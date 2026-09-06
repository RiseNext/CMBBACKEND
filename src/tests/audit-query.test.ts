import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { auditLogs } from "../db/schema/index.js";

/**
 * THE AUDIT-LOG QUERY — Tasks 12.4 and 12.5, SEC-014.
 *
 * ── 12.5: THE PRECEDENCE BUG (group B) ──────────────────────────────────────
 *
 * The bank-scope clause was pushed into the filter list as a bare `A or B`
 * fragment. Drizzle's `and()` parenthesises the whole conjunction and not each
 * term, and `and` binds tighter than `or`, so the emitted predicate was
 *
 *     ((record_type = 'loan' and bank_id is null and actor_id = :me)
 *      or (bank_id in (…)))
 *
 * — the user's filters applied to the personal branch only, and were **dropped
 * entirely** for the in-scope branch. Asking a scoped user for loan events
 * returned every audit row in their banks, of every type.
 *
 * The distinction group B keeps making is that this was **filter dropping and
 * not a scope escape**: the second disjunct is still `bank_id in (caller's
 * banks)`, so no out-of-scope row was ever reachable. Case 12 asserts that
 * directly, because a fix that narrowed the wrong way would look identical from
 * the filter cases alone.
 *
 * These cases only fail against the defect when the caller is **scoped** — an
 * unscoped caller never had the `or` clause at all.
 *
 * ── AND THAT NEEDS A ROLE THE SEED DOES NOT SHIP ────────────────────────────
 *
 * Measured while writing this file, and worth recording plainly: **no default
 * role is both bank-scoped and able to read the audit trail.** `audit_logs.view`
 * is seeded to Super Admin and Admin, and Admin also holds
 * `system.access_all_banks`, so `ctx.bankIds` is `null` for both. The defect was
 * therefore unreachable with the shipped role set — it needed exactly the
 * bespoke read-only auditor that `permissions.ts` names in its own comment on
 * `system.access_all_banks` ("a bespoke Group Auditor role"). Group B creates
 * that role through the real `POST /api/roles`, because a defect that is only
 * reachable after a supported configuration change is still a defect, and the
 * first client to create such a role would have hit it immediately.
 *
 * ── 12.4: TRUTHFUL PAGINATION (group A) ─────────────────────────────────────
 *
 * The response carried `page` and `pageSize` and no `total`. A viewer cannot
 * render honest pagination from that: it must either invent a total or offer a
 * Next that may land on nothing.
 */

const PASSWORD = "TestPassword123!";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let ctx: TestContext;
let bankA: { id: string };
let bankB: { id: string };
let superToken: string;
let auditorToken: string;
let auditorId: string;
let otherActorId: string;

/** Writes an audit row directly — these tests are about the QUERY, not the writer. */
let seq = 0;
async function seedLog(over: Partial<typeof auditLogs.$inferInsert> = {}) {
  seq += 1;
  await ctx.db.insert(auditLogs).values({
    action: "updated",
    recordType: "loan",
    recordId: `rec-${seq}`,
    ...over,
  });
}

const list = (query: string, token: string) =>
  request(ctx.app).get(`/api/audit-logs${query}`).set(bearer(token));

beforeAll(async () => {
  ctx = await createTestContext();
  bankA = await createBank(ctx.db);
  bankB = await createBank(ctx.db);

  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = (
    await request(ctx.app).post("/api/auth/login").send({ email: admin.email, password: PASSWORD })
  ).body.accessToken;

  /*
   * The bespoke scoped auditor. Created through the real route so the role is
   * exactly what a client could build: `audit_logs.view` and nothing that
   * bypasses bank scoping. A Super Admin holds `system.manage_any_user`, so
   * `assertCanGrantPermissions` allows it.
   */
  const roleRes = await request(ctx.app)
    .post("/api/roles")
    .set(bearer(superToken))
    .send({
      key: "bank_auditor",
      name: "Bank Auditor",
      level: 25,
      permissions: ["audit_logs.view", "banks.view"],
    });
  expect(roleRes.status, JSON.stringify(roleRes.body)).toBe(201);

  const auditor = await createUser(ctx.db, { roleKey: "bank_auditor", bankIds: [bankA.id] });
  auditorId = auditor.id;
  auditorToken = (
    await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: auditor.email, password: PASSWORD })
  ).body.accessToken;

  const other = await createUser(ctx.db, { roleKey: "team_leader", bankIds: [bankA.id] });
  otherActorId = other.id;

  // Sign-in already wrote a few rows. Everything below is deliberate fixture
  // data, all inside bank A unless it says otherwise.
  await seedLog({ recordType: "loan", action: "approved", bankId: bankA.id, actorId: auditorId });
  await seedLog({ recordType: "loan", action: "updated", bankId: bankA.id, actorId: otherActorId });
  await seedLog({ recordType: "customer", action: "updated", bankId: bankA.id, actorId: auditorId });
  await seedLog({
    recordType: "customer",
    action: "created",
    bankId: bankA.id,
    actorId: otherActorId,
  });
  // Bank B — outside the scoped caller's access entirely.
  await seedLog({ recordType: "loan", action: "approved", bankId: bankB.id, actorId: otherActorId });
  await seedLog({ recordType: "customer", action: "deleted", bankId: bankB.id });
}, 60_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ══ A — 12.4: pagination that can be rendered ════════════════════════════ */

describe("A · the response says how many rows matched", () => {
  it("1. THE FINDING: meta carries a total, not just page and pageSize", async () => {
    const res = await list("?pageSize=2", superToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.meta.total).toBeGreaterThan(2);
    expect(typeof res.body.meta.total).toBe("number");
  });

  it("2. totalPages follows the page size, so a paginator has something to count", async () => {
    const res = await list("?pageSize=2", superToken);
    expect(res.body.meta.totalPages).toBe(Math.ceil(res.body.meta.total / 2));
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it("3. the total describes the FILTERED set, not the whole table", async () => {
    const all = await list("?pageSize=1", superToken);
    const loans = await list("?recordType=loan&pageSize=1", superToken);
    expect(loans.body.meta.total).toBeLessThan(all.body.meta.total);
    expect(loans.body.meta.total).toBeGreaterThan(0);
  });

  it("4. page 2 returns different rows from page 1", async () => {
    const first = await list("?pageSize=2&page=1", superToken);
    const second = await list("?pageSize=2&page=2", superToken);
    const ids = new Set(first.body.data.map((r: { id: number }) => r.id));
    for (const row of second.body.data) expect(ids.has(row.id)).toBe(false);
  });

  it("5. a page past the end is empty rather than an error, and the total still holds", async () => {
    const res = await list("?pageSize=10&page=9999", superToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBeGreaterThan(0);
  });

  it("6. meta.scoped reports whether the caller sees everything", async () => {
    expect((await list("?pageSize=1", superToken)).body.meta.scoped).toBe(false);
    expect((await list("?pageSize=1", auditorToken)).body.meta.scoped).toBe(true);
  });
});

/* ══ B — 12.5: filters survive the scope clause ═══════════════════════════ */

describe("B · a scoped caller's filters are honoured", () => {
  it("7. THE FINDING: recordType filters a SCOPED caller's rows", async () => {
    // Against the defect this returned customer rows too, because the filter
    // was dropped for the entire in-scope branch of the `or`.
    const res = await list("?recordType=loan&pageSize=200", auditorToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) expect(row.recordType).toBe("loan");
  });

  it("8. the actor filter is honoured", async () => {
    const res = await list(`?actorId=${otherActorId}&pageSize=200`, auditorToken);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) expect(row.actorId).toBe(otherActorId);
  });

  it("9. the bank filter is honoured", async () => {
    const res = await list(`?bankId=${bankA.id}&pageSize=200`, auditorToken);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) expect(row.bankId).toBe(bankA.id);
  });

  it("10. the action filter is honoured", async () => {
    const res = await list("?action=approved&pageSize=200", auditorToken);
    expect(res.status).toBe(200);
    for (const row of res.body.data) expect(row.action).toBe("approved");
  });

  it("11. combined filters are ANDed, not ORed", async () => {
    const res = await list(
      `?recordType=customer&actorId=${otherActorId}&pageSize=200`,
      auditorToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(row.recordType).toBe("customer");
      expect(row.actorId).toBe(otherActorId);
    }
    // And it is strictly narrower than either half.
    const oneHalf = await list("?recordType=customer&pageSize=200", auditorToken);
    expect(res.body.meta.total).toBeLessThan(oneHalf.body.meta.total);
  });

  it("12. AND the bug was never a scope escape — no bank B row is reachable", async () => {
    // Asserted separately from the filter cases: a "fix" that narrowed the wrong
    // way would pass every case above and fail here.
    for (const query of [
      "?pageSize=500",
      "?recordType=loan&pageSize=500",
      "?action=approved&pageSize=500",
      `?actorId=${otherActorId}&pageSize=500`,
    ]) {
      const res = await list(query, auditorToken);
      for (const row of res.body.data) expect(row.bankId).not.toBe(bankB.id);
    }
  });

  it("13. a bank filter cannot WIDEN the scope — bank B is a 403, not an empty page", async () => {
    // D-051: a filter that quietly returns a different set than the one asked
    // for is worse than a refusal.
    const res = await list(`?bankId=${bankB.id}&pageSize=10`, auditorToken);
    expect(res.status).toBe(403);
  });

  it("14. an unscoped caller may filter by any bank", async () => {
    const res = await list(`?bankId=${bankB.id}&pageSize=200`, superToken);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) expect(row.bankId).toBe(bankB.id);
  });

  it("15. the caller's own bank-less rows are still visible, and still filtered", async () => {
    // The personal branch of the `or` — how a scoped user sees their own login
    // and permission-denied events, which carry no bank.
    await seedLog({ recordType: "session", action: "login", actorId: auditorId, bankId: null });
    await seedLog({ recordType: "role", action: "updated", actorId: auditorId, bankId: null });

    const res = await list("?recordType=session&pageSize=200", auditorToken);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) expect(row.recordType).toBe("session");
  });

  it("16. …but NOT somebody else's bank-less rows", async () => {
    await seedLog({ recordType: "session", action: "login", actorId: otherActorId, bankId: null });
    const res = await list("?recordType=session&pageSize=200", auditorToken);
    for (const row of res.body.data) {
      if (row.bankId === null) expect(row.actorId).toBe(auditorId);
    }
  });
});

/* ══ C — the date window ══════════════════════════════════════════════════ */

describe("C · the occurred-at window", () => {
  it("17. `from` in the future returns nothing rather than everything", async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const res = await list(`?from=${future.toISOString().slice(0, 10)}&pageSize=10`, superToken);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });

  it("18. a row written LATE on the `to` day is included", async () => {
    // A date input means the whole day. Comparing against a midnight bound
    // silently empties the final day of every window.
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const late = new Date(today);
    late.setHours(23, 47, 0, 0);
    await seedLog({ recordType: "late-marker", occurredAt: late });

    const res = await list(`?recordType=late-marker&to=${key}&pageSize=10`, superToken);
    expect(res.body.meta.total).toBe(1);
  });
});

/* ══ D — permission ═══════════════════════════════════════════════════════ */

describe("D · who may read the trail", () => {
  it("19. a role without audit_logs.view is refused", async () => {
    const exec = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });
    const token = (
      await request(ctx.app).post("/api/auth/login").send({ email: exec.email, password: PASSWORD })
    ).body.accessToken;
    expect((await list("?pageSize=10", token)).status).toBe(403);
  });

  it("20. an unauthenticated caller is refused", async () => {
    expect((await request(ctx.app).get("/api/audit-logs")).status).toBe(401);
  });

  it("21. a malformed actorId is a 422, not a 500", async () => {
    const res = await list("?actorId=not-a-uuid", superToken);
    expect(res.status).toBe(422);
  });
});
