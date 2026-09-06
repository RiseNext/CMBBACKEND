import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, count, eq, isNull } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import { customers, roles, users } from "../db/schema/index.js";

/**
 * FORCED PASSWORD CHANGE, ENFORCED SERVER-SIDE — SEC-010 / BUG-005 (Task 2.3)
 *
 * `mustChangePassword` was written on account creation, on admin reset and on an
 * admin-set password, returned on the login profile, and **consulted by nothing**.
 * Enforcement was a React redirect, so an administrator-issued temporary password
 * granted full role-scoped API access to any non-browser client indefinitely.
 *
 * The rule now: a flagged session may authenticate, see who it is, and replace
 * the password. Nothing else.
 *
 * Two properties are load-bearing and are asserted separately:
 *
 *  1. **The exemption is expressed by which middleware a route chooses, never by
 *     its URL.** `requireAuth` is applied by `router.use()` on twelve routers and
 *     by the `createScopedResource` factory, so inside it `req.path` is relative
 *     to the mount — a path allow-list would never match and would lock every
 *     flagged user out of the one route that can unflag them. Group C exists to
 *     catch exactly that failure.
 *  2. **A workflow restriction is not a session termination.** The session gates
 *     (`account_inactive`, `role_disabled`) still win, and the new code is not
 *     one of them — the user needs the session to fix the condition.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let superToken: string;
let executiveRoleId: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

interface Flagged {
  id: string;
  email: string;
  password: string;
  token: string;
  cookie: string[];
}

/** An employee created through the real route, so the flag is set the real way. */
let seq = 0;
async function flaggedEmployee(): Promise<Flagged> {
  seq += 1;
  const email = `forced${seq}@risenext.test`;
  const created = await request(ctx.app)
    .post("/api/users")
    .set(bearer(superToken))
    .send({
      name: `Forced User ${seq}`,
      email,
      employeeCode: `EMP-80${String(seq).padStart(2, "0")}`,
      roleId: executiveRoleId,
      bankIds: [bank.id],
    });
  const password = created.body.temporaryPassword as string;
  const session = await login(email, password);
  return {
    id: created.body.data.id as string,
    email,
    password,
    token: session.body.accessToken as string,
    cookie: (session.headers["set-cookie"] ?? []) as string[],
  };
}

async function customerCount(): Promise<number> {
  const [row] = await ctx.db.select({ n: count() }).from(customers);
  return row?.n ?? 0;
}

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Forced Change Bank");
  const sa = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (await login(sa.email, sa.password)).body.accessToken;
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ------------------------------------------------------------------ group A */

describe("A — a flagged account can still authenticate", () => {
  it("1/2. logs in successfully and the response still reports the flag", async () => {
    const user = await flaggedEmployee();
    const res = await login(user.email, user.password);

    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(typeof res.body.accessToken).toBe("string");
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — a flagged session cannot use the application", () => {
  it("3. GET /api/customers is refused", async () => {
    const user = await flaggedEmployee();
    const res = await request(ctx.app).get("/api/customers").set(bearer(user.token));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("password_change_required");
  });

  it("4. POST /api/customers is refused AND writes nothing", async () => {
    const user = await flaggedEmployee();
    const before = await customerCount();

    const res = await request(ctx.app)
      .post("/api/customers")
      .set(bearer(user.token))
      .send({
        bankId: bank.id,
        bankReferenceId: "REF-FORCED-1",
        name: "Should Never Exist",
        mobile: "9876543210",
        monthlyIncome: 50000,
        kyc: "Pending",
        status: "Active",
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("password_change_required");
    expect(await customerCount()).toBe(before);

    const [leaked] = await ctx.db
      .select()
      .from(customers)
      .where(eq(customers.name, "Should Never Exist"))
      .limit(1);
    expect(leaked).toBeUndefined();
  });

  it("5/6/7/8. the administrative surface is refused for a flagged Super Admin", async () => {
    // The seeded-bootstrap situation: full authority, temporary password.
    const sa = await createUser(ctx.db, { roleKey: "super_admin" });
    await ctx.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, sa.id));
    const token = (await login(sa.email, sa.password)).body.accessToken as string;
    const victim = await createUser(ctx.db, { roleKey: "executive" });

    const listUsers = await request(ctx.app).get("/api/users").set(bearer(token));
    const createUserRes = await request(ctx.app)
      .post("/api/users")
      .set(bearer(token))
      .send({
        name: "Never Minted",
        email: "never.minted@risenext.test",
        employeeCode: "EMP-8900",
        roleId: executiveRoleId,
      });
    const auditLogs = await request(ctx.app).get("/api/audit-logs").set(bearer(token));
    const reset = await request(ctx.app)
      .post(`/api/users/${victim.id}/reset-password`)
      .set(bearer(token))
      .send({});

    for (const res of [listUsers, createUserRes, auditLogs, reset]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("password_change_required");
    }

    // Nothing was minted and no credential was handed out.
    const [minted] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, "never.minted@risenext.test"))
      .limit(1);
    expect(minted).toBeUndefined();
    expect(reset.body.temporaryPassword).toBeUndefined();
  });

  it("3b. the refusal reaches routers mounted every way the app mounts them", async () => {
    const user = await flaggedEmployee();

    // router.use(requireAuth) directly, the factory, and a per-route mount.
    const paths = [
      "/api/customers", // customersRouter.use
      "/api/banks", // banksRouter.use
      "/api/users", // usersRouter.use
      "/api/roles", // rolesRouter.use
      "/api/teams", // teamsRouter.use
      "/api/audit-logs", // auditRouter.use
      "/api/notifications", // notificationsRouter.use
      "/api/recycle-bin", // recycleBinRouter.use
      "/api/dashboard/stats", // dashboardRouter.use
      "/api/service-providers", // serviceProvidersRouter.use
      "/api/loans", // createScopedResource factory
      "/api/documents", // createScopedResource factory
      "/api/ledger", // createScopedResource factory
    ];

    for (const path of paths) {
      const res = await request(ctx.app).get(path).set(bearer(user.token));
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe("password_change_required");
    }
  });

  it("22. the double-requireAuth route refuses once, with the same observable result", async () => {
    // POST /api/loans/:id/verification carries a per-route requireAuth on a
    // router that already ran router.use(requireAuth) via the factory.
    const user = await flaggedEmployee();
    const someUuid = "11111111-1111-4111-8111-111111111111";

    const flagged = await request(ctx.app)
      .post(`/api/loans/${someUuid}/verification`)
      .set(bearer(user.token))
      .send({ required: false });

    expect(flagged.status).toBe(403);
    expect(flagged.body.error.code).toBe("password_change_required");

    // ...and an unflagged caller is unaffected: it reaches the handler and 404s
    // on the missing loan, proving the gate did not change behaviour for them.
    const unflagged = await request(ctx.app)
      .post(`/api/loans/${someUuid}/verification`)
      .set(bearer(superToken))
      .send({ required: false });

    expect(unflagged.status).toBe(404);
    expect(unflagged.body.error.code).toBe("not_found");
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — the routes that must stay reachable, do", () => {
  it("9. POST /api/auth/change-password is NOT blocked by the new middleware", async () => {
    const user = await flaggedEmployee();

    // A wrong current password proves the request reached the handler's own
    // credential check. If the gate were applied here — or if it were built on a
    // path allow-list that silently never matched — this would be 403
    // password_change_required instead, and the account could never recover.
    const res = await request(ctx.app)
      .post("/api/auth/change-password")
      .set(bearer(user.token))
      .send({ currentPassword: "DefinitelyNotIt123!", newPassword: "ChosenByMe2026" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
    expect(res.body.error.code).not.toBe("password_change_required");
  });

  it("9b. its password policy still applies to a flagged caller", async () => {
    const user = await flaggedEmployee();
    const res = await request(ctx.app)
      .post("/api/auth/change-password")
      .set(bearer(user.token))
      .send({ currentPassword: user.password, newPassword: "short" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("unprocessable_entity");
  });

  it("10. GET /api/auth/me remains reachable and reports the flag", async () => {
    const user = await flaggedEmployee();
    const res = await request(ctx.app).get("/api/auth/me").set(bearer(user.token));

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(res.body.user.email).toBe(user.email);
  });

  it("11. POST /api/auth/login remains reachable", async () => {
    const user = await flaggedEmployee();
    expect((await login(user.email, user.password)).status).toBe(200);
  });

  it("12. POST /api/auth/refresh remains reachable and still returns the flag", async () => {
    const user = await flaggedEmployee();
    const res = await request(ctx.app).post("/api/auth/refresh").set("Cookie", user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);

    // The rotated token is just as restricted as the one it replaced.
    const blocked = await request(ctx.app)
      .get("/api/customers")
      .set(bearer(res.body.accessToken as string));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("password_change_required");
  });

  it("13. POST /api/auth/logout remains reachable", async () => {
    const user = await flaggedEmployee();
    const res = await request(ctx.app).post("/api/auth/logout").set("Cookie", user.cookie);
    expect(res.status).toBe(204);
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — changing the password lifts the restriction", () => {
  it("14/15/16/17. the full recovery path", async () => {
    const user = await flaggedEmployee();
    expect((await request(ctx.app).get("/api/customers").set(bearer(user.token))).status).toBe(403);

    // 14. the change itself
    const change = await request(ctx.app)
      .post("/api/auth/change-password")
      .set(bearer(user.token))
      .send({ currentPassword: user.password, newPassword: "ChosenByMe2026" });
    expect(change.status).toBe(204);

    const after = await ctx.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    expect(after[0]!.mustChangePassword).toBe(false);

    // 15. THE SAME access token now works — the context is re-read per request,
    // so the user is not stranded holding a token minted while flagged.
    const sameToken = await request(ctx.app).get("/api/customers").set(bearer(user.token));
    expect(sameToken.status).toBe(200);

    // 16. the temporary password is dead
    expect((await login(user.email, user.password)).status).toBe(401);

    // 17. the refresh cookie was revoked by change-password's existing behaviour
    const staleRefresh = await request(ctx.app).post("/api/auth/refresh").set("Cookie", user.cookie);
    expect(staleRefresh.status).toBe(401);

    // ...and a fresh login is unrestricted.
    const fresh = await login(user.email, "ChosenByMe2026");
    expect(fresh.status).toBe(200);
    expect(fresh.body.mustChangePassword).toBe(false);
    const unrestricted = await request(ctx.app)
      .get("/api/customers")
      .set(bearer(fresh.body.accessToken as string));
    expect(unrestricted.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — everyone else is untouched", () => {
  it("18. an unflagged user reaches every route they are entitled to", async () => {
    const employee = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
    const token = (await login(employee.email, employee.password)).body.accessToken as string;
    const [row] = await ctx.db.select().from(users).where(eq(users.id, employee.id)).limit(1);
    expect(row!.mustChangePassword).toBe(false);

    const list = await request(ctx.app).get("/api/customers").set(bearer(token));
    expect(list.status).toBe(200);

    const created = await request(ctx.app)
      .post("/api/customers")
      .set(bearer(token))
      .send({
        bankId: bank.id,
        bankReferenceId: "REF-UNFLAGGED-1",
        name: "Perfectly Fine",
        mobile: "9876543211",
        monthlyIncome: 50000,
        kyc: "Pending",
        status: "Active",
      });
    expect(created.status).toBe(201);

    const me = await request(ctx.app).get("/api/auth/me").set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(false);

    // A route their role genuinely cannot reach still says so, in the old way.
    const denied = await request(ctx.app).get("/api/users").set(bearer(token));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("forbidden");
  });

  it("19. a deactivated account still reports account_inactive, not the new code", async () => {
    const user = await flaggedEmployee();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, user.id));

    // Both conditions hold at once. The session gate must win: the session is
    // over, which is a strictly stronger statement than "change your password".
    const res = await request(ctx.app).get("/api/customers").set(bearer(user.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("account_inactive");
    expect(res.body.error.code).not.toBe("password_change_required");

    // ...including on the exempt routes, which must not become a hole.
    const onExempt = await request(ctx.app).get("/api/auth/me").set(bearer(user.token));
    expect(onExempt.status).toBe(403);
    expect(onExempt.body.error.code).toBe("account_inactive");

    const onChange = await request(ctx.app)
      .post("/api/auth/change-password")
      .set(bearer(user.token))
      .send({ currentPassword: user.password, newPassword: "ChosenByMe2026" });
    expect(onChange.status).toBe(403);
    expect(onChange.body.error.code).toBe("account_inactive");
  });

  it("20. a disabled role still reports role_disabled, not the new code", async () => {
    const user = await flaggedEmployee();
    const [ghostRole] = await ctx.db
      .insert(roles)
      .values({ key: "disabled_for_2_3", name: "Disabled For 2.3", level: 50, isActive: false })
      .returning();
    await ctx.db.update(users).set({ roleId: ghostRole!.id }).where(eq(users.id, user.id));

    const res = await request(ctx.app).get("/api/customers").set(bearer(user.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("role_disabled");

    const onExempt = await request(ctx.app).get("/api/auth/me").set(bearer(user.token));
    expect(onExempt.status).toBe(403);
    expect(onExempt.body.error.code).toBe("role_disabled");
  });

  it("21. the unauthenticated and soft-deleted ladders are unchanged", async () => {
    // No token at all.
    const anon = await request(ctx.app).get("/api/customers");
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("unauthorized");

    // A garbage token.
    const junk = await request(ctx.app).get("/api/customers").set(bearer("not-a-jwt"));
    expect(junk.status).toBe(401);

    // A soft-deleted account still 401s rather than 403-ing with the new code.
    const user = await flaggedEmployee();
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id));
    const deleted = await request(ctx.app).get("/api/customers").set(bearer(user.token));
    expect(deleted.status).toBe(401);
    expect(deleted.body.error.code).toBe("unauthorized");
  });

  it("21b. no flagged account leaks past the gate on any verb", async () => {
    const user = await flaggedEmployee();
    const [target] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, user.email), isNull(users.deletedAt)))
      .limit(1);

    const attempts = [
      request(ctx.app).patch(`/api/users/${target!.id}`).set(bearer(user.token)).send({ name: "X Y" }),
      request(ctx.app).delete(`/api/users/${target!.id}`).set(bearer(user.token)),
      request(ctx.app).put(`/api/users/${target!.id}/banks`).set(bearer(user.token)).send({ bankIds: [] }),
      request(ctx.app).post("/api/notifications/read-all").set(bearer(user.token)),
    ];

    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("password_change_required");
    }
  });
});
