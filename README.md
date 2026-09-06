# CMBBACKEND — Rise Next Banking CRM API

Express 5 + Drizzle + PostgreSQL (Neon). The API and data tier for a multi-bank
DSA / lending operation.

```
src/        application source
drizzle/    16 migrations + snapshots + journal — the schema's history
scripts/    release.mjs (the migration release step), ci-local.sh
docs/       living project documentation — start at docs/README.md
```

> ## THIS REPOSITORY IS ONE HALF OF A SPLIT
>
> | | |
> |---|---|
> | **Backend (here)** | <https://github.com/RiseNext/CMBBACKEND> |
> | **Frontend** | <https://github.com/RiseNext/CMBFRONTEND> |
>
> The two were a single monorepo until the production split. Paths inside this
> repository's own documentation have been rewritten to be valid here. Where a
> document still refers to `frontend/src/...`, `frontend/next.config.ts` or
> `frontend/.env.example`, it means **that path inside CMBFRONTEND** — those
> references were left intact rather than mangled, because the history and the
> reasoning they carry are worth more than a broken relative link would cost.
>
> This repository is the **operations home**: deployment, secrets, migrations,
> bootstrap, runbook, security and decision records all live in `docs/` here.

> ## PROJECT STATUS
>
> Backend **1299/1299 tests across 56 files** · typecheck clean · lint clean ·
> `drizzle-kit check` fine · `db:generate` zero diff · migrations / snapshots /
> journal **16 / 16 / 16**.
>
> **Not deployed.** `docs/README.md` is the source of truth for what actually
> works; `docs/GO_LIVE_CHECKLIST.md` is the ordered list of what remains.
> Do not treat this README as a completeness claim.

---

## Architecture

```
Vercel (Next.js)  ──HTTPS──>  Railway (Express API)  ──TLS──>  Neon (PostgreSQL)
  access token in memory        argon2id + JWT               migrations via
  refresh token httpOnly        permission checks            DIRECT_DATABASE_URL
```

Authorisation is resolved per request as `user → role → permissions`, plus a
bank-scope filter applied in the data layer. There is no `if (role === "admin")`
anywhere in the codebase; grep for it.

---

## Setup

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL, both JWT secrets, AADHAAR_PEPPER
npm run release             # applies drizzle/*.sql against DIRECT_DATABASE_URL
npm run db:seed             # permissions, default roles, bootstrap super admin
npm run dev
```

Generate secrets with `openssl rand -base64 48`. `JWT_ACCESS_SECRET` and
`JWT_REFRESH_SECRET` must differ; production boot refuses if they match.
`AADHAAR_PEPPER` has **no default in any environment** and `.env.example` ships
it empty, so `cp .env.example .env` deliberately will not boot until you
generate one.

### npm scripts

| Script | Does |
|---|---|
| `npm run dev` | `tsx watch src/server.ts` |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` |
| `npm start` | `node dist/server.js` |
| `npm run typecheck` / `lint` / `test` | the gates |
| `npm run release` | **the migration release step** — see below |
| `npm run release:check` | report pending migrations, change nothing |
| `npm run db:generate` | drizzle-kit generate (must be a no-op) |
| `npm run db:migrate` | the application-code migrator (`src/db/migrate.ts`) |
| `npm run db:seed` | permission catalogue, five roles, first Super Admin |
| `npm run jobs` | the four scheduled jobs — `npm run jobs -- all --dry-run` |

---

## Environment variables

**[`.env.example`](.env.example) is the authoritative template** — it documents
every variable with its default and its production tripwires, and
`src/tests/env-template.test.ts` **fails the build** if it drifts from
`src/config/env.ts`. Copy it; do not hand-write a `.env`.

`docs/SECRETS.md` classifies every variable as REQUIRED / OPTIONAL / DEV-ONLY and
🔴 SECRET / 🟡 SENSITIVE / ⚪ PUBLIC, with generator commands and rotation costs.

| Name | Required | Notes |
|---|---|---|
| `NODE_ENV` | **yes** | `development` \| `test` \| `production`. **No default** — the backend refuses to start without it, because this variable alone decides the refresh cookie's `Secure` / `SameSite` flags (SEC-028) |
| `DATABASE_URL` | yes | Neon **pooled** endpoint (`-pooler`) for the app |
| `DIRECT_DATABASE_URL` | for migrations | Neon **direct** endpoint; DDL through the pooler can deadlock on session-scoped locks |
| `JWT_ACCESS_SECRET` | yes | ≥32 chars |
| `JWT_REFRESH_SECRET` | yes | ≥32 chars, must differ from the access secret |
| `ACCESS_TOKEN_TTL` | no | default `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | no | default `7` |
| `COOKIE_DOMAIN` | no | leave **unset** for a split Vercel/Railway deployment; a wrong value makes the browser reject the cookie |
| `CORS_ORIGIN` | yes in prod | comma-separated allow-list; the Vercel origin, no trailing slash. No wildcard — the API sends credentials |
| `FRONTEND_URL` | **yes in prod** | default `http://localhost:3000`. **Every emailed link is built from it** — `src/services/invitations.ts:55`, `src/services/password-reset.ts:51`. Left at the default on a deployed backend, mail sends successfully and every link points at `localhost` |
| `AADHAAR_PEPPER` | **yes everywhere** | ≥32 chars, no default. Rotating it invalidates every stored Aadhaar hash **permanently** — read `docs/SECRETS.md` §5 first |
| `EMAIL_PROVIDER` / `EMAIL_API_KEY` / `EMAIL_FROM` / `EMAIL_REPLY_TO` | **yes in prod** | all four, or boot fails. Provider is Resend (D-033) |
| `STORAGE_PROVIDER` / `STORAGE_BUCKET` / `STORAGE_REGION` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | **yes in prod** | all five, or boot fails. AWS S3 `ap-south-1` (D-071) — data residency for Indian KYC documents is a **legal** constraint |
| `STORAGE_ENDPOINT` | no | only for an S3-compatible provider that is not AWS |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | no | default `300`, max `3600` |
| `MAX_DOCUMENT_MB` | no | default `15`; KYC uploads. **Deliberately not `MAX_UPLOAD_MB`** (D-072) |
| `MAX_UPLOAD_MB` | no | default `10`; the **Excel importer** only — that path's zip-bomb decompression budget (SEC-008) |
| `RECYCLE_BIN_RETENTION_DAYS` | no | default `30`; the fallback when no `recycleBin.retentionDays` setting is stored |
| `BOOTSTRAP_SUPERADMIN_EMAIL` / `_PASSWORD` | first boot only | **If either is unset the seed creates no user at all** and nobody can sign in. Remove after the first password change |
| `PORT` | no | default `8080` |
| `LOG_LEVEL` | no | default `info`. Read raw in `src/lib/logger.ts`, **outside the zod schema and unvalidated** |
| `ERROR_TRACKING_URL` / `_TOKEN` / `_TIMEOUT_MS` / `RELEASE_SHA` | no | unset → errors go to the pino log only |

**Nine variables are required in production and in no other environment**: the
four `EMAIL_*` and the five `STORAGE_*`. The backend refuses to boot without
them and names the missing keys — never their values.

**Never commit `.env`.** `.gitignore` covers `.env` and `.env.*` while keeping
`.env.example` trackable, and the CI **hygiene** job fails the build if an
environment file is ever tracked.

---

## Neon setup

1. Create a project. Pin it to one PostgreSQL major version and do not let it
   drift.
2. Copy **both** connection strings — the pooled one (`-pooler` in the host) and
   the direct one.
3. `DATABASE_URL` = pooled, `DIRECT_DATABASE_URL` = direct.
4. `npm run release`, then `node scripts/verify-postgres.mjs`, then
   `npm run db:seed`.
5. Verify: `curl $API/api/health/ready` → `{"database":{"connected":true}}`.

The schema is reproducible from zero: **30 tables, 65 foreign keys, 13 CHECK
constraints, 7 triggers, 21 partial unique indexes**, and re-running the
migrations is a no-op. `scripts/verify-postgres.mjs` asserts every one of those
against a live server and exits non-zero on a mismatch.

> Those counts were **measured** at the repository split. `docs/DATA_MODEL.md`
> and the original root README said 27 tables and 62 foreign keys — numbers that
> predate `assignment_history`, `invitations`, `password_resets` and
> `recycle_bin_entries`. Where a document and the script disagree, the script
> is the one that ran.

See **`docs/STAGING.md`** for the difference between this staging setup and
production, and for what running the migrations against a real server does and
does not prove.

---

## Migrations — the release strategy (D-090)

> **Migrations run as a release step, never on application boot, against
> `DIRECT_DATABASE_URL`, one at a time.**

```bash
npm run release          # apply pending migrations
npm run release:check    # report only; changes nothing
```

`scripts/release.mjs` **refuses to run** when `DATABASE_URL` looks pooled and
`DIRECT_DATABASE_URL` is unset — Neon's pooled endpoint is PgBouncer in
transaction mode, and the migrator's session-scoped advisory lock can be taken
on one backend while the DDL runs on another, so the protection silently stops
working. The check is a hostname heuristic and the script says so.

Nothing runs migrations from `CMD`: the `Dockerfile` starts the server and
nothing else, because every replica would otherwise race to apply the same DDL
on every restart.

Full detail — ordering, rollback position per migration, backup and restore,
and the populated-database procedure — is in **`docs/DEPLOYMENT.md` §3, §5, §6**.

---

## Testing

```bash
npm run typecheck && npm run lint && npm test && npm run build
bash scripts/ci-local.sh    # the whole CI pipeline, locally
```

**1,299 test cases across 56 files.** The suite runs the **real shipped
migration files** against a PostgreSQL engine compiled to WASM (PGlite) — no
external database needed, and a broken migration fails the suite.

> Measured on a clean checkout at the repository split. The project's own
> documentation still says 1258/55 — that was the count when it was written,
> and the working tree has gained a file and 41 cases since.

> **PGlite is not PostgreSQL.** These migrations have not been executed against
> a real server by this suite, and there is no `TEST_DATABASE_URL` override in
> the harness (`src/tests/harness.ts` constructs PGlite unconditionally).
> Building that override is roadmap task **14.9** and is the highest-value
> remaining engineering work. There are also **no end-to-end tests** — jsdom is
> not a browser. Both gaps are stated in `docs/TESTING_STRATEGY.md` rather than
> implied away.

---

## Roles and permissions

Roles are rows, not code. `key` is the stable identity; `name` is a display
label the client may rename freely; `level` sets hierarchy (lower = more
authority).

| key | name | level |
|---|---|---|
| `super_admin` | Super Admin | 0 — protected: cannot be deleted, re-keyed or deactivated, enforced by a **database trigger** |
| `admin` | Admin | 10 |
| `manager` | Manager | 20 |
| `team_leader` | Team Leader | 30 |
| `executive` | Executive | 40 |

One rule produces the whole hierarchy: **an actor may only act on a subject
whose role level is strictly greater than their own**, unless they hold
`system.manage_any_user`. Admin (10) therefore cannot create another Admin (10)
or touch Super Admin (0), with no role names in the code.

`system.access_all_banks` is the bank-scope bypass. Because it is a permission
and not a role check, a custom "Group Auditor" role can be given
read-everything access without a code change.

Privilege escalation is blocked separately: you cannot grant a permission you do
not hold yourself.

---

## Data protection

- Passwords: argon2id (m=19456, t=2, p=1), never logged, never in audit diffs.
- Aadhaar: **HMAC-SHA256 under `AADHAAR_PEPPER`** plus the last 4 digits only.
  No raw Aadhaar is stored.
- No card numbers, no CVV, no bank credentials stored anywhere.
- Audit log is append-only, enforced by a `BEFORE UPDATE OR DELETE` trigger.
- The logger redacts `authorization`, `cookie`, `set-cookie`, and any
  `password*`, `token*` or `aadhaar*` field **at any depth**.

---

## API surface

| Mount | Notes |
|---|---|
| `/api/health`, `/api/health/ready` | liveness; readiness pings the database |
| `/api/auth` | login, refresh, logout, me, change-password |
| `/api/users` | CRUD + `PUT /:id/banks` + `POST /:id/reset-password` |
| `/api/roles` | CRUD + `PUT /:id/permissions` + `GET /permissions` catalogue |
| `/api/teams` | CRUD + `PUT /:id/members` |
| `/api/banks`, `/api/customers` | CRUD, scoped |
| `/api/loans` | CRUD + `POST /:id/approve` + `POST /:id/verification` |
| `/api/verifications`, `/api/bank-orders` | CRUD, scoped |
| `/api/disbursements`, `/api/settlements` | CRUD + approve |
| `/api/transactions`, `/api/ledger`, `/api/documents` | CRUD, scoped |
| `/api/funding-sources`, `/api/service-providers` | CRUD |
| `/api/recycle-bin` | list, `POST /:id/restore`, `POST /:id/permanent-delete` |
| `/api/audit-logs` | read-only |
| `/api/imports` | template, upload/validate, preview, confirm |
| `/api/settings` | application settings |
| `/api/dashboard` | `/stats`, `/loan-status`, `/bank-performance` |

Every scoped resource routes through one factory
(`src/modules/scoped-resource.ts`), so the WHERE clause that enforces bank
isolation is assembled in exactly one place. The full inventory — 96 endpoints
with permission, validation, DB effect and caller — is in `docs/API_OVERVIEW.md`.

---

## Scheduled jobs

```bash
node dist/jobs/run.js all              # everything, in order
node dist/jobs/run.js <name> --dry-run # select and report, change nothing
```

| Job | Does | Suggested |
|---|---|---|
| `expire-import-batches` | Destroys staged import rows past retention — **SEC-009** | Daily, 02:00 IST |
| `purge-recycle-bin` | Permanently removes expired bin entries **and their S3 objects** | Daily, 02:15 IST |
| `cleanup-refresh-tokens` | Deletes tokens dead longer than 7 days | Weekly |
| `detect-sla-breach` | Notifies the people accountable for a breached bank order | Hourly, business hours |

> **Until the cron is wired, nothing is purged.** The retention half of SEC-009
> is implemented and tested and **not yet in effect**. `docs/DEPLOYMENT.md` §7.

---

## Railway deployment

1. New service from **this** repository. Root directory is the repository root —
   there is no `backend/` subdirectory any more.
2. `railway.json` selects the `Dockerfile` builder, start command
   `node dist/server.js`, health-check path `/api/health/ready`.
3. Set every variable in `.env.example` except the bootstrap pair, which is set
   once, used, then removed.
4. Run `npm run release`, then `npm run db:seed`, against the Neon database.

Full sequence, rollback, backup/restore and a 12-step smoke test:
**`docs/DEPLOYMENT.md`**.

---

## Deployment status

**Not deployed — and everything needed to deploy exists.**

**What has never been exercised, stated rather than implied away:** the Docker
image has never been built, no migration had ever run against real PostgreSQL at
the time of the split, the S3 adapter has never made a network call, no email
has ever reached Resend, and no restore has been rehearsed.

| Document | For |
|---|---|
| [`docs/GO_LIVE_CHECKLIST.md`](docs/GO_LIVE_CHECKLIST.md) | **Start here.** The ordered list, plus 72-hour hypercare |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Migrations, rollback, backup/restore, smoke test |
| [`docs/SECRETS.md`](docs/SECRETS.md) | Every variable, classified, with generator commands |
| [`docs/BOOTSTRAP.md`](docs/BOOTSTRAP.md) | The first Super Admin, and emergency recovery |
| [`docs/EMAIL.md`](docs/EMAIL.md) | All three mail flows and a 14-step production test |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Day-2 operations and incidents |
