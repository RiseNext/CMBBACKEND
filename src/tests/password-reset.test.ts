import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import {
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { passwordResets, refreshTokens, users } from "../db/schema/index.js";
import { logger } from "../lib/logger.js";
import { sha256, verifyPassword } from "../lib/password.js";
import { resetRateLimits } from "../middleware/rate-limit.js";
import { PASSWORD_RESET_TTL_HOURS } from "../services/password-reset.js";

/**
 * SELF-SERVICE PASSWORD RESET — roadmap task 3.6
 *
 * The full lifecycle over real HTTP against real migrations:
 * **request → emailed link → reset → password set → consumed → replay refused.**
 *
 * Two properties carry the weight:
 *
 *   - **The request endpoint reveals nothing** (group A). The roadmap's own
 *     words: *"always returns 200 — never confirm whether an address exists"*.
 *     That is tested against the response **and against the logs**, because a
 *     line naming a missing address moves the oracle rather than removing it.
 *   - **At most one successful reset per token** (group D), guarded by a
 *     conditional `UPDATE` the database resolves — not by application timing.
 *
 * The test environment has no email configuration, so `sendEmail` takes the
 * console transport (D-035) and the link is captured from what it logs.
 */

let ctx: TestContext;
let n = 0;

const NEW_PASSWORD = "ResetChosenByUser1";

const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

const forgot = (email: string) =>
  request(ctx.app).post("/api/auth/forgot-password").send({ email });

const reset = (token: string, password = NEW_PASSWORD) =>
  request(ctx.app).post("/api/auth/reset-password").send({ token, password });

/** Runs `fn` while capturing everything the logger is handed. */
async function capturing<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const lines: unknown[][] = [];
  const spies = (["info", "warn", "error"] as const).map((m) =>
    vi.spyOn(logger, m).mockImplementation(((...args: unknown[]) => {
      lines.push(args);
    }) as never),
  );
  try {
    const result = await fn();
    return { result, logged: JSON.stringify(lines) };
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
}

interface Account {
  id: string;
  email: string;
  password: string;
}

async function makeUser(status = "Active"): Promise<Account> {
  n += 1;
  const user = await createUser(ctx.db, {
    roleKey: "executive",
    email: `reset.${n}@risenext.com`,
    status,
  });
  return { id: user.id, email: user.email, password: user.password };
}

/** Requests a reset and pulls the raw token out of the emailed link. */
async function requestToken(email: string): Promise<string> {
  const { logged } = await capturing(() => forgot(email));
  const match = /reset-password\?token=([A-Za-z0-9_%-]+)/.exec(logged);
  if (!match) throw new Error(`no reset link was emailed: ${logged.slice(0, 300)}`);
  return decodeURIComponent(match[1]!);
}

const rowsFor = (userId: string) =>
  ctx.db.select().from(passwordResets).where(eq(passwordResets.userId, userId));

const liveFor = async (userId: string) => {
  const [row] = await ctx.db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.consumedAt)))
    .limit(1);
  return row;
};

const userRow = async (id: string) => {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
};

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => destroyTestContext(ctx));

// The limiter is process-wide, so one case must not throttle the next.
beforeEach(() => resetRateLimits());
afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

/* ------------------------------------------------------------------ group A */

describe("A — the request endpoint reveals nothing", () => {
  it("1. answers identically for a real address and an unknown one", async () => {
    const account = await makeUser();

    const known = await forgot(account.email);
    const unknown = await forgot("nobody.at.all@risenext.com");

    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(known.body).toEqual(unknown.body);
    expect(known.text).toBe(unknown.text);
  });

  it("2. answers identically for a soft-deleted account", async () => {
    const account = await makeUser();
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, account.id));

    const res = await forgot(account.email);

    expect(res.status).toBe(204);
    expect(await rowsFor(account.id)).toHaveLength(0);
  });

  it("3. answers identically for a deactivated account", async () => {
    const account = await makeUser("Inactive");

    const res = await forgot(account.email);

    expect(res.status).toBe(204);
    expect(await rowsFor(account.id)).toHaveLength(0);
  });

  it("4. the LOGS do not name the address or distinguish the outcome", async () => {
    /*
     * The subtle half of enumeration resistance. A response that says nothing is
     * worthless if the log says "no account for alice@example.com" — the oracle
     * has moved, not gone.
     */
    const account = await makeUser();
    const { logged: hit } = await capturing(() => forgot(account.email));
    const { logged: miss } = await capturing(() => forgot("ghost@risenext.com"));

    expect(miss).not.toContain("ghost@risenext.com");
    expect(miss).not.toMatch(/not found|no such|unknown user|does not exist/i);
    // Both paths write the same line.
    expect(hit).toContain("Password reset requested");
    expect(miss).toContain("Password reset requested");
  });

  it("5. an unknown address sends no mail at all", async () => {
    const { logged } = await capturing(() => forgot("nobody.here@risenext.com"));

    expect(logged).not.toContain("reset-password?token=");
  });

  it("6. a malformed address is a validation error, not an oracle", async () => {
    const res = await request(ctx.app).post("/api/auth/forgot-password").send({ email: "nope" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("7. requesting a reset does not change the existing password", async () => {
    const account = await makeUser();
    const before = await userRow(account.id);

    await forgot(account.email);

    expect((await userRow(account.id)).passwordHash).toBe(before.passwordHash);
    expect((await login(account.email, account.password)).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — issuing: only the digest is stored", () => {
  it("8. a request creates exactly one live token", async () => {
    const account = await makeUser();
    await requestToken(account.email);

    const rows = await rowsFor(account.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.consumedAt).toBeNull();
  });

  it("9. the stored value is the digest, not the token", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    const row = await liveFor(account.id);

    expect(row!.tokenHash).toBe(sha256(token));
    expect(row!.tokenHash).not.toBe(token);
  });

  it("10. no row anywhere holds the raw token", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);

    expect(JSON.stringify(await ctx.db.select().from(passwordResets))).not.toContain(token);
  });

  it("11. tokens are long and unpredictable", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const first = await requestToken(a.email);
    const second = await requestToken(b.email);

    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("12. the expiry is the documented one hour", async () => {
    const account = await makeUser();
    await requestToken(account.email);
    const row = await liveFor(account.id);

    const hours = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / (60 * 60 * 1000);
    expect(Math.round(hours)).toBe(PASSWORD_RESET_TTL_HOURS);
    expect(PASSWORD_RESET_TTL_HOURS).toBe(1);
  });

  it("13. a second request supersedes the first", async () => {
    const account = await makeUser();
    const first = await requestToken(account.email);
    const second = await requestToken(account.email);

    const live = await ctx.db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.userId, account.id), isNull(passwordResets.consumedAt)));

    expect(live).toHaveLength(1);
    expect(first).not.toBe(second);
    // The older link is dead; the newer one works.
    expect((await reset(first)).status).toBe(400);
    expect((await reset(second)).status).toBe(204);
  });

  it("14. the email is the shared template, with the link and no credential", async () => {
    const account = await makeUser();
    const { logged } = await capturing(() => forgot(account.email));

    expect(logged).toContain("Reset your Rise Next password");
    expect(logged).toContain("reset-password?token=");
    expect(logged).not.toMatch(/temporary password|your password is/i);
  });

  it("15. the link is built from FRONTEND_URL", async () => {
    const account = await makeUser();
    const { logged } = await capturing(() => forgot(account.email));

    // The test environment sets FRONTEND_URL to localhost:3000.
    expect(logged).toContain("http://localhost:3000/reset-password?token=");
  });

  it("16. the token never appears in the subject", async () => {
    const account = await makeUser();
    const lines: unknown[][] = [];
    vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
      lines.push(args);
    }) as never);
    await forgot(account.email);

    const record = lines.find((l) => JSON.stringify(l).includes("reset-password?token="))![0] as {
      subject: string;
      text: string;
    };
    const token = /reset-password\?token=([A-Za-z0-9_%-]+)/.exec(record.text)![1]!;

    expect(record.subject).not.toContain(token);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — redeeming the link", () => {
  it("17. a valid token and password succeed with 204 and no body", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);

    const res = await reset(token);

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(res.body).toEqual({});
  });

  it("18. the password is argon2-hashed, never stored plain", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    await reset(token);
    const row = await userRow(account.id);

    expect(row.passwordHash).not.toBe(NEW_PASSWORD);
    expect(row.passwordHash.startsWith("$argon2")).toBe(true);
    expect(await verifyPassword(row.passwordHash, NEW_PASSWORD)).toBe(true);
  });

  it("19. the token is consumed and the old password stops working", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);

    await reset(token);

    expect((await rowsFor(account.id))[0]!.consumedAt).not.toBeNull();
    expect((await login(account.email, account.password)).status).toBe(401);
    expect((await login(account.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("20. all sessions are revoked — the roadmap requires it explicitly", async () => {
    const account = await makeUser();
    await login(account.email, account.password);
    expect(
      await ctx.db
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.userId, account.id), isNull(refreshTokens.revokedAt))),
    ).not.toHaveLength(0);

    const token = await requestToken(account.email);
    await reset(token);

    const live = await ctx.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, account.id), isNull(refreshTokens.revokedAt)));
    expect(live).toHaveLength(0);
  });

  it("21. a lockout does not outlive the credential it guarded", async () => {
    const account = await makeUser();
    await ctx.db
      .update(users)
      .set({ failedLoginAttempts: 8, lockedUntil: new Date(Date.now() + 900_000) })
      .where(eq(users.id, account.id));

    const token = await requestToken(account.email);
    await reset(token);

    const row = await userRow(account.id);
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect((await login(account.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("22. mustChangePassword is cleared", async () => {
    const account = await makeUser();
    await ctx.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, account.id));

    const token = await requestToken(account.email);
    await reset(token);

    expect((await userRow(account.id)).mustChangePassword).toBe(false);
  });

  it("23. role, name and employee code are preserved", async () => {
    const account = await makeUser();
    const before = await userRow(account.id);
    const token = await requestToken(account.email);
    await reset(token);
    const after = await userRow(account.id);

    expect(after.roleId).toBe(before.roleId);
    expect(after.name).toBe(before.name);
    expect(after.employeeCode).toBe(before.employeeCode);
    expect(after.status).toBe(before.status);
  });

  it("24. no session is created by the reset itself", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);

    const res = await reset(token);

    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — one reset per token, and one refusal for everything else", () => {
  const MESSAGE = "This password reset link is not valid. It may have expired or already been used.";

  it("25. two simultaneous resets: exactly one succeeds", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);

    const [a, b] = await Promise.all([
      reset(token, "FirstWriterWins11"),
      reset(token, "SecondWriterLoses22"),
    ]);

    expect([a.status, b.status].sort()).toEqual([204, 400]);

    const row = await userRow(account.id);
    const first = await verifyPassword(row.passwordHash, "FirstWriterWins11");
    const second = await verifyPassword(row.passwordHash, "SecondWriterLoses22");
    expect(first !== second).toBe(true);
  });

  it("26. a replay cannot change the password again", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    await reset(token, "TheRealOne111");

    const replay = await reset(token, "AttackerChosen222");

    expect(replay.status).toBe(400);
    const row = await userRow(account.id);
    expect(await verifyPassword(row.passwordHash, "TheRealOne111")).toBe(true);
    expect(await verifyPassword(row.passwordHash, "AttackerChosen222")).toBe(false);
  });

  it.each([
    ["an unknown token", async () => "never-issued-token-aaaaaaaaaaaaaaaaaaaaaaaa"],
  ])("27. %s is refused with the one message", async (_label, make) => {
    const res = await reset(await make());

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(MESSAGE);
  });

  it("28. an expired token is refused, identically", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    await ctx.db
      .update(passwordResets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResets.userId, account.id));

    const res = await reset(token);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(MESSAGE);
  });

  it("29. a deactivated account's token is refused, and the link is not burned", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, account.id));

    expect((await reset(token)).status).toBe(400);

    // The consume rolled back with the refusal, so reactivating restores it.
    await ctx.db.update(users).set({ status: "Active" }).where(eq(users.id, account.id));
    expect((await reset(token)).status).toBe(204);
  });

  it("30. a consumed token is indistinguishable from one that never existed", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    await reset(token);

    const consumed = await reset(token);
    const unknown = await reset("never-existed-bbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    expect(consumed.status).toBe(unknown.status);
    expect(consumed.body).toEqual(unknown.body);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — password policy, and failures that must not consume", () => {
  it("31. the existing policy is enforced", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);

    const res = await reset(token, "short");

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Password must/);
  });

  it("32. a rejected password does NOT consume the token", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    expect((await reset(token, "weak")).status).toBe(422);

    expect(await liveFor(account.id)).toBeTruthy();
    expect((await reset(token)).status).toBe(204);
  });

  it("33. an invalid token is refused before any password work", async () => {
    // A junk token must not buy an argon2 hash — the SEC-005 amplification.
    const res = await reset("junk-cccccccccccccccccccccccccccccccc", "short");

    expect(res.status).toBe(400);
    expect(res.body.error.message).not.toMatch(/Password must/);
  });
});

/* ------------------------------------------------------------------ group F */

describe("F — nothing leaks", () => {
  it("34. the token never appears in an error response", async () => {
    const token = "leaky-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    const res = await reset(token, "short");

    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("35. the token never appears in a log during redemption", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);

    const { logged } = await capturing(() => reset(token));

    expect(logged).not.toContain(token);
  });

  it("36. the token never appears in an audit row", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    await reset(token);

    const rows = await ctx.client.query<{ summary: string }>(`select summary from audit_logs`);

    expect(JSON.stringify(rows.rows)).not.toContain(token);
  });

  it("37. the chosen password never appears in a log or an audit row", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    const { logged } = await capturing(() => reset(token, "NeverLogThis222"));

    const audit = await ctx.client.query<{ summary: string }>(`select summary from audit_logs`);

    expect(logged).not.toContain("NeverLogThis222");
    expect(JSON.stringify(audit.rows)).not.toContain("NeverLogThis222");
  });

  it("38. a completed reset is recorded in the audit log", async () => {
    const account = await makeUser();
    const token = await requestToken(account.email);
    await reset(token);

    const rows = await ctx.client.query<{ action: string }>(
      `select action from audit_logs where summary = 'Password reset from a self-service link'`,
    );

    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows[0]!.action).toBe("password_changed");
  });
});

/* ------------------------------------------------------------------ group G */

describe("G — the rate limits roadmap 3.6 asks for", () => {
  it("39. forgot-password is throttled after its allowance", async () => {
    const account = await makeUser();

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await forgot(account.email)).status);
    }

    expect(statuses.slice(0, 5)).toEqual([204, 204, 204, 204, 204]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("40. the throttle message reveals nothing about the account", async () => {
    const account = await makeUser();
    for (let i = 0; i < 5; i += 1) await forgot(account.email);

    const limited = await forgot(account.email);
    const limitedUnknown = await forgot("someone.else@risenext.com");

    // Both are throttled by source, not by address — so the limiter cannot be
    // used to tell one address from another either.
    expect(limited.status).toBe(429);
    expect(limitedUnknown.status).toBe(429);
    expect(limited.body).toEqual(limitedUnknown.body);
  });

  it("41. reset-password is throttled too", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await reset(`bogus-token-${i}-ffffffffffffffffffff`)).status);
    }

    expect(statuses.filter((s) => s === 400)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  it("42. throttling one endpoint does not throttle the other", async () => {
    const account = await makeUser();
    for (let i = 0; i < 6; i += 1) await forgot(account.email);
    expect((await forgot(account.email)).status).toBe(429);

    // Separate counters, so a locked-out requester can still redeem a link they
    // already received.
    const other = await makeUser();
    resetRateLimits();
    const token = await requestToken(other.email);
    expect((await reset(token)).status).toBe(204);
  });
});
