import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  customerPayload,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { logger } from "../lib/logger.js";
import * as schema from "../db/schema/index.js";

/**
 * CUSTOMER IDENTIFIER VALIDATION — BUG-017 (Task 1.9)
 *
 * The command palette navigated to `/customers/CUS-10001`; the detail page
 * passed that segment to `GET /api/customers/:id`, which compared it against a
 * `uuid` column. Postgres raised `22P02`, the error handler did not map it, and
 * the caller got a **500** while the server logged the SQL, the bound params
 * and a stack trace — on every search selection.
 *
 * Two halves are pinned here:
 *
 *   1. A malformed `:id` is a 422 `validation_failed` naming `id`, on all three
 *      customer verbs — not just GET, which is all the bug report named.
 *   2. Everything that must NOT change: a valid uuid still resolves, an absent
 *      one is still 404, `/check/reference` is still reachable, authorization
 *      still precedes validation, and a **genuine** database fault is still a
 *      500 with an error-level log.
 *
 * Group F is the important one. The tempting fix for this bug is to map `22P02`
 * centrally in `error-handler.ts`; that would convert real server faults —
 * including a mis-minted JWT `sub`, which fails inside `requireAuth` on every
 * request — into an unlogged 4xx. Group F fails if anyone ever ships it.
 */

const MALFORMED = "not-a-uuid";
const ABSENT_UUID = "00000000-0000-4000-8000-000000000000";

let ctx: TestContext;
let bank: { id: string; code: string };
let adminToken: string;
let customerId: string;
let customerCode: string;

async function login(email: string, password = "TestPassword123!") {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  return res.body?.accessToken as string;
}

const authed = (method: "get" | "patch" | "delete", path: string, token = adminToken) =>
  request(ctx.app)[method](path).set("Authorization", `Bearer ${token}`);

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Lookup Bank");
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  adminToken = await login(admin.email);

  const created = await request(ctx.app)
    .post("/api/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(customerPayload(bank.id, "LOOKUP-REF-1"));
  expect(created.status).toBe(201);
  customerId = created.body.data.id;
  customerCode = created.body.data.code;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("A2 — the search corpus the list page's placeholder promises (Task 4.5 / D-053)", () => {
  /*
   * The customers list advertises "name, mobile, PAN, customer code, or bank
   * reference". Before Task 4.5 that promise was kept client-side over at most
   * 100 loaded rows; moving search to the server would have silently dropped
   * PAN, which is why `pan` joined the `or(...)`. These cases pin every field
   * the placeholder names, so the two cannot drift apart again.
   */
  /** `customerPayload` carries no `pan`, so this block owns a customer that has one. */
  const PAN = "ZYXPK4321Q";
  let panCustomerId: string;

  beforeAll(async () => {
    const created = await request(ctx.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(customerPayload(bank.id, "LOOKUP-PAN-1", { pan: PAN, name: "Pan Searchable" }));
    expect(created.status).toBe(201);
    panCustomerId = created.body.data.id;
  });

  it("matches on PAN — the field Task 4.5 preserved rather than dropped", async () => {
    const res = await authed("get", `/api/customers?search=${encodeURIComponent(PAN)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { id: string }) => row.id)).toContain(panCustomerId);
  });

  it("matches on customer code and on bank reference", async () => {
    for (const needle of [customerCode, "LOOKUP-REF-1"]) {
      const res = await authed("get", `/api/customers?search=${encodeURIComponent(needle)}`);
      expect(res.status, needle).toBe(200);
      expect(res.body.data.map((row: { id: string }) => row.id), needle).toContain(customerId);
    }
  });

  it("does NOT match on the raw uuid — the placeholder no longer promises ID", async () => {
    const res = await authed("get", `/api/customers?search=${customerId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { id: string }) => row.id)).not.toContain(customerId);
  });
});

describe("A — the global-search journey end to end", () => {
  it("search returns a customer whose id resolves and whose code does not", async () => {
    // Exactly the request the command palette issues (topbar.tsx:66-70).
    const search = await authed("get", `/api/customers?search=Test%20Customer&pageSize=5`);
    expect(search.status).toBe(200);
    expect(search.body.data.length).toBeGreaterThan(0);

    const row = search.body.data[0];
    expect(row.id).toBe(customerId);
    expect(row.code).toBe(customerCode);

    // The palette must link by `id`: that resolves.
    const byId = await authed("get", `/api/customers/${row.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.data.id).toBe(customerId);

    // Linking by `code` is what BUG-017 did. It is a client error, not a 500 —
    // this is the contract the frontend has to satisfy.
    const byCode = await authed("get", `/api/customers/${row.code}`);
    expect(byCode.status).toBe(422);
    expect(byCode.body.error.code).toBe("validation_failed");
    expect(byCode.body.error.details[0].path).toBe("id");
  });
});

describe("B — a malformed :id is 422 on every customer verb", () => {
  // BUG-017 named only GET. PATCH and DELETE were measured to 500 identically.
  const verbs = [
    ["get", "GET"],
    ["patch", "PATCH"],
    ["delete", "DELETE"],
  ] as const;

  for (const [method, label] of verbs) {
    it(`${label} /api/customers/${MALFORMED} returns 422, not 500`, async () => {
      const res = await authed(method, `/api/customers/${MALFORMED}`).send(
        method === "patch" ? { name: "Renamed" } : undefined,
      );

      expect(res.status).not.toBe(500);
      expect(res.status).toBe(422);
    });
  }

  it("the 422 uses the standard validation_failed envelope and names `id`", async () => {
    const res = await authed("get", `/api/customers/${MALFORMED}`);

    // Same envelope as every other validation failure in the API.
    expect(Object.keys(res.body)).toEqual(["error"]);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.message).toBe("The submitted data is not valid");
    expect(res.body.error.details).toEqual([{ path: "id", message: "Invalid UUID" }]);
  });

  it("PATCH reports the id before the body, because it is the more fundamental error", async () => {
    // Both are invalid here. The id must win: reporting `path: "name"` for a
    // request whose id was never a uuid sends the caller after the wrong thing.
    const res = await authed("patch", `/api/customers/${MALFORMED}`).send({ name: "x" });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe("id");
  });

  it("no error-level log is written, and nothing about the query leaks", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const res = await authed("get", `/api/customers/${customerCode}`);

    expect(res.status).toBe(422);
    // The 500 path logged the full SQL, the bound parameters and a stack trace
    // on every mistyped URL — caller-driven log amplification (cf. SEC-018).
    expect(error).not.toHaveBeenCalled();

    // And the response must not echo the submitted value or the pg message,
    // which contains both the column type and the raw input.
    expect(res.text).not.toContain("invalid input syntax");
    expect(res.text).not.toContain("select ");
    expect(res.text).not.toContain(customerCode);
    expect(res.text).not.toMatch(/\.ts:\d+/);
  });
});

describe("C — what must not change: valid and absent identifiers", () => {
  it("a valid uuid still returns the customer", async () => {
    const res = await authed("get", `/api/customers/${customerId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(customerId);
    expect(res.body.data.code).toBe(customerCode);
  });

  it("a well-formed but absent uuid is still 404, with the record message", async () => {
    const res = await authed("get", `/api/customers/${ABSENT_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
    // Asserting the MESSAGE, not just the code: `notFoundHandler` emits
    // `not_found` too, with "Route not found". This must be the record branch,
    // which deliberately does not distinguish absent from out-of-scope.
    expect(res.body.error.message).toBe("Customer not found");
  });

  it("guards against a validator that swallows absence into malformedness", async () => {
    const malformed = await authed("get", `/api/customers/${MALFORMED}`);
    const absent = await authed("get", `/api/customers/${ABSENT_UUID}`);
    expect([malformed.status, absent.status]).toEqual([422, 404]);
  });
});

describe("D — /check/reference is reachable; `:id` matches one segment only", () => {
  /**
   * BUG-027 claimed this route was shadowed by `/:id` and returned 500. It is
   * not, and it does not: `/:id` compiles to a single-segment matcher under
   * path-to-regexp 8, so it cannot span `/check/reference`. Registration order
   * is genuinely as BUG-027 describes and is genuinely irrelevant.
   *
   * These tests are deliberately NOT about registration order — they assert
   * reachability by signature, which is what would actually break.
   */
  it("reaches its own handler and answers availability", async () => {
    const res = await authed(
      "get",
      `/api/customers/check/reference?bankId=${bank.id}&bankReferenceId=BRAND-NEW-REF`,
    );
    // Only customers.routes.ts:322 can produce this body.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });

  it("reports a taken reference as a 409 carrying the existing customer code", async () => {
    const res = await authed(
      "get",
      `/api/customers/check/reference?bankId=${bank.id}&bankReferenceId=LOOKUP-REF-1`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
    expect(res.body.error.details.existingCustomerCode).toBe(customerCode);
  });

  it("with no query, fails on ITS OWN schema — bankId/bankReferenceId, never id", async () => {
    const res = await authed("get", "/api/customers/check/reference");
    expect(res.status).toBe(422);

    // The load-bearing assertion. Now that `:id` also yields 422, a status-only
    // check would pass even if `/check/reference` were genuinely swallowed by
    // the `:id` handler. The `details` paths are the only signal that
    // distinguishes "the literal route's own schema ran" from "`:id` ate it".
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(["bankId", "bankReferenceId"]);
    expect(paths).not.toContain("id");
  });

  it("a single-segment literal IS captured by :id — the real, surviving hazard", async () => {
    // This is the grain of truth in BUG-027. `/check` is one segment, so a
    // literal route added there after :145 would be unreachable. It used to
    // fail as a 500; it now fails legibly.
    const res = await authed("get", "/api/customers/check");
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe("id");
  });

  it("a multi-segment unknown path is still a routing 404", async () => {
    const res = await authed("get", "/api/customers/a/b/c");
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("Route not found");
  });
});

describe("E — authorization still precedes validation", () => {
  /**
   * The reason this fix is inside the handlers rather than in a `router.param`
   * hook: those run BEFORE `requirePermission`, which would turn these 403s and
   * 401s into 422s and hand input-shape feedback to callers who may have no
   * business touching customers at all.
   */
  it("an unauthenticated request with a malformed id is 401, not 422", async () => {
    const res = await request(ctx.app).get(`/api/customers/${MALFORMED}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("a bad token with a malformed id is 401, not 422", async () => {
    const res = await request(ctx.app)
      .get(`/api/customers/${MALFORMED}`)
      .set("Authorization", "Bearer garbage.token.value");
    expect(res.status).toBe(401);
  });

  it("a caller lacking customers.view gets 403 on all three verbs, not 422", async () => {
    const [role] = await ctx.db
      .insert(schema.roles)
      .values({ key: "lookup_no_perms", name: "Lookup No Perms", level: 95, isSystem: false })
      .returning();
    const user = await createUser(ctx.db, { roleKey: "executive" });
    await ctx.db
      .update(schema.users)
      .set({ roleId: role!.id })
      .where(eq(schema.users.id, user.id));
    const token = await login(user.email);

    for (const method of ["get", "patch", "delete"] as const) {
      const res = await authed(method, `/api/customers/${MALFORMED}`, token).send(
        method === "patch" ? { name: "x" } : undefined,
      );
      expect(res.status, `${method} should be 403`).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
    }
  });
});

describe("F — a genuine database failure is still a 500 with an error-level log", () => {
  /**
   * The anti-over-mapping guard, and the reason this group owns its own
   * context: it destroys the schema.
   *
   * If someone later "simplifies" this fix by mapping `22P02` in
   * `error-handler.ts`, real faults start returning 4xx and — because
   * `error-handler.ts:58` only logs at `error` for status >= 500 — stop being
   * logged at all. This test fails the moment that happens.
   */
  let broken: TestContext;
  let token: string;

  beforeAll(async () => {
    broken = await createTestContext();
    const admin = await createUser(broken.db, { roleKey: "super_admin" });
    const res = await request(broken.app)
      .post("/api/auth/login")
      .send({ email: admin.email, password: "TestPassword123!" });
    token = res.body.accessToken;
    await broken.client.query("DROP TABLE customers CASCADE");
  });

  afterAll(async () => {
    await destroyTestContext(broken);
  });

  it("a valid uuid against a missing table is 500 and logs once at error", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const res = await request(broken.app)
      .get(`/api/customers/${ABSENT_UUID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "internal_error", message: "Unexpected server error" },
    });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("the terminal branch still leaks nothing to the client", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const res = await request(broken.app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(Object.keys(res.body)).toEqual(["error"]);
    expect(res.text).not.toContain("customers");
    expect(res.text).not.toMatch(/\.ts:\d+/);
  });
});
