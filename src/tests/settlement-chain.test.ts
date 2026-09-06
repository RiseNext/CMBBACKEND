import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { auditLogs, ledgerEntries, settlements, transactions } from "../db/schema/index.js";

/**
 * PHASE 8 — TRANSACTIONS AND SETTLEMENTS
 * Tasks 8.1, 8.2, 8.3, 8.7, 8.8
 * DECISIONS.md D-058, D-066, D-069, D-070 · BUSINESS_FLOW.md §3.3, §4.3
 *
 *   Group A — 8.2/8.3: settlement vocabulary, initial state, approve routing.
 *   Group B — 8.1: the transaction machine, enforced on PATCH because
 *             transactions have no approve route at all.
 *   Group C — 8.7: terminal financial records are immutable (D-069). This row
 *             builds nothing; the graph already says it and these tests prove
 *             it, which is the whole of the task.
 *   Group D — 8.8: the settlement → transaction → ledger chain.
 *   Group E — 8.8's idempotency, which is a DIFFERENT guarantee from its
 *             atomicity and needs migration 0010's indexes to hold.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let superToken: string;
let managerToken: string;
let periodCounter = 0;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const nextPeriod = () => `CHAIN-${(periodCounter += 1)}`;

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

const createSettlement = (body: Record<string, unknown> = {}, token = superToken) =>
  request(ctx.app)
    .post("/api/settlements")
    .set(auth(token))
    .send({
      bankId: bank.id,
      period: nextPeriod(),
      grossCommission: 10000,
      tds: 1000,
      netPayable: 9000,
      ...body,
    });

const approveSettlement = (id: string, status: string, token = superToken) =>
  request(ctx.app).post(`/api/settlements/${id}/approve`).set(auth(token)).send({ status });

const createTransaction = (body: Record<string, unknown> = {}, token = superToken) =>
  request(ctx.app)
    .post("/api/transactions")
    .set(auth(token))
    .send({ bankId: bank.id, amount: 500, txnType: "Commission", ...body });

const txnsFor = async (settlementId: string) =>
  ctx.db.select().from(transactions).where(eq(transactions.settlementId, settlementId));

const ledgerFor = async (transactionId: string) =>
  ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, transactionId));

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(admin.email, admin.password);
  const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bank.id] });
  managerToken = await login(manager.email, manager.password);
});

afterAll(async () => destroyTestContext(ctx));

/* ── A — settlement vocabulary and approve routing (8.2 / 8.3) ───────────── */

describe("A — settlement status is written by the approve route alone", () => {
  it("1. THE HEADLINE — approve no longer persists an arbitrary string", async () => {
    const created = await createSettlement();
    const res = await approveSettlement(created.body.data.id, "banana");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
  });

  it("2. CREATE refuses a privileged initial status", async () => {
    for (const status of ["Paid", "Disputed"]) {
      const res = await createSettlement({ status });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.details?.[0]?.path).toBe("status");
    }
  });

  it("3. CREATE accepts Pending, and the default", async () => {
    expect((await createSettlement({ status: "Pending" })).status).toBe(201);
    const bare = await createSettlement();
    expect(bare.body.data.status).toBe("Pending");
  });

  it("4. PATCH refuses status outright", async () => {
    const created = await createSettlement();
    const res = await request(ctx.app)
      .patch(`/api/settlements/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Paid" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("status");
  });

  it("5. every legal edge is allowed", async () => {
    const toPaid = await createSettlement();
    expect((await approveSettlement(toPaid.body.data.id, "Paid")).status).toBe(200);

    const toDisputed = await createSettlement();
    expect((await approveSettlement(toDisputed.body.data.id, "Disputed")).status).toBe(200);
    // Disputed resolves either way.
    expect((await approveSettlement(toDisputed.body.data.id, "Pending")).status).toBe(200);
  });

  it("6. Manager cannot approve — settlements.approve is Admin and above", async () => {
    const created = await createSettlement();
    const res = await approveSettlement(created.body.data.id, "Paid", managerToken);
    expect(res.status).toBe(403);
  });

  it("7. →Paid re-runs the arithmetic invariant", async () => {
    const created = await createSettlement();
    // Make the row incoherent through a route that does not check `netPayable`
    // against the others... it cannot, so corrupt it directly and prove approve
    // is the last line of defence before an immutable state.
    await ctx.db
      .update(settlements)
      .set({ grossCommission: "99999" })
      .where(eq(settlements.id, created.body.data.id));

    const res = await approveSettlement(created.body.data.id, "Paid");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("netPayable");

    // Refused, and F1 rolled it back — still Pending, not half-Paid.
    const [row] = await ctx.db
      .select()
      .from(settlements)
      .where(eq(settlements.id, created.body.data.id));
    expect(row!.status).toBe("Pending");
  });
});

/* ── B — the transaction machine (8.1) ──────────────────────────────────── */

describe("B — transactions are guarded on PATCH, having no approve route", () => {
  it("8. there is no approve route to guard", async () => {
    const created = await createTransaction();
    const res = await request(ctx.app)
      .post(`/api/transactions/${created.body.data.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Success" });
    expect(res.status).toBe(404);
  });

  it("9. CREATE refuses a privileged initial status", async () => {
    const res = await createTransaction({ status: "Success" });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("status");
  });

  it("10. THE BYPASS — Manager holds create and not edit, so cannot reach Success", async () => {
    const res = await createTransaction({ status: "Success" }, managerToken);
    expect(res.status).toBe(422);
  });

  it("11. PATCH allows the legal edges", async () => {
    for (const status of ["Success", "Failed"]) {
      const created = await createTransaction();
      const res = await request(ctx.app)
        .patch(`/api/transactions/${created.body.data.id}`)
        .set(auth(superToken))
        .send({ status });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe(status);
    }
  });

  it("12. a PATCH carrying no status is not judged as a transition", async () => {
    const created = await createTransaction();
    const res = await request(ctx.app)
      .patch(`/api/transactions/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ reference: "REF-1" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

/* ── C — 8.7: terminal financial records are immutable (D-069) ───────────── */

describe("C — terminal financial records cannot be moved", () => {
  it("13. a Success transaction is immutable — reversal is a NEW Refund txn", async () => {
    const created = await createTransaction();
    await request(ctx.app)
      .patch(`/api/transactions/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Success" });

    const res = await request(ctx.app)
      .patch(`/api/transactions/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Failed" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.message).toContain("final status");
  });

  it("14. a Failed transaction is immutable too", async () => {
    const created = await createTransaction();
    await request(ctx.app)
      .patch(`/api/transactions/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Failed" });

    const res = await request(ctx.app)
      .patch(`/api/transactions/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Success" });
    expect(res.status).toBe(422);
  });

  it("15. a Paid settlement is immutable", async () => {
    const created = await createSettlement();
    await approveSettlement(created.body.data.id, "Paid");
    const res = await approveSettlement(created.body.data.id, "Pending");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
  });

  it("16. neither resource exposes a DELETE at all", async () => {
    const txn = await createTransaction();
    const settlement = await createSettlement();
    expect((await request(ctx.app).delete(`/api/transactions/${txn.body.data.id}`).set(auth(superToken))).status).toBe(404);
    expect(
      (await request(ctx.app).delete(`/api/settlements/${settlement.body.data.id}`).set(auth(superToken))).status,
    ).toBe(404);
  });

  it("17. the compensating vocabulary exists — a Refund transaction is creatable", async () => {
    const res = await createTransaction({ txnType: "Refund", amount: 9000 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.txnType).toBe("Refund");
  });
});

/* ── D — 8.8: the chain ──────────────────────────────────────────────────── */

describe("D — approving a settlement posts a transaction and a ledger entry", () => {
  it("18. THE CHAIN — one settlement → one transaction → one ledger entry", async () => {
    const created = await createSettlement();
    const id = created.body.data.id;

    const res = await approveSettlement(id, "Paid");
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const txns = await txnsFor(id);
    expect(txns).toHaveLength(1);
    const txn = txns[0]!;
    expect(txn.txnType).toBe("Commission");
    expect(Number(txn.amount)).toBe(9000); // net_payable
    expect(Number(txn.commission)).toBe(0); // D-058 — not invented here
    expect(txn.status).toBe("Success");
    expect(txn.bankId).toBe(bank.id); // inherited, so scoped users can see it

    const entries = await ledgerFor(txn.id);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.category).toBe("Commission");
    expect(Number(entry.credit)).toBe(9000);
    expect(Number(entry.debit)).toBe(0);
    expect(Number(entry.balance)).toBe(0); // Phase 11.7 owns the running balance
    expect(entry.bankId).toBe(bank.id);
  });

  it("19. the chain does NOT fire on Disputed", async () => {
    const created = await createSettlement();
    await approveSettlement(created.body.data.id, "Disputed");
    expect(await txnsFor(created.body.data.id)).toHaveLength(0);
  });

  it("20. all three writes and all three audits are in ONE transaction", async () => {
    const created = await createSettlement();
    const id = created.body.data.id;
    await approveSettlement(id, "Paid");

    const txn = (await txnsFor(id))[0]!;
    const entry = (await ledgerFor(txn.id))[0]!;

    // Each write left an audit row. Before F1 the approve route audited on the
    // base handle, so none of this could have been atomic.
    for (const recordId of [id, txn.id, entry.id]) {
      const rows = await ctx.db.select().from(auditLogs).where(eq(auditLogs.recordId, recordId));
      expect(rows.length, `no audit row for ${recordId}`).toBeGreaterThan(0);
    }
  });

  it("21. codes come from the sequences, minted on the transaction handle", async () => {
    const created = await createSettlement();
    await approveSettlement(created.body.data.id, "Paid");

    const txn = (await txnsFor(created.body.data.id))[0]!;
    const entry = (await ledgerFor(txn.id))[0]!;
    // D-032: passing `tx` is what keeps this from deadlocking on a
    // single-connection driver. A hang here would be that bug returning.
    expect(txn.code).toMatch(/^TXN-\d+$/);
    expect(entry.code).toMatch(/^LG-\d+$/);
  });

  it("22. a refused approval posts NOTHING — the chain rolls back with it", async () => {
    const created = await createSettlement();
    const id = created.body.data.id;
    await ctx.db.update(settlements).set({ tds: "7" }).where(eq(settlements.id, id));

    const res = await approveSettlement(id, "Paid");
    expect(res.status).toBe(422);

    expect(await txnsFor(id)).toHaveLength(0);
    const [row] = await ctx.db.select().from(settlements).where(eq(settlements.id, id));
    expect(row!.status).toBe("Pending");
  });
});

/* ── E — 8.8 idempotency (migration 0010) ───────────────────────────────── */

describe("E — idempotency is a different guarantee from atomicity", () => {
  it("23. Paid is terminal, so a second approval cannot double-post", async () => {
    const created = await createSettlement();
    const id = created.body.data.id;
    expect((await approveSettlement(id, "Paid")).status).toBe(200);

    // The transition map refuses the second attempt before the chain runs.
    expect((await approveSettlement(id, "Paid")).status).toBe(422);
    expect(await txnsFor(id)).toHaveLength(1);
  });

  it("24. and the DB index is the backstop when the map cannot be", async () => {
    const created = await createSettlement();
    const id = created.body.data.id;
    await approveSettlement(id, "Paid");
    const existing = (await txnsFor(id))[0]!;

    // Simulates the lost race D-027 permits: two approvals both read Pending.
    // The map cannot see the other in-flight request; the unique index can.
    await expect(
      ctx.db.insert(transactions).values({
        code: "TXN-DUPLICATE",
        bankId: bank.id,
        settlementId: id,
        amount: "9000",
        txnType: "Commission",
        status: "Success",
      }),
    ).rejects.toThrow();

    expect(await txnsFor(id)).toHaveLength(1);
    expect((await txnsFor(id))[0]!.id).toBe(existing.id);
  });

  it("25. one ledger entry per transaction, enforced by the same mechanism", async () => {
    const created = await createSettlement();
    await approveSettlement(created.body.data.id, "Paid");
    const txn = (await txnsFor(created.body.data.id))[0]!;

    await expect(
      ctx.db.insert(ledgerEntries).values({
        code: "LG-DUPLICATE",
        bankId: bank.id,
        particulars: "Second entry for the same transaction",
        category: "Commission",
        transactionId: txn.id,
        debit: "0",
        credit: "9000",
        balance: "0",
      }),
    ).rejects.toThrow();

    expect(await ledgerFor(txn.id)).toHaveLength(1);
  });
});
