import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import {
  areas,
  banks,
  branches,
  customers,
  disbursements,
  fvrYesNo,
  houseConfirmations,
  loans,
  paymentStatuses,
  regions,
  users,
  verifications,
} from "../db/schema/index.js";
import { notFound, unprocessable } from "../lib/errors.js";
import { patchSchema } from "../lib/zod.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";

/**
 * MANAGER MAINTENANCE — Task MM-1, DECISIONS.md D-095.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 *
 * Management already tracks this business in four spreadsheets: a Field
 * Verification Report checklist, a Transfer / Disbursement register, an APTS
 * register and a Payment register. This module does NOT import those sheets and
 * does NOT create a second copy of the business in their shape. It is four
 * READ PROJECTIONS over `customers`, `loans`, `verifications` and
 * `disbursements` — the records that were already the source of truth — plus
 * three narrow PATCH routes for the handful of annotations the CRM genuinely
 * had nowhere to put.
 *
 * There is no `fvr_tracking`, `transfer_tracking`, `apts_tracking` or
 * `payment_tracking` table, and there must never be one. A disbursement's
 * amount appears on three of these sheets and is read from `disbursements.amount`
 * every time; a second editable copy would be two numbers that can disagree
 * about how much money moved.
 *
 * ── WHY IT IS A SEPARATE ROUTER AND NOT THE FACTORY ─────────────────────────
 *
 * `createScopedResource` owns ONE table and emits CRUD over it. Every sheet
 * here spans four to seven tables and none of them is a new resource. The
 * hand-written shape is the same one `reportsRouter` uses for the same reason.
 *
 * ── SECURITY POSTURE ────────────────────────────────────────────────────────
 *
 * Identical to every other read in this codebase, and deliberately not novel:
 *
 *   · `requireAuth` on the router, so nothing here is reachable anonymously;
 *   · `requirePermission` per route — `maintenance.view` to read,
 *     `maintenance.edit` to annotate, `maintenance.manage_locations` for master
 *     data. Frontend gating is convenience only and is never relied upon;
 *   · `bankScope(ctx, <driving table>.bankId)` in the SQL WHERE clause on every
 *     projection, so a scoped user cannot see another bank's rows. It is always
 *     applied to a NOT NULL `bank_id` on the DRIVING table (`verifications` and
 *     `disbursements` both qualify) — never to `branches.bank_id`, which is
 *     nullable and would make every branch without a lender invisible via
 *     `inArray` (the D-084 defect);
 *   · a client `bankId` filter goes through `assertBankAccess` FIRST, so it can
 *     narrow the scope and can never widen it;
 *   · every mutation re-reads the target row, re-asserts bank access on the
 *     row's own `bank_id`, and writes an audit row in the same transaction.
 *
 * ── EXPLICIT PROJECTIONS, ALWAYS ────────────────────────────────────────────
 *
 * Never a bare `.select()` over a join. That returns every column of every
 * joined table, which for `customers` includes `aadhaar_hash` (SEC-007). Each
 * query below names exactly the columns its sheet needs.
 */
export const maintenanceRouter = Router();
maintenanceRouter.use(requireAuth);

const uuidField = z.string().uuid();

/**
 * Shared by the three disbursement-backed sheets. `pageSize: 0` means "every
 * matching row" and is what the export path sends, bounded by
 * `MAINTENANCE_EXPORT_MAX` rather than unbounded — the same contract
 * `/api/reports/loans` established. Past the ceiling it refuses and says by how
 * much, because an export that silently truncates is the defect.
 */
const MAINTENANCE_EXPORT_MAX = 20_000;

const sheetQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  bankId: uuidField.optional(),
  regionId: uuidField.optional(),
  areaId: uuidField.optional(),
  branchId: uuidField.optional(),
  customerId: uuidField.optional(),
  assignedUserId: uuidField.optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(0).max(500).default(50),
});

const idParam = z.object({ id: uuidField });

/**
 * The reported date for every disbursement-backed sheet.
 *
 * `disbursed_on` when the operator recorded one, `created_at` otherwise. This is
 * the convention `/api/reports/loans` already uses for loans
 * (`coalesce(applied_on, created_at)`) and it is reused rather than reinvented
 * so two screens cannot disagree about which day a record belongs to.
 *
 * It is NOT a bank value date and nothing in this system reconciles it against
 * one. The sheets label it `DATE` / `Date`, which is what it is.
 */
const reportedAt = sql`coalesce(${disbursements.disbursedOn}, ${disbursements.createdAt})`;

/** The inclusive `to` bound. A date input means the whole day, so the
 *  comparison is against `to + 1 day` exclusive — comparing a timestamp to a
 *  midnight boundary otherwise drops everything after 00:00:00 on the last day. */
function dayAfter(to: Date): Date {
  const next = new Date(to);
  next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Every filter the three disbursement sheets share.
 *
 * Region and Area are filtered through the branch chain rather than through a
 * denormalised column, so a branch cannot be reported under two areas.
 */
function disbursementFilters(
  ctx: ReturnType<typeof authOf>,
  q: z.infer<typeof sheetQuery>,
): SQL[] {
  const filters: SQL[] = [isNull(disbursements.deletedAt)];

  const scope = bankScope(ctx, disbursements.bankId);
  if (scope) filters.push(scope);

  if (q.bankId) {
    // A client filter narrows the scope; it can never widen it.
    assertBankAccess(ctx, q.bankId);
    filters.push(eq(disbursements.bankId, q.bankId));
  }
  if (q.customerId) filters.push(eq(disbursements.customerId, q.customerId));
  if (q.branchId) filters.push(eq(loans.branchId, q.branchId));
  if (q.areaId) filters.push(eq(branches.areaId, q.areaId));
  if (q.regionId) filters.push(eq(areas.regionId, q.regionId));
  if (q.assignedUserId) {
    filters.push(
      sql`coalesce(${disbursements.assignedUserId}, ${loans.assignedUserId}) = ${q.assignedUserId}`,
    );
  }
  if (q.from) filters.push(sql`${reportedAt} >= ${q.from}`);
  if (q.to) filters.push(sql`${reportedAt} < ${dayAfter(q.to)}`);

  if (q.search) {
    const term = `%${q.search}%`;
    const match = or(
      ilike(customers.name, term),
      ilike(customers.mobile, term),
      ilike(disbursements.utr, term),
      ilike(disbursements.code, term),
      ilike(loans.btLeadId, term),
      ilike(branches.name, term),
    );
    if (match) filters.push(match);
  }

  return filters;
}

/**
 * The one projection behind Transfer, APTS and Payment.
 *
 * All four joins are many-to-one, so no driving row is multiplied and
 * `count(*)`, `sum()`, `limit` and `offset` stay correct without a `distinct`.
 *
 * `managerName` resolves through `coalesce(disbursements.assigned_user_id,
 * loans.assigned_user_id)` — the disbursement's own owner when it has one, the
 * file's owner otherwise. This reuses the EXISTING assignment model rather than
 * adding a manager hierarchy for a report. Where neither is set the column is
 * NULL and the sheet shows a blank, which is the honest answer.
 */
const sheetColumns = {
  id: disbursements.id,
  code: disbursements.code,
  date: sql<string | null>`${reportedAt}`.as("date"),
  customerId: disbursements.customerId,
  customerName: customers.name,
  customerMobile: customers.mobile,
  regionName: regions.name,
  areaName: areas.name,
  branchName: branches.name,
  btLeadId: loans.btLeadId,
  managerName: users.name,
  loanStatus: loans.status,
  transferAmount: disbursements.amount,
  utr: disbursements.utr,
  remark: disbursements.notes,
  disbursementStatus: disbursements.status,
  /*
   * "Fund Credited to Customer" — the moment the money reached the customer.
   *
   * `approved_at` is stamped `new Date()` inside the approve transaction
   * (`scoped-resource.ts`), and for `disbursements` that transaction is the ONLY
   * way to reach `Credited`: `initialStatuses` is `["In Transit"]` so a row can
   * never be created Credited, and `patchRefusals.status` blocks PATCH. So for a
   * Credited row this IS the moment it became Credited.
   *
   * GUARDED ON `status = 'Credited'` and NULL otherwise, which matters: the same
   * column is stamped on the `-> Failed` transition too, and printing a failed
   * transfer's timestamp under "Fund Credited" would assert money arrived when
   * it did not.
   */
  fundCreditedAt: sql<string | null>`case when ${disbursements.status} = 'Credited' then ${disbursements.approvedAt} else null end`.as(
    "fund_credited_at",
  ),
  paymentStatus: disbursements.paymentStatus,
} as const;

/** The join chain, applied identically by every disbursement-backed sheet. */
function sheetFrom(db: ReturnType<typeof getDb>) {
  return db
    .select(sheetColumns)
    .from(disbursements)
    .innerJoin(customers, eq(customers.id, disbursements.customerId))
    .innerJoin(loans, eq(loans.id, disbursements.loanId))
    .leftJoin(branches, eq(branches.id, loans.branchId))
    .leftJoin(areas, eq(areas.id, branches.areaId))
    .leftJoin(regions, eq(regions.id, areas.regionId))
    .leftJoin(
      users,
      sql`${users.id} = coalesce(${disbursements.assignedUserId}, ${loans.assignedUserId})`,
    );
}

/**
 * Runs one disbursement-backed sheet. The three formats differ only in which
 * columns the CLIENT renders — the rows and the totals are identical, which is
 * exactly why there is one query here and not three.
 */
async function runSheet(req: Request, res: Response): Promise<void> {
  const ctx = authOf(req);
  const q = sheetQuery.parse(req.query);
  const db = getDb();

  const filters = disbursementFilters(ctx, q);
  const where = and(...filters);

  /*
   * Aggregated over the WHOLE filtered set, never over the returned page — the
   * manager's APTS and Payment sheets both carry a totals row, and a total that
   * described one page while the header said otherwise is the defect
   * `/api/reports/loans` was rewritten to remove.
   *
   * `::text` and never `::float` (D-068). This is a money column.
   */
  const [summary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      transferAmountTotal: sql<string>`coalesce(sum(${disbursements.amount}),0)::text`,
    })
    .from(disbursements)
    .innerJoin(customers, eq(customers.id, disbursements.customerId))
    .innerJoin(loans, eq(loans.id, disbursements.loanId))
    .leftJoin(branches, eq(branches.id, loans.branchId))
    .leftJoin(areas, eq(areas.id, branches.areaId))
    .where(where);

  const total = summary?.count ?? 0;

  if (q.pageSize === 0 && total > MAINTENANCE_EXPORT_MAX) {
    const message = `That sheet contains ${total.toLocaleString("en-IN")} rows, more than the ${MAINTENANCE_EXPORT_MAX.toLocaleString("en-IN")} that can be exported at once. Narrow the date range.`;
    throw unprocessable(message, [{ path: "pageSize", message }]);
  }

  const rowsQuery = sheetFrom(db)
    .where(where)
    .orderBy(desc(reportedAt), desc(disbursements.code));

  const rows =
    q.pageSize === 0
      ? await rowsQuery
      : await rowsQuery.limit(q.pageSize).offset((q.page - 1) * q.pageSize);

  res.json({
    data: rows,
    summary: {
      count: total,
      transferAmountTotal: summary?.transferAmountTotal ?? "0",
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
}

/* ── THE THREE DISBURSEMENT-BACKED SHEETS ──────────────────────────────────── */

maintenanceRouter.get(
  "/transfer",
  requirePermission(PERMISSIONS.maintenance.view),
  async (req, res, next) => {
    try {
      await runSheet(req, res);
    } catch (error) {
      next(error);
    }
  },
);

maintenanceRouter.get(
  "/apts",
  requirePermission(PERMISSIONS.maintenance.view),
  async (req, res, next) => {
    try {
      await runSheet(req, res);
    } catch (error) {
      next(error);
    }
  },
);

maintenanceRouter.get(
  "/payment",
  requirePermission(PERMISSIONS.maintenance.view),
  async (req, res, next) => {
    try {
      await runSheet(req, res);
    } catch (error) {
      next(error);
    }
  },
);

/* ── THE FVR CHECKLIST ─────────────────────────────────────────────────────── */

/**
 * One row per `verifications` record — the CRM's existing field-verification
 * domain, exposed rather than duplicated. A loan with no verification has no
 * FVR, which is correct: an FVR *is* the field verification.
 *
 * `customerId` is nullable on `verifications`, so the customer is reached
 * through `coalesce(verifications.customer_id, loans.customer_id)`.
 */
const fvrColumns = {
  id: verifications.id,
  loanId: verifications.loanId,
  customerId: sql<string>`coalesce(${verifications.customerId}, ${loans.customerId})`.as(
    "customer_id",
  ),
  bankId: verifications.bankId,
  loanCode: loans.code,
  customerName: customers.name,
  customerMobile: customers.mobile,
  /*
   * "Loan Amount". `amount_approved` when a sanction has been recorded, else
   * `amount_requested` — the precedent `/reports` already uses, kept so the two
   * screens cannot print different figures for the same loan. In this repository
   * `amount_approved` is written only by the loan approve route, so a file that
   * has not been sanctioned reports what was asked for.
   */
  loanAmount: sql<string>`case when ${loans.amountApproved} > 0 then ${loans.amountApproved} else ${loans.amountRequested} end`.as(
    "loan_amount",
  ),
  /** "Customer Profile (Occupation / Business / Employment)". */
  customerProfile: customers.occupation,
  verificationStatus: verifications.status,
  providerName: verifications.providerReference,
  /* The thirteen checklist particulars that needed new columns. */
  fvrDate: verifications.fvrDate,
  takeoverFromLender: verifications.takeoverFromLender,
  fvrDoneByName: verifications.fvrDoneByName,
  fvrDoneByDesignation: verifications.fvrDoneByDesignation,
  houseConfirmation: verifications.houseConfirmation,
  annualIncome: verifications.annualIncome,
  cholaRelationship: verifications.cholaRelationship,
  cholaOutstandingDetails: verifications.cholaOutstandingDetails,
  newKycCustomer: verifications.newKycCustomer,
  /** "Remarks (if Any)" — the existing verification notes column. */
  remarks: verifications.notes,
  zensifyRmSignature: verifications.zensifyRmSignature,
  sharvikaRmSignature: verifications.sharvikaRmSignature,
  cholaSign: verifications.cholaSign,
} as const;

maintenanceRouter.get(
  "/fvr",
  requirePermission(PERMISSIONS.maintenance.view),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const q = sheetQuery.parse(req.query);
      const db = getDb();

      const filters: SQL[] = [isNull(verifications.deletedAt)];
      const scope = bankScope(ctx, verifications.bankId);
      if (scope) filters.push(scope);

      if (q.bankId) {
        assertBankAccess(ctx, q.bankId);
        filters.push(eq(verifications.bankId, q.bankId));
      }
      if (q.customerId) {
        filters.push(
          sql`coalesce(${verifications.customerId}, ${loans.customerId}) = ${q.customerId}`,
        );
      }
      if (q.branchId) filters.push(eq(loans.branchId, q.branchId));
      if (q.assignedUserId) filters.push(eq(loans.assignedUserId, q.assignedUserId));

      const fvrReportedAt = sql`coalesce(${verifications.fvrDate}, ${verifications.createdAt})`;
      if (q.from) filters.push(sql`${fvrReportedAt} >= ${q.from}`);
      if (q.to) filters.push(sql`${fvrReportedAt} < ${dayAfter(q.to)}`);

      if (q.search) {
        const term = `%${q.search}%`;
        const match = or(
          ilike(customers.name, term),
          ilike(loans.code, term),
          ilike(verifications.takeoverFromLender, term),
          ilike(verifications.fvrDoneByName, term),
        );
        if (match) filters.push(match);
      }

      const where = and(...filters);

      const [summary] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(verifications)
        .innerJoin(loans, eq(loans.id, verifications.loanId))
        .leftJoin(
          customers,
          sql`${customers.id} = coalesce(${verifications.customerId}, ${loans.customerId})`,
        )
        .where(where);

      const total = summary?.count ?? 0;

      if (q.pageSize === 0 && total > MAINTENANCE_EXPORT_MAX) {
        const message = `That sheet contains ${total.toLocaleString("en-IN")} rows, more than the ${MAINTENANCE_EXPORT_MAX.toLocaleString("en-IN")} that can be exported at once. Narrow the date range.`;
        throw unprocessable(message, [{ path: "pageSize", message }]);
      }

      const rowsQuery = db
        .select(fvrColumns)
        .from(verifications)
        .innerJoin(loans, eq(loans.id, verifications.loanId))
        .leftJoin(
          customers,
          sql`${customers.id} = coalesce(${verifications.customerId}, ${loans.customerId})`,
        )
        .where(where)
        .orderBy(desc(fvrReportedAt), desc(loans.code));

      const rows =
        q.pageSize === 0
          ? await rowsQuery
          : await rowsQuery.limit(q.pageSize).offset((q.page - 1) * q.pageSize);

      res.json({
        data: rows,
        summary: { count: total },
        meta: {
          page: q.pageSize === 0 ? 1 : q.page,
          pageSize: q.pageSize === 0 ? total : q.pageSize,
          total,
          totalPages: q.pageSize === 0 ? 1 : Math.ceil(total / q.pageSize),
          complete: q.pageSize === 0 || total <= q.pageSize,
          scoped: ctx.bankIds !== null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/* ── MAINTENANCE WRITES ────────────────────────────────────────────────────── */

/**
 * The FVR checklist findings.
 *
 * Every field is optional and nullable — a half-completed checklist is the
 * normal state of a form someone is still filling in, and the manager's own
 * blank sheet is the specification.
 *
 * `patchSchema`, never `.partial()`: zod 4 lets `.default()` survive `.partial()`
 * and the default then gets written over a value the caller never sent
 * (BUG-036).
 */
const fvrMaintenanceInput = z.object({
  fvrDate: z.coerce.date().optional().nullable(),
  takeoverFromLender: z.string().trim().max(160).optional().nullable(),
  fvrDoneByName: z.string().trim().max(160).optional().nullable(),
  fvrDoneByDesignation: z.string().trim().max(120).optional().nullable(),
  houseConfirmation: z.enum(houseConfirmations).optional().nullable(),
  annualIncome: z.coerce.number().min(0).max(1_000_000_000_000).optional().nullable(),
  cholaRelationship: z.enum(fvrYesNo).optional().nullable(),
  cholaOutstandingDetails: z.string().trim().max(500).optional().nullable(),
  newKycCustomer: z.enum(fvrYesNo).optional().nullable(),
  remarks: z.string().trim().max(2000).optional().nullable(),
  /*
   * The three signature lines. Plain text, and that is the whole of it.
   *
   * This system has no electronic-signature workflow, so these record WHAT WAS
   * WRITTEN ON THE SHEET and assert nothing about identity, consent or legal
   * effect. No route treats a non-null value as an approval and no guard reads
   * them — a populated signature line authorises exactly nothing.
   */
  zensifyRmSignature: z.string().trim().max(160).optional().nullable(),
  sharvikaRmSignature: z.string().trim().max(160).optional().nullable(),
  cholaSign: z.string().trim().max(160).optional().nullable(),
});

maintenanceRouter.patch(
  "/fvr/:id",
  requirePermission(PERMISSIONS.maintenance.edit),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      // Parsed INSIDE the handler and AFTER the permission gate — a bare uuid
      // reaching Postgres raises 22P02, which the error handler does not map, so
      // the caller would get a 500 and the server would log the SQL (BUG-017).
      const { id } = idParam.parse(req.params);
      const input = patchSchema(fvrMaintenanceInput).parse(req.body);
      const db = getDb();

      const [before] = await db
        .select()
        .from(verifications)
        .where(and(eq(verifications.id, id), isNull(verifications.deletedAt)))
        .limit(1);
      if (!before) throw notFound("Verification not found");
      // Re-asserted on the ROW's own bank, not on anything the caller sent.
      assertBankAccess(ctx, before.bankId);

      const { remarks, annualIncome, ...rest } = input;

      const after = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(verifications)
          .set({
            ...rest,
            // The sheet calls it Remarks; the column has always been `notes`.
            ...(remarks !== undefined ? { notes: remarks } : {}),
            // numeric(16,2) round-trips as a string (D-068).
            ...(annualIncome !== undefined
              ? { annualIncome: annualIncome === null ? null : String(annualIncome) }
              : {}),
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(eq(verifications.id, id))
          .returning();

        await recordAudit(tx as never, ctx, req, {
          action: "updated",
          recordType: "verification",
          recordId: id,
          bankId: before.bankId,
          summary: `Updated the FVR checklist on verification ${id}`,
          changes: diff(
            before as unknown as Record<string, unknown>,
            row as unknown as Record<string, unknown>,
          ),
        });

        return row;
      });

      res.json({ data: after });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * A loan's branch and BT lead id — the two Transfer-sheet columns that belong to
 * the file rather than to the payment.
 *
 * This route writes THOSE TWO COLUMNS AND NOTHING ELSE. It is not a general loan
 * editor: `PATCH /api/loans/:id` keeps that job, keeps its own permission, and
 * keeps refusing `status` and `amountApproved` under D-056.
 */
const loanMaintenanceInput = z.object({
  branchId: uuidField.optional().nullable(),
  /** Issued outside this system (sample: `BTOMKA250626053704`). Never generated
   *  here — a synthesised external reference is one no other system knows. */
  btLeadId: z.string().trim().max(64).optional().nullable(),
});

maintenanceRouter.patch(
  "/loan/:id",
  requirePermission(PERMISSIONS.maintenance.edit),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const { id } = idParam.parse(req.params);
      const input = patchSchema(loanMaintenanceInput).parse(req.body);
      const db = getDb();

      const [before] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, id), isNull(loans.deletedAt)))
        .limit(1);
      if (!before) throw notFound("Loan not found");
      assertBankAccess(ctx, before.bankId);

      if (input.branchId) {
        const [branch] = await db
          .select({ id: branches.id, status: branches.status })
          .from(branches)
          .where(and(eq(branches.id, input.branchId), isNull(branches.deletedAt)))
          .limit(1);
        if (!branch) {
          const message = "That branch does not exist.";
          throw unprocessable(message, [{ path: "branchId", message }]);
        }
        if (branch.status !== "Active") {
          const message = "That branch is Inactive and cannot be assigned to a file.";
          throw unprocessable(message, [{ path: "branchId", message }]);
        }
      }

      const after = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(loans)
          .set({ ...input, updatedAt: new Date(), updatedBy: ctx.userId })
          .where(eq(loans.id, id))
          .returning();

        await recordAudit(tx as never, ctx, req, {
          action: "updated",
          recordType: "loan",
          recordId: id,
          bankId: before.bankId,
          summary: `Updated maintenance fields on loan ${before.code}`,
          changes: diff(
            before as unknown as Record<string, unknown>,
            row as unknown as Record<string, unknown>,
          ),
        });

        return row;
      });

      res.json({ data: after });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The Payment sheet's `Payment Status`.
 *
 * ── THIS ROUTE CANNOT MOVE MONEY ────────────────────────────────────────────
 *
 * It writes `disbursements.payment_status` and NOTHING else. It does not touch
 * `status`, `utr`, `amount`, `approved_by`, `approved_at` or `disbursed_on`; it
 * runs no transition check because this column has no transitions; and nothing
 * downstream reads it. Setting it to `Received` approves nothing, credits
 * nothing and posts nothing to the ledger.
 *
 * The disbursement's own state machine is untouched and unreachable from here —
 * `POST /api/disbursements/:id/approve` remains the only way to mark money
 * Credited, and it still refuses without a UTR.
 */
const paymentMaintenanceInput = z.object({
  paymentStatus: z.enum(paymentStatuses).optional().nullable(),
});

maintenanceRouter.patch(
  "/payment/:id",
  requirePermission(PERMISSIONS.maintenance.edit),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const { id } = idParam.parse(req.params);
      const input = patchSchema(paymentMaintenanceInput).parse(req.body);
      const db = getDb();

      const [before] = await db
        .select()
        .from(disbursements)
        .where(and(eq(disbursements.id, id), isNull(disbursements.deletedAt)))
        .limit(1);
      if (!before) throw notFound("Disbursement not found");
      assertBankAccess(ctx, before.bankId);

      const after = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(disbursements)
          .set({ ...input, updatedAt: new Date(), updatedBy: ctx.userId })
          .where(eq(disbursements.id, id))
          .returning();

        await recordAudit(tx as never, ctx, req, {
          action: "updated",
          recordType: "disbursement",
          recordId: id,
          bankId: before.bankId,
          summary: `Set the manager payment status on disbursement ${before.code}`,
          changes: diff(
            before as unknown as Record<string, unknown>,
            row as unknown as Record<string, unknown>,
          ),
        });

        return row;
      });

      res.json({ data: after });
    } catch (error) {
      next(error);
    }
  },
);

/* ── REGION ▸ AREA ▸ BRANCH MASTER DATA ────────────────────────────────────── */

/**
 * Reading the hierarchy needs only `maintenance.view` — the filter dropdowns on
 * every sheet are built from it. Writing needs `maintenance.manage_locations`.
 *
 * These lists are NOT bank-scoped. `branches.bank_id` is nullable by design, and
 * `bankScope` filters with `inArray`, which never matches NULL — scoping here
 * would hide every branch that has no lender recorded from every scoped user
 * (the D-084 defect). Nothing confidential is exposed: a branch row is a place
 * name. Tenant isolation is enforced where it belongs, on the operational rows,
 * whose `bank_id` is NOT NULL and does go through `bankScope`.
 */
maintenanceRouter.get(
  "/regions",
  requirePermission(PERMISSIONS.maintenance.view),
  async (_req, res, next) => {
    try {
      const rows = await getDb()
        .select({
          id: regions.id,
          name: regions.name,
          status: regions.status,
        })
        .from(regions)
        .where(isNull(regions.deletedAt))
        .orderBy(asc(regions.name));
      res.json({ data: rows, meta: { total: rows.length } });
    } catch (error) {
      next(error);
    }
  },
);

maintenanceRouter.get(
  "/areas",
  requirePermission(PERMISSIONS.maintenance.view),
  async (req, res, next) => {
    try {
      const q = z.object({ regionId: uuidField.optional() }).parse(req.query);
      const filters: SQL[] = [isNull(areas.deletedAt)];
      if (q.regionId) filters.push(eq(areas.regionId, q.regionId));
      const rows = await getDb()
        .select({
          id: areas.id,
          regionId: areas.regionId,
          regionName: regions.name,
          name: areas.name,
          status: areas.status,
        })
        .from(areas)
        .innerJoin(regions, eq(regions.id, areas.regionId))
        .where(and(...filters))
        .orderBy(asc(regions.name), asc(areas.name));
      res.json({ data: rows, meta: { total: rows.length } });
    } catch (error) {
      next(error);
    }
  },
);

maintenanceRouter.get(
  "/branches",
  requirePermission(PERMISSIONS.maintenance.view),
  async (req, res, next) => {
    try {
      const q = z
        .object({ areaId: uuidField.optional(), regionId: uuidField.optional() })
        .parse(req.query);
      const filters: SQL[] = [isNull(branches.deletedAt)];
      if (q.areaId) filters.push(eq(branches.areaId, q.areaId));
      if (q.regionId) filters.push(eq(areas.regionId, q.regionId));
      const rows = await getDb()
        .select({
          id: branches.id,
          areaId: branches.areaId,
          areaName: areas.name,
          regionId: areas.regionId,
          regionName: regions.name,
          bankId: branches.bankId,
          bankName: banks.name,
          name: branches.name,
          status: branches.status,
        })
        .from(branches)
        .innerJoin(areas, eq(areas.id, branches.areaId))
        .innerJoin(regions, eq(regions.id, areas.regionId))
        .leftJoin(banks, eq(banks.id, branches.bankId))
        .where(and(...filters))
        .orderBy(asc(regions.name), asc(areas.name), asc(branches.name));
      res.json({ data: rows, meta: { total: rows.length } });
    } catch (error) {
      next(error);
    }
  },
);

const locationStatusInput = z.enum(["Active", "Inactive"]);

maintenanceRouter.post(
  "/regions",
  requirePermission(PERMISSIONS.maintenance.manageLocations),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const input = z
        .object({ name: z.string().trim().min(1).max(120), status: locationStatusInput.default("Active") })
        .parse(req.body);
      const db = getDb();

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(regions)
          .values({ ...input, createdBy: ctx.userId, updatedBy: ctx.userId })
          .returning();
        await recordAudit(tx as never, ctx, req, {
          action: "created",
          recordType: "region",
          recordId: row!.id,
          bankId: null,
          summary: `Created region ${row!.name}`,
        });
        return row;
      });

      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);

maintenanceRouter.post(
  "/areas",
  requirePermission(PERMISSIONS.maintenance.manageLocations),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const input = z
        .object({
          regionId: uuidField,
          name: z.string().trim().min(1).max(120),
          status: locationStatusInput.default("Active"),
        })
        .parse(req.body);
      const db = getDb();

      const [region] = await db
        .select({ id: regions.id })
        .from(regions)
        .where(and(eq(regions.id, input.regionId), isNull(regions.deletedAt)))
        .limit(1);
      if (!region) {
        const message = "That region does not exist.";
        throw unprocessable(message, [{ path: "regionId", message }]);
      }

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(areas)
          .values({ ...input, createdBy: ctx.userId, updatedBy: ctx.userId })
          .returning();
        await recordAudit(tx as never, ctx, req, {
          action: "created",
          recordType: "area",
          recordId: row!.id,
          bankId: null,
          summary: `Created area ${row!.name}`,
        });
        return row;
      });

      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);

maintenanceRouter.post(
  "/branches",
  requirePermission(PERMISSIONS.maintenance.manageLocations),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const input = z
        .object({
          areaId: uuidField,
          bankId: uuidField.optional().nullable(),
          name: z.string().trim().min(1).max(120),
          status: locationStatusInput.default("Active"),
        })
        .parse(req.body);
      const db = getDb();

      const [area] = await db
        .select({ id: areas.id })
        .from(areas)
        .where(and(eq(areas.id, input.areaId), isNull(areas.deletedAt)))
        .limit(1);
      if (!area) {
        const message = "That area does not exist.";
        throw unprocessable(message, [{ path: "areaId", message }]);
      }
      // A branch may name a lender only if the caller may see that lender.
      if (input.bankId) assertBankAccess(ctx, input.bankId);

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(branches)
          .values({ ...input, createdBy: ctx.userId, updatedBy: ctx.userId })
          .returning();
        await recordAudit(tx as never, ctx, req, {
          action: "created",
          recordType: "branch",
          recordId: row!.id,
          bankId: input.bankId ?? null,
          summary: `Created branch ${row!.name}`,
        });
        return row;
      });

      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);
