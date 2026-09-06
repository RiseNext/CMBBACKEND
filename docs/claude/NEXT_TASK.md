# NEXT TASK

> **This file always describes exactly one task — the one to do now.**
> Rewrite it completely when the task is finished. Never leave a stale task here.

---

**Last updated:** 2026-09-06
**Updated by:** Wave 5 + Wave 6 (Claude-doable)

> ## ✅ ALL CLAUDE-OWNED WORK IS COMPLETE
>
> Backend **1258/1258 · 55 files** · frontend **1143/1143 · 52 files** · both typechecks clean · backend lint clean · frontend lint **58** (1 pre-existing error) · `db:generate` zero diff · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16** · demo exclusion PASSED · `next build` exit 0.
>
> **0 CRITICAL. 1 HIGH — SEC-009 — whose retention job is built and tested and takes effect the day the cron is wired.**
>
> Readiness **130/160 = 81%**.

---

## CURRENT TASK

# THIS IS NOT A CLAUDE TASK. IT IS THE HUMAN PRODUCTION SETUP.

**Nothing in this repository is waiting on more code.** The next action is to
create the external services and connect them.

**Start at `docs/GO_LIVE_CHECKLIST.md`.** It is ordered, every row says who owns
it, and every ⬜ row is yours.

### The order, and why it is this order

```
Neon ──► S3 ──► Resend ──► Railway ──► migrate ──► seed ──► Vercel ──► CORS
```

Railway before Vercel, because Vercel needs `NEXT_PUBLIC_API_URL` and that is
the Railway URL. `CORS_ORIGIN` last, because it is the Vercel URL.

### The five documents you will need

| Document | For |
|---|---|
| `docs/GO_LIVE_CHECKLIST.md` | **Start here.** The ordered list, plus hypercare |
| `docs/SECRETS.md` | Every variable, classified, with generator commands |
| `docs/DEPLOYMENT.md` | Migrations, rollback, backup/restore, smoke test |
| `docs/BOOTSTRAP.md` | The first Super Admin — and the failure that costs a first deployment |
| `docs/EMAIL.md` | All three flows and a 14-step production test |
| `docs/RUNBOOK.md` | Day-2 operations and incidents |

---

## THE FOUR THINGS MOST LIKELY TO GO WRONG

Not a general list — these are what *this* system fails at first.

1. **Login works, then a reload signs you out.** `NODE_ENV` is not exactly
   `production`, so the refresh cookie is `SameSite=Lax` and the browser never
   sends it across the Vercel↔Railway boundary. Smoke-test step 5 catches it.
2. **Every request 500s from the browser.** `CORS_ORIGIN` does not match the
   Vercel origin exactly. BUG-022 makes a rejected origin a 500 rather than a
   403, so it looks like the API has crashed.
3. **Invitation links point at `localhost`.** `FRONTEND_URL` is unset. **This
   fails silently** — the mail sends successfully and every link is useless.
   Links already issued stay broken; resend them.
4. **Nobody can sign in at all.** The seed ran without both bootstrap variables,
   logged a warning and **exited 0**, creating no user. `BOOTSTRAP.md` §5.

---

## WHAT IS BUILT BUT NOT YET IN EFFECT

**SEC-009 — the one open HIGH.** `expire-import-batches` destroys the plaintext
Aadhaar that `import_rows` has retained since the first migration, and a test
proves the value is gone from the database rather than merely that a status
changed. **Nothing purges until the cron is scheduled.** After wiring it, run
the query in `RUNBOOK.md` §4 and confirm it reads zero — that is what closes the
finding, not the passing test.

The same is true of `purge-recycle-bin`: `purge_after` has been stamped on every
soft delete since day one and nothing has ever acted on it.

---

## IF YOU WANT MORE ENGINEERING FIRST

Optional, and none of it blocks a deployment.

| Item | Why it might be worth doing first |
|---|---|
| **14.9 — the suite against real Postgres** | The highest-value remaining engineering task. 1,258 backend cases run on PGlite, and **PGlite is not Postgres**. Needs a `DATABASE_URL` override the harness honours and a CI service container |
| **SEC-011** — a CSP nonce (D-082) | `script-src 'unsafe-inline'` means XSS is not closed. Needs `middleware.ts` |
| **11.4** — a real `.xlsx` and PDF | The controls are honestly labelled today |
| **13.14** — PAN masking | PAN and account number are still stored and returned in plaintext |
| **BUG-035** — map `22P02` | A malformed uuid in a `filterable` param still 500s |
| **Alerting, metrics, log aggregation** | `RUNBOOK.md` §12 lists what is missing |
| **Managed secret store (15.10)** | Environment variables today |

---

## CARRIED FORWARD — verified still open (2026-09-06)

- **SEC-009 (HIGH)** — see above. The only open HIGH.
- **SEC-002 (LOW)** — bounded by 13.1's limiter, not eliminated.
- **SEC-017 (LOW)** — accretion stopped; free-text sinks and already-written
  rows remain.
- **SEC-011 (LOW)** — headers real; XSS not closed. Needs `middleware.ts`.
- **SEC-020, SEC-021, SEC-023, SEC-024, SEC-026** — unchanged.
- **13.14** PAN plaintext · **13.15** `refresh_tokens` growth is now **handled**
  by `cleanup-refresh-tokens` once scheduled · **11.4** real export formats.
- **12.7 / 12.9** — 2FA deleted by D-083 (real TOTP post-launch); 12.9 unstarted.
- **Per-user preferences** — blocked on a `user_settings` table (D-087). Do not
  re-add those switches before the table exists.
- **U-10** half done — `23514` mapped, **`22P02` is not** (BUG-035).
- **BUG-004 and BUG-006** still look closable and are still deliberately open
  pending a one-at-a-time re-read.
- **Rate limiting is per-process and in-memory** (D-085). Two replicas double
  every limit — a real consideration before scaling past `numReplicas: 1`.

## OWNER DECISIONS

**Resolved — do not re-ask:** OPEN-2 (AWS S3 `ap-south-1`) · OPEN-3 (invitation
link) · OPEN-4 (immutable financial records) · **OPEN-5 / OD-3** (Vercel +
Railway + Neon + S3, **D-091**) · **OPEN-6 / OD-4** (release-step migrations,
**D-090**) · OPEN-7 / OD-1 (**D-084**) · OPEN-8 / OD-2 (**D-083**) · OPEN-9 ·
OD-7 · OD-8 / U-14 (**D-086**).

**Still open:** **OD-9** — ratify the built hybrid scope in the PRD (OPEN-10).
Documentation only; blocks nothing.

**External — cannot be fabricated:** **OD-5** DPDP counsel sign-off ·
**OD-6** independent penetration test.
