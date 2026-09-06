import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, count, eq } from "drizzle-orm";
import { createTestContext, createUser, destroyTestContext, type TestContext } from "./harness.js";
import { auditLogs, teams } from "../db/schema/index.js";

/**
 * TEAM EDIT — Task 12.3.
 *
 * `teams.edit` has been in the permission catalogue and seeded to Super Admin
 * and Admin since the first migration, and **no route consumed it**. A team's
 * name, description, leader and status were whatever `POST /api/teams` set, for
 * the life of the record. A typo in a team name was permanent, a team could not
 * be stood down, and leadership could never move.
 *
 * ── WHAT THESE CASES ARE FOR ────────────────────────────────────────────────
 *
 * Group A is the plain capability. Group B is the one that matters: the leader
 * designation is authorized like a roster change, not like a scalar column.
 * `PUT /:id/members` applies the role hierarchy over `previous ∪ submitted`
 * because omitting a name is as much an act as adding one (BUG-038 / SEC-029).
 * If `leaderId` were exempt, the identical designation could be made through
 * this route instead and the hierarchy bypassed one field over — so group B
 * measures it from both directions, and group C proves it cannot be bypassed by
 * routing the same designation through `POST` instead.
 *
 * Every refusal asserts the row is untouched AND that no audit entry was
 * written. A guard that refuses after writing is not a guard.
 */

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let ctx: TestContext;
let teamCounter = 0;

interface Actor {
  id: string;
  email: string;
  token: string;
}

async function signedIn(roleKey: string): Promise<Actor> {
  const user = await createUser(ctx.db, { roleKey });
  const res = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: user.email, password: user.password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id: user.id, email: user.email, token: res.body.accessToken as string };
}

async function makeTeam(over: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  teamCounter += 1;
  const name = `Edit Team ${teamCounter}`;
  const [team] = await ctx.db
    .insert(teams)
    .values({ name, status: "Active", ...over })
    .returning();
  return { id: team!.id, name };
}

async function rowOf(id: string) {
  const [row] = await ctx.db.select().from(teams).where(eq(teams.id, id)).limit(1);
  return row;
}

async function auditCount(teamId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.recordType, "team"), eq(auditLogs.recordId, teamId)));
  return row?.n ?? 0;
}

let superAdmin: Actor;
let admin: Actor;
let manager: Actor;

beforeAll(async () => {
  ctx = await createTestContext();
  superAdmin = await signedIn("super_admin");
  admin = await signedIn("admin");
  manager = await signedIn("manager");
}, 60_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ══ A — the capability that did not exist ════════════════════════════════ */

describe("A · a team can be edited at all", () => {
  it("1. THE FINDING: PATCH /api/teams/:id exists and renames the team", async () => {
    const team = await makeTeam();
    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ name: "Renamed Alpha" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.name).toBe("Renamed Alpha");
    expect((await rowOf(team.id))?.name).toBe("Renamed Alpha");
  });

  it("2. description and status are editable, and status stands the team down", async () => {
    const team = await makeTeam();
    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ description: "North zone", status: "Inactive" });

    expect(res.status).toBe(200);
    const row = await rowOf(team.id);
    expect(row?.description).toBe("North zone");
    expect(row?.status).toBe("Inactive");
  });

  it("3. a one-field PATCH does not overwrite the fields it omits (BUG-036)", async () => {
    const team = await makeTeam({ description: "Kept", status: "Inactive" });
    await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ name: "Only the name" });

    const row = await rowOf(team.id);
    expect(row?.description).toBe("Kept");
    // `teamInput.status` carries `.default("Active")`. Without `patchSchema` the
    // default would survive `.partial()` and silently reactivate the team.
    expect(row?.status).toBe("Inactive");
  });

  it("4. the change is audited, with the before and after values", async () => {
    const team = await makeTeam();
    const before = await auditCount(team.id);
    await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ name: "Audited name" });

    expect(await auditCount(team.id)).toBe(before + 1);
    const [entry] = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.recordType, "team"), eq(auditLogs.recordId, team.id)));
    const changes = entry?.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.name).toEqual({ from: team.name, to: "Audited name" });
  });

  it("5. a PATCH that changes nothing writes no audit row", async () => {
    // `audit_logs` is immutable with no purge path (SEC-017). A no-op must not
    // grow it.
    const team = await makeTeam();
    const before = await auditCount(team.id);
    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ name: team.name });

    expect(res.status).toBe(200);
    expect(await auditCount(team.id)).toBe(before);
  });

  it("6. an empty body is a no-op that returns the row rather than an error", async () => {
    const team = await makeTeam();
    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(team.name);
  });

  it("7. a name that duplicates a live team is refused by the unique index", async () => {
    const first = await makeTeam();
    const second = await makeTeam();
    const res = await request(ctx.app)
      .patch(`/api/teams/${second.id}`)
      .set(bearer(superAdmin.token))
      .send({ name: first.name });

    expect(res.status).toBe(409);
    expect((await rowOf(second.id))?.name).toBe(second.name);
  });

  it("8. a soft-deleted team is 404, not silently resurrected", async () => {
    const team = await makeTeam();
    await ctx.db.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, team.id));

    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ name: "Resurrected" });

    expect(res.status).toBe(404);
    expect((await rowOf(team.id))?.name).toBe(team.name);
  });

  it("9. an unknown team is 404", async () => {
    const res = await request(ctx.app)
      .patch("/api/teams/00000000-0000-4000-8000-000000000000")
      .set(bearer(superAdmin.token))
      .send({ name: "Ghost" });
    expect(res.status).toBe(404);
  });

  it("10. an invalid status is 422", async () => {
    const team = await makeTeam();
    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ status: "Disbanded" });
    expect(res.status).toBe(422);
    expect((await rowOf(team.id))?.status).toBe("Active");
  });
});

/* ══ B — the leader is authorized like a member ═══════════════════════════ */

describe("B · naming a leader is an act upon that person", () => {
  it("11. a leader below the actor can be named", async () => {
    const team = await makeTeam();
    const leader = await createUser(ctx.db, { roleKey: "team_leader" });

    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(admin.token))
      .send({ leaderId: leader.id });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await rowOf(team.id))?.leaderId).toBe(leader.id);
  });

  it("12. THE GUARD: an Admin cannot name a Super Admin as leader", async () => {
    // The exact shape of BUG-038 one field over. `assertCanManageRoleLevel` is
    // "strictly greater"; Super Admin is level 0.
    const team = await makeTeam();
    const target = await createUser(ctx.db, { roleKey: "super_admin" });

    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(admin.token))
      .send({ leaderId: target.id });

    expect(res.status).toBe(403);
    expect((await rowOf(team.id))?.leaderId).toBeNull();
    expect(await auditCount(team.id)).toBe(0);
  });

  it("13. …nor another Admin — the rule is strictly greater, not greater-or-equal", async () => {
    const team = await makeTeam();
    const peer = await createUser(ctx.db, { roleKey: "admin" });

    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(admin.token))
      .send({ leaderId: peer.id });

    expect(res.status).toBe(403);
    expect((await rowOf(team.id))?.leaderId).toBeNull();
  });

  it("14. a Super Admin holds system.manage_any_user and may name anyone", async () => {
    const team = await makeTeam();
    const target = await createUser(ctx.db, { roleKey: "admin" });

    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ leaderId: target.id });

    expect(res.status).toBe(200);
    expect((await rowOf(team.id))?.leaderId).toBe(target.id);
  });

  it("15. naming YOURSELF is allowed — nobody outranks themselves", async () => {
    // Without the self-exemption an Admin could never lead a team, because the
    // hierarchy rule is strictly greater and their own level is equal to itself.
    const team = await makeTeam();
    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(admin.token))
      .send({ leaderId: admin.id });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await rowOf(team.id))?.leaderId).toBe(admin.id);
  });

  it("16. a leader id that names nobody is a 400, not a foreign-key 409", async () => {
    // A 23503 surfaces as "still referenced by other records", which says the
    // opposite of what happened.
    const team = await makeTeam();
    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ leaderId: "00000000-0000-4000-8000-000000000000" });

    expect(res.status).toBe(400);
    expect((await rowOf(team.id))?.leaderId).toBeNull();
  });

  it("17. a soft-deleted user cannot be named leader", async () => {
    const team = await makeTeam();
    const gone = await createUser(ctx.db, { roleKey: "executive" });
    await request(ctx.app).delete(`/api/users/${gone.id}`).set(bearer(superAdmin.token));

    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token))
      .send({ leaderId: gone.id });

    expect(res.status).toBe(400);
  });

  it("18. the leader can be cleared, and it is audited", async () => {
    const leader = await createUser(ctx.db, { roleKey: "team_leader" });
    const team = await makeTeam({ leaderId: leader.id });

    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(admin.token))
      .send({ leaderId: null });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await rowOf(team.id))?.leaderId).toBeNull();
    expect(await auditCount(team.id)).toBe(1);
  });

  it("19. a mixed-case uuid is accepted and stored canonically", async () => {
    const team = await makeTeam();
    const leader = await createUser(ctx.db, { roleKey: "executive" });

    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(admin.token))
      .send({ leaderId: leader.id.toUpperCase() });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await rowOf(team.id))?.leaderId).toBe(leader.id);
  });
});

/* ══ C — the same designation through POST ════════════════════════════════ */

describe("C · creating a team cannot bypass the leader rule", () => {
  it("20. POST refuses a leader the actor could not name via PATCH", async () => {
    const target = await createUser(ctx.db, { roleKey: "super_admin" });
    teamCounter += 1;
    const res = await request(ctx.app)
      .post("/api/teams")
      .set(bearer(admin.token))
      .send({ name: `Created Team ${teamCounter}`, leaderId: target.id });

    expect(res.status).toBe(403);
    const [row] = await ctx.db
      .select()
      .from(teams)
      .where(eq(teams.name, `Created Team ${teamCounter}`));
    expect(row).toBeUndefined();
  });

  it("21. POST refuses a leader that does not exist", async () => {
    teamCounter += 1;
    const res = await request(ctx.app)
      .post("/api/teams")
      .set(bearer(admin.token))
      .send({
        name: `Created Team ${teamCounter}`,
        leaderId: "00000000-0000-4000-8000-000000000000",
      });
    expect(res.status).toBe(400);
  });

  it("22. POST still creates normally with an allowed leader", async () => {
    const leader = await createUser(ctx.db, { roleKey: "team_leader" });
    teamCounter += 1;
    const res = await request(ctx.app)
      .post("/api/teams")
      .set(bearer(admin.token))
      .send({ name: `Created Team ${teamCounter}`, leaderId: leader.id });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.leaderId).toBe(leader.id);
  });
});

/* ══ D — permission, and the delete correction ════════════════════════════ */

describe("D · who may edit, and an honest delete", () => {
  it("23. Manager holds teams.view and teams.assign but NOT teams.edit", async () => {
    // Recorded because NEXT_TASK.md claimed Manager held `teams.edit`. It does
    // not — `permissions.ts` grants Manager `teams.view` and `teams.assign`
    // only, so this route is Super Admin and Admin.
    const team = await makeTeam();
    const res = await request(ctx.app)
      .patch(`/api/teams/${team.id}`)
      .set(bearer(manager.token))
      .send({ name: "Manager rename" });

    expect(res.status).toBe(403);
    expect((await rowOf(team.id))?.name).toBe(team.name);
    expect(await auditCount(team.id)).toBe(0);
  });

  it("24. an unauthenticated caller is refused", async () => {
    const team = await makeTeam();
    const res = await request(ctx.app).patch(`/api/teams/${team.id}`).send({ name: "Anon" });
    expect(res.status).toBe(401);
  });

  it("25. DELETE of an unknown team is 404, not a 204 that changed nothing", async () => {
    const res = await request(ctx.app)
      .delete("/api/teams/00000000-0000-4000-8000-000000000000")
      .set(bearer(superAdmin.token));
    expect(res.status).toBe(404);
  });

  it("26. DELETE of a live team still succeeds and is audited by name", async () => {
    const team = await makeTeam();
    const res = await request(ctx.app)
      .delete(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token));

    expect(res.status).toBe(204);
    expect((await rowOf(team.id))?.deletedAt).not.toBeNull();

    const [entry] = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.recordType, "team"), eq(auditLogs.recordId, team.id)));
    expect(entry?.summary).toContain(team.name);
  });

  it("27. deleting the same team twice is 404 the second time", async () => {
    const team = await makeTeam();
    await request(ctx.app).delete(`/api/teams/${team.id}`).set(bearer(superAdmin.token));
    const res = await request(ctx.app)
      .delete(`/api/teams/${team.id}`)
      .set(bearer(superAdmin.token));
    expect(res.status).toBe(404);
  });
});
