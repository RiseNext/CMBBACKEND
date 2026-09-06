import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createTestContext, createUser, destroyTestContext, type TestContext } from "./harness.js";
import { refreshTokens } from "../db/schema/index.js";

/**
 * ACTIVE SESSIONS AND REVOCATION — Task 12.8.
 *
 * The settings screen listed **three hardcoded devices dated 2024**, each with a
 * "Sign out" button that raised a success toast and revoked nothing. Wave 1
 * deleted the table rather than leave the claim standing, and named this row.
 *
 * `refresh_tokens` has always held the real data. What was missing was any way
 * to read it or to revoke one row.
 *
 * ── WHAT GROUP C EXISTS FOR ─────────────────────────────────────────────────
 *
 * "Revoked" must mean the session genuinely cannot continue, not that a row was
 * marked and a toast raised. So revocation is measured by **using the cookie
 * afterwards**: the revoked session's refresh is refused, and a session that was
 * not revoked still works. Asserting `revoked_at is not null` would pass against
 * a fix that forgot to check the column on the refresh path.
 *
 * ── AND WHAT IS NOT CLAIMED ─────────────────────────────────────────────────
 *
 * The rows carry `created_at`, `expires_at`, `user_agent` and `ip_address`, and
 * that is all the endpoint returns. Case 6 pins the absence of a fabricated
 * device name, and case 5 pins that the token digest never leaves the server.
 */

const PASSWORD = "TestPassword123!";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let ctx: TestContext;

interface Session {
  access: string;
  cookie: string;
  userId: string;
  email: string;
}

/** A real sign-in, so the refresh cookie and its stored hash are genuine. */
async function signIn(email: string, userAgent = "vitest-agent/1.0"): Promise<Session> {
  const res = await request(ctx.app)
    .post("/api/auth/login")
    .set("User-Agent", userAgent)
    .send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);

  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = (raw ?? []).find((c) => c.startsWith("rn_refresh="));
  expect(cookie, "login must set the refresh cookie").toBeTruthy();

  return {
    access: res.body.accessToken as string,
    cookie: cookie!.split(";")[0]!,
    userId: res.body.user.id as string,
    email,
  };
}

const listSessions = (session: Session) =>
  request(ctx.app)
    .get("/api/auth/sessions")
    .set(bearer(session.access))
    .set("Cookie", session.cookie);

const revoke = (session: Session, id: string) =>
  request(ctx.app)
    .delete(`/api/auth/sessions/${id}`)
    .set(bearer(session.access))
    .set("Cookie", session.cookie);

/** Does this cookie still buy a new access token? */
const canRefresh = async (cookie: string) =>
  (await request(ctx.app).post("/api/auth/refresh").set("Cookie", cookie)).status === 200;

let owner: { id: string; email: string };
let stranger: { id: string; email: string };

beforeAll(async () => {
  ctx = await createTestContext();
  owner = await createUser(ctx.db, { roleKey: "manager" });
  stranger = await createUser(ctx.db, { roleKey: "manager" });
}, 60_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ══ A — the list is real ═════════════════════════════════════════════════ */

describe("A · the sessions endpoint returns actual refresh tokens", () => {
  it("1. THE FINDING: GET /api/auth/sessions exists and lists one row per sign-in", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const first = await signIn(user.email);
    await signIn(user.email);

    const res = await listSessions(first);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it("2. it lists only the CALLER's sessions", async () => {
    await signIn(stranger.email);
    const mine = await signIn(owner.email);

    const res = await listSessions(mine);
    const ids = res.body.data.map((row: { id: string }) => row.id);
    const strangerRows = await ctx.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, stranger.id));
    for (const row of strangerRows) expect(ids).not.toContain(row.id);
  });

  it("3. the current session is marked, and exactly one is", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    await signIn(user.email);
    const here = await signIn(user.email);

    const res = await listSessions(here);
    const current = res.body.data.filter((row: { current: boolean }) => row.current);
    expect(current).toHaveLength(1);
  });

  it("4. the metadata is what was actually recorded at sign-in", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const session = await signIn(user.email, "Mozilla/5.0 (Honest Test Agent)");

    const row = (await listSessions(session)).body.data.find(
      (r: { current: boolean }) => r.current,
    );
    expect(row.userAgent).toBe("Mozilla/5.0 (Honest Test Agent)");
    expect(row.createdAt).toBeTruthy();
    expect(row.expiresAt).toBeTruthy();
  });

  it("5. the token digest never leaves the server", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const session = await signIn(user.email);
    const res = await listSessions(session);
    for (const row of res.body.data) {
      expect(row).not.toHaveProperty("tokenHash");
      expect(row).not.toHaveProperty("token_hash");
    }
    expect(JSON.stringify(res.body)).not.toContain("tokenHash");
  });

  it("6. no device, browser, location or last-active is invented", async () => {
    // The rows carry none of these. On a screen whose whole purpose is deciding
    // what to revoke, a guessed device name is the worst kind of false claim.
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const session = await signIn(user.email);
    const [row] = (await listSessions(session)).body.data;
    expect(Object.keys(row).sort()).toEqual(
      ["createdAt", "current", "expiresAt", "id", "ipAddress", "userAgent"].sort(),
    );
  });

  it("7. a revoked session drops off the list", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const gone = await signIn(user.email);
    const here = await signIn(user.email);

    const before = (await listSessions(here)).body.data.length;
    const target = (await listSessions(here)).body.data.find(
      (r: { current: boolean }) => !r.current,
    );
    expect(target.id).toBeTruthy();
    await revoke(here, target.id);

    expect((await listSessions(here)).body.data).toHaveLength(before - 1);
    expect(await canRefresh(gone.cookie)).toBe(false);
  });

  it("8. an expired session is not listed", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const session = await signIn(user.email);
    const stale = await signIn(user.email);

    const staleRow = (await listSessions(session)).body.data.find(
      (r: { current: boolean }) => !r.current,
    );
    await ctx.db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.id, staleRow.id));

    const ids = (await listSessions(session)).body.data.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(staleRow.id);
    expect(stale.cookie).toBeTruthy();
  });

  it("9. an unauthenticated caller is refused", async () => {
    expect((await request(ctx.app).get("/api/auth/sessions")).status).toBe(401);
  });
});

/* ══ B — revocation is authorized ═════════════════════════════════════════ */

describe("B · you can only revoke your own", () => {
  it("10. THE GUARD: another user's session id is a 404, and stays live", async () => {
    const victim = await signIn(stranger.email);
    const attacker = await signIn(owner.email);

    const victimRow = (await listSessions(victim)).body.data.find(
      (r: { current: boolean }) => r.current,
    );
    const res = await revoke(attacker, victimRow.id);

    expect(res.status).toBe(404);
    // The real measure: the victim's session still works.
    expect(await canRefresh(victim.cookie)).toBe(true);
  });

  it("11. an id that names nothing is the same 404 — not an oracle", async () => {
    const session = await signIn(owner.email);
    const res = await revoke(session, "00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  it("12. revoking the same session twice is 404 the second time", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const here = await signIn(user.email);
    const other = await signIn(user.email);

    const target = (await listSessions(here)).body.data.find(
      (r: { current: boolean }) => !r.current,
    );
    expect((await revoke(here, target.id)).status).toBe(204);
    expect((await revoke(here, target.id)).status).toBe(404);
    expect(other.cookie).toBeTruthy();
  });

  it("13. a malformed id is a 422, not a 500", async () => {
    const session = await signIn(owner.email);
    const res = await request(ctx.app)
      .delete("/api/auth/sessions/not-a-uuid")
      .set(bearer(session.access));
    expect(res.status).toBe(422);
  });

  it("14. an unauthenticated caller cannot revoke", async () => {
    const session = await signIn(owner.email);
    const row = (await listSessions(session)).body.data[0];
    const res = await request(ctx.app).delete(`/api/auth/sessions/${row.id}`);
    expect(res.status).toBe(401);
    expect(await canRefresh(session.cookie)).toBe(true);
  });
});

/* ══ C — revocation actually ends the session ═════════════════════════════ */

describe("C · revoked means the session cannot continue", () => {
  it("15. THE POINT: the revoked cookie can no longer refresh", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const doomed = await signIn(user.email);
    const here = await signIn(user.email);

    expect(await canRefresh(doomed.cookie)).toBe(true);

    const target = (await listSessions(here)).body.data.find(
      (r: { current: boolean }) => !r.current,
    );
    expect((await revoke(here, target.id)).status).toBe(204);

    expect(await canRefresh(doomed.cookie)).toBe(false);
  });

  it("16. revoking one session leaves the others alone", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const keep = await signIn(user.email);
    const drop = await signIn(user.email);
    const here = await signIn(user.email);

    const rows = (await listSessions(here)).body.data;
    // `drop` is the middle of the three, newest first.
    const dropRow = rows.find((r: { current: boolean }) => !r.current);
    await revoke(here, dropRow.id);

    // Exactly one of the two older cookies died.
    const survivors = [await canRefresh(keep.cookie), await canRefresh(drop.cookie)].filter(Boolean);
    expect(survivors).toHaveLength(1);
  });

  it("17. revoking the CURRENT session clears the cookie and ends it", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const here = await signIn(user.email);

    const current = (await listSessions(here)).body.data.find(
      (r: { current: boolean }) => r.current,
    );
    const res = await revoke(here, current.id);

    expect(res.status).toBe(204);
    const cleared = (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    expect(cleared.some((c) => c.startsWith("rn_refresh="))).toBe(true);
    expect(await canRefresh(here.cookie)).toBe(false);
  });

  it("18. the revocation is audited", async () => {
    const user = await createUser(ctx.db, { roleKey: "manager" });
    const here = await signIn(user.email);
    await signIn(user.email);

    const target = (await listSessions(here)).body.data.find(
      (r: { current: boolean }) => !r.current,
    );
    await revoke(here, target.id);

    const rows = await ctx.db.select().from(
      // A session revocation is a `logout`, which is a declared AuditAction.
      (await import("../db/schema/index.js")).auditLogs,
    );
    expect(
      rows.some((row) => row.action === "logout" && row.summary === "Revoked a session"),
    ).toBe(true);
  });
});
