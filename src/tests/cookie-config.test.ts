import { afterAll, afterEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "../config/env.js";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "../lib/tokens.js";

/**
 * REFRESH-COOKIE CONFIGURATION — SEC-028
 *
 * WHAT THE DEFECT ACTUALLY WAS. `NODE_ENV` was `.default("development")`, and
 * `NODE_ENV` alone decides the refresh cookie's `Secure` and `SameSite` flags
 * (`lib/tokens.ts:75-82`). Nothing in this repository sets `NODE_ENV` — there
 * is no Dockerfile, no `railway.*`, no `Procfile`, no CI, and `npm start` is a
 * bare `node dist/server.js` — so a real production deployment that never set
 * it booted as `development` and issued the cookie without `Secure` and with
 * `SameSite=Lax`. Two separate failures: the cookie became transmissible over
 * plain HTTP, and across the Vercel↔Railway *site* boundary the browser stored
 * it and never sent it, so every reload silently signed the user out.
 *
 * WHAT THE ROADMAP ORIGINALLY ASKED FOR, AND WHY IT IS NOT HERE. It asked to
 * assert that `NODE_ENV=production` implies `secure=true` and
 * `sameSite="none"`. Both values are computed from the *same expression* in the
 * *same function*, so that assertion reduces to `isProd → isProd`: no
 * configuration can falsify it, and it would have caught nothing. Group B below
 * does assert those values, but as a **contract lock on the mapping** — it
 * would catch someone editing `tokens.ts` — and explicitly not as evidence that
 * a misconfiguration is detected. Group A is the test that carries the security
 * claim. See docs/DECISIONS.md D-019.
 *
 * No database and no server: `loadEnv()` takes an explicit source object and
 * `refreshCookieOptions()` is a pure function of the resolved config.
 */

/** A complete, valid production environment. Cases vary one field at a time. */
const PROD_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  PORT: "8080",
  DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
  JWT_ACCESS_SECRET: "access-secret-that-is-definitely-long-enough-x",
  JWT_REFRESH_SECRET: "refresh-secret-that-is-definitely-long-enough-y",
  CORS_ORIGIN: "https://app.example.com",
  AADHAAR_PEPPER: "a-real-production-pepper-value-long-enough!!",
  /*
   * Storage added by Task 9.2 (D-072), for the same reason and on the same
   * terms as the email block below: this fixture's contract is "a complete,
   * valid production environment", and as of 9.2 a complete one includes object
   * storage — `loadEnv` refuses to boot production without it, because the
   * development fallback is a container-local filesystem that would accept a
   * KYC upload and lose it. Placeholders, not credentials. Storage-specific
   * behaviour is covered in `storage-service.test.ts`.
   */
  STORAGE_PROVIDER: "s3",
  STORAGE_BUCKET: "risenext-kyc-placeholder",
  STORAGE_REGION: "ap-south-1",
  STORAGE_ACCESS_KEY_ID: "AKIA_PLACEHOLDER_NOT_REAL",
  STORAGE_SECRET_ACCESS_KEY: "placeholder-not-a-real-secret",
  /*
   * Added by Task 3.2. This fixture's contract is "a complete, valid production
   * environment", and as of that task a complete one includes email: `loadEnv`
   * refuses to boot production without all four keys. Nothing about these tests
   * changed — the fixture was updated so it remains true to its own comment.
   * Email-specific behaviour is covered in `email-config.test.ts`.
   */
  EMAIL_PROVIDER: "resend",
  EMAIL_API_KEY: "re_placeholder_not_a_real_key",
  EMAIL_FROM: "no-reply@risenext.in",
  EMAIL_REPLY_TO: "support@risenext.in",
};

const withEnv = (overrides: NodeJS.ProcessEnv = {}) => ({ ...PROD_ENV, ...overrides });

/** Everything except NODE_ENV, for the omission case. */
function withoutNodeEnv(): NodeJS.ProcessEnv {
  const source = { ...PROD_ENV };
  delete source.NODE_ENV;
  return source;
}

/**
 * `refreshCookieOptions()` reads the cached global config, so exercising it per
 * environment means setting `process.env` and clearing the cache. Restored
 * afterwards so no later test file inherits the mutation.
 */
const ORIGINAL_ENV = { ...process.env };

function cookieOptionsUnder(nodeEnv: string, extra: NodeJS.ProcessEnv = {}) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, withEnv({ NODE_ENV: nodeEnv, ...extra }));
  resetEnvCache();
  return refreshCookieOptions();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ORIGINAL_ENV);
  resetEnvCache();
});

afterAll(() => {
  resetEnvCache();
});

describe("A — NODE_ENV must be declared (the actual fix)", () => {
  it("refuses to load when NODE_ENV is absent, naming the variable", () => {
    // THE REGRESSION TEST. Against the previous `.default("development")` this
    // returned a valid config with NODE_ENV="development" and threw nothing —
    // which is exactly how a production deploy shipped insecure cookies.
    let thrown: Error | undefined;
    try {
      loadEnv(withoutNodeEnv());
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown, "loadEnv must reject a config with no NODE_ENV").toBeDefined();
    expect(thrown!.message).toContain("NODE_ENV");
    // The message has to tell an operator what to do, not just that something
    // is wrong — this failure will be read from a deploy log.
    expect(thrown!.message).toMatch(/development.*test.*production/s);
  });

  it("does not silently fall back to development", () => {
    // The specific old behaviour, asserted as its own case: absence must not
    // resolve to a working config at all, let alone the insecure one.
    expect(() => loadEnv(withoutNodeEnv())).toThrow();
  });

  it("still rejects a value outside the enum", () => {
    // This guard predates the fix and must survive it: a typo was never silent.
    for (const bad of ["prod", "Production", "staging", ""]) {
      expect(() => loadEnv(withEnv({ NODE_ENV: bad })), `NODE_ENV=${bad}`).toThrow();
    }
  });

  it("accepts each of the three declared environments", () => {
    for (const value of ["development", "test", "production"] as const) {
      expect(loadEnv(withEnv({ NODE_ENV: value })).NODE_ENV).toBe(value);
    }
  });
});

describe("B — the NODE_ENV → cookie mapping, locked against edits", () => {
  /*
   * These do NOT prove a misconfiguration is caught — `secure` and `sameSite`
   * are derived from the same expression, so they cannot disagree with
   * NODE_ENV. They lock the mapping itself, so a change to `tokens.ts` that
   * weakened production cookies would fail here.
   */
  it("production ⇒ Secure + SameSite=None", () => {
    const options = cookieOptionsUnder("production");

    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe("none");
  });

  it("development ⇒ not Secure, SameSite=Lax, so local HTTP keeps working", () => {
    const options = cookieOptionsUnder("development");

    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe("lax");
  });

  it("test ⇒ same as development", () => {
    const options = cookieOptionsUnder("test");

    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe("lax");
  });

  it("scope and lifetime are not environment-dependent", () => {
    // Task 1.7 changed only whether NODE_ENV is required. If the cookie's path
    // or lifetime ever start varying by environment, that is a new decision and
    // should not slip in unnoticed.
    const prod = cookieOptionsUnder("production");
    const dev = cookieOptionsUnder("development");

    expect(prod.path).toBe("/api/auth");
    expect(dev.path).toBe("/api/auth");
    expect(prod.maxAge).toBe(7 * 24 * 60 * 60 * 1000); // REFRESH_TOKEN_TTL_DAYS default
    expect(dev.maxAge).toBe(prod.maxAge);
  });

  it("honours REFRESH_TOKEN_TTL_DAYS rather than hardcoding the lifetime", () => {
    const options = cookieOptionsUnder("production", { REFRESH_TOKEN_TTL_DAYS: "3" });

    expect(options.maxAge).toBe(3 * 24 * 60 * 60 * 1000);
  });
});

describe("C — COOKIE_DOMAIN", () => {
  it("sets domain when configured", () => {
    const options = cookieOptionsUnder("production", { COOKIE_DOMAIN: ".example.com" });

    expect(options.domain).toBe(".example.com");
  });

  it("omits the key entirely when unset, rather than sending domain: undefined", () => {
    // `res.cookie` treats a present-but-undefined `domain` differently from an
    // absent one in some Express/cookie versions, so the spread in
    // `tokens.ts:85` must add no key at all.
    const options = cookieOptionsUnder("production");

    expect("domain" in options).toBe(false);
    expect(Object.keys(options)).not.toContain("domain");
  });
});

describe("D — clearing the cookie matches setting it", () => {
  it("differs only in maxAge, so logout actually removes the cookie", () => {
    // `auth.routes.ts:205,257` clear with `{...refreshCookieOptions(), maxAge: undefined}`.
    // A browser only removes a cookie when name, path and domain match the one
    // it stored, so any divergence here would leave the session cookie in place
    // after logout. This reproduces that call shape.
    const set = cookieOptionsUnder("production", { COOKIE_DOMAIN: ".example.com" });
    const cleared = { ...set, maxAge: undefined };

    expect(cleared.path).toBe(set.path);
    expect(cleared.domain).toBe(set.domain);
    expect(cleared.secure).toBe(set.secure);
    expect(cleared.sameSite).toBe(set.sameSite);
    expect(cleared.httpOnly).toBe(set.httpOnly);
    expect(cleared.maxAge).toBeUndefined();
    expect(REFRESH_COOKIE_NAME).toBe("rn_refresh");
  });
});

describe("E — the pre-existing production guards are undisturbed", () => {
  it("still rejects the shipped default AADHAAR_PEPPER in production", () => {
    expect(() => loadEnv(withEnv({ AADHAAR_PEPPER: "dev-only-pepper-change-me!!" }))).toThrow(
      /AADHAAR_PEPPER/,
    );
  });

  it("still rejects identical JWT secrets in production", () => {
    const same = "the-same-secret-repeated-and-long-enough-1";
    expect(() =>
      loadEnv(withEnv({ JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same })),
    ).toThrow(/must differ/);
  });

  it("the JWT-secret guard is still production-only", () => {
    // This half is unchanged: identical secrets are refused in production and
    // tolerated in development, where nobody can reach the service.
    const same = "the-same-secret-repeated-and-long-enough-1";
    const config = loadEnv(
      withEnv({ NODE_ENV: "development", JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same }),
    );
    expect(config.JWT_ACCESS_SECRET).toBe(same);
  });

  it("INVERTED by Task 13.4 — the pepper guard is NO LONGER production-only", () => {
    /*
     * This case asserted the opposite until 2026-09-06: that development was
     * *allowed* the shipped pepper, and it passed because the guard was written
     * `if (NODE_ENV === "production")`.
     *
     * That is precisely the defect **SEC-007** names — *"Remove the
     * `AADHAAR_PEPPER` default so it is required in every environment."* The
     * production-only guard was real but narrow: **staging** and **UAT** are
     * where real customer data goes for acceptance testing, and neither is
     * `production`, so both peppered live Aadhaar numbers with a constant
     * published in this repository.
     *
     * The check moved into the zod schema, so it now fires everywhere. The old
     * expectation is not deleted — it is inverted, because the behaviour it
     * described was the finding.
     */
    expect(() =>
      loadEnv(withEnv({ NODE_ENV: "development", AADHAAR_PEPPER: "dev-only-pepper-change-me!!" })),
    ).toThrow(/AADHAAR_PEPPER/);

    expect(() =>
      loadEnv(withEnv({ NODE_ENV: "test", AADHAAR_PEPPER: "dev-only-pepper-change-me!!" })),
    ).toThrow(/AADHAAR_PEPPER/);
  });

  it("accepts a complete, valid production configuration", () => {
    // The false-positive guard. A fail-fast check is only safe to ship if a
    // correct deployment is provably unaffected by it.
    const config = loadEnv(withEnv());

    expect(config.NODE_ENV).toBe("production");
    expect(config.CORS_ORIGIN).toBe("https://app.example.com");
    expect(config.PORT).toBe(8080);
  });

  it("does not infer production from any other variable", () => {
    // D-019: the fix deliberately reads NODE_ENV and nothing else. An https
    // CORS_ORIGIN and a remote DATABASE_URL must NOT promote a development
    // config, or a developer testing against a deployed frontend would get
    // production cookies — or be refused a boot.
    const config = loadEnv(
      withEnv({
        NODE_ENV: "development",
        CORS_ORIGIN: "https://app.example.com",
        DATABASE_URL: "postgres://user:pass@db.neon.tech:5432/app",
      }),
    );

    expect(config.NODE_ENV).toBe("development");
  });
});
