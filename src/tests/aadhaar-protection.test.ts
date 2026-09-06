import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, getTableColumns } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import * as schema from "../db/schema/index.js";
import { CUSTOMER_COLUMNS } from "../modules/customers.routes.js";
import { peppered } from "../lib/password.js";
import { loadEnv } from "../config/env.js";

/**
 * SEC-007 (P0) — AADHAAR HASH EXPOSURE. Task 13.4.
 *
 * Three defects in one finding, and all three are tested here:
 *
 *   1. **`aadhaar_hash` was returned to clients.** Four call sites used a bare
 *      `.select()` / `.returning()`, and Drizzle returns every column for both,
 *      so the digest was in the list, detail, create and update responses — to
 *      any holder of `customers.view`, and into the browser and its cache.
 *   2. **The pepper defaulted to a value published in this repository**, guarded
 *      only by a `NODE_ENV === "production"` check. Staging and UAT — the
 *      environments that get real data for acceptance testing — peppered live
 *      Aadhaar numbers with a public constant.
 *   3. **The digest was `sha256(pepper + ":" + value)`**, which is length-
 *      extendable and has no domain separation, over a **10^12** keyspace.
 *
 * Group A is the one that matters most and is written as a **whole-response
 * sweep** rather than a field check: asserting `body.aadhaarHash` is undefined
 * would pass while the digest sat one level down in a nested object. The sweep
 * serialises the entire response and looks for the digest itself.
 */

const PASSWORD = "TestPassword123!";

let ctx: TestContext;
let bank: { id: string; code: string };
let token: string;

const AADHAAR = "123412341234";

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  const res = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: admin.email, password: PASSWORD });
  token = res.body.accessToken as string;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

const auth = () => ({ Authorization: `Bearer ${token}` });

let seq = 0;
async function createCustomer(aadhaar: string | null = AADHAAR) {
  seq += 1;
  return request(ctx.app)
    .post("/api/customers")
    .set(auth())
    .send({
      bankId: bank.id,
      bankReferenceId: `REF-SEC7-${seq}`,
      name: `PII Customer ${seq}`,
      mobile: `98480${String(10000 + seq)}`,
      monthlyIncome: 50000,
      ...(aadhaar ? { aadhaar } : {}),
    });
}

/** The digest the server would have stored for this number. */
const digestOf = (raw: string) => peppered(raw, process.env.AADHAAR_PEPPER!);

/* ══ A — the digest never leaves the server ═══════════════════════════════ */

describe("A · `aadhaar_hash` is absent from every response that carries a customer", () => {
  it("1. it is stored — the control is not simply 'stop hashing'", async () => {
    const created = await createCustomer();
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const [row] = await ctx.db
      .select({ h: schema.customers.aadhaarHash, last4: schema.customers.aadhaarLast4 })
      .from(schema.customers)
      .where(eq(schema.customers.id, created.body.data.id))
      .limit(1);

    expect(row!.h).toBeTruthy();
    expect(row!.h).toBe(digestOf(AADHAAR));
    expect(row!.last4).toBe("1234");
  });

  it("2. THE FINDING — the CREATE response does not contain the digest", async () => {
    const res = await createCustomer();
    const serialised = JSON.stringify(res.body);

    expect(res.body.data.aadhaarHash).toBeUndefined();
    // The sweep is the assertion that matters: a field check would pass while
    // the digest sat nested one level down.
    expect(serialised).not.toContain(digestOf(AADHAAR));
  });

  it("3. the DETAIL response does not contain the digest", async () => {
    const created = await createCustomer();
    const res = await request(ctx.app)
      .get(`/api/customers/${created.body.data.id}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.aadhaarHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(digestOf(AADHAAR));
  });

  it("4. the LIST response does not contain the digest", async () => {
    await createCustomer();
    const res = await request(ctx.app).get("/api/customers?pageSize=100").set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) expect(row.aadhaarHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(digestOf(AADHAAR));
  });

  it("5. the UPDATE response does not contain the digest", async () => {
    const created = await createCustomer();
    const res = await request(ctx.app)
      .patch(`/api/customers/${created.body.data.id}`)
      .set(auth())
      .send({ city: "Hyderabad" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.aadhaarHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(digestOf(AADHAAR));
  });

  it("6. re-hashing a NEWLY supplied number does not leak it on the way back either", async () => {
    const created = await createCustomer(null);
    const res = await request(ctx.app)
      .patch(`/api/customers/${created.body.data.id}`)
      .set(auth())
      .send({ aadhaar: "999988887777" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(digestOf("999988887777"));
  });

  it("7. `aadhaarLast4` IS still returned — the screen needs it and 4 digits carry no risk", async () => {
    const created = await createCustomer();
    expect(created.body.data.aadhaarLast4).toBe("1234");
  });
});

/* ══ B — the projection is the mechanism, so pin the projection ═══════════ */

describe("B · the shared projection is what makes the omission durable", () => {
  it("8. `CUSTOMER_COLUMNS` does not mention aadhaarHash", () => {
    expect(Object.keys(CUSTOMER_COLUMNS)).not.toContain("aadhaarHash");
  });

  it("9. it covers every OTHER column on the table, so nothing was dropped by accident", () => {
    // `getTableColumns` is Drizzle's own accessor, so this reads the real
    // column set rather than guessing at object keys on the table proxy.
    const onTable = Object.keys(getTableColumns(schema.customers));
    const projected = new Set(Object.keys(CUSTOMER_COLUMNS));

    const missing = onTable.filter((c) => c !== "aadhaarHash" && !projected.has(c));
    expect(missing, `columns absent from CUSTOMER_COLUMNS: ${missing.join(", ")}`).toEqual([]);
  });
});

/* ══ C — the pepper is required, long, and not the published one ══════════ */

describe("C · AADHAAR_PEPPER is required in EVERY environment, not only production", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://localhost:5432/test",
    JWT_ACCESS_SECRET: "a".repeat(40),
    JWT_REFRESH_SECRET: "b".repeat(40),
  };

  it("10. THE FINDING: boot fails with no pepper, in a NON-production environment", () => {
    // Pre-fix this booted happily on the repository's published default.
    expect(() => loadEnv({ ...base } as NodeJS.ProcessEnv)).toThrow(/AADHAAR_PEPPER/);
  });

  it("11. the published placeholder is refused by name", () => {
    expect(() =>
      loadEnv({ ...base, AADHAAR_PEPPER: "dev-only-pepper-change-me!!" } as NodeJS.ProcessEnv),
    ).toThrow(/AADHAAR_PEPPER/);
  });

  it("12. a short key is refused — it is an HMAC key over a 10^12 keyspace", () => {
    expect(() =>
      loadEnv({ ...base, AADHAAR_PEPPER: "too-short" } as NodeJS.ProcessEnv),
    ).toThrow(/AADHAAR_PEPPER/);
  });

  it("13. a real key boots", () => {
    const env = loadEnv({ ...base, AADHAAR_PEPPER: "x".repeat(48) } as NodeJS.ProcessEnv);
    expect(env.AADHAAR_PEPPER).toHaveLength(48);
  });
});

/* ══ D — the digest is an HMAC, not a concatenated hash ═══════════════════ */

describe("D · the construction is HMAC-SHA256", () => {
  it("14. it matches HMAC and NOT the old sha256(pepper + ':' + value) form", async () => {
    const { createHash, createHmac } = await import("node:crypto");
    const pepper = "a-test-pepper-that-is-long-enough-for-hmac";

    const actual = peppered(AADHAAR, pepper);
    expect(actual).toBe(createHmac("sha256", pepper).update(AADHAAR).digest("hex"));

    const oldForm = createHash("sha256").update(`${pepper}:${AADHAAR}`).digest("hex");
    expect(actual).not.toBe(oldForm);
  });

  it("15. the pepper genuinely participates — two peppers give two digests", () => {
    const a = peppered(AADHAAR, "pepper-one-that-is-long-enough-for-hmac!!");
    const b = peppered(AADHAAR, "pepper-two-that-is-long-enough-for-hmac!!");
    expect(a).not.toBe(b);
  });

  it("16. it is deterministic, or duplicate detection could never work", () => {
    const pepper = "a-stable-pepper-long-enough-for-hmac-keys";
    expect(peppered(AADHAAR, pepper)).toBe(peppered(AADHAAR, pepper));
  });
});
