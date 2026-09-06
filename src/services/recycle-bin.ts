import { and, eq, isNull, sql } from "drizzle-orm";
import type { Request } from "express";
import type { Database } from "../db/index.js";
import { assertSafeKey, storage } from "./storage.js";

/**
 * Removes a stored object, idempotently — Task 9.8, D-075.
 *
 * Depends on the storage SERVICE rather than on `documents.routes.ts`: a purge
 * is a service-layer concern and routing a service through a routes module
 * would invert the dependency for no gain.
 *
 * `assertSafeKey` runs here too. Rows written before Task 9.4 carry whatever a
 * client sent in `storage_key` (SEC-024), and a purge is the last place that
 * should be dereferencing a traversal payload.
 */
async function purgeObject(storageKey: string | null): Promise<void> {
  if (!storageKey) return;
  assertSafeKey(storageKey);
  await storage().delete(storageKey);
}
import {
  bankOrders,
  banks,
  customers,
  disbursements,
  documents,
  fundingSources,
  ledgerEntries,
  loans,
  recycleBinEntries,
  serviceProviders,
  settlements,
  transactions,
  users,
  verifications,
} from "../db/schema/index.js";
import { conflict, notFound } from "../lib/errors.js";
import { env } from "../config/env.js";
import { recordAudit } from "./audit.js";
import { readSetting } from "./settings.js";
import type { AuthContext } from "./access.js";

/**
 * Registry of soft-deletable record types. Adding a new type here is all that
 * is needed for it to appear in the Bin, restore correctly, and be purgeable.
 */
export const BIN_REGISTRY = {
  customer: {
    table: customers,
    label: (row: Record<string, unknown>) => String(row.name ?? row.code ?? "Customer"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  bank: {
    table: banks,
    label: (row: Record<string, unknown>) => String(row.name ?? "Bank"),
    bankIdOf: (row: Record<string, unknown>) => (row.id as string | null) ?? null,
  },
  loan: {
    table: loans,
    label: (row: Record<string, unknown>) => String(row.code ?? row.applicationNo ?? "Loan"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  bank_order: {
    table: bankOrders,
    label: (row: Record<string, unknown>) => String(row.code ?? "Bank order"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  verification: {
    table: verifications,
    label: (row: Record<string, unknown>) => String(row.providerReference ?? "Verification"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  disbursement: {
    table: disbursements,
    label: (row: Record<string, unknown>) => String(row.code ?? row.utr ?? "Disbursement"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  settlement: {
    table: settlements,
    label: (row: Record<string, unknown>) => String(row.code ?? row.invoiceNo ?? "Settlement"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  transaction: {
    table: transactions,
    label: (row: Record<string, unknown>) => String(row.code ?? row.reference ?? "Transaction"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  ledger_entry: {
    table: ledgerEntries,
    label: (row: Record<string, unknown>) => String(row.voucherNo ?? row.code ?? "Ledger entry"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  document: {
    table: documents,
    label: (row: Record<string, unknown>) => String(row.fileName ?? "Document"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  funding_source: {
    table: fundingSources,
    label: (row: Record<string, unknown>) => String(row.name ?? "Funding source"),
    bankIdOf: (row: Record<string, unknown>) => (row.bankId as string | null) ?? null,
  },
  service_provider: {
    table: serviceProviders,
    label: (row: Record<string, unknown>) => String(row.name ?? "Service provider"),
    bankIdOf: () => null,
  },
  /**
   * Employees. Two things make a user unlike every other type here, and both are
   * declared rather than special-cased in the delete path:
   *
   *   - `bankIdOf` returns `null`, following `service_provider`. A user belongs
   *     to many banks through `user_bank_access`, or to none, so there is no one
   *     bank to stamp. The list route already keeps null-bank entries visible
   *     only to unscoped actors.
   *   - `redact` keeps the argon2 hash out of the snapshot. Bin entries are
   *     retained even after a purge, so an unredacted snapshot would park a live
   *     credential in a second table forever. The field list matches the audit
   *     log's own `REDACTED_FIELDS` vocabulary (`services/audit.ts`).
   *
   * `deleteFields` preserves what the hand-rolled delete did before this route
   * was moved onto `softDelete`: a deleted employee is also deactivated, so
   * restoring the record does not silently hand back a working login.
   */
  user: {
    table: users,
    label: (row: Record<string, unknown>) =>
      String(row.name ?? row.email ?? row.employeeCode ?? "Employee"),
    bankIdOf: () => null,
    redact: ["passwordHash"],
    deleteFields: { status: "Inactive" },
  },
} as const;

export type BinRecordType = keyof typeof BIN_REGISTRY;

export const isBinRecordType = (value: string): value is BinRecordType => value in BIN_REGISTRY;

/**
 * When a record deleted now becomes purgeable.
 *
 * Task 12.6 gave this a live setting. `recycleBin.retentionDays` in
 * `app_settings` wins; absent — or stored as something that no longer satisfies
 * its schema — it falls back to `RECYCLE_BIN_RETENTION_DAYS`, which is exactly
 * what this function did before, so an untouched deployment is unchanged.
 *
 * It takes the caller's handle deliberately. `softDelete` calls it from inside a
 * transaction, and on the single-connection test driver a read through the base
 * handle from within a transaction deadlocks (Task 2.11).
 */
export async function purgeDate(db: Database): Promise<Date> {
  const stored = await readSetting(db, "recycleBin.retentionDays");
  const days = typeof stored === "number" ? stored : env().RECYCLE_BIN_RETENTION_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Soft delete: the row stays put with `deleted_at` set and an index entry is
 * written to the Bin. Runs in a transaction so a record can never be marked
 * deleted without a corresponding, restorable Bin entry.
 */
export async function softDelete(
  db: Database,
  ctx: AuthContext,
  req: Request | null,
  recordType: BinRecordType,
  recordId: string,
): Promise<void> {
  const entry = BIN_REGISTRY[recordType];
  const table = entry.table;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(table)
      .where(and(eq(table.id, recordId), isNull(table.deletedAt)))
      .limit(1);

    if (!row) throw notFound(`${recordType} not found`);

    const now = new Date();
    const purgeAfter = await purgeDate(tx as unknown as Database);

    // A type may need extra columns written alongside the soft delete — a user
    // is deactivated as well as hidden, so restoring the record cannot hand back
    // a working login on its own.
    const extra = "deleteFields" in entry ? entry.deleteFields : {};

    await tx
      .update(table)
      .set({ deletedAt: now, deletedBy: ctx.userId, purgeAfter, ...extra })
      .where(eq(table.id, recordId));

    /*
     * Bin entries outlive the rows they describe — a purge keeps the entry and
     * only stamps `purged_at` — so anything secret in the snapshot would be
     * retained indefinitely. `redact` strips those fields before the write.
     */
    const raw = row as Record<string, unknown>;
    const redact: readonly string[] = "redact" in entry ? entry.redact : [];
    const snapshot = redact.length
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => !redact.includes(key)))
      : raw;

    await tx.insert(recycleBinEntries).values({
      recordType,
      recordId,
      bankId: entry.bankIdOf(raw),
      label: entry.label(raw),
      snapshot: snapshot as never,
      deletedAt: now,
      deletedBy: ctx.userId,
      purgeAfter,
    });

    await recordAudit(tx as unknown as Database, ctx, req, {
      action: "deleted",
      recordType,
      recordId,
      bankId: entry.bankIdOf(row as Record<string, unknown>),
      summary: `Moved ${entry.label(row as Record<string, unknown>)} to the recycle bin`,
    });
  });
}

export async function restore(
  db: Database,
  ctx: AuthContext,
  req: Request | null,
  binEntryId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(recycleBinEntries)
      .where(
        and(
          eq(recycleBinEntries.id, binEntryId),
          isNull(recycleBinEntries.restoredAt),
          isNull(recycleBinEntries.purgedAt),
        ),
      )
      .limit(1);

    if (!entry) throw notFound("Recycle bin entry not found");
    if (!isBinRecordType(entry.recordType)) throw conflict("Unsupported record type");

    const table = BIN_REGISTRY[entry.recordType].table;

    await tx
      .update(table)
      .set({ deletedAt: null, deletedBy: null, purgeAfter: null, updatedBy: ctx.userId })
      .where(eq(table.id, entry.recordId));

    await tx
      .update(recycleBinEntries)
      .set({ restoredAt: new Date(), restoredBy: ctx.userId })
      .where(eq(recycleBinEntries.id, binEntryId));

    await recordAudit(tx as unknown as Database, ctx, req, {
      action: "restored",
      recordType: entry.recordType,
      recordId: entry.recordId,
      bankId: entry.bankId,
      summary: `Restored ${entry.label} from the recycle bin`,
    });
  });
}

/**
 * Hard delete. The Bin entry itself is retained and marked `purged_at` so the
 * audit trail still shows the record existed, who deleted it and who purged it,
 * even though the row is gone. The brief's "do not silently destroy financial
 * history" requirement is met by that retained entry plus the audit log.
 */
/**
 * `ctx` is nullable as of Task 15.9. The scheduled retention purge has no
 * actor — nobody clicked anything — so `purged_by` and the audit row's
 * `actor_id` are both null, which is the truthful record of a system action.
 * Manufacturing a service account would put a real, loginable row in `users`
 * purely so the audit table looked tidier.
 *
 * **Authorization is unaffected.** It has never lived here: the route performs
 * `assertBinScope` and `assertCanActOnBinnedUser` before calling in, and the
 * job is not reachable over HTTP at all.
 */
export async function permanentDelete(
  db: Database,
  ctx: AuthContext | null,
  req: Request | null,
  binEntryId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(recycleBinEntries)
      .where(and(eq(recycleBinEntries.id, binEntryId), isNull(recycleBinEntries.purgedAt)))
      .limit(1);

    if (!entry) throw notFound("Recycle bin entry not found");
    if (!isBinRecordType(entry.recordType)) throw conflict("Unsupported record type");

    const table = BIN_REGISTRY[entry.recordType].table;

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * OBJECT FIRST, ROW SECOND — Task 9.8, DECISIONS.md D-075
     * ─────────────────────────────────────────────────────────────────────────
     *
     * The ordering is the decision. If the object delete fails, this throws,
     * the transaction unwinds and the ROW SURVIVES — a recoverable state, with
     * the record still pointing at the file. The other order commits the row
     * deletion and leaves a KYC document that outlived its own erasure, which
     * is precisely the compliance failure SEC-017 names.
     *
     * `deleteDocumentObject` is idempotent, so a retried purge is safe.
     *
     * ── the cascade path, which a document-only hook cannot reach ────────────
     *
     * `documents.customer_id` and `documents.loan_id` are both
     * `onDelete: "cascade"`. Purging a CUSTOMER therefore destroys its document
     * rows inside the `tx.delete` below, at the database level, without any of
     * them passing through `softDelete` or this function. Their objects would
     * orphan silently and permanently.
     *
     * So the children are enumerated and their objects removed BEFORE the
     * parent row goes. This is why 9.8 re-rated S → M.
     */
    if (entry.recordType === "document") {
      const [doc] = await tx
        .select({ storageKey: documents.storageKey })
        .from(documents)
        .where(eq(documents.id, entry.recordId))
        .limit(1);
      await purgeObject(doc?.storageKey ?? null);
    } else if (entry.recordType === "customer" || entry.recordType === "loan") {
      const column = entry.recordType === "customer" ? documents.customerId : documents.loanId;
      const children = await tx
        .select({ storageKey: documents.storageKey })
        .from(documents)
        .where(eq(column, entry.recordId));
      for (const child of children) {
        await purgeObject(child.storageKey);
      }
    }

    await tx.delete(table).where(eq(table.id, entry.recordId));

    await tx
      .update(recycleBinEntries)
      .set({ purgedAt: new Date(), purgedBy: ctx?.userId ?? null })
      .where(eq(recycleBinEntries.id, binEntryId));

    await recordAudit(tx as unknown as Database, ctx, req, {
      action: "permanently_deleted",
      recordType: entry.recordType,
      recordId: entry.recordId,
      bankId: entry.bankId,
      summary: `Permanently deleted ${entry.label}`,
      metadata: { retainedSnapshot: true },
    });
  });
}

/** Rows whose retention window has elapsed. Driven by a scheduled job. */
export async function expiredEntries(db: Database) {
  return db
    .select()
    .from(recycleBinEntries)
    .where(
      and(
        isNull(recycleBinEntries.restoredAt),
        isNull(recycleBinEntries.purgedAt),
        sql`${recycleBinEntries.purgeAfter} < now()`,
      ),
    );
}
