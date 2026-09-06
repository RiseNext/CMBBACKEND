import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  customerPayload,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { customers, userBankAccess } from "../db/schema/index.js";

/**
 * ASSIGNMENT VALIDATION ON CUSTOMERS — Task 4.7, DECISIONS.md D-047 / D-048
 *
 * `assignedUserId` and `assignedTeamId` are real foreign keys with no
 * application-level validation. A nonexistent UUID reached Postgres, raised
 * `23503`, and came back as the 409 "That record is still referenced by other
 * records" — an error about the wrong direction of the relationship, naming no
 * field the caller could correct.
 *
 * **These tests do not describe a confidentiality fix, because there is not one
 * to describe.** There is no assignment-driven read path for customers: no
 * `assignedUserId` list filter, no "assigned to me" endpoint, and every read
 * still passes through `bankScope`. Group E pins that property so nobody later
 * re-reads this suite as an IDOR regression guard it is not.
 *
 * The two fields are validated differently, and the asymmetry is the point:
 *
 *   - **Teams (D-047)** — existence and liveness only. `teams` has no bank
 *     column and no join table to banks, so "bank-scope membership" for a team
 *     is undefined in this data model. Inventing one would be new product
 *     policy.
 *   - **Users (D-048)** — existence, liveness and bank membership, EXCEPT that a
 *     holder of `system.access_all_banks` passes with zero `user_bank_access`
 *     rows. Zero rows means "unrestricted", never "no access" — the semantics of
 *     `loadAuthContext` and `assertBankAccess`, mirrored rather than re-decided.
 *     Group C is the regression guard for "you cannot assign a customer to an
 *     administrator", which no other test would catch.
 *
 * Group F covers the one other change this file's route received: the server
 * side `kyc` list filter (D-051 constraint 4, in support of Task 4.5).
 */

let ctx: TestContext;
let bankA: { id: string; code: string };
let bankB: { id: string; code: string };
let bankK: { id: string; code: string };
let superToken: string;

/** A bank-A executive: scoped, and legitimately assignable for bank A. */
let execA: { id: string; email: string; password: string };
/** A bank-B executive: scoped, and NOT assignable for a bank-A customer. */
let execB: { id: string; email: string; password: string };
/** Admin — unrestricted by permission, with zero user_bank_access rows. */
let adminUser: { id: string; email: string; password: string };
/** Super Admin — the same, one role level up. */
let superAssignee: { id: string; email: string; password: string };

let teamA: string;

/** Well-formed uuids that name nothing. */
const ABSENT_USER = "11111111-1111-4111-8111-111111111111";
const ABSENT_TEAM = "22222222-2222-4222-8222-222222222222";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

let ref = 0;
const nextRef = () => `ASSIGN-${(ref += 1)}`;

function createCustomer(overrides: Record<string, unknown> = {}, bankId = bankA.id) {
  return request(ctx.app)
    .post("/api/customers")
    .set(auth(superToken))
    .send(customerPayload(bankId, nextRef(), overrides));
}

async function customerByRef(reference: string) {
  const [row] = await ctx.db
    .select()
    .from(customers)
    .where(eq(customers.bankReferenceId, reference))
    .limit(1);
  return row;
}

/** The 422 field-error contract D-031 consumes, asserted by shape. */
function issuesOf(res: request.Response): { path: string; message: string }[] {
  expect(res.status, JSON.stringify(res.body)).toBe(422);
  expect(res.body.error.code).toBe("unprocessable_entity");
  const details = res.body.error.details;
  expect(Array.isArray(details), JSON.stringify(res.body)).toBe(true);
  for (const issue of details as unknown[]) {
    expect(typeof (issue as { path: unknown }).path).toBe("string");
    expect(typeof (issue as { message: unknown }).message).toBe("string");
  }
  return details as { path: string; message: string }[];
}

beforeAll(async () => {
  ctx = await createTestContext();
  bankA = await createBank(ctx.db, "Assignment Validation Bank A");
  bankB = await createBank(ctx.db, "Assignment Validation Bank B");
  bankK = await createBank(ctx.db, "Assignment Validation Bank K");

  const sa = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(sa.email, sa.password);

  execA = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });
  execB = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankB.id] });
  adminUser = await createUser(ctx.db, { roleKey: "admin" });
  superAssignee = await createUser(ctx.db, { roleKey: "super_admin" });

  const team = await request(ctx.app)
    .post("/api/teams")
    .set(auth(superToken))
    .send({ name: "Assignment Validation Team", status: "Active" });
  expect(team.status, JSON.stringify(team.body)).toBe(201);
  teamA = team.body.data.id;
}, 90_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ------------------------------------------------------------------ group A */

describe("A — a valid assignment is accepted and written", () => {
  it("1. a same-bank scoped user is accepted on POST", async () => {
    const res = await createCustomer({ assignedUserId: execA.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assignedUserId).toBe(execA.id);
  });

  it("2. an existing team is accepted on POST — no bank check exists to make", async () => {
    const res = await createCustomer({ assignedTeamId: teamA });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assignedTeamId).toBe(teamA);
  });

  it("3. both fields together are accepted, and both are persisted", async () => {
    const res = await createCustomer({ assignedUserId: execA.id, assignedTeamId: teamA });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const [row] = await ctx.db
      .select()
      .from(customers)
      .where(eq(customers.id, res.body.data.id))
      .limit(1);
    expect(row!.assignedUserId).toBe(execA.id);
    expect(row!.assignedTeamId).toBe(teamA);
  });

  it("4. a valid assignment is accepted on PATCH and written", async () => {
    const created = await createCustomer();
    expect(created.status).toBe(201);

    const res = await request(ctx.app)
      .patch(`/api/customers/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ assignedUserId: execA.id, assignedTeamId: teamA });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.assignedUserId).toBe(execA.id);
    expect(res.body.data.assignedTeamId).toBe(teamA);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — a cross-bank or absent assignee is 422, naming the field", () => {
  it("5. a scoped user from another bank is refused, and nothing is written", async () => {
    const reference = nextRef();
    const res = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankA.id, reference, { assignedUserId: execB.id }));

    const issues = issuesOf(res);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("assignedUserId");
    expect(issues[0]!.message).toMatch(/bank/i);

    // The refusal precedes the insert.
    expect(await customerByRef(reference)).toBeUndefined();
  });

  it("6. a nonexistent user is 422, NOT the misleading 409 the FK produced", async () => {
    const reference = nextRef();
    const res = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankA.id, reference, { assignedUserId: ABSENT_USER }));

    const issues = issuesOf(res);
    expect(issues[0]!.path).toBe("assignedUserId");
    // The exact regression: `23503` used to surface as this 409 message.
    expect(res.body.error.message).not.toMatch(/still referenced by other records/);
    expect(await customerByRef(reference)).toBeUndefined();
  });

  it("7. a nonexistent team is 422 on the team field", async () => {
    const reference = nextRef();
    const res = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankA.id, reference, { assignedTeamId: ABSENT_TEAM }));

    const issues = issuesOf(res);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("assignedTeamId");
    expect(await customerByRef(reference)).toBeUndefined();
  });

  it("8. both bad fields are reported together, in one response", async () => {
    const reference = nextRef();
    const res = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(
        customerPayload(bankA.id, reference, {
          assignedUserId: ABSENT_USER,
          assignedTeamId: ABSENT_TEAM,
        }),
      );

    const issues = issuesOf(res);
    expect(issues.map((i) => i.path).sort()).toEqual(["assignedTeamId", "assignedUserId"]);
    expect(await customerByRef(reference)).toBeUndefined();
  });

  it("9. a soft-deleted user is refused — liveness, not just existence", async () => {
    const doomed = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });

    // Assignable while it lives...
    const before = await createCustomer({ assignedUserId: doomed.id });
    expect(before.status, JSON.stringify(before.body)).toBe(201);

    const removed = await request(ctx.app)
      .delete(`/api/users/${doomed.id}`)
      .set(auth(superToken));
    expect(removed.status, JSON.stringify(removed.body)).toBe(204);

    // ...and not once it is in the bin.
    const after = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankA.id, nextRef(), { assignedUserId: doomed.id }));
    const issues = issuesOf(after);
    expect(issues[0]!.path).toBe("assignedUserId");
  });

  it("10. a soft-deleted team is refused too", async () => {
    const created = await request(ctx.app)
      .post("/api/teams")
      .set(auth(superToken))
      .send({ name: "Assignment Doomed Team", status: "Active" });
    expect(created.status).toBe(201);
    const doomedTeam = created.body.data.id as string;

    const before = await createCustomer({ assignedTeamId: doomedTeam });
    expect(before.status, JSON.stringify(before.body)).toBe(201);

    const removed = await request(ctx.app)
      .delete(`/api/teams/${doomedTeam}`)
      .set(auth(superToken));
    expect(removed.status).toBe(204);

    const after = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankA.id, nextRef(), { assignedTeamId: doomedTeam }));
    const issues = issuesOf(after);
    expect(issues[0]!.path).toBe("assignedTeamId");
  });

  it("11. PATCH refuses the same way, and leaves the existing assignment alone", async () => {
    const created = await createCustomer({ assignedUserId: execA.id });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const res = await request(ctx.app)
      .patch(`/api/customers/${id}`)
      .set(auth(superToken))
      .send({ name: "Should Not Apply", assignedUserId: execB.id });

    const issues = issuesOf(res);
    expect(issues[0]!.path).toBe("assignedUserId");

    // The whole request is refused — the rename does not sneak through.
    const [row] = await ctx.db.select().from(customers).where(eq(customers.id, id)).limit(1);
    expect(row!.assignedUserId).toBe(execA.id);
    expect(row!.name).toBe("Test Customer");
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — an unrestricted assignee passes (D-048)", () => {
  it("12. the Admin under test genuinely has ZERO user_bank_access rows", async () => {
    // This is the whole reason D-048 exists. If this assertion ever fails, the
    // two tests below stop proving anything.
    for (const user of [adminUser, superAssignee]) {
      const rows = await ctx.db
        .select()
        .from(userBankAccess)
        .where(eq(userBankAccess.userId, user.id));
      expect(rows).toHaveLength(0);
    }
  });

  it("13. an Admin is accepted as the assignee of a bank-A customer", async () => {
    const res = await createCustomer({ assignedUserId: adminUser.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assignedUserId).toBe(adminUser.id);
  });

  it("14. a Super Admin is accepted too", async () => {
    const res = await createCustomer({ assignedUserId: superAssignee.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assignedUserId).toBe(superAssignee.id);
  });

  it("15. an unrestricted assignee is accepted for EVERY bank, not just one", async () => {
    const res = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bankB.id, nextRef(), { assignedUserId: adminUser.id }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("16. accepted on PATCH as well as POST", async () => {
    const created = await createCustomer();
    const res = await request(ctx.app)
      .patch(`/api/customers/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ assignedUserId: adminUser.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.assignedUserId).toBe(adminUser.id);
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — omitted and null assignments are untouched", () => {
  it("17. a create with neither field is accepted, as it always was", async () => {
    const res = await createCustomer();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assignedUserId).toBeNull();
    expect(res.body.data.assignedTeamId).toBeNull();
  });

  it("18. explicit nulls are accepted on create — nothing to validate", async () => {
    const res = await createCustomer({ assignedUserId: null, assignedTeamId: null });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assignedUserId).toBeNull();
  });

  it("19. a name-only PATCH still works and demands no assignment fields", async () => {
    const created = await createCustomer({ assignedUserId: execA.id, assignedTeamId: teamA });
    const id = created.body.data.id as string;

    const res = await request(ctx.app)
      .patch(`/api/customers/${id}`)
      .set(auth(superToken))
      .send({ name: "Renamed Only" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.name).toBe("Renamed Only");
    // BUG-036's guarantee still holds: the untouched assignment survives.
    expect(res.body.data.assignedUserId).toBe(execA.id);
    expect(res.body.data.assignedTeamId).toBe(teamA);
  });

  it("20. an explicit null on PATCH clears the assignment", async () => {
    const created = await createCustomer({ assignedUserId: execA.id, assignedTeamId: teamA });
    const res = await request(ctx.app)
      .patch(`/api/customers/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ assignedUserId: null, assignedTeamId: null });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.assignedUserId).toBeNull();
    expect(res.body.data.assignedTeamId).toBeNull();
  });

  it("21. an existing customer with a stale assignment is still editable", async () => {
    // Written straight to the column so it bypasses the new validation, then
    // renamed through the route. 4.7 validates what a request SUPPLIES; it does
    // not retroactively refuse edits to rows that predate it.
    const created = await createCustomer();
    const id = created.body.data.id as string;
    await ctx.db.update(customers).set({ assignedUserId: execB.id }).where(eq(customers.id, id));

    const res = await request(ctx.app)
      .patch(`/api/customers/${id}`)
      .set(auth(superToken))
      .send({ name: "Legacy Row Renamed" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.name).toBe("Legacy Row Renamed");
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — what 4.7 is NOT: there is no assignment-driven read path", () => {
  it("22. an assignee cannot read a customer in a bank they are not scoped to", async () => {
    // Assign a bank-A customer to a bank-A executive, legitimately. The
    // executive can see it because of BANK scope, not because of assignment.
    const created = await createCustomer({ assignedUserId: execA.id });
    const id = created.body.data.id as string;

    const tokenB = await login(execB.email, execB.password);
    const denied = await request(ctx.app).get(`/api/customers/${id}`).set(auth(tokenB));
    expect(denied.status).toBe(404);

    const tokenA = await login(execA.email, execA.password);
    const allowed = await request(ctx.app).get(`/api/customers/${id}`).set(auth(tokenA));
    expect(allowed.status).toBe(200);
  });

  it("23. the list route exposes no assignedUserId filter to widen anything", async () => {
    // An unknown query key is ignored, not honoured: a caller cannot turn the
    // assignment column into a read path by asking for one.
    const res = await request(ctx.app)
      .get(`/api/customers?bankId=${bankA.id}&assignedUserId=${execB.id}&pageSize=500`)
      .set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.some((c: { assignedUserId: string | null }) => c.assignedUserId === null))
      .toBe(true);
  });
});

/* ------------------------------------------------------------------ group F */

describe("F — the server-side kyc list filter (D-051 constraint 4)", () => {
  beforeAll(async () => {
    for (const kyc of ["Verified", "Verified", "Pending", "Rejected"]) {
      const res = await request(ctx.app)
        .post("/api/customers")
        .set(auth(superToken))
        .send(customerPayload(bankK.id, nextRef(), { kyc }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  });

  const listK = (query: string) =>
    request(ctx.app).get(`/api/customers?bankId=${bankK.id}&${query}`).set(auth(superToken));

  it("24. filters to exactly the requested KYC state", async () => {
    const verified = await listK("kyc=Verified&pageSize=500");
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.meta.total).toBe(2);
    for (const row of verified.body.data) expect(row.kyc).toBe("Verified");

    const rejected = await listK("kyc=Rejected&pageSize=500");
    expect(rejected.body.meta.total).toBe(1);
    expect(rejected.body.data[0].kyc).toBe("Rejected");
  });

  it("25. omitting it returns every state, exactly as before", async () => {
    const all = await listK("pageSize=500");
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(4);
  });

  it("26. combines with status rather than replacing it", async () => {
    const both = await listK("kyc=Verified&status=Active&pageSize=500");
    expect(both.body.meta.total).toBe(2);

    const none = await listK("kyc=Verified&status=Closed&pageSize=500");
    expect(none.body.meta.total).toBe(0);
  });

  it("27. an unknown KYC value is a 422 naming the field, not a silent all-rows", async () => {
    const res = await listK("kyc=Unknown");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.details[0].path).toBe("kyc");
  });

  it("28. it never widens bank scope", async () => {
    const tokenB = await login(execB.email, execB.password);
    const res = await request(ctx.app)
      .get("/api/customers?kyc=Verified&pageSize=500")
      .set(auth(tokenB));
    expect(res.status).toBe(200);
    // Every bank-K customer is Verified or otherwise; a bank-B executive sees
    // none of them.
    const [visible] = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.bankId, bankK.id), isNull(customers.deletedAt)))
      .limit(1);
    expect(visible).toBeDefined();
    expect(res.body.data.some((c: { bankId: string }) => c.bankId === bankK.id)).toBe(false);
  });
});
