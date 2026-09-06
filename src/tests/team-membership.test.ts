import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, count, eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { auditLogs, teamMembers, teams, users } from "../db/schema/index.js";

/**
 * TEAM MEMBERSHIP AUTHORIZATION — BUG-038
 *
 * `PUT /api/teams/:id/members` replaces the whole roster in one request, and
 * until this fix its only guard was `requirePermission(teams.assign)` — a flat
 * yes/no with no coupling to *who* was being rostered. Measured before the fix:
 * a Manager could add a Super Admin (200) while the same Manager was refused a
 * 403 on `PATCH /api/users/:id` for that same person.
 *
 * The rule being enforced is the project's one hierarchy rule
 * (`access.ts:141-156`): an actor may only act on a subject whose role level is
 * strictly greater than their own, unless they hold `system.manage_any_user`.
 * There are no role-name comparisons here or in the route.
 *
 * The part that is easy to get wrong, and which group C exists to pin down:
 * because the roster is REPLACED, omitting a name is an act upon that person
 * exactly as much as adding one is. Authorizing only the submitted list leaves
 * the eviction path wide open. Authorization therefore covers
 * `previous ∪ submitted`.
 *
 * Every refusal asserts the roster in the database is untouched and that no
 * audit row was written — a guard that refuses after writing is not a guard.
 */

let ctx: TestContext;
let teamCounter = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Actor {
  id: string;
  email: string;
  password: string;
  token: string;
}

async function signedIn(roleKey: string, bankIds?: string[]): Promise<Actor> {
  const user = await createUser(ctx.db, { roleKey, ...(bankIds ? { bankIds } : {}) });
  const res = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: user.email, password: user.password });
  expect(res.status).toBe(200);
  return { ...user, token: res.body.accessToken as string };
}

async function makeTeam(): Promise<string> {
  teamCounter += 1;
  const [team] = await ctx.db
    .insert(teams)
    .values({ name: `Team ${teamCounter}`, status: "Active" })
    .returning();
  return team!.id;
}

/** Seeds the prior roster directly, so `previous` is a fixture, not a side effect. */
async function seedRoster(teamId: string, userIds: string[]): Promise<void> {
  await ctx.db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
  if (userIds.length) {
    await ctx.db.insert(teamMembers).values(userIds.map((userId) => ({ teamId, userId })));
  }
}

async function rosterOf(teamId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
  return rows.map((r) => r.userId).sort();
}

async function auditRowsFor(teamId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.recordType, "team"), eq(auditLogs.recordId, teamId)));
  return row?.n ?? 0;
}

async function lastAuditFor(teamId: string) {
  const rows = await ctx.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.recordType, "team"), eq(auditLogs.recordId, teamId)));
  return rows[rows.length - 1]!;
}

const setMembers = (teamId: string, token: string, userIds: string[]) =>
  request(ctx.app).put(`/api/teams/${teamId}/members`).set(bearer(token)).send({ userIds });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await ctx.db.delete(teamMembers);
});

/* ------------------------------------------------------------------------ */

describe("A. Additions are bound by the hierarchy rule", () => {
  it("refuses a Manager adding a Super Admin, and writes nothing", async () => {
    const manager = await signedIn("manager");
    const victim = await createUser(ctx.db, { roleKey: "super_admin" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [victim.id]);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(await rosterOf(teamId)).toEqual([]);
    expect(await auditRowsFor(teamId)).toBe(0);
  });

  it("refuses a Manager adding an Admin", async () => {
    const manager = await signedIn("manager");
    const target = await createUser(ctx.db, { roleKey: "admin" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [target.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([]);
  });

  it("refuses a Manager adding a peer Manager — 'strictly greater', not 'greater or equal'", async () => {
    const manager = await signedIn("manager");
    const peer = await createUser(ctx.db, { roleKey: "manager" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [peer.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([]);
  });

  it("refuses the whole request when one member of a valid batch is protected", async () => {
    const manager = await signedIn("manager");
    const ok = await createUser(ctx.db, { roleKey: "executive" });
    const protectedUser = await createUser(ctx.db, { roleKey: "admin" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [ok.id, protectedUser.id]);

    expect(res.status).toBe(403);
    // All-or-nothing: the authorised half must not be written either.
    expect(await rosterOf(teamId)).toEqual([]);
  });
});

describe("B. Legitimate assignment still works", () => {
  it("lets a Manager add an Executive", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [exec.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([exec.id]);
  });

  it("lets a Manager add a Team Leader", async () => {
    const manager = await signedIn("manager");
    const lead = await createUser(ctx.db, { roleKey: "team_leader" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [lead.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([lead.id]);
  });

  it("lets a Manager roster an Executive and a Team Leader together", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const lead = await createUser(ctx.db, { roleKey: "team_leader" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [exec.id, lead.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([exec.id, lead.id].sort());
  });

  it("preserves the response contract", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [exec.id]);

    expect(res.body).toEqual({ data: { teamId, userIds: [exec.id] } });
  });

  it("replaces the roster rather than merging into it", async () => {
    const manager = await signedIn("manager");
    const first = await createUser(ctx.db, { roleKey: "executive" });
    const second = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [first.id]);

    const res = await setMembers(teamId, manager.token, [second.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([second.id]);
  });
});

describe("C. Removals are bound by the same rule — the eviction path", () => {
  /**
   * THE REGRESSION TEST FOR BUG-038.
   *
   * Every id in the submitted body is one the Manager is fully entitled to
   * manage, so an implementation that authorises only `userIds` returns 200 here
   * and quietly drops the Super Admin. This test is the tripwire: reduce the
   * affected set from `previous ∪ submitted` back to `submitted` and it fails.
   */
  it("refuses a Manager evicting a Super Admin by omission, even though every SUBMITTED id is authorised", async () => {
    const manager = await signedIn("manager");
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [superAdmin.id, exec.id]);

    const res = await setMembers(teamId, manager.token, [exec.id]);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe(
      "You cannot manage a user at or above your own role level",
    );
    // The victim is still there.
    expect(await rosterOf(teamId)).toEqual([superAdmin.id, exec.id].sort());
    expect(await auditRowsFor(teamId)).toBe(0);
  });

  it("refuses a Manager evicting an Admin by omission", async () => {
    const manager = await signedIn("manager");
    const admin = await createUser(ctx.db, { roleKey: "admin" });
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [admin.id, exec.id]);

    const res = await setMembers(teamId, manager.token, [exec.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([admin.id, exec.id].sort());
  });

  it("refuses a Manager clearing a roster that contains a protected member", async () => {
    const manager = await signedIn("manager");
    const admin = await createUser(ctx.db, { roleKey: "admin" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [admin.id]);

    const res = await setMembers(teamId, manager.token, []);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([admin.id]);
  });

  it("lets a Manager remove a member they are entitled to manage", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const lead = await createUser(ctx.db, { roleKey: "team_leader" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [exec.id, lead.id]);

    const res = await setMembers(teamId, manager.token, [exec.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([exec.id]);
  });

  it("lets a Manager clear a roster of members they may manage", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [exec.id]);

    const res = await setMembers(teamId, manager.token, []);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([]);
  });

  /**
   * A documented consequence of authorizing the union rather than only the
   * changes: a Manager cannot edit a roster that contains someone senior to them
   * even when they leave that person in place. This is deliberate — the route
   * rewrites the whole roster, so it fails closed — and is asserted here so the
   * behaviour is a decision rather than an accident.
   */
  it("refuses a Manager touching a roster containing a Super Admin, even when they keep them", async () => {
    const manager = await signedIn("manager");
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [superAdmin.id]);

    const res = await setMembers(teamId, manager.token, [superAdmin.id, exec.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([superAdmin.id]);
  });
});

describe("D. Membership targets must be real users", () => {
  it("refuses a nonexistent user with a 400 that says what is wrong", async () => {
    const manager = await signedIn("manager");
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [
      "00000000-0000-4000-8000-000000000000",
    ]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(res.body.error.message).toBe("One or more users do not exist");
    expect(await rosterOf(teamId)).toEqual([]);
    expect(await auditRowsFor(teamId)).toBe(0);
  });

  it("no longer leaks the raw foreign-key conflict for a nonexistent user", async () => {
    const manager = await signedIn("manager");
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [
      "00000000-0000-4000-8000-000000000001",
    ]);

    // Before the fix this was a 409 "That record is still referenced by other
    // records" — a message that asserts the opposite of what happened.
    expect(res.status).not.toBe(409);
    expect(res.body.error.message).not.toMatch(/still referenced/i);
  });

  it("refuses a soft-deleted user being added", async () => {
    const manager = await signedIn("manager");
    const ghost = await createUser(ctx.db, { roleKey: "executive" });
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, ghost.id));
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [ghost.id]);

    expect(res.status).toBe(400);
    expect(await rosterOf(teamId)).toEqual([]);
  });

  it("still rejects a malformed uuid at the schema boundary", async () => {
    const manager = await signedIn("manager");
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, ["not-a-uuid"]);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("404s for a team that does not exist", async () => {
    const manager = await signedIn("manager");

    const res = await setMembers(
      "00000000-0000-4000-8000-0000000000ff",
      manager.token,
      [],
    );

    expect(res.status).toBe(404);
  });

  /**
   * Soft-deleting a user leaves their `team_members` rows behind, so requiring
   * every PRIOR member to be live would make any team containing a departed
   * employee permanently unmanageable. Dropping an already-deleted member grants
   * nobody anything, so it is allowed.
   */
  it("does not let a departed ex-member lock the roster", async () => {
    const manager = await signedIn("manager");
    const departed = await createUser(ctx.db, { roleKey: "executive" });
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [departed.id]);
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, departed.id));

    const res = await setMembers(teamId, manager.token, [exec.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([exec.id]);
  });
});

describe("E. Inactive users remain assignable", () => {
  it("allows an Inactive user to be rostered — deactivation is not deletion", async () => {
    const manager = await signedIn("manager");
    const benched = await createUser(ctx.db, { roleKey: "executive", status: "Inactive" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [benched.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([benched.id]);
  });
});

describe("F. system.manage_any_user still bypasses, as the rule says it must", () => {
  it("lets a Super Admin roster an Admin", async () => {
    const superAdmin = await signedIn("super_admin");
    const admin = await createUser(ctx.db, { roleKey: "admin" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, superAdmin.token, [admin.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([admin.id]);
  });

  it("lets a Super Admin roster another Super Admin", async () => {
    const superAdmin = await signedIn("super_admin");
    const peer = await createUser(ctx.db, { roleKey: "super_admin" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, superAdmin.token, [peer.id]);

    expect(res.status).toBe(200);
  });

  it("lets a Super Admin clear a roster containing a Super Admin", async () => {
    const superAdmin = await signedIn("super_admin");
    const peer = await createUser(ctx.db, { roleKey: "super_admin" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [peer.id]);

    const res = await setMembers(teamId, superAdmin.token, []);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([]);
  });

  it("lets an Admin roster a Manager", async () => {
    const admin = await signedIn("admin");
    const manager = await createUser(ctx.db, { roleKey: "manager" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, admin.token, [manager.id]);

    expect(res.status).toBe(200);
  });

  it("refuses an Admin rostering a Super Admin — Admin holds no manage_any_user", async () => {
    const admin = await signedIn("admin");
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, admin.token, [superAdmin.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([]);
  });

  it("refuses an Admin rostering a peer Admin", async () => {
    const admin = await signedIn("admin");
    const peer = await createUser(ctx.db, { roleKey: "admin" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, admin.token, [peer.id]);

    expect(res.status).toBe(403);
  });
});

describe("G. The permission gate is unchanged", () => {
  it("refuses a Team Leader, who does not hold teams.assign", async () => {
    const lead = await signedIn("team_leader");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, lead.token, [exec.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([]);
  });

  it("refuses an Executive", async () => {
    const exec = await signedIn("executive");
    const teamId = await makeTeam();

    const res = await setMembers(teamId, exec.token, []);

    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    const teamId = await makeTeam();

    const res = await request(ctx.app).put(`/api/teams/${teamId}/members`).send({ userIds: [] });

    expect(res.status).toBe(401);
  });
});

describe("H. The audit row records the roster transition", () => {
  it("records from/to for an addition", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();

    await setMembers(teamId, manager.token, [exec.id]);

    const row = await lastAuditFor(teamId);
    expect(row.action).toBe("assigned");
    expect(row.changes).toEqual({ members: { from: [], to: [exec.id] } });
  });

  it("records WHO was removed — the question the old audit row could not answer", async () => {
    const manager = await signedIn("manager");
    const leaving = await createUser(ctx.db, { roleKey: "executive" });
    const staying = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [leaving.id, staying.id]);

    await setMembers(teamId, manager.token, [staying.id]);

    const row = await lastAuditFor(teamId);
    const changes = row.changes as { members: { from: string[]; to: string[] } };
    expect(changes.members.from.sort()).toEqual([leaving.id, staying.id].sort());
    expect(changes.members.to).toEqual([staying.id]);
    // The removal is recoverable by difference, which is the whole point.
    expect(changes.members.from.filter((id) => !changes.members.to.includes(id))).toEqual([
      leaving.id,
    ]);
  });

  it("records an empty 'to' when a roster is cleared", async () => {
    const superAdmin = await signedIn("super_admin");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [exec.id]);

    await setMembers(teamId, superAdmin.token, []);

    const row = await lastAuditFor(teamId);
    expect(row.changes).toEqual({ members: { from: [exec.id], to: [] } });
  });
});

/**
 * Both cases below are regressions that the first cut of this fix introduced and
 * that the adversarial review caught. They are not hypothetical: each was
 * measured returning the wrong answer before being corrected.
 */
describe("J. The actor's own membership is not something they need authority over", () => {
  it("lets a Manager who is on the team edit that team's roster", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [manager.id]);

    const res = await setMembers(teamId, manager.token, [manager.id, exec.id]);

    // Without the self-exclusion this is 403: the hierarchy rule is *strictly*
    // greater, and nobody outranks themselves. `POST /api/users` can place a
    // Manager on a team at creation, so this state is reachable normally.
    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([manager.id, exec.id].sort());
  });

  it("lets a Manager remove themselves from a team", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [manager.id, exec.id]);

    const res = await setMembers(teamId, manager.token, [exec.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([exec.id]);
  });

  it("lets a Manager add themselves to a team", async () => {
    const manager = await signedIn("manager");
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [manager.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([manager.id]);
  });

  it("still refuses a peer at the actor's level who is NOT the actor", async () => {
    const manager = await signedIn("manager");
    const peer = await createUser(ctx.db, { roleKey: "manager" });
    const teamId = await makeTeam();
    await seedRoster(teamId, [manager.id]);

    // The self-exclusion must be an identity check, not a level check.
    const res = await setMembers(teamId, manager.token, [manager.id, peer.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([manager.id]);
  });
});

describe("K. Submitted uuids are canonicalised before they are compared", () => {
  it("accepts an uppercase uuid for a live user", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [exec.id.toUpperCase()]);

    // Postgres emits uuids lower-cased and `z.uuid()` does not normalise, so
    // comparing the raw request id against ids read back from the database
    // rejected a real user with "One or more users do not exist".
    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([exec.id]);
  });

  it("returns the canonical lower-case id, matching what was stored", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [exec.id.toUpperCase()]);

    expect(res.body.data.userIds).toEqual([exec.id]);
  });

  it("still enforces the hierarchy on an uppercase uuid", async () => {
    const manager = await signedIn("manager");
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const teamId = await makeTeam();

    // Case must not become a way to slip past the check that matters.
    const res = await setMembers(teamId, manager.token, [superAdmin.id.toUpperCase()]);

    expect(res.status).toBe(403);
    expect(await rosterOf(teamId)).toEqual([]);
  });

  it("treats case variants of one id as the same member", async () => {
    const manager = await signedIn("manager");
    const exec = await createUser(ctx.db, { roleKey: "executive" });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [exec.id, exec.id.toUpperCase()]);

    // Two spellings of one uuid would otherwise violate the (team_id, user_id)
    // primary key.
    expect(res.status).not.toBe(500);
  });
});

/**
 * Task 2.7 wires this route from the employee screen. Moving one employee is two
 * requests against two teams, because a roster cannot express membership of
 * another team — so the sequence itself is worth pinning at the HTTP level,
 * independently of the React tests that build the bodies.
 */
describe("L. The employee-screen move sequence, end to end", () => {
  it("moves an employee between teams and leaves both rosters correct", async () => {
    const admin = await signedIn("admin");
    const moving = await createUser(ctx.db, { roleKey: "executive" });
    const stayingOnOld = await createUser(ctx.db, { roleKey: "executive" });
    const alreadyOnNew = await createUser(ctx.db, { roleKey: "team_leader" });
    const from = await makeTeam();
    const to = await makeTeam();
    await seedRoster(from, [moving.id, stayingOnOld.id]);
    await seedRoster(to, [alreadyOnNew.id]);

    // 1. off the old team — its other member is resubmitted, not dropped
    const off = await setMembers(from, admin.token, [stayingOnOld.id]);
    // 2. onto the new team — its existing member is resubmitted, not dropped
    const on = await setMembers(to, admin.token, [alreadyOnNew.id, moving.id]);

    expect(off.status).toBe(200);
    expect(on.status).toBe(200);
    expect(await rosterOf(from)).toEqual([stayingOnOld.id]);
    expect(await rosterOf(to)).toEqual([alreadyOnNew.id, moving.id].sort());
  });

  it("would evict the whole roster if the UI sent only the moved employee", async () => {
    // This is why the client must resubmit the complete roster: the route
    // accepts a bare list happily, with a 200 and no warning.
    const admin = await signedIn("admin");
    const moving = await createUser(ctx.db, { roleKey: "executive" });
    const bystander = await createUser(ctx.db, { roleKey: "executive" });
    const to = await makeTeam();
    await seedRoster(to, [bystander.id]);

    const res = await setMembers(to, admin.token, [moving.id]);

    expect(res.status).toBe(200);
    expect(await rosterOf(to)).toEqual([moving.id]);
    // The bystander is gone, and nothing refused it.
    expect(await rosterOf(to)).not.toContain(bystander.id);
  });

  it("refuses the move to an actor without teams.assign", async () => {
    const lead = await signedIn("team_leader");
    const moving = await createUser(ctx.db, { roleKey: "executive" });
    const to = await makeTeam();

    const res = await setMembers(to, lead.token, [moving.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(to)).toEqual([]);
  });

  it("lets a Manager move an employee between teams of manageable members", async () => {
    const manager = await signedIn("manager");
    const moving = await createUser(ctx.db, { roleKey: "executive" });
    const lead = await createUser(ctx.db, { roleKey: "team_leader" });
    const from = await makeTeam();
    const to = await makeTeam();
    await seedRoster(from, [moving.id]);
    await seedRoster(to, [lead.id]);

    const off = await setMembers(from, manager.token, []);
    const on = await setMembers(to, manager.token, [lead.id, moving.id]);

    expect(off.status).toBe(200);
    expect(on.status).toBe(200);
    expect(await rosterOf(to)).toEqual([lead.id, moving.id].sort());
  });

  it("still blocks a Manager whose target roster holds a Super Admin — BUG-038 intact", async () => {
    // The union check fires on a member the UI resubmitted untouched. This is
    // the case the screen must surface verbatim rather than quietly dropping.
    const manager = await signedIn("manager");
    const moving = await createUser(ctx.db, { roleKey: "executive" });
    const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
    const to = await makeTeam();
    await seedRoster(to, [superAdmin.id]);

    const res = await setMembers(to, manager.token, [superAdmin.id, moving.id]);

    expect(res.status).toBe(403);
    expect(await rosterOf(to)).toEqual([superAdmin.id]);
  });
});

describe("I. Teams are not bank-scoped, and this fix did not make them so", () => {
  it("lets a Manager roster an employee assigned to a different bank", async () => {
    const bankA = await createBank(ctx.db);
    const bankB = await createBank(ctx.db);
    const manager = await signedIn("manager", [bankA.id]);
    const outsider = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankB.id] });
    const teamId = await makeTeam();

    const res = await setMembers(teamId, manager.token, [outsider.id]);

    // `teams` and `team_members` carry no bank column and PROJECT_CONTEXT.md
    // states teams are "Not bank-scoped". Adding a scope check here would be new
    // policy, not a bug fix.
    expect(res.status).toBe(200);
    expect(await rosterOf(teamId)).toEqual([outsider.id]);
  });
});
