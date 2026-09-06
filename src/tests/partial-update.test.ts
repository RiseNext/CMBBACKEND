import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import { auditLogs, banks, customers, ledgerEntries, loans, settlements, users } from "../db/schema/index.js";

/**
 * PARTIAL UPDATES DO NOT INVENT VALUES — BUG-036
 *
 * `schema.partial()` does not remove `.default(...)` in zod 4: the field becomes
 * `ZodOptional<ZodDefault<…>>` and the default is still applied when the key is
 * absent. Every PATCH handler then wrote those invented values — either through
 * an `input.x !== undefined` guard the injection defeats, or, in
 * `createScopedResource`, by spreading the parsed body wholesale.
 *
 * Measured before the fix, over real HTTP:
 *   - `{name}` on an employee zeroed `target` and `achieved`, and on an
 *     **Inactive** employee flipped `status` back to Active — login went 403 → 200.
 *   - A bank pause wiped `commissionRate` and `productsOffered`.
 *   - A customer edit reverted `kyc` from Verified to Pending.
 *   - A `{notes}` PATCH on an Approved loan zeroed every money column and reset
 *     its status to Draft.
 *
 * `lib/zod.ts::patchSchema` strips the defaults before `.partial()`. These tests
 * assert **database state**, not status codes: a 200 was never the problem.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let superToken: string;
let execRoleId: string;
let adminRoleId: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

let seq = 0;

/** A fully populated employee — every field a partial PATCH could disturb. */
async function employee(overrides: Record<string, unknown> = {}) {
  seq += 1;
  const email = `partial${seq}@risenext.test`;
  const created = await request(ctx.app)
    .post("/api/users")
    .set(bearer(superToken))
    .send({
      name: `Employee ${seq}`,
      email,
      phone: "9848011111",
      employeeCode: `EMP-95${String(seq).padStart(2, "0")}`,
      roleId: execRoleId,
      branch: "Hyderabad",
      target: 8_000_000,
      achieved: 3_250_000,
      avatarColor: "#1d4ed8",
      bankIds: [bank.id],
    });
  const id = created.body.data.id as string;
  await ctx.db.update(users).set({ mustChangePassword: false, ...overrides }).where(eq(users.id, id));
  return { id, email, password: created.body.temporaryPassword as string };
}

async function userRow(id: string) {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
}

/** Asserts that everything except `changed` survived the request untouched. */
function preserved(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changed: string[],
) {
  const watched = [
    "name", "email", "phone", "employeeCode", "roleId", "branch", "status",
    "target", "achieved", "avatarColor", "mustChangePassword", "passwordHash",
    "failedLoginAttempts", "deletedAt",
  ];
  for (const key of watched) {
    if (changed.includes(key)) continue;
    expect(JSON.stringify(after[key]), `${key} must be untouched`).toBe(
      JSON.stringify(before[key]),
    );
  }
}

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Partial Update Bank");
  const sa = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (await login(sa.email, sa.password)).body.accessToken;
  execRoleId = (await roleByKey(ctx.db, "executive")).id;
  adminRoleId = (await roleByKey(ctx.db, "admin")).id;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ------------------------------------------------------------------ group A */

describe("A — a single-field user PATCH touches exactly that field", () => {
  it("1. { name } preserves status, target, achieved and everything else", async () => {
    const e = await employee();
    const before = await userRow(e.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "Changed Name" });

    expect(res.status).toBe(200);
    const after = await userRow(e.id);
    expect(after.name).toBe("Changed Name");
    expect(after.target).toBe(8_000_000);
    expect(after.achieved).toBe(3_250_000);
    expect(after.status).toBe("Active");
    preserved(before as never, after as never, ["name"]);
  });

  it("2. { phone } preserves target and achieved", async () => {
    const e = await employee();
    const before = await userRow(e.id);
    await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ phone: "9999911111" });
    const after = await userRow(e.id);
    expect(after.phone).toBe("9999911111");
    expect(after.target).toBe(8_000_000);
    expect(after.achieved).toBe(3_250_000);
    preserved(before as never, after as never, ["phone"]);
  });

  it("3. { email } preserves target and achieved", async () => {
    const e = await employee();
    const before = await userRow(e.id);
    await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ email: "moved.address@risenext.test" });
    const after = await userRow(e.id);
    expect(after.email).toBe("moved.address@risenext.test");
    expect(after.target).toBe(8_000_000);
    expect(after.achieved).toBe(3_250_000);
    preserved(before as never, after as never, ["email"]);
  });

  it("4. { employeeCode } preserves target and achieved", async () => {
    const e = await employee();
    const before = await userRow(e.id);
    await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ employeeCode: "EMP-RENUMBERED" });
    const after = await userRow(e.id);
    expect(after.employeeCode).toBe("EMP-RENUMBERED");
    expect(after.target).toBe(8_000_000);
    expect(after.achieved).toBe(3_250_000);
    preserved(before as never, after as never, ["employeeCode"]);
  });

  it("5. { roleId: the current role } changes nothing at all", async () => {
    const e = await employee();
    const before = await userRow(e.id);
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ roleId: execRoleId });
    expect(res.status).toBe(200);
    const after = await userRow(e.id);
    preserved(before as never, after as never, []);
  });

  it("6. { status: the current status } changes nothing at all", async () => {
    const e = await employee();
    const before = await userRow(e.id);
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ status: "Active" });
    expect(res.status).toBe(200);
    const after = await userRow(e.id);
    preserved(before as never, after as never, []);
  });

  it("7. THE HEADLINE — an omitted status stays omitted; a revoked account stays revoked", async () => {
    const e = await employee({ status: "Inactive" });
    // Precondition: access really is revoked.
    expect((await login(e.email, e.password)).status).toBe(403);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "Renamed While Revoked" });

    expect(res.status).toBe(200);
    const after = await userRow(e.id);
    expect(after.name).toBe("Renamed While Revoked");
    expect(after.status).toBe("Inactive");
    expect(after.target).toBe(8_000_000);
    expect(after.achieved).toBe(3_250_000);
    // The decisive assertion: renaming must not hand access back.
    expect((await login(e.email, e.password)).status).toBe(403);
  });

  it("8. a full-form echo of every stored value is still a valid no-op", async () => {
    const e = await employee();
    const before = await userRow(e.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({
        name: before.name,
        email: before.email,
        phone: before.phone,
        employeeCode: before.employeeCode,
        roleId: before.roleId,
        branch: before.branch,
        status: before.status,
        target: before.target,
        achieved: before.achieved,
        avatarColor: before.avatarColor,
      });

    expect(res.status).toBe(200);
    preserved(before as never, await userRow(e.id), []);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — explicit changes still work exactly as before", () => {
  it("9. an explicit status change is applied", async () => {
    const e = await employee();
    const off = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ status: "Inactive" });
    expect(off.status).toBe(200);
    expect((await userRow(e.id)).status).toBe("Inactive");
    expect((await login(e.email, e.password)).status).toBe(403);

    const on = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ status: "Active" });
    expect(on.status).toBe(200);
    expect((await userRow(e.id)).status).toBe("Active");
    // ...and the round trip did not cost the employee their figures.
    expect((await userRow(e.id)).target).toBe(8_000_000);
    expect((await userRow(e.id)).achieved).toBe(3_250_000);
  });

  it("9b. explicit target and achieved values are still written", async () => {
    const e = await employee();
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ target: 12_000_000, achieved: 250 });
    expect(res.status).toBe(200);
    const after = await userRow(e.id);
    expect(after.target).toBe(12_000_000);
    expect(after.achieved).toBe(250);
  });

  it("9c. an explicit zero is honoured — it is a real value, not an absent one", async () => {
    const e = await employee();
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ target: 0 });
    expect(res.status).toBe(200);
    expect((await userRow(e.id)).target).toBe(0);
    // ...and achieved, which was NOT sent, survived.
    expect((await userRow(e.id)).achieved).toBe(3_250_000);
  });

  it("10. an explicit role change is applied", async () => {
    const e = await employee();
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ roleId: adminRoleId });
    expect(res.status).toBe(200);
    const after = await userRow(e.id);
    expect(after.roleId).toBe(adminRoleId);
    expect(after.target).toBe(8_000_000);
  });

  it("11. password behaviour is unchanged", async () => {
    const e = await employee();
    const before = await userRow(e.id);

    const weak = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ password: "short" });
    expect(weak.status).toBe(400);
    expect((await userRow(e.id)).passwordHash).toBe(before.passwordHash);

    const ok = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ password: "AdminSetThis2026" });
    expect(ok.status).toBe(200);
    const after = await userRow(e.id);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect((await login(e.email, "AdminSetThis2026")).status).toBe(200);
    // The password write must not have cost them their figures either.
    expect(after.target).toBe(8_000_000);
    expect(after.achieved).toBe(3_250_000);
  });

  it("12. mustChangePassword behaviour is unchanged", async () => {
    const e = await employee();
    expect((await userRow(e.id)).mustChangePassword).toBe(false);

    // A PATCH with no password must not touch the flag...
    await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "No Password Here" });
    expect((await userRow(e.id)).mustChangePassword).toBe(false);

    // ...and a PATCH that sets a password must still raise it.
    await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ password: "AdminSetThis2026" });
    expect((await userRow(e.id)).mustChangePassword).toBe(true);
  });

  it("13. the audit row no longer claims target/achieved changed", async () => {
    const e = await employee();
    await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "Audited Rename" });

    const rows = await ctx.db.select().from(auditLogs).where(eq(auditLogs.recordId, e.id));
    const changes = (rows[rows.length - 1]!.changes ?? {}) as Record<string, unknown>;
    expect(Object.keys(changes).sort()).toEqual(["name", "updatedAt"]);
    expect(changes).not.toHaveProperty("target");
    expect(changes).not.toHaveProperty("achieved");
    expect(changes).not.toHaveProperty("status");
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — SEC-003 / Task 2.1 protections are intact", () => {
  it("14. the sole active Super Admin can still rename themselves", async () => {
    const sa = await createUser(ctx.db, { roleKey: "super_admin" });
    await ctx.db.update(users).set({ target: 5_000_000 }).where(eq(users.id, sa.id));
    const token = (await login(sa.email, sa.password)).body.accessToken as string;

    const res = await request(ctx.app)
      .patch(`/api/users/${sa.id}`)
      .set(bearer(token))
      .send({ name: "Self Renamed" });

    expect(res.status).toBe(200);
    const after = await userRow(sa.id);
    expect(after.name).toBe("Self Renamed");
    // Not treated as a deactivation or a demotion...
    expect(after.status).toBe("Active");
    expect(after.target).toBe(5_000_000);
    // ...and the session still works.
    expect((await request(ctx.app).get("/api/users").set(bearer(token))).status).toBe(200);
  });

  it("14b. the self-guard and the last-super-admin invariant still refuse the real cases", async () => {
    const sa = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = (await login(sa.email, sa.password)).body.accessToken as string;

    const selfOff = await request(ctx.app)
      .patch(`/api/users/${sa.id}`)
      .set(bearer(token))
      .send({ status: "Inactive" });
    expect(selfOff.status).toBe(400);
    expect((await userRow(sa.id)).status).toBe("Active");

    const selfDemote = await request(ctx.app)
      .patch(`/api/users/${sa.id}`)
      .set(bearer(token))
      .send({ roleId: execRoleId });
    expect(selfDemote.status).toBe(400);
    expect((await userRow(sa.id)).roleId).not.toBe(execRoleId);
  });

  it("14c. `input.status ?? target.status` is now genuinely reachable", async () => {
    /*
     * Before BUG-036 was fixed, `input.status` was never undefined, so the
     * fallback at the assertSuperAdminRemains call site was dead code. It is now
     * the live path for any PATCH that omits `status`. An INACTIVE Super Admin
     * renamed while another active one exists must stay Inactive — proving the
     * fallback supplies the stored value rather than an invented "Active".
     */
    const dormant = await createUser(ctx.db, { roleKey: "super_admin", status: "Inactive" });
    const res = await request(ctx.app)
      .patch(`/api/users/${dormant.id}`)
      .set(bearer(superToken))
      .send({ name: "Dormant Super Admin" });

    expect(res.status).toBe(200);
    const after = await userRow(dormant.id);
    expect(after.name).toBe("Dormant Super Admin");
    // The critical bit: a rename must NOT return them to the protected population.
    expect(after.status).toBe("Inactive");
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — the same guarantee across every other PATCH surface", () => {
  it("15. a bank pause preserves commissionRate and productsOffered", async () => {
    const created = await request(ctx.app)
      .post("/api/banks")
      .set(bearer(superToken))
      .send({
        code: "PU-01",
        name: "Partner Bank",
        shortName: "PB",
        status: "Active",
        commissionRate: 3.5,
        productsOffered: ["Home Loan", "LAP", "Business Loan"],
      });
    const id = created.body.data.id as string;

    // Exactly what banks/page.tsx sends for pause/resume.
    const pause = await request(ctx.app)
      .patch(`/api/banks/${id}`)
      .set(bearer(superToken))
      .send({ status: "Paused" });
    expect(pause.status).toBe(200);

    const [after] = await ctx.db.select().from(banks).where(eq(banks.id, id)).limit(1);
    expect(after!.status).toBe("Paused");
    expect(Number(after!.commissionRate)).toBe(3.5);
    expect(after!.productsOffered).toEqual(["Home Loan", "LAP", "Business Loan"]);

    // ...and a rename does not un-pause it.
    await request(ctx.app)
      .patch(`/api/banks/${id}`)
      .set(bearer(superToken))
      .send({ name: "Renamed Partner" });
    const [renamed] = await ctx.db.select().from(banks).where(eq(banks.id, id)).limit(1);
    expect(renamed!.status).toBe("Paused");
    expect(Number(renamed!.commissionRate)).toBe(3.5);
  });

  it("16. a customer rename preserves monthlyIncome, kyc and status", async () => {
    const created = await request(ctx.app)
      .post("/api/customers")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        bankReferenceId: "PU-CUST-1",
        name: "Verified Customer",
        mobile: "9876543210",
        monthlyIncome: 250_000,
        kyc: "Verified",
        status: "Closed",
      });
    const id = created.body.data.id as string;

    const res = await request(ctx.app)
      .patch(`/api/customers/${id}`)
      .set(bearer(superToken))
      .send({ name: "Renamed Customer" });
    expect(res.status).toBe(200);

    const [after] = await ctx.db.select().from(customers).where(eq(customers.id, id)).limit(1);
    expect(after!.name).toBe("Renamed Customer");
    expect(Number(after!.monthlyIncome)).toBe(250_000);
    expect(after!.kyc).toBe("Verified");
    expect(after!.status).toBe("Closed");
  });

  it("17. a loan note preserves every monetary field and the status", async () => {
    const cust = await request(ctx.app)
      .post("/api/customers")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        bankReferenceId: "PU-CUST-2",
        name: "Loan Customer",
        mobile: "9876543211",
        monthlyIncome: 90_000,
        kyc: "Verified",
        status: "Active",
      });

    const created = await request(ctx.app)
      .post("/api/loans")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        customerId: cust.body.data.id,
        loanType: "Home Loan",
        amountRequested: 5_000_000,
        amountApproved: 4_500_000,
        interestRate: 8.75,
        tenureMonths: 240,
        emi: 39_500,
        processingFee: 25_000,
        commission: 45_000,
        /*
         * FIXTURE ONLY — changed from "Approved" by Task 5.2 (D-057).
         *
         * `Approved` is no longer a legal INITIAL status: `requests.create` is
         * held by roles that do not hold `requests.approve`, so accepting it on
         * create was the same privilege bypass D-056 closed on PATCH. Any
         * non-default status exercises this test's actual subject — that a
         * notes-only PATCH preserves the status and every money column — and
         * `Submitted` is one. No assertion is removed or loosened; the
         * expectation at the foot of the test moves with the fixture.
         */
        status: "Submitted",
        priority: "High",
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const res = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(bearer(superToken))
      .send({ notes: "Called the customer today" });
    expect(res.status).toBe(200);

    const [after] = await ctx.db.select().from(loans).where(eq(loans.id, id)).limit(1);
    expect(after!.notes).toBe("Called the customer today");
    expect(Number(after!.amountRequested)).toBe(5_000_000);
    expect(Number(after!.amountApproved)).toBe(4_500_000);
    expect(Number(after!.interestRate)).toBe(8.75);
    expect(after!.tenureMonths).toBe(240);
    expect(Number(after!.emi)).toBe(39_500);
    expect(Number(after!.processingFee)).toBe(25_000);
    expect(Number(after!.commission)).toBe(45_000);
    expect(after!.status).toBe("Submitted");
    expect(after!.priority).toBe("High");
  });

  it("18. a settlement note preserves netPayable and the status", async () => {
    const created = await request(ctx.app)
      .post("/api/settlements")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        period: "2026-08",
        cases: 42,
        grossCommission: 900_000,
        tds: 90_000,
        netPayable: 810_000,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;

    /*
     * UPDATED 2026-09-06, Tasks 8.2 / 8.3 (D-066).
     *
     * The create above used to carry `status: "Paid"`. `initialStatuses` now
     * admits only `Pending`, because creating a settlement already Paid is an
     * approval performed on `settlements.create` alone. Reaching Paid through
     * the route that owns the transition is what makes this case's real
     * assertion — that a notes-only PATCH does not disturb the money columns or
     * the status — worth anything.
     */
    const paid = await request(ctx.app)
      .post(`/api/settlements/${id}/approve`)
      .set(bearer(superToken))
      .send({ status: "Paid" });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);

    const res = await request(ctx.app)
      .patch(`/api/settlements/${id}`)
      .set(bearer(superToken))
      .send({ notes: "Remittance advice received" });
    expect(res.status).toBe(200);

    const [after] = await ctx.db.select().from(settlements).where(eq(settlements.id, id)).limit(1);
    expect(Number(after!.netPayable)).toBe(810_000);
    expect(Number(after!.grossCommission)).toBe(900_000);
    expect(Number(after!.tds)).toBe(90_000);
    expect(after!.cases).toBe(42);
    expect(after!.status).toBe("Paid");
  });

  it("19. a ledger entry edit preserves debit, credit and balance", async () => {
    /*
     * UPDATED 2026-09-06, Task 11.7.
     *
     * This case used to send `balance: 810_000` and assert it came back
     * unchanged. That premise is what 11.7 removes: `balance` is no longer
     * accepted from the client — a caller could previously assert any closing
     * balance they liked and the server wrote it — and is now computed from the
     * rows themselves inside the insert transaction.
     *
     * The property this case exists to protect is **BUG-036**: a PATCH that
     * mentions none of the money columns must not zero them. That is unchanged
     * and is still what is asserted; the balance is simply read from the server
     * after the create rather than dictated to it.
     */
    const created = await request(ctx.app)
      .post("/api/ledger")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        particulars: "Commission received for August",
        category: "Commission",
        debit: 0,
        credit: 810_000,
        party: "Partner Bank",
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    // Whatever the running balance is for this bank once the row lands — the
    // point is that the PATCH below does not disturb it.
    const balanceAfterCreate = Number(created.body.data.balance);
    expect(Number.isFinite(balanceAfterCreate)).toBe(true);

    const res = await request(ctx.app)
      .patch(`/api/ledger/${id}`)
      .set(bearer(superToken))
      .send({ particulars: "Commission received for August (revised note)" });
    expect(res.status).toBe(200);

    const [after] = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id)).limit(1);
    expect(after!.particulars).toBe("Commission received for August (revised note)");
    expect(Number(after!.debit)).toBe(0);
    expect(Number(after!.credit)).toBe(810_000);
    expect(Number(after!.balance)).toBe(balanceAfterCreate);
    expect(after!.category).toBe("Commission");
  });

  it("19b. `balance` is NOT accepted from the client — Task 11.7", async () => {
    // Pre-11.7 the server wrote whatever was sent, so a caller could assert a
    // closing balance of their choosing on the business's own book.
    const created = await request(ctx.app)
      .post("/api/ledger")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        particulars: "Attempted balance assertion",
        category: "Commission",
        debit: 0,
        credit: 100,
        balance: 99_999_999,
      });
    expect(created.status).toBe(201);
    expect(Number(created.body.data.balance)).not.toBe(99_999_999);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — validation and create-time defaults are untouched", () => {
  it("20. constraints from the base schema still apply on PATCH", async () => {
    const e = await employee();

    // min(0) on target
    const negative = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ target: -1 });
    expect(negative.status).toBe(422);

    // the status enum
    const badEnum = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ status: "Retired" });
    expect(badEnum.status).toBe(422);

    // uuid on roleId
    const badUuid = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ roleId: "not-a-uuid" });
    expect(badUuid.status).toBe(422);

    // email shape, and min(2) on name
    const badEmail = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ email: "nope" });
    expect(badEmail.status).toBe(422);

    const shortName = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "X" });
    expect(shortName.status).toBe(422);

    // Every rejection must have left the row alone.
    const after = await userRow(e.id);
    expect(after.target).toBe(8_000_000);
    expect(after.status).toBe("Active");
  });

  it("20b. scoped-resource constraints still apply on PATCH", async () => {
    const cust = await request(ctx.app)
      .post("/api/customers")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        bankReferenceId: "PU-CUST-3",
        name: "Validation Customer",
        mobile: "9876543212",
        monthlyIncome: 10_000,
        kyc: "Pending",
        status: "Active",
      });
    const loan = await request(ctx.app)
      .post("/api/loans")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        customerId: cust.body.data.id,
        loanType: "Personal Loan",
        amountRequested: 100_000,
        status: "Submitted",
      });
    const id = loan.body.data.id as string;

    const negative = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(bearer(superToken))
      .send({ amountApproved: -5 });
    expect(negative.status).toBe(422);

    const badStatus = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(bearer(superToken))
      .send({ status: "Vaporised" });
    expect(badStatus.status).toBe(422);

    const [after] = await ctx.db.select().from(loans).where(eq(loans.id, id)).limit(1);
    expect(after!.status).toBe("Submitted");
    expect(Number(after!.amountRequested)).toBe(100_000);
  });

  it("21. CREATE still applies every default it always did", async () => {
    // Users: status, target and achieved are omitted entirely.
    const created = await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({
        name: "Defaults On Create",
        email: "defaults@risenext.test",
        employeeCode: "EMP-DEFAULTS",
        roleId: execRoleId,
      });
    expect(created.status).toBe(201);
    const row = await userRow(created.body.data.id as string);
    expect(row.status).toBe("Active");
    expect(row.target).toBe(0);
    expect(row.achieved).toBe(0);

    // Banks: status, commissionRate and productsOffered are omitted.
    const bankRes = await request(ctx.app)
      .post("/api/banks")
      .set(bearer(superToken))
      .send({ code: "DEF-01", name: "Default Bank", shortName: "DB" });
    expect(bankRes.status).toBe(201);
    const [bankRow] = await ctx.db
      .select()
      .from(banks)
      .where(eq(banks.id, bankRes.body.data.id as string))
      .limit(1);
    expect(bankRow!.status).toBe("Active");
    expect(Number(bankRow!.commissionRate)).toBe(0);
    expect(bankRow!.productsOffered).toEqual([]);

    // Loans, through the factory: status and the money columns are omitted.
    const cust = await request(ctx.app)
      .post("/api/customers")
      .set(bearer(superToken))
      .send({
        bankId: bank.id,
        bankReferenceId: "PU-CUST-4",
        name: "Default Customer",
        mobile: "9876543213",
      });
    // customers: monthlyIncome, kyc and status omitted here too.
    const [custRow] = await ctx.db
      .select()
      .from(customers)
      .where(eq(customers.id, cust.body.data.id as string))
      .limit(1);
    expect(Number(custRow!.monthlyIncome)).toBe(0);
    expect(custRow!.kyc).toBe("Pending");
    expect(custRow!.status).toBe("Active");

    const loanRes = await request(ctx.app)
      .post("/api/loans")
      .set(bearer(superToken))
      .send({ bankId: bank.id, customerId: cust.body.data.id, loanType: "Gold Loan" });
    expect(loanRes.status).toBe(201);
    const [loanRow] = await ctx.db
      .select()
      .from(loans)
      .where(eq(loans.id, loanRes.body.data.id as string))
      .limit(1);
    expect(loanRow!.status).toBe("Draft");
    expect(Number(loanRow!.amountRequested)).toBe(0);
    expect(loanRow!.priority).toBe("Normal");
    expect(loanRow!.verificationRequired).toBe(false);
  });

  it("22. authorization is unchanged by the schema swap", async () => {
    const e = await employee();
    const exec = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
    const execToken = (await login(exec.email, exec.password)).body.accessToken as string;

    // No users.edit at all.
    const denied = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(execToken))
      .send({ name: "Nice Try" });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("forbidden");

    // An Admin may not reach a Super Admin.
    const admin = await createUser(ctx.db, { roleKey: "admin" });
    const adminToken = (await login(admin.email, admin.password)).body.accessToken as string;
    const sa = await createUser(ctx.db, { roleKey: "super_admin" });
    const blocked = await request(ctx.app)
      .patch(`/api/users/${sa.id}`)
      .set(bearer(adminToken))
      .send({ name: "Nope" });
    expect(blocked.status).toBe(403);

    const [unchanged] = await ctx.db
      .select()
      .from(users)
      .where(and(eq(users.id, e.id)))
      .limit(1);
    expect(unchanged!.name).not.toBe("Nice Try");
  });
});
