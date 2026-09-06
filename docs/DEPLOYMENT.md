# DEPLOYMENT

**Target architecture — OD-3, ratified 2026-09-06 as D-091:**

| Component | Platform | Why |
|---|---|---|
| Frontend | **Vercel** | Next.js 16; region `bom1` (Mumbai) |
| Backend | **Railway** | Container, `ap-south` |
| Database | **Neon Postgres** | `ap-south-1`; pooled + direct endpoints |
| Object storage | **AWS S3** | `ap-south-1` — **legal**, not preference (OPEN-2 / D-071) |
| Email | **Resend** | D-033 |

> ## NOTHING BELOW HAS EVER BEEN EXECUTED
>
> There is no deployment, no Neon project and no bucket. Every file referenced
> here exists and is syntactically valid; the **image has never been built**
> (Docker is installed on the authoring machine but its daemon was not running)
> and **no migration has ever run against a real Postgres server** (roadmap
> 14.9). Treat the first deployment as the integration test, and use §8.

---

## 1. WHAT IS IN THE REPOSITORY

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build. Builder has devDependencies; runtime has none |
| `.dockerignore` | Keeps `.env`, tests and `node_modules` out of the build context |
| `railway.json` | Builder, start command, health-check path, restart policy |
| `scripts/release.mjs` | The migration release step, with a pooled-URL guard |
| `scripts/verify-postgres.mjs` | Schema assertions against a live server — read-only, prints no connection string |
| `docs/STAGING.md` | Staging vs production, and what real-Postgres verification does **not** cover |
| `vercel.json` **in CMBFRONTEND** | Framework, region `bom1` |
| `.github/workflows/ci.yml` | The gates. **Never run remotely** — see §9 |
| `scripts/ci-local.sh` | The same gates, locally. **Has** been run — §9 |

### Deliberately absent

**No `docker-compose.yml`** — nothing here runs multi-container locally; Neon is
the database in every environment above development.

**No infrastructure-as-code.** Four managed platforms configured through their
dashboards. Terraform for this would be more moving parts than it removes, and
none of it would be exercised until the second environment exists.

---

## 2. FIRST DEPLOYMENT, IN ORDER

The order matters. Each step needs the one before it.

```
Neon ──► S3 ──► Resend ──► Railway ──► migrate ──► seed ──► Vercel ──► CORS
```

Two of those are easy to get backwards:

- **Railway before Vercel**, because Vercel needs `NEXT_PUBLIC_API_URL` and that
  is the Railway URL.
- **`CORS_ORIGIN` after Vercel**, because it is the Vercel URL. Set it to a
  placeholder, deploy the frontend, then come back and correct it. Until you do,
  every browser request fails — and BUG-022 means the failure arrives as a
  **500**, so it looks like the API is broken rather than misconfigured.

The exact click-by-click sequence, with what proves each step, is in the
handoff's **HUMAN PRODUCTION SETUP START POINT**.

---

## 3. MIGRATIONS — the release strategy (D-090)

### The rule

**Migrations run as a release step, never on application boot, against
`DIRECT_DATABASE_URL`, one at a time.**

```bash
npm run release          # apply pending migrations
npm run release:check    # report only; changes nothing
```

### Why not on boot

Every replica would race to apply the same DDL on every restart. Drizzle takes
an advisory lock, so it is survivable rather than safe — and "survivable" is not
a reason to design it that way. D-050 already states the rule: one migration in
flight.

`railway.json` sets `numReplicas: 1`, which makes the race impossible today. It
is **not** the protection — scaling to two is a dashboard toggle, and the
protection must not be a setting somebody can change without knowing.

### Why the direct endpoint

Neon's pooled endpoint is PgBouncer in **transaction mode**. Session-scoped
things — advisory locks, `SET LOCAL`, some `ALTER` forms — either fail or apply
to a different backend than the one continuing the transaction. The migrator
takes an advisory lock, so through the pooler the lock can be held on one
backend while the DDL runs on another: the protection silently stops working.

`scripts/release.mjs` therefore **refuses** when `DATABASE_URL` looks pooled and
`DIRECT_DATABASE_URL` is unset. Verified locally:

```
$ DATABASE_URL='postgresql://…-pooler.ap-south-1.aws.neon.tech/crm' npm run release:check
Migration release FAILED: DATABASE_URL points at a POOLED endpoint and
DIRECT_DATABASE_URL is not set. …
exit 1
```

The check is a hostname heuristic and the script says so. It is a guard rail.

### How to invoke it

**Option A — from CI or a laptop (recommended to start).** Explicit, and you see
the output before traffic moves:

```bash
railway run --service <backend> npm run release
```

**Option B — a Railway pre-deploy command.** If your plan offers one, set it to
`npm run release`. Deliberately **not** written into `railway.json`: the key is
not supported on every plan, and an unrecognised key can reject the whole file
— a configuration error that stops deploys entirely, to save one manual step.

### Ordering and the current state

Sequential, `0000` → `0015`, by filename. Drizzle records applied migrations in
`drizzle.__drizzle_migrations` and skips them on the next run.

- **16 migrations**, `0000_init` … `0015_ledger_bank_required`
- **16 snapshots**, **16 journal entries** — all three counts agree, and CI
  fails if they ever do not (§9)
- `drizzle-kit check`: *Everything's fine*
- `db:generate`: **zero diff**

### PostgreSQL compatibility

| | |
|---|---|
| **Developed and tested against** | PGlite 0.5.4, which reports **`PostgreSQL 18.3 … on wasm32-unknown-linux-gnu`** |
| **Recommended for production** | **17 or 18** on Neon. Pin whichever you choose |
| **Minimum plausible** | **15**. Nothing uses a 16-, 17- or 18-only feature *that has been identified*, but **this has not been verified against a real 15 server** and is not a supported claim |

> **Corrected at the repository split (2026-09-06).** These two rows said
> PostgreSQL **17** in both places. `select version()` on the pinned PGlite
> 0.5.4 returns **18.3**. The distinction is not cosmetic: on 17+ a `NOT NULL`
> constraint appears in `pg_constraint` with `contype='n'` rather than being
> invisible there, which changes what the catalogue queries in §6 return. The
> number was never measured before; it is now.

Features the schema relies on: `gen_random_uuid()` (pgcrypto, built in from 13),
`jsonb`, partial and expression unique indexes, `BEFORE UPDATE OR DELETE`
triggers (`0001_governance_guards.sql`), `NOT VALID` CHECK constraints with a
separate `VALIDATE`, and `numeric` throughout for money.

**Pin the Neon project to one major version and do not let it drift.**

### Verifying against a populated database — roadmap 14.9

The suite runs on a **fresh** database every time. A migration can be correct
against an empty table and fail against a populated one — a `NOT NULL` on a
column with existing nulls, a `CHECK` on rows that predate the vocabulary. Two
of the sixteen are exactly that shape (`0014`, `0015`).

`src/tests/migration-populated.test.ts` covers this on PGlite. **On real
Postgres it has never been done.** Procedure:

1. Restore a production-shaped dump into a scratch Neon branch.
2. `DIRECT_DATABASE_URL=<branch direct URL> npm run release:check` — read the
   pending count.
3. `npm run release`.
4. Re-run `release:check`; pending must be 0.
5. Spot-check the constraints the last two migrations add:
   ```sql
   select count(*) from ledger_entries where bank_id is null;  -- must be 0
   select conname, convalidated from pg_constraint where conname like '%_status_check';
   ```
   `convalidated` must be `true` for every row.
6. Point a staging backend at the branch and run the smoke tests (§8).

---

## 4. HEALTH AND READINESS

| Endpoint | Touches the DB | Used by |
|---|---|---|
| `GET /api/health` | **No** | The container `HEALTHCHECK` — liveness |
| `GET /api/health/ready` | **Yes** (`select 1`) | Railway's `healthcheckPath` — readiness |

The split is deliberate. Liveness must not depend on the database, or a Neon
blip restart-loops a perfectly healthy container — and a restart cannot fix a
database outage, so it can only make things worse. Readiness *must* depend on
it, so Railway does not route traffic to an instance that cannot serve.

**Neither leaks infrastructure.** `/health/ready` used to return the driver
error verbatim, which carries the host, port, database name and role — an
unauthenticated map of the data tier. It now returns `{connected:false}` and the
detail goes to the log at `error` level (SEC-015).

```jsonc
// 200
{"status":"ok","database":{"connected":true,"latencyMs":12},"timestamp":"…"}
// 503
{"status":"degraded","database":{"connected":false},"timestamp":"…"}
```

Both are unauthenticated — they must be, a health check cannot present a
credential — and `/api/health` is **exempt from the global rate limiter**, so
the limiter cannot restart-loop the platform.

---

## 5. ROLLBACK

### Application code

Vercel and Railway both keep previous deployments; roll back from the dashboard.
Seconds, no data effect.

### The rule that governs everything else

> **Roll the code back. Do not roll the schema back.**

Every migration here is written so the **previous** application version still
runs against the **new** schema. Adding a CHECK constraint, a NOT NULL, or an
index does not break the older code. So the recovery for a bad deploy is:
redeploy the previous image, leave the schema alone, fix forward.

### When the schema itself is the problem

| Migration | Reversible? | What to do |
|---|---|---|
| `0014_status_check_sweep` | **Yes** | `ALTER TABLE x DROP CONSTRAINT x_status_check;`. Drops a rule; loses no data |
| `0015_ledger_bank_required` | **Partly** | `SET NOT NULL` → `DROP NOT NULL` is clean. The FK `restrict` → `set null` is a separate `ALTER`. Neither loses data |
| `0011_notification_event_model` | **No** | It refuses to run against a null-recipient row rather than deleting one (D-077). Once applied, reverting means dropping a NOT NULL and a unique index — safe — but rows written since would need reconciling |
| `0000`–`0013` generally | **No, and do not try** | Dropping a column destroys its data |

**There is no down-migration mechanism and there deliberately is not one.**
Drizzle does not generate them, and a hand-written `down` that has never been
executed is worse than none: it reads as a safety net and is not one.

For a genuinely bad schema change the recovery is **restore from backup**
(§6) — which is why a verified pre-release backup is step one of every release.

### Configuration

Environment variables roll back by editing and redeploying. Two carry a trap:

- **`NEXT_PUBLIC_*` are baked in at build time.** Changing one requires a
  redeploy; restarting does nothing.
- **Reverting `AADHAAR_PEPPER` is not a rollback** — the *previous* value is the
  one that matches the data. See `docs/SECRETS.md` §5.

---

## 6. BACKUP AND RESTORE

### What Neon provides

Point-in-time restore over a retention window that depends on the plan (7 days
on paid tiers at time of writing — **confirm yours**), and instant branching,
which is the cheapest way to get a copy to test against.

**Neon's PITR is the backup of record.** Do not build a second mechanism until
you have read the plan's actual retention.

### What is NOT in Neon

**Documents.** KYC files are in S3, and S3 is a separate failure domain with a
separate backup story. A database restore to yesterday leaves today's uploads in
the bucket with **no rows pointing at them** — orphans, not corruption, but
nobody will find them. Enable **S3 Versioning** on the bucket, which makes an
accidental delete recoverable, and note that versioning is not a backup either.

### The independent dump (recommended)

Retention windows expire and accounts get suspended. One weekly logical dump
somewhere outside Neon:

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --file="crm-$(date +%F).dump" "$DIRECT_DATABASE_URL"
```

Store encrypted. **It contains every customer's PII.** Treat the dump file with
the same care as the database — that includes not leaving it on a laptop.

### Restore

```bash
# 1. New Neon branch — never restore over the live database first.
# 2. Restore into it.
pg_restore --no-owner --no-privileges --dbname "$SCRATCH_DIRECT_URL" crm-2026-09-06.dump
# 3. Verify (below).
# 4. Only then repoint DATABASE_URL / DIRECT_DATABASE_URL and redeploy.
```

### Integrity verification — run all of these

**Or run the script, which is these queries and about thirty more:**

```bash
node scripts/verify-postgres.mjs           # against DIRECT_DATABASE_URL
node scripts/verify-postgres.mjs --pooled  # and again through the pooler
```

It writes nothing, prints no connection string, and exits non-zero on any
failure. Added at the repository split, when the counts below were measured for
the first time against a real server.

```sql
-- Roles and permissions seeded
select count(*) from roles;                                   -- expect 5+
select count(*) from permissions;                             -- expect 60+
-- At least one usable administrator, or nobody can sign in
select count(*) from users u join roles r on r.id=u.role_id
 where r.is_system and u.status='Active' and u.deleted_at is null;   -- >= 1
-- Migrations all applied
select count(*) from drizzle.__drizzle_migrations;            -- expect 16
-- The shape of the schema
select count(*) from information_schema.tables
 where table_schema='public' and table_type='BASE TABLE';     -- expect 30
select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid
 join pg_namespace n on n.oid=t.relnamespace
 where c.contype='f' and n.nspname='public';                  -- expect 65
-- The invariants the last two migrations added
select count(*) from ledger_entries where bank_id is null;    -- expect 0
select count(*) from pg_constraint where conname like '%_status_check';  -- expect 12
-- The immutability trigger survived the restore
select tgname from pg_trigger where tgrelid='audit_logs'::regclass;
```

> ### ⚠️ THREE OF THESE NUMBERS WERE WRONG UNTIL 2026-09-06
>
> The `%_status_check` row said **expect 13**. The real answer is **12**: there
> are thirteen CHECK constraints, but the thirteenth is
> `bank_orders_stage_check`, which ends in `_stage_check` and does not match
> that `LIKE` pattern. An operator running this after a restore would have read
> a perfectly good database as a failed one, during an incident.
>
> The table and foreign-key rows are **new**, and they are 30 and 65 —
> `DATA_MODEL.md` and the old root README both say 27 and 62. Those predate
> `assignment_history`, `invitations`, `password_resets` and
> `recycle_bin_entries`.
>
> All of these were produced by applying the sixteen shipped migrations to a
> fresh engine and counting the catalogue. `scripts/verify-postgres.mjs` carries
> the same numbers with the derivation written next to them, so the next person
> to find a mismatch can tell whether the schema moved or the list went stale.

Then the application checks:

1. `GET /api/health/ready` → 200.
2. Sign in as a real user.
3. Open a customer with a document and **download it** — this is what proves the
   database and the bucket still agree.
4. `npm run jobs -- all --dry-run` → completes, reports counts, changes nothing.

### What has NOT been done

**No restore has ever been rehearsed** — there is no database to restore. It
stays **EXTERNAL/PENDING** until somebody runs the above against a real Neon
branch and records the date.

---

## 7. SCHEDULED JOBS

Four jobs, one entry point:

```bash
node dist/jobs/run.js all              # everything, in order
node dist/jobs/run.js <name>           # one
node dist/jobs/run.js <name> --dry-run # select and report, change nothing
node dist/jobs/run.js <name> --limit=N
```

| Job | Does | Suggested |
|---|---|---|
| `expire-import-batches` | Destroys staged import rows past retention — **SEC-009** | Daily, 02:00 IST |
| `purge-recycle-bin` | Permanently removes expired bin entries **and their S3 objects** | Daily, 02:15 IST |
| `cleanup-refresh-tokens` | Deletes tokens dead longer than 7 days | Weekly |
| `detect-sla-breach` | Notifies the people accountable for a breached bank order | Hourly, business hours |

**Exit 0 only when every job completed with `failed === 0`.** Nothing found is a
success; something selected and not processed is not.

### Wiring it — the remaining external step

Railway Cron: add a service from the same repository/image, set the schedule and
the start command, and give it **the same environment variables as the API**
(it needs `DATABASE_URL`, and `purge-recycle-bin` needs the `STORAGE_*` keys to
delete objects).

Run each once with `--dry-run` first and read the counts.

> **Until this is wired, nothing is purged.** The retention half of SEC-009 is
> *implemented and tested* and **not yet in effect**.

---

## 8. SMOKE TEST AFTER ANY DEPLOY

Ten minutes, in order. Stop at the first failure.

| # | Check | Pass |
|---|---|---|
| 1 | `GET /api/health` | 200 |
| 2 | `GET /api/health/ready` | 200, `connected: true` |
| 3 | Load the Vercel origin | Login page, no console CORS error |
| 4 | Sign in | Workspace loads |
| 5 | **Reload the page** | **Still signed in.** A sign-out here means `NODE_ENV` is not `production` or `COOKIE_DOMAIN` is wrong — the classic split-deployment failure |
| 6 | Open Customers | Real data or an honest empty state — never a spinner that never resolves |
| 7 | Create a customer | 201, appears in the list |
| 8 | Upload a document, then download it | Both work → S3 is correctly wired |
| 9 | Create an employee | Invitation email arrives; the link host is the Vercel origin |
| 10 | Sign in as a non-admin | Sidebar shows fewer items; a forbidden URL refuses honestly |
| 11 | `npm run release:check` | Pending = 0 |
| 12 | `node dist/jobs/run.js all --dry-run` | Exit 0 |

---

## 9. CI

`.github/workflows/ci.yml` — four parallel jobs: **backend**, **schema**,
**frontend**, **hygiene**.

The **schema** job exists because of Wave 0: snapshots for `0008`–`0013` were
absent for six migrations and nothing noticed, because the breakage only appears
the next time somebody runs `generate`. Three checks now stop that recurring —
`drizzle-kit check`, a count agreement between migrations/snapshots/journal, and
a **content-hash snapshot taken before and after `db:generate`**.

> That last one was wrong on its first draft. It used `git diff`, which answers
> "does the tree match HEAD?" — a different question that is blind to untracked
> files and fails on legitimate uncommitted migration work. It reported a
> failure that had nothing to do with the schema. The before/after hash is what
> the check is actually about.

### What was actually run

**`scripts/ci-local.sh` executes every step above locally, and has been run.**
First run: 13 passed, 2 failed — one type error in a new test, and the
`git diff` defect above. Both fixed; see the final report for the re-run.

**GitHub Actions has never executed this workflow.** There is no remote. Two
things only GitHub can prove: that `npm ci` resolves on a clean runner, and that
the YAML parses as Actions expects. **The first push is the test.** If it fails,
it will be in the runner setup, not in the commands — those have all run here.
