import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { DEFAULT_ROLES } from "../lib/permissions.js";

/**
 * THE FIVE-ROLE PERMISSION MATRIX — roadmap Q9 / 16.2's automatable half.
 *
 * ── WHAT WAS MISSING ────────────────────────────────────────────────────────
 *
 * `Q9 — role-based tests for all 5 roles` read **NOT STARTED** through fourteen
 * waves, and the reason it stayed that way is instructive: almost every one of
 * the 1,200 backend cases signs in as Super Admin, because Super Admin is the
 * role that can set up the fixture. Individual routes have excellent
 * role-specific coverage — `authorization.test.ts`, `team-edit.test.ts`,
 * `settings.test.ts` — but nothing ever asked the flat question:
 *
 *     for each of the five seeded roles, on each significant endpoint,
 *     is the answer the one the catalogue promises?
 *
 * ── WHY A TABLE AND NOT MORE PROSE CASES ────────────────────────────────────
 *
 * Because the failure this catches is a **grant drift**, not a logic bug.
 * Somebody widens a seeded role by one key — the way `settings.edit` was widened
 * in Wave 4, deliberately and with a decision behind it — and nothing outside
 * that key's own test notices. A matrix fails on the row that changed and names
 * it, which is the shortest path from "CI is red" to "we granted Manager
 * something".
 *
 * ── HOW EXPECTATIONS ARE DERIVED, AND WHY THAT IS NOT CIRCULAR ──────────────
 *
 * Each row names the **permission the route requires**, and the expectation is
 * computed from `DEFAULT_ROLES`. That looks circular — the catalogue checking
 * itself — and it is not, because the two things it joins are independent:
 *
 *   · the **route's** requirement lives in `requirePermission(...)` in a
 *     handler, hand-copied into this table;
 *   · the **role's** grant lives in `permissions.ts`.
 *
 * A route that stops enforcing its key, or enforces a different one, breaks
 * here even though `permissions.ts` is untouched. That is exactly the drift
 * worth catching, and it is the half a hand-written expectation would get wrong
 * first.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * It is not 16.2. Walking each role through the product by hand — can a Team
 * Leader actually complete a file end to end? — needs a person, and it stays
 * EXTERNAL/PENDING. This proves the API's answers, not that the journeys work.
 */

const PASSWORD = "TestPassword123!";
const ROLE_KEYS = ["super_admin", "admin", "manager", "team_leader", "executive"] as const;
type RoleKey = (typeof ROLE_KEYS)[number];

/** What the catalogue says this role holds. `"*"` is Super Admin. */
function grantsOf(roleKey: RoleKey): Set<string> {
  const seed = DEFAULT_ROLES.find((role) => role.key === roleKey);
  if (!seed) throw new Error(`${roleKey} is not a seeded role`);
  return seed.permissions === "*" ? new Set(["*"]) : new Set(seed.permissions);
}

const holds = (roleKey: RoleKey, permission: string): boolean => {
  const grants = grantsOf(roleKey);
  return grants.has("*") || grants.has(permission);
};

interface Row {
  /** Human label, used in the test name. */
  what: string;
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  /** The key the handler's `requirePermission` names. Hand-copied from source. */
  permission: string;
  /** A body for write methods. Deliberately minimal and usually invalid. */
  body?: Record<string, unknown>;
}

/**
 * One row per significant endpoint.
 *
 * The bodies are mostly **invalid on purpose**. This file asks one question —
 * *was the caller refused on permissions?* — and a 422 for a bad body is a
 * perfectly good "not 403". Supplying valid bodies would turn a permission
 * matrix into an integration suite and make it fail for unrelated reasons.
 */
const MATRIX: Row[] = [
  // ── read surfaces ──
  { what: "list customers", method: "get", path: "/api/customers", permission: "customers.view" },
  { what: "list loans", method: "get", path: "/api/loans", permission: "requests.view" },
  { what: "list banks", method: "get", path: "/api/banks", permission: "banks.view" },
  { what: "list employees", method: "get", path: "/api/users", permission: "users.view" },
  { what: "list roles", method: "get", path: "/api/roles", permission: "roles.view" },
  { what: "list teams", method: "get", path: "/api/teams", permission: "teams.view" },
  { what: "read the audit trail", method: "get", path: "/api/audit-logs", permission: "audit_logs.view" },
  { what: "read the recycle bin", method: "get", path: "/api/recycle-bin", permission: "recycle_bin.view" },
  { what: "read the ledger", method: "get", path: "/api/ledger", permission: "ledger.view" },
  { what: "read settlements", method: "get", path: "/api/settlements", permission: "settlements.view" },
  { what: "read disbursements", method: "get", path: "/api/disbursements", permission: "disbursements.view" },
  { what: "read transactions", method: "get", path: "/api/transactions", permission: "transactions.view" },
  { what: "read bank orders", method: "get", path: "/api/bank-orders", permission: "bank_orders.view" },
  { what: "read documents", method: "get", path: "/api/documents", permission: "documents.view" },
  { what: "run the loan report", method: "get", path: "/api/reports/loans", permission: "reports.view" },
  { what: "read settings", method: "get", path: "/api/settings", permission: "settings.view" },

  // ── writes ──
  { what: "create a customer", method: "post", path: "/api/customers", permission: "customers.create", body: {} },
  { what: "delete a customer", method: "delete", path: "/api/customers/00000000-0000-4000-8000-000000000000", permission: "customers.delete" },
  { what: "create a loan", method: "post", path: "/api/loans", permission: "requests.create", body: {} },
  { what: "approve a loan", method: "post", path: "/api/loans/00000000-0000-4000-8000-000000000000/approve", permission: "requests.approve", body: {} },
  { what: "create a bank", method: "post", path: "/api/banks", permission: "banks.create", body: {} },
  { what: "create an employee", method: "post", path: "/api/users", permission: "users.create", body: {} },
  { what: "create a role", method: "post", path: "/api/roles", permission: "roles.create", body: {} },
  { what: "re-grant a role's permissions", method: "put", path: "/api/roles/00000000-0000-4000-8000-000000000000/permissions", permission: "roles.assign_permissions", body: { permissions: [] } },
  { what: "create a team", method: "post", path: "/api/teams", permission: "teams.create", body: {} },
  { what: "edit a team", method: "patch", path: "/api/teams/00000000-0000-4000-8000-000000000000", permission: "teams.edit", body: {} },
  { what: "set a team roster", method: "put", path: "/api/teams/00000000-0000-4000-8000-000000000000/members", permission: "teams.assign", body: { userIds: [] } },
  { what: "post a ledger entry", method: "post", path: "/api/ledger", permission: "ledger.create", body: {} },
  { what: "create a settlement", method: "post", path: "/api/settlements", permission: "settlements.create", body: {} },
  { what: "approve a settlement", method: "post", path: "/api/settlements/00000000-0000-4000-8000-000000000000/approve", permission: "settlements.approve", body: {} },
  { what: "create a disbursement", method: "post", path: "/api/disbursements", permission: "disbursements.create", body: {} },
  { what: "approve a disbursement", method: "post", path: "/api/disbursements/00000000-0000-4000-8000-000000000000/approve", permission: "disbursements.approve", body: {} },
  { what: "verify a document", method: "patch", path: "/api/documents/00000000-0000-4000-8000-000000000000", permission: "documents.verify", body: {} },
  { what: "change settings", method: "patch", path: "/api/settings", permission: "settings.edit", body: {} },
  { what: "purge from the recycle bin", method: "post", path: "/api/recycle-bin/00000000-0000-4000-8000-000000000000/permanent-delete", permission: "recycle_bin.permanent_delete", body: {} },
  { what: "restore from the recycle bin", method: "post", path: "/api/recycle-bin/00000000-0000-4000-8000-000000000000/restore", permission: "recycle_bin.restore", body: {} },
];

let ctx: TestContext;
const tokens = {} as Record<RoleKey, string>;

beforeAll(async () => {
  ctx = await createTestContext();
  const bank = await createBank(ctx.db);

  for (const roleKey of ROLE_KEYS) {
    // Every role gets the same bank, so a refusal is never bank scope in
    // disguise. Super Admin holds `system.access_all_banks` and ignores it.
    const user = await createUser(ctx.db, { roleKey, bankIds: [bank.id] });
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });
    expect(res.status, `${roleKey} could not sign in: ${JSON.stringify(res.body)}`).toBe(200);
    tokens[roleKey] = res.body.accessToken as string;
  }
}, 90_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

const call = (row: Row, token: string) => {
  const agent = request(ctx.app)[row.method](row.path).set("Authorization", `Bearer ${token}`);
  return row.body === undefined ? agent : agent.send(row.body);
};

/* ══ A — the matrix ═══════════════════════════════════════════════════════ */

describe("A · every role gets the answer the catalogue promises", () => {
  for (const row of MATRIX) {
    it(`${row.method.toUpperCase()} ${row.path} — ${row.what}`, async () => {
      const wrong: string[] = [];

      for (const roleKey of ROLE_KEYS) {
        const res = await call(row, tokens[roleKey]);
        const permitted = holds(roleKey, row.permission);
        const refused = res.status === 403;

        /*
         * The assertion is deliberately one-sided in each direction:
         *
         *   holder     → must NOT be 403. Anything else (404, 422, 409, 200) is
         *                fine — the fixture ids do not exist and the bodies are
         *                mostly invalid, and this file is not about that.
         *   non-holder → MUST be 403. Not 404, not 422: `requirePermission` runs
         *                before the handler, so a non-holder must never reach
         *                validation or a lookup.
         */
        if (permitted && refused) {
          wrong.push(`${roleKey} holds ${row.permission} but was refused 403`);
        }
        if (!permitted && !refused) {
          wrong.push(
            `${roleKey} does NOT hold ${row.permission} but got ${res.status} instead of 403`,
          );
        }
      }

      expect(wrong, wrong.join(" | ")).toEqual([]);
    });
  }
});

/* ══ B — the properties the whole model rests on ══════════════════════════ */

describe("B · the invariants behind the matrix", () => {
  it("every role in the matrix's expectations is one the seed actually creates", async () => {
    // A typo in a role key would make `grantsOf` throw rather than silently
    // expect nothing, but only if something calls it for that key.
    for (const roleKey of ROLE_KEYS) expect(() => grantsOf(roleKey)).not.toThrow();
    expect(ROLE_KEYS.length).toBe(DEFAULT_ROLES.length);
  });

  it("Super Admin is refused nothing in the matrix", async () => {
    const refused: string[] = [];
    for (const row of MATRIX) {
      const res = await call(row, tokens.super_admin);
      if (res.status === 403) refused.push(`${row.method.toUpperCase()} ${row.path}`);
    }
    expect(refused, `Super Admin was refused: ${refused.join(", ")}`).toEqual([]);
  });

  it("Executive is refused every administrative surface", async () => {
    // The role the demo runs as, and the one most likely to be over-granted by
    // accident because it is the one people test with.
    const administrative = MATRIX.filter((row) =>
      ["roles.", "audit_logs.", "settings.", "users.create", "banks.create", "recycle_bin."].some(
        (prefix) => row.permission.startsWith(prefix),
      ),
    );
    expect(administrative.length).toBeGreaterThan(5);

    for (const row of administrative) {
      const res = await call(row, tokens.executive);
      expect(res.status, `Executive reached ${row.method.toUpperCase()} ${row.path}`).toBe(403);
    }
  });

  it("no role below Admin can read the audit trail or change settings", async () => {
    // Both were decided deliberately — U-14/OD-8 for settings, and the audit
    // trail has been Super Admin + Admin since the first migration. This is the
    // row that fails if somebody widens either.
    for (const roleKey of ["manager", "team_leader", "executive"] as const) {
      for (const path of ["/api/audit-logs", "/api/settings"]) {
        const res = await request(ctx.app)
          .get(path)
          .set("Authorization", `Bearer ${tokens[roleKey]}`);
        expect(res.status, `${roleKey} reached ${path}`).toBe(403);
      }
    }
  });

  it("an unauthenticated caller is refused every row with 401, never 403", async () => {
    // 401 and 403 mean different things and the client acts on the difference
    // (BUG-034). A route that answered 403 to an anonymous caller would be
    // telling the frontend the session is fine when there is no session.
    for (const row of MATRIX) {
      const agent = request(ctx.app)[row.method](row.path);
      const res = row.body === undefined ? await agent : await agent.send(row.body);
      expect(res.status, `${row.method.toUpperCase()} ${row.path}`).toBe(401);
    }
  });
});
