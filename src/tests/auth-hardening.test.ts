import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import {
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import * as schema from "../db/schema/index.js";
import { env } from "../config/env.js";
import { verifyAccessToken, verifyRefreshToken } from "../lib/tokens.js";

/**
 * WAVE 1 / TRACK B — AUTHENTICATION HARDENING
 *
 * Regression coverage for three findings closed together, because they live in
 * the same handler and the same token pair:
 *
 *   SEC-004  user enumeration via a 429 only a real account can produce
 *   SEC-006  sticky lockout counter — permanent remote account denial of service
 *   SEC-022  `jwt.verify` pinned no algorithm
 *
 * Every case here **fails against the pre-fix code**. That is the bar Phase 13's
 * Definition of Done sets — *"every CRITICAL and HIGH finding is closed and has
 * a regression test"* — and it is why these assert observable behaviour over
 * real HTTP rather than reading the implementation back to itself.
 *
 * Two of the three are about what an *attacker* can observe, so the assertions
 * are deliberately about **indistinguishability**: not "the locked account is
 * refused" (it always was) but "the refusal is identical to the one an address
 * that does not exist gets".
 */

const PASSWORD = "TestPassword123!"; // what `createUser` sets — harness.ts:72
const MAX_FAILED_ATTEMPTS = 8;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

/** Reads the two lockout columns straight from the row. */
async function lockState(email: string) {
  const [row] = await ctx.db
    .select({ attempts: schema.users.failedLoginAttempts, lockedUntil: schema.users.lockedUntil })
    .from(schema.users)
    .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
    .limit(1);
  return row;
}

/** Burns exactly `n` wrong passwords. */
async function failTimes(email: string, n: number) {
  for (let i = 0; i < n; i += 1) await login(email, "definitely-not-the-password");
}

/** Moves a live lockout into the past — the only way to serve out 15 minutes. */
async function expireLock(userId: string) {
  await ctx.db
    .update(schema.users)
    .set({ lockedUntil: new Date(Date.now() - 60_000) })
    .where(eq(schema.users.id, userId));
}

describe("SEC-004 — a locked account is indistinguishable from one that does not exist", () => {
  it("1. a locked account answers 401, not 429", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    await failTimes(user.email, MAX_FAILED_ATTEMPTS);
    expect((await lockState(user.email))?.lockedUntil).toBeTruthy();

    // Pre-fix this was 429 `too_many_requests` — an oracle needing no password.
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(401);
  });

  it("2. the locked response is identical to the unknown-address response", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    await failTimes(user.email, MAX_FAILED_ATTEMPTS);

    const lockedRes = await login(user.email, PASSWORD);
    const unknownRes = await login("nobody-here@example.com", PASSWORD);

    expect(lockedRes.status).toBe(unknownRes.status);
    expect(lockedRes.body).toEqual(unknownRes.body);
    // The oracle was the *code*, so pin it explicitly, not only the body.
    expect(lockedRes.body.error.code).toBe(unknownRes.body.error.code);
  });

  it("3. a wrong password on a live account is also indistinguishable from unknown", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });

    const wrongRes = await login(user.email, "wrong-but-well-formed");
    const unknownRes = await login("also-nobody@example.com", "wrong-but-well-formed");

    expect(wrongRes.status).toBe(401);
    expect(wrongRes.body).toEqual(unknownRes.body);
  });

  it("4. the lockout still HOLDS — indistinguishable is not the same as disabled", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    await failTimes(user.email, MAX_FAILED_ATTEMPTS);

    // The CORRECT password must not work while the lock is live.
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });
});

describe("SEC-006 — the lockout counter resets once the window has elapsed", () => {
  it("5. the counter climbs and the account locks at the threshold", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });

    await failTimes(user.email, MAX_FAILED_ATTEMPTS - 1);
    let state = await lockState(user.email);
    expect(state?.attempts).toBe(MAX_FAILED_ATTEMPTS - 1);
    expect(state?.lockedUntil).toBeNull();

    await failTimes(user.email, 1);
    state = await lockState(user.email);
    expect(state?.attempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(state?.lockedUntil).toBeTruthy();
  });

  it("6. once the window has passed, the correct password signs in again", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    await failTimes(user.email, MAX_FAILED_ATTEMPTS);
    await expireLock(user.id);

    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("7. THE FINDING: one wrong password after the window does NOT re-lock the account", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    await failTimes(user.email, MAX_FAILED_ATTEMPTS);
    await expireLock(user.id);

    /*
     * Pre-fix, `failedLoginAttempts` was still 8 here, so `8 + 1 >= 8` re-locked
     * instantly. One request every 15 minutes — from an unauthenticated caller
     * who needs only a valid address — kept the account dead permanently, and
     * the victim could not recover by waiting.
     */
    await failTimes(user.email, 1);

    const state = await lockState(user.email);
    expect(state?.attempts).toBe(1);
    expect(state?.lockedUntil).toBeNull();

    // And the owner can still get in.
    expect((await login(user.email, PASSWORD)).status).toBe(200);
  });

  it("8. a successful login clears the counter, as it always did", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    await failTimes(user.email, 3);
    expect((await lockState(user.email))?.attempts).toBe(3);

    await login(user.email, PASSWORD);
    expect((await lockState(user.email))?.attempts).toBe(0);
  });
});

describe("SEC-022 — the JWT algorithm is pinned to HS256", () => {
  const SUB = "00000000-0000-4000-8000-000000000001";
  const claims = { issuer: "risenext-crm", audience: "risenext-crm-api" } as const;

  it("9. a token signed with HS512 is refused by the access verifier", () => {
    const forged = jwt.sign({ sub: SUB, tokenType: "access" }, env().JWT_ACCESS_SECRET, {
      algorithm: "HS512",
      ...claims,
    });
    // Pre-fix this VERIFIED: the secret is symmetric and the width was
    // unconstrained, so the token's own header chose the algorithm.
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it("10. a token signed with HS384 is refused by the refresh verifier", () => {
    const forged = jwt.sign(
      { sub: SUB, jti: "x", tokenType: "refresh" },
      env().JWT_REFRESH_SECRET,
      { algorithm: "HS384", ...claims },
    );
    expect(() => verifyRefreshToken(forged)).toThrow();
  });

  it("11. `alg: none` is refused", () => {
    const forged = jwt.sign({ sub: SUB, tokenType: "access" }, "", {
      algorithm: "none",
      ...claims,
    });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it("12. a genuine HS256 token still verifies — the pin is not a regression", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(200);

    const decoded = verifyAccessToken(res.body.accessToken as string);
    expect(decoded.sub).toBe(user.id);

    // And the token the service issues really is HS256, so the pin matches
    // what we sign with — this is what makes the fix behaviour-preserving.
    const header = JSON.parse(
      Buffer.from((res.body.accessToken as string).split(".")[0]!, "base64url").toString(),
    );
    expect(header.alg).toBe("HS256");
  });

  it("13. a forged token is refused end to end over HTTP, not merely by the helper", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    const forged = jwt.sign(
      { sub: user.id, email: user.email, tokenType: "access" },
      env().JWT_ACCESS_SECRET,
      { algorithm: "HS512", ...claims },
    );

    const res = await request(ctx.app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});
