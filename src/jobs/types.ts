import type { Database } from "../db/index.js";

/**
 * THE SCHEDULED JOB CONTRACT — Task 15.9.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Four things in this system are stamped by the application and acted on by
 * **nothing**:
 *
 *   · `recycle_bin_entries.purge_after` — every soft delete since the first
 *     migration has written a purge date. Nothing has ever purged.
 *   · `import_batches.expires_at` — likewise, and this one is **SEC-009**:
 *     `import_rows.raw` holds the spreadsheet verbatim, including plaintext
 *     Aadhaar numbers, and it is retained forever. Task 13.7 hardened the
 *     ingest path; this is the retention half, and it is the last open HIGH.
 *   · `refresh_tokens` grows unbounded (13.15). Expired and revoked rows are
 *     never removed, so the table only ever gets larger and every one of those
 *     rows is a credential digest.
 *   · `bank_orders.sla` — a column, an index, and no query that reads it.
 *
 * ── WHAT A JOB IS, AND WHAT IT MAY ASSUME ───────────────────────────────────
 *
 * A job is a plain async function over a `Database` handle. It is **not** an
 * HTTP route and has **no `AuthContext`**: there is no user, so an audit row it
 * writes carries `actor_id = null`, which is the truthful record of "the system
 * did this". Inventing a service account would put a real, loginable row in
 * `users` purely so the audit table looked tidier.
 *
 * Every job must be:
 *
 *   **Idempotent.** A scheduler will double-fire. Every job below selects the
 *   work by a predicate that the job's own effect falsifies, so a second run in
 *   the same minute finds nothing to do rather than doing it twice.
 *
 *   **Bounded.** Each takes a `limit`, defaulting to something a small
 *   container can finish inside a cron window. A job that tries to purge two
 *   years of backlog in one transaction is a job that never completes and holds
 *   locks while failing.
 *
 *   **Honest about partial failure.** One bad row must not abandon the rest,
 *   and it must not be reported as success. `failed` is counted separately from
 *   `processed`, and a run with any failure exits non-zero.
 */

export interface JobContext {
  db: Database;
  /** Maximum records this invocation may act on. */
  limit: number;
  /** Set by `--dry-run`: select the work, log it, change nothing. */
  dryRun: boolean;
}

export interface JobResult {
  name: string;
  /** Records the job successfully acted on. */
  processed: number;
  /** Records it tried and could not. A non-zero value fails the run. */
  failed: number;
  durationMs: number;
  /** Job-specific counters, logged verbatim. Never contains record content. */
  details?: Record<string, number | string | undefined>;
}

export interface Job {
  name: string;
  description: string;
  /** Default cap when the caller does not supply one. */
  defaultLimit: number;
  run: (ctx: JobContext) => Promise<Omit<JobResult, "name" | "durationMs">>;
}
