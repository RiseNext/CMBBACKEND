import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { invitations, users } from "../db/schema/index.js";
import { logger } from "../lib/logger.js";
import { resetRateLimits } from "../middleware/rate-limit.js";

/**
 * THE INVITATION LINK, END TO END — roadmap task 3.11.
 *
 * `invitations.test.ts` already proves the endpoint. This file proves the
 * **link**, which is the seam Task 3.11 introduced and the one place a defect
 * could hide behind a fully green suite on both sides.
 *
 * The page reads its token with `useSearchParams().get("token")` — which
 * URL-**decodes**. The backend builds the link with `encodeURIComponent`. A
 * base64url token contains `-` and `_`, which survive that round trip, but a
 * change to either end (a different alphabet, a double encode, a different
 * parameter name, a different path) would break **every real invitation** while
 * every unit test on both sides kept passing, because they each use a raw token
 * and never cross the URL.
 *
 * So group A parses the emailed URL exactly as a browser does and feeds the
 * result to the endpoint, rather than reusing the token the test already holds.
 *
 * Group B is the property the page depends on for its security contract: every
 * unusable token — unknown, expired, consumed, deleted, deactivated — must
 * produce **one identical refusal**, because the page renders that refusal
 * verbatim and can only be as safe as this is (**D-038**).
 */

let ctx: TestContext;
let superToken: string;
let bank: { id: string; code: string };
let executiveRoleId: string;
let n = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

const CHOSEN_PASSWORD = "ChosenByTheEmployee1";

/** The one sentence every unusable token gets. The page renders it verbatim. */
const GENERIC_REFUSAL =
  "This invitation link is not valid. It may have expired or already been used.";

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

interface Invited {
  id: string;
  email: string;
  /** The full URL as it appears in the email. */
  url: string;
  /** The token as a BROWSER would hand it to the page, not as we generated it. */
  tokenFromUrl: string;
}

/**
 * Creates an employee and extracts the link the way the recipient's browser
 * would: find the URL, parse it, read the query parameter.
 */
async function invite(): Promise<Invited> {
  n += 1;
  const email = `link.${n}@risenext.com`;

  const { result: res, logged } = await captureEmail(() =>
    request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: `Link Target ${n}`, email, roleId: executiveRoleId, bankIds: [bank.id] }),
  );
  expect(res.status).toBe(201);

  const match = /https?:\/\/[^\s"'\\]+accept-invite\?token=[^\s"'\\&]+/.exec(logged);
  if (!match) throw new Error(`no invitation URL in the email: ${logged.slice(0, 400)}`);

  const url = new URL(match[0]);
  const tokenFromUrl = url.searchParams.get("token");
  if (!tokenFromUrl) throw new Error(`no token parameter in ${url.toString()}`);

  return { id: res.body.data.id as string, email, url: match[0], tokenFromUrl };
}

const accept = (token: string, password = CHOSEN_PASSWORD) =>
  request(ctx.app).post("/api/auth/accept-invite").send({ token, password });

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Link Test Bank");
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;

  // Minted before any route-created employee: the harness numbers codes from
  // its own counter while the route takes max+1, so the two collide otherwise.
  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (await login(superAdmin.email, superAdmin.password)).body.accessToken as string;
});

afterAll(async () => destroyTestContext(ctx));
// The limiter allows 10 per 15 minutes and is process-wide.
beforeEach(() => resetRateLimits());
afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

/* ------------------------------------------------------------------ group A */

describe("A — the emailed link is exactly what the page consumes", () => {
  it("1. the email contains an absolute URL to /accept-invite", async () => {
    const invited = await invite();
    const url = new URL(invited.url);

    expect(url.pathname).toBe("/accept-invite");
    expect(url.origin).toBe("http://localhost:3000");
  });

  it("2. the token arrives in a parameter named `token`", async () => {
    // The page reads `params.get("token")`. Renaming either end breaks both.
    const invited = await invite();
    expect(new URL(invited.url).searchParams.get("token")).toBeTruthy();
  });

  it("3. the token survives the URL round trip unchanged", async () => {
    const invited = await invite();
    const raw = new URL(invited.url).searchParams.get("token")!;

    // base64url only: no character that would need escaping, and none that a
    // second decode would mangle.
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeURIComponent(raw)).toBe(raw);
  });

  it("4. the browser-parsed token is accepted by the endpoint", async () => {
    /*
     * The load-bearing test of this file: the token is taken from the parsed
     * URL, not from the generator, so it has crossed the same boundary the real
     * page crosses.
     */
    const invited = await invite();
    const res = await accept(invited.tokenFromUrl);

    expect(res.status).toBe(204);
  });

  it("5. the employee can then sign in with the password they chose", async () => {
    const invited = await invite();
    expect((await accept(invited.tokenFromUrl)).status).toBe(204);

    const signIn = await login(invited.email, CHOSEN_PASSWORD);
    expect(signIn.status).toBe(200);
  });

  it("6. acceptance sets no session — the page must not assume one", async () => {
    const invited = await invite();
    const res = await accept(invited.tokenFromUrl);

    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body).toEqual({});
  });

  it("7. and it clears the forced-change flag, so sign-in is not interrupted", async () => {
    const invited = await invite();
    await accept(invited.tokenFromUrl);

    const [row] = await ctx.db.select().from(users).where(eq(users.id, invited.id)).limit(1);
    expect(row!.mustChangePassword).toBe(false);
    expect(row!.inviteAcceptedAt).not.toBeNull();
  });

  it("8. a weak password is refused with 422, and the link stays usable", async () => {
    const invited = await invite();
    const weak = await accept(invited.tokenFromUrl, "short");

    expect(weak.status).toBe(422);
    // The page keeps the form open on a 422 precisely because this is true.
    expect((await accept(invited.tokenFromUrl)).status).toBe(204);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — every unusable token gives ONE identical refusal", () => {
  /** Drives one unusable-token scenario and returns the response. */
  const refusals: { label: string; status: number; message: string }[] = [];

  it("9. an unknown token is refused", async () => {
    const res = await accept("completely-made-up-token-value");

    expect(res.status).toBe(400);
    refusals.push({ label: "unknown", status: res.status, message: res.body.error.message });
  });

  it("10. an expired token is refused", async () => {
    const invited = await invite();
    await ctx.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invitations.userId, invited.id));

    const res = await accept(invited.tokenFromUrl);

    expect(res.status).toBe(400);
    refusals.push({ label: "expired", status: res.status, message: res.body.error.message });
  });

  it("11. an already-consumed token is refused", async () => {
    const invited = await invite();
    expect((await accept(invited.tokenFromUrl)).status).toBe(204);

    const res = await accept(invited.tokenFromUrl, "AnotherPassword123");

    expect(res.status).toBe(400);
    refusals.push({ label: "consumed", status: res.status, message: res.body.error.message });
  });

  it("12. a deactivated employee's token is refused", async () => {
    const invited = await invite();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, invited.id));

    const res = await accept(invited.tokenFromUrl);

    expect(res.status).toBe(400);
    refusals.push({ label: "deactivated", status: res.status, message: res.body.error.message });
  });

  it("13. a soft-deleted employee's token is refused", async () => {
    const invited = await invite();
    await request(ctx.app).delete(`/api/users/${invited.id}`).set(bearer(superToken));

    const res = await accept(invited.tokenFromUrl);

    expect(res.status).toBe(400);
    refusals.push({ label: "deleted", status: res.status, message: res.body.error.message });
  });

  it("14. all five refusals are byte-identical — status AND message", async () => {
    /*
     * This is what the page's security contract rests on. If the backend ever
     * differentiated these, the page would faithfully render the difference and
     * become an oracle for which addresses have a pending invitation (D-038).
     */
    expect(refusals.length).toBe(5);
    expect(new Set(refusals.map((r) => r.status)).size).toBe(1);
    expect(new Set(refusals.map((r) => r.message)).size).toBe(1);
    expect(refusals[0]!.message).toBe(GENERIC_REFUSAL);
  });

  it("15. no refusal leaks the reason in any other field", async () => {
    const invited = await invite();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, invited.id));
    const res = await accept(invited.tokenFromUrl);

    /*
     * The generic sentence itself says "may have expired or already been used"
     * — that hedged pairing is what makes it uninformative, so it is stripped
     * before the check. Nothing outside it may name a condition.
     */
    const dump = JSON.stringify(res.body).split(GENERIC_REFUSAL).join("");
    expect(dump).not.toMatch(/expired|consumed|deleted|deactivated|inactive|not found/i);
    expect(JSON.stringify(res.body)).not.toContain(invited.email);
    expect(JSON.stringify(res.body)).not.toContain(invited.tokenFromUrl);
  });

  it("16. a refusal reveals nothing about the employee", async () => {
    const invited = await invite();
    await request(ctx.app).delete(`/api/users/${invited.id}`).set(bearer(superToken));
    const res = await accept(invited.tokenFromUrl);

    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(invited.id);
    expect(dump).not.toMatch(/EMP-\d+/);
  });
});
