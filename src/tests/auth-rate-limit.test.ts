import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import {
  hashConcurrency,
  resetHashConcurrency,
  resetRateLimits,
  withHashSlot,
} from "../middleware/rate-limit.js";

/**
 * SEC-005 (P0) — RATE LIMITING AND THE ARGON2 PILE-UP. Task 13.1.
 *
 * The finding is two problems in one sentence: *"No HTTP rate limiting
 * anywhere; argon2id pile-up denial of service."* A request limiter answers the
 * first. It does **not** answer the second — it caps how many requests arrive,
 * not how many memory-hard hashes run at once — so both halves are tested here.
 *
 * ── THIS FILE DELIBERATELY FIGHTS THE GLOBAL TEST HOOK ──────────────────────
 *
 * `tests/setup.ts` resets the counters before **every** test, so the suite does
 * not throttle itself. That hook would make a limiter test vacuous, so each
 * case below resets **once at its own start** and then never again — every
 * request inside a case counts against the one it precedes. If the hook were
 * deleted tomorrow these cases would still pass; they do not depend on it.
 *
 * ── WHY THE ASSERTIONS ARE ABOUT INDISTINGUISHABILITY TOO ───────────────────
 *
 * SEC-004 was closed in Wave 1 by making a locked account answer the same 401
 * an unknown address gets. A limiter is the obvious way to reopen that: if a
 * real address throttles and an unknown one does not, the 429 becomes the new
 * oracle. Group C exists to prove it did not.
 */

const PASSWORD = "TestPassword123!"; // what `createUser` sets — harness.ts:72
const LOGIN_IP_MAX = 20; // `loginIpLimit`, auth.routes.ts
const LOGIN_ACCOUNT_MAX = 10; // `loginAccountLimit`
const GLOBAL_MAX = 300; // `app.ts`

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

const login = (email: string, password = "wrong-password") =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

/** Fires `n` logins in series and returns the status of each. */
async function burst(email: string, n: number, password?: string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push((await login(email, password)).status);
  return out;
}

/* ══ A — the login route is throttled per source address ══════════════════ */

describe("A · POST /api/auth/login is rate limited per address", () => {
  it("1. THE FINDING: a burst from one address is eventually refused 429", async () => {
    resetRateLimits();
    // Distinct addresses each time, so the ACCOUNT limiter cannot be what
    // trips — this case must isolate the per-IP axis.
    const statuses: number[] = [];
    for (let i = 0; i < LOGIN_IP_MAX + 5; i += 1) {
      statuses.push((await login(`burst-${i}@example.com`)).status);
    }

    // Pre-fix every one of these was a 401 and each cost a full argon2 hash.
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(5);
  });

  it("2. requests below the limit are untouched", async () => {
    resetRateLimits();
    const statuses = await burst("under-limit@example.com", 3);
    expect(statuses.every((s) => s === 401)).toBe(true);
  });

  it("3. a VALID credential is refused too once the address is over the limit", async () => {
    // A limiter that let correct passwords through would be trivially bypassed
    // by an attacker who has already found one.
    resetRateLimits();
    const user = await createUser(ctx.db, { roleKey: "executive" });

    for (let i = 0; i < LOGIN_IP_MAX + 2; i += 1) await login(`filler-${i}@example.com`);

    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(429);
  });
});

/* ══ B — and per account, which per-IP limiting cannot see ════════════════ */

describe("B · login is also limited per account", () => {
  it("4. one address is throttled sooner than the per-IP budget allows", async () => {
    resetRateLimits();
    const target = "single-target@example.com";
    const statuses = await burst(target, LOGIN_ACCOUNT_MAX + 3);

    // The account limiter (10) bites before the IP limiter (20) would.
    expect(statuses).toContain(429);
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(LOGIN_ACCOUNT_MAX);
  });

  it("5. the account bucket is case- and whitespace-insensitive", async () => {
    // Otherwise `A@x.com`, `a@x.com` and `a@x.com ` are three free allowances.
    resetRateLimits();
    const variants = ["Case@Example.com", "case@example.com", "  CASE@example.com  "];

    const statuses: number[] = [];
    for (let i = 0; i < LOGIN_ACCOUNT_MAX + 3; i += 1) {
      statuses.push((await login(variants[i % variants.length]!)).status);
    }
    expect(statuses).toContain(429);
  });

  it("6. a request with no usable address is not bucketed with everyone else", async () => {
    /*
     * `keyFor` returns null for these, so they opt out of the ACCOUNT limiter.
     * Bucketing them together would let malformed junk exhaust a real user's
     * allowance — a denial of service built out of the defence. They are still
     * counted by the IP limiter, which is the correct axis for junk.
     */
    resetRateLimits();
    for (let i = 0; i < 5; i += 1) {
      await request(ctx.app).post("/api/auth/login").send({ password: "x" });
    }

    // A real address still has its full account allowance.
    const statuses = await burst("untouched@example.com", 3);
    expect(statuses.every((s) => s !== 429)).toBe(true);
  });
});

/* ══ C — the limiter did not become the new enumeration oracle ════════════ */

describe("C · throttling reveals nothing about whether an account exists (SEC-004 stays closed)", () => {
  it("7. a real address and an unknown one throttle identically", async () => {
    const real = await createUser(ctx.db, { roleKey: "executive" });

    resetRateLimits();
    const realStatuses = await burst(real.email, LOGIN_ACCOUNT_MAX + 2);

    resetRateLimits();
    const fakeStatuses = await burst("definitely-not-a-user@example.com", LOGIN_ACCOUNT_MAX + 2);

    expect(realStatuses).toEqual(fakeStatuses);
  });

  it("8. the 429 body is identical for a real and an unknown address", async () => {
    const real = await createUser(ctx.db, { roleKey: "executive" });

    resetRateLimits();
    await burst(real.email, LOGIN_ACCOUNT_MAX + 1);
    const realBody = (await login(real.email)).body;

    resetRateLimits();
    await burst("nobody-at-all@example.com", LOGIN_ACCOUNT_MAX + 1);
    const fakeBody = (await login("nobody-at-all@example.com")).body;

    expect(realBody).toEqual(fakeBody);
    // And it says nothing about accounts at all.
    expect(JSON.stringify(realBody)).not.toMatch(/account|user|exist/i);
  });
});

/* ══ D — the global limiter is a backstop over every route ════════════════ */

describe("D · a global limiter covers routes nobody remembered to guard", () => {
  it("9. an unauthenticated burst at an arbitrary API route is eventually refused", async () => {
    resetRateLimits();
    let saw429 = false;
    for (let i = 0; i < GLOBAL_MAX + 20; i += 1) {
      const res = await request(ctx.app).get("/api/customers");
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });

  it("10. `/api/health` is EXEMPT, so the limiter cannot restart-loop the platform", async () => {
    /*
     * Railway polls liveness continuously from a small set of addresses.
     * Counting those would eventually throttle the platform's own health check
     * and trigger a restart loop — the limiter taking the service down being a
     * considerably worse outcome than the one it prevents.
     */
    resetRateLimits();
    for (let i = 0; i < GLOBAL_MAX + 20; i += 1) {
      const res = await request(ctx.app).get("/api/health");
      expect(res.status, `health probe ${i} must never be throttled`).toBe(200);
    }
  });
});

/* ══ E — the argon2 concurrency cap, SEC-005's other half ═════════════════ */

describe("E · argon2 concurrency is bounded (the half a request limiter cannot solve)", () => {
  it("11. THE CAP: no more than 4 hashes run at once, however many are offered", async () => {
    resetHashConcurrency();
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    // 20 simultaneous "hashes" that all block until released.
    const running = Array.from({ length: 20 }, () =>
      withHashSlot(async () => {
        peak = Math.max(peak, hashConcurrency().active);
        await gate;
        return true;
      }),
    );

    // Let the scheduler admit everything it is willing to admit.
    await new Promise((r) => setTimeout(r, 20));
    expect(hashConcurrency().active).toBeLessThanOrEqual(4);
    expect(hashConcurrency().queued).toBeGreaterThan(0);

    release();
    await Promise.all(running);

    expect(peak).toBeLessThanOrEqual(4);
    // Everything drained — no slot was leaked.
    expect(hashConcurrency()).toEqual({ active: 0, queued: 0 });
  });

  it("12. over the cap a request WAITS rather than failing", async () => {
    resetHashConcurrency();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const blockers = Array.from({ length: 4 }, () => withHashSlot(() => gate.then(() => 1)));
    await new Promise((r) => setTimeout(r, 10));

    let settled = false;
    const queued = withHashSlot(async () => 2).then((v) => ((settled = true), v));

    await new Promise((r) => setTimeout(r, 20));
    expect(settled, "the 5th must still be waiting, not rejected").toBe(false);

    release();
    await Promise.all(blockers);
    await expect(queued).resolves.toBe(2);
  });

  it("13. a REJECTED hash still frees its slot — a failed login is the common case", async () => {
    resetHashConcurrency();
    await expect(withHashSlot(async () => { throw new Error("bad password"); })).rejects.toThrow();
    expect(hashConcurrency()).toEqual({ active: 0, queued: 0 });
  });

  it("14. the queue is bounded — an unbounded one is a slower memory exhaustion", async () => {
    resetHashConcurrency();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const held = Array.from({ length: 4 }, () => withHashSlot(() => gate.then(() => 0)));
    await new Promise((r) => setTimeout(r, 10));

    // Fill the queue to its documented ceiling.
    const queued = Array.from({ length: 100 }, () => withHashSlot(async () => 0));
    await new Promise((r) => setTimeout(r, 10));

    await expect(withHashSlot(async () => 0)).rejects.toThrow();

    release();
    await Promise.all([...held, ...queued]);
  });

  it("15. login still works normally when nothing is contended", async () => {
    resetRateLimits();
    resetHashConcurrency();
    const user = await createUser(ctx.db, { roleKey: "executive" });

    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(hashConcurrency()).toEqual({ active: 0, queued: 0 });
  });
});
