# SECRETS AND ENVIRONMENT — PRODUCTION INVENTORY

**Compiled 2026-09-06 (Wave 5) from `src/config/env.ts`,
`src/lib/logger.ts`, `src/lib/observability.ts`,
`drizzle.config.ts` and `frontend/next.config.ts`.**

The code is the authority. `src/tests/env-template.test.ts` and
`frontend/src/lib/env-template.test.ts` fail the build if either template drifts
from it — that check exists because the template has drifted twice, and both
times the deployer found out, not the developer.

> **No real secret appears in this file, in either `.env.example`, or anywhere
> else in this repository.** Every value below is a shape or a generator
> command.

---

## 1. CLASSIFICATION

| Class | Meaning |
|---|---|
| **REQUIRED** | Production will not boot, or will not work, without it |
| **OPTIONAL** | Genuinely optional in production; the default is a supported state |
| **DEV ONLY** | Set locally; must **not** be set in production |
| 🔴 **SECRET** | Compromise is a security incident. Managed store only |
| 🟡 **SENSITIVE** | Not a credential, but reveals infrastructure |
| ⚪ **PUBLIC** | Safe in a dashboard, a log, or a browser bundle |

---

## 2. BACKEND — Railway

### Runtime

| Variable | Class | Sensitivity | Value | Notes |
|---|---|---|---|---|
| `NODE_ENV` | **REQUIRED** | ⚪ | `production` | **No default (SEC-028).** It alone decides the refresh cookie's `Secure`/`SameSite`. Wrong or absent → login works and every reload signs the user out |
| `PORT` | OPTIONAL | ⚪ | `8080` | Railway injects this; let it |
| `LOG_LEVEL` | OPTIONAL | ⚪ | `info` | **Not validated** — read raw, a typo falls through to pino's default. Keep at `info`: `debug` widens what is logged at all, which is the residual on SEC-019 |
| `RELEASE_SHA` | OPTIONAL | ⚪ | `$RAILWAY_GIT_COMMIT_SHA` | Reported in the error envelope, nowhere else |

### Database

| Variable | Class | Sensitivity | Value | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | **REQUIRED** | 🔴 | Neon **pooled** (`-pooler` in the host) | Carries the password. The app pool is 10 in production |
| `DIRECT_DATABASE_URL` | **REQUIRED in practice** | 🔴 | Neon **direct** (no `-pooler`) | Schema-optional, but `scripts/release.mjs` **refuses to run** when `DATABASE_URL` looks pooled and this is unset. See `docs/DEPLOYMENT.md` §3 |

### Authentication

| Variable | Class | Sensitivity | Value | Notes |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | **REQUIRED** | 🔴 | `openssl rand -base64 48` | Min 32 chars. **No known-bad-value guard** — a placeholder long enough to validate will boot |
| `JWT_REFRESH_SECRET` | **REQUIRED** | 🔴 | a *different* `openssl rand -base64 48` | Production **refuses to boot** if the two are equal |
| `ACCESS_TOKEN_TTL` | OPTIONAL | ⚪ | `15m` | |
| `REFRESH_TOKEN_TTL_DAYS` | OPTIONAL | ⚪ | `7` | |
| `COOKIE_DOMAIN` | OPTIONAL | 🟡 | **leave unset** | Only for a shared parent domain. A wrong value makes the browser reject `Set-Cookie` outright — same symptom as a wrong `NODE_ENV` |

**Rotating either JWT secret signs everyone out.** Access tokens fail
verification immediately; refresh tokens fail at the next rotation. No data is
lost. This is the *cheap* rotation — do it on any suspicion.

### Origins

| Variable | Class | Sensitivity | Value | Notes |
|---|---|---|---|---|
| `CORS_ORIGIN` | **REQUIRED** | ⚪ | `https://crm.example.in` | Comma-separated, **no wildcard** — the API sends credentials. No trailing slash. A rejected origin currently surfaces as 500, not 403 (BUG-022) |
| `FRONTEND_URL` | **REQUIRED** | ⚪ | the same origin | **Fails silently.** Every emailed link is built from it; left at the default, mail sends successfully and every link is useless |

### PII

| Variable | Class | Sensitivity | Value | Notes |
|---|---|---|---|---|
| `AADHAAR_PEPPER` | **REQUIRED everywhere** | 🔴🔴 | `openssl rand -base64 48` | Min 32. No default, no production-only exemption. The published placeholder is refused by name. **See §5 before rotating — it is effectively permanent** |

### Email — all four required in production

| Variable | Class | Sensitivity | Notes |
|---|---|---|---|
| `EMAIL_PROVIDER` | **REQUIRED** | ⚪ | Allowlist of one: `resend` |
| `EMAIL_API_KEY` | **REQUIRED** | 🔴 | Begins `re_`. Scrubbed from every error the service emits |
| `EMAIL_FROM` | **REQUIRED** | ⚪ | On a domain verified with Resend |
| `EMAIL_REPLY_TO` | **REQUIRED** | ⚪ | Somewhere a human reads |

### Storage — all five required in production

| Variable | Class | Sensitivity | Notes |
|---|---|---|---|
| `STORAGE_PROVIDER` | **REQUIRED** | ⚪ | Allowlist of one: `s3` |
| `STORAGE_BUCKET` | **REQUIRED** | 🟡 | **Must be private.** Block Public Access on |
| `STORAGE_REGION` | **REQUIRED** | ⚪ | **`ap-south-1`.** D-071 / OPEN-2 record Indian data residency as a *legal* constraint |
| `STORAGE_ACCESS_KEY_ID` | **REQUIRED** | 🔴 | Scope to `PutObject`/`GetObject`/`DeleteObject` on this bucket only. No `ListBucket` |
| `STORAGE_SECRET_ACCESS_KEY` | **REQUIRED** | 🔴 | |
| `STORAGE_ENDPOINT` | OPTIONAL | 🟡 | Non-AWS S3-compatible providers only. Leave unset for AWS |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | OPTIONAL | ⚪ | `300`, max 3600. Not the access control — the route's permission check is |
| `MAX_DOCUMENT_MB` | OPTIONAL | ⚪ | `15`. **Deliberately not `MAX_UPLOAD_MB`** (D-072) |

Why production refuses to boot without these: the development fallback is a
**local filesystem** adapter, and a Railway container's filesystem is ephemeral.
A misconfigured deploy would accept a KYC upload, report success, and lose the
file on the next restart, with the database row pointing at nothing.

### Policy

| Variable | Class | Value | Notes |
|---|---|---|---|
| `RECYCLE_BIN_RETENTION_DAYS` | OPTIONAL | `30` | Fallback only — the `recycleBin.retentionDays` **setting** wins when present (Task 12.6) |
| `MAX_UPLOAD_MB` | OPTIONAL | `10` | The importer's **compressed** budget; the decompression ceiling is 20× it (13.7) |

### Bootstrap — remove after first use

| Variable | Class | Sensitivity | Notes |
|---|---|---|---|
| `BOOTSTRAP_SUPERADMIN_EMAIL` | **REQUIRED once** | ⚪ | Read only by `db:seed` |
| `BOOTSTRAP_SUPERADMIN_PASSWORD` | **REQUIRED once** | 🔴 | 12+ chars, mixed case, a digit. **Delete after the first password change** (`docs/BOOTSTRAP.md` §4) |

### Observability — optional

| Variable | Class | Sensitivity | Notes |
|---|---|---|---|
| `ERROR_TRACKING_URL` | OPTIONAL | 🟡 | Unset → errors go to the pino log only |
| `ERROR_TRACKING_TOKEN` | OPTIONAL | 🔴 | Bearer, when the collector wants one |
| `ERROR_TRACKING_TIMEOUT_MS` | OPTIONAL | ⚪ | `3000` |

---

## 3. FRONTEND — Vercel

> ⚠️ **Every `NEXT_PUBLIC_*` value is compiled into the JavaScript bundle and is
> readable by anyone who loads the page.** There is no such thing as a secret
> here. They are baked in at **build** time, so changing one needs a
> **redeploy** — restarting achieves nothing.

| Variable | Class | Sensitivity | Value | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **REQUIRED** | ⚪ | `https://<svc>.up.railway.app` | Origin only — `lib/api.ts` appends `/api`. No trailing slash |
| `NEXT_PUBLIC_ENABLE_DEMO` | **DEV ONLY** | ⚪ | **unset** | `true` in production ships the demo credential and ~1,500 lines of fabricated customer PII (SEC-001 / SEC-027) |
| `NEXT_PUBLIC_ERROR_TRACKING_URL` | OPTIONAL | ⚪ | — | Public, so **no token accompanies it**. The collector must accept unauthenticated posts and rate-limit itself |
| `NEXT_PUBLIC_RELEASE_SHA` | OPTIONAL | ⚪ | `$VERCEL_GIT_COMMIT_SHA` | |

---

## 4. NEVER COMMIT

Enforced by the root `.gitignore` (`.env` at any depth, `.env.*`, negating
`!.env.example`) and by the CI **hygiene** job, which fails the build if a
tracked file matches an env pattern.

Never commit, in source, docs, tests, fixtures, comments or commit messages:

- any `DATABASE_URL` containing a real host or password;
- either JWT secret;
- `AADHAAR_PEPPER`;
- `EMAIL_API_KEY` (`re_…`);
- `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`;
- `BOOTSTRAP_SUPERADMIN_PASSWORD`;
- `ERROR_TRACKING_TOKEN`;
- any real customer Aadhaar, PAN, mobile or account number.

**If one is committed, rotate it — do not merely delete it.** A commit that
reached any remote is public forever, and rewriting history does not recall a
clone or a fork. Rotation order and consequences: JWT secrets are free (§2);
storage and email keys are one dashboard action each; `AADHAAR_PEPPER` is §5,
and is the reason this list is worth taking seriously.

---

## 5. `AADHAAR_PEPPER` — CHOOSING, STORING, AND WHY ROTATION IS NOT ROUTINE

### What it is

The key of an **HMAC-SHA256** over every Aadhaar number before storage
(`lib/password.ts`). The raw number is **never stored** — only
`hmac(pepper, aadhaar)` and the last four digits. Task 13.4 moved it from a
concatenated SHA-256 to HMAC precisely because the old construction was
length-extendable over a 10¹² keyspace.

### Choosing it

```bash
openssl rand -base64 48
```

Minimum 32 characters, enforced by the schema. Not a passphrase, not derived
from anything, not reused from another environment. **Each environment gets its
own** — and that means a production database restored into staging will not
match staging's pepper, which is correct and is stated in
`docs/DEPLOYMENT.md` §6.

### Storing it

Railway environment variable, marked sealed/secret. Keep an **offline** copy in
the organisation's password manager, held by at least two people.

> **Losing it is unrecoverable.** Not "inconvenient" — Aadhaar lookup stops
> working for every existing customer, permanently, and no backup restores it
> because it was never in the database.

### Rotating it — read all of this first

**Rotation invalidates every stored Aadhaar hash.** The old hashes cannot be
recomputed under the new key, because the input is gone by design.

Concretely, the moment the new pepper is live:

- Aadhaar **search** returns nothing for every customer created before rotation;
- **duplicate detection** stops seeing them, so the same person can be onboarded
  again as a new customer;
- `aadhaarLast4` still displays — it is stored separately — so the screens look
  *entirely normal*. **This failure is silent.**

There is no in-product repair. Re-peppering means re-collecting every Aadhaar
number from the source documents.

#### If you must rotate anyway (suspected exposure)

Exposure of the pepper alone does not reveal any Aadhaar number — an attacker
would also need the hashes, i.e. database access. If both are compromised, you
have a database breach and rotation is not the first thing to do.

If it is still the right call:

1. **Decide first** whether historic Aadhaar search is being abandoned or
   re-collected. Do not start until that is answered in writing.
2. Take a verified backup (`docs/DEPLOYMENT.md` §6).
3. Announce a maintenance window. Aadhaar search will be wrong during it.
4. Generate the new pepper; store it before using it.
5. Set it, redeploy, verify the service boots.
6. Confirm the expected breakage: search an Aadhaar you know exists; it should
   return nothing. **If it returns a match, the new pepper did not take** —
   stop and check the variable.
7. Re-collect, or record formally that pre-rotation Aadhaar search is retired.

#### What does *not* require rotation

A JWT secret leak, an employee leaving, a routine credential-hygiene cycle, or a
frontend compromise. The pepper is not a session secret and rotating it on that
schedule would destroy data for no security gain.

---

## 6. ROTATION SUMMARY

| Secret | Cost | Blast radius | Cadence |
|---|---|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Trivial | Everyone signs in again | On suspicion; annually |
| `EMAIL_API_KEY` | Trivial | Mail pauses until redeployed | On suspicion; annually |
| `STORAGE_*` keys | Low | Uploads/downloads fail until redeployed | On suspicion; annually |
| `DATABASE_URL` password | Low | Restart required | On suspicion; annually |
| `ERROR_TRACKING_TOKEN` | Trivial | Reports dropped | On suspicion |
| `BOOTSTRAP_SUPERADMIN_PASSWORD` | n/a | — | **Delete after first use** |
| **`AADHAAR_PEPPER`** | **Destructive** | **Aadhaar search and duplicate detection, permanently** | **Never, unless §5 applies** |

---

## 7. WHAT PROTECTS THESE AT RUNTIME

- **Logs.** `lib/logger.ts` redacts by key name **at any depth**, and every key
  in §2 marked 🔴 is in that set. Proven by `src/tests/log-redaction.test.ts`
  case 13, which logs a whole config-shaped object and asserts none of the
  values are emitted.
- **Errors.** `config/env.ts` names missing keys and never values.
  `lib/observability.ts` sends an allow-list envelope and strips a `pg` error's
  `detail` and `cause` — the two fields that carry row values and connection
  strings.
- **Health.** `/api/health/ready` returns `{connected: false}` and nothing else
  on failure; the driver error goes to the log (SEC-015).
- **The bundle.** `npm run verify:demo-exclusion` proves no demo credential or
  fixture reaches a production build, on both bundlers.

**Still open, and recorded rather than implied away:** secrets live in platform
environment variables, not a managed secret store with rotation and audit
(roadmap 15.10 / O13). That is a real gap and it is the operator's decision
whether to close it before or after go-live.
