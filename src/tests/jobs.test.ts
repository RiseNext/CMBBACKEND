import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, count, eq, sql } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import {
  auditLogs,
  bankOrders,
  customers,
  importBatches,
  importRows,
  loans,
  notifications,
  recycleBinEntries,
  refreshTokens,
} from "../db/schema/index.js";
import {
  allSucceeded,
  cleanupRefreshTokens,
  detectSlaBreach,
  expireImportBatches,
  GRACE_DAYS,
  JOBS,
  jobByName,
  overdueStagedRowCount,
  purgeRecycleBin,
  runAllJobs,
  runJob,
} from "../jobs/index.js";

/**
 * THE SCHEDULED JOBS — Task 15.9.
 *
 * Four things in this system have been stamped by the application and acted on
 * by **nothing** since the first migration: `recycle_bin_entries.purge_after`,
 * `import_batches.expires_at`, dead `refresh_tokens`, and `bank_orders.sla`.
 *
 * ── GROUP B IS THE ONE THAT MATTERS MOST ────────────────────────────────────
 *
 * It is **SEC-009's retention half** — the last open HIGH. `import_rows.raw`
 * holds the uploaded spreadsheet verbatim, including plaintext Aadhaar, and it
 * was never deleted. Case 8 seeds a recognisable Aadhaar string, runs the job,
 * and asserts the value is **gone from the database**. That is the only form of
 * evidence worth having for a retention claim: not that a status changed, but
 * that the data gone is gone.
 *
 * ── AND WHY EVERY GROUP HAS AN IDEMPOTENCE CASE ─────────────────────────────
 *
 * A scheduler will double-fire, and every one of these jobs is destructive.
 * Each group therefore runs its job **twice** and asserts the second run is a
 * no-op — not merely that it did not crash, but that it processed zero.
 */

const PASSWORD = "TestPassword123!";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let ctx: TestContext;
let bank: { id: string };
let superToken: string;
let superId: string;

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000);

let seq = 0;
const uniq = () => (seq += 1);

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superId = admin.id;
  superToken = (
    await request(ctx.app).post("/api/auth/login").send({ email: admin.email, password: PASSWORD })
  ).body.accessToken;
}, 60_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

const run = (job: Parameters<typeof runJob>[0], options = {}) =>
  runJob(job, { db: ctx.db, ...options });

/* ══ A — the registry and the contract ════════════════════════════════════ */

describe("A · the runner", () => {
  it("1. every registered job has a name, a description and a bounded default", async () => {
    expect(JOBS.length).toBeGreaterThan(0);
    for (const job of JOBS) {
      expect(job.name).toMatch(/^[a-z][a-z-]+$/);
      expect(job.description.length).toBeGreaterThan(20);
      expect(job.defaultLimit).toBeGreaterThan(0);
    }
    // Names are the scheduler's contract; a duplicate would make one
    // unreachable through `jobByName`.
    expect(new Set(JOBS.map((j) => j.name)).size).toBe(JOBS.length);
  });

  it("2. a job is reachable by the name the scheduler will use", async () => {
    for (const job of JOBS) expect(jobByName(job.name)).toBe(job);
    expect(jobByName("no-such-job")).toBeUndefined();
  });

  it("3. a job that throws is reported as a failure rather than escaping", async () => {
    // A throw is the selection query failing — an operational fault. The runner
    // must turn it into a non-zero exit, not an unhandled rejection.
    const exploding = {
      name: "exploding",
      description: "Deliberately throws, to prove the runner contains it.",
      defaultLimit: 1,
      run: async () => {
        throw new Error("boom");
      },
    };
    const result = await run(exploding);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
    expect(allSucceeded([result])).toBe(false);
  });

  it("4. a run with nothing to do is a SUCCESS, not a silent nothing", async () => {
    const results = await runAllJobs({ db: ctx.db });
    expect(results).toHaveLength(JOBS.length);
    expect(allSucceeded(results)).toBe(true);
    for (const result of results) expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("5. --dry-run selects the work and changes nothing", async () => {
    const batch = await seedExpiredBatch();
    const before = await stagedRowCount(batch);

    const result = await run(expireImportBatches, { dryRun: true });
    expect(result.processed).toBe(0);
    expect(Number(result.details?.due)).toBeGreaterThan(0);
    expect(await stagedRowCount(batch)).toBe(before);
  });
});

/* ══ B — SEC-009: staged PII is destroyed ═════════════════════════════════ */

async function seedBatch(expiresAt: Date, status = "previewed", aadhaar = "999912345678") {
  const n = uniq();
  const [batch] = await ctx.db
    .insert(importBatches)
    .values({
      importType: "customers",
      fileName: `book-${n}.xlsx`,
      bankId: bank.id,
      status,
      totalRows: 2,
      validRows: 2,
      expiresAt,
    })
    .returning();

  await ctx.db.insert(importRows).values([
    {
      batchId: batch!.id,
      rowNumber: 1,
      status: "valid",
      raw: { name: `Row ${n}`, aadhaar, pan: "ABCDE1234F", mobile: "9848000001" } as never,
    },
    {
      batchId: batch!.id,
      rowNumber: 2,
      status: "valid",
      raw: { name: `Row ${n}b`, aadhaar, pan: "ABCDE1234G", mobile: "9848000002" } as never,
    },
  ]);
  return batch!.id;
}

const seedExpiredBatch = (status = "previewed", aadhaar?: string) =>
  seedBatch(ago(1), status, aadhaar);

async function stagedRowCount(batchId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(importRows)
    .where(eq(importRows.batchId, batchId));
  return row?.n ?? 0;
}

describe("B · expire-import-batches — the retention half of SEC-009", () => {
  it("6. THE FINDING: an expired batch's staged rows are destroyed", async () => {
    const batchId = await seedExpiredBatch();
    expect(await stagedRowCount(batchId)).toBe(2);

    const result = await run(expireImportBatches);
    expect(result.failed).toBe(0);
    expect(result.processed).toBeGreaterThan(0);
    expect(await stagedRowCount(batchId)).toBe(0);
  });

  it("7. the BATCH survives, with its counts, so the operational record remains", async () => {
    const batchId = await seedExpiredBatch();
    await run(expireImportBatches);

    const [batch] = await ctx.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, batchId));
    expect(batch).toBeDefined();
    expect(batch!.status).toBe("expired");
    expect(batch!.totalRows).toBe(2);
    expect(batch!.fileName).toMatch(/\.xlsx$/);
  });

  it("8. THE PROOF: the plaintext Aadhaar is no longer anywhere in import_rows", async () => {
    // Not "the status changed" — the value is gone. That is the only evidence
    // worth having for a retention claim, and it is what DPDP erasure means.
    const marker = "888812345678";
    await seedExpiredBatch("previewed", marker);

    const before = await ctx.db
      .select({ n: count() })
      .from(importRows)
      .where(sql`${importRows.raw}::text like ${`%${marker}%`}`);
    expect(before[0]!.n).toBeGreaterThan(0);

    await run(expireImportBatches);

    const after = await ctx.db
      .select({ n: count() })
      .from(importRows)
      .where(sql`${importRows.raw}::text like ${`%${marker}%`}`);
    expect(after[0]!.n).toBe(0);
  });

  it("9. an ALREADY-IMPORTED batch is cleaned too — the staged copy is duplication", async () => {
    // The records are in `customers` with the Aadhaar peppered and hashed. The
    // plaintext staging copy is the most sensitive field in the system, twice.
    const batchId = await seedExpiredBatch("imported");
    await run(expireImportBatches);
    expect(await stagedRowCount(batchId)).toBe(0);
  });

  it("10. a batch still inside its window is UNTOUCHED", async () => {
    const live = await seedBatch(ahead(3));
    await run(expireImportBatches);
    expect(await stagedRowCount(live)).toBe(2);

    const [batch] = await ctx.db.select().from(importBatches).where(eq(importBatches.id, live));
    expect(batch!.status).toBe("previewed");
  });

  it("11. it is idempotent — a second run processes nothing", async () => {
    await seedExpiredBatch();
    const first = await run(expireImportBatches);
    expect(first.processed).toBeGreaterThan(0);

    const second = await run(expireImportBatches);
    expect(second.processed).toBe(0);
    expect(second.failed).toBe(0);
  });

  it("12. the destruction is audited with COUNTS, never with row content", async () => {
    const marker = "777712345678";
    const batchId = await seedExpiredBatch("previewed", marker);
    await run(expireImportBatches);

    const [entry] = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.recordType, "import_batch"), eq(auditLogs.recordId, batchId)));
    expect(entry).toBeDefined();
    // Nobody did this. `actor_id` null is the truthful record of a system action.
    expect(entry!.actorId).toBeNull();
    expect((entry!.metadata as { rowsDestroyed: number }).rowsDestroyed).toBe(2);
    // `audit_logs` is trigger-immutable with no purge path of its own. Writing
    // the row content here would move SEC-009 rather than close it.
    expect(JSON.stringify(entry)).not.toContain(marker);
  });

  it("13. `overdueStagedRowCount` reaches zero, which is what SEC-009 closing means", async () => {
    await seedExpiredBatch();
    expect(await overdueStagedRowCount(ctx.db)).toBeGreaterThan(0);
    await run(expireImportBatches);
    expect(await overdueStagedRowCount(ctx.db)).toBe(0);
  });

  it("14. the limit is respected, so a backlog drains in bounded chunks", async () => {
    await seedExpiredBatch();
    await seedExpiredBatch();
    await seedExpiredBatch();

    const result = await run(expireImportBatches, { limit: 2 });
    expect(result.processed).toBe(2);
    expect(await overdueStagedRowCount(ctx.db)).toBeGreaterThan(0);

    await run(expireImportBatches);
    expect(await overdueStagedRowCount(ctx.db)).toBe(0);
  });
});

/* ══ C — the recycle-bin purge ════════════════════════════════════════════ */

async function seedDeletedCustomer(purgeAfter: Date): Promise<{ customerId: string; entryId: string }> {
  const n = uniq();
  const [customer] = await ctx.db
    .insert(customers)
    .values({
      code: `CUS-J${n}`,
      bankId: bank.id,
      bankReferenceId: `JREF-${n}`,
      name: `Job Customer ${n}`,
      mobile: `96${String(100000000 + n)}`,
    })
    .returning();

  const res = await request(ctx.app)
    .delete(`/api/customers/${customer!.id}`)
    .set(bearer(superToken));
  expect(res.status, JSON.stringify(res.body)).toBe(204);

  const [entry] = await ctx.db
    .select()
    .from(recycleBinEntries)
    .where(eq(recycleBinEntries.recordId, customer!.id));

  await ctx.db
    .update(recycleBinEntries)
    .set({ purgeAfter })
    .where(eq(recycleBinEntries.id, entry!.id));

  return { customerId: customer!.id, entryId: entry!.id };
}

describe("C · purge-recycle-bin", () => {
  it("15. THE FINDING: an entry past its window is purged and the row is gone", async () => {
    const { customerId, entryId } = await seedDeletedCustomer(ago(1));

    const result = await run(purgeRecycleBin);
    expect(result.failed).toBe(0);
    expect(result.processed).toBeGreaterThan(0);

    const rows = await ctx.db.select().from(customers).where(eq(customers.id, customerId));
    expect(rows).toHaveLength(0);

    const [entry] = await ctx.db
      .select()
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.id, entryId));
    // The ENTRY is retained with `purged_at` stamped — that is the record that
    // the record once existed, and Task 2.11 depends on it for code reuse.
    expect(entry!.purgedAt).not.toBeNull();
    expect(entry!.purgedBy).toBeNull();
  });

  it("16. an entry still inside its window is untouched", async () => {
    const { customerId } = await seedDeletedCustomer(ahead(30));
    await run(purgeRecycleBin);
    const rows = await ctx.db.select().from(customers).where(eq(customers.id, customerId));
    expect(rows).toHaveLength(1);
  });

  it("17. a RESTORED entry is never purged, however old", async () => {
    const { customerId, entryId } = await seedDeletedCustomer(ago(90));
    const res = await request(ctx.app)
      .post(`/api/recycle-bin/${entryId}/restore`)
      .set(bearer(superToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    await run(purgeRecycleBin);
    const rows = await ctx.db.select().from(customers).where(eq(customers.id, customerId));
    expect(rows).toHaveLength(1);
  });

  it("18. it is idempotent", async () => {
    await seedDeletedCustomer(ago(1));
    const first = await run(purgeRecycleBin);
    expect(first.processed).toBeGreaterThan(0);
    const second = await run(purgeRecycleBin);
    expect(second.processed).toBe(0);
  });

  it("19. the purge is audited as a system action", async () => {
    const { customerId } = await seedDeletedCustomer(ago(1));
    await run(purgeRecycleBin);

    const [entry] = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, "permanently_deleted"), eq(auditLogs.recordId, customerId)),
      );
    expect(entry).toBeDefined();
    expect(entry!.actorId).toBeNull();
  });
});

/* ══ D — refresh-token cleanup ════════════════════════════════════════════ */

async function seedToken(over: Partial<typeof refreshTokens.$inferInsert>): Promise<string> {
  const n = uniq();
  const [row] = await ctx.db
    .insert(refreshTokens)
    .values({
      userId: superId,
      tokenHash: `hash-${n}-${Math.random()}`,
      expiresAt: ahead(7),
      ...over,
    })
    .returning();
  return row!.id;
}

const tokenExists = async (id: string) =>
  (await ctx.db.select().from(refreshTokens).where(eq(refreshTokens.id, id))).length > 0;

describe("D · cleanup-refresh-tokens", () => {
  it("20. THE FINDING: a long-expired token is deleted", async () => {
    const id = await seedToken({ expiresAt: ago(GRACE_DAYS + 2) });
    const result = await run(cleanupRefreshTokens);
    expect(result.failed).toBe(0);
    expect(await tokenExists(id)).toBe(false);
  });

  it("21. a LIVE token is never touched", async () => {
    const id = await seedToken({ expiresAt: ahead(5) });
    await run(cleanupRefreshTokens);
    expect(await tokenExists(id)).toBe(true);
  });

  it("22. THE GUARD: a recently revoked token SURVIVES, because reuse detection needs it", async () => {
    // This is the case that is easy to get wrong. `/auth/refresh` detects
    // replay of a rotated token by finding a revoked row. Delete it on
    // rotation and the detection silently stops working — the attacker gets
    // the same 401 either way, so no test of the endpoint would notice.
    const id = await seedToken({ expiresAt: ahead(5), revokedAt: new Date() });
    await run(cleanupRefreshTokens);
    expect(await tokenExists(id)).toBe(true);
  });

  it("23. …and is deleted once the grace period has elapsed", async () => {
    const id = await seedToken({ expiresAt: ahead(5), revokedAt: ago(GRACE_DAYS + 1) });
    await run(cleanupRefreshTokens);
    expect(await tokenExists(id)).toBe(false);
  });

  it("24. a token expired but INSIDE the grace period survives", async () => {
    const id = await seedToken({ expiresAt: ago(1) });
    await run(cleanupRefreshTokens);
    expect(await tokenExists(id)).toBe(true);
  });

  it("25. it is idempotent", async () => {
    await seedToken({ expiresAt: ago(GRACE_DAYS + 3) });
    const first = await run(cleanupRefreshTokens);
    expect(first.processed).toBeGreaterThan(0);
    const second = await run(cleanupRefreshTokens);
    expect(second.processed).toBe(0);
  });
});

/* ══ E — SLA breach detection ═════════════════════════════════════════════ */

async function seedBankOrder(sla: Date | null, status = "In Progress"): Promise<string> {
  const n = uniq();
  const assignee = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });

  const [customer] = await ctx.db
    .insert(customers)
    .values({
      code: `CUS-S${n}`,
      bankId: bank.id,
      bankReferenceId: `SREF-${n}`,
      name: `SLA Customer ${n}`,
      mobile: `95${String(100000000 + n)}`,
    })
    .returning();

  const [loan] = await ctx.db
    .insert(loans)
    .values({
      code: `LN-S${n}`,
      customerId: customer!.id,
      bankId: bank.id,
      loanType: "Personal Loan",
      status: "Submitted",
      amountRequested: "100000",
      assignedUserId: assignee.id,
    })
    .returning();

  const [order] = await ctx.db
    .insert(bankOrders)
    .values({
      code: `BO-S${n}`,
      loanId: loan!.id,
      bankId: bank.id,
      customerId: customer!.id,
      stage: "Login",
      status,
      sla,
    })
    .returning();

  return order!.id;
}

const slaNotifications = async (orderId: string) => {
  const rows = await ctx.db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recordType, "bank_order"),
        eq(notifications.recordId, orderId),
        eq(notifications.eventType, "bank_order.sla_breached"),
      ),
    );
  return rows[0]?.n ?? 0;
};

describe("E · detect-sla-breach", () => {
  it("26. THE FINDING: a breached order notifies the people accountable for the file", async () => {
    // `bank_orders.sla` had a column and an index and no query that read it.
    const orderId = await seedBankOrder(ago(1));
    const result = await run(detectSlaBreach);
    expect(result.failed).toBe(0);
    expect(await slaNotifications(orderId)).toBeGreaterThan(0);
  });

  it("27. an order still inside its SLA is silent", async () => {
    const orderId = await seedBankOrder(ahead(2));
    await run(detectSlaBreach);
    expect(await slaNotifications(orderId)).toBe(0);
  });

  it("28. a CLEARED order does not breach, however old the SLA", async () => {
    const orderId = await seedBankOrder(ago(30), "Cleared");
    await run(detectSlaBreach);
    expect(await slaNotifications(orderId)).toBe(0);
  });

  it("29. an order with no SLA set is never selected", async () => {
    const orderId = await seedBankOrder(null);
    await run(detectSlaBreach);
    expect(await slaNotifications(orderId)).toBe(0);
  });

  it("30. THE IDEMPOTENCE: running hourly does not re-notify", async () => {
    // Migration 0011's partial unique index on (user_id, event_key) is what
    // guarantees this, not a flag column the application has to remember to
    // set and reset. The event key has no discriminator, so it is constant.
    const orderId = await seedBankOrder(ago(1));
    await run(detectSlaBreach);
    const after = await slaNotifications(orderId);

    await run(detectSlaBreach);
    await run(detectSlaBreach);
    expect(await slaNotifications(orderId)).toBe(after);
  });

  it("31. the notification links somewhere real and names the stage", async () => {
    const orderId = await seedBankOrder(ago(1));
    await run(detectSlaBreach);

    const [row] = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.recordId, orderId), eq(notifications.eventType, "bank_order.sla_breached")),
      );
    expect(row!.linkHref).toContain("/bank-orders");
    expect(row!.message).toContain("Login");
    expect(row!.severity).toBe("warning");
  });
});

/* ══ F — the whole run ════════════════════════════════════════════════════ */

describe("F · `jobs all`", () => {
  beforeEach(async () => {
    // Drain anything earlier groups left, so this group measures a clean run.
    await runAllJobs({ db: ctx.db });
  });

  it("32. every job runs, in registry order, and the run succeeds", async () => {
    const results = await runAllJobs({ db: ctx.db });
    expect(results.map((r) => r.name)).toEqual(JOBS.map((j) => j.name));
    expect(allSucceeded(results)).toBe(true);
  });

  it("33. a full run picks up work of every kind in one pass", async () => {
    const batchId = await seedExpiredBatch();
    const { customerId } = await seedDeletedCustomer(ago(1));
    const tokenId = await seedToken({ expiresAt: ago(GRACE_DAYS + 5) });
    const orderId = await seedBankOrder(ago(1));

    const results = await runAllJobs({ db: ctx.db });
    expect(allSucceeded(results)).toBe(true);

    expect(await stagedRowCount(batchId)).toBe(0);
    expect(await ctx.db.select().from(customers).where(eq(customers.id, customerId))).toHaveLength(0);
    expect(await tokenExists(tokenId)).toBe(false);
    expect(await slaNotifications(orderId)).toBeGreaterThan(0);
  });
});
