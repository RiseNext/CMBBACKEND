import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
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
import {
  assertCanAssignRole,
  assertCanGrantPermissions,
  assertCanManageRoleLevel,
  loadAuthContext,
} from "../services/access.js";
import { PERMISSIONS } from "../lib/permissions.js";

let ctx: TestContext;
let bankA: { id: string; code: string };
let bankB: { id: string; code: string };

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  ctx = await createTestContext();
  bankA = await createBank(ctx.db, "Bank A");
  bankB = await createBank(ctx.db, "Bank B");
}, 60_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("schema migration", () => {
  it("creates every expected table from scratch", async () => {
    const result = await ctx.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const tables = (result.rows as { table_name: string }[]).map((r) => r.table_name);
    for (const expected of [
      "app_settings",
      "audit_logs",
      "banks",
      "customers",
      "import_batches",
      "import_rows",
      "permissions",
      "recycle_bin_entries",
      "refresh_tokens",
      "role_permissions",
      "roles",
      "team_members",
      "teams",
      "user_bank_access",
      "users",
    ]) {
      expect(tables, `missing table ${expected}`).toContain(expected);
    }
  });

  it("seeds the permission catalogue and the protected super admin role", async () => {
    const perms = await ctx.db.select().from(schema.permissions);
    expect(perms.length).toBeGreaterThan(50);
    const superAdmin = await roleByKey(ctx.db, "super_admin");
    expect(superAdmin.isSystem).toBe(true);
    expect(superAdmin.level).toBe(0);
  });
});

describe("authentication", () => {
  it("rejects a bad password and never leaks whether the account exists", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    const wrongPassword = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "NotThePassword1!" });
    const noSuchUser = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "ghost@risenext.test", password: "NotThePassword1!" });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(noSuchUser.body.error.message);
  });

  it("stores passwords as argon2id hashes, never in the clear", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    const [row] = await ctx.db
      .select({ hash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(row?.hash).toMatch(/^\$argon2id\$/);
    expect(row?.hash).not.toContain(user.password);
  });

  it("refuses every API call without a token", async () => {
    const res = await request(ctx.app).get("/api/customers");
    expect(res.status).toBe(401);
  });

  it("does not let the client choose its own role at login", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password, role: "Super Admin" });
    expect(res.status).toBe(200);
    expect(res.body.user.role.key).toBe("executive");
  });
});

describe("bank scoping is enforced server-side", () => {
  it("hides another bank's customer from a scoped user, even by direct id", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });

    const adminToken = await login(superAdmin.email, superAdmin.password);
    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(customerPayload(bankB.id, "SCOPE-001"));
    expect(created.status).toBe(201);
    const foreignId = created.body.data.id as string;

    const execToken = await login(executive.email, executive.password);

    // Not in the list...
    const list = await request(ctx.app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${execToken}`);
    expect(list.status).toBe(200);
    expect((list.body.data as { id: string }[]).map((c) => c.id)).not.toContain(foreignId);

    // ...and not reachable by guessing the id either.
    const direct = await request(ctx.app)
      .get(`/api/customers/${foreignId}`)
      .set("Authorization", `Bearer ${execToken}`);
    expect(direct.status).toBe(404);

    // ...and not writable.
    const patch = await request(ctx.app)
      .patch(`/api/customers/${foreignId}`)
      .set("Authorization", `Bearer ${execToken}`)
      .send({ name: "Hijacked" });
    expect(patch.status).toBe(404);
  });

  it("blocks creating a record under an unassigned bank", async () => {
    const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });
    const token = await login(executive.email, executive.password);

    const res = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankB.id, "SCOPE-002"));

    expect(res.status).toBe(403);
  });

  it("blocks moving a customer into an unassigned bank", async () => {
    const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });
    const token = await login(executive.email, executive.password);

    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "SCOPE-003"));
    expect(created.status).toBe(201);

    const moved = await request(ctx.app)
      .patch(`/api/customers/${created.body.data.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ bankId: bankB.id });
    expect(moved.status).toBe(403);
  });

  it("gives a user with no bank assignments an empty result, not everything", async () => {
    const orphan = await createUser(ctx.db, { roleKey: "executive", bankIds: [] });
    const token = await login(orphan.email, orphan.password);
    const res = await request(ctx.app).get("/api/customers").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("lets a super admin see across every bank", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = await login(superAdmin.email, superAdmin.password);
    const res = await request(ctx.app).get("/api/banks").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.scoped).toBe(false);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });
});

describe("permission gating", () => {
  it("refuses an operation the role does not hold", async () => {
    const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });
    const token = await login(executive.email, executive.password);

    // The Executive role holds customers.create but not customers.delete.
    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "PERM-001"));
    expect(created.status).toBe(201);

    const removed = await request(ctx.app)
      .delete(`/api/customers/${created.body.data.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(removed.status).toBe(403);
  });

  it("applies a permission revoked mid-session on the very next request", async () => {
    const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bankA.id] });
    const token = await login(manager.email, manager.password);

    const before = await request(ctx.app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);

    const role = await roleByKey(ctx.db, "manager");
    const [perm] = await ctx.db
      .select()
      .from(schema.permissions)
      .where(eq(schema.permissions.key, PERMISSIONS.customers.view));

    await ctx.db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.permissionId, perm!.id),
          eq(schema.rolePermissions.roleId, role.id),
        ),
      );

    const after = await request(ctx.app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(403);

    // Restore for the remaining tests.
    await ctx.db
      .insert(schema.rolePermissions)
      .values({ roleId: role.id, permissionId: perm!.id })
      .onConflictDoNothing();
  });
});

describe("role hierarchy", () => {
  it("stops an admin managing a peer admin or a super admin", async () => {
    const admin = await createUser(ctx.db, { roleKey: "admin" });
    const adminCtx = await loadAuthContext(ctx.db, admin.id);

    const adminRole = await roleByKey(ctx.db, "admin");
    const superAdminRole = await roleByKey(ctx.db, "super_admin");
    const managerRole = await roleByKey(ctx.db, "manager");

    expect(() => assertCanManageRoleLevel(adminCtx, adminRole.level)).toThrow();
    expect(() => assertCanManageRoleLevel(adminCtx, superAdminRole.level)).toThrow();
    expect(() => assertCanManageRoleLevel(adminCtx, managerRole.level)).not.toThrow();

    expect(() => assertCanAssignRole(adminCtx, adminRole)).toThrow();
    expect(() => assertCanAssignRole(adminCtx, superAdminRole)).toThrow();
    expect(() => assertCanAssignRole(adminCtx, managerRole)).not.toThrow();
  });

  it("lets a super admin manage anyone", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const superCtx = await loadAuthContext(ctx.db, superAdmin.id);
    const adminRole = await roleByKey(ctx.db, "admin");
    const superAdminRole = await roleByKey(ctx.db, "super_admin");

    expect(() => assertCanAssignRole(superCtx, adminRole)).not.toThrow();
    expect(() => assertCanAssignRole(superCtx, superAdminRole)).not.toThrow();
  });

  it("stops privilege escalation through role editing", async () => {
    const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bankA.id] });
    const managerCtx = await loadAuthContext(ctx.db, manager.id);

    // A Manager does not hold system.access_all_banks, so cannot grant it.
    expect(() =>
      assertCanGrantPermissions(managerCtx, [PERMISSIONS.system.accessAllBanks]),
    ).toThrow();
    expect(() => assertCanGrantPermissions(managerCtx, [PERMISSIONS.customers.view])).not.toThrow();
  });

  it("keeps role ids stable when a role is renamed", async () => {
    const before = await roleByKey(ctx.db, "team_leader");
    await ctx.db
      .update(schema.roles)
      .set({ name: "Branch Lead" })
      .where(eq(schema.roles.id, before.id));
    const after = await roleByKey(ctx.db, "team_leader");

    expect(after.id).toBe(before.id);
    expect(after.name).toBe("Branch Lead");
    expect(after.key).toBe("team_leader");
  });
});

describe("bank reference id uniqueness", () => {
  it("allows the same reference across different banks, rejects a repeat within one", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = await login(superAdmin.email, superAdmin.password);

    const first = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "REF001"));
    expect(first.status).toBe(201);

    const otherBank = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankB.id, "REF001"));
    expect(otherBank.status).toBe(201);

    const duplicate = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "REF001"));
    expect(duplicate.status).toBe(409);

    // Case-insensitive: ref001 must clash with REF001.
    const caseVariant = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "ref001"));
    expect(caseVariant.status).toBe(409);
  });

  it("frees the reference again once the customer is in the recycle bin", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = await login(superAdmin.email, superAdmin.password);

    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "REF-RECYCLE"));
    expect(created.status).toBe(201);

    await request(ctx.app)
      .delete(`/api/customers/${created.body.data.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const reused = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "REF-RECYCLE"));
    expect(reused.status).toBe(201);
  });
});

describe("recycle bin", () => {
  it("soft deletes into the bin rather than destroying the row", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = await login(superAdmin.email, superAdmin.password);

    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "BIN-001"));
    const id = created.body.data.id as string;

    await request(ctx.app)
      .delete(`/api/customers/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const [row] = await ctx.db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, id));
    expect(row).toBeDefined();
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.purgeAfter).not.toBeNull();

    const [entry] = await ctx.db
      .select()
      .from(schema.recycleBinEntries)
      .where(eq(schema.recycleBinEntries.recordId, id));
    expect(entry?.recordType).toBe("customer");
    expect(entry?.snapshot).not.toBeNull();

    const fetched = await request(ctx.app)
      .get(`/api/customers/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(fetched.status).toBe(404);
  });
});

describe("audit trail", () => {
  it("records who did what, and cannot be rewritten", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = await login(superAdmin.email, superAdmin.password);

    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "AUDIT-001"));
    const id = created.body.data.id as string;

    const logs = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.recordId, id));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]?.action).toBe("created");
    expect(logs[0]?.actorEmail).toBe(superAdmin.email);

    await expect(
      ctx.db.execute(sql`update audit_logs set summary = 'tampered' where record_id = ${id}`),
    ).rejects.toThrow();

    await expect(
      ctx.db.execute(sql`delete from audit_logs where record_id = ${id}`),
    ).rejects.toThrow();
  });

  it("never writes a password or aadhaar value into the change diff", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = await login(superAdmin.email, superAdmin.password);

    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "AUDIT-002", { aadhaar: "123456789012" }));
    expect(created.status).toBe(201);

    await request(ctx.app)
      .patch(`/api/customers/${created.body.data.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ aadhaar: "210987654321" })
      .expect(200);

    const logs = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.recordId, created.body.data.id));
    const serialised = JSON.stringify(logs);
    expect(serialised).not.toContain("123456789012");
    expect(serialised).not.toContain("210987654321");
  });
});

describe("data protection", () => {
  it("stores aadhaar as a hash plus last four digits, never in the clear", async () => {
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = await login(superAdmin.email, superAdmin.password);

    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send(customerPayload(bankA.id, "PII-001", { aadhaar: "4412 8890 1123" }));
    expect(created.status).toBe(201);

    const [row] = await ctx.db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, created.body.data.id));

    expect(row?.aadhaarLast4).toBe("1123");
    expect(row?.aadhaarHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain("441288901123");
  });
});

describe("protected system role", () => {
  it("cannot be deleted or re-keyed, even with direct SQL", async () => {
    await expect(
      ctx.db.execute(sql`delete from roles where key = 'super_admin'`),
    ).rejects.toThrow();

    await expect(
      ctx.db.execute(sql`update roles set key = 'not_super' where key = 'super_admin'`),
    ).rejects.toThrow();

    await expect(
      ctx.db.execute(sql`update roles set is_active = false where key = 'super_admin'`),
    ).rejects.toThrow();
  });

  it("can still be renamed, because the display label is not the identity", async () => {
    await ctx.db.execute(sql`update roles set name = 'Owner' where key = 'super_admin'`);
    const role = await roleByKey(ctx.db, "super_admin");
    expect(role.name).toBe("Owner");
    await ctx.db.execute(sql`update roles set name = 'Super Admin' where key = 'super_admin'`);
  });
});

describe("health", () => {
  it("answers liveness and readiness", async () => {
    const live = await request(ctx.app).get("/api/health");
    expect(live.status).toBe(200);
    expect(live.body.status).toBe("ok");

    const ready = await request(ctx.app).get("/api/health/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.database.connected).toBe(true);
  });
});
