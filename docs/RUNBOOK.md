# OPERATIONAL RUNBOOK

**Day-2 operations for Rise Next Banking CRM.** Written 2026-09-06 (Wave 5).

> **Every command here exists.** Nothing was invented for the sake of a complete
> table. Where a procedure cannot be completed with what is in the repository,
> it says so instead of describing a plausible command that would fail.

**Companion documents:** `DEPLOYMENT.md` (first deploy, migrations, rollback,
backup) · `SECRETS.md` (variables, pepper) · `EMAIL.md` (flows, test procedure) ·
`BOOTSTRAP.md` (first Super Admin, emergency recovery).

---

## 0. THE THREE THINGS TO KNOW BEFORE YOU TOUCH ANYTHING

1. **`AADHAAR_PEPPER` is effectively permanent.** Changing it silently breaks
   Aadhaar search and duplicate detection for every existing customer, and no
   backup repairs it. `SECRETS.md` §5 before you go near it.
2. **`audit_logs` cannot be edited or deleted** — a database trigger enforces it
   (`0001_governance_guards.sql`). Do not try to "clean up" a bad row; you
   cannot, and the attempt will fail loudly.
3. **Roll code back, not the schema.** Every migration is written so the
   previous application version still runs against the new schema.
   `DEPLOYMENT.md` §5.

---

## 1. ROUTINE

| Cadence | Task | How |
|---|---|---|
| Per deploy | Smoke test | `DEPLOYMENT.md` §8 |
| Daily | Scheduled jobs completed | Railway Cron logs; exit 0 and `failed: 0` |
| Daily | Error rate | Railway logs at `error`, or the collector if configured |
| Weekly | `npm run release:check` reports 0 pending | §3 |
| Weekly | Independent dump | `DEPLOYMENT.md` §6 |
| Monthly | Restore rehearsal into a scratch branch | `DEPLOYMENT.md` §6 |
| Monthly | Review `audit_logs` for `permission_denied` clusters | §7 |
| Quarterly | Rotate JWT, email and storage keys | `SECRETS.md` §6 |
| Quarterly | Confirm Neon PITR retention is what you think | Neon dashboard |

---

## 2. DEPLOYING A CHANGE

```
CI green ──► backup verified ──► migrations ──► backend ──► frontend ──► smoke
```

1. CI green on the commit (`.github/workflows/ci.yml`).
2. `npm run release:check` — know the pending count **before** you start.
3. Confirm a recent backup (`DEPLOYMENT.md` §6). Non-negotiable when step 2 is
   non-zero.
4. `railway run --service <backend> npm run release`.
5. Deploy the backend. Watch `/api/health/ready`.
6. Deploy the frontend.
7. Smoke test (`DEPLOYMENT.md` §8). **Step 5 of it — reload while signed in —
   catches the cookie misconfiguration nothing else does.**

---

## 3. MIGRATIONS

```bash
npm run release:check    # report, change nothing
npm run release          # apply
```

Both refuse to run against a pooled `DATABASE_URL` without
`DIRECT_DATABASE_URL`, and say why. See `DEPLOYMENT.md` §3.

**A failed migration.** The migrator runs each file in a transaction, so a
failure leaves that migration unapplied and earlier ones applied. Read the
error, fix the SQL, ship a **new** migration — do not edit an applied one. The
journal records a hash, and editing an applied file makes `drizzle-kit check`
fail forever after.

---

## 4. SCHEDULED JOBS

```bash
node dist/jobs/run.js all
node dist/jobs/run.js expire-import-batches --dry-run
node dist/jobs/run.js purge-recycle-bin --limit=50
```

Locally, `npm run jobs -- <name>`.

### Reading the outcome

Every run logs one line per job with `processed`, `failed`, `durationMs` and
job-specific counters. **`failed > 0` exits 1.** A job that found nothing
exits 0 — that is a success, not silence.

### When a job fails

| Job | Likely cause | Action |
|---|---|---|
| `purge-recycle-bin` | S3 delete rejected, or a `restrict` FK from a record created after the delete | Row survives and retries next run. Persistent → check `STORAGE_*` and the IAM policy |
| `expire-import-batches` | Unlikely; the delete is a plain cascade | Check the log for the batch id |
| `cleanup-refresh-tokens` | Almost never | — |
| `detect-sla-breach` | A bank order whose loan has vanished | Logged with the id; safe to ignore once |

**A single failure does not lose progress** — rows that succeeded are committed.
Repeated failure on the same id means one record needs a human.

### Verifying SEC-009 is actually being enforced

```sql
-- Staged rows retained past their batch's expiry. MUST trend to zero.
select count(*) from import_rows r
  join import_batches b on b.id = r.batch_id
 where b.expires_at < now() and b.status <> 'expired';
```

Non-zero and not falling means the cron is not running. **The code being correct
is not the same as the retention being in effect.**

---

## 5. LOGS

Railway collects stdout. `LOG_LEVEL=info` in production.

> **Do not set `LOG_LEVEL=debug` in production.** Redaction protects
> *values by key name*; `debug` widens *what is logged at all*, including
> payload shapes that carry free text. That is the recorded residual on
> SEC-019.

### What is redacted

By key name **at any depth** — credentials, tokens, Aadhaar, PAN, mobile,
account number, IFSC, DOB, address, and every secret-shaped environment key.
Proven by `src/tests/log-redaction.test.ts`, which pushes a nested
payload through a real pino instance and asserts none of the values are emitted.

**Deliberately not redacted:** `email`, `name`, `city`, `code` and every id.
They are the label the line is about — a log where the actor and the record are
both `[redacted]` is unusable during an incident, and an unusable log is one
somebody turns off.

**Still not solved:** a free-text field (a bank-order `remark`) can contain
anything, and no key-based rule catches it.

### Finding a request

Every response carries a request id, echoed in every log line for that request
and stored on the audit row. Ask the user for it, or read it from an error
screen's reference.

---

## 6. ERRORS

Unset `ERROR_TRACKING_URL` → errors go to the structured log at `error` level
and nowhere else. That is the default and it is not nothing: Railway keeps
stdout.

Set it and every 500 also POSTs a fixed envelope. **What leaves the process:**
error name, message, stack; HTTP method; the **route pattern** (`/api/customers/:id`,
never the filled URL); the request id; environment and release. A `pg` error's
`detail` — which contains the offending **row value** — is stripped, and so is
the `cause` chain, which carries the connection string.

An error tracker is a third party and this system holds Aadhaar and PAN.
**Confirm what your collector retains before enabling it.**

The frontend reports crashes the same way if `NEXT_PUBLIC_ERROR_TRACKING_URL` is
set — **pathname only**, never the query string, because `/accept-invite` and
`/reset-password` carry a live single-use token there.

---

## 7. SECURITY OPERATIONS

### Reading the audit trail

Administration → **Audit trail** (`audit_logs.view`; Super Admin and Admin).
Filter by record type, action, actor, bank and date. Every filter is applied by
the server.

Worth a look monthly:

- `permission_denied` clusters → somebody's role is wrong, or somebody is
  probing.
- `login_failed` bursts against one address → credential stuffing. The account
  locks after 8 failures for 15 minutes, and the lockout is not observable from
  outside (SEC-004).
- `permanently_deleted` with `actor_id` null → the retention job. Expected.
  With an actor → a person purged something.

### Ending a session

- **Yours:** Settings → Security → Active sessions → Revoke.
- **Somebody else's:** Employees → the person → **Reset password**. It revokes
  every session for that account. There is deliberately no admin "revoke their
  session" control — that is a different capability with different
  authorization, and it was not invented to fill out a screen (D-088).
- **Everyone's:** rotate `JWT_REFRESH_SECRET` and redeploy. Immediate, total,
  and loses no data.

### Suspected compromise

1. Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, redeploy → everyone out.
2. Deactivate the suspect account (Employees → Edit → Inactive). It takes effect
   on their **next request**, not at token expiry — `account_inactive` is
   raised by the per-request session gate.
3. Export the relevant window from the audit trail.
4. Rotate `EMAIL_API_KEY` and the `STORAGE_*` keys.
5. **Do not rotate `AADHAAR_PEPPER` reflexively.** Read `SECRETS.md` §5. On its
   own it reveals no Aadhaar number; if the database is also compromised, you
   have a breach and rotation is not the first move.

---

## 8. INCIDENTS

### Nobody can sign in

| Check | Fix |
|---|---|
| `/api/health/ready` 503? | Database. §9 |
| Signs in, then reload signs out? | `NODE_ENV` is not `production`, or `COOKIE_DOMAIN` is set wrongly. **The single most common split-deployment failure** |
| CORS error in the console? | `CORS_ORIGIN` does not match the Vercel origin exactly (scheme, host, no trailing slash). BUG-022 makes it a 500, so it looks like a crash |
| One user only? | Account locked (8 failures / 15 min), deactivated, or their role was disabled |
| **No accounts exist at all?** | The seed never ran with both bootstrap variables. `BOOTSTRAP.md` §5 |

### Every page 403s after signing in

Working as designed: `password_change_required`. Complete the forced change.

### Documents will not upload or download

1. `STORAGE_*` all set? Production **refuses to boot** without them, so if the
   service is up they are present — but they may be *wrong*.
2. IAM principal has `PutObject`, `GetObject`, `DeleteObject` on the bucket.
3. Bucket is `ap-south-1` and matches `STORAGE_REGION`.
4. Bucket is **private** — nothing here hands out a bucket URL.

> The S3 adapter signs with hand-rolled SigV4 over `node:crypto` (no AWS SDK,
> D-006). The algorithm is unit-tested; **it has never made a live network
> call.** A first-deployment failure here is more likely than anywhere else in
> the system. Test PUT, GET, DELETE and a presigned URL by hand before trusting
> it.

### Mail is not arriving

`EMAIL.md` §5.

### Slow

1. `/api/health/ready` reports `latencyMs`. High → Neon.
2. Neon's pooled endpoint in `DATABASE_URL`? The direct one exhausts quickly.
3. Reports and list endpoints page server-side; a slow *page* with a fast API is
   a frontend problem.

---

## 9. DATABASE

### Unreachable

1. Neon dashboard — is the project suspended? Free tiers auto-suspend and the
   first connection after that is slow rather than failed.
2. `DATABASE_URL` correct and pooled?
3. `/api/health/ready`'s log line has the driver error. The **response** never
   does (SEC-015).
4. Restart the Railway service to rebuild the pool.

### Connecting by hand

```bash
psql "$DIRECT_DATABASE_URL"
```

Use the **direct** endpoint for anything session-scoped. Read-only queries are
fine through either.

> ⚠️ Every table holds customer PII. A `select *` on `customers` puts PAN and
> account numbers on your terminal and into your shell history. Select the
> columns you need.

### Backup, restore, integrity verification

`DEPLOYMENT.md` §6.

---

## 10. CREDENTIAL ROTATION

`SECRETS.md` §6 for the table. The mechanics:

1. Generate: `openssl rand -base64 48`.
2. Store it (password manager) **before** using it.
3. Update the Railway variable.
4. Redeploy — variables are read at boot.
5. Verify with the smoke test.
6. Revoke the old value at the provider (Resend, AWS).

**`AADHAAR_PEPPER` does not follow this procedure.** `SECRETS.md` §5.

---

## 11. EMERGENCY SUPER ADMIN RECOVERY

`BOOTSTRAP.md` §6. Summary: there is no break-glass route by design; recovery is
a direct database action by whoever holds the Neon credential, and it is
invisible to `audit_logs`, so **write down that you did it**.

---

## 12. WHAT THIS RUNBOOK CANNOT DO YET

Stated rather than left to be discovered:

| Gap | Owner |
|---|---|
| **No alerting.** Nothing pages anybody. Railway can email on crash-loop; that is all | 15.5 / O8 |
| **No metrics.** No request rate, latency percentiles or error rate over time | O6 |
| **No log aggregation.** Railway's own retention is the whole story | O9 |
| **No uptime monitoring.** `/api/health` is not polled from outside | O6 |
| **No restore rehearsal has ever happened** | `DEPLOYMENT.md` §6 |
| **No load testing.** Capacity is unknown | 16.x |
| Rate limiting is **per-process and in-memory**. Two replicas double every limit | D-085 |
| Secrets live in platform environment variables, not a managed store | 15.10 / O13 |

None of these blocks a first deployment. All of them are things somebody will
want at 03:00, and the honest position is that they are not there.
