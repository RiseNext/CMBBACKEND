import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  createBank,
  createTestContext,
  createUser,
  customerPayload,
  destroyTestContext,
  type TestContext,
} from "./harness.js";

/**
 * FRONTEND CONTRACT
 *
 * The gap this closes: the pages were rewired without ever running against a
 * live backend, so a query parameter the API silently ignores, or a page size
 * it rejects, would only surface on first use in production.
 *
 * Every request below is copied from what a page actually issues — same path,
 * same parameters — and asserts both the status and the response shape the
 * frontend's TypeScript types expect.
 */

let ctx: TestContext;
let token: string;
let bank: { id: string; code: string };
let customerId: string;
let loanId: string;

const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Contract Bank");
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  const login = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: admin.email, password: admin.password });
  token = login.body.accessToken;

  const customer = await request(ctx.app)
    .post("/api/customers")
    .set(auth())
    .send(customerPayload(bank.id, "CONTRACT-1"));
  customerId = customer.body.data.id;

  const loan = await request(ctx.app).post("/api/loans").set(auth()).send({
    customerId,
    bankId: bank.id,
    loanType: "Personal Loan",
    amountRequested: 250000,
    status: "Submitted",
  });
  loanId = loan.body.data.id;
}, 90_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

/** Exactly the calls the pages make, with the parameters they send. */
const FRONTEND_CALLS: { page: string; path: string; query?: Record<string, string> }[] = [
  { page: "dashboard", path: "/api/dashboard/stats" },
  { page: "dashboard", path: "/api/dashboard/loan-status" },
  { page: "dashboard", path: "/api/dashboard/bank-performance" },
  { page: "dashboard", path: "/api/loans", query: { pageSize: "200" } },
  { page: "dashboard", path: "/api/bank-orders", query: { pageSize: "100" } },
  { page: "dashboard", path: "/api/settlements", query: { pageSize: "100" } },
  { page: "dashboard", path: "/api/customers", query: { pageSize: "500" } },
  { page: "reference", path: "/api/banks" },
  { page: "reference", path: "/api/users", query: { pageSize: "200" } },
  { page: "reference", path: "/api/teams" },
  // Task 4.5 moved this page to server-driven paging: it now sends `page` and a
  // fixed `pageSize` of 25, plus whichever of `search`/`status`/`bankId`/`kyc`
  // the user has set. `kyc` is the parameter Task 4.5 added to `listQuery` so
  // the KYC filter would keep filtering the whole book rather than one page.
  { page: "customers", path: "/api/customers", query: { page: "1", pageSize: "25" } },
  {
    page: "customers (filtered)",
    path: "/api/customers",
    query: { page: "2", pageSize: "25", search: "Test", status: "Active", kyc: "Pending" },
  },
  { page: "loans", path: "/api/loans" },
  { page: "banks", path: "/api/loans", query: { pageSize: "500" } },
  { page: "banks", path: "/api/settlements", query: { pageSize: "500" } },
  { page: "bank-orders", path: "/api/bank-orders" },
  { page: "disbursement", path: "/api/disbursements" },
  { page: "settlements", path: "/api/settlements" },
  { page: "transactions", path: "/api/transactions" },
  { page: "ledger", path: "/api/ledger" },
  { page: "documents", path: "/api/documents" },
  { page: "employees", path: "/api/users", query: { pageSize: "200" } },
  { page: "employees", path: "/api/roles" },
  { page: "recycle-bin", path: "/api/recycle-bin" },
  { page: "notifications", path: "/api/notifications" },
  { page: "topbar", path: "/api/customers", query: { search: "test", pageSize: "5" } },
];

describe("every request the frontend makes succeeds", () => {
  it.each(FRONTEND_CALLS)("$page → $path", async ({ path, query }) => {
    const res = await request(ctx.app).get(path).query(query ?? {}).set(auth());
    expect(res.status, `${path} ${JSON.stringify(query ?? {})} → ${JSON.stringify(res.body)}`).toBe(
      200,
    );
    expect(res.body).toHaveProperty("data");
  });

  it("accepts the 500-row reference loads the pages request", async () => {
    // A 200-row cap made these 422 and every affected table render empty.
    for (const path of ["/api/customers", "/api/loans", "/api/settlements"]) {
      const res = await request(ctx.app).get(path).query({ pageSize: "500" }).set(auth());
      expect(res.status, path).toBe(200);
    }
    const tooBig = await request(ctx.app)
      .get("/api/customers")
      .query({ pageSize: "5000" })
      .set(auth());
    expect(tooBig.status).toBe(422);
  });
});

describe("customer detail actually filters by customer", () => {
  it("honours ?customerId on loans, documents and transactions", async () => {
    const other = await request(ctx.app)
      .post("/api/customers")
      .set(auth())
      .send(customerPayload(bank.id, "CONTRACT-2", { name: "Other Customer" }));
    await request(ctx.app).post("/api/loans").set(auth()).send({
      customerId: other.body.data.id,
      bankId: bank.id,
      loanType: "Gold Loan",
      amountRequested: 90000,
    });

    const mine = await request(ctx.app).get("/api/loans").query({ customerId }).set(auth());
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBe(1);
    expect(mine.body.data[0].customerId).toBe(customerId);

    // Without the filter both loans are visible, which is what the detail page
    // would have shown before customerId was added to the allow-list.
    const all = await request(ctx.app).get("/api/loans").set(auth());
    expect(all.body.data.length).toBeGreaterThan(1);
  });
});

describe("response shapes match the frontend types", () => {
  it("customer carries code, bankReferenceId and only masked aadhaar", async () => {
    const res = await request(ctx.app).get(`/api/customers/${customerId}`).set(auth());
    const c = res.body.data;
    for (const key of ["id", "code", "bankId", "bankReferenceId", "name", "mobile", "status"]) {
      expect(c, `missing ${key}`).toHaveProperty(key);
    }
    expect(c).toHaveProperty("aadhaarLast4");
    expect(c).not.toHaveProperty("aadhaar");
    expect(typeof c.monthlyIncome).toBe("string"); // numeric arrives as a string
  });

  it("loan uses loanType/assignedUserId, not the demo's type/assignedTo", async () => {
    const res = await request(ctx.app).get(`/api/loans/${loanId}`).set(auth());
    const l = res.body.data;
    expect(l).toHaveProperty("loanType");
    expect(l).toHaveProperty("assignedUserId");
    expect(l).toHaveProperty("code");
    expect(l).not.toHaveProperty("type");
    expect(l).not.toHaveProperty("assignedTo");
  });

  it("user list exposes roleName and assignedBanks and never a password hash", async () => {
    const res = await request(ctx.app).get("/api/users").query({ pageSize: "200" }).set(auth());
    const u = res.body.data[0];
    expect(u).toHaveProperty("roleName");
    expect(u).toHaveProperty("assignedBanks");
    expect(Array.isArray(u.assignedBanks)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("$argon2");
  });

  it("dashboard stats return the snake_case keys the page reads", async () => {
    const res = await request(ctx.app).get("/api/dashboard/stats").set(auth());
    for (const key of [
      "total_customers",
      "active_customers",
      "pending_loans",
      "approved_loans",
      "disbursed_value",
      "commission_earned",
      "pending_settlement",
      "open_orders",
      "credited_disbursements",
      "successful_transactions",
      "pending_documents",
      "active_banks",
    ]) {
      expect(res.body.data, `missing ${key}`).toHaveProperty(key);
    }
  });

  it("recycle bin entries expose daysRemaining and withhold the snapshot", async () => {
    const doomed = await request(ctx.app)
      .post("/api/customers")
      .set(auth())
      .send(customerPayload(bank.id, "CONTRACT-BIN"));
    await request(ctx.app)
      .delete(`/api/customers/${doomed.body.data.id}`)
      .set(auth())
      .expect(204);

    const res = await request(ctx.app).get("/api/recycle-bin").set(auth());
    const entry = res.body.data.find(
      (e: { recordId: string }) => e.recordId === doomed.body.data.id,
    );
    expect(entry).toBeDefined();
    expect(entry).toHaveProperty("label");
    expect(typeof entry.daysRemaining).toBe("number");
    expect(entry.snapshot).toBeUndefined();
  });

  it("roles come back with their permission key list for the UI to gate on", async () => {
    const res = await request(ctx.app).get("/api/roles").set(auth());
    const superAdmin = res.body.data.find((r: { key: string }) => r.key === "super_admin");
    expect(superAdmin).toBeDefined();
    expect(Array.isArray(superAdmin.permissions)).toBe(true);
    expect(superAdmin.permissions).toContain("system.access_all_banks");
  });

  it("notifications answer with an empty list rather than a 404", async () => {
    const res = await request(ctx.app).get("/api/notifications").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.unread).toBe(0);
  });
});
