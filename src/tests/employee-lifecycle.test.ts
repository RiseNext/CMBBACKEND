import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import { recycleBinEntries, users } from "../db/schema/index.js";
import { passwordProblems } from "../lib/password.js";

/**
 * EMPLOYEE LIFECYCLE
 *
 * The gap this closes: creating a colleague, handing them a working credential,
 * and having them sign in with the right authority was never covered end to
 * end. `users.reset_password` in particular sat in the permission catalogue
 * with no route behind it, so an administrator had no way to recover an account
 * once the one-time password from creation was lost.
 *
 * Every request below is the one the Employees screen actually issues.
 */

let ctx: TestContext;
let superToken: string;
let bank: { id: string; code: string };
let teamId: string;
let executiveRoleId: string;
let superAdminRoleId: string;

const asSuper = () => ({ Authorization: `Bearer ${superToken}` });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string) {
  return request(ctx.app).post("/api/auth/login").send({ email, password });
}

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Employee Test Bank");

  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (await login(superAdmin.email, superAdmin.password)).body.accessToken;

  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;
  superAdminRoleId = (await roleByKey(ctx.db, "super_admin")).id;

  const team = await request(ctx.app)
    .post("/api/teams")
    .set(asSuper())
    .send({ name: "Hyderabad West", status: "Active" });
  teamId = team.body.data.id;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("super admin creates an employee", () => {
  let created: { id: string; email: string };
  let temporaryPassword: string;

  it("creates the account with role, bank scope and team in one call", async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(asSuper())
      .send({
        name: "Demo Employee",
        email: "employee.demo@risenext.com",
        phone: "9848012345",
        employeeCode: "EMP-2001",
        roleId: executiveRoleId,
        branch: "Hyderabad",
        status: "Active",
        target: 8000000,
        bankIds: [bank.id],
        teamId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe("employee.demo@risenext.com");
    created = res.body.data;
    temporaryPassword = res.body.temporaryPassword;
  });

  it("returns a temporary password that satisfies the password policy", () => {
    expect(typeof temporaryPassword).toBe("string");
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(passwordProblems(temporaryPassword)).toEqual([]);
    // Characters that are ambiguous when read off a screen are excluded.
    expect(temporaryPassword).not.toMatch(/[0O1lI]/);
  });

  it("stores only a hash — the plaintext is never persisted", async () => {
    const [row] = await ctx.db.select().from(users).where(eq(users.id, created.id));
    expect(row!.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(JSON.stringify(row)).not.toContain(temporaryPassword);
    expect(row!.mustChangePassword).toBe(true);
  });

  it("never exposes password material through the users list", async () => {
    const res = await request(ctx.app).get("/api/users").set(asSuper());
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("$argon2id$");
    expect(body).not.toContain(temporaryPassword);
  });

  it("records the bank scope and the team membership", async () => {
    const list = await request(ctx.app).get("/api/users").set(asSuper());
    const row = list.body.data.find((u: { id: string }) => u.id === created.id);
    expect(row.assignedBanks).toEqual([bank.id]);
    expect(row.roleKey).toBe("executive");

    const teamsRes = await request(ctx.app).get("/api/teams").set(asSuper());
    const team = teamsRes.body.data.find((t: { id: string }) => t.id === teamId);
    expect(team.members.map((m: { userId: string }) => m.userId)).toContain(created.id);
  });

  it("lets the employee sign in through the normal login route", async () => {
    const res = await login("employee.demo@risenext.com", temporaryPassword);
    expect(res.status).toBe(200);
    expect(res.body.user.role.key).toBe("executive");
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it("resolves the Executive permission set and no administrative permission", async () => {
    const res = await login("employee.demo@risenext.com", temporaryPassword);
    const held: string[] = res.body.user.permissions;

    expect(held).toContain("customers.view");
    expect(held).toContain("requests.create");
    expect(held).toContain("documents.upload");

    for (const forbidden of [
      "users.view",
      "users.create",
      "roles.view",
      "reports.view",
      "settlements.view",
      "ledger.view",
      "recycle_bin.view",
      "audit_logs.view",
      "system.access_all_banks",
      "system.manage_any_user",
    ]) {
      expect(held).not.toContain(forbidden);
    }

    expect(res.body.user.unrestrictedBankAccess).toBe(false);
    expect(res.body.user.bankIds).toEqual([bank.id]);
  });

  it("refuses the employee access to super admin functionality", async () => {
    const token = (await login("employee.demo@risenext.com", temporaryPassword)).body.accessToken;

    for (const path of ["/api/users", "/api/roles", "/api/audit-logs", "/api/dashboard/stats"]) {
      const res = await request(ctx.app).get(path).set(bearer(token));
      expect(res.status, `${path} should be forbidden`).toBe(403);
    }

    const escalate = await request(ctx.app)
      .post("/api/users")
      .set(bearer(token))
      .send({
        name: "Self Promoted",
        email: "escalate@risenext.com",
        employeeCode: "EMP-9999",
        roleId: superAdminRoleId,
      });
    expect(escalate.status).toBe(403);
  });

  it("rejects a wrong password", async () => {
    const res = await login("employee.demo@risenext.com", "NotThePassword123");
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(temporaryPassword);
  });

  it("lets the employee exchange the temporary password for their own", async () => {
    const token = (await login("employee.demo@risenext.com", temporaryPassword)).body.accessToken;

    const change = await request(ctx.app)
      .post("/api/auth/change-password")
      .set(bearer(token))
      .send({ currentPassword: temporaryPassword, newPassword: "ChosenByMe2026" });
    expect(change.status).toBe(204);

    const stale = await login("employee.demo@risenext.com", temporaryPassword);
    expect(stale.status).toBe(401);

    const fresh = await login("employee.demo@risenext.com", "ChosenByMe2026");
    expect(fresh.status).toBe(200);
    expect(fresh.body.mustChangePassword).toBe(false);
    expect(fresh.body.user.mustChangePassword).toBe(false);
  });

  it("enforces the password policy on the replacement password", async () => {
    const token = (await login("employee.demo@risenext.com", "ChosenByMe2026")).body.accessToken;
    const res = await request(ctx.app)
      .post("/api/auth/change-password")
      .set(bearer(token))
      .send({ currentPassword: "ChosenByMe2026", newPassword: "short" });
    expect(res.status).toBe(422);
  });
});

describe("password reset", () => {
  let employeeId: string;

  beforeAll(async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(asSuper())
      .send({
        name: "Reset Target",
        email: "reset.target@risenext.com",
        employeeCode: "EMP-2002",
        roleId: executiveRoleId,
        bankIds: [bank.id],
      });
    employeeId = res.body.data.id;
  });

  it("issues a fresh working credential", async () => {
    const res = await request(ctx.app)
      .post(`/api/users/${employeeId}/reset-password`)
      .set(asSuper())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("reset.target@risenext.com");
    expect(passwordProblems(res.body.temporaryPassword)).toEqual([]);

    const login = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "reset.target@risenext.com", password: res.body.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
  });

  it("invalidates the previous password", async () => {
    const first = await request(ctx.app)
      .post(`/api/users/${employeeId}/reset-password`)
      .set(asSuper())
      .send({});
    const second = await request(ctx.app)
      .post(`/api/users/${employeeId}/reset-password`)
      .set(asSuper())
      .send({});

    expect(first.body.temporaryPassword).not.toBe(second.body.temporaryPassword);

    const stale = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "reset.target@risenext.com", password: first.body.temporaryPassword });
    expect(stale.status).toBe(401);
  });

  it("revokes sessions the account already had", async () => {
    const reset = await request(ctx.app)
      .post(`/api/users/${employeeId}/reset-password`)
      .set(asSuper())
      .send({});
    const session = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "reset.target@risenext.com", password: reset.body.temporaryPassword });
    const cookie = (session.headers["set-cookie"] ?? []) as string[];
    expect(cookie.length).toBeGreaterThan(0);

    await request(ctx.app).post(`/api/users/${employeeId}/reset-password`).set(asSuper()).send({});

    const refresh = await request(ctx.app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(refresh.status).toBe(401);
  });

  it("never returns the stored hash", async () => {
    const res = await request(ctx.app)
      .post(`/api/users/${employeeId}/reset-password`)
      .set(asSuper())
      .send({});
    expect(JSON.stringify(res.body)).not.toContain("$argon2id$");
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it("refuses a reset the actor is not senior enough to perform", async () => {
    const admin = await createUser(ctx.db, { roleKey: "admin", bankIds: [bank.id] });
    const adminToken = (await login(admin.email, admin.password)).body.accessToken;

    const peer = await createUser(ctx.db, { roleKey: "admin" });
    const superior = await createUser(ctx.db, { roleKey: "super_admin" });

    for (const victim of [peer, superior]) {
      const res = await request(ctx.app)
        .post(`/api/users/${victim.id}/reset-password`)
        .set(bearer(adminToken))
        .send({});
      expect(res.status).toBe(403);
    }

    // ...but may reset someone genuinely below them.
    const junior = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
    const allowed = await request(ctx.app)
      .post(`/api/users/${junior.id}/reset-password`)
      .set(bearer(adminToken))
      .send({});
    expect(allowed.status).toBe(200);
  });

  it("refuses a reset from an account without the permission", async () => {
    const exec = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
    const execToken = (await login(exec.email, exec.password)).body.accessToken;

    const res = await request(ctx.app)
      .post(`/api/users/${employeeId}/reset-password`)
      .set(bearer(execToken))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe("revoking and restoring access", () => {
  let employeeId: string;
  let password: string;

  beforeAll(async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(asSuper())
      .send({
        name: "Revoke Target",
        email: "revoke.target@risenext.com",
        employeeCode: "EMP-2003",
        roleId: executiveRoleId,
        bankIds: [bank.id],
      });
    employeeId = res.body.data.id;
    password = res.body.temporaryPassword;
  });

  it("stops a revoked employee signing in", async () => {
    expect((await login("revoke.target@risenext.com", password)).status).toBe(200);

    const revoke = await request(ctx.app)
      .patch(`/api/users/${employeeId}`)
      .set(asSuper())
      .send({ status: "Inactive" });
    expect(revoke.status).toBe(200);

    const blocked = await login("revoke.target@risenext.com", password);
    expect(blocked.status).toBe(403);
  });

  it("lets access be restored", async () => {
    await request(ctx.app)
      .patch(`/api/users/${employeeId}`)
      .set(asSuper())
      .send({ status: "Active" });

    expect((await login("revoke.target@risenext.com", password)).status).toBe(200);
  });
});

/**
 * Task 2.8 wired `DELETE /api/users/:id` from the employee screen behind a
 * confirmation that told the user the deletion **could not be undone**, because
 * `user` was absent from `BIN_REGISTRY`. A test here asserted that — zero
 * recycle-bin rows — precisely so it would fail when the claim stopped being
 * true.
 *
 * **Task 2.9 made it stop being true**, and that test failed on cue. It is
 * replaced below by the opposite assertion. The dialog copy in
 * `employees/page.tsx` and group D of `employees-delete.test.tsx` moved with it.
 */
describe("deleting an employee, and what the confirmation dialog may claim", () => {
  let employeeId: string;
  let password: string;

  beforeAll(async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(asSuper())
      .send({
        name: "Delete Target",
        email: "delete.target@risenext.com",
        employeeCode: "EMP-2004",
        roleId: executiveRoleId,
        bankIds: [bank.id],
      });
    employeeId = res.body.data.id;
    password = res.body.temporaryPassword;
  });

  it("answers 204 with no body", async () => {
    expect((await login("delete.target@risenext.com", password)).status).toBe(200);

    const res = await request(ctx.app).delete(`/api/users/${employeeId}`).set(asSuper());

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it("soft-deletes rather than removing the row", async () => {
    const [row] = await ctx.db.select().from(users).where(eq(users.id, employeeId)).limit(1);

    expect(row).toBeTruthy();
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.deletedBy).not.toBeNull();
    expect(row!.status).toBe("Inactive");
  });

  it("stops the deleted employee signing in, as a 401 rather than a 403", async () => {
    // A *revoked* employee gets 403 `accountInactive`; a *deleted* one gets the
    // generic 401, because the login lookup filters `deletedAt IS NULL` and so
    // cannot tell a deleted account from one that never existed. That is the
    // better answer — it leaks nothing — and it is asserted so the difference
    // between revoke and delete stays deliberate.
    const res = await login("delete.target@risenext.com", password);

    expect(res.status).toBe(401);
    expect(res.body.error.code).not.toBe("account_inactive");
  });

  it("hides the employee from the list the screen reads", async () => {
    const res = await request(ctx.app).get("/api/users").set(asSuper()).query({ pageSize: 200 });

    expect(res.status).toBe(200);
    expect((res.body.data as { id: string }[]).some((u) => u.id === employeeId)).toBe(false);
  });

  it("404s a second delete of the same employee", async () => {
    expect((await request(ctx.app).delete(`/api/users/${employeeId}`).set(asSuper())).status).toBe(
      404,
    );
  });

  it("writes exactly one recycle-bin entry — the dialog's 'can be restored' is true", async () => {
    // Task 2.9 inverted this assertion. Before it, `user` was not in
    // BIN_REGISTRY and this asserted zero rows; the delete confirmation said the
    // deletion could not be undone, and that was accurate.
    const entries = await ctx.db
      .select()
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, employeeId));

    expect(entries).toHaveLength(1);
    expect(entries[0]!.recordType).toBe("user");
    expect(entries[0]!.label).toBe("Delete Target");
  });
});

describe("creation guard rails the Employees screen relies on", () => {
  it("reports a duplicate email as a conflict, not a crash", async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(asSuper())
      .send({
        name: "Clash",
        email: "employee.demo@risenext.com",
        employeeCode: "EMP-3001",
        roleId: executiveRoleId,
      });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/email/i);
  });

  it("reports a duplicate employee code as a conflict", async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(asSuper())
      .send({
        name: "Clash",
        email: "unique.code@risenext.com",
        employeeCode: "EMP-2001",
        roleId: executiveRoleId,
      });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/employee code/i);
  });

  it("rejects a missing role rather than creating an account without one", async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(asSuper())
      .send({ name: "No Role", email: "norole@risenext.com", employeeCode: "EMP-3002", roleId: "" });
    expect(res.status).toBe(422);
  });

  it("stops an admin minting a super admin", async () => {
    const admin = await createUser(ctx.db, { roleKey: "admin", bankIds: [bank.id] });
    const adminToken = (await login(admin.email, admin.password)).body.accessToken;

    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(adminToken))
      .send({
        name: "Sneaky",
        email: "sneaky@risenext.com",
        employeeCode: "EMP-3003",
        roleId: superAdminRoleId,
      });
    expect(res.status).toBe(403);
  });

  it("does not treat the frontend demo address as anything special", async () => {
    // The presentation account is matched in the browser and never reaches the
    // API. If those credentials are ever posted here, they must be refused like
    // any other unknown login — the demo must not become a backend bypass.
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "demo.employee@risenext.com", password: "Demo@12345" });
    expect(res.status).toBe(401);
  });

  it("rejects a team that does not exist", async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(asSuper())
      .send({
        name: "Ghost Team",
        email: "ghost@risenext.com",
        employeeCode: "EMP-3004",
        roleId: executiveRoleId,
        teamId: "00000000-0000-0000-0000-000000000000",
      });
    expect(res.status).toBe(404);
  });
});
