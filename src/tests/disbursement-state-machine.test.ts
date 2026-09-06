import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { customers, disbursements, loans } from "../db/schema/index.js";

/**
 * THE DISBURSEMENT STATE MACHINE — Task 7.3
 * DECISIONS.md D-010, D-057, D-066, D-067 · SECURITY_AUDIT.md SEC-016
 * BUSINESS_FLOW.md §3.3 (ratified 2026-09-05)
 *
 * The loan machine's three defects, one resource over — and this is the phase
 * the roadmap flags "**treat every defect here as high severity**", because it
 * handles money movement.
 *
 *   1. **The approve route wrote any string.** `approveBody` falls back to
 *      `z.string().min(1)` when a resource configures no `allowedStatuses`, and
 *      disbursements configured none. SEC-016's abuse scenario is written
 *      against exactly this route, and D-010 opens with `'Credited '` — a
 *      trailing space produces an off-books disbursement invisible to every
 *      reconciliation query while the UI shows it approved. Group A.
 *   2. **No from→to rule.** `Credited` and `Failed` are terminal in §3.3, so
 *      "re-initiate" cannot mutate a Failed row — which is why 7.2 creates a
 *      new one. Group B.
 *   3. **Two privilege bypasses, identical in shape to the ones D-056 closed
 *      for loans.** Group C is the security group.
 *
 * ⚠️ **Group C matters more here than it did for loans.** Manager holds
 * `disbursements.create` AND `disbursements.edit` and holds NEITHER approve
 * permission (`lib/permissions.ts:249-251`). Both a create with
 * `{"status":"Credited"}` and a PATCH with the same were 2xx — an approval
 * performed by a role that may not approve, leaving `approved_by` NULL and the
 * audit row reading "created"/"updated" rather than "approved". Guarding the
 * transition would NOT have closed either: `In Transit → Credited` is a legal
 * edge. Only refusal closes it (D-056).
 *
 * ⚠️ **Group D pins D-067.** A NULL UTR is a valid in-flight state and several
 * may be in flight at once, so the partial unique index is deliberately NOT
 * changed. The rule is temporal — it binds at `→Credited`, not at insert.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let customerId: string;
let superToken: string;
let managerToken: string;
let executiveToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

let utrCounter = 0;
const nextUtr = () => `DMUTR${String((utrCounter += 1)).padStart(5, "0")}`;

let loanCounter = 0;
async function approvedLoan(): Promise<string> {
  loanCounter += 1;
  const [loan] = await ctx.db
    .insert(loans)
    .values({
      code: `LN-DM-${loanCounter}`,
      customerId,
      bankId: bank.id,
      loanType: "Personal Loan",
      status: "Approved",
      amountApproved: "100000",
    })
    .returning();
  return loan!.id;
}

async function createDisbursement(
  overrides: Record<string, unknown> = {},
  token = superToken,
): Promise<request.Response> {
  const loanId = (overrides.loanId as string) ?? (await approvedLoan());
  return request(ctx.app)
    .post("/api/disbursements")
    .set(auth(token))
    .send({ loanId, customerId, bankId: bank.id, amount: 1000, utr: nextUtr(), ...overrides });
}

const approve = (id: string, body: Record<string, unknown>, token = superToken) =>
  request(ctx.app).post(`/api/disbursements/${id}/approve`).set(auth(token)).send(body);

const rowById = async (id: string) =>
  (await ctx.db.select().from(disbursements).where(eq(disbursements.id, id)).limit(1))[0]!;

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);

  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(admin.email, admin.password);

  const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bank.id] });
  managerToken = await login(manager.email, manager.password);

  const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
  executiveToken = await login(executive.email, executive.password);

  const [customer] = await ctx.db
    .insert(customers)
    .values({
      code: "CUS-DM-1",
      bankId: bank.id,
      bankReferenceId: "DM-REF-1",
      name: "Disbursement Fixture",
      mobile: "9876511111",
    })
    .returning();
  customerId = customer!.id;
});

afterAll(async () => destroyTestContext(ctx));

/* ── group A: vocabulary (5.3's fix, applied to disbursements) ──────────── */

describe("A — the approve route no longer writes arbitrary strings", () => {
  it("1. THE HEADLINE — `banana` is a 422 before any row is touched", async () => {
    const created = await createDisbursement();
    const res = await approve(created.body.data.id, { status: "banana" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect((await rowById(created.body.data.id)).status).toBe("In Transit");
  });

  it("2. D-010's example — `'Credited '` with a trailing space is refused", async () => {
    const created = await createDisbursement();
    const res = await approve(created.body.data.id, { status: "Credited " });

    // The whole point: this used to persist and produce a row that
    // `where status = 'Credited'` could never find.
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect((await rowById(created.body.data.id)).status).toBe("In Transit");
  });

  it("3. every legal value is still accepted", async () => {
    for (const status of ["Credited", "Failed"]) {
      const created = await createDisbursement();
      const res = await approve(created.body.data.id, { status });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe(status);
    }
  });

  it("4. approving stamps approved_by and approved_at", async () => {
    const created = await createDisbursement();
    const res = await approve(created.body.data.id, { status: "Credited" });
    expect(res.status).toBe(200);

    const row = await rowById(created.body.data.id);
    expect(row.approvedBy).not.toBeNull();
    expect(row.approvedAt).not.toBeNull();
  });
});

/* ── group B: transition legality ───────────────────────────────────────── */

describe("B — the from→to graph is enforced", () => {
  it("5. In Transit → Credited and In Transit → Failed are the only edges out", async () => {
    const credited = await createDisbursement();
    expect((await approve(credited.body.data.id, { status: "Credited" })).status).toBe(200);

    const failed = await createDisbursement();
    expect((await approve(failed.body.data.id, { status: "Failed" })).status).toBe(200);
  });

  it("6. Credited is TERMINAL — no edge leaves it", async () => {
    const created = await createDisbursement();
    await approve(created.body.data.id, { status: "Credited" });

    const res = await approve(created.body.data.id, { status: "Failed" });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.message).toContain("final status");
    expect((await rowById(created.body.data.id)).status).toBe("Credited");
  });

  it("7. Failed is TERMINAL — a retry may not resurrect the row (7.2 creates a new one)", async () => {
    const created = await createDisbursement();
    await approve(created.body.data.id, { status: "Failed" });

    const res = await approve(created.body.data.id, { status: "In Transit" });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect((await rowById(created.body.data.id)).status).toBe("Failed");
  });

  it("8. no self-loop — re-approving a Credited row is a 422, not a silent re-stamp", async () => {
    const created = await createDisbursement();
    await approve(created.body.data.id, { status: "Credited" });
    expect((await approve(created.body.data.id, { status: "Credited" })).status).toBe(422);
  });
});

/* ── group C: THE SECURITY GROUP — D-066 ────────────────────────────────── */

describe("C — status is writable only through the approve route", () => {
  it("9. CREATE refuses a privileged initial status", async () => {
    const res = await createDisbursement({ status: "Credited" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("status");
    expect(res.body.error.message).toContain("may start as: In Transit");
  });

  it("10. CREATE still accepts the legal initial status, and the default", async () => {
    expect((await createDisbursement({ status: "In Transit" })).status).toBe(201);
    const withoutStatus = await createDisbursement();
    expect(withoutStatus.status).toBe(201);
    expect(withoutStatus.body.data.status).toBe("In Transit");
  });

  it("11. PATCH refuses status outright — the D-056 refusal, applied here", async () => {
    const created = await createDisbursement();
    const res = await request(ctx.app)
      .patch(`/api/disbursements/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Credited" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("status");
    expect((await rowById(created.body.data.id)).status).toBe("In Transit");
  });

  it("12. PATCH still writes the non-authoritative fields", async () => {
    const created = await createDisbursement();
    const res = await request(ctx.app)
      .patch(`/api/disbursements/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ creditedTo: "HDFC ****4471", notes: "Beneficiary confirmed" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.creditedTo).toBe("HDFC ****4471");
  });

  it("13. THE BYPASS — Manager can create, cannot approve, and cannot reach Credited", async () => {
    // Manager holds disbursements.view/create/edit and NOT .approve.
    const loanId = await approvedLoan();
    const created = await createDisbursement({ loanId }, managerToken);
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    // ...not on create,
    const viaCreate = await createDisbursement(
      { loanId: await approvedLoan(), status: "Credited" },
      managerToken,
    );
    expect(viaCreate.status).toBe(422);

    // ...not on PATCH,
    const viaPatch = await request(ctx.app)
      .patch(`/api/disbursements/${created.body.data.id}`)
      .set(auth(managerToken))
      .send({ status: "Credited" });
    expect(viaPatch.status).toBe(422);

    // ...and not on approve, which they may not call at all.
    const viaApprove = await approve(created.body.data.id, { status: "Credited" }, managerToken);
    expect(viaApprove.status).toBe(403);

    expect((await rowById(created.body.data.id)).status).toBe("In Transit");
  });

  it("14. Executive cannot touch disbursements at all", async () => {
    const created = await createDisbursement();
    expect((await createDisbursement({}, executiveToken)).status).toBe(403);
    expect(
      (await approve(created.body.data.id, { status: "Credited" }, executiveToken)).status,
    ).toBe(403);
  });
});

/* ── group D: the UTR precondition and D-067 ────────────────────────────── */

describe("D — →Credited requires a UTR; NULL UTRs stay legal in flight", () => {
  it("15. a disbursement with no UTR cannot be marked Credited", async () => {
    const created = await createDisbursement({ utr: null });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const res = await approve(created.body.data.id, { status: "Credited" });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("utr");

    // The hook threw INSIDE the approve transaction, so nothing moved (F1).
    expect((await rowById(created.body.data.id)).status).toBe("In Transit");
  });

  it("16. ...but it CAN be marked Failed — a transfer can fail before a reference exists", async () => {
    const created = await createDisbursement({ utr: null });
    const res = await approve(created.body.data.id, { status: "Failed" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("17. once the UTR is recorded by PATCH, →Credited succeeds", async () => {
    const created = await createDisbursement({ utr: null });
    const patched = await request(ctx.app)
      .patch(`/api/disbursements/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ utr: nextUtr() });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    expect((await approve(created.body.data.id, { status: "Credited" })).status).toBe(200);
  });

  it("18. D-067 — several disbursements may hold a NULL UTR at once", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await createDisbursement({ utr: null })).status).toBe(201);
    }
  });

  it("19. a duplicate REAL utr is still a 409", async () => {
    const utr = nextUtr();
    expect((await createDisbursement({ utr })).status).toBe(201);
    const second = await createDisbursement({ utr });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
  });
});

/* ── group E: 7.6 — already delivered by 5.7, verified not rebuilt ──────── */

describe("E — 7.6 is a verification checkpoint: 5.7 already links the loan", () => {
  it("20. creating a disbursement still advances its loan to Disbursed, atomically", async () => {
    const loanId = await approvedLoan();
    const created = await createDisbursement({ loanId });
    expect(created.status).toBe(201);

    const [loan] = await ctx.db.select().from(loans).where(eq(loans.id, loanId));
    expect(loan!.status).toBe("Disbursed");
  });

  it("21. and a loan that is not Approved still refuses the disbursement entirely", async () => {
    const [draft] = await ctx.db
      .insert(loans)
      .values({
        code: `LN-DM-DRAFT-${(loanCounter += 1)}`,
        customerId,
        bankId: bank.id,
        loanType: "Personal Loan",
        status: "Draft",
      })
      .returning();

    const res = await createDisbursement({ loanId: draft!.id });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("loanId");

    // Nothing was half-written — the disbursement rolled back with the refusal.
    const rows = await ctx.db
      .select()
      .from(disbursements)
      .where(eq(disbursements.loanId, draft!.id));
    expect(rows).toHaveLength(0);
  });
});
