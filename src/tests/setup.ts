/**
 * Vitest loads this before any test module, so configuration is present no
 * matter which module happens to be imported first.
 */
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
