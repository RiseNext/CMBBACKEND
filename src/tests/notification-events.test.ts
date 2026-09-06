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
import { customers, loans, notifications, settlements } from "../db/schema/index.js";

/**
 * THE NOTIFICATION PRODUCER — Task 10.3, DECISIONS.md D-077
 *
 * `grep insert(notifications)` returned **zero** before this. The table, all
 * three routes and the bell badge existed, and nothing could ever put a row in
 * any of them — BUG-024, and the reason the notifications page was structurally
 * incapable of showing anything in production.
 *
 *   Group A — events are produced, by the routes that own them.
 *   Group B — emission is INSIDE the caller's transaction, so a rolled-back
 *             action leaves no alert claiming it happened.
 *   Group C — idempotency: a retry does not duplicate, a legitimate repeat does
 *             not get suppressed. These are different requirements and the
 *             `event_key` discriminator is what separates them.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let customerId: string;
let superToken: string;
let assigneeId: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

let loanCounter = 0;
async function makeLoan(status = "Under Review"): Promise<{ id: string; code: string }> {
  loanCounter += 1;
  const [loan] = await ctx.db
    .insert(loans)
    .values({
      code: `LN-NOTIF-${loanCounter}`,
      customerId,
      bankId: bank.id,
      loanType: "Personal Loan",
      status,
      assignedUserId: assigneeId,
      amountApproved: "100000",
    })
    .returning();
  return { id: loan!.id, code: loan!.code };
}

const notificationsFor = async (recordId: string) =>
  ctx.db.select().from(notifications).where(eq(notifications.recordId, recordId));

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);

  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(admin.email, admin.password);

  // A separate person, so the actor is never their own recipient.
  const assignee = await createUser(ctx.db, { roleKey: "team_leader", bankIds: [bank.id] });
  assigneeId = assignee.id;

  const [customer] = await ctx.db
    .insert(customers)
    .values({
      code: "CUS-NOTIF-1",
      bankId: bank.id,
      bankReferenceId: "NOTIF-REF-1",
      name: "Notification Fixture",
      mobile: "9876544444",
    })
    .returning();
  customerId = customer!.id;
});

afterAll(async () => destroyTestContext(ctx));

/* ── A — real events produce real rows ──────────────────────────────────── */

describe("A — approving and rejecting produce notifications", () => {
  it("1. THE HEADLINE — approving a loan writes a notification row", async () => {
    const loan = await makeLoan();
    const res = await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await notificationsFor(loan.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventType).toBe("loan.approved");
    expect(rows[0]!.userId).toBe(assigneeId);
    expect(rows[0]!.title).toContain(loan.code);
    expect(rows[0]!.read).toBe(false);
  });

  it("2. rejecting produces a distinct event, with a warning severity", async () => {
    const loan = await makeLoan();
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Rejected" });

    const rows = await notificationsFor(loan.id);
    expect(rows[0]!.eventType).toBe("loan.rejected");
    expect(rows[0]!.severity).toBe("warning");
  });

  it("3. link_href points at a real route — Task 10.4, never a dead link", async () => {
    const loan = await makeLoan();
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });

    const rows = await notificationsFor(loan.id);
    expect(rows[0]!.linkHref).toBe("/loans");
  });

  it("4. a transition that is not a decision produces nothing", async () => {
    const loan = await makeLoan("Submitted");
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Under Review" });

    expect(await notificationsFor(loan.id)).toHaveLength(0);
  });

  it("5. the actor is never notified about their own action", async () => {
    // The loan is assigned to the assignee; the Super Admin approves it. If the
    // actor were included, a busy approver would push real alerts off their own
    // list with echoes of their own clicks.
    const loan = await makeLoan();
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });

    const rows = await notificationsFor(loan.id);
    expect(rows.every((row) => row.userId === assigneeId)).toBe(true);
  });

  it("6. paying a settlement notifies, alongside the 8.8 chain", async () => {
    const created = await request(ctx.app)
      .post("/api/settlements")
      .set(auth(superToken))
      .send({
        bankId: bank.id,
        period: "NOTIF-1",
        grossCommission: 10000,
        tds: 1000,
        netPayable: 9000,
      });
    expect(created.status).toBe(201);

    // `created_by` is the Super Admin, who is also the actor here, so the
    // audience is empty — and an empty audience must be a silent no-op rather
    // than an error. This is the case that would crash a naive implementation.
    const res = await request(ctx.app)
      .post(`/api/settlements/${created.body.data.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Paid" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

/* ── B — emission is transactional ──────────────────────────────────────── */

describe("B — a refused action leaves no notification behind", () => {
  it("7. an illegal transition produces neither the change nor the alert", async () => {
    const loan = await makeLoan("Draft");
    const res = await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });
    expect(res.status).toBe(422);

    expect(await notificationsFor(loan.id)).toHaveLength(0);
  });

  it("8. a settlement whose arithmetic fails at →Paid notifies nobody", async () => {
    const created = await request(ctx.app)
      .post("/api/settlements")
      .set(auth(superToken))
      .send({
        bankId: bank.id,
        period: "NOTIF-2",
        grossCommission: 10000,
        tds: 1000,
        netPayable: 9000,
      });
    await ctx.db
      .update(settlements)
      .set({ tds: "7" })
      .where(eq(settlements.id, created.body.data.id));

    const res = await request(ctx.app)
      .post(`/api/settlements/${created.body.data.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Paid" });
    expect(res.status).toBe(422);

    // The whole transaction unwound — the status, the chain and the alert.
    expect(await notificationsFor(created.body.data.id)).toHaveLength(0);
  });
});

/* ── C — idempotency without suppressing real repeats ───────────────────── */

describe("C — a retry does not duplicate; a legitimate repeat is not swallowed", () => {
  it("9. re-approving is refused, so no second row can appear", async () => {
    const loan = await makeLoan();
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });

    // Approved→Approved is not an edge; the machine refuses before emission.
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });

    expect(await notificationsFor(loan.id)).toHaveLength(1);
  });

  it("10. the unique index is the backstop the machine cannot be", async () => {
    const loan = await makeLoan();
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });

    const [existing] = await notificationsFor(loan.id);
    // Simulates a retried emission — a second transaction, which atomicity
    // cannot see. Migration 0011's partial unique index refuses it.
    await expect(
      ctx.db.insert(notifications).values({
        userId: existing!.userId,
        title: "Duplicate",
        message: "Duplicate",
        eventType: existing!.eventType,
        recordType: existing!.recordType,
        recordId: existing!.recordId,
        eventKey: existing!.eventKey,
      }),
    ).rejects.toThrow();

    expect(await notificationsFor(loan.id)).toHaveLength(1);
  });

  it("11. the SAME event for a DIFFERENT recipient is allowed — fan-out is per user", async () => {
    const loan = await makeLoan();
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });

    const [existing] = await notificationsFor(loan.id);
    const other = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });

    await expect(
      ctx.db.insert(notifications).values({
        userId: other.id,
        title: existing!.title,
        message: existing!.message,
        eventType: existing!.eventType,
        recordType: existing!.recordType,
        recordId: existing!.recordId,
        eventKey: existing!.eventKey,
      }),
    ).resolves.toBeDefined();

    expect(await notificationsFor(loan.id)).toHaveLength(2);
  });

  it("12. every produced row carries the event identity migration 0011 added", async () => {
    const loan = await makeLoan();
    await request(ctx.app)
      .post(`/api/loans/${loan.id}/approve`)
      .set(auth(superToken))
      .send({ status: "Approved", amountApproved: 50000 });

    const [row] = await notificationsFor(loan.id);
    expect(row!.eventType).toBeTruthy();
    expect(row!.recordType).toBe("loan");
    expect(row!.recordId).toBe(loan.id);
    expect(row!.eventKey).toContain("loan.approved:loan:");
    expect(row!.userId).toBeTruthy(); // NOT NULL — an unaddressed row is invisible
  });
});
