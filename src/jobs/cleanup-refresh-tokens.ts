import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import { refreshTokens } from "../db/schema/index.js";
import type { Job } from "./types.js";

/**
 * DELETE DEAD REFRESH TOKENS — Task 15.9, closing BUG/finding 13.15.
 *
 * `refresh_tokens` has never had anything removed from it. Every sign-in adds a
 * row and every refresh adds another, because the token rotates; nothing is
 * ever deleted, not on logout, not on expiry, not on password change. The table
 * only grows, and **every row in it is a credential digest**. A table of
 * SHA-256 hashes of live-shaped secrets, retained forever, is a liability that
 * gets larger every day and serves no purpose after the token is dead.
 *
 * ── WHY A GRACE PERIOD, AND WHY IT IS NOT ZERO ──────────────────────────────
 *
 * A row is deleted only once it has been dead for `GRACE_DAYS`. Two reasons,
 * and the second is the load-bearing one:
 *
 *   1. **Reuse detection needs the corpse.** `POST /api/auth/refresh` looks the
 *      presented token up by hash; finding a row that is *revoked* is how it
 *      detects replay of a rotated token and revokes the whole family
 *      (`auth.routes.ts`). Delete the row immediately on rotation and a stolen
 *      token stops being *detected* — it just looks unknown, which is the same
 *      answer an expired one gets. The detection would silently stop working
 *      and no test would notice, because the outcome for the attacker is the
 *      same 401 either way.
 *   2. An incident investigation a few days later still wants to see which
 *      sessions existed.
 *
 * Seven days is comfortably longer than `REFRESH_TOKEN_TTL_DAYS`'s default of
 * seven only by coincidence; the two are independent and the grace is measured
 * from **death**, not from issue.
 *
 * ── IDEMPOTENT AND CHEAP ────────────────────────────────────────────────────
 *
 * One bounded `DELETE ... WHERE id IN (SELECT ... LIMIT n)`. The predicate is
 * falsified by the delete itself, so a repeat run removes whatever is left and
 * then nothing. No audit row: this is garbage collection of an internal table,
 * the sessions it describes were already ended by something that *was* audited,
 * and writing one row per token into a trigger-immutable table would trade a
 * growing table for a permanently growing one.
 */

/** Days a dead token is kept so reuse detection and investigation still work. */
export const GRACE_DAYS = 7;

export const cleanupRefreshTokens: Job = {
  name: "cleanup-refresh-tokens",
  description:
    "Deletes refresh tokens that have been expired or revoked for longer than the grace period.",
  defaultLimit: 5_000,

  async run({ db, limit, dryRun }) {
    const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);

    const dead = and(
      or(
        lt(refreshTokens.expiresAt, cutoff),
        and(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.revokedAt, cutoff)),
      ),
    );

    if (dryRun) {
      const [{ n = 0 } = {}] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(refreshTokens)
        .where(dead);
      return { processed: 0, failed: 0, details: { due: n, dryRun: "true" } };
    }

    /*
     * Bounded through a subselect rather than a bare `DELETE ... LIMIT`, which
     * Postgres does not support. `id` is the primary key, so the outer delete
     * is an index scan.
     */
    const doomed = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(dead)
      .limit(limit);

    if (doomed.length === 0) return { processed: 0, failed: 0, details: { due: 0 } };

    const ids = doomed.map((row) => row.id);
    await db.delete(refreshTokens).where(
      sql`${refreshTokens.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
    );

    return { processed: ids.length, failed: 0, details: { graceDays: GRACE_DAYS } };
  },
};
