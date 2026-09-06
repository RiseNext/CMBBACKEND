import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import {
  permissions as permissionsTable,
  recycleBinEntries,
  rolePermissions,
  roles,
  teamMembers,
  teams,
  userBankAccess,
  users,
} from "../db/schema/index.js";
import { PERMISSIONS } from "../lib/permissions.js";

/**
 * EMPLOYEE RECYCLE BIN — Task 2.9
 *
 * `DELETE /api/users/:id` used to soft-delete by hand: a direct `UPDATE` setting
 * `deleted_at`, `deleted_by` and `status`, with no recycle-bin entry, because
 * `user` was absent from `BIN_REGISTRY`. A deleted employee was unrecoverable
 * through any endpoint, and Task 2.8's confirmation dialog said so.
 *
 * This suite pins the whole round trip — **active → DELETE → bin → restored** —
 * and three things that are easy to get wrong when a *person* becomes a binnable
 * record rather than a business row:
 *
 *   - **The snapshot must not carry the password hash.** Bin entries outlive the
 *     rows they describe (a purge keeps the entry and only stamps `purged_at`),
 *     so an unredacted snapshot parks a live argon2 credential in a second table
 *     forever. Group C.
 *   - **The hierarchy still applies in the bin.** `recycle_bin.restore` is held
 *     by `manager` as well as `admin`, so without a guard a Manager could
 *     restore — or permanently delete — a Super Admin they could never have
 *     deleted. That is BUG-038's hole arriving by a different door, and it is
 *     created by this task rather than inherited. Group E.
 *   - **The guards that ran before the write still run.** `softDelete` knows
 *     nothing about self-deletion or the last-Super-Admin invariant. Group F.
 */

let ctx: TestContext;
let superToken: string;
let bank: { id: string; code: string };
let executiveRoleId: string;
let userCounter = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

async function signedIn(roleKey: string): Promise<{ id: string; token: string; email: string }> {
  const user = await createUser(ctx.db, { roleKey, bankIds: [bank.id] });
  const res = await login(user.email, user.password);
  expect(res.status).toBe(200);
  return { id: user.id, token: res.body.accessToken as string, email: user.email };
}

/** An employee created through the real route, so the row is exactly what production writes. */
async function makeEmployee(roleId?: string) {
  userCounter += 1;
  const res = await request(ctx.app)
    .post("/api/users")
    .set(bearer(superToken))
    .send({
      name: `Bin Target ${userCounter}`,
      email: `bin.target.${userCounter}@risenext.com`,
      employeeCode: `EMP-90${String(userCounter).padStart(2, "0")}`,
      roleId: roleId ?? executiveRoleId,
      bankIds: [bank.id],
    });
  expect(res.status).toBe(201);
  return {
    id: res.body.data.id as string,
    email: `bin.target.${userCounter}@risenext.com`,
    password: res.body.temporaryPassword as string,
    name: `Bin Target ${userCounter}`,
  };
}

const entriesFor = (recordId: string) =>
  ctx.db.select().from(recycleBinEntries).where(eq(recycleBinEntries.recordId, recordId));

const userRow = async (id: string) => {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
};

const del = (id: string, token: string) =>
  request(ctx.app).delete(`/api/users/${id}`).set(bearer(token));

const restoreEntry = (entryId: string, token: string) =>
  request(ctx.app).post(`/api/recycle-bin/${entryId}/restore`).set(bearer(token));

const purgeEntry = (entryId: string, token: string) =>
  request(ctx.app)
    .post(`/api/recycle-bin/${entryId}/permanent-delete`)
    .set(bearer(token))
    .send({ confirm: true });

/**
 * An actor on a bespoke role at `level` holding exactly `keys` — notably NOT
 * `system.manage_any_user`, so the hierarchy rule actually applies to them.
 * `POST /api/roles` can mint precisely this role today.
 */
async function bespokeActor(level: number, keys: string[]): Promise<string> {
  const [role] = await ctx.db
    .insert(roles)
    .values({ key: `bespoke_${++userCounter}`, name: `Bespoke ${userCounter}`, level, isSystem: false })
    .returning();

  const rows = await ctx.db
    .select({ id: permissionsTable.id, key: permissionsTable.key })
    .from(permissionsTable);
  await ctx.db.insert(rolePermissions).values(
    rows
      .filter((p) => keys.includes(p.key))
      .map((p) => ({ roleId: role!.id, permissionId: p.id })),
  );

  const user = await createUser(ctx.db, { roleKey: "executive" });
  await ctx.db.update(users).set({ roleId: role!.id }).where(eq(users.id, user.id));
  const res = await login(user.email, user.password);
  return res.body.accessToken as string;
}

/** A fully-permissioned actor on a non-system role, so hierarchy never refuses them. */
async function unscopedSuperUser(): Promise<string> {
  const [role] = await ctx.db
    .insert(roles)
    .values({ key: `bin_admin_${++userCounter}`, name: "Bin Admin", level: 1, isSystem: false })
    .returning();
  const catalogue = await ctx.db.select({ id: permissionsTable.id }).from(permissionsTable);
  await ctx.db
    .insert(rolePermissions)
    .values(catalogue.map((p) => ({ roleId: role!.id, permissionId: p.id })));

  const user = await createUser(ctx.db, { roleKey: "executive" });
  await ctx.db.update(users).set({ roleId: role!.id }).where(eq(users.id, user.id));
  const res = await login(user.email, user.password);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Bin Test Bank");
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;

  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  const res = await login(superAdmin.email, superAdmin.password);
  superToken = res.body.accessToken as string;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ------------------------------------------------------------------ group A */

describe("A — active → DELETE → recycle bin", () => {
  it("1. still answers 204 and still requires users.delete", async () => {
    const employee = await makeEmployee();
    const executive = await signedIn("executive");

    const refused = await del(employee.id, executive.token);
    expect(refused.status).toBe(403);
    expect(await entriesFor(employee.id)).toHaveLength(0);

    const allowed = await del(employee.id, superToken);
    expect(allowed.status).toBe(204);
  });

  it("2. writes exactly one bin entry, with the established shape", async () => {
    const employee = await makeEmployee();
    await del(employee.id, superToken);

    const entries = await entriesFor(employee.id);
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(entry.recordType).toBe("user");
    expect(entry.label).toBe(employee.name);
    // A user belongs to many banks or none, so there is no single bank to stamp —
    // the same answer `service_provider` gives.
    expect(entry.bankId).toBeNull();
    expect(entry.purgeAfter).not.toBeNull();
    expect(entry.restoredAt).toBeNull();
    expect(entry.purgedAt).toBeNull();
  });

  it("3. soft-deletes and deactivates the row rather than removing it", async () => {
    const employee = await makeEmployee();
    await del(employee.id, superToken);

    const row = await userRow(employee.id);
    expect(row).toBeTruthy();
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.deletedBy).not.toBeNull();
    expect(row!.purgeAfter).not.toBeNull();
    // Preserved from the hand-rolled delete this route replaced.
    expect(row!.status).toBe("Inactive");
  });

  it("4. hides the employee from the list and from sign-in", async () => {
    const employee = await makeEmployee();
    await del(employee.id, superToken);

    const list = await request(ctx.app)
      .get("/api/users")
      .set(bearer(superToken))
      .query({ pageSize: 200 });
    expect((list.body.data as { id: string }[]).some((u) => u.id === employee.id)).toBe(false);

    expect((await login(employee.email, employee.password)).status).toBe(401);
  });

  it("5. 404s a repeat delete and writes no second entry", async () => {
    const employee = await makeEmployee();
    await del(employee.id, superToken);

    expect((await del(employee.id, superToken)).status).toBe(404);
    expect(await entriesFor(employee.id)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — the entry is visible in the bin", () => {
  it("6. lists the deleted employee for an unscoped actor", async () => {
    const employee = await makeEmployee();
    await del(employee.id, superToken);

    const res = await request(ctx.app).get("/api/recycle-bin").set(bearer(superToken));

    expect(res.status).toBe(200);
    const row = (res.body.data as { recordId: string; recordType: string; label: string }[]).find(
      (r) => r.recordId === employee.id,
    );
    expect(row).toBeTruthy();
    expect(row!.recordType).toBe("user");
    expect(row!.label).toBe(employee.name);
  });

  it("7. never ships the snapshot through the list route", async () => {
    const employee = await makeEmployee();
    await del(employee.id, superToken);

    const res = await request(ctx.app).get("/api/recycle-bin").set(bearer(superToken));
    const row = (res.body.data as { recordId: string; snapshot?: unknown }[]).find(
      (r) => r.recordId === employee.id,
    );

    expect(row!.snapshot).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("$argon2");
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — the snapshot carries no credential", () => {
  it("8. stores the employee's fields but strips the password hash", async () => {
    const employee = await makeEmployee();
    await del(employee.id, superToken);

    const [entry] = await entriesFor(employee.id);
    const snapshot = entry!.snapshot as Record<string, unknown>;

    // The record is genuinely captured...
    expect(snapshot.id).toBe(employee.id);
    expect(snapshot.email).toBe(employee.email);
    expect(snapshot.employeeCode).toBeTruthy();

    // ...but the argon2 hash is not. Bin entries survive a purge, so an
    // unredacted snapshot would retain a live credential indefinitely.
    expect(snapshot).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(snapshot)).not.toContain("$argon2");
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — restore returns the employee, and their relationships survive", () => {
  let employee: Awaited<ReturnType<typeof makeEmployee>>;
  let teamId: string;
  let entryId: string;

  beforeEach(async () => {
    employee = await makeEmployee();

    const [team] = await ctx.db
      .insert(teams)
      .values({ name: `Bin Team ${++userCounter}`, status: "Active" })
      .returning();
    teamId = team!.id;
    await ctx.db.insert(teamMembers).values({ teamId, userId: employee.id });

    await del(employee.id, superToken);
    const [entry] = await entriesFor(employee.id);
    entryId = entry!.id;
  });

  it("9. restores through the existing recycle-bin route", async () => {
    const res = await restoreEntry(entryId, superToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ restored: true, recordType: "user" });
  });

  it("10. clears the delete stamps and puts the employee back in the list", async () => {
    await restoreEntry(entryId, superToken);

    const row = await userRow(employee.id);
    expect(row!.deletedAt).toBeNull();
    expect(row!.deletedBy).toBeNull();
    expect(row!.purgeAfter).toBeNull();

    const list = await request(ctx.app)
      .get("/api/users")
      .set(bearer(superToken))
      .query({ pageSize: 200 });
    expect((list.body.data as { id: string }[]).some((u) => u.id === employee.id)).toBe(true);
  });

  it("11. restores the record without handing back a working login", async () => {
    await restoreEntry(entryId, superToken);

    // Delete deactivated them and restore does not undo that: bringing a record
    // back is not the same as re-granting access. Re-activation is a deliberate
    // second step through the existing PATCH.
    expect((await userRow(employee.id))!.status).toBe("Inactive");
    expect((await login(employee.email, employee.password)).status).toBe(403);

    await request(ctx.app)
      .patch(`/api/users/${employee.id}`)
      .set(bearer(superToken))
      .send({ status: "Active" });
    expect((await login(employee.email, employee.password)).status).toBe(200);
  });

  it("12. leaves team membership and bank access intact across the round trip", async () => {
    // Neither relationship is touched by the soft delete, so neither needs
    // rebuilding on restore — the rows were never removed.
    const teamsDuring = await ctx.db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, employee.id));
    expect(teamsDuring).toHaveLength(1);

    await restoreEntry(entryId, superToken);

    const teamsAfter = await ctx.db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, employee.id));
    const banksAfter = await ctx.db
      .select()
      .from(userBankAccess)
      .where(eq(userBankAccess.userId, employee.id));

    expect(teamsAfter).toHaveLength(1);
    expect(teamsAfter[0]!.teamId).toBe(teamId);
    expect(banksAfter.map((b) => b.bankId)).toEqual([bank.id]);
  });

  it("13. marks the entry restored so it leaves the bin", async () => {
    await restoreEntry(entryId, superToken);

    const [entry] = await entriesFor(employee.id);
    expect(entry!.restoredAt).not.toBeNull();
    expect(entry!.restoredBy).not.toBeNull();

    const res = await request(ctx.app).get("/api/recycle-bin").set(bearer(superToken));
    expect(
      (res.body.data as { recordId: string }[]).some((r) => r.recordId === employee.id),
    ).toBe(false);
  });

  it("14. refuses a second restore of the same entry", async () => {
    await restoreEntry(entryId, superToken);
    expect((await restoreEntry(entryId, superToken)).status).toBe(404);
  });

  it("15. permanently deletes, keeping the entry as the audit trail", async () => {
    const res = await purgeEntry(entryId, superToken);
    expect(res.status).toBe(200);

    expect(await userRow(employee.id)).toBeUndefined();
    const [entry] = await entriesFor(employee.id);
    expect(entry!.purgedAt).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — the role hierarchy still applies inside the bin", () => {
  it("16. refuses a Manager restoring a Super Admin", async () => {
    // `recycle_bin.restore` is seeded to `manager`. Without the guard this
    // returns 200 and resurrects a record the Manager could never have deleted —
    // BUG-038's hole arriving through the bin.
    const victim = await createUser(ctx.db, { roleKey: "super_admin" });
    await del(victim.id, superToken);
    const [entry] = await entriesFor(victim.id);
    const manager = await signedIn("manager");

    const res = await restoreEntry(entry!.id, manager.token);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe(
      "You cannot manage a user at or above your own role level",
    );
    expect((await userRow(victim.id))!.deletedAt).not.toBeNull();
  });

  it("17. refuses a purge of a Super Admin by an actor who may not manage them", async () => {
    /*
     * Deliberately NOT a Manager: `recycle_bin.permanent_delete` is seeded only
     * to `super_admin` (through the `"*"` grant), who bypasses the hierarchy via
     * `system.manage_any_user`. So with the seeded roles this guard is
     * unreachable, and a Manager here would return 403 from `requirePermission`
     * before ever reaching it — the test would pass without testing anything.
     *
     * This actor is the reachable case: a bespoke role holding the purge
     * permission without `system.manage_any_user`, which `POST /api/roles` can
     * mint today.
     */
    const victim = await createUser(ctx.db, { roleKey: "super_admin" });
    await del(victim.id, superToken);
    const [entry] = await entriesFor(victim.id);
    const purger = await bespokeActor(20, [
      PERMISSIONS.recycleBin.view,
      PERMISSIONS.recycleBin.permanentDelete,
    ]);

    const res = await purgeEntry(entry!.id, purger);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe(
      "You cannot manage a user at or above your own role level",
    );
    // The row is still there, soft-deleted rather than destroyed.
    expect(await userRow(victim.id)).toBeTruthy();
  });

  it("17b. lets that same actor purge someone they may manage", async () => {
    // Confirms the refusal above is the hierarchy, not the permission.
    const employee = await makeEmployee();
    await del(employee.id, superToken);
    const [entry] = await entriesFor(employee.id);
    const purger = await bespokeActor(20, [
      PERMISSIONS.recycleBin.view,
      PERMISSIONS.recycleBin.permanentDelete,
    ]);

    expect((await purgeEntry(entry!.id, purger)).status).toBe(200);
    expect(await userRow(employee.id)).toBeUndefined();
  });

  it("18. still lets a Manager restore someone they may manage", async () => {
    const employee = await makeEmployee();
    await del(employee.id, superToken);
    const [entry] = await entriesFor(employee.id);
    const manager = await signedIn("manager");

    const res = await restoreEntry(entry!.id, manager.token);

    expect(res.status).toBe(200);
    expect((await userRow(employee.id))!.deletedAt).toBeNull();
  });

  it("19. leaves non-user bin entries unaffected by the new guard", async () => {
    // The guard keys on the record type, so a business record still restores on
    // permission and bank access alone.
    const target = await createBank(ctx.db, "Disposable Bank");
    const token = await unscopedSuperUser();
    expect((await request(ctx.app).delete(`/api/banks/${target.id}`).set(bearer(token))).status).toBe(
      204,
    );

    const [entry] = await ctx.db
      .select()
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, target.id));
    expect(entry!.recordType).toBe("bank");

    expect((await restoreEntry(entry!.id, token)).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ group F */

describe("F — the guards that ran before the write still run", () => {
  it("20. refuses self-deletion, and writes no bin entry", async () => {
    const admin = await signedIn("admin");

    const res = await del(admin.id, admin.token);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("You cannot delete your own account");
    expect(await entriesFor(admin.id)).toHaveLength(0);
    expect((await userRow(admin.id))!.deletedAt).toBeNull();
  });

  it("21. refuses a target at or above the actor's role level", async () => {
    const admin = await signedIn("admin");
    const peer = await createUser(ctx.db, { roleKey: "admin" });

    const res = await del(peer.id, admin.token);

    expect(res.status).toBe(403);
    expect(await entriesFor(peer.id)).toHaveLength(0);
  });

  it("22. still refuses to remove the last active Super Admin, with no bin entry", async () => {
    // Reduce the protected population to nothing FIRST — the actor is created
    // afterwards, or the reset would deactivate them and their next request
    // would be refused as `accountInactive` before the invariant ever ran.
    await ctx.db
      .update(users)
      .set({ status: "Inactive" })
      .where(and(eq(users.status, "Active"), isNull(users.deletedAt)));

    // Fully permissioned, but on a non-system role — so the actor is outside the
    // population they would be emptying and the invariant, not the self-guard,
    // is what refuses.
    const token = await unscopedSuperUser();
    const lastOne = await createUser(ctx.db, { roleKey: "super_admin" });

    const res = await del(lastOne.id, token);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("The last active Super Admin cannot be removed");
    expect(await entriesFor(lastOne.id)).toHaveLength(0);
    expect((await userRow(lastOne.id))!.deletedAt).toBeNull();
  });
});
