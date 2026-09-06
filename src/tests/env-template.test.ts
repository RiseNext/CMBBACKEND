import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
    // one. The two API-key-shaped keys ship EMPTY.
    for (const key of ["EMAIL_API_KEY", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
      expect(TEMPLATE, `${key} must ship empty`).toMatch(new RegExp(`^${key}=\\s*$`, "m"));
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
