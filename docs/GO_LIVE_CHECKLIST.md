# GO-LIVE CHECKLIST

**Compiled 2026-09-06 at the end of Wave 5 / Wave 6 (Claude-doable).**

Everything Claude could build, test and verify locally is done. **Everything
below marked EXTERNAL needs a real account, a real service, or a person.**

Work top to bottom. A row that cannot be ticked is a decision to make, not a row
to skip.

---

## LEGEND

| Mark | Meaning |
|---|---|
| ✅ | Done and verified in this repository |
| 🔶 | Code complete, **awaiting an external service** |
| ⬜ | **Your action.** Nothing in the repository can do it |
| ⛔ | Genuinely outside this project (legal, third-party audit) |

---

## A · CODE AND QUALITY GATES

| | Item | Evidence |
|---|---|---|
| ✅ | Backend suite green | **1258 / 1258 · 55 files** |
| ✅ | Frontend suite green | See the final report |
| ✅ | Backend typecheck | clean |
| ✅ | Frontend typecheck | clean |
| ✅ | Backend lint | clean |
| ✅ | Frontend lint at baseline | 58 (1 pre-existing error in `use-auth.tsx`, 57 warnings) |
| ✅ | `drizzle-kit check` | *Everything's fine* |
| ✅ | `db:generate` zero diff | Content hash unchanged before/after |
| ✅ | Migrations / snapshots / journal agree | **16 / 16 / 16** |
| ✅ | Demo excluded from production builds | `verify:demo-exclusion`, both bundlers |
| ✅ | `next build` | exit 0, 27 routes |
| ✅ | Backend build emits every entry point | `server.js`, `jobs/run.js`, `db/migrate.js`, `db/seed.js` |
| ✅ | CI pipeline exists | `.github/workflows/ci.yml` |
| ✅ | CI steps proven locally | `scripts/ci-local.sh` — **run; found 2 real defects, both fixed** |
| ⬜ | **CI green on GitHub Actions** | Never executed remotely. First push is the test |
| ⬜ | Docker image builds | Dockerfile written; **daemon unavailable here** |

---

## B · DATABASE

| | Item | Where |
|---|---|---|
| ✅ | 16 migrations, sequential, snapshots complete | `drizzle/` |
| ✅ | Release script with a pooled-URL guard | `npm run release` · verified refusing a `-pooler` URL |
| ✅ | Migration strategy decided and documented | D-090 · `DEPLOYMENT.md` §3 |
| ✅ | Populated-database migration test | `migration-populated.test.ts` — **on PGlite** |
| ✅ | Rollback position documented per migration | `DEPLOYMENT.md` §5 |
| ✅ | Backup/restore procedure + integrity queries | `DEPLOYMENT.md` §6 |
| ⬜ | **Neon project created**, region `ap-south-1` | Neon console |
| ⬜ | **Migrations run against real Postgres** (roadmap 14.9) | `npm run release` |
| ⬜ | Suite run against real Postgres | Needs a harness override — **not built** |
| ⬜ | Restore rehearsed into a scratch branch | `DEPLOYMENT.md` §6 |
| ⬜ | PITR retention confirmed for your plan | Neon dashboard |

---

## C · SECRETS AND CONFIGURATION

| | Item | Where |
|---|---|---|
| ✅ | Complete inventory, classified | `SECRETS.md` |
| ✅ | `.env.example` matches the code | Enforced by `env-template.test.ts` |
| ✅ | `frontend/.env.example` matches the code | Enforced by `env-template.test.ts` |
| ✅ | No secret in the repository | CI **hygiene** job |
| ✅ | Aadhaar pepper procedure and consequences | `SECRETS.md` §5 |
| ⬜ | Generate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (**different**) | `openssl rand -base64 48` |
| ⬜ | Generate `AADHAAR_PEPPER`, store offline in two places | `SECRETS.md` §5 |
| ⬜ | Set every Railway variable | `SECRETS.md` §2 |
| ⬜ | Set every Vercel variable | `SECRETS.md` §3 |
| ⬜ | Managed secret store (15.10) | Deferred — environment variables today |

---

## D · APPLICATION

| | Item | Evidence |
|---|---|---|
| ✅ | No CRITICAL security finding open | 0 CRITICAL |
| ✅ | Every screen exists and is wired | Phase 12 complete |
| ✅ | **Zero-fake sweep across all 20 screens** | `zero-fake-sweep.test.tsx` — and it proves it can detect an offender |
| ✅ | **Five-role permission matrix** | `role-matrix.test.ts`, 41 cases |
| ✅ | Permission-aware navigation | D-089 |
| ✅ | Honest loading / empty / error / forbidden states | Per-screen tests |
| ✅ | Truthful pagination, sorting, exports | D-051 |
| ✅ | Audit trail readable in-product | `/audit-logs` |
| ✅ | Financial records immutable in terminal states | D-069 |
| ⬜ | All five roles walked through the product by hand (16.2) | The matrix proves the API's answers, not the journeys |
| ⬜ | Load test | Capacity unknown |

---

## E · SECURITY

| | Item | Status |
|---|---|---|
| ✅ | SEC-001, 003, 004, 005, 006, 007, 008, 010, 012, 013, 014, 015, 016, 018, 022, 025, 027, 028, 029 | **Resolved** |
| ✅ | **SEC-019** log redaction at any depth | Resolved this wave |
| 🔶 | **SEC-009** plaintext Aadhaar retention | **Job implemented and tested. Not in effect until the cron is wired** |
| ⬜ | Wire the retention cron | `DEPLOYMENT.md` §7 |
| ⬜ | Confirm retention is running | `RUNBOOK.md` §4 gives the query |
| — | SEC-002, 011, 017, 020, 021, 023, 024, 026 | Open at LOW/MEDIUM, each recorded |
| ⛔ | **Independent penetration test (OD-6)** | Cannot be fabricated |
| ⛔ | **DPDP legal review (OD-5)** | Cannot be fabricated |

---

## F · INFRASTRUCTURE

| | Item | Where |
|---|---|---|
| ✅ | Dockerfile, `.dockerignore`, `railway.json`, `vercel.json` | Written |
| ✅ | Health `/api/health` + readiness `/api/health/ready`, no leakage | SEC-015 |
| ✅ | Graceful shutdown | `server.ts` + `dumb-init` |
| ✅ | Four scheduled jobs + CLI + tests | `src/jobs/`, 33 cases |
| ✅ | Error tracking, config-gated, PII-safe | D-093, 21 cases |
| ✅ | Runbook | `RUNBOOK.md` |
| ⬜ | Railway service created and deployed | |
| ⬜ | Vercel project created and deployed | |
| ⬜ | S3 bucket created, **private**, `ap-south-1` | |
| ⬜ | **S3 exercised: PUT, GET, DELETE, presign** | Adapter has never made a network call |
| ⬜ | Resend domain verified (SPF + DKIM) | |
| ⬜ | **Email tested end to end** | `EMAIL.md` §4 — 14 steps |
| ⬜ | Cron jobs scheduled and observed | |
| ⬜ | Error collector configured (optional) | |
| ⬜ | Alerting, metrics, log aggregation, uptime | **Not built** — `RUNBOOK.md` §12 |

---

## G · OPERATIONS

| | Item | Where |
|---|---|---|
| ✅ | First-Super-Admin flow documented from code | `BOOTSTRAP.md` |
| ✅ | Emergency recovery documented | `BOOTSTRAP.md` §6 |
| ✅ | Deploy, rollback, backup, restore | `DEPLOYMENT.md` |
| ✅ | Smoke test — 12 steps | `DEPLOYMENT.md` §8 |
| ✅ | Incident procedures | `RUNBOOK.md` §8 |
| ⬜ | Seed the first Super Admin | `BOOTSTRAP.md` §4 |
| ⬜ | Delete `BOOTSTRAP_SUPERADMIN_PASSWORD` after first change | |
| ⬜ | Agree go-live window and hypercare | Below |
| ⬜ | Sign `PRODUCTION_READINESS.md` | Nobody has |

---

## H · HYPERCARE — the first 72 hours

Not a template. These are the things this system will actually fail at first,
in order of likelihood.

### Hour 0–1, immediately after go-live

1. Smoke test (`DEPLOYMENT.md` §8). **Step 5 — reload while signed in — is the
   one that catches the cookie misconfiguration nothing else does.**
2. Upload **and download** a document. This is the only proof S3 works; the
   adapter has never made a live call.
3. Create a real employee and have them complete the invitation. This is the
   only proof email works.
4. `npm run release:check` → 0 pending.

### Day 1

5. `node dist/jobs/run.js all --dry-run` and read the counts before letting the
   cron run for real.
6. Watch the log for `error`. A 500 in the first day is usually configuration.
7. Sign in as each of the five roles and confirm the menu is right.

### Day 2–3

8. Let the retention job run for real. Then:
   ```sql
   select count(*) from import_rows r join import_batches b on b.id=r.batch_id
    where b.expires_at < now() and b.status <> 'expired';   -- must be 0
   ```
   **This is what closes SEC-009 in practice**, and until it reads 0 the finding
   is open in effect however green the tests are.
9. Verify the recycle-bin purge removed **both** the row and its S3 object.
10. Take and **restore** a backup into a scratch branch. First time, in calm
    conditions, not during an incident.

### The five most likely first failures

| Symptom | Cause | Fix |
|---|---|---|
| Login works, reload signs out | `NODE_ENV` not `production` | Set it, redeploy |
| Every request 500s from the browser | `CORS_ORIGIN` mismatch (BUG-022 makes it a 500) | Exact origin, no trailing slash |
| Invitation links point at `localhost` | `FRONTEND_URL` unset | Set it, **resend** — existing links stay broken |
| Uploads succeed, downloads 500 | S3 credentials or region | `RUNBOOK.md` §8 |
| Nobody can sign in at all | Seed ran without both bootstrap variables | `BOOTSTRAP.md` §5 |

### Rollback trigger

Roll the **code** back (not the schema) if any of: authentication is broken for
everyone, documents cannot be uploaded, or financial writes are producing wrong
figures. `DEPLOYMENT.md` §5.

---

## I · WHAT NOBODY HAS SIGNED

Stated plainly so it is not discovered later:

- **No independent security assessment** (OD-6).
- **No DPDP legal review** (OD-5) — this system stores Aadhaar and PAN.
- **No production sign-off.** `PRODUCTION_READINESS.md` is a measured scorecard,
  not an approval.
- **No SLA, no support rota, no on-call.**
- **No accessibility audit.**
- **No load test.**

None is a code defect. All of them are decisions the owner makes.
