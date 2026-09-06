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
import * as schema from "../db/schema/index.js";

/**
 * SESSION-INVALIDATING 403s — BUG-034
 *
 * Every 403 in this API used to carry `code: "forbidden"` — a deactivated
 * account, a missing permission, an out-of-scope record and the demo layer's
 * fabricated refusals were byte-identical to a client. The frontend therefore
 * could not sign a deactivated user out without also signing out anyone who
 * merely opened a page their role cannot see.
 *
 * Two of those cases now carry their own codes. The tests that matter most are
 * the NEGATIVE ones: an ordinary permission or bank-scope refusal must still be
 * `forbidden`, or the client starts ending sessions for routine browsing.
 *
 * Status stays 403 throughout — the caller genuinely is authenticated.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let otherBank: { id: string; code: string };

/** Signs in and returns the bearer token, asserting the login worked. */
async function login(email: string, password = "TestPassword123!") {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  return { status: res.status, token: res.body?.accessToken as string | undefined, body: res.body };
}

const get = (path: string, token?: string) =>
  token
    ? request(ctx.app).get(path).set("Authorization", `Bearer ${token}`)
    : request(ctx.app).get(path);

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Session Bank");
  otherBank = await createBank(ctx.db, "Other Session Bank");
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("A — session-invalidating states get their own codes", () => {
  it("a deactivated account gets 403 account_inactive on an ordinary request", async () => {
    const user = await createUser(ctx.db, { roleKey: "admin" });
    const { token } = await login(user.email);

    // Works before deactivation — so the assertion below is about the change of
    // state, not about the account never having had access.
    expect((await get("/api/customers", token)).status).toBe(200);

    await ctx.db
      .update(schema.users)
      .set({ status: "Inactive" })
      .where(eq(schema.users.id, user.id));

    const res = await get("/api/customers", token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("account_inactive");
    // The old code must be gone, or the frontend cannot distinguish anything.
    expect(res.body.error.code).not.toBe("forbidden");
  });

  it("surfaces on every endpoint at once, which is what makes it safe to act on", async () => {
    // The property the client relies on: a session gate fires regardless of
    // what was requested, unlike a permission refusal which is per-route.
    const user = await createUser(ctx.db, { roleKey: "admin" });
    const { token } = await login(user.email);
    await ctx.db
      .update(schema.users)
      .set({ status: "Inactive" })
      .where(eq(schema.users.id, user.id));

    for (const path of ["/api/customers", "/api/banks", "/api/users", "/api/loans"]) {
      const res = await get(path, token);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe("account_inactive");
    }
  });

  it("a disabled assigned role gets 403 role_disabled", async () => {
    const role = await roleByKey(ctx.db, "manager");
    const user = await createUser(ctx.db, { roleKey: "manager", bankIds: [bank.id] });
    const { token } = await login(user.email);

    await ctx.db.update(schema.roles).set({ isActive: false }).where(eq(schema.roles.id, role.id));
    try {
      const res = await get("/api/customers", token);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("role_disabled");
    } finally {
      await ctx.db.update(schema.roles).set({ isActive: true }).where(eq(schema.roles.id, role.id));
    }
  });

  it("keeps the standard error shape and leaks nothing extra", async () => {
    const user = await createUser(ctx.db, { roleKey: "admin" });
    const { token } = await login(user.email);
    await ctx.db
      .update(schema.users)
      .set({ status: "Inactive" })
      .where(eq(schema.users.id, user.id));

    const res = await get("/api/customers", token);

    expect(Object.keys(res.body)).toEqual(["error"]);
    expect(Object.keys(res.body.error).sort()).toEqual(["code", "message"]);
    expect(JSON.stringify(res.body)).not.toMatch(/\bat\s+\S+\s+\(|node_modules|[A-Za-z]:\\/);
  });
});

describe("B — ordinary authorisation refusals are UNCHANGED", () => {
  /*
   * These are the regression guards. If any of them starts returning a
   * session-invalidating code, the frontend will sign users out for browsing.
   */
  it("a missing permission is still forbidden", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
    const { token } = await login(user.email);

    // Executive does not hold reports.view.
    const res = await get("/api/dashboard/stats", token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("a bank-scope refusal is still forbidden", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
    const { token } = await login(user.email);

    const res = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        bankId: otherBank.id,
        bankReferenceId: "REF-SESSION-1",
        name: "Out Of Scope",
        mobile: "9876543210",
        monthlyIncome: 50000,
        kyc: "Pending",
        status: "Active",
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("a role-hierarchy refusal is still forbidden", async () => {
    const actor = await createUser(ctx.db, { roleKey: "admin" });
    const { token } = await login(actor.email);
    const superAdminRole = await roleByKey(ctx.db, "super_admin");

    // An Admin may not create a Super Admin — hierarchy, not session state.
    const res = await request(ctx.app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Escalation Attempt",
        email: `escalate-${Date.now()}@risenext.test`,
        employeeCode: `EMP-ESC-${Date.now()}`,
        roleId: superAdminRole.id,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });
});

describe("C — the surrounding auth states are unchanged", () => {
  it("a soft-deleted account is still 401 unauthorized", async () => {
    const user = await createUser(ctx.db, { roleKey: "admin" });
    const { token } = await login(user.email);

    await ctx.db
      .update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    const res = await get("/api/customers", token);

    // Deletion is a 401, not a session-invalidating 403 — the existing refresh
    // ladder already handles it and this task must not disturb that.
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("a missing or invalid bearer token is still 401", async () => {
    expect((await get("/api/customers")).status).toBe(401);
    expect((await get("/api/customers", "not-a-real-token")).status).toBe(401);
  });

  it("logging in to a deactivated account still fails with 403", async () => {
    // Login is a separate flow with no session to end. It keeps returning 403;
    // the frontend deliberately ignores it because no access token is held.
    const user = await createUser(ctx.db, { roleKey: "admin" });
    await ctx.db
      .update(schema.users)
      .set({ status: "Inactive" })
      .where(eq(schema.users.id, user.id));

    const res = await login(user.email);

    expect(res.status).toBe(403);
  });

  it("refresh for a deactivated account fails, so the 401 ladder still ends the session", async () => {
    // Belt and braces: even before this task, an expiring access token would
    // eventually sign a deactivated user out through refresh. That path must
    // keep working — the new codes shorten the window, they do not replace it.
    const user = await createUser(ctx.db, { roleKey: "admin" });
    const loginRes = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "TestPassword123!" });
    const cookies = (loginRes.headers["set-cookie"] ?? []) as unknown as string[];

    await ctx.db
      .update(schema.users)
      .set({ status: "Inactive" })
      .where(eq(schema.users.id, user.id));

    const res = await request(ctx.app).post("/api/auth/refresh").set("Cookie", cookies);

    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("account_inactive");
  });
});
