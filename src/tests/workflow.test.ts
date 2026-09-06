import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  customerPayload,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import * as schema from "../db/schema/index.js";

let ctx: TestContext;
let bankA: { id: string; code: string };
let bankB: { id: string; code: string };
let superToken: string;
let superAdmin: { id: string; email: string; password: string };

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  ctx = await createTestContext();
  bankA = await createBank(ctx.db, "Workflow Bank A");
  bankB = await createBank(ctx.db, "Workflow Bank B");
  superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(superAdmin.email, superAdmin.password);
}, 90_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("admin cannot escalate — the brief's core restriction", () => {
  let adminToken: string;

  beforeAll(async () => {
    const admin = await createUser(ctx.db, { roleKey: "admin" });
    adminToken = await login(admin.email, admin.password);
  });

  it("cannot create another Admin", async () => {
    const adminRole = await roleByKey(ctx.db, "admin");
    const res = await request(ctx.app)
      .post("/api/users")
      .set(auth(adminToken))
      .send({
        name: "Second Admin",
        email: "second.admin@risenext.test",
        employeeCode: "EMP-9001",
        roleId: adminRole.id,
      });
    expect(res.status).toBe(403);
  });

  it("cannot create a Super Admin", async () => {
    const superRole = await roleByKey(ctx.db, "super_admin");
    const res = await request(ctx.app)
      .post("/api/users")
      .set(auth(adminToken))
      .send({
        name: "Sneaky Super",
        email: "sneaky@risenext.test",
        employeeCode: "EMP-9002",
        roleId: superRole.id,
      });
    expect(res.status).toBe(403);
  });

  it("CAN create a Manager", async () => {
    const managerRole = await roleByKey(ctx.db, "manager");
    const res = await request(ctx.app)
      .post("/api/users")
      .set(auth(adminToken))
      .send({
        name: "New Manager",
        email: "new.manager@risenext.test",
        employeeCode: "EMP-9003",
        roleId: managerRole.id,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("cannot modify an existing Super Admin", async () => {
    const res = await request(ctx.app)
      .patch(`/api/users/${superAdmin.id}`)
      .set(auth(adminToken))
      .send({ name: "Hijacked Super Admin" });
    expect(res.status).toBe(403);
  });

  it("cannot promote an existing Manager to Admin", async () => {
    const managerRole = await roleByKey(ctx.db, "manager");
    const adminRole = await roleByKey(ctx.db, "admin");

    const created = await request(ctx.app)
      .post("/api/users")
      .set(auth(adminToken))
      .send({
        name: "Promotable",
        email: "promotable@risenext.test",
        employeeCode: "EMP-9004",
        roleId: managerRole.id,
      });
    expect(created.status).toBe(201);

    const promoted = await request(ctx.app)
      .patch(`/api/users/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ roleId: adminRole.id });
    expect(promoted.status).toBe(403);
  });

  it("cannot mint a role more powerful than itself", async () => {
    const res = await request(ctx.app)
      .post("/api/roles")
      .set(auth(adminToken))
      .send({
        key: "shadow_owner",
        name: "Shadow Owner",
        level: 5,
        permissions: ["system.manage_any_user"],
      });
    expect(res.status).toBe(403);
  });

  it("never returns a password hash from the users endpoint", async () => {
    const res = await request(ctx.app).get("/api/users").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("$argon2");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });
});

describe("roles are configurable, not hard-coded", () => {
  it("creates a custom role, grants it permissions, and enforces them", async () => {
    const created = await request(ctx.app)
      .post("/api/roles")
      .set(auth(superToken))
      .send({
        key: "collections_agent",
        name: "Collections Agent",
        level: 45,
        permissions: ["customers.view", "transactions.view"],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const user = await createUser(ctx.db, {
      roleKey: "collections_agent",
      bankIds: [bankA.id],
    });
    const token = await login(user.email, user.password);

    await request(ctx.app).get("/api/customers").set(auth(token)).expect(200);
    // Not granted: creating customers.
    await request(ctx.app)
      .post("/api/customers")
      .set(auth(token))
      .send(customerPayload(bankA.id, "CUSTOM-ROLE-1"))
      .expect(403);
  });

  it("keeps the role id stable across a rename", async () => {
    const [role] = await ctx.db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.key, "collections_agent"));

    const renamed = await request(ctx.app)
      .patch(`/api/roles/${role!.id}`)
      .set(auth(superToken))
      .send({ name: "Recovery Officer" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.id).toBe(role!.id);
    expect(renamed.body.data.key).toBe("collections_agent");
  });

  it("refuses to delete a role that still has users", async () => {
    const [role] = await ctx.db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.key, "collections_agent"));
    const res = await request(ctx.app)
      .delete(`/api/roles/${role!.id}`)
      .set(auth(superToken));
    expect(res.status).toBe(409);
  });
});

describe("funding / LOC workflow", () => {
  let customerId: string;
  let loanId: string;

  it("creates a loan against a customer of the same bank", async () => {
    const customer = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankA.id, "FLOW-001"));
    expect(customer.status).toBe(201);
    customerId = customer.body.data.id;

    const loan = await request(ctx.app)
      .post("/api/loans")
      .set(auth(superToken))
      .send({
        customerId,
        bankId: bankA.id,
        loanType: "Business Loan",
        amountRequested: 500000,
        status: "Submitted",
      });
    expect(loan.status, JSON.stringify(loan.body)).toBe(201);
    expect(loan.body.data.code).toMatch(/^LN-\d+$/);
    loanId = loan.body.data.id;
  });

  it("rejects a loan whose customer belongs to a different bank", async () => {
    const res = await request(ctx.app)
      .post("/api/loans")
      .set(auth(superToken))
      .send({
        customerId,
        bankId: bankB.id,
        loanType: "Personal Loan",
        amountRequested: 100000,
      });
    expect(res.status).toBe(400);
  });

  it("records bank-handled verification when it is not required", async () => {
    const res = await request(ctx.app)
      .post(`/api/loans/${loanId}/verification`)
      .set(auth(superToken))
      .send({ required: false });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.handledByBank).toBe(true);
    expect(res.body.data.status).toBe("Verified");
    expect(res.body.data.result).toMatch(/requesting bank/i);
  });

  it("demands a service provider when verification IS required", async () => {
    const customer = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankA.id, "FLOW-002"));
    const loan = await request(ctx.app)
      .post("/api/loans")
      .set(auth(superToken))
      .send({
        customerId: customer.body.data.id,
        bankId: bankA.id,
        loanType: "Gold Loan",
        amountRequested: 200000,
      });

    const missingProvider = await request(ctx.app)
      .post(`/api/loans/${loan.body.data.id}/verification`)
      .set(auth(superToken))
      .send({ required: true });
    expect(missingProvider.status).toBe(400);

    const provider = await request(ctx.app)
      .post("/api/service-providers")
      .set(auth(superToken))
      .send({ name: "Acme Field Verification", providerType: "Field Verification" });
    expect(provider.status).toBe(201);

    const ok = await request(ctx.app)
      .post(`/api/loans/${loan.body.data.id}/verification`)
      .set(auth(superToken))
      .send({ required: true, serviceProviderId: provider.body.data.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe("Requested");
    expect(ok.body.data.handledByBank).toBe(false);
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ADDED by Task 5.2 / 5.7 — DECISIONS.md D-057, D-060
   * ───────────────────────────────────────────────────────────────────────────
   *
   * The loan created above is `Submitted`, and the test below used to disburse
   * straight against it. `Submitted → Disbursed` is not an edge of the ratified
   * machine (BUSINESS_FLOW.md §3.3), so the loan is now walked through the real
   * workflow first.
   *
   * This is a CORRECTION, not a weakening. The old fixture was only viable
   * because nothing linked the two stages: BUSINESS_FLOW.md:707 already recorded
   * that the end-to-end test "never asserts that the loan status changed. The
   * name overstates what is verified." Both halves of that are now fixed — the
   * walk below asserts every intermediate status persists, and the disbursement
   * test asserts the advance it is named for.
   */
  it("walks the loan through the ratified state machine to Approved", async () => {
    for (const status of ["Under Review", "Approved"]) {
      const step = await request(ctx.app)
        .post(`/api/loans/${loanId}/approve`)
        .set(auth(superToken))
        .send({ status, ...(status === "Approved" ? { amountApproved: 50000 } : {}) });
      expect(step.status, JSON.stringify(step.body)).toBe(200);
      expect(step.body.data.status).toBe(status);
    }

    // The approve route stamps the approver; nothing else does (D-060 clause 1,
    // already shipped and deliberately not reimplemented by 5.7).
    const [row] = await ctx.db.select().from(schema.loans).where(eq(schema.loans.id, loanId));
    expect(row!.status).toBe("Approved");
    expect(row!.approvedBy).toBe(superAdmin.id);
    expect(row!.approvedAt).not.toBeNull();
  });

  it("runs disbursement, settlement and transaction end to end", async () => {
    /*
     * UPDATED 2026-09-05, Task 7.3 (D-066).
     *
     * This request used to carry `status: "Credited"` and expect a 201. That is
     * now a 422: `initialStatuses` admits only `In Transit`, because creating a
     * row already Credited is an approval performed on `disbursements.create`
     * alone — a permission Manager holds and which does not include approving.
     *
     * The end-to-end path is unchanged in substance; it now goes through the
     * route that actually owns the transition, which is what makes the
     * `approved_by`/`approved_at` stamping below real.
     */
    const disbursement = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(superToken))
      .send({
        loanId,
        customerId,
        bankId: bankA.id,
        amount: 500000,
        utr: "TESTUTR0001",
        mode: "RTGS",
      });
    expect(disbursement.status, JSON.stringify(disbursement.body)).toBe(201);
    expect(disbursement.body.data.code).toMatch(/^DSB-\d+$/);
    expect(disbursement.body.data.status).toBe("In Transit");

    // The UTR was recorded at creation, so `->Credited` satisfies its guard.
    const credited = await request(ctx.app)
      .post(`/api/disbursements/${disbursement.body.data.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Credited" });
    expect(credited.status, JSON.stringify(credited.body)).toBe(200);
    expect(credited.body.data.status).toBe("Credited");

    // Task 5.7 — the cross-stage side effect this test is named for. Before it,
    // recording a disbursement left the loan where it was forever, so
    // `dashboard/stats.disbursed_value` was a permanent zero no matter how much
    // money the disbursements table said had moved.
    const [advanced] = await ctx.db
      .select()
      .from(schema.loans)
      .where(eq(schema.loans.id, loanId));
    expect(advanced!.status).toBe("Disbursed");

    // A repeated UTR is a double-entry, not a valid second payment.
    const duplicateUtr = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(superToken))
      .send({
        loanId,
        customerId,
        bankId: bankA.id,
        amount: 500000,
        utr: "testutr0001",
        mode: "RTGS",
      });
    expect(duplicateUtr.status).toBe(409);

    const settlement = await request(ctx.app)
      .post("/api/settlements")
      .set(auth(superToken))
      .send({
        bankId: bankA.id,
        period: "May 2026",
        cases: 1,
        grossCommission: 10000,
        tds: 500,
        netPayable: 9500,
      });
    expect(settlement.status, JSON.stringify(settlement.body)).toBe(201);

    const badArithmetic = await request(ctx.app)
      .post("/api/settlements")
      .set(auth(superToken))
      .send({
        bankId: bankA.id,
        period: "June 2026",
        grossCommission: 10000,
        tds: 500,
        netPayable: 9000,
      });
    // Task 8.6 moved this from a bare 400 to a 422 carrying
    // `details: [{ path: "netPayable" }]`, so the frontend's `lib/field-errors.ts`
    // lands the refusal on the control the operator can correct (D-031).
    expect(badArithmetic.status, JSON.stringify(badArithmetic.body)).toBe(422);
    expect(badArithmetic.body.error.details?.[0]?.path).toBe("netPayable");

    const txn = await request(ctx.app)
      .post("/api/transactions")
      .set(auth(superToken))
      .send({
        customerId,
        bankId: bankA.id,
        loanId,
        disbursementId: disbursement.body.data.id,
        amount: 500000,
        commission: 10000,
        txnType: "Disbursement",
        reference: "TESTUTR0001",
      });
    expect(txn.status, JSON.stringify(txn.body)).toBe(201);
    expect(txn.body.data.code).toMatch(/^TXN-\d+$/);

    /*
     * UPDATED 2026-09-06, Task 8.1 (D-066).
     *
     * The create above used to carry `status: "Success"`. `initialStatuses` now
     * admits only `Pending`: Manager holds `transactions.create` and NOT
     * `transactions.edit`, so minting a Success transaction was an edit-level
     * outcome on a create permission. Transactions have no approve route, so
     * PATCH is the transition — guarded by `transitionColumn`.
     */
    const settled = await request(ctx.app)
      .patch(`/api/transactions/${txn.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Success" });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);
    expect(settled.body.data.status).toBe("Success");
  });

  it("scopes every operational resource, not just customers", async () => {
    const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankB.id] });
    const token = await login(executive.email, executive.password);

    const list = await request(ctx.app).get("/api/loans").set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);

    const direct = await request(ctx.app).get(`/api/loans/${loanId}`).set(auth(token));
    expect(direct.status).toBe(404);

    for (const path of ["/api/disbursements", "/api/transactions", "/api/bank-orders"]) {
      const res = await request(ctx.app).get(path).set(auth(token));
      expect(res.status, path).toBe(200);
      expect(res.body.data, path).toHaveLength(0);
    }
  });
});

describe("dashboard reflects the database, not fixtures", () => {
  it("returns real counts for a super admin and zeroes for an unassigned user", async () => {
    const real = await request(ctx.app).get("/api/dashboard/stats").set(auth(superToken));
    expect(real.status, JSON.stringify(real.body)).toBe(200);
    expect(Number(real.body.data.total_customers)).toBeGreaterThan(0);
    expect(real.body.meta.scoped).toBe(false);

    const orphan = await createUser(ctx.db, { roleKey: "manager", bankIds: [] });
    const token = await login(orphan.email, orphan.password);
    const empty = await request(ctx.app).get("/api/dashboard/stats").set(auth(token));
    expect(empty.status).toBe(200);
    expect(Number(empty.body.data.total_customers)).toBe(0);
    expect(Number(empty.body.data.disbursed_value)).toBe(0);
  });
});

describe("recycle bin round trip", () => {
  it("deletes, lists, restores, then permanently deletes with confirmation", async () => {
    const created = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankA.id, "BIN-FLOW-1"));
    const customerId = created.body.data.id as string;

    await request(ctx.app)
      .delete(`/api/customers/${customerId}`)
      .set(auth(superToken))
      .expect(204);

    const bin = await request(ctx.app).get("/api/recycle-bin").set(auth(superToken));
    expect(bin.status).toBe(200);
    const entry = (bin.body.data as { id: string; recordId: string; daysRemaining: number }[]).find(
      (e) => e.recordId === customerId,
    );
    expect(entry).toBeDefined();
    expect(entry!.daysRemaining).toBeGreaterThan(28);

    const restored = await request(ctx.app)
      .post(`/api/recycle-bin/${entry!.id}/restore`)
      .set(auth(superToken));
    expect(restored.status).toBe(200);

    const back = await request(ctx.app)
      .get(`/api/customers/${customerId}`)
      .set(auth(superToken));
    expect(back.status).toBe(200);

    // Delete again, then purge for real.
    await request(ctx.app)
      .delete(`/api/customers/${customerId}`)
      .set(auth(superToken))
      .expect(204);
    const bin2 = await request(ctx.app).get("/api/recycle-bin").set(auth(superToken));
    const entry2 = (bin2.body.data as { id: string; recordId: string }[]).find(
      (e) => e.recordId === customerId,
    );

    // Missing confirmation is refused.
    await request(ctx.app)
      .post(`/api/recycle-bin/${entry2!.id}/permanent-delete`)
      .set(auth(superToken))
      .send({})
      .expect(422);

    await request(ctx.app)
      .post(`/api/recycle-bin/${entry2!.id}/permanent-delete`)
      .set(auth(superToken))
      .send({ confirm: true })
      .expect(200);

    const gone = await ctx.db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId));
    expect(gone).toHaveLength(0);

    // History survives the purge.
    const audit = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.recordId, customerId));
    expect(audit.map((a) => a.action)).toContain("permanently_deleted");
  });

  it("refuses to purge a record belonging to another bank", async () => {
    const created = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankB.id, "BIN-FLOW-2"));
    await request(ctx.app)
      .delete(`/api/customers/${created.body.data.id}`)
      .set(auth(superToken))
      .expect(204);

    const bin = await request(ctx.app).get("/api/recycle-bin").set(auth(superToken));
    const entry = (bin.body.data as { id: string; recordId: string }[]).find(
      (e) => e.recordId === created.body.data.id,
    );

    const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bankA.id] });
    const token = await login(manager.email, manager.password);

    const res = await request(ctx.app)
      .post(`/api/recycle-bin/${entry!.id}/restore`)
      .set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe("excel import", () => {
  async function workbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Customers");
    sheet.columns = [
      { header: "Bank Code *", key: "bankCode" },
      { header: "Bank Reference ID *", key: "bankReferenceId" },
      { header: "Customer Name *", key: "name" },
      { header: "Mobile *", key: "mobile" },
      { header: "Email", key: "email" },
      { header: "Monthly Income", key: "monthlyIncome" },
    ];
    rows.forEach((r) => sheet.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("validates and previews without writing anything, then imports only valid rows", async () => {
    const buffer = await workbookBuffer([
      { bankCode: bankA.code, bankReferenceId: "XL-001", name: "Valid One", mobile: "9000000001", monthlyIncome: 30000 },
      { bankCode: bankA.code, bankReferenceId: "XL-002", name: "Valid Two", mobile: "9000000002" },
      { bankCode: bankA.code, bankReferenceId: "XL-003", name: "Bad Mobile", mobile: "123" },
      { bankCode: "BNK-NOPE", bankReferenceId: "XL-004", name: "Unknown Bank", mobile: "9000000004" },
      { bankCode: bankA.code, bankReferenceId: "XL-001", name: "Dup In File", mobile: "9000000005" },
      { bankCode: bankA.code, bankReferenceId: "FLOW-001", name: "Dup In Db", mobile: "9000000006" },
    ]);

    const before = await ctx.db.select().from(schema.customers);

    const upload = await request(ctx.app)
      .post("/api/imports/customers")
      .set(auth(superToken))
      .attach("file", buffer, {
        filename: "import.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    expect(upload.body.data.total).toBe(6);
    expect(upload.body.data.valid).toBe(2);
    expect(upload.body.data.invalid).toBe(2);
    expect(upload.body.data.duplicate).toBe(2);

    // Preview must not have touched the customers table.
    const during = await ctx.db.select().from(schema.customers);
    expect(during).toHaveLength(before.length);

    const confirmed = await request(ctx.app)
      .post(`/api/imports/${upload.body.data.batchId}/confirm`)
      .set(auth(superToken))
      .send({});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.data.imported).toBe(2);
    expect(confirmed.body.data.skipped).toBe(4);

    const after = await ctx.db.select().from(schema.customers);
    expect(after).toHaveLength(before.length + 2);

    // Re-confirming the same batch must not double-insert.
    const again = await request(ctx.app)
      .post(`/api/imports/${upload.body.data.batchId}/confirm`)
      .set(auth(superToken))
      .send({});
    expect(again.status).toBe(409);
  });

  it("rejects rows for a bank the importer is not assigned to", async () => {
    const executive = await createUser(ctx.db, { roleKey: "team_leader", bankIds: [bankA.id] });
    const token = await login(executive.email, executive.password);

    const buffer = await workbookBuffer([
      { bankCode: bankA.code, bankReferenceId: "XL-MINE", name: "Mine", mobile: "9111111111" },
      { bankCode: bankB.code, bankReferenceId: "XL-THEIRS", name: "Theirs", mobile: "9222222222" },
    ]);

    const upload = await request(ctx.app)
      .post("/api/imports/customers")
      .set(auth(token))
      .attach("file", buffer, {
        filename: "import.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    expect(upload.status).toBe(201);
    expect(upload.body.data.valid).toBe(1);
    expect(upload.body.data.invalid).toBe(1);

    const rejected = (upload.body.data.preview as { status: string; errors: { message: string }[] | null }[])
      .find((r) => r.status === "invalid");
    expect(rejected?.errors?.[0]?.message).toMatch(/not assigned/i);
  });

  it("serves a template whose headers match the validator", async () => {
    const res = await request(ctx.app)
      .get("/api/imports/template/customers")
      .set(auth(superToken))
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const headers = wb.worksheets[0]!.getRow(1).values as string[];
    expect(headers.join("|")).toContain("Bank Reference ID *");
    expect(headers.join("|")).toContain("Mobile *");
  });
});
