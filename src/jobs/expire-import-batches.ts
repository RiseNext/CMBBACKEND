import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { importBatches, importRows } from "../db/schema/index.js";
import { recordAudit } from "../services/audit.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./types.js";

/**
 * EXPIRE IMPORT BATCHES AND DESTROY THEIR STAGED ROWS — Task 15.9.
 *
 * ── THIS IS THE RETENTION HALF OF SEC-009, THE LAST OPEN HIGH ───────────────
 *
 * `import_rows.raw` is the uploaded spreadsheet row **verbatim**. For a customer
 * import that includes the Aadhaar number in plaintext, alongside the PAN, the
 * mobile and the date of birth. Task 13.7 hardened the ingest path — magic
 * bytes, a decompression ceiling, a row cap that refuses rather than truncates
 * — but it could not address the fact that the staged copy is **never deleted**.
 * `import_batches.expires_at` has been NOT NULL since the first migration and
 * is read by nothing, so every row of every spreadsheet ever previewed is still
 * there, in plaintext, indefinitely.
 *
 * Under India's DPDP Act that is an erasure request nobody can answer.
 *
 * ── WHAT IS DESTROYED, AND WHAT IS KEPT ─────────────────────────────────────
 *
 * The **rows** go. The **batch** stays, with its status set to `expired` and
 * its counts intact — `total_rows`, `valid_rows`, `imported_rows`, `file_name`.
 * That distinction is the whole design: "on 12 March, Anita imported 412
 * customers from `march-book.xlsx`" is an operational record worth keeping and
 * contains no personal data. The 412 staged copies of somebody's Aadhaar number
 * are not, and do not need to survive for the record to be meaningful.
 *
 * A `previewed` batch that was never confirmed loses its rows too. That is
 * correct and is why `expires_at` exists: an abandoned preview is a spreadsheet
 * of customer PII sitting in the database because somebody closed a tab.
 *
 * ── ALREADY-IMPORTED BATCHES ARE INCLUDED ───────────────────────────────────
 *
 * A batch with status `imported` has already written its records to `customers`
 * and `loans`, where they belong and where the Aadhaar number is peppered and
 * hashed (13.4). The staged plaintext copy is then pure duplication of the most
 * sensitive field in the system. It is the **first** thing that should go, not
 * an exception.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 *
 * Selection is `expires_at < now() and status <> 'expired'`, and the job's own
 * effect is to set `status = 'expired'`. A second run finds nothing. Deleting
 * rows for a batch that has none already is a no-op.
 */

/** `expired` is the terminal state this job writes; never re-process it. */
const TERMINAL = ["expired"];

export const expireImportBatches: Job = {
  name: "expire-import-batches",
  description:
    "Expires import batches past their retention window and destroys their staged rows, which hold plaintext Aadhaar (SEC-009).",
  defaultLimit: 100,

  async run({ db, limit, dryRun }) {
    const due = await db
      .select({
        id: importBatches.id,
        fileName: importBatches.fileName,
        status: importBatches.status,
        totalRows: importBatches.totalRows,
        bankId: importBatches.bankId,
      })
      .from(importBatches)
      .where(
        and(
          sql`${importBatches.expiresAt} < now()`,
          notInArray(importBatches.status, TERMINAL),
        ),
      )
      .orderBy(asc(importBatches.expiresAt))
      .limit(limit);

    if (dryRun) {
      return { processed: 0, failed: 0, details: { due: due.length, dryRun: "true" } };
    }

    let processed = 0;
    let failed = 0;
    let rowsDestroyed = 0;

    for (const batch of due) {
      try {
        const destroyed = await db.transaction(async (tx) => {
          /*
           * Counted before the delete rather than inferred from `total_rows`:
           * a batch may already have been partially cleaned, and the audit row
           * must say what THIS run actually destroyed.
           */
          const [{ n = 0 } = {}] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(importRows)
            .where(eq(importRows.batchId, batch.id));

          await tx.delete(importRows).where(eq(importRows.batchId, batch.id));
          await tx
            .update(importBatches)
            .set({ status: "expired" })
            .where(eq(importBatches.id, batch.id));

          /*
           * Audited, with counts and the file name only. The whole point of the
           * job is that the row CONTENT must not be retained, so writing any of
           * it into `audit_logs` — which is trigger-immutable and has no purge
           * path of its own — would move the problem rather than solve it.
           */
          await recordAudit(tx as never, null, null, {
            action: "deleted",
            recordType: "import_batch",
            recordId: batch.id,
            bankId: batch.bankId,
            summary: `Retention: expired import batch ${batch.fileName} and destroyed ${n} staged row(s)`,
            metadata: { rowsDestroyed: n, previousStatus: batch.status },
          });

          return n;
        });

        rowsDestroyed += destroyed;
        processed += 1;
      } catch (error) {
        failed += 1;
        logger.error(
          { err: error, batchId: batch.id },
          "Failed to expire an import batch; its staged rows survive and the next run will retry",
        );
      }
    }

    return { processed, failed, details: { due: due.length, rowsDestroyed } };
  },
};

/**
 * How many staged rows are currently retained past their batch's expiry.
 *
 * Exported for the readiness/observability surface and for the tests: "SEC-009
 * is closed" is a claim about this number reaching and staying at zero, and a
 * claim like that needs something that can measure it.
 */
export async function overdueStagedRowCount(db: Parameters<Job["run"]>[0]["db"]): Promise<number> {
  const [{ n = 0 } = {}] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(importRows)
    .innerJoin(importBatches, eq(importRows.batchId, importBatches.id))
    .where(and(sql`${importBatches.expiresAt} < now()`, notInArray(importBatches.status, TERMINAL)));
  return n;
}

/** Exported so the tests assert against the same vocabulary the job uses. */
export const IMPORT_TERMINAL_STATUSES = TERMINAL;
