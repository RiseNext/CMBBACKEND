import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, count, eq, isNull } from "drizzle-orm";
import {
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import { auditLogs, permissions, rolePermissions, roles, users } from "../db/schema/index.js";

/**
 * SUPER ADMIN LOCKOUT PROTECTION — SEC-003 / BUG-003 (Tasks 2.1 + 2.2)
 *
 * Two independent rules are exercised here, and the difference between them is
 * exactly why both must exist:
 *
 *   - The **self-guard** stops an actor removing their own access. It fires even
 *     when a peer Super Admin exists, because the organisation surviving is no
 *     help to the person who just locked themselves out of it.
 *   - The **last-super-admin invariant** stops any actor — self or not — emptying
 *     the population of people who can administer the system.
 *
 * `DELETE` has carried a version of both since the first commit and **neither had
 * ever been executed by a test**. Groups D and E cover them so that moving them
 * onto the shared helper is provably behaviour-preserving.
 *
 * Every refusal asserts that the database is untouched *and* that no audit row
 * was written, because a guard that refuses after writing is not a guard.
 */

let ctx: TestContext;
let superAdminRoleId: string;
let adminRoleId: string;
let executiveRoleId: string;
let shadowCounter = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

/**
 * The invariant is a property of the whole table, so each test starts from a
 * known population. Existing rows are deactivated and soft-deleted rather than
 * hard deleted: `audit_logs.actor_id` references `users` with ON DELETE SET
 * NULL, and the append-only trigger on `audit_logs` rejects that update.
 */
async function resetPopulation(): Promise<void> {
  await ctx.db.update(users).set({ status: "Inactive", deletedAt: new Date() });
}

/** Active, non-deleted holders of a system role — the protected population. */
async function activeSuperAdmins(): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(roles.isSystem, true), eq(users.status, "Active"), isNull(users.deletedAt)));
  return row?.n ?? 0;
}

async function userRow(id: string) {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
}

async function auditRowsFor(recordId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.recordType, "user"), eq(auditLogs.recordId, recordId)));
  return row?.n ?? 0;
}

interface Actor {
  id: string;
  email: string;
  password: string;
  token: string;
}

async function signedIn(roleKey: string, status?: string): Promise<Actor> {
  const user = await createUser(ctx.db, { roleKey, ...(status ? { status } : {}) });
  const res = await login(user.email, user.password);
  return { ...user, token: res.body.accessToken as string };
}

/**
 * An actor holding the ENTIRE permission catalogue — including
 * `system.manage_any_user`, so no hierarchy check refuses them — on a role that
 * is **not** `isSystem`.
 *
 * Without this the invariant is untestable: any Super Admin actor is themselves
 * a member of the population they would be emptying, so the count never reaches
 * zero and the self-guard, not the invariant, is what refuses. This actor is
 * fully authorised and outside the protected population at the same time.
 *
 * It is also a real state, not a contrivance: `POST /api/roles` will mint
 * exactly this role for any Super Admin (see test 21).
 */
async function authorisedNonSuperAdmin(): Promise<Actor> {
  shadowCounter += 1;
  const [role] = await ctx.db
    .insert(roles)
    .values({
      key: `delegated_admin_${shadowCounter}`,
      name: `Delegated Admin ${shadowCounter}`,
      level: 1,
      isSystem: false,
    })
    .returning();

  const catalogue = await ctx.db.select({ id: permissions.id }).from(permissions);
  await ctx.db
    .insert(rolePermissions)
    .values(catalogue.map((p) => ({ roleId: role!.id, permissionId: p.id })));

  const user = await createUser(ctx.db, { roleKey: "executive" });
  await ctx.db.update(users).set({ roleId: role!.id }).where(eq(users.id, user.id));
  const res = await login(user.email, user.password);
  return { ...user, token: res.body.accessToken as string };
}

beforeAll(async () => {
  ctx = await createTestContext();
  superAdminRoleId = (await roleByKey(ctx.db, "super_admin")).id;
  adminRoleId = (await roleByKey(ctx.db, "admin")).id;
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetPopulation();
});

/* ------------------------------------------------------------------ group A */

describe("A — PATCH cannot be used to lock yourself out", () => {
  it("1. refuses a Super Admin setting their own status to Inactive", async () => {
    const actor = await signedIn("super_admin");
    await signedIn("super_admin"); // a peer exists, so the invariant is NOT what refuses
    expect(await activeSuperAdmins()).toBe(2);

    const audits = await auditRowsFor(actor.id);
    const res = await request(ctx.app)
      .patch(`/api/users/${actor.id}`)
      .set(bearer(actor.token))
      .send({ status: "Inactive" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(res.body.error.message).toMatch(/your own account/i);

    expect((await userRow(actor.id)).status).toBe("Active");
    expect(await auditRowsFor(actor.id)).toBe(audits);
    expect(await activeSuperAdmins()).toBe(2);

    // The session is untouched — which is the entire point of refusing.
    expect((await request(ctx.app).get("/api/users").set(bearer(actor.token))).status).toBe(200);
  });

  it("2. refuses a Super Admin moving their own roleId off the system role", async () => {
    const actor = await signedIn("super_admin");
    await signedIn("super_admin");
    const before = await userRow(actor.id);
    const audits = await auditRowsFor(actor.id);

    for (const roleId of [executiveRoleId, adminRoleId]) {
      const res = await request(ctx.app)
        .patch(`/api/users/${actor.id}`)
        .set(bearer(actor.token))
        .send({ roleId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("bad_request");
      expect(res.body.error.message).toMatch(/your own account/i);
    }

    const after = await userRow(actor.id);
    expect(after.roleId).toBe(before.roleId);
    expect(after.roleId).toBe(superAdminRoleId);
    expect(await auditRowsFor(actor.id)).toBe(audits);
    expect(await activeSuperAdmins()).toBe(2);
    expect((await request(ctx.app).get("/api/users").set(bearer(actor.token))).status).toBe(200);
  });

  it("2b. refuses the whole request when a self-demotion rides along with a rename", async () => {
    const actor = await signedIn("super_admin");
    await signedIn("super_admin");
    const before = await userRow(actor.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${actor.id}`)
      .set(bearer(actor.token))
      .send({
        name: "Renamed While Demoting",
        email: before.email,
        employeeCode: before.employeeCode,
        roleId: executiveRoleId,
        status: "Active",
      });

    expect(res.status).toBe(400);
    const after = await userRow(actor.id);
    // The rename must not have been applied either — the guard runs before the write.
    expect(after.name).toBe(before.name);
    expect(after.roleId).toBe(superAdminRoleId);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — PATCH cannot empty the Super Admin population", () => {
  it("3. refuses deactivating the last active Super Admin", async () => {
    const actor = await authorisedNonSuperAdmin();
    const victim = await createUser(ctx.db, { roleKey: "super_admin" });
    expect(await activeSuperAdmins()).toBe(1);

    const audits = await auditRowsFor(victim.id);
    const res = await request(ctx.app)
      .patch(`/api/users/${victim.id}`)
      .set(bearer(actor.token))
      .send({ status: "Inactive" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
    expect(res.body.error.message).toBe("The last active Super Admin cannot be removed");

    expect((await userRow(victim.id)).status).toBe("Active");
    expect(await auditRowsFor(victim.id)).toBe(audits);
    expect(await activeSuperAdmins()).toBe(1);
  });

  it("4. refuses demoting the last active Super Admin off the system role", async () => {
    const actor = await authorisedNonSuperAdmin();
    const victim = await createUser(ctx.db, { roleKey: "super_admin" });
    expect(await activeSuperAdmins()).toBe(1);

    const audits = await auditRowsFor(victim.id);
    const res = await request(ctx.app)
      .patch(`/api/users/${victim.id}`)
      .set(bearer(actor.token))
      .send({ roleId: executiveRoleId });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("The last active Super Admin cannot be removed");

    expect((await userRow(victim.id)).roleId).toBe(superAdminRoleId);
    expect(await auditRowsFor(victim.id)).toBe(audits);
    expect(await activeSuperAdmins()).toBe(1);
  });

  it("4b. refuses a status and a roleId change submitted together", async () => {
    const actor = await authorisedNonSuperAdmin();
    const victim = await createUser(ctx.db, { roleKey: "super_admin" });
    const before = await userRow(victim.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${victim.id}`)
      .set(bearer(actor.token))
      .send({ name: "Should Not Apply", status: "Inactive", roleId: executiveRoleId });

    expect(res.status).toBe(409);
    const after = await userRow(victim.id);
    expect(after.name).toBe(before.name);
    expect(after.status).toBe("Active");
    expect(after.roleId).toBe(superAdminRoleId);
  });

  it("5. allows deactivating one of two active Super Admins", async () => {
    const actor = await signedIn("super_admin");
    const peer = await createUser(ctx.db, { roleKey: "super_admin" });
    expect(await activeSuperAdmins()).toBe(2);

    const res = await request(ctx.app)
      .patch(`/api/users/${peer.id}`)
      .set(bearer(actor.token))
      .send({ status: "Inactive" });

    expect(res.status).toBe(200);
    expect((await userRow(peer.id)).status).toBe("Inactive");
    expect(await activeSuperAdmins()).toBe(1);
    expect(await auditRowsFor(peer.id)).toBe(1);
  });

  it("5b. allows demoting one of two active Super Admins", async () => {
    const actor = await signedIn("super_admin");
    const peer = await createUser(ctx.db, { roleKey: "super_admin" });
    expect(await activeSuperAdmins()).toBe(2);

    const res = await request(ctx.app)
      .patch(`/api/users/${peer.id}`)
      .set(bearer(actor.token))
      .send({ roleId: adminRoleId });

    expect(res.status).toBe(200);
    expect((await userRow(peer.id)).roleId).toBe(adminRoleId);
    expect(await activeSuperAdmins()).toBe(1);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — every legitimate edit still works", () => {
  it("6. allows a Super Admin to update their own name and phone", async () => {
    const actor = await signedIn("super_admin");
    expect(await activeSuperAdmins()).toBe(1);

    const res = await request(ctx.app)
      .patch(`/api/users/${actor.id}`)
      .set(bearer(actor.token))
      .send({ name: "Renamed Self", phone: "9848012345" });

    expect(res.status).toBe(200);
    const after = await userRow(actor.id);
    expect(after.name).toBe("Renamed Self");
    expect(after.phone).toBe("9848012345");
    expect(after.status).toBe("Active");
    expect((await request(ctx.app).get("/api/users").set(bearer(actor.token))).status).toBe(200);
  });

  it("7. allows a self-PATCH that echoes the current status", async () => {
    const actor = await signedIn("super_admin");
    const res = await request(ctx.app)
      .patch(`/api/users/${actor.id}`)
      .set(bearer(actor.token))
      .send({ status: "Active" });

    expect(res.status).toBe(200);
    expect((await userRow(actor.id)).status).toBe("Active");
  });

  it("8. allows a self-PATCH that echoes the current roleId", async () => {
    const actor = await signedIn("super_admin");
    const res = await request(ctx.app)
      .patch(`/api/users/${actor.id}`)
      .set(bearer(actor.token))
      .send({ roleId: superAdminRoleId });

    expect(res.status).toBe(200);
    expect((await userRow(actor.id)).roleId).toBe(superAdminRoleId);
  });

  it("9. allows a full-form self save carrying status and roleId unchanged", async () => {
    const actor = await signedIn("super_admin");
    const before = await userRow(actor.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${actor.id}`)
      .set(bearer(actor.token))
      .send({
        name: "Full Form Save",
        email: before.email,
        employeeCode: before.employeeCode,
        roleId: superAdminRoleId,
        status: "Active",
        phone: "9000000000",
        branch: "Head Office",
      });

    expect(res.status).toBe(200);
    const after = await userRow(actor.id);
    expect(after.name).toBe("Full Form Save");
    expect(after.branch).toBe("Head Office");
    expect(after.roleId).toBe(superAdminRoleId);
    expect(after.status).toBe("Active");
    expect(await activeSuperAdmins()).toBe(1);
  });

  it("10. allows deactivating an ordinary user while one Super Admin exists", async () => {
    const actor = await signedIn("super_admin");
    const employee = await createUser(ctx.db, { roleKey: "executive" });
    expect(await activeSuperAdmins()).toBe(1);

    const res = await request(ctx.app)
      .patch(`/api/users/${employee.id}`)
      .set(bearer(actor.token))
      .send({ status: "Inactive" });

    expect(res.status).toBe(200);
    expect((await userRow(employee.id)).status).toBe("Inactive");
    expect(await auditRowsFor(employee.id)).toBe(1);
  });

  it("11. allows editing an already-inactive Super Admin while one active remains", async () => {
    const actor = await signedIn("super_admin");
    const dormant = await createUser(ctx.db, { roleKey: "super_admin", status: "Inactive" });
    expect(await activeSuperAdmins()).toBe(1);

    const rename = await request(ctx.app)
      .patch(`/api/users/${dormant.id}`)
      .set(bearer(actor.token))
      .send({ name: "Dormant Renamed" });
    expect(rename.status).toBe(200);
    expect((await userRow(dormant.id)).name).toBe("Dormant Renamed");

    // Demoting an already-inactive Super Admin removes nobody from the protected
    // population, because they were never in it.
    const demote = await request(ctx.app)
      .patch(`/api/users/${dormant.id}`)
      .set(bearer(actor.token))
      .send({ roleId: executiveRoleId, status: "Inactive" });
    expect(demote.status).toBe(200);
    expect((await userRow(dormant.id)).roleId).toBe(executiveRoleId);
    expect(await activeSuperAdmins()).toBe(1);

    // NOTE: `status: "Inactive"` is echoed above deliberately. It is not needed
    // by the guard — the demotion is permitted either way — but without it this
    // assertion would depend on **BUG-036**: `userInput.partial()` does not
    // suppress `.default("Active")` in zod 4.4.3, so a PATCH that never mentions
    // `status` still writes `Active` and silently reactivates the account. That
    // defect is pre-existing, out of scope here, and recorded rather than fixed;
    // this test must not quietly rely on it.
  });

  it("12. allows reactivating an inactive Super Admin", async () => {
    const actor = await signedIn("super_admin");
    const dormant = await createUser(ctx.db, { roleKey: "super_admin", status: "Inactive" });
    expect(await activeSuperAdmins()).toBe(1);

    const res = await request(ctx.app)
      .patch(`/api/users/${dormant.id}`)
      .set(bearer(actor.token))
      .send({ status: "Active" });

    expect(res.status).toBe(200);
    expect((await userRow(dormant.id)).status).toBe("Active");
    expect(await activeSuperAdmins()).toBe(2);
  });

  it("13. leaves every existing authorisation refusal exactly as it was", async () => {
    const superAdmin = await signedIn("super_admin");
    const admin = await signedIn("admin");

    // An Admin may not reach a Super Admin.
    const reach = await request(ctx.app)
      .patch(`/api/users/${superAdmin.id}`)
      .set(bearer(admin.token))
      .send({ status: "Inactive" });
    expect(reach.status).toBe(403);
    expect(reach.body.error.code).toBe("forbidden");
    expect((await userRow(superAdmin.id)).status).toBe("Active");

    // ...nor delete one.
    const del = await request(ctx.app)
      .delete(`/api/users/${superAdmin.id}`)
      .set(bearer(admin.token));
    expect(del.status).toBe(403);
    expect((await userRow(superAdmin.id)).deletedAt).toBeNull();

    // ...nor promote themselves. Refused by authorisation, not by the new guard.
    const promote = await request(ctx.app)
      .patch(`/api/users/${admin.id}`)
      .set(bearer(admin.token))
      .send({ roleId: superAdminRoleId });
    expect(promote.status).toBe(403);
    expect(promote.body.error.code).toBe("forbidden");
    expect((await userRow(admin.id)).roleId).toBe(adminRoleId);

    // An Executive holds no users.edit at all.
    const exec = await signedIn("executive");
    const denied = await request(ctx.app)
      .patch(`/api/users/${exec.id}`)
      .set(bearer(exec.token))
      .send({ name: "Nice Try" });
    expect(denied.status).toBe(403);
    expect((await userRow(exec.id)).name).not.toBe("Nice Try");
  });

  it("13b. an unauthenticated caller is still 401, not refused by the new guard", async () => {
    const actor = await signedIn("super_admin");
    const res = await request(ctx.app)
      .patch(`/api/users/${actor.id}`)
      .send({ status: "Inactive" });
    expect(res.status).toBe(401);
    expect((await userRow(actor.id)).status).toBe("Active");
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — DELETE keeps both of its existing guards", () => {
  it("14. refuses self-deletion and leaves the row untouched", async () => {
    const actor = await signedIn("super_admin");
    await signedIn("super_admin"); // a peer exists, so the invariant is not what refuses

    const audits = await auditRowsFor(actor.id);
    const res = await request(ctx.app).delete(`/api/users/${actor.id}`).set(bearer(actor.token));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(res.body.error.message).toBe("You cannot delete your own account");

    const after = await userRow(actor.id);
    expect(after.deletedAt).toBeNull();
    expect(after.status).toBe("Active");
    expect(await auditRowsFor(actor.id)).toBe(audits);
  });

  it("15. refuses deleting the last active Super Admin", async () => {
    const actor = await authorisedNonSuperAdmin();
    const victim = await createUser(ctx.db, { roleKey: "super_admin" });
    expect(await activeSuperAdmins()).toBe(1);

    const audits = await auditRowsFor(victim.id);
    const res = await request(ctx.app).delete(`/api/users/${victim.id}`).set(bearer(actor.token));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
    expect(res.body.error.message).toBe("The last active Super Admin cannot be removed");

    const after = await userRow(victim.id);
    expect(after.deletedAt).toBeNull();
    expect(after.status).toBe("Active");
    expect(await auditRowsFor(victim.id)).toBe(audits);
    expect(await activeSuperAdmins()).toBe(1);
  });

  it("16. still soft-deletes an ordinary user", async () => {
    const actor = await signedIn("super_admin");
    const employee = await createUser(ctx.db, { roleKey: "executive" });

    const res = await request(ctx.app).delete(`/api/users/${employee.id}`).set(bearer(actor.token));

    expect(res.status).toBe(204);
    const after = await userRow(employee.id);
    expect(after.deletedAt).not.toBeNull();
    expect(after.deletedBy).toBe(actor.id);
    expect(after.status).toBe("Inactive");
    expect(await auditRowsFor(employee.id)).toBe(1);
  });

  it("17. still deletes one of two active Super Admins", async () => {
    const actor = await signedIn("super_admin");
    const peer = await createUser(ctx.db, { roleKey: "super_admin" });
    expect(await activeSuperAdmins()).toBe(2);

    const res = await request(ctx.app).delete(`/api/users/${peer.id}`).set(bearer(actor.token));

    expect(res.status).toBe(204);
    expect((await userRow(peer.id)).deletedAt).not.toBeNull();
    expect(await activeSuperAdmins()).toBe(1);
  });

  it("18. TASK 2.2 — deletes an INACTIVE Super Admin while exactly one active remains", async () => {
    const actor = await signedIn("super_admin");
    const dormant = await createUser(ctx.db, { roleKey: "super_admin", status: "Inactive" });
    // Exactly one active Super Admin (the actor). The target is not in the
    // protected population at all, so removing it cannot break the invariant.
    expect(await activeSuperAdmins()).toBe(1);

    const res = await request(ctx.app).delete(`/api/users/${dormant.id}`).set(bearer(actor.token));

    // Before Task 2.2 this was a 409: the old count excluded the inactive target
    // via its own status filter and then compared `remaining <= 1`.
    expect(res.status).toBe(204);
    const after = await userRow(dormant.id);
    expect(after.deletedAt).not.toBeNull();
    expect(after.status).toBe("Inactive");
    expect(await auditRowsFor(dormant.id)).toBe(1);
    expect(await activeSuperAdmins()).toBe(1);
  });

  it("18b. TASK 2.2 — the same holds for a Super Admin already demoted off the system role", async () => {
    const actor = await signedIn("super_admin");
    const demoted = await createUser(ctx.db, { roleKey: "executive" });
    expect(await activeSuperAdmins()).toBe(1);

    const res = await request(ctx.app).delete(`/api/users/${demoted.id}`).set(bearer(actor.token));
    expect(res.status).toBe(204);
    expect(await activeSuperAdmins()).toBe(1);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — what the protected population is, exactly", () => {
  it("19. excludes soft-deleted Super Admins from the count", async () => {
    const actor = await authorisedNonSuperAdmin();
    const survivor = await createUser(ctx.db, { roleKey: "super_admin" });
    const gone = await createUser(ctx.db, { roleKey: "super_admin" });
    expect(await activeSuperAdmins()).toBe(2);

    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.id));
    expect(await activeSuperAdmins()).toBe(1);

    // The survivor is now genuinely the last, and the soft-deleted row must not
    // be mistaken for a second one that makes the removal safe.
    const res = await request(ctx.app)
      .patch(`/api/users/${survivor.id}`)
      .set(bearer(actor.token))
      .send({ status: "Inactive" });

    expect(res.status).toBe(409);
    expect((await userRow(survivor.id)).status).toBe("Active");
    expect(await auditRowsFor(survivor.id)).toBe(0);
  });

  it("20. returns 404 for a soft-deleted target on PATCH and on DELETE", async () => {
    const actor = await signedIn("super_admin");
    const employee = await createUser(ctx.db, { roleKey: "executive" });
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, employee.id));

    const patch = await request(ctx.app)
      .patch(`/api/users/${employee.id}`)
      .set(bearer(actor.token))
      .send({ name: "Zombie" });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe("not_found");

    const del = await request(ctx.app).delete(`/api/users/${employee.id}`).set(bearer(actor.token));
    expect(del.status).toBe(404);

    expect((await userRow(employee.id)).name).not.toBe("Zombie");
    expect(await auditRowsFor(employee.id)).toBe(0);
  });

  it("21. counts by roles.is_system, which no API route can grant or revoke", async () => {
    const actor = await signedIn("super_admin");

    // A role created through the API is never a system role, whatever is asked for.
    const created = await request(ctx.app)
      .post("/api/roles")
      .set(bearer(actor.token))
      .send({ key: "pretender", name: "Pretender", level: 5, isSystem: true, permissions: [] });
    expect(created.status).toBe(201);
    expect(created.body.data.isSystem).toBe(false);

    // Moving a user onto it therefore takes them out of the protected population.
    const helper = await createUser(ctx.db, { roleKey: "super_admin" });
    expect(await activeSuperAdmins()).toBe(2);
    const moved = await request(ctx.app)
      .patch(`/api/users/${helper.id}`)
      .set(bearer(actor.token))
      .send({ roleId: created.body.data.id });
    expect(moved.status).toBe(200);
    expect(await activeSuperAdmins()).toBe(1);

    // ...and the actor, now the last one, cannot follow them out.
    const follow = await request(ctx.app)
      .patch(`/api/users/${actor.id}`)
      .set(bearer(actor.token))
      .send({ roleId: created.body.data.id });
    expect(follow.status).toBe(400);
    expect(await activeSuperAdmins()).toBe(1);

    // The system role itself cannot be deactivated through the API, so a
    // protected Super Admin cannot be disabled behind the count's back.
    const disable = await request(ctx.app)
      .patch(`/api/roles/${superAdminRoleId}`)
      .set(bearer(actor.token))
      .send({ name: "Super Admin", isActive: false });
    expect(disable.status).toBe(200);
    const [systemRole] = await ctx.db
      .select()
      .from(roles)
      .where(eq(roles.id, superAdminRoleId))
      .limit(1);
    expect(systemRole!.isActive).toBe(true);
    expect(systemRole!.isSystem).toBe(true);
  });
});
