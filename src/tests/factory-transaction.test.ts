import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { auditLogs, bankOrders, customers, loans } from "../db/schema/index.js";
import { createScopedResource } from "../modules/scoped-resource.js";
import { errorHandler } from "../middleware/error-handler.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { z } from "zod";

/**
 * F1 — THE FACTORY TRANSACTION EXTENSION
 * DECISIONS.md D-062 · PRODUCTION_ROADMAP.md "PHASE 6–10 PREREQUISITE"
 *
 * Three defects in `createScopedResource`, one task:
 *
 *   1. **PATCH was not transactional** (F1-a). The update and its audit row were
 *      two autocommitted statements, so a failed audit left a mutated record
 *      with no history of the mutation. Group A.
 *   2. **APPROVE was not transactional either, and had no hook** (F1-a / F1-b).
 *      Same split write — on the one route in the system whose entire purpose is
 *      to record that something was approved — and nowhere for 8.8's settlement
 *      chain to run. Groups B and C.
 *   3. **The machine could only ever guard a column called `status`** (F1-c).
 *      `bank_orders` has two workflow columns, and the one a stage move writes
 *      is not `status`; bank orders also have **no approve route**, so PATCH is
 *      their only transition point. Group D.
 *
 * ⚠️ **Group E is the compatibility group and is the reason this task is safe.**
 * Every field F1 adds is opt-in. A resource that configures none of them must
 * behave exactly as it did before — including the refusal *wording*, which
 * `loan-state-machine.test.ts` asserts on.
 *
 * **The fixture below is a TEST resource, not production configuration.** It is
 * a second router over `bank_orders` that opts into `transitionColumn`,
 * `afterApprove` and an approve route, none of which the real `bankOrdersRouter`
 * has. Wiring the real one is roadmap 6.1 and is deliberately not done here.
 */

let ctx: TestContext;
let testApp: Express;
let bareApp: Express;
let bank: { id: string; code: string };
let loanId: string;
let customerId: string;
let superToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/* ── the fixture's controllable hook ────────────────────────────────────── */

interface HookCall {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  input: { status: string; notes?: string };
  sawTransactionHandle: boolean;
}

let hookMode: "off" | "record" | "write-then-throw" | "throw" = "off";
let hookCalls: HookCall[] = [];

/**
 * The stage machine from BUSINESS_FLOW.md §3.3 — forward exactly one step.
 * Ratified in Wave 0; ENFORCED by roadmap 6.1, not by this test. The map lives
 * here only so F1-c has a non-`status` machine to exercise.
 */
const STAGE_TRANSITIONS: Record<string, readonly string[]> = {
  Login: ["Credit Check"],
  "Credit Check": ["Field Verification"],
  "Field Verification": ["Sanction"],
  Sanction: ["Disbursal Queue"],
  "Disbursal Queue": [],
};

const STAGES = [
  "Login",
  "Credit Check",
  "Field Verification",
  "Sanction",
  "Disbursal Queue",
] as const;

const testOrdersRouter = createScopedResource({
  table: bankOrders,
  recordType: "bank_order",
  permissions: {
    view: PERMISSIONS.bankOrders.view,
    create: PERMISSIONS.bankOrders.create,
    edit: PERMISSIONS.bankOrders.edit,
    // The real router configures no `approve`, so no approve route is emitted
    // for it. The fixture needs one to exercise F1-a and F1-b.
    approve: PERMISSIONS.bankOrders.edit,
  },
  codePrefix: "BO",
  createSchema: z.object({
    loanId: z.string().uuid(),
    bankId: z.string().uuid(),
    customerId: z.string().uuid(),
    stage: z.enum(STAGES).default("Login"),
    status: z.enum(["In Progress", "On Hold", "Cleared", "Returned"]).default("In Progress"),
    officer: z.string().trim().max(120).optional().nullable(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  }),
  // F1-c — the machine governs `stage`, not `status`.
  transitionColumn: "stage",
  allowedStatuses: STAGES,
  allowedTransitions: STAGE_TRANSITIONS,
  initialStatuses: ["Login"],
  // F1-b
  async afterApprove(before, after, { tx, input }) {
    if (hookMode === "off") return;

    hookCalls.push({
      before,
      after,
      input,
      // A transaction handle has no `$client`; the base handle does. This is how
      // the test proves the hook was handed `tx` and not `getDb()` — D-032.
      sawTransactionHandle: !("$client" in (tx as object)),
    });

    if (hookMode === "write-then-throw") {
      // A write the hook makes must be undone with everything else.
      await tx
        .update(bankOrders)
        .set({ officer: "written-by-hook" })
        .where(eq(bankOrders.id, after.id as string));
      throw new Error("afterApprove refused this approval");
    }

    if (hookMode === "throw") throw new Error("afterApprove refused this approval");
  },
});

/**
 * The compatibility control: the same table, opting into NONE of F1's fields.
 * Group E asserts against this rather than against whichever production router
 * happens to be unconfigured — so the guarantee survives later phases.
 */
const bareOrdersRouter = createScopedResource({
  table: bankOrders,
  recordType: "bank_order",
  permissions: {
    view: PERMISSIONS.bankOrders.view,
    create: PERMISSIONS.bankOrders.create,
    edit: PERMISSIONS.bankOrders.edit,
  },
  codePrefix: "BO",
  createSchema: z.object({
    loanId: z.string().uuid(),
    bankId: z.string().uuid(),
    customerId: z.string().uuid(),
    stage: z.enum(STAGES).default("Login"),
    status: z.enum(["In Progress", "On Hold", "Cleared", "Returned"]).default("In Progress"),
    officer: z.string().trim().max(120).optional().nullable(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  }),
});

/* ── helpers ────────────────────────────────────────────────────────────── */

/**
 * Adds a CHECK that makes exactly one audit action fail to insert.
 *
 * `NOT VALID` for the same reason migration 0007 uses it (D-057): earlier tests
 * in this file have already written `updated` and `approved` audit rows, and a
 * validating `ADD CONSTRAINT` would abort on them. `NOT VALID` exempts existing
 * rows and still rejects every new one, which is all this needs.
 */
async function breakAuditFor(action: string): Promise<void> {
  await ctx.client.exec(
    `alter table audit_logs add constraint f1_audit_break check (action <> '${action}') not valid`,
  );
}
async function repairAudit(): Promise<void> {
  await ctx.client.exec(`alter table audit_logs drop constraint if exists f1_audit_break`);
}

/*
 * A FRESH LOAN PER ORDER — required since Task 6.4 (migration 0013).
 *
 * `bank_orders_loan_unique` now enforces one live order per loan, so this
 * fixture can no longer reuse a single loan for every case. That constraint is
 * the point of 6.4 and it correctly caught this helper: a second order on the
 * same loan is the same file counted twice.
 */
let fixtureLoanCounter = 0;

async function freshLoanId(): Promise<string> {
  fixtureLoanCounter += 1;
  const [row] = await ctx.db
    .insert(loans)
    .values({
      code: `LN-F1-FX-${fixtureLoanCounter}`,
      customerId,
      bankId: bank.id,
      loanType: "Personal Loan",
      status: "Submitted",
    })
    .returning();
  return row!.id;
}

async function createOrder(overrides: Record<string, unknown> = {}) {
  const res = await request(testApp)
    .post("/api/test-orders")
    .set(auth(superToken))
    .send({ loanId: await freshLoanId(), bankId: bank.id, customerId, ...overrides });
  return res;
}

const orderById = async (id: string) =>
  (await ctx.db.select().from(bankOrders).where(eq(bankOrders.id, id)).limit(1))[0]!;

const auditCountFor = async (recordId: string) =>
  (await ctx.db.select().from(auditLogs).where(eq(auditLogs.recordId, recordId))).length;

beforeAll(async () => {
  ctx = await createTestContext();

  testApp = express();
  testApp.use(express.json());
  testApp.use("/api/test-orders", testOrdersRouter);
  testApp.use(errorHandler);

  bareApp = express();
  bareApp.use(express.json());
  bareApp.use("/api/bare-orders", bareOrdersRouter);
  bareApp.use(errorHandler);

  bank = await createBank(ctx.db);
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  const login = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: admin.email, password: admin.password });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  superToken = login.body.accessToken as string;

  const [customer] = await ctx.db
    .insert(customers)
    .values({
      code: "CUS-F1-1",
      bankId: bank.id,
      bankReferenceId: "F1-REF-1",
      name: "F1 Fixture Customer",
      mobile: "9876500001",
    })
    .returning();
  customerId = customer!.id;

  const [loan] = await ctx.db
    .insert(loans)
    .values({
      code: "LN-F1-1",
      customerId,
      bankId: bank.id,
      loanType: "Personal Loan",
      status: "Submitted",
    })
    .returning();
  loanId = loan!.id;
});

afterAll(async () => {
  await repairAudit();
  await destroyTestContext(ctx);
});

/* ══ GROUP A — F1-a: PATCH is transactional ═══════════════════════════════ */

describe("F1-a · PATCH commits its write and its audit row together", () => {
  it("writes the row and exactly one audit row on a normal PATCH", async () => {
    const created = await createOrder();
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;

    const before = await auditCountFor(id);
    const res = await request(testApp)
      .patch(`/api/test-orders/${id}`)
      .set(auth(superToken))
      .send({ officer: "Priya" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.officer).toBe("Priya");
    expect((await orderById(id)).officer).toBe("Priya");
    expect(await auditCountFor(id)).toBe(before + 1);
  });

  it("ROLLS THE WRITE BACK when the audit insert fails", async () => {
    const created = await createOrder();
    const id = created.body.data.id;
    const original = await orderById(id);
    const auditsBefore = await auditCountFor(id);

    await breakAuditFor("updated");
    try {
      const res = await request(testApp)
        .patch(`/api/test-orders/${id}`)
        .set(auth(superToken))
        .send({ officer: "should-not-persist" });

      // The request fails...
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await repairAudit();
    }

    // ...and the row is untouched. Before F1-a this assertion failed: the
    // update had already autocommitted before the audit was attempted.
    const after = await orderById(id);
    expect(after.officer).toBe(original.officer);
    expect(after.updatedAt).toEqual(original.updatedAt);
    expect(await auditCountFor(id)).toBe(auditsBefore);
  });

  it("preserves the response shape — { data: row }", async () => {
    const created = await createOrder();
    const res = await request(testApp)
      .patch(`/api/test-orders/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ remarks: "shape check" });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["data"]);
    expect(res.body.data.id).toBe(created.body.data.id);
  });
});

/* ══ GROUP B — F1-a: APPROVE is transactional ═════════════════════════════ */

describe("F1-a · APPROVE commits its write and its audit row together", () => {
  it("advances the record and audits it as `approved`", async () => {
    hookMode = "off";
    const created = await createOrder();
    const id = created.body.data.id;

    const res = await request(testApp)
      .post(`/api/test-orders/${id}/approve`)
      .set(auth(superToken))
      .send({ status: "Credit Check" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await orderById(id)).stage).toBe("Credit Check");

    const rows = await ctx.db.select().from(auditLogs).where(eq(auditLogs.recordId, id));
    expect(rows.some((r) => r.action === "approved")).toBe(true);
  });

  it("ROLLS THE STATUS CHANGE BACK when the audit insert fails", async () => {
    hookMode = "off";
    const created = await createOrder();
    const id = created.body.data.id;
    expect((await orderById(id)).stage).toBe("Login");

    await breakAuditFor("approved");
    try {
      const res = await request(testApp)
        .post(`/api/test-orders/${id}/approve`)
        .set(auth(superToken))
        .send({ status: "Credit Check" });
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await repairAudit();
    }

    // The approval did not happen at all — not "happened but unrecorded".
    expect((await orderById(id)).stage).toBe("Login");
  });
});

/* ══ GROUP C — F1-b: afterApprove ═════════════════════════════════════════ */

describe("F1-b · afterApprove runs inside the approve transaction", () => {
  it("receives before, after, the input and a TRANSACTION handle", async () => {
    hookMode = "record";
    hookCalls = [];
    const created = await createOrder();
    const id = created.body.data.id;

    const res = await request(testApp)
      .post(`/api/test-orders/${id}/approve`)
      .set(auth(superToken))
      .send({ status: "Credit Check", notes: "looks good" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(hookCalls).toHaveLength(1);
    const call = hookCalls[0]!;
    expect(call.before.stage).toBe("Login");
    expect(call.after.stage).toBe("Credit Check");
    expect(call.input.status).toBe("Credit Check");
    expect(call.input.notes).toBe("looks good");
    // D-032: the hook must never be handed the base handle.
    expect(call.sawTransactionHandle).toBe(true);
    hookMode = "off";
  });

  it("ROLLS THE APPROVAL BACK when the hook throws", async () => {
    const created = await createOrder();
    const id = created.body.data.id;
    const auditsBefore = await auditCountFor(id);

    hookMode = "throw";
    const res = await request(testApp)
      .post(`/api/test-orders/${id}/approve`)
      .set(auth(superToken))
      .send({ status: "Credit Check" });
    hookMode = "off";

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect((await orderById(id)).stage).toBe("Login");
    expect(await auditCountFor(id)).toBe(auditsBefore);
  });

  it("ROLLS THE HOOK'S OWN WRITES BACK when it throws after writing", async () => {
    const created = await createOrder();
    const id = created.body.data.id;

    hookMode = "write-then-throw";
    const res = await request(testApp)
      .post(`/api/test-orders/${id}/approve`)
      .set(auth(superToken))
      .send({ status: "Credit Check" });
    hookMode = "off";

    expect(res.status).toBeGreaterThanOrEqual(500);
    const row = await orderById(id);
    expect(row.stage).toBe("Login");
    expect(row.officer).not.toBe("written-by-hook");
  });

  it("does not fire on create or on PATCH — it is afterApprove, not afterWrite", async () => {
    hookMode = "record";
    hookCalls = [];

    const created = await createOrder();
    expect(created.status).toBe(201);
    expect(hookCalls).toHaveLength(0);

    const patched = await request(testApp)
      .patch(`/api/test-orders/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ officer: "Nikhil" });
    expect(patched.status).toBe(200);
    expect(hookCalls).toHaveLength(0);

    hookMode = "off";
  });
});

/* ══ GROUP D — F1-c: transitionColumn ═════════════════════════════════════ */

describe("F1-c · transitionColumn guards a column that is not called `status`", () => {
  it("allows a legal one-step stage move through PATCH", async () => {
    const created = await createOrder();
    const id = created.body.data.id;

    const res = await request(testApp)
      .patch(`/api/test-orders/${id}`)
      .set(auth(superToken))
      .send({ stage: "Credit Check" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await orderById(id)).stage).toBe("Credit Check");
  });

  it("REFUSES a skipped stage through PATCH with 422 and details.path = 'stage'", async () => {
    const created = await createOrder();
    const id = created.body.data.id;

    const res = await request(testApp)
      .patch(`/api/test-orders/${id}`)
      .set(auth(superToken))
      .send({ stage: "Sanction" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    // D-031: the frontend maps by shape, so the path must name the control the
    // operator actually used — `stage`, never `status`.
    expect(res.body.error.details?.[0]?.path).toBe("stage");
    expect(res.body.error.message).toContain("Login");
    expect(res.body.error.message).toContain("Sanction");
    expect((await orderById(id)).stage).toBe("Login");
  });

  it("REFUSES leaving a terminal stage", async () => {
    const created = await createOrder();
    const id = created.body.data.id;
    await ctx.db
      .update(bankOrders)
      .set({ stage: "Disbursal Queue" })
      .where(eq(bankOrders.id, id));

    const res = await request(testApp)
      .patch(`/api/test-orders/${id}`)
      .set(auth(superToken))
      .send({ stage: "Login" });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain("final stage");
  });

  it("REFUSES an illegal initial stage on create, naming `stage`", async () => {
    const res = await createOrder({ stage: "Sanction" });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("stage");
    expect(res.body.error.message).toContain("stage Sanction");
  });

  it("does not judge a PATCH that carries no stage", async () => {
    const created = await createOrder();
    const id = created.body.data.id;
    await ctx.db.update(bankOrders).set({ stage: "Sanction" }).where(eq(bankOrders.id, id));

    // Sanction→Sanction is not a legal edge; a remarks-only PATCH must not be
    // read as a self-transition and refused.
    const res = await request(testApp)
      .patch(`/api/test-orders/${id}`)
      .set(auth(superToken))
      .send({ remarks: "no stage in this payload" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await orderById(id)).stage).toBe("Sanction");
  });

  it("writes the configured column on approve, not `status`", async () => {
    hookMode = "off";
    const created = await createOrder();
    const id = created.body.data.id;
    const statusBefore = (await orderById(id)).status;

    const res = await request(testApp)
      .post(`/api/test-orders/${id}/approve`)
      .set(auth(superToken))
      .send({ status: "Credit Check" });

    expect(res.status).toBe(200);
    const row = await orderById(id);
    expect(row.stage).toBe("Credit Check");
    expect(row.status).toBe(statusBefore);
  });
});

/* ══ GROUP E — compatibility: unconfigured resources are unchanged ════════ */

describe("F1 · resources that opt into nothing behave exactly as before", () => {
  it("the REAL bank-orders router has no approve route — F1 did not add one", async () => {
    const res = await request(ctx.app)
      .post(`/api/bank-orders/${loanId}/approve`)
      .set(auth(superToken))
      .send({ status: "Cleared" });

    expect(res.status).toBe(404);
  });

  it("a router that configures NOTHING does not enforce transitions on PATCH", async () => {
    /*
     * RETARGETED 2026-09-05, Task 6.1.
     *
     * This used to assert against the real `/api/bank-orders`, which then
     * configured no machine. 6.1 has since given it one — that is the row's
     * whole point — so the assertion moved to a fixture that opts into nothing.
     *
     * Pinning it against a *fixture* rather than whichever production router
     * happens to be unconfigured this week is the durable form: the property
     * being protected is "F1 changed nothing for resources that did not ask",
     * and that must stay true no matter which phase configures what next.
     */
    const created = await request(bareApp)
      .post("/api/bare-orders")
      .set(auth(superToken))
      .send({ loanId, bankId: bank.id, customerId });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    // A skip the CONFIGURED fixture refuses. This one has no `transitionColumn`,
    // so PATCH must not consult a map at all.
    const res = await request(bareApp)
      .patch(`/api/bare-orders/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ stage: "Sanction" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.stage).toBe("Sanction");
  });

  it("the REAL bank-orders router now DOES enforce them — 6.1 landed", async () => {
    const created = await request(ctx.app)
      .post("/api/bank-orders")
      .set(auth(superToken))
      // A fresh loan: since Task 6.4 the shared `loanId` already has an order,
      // and migration 0013 permits exactly one live order per loan.
      .send({ loanId: await freshLoanId(), bankId: bank.id, customerId });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const res = await request(ctx.app)
      .patch(`/api/bank-orders/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ stage: "Sanction" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("stage");
  });

  it("the REAL bank-orders PATCH still audits, now atomically", async () => {
    const created = await request(ctx.app)
      .post("/api/bank-orders")
      .set(auth(superToken))
      .send({ loanId: await freshLoanId(), bankId: bank.id, customerId });
    const id = created.body.data.id;
    const before = await auditCountFor(id);

    const res = await request(ctx.app)
      .patch(`/api/bank-orders/${id}`)
      .set(auth(superToken))
      .send({ officer: "Compat" });

    expect(res.status).toBe(200);
    expect(await auditCountFor(id)).toBe(before + 1);
  });

  it("loan refusal wording is unchanged — `the allowed statuses are:`", async () => {
    const [loan] = await ctx.db
      .insert(loans)
      .values({
        code: "LN-F1-2",
        customerId,
        bankId: bank.id,
        loanType: "Personal Loan",
        status: "Draft",
      })
      .returning();

    const res = await request(ctx.app)
      .post(`/api/loans/${loan!.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });

    expect(res.status).toBe(422);
    // F1-c parameterised this message. `transitionColumn` defaults to "status",
    // and "status" pluralises to "statuses", so loans read exactly as before.
    expect(res.body.error.message).toContain("the allowed statuses are:");
    expect(res.body.error.details?.[0]?.path).toBe("status");
  });

  it("loan create refusal still names `status` and reads as before", async () => {
    const res = await request(ctx.app)
      .post("/api/loans")
      .set(auth(superToken))
      .send({ customerId, bankId: bank.id, loanType: "Personal Loan", status: "Approved" });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain("cannot be created with status Approved");
    expect(res.body.error.details?.[0]?.path).toBe("status");
  });
});
