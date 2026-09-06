/**
 * Vitest loads this before any test module, so configuration is present no
 * matter which module happens to be imported first.
 */

/*
 * Loaded HERE, first, on purpose — and this import is the whole mechanism that
 * makes the deletions further down work.
 *
 * `config/env.ts` opens with its own `import "dotenv/config"`. Deleting a
 * variable in this file without this line accomplishes nothing: the delete
 * runs, then the first test to import `env.ts` triggers dotenv, dotenv finds
 * the key unset and **puts it straight back** from the developer's `.env`.
 *
 * ES modules are evaluated once per specifier. By importing `dotenv/config`
 * here — hoisted, so it runs before every statement below — the file is read
 * while this module initialises, and `env.ts`'s later import is a cached no-op
 * that cannot repopulate anything. The pins and deletions below therefore get
 * the last word, which is the only ordering in which they mean anything.
 */
import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://localhost:5432/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-that-is-definitely-long-enough";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-that-is-definitely-long-enough";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.FRONTEND_URL ??= "http://localhost:3000";
process.env.AADHAAR_PEPPER ??= "test-pepper-value-1234567890-long-enough-for-hmac";
process.env.RECYCLE_BIN_RETENTION_DAYS ??= "30";
process.env.MAX_UPLOAD_MB ??= "10";

/*
 * THE SUITE OWNS ITS INTEGRATION CONFIG — it does not inherit the developer's.
 *
 * ── THE DEFECT THIS FIXES ───────────────────────────────────────────────────
 *
 * `config/env.ts` opens with `import "dotenv/config"`, so the developer's real
 * `backend/.env` is loaded into `process.env` before any test runs. The pins
 * above defend `NODE_ENV`, the database and the secrets — but nothing defended
 * `EMAIL_*` or `STORAGE_*`.
 *
 * The moment a developer configures live Resend locally (all four EMAIL_ keys,
 * which is the supported way to test mail against the real provider),
 * `emailTransport()` stops returning `"console"` and **171 tests across seven
 * files start making real HTTP calls to api.resend.com** — billed, rate-limited,
 * and asserting against a live third party. They fail, and they fail in ways
 * that read as product defects: `reset-password-link.test.ts` reports `400`
 * where it expected `422`, which looks like a validation bug and is not one.
 *
 * CI never saw it. CI has no `.env`, so the keys were absent there and the
 * console transport applied — the suite was green on the one machine that could
 * not reproduce the problem, and red on every machine configured to do real
 * work. Local Resend and a green suite were mutually exclusive.
 *
 * ── WHY DELETE RATHER THAN `??=` ────────────────────────────────────────────
 *
 * The pins above use `??=` because they supply a value the suite needs. These
 * are the opposite case: what the suite needs is **absence**. `emailTransport()`
 * and `storageAdapterKind()` both key off all-keys-present, and `env.ts`'s own
 * `.env` convention is explicit that `KEY=` (empty string) is a *present* value
 * that fails validation rather than an absent one. So a blank string would not
 * do — the variable has to be gone.
 *
 * Tests that genuinely exercise the configured transports are unaffected: they
 * pass an explicit `source` to `loadEnv()` or an explicit `config` to
 * `sendEmail()`, and neither reads `process.env` (`email-config.test.ts`,
 * `email-service.test.ts`). This only removes ambient configuration nothing is
 * supposed to be reading.
 */
for (const key of [
  "EMAIL_PROVIDER",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "STORAGE_PROVIDER",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_ENDPOINT",
]) {
  delete process.env[key];
}

/*
 * EVERY TEST STARTS WITH EMPTY RATE-LIMIT COUNTERS — Task 13.1.
 *
 * The limiters added for SEC-005 are module-level, and the whole suite arrives
 * from one address (`::1` under supertest). Without this, a file that signs in
 * repeatedly would throttle whatever ran after it, and the failure would look
 * like a product defect rather than shared state — the classic way a real
 * limiter gets quietly weakened until it stops meaning anything.
 *
 * This is **isolation, not indulgence.** The limits themselves are untouched,
 * and `auth-rate-limit.test.ts` deliberately does NOT reset inside a case —
 * that file is where the limiter is actually proven, and it would pass just as
 * well with this hook absent.
 */
import { beforeEach } from "vitest";
import { resetHashConcurrency, resetRateLimits } from "../middleware/rate-limit.js";

beforeEach(() => {
  resetRateLimits();
  resetHashConcurrency();
});
