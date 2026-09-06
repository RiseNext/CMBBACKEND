import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { auditLogs, bankOrders, customers } from "../db/schema/index.js";

/**
 * LOAN SUBMISSION OPENS ITS BANK ORDER — Task 6.4
 * DECISIONS.md D-027, D-059, D-060, D-070 · BUSINESS_FLOW.md §3.3
 *
 * "Link loan submission to bank-order creation so the stages connect."
 *
 * Before this, `POST /api/bank-orders` had **zero callers** and orders could
 * only appear by direct database insert — so the Kanban board tracked a
 * pipeline nothing could enter. A loan was submitted and the bank-order screen
 * never heard about it.
 *
 *   Group A — the link itself, and that it is atomic with the loan.
 *   Group B — no duplicate, from either the service check or the DB constraint.
 *             These are DIFFERENT guarantees: the check covers sequential
 *             re-submission, the index covers the concurrent case the check
 *             structurally cannot see, because D-027 forbids taking a lock.
 *   Group C — derivation. Nothing about the order is taken from the request.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let otherBank: { id: string; code: string };
let customerId: string;
let superToken: string;
let counter = 0;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

const createLoan = (overrides: Record<string, unknown> = {}) =>
  request(ctx.app)
    .post("/api/loans")
    .set(auth(superToken))
    .send({
      customerId,
      bankId: bank.id,
      loanType: "Personal Loan",
      amountRequested: 500000,
      status: "Submitted",
      ...overrides,
    });

const ordersFor = async (loanId: string) =>
  ctx.db
    .select()
    .from(bankOrders)
    .where(and(eq(bankOrders.loanId, loanId), isNull(bankOrders.deletedAt)));

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);
  otherBank = await createBank(ctx.db);

  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(admin.email, admin.password);

  const [customer] = await ctx.db
    .insert(customers)
    .values({
      code: "CUS-LINK-1",
      bankId: bank.id,
      bankReferenceId: "LINK-REF-1",
      name: "Link Fixture",
      mobile: "9876588888",
    })
    .returning();
  customerId = customer!.id;
});

afterAll(async () => destroyTestContext(ctx));

/* ── A — the link ───────────────────────────────────────────────────────── */

describe("A — submitting a loan opens its bank order", () => {
  it("1. THE HEADLINE — a loan created Submitted gets exactly one order", async () => {
    const loan = await createLoan();
    expect(loan.status, JSON.stringify(loan.body)).toBe(201);

    const orders = await ordersFor(loan.body.data.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.code).toMatch(/^BO-\d+$/);
  });

  it("2. it opens at the ratified initial state", async () => {
    const loan = await createLoan();
    const [order] = await ordersFor(loan.body.data.id);
    // BUSINESS_FLOW.md §3.3 — anything else would be refused by the machine
    // 6.1 enforces on PATCH.
    expect(order!.stage).toBe("Login");
    expect(order!.status).toBe("In Progress");
    expect(order!.submittedOn).not.toBeNull();
  });

  it("3. a loan created as Draft does NOT open one", async () => {
    const loan = await createLoan({ status: "Draft" });
    expect(loan.status).toBe(201);
    expect(await ordersFor(loan.body.data.id)).toHaveLength(0);
  });

  it("4. ...and gets one when it is later submitted through the machine", async () => {
    const loan = await createLoan({ status: "Draft" });
    const id = loan.body.data.id;
    expect(await ordersFor(id)).toHaveLength(0);

    const submitted = await request(ctx.app)
      .post(`/api/loans/${id}/approve`)
      .set(auth(superToken))
      .send({ status: "Submitted" });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

    // Both doors into `Submitted` open the same thing — a file that became
    // submitted by a different route is not a different file.
    expect(await ordersFor(id)).toHaveLength(1);
  });

  it("5. the order is audited, naming the loan that opened it", async () => {
    const loan = await createLoan();
    const [order] = await ordersFor(loan.body.data.id);

    const rows = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.recordId, order!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toContain(loan.body.data.code);
  });

  it("6. ATOMICITY — a refused loan leaves no orphan order", async () => {
    // A customer from another bank fails `assertSameBank` in `beforeWrite`.
    const [stranger] = await ctx.db
      .insert(customers)
      .values({
        code: `CUS-LINK-X${(counter += 1)}`,
        bankId: otherBank.id,
        bankReferenceId: `LINK-X${counter}`,
        name: "Other Bank",
        mobile: "9876599999",
      })
      .returning();

    const before = await ctx.db.select().from(bankOrders);
    const res = await createLoan({ customerId: stranger!.id });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const after = await ctx.db.select().from(bankOrders);
    expect(after).toHaveLength(before.length);
  });
});

/* ── B — no duplicates ──────────────────────────────────────────────────── */

describe("B — one live order per loan, guarded twice", () => {
  it("7. re-submitting through the machine does not open a second", async () => {
    const loan = await createLoan();
    const id = loan.body.data.id;
    expect(await ordersFor(id)).toHaveLength(1);

    // Submitted → Under Review → Submitted is a legal round trip.
    await request(ctx.app)
      .post(`/api/loans/${id}/approve`)
      .set(auth(superToken))
      .send({ status: "Under Review" });
    const back = await request(ctx.app)
      .post(`/api/loans/${id}/approve`)
      .set(auth(superToken))
      .send({ status: "Submitted" });
    expect(back.status, JSON.stringify(back.body)).toBe(200);

    // The service-layer existence check covers this sequential case.
    expect(await ordersFor(id)).toHaveLength(1);
  });

  it("8. THE BACKSTOP — the DB refuses a second live order the check cannot see", async () => {
    const loan = await createLoan();
    const id = loan.body.data.id;
    const [existing] = await ordersFor(id);

    /*
     * Simulates the concurrent case: two submissions both read "no order"
     * before either writes. D-027 forbids a row lock, so the service check
     * cannot close this — migration 0013's partial unique index does.
     */
    await expect(
      ctx.db.insert(bankOrders).values({
        code: "BO-DUPLICATE",
        loanId: id,
        bankId: bank.id,
        customerId,
        stage: "Login",
        status: "In Progress",
      }),
    ).rejects.toThrow();

    const orders = await ordersFor(id);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.id).toBe(existing!.id);
  });

  it("9. a soft-deleted order does not block a replacement", async () => {
    const loan = await createLoan();
    const id = loan.body.data.id;
    const [order] = await ordersFor(id);

    await ctx.db
      .update(bankOrders)
      .set({ deletedAt: new Date() })
      .where(eq(bankOrders.id, order!.id));

    // The predicate is partial on `deleted_at is null` precisely so the recycle
    // bin does not permanently freeze a file.
    await expect(
      ctx.db.insert(bankOrders).values({
        code: `BO-REPLACE-${(counter += 1)}`,
        loanId: id,
        bankId: bank.id,
        customerId,
        stage: "Login",
        status: "In Progress",
      }),
    ).resolves.toBeDefined();
  });
});

/* ── C — everything is derived ──────────────────────────────────────────── */

describe("C — the order is derived from the loan, never from the request", () => {
  it("10. bank and customer come from the loan row", async () => {
    const loan = await createLoan();
    const [order] = await ordersFor(loan.body.data.id);

    // D-059 — `assertSameBank` guards both, so a freely-chosen bank could only
    // ever produce a refusal. Deriving is the only shape that works.
    expect(order!.bankId).toBe(bank.id);
    expect(order!.customerId).toBe(customerId);
  });

  it("11. the code comes from the BO sequence, minted on the transaction handle", async () => {
    const first = await createLoan();
    const second = await createLoan();

    const [a] = await ordersFor(first.body.data.id);
    const [b] = await ordersFor(second.body.data.id);

    // D-032: passing `tx` is what keeps this from deadlocking on a
    // single-connection driver. A hang here would be that bug returning.
    expect(a!.code).toMatch(/^BO-\d+$/);
    expect(b!.code).toMatch(/^BO-\d+$/);
    expect(a!.code).not.toBe(b!.code);
  });

  it("12. the manual create route still works and still enforces its invariants", async () => {
    // Task 6.3's path. A loan with no order yet, created as Draft so 6.4 did
    // not open one.
    const loan = await createLoan({ status: "Draft" });
    const loanId = loan.body.data.id;

    const ok = await request(ctx.app)
      .post("/api/bank-orders")
      .set(auth(superToken))
      .send({ loanId, bankId: bank.id, customerId, stage: "Login", status: "In Progress" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    // ...and a mismatched bank is refused, which is why the UI derives it.
    const loan2 = await createLoan({ status: "Draft" });
    const bad = await request(ctx.app)
      .post("/api/bank-orders")
      .set(auth(superToken))
      .send({ loanId: loan2.body.data.id, bankId: otherBank.id, customerId });
    expect(bad.status).toBe(400);
  });

  it("13. the manual route refuses a non-initial stage", async () => {
    const loan = await createLoan({ status: "Draft" });
    const res = await request(ctx.app)
      .post("/api/bank-orders")
      .set(auth(superToken))
      .send({
        loanId: loan.body.data.id,
        bankId: bank.id,
        customerId,
        stage: "Sanction",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("stage");
  });
});
