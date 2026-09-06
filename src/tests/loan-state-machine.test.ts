import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  customerPayload,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { auditLogs, disbursements, loans, verifications } from "../db/schema/index.js";

/**
 * THE LOAN STATE MACHINE — Tasks 5.2, 5.3 and 5.7
 * DECISIONS.md D-010, D-031, D-056, D-057, D-060 · BUSINESS_FLOW.md §3.3
 *
 * Three defects, one machine:
 *
 *   1. **The approve route wrote any string** (5.3). `z.string().min(1)`, not the
 *      entity's enum, so `{"status":"banana"}` was a 200 that persisted
 *      `banana`. D-010 opens with the sharper version — `'Credited '` with a
 *      trailing space produces a record reconciliation queries cannot see while
 *      the UI shows it approved. Group A.
 *   2. **No from→to rule existed on any path** (5.2). The approve handler read
 *      the current row solely for a 404 and an audit diff; the previous status
 *      was never compared to the requested one, and `POST /loans
 *      {"status":"Disbursed"}` was a 201. Groups B, C, D and F.
 *   3. **No cross-stage side effect, and no transaction to put one in** (5.7).
 *      Recording a disbursement left the loan where it was forever, so
 *      `dashboard/stats.disbursed_value` was a permanent zero regardless of how
 *      much money the disbursements table said had moved. Group G.
 *
 * ⚠️ **Group E is the security group.** D-056: Team Leader holds `requests.edit`
 * but not `requests.approve`, and `PATCH` spread the parsed body wholesale while
 * `patchSchema` kept the enum — so a Team Leader could approve a loan through
 * PATCH, leaving `approved_by` NULL and auditing it as "updated". Guarding the
 * transition would NOT have closed it, because Draft→Submitted→Under
 * Review→Approved are all legal edges. Only refusal closes it, and Group D
 * closes the same hole on CREATE, which no decision had noticed.
 *
 * ⚠️ **Group A's last case pins behaviour that is deliberately NOT fixed here.**
 * `allowedStatuses` is opt-in, so settlements still accept any string on
 * approve. That is roadmap 7.3's and 13.13's to close; widening it from the
 * factory would annex two phases under cover of a 5.3 change.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let customerId: string;
let superToken: string;
let managerToken: string;
let teamLeaderToken: string;
let managerId: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

let utrCounter = 0;
const nextUtr = () => `SMUTR${String((utrCounter += 1)).padStart(5, "0")}`;

/** POST /api/loans. `status` omitted means the schema default, `Draft`. */
async function createLoan(
  overrides: Record<string, unknown> = {},
  token = superToken,
): Promise<request.Response> {
  return request(ctx.app)
    .post("/api/loans")
    .set(auth(token))
    .send({
      customerId,
      bankId: bank.id,
      loanType: "Personal Loan",
      amountRequested: 100000,
      ...overrides,
    });
}

/** POST /api/loans/:id/approve — the only client-facing writer of loan status. */
async function approve(
  loanId: string,
  body: Record<string, unknown>,
  token = superToken,
): Promise<request.Response> {
  return request(ctx.app).post(`/api/loans/${loanId}/approve`).set(auth(token)).send(body);
}

/**
 * Every status is reached by walking the real machine from `Draft`, never by
 * seeding the column directly. A fixture that wrote the status straight into the
 * table would still pass if the machine were deleted.
 */
const WALK: Record<string, readonly string[]> = {
  Draft: [],
  Submitted: ["Submitted"],
  "Under Review": ["Submitted", "Under Review"],
  Approved: ["Submitted", "Under Review", "Approved"],
  Disbursed: ["Submitted", "Under Review", "Approved", "Disbursed"],
  Rejected: ["Submitted", "Rejected"],
  Closed: ["Closed"],
};

async function loanAt(status: string): Promise<string> {
  const created = await createLoan();
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id as string;
  for (const step of WALK[status] ?? []) {
    /*
     * `amountApproved` rides along only on `->Approved` — audit U-5. The
     * approve route requires it for that transition and for no other, so
     * sending it unconditionally would not exercise the same path a rejection
     * or a closure takes.
     */
    const res = await approve(id, {
      status: step,
      ...(step === "Approved" ? { amountApproved: 50000 } : {}),
    });
    expect(res.status, `walking to ${step}: ${JSON.stringify(res.body)}`).toBe(200);
  }
  const [row] = await ctx.db.select().from(loans).where(eq(loans.id, id));
  expect(row!.status, `fixture should be ${status}`).toBe(status);
  return id;
}

async function statusOf(loanId: string): Promise<string> {
  const [row] = await ctx.db.select().from(loans).where(eq(loans.id, loanId));
  return row!.status;
}

/**
 * The driver error's SQLSTATE. Drizzle wraps it in a DrizzleQueryError, so the
 * code lives on `.cause`, sometimes nested — the same walk
 * `middleware/error-handler.ts:28-34` performs.
 */
function pgCode(error: unknown, depth = 0): string | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
  return pgCode((error as { cause?: unknown }).cause, depth + 1);
}

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "State Machine Bank");

  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(superAdmin.email, superAdmin.password);

  // Manager holds the whole `requests` group, so it holds `requests.approve`.
  const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bank.id] });
  managerId = manager.id;
  managerToken = await login(manager.email, manager.password);

  // Team Leader holds `requests.edit` and NOT `requests.approve` — the exact
  // pairing that made PATCH a privilege bypass (D-056, lib/permissions.ts:276-279).
  const teamLeader = await createUser(ctx.db, { roleKey: "team_leader", bankIds: [bank.id] });
  teamLeaderToken = await login(teamLeader.email, teamLeader.password);

  const customer = await request(ctx.app)
    .post("/api/customers")
    .set(auth(superToken))
    .send(customerPayload(bank.id, "SM-CUST-1"));
  expect(customer.status, JSON.stringify(customer.body)).toBe(201);
  customerId = customer.body.data.id as string;
}, 90_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* --------------------------------------------------------------- group A: 5.3 */

describe("A — the approve route has a vocabulary", () => {
  it("1. THE HEADLINE — a status outside the vocabulary is 422, not a 200 that persists it", async () => {
    const id = await loanAt("Submitted");

    const res = await approve(id, { status: "banana" });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(await statusOf(id)).toBe("Submitted");
  });

  it("2. D-010's actual example — a trailing space is a different string and is refused", async () => {
    const id = await loanAt("Under Review");
    const res = await approve(id, { status: "Approved " });
    expect(res.status).toBe(422);
    // A VOCABULARY refusal specifically. `Under Review → Approved` is a legal
    // edge, so if the enum were removed the transition guard would let the
    // padded string through as though it were the real status.
    expect(res.body.error.code).toBe("validation_failed");
    expect(await statusOf(id)).toBe("Under Review");
  });

  it("3. the refusal names the field, so D-031 field mapping can place it", async () => {
    const id = await loanAt("Submitted");
    const res = await approve(id, { status: "banana" });

    // `{ path, message }[]` with a dot-joined path — the ZodError shape
    // `lib/field-errors.ts` discriminates on. An object here (the 409 shape)
    // would make the frontend's mapper throw inside a catch.
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details[0].path).toBe("status");
    expect(typeof res.body.error.details[0].message).toBe("string");
  });

  it("4. an empty or missing status is still refused, as it always was", async () => {
    const id = await loanAt("Submitted");
    expect((await approve(id, { status: "" })).status).toBe(422);
    expect((await approve(id, {})).status).toBe(422);
    expect(await statusOf(id)).toBe("Submitted");
  });

  it("5. `notes` still rides along and is still written", async () => {
    const id = await loanAt("Under Review");
    const res = await approve(id, { status: "Approved", amountApproved: 50000, notes: "Sanctioned by committee" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.notes).toBe("Sanctioned by committee");
  });

  it("6. OPT-IN — settlements have since opted in too, and the mechanism is unchanged", async () => {
    /*
     * UPDATED 2026-09-06, Tasks 8.2 / 8.3 (D-066).
     *
     * This case asserted a **200** persisting `banana`, pinning that
     * `allowedStatuses` is opt-in and that Phase 5 had not annexed decisions
     * belonging to later phases. Its own comment named the owners; 8.2/8.3 are
     * the settlement half and have now landed, so the same request is a 422.
     *
     * The property being protected has not changed — each resource opts in for
     * itself, and the factory still refuses to widen anything on its own. What
     * changed is how many resources have chosen to. `verifications.status`
     * remains the one that has chosen nothing, and it is why **SEC-016 is still
     * OPEN** after Phases 6–8; 13.13 owns it.
     */
    const settlement = await request(ctx.app)
      .post("/api/settlements")
      .set(auth(superToken))
      .send({ bankId: bank.id, period: "SM 2026", grossCommission: 100, tds: 10, netPayable: 90 });
    expect(settlement.status, JSON.stringify(settlement.body)).toBe(201);

    const res = await request(ctx.app)
      .post(`/api/settlements/${settlement.body.data.id}/approve`)
      .set(auth(superToken))
      .send({ status: "banana" });
    expect(res.status, JSON.stringify(res.body)).toBe(422);

    /*
     * UPDATED AGAIN 2026-09-06, Task 13.13 — and this is the last time.
     *
     * This block asserted a **200 persisting `banana`**, because `verifications`
     * was the one resource that opted into nothing. The comment above named
     * 13.13 as its owner and said SEC-016 would stay open until then. 13.13 has
     * now landed: the router configures `allowedStatuses: verificationStatuses`
     * and migration `0014` adds `verifications_status_check` behind it.
     *
     * **So there is no longer any resource whose approve route accepts free
     * text, and SEC-016 closes with this change.**
     *
     * The property this case exists to protect is unchanged and is still
     * asserted below: `allowedStatuses` is **opt-in**, the factory widens
     * nothing on its own, and a resource gets a vocabulary only by choosing
     * one. What changed is that every resource has now chosen.
     */
    const verification = await request(ctx.app)
      .post(`/api/verifications`)
      .set(auth(superToken))
      .send({ loanId: await loanAt("Submitted"), bankId: bank.id, required: false });
    if (verification.status === 201) {
      const loose = await request(ctx.app)
        .post(`/api/verifications/${verification.body.data.id}/approve`)
        .set(auth(superToken))
        .send({ status: "banana" });
      expect(loose.status, JSON.stringify(loose.body)).toBe(422);

      // Refused by the SERVICE layer, not by the database. The distinction
      // matters: a CHECK violation would also be a 422 now (error-handler's
      // 23514 branch), but it carries a generic message. Naming the field is
      // what makes the refusal actionable.
      expect(JSON.stringify(loose.body)).toMatch(/status/i);

      // And a legal value still works, so the vocabulary is a filter and not a
      // wall.
      const ok = await request(ctx.app)
        .post(`/api/verifications/${verification.body.data.id}/approve`)
        .set(auth(superToken))
        .send({ status: "Verified" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.status).toBe("Verified");
    }
  });
});

/* --------------------------------------------------------------- group B: 5.2 */

describe("B — every legal transition of the ratified machine", () => {
  /*
   * All ten edges of BUSINESS_FLOW.md §3.3, each walked for real. If an edge is
   * removed from `loanTransitions`, exactly one of these fails and names it.
   */
  const EDGES: readonly (readonly [string, string])[] = [
    ["Draft", "Submitted"],
    ["Draft", "Closed"],
    ["Submitted", "Under Review"],
    ["Submitted", "Rejected"],
    ["Under Review", "Submitted"],
    ["Under Review", "Approved"],
    ["Under Review", "Rejected"],
    ["Approved", "Disbursed"],
    ["Approved", "Closed"],
    ["Disbursed", "Closed"],
  ];

  for (const [from, to] of EDGES) {
    it(`7. ${from} → ${to} is allowed and persists`, async () => {
      const id = await loanAt(from);
      // Required on ->Approved and on no other edge — audit U-5.
      const res = await approve(id, {
        status: to,
        ...(to === "Approved" ? { amountApproved: 50000 } : {}),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe(to);
      expect(await statusOf(id)).toBe(to);
    });
  }

  it("8. the approver is stamped — D-060 clause 1, already shipped and not reimplemented", async () => {
    const id = await loanAt("Under Review");
    const res = await approve(id, { status: "Approved", amountApproved: 50000 }, managerToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const [row] = await ctx.db.select().from(loans).where(eq(loans.id, id));
    expect(row!.approvedBy).toBe(managerId);
    expect(row!.approvedAt).not.toBeNull();
  });

  it("9. the transition is audited as `approved`, with a from/to diff", async () => {
    // Created directly at `Submitted` — a legal initial status — rather than
    // walked there, so the single audit row below is the transition under test
    // and not the walk's own.
    const created = await createLoan({ status: "Submitted" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;

    expect((await approve(id, { status: "Under Review" })).status).toBe(200);

    const rows = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.recordId, id), eq(auditLogs.action, "approved")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordType).toBe("loan");
    const changes = rows[0]!.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.status).toEqual({ from: "Submitted", to: "Under Review" });
  });
});

/* --------------------------------------------------------------- group C: 5.2 */

describe("C — an illegal transition is refused", () => {
  const ILLEGAL: readonly (readonly [string, string, string])[] = [
    ["Draft", "Approved", "skips assessment entirely"],
    ["Draft", "Disbursed", "the roadmap's named example"],
    ["Draft", "Under Review", "skips submission"],
    ["Submitted", "Approved", "skips Under Review"],
    ["Submitted", "Disbursed", "money before a decision"],
    ["Under Review", "Disbursed", "money before approval"],
    ["Approved", "Under Review", "backwards"],
    ["Approved", "Submitted", "backwards"],
    ["Disbursed", "Approved", "backwards, after money moved"],
  ];

  for (const [from, to, why] of ILLEGAL) {
    it(`10. ${from} → ${to} is 422 (${why})`, async () => {
      const id = await loanAt(from);
      const res = await approve(id, { status: to });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe("unprocessable_entity");
      expect(res.body.error.details[0].path).toBe("status");
      expect(res.body.error.details[0].message).toContain(from);
      // The refusal must leave the row exactly as it was.
      expect(await statusOf(id)).toBe(from);
    });
  }

  it("11. a terminal status cannot be left, and says so", async () => {
    for (const terminal of ["Rejected", "Closed"]) {
      const id = await loanAt(terminal);
      for (const target of ["Draft", "Submitted", "Under Review", "Approved", "Disbursed"]) {
        const res = await approve(id, { status: target });
        expect(res.status, `${terminal} → ${target}: ${JSON.stringify(res.body)}`).toBe(422);
        expect(res.body.error.details[0].message).toMatch(/final status/i);
      }
      expect(await statusOf(id)).toBe(terminal);
    }
  });

  it("12. there are no self-loops — re-approving an Approved loan is refused", async () => {
    /*
     * Not pedantry. A silent self-transition would re-stamp `approved_by` and
     * `approved_at` on every click, quietly rewriting who approved a loan and
     * when — on a record whose whole purpose is to say exactly that.
     */
    const id = await loanAt("Approved");
    const [before] = await ctx.db.select().from(loans).where(eq(loans.id, id));

    const res = await approve(id, { status: "Approved", amountApproved: 50000 });
    expect(res.status, JSON.stringify(res.body)).toBe(422);

    const [after] = await ctx.db.select().from(loans).where(eq(loans.id, id));
    expect(after!.approvedAt).toEqual(before!.approvedAt);
  });

  it("13. a refused transition writes no audit row", async () => {
    const id = await loanAt("Draft");
    expect((await approve(id, { status: "Disbursed" })).status).toBe(422);

    const rows = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.recordId, id), eq(auditLogs.action, "approved")));
    expect(rows).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- group D: 5.2 */

describe("D — a loan may only be CREATED in a starting state", () => {
  it("14. omitting the status still yields Draft, exactly as before", async () => {
    const res = await createLoan();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("Draft");
  });

  for (const status of ["Draft", "Submitted"]) {
    it(`15. ${status} is a legal initial status`, async () => {
      const res = await createLoan({ status });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.status).toBe(status);
    });
  }

  for (const status of ["Under Review", "Approved", "Disbursed", "Rejected", "Closed"]) {
    it(`16. ${status} is refused on create with 422`, async () => {
      const res = await createLoan({ status });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe("unprocessable_entity");
      expect(res.body.error.details[0].path).toBe("status");
    });
  }

  it("17. THE SECURITY CASE — a Team Leader cannot create a pre-approved loan", async () => {
    /*
     * `requests.create` is held by Team Leader and Executive; `requests.approve`
     * is held by neither (lib/permissions.ts:277, :304). Accepting `Approved` on
     * create is therefore the identical privilege bypass D-056 closed on PATCH,
     * one route over — and it produces a WORSE record than the PATCH route did:
     * `approved_by` NULL, and an audit row that says "created".
     *
     * No decision had noticed this. It is recorded in BUSINESS_FLOW.md §3.3 and
     * as partial remediation under SEC-016, which stays OPEN.
     */
    const res = await createLoan({ status: "Approved", amountApproved: 50000 }, teamLeaderToken);
    expect(res.status, JSON.stringify(res.body)).toBe(422);

    const rows = await ctx.db.select().from(loans).where(eq(loans.status, "Approved"));
    for (const row of rows) {
      // Nothing reached the table with a NULL approver via this route.
      expect(row.approvedBy, `loan ${row.code} was approved by nobody`).not.toBeNull();
    }
  });

  it("18. a garbage status on create is still refused by the enum, as it always was", async () => {
    const res = await createLoan({ status: "banana" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
  });
});

/* ------------------------------------------------------ group E: D-056 / SEC */

describe("E — PATCH refuses status and amountApproved", () => {
  it("19. THE HEADLINE — a Team Leader can no longer approve a loan through PATCH", async () => {
    const id = await loanAt("Submitted");

    const patched = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(auth(teamLeaderToken))
      .send({ status: "Approved", amountApproved: 50000 });
    expect(patched.status, JSON.stringify(patched.body)).toBe(422);

    // And the route that DOES own the status still refuses them outright.
    const approved = await approve(id, { status: "Under Review" }, teamLeaderToken);
    expect(approved.status).toBe(403);

    expect(await statusOf(id)).toBe("Submitted");
  });

  it("20. `status` on PATCH is 422 and names the field", async () => {
    const id = await loanAt("Submitted");
    const res = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(auth(superToken))
      .send({ status: "Under Review" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details[0].path).toBe("status");
    expect(res.body.error.details[0].message).toMatch(/approve/i);
    expect(await statusOf(id)).toBe("Submitted");
  });

  it("21. `amountApproved` on PATCH is 422 and names the field", async () => {
    const id = await loanAt("Submitted");
    const res = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(auth(superToken))
      .send({ amountApproved: 999999 });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details[0].path).toBe("amountApproved");

    const [row] = await ctx.db.select().from(loans).where(eq(loans.id, id));
    expect(Number(row!.amountApproved)).toBe(0);
  });

  it("22. even a legal transition is refused on PATCH — the route is wrong, not the value", async () => {
    const id = await loanAt("Draft");
    const res = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(auth(superToken))
      .send({ status: "Submitted" });
    expect(res.status).toBe(422);
    expect(await statusOf(id)).toBe("Draft");
  });

  it("23. the other seven editable fields still PATCH cleanly (Task 5.5's set)", async () => {
    const id = await loanAt("Submitted");
    const res = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(auth(superToken))
      .send({
        loanType: "Gold Loan",
        amountRequested: 250000,
        interestRate: 11.5,
        tenureMonths: 36,
        priority: "Urgent",
        notes: "Revised on customer request",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const [row] = await ctx.db.select().from(loans).where(eq(loans.id, id));
    expect(row!.loanType).toBe("Gold Loan");
    expect(Number(row!.amountRequested)).toBe(250000);
    expect(row!.priority).toBe("Urgent");
    // Untouched by the edit, because PATCH cannot reach it.
    expect(row!.status).toBe("Submitted");
  });

  it("24. PER-RESOURCE — 7.3 has now taken the same refusal for disbursements", async () => {
    /*
     * UPDATED 2026-09-05, Task 7.3 (D-066).
     *
     * This case previously asserted a **200**, pinning that `patchRefusals` is
     * per-resource and that Phase 5 had not annexed a decision belonging to
     * roadmap 7.3. That was correct then and the mechanism is unchanged — what
     * changed is that 7.3 has now made its own decision, and made the same one.
     *
     * The case is retargeted rather than deleted, because the property worth
     * pinning is the same: each resource opts in for itself. Bank orders still
     * do not refuse `stage` on PATCH — 6.1 enforces a transition map there
     * instead, since bank orders have no approve route to move the write to.
     */
    const loanId = await loanAt("Approved");
    const created = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(superToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 1000, utr: nextUtr() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const res = await request(ctx.app)
      .patch(`/api/disbursements/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Credited" });

    // D-066: the approve route is the only writer of an authoritative status.
    // Manager holds `disbursements.edit` and not `.approve`, so a 200 here was
    // an approval performed by a role that may not approve.
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("status");

    // ...and the row did not move.
    const [row] = await ctx.db
      .select()
      .from(disbursements)
      .where(eq(disbursements.id, created.body.data.id as string));
    expect(row!.status).toBe("In Transit");
  });
});

/* --------------------------------------------- group F: the database constraint */

describe("F — the DB enforces the vocabulary, with no application code involved", () => {
  it("25. THE HEADLINE — a direct UPDATE to a bogus status is rejected with 23514", async () => {
    /*
     * Deliberately bypasses Express, the router, zod and the factory entirely.
     * `UPDATE loans SET status = 'banana'` used to succeed: the repository had
     * zero CHECK constraints on any status column (D-010). This is the DB half
     * of the roadmap's "impossible at both the API and DB layers".
     */
    const id = await loanAt("Submitted");

    let code: string | undefined;
    try {
      await ctx.db.update(loans).set({ status: "banana" }).where(eq(loans.id, id));
      throw new Error("the CHECK constraint did not fire");
    } catch (error) {
      code = pgCode(error);
      expect(JSON.stringify(error)).toContain("loans_status_check");
    }
    expect(code).toBe("23514");
    expect(await statusOf(id)).toBe("Submitted");
  });

  it("26. an INSERT with a bogus status is rejected too, not just an UPDATE", async () => {
    let code: string | undefined;
    try {
      await ctx.db
        .insert(loans)
        .values({ code: "LN-CHECK-1", customerId, bankId: bank.id, loanType: "X", status: "  " });
      throw new Error("the CHECK constraint did not fire");
    } catch (error) {
      code = pgCode(error);
    }
    expect(code).toBe("23514");
  });

  it("27. all seven real statuses are accepted — the constraint is not too narrow", async () => {
    const id = await loanAt("Draft");
    for (const status of [
      "Draft",
      "Submitted",
      "Under Review",
      "Approved",
      "Disbursed",
      "Rejected",
      "Closed",
    ]) {
      await ctx.db.update(loans).set({ status }).where(eq(loans.id, id));
      expect(await statusOf(id)).toBe(status);
    }
  });

  it("28. VOCABULARY ONLY — the DB permits an illegal TRANSITION that the API refuses", async () => {
    /*
     * The precise boundary D-057 draws, pinned so nobody later "improves" the
     * CHECK into a trigger. A constraint sees one candidate row and cannot know
     * what the row used to be, so `Draft → Disbursed` is fine by Postgres and
     * refused by `scoped-resource.ts`. Enforcement lives in exactly one place.
     */
    const id = await loanAt("Draft");
    await ctx.db.update(loans).set({ status: "Disbursed" }).where(eq(loans.id, id));
    expect(await statusOf(id)).toBe("Disbursed");

    const viaApi = await approve(await loanAt("Draft"), { status: "Disbursed" });
    expect(viaApi.status).toBe(422);
  });

  it("29. SCOPE — migration 0007 constrained `loans.status` and nothing else", async () => {
    /*
     * UPDATED 2026-09-05, Task 7.3 (migration 0009).
     *
     * This case previously ended by writing `banana` into `disbursements.status`
     * and asserting it stuck — pinning, deliberately, that 0007 had not grown
     * past its remit. Its own comment named the owner: "7.3 owns disbursements".
     *
     * 7.3 has now landed, so `disbursements_status_check` exists and that write
     * is refused with 23514. The assertion is retargeted rather than deleted:
     * what it still proves is that 0007's scope was `loans.status` alone, and
     * that the columns 13.13 owns are still unconstrained — which is why
     * SEC-016 remains OPEN after Phases 6–8.
     */
    const loanId = await loanAt("Approved");
    const created = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(superToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 500, utr: nextUtr() });
    expect(created.status).toBe(201);

    // 7.3's constraint now refuses the write that used to succeed here. Drizzle
    // wraps the driver error, so the assertion is on the rejection and on the
    // row's survival rather than on the wrapper's shape.
    await expect(
      ctx.db
        .update(disbursements)
        .set({ status: "banana" })
        .where(eq(disbursements.id, created.body.data.id as string)),
    ).rejects.toThrow(/disbursements_status_check|violates check constraint|Failed query/);

    // ...and the row is untouched by the refused write.
    const [row] = await ctx.db
      .select()
      .from(disbursements)
      .where(eq(disbursements.id, created.body.data.id as string));
    expect(row!.status).toBe("In Transit");

    /*
     * STILL UNCONSTRAINED, and that is the point of this case now.
     * `verifications.status` is named by no row in any phase; documents,
     * settlements and transactions are enum-guarded in the service layer but
     * carry no CHECK. All four belong to the 13.13 sweep. If this half starts
     * failing, the sweep has been done early and SEC-016 can be re-examined.
     */
    const [verification] = await ctx.db
      .select()
      .from(verifications)
      .where(eq(verifications.loanId, loanId))
      .limit(1);
    if (verification) {
      await ctx.db
        .update(verifications)
        .set({ status: "banana" })
        .where(eq(verifications.id, verification.id));
      const [after] = await ctx.db
        .select()
        .from(verifications)
        .where(eq(verifications.id, verification.id));
      expect(after!.status).toBe("banana");
    }
  });
});

/* --------------------------------------------------------------- group G: 5.7 */

describe("G — a disbursement advances the loan, atomically", () => {
  it("30. THE HEADLINE — creating a disbursement moves the loan to Disbursed", async () => {
    const loanId = await loanAt("Approved");

    const res = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(managerToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 100000, utr: nextUtr() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect(await statusOf(loanId)).toBe("Disbursed");
  });

  it("31. both writes are audited, and the loan's audit carries the real diff", async () => {
    const loanId = await loanAt("Approved");
    const res = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(managerToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 250000, utr: nextUtr() });
    expect(res.status).toBe(201);

    const created = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.recordId, res.body.data.id as string));
    expect(created.map((r) => r.action)).toContain("created");

    const advanced = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.recordId, loanId), eq(auditLogs.action, "disbursed")));
    expect(advanced).toHaveLength(1);
    expect(advanced[0]!.recordType).toBe("loan");
    expect(advanced[0]!.actorId).toBe(managerId);
    expect(advanced[0]!.bankId).toBe(bank.id);

    const changes = advanced[0]!.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.status).toEqual({ from: "Approved", to: "Disbursed" });

    const metadata = advanced[0]!.metadata as Record<string, unknown>;
    expect(metadata.disbursementId).toBe(res.body.data.id);
  });

  it("32. ROLLBACK — a refused advance leaves NEITHER the disbursement nor a loan change", async () => {
    /*
     * The rollback that proves the boundary exists. The disbursement row is
     * INSERTED first and the hook throws after it, so without one transaction
     * this leaves a payment recorded against a loan that never moved — the
     * orphaned half-write 5.7 exists to make impossible.
     */
    for (const from of ["Draft", "Submitted", "Under Review", "Rejected", "Closed"]) {
      const loanId = await loanAt(from);
      const utr = nextUtr();

      const res = await request(ctx.app)
        .post("/api/disbursements")
        .set(auth(managerToken))
        .send({ loanId, customerId, bankId: bank.id, amount: 100000, utr });

      expect(res.status, `${from}: ${JSON.stringify(res.body)}`).toBe(422);
      expect(res.body.error.code).toBe("unprocessable_entity");
      // The field the caller must change is the loan they picked.
      expect(res.body.error.details[0].path).toBe("loanId");

      // Neither.
      const rows = await ctx.db
        .select()
        .from(disbursements)
        .where(eq(disbursements.loanId, loanId));
      expect(rows, `${from}: a disbursement survived the rollback`).toHaveLength(0);
      expect(await statusOf(loanId), `${from}: the loan moved anyway`).toBe(from);
    }
  });

  it("33. the rolled-back disbursement leaves no audit row either", async () => {
    const loanId = await loanAt("Submitted");
    const before = await ctx.db.select().from(auditLogs).where(eq(auditLogs.recordId, loanId));

    const res = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(managerToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 100000, utr: nextUtr() });
    expect(res.status).toBe(422);

    const after = await ctx.db.select().from(auditLogs).where(eq(auditLogs.recordId, loanId));
    expect(after).toHaveLength(before.length);
  });

  it("34. a SECOND disbursement is allowed and does not re-audit the loan", async () => {
    /*
     * A loan may legitimately be paid out in tranches. `Disbursed → Disbursed`
     * is not an edge, so the hook no-ops rather than refusing: the payment is
     * recorded, the loan is already where it belongs, and nothing is audited
     * about a change that did not happen.
     */
    const loanId = await loanAt("Approved");

    for (const amount of [50000, 50000]) {
      const res = await request(ctx.app)
        .post("/api/disbursements")
        .set(auth(managerToken))
        .send({ loanId, customerId, bankId: bank.id, amount, utr: nextUtr() });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }

    expect(await statusOf(loanId)).toBe("Disbursed");
    const rows = await ctx.db.select().from(disbursements).where(eq(disbursements.loanId, loanId));
    expect(rows).toHaveLength(2);

    const advanced = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.recordId, loanId), eq(auditLogs.action, "disbursed")));
    expect(advanced).toHaveLength(1);
  });

  it("35. the create transaction did not break the existing 23505 path", async () => {
    // A repeated UTR is a double-entry. It must still surface as a 409 from
    // inside the new transaction, not as a 500.
    const loanId = await loanAt("Approved");
    const utr = nextUtr();

    const first = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(managerToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 1000, utr });
    expect(first.status).toBe(201);

    const second = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(managerToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 1000, utr: utr.toLowerCase() });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
  });

  it("36. the loan's own audit trail reads as a workflow, in order", async () => {
    const loanId = await loanAt("Approved");
    const res = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(managerToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 100000, utr: nextUtr() });
    expect(res.status).toBe(201);

    const rows = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.recordId, loanId))
      .orderBy(auditLogs.occurredAt);
    expect(rows.map((r) => r.action)).toEqual([
      "created",
      "approved",
      "approved",
      "approved",
      "disbursed",
    ]);
  });
});

/* ------------------------------------------------ group H: permission boundary */

describe("H — the permission boundary is exactly what it was", () => {
  it("37. `requests.approve` is still required, and is still not held by Team Leader", async () => {
    const id = await loanAt("Submitted");

    expect((await approve(id, { status: "Under Review" }, teamLeaderToken)).status).toBe(403);
    expect(await statusOf(id)).toBe("Submitted");

    // Manager holds the whole `requests` group and is unaffected.
    expect((await approve(id, { status: "Under Review" }, managerToken)).status).toBe(200);
  });

  it("38. a 403 is decided before the state machine ever runs", async () => {
    // An illegal transition requested by an unauthorised caller must answer
    // 403, never 422 — a validation message would confirm the record exists and
    // disclose its current status to someone with no right to the route.
    const id = await loanAt("Draft");
    const res = await approve(id, { status: "Disbursed" }, teamLeaderToken);
    expect(res.status).toBe(403);
  });

  it("39. bank scoping is unchanged — an out-of-scope loan is 404, not 422", async () => {
    const otherBank = await createBank(ctx.db, "Out Of Scope Bank");
    const outsider = await createUser(ctx.db, { roleKey: "manager", bankIds: [otherBank.id] });
    const token = await login(outsider.email, outsider.password);

    const id = await loanAt("Submitted");
    const res = await approve(id, { status: "Under Review" }, token);
    expect(res.status).toBe(404);
  });

  it("40. `requests.edit` still gates PATCH, and Executive still lacks it", async () => {
    const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
    const token = await login(executive.email, executive.password);

    const id = await loanAt("Submitted");
    const res = await request(ctx.app)
      .patch(`/api/loans/${id}`)
      .set(auth(token))
      .send({ notes: "nice try" });
    expect(res.status).toBe(403);
  });
});
