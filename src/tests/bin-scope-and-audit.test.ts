import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import * as schema from "../db/schema/index.js";

/**
 * SEC-013 (Task 13.9) AND THE TWO UNWRITTEN AUDIT ACTIONS (Task 13.12).
 *
 * **SEC-013** — both recycle-bin write routes read
 * `if (entry.bankId) assertBankAccess(...)`, so an entry with a NULL bank
 * **skipped the scope check entirely**. `recycle_bin.restore` is granted to
 * Manager, so this was never Super-Admin-only. D-075 records that Task 9.8 made
 * it worse: an out-of-scope permanent-delete now destroys the **KYC file**, not
 * just the row.
 *
 * The fix is deliberately *not* "refuse every scoped caller on a null bank" —
 * that was the first attempt and four cases in `user-recycle-bin.test.ts`
 * caught it, because `user` entries are always bank-less and their authority is
 * the role hierarchy (D-030), not bank scope. Group A pins both halves: the
 * hole is closed **and** the capability it would have taken with it survives.
 *
 * **13.12** — `logout` and `permission_denied` are declared `AuditAction`s that
 * nothing ever wrote. A session could begin in the audit trail and never end,
 * and a refused attempt to cross the authorisation boundary left no trace at
 * all — which is the single most useful signal during an incident.
 */

const PASSWORD = "TestPassword123!";

let ctx: TestContext;
let bankA: { id: string; code: string };
let bankB: { id: string; code: string };

beforeAll(async () => {
  ctx = await createTestContext();
  bankA = await createBank(ctx.db);
  bankB = await createBank(ctx.db);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

async function tokenFor(roleKey: string, bankIds?: string[]) {
  const user = await createUser(ctx.db, { roleKey, ...(bankIds ? { bankIds } : {}) });
  const res = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: user.email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { token: res.body.accessToken as string, user };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Puts a bin entry in directly, so the bank on it is exactly what we choose. */
let binSeq = 0;
async function binEntry(recordType: string, bankId: string | null) {
  binSeq += 1;
  const [row] = await ctx.db
    .insert(schema.recycleBinEntries)
    .values({
      recordType,
      recordId: "00000000-0000-4000-8000-0000000000" + String(10 + binSeq).slice(-2),
      bankId,
      label: `Binned ${recordType} ${binSeq}`,
      snapshot: {} as never,
      purgeAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return row!.id;
}

/* ══ A — SEC-013 ══════════════════════════════════════════════════════════ */

describe("A · SEC-013 — a bin entry with no bank is not a free-for-all", () => {
  it("1. THE FINDING: a scoped caller cannot restore a bank-less service_provider", async () => {
    const { token } = await tokenFor("manager", [bankA.id]);
    const id = await binEntry("service_provider", null);

    // Pre-fix `if (entry.bankId)` was false, so the scope check was skipped
    // entirely and this succeeded.
    const res = await request(ctx.app)
      .post(`/api/recycle-bin/${id}/restore`)
      .set(auth(token));
    expect(res.status).toBe(403);
  });

  it("2. and cannot permanently delete one — the path that now destroys a KYC file", async () => {
    const { token } = await tokenFor("admin", [bankA.id]);
    const id = await binEntry("service_provider", null);

    const res = await request(ctx.app)
      .post(`/api/recycle-bin/${id}/permanent-delete`)
      .set(auth(token))
      .send({ confirm: true });
    expect(res.status).toBe(403);
  });

  it("3. an UNSCOPED caller still can — the record has to be reachable by someone", async () => {
    const { token } = await tokenFor("super_admin");
    const id = await binEntry("service_provider", null);

    const res = await request(ctx.app)
      .post(`/api/recycle-bin/${id}/restore`)
      .set(auth(token));
    // Not 403. (The restore itself may fail on the absent target row; the
    // authorisation gate is what this case is about.)
    expect(res.status).not.toBe(403);
  });

  it("4. a null bank on a BANK-OWNED type fails closed — that is corrupt data", async () => {
    const { token } = await tokenFor("manager", [bankA.id]);
    const id = await binEntry("customer", null);

    const res = await request(ctx.app)
      .post(`/api/recycle-bin/${id}/restore`)
      .set(auth(token));
    expect(res.status).toBe(403);
  });

  it("5. ordinary cross-bank scoping is unchanged", async () => {
    const { token } = await tokenFor("manager", [bankA.id]);
    const id = await binEntry("customer", bankB.id);

    const res = await request(ctx.app)
      .post(`/api/recycle-bin/${id}/restore`)
      .set(auth(token));
    expect(res.status).toBe(403);
  });

  it("6. THE REGRESSION THE FIRST FIX WOULD HAVE CAUSED: a scoped Manager may still act on a `user` entry", async () => {
    /*
     * `user` entries are ALWAYS bank-less, and D-030 deliberately made the role
     * hierarchy their authority rather than bank scope. Blanket-refusing scoped
     * callers on a null bank would have removed employee restore from every
     * Manager and left it to Super Admin alone.
     */
    const { token } = await tokenFor("manager", [bankA.id]);
    const id = await binEntry("user", null);

    const res = await request(ctx.app)
      .post(`/api/recycle-bin/${id}/restore`)
      .set(auth(token));
    // Refused or not by the HIERARCHY — but never by bank scope, and the
    // message must not be the scope one.
    expect(JSON.stringify(res.body)).not.toMatch(/belongs to no bank/);
  });
});

/* ══ B — 13.12: logout ════════════════════════════════════════════════════ */

describe("B · logout is audited", () => {
  const logoutRows = (userId: string) =>
    ctx.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "logout"), eq(schema.auditLogs.actorId, userId)))
      .orderBy(desc(schema.auditLogs.occurredAt));

  it("7. THE FINDING: a real logout writes a `logout` row naming the user", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD });

    expect(await logoutRows(user.id)).toHaveLength(0);
    const res = await agent.post("/api/auth/logout");
    expect(res.status).toBe(204);

    const rows = await logoutRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordType).toBe("auth");
  });

  it("8. a logout with NO cookie writes nothing — it revoked nothing", async () => {
    /*
     * Otherwise an anonymous caller could fill a trigger-immutable, unpurgeable
     * table at will, which is SEC-002's shape one route over.
     */
    const before = await ctx.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "logout"));
    const res = await request(ctx.app).post("/api/auth/logout");
    expect(res.status).toBe(204);

    const after = await ctx.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "logout"));
    expect(after.length).toBe(before.length);
  });

  it("9. logging out twice records once — the second revoked nothing", async () => {
    const user = await createUser(ctx.db, { roleKey: "executive" });
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD });

    await agent.post("/api/auth/logout");
    await agent.post("/api/auth/logout");

    expect(await logoutRows(user.id)).toHaveLength(1);
  });
});

/* ══ C — 13.12: permission_denied ═════════════════════════════════════════ */

describe("C · a refused authorization leaves a trace", () => {
  const denials = () =>
    ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "permission_denied"))
      .orderBy(desc(schema.auditLogs.occurredAt));

  it("10. THE FINDING: a 403 on a missing permission writes a row", async () => {
    const { token, user } = await tokenFor("executive", [bankA.id]);

    // Executive holds no `roles.view`.
    const res = await request(ctx.app).get("/api/roles").set(auth(token));
    expect(res.status).toBe(403);

    // Fire-and-forget, so give the insert a tick to land.
    await new Promise((r) => setTimeout(r, 60));

    const rows = await denials();
    const mine = rows.filter((r) => r.actorId === user.id);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0]!.recordType).toBe("authorization");
  });

  it("11. the row names the permission that was required", async () => {
    const { token, user } = await tokenFor("executive", [bankA.id]);
    await request(ctx.app).get("/api/audit-logs").set(auth(token));
    await new Promise((r) => setTimeout(r, 60));

    const mine = (await denials()).filter((r) => r.actorId === user.id);
    expect(JSON.stringify(mine[0]!.metadata)).toContain("audit_logs.view");
  });

  it("12. it records the PERMISSION KEYS, never the request body", async () => {
    /*
     * A refused customer write carries full customer PII, and `audit_logs` is
     * trigger-immutable with no retention job (SEC-017). Recording the body of
     * an operation that never happened, into a table that can never be purged,
     * would be strictly worse than not recording it at all.
     */
    const { token, user } = await tokenFor("executive", [bankA.id]);
    const secret = "Rajesh-Very-Identifiable-9876543210";

    await request(ctx.app)
      .post("/api/roles")
      .set(auth(token))
      .send({ key: "x", name: secret, level: 99 });
    await new Promise((r) => setTimeout(r, 60));

    const mine = (await denials()).filter((r) => r.actorId === user.id);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(mine)).not.toContain(secret);
  });

  it("13. an UNAUTHENTICATED request writes nothing — there is no actor to attribute", async () => {
    const before = (await denials()).length;
    await request(ctx.app).get("/api/roles");
    await new Promise((r) => setTimeout(r, 60));

    // Recording every anonymous 401 would let an unauthenticated caller fill an
    // immutable table — SEC-002 exactly.
    expect((await denials()).length).toBe(before);
  });

  it("14. a SUCCESSFUL authorization writes no denial", async () => {
    const { token, user } = await tokenFor("super_admin");
    const res = await request(ctx.app).get("/api/roles").set(auth(token));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 60));

    expect((await denials()).filter((r) => r.actorId === user.id)).toHaveLength(0);
  });
});
