import { and, asc, isNull, sql } from "drizzle-orm";
import { recycleBinEntries } from "../db/schema/index.js";
import { isBinRecordType, permanentDelete } from "../services/recycle-bin.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./types.js";

/**
 * PURGE THE RECYCLE BIN — Task 15.9, roadmap O12.
 *
 * Every soft delete since the first migration has stamped `purge_after` from
 * `RECYCLE_BIN_RETENTION_DAYS` (and, since Task 12.6, from the
 * `recycleBin.retentionDays` setting). **Nothing has ever read it.** A record
 * deleted on day one is still fully present on day four hundred, which is a
 * retention promise the product makes and does not keep.
 *
 * ── IT REUSES `permanentDelete`, WHICH IS THE POINT ─────────────────────────
 *
 * The interactive purge route already does this correctly and expensively: it
 * removes the storage object **before** the row so a KYC file cannot outlive
 * its own erasure, and it walks `documents` children for a customer or loan
 * because those cascade at the database level and would otherwise orphan their
 * objects silently and permanently (Task 9.8). Re-implementing that here would
 * mean two purge paths, and the cheap one would be the one that leaks files.
 *
 * ── ONE ROW PER TRANSACTION, DELIBERATELY ───────────────────────────────────
 *
 * `permanentDelete` opens its own transaction per entry. Batching them into one
 * would make a single unpurgeable row — a `restrict` foreign key from a record
 * created after the delete, say — abandon every other row in the batch. Per-row
 * means one failure costs one record and the next run tries again.
 *
 * ── IDEMPOTENT BY CONSTRUCTION ──────────────────────────────────────────────
 *
 * The selection predicate is `purged_at is null and restored_at is null and
 * purge_after < now()`, and `permanentDelete`'s own effect is to set
 * `purged_at`. A second run in the same minute selects nothing.
 */
export const purgeRecycleBin: Job = {
  name: "purge-recycle-bin",
  description:
    "Permanently removes recycle-bin entries whose retention window has elapsed, including their stored objects.",
  defaultLimit: 200,

  async run({ db, limit, dryRun }) {
    const due = await db
      .select({
        id: recycleBinEntries.id,
        recordType: recycleBinEntries.recordType,
        recordId: recycleBinEntries.recordId,
      })
      .from(recycleBinEntries)
      .where(
        and(
          isNull(recycleBinEntries.restoredAt),
          isNull(recycleBinEntries.purgedAt),
          sql`${recycleBinEntries.purgeAfter} is not null`,
          sql`${recycleBinEntries.purgeAfter} < now()`,
        ),
      )
      // Oldest first, so a backlog drains in the order it accumulated rather
      // than leaving the earliest deletions permanently at the back of a queue.
      .orderBy(asc(recycleBinEntries.purgeAfter))
      .limit(limit);

    if (dryRun) {
      return { processed: 0, failed: 0, details: { due: due.length, dryRun: "true" } };
    }

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const entry of due) {
      /*
       * A record type that is no longer in `BIN_REGISTRY` cannot be purged —
       * there is no table to delete from. Skipping is the only safe answer;
       * `permanentDelete` would throw, and treating it as a failure would make
       * every run red forever over a row nobody can act on.
       */
      if (!isBinRecordType(entry.recordType)) {
        skipped += 1;
        logger.warn(
          { binEntryId: entry.id, recordType: entry.recordType },
          "Recycle-bin entry has an unknown record type and cannot be purged",
        );
        continue;
      }

      try {
        // `ctx` is null: no user did this. The audit row records `actor_id`
        // null, which is the truthful account of a scheduled purge.
        await permanentDelete(db, null, null, entry.id);
        processed += 1;
      } catch (error) {
        failed += 1;
        logger.error(
          { err: error, binEntryId: entry.id, recordType: entry.recordType },
          "Failed to purge a recycle-bin entry; the row survives and the next run will retry",
        );
      }
    }

    return { processed, failed, details: { due: due.length, skipped } };
  },
};
