import { afterAll, afterEach, describe, expect, it } from "vitest";
import { emailTransport, loadEnv, missingEmailConfig, resetEnvCache } from "../config/env.js";

/**
 * EMAIL CONFIGURATION — Task 3.2
 *
 * Configuration only. No provider SDK, no `services/email.ts`, nothing is sent.
 * What is proven here is the one asymmetry the roadmap asks for:
 *
 *   production + missing config  ->  **refuse to boot**
 *   development + missing config ->  **boot, on the console transport**
 *
 * The production half matters because the fallback is silent by nature. A
 * production deploy that booted without mail credentials would accept an
 * invitation request, log it to stdout, and report success — a control
 * reporting an outcome it never achieved (D-004). Refusing to start is the
 * only honest answer, and it is the same shape as SEC-028's `NODE_ENV` fix.
 *
 * No database and no server: `loadEnv()` takes an explicit source object, and
 * `emailTransport()` is a pure function of the resolved config. Modelled on
 * `cookie-config.test.ts`, which tests this file the same way.
 */

/**
 * A complete, valid production environment INCLUDING email.
 *
 * Storage was added 2026-09-05 by Task 9.2 (D-072): `loadEnv` now refuses to
 * boot in production without it, for the same reason it refuses without email —
 * the development fallback is a container-local filesystem that would accept a
 * KYC upload and lose it. These are placeholders, not credentials.
 */
const PROD_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  PORT: "8080",
  DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
  JWT_ACCESS_SECRET: "access-secret-that-is-definitely-long-enough-x",
  JWT_REFRESH_SECRET: "refresh-secret-that-is-definitely-long-enough-y",
  CORS_ORIGIN: "https://app.example.com",
  AADHAAR_PEPPER: "a-real-production-pepper-value-long-enough!!",
  EMAIL_PROVIDER: "resend",
  EMAIL_API_KEY: "re_placeholder_not_a_real_key",
  EMAIL_FROM: "no-reply@risenext.in",
  EMAIL_REPLY_TO: "support@risenext.in",
  STORAGE_PROVIDER: "s3",
  STORAGE_BUCKET: "risenext-kyc-placeholder",
  STORAGE_REGION: "ap-south-1",
  STORAGE_ACCESS_KEY_ID: "AKIA_PLACEHOLDER_NOT_REAL",
  STORAGE_SECRET_ACCESS_KEY: "placeholder-not-a-real-secret",
};

const DEV_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://localhost:5432/dev",
  JWT_ACCESS_SECRET: "access-secret-that-is-definitely-long-enough-x",
  JWT_REFRESH_SECRET: "refresh-secret-that-is-definitely-long-enough-y",
  // Required in EVERY environment since Task 13.4 (SEC-007) — there is no
  // default any more, not even in development.
  AADHAAR_PEPPER: "a-development-pepper-that-is-long-enough!!",
};

const prod = (overrides: NodeJS.ProcessEnv = {}) => ({ ...PROD_ENV, ...overrides });
const dev = (overrides: NodeJS.ProcessEnv = {}) => ({ ...DEV_ENV, ...overrides });

/** `prod()` minus one key — `undefined` is not the same as absent to zod. */
function prodWithout(key: string): NodeJS.ProcessEnv {
  const source = prod();
  delete source[key];
  return source;
}

afterEach(() => resetEnvCache());
afterAll(() => resetEnvCache());

/* ------------------------------------------------------------------ group A */

describe("A — production refuses to boot without email configuration", () => {
  it("1. accepts a complete production environment", () => {
    const config = loadEnv(prod());

    expect(config.EMAIL_PROVIDER).toBe("resend");
    expect(config.EMAIL_FROM).toBe("no-reply@risenext.in");
    expect(config.EMAIL_REPLY_TO).toBe("support@risenext.in");
    expect(emailTransport(config)).toBe("resend");
  });

  it.each(["EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO"])(
    "2-5. refuses production missing %s",
    (key) => {
      expect(() => loadEnv(prodWithout(key))).toThrow(/Email configuration is required in production/);
      // The message must name the key that is actually missing.
      expect(() => loadEnv(prodWithout(key))).toThrow(new RegExp(key));
    },
  );

  it("6. names every missing key at once, not just the first", () => {
    const source = prod();
    delete source.EMAIL_API_KEY;
    delete source.EMAIL_REPLY_TO;

    expect(() => loadEnv(source)).toThrow(/EMAIL_API_KEY/);
    expect(() => loadEnv(source)).toThrow(/EMAIL_REPLY_TO/);
  });

  it("7. still enforces the pre-existing production rules — SEC-028 and D-019 intact", () => {
    // Email validation must not have displaced what was already there.
    expect(() => loadEnv(prod({ AADHAAR_PEPPER: "dev-only-pepper-change-me!!" }))).toThrow(
      /AADHAAR_PEPPER/,
    );
    const same = "identical-secret-that-is-definitely-long-enough";
    expect(() =>
      loadEnv(prod({ JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same })),
    ).toThrow(/must differ/);
    const noNodeEnv = prod();
    delete noNodeEnv.NODE_ENV;
    expect(() => loadEnv(noNodeEnv)).toThrow(/NODE_ENV/);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — the provider is an allowlist, not free text", () => {
  it("8. rejects an unimplemented provider outright", () => {
    // D-033 chose Resend. A key that silently accepted "sendgrid" would boot a
    // production deploy whose mail can never be delivered.
    expect(() => loadEnv(prod({ EMAIL_PROVIDER: "sendgrid" }))).toThrow(
      /Invalid environment configuration/,
    );
  });

  it("9. rejects a near-miss typo", () => {
    expect(() => loadEnv(prod({ EMAIL_PROVIDER: "Resend" }))).toThrow(
      /Invalid environment configuration/,
    );
  });

  it("10. rejects an address that is not one", () => {
    expect(() => loadEnv(prod({ EMAIL_FROM: "not-an-address" }))).toThrow(/EMAIL_FROM/);
    expect(() => loadEnv(prod({ EMAIL_REPLY_TO: "also@bad" }))).toThrow(/EMAIL_REPLY_TO/);
  });

  it('11. accepts the "Display Name <address>" form a real EMAIL_FROM uses', () => {
    // Rejecting this would be a false positive that stops a correct production
    // deployment from booting — the failure mode the NODE_ENV note warns about.
    const config = loadEnv(prod({ EMAIL_FROM: "Rise Next <no-reply@risenext.in>" }));

    expect(config.EMAIL_FROM).toBe("Rise Next <no-reply@risenext.in>");
    expect(emailTransport(config)).toBe("resend");
  });

  it("12. rejects an empty API key rather than treating it as set", () => {
    expect(() => loadEnv(prod({ EMAIL_API_KEY: "   " }))).toThrow();
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — development boots without email, on the console transport", () => {
  it("13. boots with no email configuration at all", () => {
    const config = loadEnv(dev());

    expect(config.NODE_ENV).toBe("development");
    expect(config.EMAIL_PROVIDER).toBeUndefined();
    expect(emailTransport(config)).toBe("console");
  });

  it("14. reports exactly which keys are missing, for the boot notice", () => {
    expect(missingEmailConfig(loadEnv(dev())).sort()).toEqual(
      ["EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_PROVIDER", "EMAIL_REPLY_TO"].sort(),
    );
  });

  it("15. uses the real provider when development IS fully configured", () => {
    const config = loadEnv(
      dev({
        EMAIL_PROVIDER: "resend",
        EMAIL_API_KEY: "re_placeholder_not_a_real_key",
        EMAIL_FROM: "no-reply@risenext.in",
        EMAIL_REPLY_TO: "support@risenext.in",
      }),
    );

    expect(emailTransport(config)).toBe("resend");
    expect(missingEmailConfig(config)).toEqual([]);
  });

  it("16. falls back to console when development is only HALF configured", () => {
    // A key without a provider cannot send. Falling back is right; doing it
    // silently is not, which is why `missingEmailConfig` names the gap.
    const config = loadEnv(dev({ EMAIL_API_KEY: "re_placeholder_not_a_real_key" }));

    expect(emailTransport(config)).toBe("console");
    expect(missingEmailConfig(config)).toContain("EMAIL_PROVIDER");
    expect(missingEmailConfig(config)).not.toContain("EMAIL_API_KEY");
  });

  it("17. the test environment boots without email — the suite depends on it", () => {
    const config = loadEnv({ ...dev(), NODE_ENV: "test" });

    expect(config.NODE_ENV).toBe("test");
    expect(emailTransport(config)).toBe("console");
  });

  it("18. still validates a MALFORMED value in development", () => {
    // Optional means "may be absent", not "may be wrong".
    expect(() => loadEnv(dev({ EMAIL_PROVIDER: "mailgun" }))).toThrow();
    expect(() => loadEnv(dev({ EMAIL_FROM: "nonsense" }))).toThrow();
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — the API key never leaves the configuration", () => {
  const SECRET = "re_super_secret_value_that_must_never_appear";

  it("19. is absent from every production validation error", () => {
    for (const key of ["EMAIL_PROVIDER", "EMAIL_FROM", "EMAIL_REPLY_TO"]) {
      const source = prod({ EMAIL_API_KEY: SECRET });
      delete source[key];

      try {
        loadEnv(source);
        throw new Error(`expected loadEnv to throw for missing ${key}`);
      } catch (error) {
        expect((error as Error).message).not.toContain(SECRET);
        expect((error as Error).message).toContain(key);
      }
    }
  });

  it("20. is absent from a schema failure elsewhere in the file", () => {
    const source = prod({ EMAIL_API_KEY: SECRET, JWT_ACCESS_SECRET: "too-short" });

    try {
      loadEnv(source);
      throw new Error("expected loadEnv to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("21. is never included in the missing-key report used by the boot log", () => {
    const config = loadEnv(dev({ EMAIL_API_KEY: SECRET }));

    expect(JSON.stringify(missingEmailConfig(config))).not.toContain(SECRET);
  });

  it("22. is not exposed under any NEXT_PUBLIC_ name", () => {
    // Frontend leakage guard: the key is backend configuration and Next only
    // inlines NEXT_PUBLIC_*.
    const config = loadEnv(prod());

    expect(Object.keys(config).some((k) => k.startsWith("NEXT_PUBLIC"))).toBe(false);
    expect(config.EMAIL_API_KEY).toBe("re_placeholder_not_a_real_key");
  });
});
