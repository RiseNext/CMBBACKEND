import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, count, eq } from "drizzle-orm";
import { createTestContext, createUser, destroyTestContext, type TestContext } from "./harness.js";
import { appSettings, auditLogs, customers, recycleBinEntries } from "../db/schema/index.js";

/**
 * APPLICATION SETTINGS — Task 12.6, and U-14 / OD-8.
 *
 * `app_settings` shipped in the first migration and was **completely dead** —
 * zero references outside the schema file. The settings screen's Company tab
 * was a set of uncontrolled inputs whose contents were discarded on every
 * keystroke, under the words "Printed on invoices"; Wave 1 removed them and
 * named this row as their owner.
 *
 * Group C is the one that makes this more than a key/value dump: the store has a
 * **live consumer**. `recycleBin.retentionDays` feeds `purgeDate()`, so changing
 * it changes when a deleted record becomes purgeable — measured through the real
 * delete path, not by reading the setting back.
 *
 * Group D is U-14: `settings.edit` is Super Admin and Admin, and stops there.
 */

const PASSWORD = "TestPassword123!";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let ctx: TestContext;
let superToken: string;
let adminToken: string;
let managerToken: string;

async function tokenFor(roleKey: string): Promise<string> {
  const user = await createUser(ctx.db, { roleKey });
  const res = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: user.email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

const get = (token: string) => request(ctx.app).get("/api/settings").set(bearer(token));
const patch = (token: string, body: Record<string, unknown>) =>
  request(ctx.app).patch("/api/settings").set(bearer(token)).send(body);

beforeAll(async () => {
  ctx = await createTestContext();
  superToken = await tokenFor("super_admin");
  adminToken = await tokenFor("admin");
  managerToken = await tokenFor("manager");
}, 60_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  // Each case starts from "nothing has ever been saved", so the default path and
  // the stored path are never confused for one another.
  await ctx.db.delete(appSettings);
});

/* ══ A — it persists, and the server is the authority ═════════════════════ */

describe("A · settings survive the request that set them", () => {
  it("1. THE FINDING: there is a settings endpoint at all, and it answers with defaults", async () => {
    const res = await get(superToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data["organisation.legalName"]).toBe("");
    // The retention default comes from RECYCLE_BIN_RETENTION_DAYS, not a literal.
    expect(typeof res.body.data["recycleBin.retentionDays"]).toBe("number");
  });

  it("2. a saved value is read back on a fresh request", async () => {
    const saved = await patch(superToken, { "organisation.legalName": "Risenext Advisory LLP" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const res = await get(superToken);
    expect(res.body.data["organisation.legalName"]).toBe("Risenext Advisory LLP");
  });

  it("3. PATCH returns the SERVER's whole resulting state, not the request echoed", async () => {
    // D-026: the client adopts the server row. A response that echoed the body
    // would let the screen show a value the database never accepted.
    const res = await patch(superToken, { "organisation.gstin": "  29ABCDE1234F1Z5  " });
    expect(res.status).toBe(200);
    // Trimmed by the schema — proof the value came back through the parser.
    expect(res.body.data["organisation.gstin"]).toBe("29ABCDE1234F1Z5");
    expect(res.body.data["organisation.legalName"]).toBe("");
  });

  it("4. a second save updates rather than duplicating the row", async () => {
    await patch(superToken, { "organisation.pan": "AAAAA0000A" });
    await patch(superToken, { "organisation.pan": "BBBBB1111B" });

    const [row] = await ctx.db
      .select({ n: count() })
      .from(appSettings)
      .where(eq(appSettings.key, "organisation.pan"));
    expect(row?.n).toBe(1);
    expect((await get(superToken)).body.data["organisation.pan"]).toBe("BBBBB1111B");
  });

  it("5. an unrelated key is untouched by a partial save", async () => {
    await patch(superToken, { "organisation.legalName": "Kept", "organisation.pan": "AAAAA0000A" });
    await patch(superToken, { "organisation.pan": "BBBBB1111B" });

    const res = await get(superToken);
    expect(res.body.data["organisation.legalName"]).toBe("Kept");
  });

  it("6. an empty body changes nothing and is not an error", async () => {
    await patch(superToken, { "organisation.legalName": "Unchanged" });
    const res = await patch(superToken, {});
    expect(res.status).toBe(200);
    expect(res.body.data["organisation.legalName"]).toBe("Unchanged");
  });

  it("7. the change is audited, and a no-op is not", async () => {
    const before = async () => {
      const [row] = await ctx.db
        .select({ n: count() })
        .from(auditLogs)
        .where(and(eq(auditLogs.recordType, "setting")));
      return row?.n ?? 0;
    };
    const start = await before();
    await patch(superToken, { "organisation.legalName": "Audited Ltd" });
    expect(await before()).toBe(start + 1);

    // Same value again — nothing changed, so nothing is written to an immutable,
    // unpurgeable table (SEC-017).
    await patch(superToken, { "organisation.legalName": "Audited Ltd" });
    expect(await before()).toBe(start + 1);
  });
});

/* ══ B — the registry is closed ═══════════════════════════════════════════ */

describe("B · only declared keys are accepted", () => {
  it("8. THE GUARD: an unknown key is a 400 naming it, not a silent drop", async () => {
    // A screen that reports success for a field the server ignored is the exact
    // shape D-004 forbids.
    const res = await patch(superToken, { "attacker.arbitrary": "anything" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("attacker.arbitrary");

    const [row] = await ctx.db
      .select({ n: count() })
      .from(appSettings)
      .where(eq(appSettings.key, "attacker.arbitrary"));
    expect(row?.n).toBe(0);
  });

  it("9. a value that fails its schema is a 422 that names the field", async () => {
    const res = await patch(superToken, { "recycleBin.retentionDays": 0 });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe("recycleBin.retentionDays");
  });

  it("10. one bad field rolls the WHOLE save back", async () => {
    // A partial save reported as a success is worse than a refusal: the operator
    // believes both fields took.
    const res = await patch(superToken, {
      "organisation.legalName": "Should not persist",
      "recycleBin.retentionDays": 99_999,
    });
    expect(res.status).toBe(422);
    expect((await get(superToken)).body.data["organisation.legalName"]).toBe("");
  });

  it("11. a string past its maximum length is refused rather than truncated", async () => {
    const res = await patch(superToken, { "organisation.gstin": "x".repeat(500) });
    expect(res.status).toBe(422);
  });
});

/* ══ C — the setting has a live consumer ══════════════════════════════════ */

describe("C · retentionDays actually changes what the system does", () => {
  /** Soft-deletes a customer through the real route and returns its purge date. */
  async function purgeDateAfterDelete(): Promise<Date> {
    const bankRes = await request(ctx.app)
      .post("/api/banks")
      .set(bearer(superToken))
      .send({
        code: `RB-${Math.floor(Math.random() * 100000)}`,
        name: "Retention Bank",
        shortName: "RB",
        vendorId: `VEN-${Math.floor(Math.random() * 100000)}`,
        commissionRate: 1,
      });
    expect(bankRes.status, JSON.stringify(bankRes.body)).toBe(201);

    const [customer] = await ctx.db
      .insert(customers)
      .values({
        code: `CUS-RET${Math.floor(Math.random() * 100000)}`,
        bankId: bankRes.body.data.id as string,
        bankReferenceId: `RETREF-${Math.floor(Math.random() * 100000)}`,
        name: "Retention Customer",
        mobile: `98${Math.floor(100000000 + Math.random() * 800000000)}`,
      })
      .returning();

    const del = await request(ctx.app)
      .delete(`/api/customers/${customer!.id}`)
      .set(bearer(superToken));
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    const [entry] = await ctx.db
      .select({ purgeAfter: recycleBinEntries.purgeAfter })
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, customer!.id));
    expect(entry?.purgeAfter).toBeTruthy();
    return entry!.purgeAfter as Date;
  }

  const daysFromNow = (date: Date) => Math.round((date.getTime() - Date.now()) / 86_400_000);

  it("12. with no setting stored, the environment default still applies", async () => {
    // The fallback IS the previous behaviour. An untouched deployment must be
    // unchanged by this task.
    expect(daysFromNow(await purgeDateAfterDelete())).toBe(30);
  });

  it("13. THE POINT: changing the setting changes the real purge window", async () => {
    const res = await patch(superToken, { "recycleBin.retentionDays": 7 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(daysFromNow(await purgeDateAfterDelete())).toBe(7);
  });

  it("14. a stored value that no longer satisfies its schema falls back rather than breaking deletes", async () => {
    // Written directly, as a schema tightened after the row was saved would
    // leave it. One bad row must not break every soft delete in the system.
    await ctx.db.insert(appSettings).values({
      key: "recycleBin.retentionDays",
      value: "not a number" as never,
    });
    expect(daysFromNow(await purgeDateAfterDelete())).toBe(30);
  });
});

/* ══ D — U-14 / OD-8: who may edit ════════════════════════════════════════ */

describe("D · settings.edit is Super Admin and Admin, and stops there", () => {
  it("15. Super Admin may edit", async () => {
    expect((await patch(superToken, { "organisation.legalName": "SA" })).status).toBe(200);
  });

  it("16. OD-8: Admin may edit", async () => {
    const res = await patch(adminToken, { "organisation.legalName": "By admin" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data["organisation.legalName"]).toBe("By admin");
  });

  it("17. Manager may NOT edit — and may not even read", async () => {
    // A retention window that field staff can shorten is a records-retention
    // control with no control. Manager holds neither settings key.
    expect((await patch(managerToken, { "organisation.legalName": "No" })).status).toBe(403);
    expect((await get(managerToken)).status).toBe(403);
  });

  it("18. a refused save writes nothing", async () => {
    await patch(managerToken, { "organisation.legalName": "No" });
    expect((await get(superToken)).body.data["organisation.legalName"]).toBe("");
  });

  it("19. Team Leader and Executive are refused", async () => {
    for (const roleKey of ["team_leader", "executive"]) {
      const token = await tokenFor(roleKey);
      expect((await get(token)).status).toBe(403);
      expect((await patch(token, { "organisation.pan": "X" })).status).toBe(403);
    }
  });

  it("20. an unauthenticated caller is refused on both routes", async () => {
    expect((await request(ctx.app).get("/api/settings")).status).toBe(401);
    expect((await request(ctx.app).patch("/api/settings").send({})).status).toBe(401);
  });
});
