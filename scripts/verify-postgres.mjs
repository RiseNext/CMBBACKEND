#!/usr/bin/env node
/**
 * SCHEMA VERIFICATION AGAINST A REAL POSTGRESQL SERVER.
 *
 *     node scripts/verify-postgres.mjs            # verify the direct endpoint
 *     node scripts/verify-postgres.mjs --pooled   # verify through the pooler too
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The 1,258-case test suite runs on PGlite and **cannot** run against a real
 * server today — `src/tests/harness.ts` constructs `new PGlite()`
 * unconditionally and there is no `TEST_DATABASE_URL` override. That override is
 * roadmap task 14.9.
 *
 * So after `npm run release` there is a gap: the migrations applied, and nothing
 * checked that what they produced is what the snapshots say. `docs/DEPLOYMENT.md`
 * §3 and §6 carry those checks as SQL to paste by hand, which means they get run
 * once, by whoever remembers. This script is those queries, executed in order,
 * with an exit code.
 *
 * **It is not a substitute for 14.9.** It verifies the SCHEMA — objects,
 * constraints, indexes, foreign keys, triggers — not the application's behaviour
 * against a real server. Anything that needs a request to be served is still
 * only covered on PGlite. That distinction is the whole point of reporting it
 * separately.
 *
 * ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────
 *
 * **It writes nothing.** Every statement is a read. It is safe against a
 * populated database, which is why it is also the post-restore integrity check
 * in `docs/DEPLOYMENT.md` §6.
 *
 * **It never prints a connection string, a host, a role or a password** — only
 * which variable was used. `pg` errors carry the host in `message` and row
 * values in `detail`; only `message` is surfaced, and the readiness probe
 * learned that lesson the hard way as SEC-015.
 */

// Same reasoning as `scripts/release.mjs`: this script reads DATABASE_URL and
// DIRECT_DATABASE_URL directly rather than through `config/env.ts`, so it has to
// load dotenv itself or a correctly filled-in `.env` would be ignored. A no-op
// in a container, where there is no `.env` and the platform sets the variables.
import "dotenv/config";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "..", "drizzle");

const usePooled = process.argv.includes("--pooled");

/* ══════════════════════════════════════════════ the documented expectations ══
 *
 * Every number here is sourced, not guessed. Where a count is derived from a
 * migration file, the file is named — so when one of these fails the next
 * question is "did the schema change or did the expectation go stale?", and it
 * is answerable.
 */
const EXPECT = {
  migrations: 16, //  drizzle/0000 … 0015 — journal, snapshots and files all agree
  tables: 30,
  foreignKeys: 65,
  primaryKeys: 30, // one per table
  triggers: 7, //     D-057; 0014 and 0015 both state the count stays at 7
  checkConstraints: 13, // 12 × *_status_check + bank_orders_stage_check
  statusChecks: 12, //     constraints matching '%_status_check' specifically
};

/*
 * ── THESE NUMBERS WERE MEASURED, NOT COPIED ─────────────────────────────────
 *
 * Every value above and every name below was produced by applying the 16
 * shipped migrations to a fresh engine and counting the catalogue, at the
 * repository split.
 *
 * That matters because the prose had drifted. `docs/DATA_MODEL.md` and the old
 * root README said **27 tables and 62 foreign keys**; the migrations produce
 * **30 and 65**. `docs/DEPLOYMENT.md` §6's restore-integrity query said to
 * expect **13** rows from `conname like '%_status_check'`; the real answer is
 * **12**, because the thirteenth CHECK is `bank_orders_stage_check` — which
 * ends in `_stage_check` and does not match that pattern. An operator running
 * that query after a restore would have read a correct database as a failed one.
 *
 * If one of these assertions fails, ask which moved: the schema, or this list.
 */

/** The tables the migrations create. Sorted; compared as a set. */
const EXPECTED_TABLES = [
  "app_settings", "assignment_history", "audit_logs", "bank_orders", "banks",
  "customers", "disbursements", "documents", "funding_sources", "import_batches",
  "import_rows", "invitations", "ledger_entries", "loans", "notifications",
  "password_resets", "permissions", "recycle_bin_entries", "refresh_tokens",
  "required_document_types", "role_permissions", "roles", "service_providers",
  "settlements", "team_members", "teams", "transactions", "user_bank_access",
  "users", "verifications",
];

/** The seven triggers, as `table.trigger`. D-057 fixes the count at 7. */
const EXPECTED_TRIGGERS = [
  "audit_logs.audit_logs_no_update", // the append-only guard
  "banks.banks_touch_updated_at",
  "customers.customers_touch_updated_at",
  "roles.roles_protect_system", // 0001_governance_guards
  "roles.roles_touch_updated_at",
  "teams.teams_touch_updated_at",
  "users.users_touch_updated_at",
];

/**
 * Partial (filtered) unique indexes. These are how soft delete and uniqueness
 * coexist: `unique (code) where deleted_at is null`. A predicate silently lost
 * in a migration would make the index far stricter than intended — a deleted
 * record would permanently reserve its code — and nothing in the application
 * would report it, so they are named individually rather than counted.
 */
const EXPECTED_PARTIAL_INDEXES = [
  "bank_orders_code_unique", "bank_orders_loan_unique", "banks_code_unique",
  "customers_bank_reference_unique", "customers_code_unique",
  "disbursements_code_unique", "disbursements_utr_unique",
  "funding_sources_name_unique", "ledger_entries_transaction_unique",
  "loans_code_unique", "notifications_event_unique", "recycle_bin_active_unique",
  "required_document_types_unique", "service_providers_name_unique",
  "settlements_bank_period_unique", "settlements_code_unique", "teams_name_unique",
  "transactions_settlement_unique", "users_email_unique",
  "users_employee_code_unique", "verifications_loan_unique",
];

/* ═══════════════════════════════════════════════════════════════ reporting ══ */

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    process.stdout.write(`  ✓ ${name}${detail ? `  ${detail}` : ""}\n`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    process.stdout.write(`  ✗ ${name}${detail ? `  ${detail}` : ""}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n── ${title}\n`);
}

/** Never interpolated into output — only which variable it came from is named. */
function resolveUrl() {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  const pooled = process.env.DATABASE_URL?.trim();

  if (usePooled) {
    if (!pooled) throw new Error("DATABASE_URL is not set — nothing to verify through the pooler.");
    return { url: pooled, source: "DATABASE_URL (pooled)" };
  }
  if (direct) return { url: direct, source: "DIRECT_DATABASE_URL (direct)" };
  if (!pooled) throw new Error("Neither DIRECT_DATABASE_URL nor DATABASE_URL is set.");
  if (/-pooler\.|pgbouncer/i.test(pooled)) {
    throw new Error(
      "DATABASE_URL points at a POOLED endpoint and DIRECT_DATABASE_URL is not set. " +
        "Set DIRECT_DATABASE_URL, or pass --pooled to verify the pooled endpoint deliberately.",
    );
  }
  return { url: pooled, source: "DATABASE_URL (no pooler detected)" };
}

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];
const all = async (client, sql, params = []) => (await client.query(sql, params)).rows;

/* ════════════════════════════════════════════════════════════════════ main ══ */

async function main() {
  const { url, source } = resolveUrl();

  process.stdout.write("Real-PostgreSQL schema verification\n");
  process.stdout.write(`  connection : ${source}\n`);

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: true },
    statement_timeout: 30_000,
  });

  await client.connect();
  try {
    /* ── server ─────────────────────────────────────────────────────────── */
    section("Server");
    const v = await one(client, "select version() as v, current_database() as db");
    // The version banner carries no credential. The database NAME is not a
    // secret either — the host, role and password are, and none appear here.
    process.stdout.write(`  ${v.v.split(",")[0]}\n`);
    process.stdout.write(`  database: ${v.db}\n`);
    check("server answers SELECT 1", (await one(client, "select 1 as ok")).ok === 1);

    /* ── migration journal ──────────────────────────────────────────────── */
    section("Migration journal");
    const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    check(`${EXPECT.migrations} migration files on disk`, onDisk.length === EXPECT.migrations, `found ${onDisk.length}`);

    const journalExists = await one(
      client,
      "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
    );
    check("drizzle.__drizzle_migrations exists", journalExists.present === true);

    if (journalExists.present) {
      const applied = await one(client, "select count(*)::int as n from drizzle.__drizzle_migrations");
      check(
        `${EXPECT.migrations} migrations applied`,
        applied.n === EXPECT.migrations,
        `applied ${applied.n}`,
      );
      check("nothing pending", applied.n >= onDisk.length, `on disk ${onDisk.length}, applied ${applied.n}`);
    }

    /* ── tables ─────────────────────────────────────────────────────────── */
    section("Tables");
    const tables = (
      await all(
        client,
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
          order by table_name`,
      )
    ).map((r) => r.table_name);
    check(`${EXPECT.tables} tables`, tables.length === EXPECT.tables, `found ${tables.length}`);
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    const extra = tables.filter((t) => !EXPECTED_TABLES.includes(t));
    check("every expected table is present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");
    check("no unexpected table", extra.length === 0, extra.length ? `extra: ${extra.join(", ")}` : "");

    /* ── constraints ────────────────────────────────────────────────────── */
    section("Constraints");
    const fks = await one(
      client,
      `select count(*)::int as n from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'f' and n.nspname = 'public'`,
    );
    check(`${EXPECT.foreignKeys} foreign keys`, fks.n === EXPECT.foreignKeys, `found ${fks.n}`);

    const pks = await one(
      client,
      `select count(*)::int as n from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'p' and n.nspname = 'public'`,
    );
    check("every table has a primary key", pks.n === tables.length, `${pks.n} primary keys / ${tables.length} tables`);

    const allChecks = await all(
      client,
      `select c.conname, c.convalidated from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'c' and n.nspname = 'public'
        order by c.conname`,
    );
    check(
      `${EXPECT.checkConstraints} CHECK constraints`,
      allChecks.length === EXPECT.checkConstraints,
      `found ${allChecks.length}`,
    );
    // The thirteenth. It is the one that does NOT match '%_status_check', which
    // is exactly why the count in DEPLOYMENT.md §6 used to be wrong.
    check(
      "bank_orders_stage_check is present (0008_bank_order_vocabularies)",
      allChecks.some((r) => r.conname === "bank_orders_stage_check"),
    );

    /* ── 0014_status_check_sweep ────────────────────────────────────────── */
    section("0014_status_check_sweep — the status vocabulary (SEC-016)");
    const statusChecks = await all(
      client,
      `select c.conname, c.convalidated from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'c' and n.nspname = 'public' and c.conname like '%\\_status\\_check'
        order by c.conname`,
    );
    check(
      `${EXPECT.statusChecks} *_status_check constraints`,
      statusChecks.length === EXPECT.statusChecks,
      `found ${statusChecks.length}`,
    );
    const unvalidated = statusChecks.filter((r) => r.convalidated !== true).map((r) => r.conname);
    check(
      "every status CHECK is VALIDATED, not merely declared",
      unvalidated.length === 0,
      unvalidated.length ? `NOT VALID: ${unvalidated.join(", ")}` : "",
    );
    // The nine 0014 added, named individually — a count alone would pass if one
    // were swapped for another.
    for (const name of [
      "users_status_check", "banks_status_check", "customers_status_check",
      "documents_status_check", "funding_sources_status_check",
      "service_providers_status_check", "settlements_status_check",
      "transactions_status_check", "verifications_status_check",
    ]) {
      check(`  ${name}`, statusChecks.some((r) => r.conname === name));
    }

    /* ── 0015_ledger_bank_required ──────────────────────────────────────── */
    section("0015_ledger_bank_required — every ledger entry belongs to a bank (D-084)");
    const bankIdCol = await one(
      client,
      `select is_nullable from information_schema.columns
        where table_schema='public' and table_name='ledger_entries' and column_name='bank_id'`,
    );
    check("ledger_entries.bank_id is NOT NULL", bankIdCol?.is_nullable === "NO", `is_nullable=${bankIdCol?.is_nullable}`);

    const nulls = await one(client, "select count(*)::int as n from ledger_entries where bank_id is null");
    check("no ledger entry has a null bank_id", nulls.n === 0, `found ${nulls.n}`);

    const ledgerFk = await one(
      client,
      `select c.confdeltype from pg_constraint c
         join pg_class t on t.oid = c.conrelid
        where c.contype='f' and t.relname='ledger_entries'
          and c.conname='ledger_entries_bank_id_banks_id_fk'`,
    );
    // 'r' = RESTRICT. It was 'n' (SET NULL), which is incompatible with NOT NULL:
    // deleting a bank would try to write NULL into a column that forbids it.
    check(
      "ledger_entries.bank_id FK is ON DELETE RESTRICT",
      ledgerFk?.confdeltype === "r",
      `confdeltype=${ledgerFk?.confdeltype ?? "absent"}`,
    );

    const scaffold = await one(
      client,
      `select count(*)::int as n from pg_constraint
        where conname = 'ledger_entries_bank_id_not_null'`,
    );
    // Step 4 of the migration drops it once SET NOT NULL has taken over. Still
    // present means the migration stopped part-way.
    check("the staged CHECK scaffold was dropped", scaffold.n === 0, `found ${scaffold.n}`);

    /* ── triggers ───────────────────────────────────────────────────────── */
    section("Triggers");
    const triggers = (
      await all(
        client,
        `select t.tgname, c.relname from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where not t.tgisinternal and n.nspname='public'
          order by c.relname, t.tgname`,
      )
    ).map((t) => `${t.relname}.${t.tgname}`);
    check(`${EXPECT.triggers} triggers`, triggers.length === EXPECT.triggers, `found ${triggers.length}`);
    const missingTriggers = EXPECTED_TRIGGERS.filter((t) => !triggers.includes(t));
    check(
      "every expected trigger is present",
      missingTriggers.length === 0,
      missingTriggers.length ? `missing: ${missingTriggers.join(", ")}` : "",
    );
    // Named separately because these two are security controls, not conveniences:
    // one makes the audit trail append-only, the other stops a system role being
    // deleted, re-keyed or deactivated.
    check("audit_logs is append-only at the database", triggers.includes("audit_logs.audit_logs_no_update"));
    check("roles carries the system-role guard (0001_governance_guards)", triggers.includes("roles.roles_protect_system"));

    /* ── indexes ────────────────────────────────────────────────────────── */
    section("Indexes");
    const idx = await one(
      client,
      "select count(*)::int as n from pg_indexes where schemaname='public'",
    );
    const uniq = await one(
      client,
      `select count(*)::int as n from pg_index i
         join pg_class c on c.oid = i.indexrelid
         join pg_namespace ns on ns.oid = c.relnamespace
        where i.indisunique and ns.nspname='public'`,
    );
    const partial = (
      await all(
        client,
        `select c.relname from pg_index i
           join pg_class c on c.oid = i.indexrelid
           join pg_namespace ns on ns.oid = c.relnamespace
          where i.indpred is not null and ns.nspname='public'
          order by c.relname`,
      )
    ).map((r) => r.relname);
    // The totals are reported rather than asserted: they move legitimately with
    // any index addition. The PARTIAL ones are asserted by name, because a lost
    // predicate is silent and expensive — see EXPECTED_PARTIAL_INDEXES.
    process.stdout.write(`  indexes: ${idx.n}   unique: ${uniq.n}   partial: ${partial.length}\n`);
    const missingPartial = EXPECTED_PARTIAL_INDEXES.filter((p) => !partial.includes(p));
    check(
      `${EXPECTED_PARTIAL_INDEXES.length} partial unique indexes, each with its predicate intact`,
      missingPartial.length === 0 && partial.length >= EXPECTED_PARTIAL_INDEXES.length,
      missingPartial.length ? `missing or no longer partial: ${missingPartial.join(", ")}` : `${partial.length} present`,
    );

    /* ── seed state ─────────────────────────────────────────────────────── */
    section("Seed state (informational before db:seed has run)");
    const roles = await one(client, "select count(*)::int as n from roles");
    const perms = await one(client, "select count(*)::int as n from permissions");
    const docTypes = await one(client, "select count(*)::int as n from required_document_types");
    const admins = await one(
      client,
      `select count(*)::int as n from users u join roles r on r.id = u.role_id
        where r.is_system and u.status='Active' and u.deleted_at is null`,
    );
    process.stdout.write(`  roles: ${roles.n}   permissions: ${perms.n}   required_document_types: ${docTypes.n}\n`);
    process.stdout.write(`  active system-role users: ${admins.n}\n`);

    if (roles.n > 0 || perms.n > 0) {
      check("5 roles seeded", roles.n >= 5, `found ${roles.n}`);
      check("permission catalogue seeded", perms.n >= 60, `found ${perms.n}`);
      check(
        "at least one active Super Admin — without this nobody can sign in",
        admins.n >= 1,
        `found ${admins.n}`,
      );
    } else {
      process.stdout.write("  (seed has not run yet — run `npm run db:seed`)\n");
    }
  } finally {
    await client.end();
  }

  /* ── summary ──────────────────────────────────────────────────────────── */
  process.stdout.write(`\n${"═".repeat(60)}\n`);
  process.stdout.write(`  ${passed} passed, ${failed} failed\n`);
  if (failed) {
    process.stdout.write("\n  FAILURES:\n");
    for (const f of failures) process.stdout.write(`    - ${f}\n`);
  }
  process.stdout.write(`${"═".repeat(60)}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  // The message only. A `pg` error's `detail` can carry row values and its
  // message can carry the host — neither belongs in a verification log.
  process.stderr.write(`\nVerification FAILED to run: ${error.message}\n`);
  process.exit(1);
});
