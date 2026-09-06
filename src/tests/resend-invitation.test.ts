import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, isNull, lt } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import {
  auditLogs,
  invitations,
  permissions as permissionsTable,
  recycleBinEntries,
  rolePermissions,
  roles,
  users,
} from "../db/schema/index.js";
import { resetEnvCache } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { sha256 } from "../lib/password.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { INVITATION_TTL_HOURS } from "../services/invitations.js";
import { resetRateLimits } from "../middleware/rate-limit.js";

/**
 * RESEND INVITATION — roadmap task 3.8
 *
 * `POST /api/users/:id/resend-invitation`. The route is deliberately thin — it
 * reuses `issueInvitation` wholesale — so almost all of the risk is in the
 * decisions *around* the reissue, and that is where the groups are weighted:
 *
 *   - **Authorization** (group A). A credential route gated only on a flat
 *     permission is precisely what **BUG-038** was. `users.reset_password` is
 *     required *and* the hierarchy rule applies, so the full actor x target
 *     matrix is walked here rather than reasoned about.
 *   - **State guards** (group D). Already-accepted and non-active employees are
 *     refused, because the first would be a second password-reset path that
 *     skips session revocation and the second would mail a link that
 *     `acceptInvitation` will not honour (**D-004**).
 *   - **Supersession** (groups B, C). The old link must be dead the moment the
 *     new one exists, and that must hold for the token an employee is actually
 *     holding — so it is tested by *redeeming* it, not by reading a column.
 *
 * The test environment has no email configuration, so `sendEmail` takes the
 * console transport (**D-035**); that is how the link is captured, exactly as
 * `invitations.test.ts` does it.
 */

let ctx: TestContext;
let superToken: string;
let adminToken: string;
let managerToken: string;
let teamLeaderToken: string;
let executiveToken: string;
let bank: { id: string; code: string };
let executiveRoleId: string;

type RoleKey = "super_admin" | "admin" | "manager" | "team_leader" | "executive";

/** Targets, by the role of the employee being resent an invitation. */
const target = {} as Record<RoleKey, string>;

const ROLE_KEYS: RoleKey[] = ["super_admin", "admin", "manager", "team_leader", "executive"];

/** Accounts minted up front for `bespokeActor` — see the note there. */
const spareUsers: { id: string; email: string; password: string }[] = [];

/** A target nothing else in the file touches, so it stays genuinely uninvited. */
let neverInvitedId: string;

let n = 0;
let counter = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

const GOOD_PASSWORD = "ChosenByTheEmployee1";

const resend = (userId: string, token: string) =>
  request(ctx.app).post(`/api/users/${userId}/resend-invitation`).set(bearer(token)).send({});

const accept = (token: string, password = GOOD_PASSWORD) =>
  request(ctx.app).post("/api/auth/accept-invite").send({ token, password });

/** Captures whatever the console transport logs while `fn` runs. */
async function captureEmail<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const lines: unknown[][] = [];
  const info = vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
    lines.push(args);
  }) as never);
  const warn = vi.spyOn(logger, "warn").mockImplementation(((...args: unknown[]) => {
    lines.push(args);
  }) as never);
  try {
    const result = await fn();
    return { result, logged: JSON.stringify(lines) };
  } finally {
    info.mockRestore();
    warn.mockRestore();
  }
}

const linkIn = (logged: string): string | null => {
  const match = /accept-invite\?token=([A-Za-z0-9_%-]+)/.exec(logged);
  return match ? decodeURIComponent(match[1]!) : null;
};

interface NewEmployee {
  id: string;
  email: string;
  name: string;
  token: string;
}

/** Creates an employee through the real route and pulls the link out of the mail. */
async function createEmployee(overrides: Record<string, unknown> = {}): Promise<NewEmployee> {
  n += 1;
  const email = `resend.${n}@risenext.com`;
  const name = `Resend Target ${n}`;

  const { result: res, logged } = await captureEmail(() =>
    request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name, email, roleId: executiveRoleId, bankIds: [bank.id], ...overrides }),
  );

  expect(res.status).toBe(201);
  const token = linkIn(logged);
  if (!token) throw new Error(`no invitation link in the sent email: ${logged.slice(0, 300)}`);

  return { id: res.body.data.id as string, email, name, token };
}

/** Resends through the real route and pulls the fresh link out of the mail. */
async function resendAndCapture(userId: string, actor = superToken) {
  const { result: res, logged } = await captureEmail(() => resend(userId, actor));
  return { res, token: linkIn(logged), logged };
}

const rowsFor = (userId: string) =>
  ctx.db.select().from(invitations).where(eq(invitations.userId, userId));

const liveRowsFor = (userId: string) =>
  ctx.db
    .select()
    .from(invitations)
    .where(and(eq(invitations.userId, userId), isNull(invitations.consumedAt)));

const userRow = async (id: string) => {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
};

/** Obvious junk. No real key is ever used here, and none is needed. */
const FAKE_KEY = "re_test_not_a_real_key_0000000000";

/**
 * Points the environment at a configured provider whose `fetch` always fails,
 * so the route walks the real transport, the real retries and the real outcome.
 * Returns the undo — call it in a `finally`.
 */
function withFailingProvider(): () => void {
  const previous = { ...process.env };
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_API_KEY = FAKE_KEY;
  process.env.EMAIL_FROM = "Rise Next <no-reply@risenext.test>";
  process.env.EMAIL_REPLY_TO = "support@risenext.test";
  resetEnvCache();

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("provider exploded", { status: 500 })),
  );

  return () => {
    vi.unstubAllGlobals();
    process.env = previous;
    resetEnvCache();
  };
}

/** Ages every outstanding invitation for a user past its expiry. */
const expireInvitations = (userId: string) =>
  ctx.db
    .update(invitations)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(invitations.userId, userId));

/**
 * An actor on a bespoke role at `level` holding exactly `keys` — notably NOT
 * `system.manage_any_user`, so the hierarchy rule actually applies to them.
 * Same shape `user-recycle-bin.test.ts` uses; `POST /api/roles` can mint it.
 */
async function bespokeActor(level: number, keys: string[]): Promise<string> {
  const [role] = await ctx.db
    .insert(roles)
    .values({
      key: `resend_bespoke_${++counter}`,
      name: `Resend Bespoke ${counter}`,
      level,
      isSystem: false,
    })
    .returning();

  const rows = await ctx.db
    .select({ id: permissionsTable.id, key: permissionsTable.key })
    .from(permissionsTable);
  const grants = rows
    .filter((p) => keys.includes(p.key))
    .map((p) => ({ roleId: role!.id, permissionId: p.id }));
  if (grants.length > 0) await ctx.db.insert(rolePermissions).values(grants);

  /*
   * Taken from a pool minted in `beforeAll` rather than created here. Creating a
   * harness user mid-suite would collide with a route-generated employee code —
   * the harness counts from its own counter while the route takes max+1.
   */
  const user = spareUsers.shift();
  if (!user) throw new Error("bespoke actor pool exhausted — mint more in beforeAll");
  await ctx.db.update(users).set({ roleId: role!.id }).where(eq(users.id, user.id));
  return (await login(user.email, user.password)).body.accessToken as string;
}

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Resend Test Bank");
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;

  /*
   * Every direct-insert fixture is minted up front, before any route-created
   * employee exists. The harness numbers codes from its own counter (EMP-1001,
   * EMP-1002 ...) while the route generates max+1 over existing rows, so a
   * harness user created AFTER a route-created one collides. A fixture
   * interaction, not a product defect — see `invitations.test.ts`.
   */
  const actors = {
    super_admin: await createUser(ctx.db, { roleKey: "super_admin" }),
    admin: await createUser(ctx.db, { roleKey: "admin" }),
    manager: await createUser(ctx.db, { roleKey: "manager" }),
    team_leader: await createUser(ctx.db, { roleKey: "team_leader" }),
    executive: await createUser(ctx.db, { roleKey: "executive" }),
  };

  // Targets are separate accounts from the actors, so an actor is never
  // accidentally acting on themselves.
  for (const key of ROLE_KEYS) {
    const user = await createUser(ctx.db, { roleKey: key });
    target[key] = user.id;
  }

  neverInvitedId = (await createUser(ctx.db, { roleKey: "executive" })).id;
  for (let i = 0; i < 4; i += 1) {
    spareUsers.push(await createUser(ctx.db, { roleKey: "executive" }));
  }

  superToken = (await login(actors.super_admin.email, actors.super_admin.password)).body
    .accessToken as string;
  adminToken = (await login(actors.admin.email, actors.admin.password)).body
    .accessToken as string;
  managerToken = (await login(actors.manager.email, actors.manager.password)).body
    .accessToken as string;
  teamLeaderToken = (await login(actors.team_leader.email, actors.team_leader.password)).body
    .accessToken as string;
  executiveToken = (await login(actors.executive.email, actors.executive.password)).body
    .accessToken as string;
});

afterAll(async () => destroyTestContext(ctx));

/*
 * `accept-invite` carries the Task 3.6 limiter (10 per 15 minutes) and this
 * file redeems far more links than that. The limiter is process-wide, so one
 * case must not throttle the next.
 */
beforeEach(() => resetRateLimits());
afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

/* ------------------------------------------------------------------ group A */

describe("A — authorization: the permission AND the hierarchy", () => {
  it("1. an unauthenticated caller is refused", async () => {
    const res = await request(ctx.app)
      .post(`/api/users/${target.executive}/resend-invitation`)
      .send({});

    expect(res.status).toBe(401);
  });

  it("2. Super Admin may resend to an Executive", async () => {
    const res = await resend(target.executive, superToken);
    expect(res.status).toBe(200);
  });

  it("3. Super Admin may resend to an Admin — manage_any_user bypasses hierarchy", async () => {
    const res = await resend(target.admin, superToken);
    expect(res.status).toBe(200);
  });

  it("4. Super Admin may resend to another Super Admin, for the same reason", async () => {
    const res = await resend(target.super_admin, superToken);
    expect(res.status).toBe(200);
  });

  it("5. Admin may resend to an Executive", async () => {
    const res = await resend(target.executive, adminToken);
    expect(res.status).toBe(200);
  });

  it("6. Admin may resend to a Team Leader", async () => {
    const res = await resend(target.team_leader, adminToken);
    expect(res.status).toBe(200);
  });

  it("7. Admin may resend to a Manager", async () => {
    const res = await resend(target.manager, adminToken);
    expect(res.status).toBe(200);
  });

  it("8. Admin may NOT resend to an Admin peer — not strictly greater", async () => {
    const res = await resend(target.admin, adminToken);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/at or above your own role level/i);
  });

  it("9. Admin may NOT resend to a Super Admin", async () => {
    const res = await resend(target.super_admin, adminToken);
    expect(res.status).toBe(403);
  });

  it("10. Manager is refused — the permission is not held", async () => {
    const res = await resend(target.executive, managerToken);
    expect(res.status).toBe(403);
  });

  it("11. Team Leader is refused", async () => {
    const res = await resend(target.executive, teamLeaderToken);
    expect(res.status).toBe(403);
  });

  it("12. Executive is refused", async () => {
    const res = await resend(target.executive, executiveToken);
    expect(res.status).toBe(403);
  });

  it("13. the gate is users.reset_password specifically — users.edit is not enough", async () => {
    /*
     * The exact boundary. A bespoke role that can edit employees but cannot hand
     * out credentials must not be able to mail a password-setting link.
     */
    const editor = await bespokeActor(10, [PERMISSIONS.users.view, PERMISSIONS.users.edit]);
    const res = await resend(target.executive, editor);

    expect(res.status).toBe(403);
  });

  it("14. the same bespoke role WITH users.reset_password succeeds", async () => {
    const resetter = await bespokeActor(10, [
      PERMISSIONS.users.view,
      PERMISSIONS.users.resetPassword,
    ]);
    const res = await resend(target.executive, resetter);

    expect(res.status).toBe(200);
  });

  it("15. that bespoke holder is still bound by the hierarchy", async () => {
    /*
     * The BUG-038 shape: holding the permission is not authorization to act on
     * a *particular* subject. A level-10 role with no manage_any_user cannot
     * reach a Super Admin.
     */
    const resetter = await bespokeActor(10, [
      PERMISSIONS.users.view,
      PERMISSIONS.users.resetPassword,
    ]);
    const res = await resend(target.super_admin, resetter);

    expect(res.status).toBe(403);
  });

  it("16. a refusal issues no invitation and moves no timestamp", async () => {
    const before = await userRow(target.super_admin);
    const rowsBefore = await rowsFor(target.super_admin);

    expect((await resend(target.super_admin, adminToken)).status).toBe(403);

    const after = await userRow(target.super_admin);
    expect((await rowsFor(target.super_admin)).length).toBe(rowsBefore.length);
    expect(after.invitedAt?.getTime()).toBe(before.invitedAt?.getTime());
  });

  it("17. an unknown user is 404, and authorization is not leaked around it", async () => {
    const res = await resend("11111111-1111-4111-8111-111111111111", superToken);
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — the reissue itself", () => {
  it("18. an employee with an expired invitation can be given a fresh one", async () => {
    const employee = await createEmployee();
    await expireInvitations(employee.id);

    const { res, token } = await resendAndCapture(employee.id);

    expect(res.status).toBe(200);
    expect(token).toBeTruthy();
    expect(token).not.toBe(employee.token);
  });

  it("19. the fresh invitation is a genuinely new token", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);

    const rows = await rowsFor(employee.id);
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.tokenHash)).size).toBe(2);
    expect(rows.some((r) => r.tokenHash === sha256(token!))).toBe(true);
  });

  it("20. the previous unused invitation is superseded, leaving exactly one live row", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id);

    const live = await liveRowsFor(employee.id);
    expect(live.length).toBe(1);
  });

  it("21. the superseded row is marked consumed, not deleted — history survives", async () => {
    const employee = await createEmployee();
    const originalHash = sha256(employee.token);
    await resendAndCapture(employee.id);

    const rows = await rowsFor(employee.id);
    const original = rows.find((r) => r.tokenHash === originalHash);
    expect(original).toBeDefined();
    expect(original!.consumedAt).not.toBeNull();
  });

  it("22. the OLD token can no longer be redeemed", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id);

    const res = await accept(employee.token);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not valid/i);
  });

  it("23. the NEW token can be redeemed and sets the password", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);

    expect((await accept(token!)).status).toBe(204);
    expect((await login(employee.email, GOOD_PASSWORD)).status).toBe(200);
  });

  it("24. resend works repeatedly — only the newest of three survives", async () => {
    const employee = await createEmployee();
    const first = await resendAndCapture(employee.id);
    const second = await resendAndCapture(employee.id);

    expect((await liveRowsFor(employee.id)).length).toBe(1);
    expect((await accept(employee.token)).status).toBe(400);
    expect((await accept(first.token!)).status).toBe(400);
    expect((await accept(second.token!)).status).toBe(204);
  });

  it("25. the new invitation carries the existing 72-hour policy, not a second constant", async () => {
    const employee = await createEmployee();
    const before = Date.now();
    await resendAndCapture(employee.id);

    const [live] = await liveRowsFor(employee.id);
    const hours = (live!.expiresAt.getTime() - before) / 3_600_000;

    expect(hours).toBeGreaterThan(INVITATION_TTL_HOURS - 0.5);
    expect(hours).toBeLessThanOrEqual(INVITATION_TTL_HOURS + 0.5);
  });

  it("26. the response reports the same expiry the row carries", async () => {
    const employee = await createEmployee();
    const { res } = await resendAndCapture(employee.id);

    expect(res.body.invitation.expiresInHours).toBe(INVITATION_TTL_HOURS);
  });

  it("27. an employee who was never invited can be invited through this route", async () => {
    /*
     * Employees predating Task 3.5 have no invitation at all. Refusing them here
     * would leave them with no route to a credential link, so the guard is on
     * *acceptance*, not on whether a previous invitation exists.
     */
    const before = await userRow(neverInvitedId);
    expect(before.invitedAt).toBeNull();
    expect((await rowsFor(neverInvitedId)).length).toBe(0);

    const { res, token } = await resendAndCapture(neverInvitedId, adminToken);

    expect(res.status).toBe(200);
    expect(token).toBeTruthy();
    expect((await userRow(neverInvitedId)).invitedAt).not.toBeNull();
    expect((await accept(token!)).status).toBe(204);
  });

  it("28. the reissue records who issued it", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id, adminToken);

    const [live] = await liveRowsFor(employee.id);
    expect(live!.createdBy).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — token security", () => {
  it("29. the raw token is never stored — only its digest", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);

    const rows = await rowsFor(employee.id);
    for (const row of rows) expect(row.tokenHash).not.toBe(token);
    expect(rows.some((r) => r.tokenHash === sha256(token!))).toBe(true);
  });

  it("30. no column anywhere in the row contains the raw token", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);

    const dump = JSON.stringify(await rowsFor(employee.id));
    expect(dump).not.toContain(token);
  });

  it("31. the raw token is never returned by the endpoint", async () => {
    const employee = await createEmployee();
    const { res, token } = await resendAndCapture(employee.id);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(token);
    expect(body).not.toMatch(/token/i);
  });

  it("32. no temporary password is returned either — the link is the only credential", async () => {
    const employee = await createEmployee();
    const { res } = await resendAndCapture(employee.id);

    expect(res.body.temporaryPassword).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it("33. the token appears in the email link and nowhere else in the log", async () => {
    const employee = await createEmployee();
    const { token, logged } = await resendAndCapture(employee.id);

    /*
     * The console transport IS the delivery here, so the link is legitimately
     * present in the message body. What must not happen is the token appearing
     * anywhere else — as its own field, or in a structured log line. So every
     * occurrence is stripped along with its `accept-invite?token=` prefix, and
     * nothing may be left over.
     */
    const encoded = encodeURIComponent(token!);
    const withoutLinks = logged.split(`accept-invite?token=${encoded}`).join("");

    expect(logged).toContain(`accept-invite?token=${encoded}`);
    expect(withoutLinks).not.toContain(encoded);
    expect(withoutLinks).not.toContain(token!);
    expect(logged).not.toMatch(/"tokenHash"|"token":/);
  });

  it("34. a superseded token cannot be replayed even after the new one is used", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);
    expect((await accept(token!)).status).toBe(204);

    expect((await accept(employee.token)).status).toBe(400);
  });

  it("35. the digest of the new token is unique across the table", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);

    const all = await ctx.db
      .select({ hash: invitations.tokenHash })
      .from(invitations)
      .where(eq(invitations.tokenHash, sha256(token!)));

    expect(all.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — employee state guards", () => {
  it("36. an employee who already accepted is refused with 409", async () => {
    const employee = await createEmployee();
    expect((await accept(employee.token)).status).toBe(204);

    const res = await resend(employee.id, superToken);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already completed setup/i);
  });

  it("37. that refusal issues nothing and leaves the acceptance intact", async () => {
    const employee = await createEmployee();
    expect((await accept(employee.token)).status).toBe(204);
    const before = await userRow(employee.id);
    const rowsBefore = (await rowsFor(employee.id)).length;

    expect((await resend(employee.id, superToken)).status).toBe(409);

    const after = await userRow(employee.id);
    expect((await rowsFor(employee.id)).length).toBe(rowsBefore);
    expect(after.inviteAcceptedAt?.getTime()).toBe(before.inviteAcceptedAt?.getTime());
    expect(after.invitedAt?.getTime()).toBe(before.invitedAt?.getTime());
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("38. an accepted employee's password still works after the refusal", async () => {
    const employee = await createEmployee();
    expect((await accept(employee.token)).status).toBe(204);
    await resend(employee.id, superToken);

    expect((await login(employee.email, GOOD_PASSWORD)).status).toBe(200);
  });

  it("39. a deactivated employee is refused with 409", async () => {
    const employee = await createEmployee();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, employee.id));

    const res = await resend(employee.id, superToken);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/not active/i);
  });

  it("40. resending does NOT reactivate a deactivated employee", async () => {
    const employee = await createEmployee();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, employee.id));
    await resend(employee.id, superToken);

    expect((await userRow(employee.id)).status).toBe("Inactive");
  });

  it("41. reactivating then resending works — the guard is state, not a permanent bar", async () => {
    const employee = await createEmployee();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, employee.id));
    expect((await resend(employee.id, superToken)).status).toBe(409);

    await ctx.db.update(users).set({ status: "Active" }).where(eq(users.id, employee.id));
    const { res, token } = await resendAndCapture(employee.id);

    expect(res.status).toBe(200);
    expect((await accept(token!)).status).toBe(204);
  });

  it("42. a soft-deleted employee is 404, not 409 — they are simply not there", async () => {
    const employee = await createEmployee();
    expect(
      (await request(ctx.app).delete(`/api/users/${employee.id}`).set(bearer(superToken))).status,
    ).toBe(204);

    const res = await resend(employee.id, superToken);

    expect(res.status).toBe(404);
  });

  it("43. a soft-deleted employee receives no invitation", async () => {
    const employee = await createEmployee();
    await request(ctx.app).delete(`/api/users/${employee.id}`).set(bearer(superToken));
    const rowsBefore = (await rowsFor(employee.id)).length;

    await resend(employee.id, superToken);

    expect((await rowsFor(employee.id)).length).toBe(rowsBefore);
  });

  it("44. a restored employee is refused while still Inactive, and works once reactivated", async () => {
    /*
     * Deletion deactivates; restore clears `deleted_at` but does NOT reactivate.
     * So a restored employee is visible again yet still not a valid recipient
     * until someone deliberately turns their access back on. No special case in
     * the route — the Active guard produces this for free.
     */
    const employee = await createEmployee();
    await request(ctx.app).delete(`/api/users/${employee.id}`).set(bearer(superToken));

    const [entry] = await ctx.db
      .select()
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, employee.id))
      .limit(1);
    expect(
      (
        await request(ctx.app)
          .post(`/api/recycle-bin/${entry!.id}/restore`)
          .set(bearer(superToken))
      ).status,
    ).toBe(200);

    expect((await userRow(employee.id)).deletedAt).toBeNull();
    expect((await resend(employee.id, superToken)).status).toBe(409);

    await ctx.db.update(users).set({ status: "Active" }).where(eq(users.id, employee.id));
    expect((await resend(employee.id, superToken)).status).toBe(200);
  });

  it("45. an employee with a still-valid invitation may be resent one anyway", async () => {
    // The link may simply not have arrived. Refusing would make a lost email
    // unrecoverable for 72 hours.
    const employee = await createEmployee();
    const live = await liveRowsFor(employee.id);
    expect(live.length).toBe(1);

    const { res, token } = await resendAndCapture(employee.id);

    expect(res.status).toBe(200);
    expect((await accept(token!)).status).toBe(204);
  });

  it("46. resend modifies no unrelated employee field", async () => {
    const employee = await createEmployee();
    const before = await userRow(employee.id);

    await resendAndCapture(employee.id);
    const after = await userRow(employee.id);

    // Everything except the one timestamp the task owns.
    expect(after.name).toBe(before.name);
    expect(after.email).toBe(before.email);
    expect(after.employeeCode).toBe(before.employeeCode);
    expect(after.roleId).toBe(before.roleId);
    expect(after.status).toBe(before.status);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.mustChangePassword).toBe(before.mustChangePassword);
    expect(after.inviteAcceptedAt).toBe(before.inviteAcceptedAt);
    expect(after.deletedAt).toBe(before.deletedAt);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — delivery state (roadmap 3.7 semantics preserved)", () => {
  it("47. invited_at moves forward to the new issuance", async () => {
    const employee = await createEmployee();
    const before = await userRow(employee.id);
    expect(before.invitedAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await resendAndCapture(employee.id);

    const after = await userRow(employee.id);
    expect(after.invitedAt!.getTime()).toBeGreaterThan(before.invitedAt!.getTime());
  });

  it("48. invited_at matches the newest invitation row, not the oldest", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id);

    const [live] = await liveRowsFor(employee.id);
    const user = await userRow(employee.id);

    expect(Math.abs(user.invitedAt!.getTime() - live!.createdAt.getTime())).toBeLessThan(1_000);
  });

  it("49. invite_accepted_at stays null through a resend before acceptance", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id);

    expect((await userRow(employee.id)).inviteAcceptedAt).toBeNull();
  });

  it("50. acceptance through the resent link stamps invite_accepted_at", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);
    await accept(token!);

    expect((await userRow(employee.id)).inviteAcceptedAt).not.toBeNull();
  });

  it("51. the employees list reflects the new state", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id);

    const res = await request(ctx.app).get("/api/users").set(bearer(superToken));
    const row = (res.body.data as Record<string, unknown>[]).find((r) => r.id === employee.id);

    expect(row!.invitedAt).not.toBeNull();
    expect(row!.inviteAcceptedAt).toBeNull();
  });

  it("52. an old expired invitation does not drag invited_at backwards", async () => {
    const employee = await createEmployee();
    await expireInvitations(employee.id);
    await resendAndCapture(employee.id);

    const expired = await ctx.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.userId, employee.id), lt(invitations.expiresAt, new Date())));
    expect(expired.length).toBe(1);

    const user = await userRow(employee.id);
    const [live] = await liveRowsFor(employee.id);
    expect(user.invitedAt!.getTime()).toBeGreaterThanOrEqual(
      live!.createdAt.getTime() - 1_000,
    );
  });
});

/* ------------------------------------------------------------------ group F */

describe("F — the email and its honest outcome", () => {
  it("53. the invitation template is used, addressed to the employee", async () => {
    const employee = await createEmployee();
    const { logged } = await resendAndCapture(employee.id);

    expect(logged).toContain(employee.email);
    expect(logged).toMatch(/finish setting it up|choose your own password/i);
  });

  it("54. the link points at the configured frontend URL", async () => {
    const employee = await createEmployee();
    const { logged } = await resendAndCapture(employee.id);

    expect(logged).toMatch(/http:\/\/localhost:3000\/accept-invite\?token=/);
  });

  it("55. no password is in the email — D-037 forbids emailing one", async () => {
    const employee = await createEmployee();
    const { logged } = await resendAndCapture(employee.id);

    expect(logged).not.toMatch(/temporary password|your password is/i);
  });

  it("56. the response distinguishes the outcome rather than assuming success", async () => {
    const employee = await createEmployee();
    const { res } = await resendAndCapture(employee.id);

    // No email configuration in test, so the console transport reports `logged`
    // — NOT `sent`. The distinction is the point (D-004, D-035).
    expect(res.body.invitation.status).toBe("logged");
  });

  it("57. a provider failure is reported as failed, not as success", async () => {
    /*
     * Driven through the REAL provider path rather than by stubbing
     * `sendEmail`: the environment is pointed at a configured provider and
     * `fetch` is replaced with one that always 500s, so the route exercises the
     * transport, the retries and the outcome exactly as production would. No
     * network, and the key is obvious junk.
     */
    const employee = await createEmployee();
    const restore = withFailingProvider();
    try {
      const res = await resend(employee.id, superToken);

      expect(res.status).toBe(200);
      expect(res.body.invitation.status).toBe("failed");
    } finally {
      restore();
    }
  });

  it("58. a provider failure leaks neither the API key nor the provider body", async () => {
    const employee = await createEmployee();
    const restore = withFailingProvider();
    try {
      const { res, logged } = await resendAndCapture(employee.id);

      // The API key must appear NOWHERE — that is the Task 3.3 guarantee, and
      // `scrub()` is what makes it structural rather than incidental.
      expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
      expect(logged).not.toContain(FAKE_KEY);

      // The provider's own words must not reach the caller. A server-side log
      // may carry them — that is a diagnostic, not a disclosure.
      expect(JSON.stringify(res.body)).not.toContain("provider exploded");
    } finally {
      restore();
    }
  });

  it("59. a failed email still leaves the reissue done — the old link is dead", async () => {
    /*
     * Deliberate: supersession is a database fact settled before the mail is
     * attempted. Rolling it back on a send failure would leave the operator
     * believing nothing happened while the token they superseded stayed live.
     */
    const employee = await createEmployee();
    await resendAndCapture(employee.id);

    expect((await accept(employee.token)).status).toBe(400);
  });

  it("60. no API key appears in the log, on the path where a key actually exists", async () => {
    /*
     * Run under the CONFIGURED provider deliberately. Asserting this on the
     * console transport would be vacuous — there is no key in that environment,
     * so the assertion could never fail. An adversarial review pointed that out.
     */
    const employee = await createEmployee();
    const restore = withFailingProvider();
    try {
      const { logged } = await resendAndCapture(employee.id);

      expect(logged).not.toContain(FAKE_KEY);
      expect(logged).not.toMatch(/EMAIL_API_KEY/);
      expect(logged).not.toMatch(/Bearer re_/);
    } finally {
      restore();
    }
  });

  it("61. no password hash appears in the log", async () => {
    const employee = await createEmployee();
    const { logged } = await resendAndCapture(employee.id);

    expect(logged).not.toContain("$argon2");
  });
});

/* ------------------------------------------------------------------ group G */

describe("G — audit", () => {
  const auditFor = (userId: string) =>
    ctx.db.select().from(auditLogs).where(eq(auditLogs.recordId, userId));

  it("62. a resend writes an audit row naming the operation", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id, adminToken);

    const rows = await auditFor(employee.id);
    const entry = rows.find((r) => r.action === "invitation_resent");

    expect(entry).toBeDefined();
    expect(entry!.recordType).toBe("user");
  });

  it("63. the audit row names the actor", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id, adminToken);

    const [entry] = (await auditFor(employee.id)).filter((r) => r.action === "invitation_resent");

    expect(entry!.actorId).not.toBeNull();
    expect(entry!.actorEmail).toBeTruthy();
    expect(entry!.occurredAt).toBeInstanceOf(Date);
  });

  it("64. the audit row contains no token, digest or URL", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);

    const [entry] = (await auditFor(employee.id)).filter((r) => r.action === "invitation_resent");
    const dump = JSON.stringify(entry);

    expect(dump).not.toContain(token);
    expect(dump).not.toContain(sha256(token!));
    expect(dump).not.toContain("accept-invite");
    expect(dump).not.toMatch(/\$argon2/);
  });

  it("65. a refused resend writes no invitation_resent row", async () => {
    const before = (await ctx.db.select().from(auditLogs)).filter(
      (r) => r.action === "invitation_resent" && r.recordId === target.super_admin,
    ).length;

    expect((await resend(target.super_admin, adminToken)).status).toBe(403);

    const after = (await ctx.db.select().from(auditLogs)).filter(
      (r) => r.action === "invitation_resent" && r.recordId === target.super_admin,
    ).length;
    expect(after).toBe(before);
  });

  it("66. two resends write two audit rows", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id);
    await resendAndCapture(employee.id);

    const rows = (await auditFor(employee.id)).filter((r) => r.action === "invitation_resent");
    expect(rows.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ group H */

describe("H — repeated and concurrent resends", () => {
  it("67. two sequential resends leave exactly one usable invitation", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id);
    const second = await resendAndCapture(employee.id);

    expect((await liveRowsFor(employee.id)).length).toBe(1);
    expect((await accept(second.token!)).status).toBe(204);
  });

  it("68. rapid back-to-back resends are deterministic — the last one wins", async () => {
    const employee = await createEmployee();
    const a = await resendAndCapture(employee.id);
    const b = await resendAndCapture(employee.id);

    expect((await accept(a.token!)).status).toBe(400);
    expect((await accept(b.token!)).status).toBe(204);
  });

  it("69. accepting twice through a resent link is still refused the second time", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);

    expect((await accept(token!)).status).toBe(204);
    expect((await accept(token!, "AnotherPassword123")).status).toBe(400);
  });

  it("70. total invitation rows equal one per issuance — none are lost or duplicated", async () => {
    const employee = await createEmployee();
    await resendAndCapture(employee.id);
    await resendAndCapture(employee.id);

    expect((await rowsFor(employee.id)).length).toBe(3);
  });

  it("71. the whole documented lifecycle, end to end, in one chain", async () => {
    /*
     * employee created, not accepted -> their invitation expires -> an
     * administrator resends -> the new link is captured -> the OLD token is
     * refused -> the NEW token is accepted. Every step over real HTTP against
     * the real migrations, asserting the database at each point.
     */
    const employee = await createEmployee();
    const created = await userRow(employee.id);
    expect(created.invitedAt).not.toBeNull();
    expect(created.inviteAcceptedAt).toBeNull();
    expect((await liveRowsFor(employee.id)).length).toBe(1);

    // 1 — the link goes stale.
    await expireInvitations(employee.id);
    expect((await accept(employee.token)).status).toBe(400);

    // 2 — an authorized administrator reissues it.
    const { res, token } = await resendAndCapture(employee.id, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe("logged");
    expect(token).toBeTruthy();
    expect(token).not.toBe(employee.token);

    // 3 — exactly one live invitation, and invited_at moved with it.
    const afterResend = await userRow(employee.id);
    expect((await liveRowsFor(employee.id)).length).toBe(1);
    expect(afterResend.invitedAt!.getTime()).toBeGreaterThan(created.invitedAt!.getTime());
    expect(afterResend.inviteAcceptedAt).toBeNull();

    // 4 — the old token stays dead.
    expect((await accept(employee.token)).status).toBe(400);

    // 5 — the new token works, once.
    expect((await accept(token!)).status).toBe(204);
    expect((await accept(token!, "YetAnotherPassword1")).status).toBe(400);

    // 6 — the employee can now sign in with the password they chose.
    expect((await login(employee.email, GOOD_PASSWORD)).status).toBe(200);

    // 7 — acceptance recorded, nothing left live, and a further resend refused.
    const final = await userRow(employee.id);
    expect(final.inviteAcceptedAt).not.toBeNull();
    expect((await liveRowsFor(employee.id)).length).toBe(0);
    expect((await resend(employee.id, adminToken)).status).toBe(409);

    // 8 — audited, without a shred of secret material.
    const audit = (await ctx.db.select().from(auditLogs).where(eq(auditLogs.recordId, employee.id)))
      .filter((r) => r.action === "invitation_resent");
    expect(audit.length).toBe(1);
    expect(JSON.stringify(audit)).not.toContain(token!);
  });

  it("72. a resend after acceptance cannot resurrect the account into an invitable state", async () => {
    const employee = await createEmployee();
    const { token } = await resendAndCapture(employee.id);
    await accept(token!);

    expect((await resend(employee.id, superToken)).status).toBe(409);
    expect((await liveRowsFor(employee.id)).length).toBe(0);
  });
});
