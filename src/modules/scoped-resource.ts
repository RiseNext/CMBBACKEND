import type { Request } from "express";
import { Router } from "express";
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb, type Database } from "../db/index.js";
import { internal, notFound, unprocessable } from "../lib/errors.js";
import { notOnThisRoute, patchSchema } from "../lib/zod.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";
import { softDelete, type BinRecordType } from "../services/recycle-bin.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE HUMAN-READABLE CODE GENERATOR — BUG-011, Task 4.9, DECISIONS.md D-050
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Seven code series used to be minted by `codeStart + count(*) + 1` at THREE
 * independent call sites: `nextCode` below, `nextCustomerCode` in
 * `customers.routes.ts`, and an inline copy inside the Excel importer's confirm
 * transaction (`imports.routes.ts`). Two of those three mint `CUS-`, so fixing
 * fewer than all of them would have made the route and the importer collide
 * with EACH OTHER. All three now call this function and nothing else.
 *
 * Why a count was wrong, precisely — the roadmap's own diagnosis was not:
 *
 *   - **Permanent delete.** A count goes DOWN. Purge a record and the next
 *     create is handed a number already issued. On `ledger_entries` and
 *     `transactions`, whose code indexes are UNCONDITIONAL, that is an instant
 *     23505; on the partial ones it is a silently duplicated code.
 *   - **Concurrency.** Two creates read the same count and mint the same code.
 *   - **Independent generators.** Two sites counting the same table hand out the
 *     same number by construction, no delete or race required.
 *
 * ⚠️ **What was NOT wrong: the missing `deleted_at` filter.** Its absence is
 * load-bearing correctness. A soft-deleted row still counts, so its code stays
 * reserved; `customers_code_unique` is PARTIAL (`WHERE deleted_at is null`), so
 * re-issuing that code would be accepted by the index and would make restoring
 * the row from the recycle bin permanently impossible (PRD R3.1 AC3). Sequences
 * preserve that property for free — they never go backwards for any reason.
 *
 * The sequences and their starting values live in
 * `drizzle/0006_code_sequences.sql`, which seeds each one from the highest
 * number EVER issued for its prefix — live rows, soft-deleted rows and retained
 * recycle-bin snapshots of purged rows alike — following D-032's reasoning for
 * `nextEmployeeCode`. An empty table still yields `codeStart + 1`, so the
 * existing series continues and nothing renumbers.
 *
 * Sequences are gap-tolerant on purpose: `nextval` is not rolled back, so an
 * aborted insert burns a number. **A gap is harmless; a reuse is not.**
 */
const CODE_SEQUENCES: Record<string, string> = {
  CUS: "customer_code_seq",
  LN: "loan_code_seq",
  BO: "bank_order_code_seq",
  DSB: "disbursement_code_seq",
  STL: "settlement_code_seq",
  TXN: "transaction_code_seq",
  LG: "ledger_entry_code_seq",
};

/**
 * Anything that can run a statement: `getDb()`, or a transaction handle.
 *
 * The importer allocates a run of codes INSIDE its confirm transaction and must
 * pass `tx`, not the base handle — reading through the base handle from inside a
 * transaction deadlocks on a single-connection driver, which is exactly the bug
 * D-032 found and fixed in `nextEmployeeCode`.
 */
export type CodeExecutor = Pick<Database, "execute">;

/**
 * The handle `db.transaction(async (tx) => …)` hands its callback — Task 5.7,
 * DECISIONS.md D-060.
 *
 * Derived from `Database` rather than imported, because drizzle does not export
 * a `PgTransaction` alias that can be written down without also naming the four
 * generic parameters of the node-postgres driver. Deriving it means a driver
 * change cannot silently leave this type describing the wrong handle.
 *
 * It is NOT `Database`: a transaction handle has no `.transaction()` of its own
 * worth using here and no `$client`, so hooks receive exactly what they may use.
 * `recordAudit` takes a `Database` and is called as `recordAudit(tx as never, …)`
 * throughout `admin.routes.ts`; that cast is the established house pattern and is
 * reused rather than a second audit signature being invented.
 */
export type TransactionHandle = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The next code in a series — `CUS-10001`, `LN-1001`, `TXN-77001`.
 *
 * Lock-free and collision-free: `nextval` is atomic, so unlike the check-then-
 * insert generators this replaces, two concurrent callers cannot be handed the
 * same number. The unique index remains in place as a guard against a
 * hand-supplied duplicate; it is no longer load-bearing for generated codes.
 */
export async function nextResourceCode(
  prefix: string,
  executor: CodeExecutor = getDb(),
): Promise<string> {
  const sequence = CODE_SEQUENCES[prefix];
  // A prefix with no sequence must fail loudly rather than fall back to a
  // count: a second generation mechanism is the defect D-050 exists to remove.
  if (!sequence) throw internal(`No code sequence is defined for prefix ${prefix}`);

  // `sequence` is a value from the closed map above, never request input.
  // `::text` because a bigint reaches the two drivers as different JS types.
  const result = await executor.execute(sql.raw(`select nextval('${sequence}')::text as value`));
  const value = (result.rows as { value?: string }[])[0]?.value;
  if (!value) throw internal(`Sequence ${sequence} returned no value`);
  return `${prefix}-${value}`;
}

export interface ScopedResourceConfig<TCreate extends z.ZodTypeAny> {
  /** Drizzle table. Must carry id, bank_id and the soft-delete columns. */
  table: PgTable & Record<string, any>;
  /** Key in the recycle-bin registry. */
  recordType: BinRecordType;
  permissions: {
    view: string;
    create: string;
    edit: string;
    delete?: string;
    approve?: string;
  };
  createSchema: TCreate;
  /** Columns matched by the `search` query parameter. */
  searchable?: string[];
  /** Columns exposed as exact-match query parameters. */
  filterable?: string[];
  /** Numeric columns — Drizzle wants strings for `numeric`, the API takes numbers. */
  numericFields?: string[];
  /**
   * Generates the human-readable code (LN-1001, DSB-5001, ...). The prefix must
   * have a sequence in `CODE_SEQUENCES` above, or creation fails loudly.
   */
  codePrefix?: string;
  /**
   * The number BELOW the first code in the series — `LN-1001` starts at 1000.
   *
   * Since Task 4.9 this is documentation, not behaviour: the value that matters
   * is the one `drizzle/0006_code_sequences.sql` seeds the sequence with, and
   * the two agree by construction. It is kept because it is the only place the
   * six series' starting numbers are stated in TypeScript, and removing it would
   * silently detach six resources from a number they are still defined by.
   */
  codeStart?: number;
  /** Column the ordering is applied to. Defaults to created_at. */
  orderColumn?: string;
  /** Runs inside create/update before the write. Use for cross-record checks. */
  beforeWrite?: (
    input: Record<string, any>,
    context: { db: ReturnType<typeof getDb>; ctx: ReturnType<typeof authOf>; existing?: any },
  ) => Promise<void> | void;
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * STATE MACHINE — Task 5.2 / 5.3, DECISIONS.md D-010, D-056, D-057
   * ───────────────────────────────────────────────────────────────────────────
   *
   * All three fields are OPT-IN. A resource that configures none of them
   * behaves exactly as it did before Phase 5 — which is deliberate, not
   * laziness: bank-order stages belong to roadmap 6.5, disbursement status to
   * 7.3, and 13.13 is the sweep. Widening any of these to every resource here
   * would annex three phases' worth of business rules under cover of a factory
   * change, and would do it without the BUSINESS_FLOW.md machine D-010 requires
   * to be written first.
   *
   * `loans` is the only resource that configures them today. Its machine is
   * ratified at BUSINESS_FLOW.md §3.3; the edge table there is authoritative and
   * `operations.routes.ts` must not drift from it.
   */
  /**
   * The **vocabulary** the approve route accepts — Task 5.3.
   *
   * Without it the route parses `z.string().min(1)` and writes whatever it is
   * given, so `{"status":"banana"}` is a 200 that persists `banana` (D-010's
   * opening example, and BUSINESS_FLOW.md §3.2(b)). With it the same field is
   * parsed by `z.enum(...)`, so an unknown value is a 422 before any row is
   * touched.
   *
   * Supply the schema layer's exported const — `loanStatuses` and friends in
   * `db/schema/operations.ts` — rather than a fresh literal. A second copy of a
   * vocabulary is a second thing to forget to update.
   */
  allowedStatuses?: readonly [string, ...string[]];
  /**
   * The legal `from → to` edges — Task 5.2. Keys are statuses; values are the
   * statuses reachable from them. A **terminal** status is present with an empty
   * array; a status absent from the map entirely is treated as unknown and
   * nothing may move out of it (fail closed).
   *
   * Enforced at CREATE and APPROVE only. PATCH is not a third enforcement point
   * because under D-056 PATCH does not write status at all — see `patchRefusals`.
   */
  allowedTransitions?: Record<string, readonly string[]>;
  /**
   * The statuses a record may be **created** in. Required alongside
   * `allowedTransitions`, because an initial status has no `from` and therefore
   * cannot be expressed as an edge.
   *
   * This is the guard that closes `POST /api/loans {"status":"Approved"}` — a
   * privilege bypass identical in shape to the PATCH one D-056 closed, since
   * `requests.create` is held by roles that do not hold `requests.approve`.
   */
  initialStatuses?: readonly string[];
  /**
   * The column the machine above governs — Task F1-c, DECISIONS.md D-062/D-063.
   *
   * Defaults to `"status"`, which is what every resource configured before F1
   * used implicitly, so **omitting this is byte-for-byte the previous
   * behaviour**: `allowedTransitions` and `initialStatuses` read `status`, the
   * approve route writes `status`, and refusals name `path: "status"`.
   *
   * It exists because `bank_orders` has **two** workflow columns — `stage` and
   * `status` (`operations.routes.ts:317-320`) — and the machine that matters for
   * a stage move is not on a column called `status`. Without this the loan
   * machine could not be pointed at `stage` at all.
   *
   * **Setting it explicitly also turns on PATCH-side enforcement** (see the
   * PATCH handler). That is deliberate and is the only way to get it: bank
   * orders have **no approve route** — `bankOrdersRouter` configures no
   * `approve` permission, and the route below is conditional on one — so PATCH
   * is their only transition point. Resources that leave this unset keep a PATCH
   * that does not consult the transition map, exactly as before F1.
   */
  transitionColumn?: string;
  /**
   * Fields the create schema declares that **PATCH must refuse** — field name to
   * the message the caller is given. D-025 established the pattern on
   * `PATCH /api/users/:id` for `bankIds`/`teamId`; D-056 applies it to
   * `loans.status` and `loans.amountApproved`.
   *
   * Per-resource on purpose. Bank orders and disbursements own their own status
   * writability (6.5, 7.3) and must not inherit a refusal decided for loans.
   */
  patchRefusals?: Record<string, string>;
  /**
   * Runs INSIDE the create transaction, after the row exists — Task 5.7, D-060.
   *
   * `beforeWrite` cannot serve this purpose: it fires before the insert, so the
   * new row has no id yet, and it is handed the base `db` handle rather than the
   * transaction. This hook receives the transaction handle and the created row,
   * so anything it writes commits or rolls back **with** the row that caused it.
   *
   * Named `afterCreate`, not `afterWrite`, because it fires on create only.
   * `beforeWrite` runs on create *and* patch, so reusing that word would promise
   * a symmetry that does not exist.
   *
   * Throwing from here aborts the whole create. That is the intended way to
   * refuse a cross-record precondition: the caller gets the error, and neither
   * the new row nor any partial side effect survives.
   */
  afterCreate?: (
    created: Record<string, any>,
    context: {
      tx: TransactionHandle;
      ctx: ReturnType<typeof authOf>;
      req: Request;
      input: Record<string, any>;
    },
  ) => Promise<void>;
  /**
   * Runs INSIDE the approve transaction, after the status has been written —
   * Task F1-b, DECISIONS.md D-062.
   *
   * The approve twin of `afterCreate`, and named the same way for the same
   * reason: it fires on **approve only**. It is deliberately NOT a single
   * `afterWrite` covering create, patch and approve. `afterCreate` already has a
   * consumer whose work must happen exactly once — `disbursementsRouter`
   * advances its loan to `Disbursed` and audits that (`operations.routes.ts:387`)
   * — and a merged hook would re-run that state transition on every unrelated
   * PATCH. Two narrow hooks that each say when they fire beat one broad hook
   * that does not.
   *
   * Receives `before` as well as `after` because the interesting thing about an
   * approval is the edge, not the destination: 8.8's settlement chain fires on
   * `→ Paid` specifically, not on every write that leaves a settlement `Paid`.
   *
   * **The handle is `tx`, and it is the only handle a hook may use.** Calling
   * `getDb()` from in here — or opening a nested transaction — reads through the
   * base handle while this transaction holds the only connection, which is the
   * deadlock D-032 diagnosed. `nextResourceCode` takes a `CodeExecutor` for
   * exactly this reason and must be passed `tx`.
   *
   * Throwing aborts the whole approval: the status change, this hook's writes
   * and the audit row all roll back together.
   */
  /**
   * Extra fields the APPROVE route accepts and writes — audit U-5, Task 11.6b.
   *
   * OPT-IN. A resource configuring nothing gets an approve body of exactly
   * `{ status, notes }`, byte-for-byte as before.
   *
   * It exists because `loans.amount_approved` was **written by nothing**: PATCH
   * refuses it under D-056 ("part of the approval decision, not an edit") and
   * the approve route had no way to carry it. So every approved loan reported a
   * sanctioned amount of **0**, and `/api/dashboard/bank-performance` summed
   * that column. The amount belongs to the approval, so it is captured where
   * the approval is made.
   */
  approveInput?: z.ZodObject<z.ZodRawShape>;

  /**
   * Runs after the transition is judged legal and BEFORE anything is written.
   *
   * The mirror of `beforeWrite` for the approve route. `afterApprove` is too
   * late to refuse an approval — it runs inside the transaction, after the row
   * has been updated — and a hook that can only undo by throwing is the wrong
   * shape for "this approval is missing a required figure".
   */
  beforeApprove?: (
    before: Record<string, any>,
    input: Record<string, any>,
    context: { ctx: ReturnType<typeof authOf>; db: Database },
  ) => void | Promise<void>;

  afterApprove?: (
    before: Record<string, any>,
    after: Record<string, any>,
    context: {
      tx: TransactionHandle;
      ctx: ReturnType<typeof authOf>;
      req: Request;
      input: { status: string; notes?: string };
    },
  ) => Promise<void>;
  /** Human label for audit summaries. */
  label?: (row: Record<string, any>) => string;
}

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  search: z.string().trim().max(160).optional(),
  bankId: z.string().uuid().optional(),
});

function stringifyNumerics(
  input: Record<string, any>,
  fields: string[] | undefined,
): Record<string, any> {
  if (!fields?.length) return input;
  const out = { ...input };
  for (const field of fields) {
    if (out[field] !== undefined && out[field] !== null) out[field] = String(out[field]);
  }
  return out;
}

/**
 * Builds a router whose every handler goes through the same four gates:
 * authenticate -> permission -> bank scope -> audit.
 *
 * Writing ten of these by hand is how one resource ends up missing its scope
 * filter. The factory makes that failure mode structurally impossible: there is
 * exactly one place the WHERE clause is assembled.
 */
export function createScopedResource<TCreate extends z.ZodTypeAny>(
  config: ScopedResourceConfig<TCreate>,
): Router {
  const router = Router();
  router.use(requireAuth);

  const table = config.table;
  const bankColumn = table.bankId as PgColumn;
  const idColumn = table.id as PgColumn;
  const deletedAtColumn = table.deletedAt as PgColumn;
  const orderColumn = (table[config.orderColumn ?? "createdAt"] ?? table.createdAt) as PgColumn;
  const labelOf = config.label ?? ((row) => String(row.code ?? row.name ?? config.recordType));

  /** Six series — LN, BO, DSB, STL, TXN, LG — off the one shared generator. */
  async function nextCode(): Promise<string | undefined> {
    if (!config.codePrefix) return undefined;
    return nextResourceCode(config.codePrefix);
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * TRANSITION ENFORCEMENT — Task 5.2, DECISIONS.md D-010, D-031, D-057
   * ───────────────────────────────────────────────────────────────────────────
   *
   * Two entry points, and only two: CREATE and APPROVE. PATCH is not a third,
   * because D-056 removed its ability to write status at all — guarding a
   * transition there would be guarding a write that can no longer happen.
   *
   * Every refusal is **422 via `unprocessable()`** carrying
   * `details: [{ path: "status", message }]`. The shape is not decorative: the
   * frontend's `lib/field-errors.ts` discriminates on it (D-031 — "consumed by
   * shape, not by status code"), so a rejection lands on the status control
   * rather than as an anonymous banner. The same message is used for the
   * top-line and the field so a client that renders either is correct.
   *
   * NOT guarded here, deliberately: concurrency. This is check-then-write
   * against the row already read for the 404, so two simultaneous approvals can
   * both observe the old status. D-027 keeps that posture at all eleven
   * transaction sites in the codebase and BUG-037 stays deferred — **no row lock
   * is taken.** BUSINESS_FLOW.md §3.3 records the same.
   */

  /*
   * The column the machine governs — F1-c. `"status"` unless a resource says
   * otherwise, which is what every pre-F1 caller meant implicitly, so the
   * default path through everything below is unchanged.
   *
   * It is also the `details[].path` the refusals name, so a 422 lands on the
   * control the operator actually used (D-031). A stage refusal that reported
   * `path: "status"` would be mapped onto a field the form does not have.
   */
  const transitionColumn = config.transitionColumn ?? "status";
  /*
   * Used only in refusal prose. `status → statuses` keeps every message a
   * pre-F1 resource produces **byte-for-byte identical**, which matters because
   * `loan-state-machine.test.ts` asserts on this wording; `stage → stages` reads
   * correctly for the one resource that will configure it.
   */
  const transitionColumnPlural = transitionColumn === "status" ? "statuses" : `${transitionColumn}s`;

  /** Refusing to move a record out of `from`. `to` is already known-valid. */
  function assertTransitionAllowed(from: unknown, to: string): void {
    const map = config.allowedTransitions;
    if (!map) return;

    const current = String(from ?? "");
    const allowed = map[current];

    // Absent key, not just an empty one. After migration 0007 the CHECK makes
    // every stored loan status a member of the vocabulary, so reaching this
    // means the map and the constraint have drifted apart — fail closed and say
    // which value could not be placed, rather than waving the write through.
    if (!allowed) {
      const message = `${current || `An empty ${transitionColumn}`} is not a recognised ${config.recordType} ${transitionColumn}, so no change can be made from it`;
      throw unprocessable(message, [{ path: transitionColumn, message }]);
    }

    if (allowed.includes(to)) return;

    const message =
      allowed.length === 0
        ? `${current} is a final ${transitionColumn} for a ${config.recordType} and cannot be changed`
        : `A ${config.recordType} cannot move from ${current} to ${to}. From ${current} the allowed ${transitionColumnPlural} are: ${allowed.join(", ")}`;
    throw unprocessable(message, [{ path: transitionColumn, message }]);
  }

  /** Refusing an illegal status on a record that does not exist yet. */
  function assertInitialStatusAllowed(to: unknown): void {
    const allowed = config.initialStatuses;
    // `undefined` means the create schema's own default applies, which is the
    // start state by construction and never needs checking.
    if (!allowed || to === undefined || to === null) return;

    const requested = String(to);
    if (allowed.includes(requested)) return;

    const message = `A ${config.recordType} cannot be created with ${transitionColumn} ${requested}. A new ${config.recordType} may start as: ${allowed.join(", ")}`;
    throw unprocessable(message, [{ path: transitionColumn, message }]);
  }

  /*
   * The approve route's body schema — Task 5.3.
   *
   * Built once, here, rather than per request: it is derived from static config
   * and rebuilding a zod schema on every call would be pure waste. `z.enum` when
   * a vocabulary is configured, the historical `z.string().min(1)` when it is
   * not, so a resource that opts out is byte-for-byte unchanged. Both branches
   * produce a plain `string`, which is all the handler needs.
   */
  const approveBody = (() => {
    const base = z.object({
      status: (config.allowedStatuses
        ? z.enum(config.allowedStatuses)
        : z.string().min(1)) as z.ZodType<string>,
      notes: z.string().max(1000).optional(),
    });
    // Opt-in (U-5). A resource configuring nothing is unchanged.
    return config.approveInput ? base.extend(config.approveInput.shape) : base;
  })();

  /*
   * The PATCH body schema — D-024 (one derivation), D-025 / D-056 (refusals).
   *
   * `patchSchema`, never `.partial()`: in zod 4 a `.default()` survives
   * `.partial()`, and the update below spreads the parsed object wholesale with
   * no `!== undefined` guard, so every default in every resource schema used to
   * be written on every PATCH (BUG-036). Measured before the fix: a remarks-only
   * PATCH on an approved loan zeroed amountRequested, amountApproved, emi,
   * processingFee, commission, interestRate and tenureMonths, and reset its
   * status to Draft.
   *
   * `notOnThisRoute()` rather than `.strict()`, exactly as D-025 chose for
   * users: `.strict()` would reject every unrecognised key on the route and
   * report `path: ""`, naming the offending field only inside the message.
   */
  const patchBody = (() => {
    const base = patchSchema(config.createSchema as unknown as z.ZodObject<z.ZodRawShape>);
    const refusals = config.patchRefusals;
    if (!refusals) return base;
    return base.extend(
      Object.fromEntries(
        Object.entries(refusals).map(([field, message]) => [field, notOnThisRoute(message)]),
      ),
    );
  })();

  /** The single choke point. Every read passes through here. */
  function scopedWhere(req: Parameters<typeof authOf>[0], extra: SQL[] = []): SQL | undefined {
    const ctx = authOf(req);
    const filters: SQL[] = [isNull(deletedAtColumn), ...extra];
    const scope = bankScope(ctx, bankColumn);
    if (scope) filters.push(scope);
    return and(...filters);
  }

  router.get("/", requirePermission(config.permissions.view), async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const query = listQuery.parse(req.query);
      const db = getDb();
      const extra: SQL[] = [];

      if (query.bankId) {
        // A client filter can narrow the scope; it can never widen it.
        assertBankAccess(ctx, query.bankId);
        extra.push(eq(bankColumn, query.bankId));
      }

      for (const field of config.filterable ?? []) {
        const value = req.query[field];
        if (typeof value === "string" && value.length > 0) {
          extra.push(eq(table[field] as PgColumn, value));
        }
      }

      if (query.search && config.searchable?.length) {
        const needle = `%${query.search}%`;
        const match = or(
          ...config.searchable.map((field) => ilike(table[field] as PgColumn, needle)),
        );
        if (match) extra.push(match);
      }

      const where = scopedWhere(req, extra);
      const [{ total = 0 } = {}] = await db.select({ total: count() }).from(table).where(where);
      const rows = await db
        .select()
        .from(table)
        .where(where)
        .orderBy(desc(orderColumn))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      res.json({
        data: rows,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
          scoped: ctx.bankIds !== null,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", requirePermission(config.permissions.view), async (req, res, next) => {
    try {
      const [row] = await getDb()
        .select()
        .from(table)
        .where(scopedWhere(req, [eq(idColumn, req.params.id as string)]))
        .limit(1);
      // Out of scope and non-existent are indistinguishable by design.
      if (!row) throw notFound(`${config.recordType} not found`);
      res.json({ data: row });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", requirePermission(config.permissions.create), async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const parsed = config.createSchema.parse(req.body) as Record<string, any>;
      const db = getDb();

      // Asserted against the *payload*, so a hand-crafted bankId is rejected.
      assertBankAccess(ctx, parsed.bankId);
      // A payload-shape refusal, so it sits with the other payload checks and
      // ahead of beforeWrite's cross-record reads (Task 5.2). Reads the machine's
      // own column (F1-c); `transitionColumn` defaults to `status`, so this is
      // `parsed.status` for every resource configured before F1.
      assertInitialStatusAllowed(parsed[transitionColumn]);
      await config.beforeWrite?.(parsed, { db, ctx });

      /*
       * Minted BEFORE the transaction opens. Calling the generator from inside
       * it would read through the base handle while the transaction holds the
       * only connection — the deadlock D-032 diagnosed and fixed in
       * `nextEmployeeCode`, where every test in the new suite timed out at 60 s.
       * `nextval` is not rolled back, so an aborted create burns a number; a gap
       * is harmless and a reuse is not (D-050).
       */
      const code = await nextCode();

      /*
       * ONE TRANSACTION — Task 5.7, DECISIONS.md D-060.
       *
       * Before this, the insert and its audit row were two autocommitted
       * statements: a failed audit left a record with no history, and there was
       * no boundary a cross-stage side effect could join. `grep '\.transaction('`
       * over this file returned zero hits.
       *
       * `recordAudit` was already built for this — it "deliberately accepts the
       * same `db` handle the caller is using, so that when the caller is inside a
       * transaction the audit row commits or rolls back atomically with the
       * change it describes" (services/audit.ts:45-49). It had no caller doing
       * so. Now every create in every one of the nine routers does.
       */
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(table)
          .values({
            ...stringifyNumerics(parsed, config.numericFields),
            ...(code ? { code } : {}),
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning();

        // Cross-stage side effects, on the same handle. A throw in here aborts
        // the insert above with it — that is the point.
        await config.afterCreate?.(row as Record<string, any>, { tx, ctx, req, input: parsed });

        await recordAudit(tx as never, ctx, req, {
          action: "created",
          recordType: config.recordType,
          recordId: (row as any)?.id,
          bankId: parsed.bankId,
          summary: `Created ${config.recordType} ${labelOf(row as any)}`,
        });

        return row;
      });

      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", requirePermission(config.permissions.edit), async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      // Derived once at router construction — see `patchBody` above for why it
      // is `patchSchema` (BUG-036) and where the refusals come from (D-056).
      const parsed = patchBody.parse(req.body) as Record<string, any>;
      const db = getDb();

      const [before] = await db
        .select()
        .from(table)
        .where(scopedWhere(req, [eq(idColumn, id)]))
        .limit(1);
      if (!before) throw notFound(`${config.recordType} not found`);

      // Reassigning to another bank requires access to the destination too,
      // otherwise scoping could be escaped by moving a record out.
      if (parsed.bankId && parsed.bankId !== (before as any).bankId) {
        assertBankAccess(ctx, parsed.bankId);
      }
      await config.beforeWrite?.(parsed, { db, ctx, existing: before });

      /*
       * PATCH-side transition enforcement — Task F1-c, D-062.
       *
       * OPT-IN, and gated on `transitionColumn` being set **explicitly** rather
       * than on `allowedTransitions` alone. A resource that configured a machine
       * before F1 gets a PATCH that behaves exactly as it did: loans, the only
       * such resource, refuse `status` on PATCH outright under D-056, so there
       * would be nothing here to guard anyway.
       *
       * It exists for bank orders, which have **no approve route** — the route
       * below is conditional on an `approve` permission they do not configure —
       * so PATCH is the only place their stage machine can be enforced. That is
       * the whole reason 6.1 could not simply reuse the loan configuration.
       *
       * Only fires when the payload actually carries the column: a remarks-only
       * PATCH is not a transition and must not be judged as one.
       */
      if (config.transitionColumn !== undefined && parsed[transitionColumn] !== undefined) {
        assertTransitionAllowed(
          (before as any)[transitionColumn],
          String(parsed[transitionColumn]),
        );
      }

      /*
       * ONE TRANSACTION — Task F1-a, D-062.
       *
       * Before this, the update and its audit row were two autocommitted
       * statements, so a failed audit left a mutated record with no history of
       * the mutation. `recordAudit` was already built to accept a transaction
       * handle (services/audit.ts) and the create path already did so; PATCH did
       * not. Now it does, on the same `recordAudit(tx as never, …)` pattern.
       *
       * `beforeWrite` deliberately stays OUTSIDE and keeps the base handle: its
       * signature hands callers `db`, five routers rely on that, and widening it
       * to a transaction handle would be a breaking change to all of them for no
       * gain — it only ever reads.
       */
      const after = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(table)
          .set({
            ...stringifyNumerics(parsed, config.numericFields),
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(eq(idColumn, id))
          .returning();

        await recordAudit(tx as never, ctx, req, {
          action: "updated",
          recordType: config.recordType,
          recordId: id,
          bankId: (row as any)?.bankId,
          summary: `Updated ${config.recordType} ${labelOf(row as any)}`,
          changes: diff(before as any, row as any),
        });

        return row;
      });

      res.json({ data: after });
    } catch (error) {
      next(error);
    }
  });

  if (config.permissions.delete) {
    router.delete("/:id", requirePermission(config.permissions.delete), async (req, res, next) => {
      try {
        const ctx = authOf(req);
        const id = req.params.id as string;
        const [row] = await getDb()
          .select({ id: idColumn })
          .from(table)
          .where(scopedWhere(req, [eq(idColumn, id)]))
          .limit(1);
        if (!row) throw notFound(`${config.recordType} not found`);

        await softDelete(getDb(), ctx, req, config.recordType, id);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    });
  }

  if (config.permissions.approve) {
    router.post(
      "/:id/approve",
      requirePermission(config.permissions.approve),
      async (req, res, next) => {
        try {
          const ctx = authOf(req);
          const id = req.params.id as string;
          const db = getDb();

          const [before] = await db
            .select()
            .from(table)
            .where(scopedWhere(req, [eq(idColumn, id)]))
            .limit(1);
          if (!before) throw notFound(`${config.recordType} not found`);

          /*
           * Vocabulary first (Task 5.3, `z.enum` → 422), then legality (Task
           * 5.2, `unprocessable` → 422). Both refuse before any row is touched.
           *
           * The order matters for the message a caller gets: `"banana"` is not a
           * status at all, so answering "you cannot move from Draft to banana"
           * would invite them to look for a transition that could never exist.
           */
          /*
           * Typed explicitly because `approveInput` widens the schema's inferred
           * type to a union (U-5). `status` is always present — the base object
           * requires it — and the rest is whatever the resource opted into.
           */
          const status = approveBody.parse(req.body) as {
            status: string;
            notes?: string;
          } & Record<string, unknown>;

          /*
           * `before` was already loaded above for the 404 and the audit diff.
           * Comparing its status to the requested one is the whole of the
           * from→to rule — BUSINESS_FLOW.md §3.2(c) recorded that "the previous
           * status is never compared to the requested one", and this is the line
           * that stops being true.
           */
          assertTransitionAllowed((before as any)[transitionColumn], status.status);

          /*
           * Last chance to refuse — audit U-5. Runs after the transition is
           * judged legal and before any row is touched, so a rejected approval
           * leaves nothing behind and needs no rollback.
           */
          await config.beforeApprove?.(before as Record<string, any>, status as Record<string, any>, {
            ctx,
            db,
          });

          /*
           * ONE TRANSACTION — Task F1-a / F1-b, D-062.
           *
           * The mirror of the create path: write, then the hook on the same
           * handle, then the audit row on the same handle. Before F1 the update
           * and the audit were two autocommits, so an approval could commit with
           * no record that it happened — on the one route in the system whose
           * entire purpose is to record that something was approved.
           *
           * Ordering matches create for a reason: the hook sees the row as it
           * will be committed, and anything it writes is undone with the status
           * change if it throws.
           */
          const after = await db.transaction(async (tx) => {
            const [row] = await tx
              .update(table)
              .set({
                [transitionColumn]: status.status,
                /*
                 * Whatever `approveInput` declared, written with the decision it
                 * belongs to (U-5). `status` and `notes` are handled explicitly
                 * below, so they are stripped here rather than written twice.
                 */
                ...(config.approveInput
                  ? stringifyNumerics(
                      Object.fromEntries(
                        Object.entries(status as Record<string, unknown>).filter(
                          ([k, v]) => k !== "status" && k !== "notes" && v !== undefined,
                        ),
                      ),
                      config.numericFields,
                    )
                  : {}),
                ...(table.approvedBy ? { approvedBy: ctx.userId, approvedAt: new Date() } : {}),
                ...(status.notes && table.notes ? { notes: status.notes } : {}),
                updatedAt: new Date(),
                updatedBy: ctx.userId,
              })
              .where(eq(idColumn, id))
              .returning();

            // Cross-stage side effects, on the same handle — 8.8's settlement →
            // transaction → ledger chain is the intended consumer. A throw in
            // here aborts the approval above with it.
            await config.afterApprove?.(before as Record<string, any>, row as Record<string, any>, {
              tx,
              ctx,
              req,
              input: status,
            });

            await recordAudit(tx as never, ctx, req, {
              action: "approved",
              recordType: config.recordType,
              recordId: id,
              bankId: (row as any)?.bankId,
              summary: `Set ${config.recordType} ${labelOf(row as any)} to ${status.status}`,
              changes: diff(before as any, row as any),
            });

            return row;
          });

          res.json({ data: after });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  return router;
}
