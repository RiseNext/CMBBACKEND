import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import { users } from "../db/schema/index.js";
import { resetEnvCache } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { passwordProblems } from "../lib/password.js";

/**
 * ON-SCREEN CREDENTIAL HAND-OVER — roadmap task 3.9
 *
 * *"Keep the on-screen credential hand-over as an explicit fallback for when
 * email is unavailable — do not remove it."*
 *
 * The roadmap row is a **prohibition**, and prohibitions need tests or they are
 * only a comment. Before this file, the create route's temporary password was
 * covered for generation, storage and login (`employee-lifecycle.test.ts`) but
 * **nothing anywhere asserted it survives a mail outage** — which is the single
 * property the roadmap actually asks for. Deleting the hand-over, or making it
 * conditional on the email having succeeded, broke no test.
 *
 * So group A is the load-bearing one: with the provider configured and every
 * request failing, creating an employee must still hand the credential back,
 * and must say `failed` while doing it. The rest of the file pins the
 * boundaries that make the fallback safe rather than merely present — it is
 * never stored in the clear, never logged, never emailed, and never reachable
 * through an ordinary read.
 *
 * The failing provider is driven through the REAL transport: `EMAIL_*` is set
 * so `emailTransport()` selects `resend`, and `fetch` is stubbed to 500. No
 * network, and the key is obvious junk.
 */

let ctx: TestContext;
let superToken: string;
let executiveToken: string;
let adminToken: string;
let bank: { id: string; code: string };
let executiveRoleId: string;
let superAdminRoleId: string;
let n = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

/** Obvious junk. No real key is ever used here, and none is needed. */
const FAKE_KEY = "re_test_not_a_real_key_0000000000";

/**
 * Points the environment at a configured provider whose `fetch` always fails.
 * This is what "email is unavailable" means for the purposes of 3.9.
 */
function withFailingProvider(): () => void {
  const previous = { ...process.env };
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_API_KEY = FAKE_KEY;
  process.env.EMAIL_FROM = "Rise Next <no-reply@risenext.test>";
  process.env.EMAIL_REPLY_TO = "support@risenext.test";
  resetEnvCache();

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("provider exploded", { status: 500 })),
  );

  return () => {
    vi.unstubAllGlobals();
    process.env = previous;
    resetEnvCache();
  };
}

/** Points the environment at a provider that accepts everything. */
function withWorkingProvider(): () => void {
  const previous = { ...process.env };
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_API_KEY = FAKE_KEY;
  process.env.EMAIL_FROM = "Rise Next <no-reply@risenext.test>";
  process.env.EMAIL_REPLY_TO = "support@risenext.test";
  resetEnvCache();

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "msg_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );

  return () => {
    vi.unstubAllGlobals();
    process.env = previous;
    resetEnvCache();
  };
}

/** Captures everything the logger emits while `fn` runs. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const lines: unknown[][] = [];
  const push = ((...args: unknown[]) => {
    lines.push(args);
  }) as never;
  const spies = [
    vi.spyOn(logger, "info").mockImplementation(push),
    vi.spyOn(logger, "warn").mockImplementation(push),
    vi.spyOn(logger, "error").mockImplementation(push),
    vi.spyOn(logger, "debug").mockImplementation(push),
  ];
  try {
    const result = await fn();
    return { result, logged: JSON.stringify(lines) };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

/** Creates an employee through the real route. */
function createEmployee(token = superToken, overrides: Record<string, unknown> = {}) {
  n += 1;
  return request(ctx.app)
    .post("/api/users")
    .set(bearer(token))
    .send({
      name: `Handover Target ${n}`,
      email: `handover.${n}@risenext.com`,
      roleId: executiveRoleId,
      bankIds: [bank.id],
      ...overrides,
    });
}

const userRow = async (id: string) => {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
};

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Handover Test Bank");
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;
  superAdminRoleId = (await roleByKey(ctx.db, "super_admin")).id;

  // All direct-insert fixtures up front: the harness mints employee codes from
  // its own counter while the route takes max+1, so a harness user created
  // after a route-created one collides. See `invitations.test.ts`.
  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  const executive = await createUser(ctx.db, { roleKey: "executive" });
  const admin = await createUser(ctx.db, { roleKey: "admin" });

  superToken = (await login(superAdmin.email, superAdmin.password)).body.accessToken as string;
  executiveToken = (await login(executive.email, executive.password)).body.accessToken as string;
  adminToken = (await login(admin.email, admin.password)).body.accessToken as string;
});

afterAll(async () => destroyTestContext(ctx));
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ group A */

describe("A — the fallback survives a mail outage (the whole point of 3.9)", () => {
  it("1. creating an employee still succeeds when the provider is down", async () => {
    const restore = withFailingProvider();
    try {
      const res = await createEmployee();
      expect(res.status).toBe(201);
    } finally {
      restore();
    }
  });

  it("2. the temporary password is STILL handed back when the provider is down", async () => {
    /*
     * The load-bearing assertion of this file. If this fails, an administrator
     * whose mail provider is down has created an account nobody can get into.
     */
    const restore = withFailingProvider();
    try {
      const res = await createEmployee();

      expect(typeof res.body.temporaryPassword).toBe("string");
      expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    } finally {
      restore();
    }
  });

  it("3. the handed-back credential actually works for signing in", async () => {
    const restore = withFailingProvider();
    let email: string;
    let password: string;
    try {
      const res = await createEmployee();
      email = res.body.data.email;
      password = res.body.temporaryPassword;
    } finally {
      restore();
    }

    expect((await login(email!, password!)).status).toBe(200);
  });

  it("4. the outage is reported honestly — `failed`, not a false success", async () => {
    const restore = withFailingProvider();
    try {
      const res = await createEmployee();

      expect(res.body.invitation.status).toBe("failed");
      expect(res.body.invitation.status).not.toBe("sent");
    } finally {
      restore();
    }
  });

  it("5. a working provider reports `sent` AND still hands the credential over", async () => {
    // 3.9 says keep it, not "keep it only on failure". The fallback is present
    // either way; what changes is what the screen tells the administrator.
    const restore = withWorkingProvider();
    try {
      const res = await createEmployee();

      expect(res.body.invitation.status).toBe("sent");
      expect(typeof res.body.temporaryPassword).toBe("string");
    } finally {
      restore();
    }
  });

  it("6. with no email configured at all the outcome is `logged`, and the credential is there", async () => {
    // The default test environment: the console transport, which delivers
    // nothing. From the employee's side that is identical to an outage.
    const res = await createEmployee();

    expect(res.body.invitation.status).toBe("logged");
    expect(typeof res.body.temporaryPassword).toBe("string");
  });

  it("7. the outcome is always one of the three documented values", async () => {
    const res = await createEmployee();
    expect(["sent", "logged", "failed"]).toContain(res.body.invitation.status);
  });

  it("8. a mail outage does not roll back the account", async () => {
    const restore = withFailingProvider();
    try {
      const res = await createEmployee();
      const row = await userRow(res.body.data.id);

      expect(row).toBeDefined();
      expect(row.deletedAt).toBeNull();
      expect(row.status).toBe("Active");
    } finally {
      restore();
    }
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — the credential is never persisted or logged in the clear", () => {
  it("9. only a hash is stored — the plaintext is in no column", async () => {
    const res = await createEmployee();
    const row = await userRow(res.body.data.id);

    expect(JSON.stringify(row)).not.toContain(res.body.temporaryPassword);
    expect(row.passwordHash).toMatch(/^\$argon2/);
  });

  it("10. it is not logged on the happy path", async () => {
    const { result: res, logged } = await captureLogs(() => createEmployee());
    expect(logged).not.toContain(res.body.temporaryPassword);
  });

  it("11. it is not logged on the outage path either, where more is written", async () => {
    /*
     * The failure branch logs a warning naming the user and the transport. That
     * is exactly the kind of place a password gets swept into a log line by
     * accident, so it is asserted rather than assumed.
     */
    const restore = withFailingProvider();
    try {
      const { result: res, logged } = await captureLogs(() => createEmployee());

      expect(logged).not.toContain(res.body.temporaryPassword);
      expect(logged).not.toContain(FAKE_KEY);
    } finally {
      restore();
    }
  });

  it("12. it is not returned by the employee list", async () => {
    const res = await createEmployee();
    const list = await request(ctx.app).get("/api/users").set(bearer(superToken));

    expect(JSON.stringify(list.body)).not.toContain(res.body.temporaryPassword);
  });

  it("13. no password hash is exposed by the employee list either", async () => {
    const list = await request(ctx.app).get("/api/users").set(bearer(superToken));
    expect(JSON.stringify(list.body)).not.toMatch(/\$argon2/);
  });

  it("14. it cannot be read back after the creating response", async () => {
    const res = await createEmployee();
    const again = await request(ctx.app).get("/api/users").set(bearer(superToken));
    const row = (again.body.data as Record<string, unknown>[]).find(
      (r) => r.id === res.body.data.id,
    );

    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(res.body.temporaryPassword);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — the credential is never a delivery channel of its own", () => {
  it("15. the invitation email carries no password", async () => {
    /*
     * D-037: the credential model is a link; passwords are not emailed. The
     * on-screen fallback must not quietly become an emailed one.
     */
    const { result: res, logged } = await captureLogs(() => createEmployee());

    expect(logged).toContain("accept-invite?token=");
    expect(logged).not.toContain(res.body.temporaryPassword);
  });

  it("16. the email body never uses password-handover wording", async () => {
    const { logged } = await captureLogs(() => createEmployee());

    expect(logged).not.toMatch(/temporary password|your password is|password:/i);
  });

  it("17. the invitation link is still issued alongside the fallback", async () => {
    // 3.9 preserves the fallback; it does not replace the link model (D-037).
    const { logged } = await captureLogs(() => createEmployee());
    expect(logged).toMatch(/accept-invite\?token=[A-Za-z0-9_%-]+/);
  });

  it("18. an outage does not cause a password to be emailed as a substitute", async () => {
    const restore = withFailingProvider();
    try {
      const { result: res, logged } = await captureLogs(() => createEmployee());
      expect(logged).not.toContain(res.body.temporaryPassword);
    } finally {
      restore();
    }
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — the account contract around the fallback", () => {
  it("19. the employee must change the temporary password on first sign-in", async () => {
    const res = await createEmployee();
    const row = await userRow(res.body.data.id);

    expect(row.mustChangePassword).toBe(true);
  });

  it("20. that holds on the outage path too", async () => {
    const restore = withFailingProvider();
    try {
      const res = await createEmployee();
      expect((await userRow(res.body.data.id)).mustChangePassword).toBe(true);
    } finally {
      restore();
    }
  });

  it("21. an administrator-supplied password returns NO hand-over", async () => {
    // There is nothing to hand over — the administrator already knows it.
    const res = await createEmployee(superToken, { password: "ChosenByAdmin2026" });

    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeUndefined();
  });

  it("22. an administrator-supplied password still sets mustChangePassword", async () => {
    const res = await createEmployee(superToken, { password: "ChosenByAdmin2027" });
    expect((await userRow(res.body.data.id)).mustChangePassword).toBe(true);
  });

  it("23. the generated password satisfies the password policy", async () => {
    const res = await createEmployee();
    expect(passwordProblems(res.body.temporaryPassword)).toEqual([]);
  });

  it("24. two creations never produce the same credential", async () => {
    const first = await createEmployee();
    const second = await createEmployee();

    expect(first.body.temporaryPassword).not.toBe(second.body.temporaryPassword);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — only an authorized creator ever sees a credential", () => {
  it("25. an unauthenticated caller gets no account and no credential", async () => {
    const res = await request(ctx.app)
      .post("/api/users")
      .send({ name: "Nobody", email: "nobody@risenext.com", roleId: executiveRoleId });

    expect(res.status).toBe(401);
    expect(res.body.temporaryPassword).toBeUndefined();
  });

  it("26. an actor without users.create gets no credential", async () => {
    const res = await createEmployee(executiveToken);

    expect(res.status).toBe(403);
    expect(res.body.temporaryPassword).toBeUndefined();
  });

  it("27. the hierarchy rule still gates it — an Admin cannot mint a Super Admin", async () => {
    /*
     * The fallback must not become a way around target authorization. If this
     * ever returns 201, an Admin has handed themselves a working Super Admin
     * credential — which is the BUG-038 class of defect.
     */
    const res = await createEmployee(adminToken, { roleId: superAdminRoleId });

    expect(res.status).toBe(403);
    expect(res.body.temporaryPassword).toBeUndefined();
  });

  it("28. a refused creation writes no user at all", async () => {
    const before = (await ctx.db.select().from(users)).length;
    await createEmployee(executiveToken);

    expect((await ctx.db.select().from(users)).length).toBe(before);
  });

  it("29. a validation failure returns no credential", async () => {
    const res = await createEmployee(superToken, { email: "not-an-email" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.temporaryPassword).toBeUndefined();
  });

  it("30. a duplicate email returns no credential", async () => {
    const first = await createEmployee();
    const res = await createEmployee(superToken, { email: first.body.data.email });

    expect(res.status).toBe(409);
    expect(res.body.temporaryPassword).toBeUndefined();
  });
});
