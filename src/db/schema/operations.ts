import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { teams, users } from "./identity.js";
import { banks, branches, customers } from "./domain.js";

/** Columns every operational table carries. Keeps the shape uniform for the
 *  scoped-CRUD factory, the recycle bin and the audit writer. */
const lifecycle = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by"),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
};

const money = (name: string) => numeric(name, { precision: 16, scale: 2 });

/**
 * SERVICE PROVIDERS — third-party verification agencies. Required by the brief;
 * no equivalent existed in the frontend.
 */
/**
 * The two-value lifecycle shared by `funding_sources`, `service_providers` and
 * `users`. Declared once so the CHECK, the zod enums and any future reader
 * cannot drift apart.
 *
 * Declared HERE, above the first table that reads it, and not with the other
 * vocabularies further down: a `pgTable(...)` constraint callback runs the
 * moment `pgTable(...)` is evaluated, so a const below it is still in the
 * temporal dead zone. That is the same trap `bankOrderStages` documents.
 */
export const activeInactive = ["Active", "Inactive"] as const;

export const serviceProviders = pgTable(
  "service_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull().default("Field Verification"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    status: text("status").notNull().default("Active"),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("service_providers_name_unique")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("service_providers_status_idx").on(t.status),
    index("service_providers_deleted_idx").on(t.deletedAt),
    /*
     * VOCABULARY ONLY — Task 13.13, D-010, D-057. Migration `0014`.
     *
     * A CHECK sees one candidate row and cannot see that row's previous value,
     * so it can express WHICH values exist and nothing about which transitions
     * are legal or who may make them. Those stay in the service layer, where
     * `allowedTransitions`, `initialStatuses` and `patchRefusals` already carry
     * them. The trigger count stays at 7.
     */
    check(
      "service_providers_status_check",
      sql`${t.status} in (${sql.raw(activeInactive.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

/**
 * FUNDING SOURCES — own funds, another bank, or a configured external source.
 * `bankId` is set only when the source IS a bank, so scoping still works.
 */
export const fundingSources = pgTable(
  "funding_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sourceType: text("source_type").notNull().default("own_funds"),
    bankId: uuid("bank_id").references(() => banks.id, { onDelete: "set null" }),
    accountRef: text("account_ref"),
    status: text("status").notNull().default("Active"),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("funding_sources_name_unique")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("funding_sources_bank_idx").on(t.bankId),
    index("funding_sources_deleted_idx").on(t.deletedAt),
    /*
     * VOCABULARY ONLY — Task 13.13, D-010, D-057. Migration `0014`.
     *
     * A CHECK sees one candidate row and cannot see that row's previous value,
     * so it can express WHICH values exist and nothing about which transitions
     * are legal or who may make them. Those stay in the service layer, where
     * `allowedTransitions`, `initialStatuses` and `patchRefusals` already carry
     * them. The trigger count stays at 7.
     */
    check(
      "funding_sources_status_check",
      sql`${t.status} in (${sql.raw(activeInactive.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

/**
 * The loan status vocabulary.
 *
 * Declared HERE, immediately above the table, rather than with the other status
 * consts at the foot of this file: `loans_status_check` below reads it, and the
 * table's constraint callback runs the moment `pgTable(...)` is evaluated — a
 * const declared further down would still be in its temporal dead zone.
 *
 * It is the ONLY copy. Until Task 5.3 it had zero consumers while
 * `operations.routes.ts` carried a second literal list of the same seven
 * strings; the route's create schema, the approve route's enum and this CHECK
 * constraint now all derive from this line. The transition graph over these
 * statuses lives at BUSINESS_FLOW.md §3.3 and is transcribed in
 * `operations.routes.ts` — a graph is not a vocabulary and a CHECK cannot hold
 * one (D-057).
 */
export const loanStatuses = [
  "Draft",
  "Submitted",
  "Under Review",
  "Approved",
  "Disbursed",
  "Rejected",
  "Closed",
] as const;

/**
 * LOANS / FUNDING REQUESTS — mirrors the frontend `Loan` interface field for
 * field, with the brief's workflow columns added alongside rather than instead.
 */
export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    applicationNo: text("application_no"),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),

    loanType: text("loan_type").notNull(),
    amountRequested: money("amount_requested").notNull().default("0"),
    amountApproved: money("amount_approved").notNull().default("0"),
    interestRate: numeric("interest_rate", { precision: 6, scale: 3 }).notNull().default("0"),
    tenureMonths: integer("tenure_months").notNull().default(0),
    emi: money("emi").notNull().default("0"),
    processingFee: money("processing_fee").notNull().default("0"),
    commission: money("commission").notNull().default("0"),

    status: text("status").notNull().default("Draft"),
    appliedOn: timestamp("applied_on", { withTimezone: true }),

    /** Conditional verification, per the brief. False means the requesting bank
     *  handled it themselves; the reason is recorded on the verification row. */
    verificationRequired: boolean("verification_required").notNull().default(false),
    fundingSourceId: uuid("funding_source_id").references(() => fundingSources.id, {
      onDelete: "set null",
    }),

    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    assignedTeamId: uuid("assigned_team_id").references(() => teams.id, { onDelete: "set null" }),
    priority: text("priority").notNull().default("Normal"),
    dueDate: timestamp("due_date", { withTimezone: true }),

    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),

    /*
     * ── MANAGER MAINTENANCE — Task MM-1, D-095 ──────────────────────────────
     *
     * Both nullable, both written only by `PATCH /api/maintenance/loan/:id`.
     * Neither is read by any state machine, guard or money path.
     *
     * `branchId` is where the file was sourced. Region and Area are NOT stored
     * here — they are reached by walking `branches.area_id → areas.region_id`,
     * so a branch cannot disagree with itself about which area it is in.
     *
     * `btLeadId` is the manager's `BT LEAD ID` (sample: `BTOMKA250626053704`).
     * It is issued OUTSIDE this system, so it is free text and is **never
     * generated** — synthesising one would fabricate an external reference that
     * no other system would recognise. It is deliberately NOT unique: the
     * repository has no format rule for it and a uniqueness constraint on an
     * identifier we do not mint would reject legitimate data on a typo in
     * someone else's system.
     */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    btLeadId: text("bt_lead_id"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("loans_code_unique").on(t.code).where(sql`${t.deletedAt} is null`),
    index("loans_branch_idx").on(t.branchId),
    index("loans_customer_idx").on(t.customerId),
    index("loans_bank_idx").on(t.bankId),
    index("loans_status_idx").on(t.status),
    index("loans_assigned_user_idx").on(t.assignedUserId),
    index("loans_assigned_team_idx").on(t.assignedTeamId),
    index("loans_due_date_idx").on(t.dueDate),
    index("loans_deleted_idx").on(t.deletedAt),
    /*
     * The repository's FIRST status CHECK constraint — D-010, Task 5.2, applied
     * by `drizzle/0007_loan_status_check.sql`.
     *
     * VOCABULARY ONLY. A CHECK is evaluated against the candidate row and can
     * see no other, so it cannot express a from→to rule; transition legality is
     * enforced in `scoped-resource.ts` instead, and **no trigger was added**
     * (D-057). What this stops is the class D-010 opens with: an approve route
     * writing `'Credited '` with a trailing space, producing a record that
     * reconciliation queries cannot see while the UI shows it approved.
     *
     * Scope is `loans.status` and nothing else. Bank-order stages are roadmap
     * 6.5, disbursements 7.3, and 13.13 is the sweep.
     */
    check(
      "loans_status_check",
      sql`${t.status} in (${sql.raw(loanStatuses.map((s) => `'${s}'`).join(", "))})`,
    ),
  ],
);

/**
 * The FVR checklist vocabularies — Task MM-1, D-095.
 *
 * Declared HERE, above `verifications`, for the same reason `loanStatuses` sits
 * above `loans`: the CHECK constraints below read them while `pgTable(...)` is
 * being evaluated, and the house style is that a vocabulary a constraint reads
 * is declared before the table.
 *
 * Both are `Yes`/`No` rather than a boolean, because the manager's form offers
 * exactly those two words and a NULL third state that means "not yet asked".
 * A `boolean` column would collapse "No" and "not yet recorded" into `false`,
 * which is precisely the fabricated answer D-004 forbids.
 */
export const houseConfirmations = ["Owned", "Rented"] as const;
export const fvrYesNo = ["Yes", "No"] as const;

/**
 * VERIFICATIONS — one row per loan. Exists even when not required, so the
 * record shows *that* the requesting bank handled it rather than leaving a gap.
 */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),

    required: boolean("required").notNull().default(false),
    handledByBank: boolean("handled_by_bank").notNull().default(false),

    serviceProviderId: uuid("service_provider_id").references(() => serviceProviders.id, {
      onDelete: "set null",
    }),
    providerReference: text("provider_reference"),

    status: text("status").notNull().default("Pending"),
    result: text("result"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),

    /*
     * ── THE FVR CHECKLIST — Task MM-1, D-095 ────────────────────────────────
     *
     * The manager's "FIELD VERIFICATION REPORT (FVR) CHECKLIST" is a
     * per-customer form of thirteen particulars. Nine of them already had a
     * home — customer name, loan amount, occupation and remarks all resolve
     * through `loans` and `customers`, and `notes` is the Remarks line. The
     * columns below are the ones the CRM genuinely could not carry.
     *
     * They live on `verifications` and not on `customers` because every one of
     * them is a FIELD-VISIT FINDING, not customer master data. "House
     * Confirmation: Owned" is what a verifier observed on a given date, and the
     * same customer can be verified twice with different answers. Putting them
     * on `customers` would assert them as declared fact and silently overwrite
     * the earlier visit.
     *
     * EVERY COLUMN IS NULLABLE AND EVERY ONE DEFAULTS TO NULL. A blank FVR line
     * means "not recorded", which is exactly what the manager's own blank sheet
     * means. Nothing here is derived, defaulted or inferred from another column.
     *
     * NONE of these is read by any state machine, permission check, transition
     * guard, money path or approval route. They are written only by
     * `PATCH /api/maintenance/fvr/:id`.
     */
    /** The `Date: ____` on the form header. Not `completedAt` — that is the
     *  verification workflow's own timestamp and means something else. */
    fvrDate: timestamp("fvr_date", { withTimezone: true }),
    takeoverFromLender: text("takeover_from_lender"),
    fvrDoneByName: text("fvr_done_by_name"),
    /** The form asks for "Name & Designation" as one line; stored as two so a
     *  designation can be reported on without re-parsing a free-text string. */
    fvrDoneByDesignation: text("fvr_done_by_designation"),
    houseConfirmation: text("house_confirmation"),
    /** An independently observed figure. Deliberately NOT
     *  `customers.monthly_income * 12`: multiplying a declared monthly figure
     *  would print a number nobody verified onto a verification document. */
    annualIncome: money("annual_income"),
    cholaRelationship: text("chola_relationship"),
    /** The form's own sub-line: "If yes, specify details outstanding loan
     *  amount". Free text, because the sheet asks for details and an amount. */
    cholaOutstandingDetails: text("chola_outstanding_details"),
    newKycCustomer: text("new_kyc_customer"),
    /*
     * THE THREE SIGNATURE LINES.
     *
     * Plain nullable text and nothing more. There is no electronic-signature
     * workflow in this system, so these record WHAT WAS WRITTEN ON THE SHEET
     * and make no cryptographic, legal or identity claim whatsoever.
     *
     * They are not booleans, there is no "signed" state, no route treats a
     * non-null value as an approval, and no guard anywhere reads them. A
     * populated signature line authorises exactly nothing.
     */
    zensifyRmSignature: text("zensify_rm_signature"),
    sharvikaRmSignature: text("sharvika_rm_signature"),
    cholaSign: text("chola_sign"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("verifications_loan_unique").on(t.loanId).where(sql`${t.deletedAt} is null`),
    /*
     * VOCABULARY ONLY — D-010, D-057.
     *
     * Each name ends `_status_check` so `middleware/error-handler.ts`'s
     * `/_(status|stage)_check$/` turns a 23514 into a 422 instead of letting it
     * fall through to a 500 with a stack trace. `... is null or ... in (...)`
     * because NULL is the legitimate "not recorded" state and a bare `in` would
     * reject it.
     */
    check(
      "verifications_house_confirmation_status_check",
      sql`${t.houseConfirmation} is null or ${t.houseConfirmation} in (${sql.raw(houseConfirmations.map((v) => `'${v}'`).join(", "))})`,
    ),
    check(
      "verifications_chola_relationship_status_check",
      sql`${t.cholaRelationship} is null or ${t.cholaRelationship} in (${sql.raw(fvrYesNo.map((v) => `'${v}'`).join(", "))})`,
    ),
    check(
      "verifications_new_kyc_customer_status_check",
      sql`${t.newKycCustomer} is null or ${t.newKycCustomer} in (${sql.raw(fvrYesNo.map((v) => `'${v}'`).join(", "))})`,
    ),
    index("verifications_bank_idx").on(t.bankId),
    index("verifications_status_idx").on(t.status),
    index("verifications_provider_idx").on(t.serviceProviderId),
    /*
     * VOCABULARY ONLY — Task 13.13, D-010, D-057. Migration `0014`.
     *
     * A CHECK sees one candidate row and cannot see that row's previous value,
     * so it can express WHICH values exist and nothing about which transitions
     * are legal or who may make them. Those stay in the service layer, where
     * `allowedTransitions`, `initialStatuses` and `patchRefusals` already carry
     * them. The trigger count stays at 7.
     */
    /*
     * ── THIS IS SEC-016's LAST COLUMN ───────────────────────────────────────
     *
     * The finding is "POST /:id/approve accepts any status string". 0007, 0008
     * and 0009 closed loans, bank orders and disbursements. `verifications` was
     * named by NO roadmap row in any phase — NEXT_TASK.md carried it forward
     * five times as "belongs to the 13.13 sweep". This is that sweep, and with
     * this constraint SEC-016 has no unconstrained approve-route column left.
     */
    check(
      "verifications_status_check",
      sql`${t.status} in (${sql.raw(verificationStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

/**
 * The bank-order vocabularies — Task 6.5, DECISIONS.md D-063.
 *
 * MOVED HERE from the foot of this file, for the same reason `loanStatuses`
 * sits above `loans`: the constraint callbacks below read them, and a
 * `pgTable(...)` call evaluates its callback the moment the module is
 * initialised. Left at the bottom they would still be in their temporal dead
 * zone and the module would throw `ReferenceError` on import — before any test
 * could run.
 *
 * `bank_orders` is the only table in the schema with **two** workflow columns.
 * `stage` is the lender's pipeline position; `status` is the health of that
 * file. Both are real machines, both are ratified at BUSINESS_FLOW.md §3.3, and
 * D-063 assigns both to Phase 6 rather than leaving `status` unowned.
 */
export const bankOrderStages = [
  "Login",
  "Credit Check",
  "Field Verification",
  "Sanction",
  "Disbursal Queue",
] as const;

export const bankOrderStatuses = ["In Progress", "On Hold", "Cleared", "Returned"] as const;

export const bankOrders = pgTable(
  "bank_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),

    submittedOn: timestamp("submitted_on", { withTimezone: true }),
    sla: timestamp("sla", { withTimezone: true }),
    stage: text("stage").notNull().default("Login"),
    status: text("status").notNull().default("In Progress"),
    officer: text("officer"),
    remarks: text("remarks"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("bank_orders_code_unique").on(t.code).where(sql`${t.deletedAt} is null`),
    index("bank_orders_loan_idx").on(t.loanId),
    /*
     * ONE LIVE BANK ORDER PER LOAN — Task 6.4, DECISIONS.md D-027, D-070.
     *
     * A bank order tracks one file's progress through one lender's pipeline,
     * and a loan names exactly one bank. Two orders for the same loan is not a
     * richer record; it is the same file counted twice on the Kanban board and
     * in every SLA query.
     *
     * 6.4 creates the order automatically when a loan is submitted. The service
     * layer checks for an existing one first, but that check is check-then-write
     * against a row read moments earlier — D-027 forbids taking a lock, so two
     * concurrent submissions could both find nothing and both insert. This index
     * is the compliant backstop, exactly as `transactions_settlement_unique` is
     * for the 8.8 chain: the loser gets 23505 and its whole transaction unwinds.
     *
     * PARTIAL on `deleted_at is null`, so a soft-deleted order does not
     * permanently prevent re-submitting the loan.
     */
    uniqueIndex("bank_orders_loan_unique")
      .on(t.loanId)
      .where(sql`${t.deletedAt} is null`),
    index("bank_orders_bank_idx").on(t.bankId),
    index("bank_orders_status_idx").on(t.status),
    index("bank_orders_sla_idx").on(t.sla),
    /*
     * VOCABULARY ONLY, on BOTH workflow columns — Task 6.5, D-010, D-057.
     *
     * The second and third CHECK constraints in the repository. A CHECK sees
     * only the candidate row, so neither can express "Sanction may only follow
     * Field Verification"; that graph is enforced in `scoped-resource.ts` from
     * the machine ratified at BUSINESS_FLOW.md §3.3, reached through
     * `transitionColumn` because bank orders have no approve route. **No
     * trigger was added** — the count stays at 7 (D-057).
     */
    check(
      "bank_orders_stage_check",
      sql`${t.stage} in (${sql.raw(bankOrderStages.map((s) => `'${s}'`).join(", "))})`,
    ),
    check(
      "bank_orders_status_check",
      sql`${t.status} in (${sql.raw(bankOrderStatuses.map((s) => `'${s}'`).join(", "))})`,
    ),
  ],
);

/**
 * The disbursement status vocabulary — Task 7.3, DECISIONS.md D-057, D-066.
 *
 * Moved above the table for the same temporal-dead-zone reason as
 * `loanStatuses` and `bankOrderStages`: `disbursements_status_check` reads it
 * while `pgTable(...)` is being evaluated.
 *
 * This is the vocabulary **SEC-016's abuse scenario is written against**. The
 * approve route parsed `z.string().min(1)` and wrote the result through, so
 * `{"status":"Credited "}` with a trailing space produced an off-books
 * disbursement invisible to every reconciliation query while the UI showed it
 * approved. Task 7.3 configures `allowedStatuses` from this const; this CHECK
 * is the backstop underneath it.
 */
export const disbursementStatuses = ["Credited", "In Transit", "Failed"] as const;

/**
 * `disbursements.payment_status` — MANAGER MAINTENANCE ONLY. Task MM-1, D-095.
 *
 * ── THIS IS NOT A FINANCIAL STATE, AND THE SHEET PROVES IT ──────────────────
 *
 * The manager's Payment sheet shows sixteen rows that each carry a "Fund
 * Credited to Customer" TIME — the money demonstrably left and reached the
 * customer — and every one of those rows reads `Not Received` under "Payment
 * Status". So it cannot be `disbursements.status` (those rows are `Credited`),
 * it cannot be `transactions.status`, and it cannot be `settlements.status`.
 * It is a downstream receipt flag the manager maintains by hand, and the CRM
 * has no authoritative source for it.
 *
 * ── HOW IT IS KEPT OUT OF THE MONEY PATH ────────────────────────────────────
 *
 * Separation is STRUCTURAL, not a convention someone must remember:
 *
 *   · it is absent from `disbursementsRouter.createSchema`, so POST cannot set
 *     it, and `patchSchema` derives from that schema, so PATCH cannot either;
 *   · `transitionColumn` is `status`, so `allowedTransitions`,
 *     `initialStatuses` and `allowedStatuses` never look at this column;
 *   · no guard, hook, notification, ledger entry or approval reads it —
 *     `afterApprove`'s UTR precondition is untouched;
 *   · the ONLY writer is `PATCH /api/maintenance/payment/:id`, gated on
 *     `maintenance.edit`, which writes this column and nothing else.
 *
 * It therefore cannot override, shortcut or contradict the canonical financial
 * state. Setting it to `Received` moves no money and approves nothing.
 *
 * NULL means "not yet maintained" and is the default. Only `Not Received` is
 * attested in the supplied sheet; `Received` is the other half of the binary
 * that word implies. **Flagged for manager confirmation** — if the real
 * vocabulary is longer, this one const and one CHECK are the whole change.
 */
export const paymentStatuses = ["Received", "Not Received"] as const;

export const disbursements = pgTable(
  "disbursements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    fundingSourceId: uuid("funding_source_id").references(() => fundingSources.id, {
      onDelete: "set null",
    }),

    amount: money("amount").notNull().default("0"),
    utr: text("utr"),
    mode: text("mode").notNull().default("NEFT"),
    disbursedOn: timestamp("disbursed_on", { withTimezone: true }),
    status: text("status").notNull().default("In Transit"),
    creditedTo: text("credited_to"),

    /** Manager maintenance only — see `paymentStatuses` above for why this is
     *  not, and can never become, part of the disbursement state machine. */
    paymentStatus: text("payment_status"),

    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("disbursements_code_unique").on(t.code).where(sql`${t.deletedAt} is null`),
    // A UTR is a bank's own unique payment reference; a duplicate almost always
    // means a double-entry, so it is rejected rather than silently accepted.
    uniqueIndex("disbursements_utr_unique")
      .on(sql`upper(${t.utr})`)
      .where(sql`${t.deletedAt} is null and ${t.utr} is not null`),
    index("disbursements_loan_idx").on(t.loanId),
    index("disbursements_bank_idx").on(t.bankId),
    index("disbursements_status_idx").on(t.status),
    /*
     * VOCABULARY ONLY — Task 7.3, D-010, D-057. Partial remediation of SEC-016.
     *
     * This is the column that finding is written against: the approve route has
     * been able to write any non-empty string to it since launch. The CHECK
     * stops the vocabulary escaping; `allowedStatuses` on the router stops it
     * one layer earlier with a readable 422; `allowedTransitions` and
     * `patchRefusals` stop the *privilege* holes, which a CHECK cannot see.
     *
     * SEC-016 stays OPEN after this: `verifications.status` is named by no row
     * in any phase and belongs to the 13.13 sweep.
     */
    check(
      "disbursements_status_check",
      sql`${t.status} in (${sql.raw(disbursementStatuses.map((s) => `'${s}'`).join(", "))})`,
    ),
    /*
     * The maintenance column's vocabulary — D-010, D-095. NULL is legal and is
     * the default, so the predicate admits it explicitly. Named `_status_check`
     * for the 422 mapping, exactly as the constraint above it.
     */
    check(
      "disbursements_payment_status_check",
      sql`${t.paymentStatus} is null or ${t.paymentStatus} in (${sql.raw(paymentStatuses.map((s) => `'${s}'`).join(", "))})`,
    ),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    period: text("period").notNull(),
    cases: integer("cases").notNull().default(0),
    grossCommission: money("gross_commission").notNull().default("0"),
    tds: money("tds").notNull().default("0"),
    netPayable: money("net_payable").notNull().default("0"),
    status: text("status").notNull().default("Pending"),
    invoiceNo: text("invoice_no"),
    raisedOn: timestamp("raised_on", { withTimezone: true }),
    settledOn: timestamp("settled_on", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("settlements_code_unique").on(t.code).where(sql`${t.deletedAt} is null`),
    uniqueIndex("settlements_bank_period_unique")
      .on(t.bankId, sql`lower(${t.period})`)
      .where(sql`${t.deletedAt} is null`),
    index("settlements_status_idx").on(t.status),
    /*
     * VOCABULARY ONLY — Task 13.13, D-010, D-057. Migration `0014`.
     *
     * A CHECK sees one candidate row and cannot see that row's previous value,
     * so it can express WHICH values exist and nothing about which transitions
     * are legal or who may make them. Those stay in the service layer, where
     * `allowedTransitions`, `initialStatuses` and `patchRefusals` already carry
     * them. The trigger count stays at 7.
     */
    check(
      "settlements_status_check",
      sql`${t.status} in (${sql.raw(settlementStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    loanId: uuid("loan_id").references(() => loans.id, { onDelete: "restrict" }),
    disbursementId: uuid("disbursement_id").references(() => disbursements.id, {
      onDelete: "set null",
    }),
    settlementId: uuid("settlement_id").references(() => settlements.id, { onDelete: "set null" }),
    fundingSourceId: uuid("funding_source_id").references(() => fundingSources.id, {
      onDelete: "set null",
    }),

    amount: money("amount").notNull().default("0"),
    commission: money("commission").notNull().default("0"),
    txnType: text("txn_type").notNull(),
    status: text("status").notNull().default("Pending"),
    reference: text("reference"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("transactions_code_unique").on(t.code),
    /*
     * IDEMPOTENCY FOR THE 8.8 CHAIN — Task 8.8, DECISIONS.md D-027, D-070.
     *
     * Approving a settlement generates exactly one transaction. Atomicity
     * (F1-a) prevents a *partial* chain; it does nothing about a *second* one,
     * and those are different guarantees. Two concurrent approvals both read
     * `Pending`, both pass the transition check — D-027 keeps that posture and
     * takes **no row lock** — and without this index both would post.
     *
     * D-027 forbids locks, not constraints. This is the compliant remedy.
     *
     * PARTIAL, and it must be: most transactions carry no settlement, and an
     * unconditional unique index would permit exactly one such row and break the
     * table. `deleted_at is null` because both tables carry the soft-delete
     * mixin — a voided chain must not block a legitimate re-post.
     */
    uniqueIndex("transactions_settlement_unique")
      .on(t.settlementId)
      .where(sql`${t.settlementId} is not null and ${t.deletedAt} is null`),
    index("transactions_customer_idx").on(t.customerId),
    index("transactions_bank_idx").on(t.bankId),
    index("transactions_loan_idx").on(t.loanId),
    index("transactions_status_idx").on(t.status),
    index("transactions_occurred_idx").on(t.occurredAt),
    /*
     * VOCABULARY ONLY — Task 13.13, D-010, D-057. Migration `0014`.
     *
     * A CHECK sees one candidate row and cannot see that row's previous value,
     * so it can express WHICH values exist and nothing about which transitions
     * are legal or who may make them. Those stay in the service layer, where
     * `allowedTransitions`, `initialStatuses` and `patchRefusals` already carry
     * them. The trigger count stays at 7.
     */
    check(
      "transactions_status_check",
      sql`${t.status} in (${sql.raw(transactionStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    entryDate: timestamp("entry_date", { withTimezone: true }).notNull().defaultNow(),
    voucherNo: text("voucher_no"),
    particulars: text("particulars").notNull(),
    party: text("party"),
    category: text("category").notNull(),
    /*
     * NOT NULL since migration `0015` — OPEN-7, resolved by the owner (D-084).
     *
     * It was nullable, and `bankScope` filters with `inArray`, which never
     * matches NULL (`services/access.ts:117`). So a hand-created entry from an
     * unscoped user landed with `bank_id = NULL` and was **permanently
     * invisible to every scoped user** — a financial record written into a
     * hole, with no error anywhere.
     *
     * `onDelete` moved from `set null` to **`restrict`** in the same migration,
     * because the two are incompatible: deleting a bank would try to write NULL
     * into a column that forbids it. `restrict` also matches every other
     * NOT NULL `bank_id` in this schema, and refusing to delete a bank that
     * still owns ledger entries is correct for immutable financial records
     * (D-069).
     */
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    /** Running balance is stored for display parity with the frontend, but it is
     *  recomputed inside the same transaction that inserts the row. */
    balance: money("balance").notNull().default("0"),
    mode: text("mode"),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("ledger_entries_code_unique").on(t.code),
    /*
     * The second leg of the 8.8 chain's idempotency — D-070.
     *
     * One transaction posts one ledger entry (BUSINESS_FLOW.md 3.3: "must post
     * the matching ledger entry in the same DB transaction"). A reversal is a
     * NEW `Refund` transaction carrying its own entry, so the one-to-one holds
     * and this index does not block legitimate accounting.
     */
    uniqueIndex("ledger_entries_transaction_unique")
      .on(t.transactionId)
      .where(sql`${t.transactionId} is not null and ${t.deletedAt} is null`),
    index("ledger_entries_date_idx").on(t.entryDate),
    index("ledger_entries_category_idx").on(t.category),
    index("ledger_entries_bank_idx").on(t.bankId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    loanId: uuid("loan_id").references(() => loans.id, { onDelete: "cascade" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),

    docType: text("doc_type").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull().default(0),
    mimeType: text("mime_type"),
    /** Object-store key. No file bytes are kept in Postgres. */
    storageKey: text("storage_key"),
    checksum: text("checksum"),

    status: text("status").notNull().default("Pending"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    ...lifecycle,
  },
  (t) => [
    index("documents_customer_idx").on(t.customerId),
    index("documents_loan_idx").on(t.loanId),
    index("documents_bank_idx").on(t.bankId),
    index("documents_status_idx").on(t.status),
    /*
     * VOCABULARY ONLY — Task 13.13, D-010, D-057. Migration `0014`.
     *
     * A CHECK sees one candidate row and cannot see that row's previous value,
     * so it can express WHICH values exist and nothing about which transitions
     * are legal or who may make them. Those stay in the service layer, where
     * `allowedTransitions`, `initialStatuses` and `patchRefusals` already carry
     * them. The trigger count stays at 7.
     */
    check(
      "documents_status_check",
      sql`${t.status} in (${sql.raw(documentStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /*
     * NOT NULL since Task 10.3 (migration 0011) — DECISIONS.md D-077.
     *
     * It was nullable, while `GET /api/notifications` scopes on `ctx.userId`.
     * A null-recipient row was therefore invisible to every user, permanently
     * and silently. There is no "broadcast" reading of NULL here: the route has
     * no branch for it.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    severity: text("severity").notNull().default("info"),
    read: boolean("read").notNull().default(false),
    linkHref: text("link_href"),
    /*
     * EVENT IDENTITY — Task 10.3, D-077.
     *
     * Row 10.3's own test line requires "each producing event writes exactly one
     * notification row", which the original four columns could not express: no
     * event identity, no record reference, no uniqueness.
     *
     * `eventKey` is `{eventType}:{recordType}:{recordId}:{discriminator}`, the
     * discriminator being whatever makes a LEGITIMATE repeat distinct — a
     * per-tranche disbursement id, say. Retries therefore collide and genuine
     * repeats do not. That distinction is the whole design; without it a
     * dedupe rule would suppress real events.
     */
    eventType: text("event_type").notNull(),
    recordType: text("record_type"),
    recordId: uuid("record_id"),
    eventKey: text("event_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_read_idx").on(t.userId, t.read),
    index("notifications_record_idx").on(t.recordType, t.recordId),
    /*
     * Idempotency, scoped per recipient — a fan-out writes one row per user and
     * each is independently deduplicated. PARTIAL because `eventKey` is null for
     * anything not produced by the event service.
     */
    uniqueIndex("notifications_event_unique")
      .on(t.userId, t.eventKey)
      .where(sql`${t.eventKey} is not null`),
  ],
);

/** Every reassignment is kept, so "who had this and when" is answerable. */
export const assignmentHistory = pgTable(
  "assignment_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    bankId: uuid("bank_id"),
    fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "set null" }),
    fromTeamId: uuid("from_team_id").references(() => teams.id, { onDelete: "set null" }),
    toTeamId: uuid("to_team_id").references(() => teams.id, { onDelete: "set null" }),
    reason: text("reason"),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assignment_history_record_idx").on(t.recordType, t.recordId),
    index("assignment_history_to_user_idx").on(t.toUserId),
  ],
);

export const loansRelations = relations(loans, ({ one, many }) => ({
  customer: one(customers, { fields: [loans.customerId], references: [customers.id] }),
  bank: one(banks, { fields: [loans.bankId], references: [banks.id] }),
  fundingSource: one(fundingSources, {
    fields: [loans.fundingSourceId],
    references: [fundingSources.id],
  }),
  verification: one(verifications),
  bankOrders: many(bankOrders),
  disbursements: many(disbursements),
  transactions: many(transactions),
}));

export const verificationsRelations = relations(verifications, ({ one }) => ({
  loan: one(loans, { fields: [verifications.loanId], references: [loans.id] }),
  provider: one(serviceProviders, {
    fields: [verifications.serviceProviderId],
    references: [serviceProviders.id],
  }),
}));

export const disbursementsRelations = relations(disbursements, ({ one }) => ({
  loan: one(loans, { fields: [disbursements.loanId], references: [loans.id] }),
  bank: one(banks, { fields: [disbursements.bankId], references: [banks.id] }),
  customer: one(customers, { fields: [disbursements.customerId], references: [customers.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  loan: one(loans, { fields: [transactions.loanId], references: [loans.id] }),
  bank: one(banks, { fields: [transactions.bankId], references: [banks.id] }),
  disbursement: one(disbursements, {
    fields: [transactions.disbursementId],
    references: [disbursements.id],
  }),
}));

/* `loanStatuses` is declared above the `loans` table — `loans_status_check`
 * reads it during table construction, so it cannot live down here. */

export const loanTypes = [
  "Personal Loan",
  "Business Loan",
  "Gold Loan",
  "Vehicle Loan",
  "Home Loan",
  "Loan Against Property",
] as const;

export const verificationStatuses = [
  "Pending",
  "Requested",
  "In Progress",
  "Verified",
  "Rejected",
  "Failed",
  "Expired",
] as const;

/* `bankOrderStages` and `bankOrderStatuses` are declared above the `bank_orders`
 * table — `bank_orders_stage_check` and `bank_orders_status_check` read them
 * during table construction, so they cannot live down here (Task 6.5).
 * `disbursementStatuses` moved above `disbursements` for the same reason
 * (Task 7.3). */
export const disbursementModes = ["NEFT", "RTGS", "IMPS"] as const;
export const settlementStatuses = ["Paid", "Pending", "Disputed"] as const;
/*
 * Task 9.7. `documents.status` had no const at all — the vocabulary lived only
 * as a Zod literal in `operations.routes.ts`, which is the drift D-010's
 * "supply the schema layer's exported const" rule exists to prevent.
 *
 * It sits down here rather than above the table because there is no
 * `documents_status_check` reading it: D-010 scopes per-resource CHECK
 * constraints to Phases 5–8 and documents fall outside that, so 13.13 owns the
 * constraint. Nothing evaluates this during table construction, so there is no
 * temporal-dead-zone hazard.
 */
export const documentStatuses = ["Verified", "Pending", "Rejected"] as const;

/**
 * REQUIRED DOCUMENT TYPES — Task 9.11, DECISIONS.md D-076
 *
 * The table D-057 said did not exist. Its exact words, deferring the loan
 * machine's document-completeness guard: *"there is no `required document
 * types` table among the 27. The guard has nothing to read."* This is what it
 * reads.
 *
 * It also closes Phase 9's third DoD box — *"A KYC pack can be assembled and
 * produced from the system"* — which had **no owning task** before Wave 0. The
 * phrase occurs exactly once in the whole repository, in that DoD line, so
 * D-076 records engineering's minimum reading rather than inventing product:
 * required types, per-customer completeness, and a manifest of Verified
 * documents. **Not a PDF and not a ZIP** — either would be new scope or a new
 * dependency.
 *
 * `bank_id` is nullable on purpose: a null row is the default requirement set
 * that applies to every bank, and a bank-specific row overrides it. Partner
 * banks genuinely differ on what they will accept.
 */
export const requiredDocumentTypes = pgTable(
  "required_document_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** NULL = applies to every bank. A row with a bank narrows it. */
    bankId: uuid("bank_id").references(() => banks.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull(),
    /**
     * A type may be listed and not mandatory — "we accept a salary slip" is a
     * different statement from "we require one".
     */
    mandatory: boolean("mandatory").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...lifecycle,
  },
  (t) => [
    uniqueIndex("required_document_types_unique")
      .on(t.bankId, t.docType)
      .where(sql`${t.deletedAt} is null`),
    index("required_document_types_bank_idx").on(t.bankId),
  ],
);
export const transactionTypes = ["Disbursement", "EMI Collection", "Commission", "Refund"] as const;
export const transactionStatuses = ["Success", "Pending", "Failed"] as const;
export const ledgerCategories = [
  "Commission",
  "Disbursement",
  "Payout",
  "Expense",
  "Tax",
] as const;
export const fundingSourceTypes = ["own_funds", "bank", "external"] as const;
