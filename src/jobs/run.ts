import { closeDb } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { allSucceeded, JOBS, jobByName, runAllJobs, runJob } from "./index.js";

/**
 * THE SCHEDULED-JOB ENTRY POINT — Task 15.9.
 *
 *     npm run jobs -- all
 *     npm run jobs -- expire-import-batches
 *     npm run jobs -- purge-recycle-bin --dry-run
 *     npm run jobs -- cleanup-refresh-tokens --limit=1000
 *
 * In production the compiled form is `node dist/jobs/run.js <name>`, invoked by
 * Railway Cron. See `docs/RUNBOOK.md`.
 *
 * **Exit 0 only when every job completed with no failures.** That is the
 * scheduler's success signal and there is nothing else in between: a run that
 * found no work exits 0, a run that could not process something it selected
 * exits 1 and the platform's own alerting fires.
 */

function usage(): string {
  const names = JOBS.map((job) => `  ${job.name.padEnd(24)}${job.description}`).join("\n");
  return [
    "Usage: node dist/jobs/run.js <job-name|all> [--dry-run] [--limit=N]",
    "",
    "Jobs:",
    names,
    "  all                     Runs every job above, in order",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args.find((arg) => !arg.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  if (!target) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    process.stdout.write("--limit must be a positive integer\n");
    process.exitCode = 2;
    return;
  }

  const results =
    target === "all"
      ? await runAllJobs({ limit, dryRun })
      : await (async () => {
          const job = jobByName(target);
          if (!job) {
            process.stdout.write(`Unknown job "${target}".\n\n${usage()}\n`);
            process.exitCode = 2;
            return null;
          }
          return [await runJob(job, { limit, dryRun })];
        })();

  if (!results) return;

  const processed = results.reduce((total, r) => total + r.processed, 0);
  const failed = results.reduce((total, r) => total + r.failed, 0);
  logger.info({ jobs: results.length, processed, failed, dryRun }, "Job run complete");

  process.exitCode = allSucceeded(results) ? 0 : 1;
}

main()
  .catch((error) => {
    logger.error({ err: error }, "Job runner failed to start");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
