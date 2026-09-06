import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, count, eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import { auditLogs, teamMembers, userBankAccess, users } from "../db/schema/index.js";

/**
 * ASSIGNMENT FIELDS ON PATCH /api/users/:id — BUG-020 (Task 2.5)
 *
 * `userInput` declares `joinedOn`, `bankIds` and `teamId`. The PATCH handler
 * parsed all three and wrote **none** of them: a 200, no database change, and an
 * audit row listing only `updatedAt`. A caller had no way to tell.
 *
 * The three fields are not one problem, and the fix treats them differently:
 *
 *   - `joinedOn` is a plain nullable column on `users` and no other route can
 *     change it after creation, so PATCH now **persists** it.
 *   - `bankIds` and `teamId` are many-to-many relationships owned by
 *     `PUT /api/users/:id/banks` and `PUT /api/teams/:id/members`, which are
 *     already transactional and carry their own authorisation. PATCH now
 *     **refuses** them with 422 rather than duplicating that logic — and in
 *     `teamId`'s case rather than inventing a scalar relationship, because
 *     `users` has no team column at all.
 *
 * Every case asserts database state. A 200 was never the problem.
 */

let ctx: TestContext;
let bankA: { id: string; code: string };
let bankB: { id: string; code: string };
let superToken: string;
let execRoleId: string;
let teamA: string;
let teamB: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

const iso = (date: Date | null) => (date ? date.toISOString() : null);

async function userRow(id: string) {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
}

async function bankGrants(userId: string): Promise<string[]> {
  const rows = await ctx.db
    .select()
    .from(userBankAccess)
    .where(eq(userBankAccess.userId, userId));
  return rows.map((r) => r.bankId).sort();
}

async function teamsOf(userId: string): Promise<string[]> {
  const rows = await ctx.db.select().from(teamMembers).where(eq(teamMembers.userId, userId));
  return rows.map((r) => r.teamId).sort();
}

async function auditCount(recordId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.recordType, "user"), eq(auditLogs.recordId, recordId)));
  return row?.n ?? 0;
}

let seq = 0;
/** An employee created through the real route, with a bank, a team and a date. */
async function employee() {
  seq += 1;
  const email = `assign${seq}@risenext.test`;
  const res = await request(ctx.app)
    .post("/api/users")
    .set(bearer(superToken))
    .send({
      name: `Assignment Employee ${seq}`,
      email,
      employeeCode: `EMP-A1${String(seq).padStart(2, "0")}`,
      roleId: execRoleId,
      branch: "Hyderabad",
      target: 8_000_000,
      achieved: 3_250_000,
      joinedOn: "2024-04-01T00:00:00.000Z",
      bankIds: [bankA.id],
      teamId: teamA,
    });
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, email };
}

beforeAll(async () => {
  ctx = await createTestContext();
  bankA = await createBank(ctx.db, "Assignment Bank A");
  bankB = await createBank(ctx.db, "Assignment Bank B");
  const sa = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (await login(sa.email, sa.password)).body.accessToken;
  execRoleId = (await roleByKey(ctx.db, "executive")).id;

  const a = await request(ctx.app)
    .post("/api/teams")
    .set(bearer(superToken))
    .send({ name: "Assignment Team A", status: "Active" });
  const b = await request(ctx.app)
    .post("/api/teams")
    .set(bearer(superToken))
    .send({ name: "Assignment Team B", status: "Active" });
  teamA = a.body.data.id;
  teamB = b.body.data.id;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ------------------------------------------------------------------ group A */

describe("A — joinedOn is now persisted by PATCH", () => {
  it("1. an explicit joinedOn is written", async () => {
    const e = await employee();
    expect(iso((await userRow(e.id)).joinedOn)).toBe("2024-04-01T00:00:00.000Z");

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ joinedOn: "2026-01-15T00:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(iso((await userRow(e.id)).joinedOn)).toBe("2026-01-15T00:00:00.000Z");
  });

  it("2. a PATCH without joinedOn leaves it untouched", async () => {
    const e = await employee();
    const before = await userRow(e.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "Renamed Only" });

    expect(res.status).toBe(200);
    const after = await userRow(e.id);
    expect(after.name).toBe("Renamed Only");
    expect(iso(after.joinedOn)).toBe(iso(before.joinedOn));
  });

  it("2b. an explicit null clears it — the schema is nullable", async () => {
    const e = await employee();
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ joinedOn: null });

    expect(res.status).toBe(200);
    expect((await userRow(e.id)).joinedOn).toBeNull();
  });

  it("2c. writing joinedOn disturbs no other column", async () => {
    const e = await employee();
    const before = await userRow(e.id);

    await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ joinedOn: "2025-07-01T00:00:00.000Z" });

    const after = await userRow(e.id);
    for (const key of [
      "name", "email", "phone", "employeeCode", "roleId", "branch",
      "status", "target", "achieved", "avatarColor", "passwordHash", "mustChangePassword",
    ] as const) {
      expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
    }
    // ...and the relationships it does not own are untouched too.
    expect(await bankGrants(e.id)).toEqual([bankA.id]);
    expect(await teamsOf(e.id)).toEqual([teamA]);
  });

  it("2d. a malformed joinedOn is a 422, and nothing is written", async () => {
    const e = await employee();
    const before = await userRow(e.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ joinedOn: "not-a-date" });

    expect(res.status).toBe(422);
    expect(iso((await userRow(e.id)).joinedOn)).toBe(iso(before.joinedOn));
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — bankIds is refused by PATCH, not silently dropped", () => {
  it("3/4/7. returns 422 naming the field, and writes nothing", async () => {
    const e = await employee();
    const grantsBefore = await bankGrants(e.id);
    const audits = await auditCount(e.id);
    expect(grantsBefore).toEqual([bankA.id]);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ bankIds: [bankB.id] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");

    // 7. the offending field is identified, and the message points at the route
    // that does own it.
    const detail = (res.body.error.details as { path: string; message: string }[]).find(
      (d) => d.path === "bankIds",
    );
    expect(detail).toBeDefined();
    expect(detail!.message).toMatch(/PUT \/api\/users\/:id\/banks/);

    // 4. no grant changed, and the refusal happened before any write.
    expect(await bankGrants(e.id)).toEqual(grantsBefore);
    expect(await auditCount(e.id)).toBe(audits);
  });

  it("an empty bankIds array is refused too — it is still an attempt to write", async () => {
    const e = await employee();
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ bankIds: [] });

    expect(res.status).toBe(422);
    expect(await bankGrants(e.id)).toEqual([bankA.id]);
  });

  it("bankIds alongside a legitimate field refuses the WHOLE request", async () => {
    const e = await employee();
    const before = await userRow(e.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "Should Not Apply", bankIds: [bankB.id] });

    expect(res.status).toBe(422);
    expect((await userRow(e.id)).name).toBe(before.name);
    expect(await bankGrants(e.id)).toEqual([bankA.id]);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — teamId is refused by PATCH", () => {
  it("5/6/7. returns 422 naming the field, and writes nothing", async () => {
    const e = await employee();
    const teamsBefore = await teamsOf(e.id);
    const audits = await auditCount(e.id);
    expect(teamsBefore).toEqual([teamA]);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ teamId: teamB });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");

    const detail = (res.body.error.details as { path: string; message: string }[]).find(
      (d) => d.path === "teamId",
    );
    expect(detail).toBeDefined();
    expect(detail!.message).toMatch(/PUT \/api\/teams\/:id\/members/);

    expect(await teamsOf(e.id)).toEqual(teamsBefore);
    expect(await auditCount(e.id)).toBe(audits);
  });

  it("teamId: null is refused too — there is no scalar team to clear", async () => {
    const e = await employee();
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ teamId: null });

    expect(res.status).toBe(422);
    expect(await teamsOf(e.id)).toEqual([teamA]);
  });

  it("both refused fields are reported together", async () => {
    const e = await employee();
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ bankIds: [bankB.id], teamId: teamB });

    expect(res.status).toBe(422);
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(["bankIds", "teamId"]);

    expect(await bankGrants(e.id)).toEqual([bankA.id]);
    expect(await teamsOf(e.id)).toEqual([teamA]);
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — nothing else about PATCH changed", () => {
  it("11. an ordinary PATCH is entirely unaffected", async () => {
    const e = await employee();
    const before = await userRow(e.id);

    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "Perfectly Ordinary", phone: "9000000000" });

    expect(res.status).toBe(200);
    const after = await userRow(e.id);
    expect(after.name).toBe("Perfectly Ordinary");
    expect(after.phone).toBe("9000000000");
    // BUG-036's guarantee still holds.
    expect(after.target).toBe(before.target);
    expect(after.achieved).toBe(before.achieved);
    expect(after.status).toBe(before.status);
    expect(iso(after.joinedOn)).toBe(iso(before.joinedOn));
  });

  it("an unrecognised key is still ignored, not rejected", async () => {
    // The guard is field-specific on purpose: it must not become a blanket
    // `.strict()` that changes the route's behaviour for every unknown key.
    const e = await employee();
    const res = await request(ctx.app)
      .patch(`/api/users/${e.id}`)
      .set(bearer(superToken))
      .send({ name: "Still Fine", somethingUnknown: 42 });

    expect(res.status).toBe(200);
    expect((await userRow(e.id)).name).toBe("Still Fine");
  });

  it("the Task 2.1 guards still refuse what they always did", async () => {
    const sa = await createUser(ctx.db, { roleKey: "super_admin" });
    const token = (await login(sa.email, sa.password)).body.accessToken as string;

    const selfOff = await request(ctx.app)
      .patch(`/api/users/${sa.id}`)
      .set(bearer(token))
      .send({ status: "Inactive" });
    expect(selfOff.status).toBe(400);
    expect((await userRow(sa.id)).status).toBe("Active");
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — the routes that DO own these fields are unchanged", () => {
  it("8. POST /users still accepts and applies all three", async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .set(bearer(superToken))
      .send({
        name: "Created With Everything",
        email: "everything@risenext.test",
        employeeCode: "EMP-A900",
        roleId: execRoleId,
        joinedOn: "2023-11-20T00:00:00.000Z",
        bankIds: [bankA.id, bankB.id],
        teamId: teamB,
      });

    expect(res.status).toBe(201);
    const id = res.body.data.id as string;

    expect(iso((await userRow(id)).joinedOn)).toBe("2023-11-20T00:00:00.000Z");
    expect(await bankGrants(id)).toEqual([bankA.id, bankB.id].sort());
    expect(await teamsOf(id)).toEqual([teamB]);
  });

  it("9. PUT /users/:id/banks still replaces bank access transactionally", async () => {
    const e = await employee();
    expect(await bankGrants(e.id)).toEqual([bankA.id]);

    const set = await request(ctx.app)
      .put(`/api/users/${e.id}/banks`)
      .set(bearer(superToken))
      .send({ bankIds: [bankB.id] });
    expect(set.status).toBe(200);
    expect(await bankGrants(e.id)).toEqual([bankB.id]);

    const cleared = await request(ctx.app)
      .put(`/api/users/${e.id}/banks`)
      .set(bearer(superToken))
      .send({ bankIds: [] });
    expect(cleared.status).toBe(200);
    expect(await bankGrants(e.id)).toEqual([]);

    // ...and it still refuses a bank that does not exist, writing nothing.
    const bogus = await request(ctx.app)
      .put(`/api/users/${e.id}/banks`)
      .set(bearer(superToken))
      .send({ bankIds: ["11111111-1111-4111-8111-111111111111"] });
    expect(bogus.status).toBe(400);
    expect(await bankGrants(e.id)).toEqual([]);
  });

  it("10. PUT /teams/:id/members still replaces a team's roster", async () => {
    const one = await employee();
    const two = await employee();

    const res = await request(ctx.app)
      .put(`/api/teams/${teamB}/members`)
      .set(bearer(superToken))
      .send({ userIds: [one.id, two.id] });
    expect(res.status).toBe(200);

    expect(await teamsOf(one.id)).toEqual([teamA, teamB].sort());
    expect(await teamsOf(two.id)).toEqual([teamA, teamB].sort());

    // Replacing the roster with one member removes the other from THAT team
    // only — the behaviour Task 2.5 deliberately did not change.
    const shrink = await request(ctx.app)
      .put(`/api/teams/${teamB}/members`)
      .set(bearer(superToken))
      .send({ userIds: [one.id] });
    expect(shrink.status).toBe(200);
    expect(await teamsOf(one.id)).toEqual([teamA, teamB].sort());
    expect(await teamsOf(two.id)).toEqual([teamA]);
  });
});
