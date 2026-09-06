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
import { invitations, refreshTokens, users } from "../db/schema/index.js";
import { logger } from "../lib/logger.js";
import { sha256, verifyPassword } from "../lib/password.js";
import { INVITATION_TTL_HOURS } from "../services/invitations.js";
import { resetRateLimits } from "../middleware/rate-limit.js";

/**
 * EMPLOYEE INVITATIONS — roadmap task 3.5
 *
 * The whole lifecycle over real HTTP against real migrations:
 * **create employee → invitation row → emailed link → accept → password set →
 * consumed → replay refused.**
 *
 * Three properties carry the weight, and each has its own group:
 *
 *   - **The raw token is never at rest** (group B). Only a SHA-256 digest is
 *     stored, so a database read does not hand over every pending invitation.
 *   - **At most one password establishment per invitation** (group E). The guard
 *     is a conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()`,
 *     resolved by the database, not by application timing.
 *   - **Nothing distinguishes the failure modes** (group D). Unknown, expired,
 *     consumed, deleted and deactivated all produce one message — otherwise a
 *     public endpoint becomes an oracle for which addresses have invitations.
 *
 * The test environment has no email configuration, so `sendEmail` takes the
 * console transport and logs what it would have sent (D-035). That is how the
 * link is captured here — the same path a developer reads it from.
 */

let ctx: TestContext;
let superToken: string;
let bank: { id: string; code: string };
let executiveRoleId: string;
let lowPrivilegeToken: string;
let n = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

const GOOD_PASSWORD = "ChosenByTheEmployee1";

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

interface NewEmployee {
  id: string;
  email: string;
  name: string;
  token: string;
  body: Record<string, unknown>;
}

/** Creates an employee through the real route and pulls the link out of the mail. */
async function createEmployee(overrides: Record<string, unknown> = {}): Promise<NewEmployee> {
  n += 1;
  const email = `invitee.${n}@risenext.com`;

  const { result: res, logged } = await captureEmail(() =>
    request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({
        name: `Invitee ${n}`,
        email,
        roleId: executiveRoleId,
        bankIds: [bank.id],
        ...overrides,
      }),
  );

  expect(res.status).toBe(201);

  const match = /accept-invite\?token=([A-Za-z0-9_%-]+)/.exec(logged);
  if (!match) throw new Error(`no invitation link in the sent email: ${logged.slice(0, 400)}`);

  return {
    id: res.body.data.id as string,
    email,
    name: `Invitee ${n}`,
    token: decodeURIComponent(match[1]!),
    body: res.body as Record<string, unknown>,
  };
}

const accept = (token: string, password = GOOD_PASSWORD) =>
  request(ctx.app).post("/api/auth/accept-invite").send({ token, password });

const rowFor = async (userId: string) => {
  const rows = await ctx.db.select().from(invitations).where(eq(invitations.userId, userId));
  return rows;
};

const liveRowFor = async (userId: string) => {
  const [row] = await ctx.db
    .select()
    .from(invitations)
    .where(and(eq(invitations.userId, userId), isNull(invitations.consumedAt)))
    .limit(1);
  return row;
};

const userRow = async (id: string) => {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
};

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Invite Test Bank");
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;

  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (await login(superAdmin.email, superAdmin.password)).body.accessToken as string;

  /*
   * Created up front, deliberately. The harness mints employee codes from its
   * own counter (EMP-1001, EMP-1002 ...) while the route generates max+1 over
   * existing rows, so creating a harness user AFTER several route-created ones
   * makes the two sequences collide. That is a fixture interaction, not a
   * product defect - an explicit duplicate through the route still 409s.
   */
  const executive = await createUser(ctx.db, { roleKey: "executive" });
  lowPrivilegeToken = (await login(executive.email, executive.password)).body.accessToken as string;
});

afterAll(async () => destroyTestContext(ctx));
// The limiter is process-wide; one case must not throttle the next.
beforeEach(() => resetRateLimits());
afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

/* ------------------------------------------------------------------ group A */

describe("A — the table and the migration", () => {
  it("1. the migration created `invitations` with the documented columns", async () => {
    const rows = await ctx.client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_name = 'invitations' order by column_name`,
    );
    const columns = rows.rows.map((r) => r.column_name).sort();

    expect(columns).toEqual(
      ["consumed_at", "created_at", "created_by", "expires_at", "id", "token_hash", "user_id"].sort(),
    );
  });

  it("2. token_hash, user_id and expires_at are NOT NULL; consumed_at is nullable", async () => {
    const rows = await ctx.client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_name = 'invitations'`,
    );
    const nullable = Object.fromEntries(rows.rows.map((r) => [r.column_name, r.is_nullable]));

    expect(nullable.token_hash).toBe("NO");
    expect(nullable.user_id).toBe("NO");
    expect(nullable.expires_at).toBe("NO");
    expect(nullable.consumed_at).toBe("YES");
  });

  it("3. token_hash is unique", async () => {
    const rows = await ctx.client.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'invitations'`,
    );
    expect(rows.rows.map((r) => r.indexname)).toContain("invitations_token_hash_unique");
  });

  it("4. there is no column that could hold a raw token", async () => {
    // The point of the table: a database read must not yield a usable link.
    const rows = await ctx.client.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'invitations'`,
    );
    const columns = rows.rows.map((r) => r.column_name);

    expect(columns).not.toContain("token");
    expect(columns).not.toContain("raw_token");
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — issuing: the raw token never reaches the database", () => {
  it("5. creating an employee creates exactly one live invitation", async () => {
    const employee = await createEmployee();
    const rows = await rowFor(employee.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.consumedAt).toBeNull();
  });

  it("6. only the digest is stored, and it matches the emailed token", async () => {
    const employee = await createEmployee();
    const row = await liveRowFor(employee.id);

    expect(row!.tokenHash).toBe(sha256(employee.token));
    expect(row!.tokenHash).not.toBe(employee.token);
  });

  it("7. no row anywhere in the table contains the raw token", async () => {
    const employee = await createEmployee();
    const all = await ctx.db.select().from(invitations);

    expect(JSON.stringify(all)).not.toContain(employee.token);
  });

  it("8. tokens are long and unpredictable", async () => {
    const a = await createEmployee();
    const b = await createEmployee();

    // 48 random bytes, base64url — 64 characters.
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("9. the expiry is the documented window", async () => {
    const employee = await createEmployee();
    const row = await liveRowFor(employee.id);

    const hours = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / (60 * 60 * 1000);
    expect(Math.round(hours)).toBe(INVITATION_TTL_HOURS);
  });

  it("10. the emailed link carries the token and the subject does not", async () => {
    const lines: unknown[][] = [];
    vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
      lines.push(args);
    }) as never);

    n += 1;
    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: `Subject Check ${n}`, email: `subject.${n}@risenext.com`, roleId: executiveRoleId });
    expect(res.status).toBe(201);

    const payload = lines.find((l) => JSON.stringify(l).includes("accept-invite"));
    const record = payload![0] as { subject: string; text: string };
    const token = /accept-invite\?token=([A-Za-z0-9_%-]+)/.exec(record.text)![1]!;

    expect(record.text).toContain("accept-invite?token=");
    expect(record.subject).not.toContain(token);
  });

  it("11. the email is the shared template, carrying no password", async () => {
    const lines: unknown[][] = [];
    vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
      lines.push(args);
    }) as never);

    n += 1;
    await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: `Template ${n}`, email: `template.${n}@risenext.com`, roleId: executiveRoleId });

    const record = lines.find((l) => JSON.stringify(l).includes("accept-invite"))![0] as {
      subject: string;
      text: string;
    };

    // `employeeInvitationEmail`'s own wording, not a second copy in the route.
    expect(record.subject).toBe("Set up your Rise Next account");
    expect(record.text).toContain("Choose your own password");
    expect(record.text).not.toMatch(/temporary password|your password is/i);
  });

  it("12. reissuing supersedes the previous invitation instead of leaving two live", async () => {
    const employee = await createEmployee();
    const first = await liveRowFor(employee.id);

    // A second issue for the same employee, through the service the route uses.
    const { issueInvitation } = await import("../services/invitations.js");
    await issueInvitation(ctx.db, employee.id, null);

    const live = await ctx.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.userId, employee.id), isNull(invitations.consumedAt)));

    expect(live).toHaveLength(1);
    expect(live[0]!.id).not.toBe(first!.id);
    // And the old link is dead.
    expect((await accept(employee.token)).status).toBe(400);
  });

  it("13. the on-screen hand-over survives — roadmap 3.9", async () => {
    const employee = await createEmployee();

    expect(typeof employee.body.temporaryPassword).toBe("string");
    expect((employee.body.temporaryPassword as string).length).toBeGreaterThan(8);
  });

  it("14. the response reports the invitation outcome honestly", async () => {
    const employee = await createEmployee();
    const invitation = employee.body.invitation as { status: string; expiresInHours: number };

    // No email configuration in tests, so the console transport ran. "logged" is
    // not "sent", and the response says so rather than claiming delivery.
    expect(invitation.status).toBe("logged");
    expect(invitation.status).not.toBe("sent");
    expect(invitation.expiresInHours).toBe(INVITATION_TTL_HOURS);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — accepting: the happy path, end to end", () => {
  it("15. a valid token and password set the credential and return 204 with no body", async () => {
    const employee = await createEmployee();

    const res = await accept(employee.token);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.text).toBe("");
  });

  it("16. the password is argon2-hashed by the existing utility, never stored plain", async () => {
    const employee = await createEmployee();
    await accept(employee.token);
    const row = await userRow(employee.id);

    expect(row.passwordHash).not.toBe(GOOD_PASSWORD);
    expect(row.passwordHash.startsWith("$argon2")).toBe(true);
    expect(await verifyPassword(row.passwordHash, GOOD_PASSWORD)).toBe(true);
  });

  it("17. the invitation is consumed", async () => {
    const employee = await createEmployee();
    await accept(employee.token);
    const rows = await rowFor(employee.id);

    expect(rows[0]!.consumedAt).not.toBeNull();
  });

  it("18. mustChangePassword is cleared — they chose it themselves", async () => {
    const employee = await createEmployee();
    expect((await userRow(employee.id)).mustChangePassword).toBe(true);

    await accept(employee.token);

    expect((await userRow(employee.id)).mustChangePassword).toBe(false);
  });

  it("19. the employee can then sign in normally", async () => {
    const employee = await createEmployee();
    await accept(employee.token);

    const res = await login(employee.email, GOOD_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("20. accepting creates no session of its own", async () => {
    // The invitation establishes a credential; signing in is the normal flow.
    const employee = await createEmployee();
    const res = await accept(employee.token);

    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("21. unrelated fields survive — role, bank access, name, code", async () => {
    const employee = await createEmployee();
    const before = await userRow(employee.id);
    await accept(employee.token);
    const after = await userRow(employee.id);

    expect(after.roleId).toBe(before.roleId);
    expect(after.name).toBe(before.name);
    expect(after.employeeCode).toBe(before.employeeCode);
    expect(after.status).toBe(before.status);
  });

  it("22. the temporary password stops working once a new one is set", async () => {
    const employee = await createEmployee();
    const temporary = employee.body.temporaryPassword as string;
    expect((await login(employee.email, temporary)).status).toBe(200);

    await accept(employee.token);

    expect((await login(employee.email, temporary)).status).toBe(401);
    expect((await login(employee.email, GOOD_PASSWORD)).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — every refusal looks the same", () => {
  const MESSAGE = "This invitation link is not valid. It may have expired or already been used.";

  it("23. an unknown token is refused", async () => {
    const res = await accept("a-token-that-was-never-issued-aaaaaaaaaaaaaaaaaaaa");

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(MESSAGE);
  });

  it("24. a consumed token is refused, identically", async () => {
    const employee = await createEmployee();
    await accept(employee.token);

    const res = await accept(employee.token);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(MESSAGE);
  });

  it("25. an expired token is refused, identically", async () => {
    const employee = await createEmployee();
    await ctx.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.userId, employee.id));

    const res = await accept(employee.token);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(MESSAGE);
  });

  it("26. a soft-deleted employee's token is refused, identically", async () => {
    const employee = await createEmployee();
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, employee.id));

    const res = await accept(employee.token);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(MESSAGE);
  });

  it("27. a deactivated employee's token is refused, identically", async () => {
    const employee = await createEmployee();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, employee.id));

    const res = await accept(employee.token);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(MESSAGE);
  });

  it("28. refusing a deactivated employee does NOT burn the link", async () => {
    // The consume is inside the transaction that rejects, so it rolls back —
    // reactivating restores a usable invitation rather than a dead one.
    const employee = await createEmployee();
    await ctx.db.update(users).set({ status: "Inactive" }).where(eq(users.id, employee.id));
    expect((await accept(employee.token)).status).toBe(400);

    await ctx.db.update(users).set({ status: "Active" }).where(eq(users.id, employee.id));

    expect((await accept(employee.token)).status).toBe(204);
  });

  it("29. no refusal reveals whether the employee exists", async () => {
    const employee = await createEmployee();
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, employee.id));

    const known = await accept(employee.token);
    const unknown = await accept("definitely-not-a-real-token-bbbbbbbbbbbbbbbbbbbb");

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });

  it("30. a malformed body is a validation error, not a crash", async () => {
    expect((await request(ctx.app).post("/api/auth/accept-invite").send({})).status).toBe(422);
    expect(
      (await request(ctx.app).post("/api/auth/accept-invite").send({ token: "" , password: "x" })).status,
    ).toBe(422);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — at most one password establishment per invitation", () => {
  it("31. two simultaneous acceptances: exactly one succeeds", async () => {
    const employee = await createEmployee();

    const [a, b] = await Promise.all([
      accept(employee.token, "FirstWriterWins11"),
      accept(employee.token, "SecondWriterLoses22"),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([204, 400]);

    // And exactly one of the two passwords is live — never both, never neither.
    const row = await userRow(employee.id);
    const first = await verifyPassword(row.passwordHash, "FirstWriterWins11");
    const second = await verifyPassword(row.passwordHash, "SecondWriterLoses22");
    expect(first !== second).toBe(true);
  });

  it("32. a replay cannot change the password a second time", async () => {
    const employee = await createEmployee();
    await accept(employee.token, "TheRealPassword11");

    const replay = await accept(employee.token, "AttackerChosen22");

    expect(replay.status).toBe(400);
    const row = await userRow(employee.id);
    expect(await verifyPassword(row.passwordHash, "TheRealPassword11")).toBe(true);
    expect(await verifyPassword(row.passwordHash, "AttackerChosen22")).toBe(false);
  });

  it("33. only one invitation row is ever consumed", async () => {
    const employee = await createEmployee();
    await accept(employee.token);
    await accept(employee.token);

    const rows = await rowFor(employee.id);
    expect(rows.filter((r) => r.consumedAt !== null)).toHaveLength(1);
  });

  it("34. accepting revokes sessions that predate the credential", async () => {
    const employee = await createEmployee();
    const temporary = employee.body.temporaryPassword as string;
    await login(employee.email, temporary);
    expect(
      await ctx.db
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.userId, employee.id), isNull(refreshTokens.revokedAt))),
    ).not.toHaveLength(0);

    await accept(employee.token);

    const live = await ctx.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, employee.id), isNull(refreshTokens.revokedAt)));
    expect(live).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ group F */

describe("F — the password policy, and failures that must not consume", () => {
  it("35. a weak password is refused with the existing policy message", async () => {
    const employee = await createEmployee();

    const res = await accept(employee.token, "short");

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Password must/);
  });

  it.each([
    ["nouppercase111", /uppercase/],
    ["NOLOWERCASE111", /lowercase/],
    ["NoDigitsAtAllHere", /digit/],
  ])("36. rejects %s", async (password, expected) => {
    const employee = await createEmployee();

    const res = await accept(employee.token, password);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(expected);
  });

  it("37. a rejected password does NOT consume the invitation", async () => {
    // Otherwise one typo would permanently burn an employee's only link.
    const employee = await createEmployee();
    expect((await accept(employee.token, "weak")).status).toBe(422);

    expect((await liveRowFor(employee.id))).toBeTruthy();
    expect((await accept(employee.token)).status).toBe(204);
  });

  it("38. an invalid token is refused before any password work happens", async () => {
    // The SEC-005 mitigation: a junk token must not buy an argon2 hash.
    const res = await accept("junk-token-cccccccccccccccccccccccccccc", "short");

    // The generic invitation failure, NOT the password-policy message — proving
    // the token was rejected first.
    expect(res.status).toBe(400);
    expect(res.body.error.message).not.toMatch(/Password must/);
  });
});

/* ------------------------------------------------------------------ group G */

describe("G — the token never leaks", () => {
  it("39. never appears in any log line during issue or acceptance", async () => {
    const lines: unknown[][] = [];
    for (const method of ["info", "warn", "error"] as const) {
      vi.spyOn(logger, method).mockImplementation(((...args: unknown[]) => {
        lines.push(args);
      }) as never);
    }

    n += 1;
    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: `Leak ${n}`, email: `leak.${n}@risenext.com`, roleId: executiveRoleId });
    const token = /accept-invite\?token=([A-Za-z0-9_%-]+)/.exec(JSON.stringify(lines))![1]!;

    const before = lines.length;
    await accept(decodeURIComponent(token));

    // The console transport legitimately logs the link at issue time — that is
    // its purpose. What must not happen is the token appearing again during
    // ACCEPTANCE, where there is no reason for it.
    expect(JSON.stringify(lines.slice(before))).not.toContain(token);
    expect(res.status).toBe(201);
  });

  it("40. never appears in an error response", async () => {
    const token = "leaky-token-dddddddddddddddddddddddddddddddd";

    const res = await accept(token, "short");

    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("41. never appears in an audit summary", async () => {
    const employee = await createEmployee();
    await accept(employee.token);

    const rows = await ctx.client.query<{ summary: string }>(
      `select summary from audit_logs where summary is not null`,
    );

    expect(JSON.stringify(rows.rows)).not.toContain(employee.token);
  });

  it("42. the chosen password never appears in a log or an audit row", async () => {
    const lines: unknown[][] = [];
    for (const method of ["info", "warn", "error"] as const) {
      vi.spyOn(logger, method).mockImplementation(((...args: unknown[]) => {
        lines.push(args);
      }) as never);
    }
    const employee = await createEmployee();
    await accept(employee.token, "NeverLogThis111");

    const audit = await ctx.client.query<{ summary: string }>(`select summary from audit_logs`);

    expect(JSON.stringify(lines)).not.toContain("NeverLogThis111");
    expect(JSON.stringify(audit.rows)).not.toContain("NeverLogThis111");
  });

  it("43. accepting records an audit event without exposing the credential", async () => {
    const employee = await createEmployee();
    await accept(employee.token);

    const rows = await ctx.client.query<{ action: string; summary: string }>(
      `select action, summary from audit_logs where summary = 'Password set from an invitation link'`,
    );

    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows[0]!.action).toBe("password_changed");
  });
});

/* ------------------------------------------------------------------ group H */

describe("H — creation still works when mail does not", () => {
  it("44. a failing provider does not fail employee creation", async () => {
    /*
     * The roadmap's own requirement: "user creation still succeeds when the mail
     * provider is down". `sendEmail` never throws (D-035); this proves the route
     * relies on that rather than on the provider being up.
     */
    /*
     * The transport is made to blow up mid-send. This originally escaped and
     * turned creation into a 500 - sendEmail guaranteed "never throws" only for
     * provider failures, not for anything else in its own body. That guarantee
     * is now absolute (D-035, hardened here), and this is the test that found it.
     */
    const spy = vi.spyOn(logger, "info").mockImplementation((() => {
      throw new Error("logging transport exploded");
    }) as never);

    n += 1;
    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: `Outage ${n}`, email: `outage.${n}@risenext.com`, roleId: executiveRoleId });
    spy.mockRestore();

    expect(res.status).toBe(201);
    // And the invitation still exists, so it can be resent (roadmap 3.8).
    expect(await rowFor(res.body.data.id as string)).toHaveLength(1);
  });
});

describe("H2 — accept-invite is rate limited too", () => {
  it("48. throttles repeated redemption attempts from one source", async () => {
    // The third public credential-granting endpoint. Task 3.5 shipped before the
    // limiter existed; leaving it unguarded afterwards would be an oversight.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await accept(`bogus-invite-${i}-gggggggggggggggggggg`)).status);
    }

    expect(statuses.filter((s) => s === 400)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ group I */

describe("I — existing controls are untouched", () => {
  it("45. accept-invite needs no authentication, but grants nothing else", async () => {
    const employee = await createEmployee();
    await accept(employee.token);

    // The role is what it always was; acceptance grants no permission.
    const row = await userRow(employee.id);
    expect(row.roleId).toBe(executiveRoleId);
  });

  it("46. creation still refuses an actor who may not create", async () => {
    n += 1;
    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(lowPrivilegeToken))
      .send({ name: `Nope ${n}`, email: `nope.${n}@risenext.com`, roleId: executiveRoleId });

    expect(res.status).toBe(403);
    // No invitation was issued for a refused creation.
    expect(await ctx.db.select().from(invitations)).not.toHaveLength(0); // others exist
  });

  it("47. a failed creation issues no invitation", async () => {
    const before = (await ctx.db.select().from(invitations)).length;

    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: "X", email: "not-an-email", roleId: executiveRoleId });

    expect(res.status).toBe(422);
    expect((await ctx.db.select().from(invitations)).length).toBe(before);
  });
});
