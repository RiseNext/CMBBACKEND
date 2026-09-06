import { Router } from "express";
import { and, count, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Database } from "../db/index.js";
import {
  banks,
  customers,
  permissions,
  rolePermissions,
  teams,
  userBankAccess,
  users,
} from "../db/schema/index.js";
import { conflict, notFound, unprocessable } from "../lib/errors.js";
import { patchSchema } from "../lib/zod.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { peppered } from "../lib/password.js";
import { env } from "../config/env.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";
import { softDelete } from "../services/recycle-bin.js";
import { nextResourceCode } from "./scoped-resource.js";

export const customersRouter = Router();
customersRouter.use(requireAuth);

const aadhaarSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s|-/g, ""))
  .refine((v) => v === "" || /^\d{12}$/.test(v), "Aadhaar must be 12 digits");

const customerInput = z.object({
  bankId: z.string().uuid(),
  /** Required by the brief. Unique per bank, case-insensitively. */
  bankReferenceId: z.string().trim().min(1).max(64),

  name: z.string().trim().min(2).max(160),
  fatherName: z.string().trim().max(160).optional().nullable(),
  motherName: z.string().trim().max(160).optional().nullable(),
  dob: z.coerce.date().optional().nullable(),
  gender: z.enum(["Male", "Female", "Other"]).optional().nullable(),
  maritalStatus: z.enum(["Single", "Married"]).optional().nullable(),
  occupation: z.string().trim().max(120).optional().nullable(),
  monthlyIncome: z.coerce.number().min(0).max(1_000_000_000).default(0),

  mobile: z.string().trim().regex(/^\d{10}$/, "Mobile must be 10 digits"),
  altMobile: z.string().trim().regex(/^\d{10}$/).optional().nullable().or(z.literal("")),
  email: z.string().trim().email().max(255).optional().nullable().or(z.literal("")),

  address: z.string().trim().max(400).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  state: z.string().trim().max(120).optional().nullable(),
  pincode: z.string().trim().regex(/^\d{6}$/).optional().nullable().or(z.literal("")),

  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN format is invalid")
    .optional()
    .nullable()
    .or(z.literal("")),
  aadhaar: aadhaarSchema.optional().nullable(),

  kyc: z.enum(["Verified", "Pending", "Rejected"]).default("Pending"),
  cibil: z.coerce.number().int().min(300).max(900).optional().nullable(),

  accountNo: z.string().trim().max(40).optional().nullable(),
  ifsc: z.string().trim().toUpperCase().max(20).optional().nullable(),
  branch: z.string().trim().max(120).optional().nullable(),

  assignedUserId: z.string().uuid().optional().nullable(),
  assignedTeamId: z.string().uuid().optional().nullable(),
  status: z.enum(["Active", "Follow Up", "Closed"]).default("Active"),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  search: z.string().trim().max(120).optional(),
  bankId: z.string().uuid().optional(),
  status: z.enum(["Active", "Follow Up", "Closed"]).optional(),
  /**
   * Mirrors `status` exactly. Added for Task 4.5 (D-051 constraint 4): once the
   * table pages server-side, a client-only KYC filter reports "0 records match"
   * while the rejected customers sit on page 3.
   */
  kyc: z.enum(["Verified", "Pending", "Rejected"]).optional(),
});

/**
 * The `:id` path segment — BUG-017.
 *
 * `customers.id` is a `uuid` column, so an unvalidated segment reaches Postgres
 * and raises `22P02 invalid_text_representation`. `middleware/error-handler.ts`
 * maps only `23505` and `23503`, so that fell through to the terminal branch:
 * the caller got a **500**, and the server wrote the SQL, the bound parameters
 * and a stack trace to the log on every mistyped URL.
 *
 * Validating here rather than centrally is deliberate, and both halves matter:
 *
 * - **Not in the error handler.** `22P02` is `invalid_text_representation`, not
 *   "bad uuid" — it also fires on integer, numeric, boolean and json input. It
 *   is raised by `services/access.ts:48` too, on *every* request, if a token is
 *   ever minted with a non-uuid `sub`. Mapping it globally would turn that
 *   total outage into a polite 4xx that `error-handler.ts:58` does not even
 *   log. `tests/cors.test.ts:211` already pins the opposite commitment.
 * - **Not a `router.param()` hook.** Those run *before* the per-route
 *   `requirePermission`, which would turn today's 403 into a 422 and leak
 *   input-shape feedback to callers who may not touch this resource at all.
 *
 * So it is parsed inside each handler, after the permission gate. The object
 * form is required: `z.object({id})` reports `path: "id"`, whereas a bare
 * `z.string().uuid()` reports `path: ""`.
 *
 * Accepted narrowing: Postgres also accepts unhyphenated (`054bfa18ca47…`) and
 * brace-wrapped (`{054bfa18-…}`) uuids, which now return 422. Nothing emits
 * them — every customer link in the frontend uses `id`/`customerId` straight
 * from this API, which returns the canonical form. See DECISIONS.md D-021.
 *
 * This covers the three customer routes only. The same pattern exists on 45
 * other endpoints (BUG-017) and in the `filterable` query loop (BUG-035); both
 * are out of scope here and recorded, not silently fixed.
 */
const idParam = z.object({ id: z.string().uuid() });

/** Aadhaar never lands in a column in the clear. See README > Data protection. */
function aadhaarFields(raw: string | null | undefined) {
  if (!raw) return { aadhaarHash: null, aadhaarLast4: null };
  return {
    aadhaarHash: peppered(raw, env().AADHAAR_PEPPER),
    aadhaarLast4: raw.slice(-4),
  };
}

/**
 * `CUS-10001`, `CUS-10002`, … — Task 4.9 / BUG-011 / D-050.
 *
 * Was `10000 + count(*) + 1`, which is wrong in three separate ways: a count
 * goes DOWN after a permanent delete so the next create repeats an issued code;
 * two concurrent creates read the same count; and the Excel importer counted the
 * same table independently, so the route and the importer collided with each
 * other with no delete and no race required.
 *
 * All of that now lives in ONE place — `nextResourceCode` in
 * `scoped-resource.ts`, backed by the `customer_code_seq` sequence created and
 * seeded by `drizzle/0006_code_sequences.sql`. The importer calls the same
 * function with its transaction handle, so there is one series, not two. See the
 * long note above `CODE_SEQUENCES` for why the missing `deleted_at` filter was
 * never the bug.
 */
const nextCustomerCode = (): Promise<string> => nextResourceCode("CUS");

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ASSIGNMENT VALIDATION — Task 4.7, DECISIONS.md D-047 and D-048
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **This is a data-integrity fix, not a confidentiality one, and the distinction
 * is deliberate rather than modest.** Traced end to end there is no
 * assignment-driven read path for customers: `listQuery` above exposes no
 * `assignedUserId` filter, there is no "assigned to me" endpoint, and every
 * customer read — list, detail, patch, delete — still goes through `bankScope`.
 * Assigning a customer to an out-of-bank user therefore grants that user
 * **nothing**. Do not describe this as an IDOR fix; it is not one.
 *
 * What it actually fixes is a referential-integrity hole with a misleading
 * symptom. Both columns are real foreign keys (`db/schema/domain.ts:120-121`),
 * so a nonexistent UUID reached Postgres, raised `23503`, and came back as the
 * 409 "That record is still referenced by other records"
 * (`middleware/error-handler.ts:77-82`) — an error about the wrong direction of
 * the relationship, on a request the user could not correct because nothing
 * named the offending field.
 *
 * ── Why the two fields are checked differently ──────────────────────────────
 *
 * **Teams (D-047): existence and liveness ONLY.** `teams` has no bank column and
 * no join table to banks (`db/schema/identity.ts:190-213`) — "bank-scope
 * membership" for a team is undefined in this data model. The roadmap row's
 * suggested `assertSameBank` helper cannot apply: its entire mechanism is
 * `table.bankId`. Inventing `teams.bank_id`, or deriving a team's bank from its
 * members, would be a new product policy invented inside an "S" row, and teams
 * span banks by construction. The asymmetry with users is intentional and
 * documented: only one of the two has a bank.
 *
 * **Users (D-048): existence, liveness AND bank membership — but an
 * unrestricted assignee passes.** The obvious rule, "require a `user_bank_access`
 * row for the customer's bank", refuses assigning a customer to any Admin or
 * Super Admin. `loadAuthContext` only reads `user_bank_access` when
 * `system.access_all_banks` is ABSENT (`services/access.ts:70-77`); a holder has
 * `bankIds === null` and typically **zero rows** in that table, and
 * `assertBankAccess` encodes exactly that with `if (ctx.bankIds === null)
 * return;` (`:128-134`). Zero rows means "unrestricted", never "no access". The
 * check below mirrors those two functions statement for statement rather than
 * writing a second, stricter answer to the same question.
 *
 * ── Deliberately NOT checked ────────────────────────────────────────────────
 *
 * `users.status` and `teams.status`. D-048 requires existence and liveness;
 * refusing to assign work to a temporarily Inactive colleague is a product
 * policy no decision authorises, and it would break the ordinary case of a
 * customer already assigned to someone on leave. Soft-deleted rows ARE refused —
 * that is liveness, and a soft-deleted assignee is on its way out of the table.
 *
 * ── The error contract ──────────────────────────────────────────────────────
 *
 * 422 with `details: [{ path, message }]`, `path` being exactly
 * `"assignedUserId"` or `"assignedTeamId"`, so D-031's `serverFieldIssues`
 * pins the message to the control that names it. A bare 400 (what
 * `assertSameBank` raises) would land in `formLevelError` and the user would
 * never learn which field is wrong. The status comes from `unprocessable`, so
 * the code is `unprocessable_entity` rather than the ZodError branch's
 * `validation_failed`; D-031 is explicit that the frontend discriminates on the
 * payload's SHAPE, not on the status or the code, and this is a semantic
 * cross-record refusal rather than a schema-shape failure. Both fields are
 * reported together, in one response, for the same reason a zod parse reports
 * every issue at once.
 */
interface AssignmentIssue {
  path: "assignedUserId" | "assignedTeamId";
  message: string;
}

/**
 * True when the assignee holds `system.access_all_banks` — the `bankIds ===
 * null` case of `loadAuthContext` (`services/access.ts:71`), evaluated for
 * another user rather than the caller.
 *
 * `loadAuthContext` itself is deliberately not reused: its three session gates
 * raise `unauthorized` / `account_inactive` / `role_disabled`, which describe
 * the CALLER's session. Applying them to an assignee would answer "this
 * customer's assignee does not exist" with a 401 that logs the caller out.
 */
async function assigneeIsUnrestricted(db: Database, roleId: string): Promise<boolean> {
  const [row] = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(
      and(
        eq(rolePermissions.roleId, roleId),
        eq(permissions.key, PERMISSIONS.system.accessAllBanks),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Validates whichever of `assignedUserId` / `assignedTeamId` the request
 * actually supplied, against the bank the customer will belong to.
 *
 * `undefined` (omitted) and `null` (explicitly cleared) are both skipped: an
 * unassignment has nothing to validate, and a name-only PATCH must not be made
 * to carry assignment fields it never mentioned.
 */
async function assertAssignable(
  db: Database,
  bankId: string,
  input: { assignedUserId?: string | null; assignedTeamId?: string | null },
): Promise<void> {
  const issues: AssignmentIssue[] = [];

  if (input.assignedUserId) {
    const [assignee] = await db
      .select({ id: users.id, roleId: users.roleId })
      .from(users)
      .where(and(eq(users.id, input.assignedUserId), isNull(users.deletedAt)))
      .limit(1);

    if (!assignee) {
      issues.push({ path: "assignedUserId", message: "That user does not exist" });
    } else if (!(await assigneeIsUnrestricted(db, assignee.roleId))) {
      // Only reached when the assignee is bank-scoped, exactly as
      // `loadAuthContext` only reads this table when the permission is absent.
      const [grant] = await db
        .select({ bankId: userBankAccess.bankId })
        .from(userBankAccess)
        .where(
          and(eq(userBankAccess.userId, assignee.id), eq(userBankAccess.bankId, bankId)),
        )
        .limit(1);

      if (!grant) {
        issues.push({
          path: "assignedUserId",
          message: "That user is not assigned to this customer's bank",
        });
      }
    }
  }

  if (input.assignedTeamId) {
    // Existence and liveness only — see D-047 above. No bank check exists to
    // make, and none is invented here.
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, input.assignedTeamId), isNull(teams.deletedAt)))
      .limit(1);

    if (!team) issues.push({ path: "assignedTeamId", message: "That team does not exist" });
  }

  if (issues.length > 0) throw unprocessable("The submitted data is not valid", issues);
}

/**
 * EVERY COLUMN A CLIENT MAY SEE — SEC-007, Task 13.4.
 *
 * `aadhaar_hash` is **absent, and that is the entire point.** Four call sites
 * in this file used bare `.select()` and `.returning()`, and Drizzle returns
 * every column for both — so the peppered digest of a customer's Aadhaar number
 * was in the list response, the detail response, the create response and the
 * update response. Any authenticated user with `customers.view` received it,
 * and it reached the browser, its cache and any log that captured a response
 * body.
 *
 * It is a projection rather than four hand-written column lists so the omission
 * has ONE place to be got right. A `.select()` added tomorrow that forgets this
 * constant reintroduces the finding; `customers-projection.test.ts` asserts
 * every response shape against this list, so the test fails rather than the
 * leak going unnoticed.
 *
 * `aadhaarLast4` IS included, deliberately. It is what the UI displays to
 * confirm identity, four digits carry no reconstruction risk on their own, and
 * removing it would break the screen without improving anything.
 *
 * When a column is added to the `customers` table it must be added here too, or
 * it will simply be missing from every response — a visible failure, which is
 * the correct direction for this to fail in.
 */
export const CUSTOMER_COLUMNS = {
  id: customers.id,
  code: customers.code,
  bankId: customers.bankId,
  bankReferenceId: customers.bankReferenceId,
  name: customers.name,
  fatherName: customers.fatherName,
  motherName: customers.motherName,
  dob: customers.dob,
  gender: customers.gender,
  maritalStatus: customers.maritalStatus,
  occupation: customers.occupation,
  monthlyIncome: customers.monthlyIncome,
  mobile: customers.mobile,
  altMobile: customers.altMobile,
  email: customers.email,
  address: customers.address,
  city: customers.city,
  state: customers.state,
  pincode: customers.pincode,
  pan: customers.pan,
  aadhaarLast4: customers.aadhaarLast4,
  kyc: customers.kyc,
  cibil: customers.cibil,
  accountNo: customers.accountNo,
  ifsc: customers.ifsc,
  branch: customers.branch,
  assignedUserId: customers.assignedUserId,
  assignedTeamId: customers.assignedTeamId,
  status: customers.status,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
  createdBy: customers.createdBy,
  updatedBy: customers.updatedBy,
  deletedAt: customers.deletedAt,
  deletedBy: customers.deletedBy,
  purgeAfter: customers.purgeAfter,
} as const;

customersRouter.get("/", requirePermission(PERMISSIONS.customers.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const query = listQuery.parse(req.query);
    const db = getDb();

    const filters: SQL[] = [isNull(customers.deletedAt)];

    // Server-side scoping. Note this runs whether or not the client sent a
    // bankId filter — a filter can narrow the scope, never widen it.
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    if (query.bankId) {
      assertBankAccess(ctx, query.bankId);
      filters.push(eq(customers.bankId, query.bankId));
    }
    if (query.status) filters.push(eq(customers.status, query.status));
    if (query.kyc) filters.push(eq(customers.kyc, query.kyc));
    if (query.search) {
      const needle = `%${query.search}%`;
      // `pan` joined this list in Task 4.5 (D-053). The list page's placeholder
      // has always promised PAN search, and until 4.5 the promise was honoured
      // client-side over the ≤100 loaded rows. Moving search to the server would
      // otherwise have silently dropped a real capability — the exact "quietly
      // changed contract" D-053 forbids. It is one more `ilike` in the same
      // disjunction, so it narrows nothing and widens no scope: the bank filter
      // is ANDed ahead of it at :138-144.
      //
      // `id` is deliberately NOT searchable. It is a `uuid` column, so `ilike`
      // cannot take it without a `::text` cast that no index could serve, and
      // `code`/`bankReferenceId` are the identifiers this business actually
      // quotes. The placeholder names what is searched and no longer says "ID".
      const match = or(
        ilike(customers.name, needle),
        ilike(customers.mobile, needle),
        ilike(customers.code, needle),
        ilike(customers.bankReferenceId, needle),
        ilike(customers.pan, needle),
      );
      if (match) filters.push(match);
    }

    const where = and(...filters);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(customers).where(where);

    const rows = await db
      .select(CUSTOMER_COLUMNS)
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    res.json({
      data: rows,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  } catch (error) {
    next(error);
  }
});

customersRouter.get("/:id", requirePermission(PERMISSIONS.customers.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const { id } = idParam.parse(req.params);
    const filters: SQL[] = [eq(customers.id, id), isNull(customers.deletedAt)];
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    const [row] = await getDb()
      .select(CUSTOMER_COLUMNS)
      .from(customers)
      .where(and(...filters))
      .limit(1);

    // Out of scope and non-existent are indistinguishable by design.
    if (!row) throw notFound("Customer not found");
    res.json({ data: row });
  } catch (error) {
    next(error);
  }
});

customersRouter.post("/", requirePermission(PERMISSIONS.customers.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = customerInput.parse(req.body);
    const db = getDb();

    // An executive cannot create a customer under a bank they are not assigned
    // to, even by hand-crafting the payload.
    assertBankAccess(ctx, input.bankId);

    const [bank] = await db
      .select({ id: banks.id, name: banks.name })
      .from(banks)
      .where(and(eq(banks.id, input.bankId), isNull(banks.deletedAt)))
      .limit(1);
    if (!bank) throw notFound("Bank not found");

    // After the bank is known to exist: an assignment can only be judged
    // against a real bank, and "Bank not found" is the more fundamental error.
    await assertAssignable(db, input.bankId, input);

    const { aadhaar, ...rest } = input;
    const [created] = await db
      .insert(customers)
      .values({
        ...rest,
        code: await nextCustomerCode(),
        monthlyIncome: String(input.monthlyIncome),
        email: input.email || null,
        altMobile: input.altMobile || null,
        pan: input.pan || null,
        pincode: input.pincode || null,
        ...aadhaarFields(aadhaar),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning(CUSTOMER_COLUMNS);

    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "customer",
      recordId: created?.id,
      bankId: input.bankId,
      summary: `Created customer ${created?.name} (${bank.name} / ${input.bankReferenceId})`,
    });

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

customersRouter.patch("/:id", requirePermission(PERMISSIONS.customers.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    // Before the body parse: a malformed id is the more fundamental error, and
    // reporting `path: "name"` for a request whose id was never valid is noise.
    const { id } = idParam.parse(req.params);
    // patchSchema, not .partial(): `monthlyIncome`, `kyc` and `status` carry
    // defaults, and `...rest` is spread wholesale — an unrelated edit would
    // otherwise revert KYC from Verified to Pending (BUG-036).
    const input = patchSchema(customerInput).parse(req.body);
    const db = getDb();
    const { aadhaar, monthlyIncome, ...rest } = input;

    const filters: SQL[] = [eq(customers.id, id), isNull(customers.deletedAt)];
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    const [before] = await db
      .select(CUSTOMER_COLUMNS)
      .from(customers)
      .where(and(...filters))
      .limit(1);
    if (!before) throw notFound("Customer not found");

    // Moving a customer to a different bank requires access to the destination
    // too, otherwise scoping could be escaped by reassignment.
    if (input.bankId && input.bankId !== before.bankId) {
      assertBankAccess(ctx, input.bankId);
    }

    /*
     * Validated against the bank the customer will have AFTER this request, so
     * a payload that moves the customer and reassigns it in one call is judged
     * on the destination rather than the origin.
     *
     * Only fields the payload actually supplies are checked. A `bankId`-only
     * move can therefore leave an existing assignee out of the new bank —
     * recorded rather than fixed, because refusing an otherwise valid move over
     * a field the caller never mentioned is a policy no decision authorises,
     * and D-052 keeps `bankId` out of the edit dialog anyway.
     */
    await assertAssignable(db, input.bankId ?? before.bankId, input);

    const [after] = await db
      .update(customers)
      .set({
        ...rest,
        ...(monthlyIncome !== undefined ? { monthlyIncome: String(monthlyIncome) } : {}),
        ...(aadhaar !== undefined ? aadhaarFields(aadhaar) : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(customers.id, id))
      .returning(CUSTOMER_COLUMNS);

    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "customer",
      recordId: id,
      bankId: after?.bankId,
      summary: `Updated customer ${after?.name}`,
      changes: diff(before as Record<string, unknown>, after as Record<string, unknown>),
    });

    res.json({ data: after });
  } catch (error) {
    next(error);
  }
});

customersRouter.delete("/:id", requirePermission(PERMISSIONS.customers.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const { id } = idParam.parse(req.params);

    const filters: SQL[] = [eq(customers.id, id), isNull(customers.deletedAt)];
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    const [row] = await getDb()
      .select({ id: customers.id })
      .from(customers)
      .where(and(...filters))
      .limit(1);
    if (!row) throw notFound("Customer not found");

    await softDelete(getDb(), ctx, req, "customer", id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/**
 * Pre-flight check used by the create form and by Excel import validation, so
 * the user learns about a clashing reference before submitting 500 rows.
 */
customersRouter.get(
  "/check/reference",
  requirePermission(PERMISSIONS.customers.view),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const params = z
        .object({ bankId: z.string().uuid(), bankReferenceId: z.string().trim().min(1) })
        .parse(req.query);

      assertBankAccess(ctx, params.bankId);

      const [existing] = await getDb()
        .select({ id: customers.id, code: customers.code })
        .from(customers)
        .where(
          and(
            eq(customers.bankId, params.bankId),
            ilike(customers.bankReferenceId, params.bankReferenceId),
            isNull(customers.deletedAt),
          ),
        )
        .limit(1);

      if (existing) {
        throw conflict("This Bank Reference ID is already used for the selected bank", {
          existingCustomerCode: existing.code,
        });
      }
      res.json({ available: true });
    } catch (error) {
      next(error);
    }
  },
);
