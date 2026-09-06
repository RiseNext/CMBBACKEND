import type { Request } from "express";
import type { Database } from "../db/index.js";
import { auditLogs } from "../db/schema/index.js";
import type { AuditAction } from "../db/schema/governance.js";
import type { AuthContext } from "./access.js";
import { logger } from "../lib/logger.js";

export interface AuditInput {
  action: AuditAction | string;
  recordType: string;
  recordId?: string | null;
  bankId?: string | null;
  summary?: string;
  changes?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * FIELDS WHOSE VALUE NEVER REACHES `audit_logs` — SEC-017, Task 13.8.
 *
 * ── WHY THIS TABLE IS THE WORST PLACE FOR PII ───────────────────────────────
 *
 * `audit_logs` is **trigger-immutable** — `0001_governance_guards.sql` rejects
 * UPDATE and DELETE at the database — and there is **no retention job** (roadmap
 * 15.9). So a value that lands here is not merely stored: it is stored
 * permanently, cannot be corrected, and cannot be erased. Under India's DPDP Act
 * a subject's erasure request is unanswerable for anything written here.
 *
 * The set was eight entries, all secrets. It missed **every piece of ordinary
 * customer PII** — so one `PATCH /api/customers/:id` correcting a typo wrote the
 * customer's PAN, mobile, date of birth, address, account number and IFSC into
 * that table, twice each, as `{ from, to }`.
 *
 * ── VALUES ARE REDACTED; THE FACT OF THE CHANGE IS NOT ──────────────────────
 *
 * A redacted field is **still listed** in `changes`, as
 * `{ from: "[redacted]", to: "[redacted]" }` — the roadmap row's own second
 * option ("or store `changes` as a key list"), applied per field. That keeps
 * what an audit trail is for: *who changed the customer's bank account, and
 * when.* Dropping the key entirely would answer "nothing happened", which is
 * worse than useless during a fraud investigation.
 *
 * A field is only listed when it **actually changed**, exactly as before — two
 * redacted placeholders are not compared, the underlying values are.
 *
 * ── WHAT IS DELIBERATELY NOT REDACTED ───────────────────────────────────────
 *
 * `name`, `city`, `state`, `branch`, `status`, `code`, and every foreign key.
 * A customer's name is the label the audit trail is *about* — redacting it
 * leaves "someone changed something about someone". `aadhaarLast4` is likewise
 * kept: four digits carry no reconstruction risk and they are how an operator
 * recognises the record. The line is drawn at values that identify or
 * authenticate a person on their own.
 *
 * ── WHAT THIS DOES NOT CLOSE ────────────────────────────────────────────────
 *
 * Two things, both recorded rather than hidden:
 *
 *   1. **Free-text sinks.** Bank-order `remarks` (Task 6.2) and notification
 *      titles (10.3) are unstructured; an operator can type a PAN into either
 *      and no field list can catch it. D-049 had both tasks record this rather
 *      than pretend otherwise.
 *   2. **Rows already written.** This changes what is written from now on. It
 *      cannot reach into an append-only table and clean what is there — that is
 *      the retention/anonymisation path, which needs 15.9's job runner.
 *
 * So **SEC-017 does not fully close here.** Its accretion half does.
 */
const REDACTED_FIELDS = new Set([
  // ── secrets (the original eight) ──
  "password",
  "passwordHash",
  "password_hash",
  "aadhaar",
  "aadhaarHash",
  "aadhaar_hash",
  "token",
  "tokenHash",
  "token_hash",
  "refreshToken",
  "resetToken",

  // ── government identifiers ──
  "pan",
  "gstin",
  "voterId",
  "voter_id",
  "passportNo",
  "passport_no",
  "drivingLicence",
  "driving_licence",

  // ── contact details, which identify a person on their own ──
  "mobile",
  "altMobile",
  "alt_mobile",
  "phone",
  "email",
  "address",
  "pincode",

  // ── financial instruments ──
  "accountNo",
  "account_no",
  "ifsc",
  "upiId",
  "upi_id",

  // ── personal attributes ──
  "dob",
  "fatherName",
  "father_name",
  "motherName",
  "mother_name",
]);

/** What a redacted field's before/after becomes. */
const REDACTED = "[redacted]";

/** Never let a secret reach the audit table via a diff. */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const from = before?.[key];
    const to = after?.[key];
    // Compared on the REAL values — two placeholders would look identical and
    // the change would vanish from the trail.
    if (JSON.stringify(from) === JSON.stringify(to)) continue;

    /*
     * The KEY survives, the VALUE does not. "Who changed the account number,
     * and when" is the question an audit trail exists to answer; dropping the
     * key would answer "nothing happened" (SEC-017, Task 13.8).
     */
    changes[key] = REDACTED_FIELDS.has(key) ? { from: REDACTED, to: REDACTED } : { from, to };
  }
  return changes;
}

/**
 * Writes an audit row. Deliberately accepts the same `db` handle the caller is
 * using, so that when the caller is inside a transaction the audit row commits
 * or rolls back atomically with the change it describes.
 */
export async function recordAudit(
  db: Database,
  ctx: AuthContext | null,
  req: Request | null,
  input: AuditInput,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: ctx?.userId ?? null,
      actorEmail: ctx?.email ?? null,
      actorRoleKey: ctx?.roleKey ?? null,
      action: input.action,
      recordType: input.recordType,
      recordId: input.recordId ?? null,
      bankId: input.bankId ?? null,
      summary: input.summary ?? null,
      changes: (input.changes ?? null) as never,
      metadata: (input.metadata ?? null) as never,
      ipAddress: req?.ip ?? null,
      userAgent: req?.headers["user-agent"] ?? null,
      requestId: req?.requestId ?? null,
    });
  } catch (error) {
    // An audit write must never mask the operation's own error, but a silent
    // failure would be worse, so it is logged at error level for alerting.
    logger.error({ err: error, audit: input }, "Failed to write audit log");
    throw error;
  }
}

export async function recordAuthEvent(
  db: Database,
  req: Request | null,
  action: AuditAction,
  email: string,
  userId: string | null,
  summary: string,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: userId,
    actorEmail: email,
    action,
    recordType: "auth",
    recordId: userId,
    summary,
    ipAddress: req?.ip ?? null,
    userAgent: req?.headers["user-agent"] ?? null,
    requestId: req?.requestId ?? null,
  });
}
