import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import * as schema from "../db/schema/index.js";

/**
 * SQL REPORTING — Tasks 11.3, 11.9, and the server half of 11.2.
 *
 * The reports screen computed everything in the browser from
 * `useResource("/loans", { pageSize: 500 })`. 500 is the factory's hard
 * maximum, so:
 *
 *   · **loan 501 was invisible**, with nothing on screen to say so;
 *   · every filter ran over that truncated page;
 *   · every total was a sum of a sample, presented as a sum of the book.
 *
 * Group B is the one that matters most. It is written with **more rows than the
 * old cap** precisely so that a regression to client-side filtering fails here
 * rather than in production on the first client with a real book.
 *
 * The `to`-bound case is here rather than in the frontend because 11.3 moved
 * the comparison into SQL. Task 11.2 fixed it in the browser; if the two
 * disagree the report silently changes shape depending on which layer filtered.
 */

const PASSWORD = "TestPassword123!";

let ctx: TestContext;
let bankA: { id: string; code: string };
let bankB: { id: string; code: string };
let superToken: string;
let scopedToken: string;

/** Local `YYYY-MM-DD`, matching what a date input submits. */
const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TODAY = new Date();

let seq = 0;
async function seedLoan(opts: {
  bankId: string;
  status?: string;
  approved?: number;
  requested?: number;
  commission?: number;
  at?: Date;
}) {
  seq += 1;
  const [customer] = await ctx.db
    .insert(schema.customers)
    .values({
      code: `CUS-R${seq}`,
      bankId: opts.bankId,
      bankReferenceId: `RREF-${seq}`,
      name: `Report Customer ${seq}`,
      mobile: `97${String(400000000 + seq)}`,
    })
    .returning();

  await ctx.db.insert(schema.loans).values({
    code: `LN-R${seq}`,
    customerId: customer!.id,
    bankId: opts.bankId,
    loanType: "Personal Loan",
    status: opts.status ?? "Approved",
    amountRequested: String(opts.requested ?? 100_000),
    amountApproved: String(opts.approved ?? 90_000),
    commission: String(opts.commission ?? 5_000),
    appliedOn: opts.at ?? TODAY,
  });
}

beforeAll(async () => {
  ctx = await createTestContext();
  bankA = await createBank(ctx.db);
  bankB = await createBank(ctx.db);

  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (
    await request(ctx.app).post("/api/auth/login").send({ email: admin.email, password: PASSWORD })
  ).body.accessToken;

  const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bankA.id] });
  scopedToken = (
    await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: manager.email, password: PASSWORD })
  ).body.accessToken;
}, 60_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

const report = (query: string, token = superToken) =>
  request(ctx.app).get(`/api/reports/loans${query}`).set("Authorization", `Bearer ${token}`);

/* ══ A — it aggregates in SQL ═════════════════════════════════════════════ */

describe("A · the summary is computed by the database", () => {
  it("1. an empty book reports zeroes, not an error", async () => {
    const res = await report("?pageSize=10");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.summary.count).toBe(0);
    expect(Number(res.body.summary.commission)).toBe(0);
  });

  it("2. it sums approved value and commission across the filtered set", async () => {
    await seedLoan({ bankId: bankA.id, approved: 100_000, commission: 5_000 });
    await seedLoan({ bankId: bankA.id, approved: 200_000, commission: 7_500 });

    const res = await report("?pageSize=10");
    expect(res.body.summary.count).toBe(2);
    expect(Number(res.body.summary.approvedValue)).toBe(300_000);
    expect(Number(res.body.summary.commission)).toBe(12_500);
  });

  it("3. money is exact — numeric all the way out, never a float (D-068)", async () => {
    const bank = await createBank(ctx.db);
    await seedLoan({ bankId: bank.id, approved: 0.1, commission: 0.1 });
    await seedLoan({ bankId: bank.id, approved: 0.2, commission: 0.2 });

    const res = await report(`?bankId=${bank.id}&pageSize=10`);
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754.
    expect(Number(res.body.summary.approvedValue)).toBeCloseTo(0.3, 10);
  });

  it("4. `approvedCount` counts Approved and Disbursed only", async () => {
    const bank = await createBank(ctx.db);
    await seedLoan({ bankId: bank.id, status: "Approved" });
    await seedLoan({ bankId: bank.id, status: "Disbursed" });
    await seedLoan({ bankId: bank.id, status: "Rejected" });

    const res = await report(`?bankId=${bank.id}&pageSize=10`);
    expect(res.body.summary.count).toBe(3);
    expect(res.body.summary.approvedCount).toBe(2);
  });
});

/* ══ B — past the old 500 cap ═════════════════════════════════════════════ */

describe("B · the report is not capped at the page it fetched", () => {
  const bigBank = { id: "" };

  beforeAll(async () => {
    const bank = await createBank(ctx.db);
    bigBank.id = bank.id;
    // 520 loans — deliberately past the 500-row ceiling the old screen had.
    for (let i = 0; i < 520; i += 1) {
      await seedLoan({ bankId: bank.id, approved: 1_000, commission: 10 });
    }
  }, 180_000);

  it("5. THE FINDING: the summary counts all 520, not 500", async () => {
    const res = await report(`?bankId=${bigBank.id}&pageSize=50`);
    expect(res.body.summary.count).toBe(520);
    expect(Number(res.body.summary.commission)).toBe(5_200);
  });

  it("6. the returned page is still a page, and says so", async () => {
    const res = await report(`?bankId=${bigBank.id}&pageSize=50`);
    expect(res.body.data).toHaveLength(50);
    expect(res.body.meta.total).toBe(520);
    expect(res.body.meta.complete).toBe(false);
  });

  it("7. `pageSize=0` returns EVERY row — Task 11.9's export path", async () => {
    const res = await report(`?bankId=${bigBank.id}&pageSize=0`);
    expect(res.body.data).toHaveLength(520);
    expect(res.body.meta.complete).toBe(true);
  });
});

/* ══ C — the inclusive `to` bound, now in SQL ═════════════════════════════ */

describe("C · the date window, server-side (11.2's other half)", () => {
  const dateBank = { id: "" };

  beforeAll(async () => {
    const bank = await createBank(ctx.db);
    dateBank.id = bank.id;

    const lateToday = new Date(TODAY);
    lateToday.setHours(23, 47, 0, 0);
    await seedLoan({ bankId: bank.id, at: lateToday });

    const longAgo = new Date(TODAY);
    longAgo.setFullYear(longAgo.getFullYear() - 5);
    await seedLoan({ bankId: bank.id, at: longAgo });
  });

  it("8. THE FINDING: a loan timestamped LATE on the `to` day is included", async () => {
    /*
     * A date input means the whole DAY. Comparing a 23:47 timestamp against a
     * midnight `to` boundary drops it, which is why the final day of every
     * report used to be silently empty.
     */
    // BOTH bounds set to today, so the window is exactly one day and the case
    // isolates the `to` boundary rather than also catching the old loan.
    const res = await report(
      `?bankId=${dateBank.id}&from=${key(TODAY)}&to=${key(TODAY)}&pageSize=100`,
    );
    expect(res.body.summary.count).toBe(1);
    expect(res.body.data).toHaveLength(1);
  });

  it("8b. and `to` alone still includes everything up to and including that day", async () => {
    const res = await report(`?bankId=${dateBank.id}&to=${key(TODAY)}&pageSize=100`);
    expect(res.body.summary.count).toBe(2);
  });

  it("9. a loan outside the window is excluded", async () => {
    const res = await report(`?bankId=${dateBank.id}&from=${key(TODAY)}&pageSize=100`);
    expect(res.body.summary.count).toBe(1);
  });

  it("10. no window returns everything", async () => {
    const res = await report(`?bankId=${dateBank.id}&pageSize=100`);
    expect(res.body.summary.count).toBe(2);
  });
});

/* ══ D — scoping and permissions ══════════════════════════════════════════ */

describe("D · a scoped user's report cannot reach another bank", () => {
  it("11. a Manager sees only their assigned bank", async () => {
    await seedLoan({ bankId: bankB.id, commission: 999_999 });

    const res = await report("?pageSize=200", scopedToken);
    expect(res.status).toBe(200);
    expect(res.body.meta.scoped).toBe(true);
    for (const row of res.body.data) expect(row.bankId).not.toBe(bankB.id);
    expect(Number(res.body.summary.commission)).not.toBe(999_999);
  });

  it("12. a client bankId filter can NARROW the scope but never widen it", async () => {
    const res = await report(`?bankId=${bankB.id}&pageSize=10`, scopedToken);
    expect(res.status).toBe(403);
  });

  it("13. Executive holds no `reports.view` and is refused", async () => {
    const exec = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });
    const token = (
      await request(ctx.app).post("/api/auth/login").send({ email: exec.email, password: PASSWORD })
    ).body.accessToken;

    const res = await report("?pageSize=10", token);
    expect(res.status).toBe(403);
  });

  it("14. an unauthenticated caller is refused", async () => {
    const res = await request(ctx.app).get("/api/reports/loans");
    expect(res.status).toBe(401);
  });
});

/* ══ E — the trend endpoint ═══════════════════════════════════════════════ */

describe("E · the trend endpoint (11.5)", () => {
  it("15. it returns monthly buckets rather than a hardcoded empty array", async () => {
    const res = await request(ctx.app)
      .get("/api/reports/trend")
      .set("Authorization", `Bearer ${superToken}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("month");
    expect(res.body.data[0].month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("16. it is bank-scoped like everything else", async () => {
    const res = await request(ctx.app)
      .get("/api/reports/trend")
      .set("Authorization", `Bearer ${scopedToken}`);
    expect(res.status).toBe(200);
  });
});
