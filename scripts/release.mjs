#!/usr/bin/env node
/**
 * THE PRODUCTION MIGRATION RELEASE STEP — Task 15.4, D-090.
 *
 *     node scripts/release.mjs            # apply pending migrations
 *     node scripts/release.mjs --check    # report only, change nothing
 *
 * ── WHY THIS IS A SEPARATE STEP AND NOT PART OF BOOT ────────────────────────
 *
 * Running migrations from the application's start command means **every
 * replica races to apply the same DDL on every restart**. Postgres serialises
 * the DDL, so the usual outcome is one winner and several losers that crash on
 * a duplicate object — a restart loop during a deploy, which is the worst
 * possible moment. Drizzle's migrator does take an advisory lock, which makes
 * the race survivable rather than safe; "survivable" is not a reason to build
 * it that way. D-050 already states the rule: one migration in flight.
 *
 * ── WHY IT REFUSES THE POOLED URL ───────────────────────────────────────────
 *
 * Neon's pooled endpoint (`-pooler` in the host) is PgBouncer in transaction
 * mode. Session-scoped things — advisory locks, `SET LOCAL`, some `ALTER`
 * forms — either fail or, worse, silently apply to a different backend than the
 * one that continues the transaction. The migrator uses an advisory lock, so on
 * the pooled endpoint the lock may be taken on one backend and the DDL run on
 * another: the protection quietly stops working.
 *
 * So this script **fails loudly** when `DIRECT_DATABASE_URL` is absent while
 * `DATABASE_URL` looks pooled, rather than proceeding on the pooled one. That
 * check is a heuristic on the hostname and it says so; it is a guard rail, not
 * a guarantee.
 *
 * ── WHAT IT PRINTS ──────────────────────────────────────────────────────────
 *
 * The applied-versus-pending count before and after, so a release log answers
 * "did this deploy change the schema?" without anybody opening a psql session.
 * **No connection string is ever printed** — not the host, not the user. The
 * readiness probe learned that lesson as SEC-015.
 *
 * ── WHY IT LOADS `.env` — fixed at the repository split, 2026-09-06 ─────────
 *
 * It did not, and that was a real defect rather than a style point.
 *
 * Every other entry point reaches the environment through `config/env.ts`,
 * which begins `import "dotenv/config"`. This script deliberately does not use
 * `env.ts` — it reads two variables directly so that `--check` works against a
 * checkout that has never been built — and in skipping `env.ts` it skipped
 * dotenv with it.
 *
 * On Railway that was invisible: the platform injects the variables, so the
 * script found them. On a laptop it meant the documented setup path
 *
 *     cp .env.example .env   →   npm run release
 *
 * failed with "Neither DIRECT_DATABASE_URL nor DATABASE_URL is set" while a
 * correctly filled-in `.env` sat next to it — an error message that names the
 * right variables and the wrong cause. `npm run db:seed` in the very next line
 * of the same instructions worked, because *it* goes through `env.ts`.
 *
 * `dotenv` is already a production dependency. Loading it here is a no-op when
 * no `.env` file exists, which is the case in every container, so this changes
 * nothing about a deployed release step. Real environment variables still win:
 * dotenv does not overwrite what is already set.
 */

import "dotenv/config";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "..", "drizzle");

const checkOnly = process.argv.includes("--check");

/** Never interpolated into output — only its shape is ever reported. */
function resolveUrl() {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  const pooled = process.env.DATABASE_URL?.trim();

  if (direct) return { url: direct, source: "DIRECT_DATABASE_URL" };
  if (!pooled) {
    throw new Error(
      "Neither DIRECT_DATABASE_URL nor DATABASE_URL is set. Migrations need a direct, " +
        "non-pooled connection — see docs/DEPLOYMENT.md.",
    );
  }
  if (/-pooler\.|pgbouncer/i.test(pooled)) {
    throw new Error(
      "DATABASE_URL points at a POOLED endpoint and DIRECT_DATABASE_URL is not set.\n" +
        "Migrations must run against the direct endpoint: the migrator takes a session-scoped " +
        "advisory lock, and a transaction-mode pooler can hand the DDL to a different backend " +
        "than the one holding it, so the protection silently stops working.\n" +
        "Set DIRECT_DATABASE_URL to Neon's direct connection string (the one WITHOUT `-pooler` " +
        "in the host) and re-run.",
    );
  }
  return { url: pooled, source: "DATABASE_URL (no pooler detected)" };
}

/** The migration files on disk, in the order Drizzle will apply them. */
function migrationsOnDisk() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function appliedCount(client) {
  try {
    const { rows } = await client.query(
      "select count(*)::int as n from drizzle.__drizzle_migrations",
    );
    return rows[0]?.n ?? 0;
  } catch {
    // The table does not exist yet — this is a brand-new database.
    return 0;
  }
}

async function main() {
  const { url, source } = resolveUrl();
  const onDisk = migrationsOnDisk();

  process.stdout.write(`Migration release step\n`);
  process.stdout.write(`  connection : ${source}\n`);
  process.stdout.write(`  files      : ${onDisk.length} (${onDisk[0]} … ${onDisk.at(-1)})\n`);

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: true },
  });

  await client.connect();
  try {
    const before = await appliedCount(client);
    process.stdout.write(`  applied    : ${before}\n`);
    process.stdout.write(`  pending    : ${Math.max(0, onDisk.length - before)}\n`);

    if (checkOnly) {
      process.stdout.write(
        onDisk.length === before
          ? "\nUp to date. Nothing to apply.\n"
          : `\n${onDisk.length - before} migration(s) would be applied. Re-run without --check.\n`,
      );
      // Exit 0 either way: --check reports, it does not gate. A deploy that
      // wants to gate on this should read the counts.
      return;
    }

    if (onDisk.length === before) {
      process.stdout.write("\nUp to date. Nothing to apply.\n");
      return;
    }

    // Imported here rather than at the top so `--check` needs no ESM-compiled
    // application code and works against a checkout that has not been built.
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");

    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });

    const after = await appliedCount(client);
    process.stdout.write(`\nApplied ${after - before} migration(s). Now at ${after}.\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // The message only. A `pg` error's `detail` can carry row values and its
  // message can carry the host — neither belongs in a release log.
  process.stderr.write(`\nMigration release FAILED: ${error.message}\n`);
  process.exit(1);
});
