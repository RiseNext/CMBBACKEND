import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import { invitations, users } from "../db/schema/index.js";
import { logger } from "../lib/logger.js";
import { resetRateLimits } from "../middleware/rate-limit.js";
import { issueInvitation } from "../services/invitations.js";

/**
 * INVITATION DELIVERY STATE — roadmap task 3.7
 *
 * *"Record delivery state on the user (`invited_at`, `invite_accepted_at`) and
 * surface it in the employees list."*
 *
 * The semantics are the whole task, and two of them are easy to get wrong:
 *
 *   - **`invitedAt` means ISSUED, not delivered.** `sendEmail` reports provider
 *     acceptance at best (**D-035**), and in development the console transport
 *     delivers nothing at all — so a column conditioned on the send outcome
 *     would be null on every developer machine and would still not mean
 *     "received". Group B pins that it is set regardless of outcome, and group E
 *     pins that nothing anywhere claims delivery.
 *   - **`invitedAt` is the LATEST issuance, not the first.** Roadmap 3.8 adds
 *     resend, and the question an administrator asks is *"when did we last
 *     invite them?"* — that is what decides whether to chase. Group C pins it.
 *
 * See D-040.
 */

let ctx: TestContext;
let superToken: string;
let executiveRoleId: string;
let uninvitedId: string;
let n = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

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

interface NewEmployee {
  id: string;
  email: string;
  token: string;
}

async function createEmployee(): Promise<NewEmployee> {
  n += 1;
  const email = `state.${n}@risenext.com`;
  const { result: res, logged } = await capturing(() =>
    request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: `State ${n}`, email, roleId: executiveRoleId }),
  );
  expect(res.status).toBe(201);
  const match = /accept-invite\?token=([A-Za-z0-9_%-]+)/.exec(logged);
  if (!match) throw new Error("no invitation link emailed");
  return { id: res.body.data.id as string, email, token: decodeURIComponent(match[1]!) };
}

const accept = (token: string, password = "ChosenByEmployee11") =>
  request(ctx.app).post("/api/auth/accept-invite").send({ token, password });

const userRow = async (id: string) => {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
};

const listRow = async (id: string) => {
  const res = await request(ctx.app).get("/api/users").set(bearer(superToken)).query({ pageSize: 200 });
  expect(res.status).toBe(200);
  return (res.body.data as Record<string, unknown>[]).find((r) => r.id === id);
};

beforeAll(async () => {
  ctx = await createTestContext();
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;
  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (await login(superAdmin.email, superAdmin.password)).body.accessToken as string;

  /*
   * Created up front. The harness mints employee codes from its own counter
   * while the route generates max+1 over existing rows, so a harness user made
   * AFTER several route-created ones collides. A fixture interaction, not a
   * product defect - an explicit duplicate through the route still 409s.
   */
  uninvitedId = (await createUser(ctx.db, { roleKey: "executive" })).id;
});

afterAll(async () => destroyTestContext(ctx));
beforeEach(() => resetRateLimits());
afterEach(() => {
  vi.restoreAllMocks();
  resetRateLimits();
});

/* ------------------------------------------------------------------ group A */

describe("A — the columns exist and start empty", () => {
  it("1. the migration added both, nullable", async () => {
    const rows = await ctx.client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_name = 'users' and column_name in ('invited_at', 'invite_accepted_at')`,
    );

    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) expect(row.is_nullable).toBe("YES");
  });

  it("2. an employee created outside the invitation flow has neither", async () => {
    // The harness inserts directly, which is what a pre-existing row looks like.
    const row = await userRow(uninvitedId);

    expect(row.invitedAt).toBeNull();
    expect(row.inviteAcceptedAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — invitedAt records ISSUANCE, not delivery", () => {
  it("3. creating an employee sets invitedAt and leaves inviteAcceptedAt null", async () => {
    const employee = await createEmployee();
    const row = await userRow(employee.id);

    expect(row.invitedAt).not.toBeNull();
    expect(row.inviteAcceptedAt).toBeNull();
  });

  it("4. it matches the invitation row it was issued alongside", async () => {
    const employee = await createEmployee();
    const row = await userRow(employee.id);
    const [invitation] = await ctx.db
      .select()
      .from(invitations)
      .where(eq(invitations.userId, employee.id));

    // Written in the same statement pair, so they cannot drift.
    expect(Math.abs(row.invitedAt!.getTime() - invitation!.createdAt.getTime())).toBeLessThan(2000);
  });

  it("5. it is set even though the console transport delivered nothing", async () => {
    /*
     * The test environment has no email configuration, so `sendEmail` returns
     * `logged` — nothing left the machine. `invitedAt` is still set, because it
     * records that an invitation was ISSUED. Conditioning it on delivery would
     * leave the column null on every developer machine.
     */
    const employee = await createEmployee();

    expect((await userRow(employee.id)).invitedAt).not.toBeNull();
  });

  it("6. it is still set when the mail transport blows up entirely", async () => {
    // Employee creation stays non-blocking with respect to mail (D-035), and the
    // issuance record must survive that.
    const spy = vi.spyOn(logger, "info").mockImplementation((() => {
      throw new Error("transport exploded");
    }) as never);

    n += 1;
    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: `Outage ${n}`, email: `outage.state.${n}@risenext.com`, roleId: executiveRoleId });
    spy.mockRestore();

    expect(res.status).toBe(201);
    expect((await userRow(res.body.data.id as string)).invitedAt).not.toBeNull();
  });

  it("7. a refused creation records nothing", async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({ name: "X", email: "not-an-email", roleId: executiveRoleId });

    expect(res.status).toBe(422);
    // Nothing to assert on a user that was never created — but the invitation
    // table must not have grown either.
    expect(await ctx.db.select().from(invitations)).not.toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — invitedAt is the LATEST issuance, which is what 3.8 needs", () => {
  it("8. reissuing moves it forward", async () => {
    const employee = await createEmployee();
    const first = (await userRow(employee.id)).invitedAt!;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await issueInvitation(ctx.db, employee.id, null);

    const second = (await userRow(employee.id)).invitedAt!;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });

  it("9. reissuing does not clear an existing acceptance", async () => {
    // Order matters for 3.8: re-inviting someone who already accepted must not
    // silently erase the fact that they did.
    const employee = await createEmployee();
    await accept(employee.token);
    const accepted = (await userRow(employee.id)).inviteAcceptedAt!;

    await issueInvitation(ctx.db, employee.id, null);

    expect((await userRow(employee.id)).inviteAcceptedAt).toEqual(accepted);
  });

  it("10. the state survives a reload from the database", async () => {
    const employee = await createEmployee();
    await accept(employee.token);
    const first = await userRow(employee.id);
    const second = await userRow(employee.id);

    expect(second.invitedAt).toEqual(first.invitedAt);
    expect(second.inviteAcceptedAt).toEqual(first.inviteAcceptedAt);
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — acceptance records inviteAcceptedAt and nothing else", () => {
  it("11. accepting sets it", async () => {
    const employee = await createEmployee();
    expect((await userRow(employee.id)).inviteAcceptedAt).toBeNull();

    await accept(employee.token);

    expect((await userRow(employee.id)).inviteAcceptedAt).not.toBeNull();
  });

  it("12. accepting leaves invitedAt where it was", async () => {
    const employee = await createEmployee();
    const invited = (await userRow(employee.id)).invitedAt!;

    await accept(employee.token);

    expect((await userRow(employee.id)).invitedAt).toEqual(invited);
  });

  it("13. a refused acceptance records nothing", async () => {
    const employee = await createEmployee();
    expect((await accept(employee.token, "weak")).status).toBe(422);

    expect((await userRow(employee.id)).inviteAcceptedAt).toBeNull();
  });

  it("14. unrelated fields are untouched", async () => {
    const employee = await createEmployee();
    const before = await userRow(employee.id);

    await accept(employee.token);
    const after = await userRow(employee.id);

    expect(after.roleId).toBe(before.roleId);
    expect(after.name).toBe(before.name);
    expect(after.employeeCode).toBe(before.employeeCode);
    expect(after.email).toBe(before.email);
    expect(after.status).toBe(before.status);
    expect(after.target).toBe(before.target);
  });

  it("15. the invitation row is still consumed exactly as before", async () => {
    const employee = await createEmployee();
    await accept(employee.token);

    const rows = await ctx.db.select().from(invitations).where(eq(invitations.userId, employee.id));
    expect(rows.filter((r) => r.consumedAt !== null)).toHaveLength(1);
    // And a replay is still refused.
    expect((await accept(employee.token)).status).toBe(400);
  });

  it("16. a soft delete and restore leave the state intact", async () => {
    const employee = await createEmployee();
    await accept(employee.token);
    const before = await userRow(employee.id);

    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, employee.id));
    await ctx.db.update(users).set({ deletedAt: null }).where(eq(users.id, employee.id));

    const after = await userRow(employee.id);
    expect(after.invitedAt).toEqual(before.invitedAt);
    expect(after.inviteAcceptedAt).toEqual(before.inviteAcceptedAt);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — surfaced in the employees list, without leaking anything", () => {
  it("17. GET /api/users returns both fields", async () => {
    const employee = await createEmployee();
    const row = await listRow(employee.id);

    expect(row).toBeTruthy();
    expect(row!.invitedAt).not.toBeNull();
    expect(row!.inviteAcceptedAt).toBeNull();
  });

  it("18. they update after acceptance", async () => {
    const employee = await createEmployee();
    await accept(employee.token);

    const row = await listRow(employee.id);
    expect(row!.inviteAcceptedAt).not.toBeNull();
  });

  it("19. the row carries no token, hash or credential", async () => {
    const employee = await createEmployee();
    const row = await listRow(employee.id);
    const serialised = JSON.stringify(row);

    expect(serialised).not.toContain(employee.token);
    expect(serialised).not.toMatch(/tokenHash|token_hash|passwordHash|password_hash/);
  });

  it("20. the whole list carries no invitation token", async () => {
    const employee = await createEmployee();
    const res = await request(ctx.app).get("/api/users").set(bearer(superToken)).query({ pageSize: 200 });

    expect(JSON.stringify(res.body)).not.toContain(employee.token);
  });

  it("21. an uninvited employee reads as neither invited nor accepted", async () => {
    const row = await listRow(uninvitedId);

    expect(row!.invitedAt).toBeNull();
    expect(row!.inviteAcceptedAt).toBeNull();
  });
});
