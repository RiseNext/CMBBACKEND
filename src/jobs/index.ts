import { getDb, type Database } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { captureException } from "../lib/observability.js";
import { cleanupRefreshTokens } from "./cleanup-refresh-tokens.js";
import { detectSlaBreach } from "./detect-sla-breach.js";
import { expireImportBatches } from "./expire-import-batches.js";
import { purgeRecycleBin } from "./purge-recycle-bin.js";
import type { Job, JobResult } from "./types.js";

export type { Job, JobResult, JobContext } from "./types.js";
export { purgeRecycleBin } from "./purge-recycle-bin.js";
export { expireImportBatches, overdueStagedRowCount } from "./expire-import-batches.js";
export { cleanupRefreshTokens, GRACE_DAYS } from "./cleanup-refresh-tokens.js";
export { detectSlaBreach } from "./detect-sla-breach.js";

/**
 * THE JOB REGISTRY — Task 15.9.
 *
 * ── HOW THESE ARE INVOKED, AND WHY THERE IS NO HTTP TRIGGER ─────────────────
 *
 * `npm run jobs -- <name|all>`, run by an external scheduler (Railway Cron on
 * the documented deployment). Deliberately **not** an authenticated endpoint on
 * the API:
 *
 *   · an endpoint that purges records is a destructive, unauthenticated-by-
 *     default surface that then needs its own shared secret, its own rate
 *     limit and its own audit path — three new things to get wrong for no gain;
 *   · a job that runs inside the API process competes with request traffic for
 *     the same narrow Neon pool and the same small container;
 *   · **and in a multi-instance deployment every instance would fire it.** The
 *     jobs are idempotent, so that is survivable rather than catastrophic, but
 *     "survivable" is not a reason to build it that way.
 *
 * A one-off container per run also means a hung job cannot wedge the API, and
 * its exit code is the scheduler's success signal with nothing in between.
 *
 * ── WHAT "SUCCESS" MEANS ────────────────────────────────────────────────────
 *
 * Exit **0** only when every job in the run completed with `failed === 0`.
 * A job that processed nothing because there was nothing to do is a success; a
 * job that could not process something it selected is not, and the run exits
 * **1** so the scheduler's own alerting fires. Partial progress is kept — the
 * rows that did succeed are committed, because the alternative is a backlog
 * that can never drain past its first bad record.
 */
export const JOBS: Job[] = [
  expireImportBatches,
  purgeRecycleBin,
  cleanupRefreshTokens,
  detectSlaBreach,
];

export const jobByName = (name: string): Job | undefined =>
  JOBS.find((job) => job.name === name);

export interface RunOptions {
  db?: Database;
  limit?: number;
  dryRun?: boolean;
}

/** Runs one job and reports what it did. Never throws for a job-level failure. */
export async function runJob(job: Job, options: RunOptions = {}): Promise<JobResult> {
  const db = options.db ?? getDb();
  const limit = options.limit ?? job.defaultLimit;
  const dryRun = options.dryRun ?? false;
  const started = Date.now();

  logger.info({ job: job.name, limit, dryRun }, "Job starting");

  try {
    const outcome = await job.run({ db, limit, dryRun });
    const result: JobResult = { name: job.name, durationMs: Date.now() - started, ...outcome };

    /*
     * `warn` when anything failed, so a platform alerting on log level notices
     * without needing to parse the payload. The counters are always present, so
     * a run that did nothing is still visibly a run rather than silence.
     */
    const level = result.failed > 0 ? "warn" : "info";
    logger[level]({ ...result }, "Job finished");
    return result;
  } catch (error) {
    /*
     * A throw here is the job's whole selection query failing — the database is
     * unreachable, or a migration has not been applied. That is an operational
     * fault rather than a bad record, so it is captured for error tracking as
     * well as logged, and reported as one failure so the run exits non-zero.
     */
    captureException(error, { job: job.name, scope: "scheduled-job" });
    logger.error({ err: error, job: job.name }, "Job threw and did not complete");
    return {
      name: job.name,
      processed: 0,
      failed: 1,
      durationMs: Date.now() - started,
      details: { error: "unhandled" },
    };
  }
}

/** Runs every registered job in declaration order. */
export async function runAllJobs(options: RunOptions = {}): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of JOBS) {
    // Sequential on purpose. They share one narrow connection pool, and
    // `purge-recycle-bin` and `expire-import-batches` both touch storage and
    // the audit table; running them concurrently buys nothing and makes a
    // lock-contention failure look like a random one.
    results.push(await runJob(job, options));
  }
  return results;
}

/** True when every job in the run completed with no failures. */
export const allSucceeded = (results: JobResult[]): boolean =>
  results.every((result) => result.failed === 0);
