# STAGING vs PRODUCTION

**Written 2026-09-06, at the repository split, when the first real PostgreSQL
environment was created.**

Until now this project had exactly one environment: a developer's laptop, with
the test suite running on PGlite. That is no longer true, and the distinction
below matters more than it looks — the single most expensive mistake available
from here is running a destructive verification against the wrong database.

---

## 1. THE TWO ENVIRONMENTS

| | **STAGING / LOCAL REAL-POSTGRES** | **PRODUCTION** |
|---|---|---|
| **Exists today** | ✅ Yes — a Neon project | ❌ Not yet |
| **Neon region** | `ap-southeast-1` (Singapore) — the free-tier default | **`ap-south-1` (Mumbai)** — mandatory |
| **Purpose** | Prove the migrations, the schema and the bootstrap against a real server | Serve real customers |
| **Data** | **Disposable. Test data only.** Safe to drop and recreate | Real customer PII: Aadhaar hashes, PAN, mobile, account numbers |
| **Backend runs** | On your laptop, `npm run dev`, `NODE_ENV=development` | Railway, `NODE_ENV=production` |
| **Frontend runs** | On your laptop, `npm run dev`, port 3000 | Vercel, region `bom1` |
| **Object storage** | **Local filesystem** adapter → `.storage/` | **AWS S3**, `ap-south-1`, private bucket |
| **Email** | **Console transport** — logged, never delivered | Resend, verified domain |
| **`AADHAAR_PEPPER`** | A local value. Rotating it costs nothing | A *different* value, stored offline in two places. Rotating it is **destructive and permanent** — `SECRETS.md` §5 |
| **JWT secrets** | Local values | Different values, in the platform secret store |
| **Cookie flags** | `SameSite=Lax; Secure=false` (because `NODE_ENV=development`) | `SameSite=None; Secure=true` |
| **Migrations** | `npm run release` from your laptop | `npm run release` as a release step, `DIRECT_DATABASE_URL` |

> ### ⚠️ THE REGION IS NOT A DETAIL
>
> **D-071 / OPEN-2 record Indian data residency for KYC documents as a LEGAL
> constraint, not a preference.** The staging project sitting in Singapore is
> acceptable **only** because it holds no real customer data. The production
> Neon project and the production S3 bucket must both be **`ap-south-1`**, and
> that is not a decision to revisit casually.

---

## 2. WHAT "REAL POSTGRES" DOES AND DOES NOT COVER

This is the distinction that is easiest to overstate, so it is stated flatly.

### What running the migrations against Neon proves

- The 16 shipped migration files apply, in order, to an empty PostgreSQL server.
- The resulting schema — tables, indexes, foreign keys, CHECK constraints,
  triggers — is what the snapshots say it is.
- `drizzle-kit check` and `db:generate` still agree with the schema afterwards.
- The seed produces the permission catalogue, five roles and one Super Admin.

### What it does NOT prove

**The 1,258-case backend test suite did not run against PostgreSQL.** It cannot,
today: `src/tests/harness.ts` constructs a `new PGlite()` unconditionally and
there is **no `TEST_DATABASE_URL` override**. Building one is roadmap task
**14.9** and it is not a small job — the suite assumes a private database per
file, and PGlite gives that for free while a real server does not.

Anyone reading a green suite and a successful Neon migration in the same report
could reasonably conclude the suite ran on Neon. It did not. See
`TESTING_STRATEGY.md`.

**Migrations against a POPULATED database are still untested on real Postgres.**
`src/tests/migration-populated.test.ts` covers it on PGlite. Two of the sixteen
migrations — `0014` (a CHECK sweep) and `0015` (a `NOT NULL` plus an FK action
change) — are exactly the shape that passes on an empty table and fails on a
populated one. `DEPLOYMENT.md` §3 has the procedure for a scratch branch.

---

## 3. SETTING UP THE STAGING ENVIRONMENT

### 3.1 Neon

1. Create the project. **Pin the PostgreSQL major version and do not let it
   drift.**
2. **Connect** → copy **both** connection strings:
   - "Connection pooling" **ON** → the host contains `-pooler` → `DATABASE_URL`
   - "Connection pooling" **OFF** → no `-pooler` → `DIRECT_DATABASE_URL`
3. Keep `?sslmode=require` (and `&channel_binding=require` if Neon supplies it).

### 3.2 The environment file

```bash
cp .env.example .env
```

Then, at minimum:

| Variable | Staging value |
|---|---|
| `NODE_ENV` | `development` |
| `DATABASE_URL` | the **pooled** Neon string |
| `DIRECT_DATABASE_URL` | the **direct** Neon string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | two *different* `openssl rand -base64 48` |
| `AADHAAR_PEPPER` | one more `openssl rand -base64 48` |
| `CORS_ORIGIN` / `FRONTEND_URL` | `http://localhost:3000` |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY` | **leave commented out** — console transport |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | **leave commented out** — local filesystem adapter |

> ⚠️ **"Leave it blank" means COMMENTED OUT, not `EMAIL_PROVIDER=`.**
>
> dotenv turns a bare `KEY=` into the *string* `""`, and `""` is a **present**
> value — so `.optional()` never applies and `z.enum(["resend"])` / `.min(1)`
> reject it. `.env.example` used to ship six keys that way, and
> `cp .env.example .env` then failed with six validation errors while its own
> prose said to leave them blank. Fixed at the repository split; `.env.example`
> now comments them out, and `env-template.test.ts` case 9 loads the template
> through the real validator so it cannot regress.
>
> `EMAIL_FROM`, `EMAIL_REPLY_TO` and `STORAGE_REGION` are left *set* in the
> template on purpose: their example values are valid, and neither integration
> activates until **all four** email keys or **all five** storage keys are
> present.

`.env` is ignored by git at every depth and the CI hygiene job fails the build
if one is ever tracked. Never paste a connection string into an issue, a log or
a chat.

### 3.3 Migrate, verify, seed

```bash
npm run release:check                 # reports; changes nothing
npm run release                       # applies 0000 … 0015
node scripts/verify-postgres.mjs      # schema assertions against the real server
```

Then the first Super Admin — set both bootstrap variables first, or the seed
creates **no user at all** and exits 0:

```bash
npm run db:seed
```

`BOOTSTRAP.md` is the full procedure, including the forced password change and
what to do when it goes wrong.

### 3.4 Run it

```bash
# terminal 1 — CMBBACKEND
npm run dev            # http://localhost:8080

# terminal 2 — CMBFRONTEND
npm run dev            # http://localhost:3000, NEXT_PUBLIC_API_URL=http://localhost:8080
```

---

## 4. WHAT IS SAFE TO DO AGAINST STAGING

Because the data is disposable:

| Action | Staging | Production |
|---|---|---|
| Drop and re-run every migration | ✅ | ❌ |
| Re-run `db:seed` | ✅ (it is idempotent anyway) | ✅ |
| Rotate `AADHAAR_PEPPER` | ✅ costs nothing | ❌ **destructive and permanent** |
| Delete rows directly in SQL | ✅ | ❌ except the documented recovery in `BOOTSTRAP.md` §6 |
| Load real customer data | ❌ **never** | — |

> **No real customer data is permitted in staging.** Not a sample, not "just one
> record to test with". The moment real Aadhaar or PAN lands in a Singapore
> free-tier project, the residency question stops being theoretical.

---

## 5. GOING FROM HERE TO PRODUCTION

The order is fixed, and each step needs the one before it:

```
Neon(prod) ──► S3 ──► Resend ──► Railway ──► migrate ──► seed ──► Vercel ──► CORS
```

| Step | Document | The trap |
|---|---|---|
| **Neon production**, `ap-south-1` | `DEPLOYMENT.md` §3 | A *new* project, not this one. Different credentials, different pepper |
| **AWS S3**, `ap-south-1`, private | `SECRETS.md` §2 storage | The adapter has **never made a network call**. Verify PUT/GET/DELETE/presign by hand |
| **Resend**, verified domain | `EMAIL.md` §4 | All four `EMAIL_*` or production refuses to boot |
| **Railway** | `DEPLOYMENT.md` §2 | `NODE_ENV=production` exactly, or every reload signs users out |
| **Migrate** | `DEPLOYMENT.md` §3 | Against `DIRECT_DATABASE_URL`, as a release step, never from `CMD` |
| **Seed** | `BOOTSTRAP.md` §4 | Both bootstrap variables, or no user is created and nobody can sign in |
| **Vercel** | CMBFRONTEND `README.md` | `NEXT_PUBLIC_ENABLE_DEMO` must stay **unset** |
| **CORS** | `SECRETS.md` §2 origins | Exact Vercel origin, no trailing slash. A mismatch surfaces as a **500** (BUG-022) |

`GO_LIVE_CHECKLIST.md` is the row-by-row version of this, with an owner against
every line.

### Nothing in staging carries over

Not the connection string, not the JWT secrets, not the pepper, not the
bootstrap password, not the data. A production environment that reuses a staging
secret is a production environment with a known-shared credential.
