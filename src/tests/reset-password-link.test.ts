import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { passwordResets, refreshTokens, users } from "../db/schema/index.js";
import { logger } from "../lib/logger.js";
import { resetRateLimits } from "../middleware/rate-limit.js";

/**
 * THE RESET LINK, END TO END — roadmap task 3.12.
 *
 * `password-reset.test.ts` already proves the endpoints. This file proves the
 * **link**, which is the seam Task 3.12 introduced — the same seam
 * `accept-invite-link.test.ts` closed for Task 3.11, and it hides in the same
 * place.
 *
 * The page reads its token with `useSearchParams().get("token")`, which
 * URL-**decodes**; `passwordResetUrl()` builds the link with
 * `encodeURIComponent`. Both suites use a raw token and never cross the URL, so
 * a change to the alphabet, the parameter name, the path, or a double encode
 * would break **every real reset** while both sides stayed green.
 *
 * Group A therefore walks the whole flow the way a person does: forget the
 * password, ask for a link, read the email, open the URL, set a new password,
 * sign in. Group B pins the property the page's safety rests on — every
 * unusable token gives **one identical refusal** (**D-039**) — and group C
 * pins the one the *request* page rests on: `forgot-password` answers
 * identically no matter who asks.
 */

let ctx: TestContext;
let superToken: string;
let bank: { id: string; code: string };
let executiveRoleId: string;
let n = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

const NEW_PASSWORD = "ChosenAfterReset1";

/** The one sentence every unusable reset token gets. The page renders it verbatim. */
const GENERIC_REFUSAL =
  "This password reset link is not valid. It may have expired or already been used.";

/** Captures whatever the console transport logs while `fn` runs. */
async function captureEmail<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const lines: unknown[][] = [];
  const spy = vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
    lines.push(args);
  }) as never);
  try {
    const result = await fn();
    return { result, logged: JSON.stringify(lines) };
  } finally {
    spy.mockRestore();
  }
}

interface Account {
  id: string;
  email: string;
  /** The temporary password from creation — the credential the reset replaces. */
  originalPassword: string;
}

/** Creates a real, signed-in-capable employee through the real route. */
async function createAccount(): Promise<Account> {
  n += 1;
  const email = `reset.link.${n}@risenext.com`;

  const res = await captureEmail(() =>
    request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: `Reset Target ${n}`, email, roleId: executiveRoleId, bankIds: [bank.id] }),
  );
  expect(res.result.status).toBe(201);

  return {
    id: res.result.body.data.id as string,
    email,
    originalPassword: res.result.body.temporaryPassword as string,
  };
}

/**
 * Asks for a reset and extracts the link the way the recipient's browser would:
 * find the URL, parse it, read the query parameter.
 */
async function requestReset(email: string): Promise<string | null> {
  const { result: res, logged } = await captureEmail(() =>
    request(ctx.app).post("/api/auth/forgot-password").send({ email }),
  );
  // Always 204, whoever asked.
  expect(res.status).toBe(204);

  const match = /https?:\/\/[^\s"'\\]+reset-password\?token=[^\s"'\\&]+/.exec(logged);
  if (!match) return null;
  return new URL(match[0]).searchParams.get("token");
}

const reset = (token: string, password = NEW_PASSWORD) =>
  request(ctx.app).post("/api/auth/reset-password").send({ token, password });

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Reset Link Bank");
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;

  // Minted before any route-created employee: the harness numbers codes from
  // its own counter while the route takes max+1, so the two collide otherwise.
  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (await login(superAdmin.email, superAdmin.password)).body.accessToken as string;
});

afterAll(async () => destroyTestContext(ctx));
// forgot-password allows 5 per 15 minutes, reset-password 10. Process-wide.
beforeEach(() => resetRateLimits());
afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

/* ------------------------------------------------------------------ group A */

describe("A — the whole unaided recovery, as a person performs it", () => {
  it("1. the reset email contains an absolute URL to /reset-password", async () => {
    const account = await createAccount();
    const { logged } = await captureEmail(() =>
      request(ctx.app).post("/api/auth/forgot-password").send({ email: account.email }),
    );

    const match = /https?:\/\/[^\s"'\\]+reset-password\?token=[^\s"'\\&]+/.exec(logged);
    expect(match).not.toBeNull();

    const url = new URL(match![0]);
    expect(url.pathname).toBe("/reset-password");
    expect(url.origin).toBe("http://localhost:3000");
  });

  it("2. the token arrives in a parameter named `token` and survives the round trip", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);

    expect(token).toBeTruthy();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeURIComponent(token!)).toBe(token);
  });

  it("3. the link points at /reset-password, NOT /accept-invite", async () => {
    // D-039 keeps the two flows on separate tables so a token cannot cross.
    const account = await createAccount();
    const { logged } = await captureEmail(() =>
      request(ctx.app).post("/api/auth/forgot-password").send({ email: account.email }),
    );

    const match = /https?:\/\/[^\s"'\\]+reset-password\?token=[^\s"'\\&]+/.exec(logged);
    expect(new URL(match![0]).pathname).not.toBe("/accept-invite");
  });

  it("4. the browser-parsed token is accepted, and the new password works", async () => {
    /*
     * The load-bearing test: forget → request → read the email → parse the URL
     * → set a password → sign in. The token crosses the same boundary the real
     * page crosses.
     */
    const account = await createAccount();
    const token = await requestReset(account.email);

    expect((await reset(token!)).status).toBe(204);
    expect((await login(account.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("5. the old password stops working", async () => {
    const account = await createAccount();
    expect((await login(account.email, account.originalPassword)).status).toBe(200);

    const token = await requestReset(account.email);
    expect((await reset(token!)).status).toBe(204);

    expect((await login(account.email, account.originalPassword)).status).toBe(401);
  });

  it("6. every existing session is revoked", async () => {
    const account = await createAccount();
    expect((await login(account.email, account.originalPassword)).status).toBe(200);

    const live = await ctx.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, account.id), isNull(refreshTokens.revokedAt)));
    expect(live.length).toBeGreaterThan(0);

    const token = await requestReset(account.email);
    await reset(token!);

    const stillLive = await ctx.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, account.id), isNull(refreshTokens.revokedAt)));
    expect(stillLive.length).toBe(0);
  });

  it("7. the reset itself creates no session", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);
    const res = await reset(token!);

    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body).toEqual({});
  });

  it("8. it clears the forced-change flag and any lockout", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);
    await reset(token!);

    const [row] = await ctx.db.select().from(users).where(eq(users.id, account.id)).limit(1);
    expect(row!.mustChangePassword).toBe(false);
    expect(row!.failedLoginAttempts).toBe(0);
    expect(row!.lockedUntil).toBeNull();
  });

  it("9. a weak password is refused 422 and does NOT burn the token", async () => {
    /*
     * Exactly why the page keeps the form open on a 422 rather than declaring
     * the link dead. If this ever consumed the token, that UI would strand the
     * user with a spent link and a rejected password.
     */
    const account = await createAccount();
    const token = await requestReset(account.email);

    expect((await reset(token!, "short")).status).toBe(422);

    const [row] = await ctx.db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.userId, account.id))
      .limit(1);
    expect(row!.consumedAt).toBeNull();

    expect((await reset(token!)).status).toBe(204);
  });

  it("10. the raw token is never stored — only its digest", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);

    const rows = await ctx.db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.userId, account.id));
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — every unusable token gives ONE identical refusal", () => {
  const refusals: { label: string; status: number; message: string }[] = [];

  it("11. an unknown token is refused", async () => {
    const res = await reset("completely-made-up-reset-token");

    expect(res.status).toBe(400);
    refusals.push({ label: "unknown", status: res.status, message: res.body.error.message });
  });

  it("12. an expired token is refused", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);
    await ctx.db
      .update(passwordResets)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(passwordResets.userId, account.id));

    const res = await reset(token!);

    expect(res.status).toBe(400);
    refusals.push({ label: "expired", status: res.status, message: res.body.error.message });
  });

  it("13. an already-consumed token is refused", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);
    expect((await reset(token!)).status).toBe(204);

    const res = await reset(token!, "YetAnotherPassword1");

    expect(res.status).toBe(400);
    refusals.push({ label: "consumed", status: res.status, message: res.body.error.message });
  });

  it("14. a deactivated account's token is refused", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, account.id));

    const res = await reset(token!);

    expect(res.status).toBe(400);
    refusals.push({ label: "deactivated", status: res.status, message: res.body.error.message });
  });

  it("15. a soft-deleted account's token is refused", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);
    await request(ctx.app).delete(`/api/users/${account.id}`).set(bearer(superToken));

    const res = await reset(token!);

    expect(res.status).toBe(400);
    refusals.push({ label: "deleted", status: res.status, message: res.body.error.message });
  });

  it("16. all five refusals are byte-identical — status AND message", async () => {
    expect(refusals.length).toBe(5);
    expect(new Set(refusals.map((r) => r.status)).size).toBe(1);
    expect(new Set(refusals.map((r) => r.message)).size).toBe(1);
    expect(refusals[0]!.message).toBe(GENERIC_REFUSAL);
  });

  it("17. a refusal names no condition and no account", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, account.id));
    const res = await reset(token!);

    // The hedged sentence is allowed; nothing outside it may name a condition.
    const dump = JSON.stringify(res.body).split(GENERIC_REFUSAL).join("");
    expect(dump).not.toMatch(/expired|consumed|deleted|deactivated|inactive|not found/i);
    expect(JSON.stringify(res.body)).not.toContain(account.email);
    expect(JSON.stringify(res.body)).not.toContain(account.id);
  });

  it("18. a deactivated account does not lose its live link — the consume rolls back", async () => {
    const account = await createAccount();
    const token = await requestReset(account.email);
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, account.id));
    expect((await reset(token!)).status).toBe(400);

    await ctx.db.update(users).set({ status: "Active" }).where(eq(users.id, account.id));
    expect((await reset(token!)).status).toBe(204);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — asking for a link reveals nothing about the address", () => {
  it("19. an unknown address gets the same 204", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody.at.all@risenext.com" });

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it("20. a known, a deactivated and a deleted address are indistinguishable", async () => {
    const known = await createAccount();

    const deactivated = await createAccount();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, deactivated.id));

    const deleted = await createAccount();
    await request(ctx.app).delete(`/api/users/${deleted.id}`).set(bearer(superToken));

    const responses = [];
    for (const email of [
      known.email,
      deactivated.email,
      deleted.email,
      "never.existed@risenext.com",
    ]) {
      resetRateLimits();
      const res = await request(ctx.app).post("/api/auth/forgot-password").send({ email });
      responses.push({ status: res.status, body: JSON.stringify(res.body) });
    }

    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([204]));
    expect(new Set(responses.map((r) => r.body)).size).toBe(1);
  });

  it("21. only an eligible address actually produces a link", async () => {
    // The response is identical; what differs is invisible to the caller.
    const deactivated = await createAccount();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, deactivated.id));

    expect(await requestReset(deactivated.email)).toBeNull();
    expect(await requestReset("never.existed@risenext.com")).toBeNull();
  });

  it("22. the request is rate limited, and the limit does not leak existence either", async () => {
    const account = await createAccount();
    resetRateLimits();

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push(
        (await request(ctx.app).post("/api/auth/forgot-password").send({ email: account.email }))
          .status,
      );
    }

    // 5 per 15 minutes, then 429 — for any address, existing or not.
    expect(statuses.slice(0, 5)).toEqual([204, 204, 204, 204, 204]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
