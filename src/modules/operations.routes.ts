import { Router, type Request } from "express";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import {
  bankOrders,
  bankOrderStages,
  bankOrderStatuses,
  customers,
  disbursements,
  disbursementStatuses,
  documents,
  documentStatuses,
  verificationStatuses,
  fundingSources,
  ledgerEntries,
  loans,
  loanStatuses,
  serviceProviders,
  settlements,
  settlementStatuses,
  transactions,
  transactionStatuses,
  transactionTypes,
  verifications,
} from "../db/schema/index.js";
import { badRequest, conflict, notFound, unprocessable } from "../lib/errors.js";
import { patchSchema } from "../lib/zod.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";
import {
  createScopedResource,
  nextResourceCode,
  type TransactionHandle,
} from "./scoped-resource.js";
import {
  loanAudience,
  notifyDisbursementCredited,
  notifyLoanDecision,
  notifySettlement,
} from "../services/notifications.js";

const money = z.coerce.number().min(0).max(1_000_000_000_000);
const uuidField = z.string().uuid();

/**
 * A customer and a loan must belong to the same bank as the record pointing at
 * them. Without this a user could attach a bank-A customer to a bank-B loan and
 * read the customer's name back through the loan endpoint.
 */
async function assertSameBank(
  db: ReturnType<typeof getDb>,
  table: typeof customers | typeof loans,
  id: string | undefined,
  bankId: string | undefined,
  label: string,
): Promise<void> {
  if (!id || !bankId) return;
  const [row] = await db
    .select({ bankId: table.bankId })
    .from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
    .limit(1);
  if (!row) throw notFound(`${label} not found`);
  if (row.bankId !== bankId) throw badRequest(`The ${label} belongs to a different bank`);
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LOAN STATE MACHINE — Task 5.2, DECISIONS.md D-010 / D-056 / D-057
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ This is a transcription of the RATIFIED machine at BUSINESS_FLOW.md §3.3.
 * **That edge table is authoritative and this must not drift from it.** D-010
 * requires the machine to be defined in the document *before* enforcement is
 * written, which is the order Task 5.2 was executed in.
 *
 * Ten edges over seven statuses. `Rejected` and `Closed` are terminal and carry
 * an explicit empty array rather than being omitted — an omitted key means
 * "unknown status" to the factory, which fails closed with a different message.
 *
 * There are no self-loops. Re-approving an already-Approved loan is refused
 * rather than silently re-stamping `approved_by`/`approved_at`.
 *
 * Guards DEFERRED, with reasons recorded in D-057 and BUSINESS_FLOW.md §3.3
 * rather than quietly dropped: the verification-row precondition on
 * Submitted→Under Review, the verification-status and required-documents
 * preconditions on →Approved, the `sum(disbursements) >= amount_approved`
 * precondition on →Disbursed, and four-eyes on →Approved. Phase 5 guards
 * transition *legality*; those five are additional business preconditions on
 * edges that are already legal, and each belongs to a phase that owns the data
 * it would read. Deferring them does not weaken the graph — the graph is
 * complete.
 */
const loanTransitions: Record<string, readonly string[]> = {
  Draft: ["Submitted", "Closed"],
  Submitted: ["Under Review", "Rejected"],
  "Under Review": ["Submitted", "Approved", "Rejected"],
  Approved: ["Disbursed", "Closed"],
  Disbursed: ["Closed"],
  Rejected: [],
  Closed: [],
};

/**
 * The statuses a loan may be **created** in — BUSINESS_FLOW.md §3.3.
 *
 * `Draft` is the machine's start state and the column default
 * (`schema/operations.ts:108`). `Submitted` is admitted because it is what the
 * product actually creates — `loans/page.tsx:139` posts it — and it is one
 * `submit` edge away, so creating there is create-plus-submit in one request.
 *
 * The other five are refused, and **`Approved` is the one that matters.**
 * `requests.create` is held by Team Leader *and* Executive
 * (`lib/permissions.ts:277`, `:304`); `requests.approve` is held by neither. So
 * `POST /api/loans {"status":"Approved"}` was the identical privilege bypass
 * D-056 closed on PATCH, one route over — a loan approved by someone who may not
 * approve, with `approved_by` left NULL because only the approve route stamps
 * it, and audited as "created" rather than "approved".
 */
const loanInitialStatuses = ["Draft", "Submitted"] as const;

export const loansRouter = createScopedResource({
  table: loans,
  recordType: "loan",
  permissions: {
    view: PERMISSIONS.requests.view,
    create: PERMISSIONS.requests.create,
    edit: PERMISSIONS.requests.edit,
    delete: PERMISSIONS.requests.delete,
    approve: PERMISSIONS.requests.approve,
  },
  codePrefix: "LN",
  codeStart: 1000,
  searchable: ["code", "applicationNo"],
  filterable: ["status", "loanType", "priority", "customerId", "assignedUserId", "assignedTeamId"],
  numericFields: [
    "amountRequested",
    "amountApproved",
    "interestRate",
    "emi",
    "processingFee",
    "commission",
  ],
  createSchema: z.object({
    customerId: uuidField,
    bankId: uuidField,
    loanType: z.string().trim().min(2).max(80),
    amountRequested: money.default(0),
    amountApproved: money.default(0),
    interestRate: z.coerce.number().min(0).max(100).default(0),
    tenureMonths: z.coerce.number().int().min(0).max(600).default(0),
    emi: money.default(0),
    processingFee: money.default(0),
    commission: money.default(0),
    // The schema layer's const, not a second literal copy of the same seven
    // strings — Task 5.3. `loanStatuses` had zero consumers before this line.
    status: z.enum(loanStatuses).default("Draft"),
    applicationNo: z.string().trim().max(60).optional().nullable(),
    appliedOn: z.coerce.date().optional().nullable(),
    verificationRequired: z.boolean().default(false),
    fundingSourceId: uuidField.optional().nullable(),
    assignedUserId: uuidField.optional().nullable(),
    assignedTeamId: uuidField.optional().nullable(),
    priority: z.enum(["Low", "Normal", "High", "Urgent"]).default("Normal"),
    dueDate: z.coerce.date().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  // Task 5.3 — the approve route parsed `z.string().min(1)` and wrote whatever
  // it was handed, so `{"status":"banana"}` was a 200 that persisted `banana`.
  allowedStatuses: loanStatuses,
  // Task 5.2 — enforced at CREATE and APPROVE. See the machine above.
  allowedTransitions: loanTransitions,
  initialStatuses: loanInitialStatuses,
  /*
   * D-056 — the approve route becomes the single client-facing writer of loan
   * status. Team Leader holds `requests.edit` but not `requests.approve`, so
   * `PATCH {"status":"Approved"}` was an approval performed by a role that may
   * not approve: `approved_by` stayed NULL and the audit row said "updated".
   * Guarding the transition would not have closed it — Draft→Submitted→Under
   * Review→Approved are all *legal* edges, so an editor could have walked the
   * loan up lawfully. Only refusal closes it.
   *
   * Loans only. Bank orders (6.5) and disbursements (7.3) own their own.
   */
  patchRefusals: {
    status: "Loan status is not editable here. Use POST /api/loans/:id/approve instead.",
    // Deliberately does NOT name a route that will write it: nothing does yet,
    // and D-057 records that the Approved→Disbursed amount guard stays deferred
    // precisely because `amount_approved` is never populated. Promising a route
    // that does not do the job is the defect RULES §4 exists to prevent.
    amountApproved:
      "The approved amount is not editable here. It is part of the approval decision, not an edit.",
  },
  /*
   * Notification emission — Task 10.3, D-077.
   *
   * Inside the approve transaction, so the alert commits with the decision it
   * describes or not at all. A rolled-back approval that still told someone it
   * succeeded is D-004's forbidden shape.
   */
  /*
   * THE SANCTIONED AMOUNT IS CAPTURED AT APPROVAL — audit U-5.
   *
   * `amount_approved` was written by **nothing**. PATCH refuses it under D-056
   * ("part of the approval decision, not an edit") and the approve route had no
   * way to carry it, so every approved loan in the system reported a sanctioned
   * amount of **0** — and `/api/dashboard/bank-performance` sums that column
   * (`operations.routes.ts`, `coalesce(sum(amount_approved),0)`), as does the
   * reports "Report value" tile. The business's headline number was structurally
   * zero.
   *
   * Optional in the schema and required by `beforeApprove` below, rather than
   * required here: only the `->Approved` transition needs it, and demanding it
   * on a rejection or a closure would be nonsense.
   */
  approveInput: z.object({
    amountApproved: money.optional(),
  }),

  /**
   * A loan cannot become Approved without the amount that was approved.
   *
   * D-057 deferred the `Approved -> Disbursed` amount guard *precisely because*
   * `amount_approved` was never populated — there was nothing to guard against.
   * This is the row that populates it, so that guard becomes possible later;
   * it is deliberately NOT added here (D-043).
   */
  beforeApprove(before, input) {
    if (String(input.status) !== "Approved") return;

    const amount = input.amountApproved;
    if (amount === undefined || Number(amount) <= 0) {
      const message =
        "Enter the amount being sanctioned. An approved loan must record what was approved.";
      throw unprocessable(message, [{ path: "amountApproved", message }]);
    }

    /*
     * A sanction above what was asked for is almost always a typo, and it flows
     * straight into commission and every report. Refusing is cheap; a silent
     * 10x is not. Below the requested amount is normal and is allowed.
     */
    const requested = Number((before as { amountRequested?: unknown }).amountRequested ?? 0);
    if (requested > 0 && Number(amount) > requested) {
      const message = `The approved amount cannot exceed the amount requested (${requested}).`;
      throw unprocessable(message, [{ path: "amountApproved", message }]);
    }
  },

  async afterApprove(_before, after, { tx, ctx, req }) {
    const status = String(after.status);

    /*
     * Task 6.4 — a loan that reaches `Submitted` through the approve route gets
     * its bank order here, exactly as one created `Submitted` does below. Both
     * doors into the same state open the same thing; a file that became
     * submitted by a different route is not a different file.
     */
    if (status === "Submitted") {
      await ensureBankOrderForLoan(tx, ctx, req, after);
      return;
    }

    if (status !== "Approved" && status !== "Rejected") return;

    const audience = await loanAudience(tx, after.id as string);
    await notifyLoanDecision(
      tx,
      ctx,
      null,
      { id: after.id as string, code: String(after.code), status },
      audience,
    );
  },
  /*
   * Task 6.4 — submitting a loan opens its bank order, atomically.
   *
   * "Link loan submission to bank-order creation so the stages connect." Before
   * this, `POST /api/bank-orders` had **zero callers** and orders could only
   * appear by direct database insert — so the Kanban board tracked a pipeline
   * nothing ever entered. The product hardcodes `status: "Submitted"` at loan
   * creation, so this is the path that actually happens.
   *
   * Inside the loan's own transaction (F1/D-060's `afterCreate`), so the loan
   * and its order commit together or not at all. A submitted loan with no order
   * is a file the bank pipeline cannot see.
   */
  async afterCreate(created, { tx, ctx, req }) {
    if (String(created.status) !== "Submitted") return;
    await ensureBankOrderForLoan(tx, ctx, req, created);
  },
  async beforeWrite(input, { db, existing }) {
    const bankId = (input.bankId ?? existing?.bankId) as string | undefined;
    await assertSameBank(db, customers, input.customerId as string | undefined, bankId, "customer");
  },
});

/**
 * Opens the bank order for a submitted loan — Task 6.4.
 *
 * **Idempotent by design, and belt-and-braces about it.** The existence check
 * below covers the ordinary case (a loan submitted, then re-submitted through
 * the machine); migration `0013`'s partial unique index covers the case the
 * check structurally cannot, which is two concurrent submissions both reading
 * "no order" before either writes. D-027 forbids a row lock, so the constraint
 * is the compliant answer — the same reasoning as the 8.8 chain's indexes.
 *
 * Everything is derived from the loan. Nothing is taken from the request: the
 * bank and customer come from the loan row itself, which is what makes
 * `assertSameBank`'s invariant hold without a second check (D-059).
 */
async function ensureBankOrderForLoan(
  tx: TransactionHandle,
  ctx: ReturnType<typeof authOf>,
  req: Request,
  loan: Record<string, unknown>,
): Promise<void> {
  const loanId = loan.id as string;

  const [existing] = await tx
    .select({ id: bankOrders.id })
    .from(bankOrders)
    .where(and(eq(bankOrders.loanId, loanId), isNull(bankOrders.deletedAt)))
    .limit(1);
  if (existing) return;

  // `tx`, never the base handle — reading through it from inside a transaction
  // deadlocks on a single-connection driver (D-032).
  const code = await nextResourceCode("BO", tx);

  const [order] = await tx
    .insert(bankOrders)
    .values({
      code,
      loanId,
      // Derived from the loan, not supplied. A bank order for loan X is at
      // loan X's bank, by definition.
      bankId: loan.bankId as string,
      customerId: loan.customerId as string,
      submittedOn: new Date(),
      // The ratified initial state — BUSINESS_FLOW.md §3.3. Anything else would
      // be refused by the machine 6.1 enforces.
      stage: "Login",
      status: "In Progress",
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();

  await recordAudit(tx as never, ctx, req, {
    action: "created",
    recordType: "bank_order",
    recordId: (order as { id: string }).id,
    bankId: loan.bankId as string,
    summary: `Opened bank order ${code} on submission of loan ${String(loan.code)}`,
    metadata: { loanId, loanCode: String(loan.code) },
  });
}

/**
 * Creating a loan also opens its verification record, in the same transaction.
 * A loan that requires verification but has no verification row is a state the
 * system should never be able to reach.
 */
loansRouter.post("/:id/verification", requireAuth, requirePermission(PERMISSIONS.verification.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const loanId = req.params.id as string;
    const db = getDb();

    const filters = [eq(loans.id, loanId), isNull(loans.deletedAt)];
    const scope = bankScope(ctx, loans.bankId);
    if (scope) filters.push(scope);

    const [loan] = await db.select().from(loans).where(and(...filters)).limit(1);
    if (!loan) throw notFound("Loan not found");

    const input = z
      .object({
        required: z.boolean(),
        handledByBank: z.boolean().default(false),
        serviceProviderId: uuidField.optional().nullable(),
        providerReference: z.string().trim().max(120).optional().nullable(),
        notes: z.string().trim().max(2000).optional().nullable(),
      })
      .parse(req.body);

    // The brief's conditional rule, enforced rather than assumed: if
    // verification is required, a provider is mandatory; if it is not, we record
    // that the requesting bank handled it.
    if (input.required && !input.serviceProviderId) {
      throw badRequest("A service provider is required when verification_required is true");
    }

    const [existing] = await db
      .select({ id: verifications.id })
      .from(verifications)
      .where(and(eq(verifications.loanId, loanId), isNull(verifications.deletedAt)))
      .limit(1);
    if (existing) throw conflict("This loan already has a verification record");

    const [created] = await db
      .insert(verifications)
      .values({
        loanId,
        customerId: loan.customerId,
        bankId: loan.bankId,
        required: input.required,
        handledByBank: input.required ? false : true,
        serviceProviderId: input.serviceProviderId ?? null,
        providerReference: input.providerReference ?? null,
        status: input.required ? "Requested" : "Verified",
        result: input.required ? null : "Handled by the requesting bank",
        requestedAt: input.required ? new Date() : null,
        completedAt: input.required ? null : new Date(),
        notes: input.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    await db
      .update(loans)
      .set({ verificationRequired: input.required, updatedBy: ctx.userId })
      .where(eq(loans.id, loanId));

    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "verification",
      recordId: created?.id,
      bankId: loan.bankId,
      summary: input.required
        ? `Requested third-party verification for ${loan.code}`
        : `Recorded bank-handled verification for ${loan.code}`,
    });

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

export const verificationsRouter = createScopedResource({
  table: verifications,
  recordType: "verification",
  permissions: {
    view: PERMISSIONS.verification.view,
    create: PERMISSIONS.verification.create,
    edit: PERMISSIONS.verification.edit,
    approve: PERMISSIONS.verification.approve,
  },
  searchable: ["providerReference"],
  filterable: ["status", "serviceProviderId", "loanId"],
  createSchema: z.object({
    loanId: uuidField,
    customerId: uuidField.optional().nullable(),
    bankId: uuidField,
    required: z.boolean().default(false),
    handledByBank: z.boolean().default(false),
    serviceProviderId: uuidField.optional().nullable(),
    providerReference: z.string().trim().max(120).optional().nullable(),
    // Reads the shared const rather than restating it, so the zod enum, the
    // approve vocabulary and `verifications_status_check` cannot drift apart.
    status: z.enum(verificationStatuses).default("Pending"),
    result: z.string().trim().max(500).optional().nullable(),
    requestedAt: z.coerce.date().optional().nullable(),
    completedAt: z.coerce.date().optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  /*
   * SEC-016's LAST COLUMN OPTS IN — Task 13.13.
   *
   * `verifications` has an approve route and configured no `allowedStatuses`,
   * so `approveBody` fell back to `z.string().min(1)` and the route accepted
   * any non-empty string. It is the one resource that "opts into nothing" that
   * `loan-state-machine.test.ts` case 6 has pinned since Phase 5, and the
   * reason SEC-016 stayed open through Phases 6-8.
   *
   * Migration `0014` closes it at the database. This closes it one layer
   * earlier, which is what turns a generic 422 from a CHECK violation into a
   * message naming the field and listing the legal values — the same treatment
   * loans, bank orders, disbursements and settlements already get.
   *
   * **Vocabulary only.** No `allowedTransitions` and no `initialStatuses` are
   * configured: the verification machine is recorded as *proposed*, not
   * ratified, in BUSINESS_FLOW.md 3.3.1. Adding transition rules here would be
   * inventing business policy under cover of a security fix (D-043, D-057).
   */
  allowedStatuses: verificationStatuses,
});

export const bankOrdersRouter = createScopedResource({
  table: bankOrders,
  recordType: "bank_order",
  permissions: {
    view: PERMISSIONS.bankOrders.view,
    create: PERMISSIONS.bankOrders.create,
    edit: PERMISSIONS.bankOrders.edit,
    delete: PERMISSIONS.bankOrders.delete,
  },
  codePrefix: "BO",
  codeStart: 2400,
  searchable: ["code", "officer", "remarks"],
  filterable: ["status", "stage", "loanId", "customerId"],
  createSchema: z.object({
    loanId: uuidField,
    bankId: uuidField,
    customerId: uuidField,
    submittedOn: z.coerce.date().optional().nullable(),
    sla: z.coerce.date().optional().nullable(),
    stage: z.enum(bankOrderStages).default("Login"),
    status: z.enum(bankOrderStatuses).default("In Progress"),
    officer: z.string().trim().max(120).optional().nullable(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  }),
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE BANK-ORDER STAGE MACHINE — Task 6.1
   * DECISIONS.md D-010, D-062, D-063 · BUSINESS_FLOW.md §3.3
   * ───────────────────────────────────────────────────────────────────────────
   *
   * `transitionColumn: "stage"` is the reason F1-c exists. Every other machine
   * in this file guards a column literally called `status` and is enforced at
   * the approve route; bank orders have **neither**. They configure no `approve`
   * permission, so `POST /:id/approve` is never mounted, and the column that
   * carries the workflow is `stage`.
   *
   * Setting `transitionColumn` explicitly is also what turns PATCH-side
   * enforcement on — which for this resource is the only enforcement point
   * there is.
   *
   * Strictly ordered, exactly one step forward. Backward movement is not an
   * edge at all: BUSINESS_FLOW.md §3.3 routes it through `status = Returned`,
   * whose `rework` transition resets the stage. That reset is a **side effect**
   * and is deferred to 6.4 with the other cross-record preconditions.
   */
  transitionColumn: "stage",
  allowedStatuses: bankOrderStages,
  allowedTransitions: {
    Login: ["Credit Check"],
    "Credit Check": ["Field Verification"],
    "Field Verification": ["Sanction"],
    Sanction: ["Disbursal Queue"],
    "Disbursal Queue": [],
  },
  initialStatuses: ["Login"],
  async beforeWrite(input, { db, existing }) {
    const bankId = (input.bankId ?? existing?.bankId) as string | undefined;
    await assertSameBank(db, loans, input.loanId as string | undefined, bankId, "loan");
    await assertSameBank(db, customers, input.customerId as string | undefined, bankId, "customer");

    /*
     * THE SECOND MACHINE — `bank_orders.status`, Task 6.1 / D-063.
     *
     * `bank_orders` is the only table in the schema with two workflow columns,
     * and D-063 assigns both to Phase 6 rather than leaving `status` unowned as
     * the original row text would have.
     *
     * Enforced HERE rather than through `transitionColumn`, because that field
     * names ONE column by design. Widening the factory to hold a map of
     * machines would be a second mechanism serving one resource — the thing
     * D-062 was careful not to build. `beforeWrite` already receives `existing`
     * and already runs on both create and patch, so the guard costs a dozen
     * lines and stays visible next to the vocabulary it enforces.
     *
     * Same shape as the factory's own refusals: fail closed on an unrecognised
     * current value, 422 with `details[].path` so D-031's field mapping applies.
     */
    if (input.status === undefined) return;
    const requested = String(input.status);

    if (!existing) {
      // Create: an initial status has no `from`, so the rule is membership.
      if (requested !== "In Progress") {
        const message = `A bank order cannot be created with status ${requested}. A new bank order starts as: In Progress`;
        throw unprocessable(message, [{ path: "status", message }]);
      }
      return;
    }

    const current = String((existing as { status?: unknown }).status ?? "");
    const allowed: Record<string, readonly string[]> = {
      "In Progress": ["On Hold", "Cleared", "Returned"],
      "On Hold": ["In Progress"],
      Returned: ["In Progress"],
      Cleared: [],
    };
    const next = allowed[current];

    if (!next) {
      const message = `${current || "An empty status"} is not a recognised bank order status, so no change can be made from it`;
      throw unprocessable(message, [{ path: "status", message }]);
    }
    if (requested === current || next.includes(requested)) return;

    const message =
      next.length === 0
        ? `${current} is a final status for a bank order and cannot be changed`
        : `A bank order cannot move from ${current} to ${requested}. From ${current} the allowed statuses are: ${next.join(", ")}`;
    throw unprocessable(message, [{ path: "status", message }]);
  },
});

export const disbursementsRouter = createScopedResource({
  table: disbursements,
  recordType: "disbursement",
  permissions: {
    view: PERMISSIONS.disbursements.view,
    create: PERMISSIONS.disbursements.create,
    edit: PERMISSIONS.disbursements.edit,
    approve: PERMISSIONS.disbursements.approve,
  },
  codePrefix: "DSB",
  codeStart: 5000,
  searchable: ["code", "utr", "creditedTo"],
  filterable: ["status", "mode", "loanId", "customerId", "fundingSourceId"],
  numericFields: ["amount"],
  createSchema: z.object({
    loanId: uuidField,
    customerId: uuidField,
    bankId: uuidField,
    fundingSourceId: uuidField.optional().nullable(),
    amount: money,
    utr: z.string().trim().max(40).optional().nullable(),
    mode: z.enum(["NEFT", "RTGS", "IMPS"]).default("NEFT"),
    disbursedOn: z.coerce.date().optional().nullable(),
    status: z.enum(disbursementStatuses).default("In Transit"),
    creditedTo: z.string().trim().max(60).optional().nullable(),
    assignedUserId: uuidField.optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE DISBURSEMENT STATE MACHINE — Task 7.3
   * DECISIONS.md D-010, D-057, D-066 · SECURITY_AUDIT.md SEC-016
   * ───────────────────────────────────────────────────────────────────────────
   *
   * Ratified at BUSINESS_FLOW.md §3.3. Three guards, matching the loan machine's
   * shape exactly, because the holes here are the same three holes:
   *
   *   allowedStatuses     the approve route's vocabulary. Without it the body
   *                       parsed `z.string().min(1)` and wrote the result
   *                       through — SEC-016's abuse scenario is written against
   *                       THIS resource, and D-010 opens with `'Credited '`.
   *   allowedTransitions  the from→to graph. `In Transit` is the only state
   *                       anything may leave; `Credited` and `Failed` are
   *                       terminal, so "re-initiate" cannot mutate a Failed row
   *                       and must create a new one (7.2).
   *   initialStatuses     closes `POST {"status":"Credited"}`. Manager holds
   *                       `disbursements.create` (`lib/permissions.ts:250`) and
   *                       NOT `disbursements.approve` — creating a Credited row
   *                       is an approval performed by a role that may not
   *                       approve, with `approved_by` left NULL and the audit
   *                       row reading "created".
   *
   * `patchRefusals` closes the twin hole on PATCH. Manager also holds
   * `disbursements.edit` (`:251`), and `patchSchema` keeps the create enum, so
   * `PATCH {"status":"Credited"}` was a 200. **Guarding the transition would
   * not have closed it** — `In Transit → Credited` is a legal edge — which is
   * exactly what D-056 found for loans: only refusal closes it.
   *
   * `credited_to` and `disbursed_on` carry no authority and stay PATCH-editable.
   */
  allowedStatuses: disbursementStatuses,
  allowedTransitions: {
    "In Transit": ["Credited", "Failed"],
    Credited: [],
    Failed: [],
  },
  initialStatuses: ["In Transit"],
  patchRefusals: {
    status: "A disbursement's status is set by the approve route, not by an edit.",
  },
  async beforeWrite(input, { db, existing }) {
    const bankId = (input.bankId ?? existing?.bankId) as string | undefined;
    await assertSameBank(db, loans, input.loanId as string | undefined, bankId, "loan");
    await assertSameBank(db, customers, input.customerId as string | undefined, bankId, "customer");
  },
  /*
   * THE ONE BUSINESS PRECONDITION 7.3 TAKES IN SCOPE — BUSINESS_FLOW.md §3.3:
   * "Guard on ->Credited : utr must be non-null."
   *
   * A UTR is the bank's own reference for a completed payment. Marking a
   * disbursement Credited without one asserts that money arrived while
   * recording nothing that could ever prove it — and `disbursements_utr_unique`
   * is partial on `utr is not null`, so such rows do not even collide with each
   * other. That is how a double-payment hides.
   *
   * Enforced through `afterApprove` rather than a new `beforeApprove` hook:
   * throwing rolls the status change back with everything else (D-062), so the
   * observable result is identical to refusing before the write, and F1's
   * surface does not grow a second hook for one guard.
   *
   * `->Failed` is deliberately NOT guarded. A transfer can fail before the bank
   * ever issues a reference, and requiring one would make a failure
   * unrecordable.
   *
   * The remaining §3.3 preconditions — `disbursed_on`/`credited_to` — stay
   * deferred: `credited_to` is written by nothing in the product today, so
   * requiring it would block the workflow it is meant to describe. Same
   * reasoning D-057 applied to the four loan guards.
   */
  async afterApprove(_before, after, { tx, ctx }) {
    if (after.status !== "Credited") return;

    if (after.utr === null || after.utr === undefined || String(after.utr).trim() === "") {
      const message =
        "A disbursement cannot be marked Credited without a UTR. Record the bank's payment reference first.";
      throw unprocessable(message, [{ path: "utr", message }]);
    }

    // Task 10.3 — money has moved, and the people who own the file are told
    // inside the same transaction that recorded it.
    const audience = await loanAudience(tx, after.loanId as string);
    await notifyDisbursementCredited(
      tx,
      ctx,
      { id: after.id as string, code: String(after.code), loanId: after.loanId as string },
      audience,
    );
  },
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * CROSS-STAGE ATOMICITY — Task 5.7, DECISIONS.md D-060, BUSINESS_FLOW.md §4.1
   * ───────────────────────────────────────────────────────────────────────────
   *
   * "Record a disbursement for loan LN-1001 and the loan stays Submitted
   * forever." That was measured, not alleged: the only `update(loans)` in the
   * whole backend set `verification_required` and nothing else, so
   * `dashboard/stats` reported `disbursed_value` as a permanent ₹0 no matter how
   * much money the `disbursements` table said had moved.
   *
   * This runs INSIDE the factory's create transaction, on its handle. The
   * disbursement row, the loan's advance to Disbursed and both audit rows
   * therefore commit together or not at all. Throwing from here rolls the
   * disbursement back with everything else — which is exactly how a loan that is
   * not ready to be paid out refuses the payment rather than half-recording it.
   *
   * `beforeWrite` above could not have done this: it fires before the insert, so
   * there is no disbursement id to reference and no transaction to join.
   *
   * The legality test reads `loanTransitions` rather than hardcoding "Approved",
   * so the ratified §3.3 machine stays the single definition of the edge.
   */
  async afterCreate(created, { tx, ctx, req }) {
    const loanId = created.loanId as string;

    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))
      .limit(1);
    // beforeWrite already resolved this loan and asserted its bank, so this is
    // the narrow case of it being deleted between the two reads.
    if (!loan) throw notFound("Loan not found");

    /*
     * Already Disbursed: record the payment and leave the loan alone.
     *
     * NOT an oversight and NOT a silent failure — a loan may legitimately be
     * paid out in more than one tranche, and the machine has no Disbursed→
     * Disbursed self-loop. The loan is already in the target state, so there is
     * nothing to advance and nothing to audit about the loan.
     */
    if (loan.status === "Disbursed") return;

    if (!(loanTransitions[loan.status] ?? []).includes("Disbursed")) {
      /*
       * The offending field in THIS request is `loanId` — the caller chose a
       * loan that is not ready — so that is what `details.path` names, per D-031
       * (details are consumed by shape and mapped onto the form control). The
       * disbursement screen's loan picker already lists only Approved/Disbursed
       * loans (`disbursement/page.tsx:46-48`), so the server now enforces what
       * the UI already assumed.
       */
      const message = `Loan ${loan.code} is ${loan.status}. A disbursement can only be recorded against an Approved loan.`;
      throw unprocessable(message, [{ path: "loanId", message }]);
    }

    const [after] = await tx
      .update(loans)
      .set({ status: "Disbursed", updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(loans.id, loanId))
      .returning();

    await recordAudit(tx as never, ctx, req, {
      action: "disbursed",
      recordType: "loan",
      recordId: loanId,
      bankId: loan.bankId,
      summary: `Advanced loan ${loan.code} to Disbursed on disbursement ${String(created.code)}`,
      changes: diff(loan as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>),
      metadata: { disbursementId: String(created.id), disbursementCode: String(created.code) },
    });
  },
});

export const settlementsRouter = createScopedResource({
  table: settlements,
  recordType: "settlement",
  permissions: {
    view: PERMISSIONS.settlements.view,
    create: PERMISSIONS.settlements.create,
    edit: PERMISSIONS.settlements.edit,
    approve: PERMISSIONS.settlements.approve,
  },
  codePrefix: "STL",
  codeStart: 3300,
  searchable: ["code", "invoiceNo", "period"],
  filterable: ["status", "period"],
  numericFields: ["grossCommission", "tds", "netPayable"],
  createSchema: z.object({
    bankId: uuidField,
    period: z.string().trim().min(3).max(40),
    cases: z.coerce.number().int().min(0).default(0),
    grossCommission: money.default(0),
    tds: money.default(0),
    netPayable: money.default(0),
    status: z.enum(settlementStatuses).default("Pending"),
    invoiceNo: z.string().trim().max(60).optional().nullable(),
    raisedOn: z.coerce.date().optional().nullable(),
    settledOn: z.coerce.date().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE SETTLEMENT STATE MACHINE — Tasks 8.2 / 8.3
   * DECISIONS.md D-066, D-069 · BUSINESS_FLOW.md §3.3
   * ───────────────────────────────────────────────────────────────────────────
   *
   * `POST /api/settlements/:id/approve` accepted `z.string().min(1)` and
   * persisted whatever it was handed — `loan-state-machine.test.ts` case 6 has
   * been pinning that deliberately since Phase 5, naming this row as the owner.
   * It stops being true here.
   *
   * `Paid` is terminal, which is D-069's immutability policy expressed as a
   * graph: a settlement that has been paid is not edited, and a correction is a
   * compensating `Refund` transaction. `Disputed` is not terminal — a dispute
   * resolves either way.
   *
   * Approving is Super Admin and Admin only: Manager holds `settlements.view`
   * alone (`lib/permissions.ts:252`). No permission is widened to make this
   * work.
   */
  allowedStatuses: settlementStatuses,
  allowedTransitions: {
    Pending: ["Paid", "Disputed"],
    Disputed: ["Paid", "Pending"],
    Paid: [],
  },
  initialStatuses: ["Pending"],
  patchRefusals: {
    status: "A settlement's status is set by the approve route, not by an edit.",
  },
  /*
   * THE SETTLEMENT ARITHMETIC INVARIANT — Task 8.6
   *
   * `net_payable = gross_commission - tds`, to a paisa. This is not an invented
   * calculation: it refuses arithmetic that cannot be right, whoever wrote it.
   *
   * ── WHAT 8.6 FIXED ──────────────────────────────────────────────────────
   *
   * The check used to read `input.netPayable !== undefined` and take every
   * figure from the payload alone. On a PATCH that omitted `netPayable` it
   * therefore did nothing at all — so
   *
   *     PATCH /api/settlements/:id  {"grossCommission": 999999}
   *
   * sailed through and left a stored row whose three money columns no longer
   * added up. And when the payload DID carry `netPayable` but omitted the other
   * two, `?? 0` compared the new net against zeros rather than against what was
   * actually stored, so a legitimate edit could be refused.
   *
   * Both directions came from the same cause: the invariant is a property of
   * the ROW, and it was being evaluated against the PAYLOAD. The fix is to
   * merge the payload over `existing` — which the factory already threads in
   * for exactly this purpose — and check whenever any of the three fields is
   * written.
   *
   * `existing` is undefined on create, where the payload IS the row and every
   * field carries a schema default, so the create path is unchanged.
   */
  beforeWrite(input, { existing }) {
    const touchesMoney =
      input.grossCommission !== undefined ||
      input.tds !== undefined ||
      input.netPayable !== undefined;
    if (!touchesMoney) return;

    // The row as it WILL be, not as the request described it.
    const merged = {
      grossCommission: input.grossCommission ?? existing?.grossCommission ?? 0,
      tds: input.tds ?? existing?.tds ?? 0,
      netPayable: input.netPayable ?? existing?.netPayable ?? 0,
    };

    const gross = Number(merged.grossCommission);
    const tds = Number(merged.tds);
    const net = Number(merged.netPayable);

    if (Math.abs(gross - tds - net) > 0.01) {
      const message = `netPayable must equal grossCommission minus tds (${gross} − ${tds} = ${gross - tds}, not ${net})`;
      // D-031: `details` are consumed by shape, so the refusal lands on the
      // field the operator can actually correct.
      throw unprocessable(message, [{ path: "netPayable", message }]);
    }
  },
  /*
   * `→Paid` re-runs the arithmetic — BUSINESS_FLOW.md §3.3, Task 8.3.
   *
   * The invariant is enforced on create and on PATCH by `beforeWrite` above,
   * but the approve route writes `status` directly and never calls it. Without
   * this, a settlement whose figures were made incoherent by some earlier route
   * could still be marked Paid — and Paid is terminal, so it would stay that
   * way. Declaring money paid is exactly when the arithmetic must hold.
   *
   * Throwing rolls the approval back (F1-a), so the observable result is a
   * refusal, not a half-applied transition.
   */
  async afterApprove(_before, after, { tx, ctx, req }) {
    if (after.status !== "Paid") return;

    const gross = Number(after.grossCommission ?? 0);
    const tds = Number(after.tds ?? 0);
    const net = Number(after.netPayable ?? 0);

    if (Math.abs(gross - tds - net) > 0.01) {
      const message = `This settlement cannot be marked Paid: netPayable must equal grossCommission minus tds (${gross} − ${tds} = ${gross - tds}, not ${net})`;
      throw unprocessable(message, [{ path: "netPayable", message }]);
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE CROSS-STAGE CHAIN — Task 8.8, D-070, BUSINESS_FLOW.md §4.3
     * ─────────────────────────────────────────────────────────────────────────
     *
     * "Approving a settlement creates a transaction; a transaction creates a
     * ledger entry." Before this, `grep insert(transactions)` and
     * `grep insert(ledgerEntries)` across the backend both returned ZERO:
     * `transactions.settlement_id` and `ledger_entries.transaction_id` were
     * modelled and never populated, so the financial layer had no chain at all.
     *
     * The roadmap said to do this "inside existing transactions". There were
     * none — approve wrote its row and its audit as two autocommits. **F1**
     * built the boundary and the hook; this is its first consumer.
     *
     * ── bank_id, and why OPEN-7 does not block this ──────────────────────────
     *
     * Bank ownership flows down the chain: `settlements.bank_id` is NOT NULL,
     * so the transaction and the ledger entry both inherit a real bank. The
     * nullable `ledger_entries.bank_id` that OPEN-7 concerns is for
     * hand-created global entries and is Phase 11.6's question, not this row's.
     * Passing it explicitly is what keeps these rows visible to scoped users —
     * `bankScope` uses `inArray`, which never matches NULL.
     *
     * ── idempotency is not atomicity ─────────────────────────────────────────
     *
     * This whole block is inside the approve transaction, so a failure anywhere
     * rolls back the settlement's status with it. That prevents a HALF chain.
     * It does nothing about a SECOND one: two concurrent approvals both read
     * `Pending` and both pass the transition check, because D-027 forbids row
     * locks. Migration 0010's partial unique indexes are what stop the double
     * post — the loser gets 23505 and its whole transaction unwinds cleanly.
     *
     * ── what this deliberately does NOT compute ──────────────────────────────
     *
     * `commission` stays 0 (D-058 — commission arithmetic belongs to a row that
     * owns loan mathematics) and ledger `balance` stays 0 (Phase 11.7 owns the
     * running balance). Inventing either here would make the books look
     * authoritative while being arithmetic nobody agreed.
     */
    const bankId = after.bankId as string;

    // `tx`, never `getDb()` — reading through the base handle from inside a
    // transaction deadlocks on a single-connection driver (D-032).
    const txnCode = await nextResourceCode("TXN", tx);
    const [txnRow] = await tx
      .insert(transactions)
      .values({
        code: txnCode,
        bankId,
        settlementId: after.id as string,
        amount: String(net),
        commission: "0",
        txnType: "Commission",
        status: "Success",
        reference: (after.invoiceNo as string | null) ?? (after.code as string),
        occurredAt: new Date(),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    await recordAudit(tx as never, ctx, req, {
      action: "created",
      recordType: "transaction",
      recordId: (txnRow as { id: string }).id,
      bankId,
      summary: `Created transaction ${txnCode} from settlement ${String(after.code)}`,
      metadata: { settlementId: String(after.id), settlementCode: String(after.code) },
    });

    const ledgerCode = await nextResourceCode("LG", tx);
    const [ledgerRow] = await tx
      .insert(ledgerEntries)
      .values({
        code: ledgerCode,
        bankId,
        entryDate: new Date(),
        particulars: `Commission settlement ${String(after.code)}`,
        category: "Commission",
        transactionId: (txnRow as { id: string }).id,
        debit: "0",
        credit: String(net),
        balance: "0",
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    await recordAudit(tx as never, ctx, req, {
      action: "created",
      recordType: "ledger_entry",
      recordId: (ledgerRow as { id: string }).id,
      bankId,
      summary: `Posted ledger entry ${ledgerCode} for transaction ${txnCode}`,
      metadata: { transactionId: String((txnRow as { id: string }).id), transactionCode: txnCode },
    });

    // Task 10.3, last in the transaction — the settlement, its transaction, its
    // ledger entry, all three audit rows and this notification commit together.
    await notifySettlement(
      tx,
      ctx,
      { id: after.id as string, code: String(after.code), status: "Paid" },
      [after.createdBy as string | null, after.updatedBy as string | null].filter(
        (id): id is string => Boolean(id),
      ),
    );
  },
});

export const transactionsRouter = createScopedResource({
  table: transactions,
  recordType: "transaction",
  permissions: {
    view: PERMISSIONS.transactions.view,
    create: PERMISSIONS.transactions.create,
    edit: PERMISSIONS.transactions.edit,
  },
  codePrefix: "TXN",
  codeStart: 77000,
  orderColumn: "occurredAt",
  searchable: ["code", "reference"],
  filterable: ["status", "txnType", "loanId", "customerId"],
  numericFields: ["amount", "commission"],
  createSchema: z.object({
    customerId: uuidField.optional().nullable(),
    bankId: uuidField,
    loanId: uuidField.optional().nullable(),
    disbursementId: uuidField.optional().nullable(),
    settlementId: uuidField.optional().nullable(),
    fundingSourceId: uuidField.optional().nullable(),
    amount: money,
    commission: money.default(0),
    txnType: z.enum(transactionTypes),
    status: z.enum(transactionStatuses).default("Pending"),
    reference: z.string().trim().max(120).optional().nullable(),
    occurredAt: z.coerce.date().optional(),
  }),
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE TRANSACTION STATE MACHINE — Task 8.1
   * DECISIONS.md D-066, D-069 · BUSINESS_FLOW.md §3.3
   * ───────────────────────────────────────────────────────────────────────────
   *
   * The exception that proves D-066's rule. Every other resource routes an
   * authoritative status change through the approve route and refuses it on
   * PATCH — but `transactions` has **no approve route and no
   * `transactions.approve` permission** (`lib/permissions.ts:94-97`). PATCH is
   * the only status writer there is, so the transition map has to live on it.
   *
   * That is precisely what F1-c's `transitionColumn` is for; setting it
   * explicitly (even to its default value) is what turns PATCH-side enforcement
   * on. Without it, `settle` could move a Failed transaction back to Success.
   *
   * `initialStatuses: ["Pending"]` closes the create-side hole: Manager holds
   * `transactions.create` and NOT `transactions.edit` (`:253-254`), so
   * `POST {"status":"Success"}` was an edit-level outcome on a create
   * permission.
   *
   * **Both terminal states are immutable** — D-069, ratified from
   * BUSINESS_FLOW.md §3.3: "neither terminal state may be edited or deleted",
   * and "reversal is a NEW Refund txn". The empty arrays below are that policy;
   * 8.7 adds nothing beyond tests because the graph already says it.
   */
  transitionColumn: "status",
  allowedStatuses: transactionStatuses,
  allowedTransitions: {
    Pending: ["Success", "Failed"],
    Success: [],
    Failed: [],
  },
  initialStatuses: ["Pending"],
});

export const ledgerRouter = createScopedResource({
  table: ledgerEntries,
  recordType: "ledger_entry",
  permissions: {
    view: PERMISSIONS.ledger.view,
    create: PERMISSIONS.ledger.create,
    edit: PERMISSIONS.ledger.edit,
  },
  codePrefix: "LG",
  codeStart: 9000,
  orderColumn: "entryDate",
  searchable: ["voucherNo", "particulars", "party"],
  filterable: ["category", "mode"],
  numericFields: ["debit", "credit", "balance"],
  createSchema: z.object({
    /*
     * REQUIRED since migration `0015` — OPEN-7, resolved by the owner (D-084).
     *
     * It was `.optional().nullable()`, which is what let an unscoped caller
     * post an entry with no bank. `assertBankAccess` already refused a falsy
     * `bankId` for SCOPED callers (`access.ts:130`), so the hole was only ever
     * open to Super Admin and Admin — and their entries were the ones that
     * became invisible to everyone else.
     *
     * Required here as well as NOT NULL in the database so the refusal is a 422
     * naming the field, one layer before a constraint violation.
     */
    bankId: uuidField,
    entryDate: z.coerce.date().optional(),
    voucherNo: z.string().trim().max(60).optional().nullable(),
    particulars: z.string().trim().min(2).max(400),
    party: z.string().trim().max(160).optional().nullable(),
    category: z.enum(["Commission", "Disbursement", "Payout", "Expense", "Tax"]),
    transactionId: uuidField.optional().nullable(),
    debit: money.default(0),
    credit: money.default(0),
    /*
     * `balance` is NOT accepted from the client — Task 11.7.
     *
     * It was `money.default(0)`, so a caller could assert any closing balance
     * they liked and the server wrote it. It is now computed below, in the
     * same transaction as the insert, which is what the schema comment on the
     * column has always claimed and what nothing has ever done.
     */
    mode: z.string().trim().max(40).optional().nullable(),
  }),

  /**
   * THE RUNNING BALANCE — Task 11.7.
   *
   * `ledger_entries.balance` was written as `0` by every path and recomputed by
   * none, so the "Closing balance" tile read a permanent ₹0.00 while the voucher
   * dialog said it updated immediately. The schema comment asserted the
   * recomputation happened "inside the same transaction"; no such code existed.
   *
   * ── ONE STATEMENT, NO LOCK, NO READ-THEN-WRITE ──────────────────────────────
   *
   * D-027 forbids row locks, and the obvious implementation — SELECT the latest
   * balance, add to it, UPDATE — is exactly the check-then-write race BUG-037
   * records at eleven other sites. Two concurrent vouchers would both read the
   * same prior balance and the second would overwrite the first.
   *
   * Instead the balance is derived **in SQL, from the rows themselves**, inside
   * the transaction that just inserted this row:
   *
   *     balance = SUM(credit) - SUM(debit) over this bank's live entries
   *
   * The insert is already visible to this statement (same transaction), so the
   * new row is included. Two concurrent inserts serialise on the table's own
   * MVCC behaviour rather than on a lock we took, and each ends up with the sum
   * of what it can see — which for a running total computed from scratch is the
   * correct answer either way, not a lost update.
   *
   * ── PER BANK, NOT GLOBAL ────────────────────────────────────────────────────
   *
   * D-084 made `bank_id` NOT NULL precisely so that "the book" means one bank's
   * book. A global running balance across banks would be a number no
   * reconciliation could use.
   *
   * ── SOFT-DELETED ENTRIES ARE EXCLUDED ───────────────────────────────────────
   *
   * A binned voucher is not part of the book. It is `deleted_at is null` here
   * and in `bankScope`, so the tile and the rows agree.
   */
  async afterCreate(row, { tx }) {
    const bankId = (row as { bankId: string }).bankId;

    const [totals] = await tx
      .select({
        credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)::text`,
        debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)::text`,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.bankId, bankId), isNull(ledgerEntries.deletedAt)));

    // `::text` then Number, never `::float` — D-068. The aggregate is numeric in
    // Postgres and must not round-trip through a double on the way out.
    const balance = Number(totals?.credit ?? 0) - Number(totals?.debit ?? 0);

    const [updated] = await tx
      .update(ledgerEntries)
      .set({ balance: String(balance) })
      .where(eq(ledgerEntries.id, (row as { id: string }).id))
      .returning({ balance: ledgerEntries.balance });

    // The factory builds its response from the row it inserted, so the freshly
    // computed balance is written back onto it — D-026, the client adopts the
    // server's row rather than the one it sent.
    (row as { balance?: unknown }).balance = updated?.balance ?? String(balance);
  },
});

export const documentsRouter = createScopedResource({
  table: documents,
  recordType: "document",
  permissions: {
    view: PERMISSIONS.documents.view,
    create: PERMISSIONS.documents.upload,
    /*
     * Task 9.7, D-074. Was `documents.upload` — the same key that lets someone
     * put a KYC document into the system also let them mark it Verified, so
     * every uploader could self-verify. Now a separate permission held only by
     * Admin and Super Admin.
     */
    edit: PERMISSIONS.documents.verify,
    delete: PERMISSIONS.documents.delete,
  },
  searchable: ["fileName", "docType"],
  filterable: ["status", "docType", "customerId", "loanId"],
  createSchema: z.object({
    customerId: uuidField.optional().nullable(),
    loanId: uuidField.optional().nullable(),
    bankId: uuidField,
    docType: z.string().trim().min(2).max(80),
    fileName: z.string().trim().min(1).max(255),
    fileSize: z.coerce.number().int().min(0).default(0),
    mimeType: z.string().trim().max(120).optional().nullable(),
    /*
     * `storageKey` and `checksum` are GONE from this schema — Task 9.4,
     * SECURITY_AUDIT.md SEC-024.
     *
     * Both were client-supplied and neither was ever written by the server, so
     * the API was accumulating attacker-controlled, path-shaped strings against
     * the day something dereferenced them — and a client could assert the
     * integrity of its own file. Both are now produced by
     * `POST /api/documents/upload`: the key by `buildStorageKey`, the checksum
     * by hashing the bytes that actually arrived.
     *
     * SEC-024 does NOT close with this. Rows written before today still carry
     * whatever a client sent, which is why `assertSafeKey` runs on the READ
     * path too (9.5).
     */
    status: z.enum(documentStatuses).default("Pending"),
  }),
  /*
   * THE DOCUMENT MACHINE — Task 9.7, BUSINESS_FLOW.md §3.3.
   *
   * `transitionColumn` is set explicitly so PATCH enforces it: documents have
   * no approve route, so PATCH is the verification path.
   *
   * The DB CHECK for this column is NOT here — D-010 scopes per-resource CHECK
   * constraints to "Phases 5–8" and documents fall outside it; 13.13 owns it.
   * The service layer carries the machine in the meantime.
   */
  transitionColumn: "status",
  allowedStatuses: documentStatuses,
  allowedTransitions: {
    Pending: ["Verified", "Rejected"],
    Verified: [],
    Rejected: [],
  },
  initialStatuses: ["Pending"],
  async beforeWrite(input, { ctx, existing }) {
    if (input.status === undefined || !existing) return;
    const requested = String(input.status);
    if (requested !== "Verified" && requested !== "Rejected") return;

    /*
     * "Guard on ->Verified : storage_key must be non-null (a real file must
     * exist)" — BUSINESS_FLOW.md §3.3.
     *
     * Before Phase 9 this was unenforceable: nothing ever wrote `storage_key`,
     * so every document was a dangling pointer and the guard had nothing to
     * read. Now it is the difference between verifying a KYC document and
     * verifying a filename.
     */
    if (requested === "Verified" && !(existing as { storageKey?: string | null }).storageKey) {
      const message =
        "This document has no stored file, so it cannot be verified. Upload the file first.";
      throw unprocessable(message, [{ path: "status", message }]);
    }

    // Who verified it is part of the record, not an optional extra.
    input.verifiedBy = ctx.userId;
  },
});

export const fundingSourcesRouter = createScopedResource({
  table: fundingSources,
  recordType: "funding_source",
  permissions: {
    view: PERMISSIONS.fundingSources.view,
    create: PERMISSIONS.fundingSources.create,
    edit: PERMISSIONS.fundingSources.edit,
    delete: PERMISSIONS.fundingSources.delete,
  },
  searchable: ["name", "accountRef"],
  filterable: ["sourceType", "status"],
  createSchema: z.object({
    name: z.string().trim().min(2).max(160),
    sourceType: z.enum(["own_funds", "bank", "external"]).default("own_funds"),
    bankId: uuidField.optional().nullable(),
    accountRef: z.string().trim().max(80).optional().nullable(),
    status: z.enum(["Active", "Inactive"]).default("Active"),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
  beforeWrite(input) {
    if (input.sourceType === "bank" && !input.bankId) {
      throw badRequest("A bank funding source must reference a bank");
    }
  },
  label: (row) => String(row.name),
});

/**
 * Service providers are not bank-owned, so they get an ordinary router rather
 * than the scoped factory. Feeding a null bank column into the scope filter
 * would silently hide every row from scoped users.
 */
export const serviceProvidersRouter = Router();
serviceProvidersRouter.use(requireAuth);

const providerInput = z.object({
  name: z.string().trim().min(2).max(160),
  providerType: z.string().trim().min(2).max(80).default("Field Verification"),
  contactName: z.string().trim().max(120).optional().nullable(),
  contactPhone: z.string().trim().max(20).optional().nullable(),
  contactEmail: z.string().trim().email().max(255).optional().nullable().or(z.literal("")),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  notes: z.string().trim().max(2000).optional().nullable(),
});

serviceProvidersRouter.get("/", requirePermission(PERMISSIONS.serviceProviders.view), async (_req, res, next) => {
  try {
    const rows = await getDb()
      .select()
      .from(serviceProviders)
      .where(isNull(serviceProviders.deletedAt))
      .orderBy(serviceProviders.name);
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (error) {
    next(error);
  }
});

serviceProvidersRouter.post("/", requirePermission(PERMISSIONS.serviceProviders.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = providerInput.parse(req.body);
    const db = getDb();
    const [created] = await db
      .insert(serviceProviders)
      .values({
        ...input,
        contactEmail: input.contactEmail || null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "service_provider",
      recordId: created?.id,
      summary: `Created service provider ${created?.name}`,
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

serviceProvidersRouter.patch("/:id", requirePermission(PERMISSIONS.serviceProviders.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    // patchSchema, not .partial() — `providerType` and `status` carry
    // defaults and `...input` is spread wholesale (BUG-036).
    const input = patchSchema(providerInput).parse(req.body);
    const db = getDb();
    const [after] = await db
      .update(serviceProviders)
      .set({ ...input, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(serviceProviders.id, id), isNull(serviceProviders.deletedAt)))
      .returning();
    if (!after) throw notFound("Service provider not found");
    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "service_provider",
      recordId: id,
      summary: `Updated service provider ${after.name}`,
    });
    res.json({ data: after });
  } catch (error) {
    next(error);
  }
});

/**
 * DASHBOARD — replaces every hardcoded KPI in the frontend. Scoped, so a
 * manager's totals reflect their banks and a super admin's reflect everything.
 * An empty database returns zeroes, never fabricated numbers.
 */
export const reportsRouter = Router();
reportsRouter.use(requireAuth);

/* ── REPORTING — Task 11.3 ────────────────────────────────────────────────── */

/**
 * The loan report, aggregated in SQL — Task 11.3.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 *
 * The reports screen computed everything client-side from
 * `useResource("/loans", { pageSize: 500 })`. Three consequences, all silent:
 *
 *   1. **Loan 501 was invisible.** 500 is the factory's hard maximum
 *      (`listQuery`, `scoped-resource.ts`), so a book larger than that produced
 *      a report that was simply wrong, with nothing on screen to say so.
 *   2. Every filter was applied in the browser over that truncated page, so the
 *      totals were sums of a sample.
 *   3. The whole book crossed the wire to render a summary of it.
 *
 * ── THE SHAPE ───────────────────────────────────────────────────────────────
 *
 * One endpoint returns **both** the aggregate and a page of rows, because they
 * have to agree: two calls could straddle a write and show a total that does
 * not match its own rows. `summary` is computed over the *whole* filtered set,
 * never over the returned page — that is the entire point.
 *
 * `pageSize=0` returns **every** matching row. That is what Task 11.9's
 * "exports contain all matching rows" needs, and it is bounded by
 * `REPORT_EXPORT_MAX` rather than unbounded: an export that silently truncates
 * is the defect, and one that exhausts the container is not an improvement.
 * Past the ceiling it refuses and says by how much.
 *
 * Bank scoping goes through the same `bankScope` choke point as every other
 * read, so a scoped user's report cannot reach another bank.
 */
const REPORT_EXPORT_MAX = 20_000;

const reportQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  bankId: uuidField.optional(),
  assignedUserId: uuidField.optional(),
  status: z.enum(loanStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  /** `0` means "every matching row" — the export path. */
  pageSize: z.coerce.number().int().min(0).max(500).default(50),
});

reportsRouter.get("/loans", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const q = reportQuery.parse(req.query);
    const db = getDb();

    const filters: SQL[] = [isNull(loans.deletedAt)];
    const scope = bankScope(ctx, loans.bankId);
    if (scope) filters.push(scope);

    if (q.bankId) {
      // A client filter can narrow the scope; it can never widen it.
      assertBankAccess(ctx, q.bankId);
      filters.push(eq(loans.bankId, q.bankId));
    }
    if (q.assignedUserId) filters.push(eq(loans.assignedUserId, q.assignedUserId));
    if (q.status) filters.push(eq(loans.status, q.status));

    /*
     * The reported date is `applied_on` when set and `created_at` otherwise —
     * the same rule the screen used, kept so the numbers do not move.
     *
     * ── THE `to` BOUND IS INCLUSIVE ─────────────────────────────────────────
     *
     * Task 11.2 fixed this in the browser; it has to hold here too or the two
     * disagree. A date input means the whole DAY, so the comparison is against
     * `to + 1 day` exclusive rather than `<= to`: comparing a timestamp to a
     * midnight boundary otherwise drops everything after 00:00:00 on the final
     * day, which was the original defect.
     */
    const reportedAt = sql`coalesce(${loans.appliedOn}, ${loans.createdAt})`;
    if (q.from) filters.push(sql`${reportedAt} >= ${q.from}`);
    if (q.to) {
      const dayAfter = new Date(q.to);
      dayAfter.setDate(dayAfter.getDate() + 1);
      filters.push(sql`${reportedAt} < ${dayAfter}`);
    }

    const where = and(...filters);

    /*
     * Aggregated over the WHOLE filtered set, in one round trip.
     *
     * `::text` on every money column, never `::float` — D-068. These are the
     * figures a DSA reconciles commission against. `sum(amount_approved)` is
     * the column U-5 now populates; before that row it summed a field nothing
     * ever wrote, so this total was structurally zero.
     */
    const [summary] = await db
      .select({
        count: sql<number>`count(*)::int`,
        approvedValue: sql<string>`coalesce(sum(${loans.amountApproved}),0)::text`,
        requestedValue: sql<string>`coalesce(sum(${loans.amountRequested}),0)::text`,
        commission: sql<string>`coalesce(sum(${loans.commission}),0)::text`,
        approvedCount: sql<number>`count(*) filter (where ${loans.status} in ('Approved','Disbursed'))::int`,
      })
      .from(loans)
      .where(where);

    const total = summary?.count ?? 0;

    if (q.pageSize === 0 && total > REPORT_EXPORT_MAX) {
      const message = `That report contains ${total.toLocaleString("en-IN")} rows, more than the ${REPORT_EXPORT_MAX.toLocaleString("en-IN")} that can be exported at once. Narrow the date range.`;
      throw unprocessable(message, [{ path: "pageSize", message }]);
    }

    const rowsQuery = db
      .select({
        id: loans.id,
        code: loans.code,
        bankId: loans.bankId,
        customerId: loans.customerId,
        assignedUserId: loans.assignedUserId,
        loanType: loans.loanType,
        status: loans.status,
        amountRequested: loans.amountRequested,
        amountApproved: loans.amountApproved,
        commission: loans.commission,
        appliedOn: loans.appliedOn,
        createdAt: loans.createdAt,
      })
      .from(loans)
      .where(where)
      .orderBy(desc(reportedAt));

    const rows =
      q.pageSize === 0
        ? await rowsQuery
        : await rowsQuery.limit(q.pageSize).offset((q.page - 1) * q.pageSize);

    res.json({
      data: rows,
      summary: {
        count: total,
        approvedValue: summary?.approvedValue ?? "0",
        requestedValue: summary?.requestedValue ?? "0",
        commission: summary?.commission ?? "0",
        approvedCount: summary?.approvedCount ?? 0,
      },
      meta: {
        page: q.pageSize === 0 ? 1 : q.page,
        pageSize: q.pageSize === 0 ? total : q.pageSize,
        total,
        totalPages: q.pageSize === 0 ? 1 : Math.ceil(total / q.pageSize),
        /** True when `data` holds every matching row, not just this page. */
        complete: q.pageSize === 0 || total <= q.pageSize,
        scoped: ctx.bankIds !== null,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * The monthly trend — Task 11.5's endpoint half.
 *
 * The chart was fed a hardcoded `[]` and rendered permanently blank. Bucketed
 * in SQL by month so the browser is not handed the whole book to group itself.
 */
reportsRouter.get("/trend", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const months = z.coerce.number().int().min(1).max(36).default(12).parse(req.query.months);
    const db = getDb();

    const filters: SQL[] = [isNull(loans.deletedAt)];
    const scope = bankScope(ctx, loans.bankId);
    if (scope) filters.push(scope);

    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const reportedAt = sql`coalesce(${loans.appliedOn}, ${loans.createdAt})`;
    filters.push(sql`${reportedAt} >= ${since}`);

    const bucket = sql<string>`to_char(date_trunc('month', ${reportedAt}), 'YYYY-MM')`;

    const rows = await db
      .select({
        month: bucket,
        cases: sql<number>`count(*)::int`,
        disbursed: sql<string>`coalesce(sum(${loans.amountApproved}) filter (where ${loans.status} = 'Disbursed'),0)::text`,
        commission: sql<string>`coalesce(sum(${loans.commission}),0)::text`,
      })
      .from(loans)
      .where(and(...filters))
      .groupBy(bucket)
      .orderBy(bucket);

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/stats", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const db = getDb();

    const ids = ctx.bankIds;
    const scopeFor = (column: string) =>
      ids === null
        ? sql`true`
        : ids.length === 0
          ? sql`false`
          : sql`${sql.raw(column)} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;

    /*
     * Task 7.7a, DECISIONS.md D-068 — the three money aggregates below cast to
     * text, not to float.
     *
     * Every money column in this schema is numeric(16,2), which Postgres sums
     * EXACTLY. The float cast threw that away at the very last step: it turned
     * an exact decimal into an IEEE-754 double purely so the JSON would carry a
     * number, which means a book that balanced in the database could arrive at
     * the dashboard not balancing.
     *
     * Casting to text keeps the exact value. The scale is fixed at 2, so the
     * string is unambiguous and the frontend formatters already accept strings.
     *
     * This is the block's ONLY wire-format change and it is confined to these
     * three fields plus two in the trend query below. Per-row money is
     * untouched — moving that to strings is a breaking change across five
     * resources and belongs to Phase 11, with 11.7 and 11.8 which own the
     * frontend arithmetic.
     *
     * (The comment lives out here rather than inside the template literal: a
     * backtick in a comment inside a tagged template terminates the template.)
     */
    const result = await db.execute(sql`
      select
        (select count(*)::int from customers
           where deleted_at is null and ${scopeFor("bank_id")})                      as total_customers,
        (select count(*)::int from customers
           where deleted_at is null and status = 'Active' and ${scopeFor("bank_id")}) as active_customers,
        (select count(*)::int from loans
           where deleted_at is null and status in ('Draft','Submitted','Under Review')
             and ${scopeFor("bank_id")})                                             as pending_loans,
        (select count(*)::int from loans
           where deleted_at is null and status in ('Approved','Disbursed')
             and ${scopeFor("bank_id")})                                             as approved_loans,
        (select coalesce(sum(amount_approved),0)::text from loans
           where deleted_at is null and status = 'Disbursed' and ${scopeFor("bank_id")}) as disbursed_value,
        (select coalesce(sum(commission),0)::text from loans
           where deleted_at is null and ${scopeFor("bank_id")})                      as commission_earned,
        (select coalesce(sum(net_payable),0)::text from settlements
           where deleted_at is null and status <> 'Paid' and ${scopeFor("bank_id")}) as pending_settlement,
        (select count(*)::int from bank_orders
           where deleted_at is null and status <> 'Cleared' and ${scopeFor("bank_id")}) as open_orders,
        (select count(*)::int from disbursements
           where deleted_at is null and status = 'Credited' and ${scopeFor("bank_id")}) as credited_disbursements,
        (select count(*)::int from transactions
           where deleted_at is null and status = 'Success' and ${scopeFor("bank_id")}) as successful_transactions,

(select count(*)::int from transactions
   where deleted_at is null
     and status = 'Success'
     and occurred_at >= current_date
     and occurred_at < current_date + interval '1 day'
     and ${scopeFor("bank_id")}) as todays_transactions,

        (select count(*)::int from documents
           where deleted_at is null and status = 'Pending' and ${scopeFor("bank_id")}) as pending_documents,
        (select count(*)::int from banks
           where deleted_at is null and status = 'Active' and ${scopeFor("id")})     as active_banks
    `);

    // db.execute returns a QueryResult, not an array — .rows is the payload.
    const row = (result as unknown as { rows: Record<string, unknown>[] }).rows[0];
    res.json({ data: row ?? {}, meta: { scoped: ids !== null } });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/loan-status", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const filters = [isNull(loans.deletedAt)];
    const scope = bankScope(ctx, loans.bankId);
    if (scope) filters.push(scope);

    const rows = await getDb()
      .select({ status: loans.status, count: sql<number>`count(*)::int` })
      .from(loans)
      .where(and(...filters))
      .groupBy(loans.status);

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/bank-performance", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const filters = [isNull(loans.deletedAt)];
    const scope = bankScope(ctx, loans.bankId);
    if (scope) filters.push(scope);

    const rows = await getDb()
      .select({
        bankId: loans.bankId,
        cases: sql<number>`count(*)::int`,
        // Task 7.7a / D-068 — exact `numeric` sums, serialised as text rather
        // than rounded through a double. See the dashboard query above.
        volume: sql<string>`coalesce(sum(${loans.amountApproved}),0)::text`,
        commission: sql<string>`coalesce(sum(${loans.commission}),0)::text`,
      })
      .from(loans)
      .where(and(...filters))
      .groupBy(loans.bankId);

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

export { assertBankAccess };
