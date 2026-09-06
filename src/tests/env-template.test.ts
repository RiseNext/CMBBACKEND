import { readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { emailTransport, loadEnv, storageAdapterKind } from "../config/env.js";

/**
 * THE ENVIRONMENT TEMPLATE MATCHES THE CODE — Task 15.15.
 *
 * ── WHY THIS IS A TEST AND NOT A CHECKLIST ──────────────────────────────────
 *
 * `backend/.env.example` has drifted from `env.ts` twice, and both times the
 * consequence landed on whoever deployed next rather than on whoever changed
 * the code:
 *
 *   · **Wave 0** found the template missing **eight storage keys** that Phase 9
 *     had added, five of which production refuses to boot without. A deployer
 *     following the file got an unexplained boot failure (audit U-2, SEC-025).
 *   · The `FRONTEND_URL` block said the variable was "read by nothing", which
 *     was true when written and stopped being true in Phase 3 — after which
 *     every invitation email would have pointed at `localhost`.
 *
 * Both are the same failure: a document describing code, maintained by memory.
 * A test cannot keep the prose accurate, but it can keep the **key list**
 * accurate, which is the half that breaks a deployment.
 *
 * The code is the authority. When this fails, the template is wrong.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

const ENV_TS = read("src/config/env.ts");
const TEMPLATE = read(".env.example");

/**
 * Every key declared in the zod schema.
 *
 * Parsed from the source rather than by importing `env.ts`, deliberately:
 * importing it runs `dotenv/config` and would validate the ambient environment,
 * so the test would depend on the machine it runs on.
 */
function schemaKeys(): string[] {
  const body = ENV_TS.slice(ENV_TS.indexOf("const schema = z.object({"));
  const keys = new Set<string>();
  /*
   * Deliberately NOT `KEY: z\.` — several fields are declared across multiple
   * lines (`AADHAAR_PEPPER: z
  .string()`) or through a helper
   * (`EMAIL_FROM: emailAddress(...)`), and the tighter pattern silently missed
   * all of them. Missing a key here would make case 3 report it as
   * "documented but unread", which is the opposite of the truth.
   */
  for (const match of body.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)) {
    keys.add(match[1]!);
  }
  return [...keys].sort();
}

/** Every `process.env.X` read anywhere in the backend source. */
function directReads(): string[] {
  const keys = new Set<string>();
  for (const file of [
    "src/lib/logger.ts",
    "src/lib/observability.ts",
    "drizzle.config.ts",
  ]) {
    for (const match of read(file).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      keys.add(match[1]!);
    }
  }
  return [...keys].sort();
}

/** Keys the template actually documents, as `KEY=` or a commented `# KEY=`. */
function templateKeys(): string[] {
  const keys = new Set<string>();
  for (const match of TEMPLATE.matchAll(/^#?\s?([A-Z][A-Z0-9_]*)=/gm)) {
    keys.add(match[1]!);
  }
  return [...keys].sort();
}

/* ══ A — every key the code reads is documented ═══════════════════════════ */

describe("A · .env.example covers everything the backend reads", () => {
  it("1. THE FINDING: every zod-schema key appears in the template", async () => {
    // Wave 0's defect, as a test. Eight storage keys were absent for a whole
    // phase, five of them boot-critical.
    const missing = schemaKeys().filter((key) => !templateKeys().includes(key));
    expect(missing, `undocumented schema keys: ${missing.join(", ")}`).toEqual([]);
  });

  it("2. every variable read directly from `process.env` is documented too", async () => {
    // `LOG_LEVEL`, `RELEASE_SHA` and the `ERROR_TRACKING_*` keys are outside
    // the schema on purpose, which is exactly how they get forgotten.
    const missing = directReads().filter((key) => !templateKeys().includes(key));
    expect(missing, `undocumented direct reads: ${missing.join(", ")}`).toEqual([]);
  });

  it("3. the template documents nothing the code does not read", async () => {
    // The other direction. A key nobody reads is a deployer setting something
    // that has no effect, which is worse than an undocumented one because it
    // reads as configured.
    const known = new Set([...schemaKeys(), ...directReads()]);
    const stray = templateKeys().filter((key) => !known.has(key));
    expect(stray, `documented but unread: ${stray.join(", ")}`).toEqual([]);
  });
});

/* ══ B — the template's own claims are still true ═════════════════════════ */

describe("B · the template does not contradict the schema", () => {
  it("4. AADHAAR_PEPPER is not shipped with the value the schema rejects", async () => {
    // Task 13.4 removed the default AND added a guard refusing this exact
    // string. The template shipped it deliberately so the guard would fire —
    // but the guard now fires in EVERY environment, not just production, so
    // shipping it means `cp .env.example .env` no longer boots.
    const guard = /refine\(\(v\) => v !== "([^"]+)"/.exec(ENV_TS);
    expect(guard, "the known-bad-pepper guard should still exist").not.toBeNull();
    expect(
      TEMPLATE.includes(`AADHAAR_PEPPER=${guard![1]}`),
      "the template ships the exact pepper the schema refuses — a fresh copy cannot boot",
    ).toBe(false);
  });

  it("5. the documented pepper minimum matches the schema's", async () => {
    const min = /AADHAAR_PEPPER: z[\s\S]{0,200}?\.min\((\d+)/.exec(ENV_TS);
    expect(min).not.toBeNull();
    expect(
      TEMPLATE,
      `the schema requires ${min![1]} characters; the template must say so`,
    ).toContain(`${min![1]} characters`);
  });

  it("6. NODE_ENV is documented as required, not as defaulted", async () => {
    // SEC-028. It has no default and the template must not imply one.
    expect(ENV_TS).not.toMatch(/NODE_ENV: z\.enum\([^)]*\)\.default/);
    const block = TEMPLATE.slice(TEMPLATE.indexOf("# development | test | production"));
    expect(block.slice(0, 2_000)).toContain("REQUIRED");
  });

  it("7. no real-looking secret is present in the template", async () => {
    // A placeholder that looks configured is how a deploy ends up running on
    // one. The API-key-shaped keys must carry NO VALUE.
    //
    // This used to demand the bare form `KEY=` specifically, and that turned out
    // to be the wrong shape to insist on — see case 9. Commented out is strictly
    // stronger: the key is absent rather than present-and-empty. Both forms are
    // accepted here; a VALUE is what is refused.
    // `[ \t]` rather than `\s`, deliberately: `\s` matches a NEWLINE, so
    // `KEY=\s*\S` happily walks past the end of the line and matches the first
    // character of the next comment block. The negative assertion below was
    // green against a template that did ship a value, for exactly that reason.
    for (const key of ["EMAIL_API_KEY", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
      expect(TEMPLATE, `${key} must ship with no value`).toMatch(
        new RegExp(`^#?[ \\t]?${key}=[ \\t]*$`, "m"),
      );
      expect(TEMPLATE, `${key} must not ship a value of any kind`).not.toMatch(
        new RegExp(`^#?[ \\t]?${key}=[ \\t]*\\S`, "m"),
      );
    }
    // Nothing anywhere that looks like a live Resend key.
    expect(TEMPLATE).not.toMatch(/re_[A-Za-z0-9]{16,}/);
  });

  it("8. the storage region still matches the decision D-071 records", async () => {
    // OPEN-2 records Indian data residency as a legal constraint, not a
    // preference. A template that quietly said `us-east-1` would be a
    // compliance failure delivered by a config file.
    expect(TEMPLATE).toMatch(/^STORAGE_REGION=ap-south-1$/m);
  });
});

/* ══ C — the template actually LOADS ══════════════════════════════════════ */

/**
 * Group A checks that the key LISTS agree. That is necessary and it is not
 * sufficient, which this group exists to prove.
 *
 * ── THE FINDING ─────────────────────────────────────────────────────────────
 *
 * Every key was documented, every key was read, group A was green — and
 * `cp .env.example .env` still could not start the process.
 *
 * `EMAIL_PROVIDER=` and five others shipped as bare empty assignments. dotenv
 * turns `KEY=` into the STRING `""`, and `""` is a present value: `.optional()`
 * never fires, so `z.enum(["resend"])` and `.min(1)` reject it. The template's
 * own prose said "leave them blank locally and the backend boots on the console
 * transport", and doing exactly that produced six validation errors.
 *
 * It surfaced when the first real staging database was set up — `npm run db:seed`
 * refused to start — and the workaround at the time was to comment the lines out
 * by hand, in a file every future developer would copy again.
 *
 * A list-comparison test cannot catch that. Loading the file can.
 *
 * ── WHY IMPORTING `env.ts` IS SAFE HERE ─────────────────────────────────────
 *
 * Group A deliberately parses `env.ts` as TEXT, because importing it runs
 * `dotenv/config` and would make the assertions depend on the developer's own
 * environment. That reasoning does not apply to `loadEnv(source)`: it validates
 * the object it is GIVEN and never reads `process.env` unless asked to. The
 * import's side effect cannot reach these cases.
 */
describe("C · .env.example loads, and production stays strict", () => {
  /** The template exactly as dotenv materialises it — the real contract. */
  const asLoaded = (): Record<string, string> => dotenv.parse(TEMPLATE);

  /**
   * Collect the schema's complaints, or `[]` when it accepts the input.
   *
   * `loadEnv` throws in TWO shapes and both matter here: zod failures arrive as
   * a header line followed by one indented `- KEY: message` per issue, while the
   * production-only blocks (email, storage) throw a single sentence with no
   * newline at all. Slicing off a header that is not there is how the first
   * draft of case 12 reported a strict production config as permissive.
   */
  function complaints(source: Record<string, string>): string[] {
    try {
      loadEnv(source as NodeJS.ProcessEnv);
      return [];
    } catch (error) {
      const message = (error as Error).message;
      if (!message.includes("\n")) return [message];
      return message
        .split("\n")
        .slice(1)
        .map((line) => line.trim().replace(/^- /, ""))
        .filter(Boolean);
    }
  }

  /** The key each complaint is about. */
  const keysOf = (issues: string[]) => issues.map((i) => i.split(":")[0]!.trim()).sort();

  it("9. THE FINDING: loading the template complains about AADHAAR_PEPPER and nothing else", async () => {
    // The pepper's emptiness is the one DELIBERATE refusal — Task 13.4 removed
    // its default so a fresh copy cannot boot on a published value. Every other
    // complaint was an accident of `KEY=` meaning "empty string".
    expect(keysOf(complaints(asLoaded()))).toEqual(["AADHAAR_PEPPER"]);
  });

  it("10. with a pepper supplied, the template boots as-is", async () => {
    // This is the developer's actual first five minutes: copy the file,
    // `openssl rand -base64 48`, paste, run. It has to work.
    const env = loadEnv({ ...asLoaded(), AADHAAR_PEPPER: "a".repeat(48) } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe("development");
    // ...and the optional integrations are OFF rather than misconfigured.
    expect(emailTransport(env)).toBe("console");
    expect(storageAdapterKind(env)).toBe("local");
  });

  it("11. an explicitly-supplied empty string is still REJECTED", async () => {
    // The fix was to the template, not to the validator. Someone who genuinely
    // writes `EMAIL_PROVIDER=` in their own .env must still be told.
    const base = { ...asLoaded(), AADHAAR_PEPPER: "a".repeat(48) };
    for (const key of [
      "EMAIL_PROVIDER",
      "EMAIL_API_KEY",
      "STORAGE_PROVIDER",
      "STORAGE_BUCKET",
      "STORAGE_ACCESS_KEY_ID",
      "STORAGE_SECRET_ACCESS_KEY",
    ]) {
      expect(keysOf(complaints({ ...base, [key]: "" })), `${key}="" must be refused`).toContain(key);
    }
  });

  it("12. production strictness is unchanged — all nine keys still required", async () => {
    // The template's whole point is that these are optional in development.
    // Production is where that stops being true, and this is the case that
    // would fail if the fix had been "make everything optional".
    const prod = {
      ...asLoaded(),
      NODE_ENV: "production",
      AADHAAR_PEPPER: "a".repeat(48),
      JWT_ACCESS_SECRET: "a".repeat(48),
      JWT_REFRESH_SECRET: "b".repeat(48),
    };
    const issues = complaints(prod).join(" ");
    expect(issues).toMatch(/Email configuration is required in production/);
    expect(issues).toMatch(/EMAIL_PROVIDER/);
    expect(issues).toMatch(/EMAIL_API_KEY/);

    // Storage is reported once email is satisfied — the two blocks are separate.
    const withEmail = {
      ...prod,
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "not-a-real-key",
      EMAIL_FROM: "Rise Next <no-reply@example.com>",
      EMAIL_REPLY_TO: "support@example.com",
    };
    const storageIssues = complaints(withEmail).join(" ");
    expect(storageIssues).toMatch(/Object storage configuration is required in production/);
    for (const key of ["STORAGE_PROVIDER", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
      expect(storageIssues, `${key} must still be demanded in production`).toContain(key);
    }
  });

  it("13. fully configured, production accepts the same template", async () => {
    // The other direction: the template must describe a shape that CAN be
    // completed into a valid production configuration. None of these values is
    // real — they are shapes.
    const env = loadEnv({
      ...asLoaded(),
      NODE_ENV: "production",
      AADHAAR_PEPPER: "a".repeat(48),
      JWT_ACCESS_SECRET: "a".repeat(48),
      JWT_REFRESH_SECRET: "b".repeat(48),
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "not-a-real-key",
      EMAIL_FROM: "Rise Next <no-reply@example.com>",
      EMAIL_REPLY_TO: "support@example.com",
      STORAGE_PROVIDER: "s3",
      STORAGE_BUCKET: "example-bucket",
      STORAGE_REGION: "ap-south-1",
      STORAGE_ACCESS_KEY_ID: "not-a-real-key-id",
      STORAGE_SECRET_ACCESS_KEY: "not-a-real-secret",
    } as NodeJS.ProcessEnv);
    expect(emailTransport(env)).toBe("resend");
    expect(storageAdapterKind(env)).toBe("s3");
  });

  it("14. every optional key is ABSENT in the template, not empty", async () => {
    // The structural half of case 9, so a regression names the offending key
    // rather than just reporting a failed load.
    //
    // AADHAAR_PEPPER is the documented exception. BOOTSTRAP_SUPERADMIN_PASSWORD
    // is `z.string().optional()`, which accepts "", and the seed tests it for
    // truthiness — so a bare `KEY=` there is harmless and stays.
    const ALLOWED_EMPTY = new Set(["AADHAAR_PEPPER", "BOOTSTRAP_SUPERADMIN_PASSWORD"]);
    const emptyAssignments = [...TEMPLATE.matchAll(/^([A-Z][A-Z0-9_]*)=[ \t]*$/gm)]
      .map((m) => m[1]!)
      .filter((key) => !ALLOWED_EMPTY.has(key));
    expect(
      emptyAssignments,
      `these ship as \`KEY=\` (an empty STRING, which the schema rejects). ` +
        `Comment them out instead: ${emptyAssignments.join(", ")}`,
    ).toEqual([]);
  });

  /*
   * STORAGE_ALLOW_EPHEMERAL — the deliberate exception to case 12.
   *
   * The escape hatch's whole value is that it is hard to reach by accident, so
   * what is worth testing is not that it works but that **nothing else opens
   * it**: not absence, not "false", not a plausible typo, and not the email
   * block next door.
   */
  describe("the ephemeral-storage escape hatch", () => {
    const productionWithoutStorage = () => ({
      ...asLoaded(),
      NODE_ENV: "production",
      AADHAAR_PEPPER: "a".repeat(48),
      JWT_ACCESS_SECRET: "a".repeat(48),
      JWT_REFRESH_SECRET: "b".repeat(48),
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "not-a-real-key",
      EMAIL_FROM: "Rise Next <no-reply@example.com>",
      EMAIL_REPLY_TO: "support@example.com",
    });

    it('15. "true" is the only value that lets production boot without a bucket', () => {
      const env = loadEnv({ ...productionWithoutStorage(), STORAGE_ALLOW_EPHEMERAL: "true" });
      expect(env.NODE_ENV).toBe("production");
      // It boots, and it boots onto the LOCAL adapter — the honest consequence.
      expect(storageAdapterKind(env)).toBe("local");
    });

    it("16. absent or false keeps the original refusal exactly as it was", () => {
      // Absence is the default state and must behave as though this key had
      // never been added — the regression that would matter most.
      expect(() => loadEnv(productionWithoutStorage())).toThrow(
        /Object storage configuration is required in production/,
      );
      expect(() =>
        loadEnv({ ...productionWithoutStorage(), STORAGE_ALLOW_EPHEMERAL: "false" }),
      ).toThrow(/Object storage configuration is required in production/);
    });

    it("17. a typo is a boot failure, never a silent false", () => {
      // The failure mode this guards against: an operator sets TRUE or 1,
      // believes storage is bridged, and gets the refusal — or worse, a
      // permissive coercion reads "false" as true. Neither may happen quietly.
      for (const value of ["TRUE", "True", "1", "yes", "on", ""]) {
        expect(
          () => loadEnv({ ...productionWithoutStorage(), STORAGE_ALLOW_EPHEMERAL: value }),
          `STORAGE_ALLOW_EPHEMERAL=${JSON.stringify(value)} must be refused`,
        ).toThrow(/STORAGE_ALLOW_EPHEMERAL/);
      }
    });

    it("18. it does not weaken the email block, or anything else", () => {
      // Scope check. The hatch is storage-only; an operator who sets it must
      // still be told about missing mail configuration.
      const noEmail = { ...productionWithoutStorage(), STORAGE_ALLOW_EPHEMERAL: "true" };
      delete (noEmail as Record<string, unknown>).EMAIL_API_KEY;
      expect(() => loadEnv(noEmail)).toThrow(/Email configuration is required in production/);

      // And it must not license the development fallback outside production.
      expect(() =>
        loadEnv({
          ...productionWithoutStorage(),
          STORAGE_ALLOW_EPHEMERAL: "true",
          JWT_REFRESH_SECRET: "a".repeat(48),
        }),
      ).toThrow(/JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ/);
    });
  });
});
