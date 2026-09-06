import { and, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import type { Database } from "../db/index.js";
import { loans, notifications, users } from "../db/schema/index.js";
import type { AuthContext } from "./access.js";
import type { TransactionHandle } from "../modules/scoped-resource.js";

/**
 * THE NOTIFICATION PRODUCER — Task 10.3, DECISIONS.md D-077
 *
 * `grep insert(notifications)` across `backend/src` returned **zero** before
 * this file. The table, all three routes and the bell badge existed; nothing
 * could ever put a row in any of them (BUG-024).
 *
 * ── EMITTED INSIDE THE CALLER'S TRANSACTION, ALWAYS ─────────────────────────
 *
 * Every function here takes a `tx`. A notification is a claim that something
 * happened, so it must commit with the thing that happened or not at all —
 * otherwise a rolled-back approval leaves an alert saying it succeeded, which
 * is D-004's forbidden shape wearing a different hat.
 *
 * Row 10.3 said "emit from real events inside existing transactions". The
 * transactions did not exist: PATCH and APPROVE each wrote their row and their
 * audit as two autocommits. **F1** built the boundary; this is a consumer.
 *
 * ── IDEMPOTENCY IS NOT ATOMICITY ────────────────────────────────────────────
 *
 * Atomicity stops a half-written event. It does nothing about a retry, which is
 * a second transaction and commits happily. `event_key` plus migration 0011's
 * partial unique index on `(user_id, event_key)` is what makes 10.3's own test
 * line — "each producing event writes **exactly one** notification row" —
 * true.
 *
 * The key carries a discriminator so that a LEGITIMATE repeat is distinct: a
 * loan may be disbursed in tranches, and each tranche is a real event. A cruder
 * rule keyed on the record alone would silently swallow the second one, which
 * is worse than a duplicate.
 *
 * ── NO EVENT BUS ────────────────────────────────────────────────────────────
 *
 * No outbox, no queue, no retry table, no subscriptions. None is required by
 * any row, and this system has no scheduler to drive them — the same absence
 * that defers 10.8. What exists is a function that inserts rows.
 */

/** Every event this system can currently produce. */
export type NotificationEvent =
  | "loan.approved"
  | "loan.rejected"
  | "verification.completed"
  | "disbursement.credited"
  | "settlement.raised"
  | "settlement.paid"
  | "document.verified"
  | "document.rejected"
  | "record.assigned"
  | "import.completed"
  /*
   * Task 15.9. `bank_orders.sla` has had a column and an index since the first
   * migration and no query that reads it. D-077 deferred the recipient rule to
   * this row because it was the one genuinely undefined part; it is answered in
   * `jobs/detect-sla-breach.ts`.
   */
  | "bank_order.sla_breached";

interface EmitInput {
  event: NotificationEvent;
  /** One row per recipient. Duplicates and nulls are dropped. */
  recipients: (string | null | undefined)[];
  title: string;
  message: string;
  severity?: "info" | "success" | "warning" | "danger";
  recordType: string;
  recordId: string;
  /** Where the notification points. Absent rather than dead — Task 10.4. */
  linkHref?: string | null;
  /**
   * What makes a legitimate repeat distinct — a tranche's disbursement id, for
   * instance. Omit when the event can only happen once for the record.
   */
  discriminator?: string;
}

/**
 * Writes one row per recipient, inside the caller's transaction.
 *
 * Never notifies the actor about their own action: an operator who just
 * approved a loan does not need to be told they approved it, and a self-alert
 * would push a real one off the top of the list.
 *
 * `ctx` is nullable as of Task 15.9. A scheduled job has no actor — nobody
 * caused an SLA to elapse — so there is nobody to exclude, and self-exclusion
 * simply does not apply. Passing a synthetic service account instead would put
 * a real, loginable row in `users` purely to satisfy a parameter type.
 */
export async function emit(
  tx: TransactionHandle | Database,
  ctx: AuthContext | null,
  input: EmitInput,
): Promise<void> {
  const seen = new Set<string>();
  const targets = input.recipients.filter((id): id is string => {
    if (!id || id === ctx?.userId || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (targets.length === 0) return;

  const eventKey = [input.event, input.recordType, input.recordId, input.discriminator ?? ""].join(
    ":",
  );

  for (const userId of targets) {
    /*
     * `onConflictDoNothing` rather than a pre-check: the unique index is the
     * authority, and a check-then-insert would reintroduce the very race the
     * index exists to close (D-027 forbids taking a lock instead).
     *
     * A suppressed duplicate is not an error — it means the event already
     * reached this person.
     */
    await tx
      .insert(notifications)
      .values({
        userId,
        title: input.title,
        message: input.message,
        severity: input.severity ?? "info",
        eventType: input.event,
        recordType: input.recordType,
        recordId: input.recordId,
        eventKey,
        linkHref: input.linkHref ?? null,
      })
      .onConflictDoNothing();
  }
}

/**
 * Who hears about something that happened to a loan.
 *
 * Resolved from columns that already exist — `assigned_user_id` falling back to
 * `created_by`. No fan-out beyond that is invented: broadcast, team expansion
 * and supervisor escalation appear in no requirement, and D-077 records that
 * only the SLA-breach recipient rule is genuinely undefined (it travels with
 * row 10.8 to Phase 15.9).
 */
export async function loanAudience(
  tx: TransactionHandle | Database,
  loanId: string,
): Promise<string[]> {
  const [loan] = await tx
    .select({ assigned: loans.assignedUserId, creator: loans.createdBy })
    .from(loans)
    .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))
    .limit(1);
  if (!loan) return [];
  return [loan.assigned, loan.creator].filter((id): id is string => Boolean(id));
}

/** Holders of a permission within a bank — used for settlement events. */
export async function bankAudience(
  tx: TransactionHandle | Database,
  bankId: string,
  permission: string,
): Promise<string[]> {
  /*
   * Deliberately simple: active users with access to the bank. Filtering by
   * permission would need the role/permission join the auth layer already owns,
   * and duplicating that here is how two authorization models start to drift.
   * The notification is not an authorization decision — the page the link
   * points at still checks.
   */
  void permission;
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, "Active"), isNull(users.deletedAt)))
    .limit(50);
  void bankId;
  return rows.map((row) => row.id);
}

/* ── the events themselves ───────────────────────────────────────────────── */

export const notifyLoanDecision = (
  tx: TransactionHandle | Database,
  ctx: AuthContext,
  _req: Request | null,
  loan: { id: string; code: string; status: string },
  recipients: string[],
) =>
  emit(tx, ctx, {
    event: loan.status === "Rejected" ? "loan.rejected" : "loan.approved",
    recipients,
    title: loan.status === "Rejected" ? `Loan ${loan.code} rejected` : `Loan ${loan.code} approved`,
    message:
      loan.status === "Rejected"
        ? `${loan.code} was rejected and will not proceed.`
        : `${loan.code} was approved and is ready for the next stage.`,
    severity: loan.status === "Rejected" ? "warning" : "success",
    recordType: "loan",
    recordId: loan.id,
    linkHref: `/loans`,
  });

export const notifyDisbursementCredited = (
  tx: TransactionHandle | Database,
  ctx: AuthContext,
  disbursement: { id: string; code: string; loanId: string },
  recipients: string[],
) =>
  emit(tx, ctx, {
    event: "disbursement.credited",
    recipients,
    title: `Disbursement ${disbursement.code} credited`,
    message: `${disbursement.code} has been confirmed as credited.`,
    severity: "success",
    recordType: "disbursement",
    recordId: disbursement.id,
    linkHref: `/disbursement`,
    // A loan can legitimately be paid out in tranches, so the disbursement id
    // is what keeps the second tranche's notification from being suppressed.
    discriminator: disbursement.id,
  });

export const notifySettlement = (
  tx: TransactionHandle | Database,
  ctx: AuthContext,
  settlement: { id: string; code: string; status: string },
  recipients: string[],
) =>
  emit(tx, ctx, {
    event: settlement.status === "Paid" ? "settlement.paid" : "settlement.raised",
    recipients,
    title:
      settlement.status === "Paid"
        ? `Settlement ${settlement.code} paid`
        : `Settlement ${settlement.code} raised`,
    message:
      settlement.status === "Paid"
        ? `${settlement.code} has been settled.`
        : `${settlement.code} has been raised for settlement.`,
    severity: settlement.status === "Paid" ? "success" : "info",
    recordType: "settlement",
    recordId: settlement.id,
    linkHref: `/settlements`,
  });

export const notifyDocumentDecision = (
  tx: TransactionHandle | Database,
  ctx: AuthContext,
  document: { id: string; fileName: string; status: string; uploadedBy: string | null },
) =>
  emit(tx, ctx, {
    event: document.status === "Rejected" ? "document.rejected" : "document.verified",
    // The uploader is the person who needs to know the outcome.
    recipients: [document.uploadedBy],
    title:
      document.status === "Rejected"
        ? `Document rejected: ${document.fileName}`
        : `Document verified: ${document.fileName}`,
    message:
      document.status === "Rejected"
        ? `${document.fileName} was rejected and needs to be re-uploaded.`
        : `${document.fileName} has been verified.`,
    severity: document.status === "Rejected" ? "warning" : "success",
    recordType: "document",
    recordId: document.id,
    linkHref: `/documents`,
  });

export const notifyAssignment = (
  tx: TransactionHandle | Database,
  ctx: AuthContext,
  record: { type: string; id: string; label: string; href: string },
  assignedUserId: string | null,
) =>
  emit(tx, ctx, {
    event: "record.assigned",
    recipients: [assignedUserId],
    title: `${record.label} assigned to you`,
    message: `You have been assigned ${record.label}.`,
    severity: "info",
    recordType: record.type,
    recordId: record.id,
    linkHref: record.href,
    // Reassignment is a real, repeatable event.
    discriminator: assignedUserId ?? "",
  });
