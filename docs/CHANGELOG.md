# CHANGELOG

All meaningful changes to this project, newest first.

**Every session must add an entry.** Include what changed, why, and which files. Keep application changes and documentation changes in separate sections so the record stays readable.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). The project is not yet versioned — entries are dated and grouped by phase.

---

## [Unreleased]

### 2026-09-06 — WAVE 5 + WAVE 6 (Claude-doable): delivery, operations and the final gate

**The repository is ready for the human production-setup phase.** Everything that could be built, tested and verified locally is done; everything that needs a real account, a real service or a person is listed and marked.

#### Wave 5 — delivery and operations

**15.9 — the scheduled job runner (D-092).** Four things had been stamped by the application since the first migration and acted on by **nothing**. `src/jobs/` now holds `expire-import-batches`, `purge-recycle-bin`, `cleanup-refresh-tokens` and `detect-sla-breach`, behind `node dist/jobs/run.js <name|all>` with `--dry-run` and `--limit`. Exit 0 only when every job reports `failed: 0`. **No migration** — observability is the structured log plus the audit rows the jobs already write.

**`expire-import-batches` is SEC-009's retention half.** `import_rows.raw` is the uploaded spreadsheet verbatim, including plaintext Aadhaar, and it was never deleted. The job destroys the rows and keeps the batch record and its counts — "on 12 March, Anita imported 412 customers from `march-book.xlsx`" is worth keeping and contains no personal data; 412 staged copies of an Aadhaar number are not. Case 8 seeds a recognisable value and asserts it is **gone from the database**, which is the only evidence worth having for a retention claim. ⚠️ **It is implemented and not in effect** — nothing purges until the cron is wired, so the finding stays open.

Two signatures widened to accept a null actor (`permanentDelete`, `notifications.emit`): a job has no user, and `actor_id = null` is the truthful record of a system action rather than a manufactured service account. `cleanup-refresh-tokens` keeps dead tokens for **7 days**, because `/auth/refresh` detects replay by finding a *revoked* row — deleting on rotation would make the detection silently stop working, and the attacker gets the same 401 either way, so no endpoint test would notice.

**15.7 / SEC-019 — log redaction at any depth (D-094).** The paths were `*.password`-shaped, and a pino `*` matches **exactly one** intervening level. So `req.body.password` — depth three, and the single most likely leak shape — was never covered, nor was `audit.changes.pan`, which `services/audit.ts` logs wholesale on its own failure path. The file's comment promised otherwise. Redaction is now a bounded, cycle-safe walker by **key name at any depth**. `email`, `name` and every id are deliberately kept: a log where the actor and the record are both `[redacted]` is one somebody turns off. **The first walker had a defect its own tests caught** — it treated `Error` like a plain object, but `message` and `stack` are non-enumerable, so it produced `{}` and destroyed the error message.

**15.5 — error tracking (D-093).** `lib/observability.ts`, `lib/report-error.ts`, and real Next.js error boundaries where there were none. Config-gated; no SDK, for D-006's reason on the server and a sharper one in the browser — an SDK is third-party JavaScript and the CSP has no allowance for one. The envelope is an **allow-list**: a `pg` error's `detail` (which contains the offending **row value**) and its `cause` (the connection string) are stripped, and the browser envelope carries `pathname` and **never the query string**, where `/accept-invite` keeps a live single-use token.

**15.1 / 15.4 — deployment and the migration release step (D-090, D-091).** Multi-stage `Dockerfile` with `dumb-init` so SIGTERM reaches Node and the graceful drain actually runs; `railway.json`, `vercel.json`, `.dockerignore`. `scripts/release.mjs` applies migrations against `DIRECT_DATABASE_URL`, prints applied-versus-pending, never prints a connection string, and **refuses** when `DATABASE_URL` looks pooled and the direct URL is unset — verified locally in both directions. OD-3 and OD-4 applied and recorded, closing OPEN-5 and OPEN-6.

**14.7 — CI, and it was run.** `.github/workflows/ci.yml` with four jobs. The **schema** job exists because of Wave 0 and is what stops the snapshot defect recurring. `scripts/ci-local.sh` executes every step locally, and **its first run found two real defects**: a type error in a new test, and a zero-diff check that used `git diff` — which answers "does the tree match HEAD?", a different question that is blind to untracked files and fails on legitimate uncommitted migration work. Both fixed; the check is now a content hash taken before and after.

**15.15 — configuration consistency, as tests.** `.env.example` had drifted again: it shipped the exact `AADHAAR_PEPPER` the schema now refuses by name (so `cp .env.example .env` could not boot), documented a 16-character minimum against a 32-character schema, and said the retention job "does not exist yet". The frontend template documented two variables **no file reads**. All fixed — and `env-template.test.ts` on each side now fails the build if either drifts again, in **both** directions.

#### Wave 6 — the Claude-doable half of the final gate

**Q9 — the five-role permission matrix.** `role-matrix.test.ts` drives all five seeded roles against 37 endpoints: a holder is never 403, a non-holder is **always** 403 — never 404 or 422, because `requirePermission` runs before the handler. Expectations are computed from `DEFAULT_ROLES` and joined against each route's hand-copied requirement, so a route that stops enforcing its key fails even though the catalogue is untouched. It found one thing immediately: the recycle-bin purge path in the first draft of the matrix was wrong.

**Zero-fake, repository-wide.** `zero-fake-sweep.test.tsx` sweeps **all twenty screens**, clicking every enabled control twice over so dialog contents are reached, with every permission granted so nothing is hidden from it. It also proves it can *detect* a planted offender, that every navigable route is in its list, and that it clicked a meaningful number of controls — three ways a sweep can pass while testing nothing.

**Operational documentation:** `DEPLOYMENT.md`, `RUNBOOK.md`, `SECRETS.md`, `EMAIL.md`, `BOOTSTRAP.md`, `GO_LIVE_CHECKLIST.md`. Every command in them exists. `EMAIL.md` is a code-read audit of all three sending flows plus the two templates that have **no caller**, with a 14-step production test. `BOOTSTRAP.md` documents the failure that costs a first deployment: with either bootstrap variable unset, the seed creates **no user at all** and exits 0.

#### Gates

Backend **1258/1258 · 55 files** (was 1188/51) · frontend **1143/1143 · 52 files** (was 1105/49) · both typechecks clean · backend lint clean · frontend lint **58**, unchanged · `db:generate` zero diff · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16** · demo exclusion PASSED · `next build` exit 0. **No migration — Wave 5 needed no schema change.**

**Registers:** SEC-019 resolved → **0 CRITICAL · 1 HIGH · 2 MEDIUM · 6 LOW, 9 open / 21 resolved**. Readiness recomputed mechanically: **130/160 = 81%**, up from 123/160.

#### What is NOT done, and cannot be here

The Docker image has never been built (daemon unavailable). CI has never run on GitHub Actions. No migration has ever run against real Postgres. S3 has never made a network call. No email has ever reached Resend. No restore has been rehearsed. **OD-5** (DPDP counsel) and **OD-6** (penetration test) are external. Every one of these is in `GO_LIVE_CHECKLIST.md` with the action that closes it.

---

### 2026-09-06 — WAVE 4: the admin UI (Phase 12)

**Three screens that did not exist now do**, over routes that shipped with the first migration and had **zero frontend callers**. Two backend defects closed, both reversion-proven. **No migration** — Wave 4 needed no schema change.

#### Backend — one new module, two fixes, two new route pairs

**12.3 — `PATCH /api/teams/:id`.** `teams.edit` had been seeded to Super Admin and Admin since the beginning and was **consumed by no route**: a team's name, description, leader and status were whatever `POST /api/teams` set, for the life of the record. The new route also authorizes the **leader designation like a roster change** — `assertCanManageRoleLevel`, with the same self-exemption `PUT /:id/members` uses — because naming somebody team leader is an act upon them exactly as rostering them is, and exempting it would leave the BUG-038 hierarchy bypassable one field over. The same guard is applied to `POST`, or the designation would be reachable by deleting the team and creating it again. **Reversion-proven: 3 of 27 fail without it.** `DELETE` was corrected in the same pass — it used to `UPDATE … WHERE id` with no prior read, so deleting a uuid naming no team wrote an audit row and answered **204**.

**12.5 / SEC-014 / BUG-016 — the audit filter precedence bug.** The bank-scope clause was a bare `A or B` pushed into `and(...filters)`. Drizzle parenthesises the conjunction and not its members, and `and` binds tighter than `or`, so the predicate read as `((filters and personal-branch) or bank_id in (…))` — **every operator-selected filter was silently dropped for the in-scope half of a scoped caller's query**. An investigator narrowing to `action=deleted` got an unfiltered stream. The fix is the parentheses and nothing else. **Reversion-proven: 5 of 21.**

Two things measured while writing those tests and recorded rather than smoothed over: it was **never a cross-tenant leak** (the escaping disjunct was still `bank_id in (caller's banks)`, and a case asserts that separately from the filter cases), and it was **unreachable with the seeded roles** — `audit_logs.view` is held only by Super Admin and Admin, and Admin also holds `system.access_all_banks`, so `ctx.bankIds` was `null` for both. Reaching it needs the bespoke bank-scoped auditor `permissions.ts` names in its own comment, which the tests build through the real `POST /api/roles`.

**12.4 — `meta.total` and the filters a viewer needs.** The route answered `{ page, pageSize }` and no total, from which a paginator can only invent a page count or offer a Next that lands on nothing. Added `total`, `totalPages`, `scoped`, plus `actorId`, `bankId` and an inclusive-to-the-whole-day date window. A `bankId` outside the caller's scope is a **403**, never a quietly different result set (D-051).

**12.6 — `app_settings` is alive.** It shipped in the first migration with **zero references outside the schema file**. Now `services/settings.ts` holds a **closed registry** of seven keys, each with its own schema and fallback; `GET`/`PATCH /api/settings` read and write it. An undeclared key is a **400 naming it**, the whole body is validated before anything is written, the writes share one transaction, and the response is the server's re-read state rather than the request echoed. One key has a **live consumer**: `recycleBin.retentionDays` feeds `purgeDate()`, so changing it changes when a deleted record becomes purgeable — measured through the real delete path, not by reading the setting back. Absent, it falls back to `RECYCLE_BIN_RETENTION_DAYS`, so an untouched deployment is unchanged. **D-087.**

**U-14 / OD-8 — `settings.edit` is Super Admin and Admin.** The key had never needed an answer because no route consumed it. **D-086.**

**12.8 — real sessions.** `GET /api/auth/sessions` and `DELETE /api/auth/sessions/:id`. Both self-service only, scoped to the caller's own `user_id` with no permission key and no `?userId=` — administrative revocation of somebody else's sessions is a different capability with different authorization, and inventing it to fill out a screen would widen the permission model by accident. The token digest never leaves the server; `current` is derived by comparing the caller's own cookie against each row's hash. **D-088.**

#### Frontend — four screens

**12.1 `/roles`.** List, create, edit, delete and a permission matrix, over six routes with no callers. The hierarchy and `assertCanGrantPermissions` are **mirrored** in the UI so no control is offered that is certain to 403 — but a permission the viewer does not hold is **disabled and explained**, not hidden: hiding it would make the matrix read as the role's complete grant when it is not.

**12.2 `/teams`.** Create, edit, delete, and whole-roster replacement. The roster dialog is seeded from the **server's** membership every time it opens and the list is **re-read** after a save — merging a local draft would evict whoever joined since the page loaded, and the server would authorize that eviction perfectly correctly.

**12.4 `/audit-logs`.** Server-side filters, a detail view that renders redaction placeholders as they arrived, and pagination whose every number is `meta.total`. Deliberately **no sortable headers** (the route takes no sort parameter — a clickable header would reorder 50 rows while implying it ordered the trail) and **no CSV export** (`changes` names every field that changed on every record).

**12.6 / 12.8 `/settings`.** The Company tab is a real form again — loads, saves, and adopts what the server returns rather than what was typed. The active-sessions panel lists real refresh tokens with a revoke that genuinely ends the session, showing the user-agent string **verbatim** rather than parsed into a device name.

**12.10 — permission-aware navigation.** `NavItem` had no permission field at all, so all fourteen entries rendered for all five roles; an Executive was invited into Reports, Settlements, Ledger and the Recycle bin. The Ctrl+K palette had the same defect and gets the same filter. **This is a usability change and not a security one** — **D-089**, and group D of `nav-permissions.test.ts` asserts the properties that keep it one.

#### What Wave 4 deliberately did NOT build

**Per-user preferences and alert preferences stay `NotConfigurable`, with the reason corrected.** `app_settings` is keyed by `key` alone and has **no user column**, so storing them there would make one operator's choice everybody's. That is a missing *table*, not a missing route, and the panels now say so. **Invoice numbering** likewise: settlement numbers come from `code_sequences`, so a prefix stored here would be read by nothing and the panel would claim an effect it does not have.

#### Gates

Backend **1188/1188 · 51 files** (was 1102/47) · frontend **1105/1105 · 49 files** (was 997/44) · both typechecks clean · backend lint clean · frontend lint **58**, unchanged (1 pre-existing error in `use-auth.tsx`) · `db:generate` **no schema changes** · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16** · demo exclusion PASSED on both bundlers · `next build` exit 0, 27 routes.

One lint error was introduced and fixed rather than suppressed: seeding the settings draft in a `useEffect` tripped `react-hooks/set-state-in-effect`, and it is now React's documented render-time adjustment instead.

**Registers:** SEC-014 **resolved** (0 CRITICAL · 1 HIGH · 2 MEDIUM · 7 LOW — **10 open / 20 resolved**). BUG-016 and BUG-023 **closed** (21 → **19 open**). Readiness recomputed mechanically: **123/160 = 77%**, up from 119/160.

---

### 2026-09-06 — WAVE 3: financial correctness and the security core

**Both remaining P0 findings are closed.** There is now **no CRITICAL security finding open**, and **one HIGH** (SEC-009, whose retention half needs Wave 5's job runner).

#### Security — 6 tasks, 5 findings closed, 2 downgraded

**13.1 / SEC-005 (P0).** `/api/auth/login` was completely unthrottled — an anonymous caller could drive unlimited argon2id verifications. Now limited on **two axes**: per address (20/15 min) and **per account** (10/15 min, keyed on the normalised address). Per-account is what catches a *distributed* attempt at one inbox, which per-IP cannot see. A **global limiter** (300/min) backstops every route, with `/api/health` exempt so the limiter cannot restart-loop the platform. The **argon2 pile-up** — the half a request limiter cannot solve — is bounded by `withHashSlot`: 4 concurrent, queue-not-reject, bounded queue. **Reversion-proven: 5 of 15 cases fail against pre-fix code.** Residual (per-process, in-memory, fixed-window) recorded in **D-085**.

**13.4 / SEC-007 (P0).** Three defects. The Aadhaar digest was returned by **five** bare `.select()`/`.returning()` calls — now one shared `CUSTOMER_COLUMNS` projection, with a test asserting it covers every column *except* that one so a new column cannot silently reappear. `AADHAAR_PEPPER` had a **published default** guarded only by `NODE_ENV === "production"`, so staging and UAT peppered real data with a repository constant; it is now required everywhere at 32+ characters. And the digest was `sha256(pepper + ":" + value)` — length-extendable over a 10^12 keyspace — now **HMAC-SHA256**.

**13.7 / SEC-008.** Magic-byte validation (multer checked only the client-declared MIME type), a 20× decompression ceiling read from the ZIP local headers, a 5,000-row cap that **refuses rather than truncates**, and 4xx instead of a 500 stack trace.

**13.8 / SEC-017.** `REDACTED_FIELDS` was 8 secrets and missed **every piece of customer PII** — one typo-correcting PATCH wrote PAN, mobile, DOB, address, account number and IFSC into a trigger-immutable table with no purge path. Now ~35 fields, with the **key still listed** under placeholders so "who changed the account number, and when" stays answerable.

**13.9 / SEC-013.** ⚠️ **The first fix was over-corrected and four existing tests caught it.** Blanket-refusing scoped callers on a null-bank entry would have removed employee restore from every Manager — a capability D-030 deliberately designed. The precise fix distinguishes `user` (defers to the role hierarchy), `service_provider` (no guard at all → unscoped-only) and everything else (fails closed).

**13.12.** `logout` and `permission_denied` were declared `AuditAction`s that **nothing ever wrote**. Both now are. The denial records the permission **keys**, never the request body, and is fire-and-forget so a logging failure cannot turn a 403 into a hung request.

#### Financial — 11.3, 11.7, 11.9, U-5

**11.3.** The reports screen computed everything in the browser from `/loans` capped at **500**, so **loan 501 was invisible** and every total was a sum of a sample presented as a sum of the book. `GET /api/reports/loans` aggregates in SQL and returns the summary over the *whole* filtered set alongside a page of rows — one call, because two could straddle a write. `/api/reports/trend` replaces the hardcoded empty array (11.5's endpoint half). One test seeds **520 loans** so a regression to client-side filtering fails in CI, not at a client.

**11.7.** `balance` was written as `0` by every path and recomputed by none, while the schema comment claimed otherwise. Now `SUM(credit) − SUM(debit)` over the bank's live entries, **inside the insert transaction with no row lock** — the obvious read-then-write is the BUG-037 race (D-027). It is also no longer accepted from the client, which it previously was.

**11.9.** CSV **formula injection** closed losslessly — a leading `=`/`+`/`-`/`@` is prefixed, not stripped, because `-500 adjustment` is a real narration and corrupting it would be worse than the injection. Exports now fetch **every** matching row via `pageSize=0`; the server refuses past 20,000 rather than truncating.

**U-5.** `amount_approved` was written by **nothing** — refused on PATCH (D-056) and carried by no approve path — so every approved loan reported 0 while `/dashboard/bank-performance` summed it. The approve route now captures it via two new opt-in factory fields (`approveInput`, `beforeApprove`), and a loan cannot reach `Approved` without it.

#### Test failures fixed in the implementation, never by weakening

- **`factory-transaction.test.ts`** (Wave 2) revealed the `23514` mapping was too broad.
- **Four `user-recycle-bin` cases** caught the over-corrected SEC-013 fix.
- **27 fixtures** across five files needed `amountApproved` on `->Approved` — the requirement working.
- **`partial-update` case 19** asserted a client-supplied balance survives, which is what 11.7 removes; retargeted to BUG-036's actual property, plus a new case proving the client cannot dictate it.
- **`cookie-config` case** asserted development was *allowed* the shipped pepper — **inverted**, because that behaviour was the finding.
- **`reports-load-and-dates.test.tsx`** had its date-boundary cases **moved to the backend**, where 11.3 moved the behaviour. Duplicating them against a mock would assert only that the mock works.

#### Verification

Backend **1102/1102 · 47 files** (previous baseline 1004/45) · typecheck clean · lint clean.
Frontend **997/997 · 44 files** (previous baseline 978/43) · typecheck clean · lint 58 (1 pre-existing error).
`db:generate` **no schema changes** · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16** · **no new migration** — Wave 3 needed no schema change.

#### New tests

`auth-rate-limit.test.ts` (15) · `aadhaar-protection.test.ts` (16) · `bin-scope-and-audit.test.ts` (14) · `audit-redaction.test.ts` (10) · `import-hardening.test.ts` (12) · `ledger-balance.test.ts` (12) · `reports.test.ts` (17) · `export-injection.test.ts` (14).

---

### 2026-09-06 — WAVES 1 AND 2: honesty sweep, six security findings, and the status-vocabulary sweep

Two waves of the consolidated pre-deployment programme, on top of Wave 0.

#### Wave 1 — three tracks, no shared files

**Track A — the honesty sweep.** BUG-002's thirteen were closed by Phases 4–10; the audit found **seventeen more of the same shape** that were never in its count. Each was checked against the API before being cut, and every one is unbacked *today*: `PATCH /api/users/:id` needs `users.edit` **and** passes `assertCanManageRoleLevel` against the target, so **self-edit is refused for every role** — there is no self-service profile endpoint; `users` has `avatar_color`, not `avatar_url`; `app_settings` is completely dead; there is no `GET /api/auth/sessions`; and 2FA exists in no layer.

Removed: the profile save, both avatar controls, six company-record inputs, three invoice-numbering inputs, the bank logging switch, five alert switches, three delivery-channel switches, three preference switches, the landing-page select, the fabricated three-row active-sessions table and its per-session sign-out, **the 2FA switch** (OPEN-8, resolved by **D-083**), and "Reset demo data" — a bare `window.location.reload()` described as restoring sample records. `/reports`' "Excel" (an HTML table named `.xls`) and "PDF" (`window.print()` announcing *"PDF ready"*) are relabelled to what they do.

Kept, because they are real: change-password, and the bank-access table. Empty tabs now say what is not configurable and name the roadmap row that owns it.

**Track B — six security findings.** SEC-004 (locked accounts answered 429; now the identical 401 an unknown address gets), SEC-006 (sticky lockout counter — one request every 15 minutes kept any account dead permanently), SEC-012 (`remotePatterns: "**"` deleted — an open SSRF proxy), SEC-015 (the driver error now goes to the log, not the unauthenticated response), SEC-022 (`algorithms: ["HS256"]` pinned), SEC-011 (real CSP/HSTS/XFO/Referrer-Policy/Permissions-Policy on the frontend origin).

**Track C — display truth.** The dashboard rendered **₹0 for a 403**, so an Executive saw a book of zeroes indistinguishable from a real one (U-4). `useStats` now reports `forbidden` and `error` separately and `StatCard` gained `unavailable`. `/banks` and `/teams` were fetched with no `pageSize` and defaulted to **25**, making a 26th bank invisible in every selector (U-7). Two columns rendered `—` for every row because `key` did not match the field (U-6 / BUG-039). Reports rendered **empty on load** (11.1) and **always excluded the final day** because an ISO timestamp was string-compared to a date bound (11.2).

#### Wave 2 — migration `0014`, and SEC-016 closes

Nine CHECK constraints on `users`, `banks`, `customers`, `documents`, `funding_sources`, `service_providers`, `settlements`, `transactions` and `verifications`. Repository total **4 → 13**.

**`verifications` is why this closes SEC-016.** It has an approve route and configured no `allowedStatuses`, so `approveBody` fell back to `z.string().min(1)` and accepted any non-empty string. `NEXT_TASK.md` carried it forward five times as *"belongs to the 13.13 sweep"*. The router now opts in **and** the constraint sits behind it.

Hand-written with `NOT VALID` + a separate `VALIDATE` per D-057 — `drizzle-kit generate` emits the one-shot form, which is the standing reason these are written by hand (D-081). Pre-flight offender queries in the header deliberately omit `deleted_at`, and a test proves why: a soft-deleted offender fails `VALIDATE` exactly as a live one does.

**`23514` is now mapped** (U-10). Without it, nine new constraints would each have turned a data-integrity refusal into a 500 with a stack trace. **Only `*_status_check` / `*_stage_check` map to 422** — any other CHECK violation is an internal failure the caller did not cause and stays 500, which is what `factory-transaction.test.ts` requires when it breaks the audit insert.

**Deliberately not constrained, and recorded:** `teams.status` (no route writes it, vocabulary unsettled) and `import_batches.status` / `import_rows.status` (free-form lowercase, and SEC-008/13.7 is about to rewrite that path).

#### Wave 2 completed — migration `0015`, OPEN-7 resolved by the owner

**The owner answered OD-1: bank-less ledger entries are not legitimate** (**D-084**). `ledger_entries.bank_id` becomes `NOT NULL`.

The defect it closes was silent and severe: `bankScope` filters with `inArray`, and SQL `IN` never matches NULL — so a hand-created entry from an unscoped user was **permanently invisible to every scoped user**, with no error and nothing on screen to suggest the row existed.

**Pre-flight run before writing the migration:** `0` total, `0` NULL against a fully migrated and seeded database. ⚠️ `db:seed` writes no business data, so that proves nothing about a deployed database — the operator must run the query in the header. **If it returns rows the migration fails loudly and does not backfill**; financial data is not invented.

**An unforeseen consequence, caught by inspection:** the FK was `ON DELETE SET NULL`, which is *incompatible* with `NOT NULL` — deleting a bank would have tried to write NULL into a column forbidding it. It becomes `ON DELETE RESTRICT`, matching every other NOT NULL `bank_id` in the schema.

Applied in four staged steps rather than one `SET NOT NULL`: an offender now fails at a **retryable** `VALIDATE` with the guard already stopping new offenders, instead of aborting the deployment. A test proves the retry path end to end, and another proves a **soft-deleted** offender still blocks it — which is why the pre-flight omits `deleted_at`.

**Task 11.6 completed.** `ledger.create` granted to **Manager and above** (OD-7's documented default; Team Leader and Executive stay view-only, preserving maker-checker). The voucher dialog now sends a required `bankId` — a selector is correct here and does not violate D-059, which forbids one only where the bank is *derivable*. **Task 11.8** done in the same dialog: the amount input stripped every non-digit, so paise were unreachable.

**11.7 is not done, so the balance stopped claiming to be one.** `balance` is written as `0` by every path and recomputed by none. The "Closing balance" tile and the Balance column now say the figure is not computed yet rather than printing ₹0.00 down a financial book (D-004, D-051).

#### Three test failures, all fixed in the implementation

Migration `0014` broke three existing tests. None was weakened:
1. **`loan-state-machine.test.ts` case 6** pinned `verifications` accepting `"banana"`. Its own comment named 13.13 as the owner. Updated to assert the closure, and extended to prove a legal value still works.
2–3. **`factory-transaction.test.ts`** breaks the audit insert with a CHECK and expects ≥500. That revealed the first `23514` mapping was **too broad** — it told the client their input was bad when the server's audit table was broken. The mapping was narrowed to vocabulary constraints only.

`settings-export-promise.test.tsx` group C pinned the Danger-zone card as a coherence check; that card was itself a fake, so the group was **retargeted, not deleted**, with strictly stronger assertions.

#### Verification

Backend **1004/1004 · 40 files** (was 967/38) · typecheck clean · lint clean. Frontend **978/978 · 43 files** (was 949/39) · typecheck clean · lint 59 (1 pre-existing error, was 60/2). `db:generate` **no schema changes** · `drizzle-kit check` fine · migrations/snapshots/journal all **16**. Demo exclusion passes on both bundlers.

**The Track B tests are reversion-proven:** reverting the two handler changes and the algorithm pin fails **7 of 13** cases in `auth-hardening.test.ts`.

#### New tests

`auth-hardening.test.ts` (13) · `check-violation-mapping.test.ts` (10) · `migration-populated.test.ts` +6 · `security-headers.test.ts` (7) · `use-stats-honesty.test.tsx` (8) · `reports-load-and-dates.test.tsx` (7) · **`no-unbacked-success.test.tsx` (5)** — the general form of `fake-controls.test.tsx`: it clicks every enabled control on the swept pages and enforces that a `toast.success` is accompanied by either an API call or a produced file. It found the last two offenders itself — a page-header line still promising "Excel … PDF", and an "Apply" button that reported applying filters which were already live.

---

### 2026-09-06 — WAVE 0 COMPLETE: repository integrity (no application change)

**`npm run db:generate` was broken, and the obvious repair would have shipped a migration that breaks a production database.** Both are fixed. Wave 0 changed **no application code, no tests, no migration SQL and no journal entry** — it repaired the migration tooling, completed the environment template, and reconciled three state documents that had drifted up to eight phases behind reality.

#### W0.1 / W0.2 — Drizzle snapshots (**D-081**)

`drizzle-kit` discovers snapshots by **listing `meta/`** (`readdirSync(meta).filter(it => !it.startsWith("_"))`, `bin.cjs:8127`), not by reading `_journal.json`. `meta/README.md` — written the previous day to *document* the missing snapshots — was therefore parsed as a snapshot and threw `SyntaxError: Unexpected token '#'`. **The file recording the gap was preventing anyone from closing it.**

Removing it exposed the worse half: with `0007` the newest snapshot, `drizzle-kit generate` re-emitted every DDL statement from `0008`–`0013` as one new migration, which fails on statement one against a database that has already run them.

Snapshots `0008`–`0013` were rebuilt **by reverse application**, in scratch, with no database:

1. Generate the canonical snapshot of the current schema; **discard its SQL** — that SQL is the hazard.
2. Reverse-apply each shipped migration to it, newest first, asserting every removed object was present.
3. **Require** that the last reverse step lands **byte-identically** on `0007_snapshot.json` under a recursively key-sorted comparison. It did.

That equality anchors the chain to the shipped SQL **and** to the live schema at once. Each snapshot was then checked independently — with `0000`–`N` installed, the delta drizzle-kit still wanted equals exactly migration `N+1`. The table is in the new `drizzle/SNAPSHOTS.md`.

**Two divergences are expected, permanent and confined to the discarded SQL:** drizzle-kit emits CHECKs without `NOT VALID`/`VALIDATE`, and `0011`'s `event_type` without its staged `DEFAULT 'legacy'`/`DROP DEFAULT`. Those staged forms are load-bearing on a populated table. Snapshots record the **end state**, which matches — so `generate` is now safe to *run*, but its output is still not shippable for staged DDL. **Migrations touching populated tables are still written by hand.**

#### W0.3 / W0.4 — environment templates (**D-080**)

`env.ts:193-200` **refuses to boot in production** without five `STORAGE_*` keys. **Neither environment template named any of them** — Phase 9 added eight keys and no template followed. A deployer following either file to the letter got an unexplained boot failure.

- `.env.example` now documents **all 28** `env.ts` keys plus `LOG_LEVEL`, with D-071/D-072's reasoning and the honest note that the S3 adapter has never made a live network call. Both credential keys ship **empty**.
- The root `.env.example` is **deleted**. No root `package.json`, no root tooling, and the only `dotenv` consumer is `src/config/env.ts` loaded from `backend/`. `README.md:70-71` already called `.env.example` authoritative.
- **One correction of substance:** the `FRONTEND_URL` block claimed the variable was *"read by nothing in application code"*. True when written, false since Phase 3 — `invitations.ts:55` and `password-reset.ts:51` build their links from it. Left at its default on a deployed backend, **every invitation and reset email points at `localhost`, sends successfully, and is useless.**

**SEC-025 closes** — its `.gitignore` half by Task 0.4, its template half here.

#### W0.5 — state documents and registers

- **`PRODUCTION_READINESS.md`** — header was two phases stale (described Phase 3 as in progress). Rewritten; the scorecard is **recomputed mechanically from its own area tables**: **160 items, 104 DONE (65%)**, up from 66 (41%). 38 items moved, each evidenced in its own row.
- **`CURRENT_STATE.md`** — header was **eight** phases stale ("Phase 2 is next"). Rewritten with measured state; everything below it marked explicitly historical.
- **`BUGS_AND_ISSUES.md`** — **BUG-002 CLOSED** by measurement: all thirteen theatre controls now issue real awaited requests, the last nine pinned by `fake-controls.test.tsx`. The tally disagreed with its own table in four places and is recomputed: **39 recorded, 22 open** (was "26 open of 35"). **BUG-004 and BUG-006 look closable and are deliberately left open** pending a one-at-a-time re-read.
- **`SECURITY_AUDIT.md`** — every open finding re-read against code; **none had closed silently.** **SEC-025 RESOLVED.** **SEC-009 assigned an owner (13.7 + 15.9)** — it had none, which for a P0 was its own defect; nothing about it is fixed.
- **`NEXT_TASK.md`** — rewritten for **Wave 1**.

#### The scope caveat this wave insists on

**BUG-002's closure is narrower than it sounds.** It counted thirteen controls on the business screens and **never counted the settings or reports pages**, where **17 further controls** claim an outcome and issue no request — including a 2FA switch reporting *"2FA enabled"* for a feature in no layer, a fabricated active-sessions table with a working-looking "Sign out", and a dashboard that renders **₹0 for a 403**. **Phase 16.3's *"zero fake handlers"* is not met.** Wave 1 owns them.

#### Verification

Backend **967/967 · 38 files** · backend typecheck clean · frontend **949/949 · 39 files** · frontend typecheck clean · `npm run db:generate` **exit 0, "No schema changes, nothing to migrate"** · `drizzle-kit check` **"Everything's fine"**.

All fourteen migration `.sql` files and `_journal.json` verified **byte-identical by MD5** before and after. No migration created. Nothing committed.

#### Files

`drizzle/meta/{0008..0013}_snapshot.json` (new) · `drizzle/SNAPSHOTS.md` (moved from `meta/README.md`, rewritten) · `.env.example` · `.env.example` (deleted) · `docs/DECISIONS.md` (D-080, D-081) · `docs/PRODUCTION_READINESS.md` · `docs/CURRENT_STATE.md` · `docs/BUGS_AND_ISSUES.md` · `docs/SECURITY_AUDIT.md` · `docs/claude/NEXT_TASK.md` · `docs/CHANGELOG.md`

---

### 2026-09-05 — PHASE 5 COMPLETE: Tasks 5.1–5.11, loan / file workflow

Loan approve/reject — *"the single most business-critical unreachable operation in the system"* — now issues a real request. The loan state machine is enforced at the API **and** at the database. The verification workflow has a UI for the first time. **BUG-015 is closed.**

Executed as **Wave 0 (docs) → Waves 1–2 (backend) → Waves 3–4 (frontend, serial on one file) → Wave 5 (verification UI)**.

#### Wave 0 — reconciliation before any code

Two roadmap premises were **factually wrong** and were corrected before implementation, not after:

- **5.7** said *"inside the existing transactions"* and named `approvedBy`/`approvedAt` as work. Both wrong: those columns are **already stamped** (`scoped-resource.ts:403`), and `grep '.transaction('` returns **zero** hits in `scoped-resource.ts` and `operations.routes.ts` — there was no boundary to work inside. See **D-060**.
- **5.8** said the filters are *"none are ever sent"*. `customerId` **is** sent by the customer-detail list and is pinned by `frontend-contract.test.ts:123`. See **D-061**.

Also: `claude/NEXT_TASK.md:74` claimed *"Task 5.2 owns approve/reject"* — it is **5.4**; rows **5.10**/**5.11** were added for two unowned false controls; **5.9** was widened to name `/my-work`; and a DoD scope note settled that Box 1 enumerates four UI operations and Box 3 means loan-primary screens, so Phase 7's disbursement stubs are not annexed. Decisions **D-056 – D-061** recorded.

#### Backend

- **5.3** — `allowedStatuses` added to `ScopedResourceConfig` (opt-in), wired for loans to the previously **unused** `loanStatuses` const. `{"status":"banana"}` → **422**.
- **5.2** — `BUSINESS_FLOW.md` §3.3 ratified **first** per D-010. Ten legal edges; `Rejected`/`Closed` terminal; legal initial statuses **{Draft, Submitted}**. Enforced at create and approve. **`PATCH` refuses `status` and `amountApproved`** via `notOnThisRoute()`. Migration `0007_loan_status_check`: vocabulary-only CHECK on **`loans.status` alone**, `NOT VALID` + a separate `VALIDATE`, **no trigger**.
- **5.7** — new `afterCreate` hook carrying a `TransactionHandle`; disbursement insert + loan advancement + audit in **one** transaction. Named `afterCreate` rather than `afterWrite` because `beforeWrite` fires on create *and* patch.

**Two previously unrecorded privilege bypasses were found and closed:** `PATCH /api/loans/:id` could set `status: "Approved"` on `requests.edit` alone; and `POST /api/loans {"status":"Approved"}` returned **201** on `requests.create` alone — a permission held by **Team Leader and Executive**, neither of whom holds `requests.approve`.

#### Frontend

- **5.9** — honest three-state handling on `/loans` **and** `/my-work`. The latter previously rendered *"Every file in your book has reached a decision."* on a failed load; a test now asserts that message still appears when the book is genuinely empty, so the fix distinguishes the two rather than deleting it.
- **5.1** — all four BUG-015 criteria. The duplicate-submit guard is a **ref**, proven load-bearing by mutation: the `saving` state alone lets two clicks in one React batch fire two requests.
- **5.10 / 5.11** — the false EMI claim and the no-op Bank selector removed. No EMI calculator was built; `createLoan`'s payload is unchanged.
- **5.8** — server-driven paging. **`DataTable` needed no change** — Phase 4's optional props sufficed (D-051 rule 1 holds). The 25-vs-8 double pagination is gone. Search reworded honestly per **D-061**; stat cards now say *"matching these filters"* / *"on this page"*.
- **5.4** — approve/reject wired, gated on `requests.approve`, optimistic with rollback, and the **server's returned row replaces the guess** on success (**D-026**).
- **5.5** — new `lib/loan-patch.ts`, diff-only over **seven** fields. `status`/`amountApproved` are absent **by construction**; a `@ts-expect-error` test makes `tsc` fail if the type ever widens.
- **5.6** — verification panel on the loan detail dialog. Creates through the loan sub-route, **never** the factory `POST /api/verifications` (which skips `assertSameBank` and both business rules). **Branches on HTTP status, never message text** — the same 409 arrives with two different sentences. **No permission was widened**: roles without `service_providers.view` get the bank-handled path with copy stating this is a limit on their role, not that no providers exist.

#### Verification

| Gate | Before | After |
|---|---|---|
| Backend tests | 732 / 27 files | **795 / 28** |
| Frontend tests | 656 / 30 files | **917 / 38** |
| Backend typecheck / lint | clean | **clean** |
| Frontend typecheck | clean | **clean** |
| Frontend lint | 82 (2 errors, 80 warnings) | **82 — unchanged** |
| `next build` | PASS | **PASS (exit 0)** |

**+324 tests.** No existing test was weakened or deleted. Two fixtures were corrected — `partial-update.test.ts` created a loan as `Approved` and `code-sequences.test.ts` disbursed a `Draft` loan, both illegal under the new machine; every assertion was preserved.

**The migration was verified against a populated database**, which the fresh-DB harness structurally cannot do: `NOT VALID` succeeds on a table holding an off-vocabulary row, `VALIDATE` fails on it with **23514**, the pre-flight query finds exactly the offender, `VALIDATE` succeeds after correction, and a later invalid insert is refused with 23514. **A plain validating `ADD CONSTRAINT` would have aborted the migration.**

#### Deliberately not done

**SEC-016 remains OPEN** — partial remediation only; disbursements still accept any status string and two tests pin that. **SEC-005, SEC-007, SEC-009, SEC-017, BUG-016/SEC-014 remain OPEN. BUG-035 was NOT closed** — 5.8 *worsens* its reachability and it is cross-referenced instead. The four deferred state-machine guards are recorded in `BUSINESS_FLOW.md` §3.3 (**D-057**). `amount_approved` capture was **not** implemented (**D-6**) — the stat wording was made honest rather than the column invented. **[BUG-039](BUGS_AND_ISSUES.md#bug-039) was newly found and recorded, not fixed.** No commit, no push. `frontend/next-env.d.ts` untouched.


### 2026-09-05 — PHASE 4 COMPLETE: Tasks 4.1–4.11, customer functionality

The customer detail page made **zero** write requests when this phase began. It now edits and deletes through the API and shows a real audit trail. The list page reaches every customer instead of the first hundred. Three fabricated controls are gone. **BUG-011 is closed.**

Executed in three file-disjoint lanes so no two tasks ever wrote the same file: **backend** (4.7 → 4.9), **detail page** (4.1 → 4.2 → 4.3 → 4.10), **list page** (4.8 → 4.5 → 4.4 → 4.6 → 4.11).

#### Backend

- **4.7 — assignment validation.** `assignedUserId` and `assignedTeamId` are validated on `POST` and `PATCH`. **Teams get existence and liveness only**, because `teams` has no bank column and no join table — "bank-scope membership" is undefined for them and inventing it would have been new product policy (**D-047**). Users get existence, liveness and bank membership, with **unrestricted Admin/Super Admin accepted**: they hold `system.access_all_banks` and therefore carry *zero* `user_bank_access` rows, which means unrestricted, not "no access" (**D-048**). Refusals are **422** with `details:[{path,message}]` so they map onto the control that names them (**D-031**), replacing the foreign key's misleading 409 *"still referenced by other records"*. This is data integrity, not confidentiality: there is no assignment-driven read path for customers, and a test pins that. 28 tests.
- **4.9 — one code series, seven sequences.** Migration `0006_code_sequences` creates a sequence per prefix and `setval`s each from `GREATEST(codeStart, max over the table, max over retained recycle-bin snapshots)`. All three generators — the route, the `scoped-resource` factory and the Excel importer — now call one `nextResourceCode()`, and **the importer passes its transaction handle**, so route-created and importer-created customers can no longer collide with each other. First codes are unchanged (`CUS-10001`, `LN-1001`, …). **No `deleted_at` filter was added** (**D-050**): its absence is what keeps a soft-deleted row's code reserved, and a test asserts such a row is still restorable — PRD **R3.1 AC3**. 13 tests, adversarially validated by reverting each behaviour: the count-based generator fails three, and fixing only the route while leaving the importer on its own count fails two more with a genuine `customers_code_unique` 23505.
- **`kyc` and `pan` on the list route.** `kyc` was added so 4.5's filter could filter the whole book. `pan` was added to the search disjunction because **D-053 puts preservation before honest redefinition** — the placeholder had always promised PAN search, and one more `ilike` was the modest extension the row allows. `id` was deliberately *not* made searchable: it is a `uuid` column that `ilike` cannot take without an unindexable cast, and the placeholder no longer claims it.

#### Frontend — customer detail page

- **4.1 — the edit dialog is real.** Four controlled fields sending **only what changed**, through a dedicated `lib/customer-patch.ts`. Aadhaar is absent **by construction** — `""` or `null` irreversibly nulls both `aadhaarHash` and `aadhaarLast4`, and the API only returns the last four, so it is not round-trippable (**D-052**). A cleared box sends `null`, not `""`, because `POST` normalises and `PATCH` does not. Duplicate submits are blocked by refs rather than `disabled`, which only applies after a re-render. Success is toasted only after an awaited 2xx and the view reconciles from the server (**D-004**).
- **4.2 — delete is real.** Awaits `DELETE`, then navigates rather than re-fetching a deleted record into `notFound()`. Gated on `can("customers.delete")`.
- **4.3 — the timeline is real.** `GET /api/audit-logs?recordType=customer&recordId=…`. **`audit_logs.view` was not widened** (**D-049**); the three roles lacking it get an explicit permission state, kept as its own flag so a 403 can never read as an empty history. **Field names only — never a value**, because `audit_logs.changes` carries unredacted PAN, mobile, email, account number and IFSC (**SEC-017**). Honestly thinner than the fabrication it replaced: `recordType` is scalar, so loan and document activity is unreachable, and the footer says so.
- **4.10 — the false audit-lock badge is gone.** *"Record locked for audit after disbursal"* was never true: `PATCH` and `DELETE` contain no loan-status check. No locking was invented (**D-054**).

#### Frontend — customer list page

- **4.8 — honest load states.** `loading`/`error`/`total` are destructured at last. A failed load shows a banner and **suppresses the table**, so an empty grid can no longer be mistaken for an empty database. Delete gated on `can("customers.delete")`.
- **4.5 — server-driven paging.** `DataTable` gained five **optional** props; server mode engages only when all of `total`/`page`/`onPageChange` are present, so the **ten other consumers are byte-identical** — proven by a 27-test regression suite written and run green against the *unmodified* component first (**D-051**). The six-button pager cap is gone; a sliding window pins both ends so page 7+ is one click away. Shipped with four honesty fixes: PAN search preserved, the misleading global sort affordance hidden (no server sort contract exists), export naming its scope, and stat cards no longer presenting a page-scoped figure as book-wide.
- **4.4 — the fake upload is gone.** Handler, button and hidden input removed together. No file storage exists anywhere, so "implement" was unavailable and a metadata-only row would have been a second lie.
- **4.6 — advisory duplicate check.** Uses `apiRequest` directly, since the route answers `{available:true}` rather than `{data}`. **Nothing gates the save button** — the unique index stays the authority. Only a 409 means "taken"; 404, 5xx, offline or an unexpected body become an explicit *unchecked* state. `ilike` is a superset of the index's `upper()` equality, so it can only produce a false *taken*, never a false *available*. The demo layer gained the branch it was missing.
- **4.11 — the fabricated Draft application is gone.** It emitted an applicant named *"Customer"*, `banks[0]` and a hardcoded ₹45,000 income in a document describing itself as *"for manual verification and onboarding"*. Nothing replaced it (**D-055**).

#### Verification

| Gate | Baseline | After | Delta |
|---|---|---|---|
| Backend tests | 687 / 25 files | **732 / 27** | +45, +2 files |
| Frontend tests | 454 / 20 files | **656 / 30** | +202, +10 files |
| Backend typecheck | clean | clean | — |
| Frontend typecheck | clean | clean | — |
| Backend lint | clean | clean | — |
| Frontend lint | 87 (2 errors, 85 warnings) | **85 (2 errors, 83 warnings)** | −2 warnings; the 2 errors are pre-existing and untouched |
| `next build` | PASS | **PASS (exit 0)** | — |

No existing test was weakened, deleted or skipped.

#### Documentation

`PRODUCTION_ROADMAP.md` (rows 4.1–4.11 ticked, all four DoD boxes ticked with evidence, phase marked COMPLETE, phase-overview table updated) · `BUGS_AND_ISSUES.md` (**BUG-011 CLOSED**, with a note that the `deleted_at` clause was deliberately *not* actioned) · `FEATURE_STATUS.md` (seven customer rows) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` (rewritten for Phase 5) · this file.

#### Deliberately not done

**No finding outside Phase 4's rows was fixed**, per RULES §10: **SEC-007** (P0 — `aadhaarHash` in customer responses; Phase 4 edited that file and left it, Phase 13.4 owns it) · **SEC-005** (P0) · **SEC-017** (its risk profile *rose* when 4.1 shipped, and that is recorded rather than quietly fixed) · **BUG-016 / SEC-014** · **"Print"** on the detail page (Phase 11.4) · the `documents?customerId=` parameter that is never read · `doc.uploadedBy` rendering blank · the raw UUID shown instead of `customer.code` · frozen KYC transitions · the employees Role-column defect. **No commit, no push.** `frontend/next-env.d.ts` untouched.

### 2026-09-05 — Phase 4 Wave 0: scope reconciliation (documentation only)

**No application code, test, schema or migration was touched.** No commit, no push. This entry records a documentation-only pass that fixed a stale contradiction, recorded six owner-approved decisions plus three supporting ones, and gave two owner-less Definition-of-Done violations explicit roadmap rows — **before** any Phase 4 implementation begins.

Wave 0 exists because [claude/SESSION_HANDOFF.md](claude/SESSION_HANDOFF.md):27 requires the tree and the documentation to agree before work starts, and they did not.

#### Documentation

- **[claude/CURRENT_PROGRESS.md](claude/CURRENT_PROGRESS.md)** — the phase table said **Phase 3: NOT STARTED — "Subsystem does not exist at all."** Phase 3 has been complete since 2026-09-04 across all twelve rows. Corrected to COMPLETE with its decision trail (D-033, D-037–D-046). The header also carried a garbled *"IN PROGRESS COMPLETE"* and the since-false claim that neither `/accept-invite` nor `/reset-password` exists — both were built by Tasks 3.11/3.12. Current phase is now Phase 4, NOT STARTED. **Historical task records were left untouched as history.**
- **[PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md)** — Phase 4 is now **eleven rows, 4.1–4.11**.
  - **Task 4.9 rewritten and re-rated M → L.** Three corrections, each verified against the code: *"shared with Phase 2.11"* was false (2.11's own correction states no `count(*)` generator ever underlay employee codes); there are **three** generator sites, not one, and the Excel importer mints `CUS-` codes independently, so a partial fix would make the route and the importer collide with each other; and **the prescribed `deleted_at` filter would make the bug worse** — its absence is what keeps soft-deleted codes reserved, exactly as [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md#bug-011) already stated. See **D-050**.
  - **Row 4.10 added** — remove the false *"Record locked for audit after disbursal"* badge. See **D-054**.
  - **Row 4.11 added** — remove the fabricated *"Draft application"* generator. See **D-055**.
  - **Dependencies** now state both the technical (Phase 1) and scheduled (Phase 3, per D-044) dependency instead of only the first.
  - **Tests-required** marked as a floor, with the DataTable regression test required *before* 4.5 edits the component.
  - **A Definition-of-Done scope note added**, recording that box 2 needs the pager cap fixed, box 3 is not satisfiable for three of five roles without widening a permission RULES §5 forbids, and box 4 was **partially** unowned — the more dangerous case, because the ticked box reads as done while the residue survives.
- **[DECISIONS.md](DECISIONS.md)** — **D-047 through D-055** recorded. Owner-approved: **D-047** teams are not bank-scoped, validate existence only · **D-048** unrestricted Admin/Super Admin assignees pass bank validation · **D-049** timeline shows real audit data to those permitted, an honest state to the rest · **D-050** code generation is one defect across three sites · **D-051** server paging without a misleading table · **D-052** the edit dialog keeps its four fields. Supporting: **D-053** the search contract must not silently regress · **D-054** the audit-lock badge · **D-055** the Draft application artefact.
- **[claude/NEXT_TASK.md](claude/NEXT_TASK.md)** — Wave 0 summary added; the "DO NOT" list corrected from *"4.2, 4.3 or 4.4"* to all of **4.2–4.11**, plus the D-052 field constraint and a prohibition on touching the list page.
- **[claude/SESSION_HANDOFF.md](claude/SESSION_HANDOFF.md)** — the 60-second orientation still told every new session *"There is no email and no file storage anywhere."* Email has been real since Phase 3. Corrected; **the file-storage half is unchanged because it is still true.**

#### Deliberately not done

- **No Phase 4 task was implemented or marked complete**, and Phase 4 is not marked complete.
- **Out-of-scope findings left untouched and unfixed**, as recorded: SEC-007 (P0, Aadhaar hash in responses — Phase 13.4) · SEC-005 (P0, login rate limiting — Phase 13) · SEC-017 (customer PII in `audit_logs.changes`) · BUG-016 / SEC-014 (audit filter precedence, latent) · "Print" (Phase 11.4) · the CSV export mechanism (Phase 11.9) · the `documents?customerId=` parameter that is never read · `doc.uploadedBy` rendering blank · the raw UUID shown instead of `customer.code` · the frozen KYC transition · the employees Role-column defect · the ambiguous bank-delete orphan issue.
- **`frontend/next-env.d.ts` was not edited.** It remains the pre-existing generated artefact that is never committed.
- **BUG-011 stays OPEN**; it closes only when all three generator sites land.

### 2026-09-04 — Task 3.12: the `/reset-password` page — and Phase 3 completes

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** frontend + tests · **not committed**

The redeeming half of Task 3.6. Every reset email has linked here since then and landed on a **404**.

#### It inherits D-045 unchanged, and one detail makes that concrete

Branch on **HTTP status, never on the message**: only a **400** means the link is unusable. The **422** branch is the one that pays for itself — a backend test proves a rejected password **does not consume the token**, so declaring the link dead there would strand a user holding a perfectly good link with an hour left on it.

It is a **separate file** from `/accept-invite`, not a shared component. The two flows are kept apart all the way down — separate tables so a token cannot cross (**D-039**) — and merging their UIs is the one place that separation could quietly erode.

#### Building only the roadmap row would have left box 2 unmet

Phase 3's DoD box 2 is *"A user who forgets their password can recover it **unaided**."* Something has to **send** the link, and `POST /auth/forgot-password` had **zero product callers**. `/login`'s "Forgot password?" was a toast reading *"Contact your administrator to have your password reset"* — true when written, **false since Task 3.6**, and the literal opposite of unaided.

So 3.12 also built `/forgot-password` and turned that control into a link. Bounded deliberately: one new public page, one element changed on `/login`, **no backend change of any kind**. This is the third time in the phase a row was complete while the outcome it served was not — the first two were discovered (**D-044**); repeating it knowingly would have been worse.

#### The enumeration risk lives on the REQUEST page

`/reset-password` handles a token someone already holds. `/forgot-password` takes an **email address**, and the backend's whole defence is 204-for-every-address with enumeration-safe logs. **One careless sentence destroys it**: if the screen said *"we sent a link to that address"*, the absence of that sentence elsewhere is the oracle.

So the confirmation is conditional, never echoes the address back, is **byte-identical** for known / unknown / deactivated addresses — asserted by rendering all of them and comparing — and appears on **204 only**. A backend test walks the same ground from the other side.

**One residual, recorded rather than smoothed over:** the page cannot know whether the provider actually accepted the message, because reporting that would leak existence. The mitigation is in the copy — *"Nothing arrived? Check spam, then ask an administrator to reset your password directly."*

**116 tests** (94 frontend, 22 backend). **19 mutations reversion-proven, all 19 caught**, including restoring the *"contact your administrator"* dead end, which fails 5.

#### ✅ PHASE 3 IS COMPLETE

All twelve rows done, and **all four DoD boxes genuinely satisfied** — including the two blocked by pages no roadmap row owned until D-044 assigned them. Both credential flows now work end to end for a real person, with no administrator involved at any point.

**SEC-005 remains OPEN at P0** and is not resolved by this phase: 3.6's limiter guards 5 routes of 96, per-process, in-memory, fixed-window, with `POST /api/auth/login` still unguarded. Phase 13 owes the general answer.

**Gates:** backend **687/687** (was 665, 25 files), frontend **454/454** (was 360, 20 files), both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0 with all three public routes static.

---

### 2026-09-04 — Task 3.11: the `/accept-invite` page

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** frontend + tests · **not committed**

A public route beside `/login`, outside the authenticated `(app)` shell. Every invitation email since Task 3.5 has linked here, and until now it landed on a **404**.

#### The form was the easy half

`acceptInvitation` answers **one identical refusal** for an unknown token, an expired one, a consumed one, and one belonging to a deleted or deactivated employee (**D-038**). Preserving that is obvious. **The non-obvious failure is the opposite one**, and it is what a naive `catch { setStage("refused") }` does: it reports a 500, a dropped connection, a rate-limit, or a rejected *password* as "your invitation is dead". That is a lie, and an expensive one — the user has exactly one working link and has just been told to stop using it.

So the page branches on **HTTP status, never on the message**:

- **400** — the only status that means the invitation is unusable. Renders the backend's own sentence verbatim, and is **terminal**: the form is withdrawn so a dead token is not retried against the rate limit.
- **422** — the password policy. The token is still good, so the form stays open.
- **429** — the Task 3.6 limiter. Not the link's fault.
- **5xx / offline** — a generic retry message that never mentions the invitation.

The split is structural, not incidental: `badRequest(INVALID)` is the only producer of 400 on that route, while Zod and `passwordProblems` both produce 422.

#### Everything else follows from "it creates no session"

The endpoint answers **204** with no body and no `Set-Cookie` — asserted by test. So success **links** to `/login` rather than redirecting into `(app)`, which would land on an unauthenticated shell and bounce back. The spent token is stripped from the address bar with `history.replaceState`, so a dead credential does not linger in history or in the next referrer.

A missing `?token=` is refused **without contacting the server** — there is nothing to check, no token-validation endpoint exists, and inventing one would leak what the single refusal protects. It renders **identically** to a server refusal, asserted by comparing the two rendered outputs.

#### The seam neither side's unit tests could see

The page reads its token with `useSearchParams().get("token")`, which URL-decodes; the backend builds the link with `encodeURIComponent`. Both suites use a raw token and never cross the URL — so a change to the alphabet, the parameter name, the path, or a double-encode would break **every real invitation** while both stayed green. `accept-invite-link.test.ts` creates a real employee, pulls the URL from the console transport, parses it as a browser would, feeds **that** token to the endpoint, and signs in with the password it set.

It also pins the property the page's safety rests on: all five unusable-token cases return **byte-identical status and message**.

**69 tests** (53 frontend, 16 backend). **16 mutations reversion-proven, all 16 caught** — naming "expired" fails **8**, "already used" **8**, echoing the server message from any status **5**, treating every `ApiError` as a dead invitation **4**, blaming a network failure **3**, redirecting into the app **4**, persisting the token **1**, logging it **1**, rendering it **2**, bypassing password validation **3**, allowing duplicate submits **1**, reporting success on failure **11**.

**Phase 3 DoD box 1 is now met end to end.** Box 2 stays open until **Task 3.12** builds `/reset-password`; **Phase 3 remains IN PROGRESS**.

**Gates:** backend **665/665** (was 649, 24 files), frontend **360/360** (was 307, 17 files), both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0 with `/accept-invite` as a static route.

---

### 2026-09-04 — Roadmap decision: `/accept-invite` and `/reset-password` assigned as Tasks 3.11 and 3.12

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** documentation only — **no source, migration or dependency changed** · **not committed**

**A project-owner decision, recorded here rather than made here.**

Tasks 3.5 and 3.6 each shipped a complete, tested backend credential flow and an emailed single-use link. Both roadmap rows named **only the endpoint**, so both were legitimately complete — while the pages their links point at **did not exist**, so every invitation and reset link landed on a **404**. The roadmap then ran straight from 3.10 into Phase 4, leaving the phase's task list exhausted with two of its four Definition-of-Done boxes unreachable by any row on it.

The gap was found by working the phase, and through Tasks 3.7–3.10 it was **carried forward as explicitly unowned** rather than absorbed into an unrelated task. The owner has now assigned it:

- **3.11** — build `/accept-invite` over the existing `POST /api/auth/accept-invite`. Effort **M**.
- **3.12** — build `/reset-password` over the existing `POST /api/auth/reset-password`. Effort **M**.

**Dependency chain: 3.11 → 3.12 → Phase 3 complete → Phase 4.** Task 4.1 moves behind both.

#### What these rows deliberately do NOT change

No backend code, no route, no migration, no schema, no dependency, no authentication behaviour. **D-037** stands — a single-use, time-limited link, and no password is ever emailed; **OPEN-3 stays resolved**. The token security of 3.5 (**D-038**) and 3.6 (**D-039**) is untouched, **BUG-038 remains fixed**, and **SEC-005 remains OPEN at P0** — neither page resolves it.

#### The constraint that makes them harder than they look

Both endpoints answer **one identical refusal** for every unusable token — unknown, expired, consumed, or belonging to a deleted or deactivated account — precisely so a public endpoint cannot become an oracle for which addresses have something pending. **The pages must preserve that.** The four states the rows name are, as far as the user may be told, **two**: it worked, or it did not. A friendlier "this link has expired" would re-introduce in the UI the disclosure the backend was built to avoid.

#### Effort calibrated, not guessed

**M** each, against comparable rows: **2.10** (loading/error on an *existing* page) is **S**; **12.2** (Teams page: list, create, member management, delete) is **M**; **12.1** (Roles page with a permission matrix) is **L**. Each new page is one public route, one form, one endpoint and a small state machine — more than an S-sized change to an existing screen, since it is a new route outside the authenticated `(app)` shell, but well short of a CRUD screen. `app/login/page.tsx` is the existing public-page pattern.

**Phase 3 remains IN PROGRESS and was not marked complete.** Historical entries for Tasks 3.5–3.10 are unchanged — each correctly records the gap as unowned at the time it was written. See **D-044**.

---

### 2026-09-04 — Task 3.10: the last false email promise, removed

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** frontend + tests · **not committed**

The settings page's **Request export** control is gone. Its entire handler was one statement:

```ts
toast.success("Export queued", { description: "You'll get an email when it's ready." });
```

No request, no queue, no job, no file, no `sendEmail`. It promised an asynchronous four-dataset archive **and** an email delivery; the system has neither.

#### Implementation was weighed, not dismissed

A real export mechanism **does** exist — `lib/export.ts`, used in five places, building CSV / JSON / Tally XML in the browser and downloading immediately. So the roadmap's "implement it" branch was live, and it was rejected on repository evidence rather than instinct:

- **Roadmap 11.9 already owns it** — *"Fix exports repo-wide… Either fetch all pages or export server-side."* A four-dataset archive needs a zip dependency or server-side generation, which is exactly that row. Building it in an **S**-sized Phase 3 task would pull Phase 11 work forward.
- **The PRD requires no such feature** and records the absence: *"no server-side export, no scheduled export."*
- **This phase's own preamble** says the other false email promises were *"all removed"*. This was the last of that set.

**Nothing was lost.** Every list page still exports CSV through `DataTable`; the ledger and settlements still export Tally XML. What went was a button that had never done anything.

#### The "last" claim was verified, not trusted

A repository-wide sweep confirms `settings/page.tsx:347` **was** the only false email promise. Every other "emailed"/"sent" string is a test assertion, a comment, or Task 3.9's create-dialog copy, which is gated on the real `sent` outcome.

Two **fake-async** claims remain and were deliberately left, because they promise no email and each already has an owner: `customers/page.tsx:241` *"queued for verification"* on an upload that discards the file (**roadmap 4.4**, by name), and `customers/[id]/page.tsx:185` *"Sent to printer · Profile sheet queued"* (the fake print/PDF family, **Phase 11.4**).

`passwordChangedEmail` and `accountDeactivatedEmail` remain caller-less and untouched — valid unused infrastructure, not false promises. Nothing in the UI claims either is sent.

#### Reversion-tested, and honest about which tool catches what

**6 mutations, all detected.** Restoring the button with its handler fails **6** tests; a dead restored button **5**; the row with a *differently worded* fake **6**; orphaned descriptive copy **2**; the promise moved to another tab **5** (the `Tabs` stub mounts every panel, so nothing hides on an inactive tab).

The sixth — restoring **only** the handler with no button — is caught by **lint, not by the suite**: `@typescript-eslint/no-unused-vars` moves the frontend from **87** findings to **88**. A rendering test cannot observe a function that is never rendered and never called, and claiming otherwise would be the wrong guard for the right problem.

**One self-inflicted lint regression was caught and fixed**: the new test's `Tabs` stub used an anonymous component factory, tripping `react/display-name` and taking the baseline to 88. Named, and back to 87.

**17 frontend tests.** **Phase 3 DoD box 3 — *"No UI text promises an email that is not sent"* — is now genuinely met and test-enforced.**

**Gates:** backend **649/649** unchanged (no backend change), frontend **307/307** (was 290, 16 files), both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

---

### 2026-09-04 — Task 3.9: the on-screen credential hand-over, kept and made explicit

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** frontend + tests · **not committed**

The only roadmap row in the project phrased as a **prohibition** — *"do not remove it"* — protecting something that already existed. So the first job was to establish whether anything needed doing.

#### Verified first: the backend was already right, and was not changed

`POST /api/users` generates a temporary password when the caller supplies none, returns it in the creating response only, keeps nothing but the argon2id hash, sets `mustChangePassword`, and returns it **regardless of the mail outcome**. Nothing is emailed, logged, or readable afterwards. **The `admin.routes.ts` diff for this task is empty**, and inventing one to look busy would have been worse than none.

#### Two things were genuinely missing

**It was not test-protected.** There was **no frontend test for the hand-over at all**, and nothing anywhere asserted it survives a mail outage — the one property the roadmap names. Deleting it, or gating it on the email having succeeded, broke nothing. For a row whose whole content is *"do not remove it"*, that is the wrong kind of green.

**It was not explicit.** The create flow's response type omitted `invitation` entirely, so the outcome was **silently discarded** and a mail outage produced a screen *identical* to a success — *"Hand these details to X so they can sign in"* either way. The administrator could not tell whether a working link was already on its way or whether the password was the only way in. A fallback in mechanism, but not in meaning.

#### The change: frontend only, and small

`invitation.status` is threaded into `HandoverCredential.delivery` and the copy follows it — a link was emailed and this is the spare; or the email failed and this is the only way in; or email is not configured here and nothing was delivered. A reset shows none of it, because a reset sends no email.

**`logged` is grouped with `failed`, not `sent`.** It is the development console transport: the message went to the server log and nothing left the machine (**D-035**). From the employee's side that is indistinguishable from an outage, so calling it delivery would be the false success **D-004** forbids.

**The password is shown for every outcome, unchanged** — that is the preservation requirement, and only the surrounding words vary.

#### Reversion-tested against the prohibition itself

**14 mutations, all 14 caught.** Removing the hand-over fails **6** tests; showing it only on failure **10**; withholding it during an outage **2**; withholding it entirely **35**; persisting the plaintext **3**; logging it **2**; emailing it **2**; exposing the hash through the list **1**; dropping `mustChangePassword` **14**; opening the control to `users.view` **2**.

**Two mutations were malformed and redone.** One injected a duplicate object key — the later key wins, so it was a silent no-op. The other recoloured the `logged` banner without changing its words, which the text assertions correctly ignored; the real mutation gives `logged` the wording of a delivered email, and that fails. Neither green result was accepted.

**53 tests** (30 backend, 23 frontend), where the frontend previously had none for this feature.

**Gates:** backend **649/649** (was 619, 23 files), frontend **290/290** (was 267, 15 files), both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

---

### 2026-09-04 — Task 3.8: resend invitation

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** backend + frontend + tests · **not committed**

`POST /api/users/:id/resend-invitation`, plus a gated button on the employee detail view.

#### The mechanics were free; the decisions were the task

`issueInvitation` already supersedes the outstanding invitation, mints 48 random bytes, stores only the SHA-256 digest, applies the 72-hour TTL and moves `users.invited_at`. The route calls it and adds **nothing** — no second token path, no second expiry constant, no cleanup logic. **D-040 predicted this** in as many words: *"roadmap 3.8 gets correct behaviour for free."*

So the whole task was four judgements, none of which any document specified:

- **`users.reset_password` gates it** — the only candidate that grants nobody a capability they did not already have. A holder can already mint a temporary password for the same target, which is strictly more powerful. `users.create` would have *added* reach to a role with no other power over an existing employee.
- **The hierarchy rule applies.** `assertCanManageRoleLevel`, exactly as `reset-password` does it. **BUG-038 was a route that looked harmless and did `requirePermission(...)` with no target authorization** — the same shape here would let a level-10 bespoke role mail a password-setting link for a Super Admin's account.
- **An already-accepted employee is refused 409.** The email would say *"an account has been created for you"* to someone who has been using it for weeks, and it would amount to a second password-reset path that skips the session revocation and audit row the real one writes.
- **A non-Active employee is refused too** — `acceptInvitation` rejects them, so the link would be dead on arrival (**D-004**). Resending does not reactivate anyone as a side effect.

A **never-invited** employee *can* be invited here: everyone predating Task 3.5 has no invitation at all, so the guard is on acceptance, not on history. The button reads **Send invitation** for them, not "Resend".

#### An adversarial review found three things my own tests missed

Twenty candidate defects were raised by independent reviewers and all twenty were refuted as security findings — but three were right about the tests and the copy:

- **Success was the fallthrough branch.** `failed` and `logged` were handled explicitly and *everything else* — including a missing `invitation.status` — rendered "Invitation resent". "We do not know what happened" is not success (**D-004**). Worse, the test covering it asserted only that no error appeared, so **it passed against the defect**. `sent` is now asserted explicitly and the test pins the half that matters.
- **"Resend invitation" was shown to employees who had never been invited.** Fixed; the label and toast are conditional.
- **The API-key assertion was vacuous** — it ran on the console transport, where no key exists, so it could never fail. It now runs against a configured provider with a stubbed failing `fetch`.

Four limitations were examined and deliberately **not** fixed, each recorded in **D-041**: `invite_accepted_at` only tracks the invitation path (roadmap 3.9 keeps the temporary-password hand-over alive, so narrowing that guard is 3.9's question); supersession is not atomic under true concurrency (3.5's mechanism, and the one-password-per-invitation invariant is still enforced by the atomic CAS in `acceptInvitation`); the open dialog keeps its pre-resend date (fixing it would mean inventing a timestamp the server did not return); and the role's `is_active` is not checked (pre-existing across the whole flow).

#### Audited, and quiet about secrets

`invitation_resent`, written in the same transaction as the reissue — actor, target, action, summary, timestamp. No token, no digest, no URL; asserted. **No rate limit**: SEC-005's limiter guards *public* credential endpoints, and this one is authenticated, permission-gated and hierarchy-bound. The residual provider-quota risk is named rather than hidden.

**105 tests** (72 backend, 33 frontend), including the full lifecycle in one chain — created → expired → resent → old token refused → new token accepted → sign-in → further resend refused → audited. **23 mutations reversion-proven, all 23 caught**: dropping the hierarchy check fails **5**, gating on `users.edit` **2**, allowing an accepted target **3**, silently reactivating **4**, clearing `invite_accepted_at` **1**, freezing `invited_at` **2**, removing supersession **10**, returning the raw token **1**, logging it **1**, leaking the API key **2**, reporting `sent` unconditionally **2**, dropping the audit row **4**.

**Gates:** backend **619/619** (was 547, 22 files), frontend **267/267** (was 234, 14 files), both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

---

### 2026-09-04 — Task 3.7: invitation state on the employee record

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** backend + frontend + migration + tests · **not committed**

Migration `0005` adds `users.invited_at` and `users.invite_accepted_at`, and the employees list gains a **Setup** column and filter reading Accepted / Invited / Not invited.

#### `invited_at` means ISSUED, not delivered

The task is titled *"delivery state"*, which invites the reading *"the email went out"*. That cannot be implemented honestly: `sendEmail` returns `sent` when the **provider accepted** the message, not when it arrived (**D-035**); the development console transport returns `logged` and nothing leaves the machine; and the send happens *after* the create transaction commits, so at the moment the invitation exists there is no outcome to record.

So the column is written where the invitation is issued, regardless of what the mail service later reports. **The consequence is a wording rule with a test behind it**: nothing user-facing says "Emailed", "Sent" or "Delivered" — the column reads **Invited**, and changing that fails a test. A control claiming an outcome the system never achieved is what **D-004** forbids.

#### It is the LATEST issuance, which is what 3.8 needs

The question an administrator asks is *"when did we last invite them?"* — that is what decides whether to chase. The write lives inside `issueInvitation`, so **roadmap 3.8's resend gets correct behaviour for free**: the timestamp moves with a reissue, and a reissue does **not** clear an existing acceptance. Both pinned.

#### Denormalised onto `users`, deliberately

`invitations.created_at` and `consumed_at` hold the same moments, so these columns duplicate them — against this codebase's usual instinct (**D-024**). Three reasons it is still right: the roadmap says *"on the user"* and sizes the task **S**; both are written inside the very transactions that write the invitation rows, so they cannot drift; and they outlive the source, since roadmap 15.9 will eventually purge old token rows and the employee record should not forget it invited someone. See **D-040**.

#### Mutation testing caught a weakness in my own tests

The first draft asserted `toContain("Accepted")` against whole row text, and a fixture named *"Anitha Accepted"* made it pass against the **name** rather than the state cell — so inverting the state precedence went undetected. Fixtures renamed, assertions moved onto the specific cell, and the mutation now fails 3 tests.

**33 tests** (21 backend, 12 frontend). Six mutations reversion-proven: gating on delivery fails **6**, first-not-latest **1**, no acceptance stamp **2**, resend clearing acceptance **1**, an "Emailed" label **1**, inverted precedence **3**.

#### Found, recorded, not fixed

The employees table's **Role** column renders `—` for every row: declared `key: "role"` with no `render`, while the field is `roleName`, so `DataTable` falls back to `row["role"]`. Pre-existing and unrelated; recorded rather than folded into this task.

**Gates:** backend **547/547** (was 526, 21 files), frontend **234/234** (was 222, 13 files), both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

---

### 2026-09-04 — Task 3.6: self-service password reset

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** backend behaviour + migration + tests · **not committed**

`POST /api/auth/forgot-password` and `POST /api/auth/reset-password`. A user who forgets their password can now recover it without an administrator — as far as the backend goes; there is still no page (below).

#### A separate table, and that is the security decision

`password_resets`, migration `0004` — **not** a `purpose` column on `invitations`. Both flows look a token up **by digest alone**, so one shared table would let a reset token be redeemed at `/accept-invite` and an invitation at `/reset-password`: two endpoints with different eligibility rules and different session effects. A discriminator works only while everyone remembers to check it. Separate tables make the confusion impossible by construction, and both shapes needed a migration anyway.

#### One hour, not seventy-two

An invitation gets 72 hours because a new hire may not read their mail until Monday (**D-038**). A reset is different in kind — the person asked seconds ago and is waiting — and the link can **seize an existing account** rather than activate a fresh one. One hour.

#### The endpoint reveals nothing, including in the logs

`forgot-password` answers **204 identically** for a real address, an unknown one, a soft-deleted account, a deactivated one, a disabled role, and a provider outage. No exception escapes that could become a distinguishing signal.

**The logs were the easy half to get wrong.** A line reading *"no account for alice@example.com"* moves the oracle from the response into the log file, where it is just as real for anyone who can read logs. Nothing logs the address, and the not-found path writes the same line as the success path — asserted by a test that mutation-testing confirms (adding an enumerating log line fails it).

#### Everything else follows D-038

48 random bytes stored as SHA-256; the token is looked up **before** any argon2 work so a junk token cannot buy an expensive hash; the password is validated **before** the consume so a typo does not burn the link; the consume is a conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()`. **At most one successful reset per token**, resolved by the database and proven by two simultaneous requests. A new request supersedes any older outstanding link.

On success: all sessions revoked (the roadmap's explicit words — if the reset was prompted by a compromise, leaving the attacker's session alive defeats the point), the lockout cleared (it must not outlive the credential it guarded), `mustChangePassword` cleared, and **no session created** — signing in afterwards is the normal flow.

#### The project's first rate limiter, and it is not the fix

Task 3.6's own wording asks for **rate-limited** tokens, which is stronger than the phase list's *"or implement locally here"*. So there is now a small fixed-window, in-process limiter applied to named routes — `forgot-password` at 5 per 15 minutes (tighter, because it *sends mail* for an anonymous caller and would otherwise be a mail-bomb primitive and a way to drain Resend's 100/day), `reset-password` and `accept-invite` at 10. **`accept-invite` was retro-fitted**: it shipped in 3.5 before the mechanism existed, and leaving one of three public credential endpoints unguarded once it did would have been an oversight rather than a decision.

**It is per-process, in-memory, fixed-window, and covers 5 routes out of 96.** `POST /api/auth/login` — whose argon2 pile-up SEC-005 names first — is still unguarded. **SEC-005 remains OPEN at P0**; Phase 13 owes the general answer. See **D-039**.

#### What is NOT done

**The frontend `/reset-password` page does not exist**, exactly as `/accept-invite` does not. Roadmap 3.6 names only the two endpoints, so the task is complete as defined — but Phase 3's second Definition-of-Done box (*"A user who forgets their password can recover it unaided"*) needs that page. **Two roadmap-less pages now block the phase.**

**43 tests** in `password-reset.test.ts`, plus one added to `invitations.test.ts`. Nine mutations reversion-proven: raw token stored fails **16**, expiry ignored **1**, non-atomic consume **1**, an enumerating log line **1**, no session revocation **1**, no supersede **1**, lockout left in place **1**, limiter removed **3**.

**Gates:** backend **526/526** (was 483, 20 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

---

### 2026-09-04 — Task 3.5: the invitation flow

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** backend behaviour + migration + tests · **not committed**

Creating an employee now issues a single-use, time-limited invitation and emails the setup link. The employee sets their own password through `POST /api/auth/accept-invite`. **No password is emailed** (**D-037**).

#### The three parameters D-037 left open

None was invented silently. **72-hour expiry** — nothing names a duration, and 72 hours means an employee created on a Friday can act on Monday while a link in an old inbox is usually dead. **48 random bytes, base64url, stored as SHA-256** — exactly what `refresh_tokens` already does, using the same helpers. **`${FRONTEND_URL}/accept-invite?token=…`** — `FRONTEND_URL` existed with no consumer, and top-level placement follows `login`, which also sits outside the authenticated group. All three in **D-038**.

#### At most one password establishment per invitation

The guard is a conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now() RETURNING …`. Whoever does not get a row back never writes a password. The database resolves it; nothing depends on application timing, and there is no read-then-write window. **Two simultaneous acceptances are tested for real** and produce exactly one 204 and one 400, with exactly one of the two passwords live.

#### The raw token is never at rest

Only the digest is stored. The plaintext exists in the generated URL and in the accepting request — not in the table, not in a log during acceptance, not in an audit summary, not in an error. Storing it raw fails **19** tests.

#### One refusal, for everything

Unknown token, expired, already consumed, deleted employee, deactivated employee — all produce the same 400 and the same sentence. Distinguishing them would make a public endpoint an oracle for which addresses have pending invitations. Acceptance returns **204 with no body** and creates **no session**; signing in is the normal flow afterwards.

A refusal for a deactivated employee happens *inside* the transaction, so the consume rolls back with it — a temporary deactivation does not silently destroy a live invitation.

#### Creation survives a mail outage

Issuance joins the create transaction, so an invitation cannot outlive a rolled-back user. The **send happens after the commit**: holding a transaction open across a network call is how the employee-code deadlock happened (**D-032**), and the roadmap requires creation to succeed when the provider is down. The response reports `sent` / `logged` / `failed` — the outcome `sendEmail` actually returned, never a claim that mail arrived (**D-004**). The on-screen hand-over stays, deliberately (roadmap 3.9).

#### A Task 3.5 test hardened Task 3.3

`sendEmail`'s "never throws" guarantee covered provider failures but not its own body — a logger that threw escaped into the route and turned employee creation into a **500**. The whole function is now wrapped, so the guarantee is absolute. **D-035**'s claim is unchanged; it is simply now true in every case.

#### SEC-005, handled narrowly and left open

`accept-invite` is unauthenticated and credential-granting — exactly SEC-005's surface. **No general rate limiter was built**, because inventing an application-wide subsystem inside an invitation task is unrequested scope. What was done is narrow: an invalid token is refused after one indexed `SELECT`, **before any argon2 work**, which removes the amplification the finding names. **Residual risk is recorded and SEC-005 stays open at P0**: a caller with a *valid* token can still force repeated hashing, and there is still no per-IP limit anywhere.

#### The first migration since the initial three

`0003_minor_edwin_jarvis.sql`, generated by `drizzle-kit generate` with its journal entry and snapshot — so that workflow is now exercised rather than merely assumed.

#### What is NOT done

**The frontend `/accept-invite` page does not exist.** Roadmap 3.5 names only the table and the endpoint, so the task is complete as defined — but the phase's first Definition-of-Done box ("can set their own password") needs that page, and it is recorded as outstanding rather than glossed over.

**49 tests** in `invitations.test.ts`. Five mutations reversion-proven: raw token stored fails **19**, non-atomic consume fails **1**, expiry ignored fails **1**, hashing after the consume fails **5**, dropping supersede fails **1**.

**Gates:** backend **483/483** (was 434, 19 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

---

### 2026-09-04 — OPEN-3 resolved: credentials are delivered by invitation link

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** decision / documentation only · **not committed**

The project owner has resolved **OPEN-3**, open since the decision log was created:

**Employee credential delivery uses a single-use, time-limited invitation/setup link. There is no emailed temporary password.** The employee sets their own password through the link; no password, temporary or otherwise, is ever sent by email. Recorded as **D-037**.

The register's own reasoning is why: *a password in an inbox is a permanent credential*. Mail is stored, forwarded, backed up and searched, so a credential sent that way keeps working long after the message is forgotten — its lifetime belongs to the mailbox, not the system. A single-use expiring link inverts that.

#### This confirms the existing direction rather than changing it

Roadmap **3.5** already read *"Send a single-use, time-limited link rather than a password in an email"*; the decisions register had simply never been reconciled with it. **The roadmap wording is unchanged** — the decision aligned with it, which is not a reason to edit it.

**D-036's assumption is now a formal decision, and no code changed.** Task 3.4 built `employeeInvitationEmail` for the link model on 3.5's instruction and recorded that explicitly as an assumption, kept cheap to reverse. The assumption matched the decision, so the template and its tests stand exactly as written. D-036 keeps its original wording as the record of what was assumed and why; an addendum marks it confirmed.

#### What was deliberately not decided

No expiry duration, no token format, no acceptance URL. None of those is named by any existing document, and inventing one here would repeat the error D-036 was written to avoid. `employeeInvitationEmail` takes `expiresInHours` as a **required input** precisely so the value is a decision someone makes, not a default someone inherits. All three belong to Task 3.5.

#### SEC-010 remediation 3 is narrowed, not closed

Once 3.5 lands, a new employee's credential arrives expiring by construction and no password is emailed — which removes the *emailed* permanent credential. It does **not** close the item: roadmap **3.9** deliberately keeps the on-screen credential hand-over as the fallback for when email is unavailable, and that temporary password still has no expiry.

#### Nothing was implemented

No table, no migration, no token, no endpoint, no wiring, no dependency, no secret. **Task 3.5 is unblocked and NOT STARTED.**

**No source code changed**, so no gates were re-run. The Task 3.4 baseline stands: backend 434/434, frontend 222/222, both typechecks clean, backend lint clean, frontend lint 87, `next build` passing.

---

### 2026-09-04 — Task 3.4: the four email templates

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** backend + tests · **not committed**

`src/lib/email-templates.ts` — employee invitation, password reset, password changed, account deactivated. Four pure functions, each returning the `EmailMessage` that `sendEmail()` already takes. **Nothing calls them**; the invitation flow is 3.5 and reset is 3.6.

#### The invitation needed a credential model the project has not chosen

**OPEN-3** is still open and unanswered: invitation link *(recommended)* versus emailed temporary password. But roadmap task **3.5** does not hedge — it instructs: *"Send a single-use, time-limited link rather than a password in an email — a password in an inbox is a permanent credential."*

So the invitation is built for the **link** model **on that instruction**, and recorded as an **assumption, not a decision**. **OPEN-3 is untouched and remains open.** This is the roadmap's own words being followed with the gap between the two documents written down, rather than the owner's decision being made by proxy.

It is cheap to reverse on purpose: the template is a pure function with **no callers**, so if OPEN-3 resolves the other way it is one file and its tests. The tests pin *"this message contains no password"* rather than *"the link model is correct"*, so they do not harden the assumption into a contract. **3.5 is the point of no return** — it adds a table, a migration and an endpoint — and the owner should answer OPEN-3 before it lands. See **D-036**.

#### Nothing is invented

The PRD prescribes no email copy, and neither it nor the roadmap names an expiry, a domain or a login URL. So every dynamic value is a **typed input**: `expiresInHours` is required and a missing one throws, rather than hardcoding "24 hours" the product has not agreed. `FRONTEND_URL` exists in `env.ts` with **no consumer**, and building the URL stays the caller's job — a test asserts no template emits a domain it was not handed.

The two notification templates carry **no link at all** and tell the reader to contact an administrator, because there is no self-service recovery path in this product. Inventing a "secure your account" URL would promise something that does not exist (**D-004**).

#### Untrusted input cannot become markup

An employee's name reaches all four messages, so names are HTML-escaped — asserted against a hostile name in every template. Links are refused unless `http(s)`: a `javascript:` or `data:` href in a credential email is a phishing primitive aimed at precisely the message a recipient has been told to trust. No token appears in any subject, because subjects surface on lock screens and in more logs than bodies do.

The plain-text part stands alone — the link is readable as text, not only clickable — since that is the part that survives a broken client.

#### Architecture

`lib/`, not `services/`: the repository already splits pure modules (errors, password, permissions, tokens, zod) from those that reach a database or a provider. A test asserts the module imports no database, no provider and no environment. No template-engine dependency — the second one this phase has declined, after **D-035** declined the Resend SDK.

**29 tests** in `email-templates.test.ts`, no network and no database. Five mutations reversion-proven: removing HTML escaping fails **4**, removing the URL protocol guard fails **2**, removing required-field checks fails **2**, putting the token in the subject fails **1**, removing the expiry check fails **1**.

**Gates:** backend **434/434** (was 405, 18 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

---

### 2026-09-04 — Task 3.3: the email service

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** backend service + tests · **not committed**

`src/services/email.ts` exists and can send. **No product email is sent** — nothing calls it. Templates are 3.4, the invitation flow 3.5, password reset 3.6.

#### A mail outage must never fail user creation

The roadmap's clause, and the design follows from it: **`sendEmail` never throws.** `POST /api/users` already does real work in a transaction and, since Task 2.11, assigns the employee code inside the request. A Resend outage must not stop the business creating employees — a third party taking down a core workflow is worse than no email at all.

Because the promise cannot reject, `void sendEmail(...)` in a request path is safe: there is no unhandled rejection to leak. A test asserts precisely that, by ignoring a call whose provider throws.

**But failure is reported, not swallowed.** The outcome is a discriminated union — `sent` / `logged` / `failed` — so an outage can never be mistaken for delivery (**D-004**). "Non-blocking" must not quietly become "pretend it worked". `sent` means *accepted by the provider*, not *delivered*; nothing here can know whether it reached an inbox.

#### No SDK

The backend has **no HTTP-client dependency and makes no outbound request anywhere else**. Resend's send is one POST to one endpoint and Node has global `fetch`, so the SDK would have been the repository's first HTTP dependency — added on the path that carries the API key — for about twenty lines. **No dependency was added**, which also makes the frontend-bundling question moot: there is no `resend` in either `package.json` and no reference to it anywhere under `frontend/`.

#### Retries stop where they stop helping

Three attempts, 200 ms then 400 ms, on transport errors, **429** and **5xx**. A **4xx returns immediately** — a rejected address or a bad key is rejected identically forever, so retrying only adds latency to a request path. The bound also caps what the free tier's 100/day cap costs when it becomes a 429.

#### The API key leak its own test caught

Both failure paths echo text this module did not write — a provider response body, or a transport error's message — into a reason the caller sees and logs. Neither *should* ever contain the key, but "should" is not a control, and a test that fed a key-bearing response through the service proved it. The key is now stripped from any reason before it leaves the module, so the guarantee is structural rather than a bet on what Resend and undici put in their strings.

Beyond that: the key goes into the `Authorization` header and nowhere else — not the request body, not a log line, not an outcome. Four tests hold that line.

#### The console transport is honest

In development with no configuration it logs recipient, subject and **the full body** — deliberately, because reading an invitation link out of the terminal is the entire reason it exists — marked `delivered: false`, and returns `logged`, never `sent`. It issues no provider request at all. Production cannot reach it: `loadEnv` refuses to boot unconfigured (**D-034**), and the path is still guarded, returning `failed` rather than logging a credential email and calling it sent.

#### Provider containment

Resend appears in exactly **two** source files: the `EMAIL_PROVIDER` enum in `config/env.ts` and this service. Swapping providers is a change in those two places.

**32 tests** in `email-service.test.ts` — no network, no database, no real key, the `fetch` boundary injected.

**Gates:** backend **405/405** (was 373, 17 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

**OPEN-3 is untouched** and still gates 3.5.

---

### 2026-09-04 — Task 3.2: email configuration, validated at boot

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** backend configuration + tests · **not committed**

Four keys — `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` — validated through the existing `env.ts` schema. **Configuration only.** No SDK, no `services/email.ts`, no template, no route, nothing sent. That is roadmap 3.3 onward.

#### Required in production, optional in development

Optional in the schema, required by the production block — the same split `AADHAAR_PEPPER` and the JWT-secrets-differ rule already use, so no second validation mechanism was introduced. A developer with no mail credentials still boots and can still create an employee.

Production refuses to start without all four. That matters because the fallback is silent by nature: a production deploy missing its configuration would accept an invitation, write it to stdout and report success — a control claiming an outcome it never achieved (**D-004**). It is the same shape as **SEC-028**'s `NODE_ENV` fix.

#### The provider is an allowlist of one

`z.enum(["resend"])`, per **D-033**. Free text would let `EMAIL_PROVIDER=sendgrid` boot a production deploy whose mail can never be delivered, because nothing implements SendGrid. A typo should be a boot failure, not a silent no-op. The enum widens when a second provider genuinely exists, not to look extensible.

#### `EMAIL_FROM` is deliberately not `z.email()`

The display-name form — `Rise Next <no-reply@risenext.in>` — is what a real From header usually is, and Resend accepts it. A bare `z.email()` would reject it and **stop a correct production deployment from booting**: a false positive, which is exactly what the `NODE_ENV` note in this file warns against. A small regex accepts both forms and both are tested.

#### Console transport

`emailTransport()` resolves `"resend"` or `"console"` from the configuration and does nothing else — the mode lives beside the configuration so Task 3.2 does not grow into a service. Production cannot return `"console"`, because it would have refused to boot. On startup with an incomplete configuration, `server.ts` logs a `warn` naming the missing keys, so the fallback is observable rather than something to discover later.

#### The API key never leaves the configuration

No error interpolates a value; the production failure names **key names only**. Four tests assert the key is absent from every error this file can raise, from the missing-key report the boot log uses, and from anything `NEXT_PUBLIC_`. `.env.example` and `.env.example` both ship `EMAIL_API_KEY` **empty** rather than with a realistic-looking placeholder, so a copied `.env` cannot look configured when it is not. No real key is in this repository.

#### One existing fixture updated, no assertion changed

`cookie-config.test.ts`'s `PROD_ENV` is documented as *"a complete, valid production environment"*, and after this task a complete one includes email — so `loadEnv` rightly rejected it. The four keys were added to the fixture. **No assertion changed** and all 17 of its cases still pass. Weakening the production requirement to keep the old fixture green would have been the wrong repair.

#### Proven in both directions

**22 tests** in `email-config.test.ts`, no database, following `cookie-config.test.ts`. Five mutations reversion-proven: dropping the production requirement fails **5**, free-text provider fails **3**, dropping address validation fails **2**, hardcoding the transport fails **3**, interpolating the API key into the error fails **1**.

**Gates:** backend **373/373** (was 351, 16 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

**OPEN-3 is untouched** — invitation link vs emailed temporary password is about what is *sent*, not who is configured to send it. It still gates 3.5.

---

### 2026-09-04 — Task 3.1: Resend chosen as the email provider

**Phase:** 3 (Credential delivery, invitation and email) · **Type:** decision / documentation only · **not committed**

Task 3.1 is a decision task — *"Choose a provider and record the decision in DECISIONS.md"* — and it was blocked on **OPEN-1**, which had no owner. The project owner has chosen **Resend**, starting on the **free tier** (3,000 emails/month, 100/day as stated), upgrading within the same provider when volume requires it. Recorded as **D-033**.

The reasoning, as given: a developer-oriented transactional platform rather than a marketing suite; a Node SDK and plain HTTP API that fit the existing Express backend with no new infrastructure; a free tier suited to one CRM sending invitations and password mail; and an upgrade path that is a plan change rather than a migration.

**Nothing was implemented.** No SDK installed, no `services/email.ts`, no configuration key, no environment variable, no route, no migration, no frontend change — and **no secret**. Task 3.1's whole deliverable is the record. Tasks **3.2** (config keys) and **3.3** (the provider-agnostic service) do the work, and 3.3 is where the abstraction that keeps Resend replaceable gets built; creating it now would have prejudged an interface with no caller.

**OPEN-3 is still open**, and this decision does not touch it: whether to email a single-use invitation link or a temporary password is a question about what is *sent*, not who sends it. It gates **3.5**, not 3.2–3.4. The document's recommendation remains the link, on the stated grounds that a password in an inbox is a permanent credential.

**Still accurate after this entry:** `CURRENT_STATE.md` reports **0** email providers integrated and `FEATURE_STATUS.md` grades Email **G — does not exist**. A decision is not an integration, and neither line moves until 3.2/3.3 land.

**No source code changed**, so no gates were re-run. Phase 2's committed baseline stands: backend 351/351, frontend 222/222, both typechecks clean, backend lint clean, frontend lint 87, `next build` passing.

---

### 2026-09-03 — Task 2.11: employee codes are assigned by the server, and Phase 2 closes

**Phase:** 2 (Real employee management) · **Type:** backend behaviour + frontend + tests · **not committed**

#### What was actually wrong — the roadmap's premise was half incorrect

Task 2.11 asked for a server-generated employee code *"and fix the underlying `count(*)`-based generator, which collides after any permanent-delete."*

There was **no server-side employee-code generator at all.** `employeeCode` was a **required** field on `POST /api/users`, inserted verbatim from the request. The only thing producing one was `suggestEmployeeCode()` in the browser, scanning the at-most-200 rows the employees page had loaded — so two administrators with the dialog open got the same suggestion, and past 200 employees it derived from an arbitrary subset. It also produced `EMP-1001`, unpadded from 1000, which never matched the `EMP-0001` format the seed and `DATA_MODEL.md:347` document.

The `count(*)` generators that exist are for customers and the nine factory routers, and are tracked as **[BUG-011](BUGS_AND_ISSUES.md#bug-011)** (HIGH, open) — whose Feature line names *"loans, bank orders, disbursements, settlements, transactions, ledger entries, customers"*. **Users are not among them.** BUG-011 was **not** fixed here; it is a different bug about seven other resources. The roadmap row now carries the correction, per `docs/README.md:88`.

#### The generator

`employeeCode` is now optional on create. Omit it and the server assigns the next code from the **maximum suffix ever issued**, read from two places because neither alone survives the lifecycle:

- **`users`, with no `deleted_at` filter.** The unique index is partial, so a soft delete *releases* the code — intended, per `PRD.md:1073`. Releasing is not re-issuing: the generator steps past a soft-deleted employee's number so it cannot be handed to someone else while the original is still restorable.
- **`recycle_bin_entries` snapshots for purged employees.** A permanent delete removes the `users` row entirely; the retained bin entry is the only remaining record that the number was used. Task 2.9 kept `employeeCode` in that snapshot (only `passwordHash` is redacted), which is what makes this possible.

Format unchanged — `EMP-` plus four zero-padded digits, widening rather than wrapping. Explicit codes are still honoured and still refused by the same 409 when duplicated; a generated code is always numerically above every `EMP-` code in use, so it cannot walk into one.

#### Concurrency, stated plainly

Generation is check-then-insert. Two simultaneous creates can read the same maximum, and the loser gets the 409 that `users_employee_code_unique` already produces. That is the established pattern at every write site here (**BUG-037**) and the brief asked to preserve it rather than add locking — so it is documented in the code and asserted in a test, not papered over.

#### A deadlock found while building it

The first cut called the generator **inside** `db.transaction(...)` while reading through the base handle. On a single-connection driver that deadlocks — the read waits for the transaction that is waiting for the read — and every test in the new suite timed out at 60 s. Moving the read to **before** the transaction fixed it and shortened the write transaction. Suite runtime went from >300 s to 5.4 s.

#### Proven against the failure mode

**15 backend tests** in `employee-code.test.ts`, driving real HTTP. The centrepiece walks the whole lifecycle: create with a generated code → confirm it → delete → purge the bin record → confirm the row is gone → create again → assert the code is not reused. Reverting the generator to `count(*)` fails **3** tests, that one included.

True concurrency is **not** tested, and the test says why: PGlite is a single in-process connection, so four concurrent creates serialise rather than race. The interleaving is modelled deterministically instead.

#### Frontend

`suggestEmployeeCode()` deleted. The code field is optional, placeholdered *"Assigned automatically"*, and explains that typing one keeps an existing scheme.

**Gates:** backend **351/351** (was 336, 15 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

#### Phase 2 is complete

2.1–2.11 all done. Every box in the phase's Definition of Done is now satisfiable end to end: an employee can be created, edited, scoped, assigned to a team, deactivated, deleted and restored entirely from the UI; the lockout guards hold; a temporary password grants nothing but a password change; and every mutating control on the screen is proven to issue a request.

---

### 2026-09-03 — Task 2.10: the employees page stops reporting failures as emptiness

**Phase:** 2 (Real employee management) · **Type:** frontend behaviour + tests · **not committed**

Two defects on one screen, both of which made the product lie quietly.

#### A failed load looked like an empty database

`useResource` returns `loading` and `error`. The employees page took **neither** — it destructured only `data` and `refresh`. (The roadmap says they were "destructured and discarded"; they were not even destructured. Same outcome.) Because the hook also clears `data` when a request rejects, a failed fetch fell straight through to the table's "no employees" empty state: the page told the administrator there were no employees when in fact the request had failed.

Now there are **three** states where there was one. A skeleton while the first load is in flight; an error banner carrying the server's message with a **Try again** that calls `refresh`; and the existing empty state, reserved for a list that is genuinely empty. On failure the table is suppressed entirely — an empty grid beside an error banner still invites the reader to conclude there is no data. A background refresh keeps the current rows on screen rather than blanking them.

#### The server named the field and the form threw it away

Validation failures return **422** with `details: { path, message }[]`, `path` dot-joined (`error-handler.ts:46-55`). The dialogs showed only the generic top line, so a bad email produced "The submitted data is not valid" with no indication of which field.

Server messages now appear under the control they name, in both the create and edit dialogs. This is the frontend's **first** consumer of `error.details` — nothing read the field before — so the convention is extracted into `lib/field-errors.ts` for the forms that will follow.

#### Read the contract, do not assume it

`details` is **not** uniformly an array. A 23505 unique violation puts `{ constraint }` — an object — in the same field, and an `AppError` can carry anything. Code that reaches for `details.map(...)` on the wrong branch throws inside a `catch`, replacing a useful server message with a blank dialog.

So the helper discriminates on the payload's **shape**, never on the status or code. Anything that is not an array of `{path, message}` yields no field errors and the existing top-line message stands — which is what keeps the verbatim 400/403/409 surfacing from Tasks 2.4–2.9 intact. A test uses the real `{ constraint }` payload.

Two further rules, both easy to get silently wrong: `bankIds.0` attaches to the `bankIds` control, because the element index is not something a user can act on; and an issue naming a field the form does not render is **appended to the dialog line, never dropped** — otherwise a 422 about `avatarColor` would leave strictly less information than before this task. See **D-031**.

#### What was deliberately not changed

`useResource` still clears `data` on rejection. Fixing that in the hook would alter every page that uses it, so the page compensates locally — the smallest change that fixes the reported defect. Client-side validation is untouched: `validateEmployeeForm` still refuses an address with no `@` before any request, and a test pins it. Server details complement that check rather than replacing it with something weaker.

#### Proven in both directions

**38 frontend tests** — 16 on the helper against the real payload shapes, 22 driving the page. Six mutations reversion-proven: discarding the load state fails **5**, removing the error banner fails **3**, dropping create field mapping fails **4**, dropping edit field mapping fails **1**, dropping unmapped issues fails **3**, and treating `details` as always-an-array fails **4**.

**Gates:** frontend **222/222** (was 184, 12 files), backend **336/336 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

---

### 2026-09-03 — Task 2.9: deleted employees go to the recycle bin and can be restored

**Phase:** 2 (Real employee management) · **Type:** backend behaviour + tests · **not committed**

`DELETE /api/users/:id` soft-deleted by hand — a direct `UPDATE` stamping `deleted_at`, `deleted_by` and `status` — and wrote **no recycle-bin entry**, because `user` was absent from `BIN_REGISTRY`. A deleted employee was unrecoverable through any endpoint, and Task 2.8's confirmation dialog said exactly that.

#### What changed

`user` is now the registry's **13th** type, and the route calls `softDelete`. The full round trip works: **active → DELETE → recycle bin → restored**.

Two declarative additions the other twelve types never needed:

- **`redact: ["passwordHash"]`** — the snapshot is a full row copy, and bin entries **outlive the rows they describe** (a purge keeps the entry and only stamps `purged_at`). An unredacted user snapshot would park a live argon2 credential in a second table indefinitely. The field name matches the audit log's own `REDACTED_FIELDS` vocabulary. The list route already withheld `snapshot` from responses; this fixes the *storage*.
- **`deleteFields: { status: "Inactive" }`** — the hand-rolled delete deactivated the account as well as hiding it. `softDelete` writes only the delete stamps, so moving to it would have dropped that silently — and because `restore()` does not touch `status`, a restored employee would then have come back **able to sign in**. Declaring it keeps the old behaviour and makes restore safe by construction.

`bankIdOf` returns `null`, following `service_provider`: a user belongs to many banks or none, so there is no single bank to stamp.

#### The hole this task would otherwise have opened

`recycle_bin.restore` is seeded to **`manager`** as well as `admin`, and the bin routes gated only on that permission plus bank access. That was sufficient while every binned record was a business row. Putting *people* in the bin meant a Manager could **restore a Super Admin** they could never have deleted — BUG-038's hole arriving through a different door, created by this task rather than inherited.

`assertCanActOnBinnedUser` now applies the role hierarchy to user entries on both restore and permanent-delete. It keys on the **record type**, never a role name, and leaves the other twelve types untouched. See **D-030**.

#### Guards preserved

The self-delete **400**, the hierarchy **403** and the last-active-Super-Admin **409** still run *before* any write — `softDelete` knows nothing about them and must not be trusted to enforce them. Each is asserted to leave **no** bin entry behind. The route still answers **204**.

#### Relationships

`team_members` and `user_bank_access` rows survive the delete and are therefore still correct after a restore — nothing rebuilds them because nothing removed them. That is the existing recycle-bin semantics, and it composes with **D-027**, which already made the team route tolerate rows pointing at deleted users.

#### Task 2.8's copy was inverted, not patched over

The confirmation said the deletion could not be undone. That was true when it was written and is now false, so it was rewritten to describe the bin and to warn that a restored employee comes back **deactivated**. Group D of `employees-delete.test.tsx` was inverted with it, and the backend test asserting **zero** bin entries now asserts **one**. That test existed precisely to fail here — and it did, on the first run after the registry change.

#### Proven in both directions

**23 backend tests** in `user-recycle-bin.test.ts` driving the real HTTP routes, plus the updated lifecycle group. Five mutations reversion-proven: dropping `redact` fails **1**, dropping `deleteFields` fails **3**, dropping the restore guard fails **1**, dropping the purge guard fails **1**, reverting to the hand-rolled delete fails **17**.

One test initially passed for the wrong reason — `manager` does not hold `recycle_bin.permanent_delete`, so `requirePermission` refused before the guard could run — and was rewritten to use a bespoke role that actually reaches it.

**Gates:** backend **336/336** (was 313, 14 files), frontend **184/184**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

#### Nothing else touched

BUG-038's union authorization, Task 2.6's bank access, Task 2.7's whole-roster team replacement and Task 2.8's confirmation step are all intact, and their suites pass.

---

### 2026-09-03 — Task 2.8: employees can be deleted from the product, honestly

**Phase:** 2 (Real employee management) · **Type:** frontend behaviour + tests · **not committed**

`DELETE /api/users/:id` has carried both its guards since the first commit — a self-delete refusal (400) and the last-active-Super-Admin invariant (409, shared with PATCH since Task 2.1) — and had **zero callers**. An employee who had left could be deactivated but never removed.

#### What was wired

A **Delete** button on the employee detail view, gated on `can("users.delete")` — a **fourth** distinct permission on that screen — opening a confirmation that issues nothing until it is accepted. No backend behaviour was changed.

#### The confirmation had to be true

The roadmap asks for *"clear messaging that it is a soft delete"*. The honest version of that message is not the phrase "soft delete": `user` is **absent from `BIN_REGISTRY`**, so the route writes **no recycle-bin entry** and nothing in the product can reverse the deletion. Roadmap **2.9** adds that and was **not** pulled forward — it is a separate, larger, backend-changing task.

So the dialog says what is true: **this cannot be undone from the product**, deleted employees do not go to the recycle bin, there is no restore screen, and recovery would take a database restore. It also points at **Revoke access** as the reversible alternative, because reaching for Delete when Revoke was meant is the likeliest mistake the screen enables (**D-029**, **D-004**).

That claim is about the backend, so the backend asserts it too: a new test proves deleting an employee writes **zero** `recycle_bin_entries` rows. When 2.9 lands that test fails **on purpose**, which is the signal that the copy has become a lie and must be rewritten with it.

#### 204 means there is nothing to adopt

Unlike Tasks 2.6 and 2.7, where the route echoes what it stored, this one answers **204** with no body. Success re-reads the list and reference data and clears the selection, because the detail dialog would otherwise be showing a record that no longer exists.

#### The server stays the authority

400 (own account), 409 (last active Super Admin) and 403 (target at or above the actor's role level) are surfaced **verbatim**, with the confirmation left open and retryable. A refusal refreshes nothing and shows no success.

#### Measured, not assumed

A deleted employee's login returns **401**, not the **403** a *revoked* employee gets — the login lookup filters `deletedAt IS NULL`, so a deleted account is indistinguishable from one that never existed. That leaks nothing and is the better answer; it is now asserted so the difference between revoke and delete stays deliberate. The first draft of that test asserted 403 and was wrong.

#### Proven in both directions

**23 frontend tests** driving the real page — real row click, real Delete, real confirmation, real request — plus **6 backend cases** covering 204, the soft-delete row state, the 401, list exclusion, the second-delete 404 and the empty recycle bin. Five mutations reversion-proven: deleting on first click fails **5**, gating on `users.edit` fails **2**, replacing the copy with a restorability promise fails **2**, reporting success on a refusal fails **4**, skipping the refresh fails **1**.

**Gates:** frontend **183/183** (was 160), backend **313/313** (was 307), both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

#### Nothing else touched

BUG-038's union authorization, Task 2.6's bank access and Task 2.7's whole-roster team replacement are unchanged, and their suites pass untouched.

---

### 2026-09-03 — Task 2.7: employee team membership is manageable from the product

**Phase:** 2 (Real employee management) · **Type:** frontend behaviour + tests · **not committed**

`PUT /api/teams/:id/members` had **zero frontend callers** for the repository's whole life. Team membership could be set when an employee was created and never changed again — and since Task 2.5, `PATCH /api/users/:id` refuses `teamId` with a 422 pointing at this route, so no workaround remained.

#### What was wired

A **Team** dialog on the employee detail view: a picker over `useReference().teams` plus "No team", seeded from the employee's current team, saving through `PUT /api/teams/:id/members`.

No backend file was touched. No new endpoint, and `teamId` was **not** added back to `PATCH` (D-025).

#### The whole-roster problem, which is the actual task

The route is **team-shaped**; the screen is **employee-shaped**. It replaces a team's entire roster, while the screen knows about one person. Two things follow, and both are the substance of the work rather than details of it:

**The rosters are re-read from the server before writing.** `useReference()` loads teams at sign-in and refreshes only on demand, so a roster built from it can be minutes stale — and submitting a stale roster **silently evicts** whoever another administrator added in the meantime, with a 200 and no warning. A test seeds a member into the server's answer that is absent from cached reference data and asserts it survives the write.

**Every other member is resubmitted unchanged.** `{ userIds: [employeeId] }` returns 200 and empties the team. A test asserts no request body ever equals `[employeeId]`; a backend test demonstrates the eviction that would follow if one did.

**A move is two requests, removal first.** One team's roster cannot express membership of another. They cannot be atomic across two endpoints, so the order was chosen by which failure is less harmful: removal-first leaves the employee on **no** team, which is visible and recoverable; add-first leaves them on **two**, which `teamOf()` hides by reporting only the first match. A half-completed move says exactly that — *"removed from Alpha Team but not added to the new team, so they are currently on no team"* — and refreshes so the screen shows the truth (**D-004**).

#### Gated on `teams.assign`

A **third** distinct permission on this screen, after `users.edit` and `users.assign`. The route requires it, so anything else would show a button that always 403s. No role names appear in the frontend — a test asserts the control is absent for a holder of `users.edit` + `users.assign` without `teams.assign`, even though the mocked actor is a Super Admin.

#### The server stays the authority

Success is decided by the `userIds` the route echoes back, not by the array sent: a test makes the server answer without the employee and asserts no success toast. 403s and 400s are surfaced verbatim with the dialog left open — including the 403 that the BUG-038 union check raises over a member the UI resubmitted without altering, which a backend test pins.

#### Proven in both directions

**30 frontend tests** driving the real page — real row click, real Team button, real picker, real Save — asserting the actual request bodies. **5 backend integration cases** pin the move sequence over HTTP. Six mutations reversion-proven: sending a bare `[employeeId]` on the add fails **5**, on the remove fails **4**, building rosters from cached reference data fails **4**, dropping the no-change guard fails **1**, dropping the response check fails **1**, gating on `users.assign` fails **2**.

**Gates:** frontend **160/160** (was 130), backend **307/307** (was 302), both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

#### BUG-038 untouched

`assertCanManageRoleLevel` over `previous ∪ submitted` (**D-027**) still runs on every request this screen sends. No authorization was relaxed, duplicated or recreated in React.

---

### 2026-09-03 — BUG-038 / SEC-029: team membership is authorized per member

**Phase:** 2 (Real employee management) · **Type:** backend security fix + tests · **not committed**

`PUT /api/teams/:id/members` applied **one** check — `requirePermission(teams.assign)` — and then replaced the whole roster. The role hierarchy that the rest of the codebase enforces through a single helper was consulted **nowhere** on this path. `ROLES_AND_PERMISSIONS.md` §4.2 listed nine routes that call it and this route was absent; the gap in the document was an accurate reflection of the gap in the code.

Found by measurement during Task 2.5, carried as **BUG-038 (HIGH)**, and fixed as its own task **before** roadmap 2.7 wires the route to the UI. Also registered as **[SEC-029](SECURITY_AUDIT.md#sec-029)** — the first finding in that register the security audit itself did not find, because a static review looks for bad patterns and this defect is an *absence*.

#### Measured before and after

Seeded `manager` (level 20, holds `teams.assign` by seed):

| Request | Before | After |
|---|---|---|
| Add a Super Admin | **200, placed** — while `PATCH /api/users/<same person>` returned **403** | **403** |
| Add an Admin / a peer Manager | **200, placed** | **403** |
| Roster `[super-admin, exec]`, submit `[exec]` | **200 — Super Admin evicted, never named in the request** | **403**, victim still on the roster |
| Audit row for that eviction | `changes: null` — who was removed was unrecoverable | `changes: { members: { from, to } }` |
| Non-existent `userId` | **409** *"still referenced by other records"* | **400** *"One or more users do not exist"* |
| Soft-deleted user | **200, row written** | **400** |
| Executive / Team Leader; Super Admin adds an Admin; roster cleared; Inactive user; employee scoped to another bank | 200 | **200 — all unchanged** |

#### The decision that mattered: `previous ∪ submitted`

Authorization covers the **union of the old and new rosters**, not the submitted list. Row three above is why. Every id in that request is one the Manager may legitimately manage; the victim is identified only by their **absence**. The obvious fix — loop over `userIds` — returns 200 there and evicts the Super Admin anyway.

Recorded as **D-027**, with the rejected alternative: authorizing only the symmetric difference (added ∪ removed) is *sufficient* for security and less restrictive, but the union is a smaller invariant that fails closed. Its cost is real and is tested rather than hidden — a Manager cannot edit a roster containing a Super Admin **even to leave them in place**.

#### Deliberately not done

**No bank scoping.** `claude/PROJECT_CONTEXT.md:71` records teams as *"Not bank-scoped"* and neither `teams` nor `team_members` carries a bank column, so a scope check would have been new policy under cover of a bug fix. A test asserts a Manager scoped to bank A can still roster an employee scoped to bank B — **200**.

No roster-semantics change, no new endpoint, no migration, no response change, no `error-handler.ts` change (**D-021**), and no row lock — **BUG-037** stays deferred. `assertCanManageRoleLevel` is **byte-identical**; `authorization.test.ts` (26 tests) passes unchanged, and there are still zero role-name string comparisons in authorization code.

#### One deviation from the original write-up

The BUG-038 entry proposed resolving each member through `targetUserRole`. Instead: one batched read, and a bad id returns **400**, not that helper's 404 — `PRD.md:1267` reserves 404 for path-id lookups and `PRD.md:257` already sets the 400 precedent for a bad id in a payload; here the team in the path *was* found. Existence is enforced on **submitted** ids only, because soft-deleting a user leaves their `team_members` rows behind and checking prior members too would make any team containing a departed employee permanently unmanageable.

#### What adversarial review cost it

**Two regressions the fix itself introduced, caught by adversarial review and fixed before it landed.** Both were reproduced over real HTTP before being believed, and both now have their own tests:

1. **An actor who was on the team could no longer edit that team's roster** — not even to remove themselves. Their own row entered `previous`, so the union check ran `assertCanManageRoleLevel` against their own level, and "strictly greater" means nobody outranks themselves. Measured **403** for keep-self, remove-self and add-self alike. Reachable through normal use: `POST /api/users` places a new employee on a team at creation. The actor is now excluded from the hierarchy loop **by identity, not by level** — `team_members` is never consulted by any authorization decision (`services/access.ts` does not mention teams at all), so joining or leaving a team grants and removes nothing. A test asserts a *peer* at the same level is still refused, so the exclusion cannot be widened into a level check.
2. **An uppercase uuid for a live user was rejected 400 "One or more users do not exist"** — the same class of untruth the fix was written to remove. Postgres emits uuids lower-cased and `z.uuid()` accepts any case without normalising, so the raw request id never matched the id read back. Submitted ids are now canonicalised once at the boundary, which also makes case variants of one id dedupe correctly instead of violating the `(team_id, user_id)` primary key.

#### Proven in both directions

**43 tests** in `src/tests/team-membership.test.ts`, every refusal asserting the roster in the database **and** that no audit row was written. Six reversion mutations, each failing exactly what it should: narrowing the affected set to `submitted` fails **3** (all evictions), removing the hierarchy loop fails **10**, removing the existence check fails **3**, dropping the audit `changes` fails **3**, removing the self-exclusion fails **3**, dropping the id canonicalisation fails **3**.

**Gates:** backend **302/302** across 13 files (was 259/12), frontend **130/130 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

#### Files

`src/modules/admin.routes.ts` (the handler), `src/tests/team-membership.test.ts` (new). Documentation: `BUGS_AND_ISSUES.md`, `SECURITY_AUDIT.md`, `DECISIONS.md`, `ROLES_AND_PERMISSIONS.md`, `PRODUCTION_READINESS.md`, `PRODUCTION_ROADMAP.md`, `FEATURE_STATUS.md`, `CURRENT_STATE.md`, `claude/CURRENT_PROGRESS.md`, `claude/NEXT_TASK.md`, this file.

**Task 2.7 is unblocked**, scope unchanged.

---

### 2026-09-03 — Task 2.6: employee bank access is editable from the product

**Phase:** 2 (Real employee management) · **Type:** frontend behaviour + tests · **not committed**

`PUT /api/users/:id/banks` has existed since the first commit — transactional, audited, guarded by `assertCanManageRoleLevel` on the target and `assertBankAccess` per granted bank — and had **zero callers**. Bank access could be set when an employee was created and never changed again from the product. Task 2.5 closed the only workaround by making `PATCH` refuse `bankIds` with a 422 that names this route.

#### What was wired

A **Bank access** dialog on the employee detail view: a checkbox list over `useReference().banks`, seeded from the row's `assignedBanks`, saving through `api.replace(\`/users/${id}/banks\`, { bankIds })`.

No backend file was touched. No new endpoint, no duplicate assignment logic, and `bankIds` was **not** added back to `PATCH` — assignment is its own operation against the route that owns it (**D-025**).

#### Gated on `users.assign`, not `users.edit`

The route requires `PERMISSIONS.users.assign`. That is a **different permission** from the `users.edit` that gates the Task 2.4 edit dialog, so the control has its own gate — a holder of only `users.edit` would otherwise see a button that always 403s. Tested in both directions: with `users.edit` alone the button is absent while Edit and Revoke remain; with `users.assign` alone it is present while they are absent. Pointing the gate at `users.edit` fails 4 tests.

The gate is UI convenience only. Every refusal is the server's — 403 for a bank outside the actor's scope or a target at or above their role level, 400 for a bank that does not exist — and is surfaced **verbatim**, with the dialog left open.

#### The UI adopts the server's answer

On success the dialog takes `result.data.bankIds` — the list the route confirms it wrote — rather than the array it sent, and also calls `refresh()`. A test makes the server answer with a *different* set from the one submitted and asserts the UI follows the server. Trusting the sent list instead fails that test.

#### Whole-list replace, many-to-many

The route replaces the entire grant set in one transaction, so the request carries the complete desired list, not a delta — asserted for adding, removing, selecting several, and clearing. An empty selection is permitted and sends `{ bankIds: [] }`, with the consequence spelled out on screen first: *"With no banks assigned this employee can still sign in, but their workspace will be empty."*

#### Known limitation, recorded not fixed

`assertBankAccess` guards the banks being **granted**, not those being **revoked**, so `bankIds: []` from a bank-scoped actor would clear grants to banks they cannot see. In practice this is unreachable with the seeded roles — every holder of `users.assign` (`super_admin`, `admin`) is unscoped — and a bespoke scoped assigner editing an employee who holds an invisible bank gets a **403** rather than silent data loss, because that bank is still in the submitted set. Recorded rather than papered over with speculative UI.

#### Proven in both directions

**22 new frontend tests** driving the real page — real row click, real "Bank access" button, real checkboxes, real Save — asserting the actual request. Two mutations reversion-proven: gating on `users.edit` fails 4, and trusting the sent list fails 1. Explicit negatives assert that **no PATCH body ever contains `bankIds`** and that **no `/teams` or `/members` path is ever called**.

**Gates:** frontend **130/130** (was 108), backend **259/259 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 problems — the unchanged documented baseline**, `next build` exit 0.

#### BUG-038 deliberately untouched

`PUT /api/teams/:id/members` applies no per-member authorization and remains **unwired**. Team assignment is Task 2.7 and must not land before that is fixed. A test asserts the employee UI calls no team endpoint.

**Files changed:** `frontend/src/app/(app)/employees/page.tsx` and the new `frontend/src/app/(app)/employees/employees-bank-access.test.tsx`.

---

### 2026-09-03 — Task 2.5: PATCH stops silently discarding assignment fields — **BUG-020 CLOSED**

**Phase:** 2 (Real employee management) · **Type:** backend behaviour + tests · **not committed**

`PATCH /api/users/:id` parsed `joinedOn`, `bankIds` and `teamId` and wrote **none** of them. Measured before the fix: a `200`, the database unchanged, and an audit row listing only `updatedAt` — the caller had no way to tell.

#### The three fields are not one problem

The roadmap framed Task 2.5 as one choice — apply them or reject them. The schema says they are three different questions, and the fix answers each on its merits:

| Field | What it actually is | Outcome |
|---|---|---|
| `joinedOn` | a plain nullable column on `users`; **no other route can change it** after creation | **persisted** — one branch in the existing `.set()`, no transaction |
| `bankIds` | many-to-many through `user_bank_access`, already owned by `PUT /api/users/:id/banks` | **refused, 422** |
| `teamId` | many-to-many through `team_members`; **`users` has no team column at all** | **refused, 422** |

Rejecting was not the lazy option. `PUT /api/users/:id/banks` already does bank assignment transactionally, with `assertCanManageRoleLevel` on the target, `assertBankAccess` per bank and an audit row carrying `from`/`to`; re-implementing that inside PATCH would put tenant-isolation logic in two places (**D-003**). `teamId` is worse — a scalar would be inventing a relationship the schema does not have, since the `(team_id, user_id)` primary key permits a user in many teams, which was measured.

#### Mechanism

A new `notOnThisRoute()` helper in `lib/zod.ts`, and the PATCH body derived — not hand-written, per **D-024** — as `patchSchema(userInput).extend({ bankIds: …, teamId: … })`. `userInput` is untouched, so `POST /users` still accepts and applies all three.

`z.never({ error }).optional()` rather than `.strict()`, deliberately: `.strict()` would reject every unrecognised key on the route and report `path: ""`, naming the offending field only in the message. This names it in `path`, and an unknown key is still ignored exactly as before — asserted by test. The `422 validation_failed` shape is inherited from the existing `ZodError` branch, so `error-handler.ts` was not touched and **D-021** holds.

#### A rejection is a behaviour change, and it was checked

`PATCH` previously answered 200 for these fields. Verified before changing anything: Task 2.4's dialog cannot emit them, and both `PUT` assignment routes have **zero frontend callers**. No caller exists that a 422 could break.

#### Measured after the fix

```
PATCH { joinedOn: "2026-01-15" }  -> 200, column updated
PATCH { name }                    -> 200, joinedOn untouched
PATCH { joinedOn: null }          -> 200, column cleared
PATCH { bankIds: [...] }          -> 422 details[].path = "bankIds", grants unchanged
PATCH { teamId: ... }             -> 422 details[].path = "teamId",  memberships unchanged
PATCH { name, bankIds }           -> 422, and the name is NOT applied either
```

**17 new tests** in `src/tests/assignment-fields.test.ts`, every one asserting database state. Reversion-proven: removing the omit protection fails **6**, removing the `joinedOn` branch fails **2**.

**Gates:** backend **259/259** (was 242), frontend **108/108 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 problems — the unchanged documented baseline**, `next build` exit 0. **No frontend file was touched.**

#### Found while investigating, NOT fixed

**BUG-038 (HIGH).** `PUT /api/teams/:id/members` applies **no per-member authorization** — only `requirePermission(teams.assign)`. Measured: a level-15 actor enrolled a **Super Admin** and an out-of-scope executive, 200, both placed. Because the write is a whole-roster replace it also permits silent **eviction**, and its audit row records no `from`/`to`, so evicted members are unrecoverable from the log. The same actor is refused by `PATCH /api/users/<super-admin>` and by `PUT /api/users/<super-admin>/banks`. It has **zero frontend callers** today, which bounds the exposure — but **roadmap 2.7 wires this route and must not land before it is fixed.**

Also recorded: `bankIds: []` on `PUT /users/:id/banks` revokes grants for banks the actor cannot see, and `POST /users` with a nonexistent bank returns a raw `409 "That record is still referenced by other records"`.

**Files changed:** `src/lib/zod.ts`, `src/modules/admin.routes.ts`, and the new `src/tests/assignment-fields.test.ts`.

---

### 2026-09-03 — Task 2.4: employees can finally be edited

**Phase:** 2 (Real employee management) · **Type:** frontend behaviour + tests · **not committed**

`PATCH /api/users/:id` supported eleven fields and had exactly one caller: the Revoke/Restore toggle, which sent `{ status }`. There was **no edit UI at all** — a name typo, a phone number or a branch set at creation could never be changed from the product.

#### Only what changed is sent

The dialog diffs the form against the employee row it opened on and sends **just the differing keys**. An untouched form issues **no request at all**.

This is the whole point of the task, and it is only safe because BUG-036 was fixed first: `PATCH` is now a genuine partial update, so an omitted field is left alone. The tempting alternative — posting the whole form back — would work, and would silently overwrite anything a colleague changed since the dialog opened, turning a data-loss bug into a lost-update bug.

Two edge cases carry their own tests because both are easy to get wrong:

- **An explicit `0` is a value.** `Number("0")` is falsy, so a truthiness check would drop a deliberate reset of a target to zero. A mutation replacing the `!== undefined` check with `&&` fails 6 tests.
- **A revoked employee is not reactivated by an edit.** Opening an Inactive employee, fixing their name and saving sends `{ name }` — never `status`. This is BUG-036's shape at the client boundary, and it is asserted end to end through the real dialog.

#### The server stays the authority

The `can("users.edit")` gate is UI visibility only. Every refusal comes from the backend and is shown **verbatim**: 400 for the Task 2.1 self-guard, 409 for the last-Super-Admin invariant, 403 for the role hierarchy, 422 for a schema refusal. The dialog stays open so the administrator can correct the change. No security logic was duplicated in React.

#### BUG-020 kept out of scope, visibly

`bankIds`, `teamId` and `joinedOn` are **absent by construction** — not in the form type, not in the payload type, so they cannot reach the request. The endpoint parses and discards all three (**BUG-020, still open**), and a control offering them would report a success that never happened, which RULES §4 forbids. The dialog says so in its own description: *"Bank access, team and joining date are set when the account is created and are not editable here."* A test asserts no such control exists and that no such key is ever sent.

#### Editable fields

name, email, phone, employeeCode, **branch**, roleId, status, target, achieved — nine, each verified against the current `PATCH` handler. `branch` is included beyond the task's suggested list because it is genuinely supported, is set by the create form, and is shown on the detail dialog; being unable to correct it would have been an odd gap. `password`, `avatarColor` and `mustChangePassword` are not offered — issuing a credential is `POST /users/:id/reset-password`'s job and already has its own button.

#### Proven in both directions

**52 new frontend tests** — 32 pinning the payload rules in isolation, 20 driving the **real page**: clicking the real row, the real Edit button and the real Save button, then asserting what `apiRequest` was actually handed. A control that renders but issues no request cannot pass. Two mutations reversion-proven: sending the whole form fails **29 of 52**, and a truthiness check on the numbers fails **6**.

**Gates:** frontend **108/108** (was 56), backend **242/242 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 problems — the unchanged documented baseline, with none of the new files flagged**, `next build` exit 0.

**Files changed:** `frontend/src/lib/employee-patch.ts` (new), `frontend/src/app/(app)/employees/page.tsx`, plus the new `employee-patch.test.ts` and `employees-edit.test.tsx`. No backend file was touched.

---

### 2026-09-02 — BUG-036: a one-field PATCH no longer overwrites the fields you did not send

**Phase:** 2 (Real employee management) · **Type:** backend behaviour + tests · **not committed**

In zod 4.4.3 a `.default()` survives `.partial()`. The field becomes `ZodOptional<ZodDefault<…>>`, and a successfully applied default is not an "absent" result, so the optional wrapper passes it straight through. Measured directly: `userInput.partial().parse({ name: "x" })` returns `{ name: "x", status: "Active", target: 0, achieved: 0 }` — three values the caller never sent. Every PATCH handler then wrote them, either through an `input.x !== undefined` guard the injection defeats or, in `createScopedResource`, by spreading the parsed body wholesale.

**This was not a latent hazard waiting for the employee edit dialog. Both PATCH buttons that ship today tripped it.** `employees/page.tsx:222` ("Revoke access"/"Restore access", body `{ status }`) zeroed the employee's `target` and `achieved` on every click; `banks/page.tsx:97` (pause/resume, body `{ status }`) wiped `commissionRate` and `productsOffered`.

#### Wider than the register said

BUG-036 was filed under *User administration*. The same shape existed at **six** `.partial()` call sites, and three of them spread the parsed body with **no `!== undefined` guard at all**, making them strictly more destructive than the users case. Measured before the fix:

| Resource | One-field PATCH | Collateral damage |
|---|---|---|
| users | `{name}` on an Inactive employee | `status Inactive→Active` (**login 403→200**), `target 8,000,000→0`, `achieved 3,250,000→0` |
| banks | `{name}` on a Paused bank | `Paused→Active`, `commissionRate 2.75→0`, `productsOffered→[]` |
| customers | `{name}` | `monthlyIncome 250,000→0`, **`kyc Verified→Pending`**, `status Closed→Active` |
| loans (factory) | `{notes}` on an Approved loan | every money column →0, **`status Approved→Draft`**, `priority High→Normal` |

`scoped-resource.ts` alone covers nine routers — loans, verifications, bank-orders, disbursements, settlements, transactions, ledger, documents and funding sources.

#### The fix

One helper, `patchSchema()` in `src/lib/zod.ts`, stripping `ZodDefault` before `.partial()`, applied at all six call sites. Public zod API only — `.shape`, the exported `z.ZodDefault` class and its documented `.unwrap()`; nothing touches `_def`/`_zod`. The inner schema is reused **by reference**, so `min`/`max`, enums, uuid/email, coercion and field-level `.transform()`/`.refine()` are preserved by construction. Base/create schemas were not touched — POST still applies every default it always did, asserted by test. Rejected: a second hand-written schema per resource (fixes one route, drifts from its create counterpart). Recorded as **D-024**.

#### An accidental correctness became a real one

Task 2.1's `assertSuperAdminRemains(..., { status: input.status ?? target.status, … })` had an **unreachable fallback** — `input.status` was never `undefined`, so the guard always received a fabricated `"Active"`. SEC-003 was safe only because the injected value pointed the *safe* direction, not because anything was compared. The fallback is now the live path, and a dedicated test pins it: renaming an **Inactive** Super Admin must leave them Inactive. No SEC-003 behaviour changed — `super-admin-lockout.test.ts` still passes 26/26, unmodified.

#### Proven in both directions

**27 new tests** in `src/tests/partial-update.test.ts`, every one asserting **database state** rather than a status code — a 200 was never the problem. Making `patchSchema` stop stripping defaults fails **19 of 27**. All four original reproductions re-measured after the fix: only the field actually sent changed, on all four resources, and the revoked employee's login stayed **403 → 403**.

**Gates:** backend **242/242** (was 215), frontend **56/56**, both typechecks clean, backend lint clean, frontend lint **87 problems — the unchanged documented baseline**, `next build` exit 0. No frontend source file was changed.

#### Explicitly not fixed

**BUG-020** — `teamId`, `bankIds` and `joinedOn` are still parsed and discarded; the opposite defect in the same handler, owned by roadmap 2.5. **BUG-037** — the check-then-write race; no transaction or lock was introduced, and none was needed. Also untouched: temporary-credential expiry, access tokens surviving a password change, and PATCH-password session revocation.

**Files changed:** `src/lib/zod.ts` (new), `src/modules/admin.routes.ts`, `banks.routes.ts`, `customers.routes.ts`, `operations.routes.ts`, `scoped-resource.ts`, and the new `src/tests/partial-update.test.ts`.

---

### 2026-09-02 — Task 2.3: a temporary password now grants nothing but a password change — **SEC-010 / BUG-005 CLOSED**

**Phase:** 2 (Real employee management) · **Type:** backend behaviour + tests · **not committed**

`mustChangePassword` was written on account creation, on admin reset and on an admin-set password, returned on the login profile, and **consulted by nothing**. Enforcement was a React redirect in `app-shell.tsx`, so any non-browser client holding an administrator-issued temporary password had full role-scoped API access, indefinitely.

Measured before the fix: a flagged Executive could `GET /api/customers` (200) and **`POST /api/customers` (201)** — write real business data. A flagged **Super Admin** — which is exactly what `db:seed` creates, using a `BOOTSTRAP_SUPERADMIN_PASSWORD` that lives in a deploy dashboard and is never rotated — could list users (200), **create accounts (201)**, read the audit log (200), and **reset other users' passwords (200), receiving another temporary credential**. `seed.ts:118-121`'s comment claiming the bootstrap value "stops being a valid credential" was simply false.

#### The roadmap's mechanism could not work, and that was measured rather than argued

Task 2.3 said: *"in `requireAuth`: reject with 403 unless the path is `/api/auth/change-password`, `/api/auth/me`, or `/api/auth/logout`."*

Under Express 5.2.1, inside a middleware registered by `router.use()` on a router mounted at `/api/users`, `req.path` is **`/abc123`** — relative to the mount. `requireAuth` is applied that way on twelve routers plus the `createScopedResource` factory. So `req.path === "/api/auth/change-password"` would **never match**, every flagged user would be 403'd out of the one route that clears the flag, and a temporary password would become a permanent lockout.

**So no path is compared anywhere.** `requireAuth` became the strict default; exactly two routes opt out by using a second middleware, `requireAuthAllowPasswordChange`. A private `authenticate()` holds the shared token verification and context loading, so the two exports cannot drift.

**`/api/auth/logout` was also wrong.** It carries no `requireAuth` at all — measured 204 with only a cookie. Neither do `/login` or `/refresh`. The real exemption set is exactly two routes, and both already used per-route `requireAuth`, which is why the design fits without moving anything.

#### Why in the default rather than beside it

SEC-010's own remediation proposed a separate `requirePasswordChanged` applied to the business routers. That shape **fails open** — thirteen mount points, and any future router that forgets it is silently unguarded. Putting the gate in the default and making the *exception* explicit means a new router is protected by doing nothing. Two call sites changed instead of thirteen. Recorded as **D-023**.

#### A workflow restriction is not a session termination

`password_change_required` is deliberately **not** one of Task 1.8's two session-invalidating codes: those mean "the session is over", and this user needs the session to fix the condition. The check sits in `requireAuth` *after* the session gates, so an account that is both flagged and deactivated still reports `account_inactive` — asserted on the exempt routes too, so they do not become a hole.

**`frontend/src/lib/api.ts` is byte-identical.** No frontend source change was needed: Task 1.8's allow-list design already fails safe for an unknown code. Only a test was added.

**Refresh stays reachable, deliberately.** A flagged session can still rotate its cookie — the frontend's session restore depends on it — and the rotated token is asserted to be exactly as restricted. Refresh tokens are **not** revoked because of the flag; that would sign a flagged user out on every page reload and strand them before the form that fixes the state.

**Once the flag clears, the same access token works immediately**, because the context is re-read per request.

#### Proven in both directions

**18 backend tests** (`src/tests/forced-password-change.test.ts`) and **1 frontend test**. Four mutations applied and reverted:

| Mutation | Tests that failed |
|---|---|
| Gate removed | 8 |
| A business router pointed at the permissive variant | 5 |
| `/auth/change-password` reverted to strict `requireAuth` | 3 — **including the whole recovery path**; the account becomes permanently unrecoverable |
| `password_change_required` added to `SESSION_ENDED_CODES` | the frontend test |

**Gates:** backend **215/215** (was 197), frontend **56/56** (was 55), both typechecks clean, backend lint clean, frontend lint **87 problems — the unchanged documented baseline**, `next build` exit 0.

#### Register corrections made along the way

- **`PRODUCTION_ROADMAP.md` and `FEATURE_STATUS.md` both called this finding SEC-009.** SEC-009 is a different, still-open **P0** — plaintext Aadhaar in `import_rows`. The correct id is **SEC-010**. Third instance of this collision class in the repository; the roadmap carries a wider off-by-one from SEC-010 upward, recorded but not fixed here.
- **`BUG-005` (HIGH) and `SEC-010` (MEDIUM) were the same defect at two severities.** Reconciled to **MEDIUM** in both: neither authentication nor authorization was ever defeated, and reaching the state needed a privileged or compromised channel. The measured impact is recorded in full rather than softened.
- `SECURITY_AUDIT.md` cited `access.ts:38,82` for the loaded flag; the return site is **`:89`**.

#### Explicitly not fixed

Temporary-credential **expiry** (SEC-010 remediation 3, still open) · an access token surviving a password change for up to 15 minutes, true of all three password-setting paths · `PATCH /users/:id` password branch revoking no sessions and clearing no lockout · **BUG-036** · the double `requireAuth` on `POST /loans/:id/verification` (now covered by a test asserting it refuses once, with unchanged behaviour for unflagged callers).

**Files changed:** `src/lib/errors.ts`, `src/middleware/auth.ts`, `src/modules/auth.routes.ts`, the new `src/tests/forced-password-change.test.ts`, and one test added to `frontend/src/hooks/use-auth.demo-boundary.test.tsx`.

---

### 2026-09-02 — Tasks 2.1 + 2.2: a Super Admin can no longer lock the organisation out — **SEC-003 / BUG-003 CLOSED**

**Phase:** 2 (Real employee management) · **Type:** backend behaviour + tests · **not committed**

The second P0 closed, and the first on the backend. `PATCH /api/users/:id` could set your own `status` to `Inactive` or move you off the Super Admin role, returning `200` either way, with **no recovery path inside the product** — and the UI's own "Revoke access" button issued exactly that request against whichever row you had open, including your own.

#### The obvious fix was wrong twice, and both were measured

**Copying `DELETE`'s self-guard would have broken ordinary editing.** `DELETE`'s rule is an unconditional `if (id === ctx.userId) throw`. On `PATCH` that also refuses a Super Admin changing their own name. The guard is **field-scoped and change-scoped** instead: it compares against the value already stored and refuses only a real change, so echoing your current `status` or `roleId` back — which Task 2.4's edit form will do on every save — stays `200`. A mutation that refuses on the mere *presence* of those fields fails four tests.

**A `status`-only guard would have left the quieter path open.** Self-demotion by `roleId` returns 200, the account stays Active, re-login returns 200 — and every administrative call then returns a bare `forbidden`, which the Task 1.8 client deliberately does **not** sign out on. The user is left in a permanently broken session with no explanation. `DELETE` has no analogue to copy, because `DELETE` cannot change a role.

#### Task 2.2 landed inside 2.1, not after it

The only formulation correct for **both** routes is *"count the protected population **excluding the target**; refuse if the operation removes the target and that count reaches zero"* — which **is** the 2.2 fix. So there is one helper, `assertSuperAdminRemains(db, targetId, before, after)` in `services/access.ts`, called by `PATCH` and `DELETE`. Callers describe the **proposed end state**, which is the only signature that also expresses `DELETE`'s soft delete.

For an Active target the new form is provably equivalent to the old `remaining <= 1` over a count that included them, so **`DELETE`'s behaviour on active targets is unchanged**. For an Inactive target the old form produced a spurious `409`; deleting an already-deactivated Super Admin while exactly one active one remains is now `204`. Recorded in **D-022**.

#### The two guards are independent, and that is why both exist

Deactivating yourself while a peer Super Admin exists leaves `remaining = 1`, so the invariant is satisfied — and you are still permanently locked out, because reactivation needs `users.edit`, which needs an Active account. Neither rule subsumes the other.

#### What was deliberately NOT done

| SEC-003 remediation item | Outcome |
|---|---|
| 3 — enforce the invariant with a database trigger | **Rejected, measured.** A table-wide aggregate cannot be a `CHECK`; a trigger raises `restrict_violation` (`23001`), which `error-handler.ts` does not map, so it would surface as a **500 with a stack trace**. Mapping it there is forbidden by **D-021**. |
| 4 — a `db:recover-superadmin` break-glass script | **Still open.** An operational deliverable, not a guard. |

The count and the write are still separate statements with no lock, exactly as `DELETE` has always been — repository-wide there are 11 `db.transaction` sites and **zero** row locks. That closes the single-actor path (one administrator, one mis-click), which is the whole of the realistic scenario, and leaves the concurrent one recorded as **BUG-037**.

#### Proven in both directions

**26 new tests** in `src/tests/super-admin-lockout.test.ts`; **nine fail against the pre-fix code**, including the 2.2 false refusal. `DELETE`'s two guards had **never been executed by any test** in the repository's history — they are covered now, written before the refactor touched them. Four independent mutations were applied and reverted:

| Mutation | Tests that failed |
|---|---|
| Self-guard disabled | 1, 2, 2b (+21) |
| Shared invariant disabled | 3, 4, 4b, 15, 19 |
| Pre-2.2 count restored (target included, `<= 1`) | **18 only** |
| Self-guard fires on mere field presence | 6, 7, 8, 9 |

**Gates:** backend **197/197** (was 171), frontend **55/55**, both typechecks clean, backend lint clean, frontend lint **87 problems — the unchanged documented baseline**, `next build` exit 0.

#### Found while closing it, recorded not fixed

**BUG-036 (HIGH).** `userInput.partial()` does **not** suppress `.default("Active")` in zod 4.4.3, so a `PATCH` sending only `{ name }` writes `status: "Active"` and resets `target`/`achieved` to `0` — **a revoked employee's access is silently restored by an unrelated edit.** Measured over real HTTP. It does not weaken this fix (the injected default is the safe direction, and both guards compare against the stored value), and that was verified rather than assumed. The opposite failure to BUG-020; Task 2.5 should absorb both. One test echoes `status` explicitly, with a comment, so the suite does not quietly depend on the defect.

**BUG-037 (MEDIUM).** The check-then-write race above — a whole-codebase class, not one site.

**Severity qualifier added to SEC-003.** It is retained at CRITICAL, but the register's own definition says CRITICAL means reachable *"by an attacker with no privileged position"*, and this needs the most privileged position in the system with an accident as its dominant trigger. Recorded rather than left as a silent contradiction.

**Files changed:** `src/services/access.ts`, `src/modules/admin.routes.ts`, and the new `src/tests/super-admin-lockout.test.ts`. No frontend change was made or needed — the existing `toggleStatus` catch surfaces the new `400`/`409` through its error toast.

---

### 2026-09-02 — Phase 1 record correction: the work was right, the record was not

**Phase:** 1 (post-completion audit) · **Type:** documentation only · committed as *"Correct Phase 1 records and readiness status"*

A ten-agent audit cross-checked every Phase 1 claim against code, tests and git history, and two adversarial agents attacked the headline claims. **Both refuted them.** All nine implemented tasks verify, all ten closed findings are genuinely fixed with tests, `error-handler.ts` is byte-identical to the Phase 0 baseline, and both suites pass at the documented totals. **No application behaviour changed in this pass** — the only non-markdown edit is a source comment.

#### The two serious findings

**A still-open P1 security finding was recorded as solved by Phase 1.** `PRODUCTION_ROADMAP.md:115`, inside Phase 1's own *"Problems being solved"* table, listed **SEC-013** and described the CORS 500. SEC-013 is *"Recycle-bin restore and permanent-delete skip all scoping for `null`-bank entries"* — **MEDIUM, P1, OPEN**, and its defective code is still present verbatim at `admin.routes.ts:854` and `:885` (`if (entry.bankId) assertBankAccess(…)` — a `null` bankId skips scoping entirely). The CORS finding is **SEC-018**. Corrected; SEC-013 remains open and untouched.

**A Definition-of-Done box was ticked on evidence that does not support it.** DoD item 4 claimed signing in from a demoed tab *"reaches `/employees`"*, citing regression test group C. Group C renders no page and mocks `next/navigation` into an unobservable throwaway; the word "employees" appears in **zero** frontend tests; and `login/page.tsx:69` routes to **`/dashboard`**, which the roadmap's own Manual line already said. The application has no post-login `/employees` flow to test. Corrected to state what is actually proven, with the navigation half marked **manual and unverified** — the honest fix, rather than inventing a flow the product does not have.

#### Also corrected

| Defect | Correction |
|---|---|
| `PRODUCTION_ROADMAP.md:630` attributed the `/api/health/ready` leak to SEC-014 | It is **SEC-015** (P1, open). SEC-014 is the audit-log SQL-precedence bug (P2, open). Third and fourth instance of the collision class Task 1.7 was credited with fixing. |
| Readiness scorecard: 8 of 17 rows disagreed with their own tables | Recounted mechanically. **One was Phase 1's fault** (A13 added, A6 flipped, Authentication row never incremented); seven are byte-identical at `7977d6b` and were inherited. All corrected, because the TOTAL cannot be right while its inputs are wrong. |
| A6 (DONE) and X9 (NOT STARTED) were the same control | X9 → **DONE**. Task 1.7 closed SEC-028. |
| **159 / 50 / 31%** | **160 / 59 / 37%.** No item's real state changed — only the tally was wrong. |
| 16 stale test-count references across 11 files | Live documents corrected to **171 backend / 55 frontend**. Three baseline-pinned reference documents (`TESTING_STRATEGY`, `ARCHITECTURE`, `PRD`) got a dated staleness banner instead of a rewrite — their numbers are correct *for their pinned baseline*, and rewriting them would have falsified a deliberate historical record. |
| `frontend/src/lib/api.ts` carried a **false rationale** | It claimed the `getAccessToken()` gate exists because login returns the session-invalidating codes. `auth.routes.ts:131-132` returns plain `forbidden`. **D-020 contradicted itself** — its table asserted the false version while its Consequences section stated the true one. Both corrected; the guard is retained as defence in depth and the comment now says so. |
| `topbar.tsx:198` cited in 8 places | The call is at **`:203`** — Task 1.9's own explanatory comment moved it. Self-inflicted staleness of exactly the kind Task 1.9 flagged in `a77b3c5`. |
| SEC-003 quoted `access.ts:52` → `forbidden("Account is not active")` | Task 1.8 replaced it: `access.ts:59` → `accountInactive()`. Its consequence is now **worse** — an immediate forced sign-out. |

#### Nothing was closed

SEC-013, SEC-014, SEC-015, SEC-026, BUG-035, the 45 remaining parameterised endpoints, the malformed-JSON 500, the `rootCause` SQLSTATE regex, the CORS `requestId` gap, the absent CI, the `COOKIE_DOMAIN` limitation and the `logger.ts` `NODE_ENV` second source of truth all remain **OPEN**, verified still present in code.

#### Verification

Backend **171/171**, frontend **55/55**, both typechecks clean, backend lint clean, frontend lint unchanged at 87 problems. The one source edit is a comment; no behaviour changed.

---

### 2026-09-02 — Task 1.9: a malformed customer id is a 422, not a 500 — BUG-017 CLOSED, **PHASE 1 COMPLETE**

**Phase:** 1 · **Task:** 1.9 (final) · **Type:** input validation — backend + frontend · committed as *"Fix customer ID validation and complete Phase 1"*

#### The defect

The command palette linked to `/customers/${customer.code}`. The detail page passed that segment to `GET /api/customers/:id`, which compared `CUS-10001` against a `uuid` column. Postgres raised `22P02`; `error-handler.ts` maps only `23505` and `23503`, so it fell to the terminal branch. The user got an empty page and the server logged the SQL, the bound parameters and a stack trace — **on every search selection**.

Measured, one palette click cost **four** 500s: the detail fetch plus three sibling `useResource` calls passing the same segment as `?customerId=`.

#### The change

**Backend** — one schema, three call sites, in `customers.routes.ts`:

```ts
const idParam = z.object({ id: z.string().uuid() });
...
const { id } = idParam.parse(req.params);   // GET :181, PATCH :253, DELETE :305
```

Parsed **inside** the handlers, after `requirePermission`. **Frontend** — `topbar.tsx:203` links by `customer.id`; the code is still displayed. *(Recorded as `:198` on the day; the explanatory comment added in the same change moved the call to `:203`. Corrected 2026-09-02.)*

#### Two rejected fixes, and why — the substance of this task

| Rejected | Measured reason |
|---|---|
| Map `22P02` in `error-handler.ts` | It is `invalid_text_representation`, not "bad uuid" — it also fires on integer, numeric, boolean and json. Decisively: `services/access.ts:48` feeds the JWT `sub` into `eq(users.id, …)` on **every** request, so a token minted with a non-uuid subject 22P02s on 100% of traffic. That total outage would have become a 4xx which `error-handler.ts:58` does not even log. `cors.test.ts:211-213` already says in writing: *"Task 1.6 must not turn unknown failures into 4xx."* |
| A `router.param()` hook | It runs **before** `requirePermission`. Measured: it would flip 403 → 422 for callers lacking `customers.view` — an authorization-precedence change, in the authentication-integrity phase, to fix a link. It also binds by parameter *name*, so it silently no-ops on `:batchId`. |

`middleware/error-handler.ts` changed by **zero lines**. That is the defining property of the fix ([DECISIONS.md](DECISIONS.md) D-021).

#### Two register corrections the investigation forced

- **BUG-027 is INVALID — a misdiagnosis.** It claimed `GET /api/customers/check/reference` was shadowed by `/:id` and returned 500. `:id` compiles to `^(?:\/([^\/]+))(?:\/$)?$` under path-to-regexp 8.4.2 — the `[^\/]+` excludes the slash, so a one-segment pattern can never match a two-segment path. Measured **before** any change: 200 `{"available":true}`, and 409 with `existingCustomerCode`. The registration order is exactly as BUG-027 describes and is irrelevant. Its recommended fix (reorder) was a no-op. Its one accurate point survives: a **single**-segment literal added after `/:id` *would* be captured — `GET /api/customers/check` returned 500 before, and a legible 422 now.
- **BUG-017 contained a measured-false claim.** It said the sibling `?customerId=` calls "fail their own Zod `uuid()` validation and return 422". They returned **500** — `customerId` bypasses the factory's `listQuery` and goes through the unvalidated `filterable` loop. Filed as **BUG-035**, left open.

#### Scope, stated honestly

**Three endpoints fixed, not the class.** The identical pattern exists on **45 other parameterised endpoints**, all measured at 500 — banks 3, admin 12, imports 2, operations 28. Authenticated-only, no user journey reaches them, deferred to Phase 8. Also deferred and recorded, not fixed: BUG-035, the malformed-JSON-body 500, and `rootCause()`'s `/^\d{5}$/` SQLSTATE test which cannot match a letter-bearing code like `22P02`.

#### Accepted narrowing

Postgres accepts four uuid spellings — canonical, uppercase, unhyphenated, brace-wrapped — and **all four returned 200 before this change** (measured). zod 4.4.3 accepts the first two, so the last two now return 422. No client emits them: all 17 customer-href sites in `frontend/src` use `id`/`customerId` straight from this API. Taken deliberately rather than papered over with a bespoke regex that would diverge from the 15+ existing `z.string().uuid()` sites.

#### Proven in both directions

| Reversion | Result |
|---|---|
| Remove the three `idParam.parse` calls | **9 of 20** backend tests fail |
| Restore `customer.code` in the palette | **1 of 2** frontend tests fail |

The 11 backend tests that still pass under reversion are the ones asserting what must **not** change — valid uuid, absent uuid, `/check/reference`, 401/403 precedence, and the genuine-500 guard. Group F drops the `customers` table and asserts a real fault is still 500 with one `logger.error`: it fails the moment anyone ships the central `22P02` mapping.

#### Files

**Added:** `src/tests/customer-lookup.test.ts` (20) · `frontend/src/components/layout/topbar.navigation.test.tsx` (2).
**Changed:** `src/modules/customers.routes.ts` · `frontend/src/components/layout/topbar.tsx` · `frontend/src/lib/demo/api.ts` (comment only — the `row.code === id` fallback is **kept**).
**Untouched:** `error-handler.ts`, auth, CORS, cookies/tokens, authorization middleware, schema, the other 45 endpoints.

#### Verification

Backend **171/171** (8 files, was 151/151) · frontend **55/55** (5 files, was 53/53) · both typechecks clean · backend lint clean · frontend lint unchanged at 87 problems · `next build` exits 0, which also re-proves the Task 1.10 demo tripwire.

---

### 2026-09-02 — Task 1.8 (AMENDED): only two error codes end a session — BUG-034 CLOSED

**Phase:** 1 · **Task:** 1.8 · **Type:** session-state correctness — backend + frontend · committed as *"Handle deactivated sessions on 403"*

#### Why it could not be a frontend-only fix

Measured against the real app: **every** 403 carried `code: "forbidden"` — a deactivated account, a disabled role, a missing permission, an out-of-scope record, a hierarchy refusal, and the demo layer's fabricated refusals. The demo's 403 was **byte-identical** to the bank-scope one. Signing out on a bare 403 would have logged real users out for opening a page their role cannot see, and ended a presenter's demo mid-walkthrough.

#### Severity, stated accurately

**This was never an authorization bypass.** The backend refused every request from a deactivated account correctly, and the session did not survive indefinitely: at access-token expiry (default 15 min) the next request 401'd, refresh re-ran `loadAuthContext`, failed, and `forceSignOut()` fired. The defect was a **≤ 15-minute window** where the UI looked healthy and nothing loaded — session state and UX, not access control. The roadmap's wording overstated it.

#### The change

**Backend** — two codes for the two *session gates* in `services/access.ts`, which fire on every request regardless of what was asked for:

```ts
if (row.status !== "Active") throw accountInactive();  // 403 account_inactive
if (!row.roleIsActive)       throw roleDisabled();     // 403 role_disabled
```

Status stays 403, the response shape is unchanged, every ordinary refusal keeps `forbidden`, and soft-deletion keeps its 401.

**Frontend** — one branch in `apiRequest`, reusing the existing `forceSignOut()`:

```ts
if (SESSION_ENDED_CODES.has(error.code) && getAccessToken()) forceSignOut();
```

No message parsing, no path matching, no second logout mechanism. The `getAccessToken()` gate stops a failed **login** — which returns the same code — from bouncing the login page.

#### Proven in both directions

| Reversion | Result |
|---|---|
| Remove the branch — the original defect | **2 tests fail**: deactivation no longer ends the session |
| Sign out on **any** 403 — the plausible over-broad fix | **1 test fails**: an ordinary `forbidden` logs the user out |

Most fixes only get tested for under-firing. This one can fail in either direction, so both are pinned.

#### Demo safety — and an honest note about it

The demo keeps running: its errors carry `forbidden`, which is not in the allow-set. But the stronger guarantee is structural — `apiRequest` short-circuits to `demoRequest` **before** the response branch exists, so a demo error never reaches the check at all. **The demo test therefore proves the demo still works but would not catch an over-broad rule**; the `forbidden`-stays-signed-in test is what does. Recorded in D-020 so the demo test is not mistaken for a guard it is not.

#### Files

**Added:** `src/tests/session-invalidation.test.ts` (11 tests).
**Changed:** `src/lib/errors.ts` (two helpers) · `src/services/access.ts` (two call sites + import) · `frontend/src/lib/api.ts` (one constant, one branch) · `frontend/src/hooks/use-auth.demo-boundary.test.tsx` (+7 tests).
**Untouched:** CORS, cookies, tokens, route permissions, bank-scope semantics, the demo layer, and the 401 ladder.

#### Verification

Backend **151/151** (140 + 11) · frontend **53/53** (46 + 7) · both typechecks clean · backend lint clean · frontend lint unchanged at 87 problems, 0 new.

#### Also corrected

The roadmap cited `lib/api.ts:153` for the 401 ladder; it is at **209-221**. `API_OVERVIEW.md` and `ARCHITECTURE.md` carry the same stale reference and are left alone — they are descriptive documents outside this task's scope, and are noted as follow-up.

---

### 2026-09-02 — Task 1.7 (AMENDED): `NODE_ENV` is now required — SEC-028 CLOSED

**Phase:** 1 · **Task:** 1.7 · **Type:** security — backend configuration · committed in the *"Require explicit NODE_ENV for secure cookies"* checkpoint

#### Amended, not implemented as written

The roadmap asked to *"assert at boot that `NODE_ENV=production` implies `secure`+`sameSite=none`"*. That assertion is a **tautology**: `refreshCookieOptions()` computes both flags from the single expression `config.NODE_ENV === "production"`, in one function, with no other input.

**Demonstrated rather than argued** — with the defective `.default("development")` restored, the cookie-attribute assertions **pass 5/5** while the two tests carrying the security claim fail. An assertion that passes against the broken implementation is not a security control, and this project has already written and deleted two such tests.

#### The real defect (SEC-028)

`NODE_ENV` was `.default("development")`, and **nothing in this repository sets it** — no `Dockerfile`, `railway.*`, `nixpacks.*`, `Procfile`, CI or `vercel.json`, and `npm start` is a bare `node dist/server.js`. A genuine production deployment that simply forgot the variable booted as `development` and issued the refresh cookie with `Secure=false; SameSite=Lax`:

- **Confidentiality** — transmissible over plain HTTP.
- **Availability** — across the Vercel↔Railway *site* boundary the browser stores it and never sends it, so **every reload silently signs the user out**. That is the loud symptom; the security one is silent.

A *typo* was already rejected by the enum (`prod`, `Production`, `staging`, `""` all refuse to boot) — an existing, undocumented guard. Only **absence** was silent.

#### The fix — one schema field

`config/env.ts`: drop `.default("development")` and give the enum a message an operator can act on.

```
Invalid environment configuration:
  - NODE_ENV: NODE_ENV must be set explicitly to development, test or production.
    It is not defaulted: it alone decides the refresh cookie's Secure and SameSite
    flags, so guessing it wrong ships insecure sessions.
```

**`lib/tokens.ts` is untouched** — the cookie logic was always correct; only its input was unguarded. Nothing is inferred from `CORS_ORIGIN`, `DATABASE_URL` or any other variable, so the check has no false positives (D-019).

#### Rejected, and recorded so they are not re-derived

Inferring production from an `https` `CORS_ORIGIN` (would refuse a boot to a developer testing against a deployed frontend); inferring from a non-localhost `DATABASE_URL` (would break the documented Neon local workflow); a new `APP_ENV` variable (a second source of truth); deriving cookie flags from topology (changes authentication behaviour).

#### Tests

`src/tests/cookie-config.test.ts` — 17 cases, no database, ~34 ms. Group A carries the security claim; group B locks the `NODE_ENV → cookie` mapping and is **labelled in the file as proving nothing about misconfiguration**, so the tautology is not smuggled back in as reassurance. Groups C–E cover `COOKIE_DOMAIN` presence/absence, set/clear attribute symmetry, and that the pre-existing `AADHAAR_PEPPER` and JWT-secret guards still fire.

Restoring `.default("development")` fails **2 of the 17** — both in group A.

#### Documentation defect found and fixed

`PRODUCTION_ROADMAP.md` recorded this problem as **SEC-014**. SEC-014 is a *different*, still-open finding — the audit-log bank-scope SQL-precedence bug. The cookie hazard was described in the original audit inside SEC-007's evidence but **never given an id**. It is now **SEC-028**, and the roadmap reference is corrected. `claude/NEXT_TASK.md` had repeated the wrong id when handing off from Task 1.6.

#### Side effect on SEC-007

SEC-007's abuse scenario is *"deployed to a container platform where `NODE_ENV` is not explicitly set"*. That path now fails at boot, so SEC-007 is **narrowed but not closed** — `NODE_ENV=development` set deliberately still bypasses the pepper guard.

#### Verification

Backend **140/140** (123 + 17), typecheck clean, lint clean. Frontend untouched.

#### Operational note

**Any deployment relying on the old default will now fail to start** until `NODE_ENV` is set. That is the intended behaviour. The documented workflow is unaffected: `.env.example` already ships `NODE_ENV=development` and the README already instructs `cp .env.example .env`.

#### Not fixed, deliberately

The roadmap's second clause — validate `COOKIE_DOMAIN` against the API host — **is not implementable**: the backend has no authoritative API-host value in its schema. Recorded as a follow-up rather than silently dropped.

---

### 2026-09-02 — Task 1.6: a refused CORS origin returns 403, not 500 — BUG-022 / SEC-018 CLOSED

**Phase:** 1 · **Task:** 1.6 · **Type:** security + operability — backend only · committed in the *"Fix CORS rejection handling"* checkpoint

#### Root cause

The origin callback rejected with a bare `Error`. `cors@2` hands that straight to `next()`, and `middleware/error-handler.ts` cannot classify it, so it fell to the terminal branch: **500**, body `internal_error`, and an **error-level log with a full stack trace and absolute filesystem paths**. A config mistake looked like a crash; an unauthenticated caller could drive error-level logging at will (SEC-018).

#### The fix — one callback, nothing else

```ts
origin(origin, callback) {
  if (!origin || allowed.includes(origin)) return callback(null, true);
  logger.warn({ origin }, "Blocked request from a non-allow-listed origin");
  return callback(new AppError(403, "cors_origin_denied", "Origin is not permitted"));
}
```

Four deliberate choices, recorded in [DECISIONS.md](DECISIONS.md) D-018: reject **before the route** (not `callback(null, false)`, which would let the handler run); log **at the rejection site** (the error handler cannot see the origin, and a 4xx branch there would change logging for every 401/403/404 in the API); a **distinct code** rather than the generic `forbidden`; and **no reflection** of the attacker-controlled origin into the response body.

#### Preflight was broken too, and nobody had recorded it

`cors@2` forwards the rejection to `next()` *before* its own preflight branch (`cors/lib/index.js:218-224`), so a disallowed `OPTIONS` also returned 500. Neither the roadmap nor BUG-022 nor SEC-018 mentioned it. It is 403 now, with a test.

#### Before / after

| Request | Before | After |
|---|---|---|
| GET, allowed origin | 200 + CORS headers | **unchanged** |
| GET, **disallowed** | **500** `internal_error`, error log + stack | **403** `cors_origin_denied`, one `warn` |
| GET, no `Origin` | 200 | **unchanged** |
| OPTIONS preflight, allowed | 204 + headers | **unchanged** |
| OPTIONS preflight, **disallowed** | **500** | **403** |
| Unknown path, disallowed | 500 | **403** (never reaches `notFoundHandler`) |

#### Files

**Added:** `src/tests/cors.test.ts` (16 tests, no database, ~80 ms).
**Changed:** `src/app.ts` — the origin callback and one import.
**Untouched:** the error handler, authentication, authorization, cookies, tokens, routing, middleware order, and the whole frontend.

#### Verification

Backend **123/123** (107 + 16), typecheck clean, lint clean (0 errors, 0 warnings). Frontend unaffected — 46/46 run anyway.

Reverting the callback to the original bare `Error` fails **7 of the 16**, including the preflight and `warn`-logging cases. Route non-execution is proven positively: an unknown path under a denied origin returns **403 rather than 404**, so `notFoundHandler` was never reached.

#### Deliberately not fixed

The rejection log still carries **no `requestId`** — it is assigned at `app.ts:65`, after the CORS middleware. Correlating it means reordering global middleware for every request in the app. Recorded as follow-up, not folded into a status-code task.

---

### 2026-09-02 — Task 1.10: the demo is excluded from **every** production build path — SEC-027 / BUG-033 CLOSED

**Phase:** 1 · **Task:** 1.10 · **Type:** security fix — build configuration + regression tooling · committed in the *"Secure demo build isolation and visibility"* checkpoint

#### Root cause

`turbopack.resolveAlias` is read only by Turbopack. `next build --webpack` — a documented flag — resolved `@/lib/demo` through `tsconfig` paths to the real module and shipped the credential and every fabricated customer record to the public bundle, **while the banner printed `EXCLUDED` four times**.

#### The obvious fix does not work, and that is the interesting part

Adding a webpack `resolve.alias` compiles cleanly, prints `EXCLUDED` — and still ships the demo. Next registers **`JsConfigPathsPlugin`** in `resolve.plugins` to implement `tsconfig` `paths`, and it resolves `@/lib/demo` to the real directory *before* the alias is consulted. This was not reasoned out in advance: the tripwire (below) failed the build, and instrumenting the webpack hook to print `config.resolve.plugins` confirmed why.

The webpack side therefore uses **`NormalModuleReplacementPlugin`**, which rewrites the request *before* resolution begins, so no resolve plugin can win the race. The alias is kept beside it as a second line.

#### Three layers (D-017)

| Layer | Mechanism | Covers |
|---|---|---|
| 1 | `turbopack.resolveAlias` + webpack `NormalModuleReplacementPlugin` | the known bundlers |
| 2 | **A tripwire in `lib/demo/config.ts`** — throws when `NODE_ENV=production` and the demo is not explicitly enabled; `next build` prerenders on the server, so the **build fails** | *any* bundler, present or future, **and** deep imports of `@/lib/demo/*` that an exact-match alias cannot see. Every other file in that directory imports `config.ts` |
| 3 | `npm run verify:demo-exclusion` — builds on both bundlers into clean output and searches the result | the property itself, empirically |

Layer 2 is the important one: it enumerates nothing, so it holds for a bundler Next has not shipped and an import nobody has written. It converts a silent leak into a loud build failure — and it is what caught the `JsConfigPathsPlugin` problem.

#### Evidence — three clean builds, distinct BUILD_IDs

| Variant | BUILD_ID | Banner | Result |
|---|---|---|---|
| turbopack, demo disabled | `ufkrYTID9IX04lO1yrqSq` | `EXCLUDED via turbopack alias` | credentials absent ✓ fixtures absent ✓ |
| **webpack, demo disabled** | `aHLz-pqI8lE6rIui1AvSR` | `EXCLUDED via webpack alias` | **credentials absent ✓ fixtures absent ✓** |
| turbopack, demo **enabled** | `LThCbPhRQ6fqy0JWttN1g` | `INCLUDED` | demo present ✓ |

212 demo-exclusive literals derived from source at run time, plus 4 named critical strings. The third variant is the anti-vacuity check — without it, a build emitting no client JavaScript would pass the other two and prove nothing.

#### Proven by reversion, twice

| Reversion | `npm test` | `verify:demo-exclusion` |
|---|---|---|
| Delete the webpack key — the original defect | **fails** (1 test) | **fails**; the build itself fails on the tripwire |
| Keep the alias, drop the replacement plugin — *the plausible wrong fix* | **passes 46/46** | **fails**; the build fails on the tripwire |

The second row is why layer 3 exists. **Unit tests cannot catch a resolution-order defect** — demonstrated, not assumed.

#### Files

**Added:** `frontend/scripts/verify-demo-exclusion.mjs` · `frontend/src/lib/demo-build-isolation.test.ts` (9 tests).
**Changed:** `frontend/next.config.ts` (webpack replacement plugin + alias; honest banner) · `frontend/src/lib/demo/config.ts` (tripwire only — the credential, fixtures and demo behaviour are untouched) · `frontend/package.json` (one script).
**Backend, schema, authentication, demo architecture:** untouched.

#### Verification

Frontend **46/46** · typecheck clean · lint **87 problems — identical to baseline, 0 new** · default build PASS · webpack build PASS · `verify:demo-exclusion` PASS · backend **107/107**, untouched.

#### Consequences

**SEC-001's bundler condition, added the previous day, is withdrawn** — the exclusion holds on every path. **Residual, recorded not hidden:** `verify:demo-exclusion` is a command someone must run; there is no CI in this repository yet. Phase 15 must wire it in. Until then layer 2 is what actually holds the line, and it requires nobody to remember anything.

---

### 2026-09-02 — Task 1.5 reviewed and **CLOSED AS SUPERSEDED** — and a HIGH finding uncovered doing it

**Phase:** 1 · **Task:** 1.5 · **Type:** decision + documentation · **no application code changed** · committed in the *"Secure demo build isolation and visibility"* checkpoint

#### The decision

Roadmap Task 1.5 — *"move the demo credential out of a source literal into env-gated config so it is never a constant in shipped JS"* — is **closed as superseded, not implemented** ([DECISIONS.md](DECISIONS.md) D-016). Three independent reasons:

1. **Its mechanism cannot achieve its goal.** Next inlines `NEXT_PUBLIC_*` into client JS at build time. Proven with a sentinel build: `NEXT_PUBLIC_API_URL="https://inlining-probe-9f2c1d40.example"` lands in `.next/static` verbatim as `let y="https://inlining-probe-9f2c1d40.example".replace(...)`. A `NEXT_PUBLIC_DEMO_PASSWORD` would be a literal exactly as the source constant is.
2. **A server-only variable cannot work either.** `isDemoCredentials()` runs in the browser before any request exists; reaching a server value needs a round trip, breaking the demo's defining property that it works with the backend stopped.
3. **The credential was never the gate.** `sessionStorage.setItem("risenext.demo.session","active")` alone yields a full demo session — asserted by existing test group G and by SEC-001's own impact analysis (*"No password is required"*).

The objective — no credential in the shipped bundle — was met by **Task 1.3**.

#### What the review found: SEC-027 / BUG-033 (HIGH — **resolved the same day by Task 1.10**, entry above)

Four adversarial lenses attacked the closure. Three independently falsified one of its premises, and the finding is real and reproducible:

```
$ npm run build -- --webpack        # no env vars set
[next.config] demo module: EXCLUDED (NEXT_PUBLIC_ENABLE_DEMO=unset, NODE_ENV=production)
▲ Next.js 16.2.12 (webpack)
✓ Compiled successfully
$ grep -rl "Demo@12345" .next/static
.next/static/chunks/4532-….js
```

`turbopack.resolveAlias` is honoured **only** by the Turbopack path. `--webpack` is a documented flag of the installed Next 16.2.12, needs no source change, and reopens SEC-001's exposure half in full — credential, persona and all fabricated PII — **while printing `EXCLUDED` four times**.

It does **not** revive Task 1.5: in a webpack build the module resolves, so an env-sourced credential would be inlined anyway, and the fixture PII — the larger exposure — was never in 1.5's scope. The gap belongs to Task 1.3 / D-014 and is now **roadmap task 1.10**.

**Why it went unnoticed:** SEC-001 was closed on a build-output search run **once, by hand**. Nothing inspects `.next` — `vitest.config.ts` includes only `src/**/*.test.{ts,tsx}`, and `demo-disabled.test.ts` concedes the limit in its own header. Phase 1's test list asked for this check *"in CI-runnable form, not by eye"*; it was never built.

#### Corrections made to the existing record

| Was | Now |
|---|---|
| SEC-001 **CLOSED** | **CLOSED, CONDITIONALLY** — Turbopack path only, condition stated up front, with a reopen trigger |
| D-014: webpack is *"a future move … recorded rather than pre-solved"* | Corrected — a live capability that reopens a CRITICAL finding with one flag |
| SEC-001 offered *"every build prints which variant it produced"* as a safety property | Struck — the banner reports what was configured, not what was bundled |
| Readiness X2 *"No secrets in source — DONE — placeholders only"* | **PARTIAL** — a plaintext credential literal does exist in source; a caveat, not an exposure |
| SEC-001 remediation items #2 and #3 unaddressed and ownerless | Standing of all four recorded explicitly under SEC-001 |
| Literal count quoted as both 256 and 254 | Reconciled — Task 1.4's test made two literals non-exclusive; result unchanged |

#### Files

**No application code changed.** Documentation only: `SECURITY_AUDIT.md` · `DECISIONS.md` · `PRODUCTION_ROADMAP.md` · `BUGS_AND_ISSUES.md` · `PRODUCTION_READINESS.md` · `CURRENT_STATE.md` · `FEATURE_STATUS.md` · `INTEGRATION_MAP.md` · `README.md` · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md`.

---

### 2026-09-02 — Task 1.4: demo mode is unmistakable while it is active

**Phase:** 1 · **Task:** 1.4 · **Type:** correctness of a user-facing warning — frontend only · committed in the *"Secure demo build isolation and visibility"* checkpoint

#### The defect

The only on-screen sign that the data was fabricated was a caption inside the sidebar footer card, nested in that card's `{!collapsed && …}` wrapper (`sidebar.tsx:118`). **Collapsing the sidebar removed it**, and so did being on mobile with the drawer shut. What stayed on screen was seven fabricated customers with structurally valid PANs, real-prefix mobile numbers, valid IFSC codes and loan amounts, with nothing saying they were invented. Its wording — *"Preview workspace · sample data"* — never said the data was not real, and sat directly below *"Signed in as Executive"*.

Recorded as **BUG-032**. It had been documented since the audit as roadmap Task 1.4 and [RULES.md](claude/RULES.md) §3 but had never carried a bug id.

#### Three surfaces, because they fail in different places (D-015)

| Surface | Where | Covers |
|---|---|---|
| `DemoModeBanner` | `AppShell`, above the topbar, **outside the sidebar subtree** | sidebar collapse; every route change |
| `DemoModeBadge` | inside `Topbar`, which is `sticky top-0` | **scrolling** — the case the roadmap's banner-only brief would have missed |
| sidebar marker | `sidebar.tsx`, lifted **out** of the `!collapsed` wrapper | the original defect; it now shrinks to its icon with an `sr-only` label rather than unmounting |

Neither component accepts a prop that could suppress it — only an optional `className`. The defect being fixed was a visibility signal wired to unrelated layout state, so a `collapsed` or `hidden` prop would reintroduce it one caller at a time. **The tests render each component with `collapsed`, `hidden`, `visible` and `disabled` spread on and assert the indicator survives — reintroducing an honoured `collapsed` prop fails both.**

> An earlier version of that guard asserted `DemoModeBanner.length === 1`. `Function.prototype.length` counts formal parameters, not destructured properties, so it passed with the defect reintroduced and would have failed had the component been hardened. Adversarial review caught it before commit; replaced rather than kept.

#### The useful discovery: no React Testing Library needed

`NEXT_TASK.md` had flagged this task as possibly requiring RTL. **It does not.** The whole `AppShell` mounts under the existing vitest + jsdom setup — `ThemeProvider` + `AuthProvider`, a `next/navigation` mock, `react-dom/client` and React 19's native `act`. Radix and framer-motion need a `ResizeObserver` stub and nothing else. **[D-012](DECISIONS.md) stands and its scope is wider than it looked.**

So the decisive test enters a real demo session, **clicks the actual collapse button**, asserts the sidebar genuinely collapsed, and only then asserts the indicators survive. **Proved by two independent reversions:** removing the banner from `AppShell` fails it, and re-hiding the sidebar marker when collapsed — the original defect, re-injected verbatim — fails it.

> A first attempt at the second reversion broke the file's syntax rather than re-injecting the defect, so the suite failed to collect and proved nothing. Redone as a one-token change (`{demo && …}` → `{demo && !collapsed && …}`), which failed the right test for the right reason.

#### Files

**Added:** `frontend/src/components/layout/demo-mode-indicator.tsx` · `frontend/src/components/layout/demo-mode-indicator.test.tsx` (8 tests).
**Changed:** `app-shell.tsx` (renders the banner) · `topbar.tsx` (renders the badge) · `sidebar.tsx` (marker lifted out of the `!collapsed` wrapper).
**Deleted:** none. No change to the demo architecture, authentication, the backend, or Task 1.3's build gating.

#### Verification

Frontend **37/37** · typecheck PASS · build PASS (21 routes) · lint **87 problems — byte-identical to the baseline, 0 new** · backend **107/107**, untouched.

**Task 1.3's protection re-verified after the change:** 254 demo-exclusive string literals searched across all 46 client assets, **0 present**. The demo-enabled build still ships the demo and the indicator.

#### Recorded honestly, not fixed

The indicator's own UI copy — "Demo mode", "sample data", "Nothing is real" — **is present in the production bundle**, in a component that can never render there. `isDemoMode()` is a compile-time `false`, but it is an imported call, so the minifier cannot prove the strings dead. It is UI text, not fixture data and not a credential; SEC-001's evidence is unaffected. Gating it would mean adding exports to `demo-disabled.ts` and enlarging the surface D-014 has to keep in lockstep, for no security gain. Recorded in BUG-032.

---

### 2026-09-01 — Task 1.3: the demo module is gone from production builds — **SEC-001 CLOSED**

**Phase:** 1 · **Task:** 1.3 · **Type:** security hardening — frontend only · committed in the *"Secure demo mode and authentication"* checkpoint

#### The mechanism, and why it is not the one the roadmap suggested

The roadmap called for an env-flag guard plus tree-shaking, or a dynamic `import()`. Both were rejected because **neither guarantees absence**:

| Rejected | Why |
|---|---|
| Runtime `if (flag)` + tree-shaking | The import stays at module scope. Whether 838 lines of fixtures actually vanish then depends on minifier dead-code analysis and side-effect inference. It might have worked; it could not have been promised — and the requirement was that the *bundler* statically determine the demo is unavailable. |
| Lazy dynamic `import()` | `apiRequest` decides synchronously, and `isDemoMode()` is called synchronously from five other modules. Making it async reshapes a security-critical chokepoint for no gain. |

**Implemented as bundler module replacement instead.** `next.config.ts` sets `turbopack.resolveAlias` so `@/lib/demo` resolves to `frontend/src/lib/demo-disabled.ts` — an inert module with the same 13 exports and no data. `src/lib/demo/` is then never resolved, never parsed, and never enters the module graph. See [DECISIONS.md](DECISIONS.md) D-014.

Two supporting changes make it airtight: `lib/api.ts` now imports through the barrel rather than deep-importing `@/lib/demo/api` and `@/lib/demo/session` (which would have reached straight past the alias), and **the default is exclusion** — unset flag means `next dev` includes the demo and `next build` excludes it, so a deploy pipeline gets the safe variant with nobody remembering anything.

#### The evidence is the build output, not the source

| Searched | `.next/static` |
|---|---|
| `Demo@12345`, `demo.employee@risenext.com`, `DEMO_PASSWORD` | **0** |
| `Karthik Rao` and four fabricated customer names | **0** |
| `risenext.demo.session`, the demo user/bank UUIDs, the demo phone number | **0** |
| `buildDemoDataset`, `getDemoData`, `mutateDemoData`, `nextDemoCode` | **0** |

Hand-picked terms only prove the terms you thought of, so the search was also run **exhaustively**: all 256 string literals (≥ 8 chars) that occur in `src/lib/demo/` and nowhere else in the application source, against all 46 client assets. **Zero found.** The bundler's own record agrees — the only demo-related file in any chunk's sourcemap `sources[]` is `demo-disabled.ts`.

Both directions verified: `NEXT_PUBLIC_ENABLE_DEMO=true npm run build` puts the credential and fixtures back, and `next dev` includes them with no flag set.

#### Drift risk found, and guarded

`tsc` resolves `@/lib/demo` through tsconfig paths, so consumers are **always** type-checked against the real module — the substituted build's types are checked nowhere by default. Three guards: every export typed `typeof DemoEnabled.<name>`; a `Substitute` assignment that fails `npm run typecheck` on a missing or spare export; and a runtime parity test. All three were confirmed to fire, not assumed to — the type assertion caught a real `phone: null` / `phone: string` mismatch during development, and injecting a spare export into the real module fails the parity test.

#### Files

**Added:** `frontend/src/lib/demo-disabled.ts` · `frontend/src/lib/demo-disabled.test.ts` (10 tests).
**Changed:** `frontend/next.config.ts` (the switch) · `frontend/src/lib/api.ts` (barrel import) · `frontend/.env.example` · `README.md` (D-011 discharged).
**Deleted:** none. `frontend/src/lib/demo/` is **byte-identical** — the demo itself was not touched.

#### Verification

Frontend **29/29** · typecheck PASS · build PASS (21 routes) · lint unchanged at 2 pre-existing errors, **0 new warnings** · backend **107/107**, zero backend changes.

Reversion-proved, twice: making the substitute's `isDemoMode()` read storage fails **3** tests; adding an export to the real module fails the parity test. (Notably, the login test still passes under the first reversion — because the Task 1.2 transport guard independently forces `/auth/login` to the network. The layers are genuinely independent.)

#### Documentation defect found and fixed

The Task 1.2 session filed a new finding as **SEC-024**, a number already used by the `documents.storage_key` hazard, and never added it to the register table. Renumbered to **SEC-026** and added.

#### Status

**SEC-001 is CLOSED** — all seven of the user's closure criteria hold, with build-output evidence for criteria 3–5. **One operational rule now carries it:** `NEXT_PUBLIC_ENABLE_DEMO=true` must never be set on a production deployment. Tasks 1.1 and 1.2 remain the protection for demo-enabled builds.

---

### 2026-09-01 — Task 1.2: real authentication can no longer be answered by the demo layer

**Phase:** 1 · **Task:** 1.2 · **Type:** security hardening — frontend only · committed in the *"Secure demo mode and authentication"* checkpoint

#### Auth-path inspection first
Only **one** of the demo's three `/auth/*` handlers is reachable while the demo is active:

| Path | Demo handler | Reachable? | Decision |
|---|---|---|---|
| `/auth/refresh` | returns demo user | **Yes — this IS demo reload restore** | **kept demo-served** |
| `/auth/logout` | returns `{data:null}` | **No** — `signOut` returns at `use-auth.tsx:257`, before the call at `:261` | dead handler → real |
| `/auth/me` | returns demo user | **No** — zero frontend callers | dead handler → real |
| `/auth/login` | none → throws | Yes — BUG-001's symptom | → real |
| `/auth/change-password` | none → throws | Yes, via `/settings` | → real |

#### Implemented as an allow-list, not the roadmap's deny-list (D-013)
`DEMO_SERVED_AUTH_PATHS = {"/auth/refresh"}`; `requiresRealBackend()` returns true for every other `/auth/*`. Same code size, strictly stronger: it **fails closed**, so Phase 3's `/auth/forgot-password`, `/auth/reset-password` and `/auth/accept-invite` are protected before they exist. The defect being fixed is "an auth request was silently answered by fixtures", so the default must be deny.

#### Adversarially reviewed — and it found things
Three independent lenses attacked the change. Outcome:

| Finding | Response |
|---|---|
| **A real regression I introduced** — `/settings` is a demo route and its password form now put a typed credential on the wire (**BUG-031**) | **Fixed** — early return in `handlePasswordUpdate` |
| **Two latent guard holes** — `//auth/login` and `/AUTH/login` bypassed the prefix test; `demoRequest` drops empty segments and Express routes case-insensitively | **Fixed** — collapse repeated slashes, strip `#`, lowercase |
| **A fake test from Task 1.1** — "a forced sign-out clears demo mode" never invoked `forceSignOut`; it would have passed with Task 1.1's change reverted | **Rewritten** to drive the real 401 → refresh-fail → `forceSignOut` ladder |
| **Task 1.1's in-flight discard was untested** — `use-auth.tsx:146` could be deleted with the suite still green | **Test H added**; verified it fails when the guard is removed |
| **My own new settings test was tautological** — it mirrored the guard in the test body, so it passed with the guard deleted | **Removed rather than kept as false assurance.** Gap recorded in BUG-031 |
| **SEC-024** — `POST /users`, `POST /users/:id/reset-password`, `PATCH /users/:id` are credential operations outside `/auth/*` and still demo-answerable | **Recorded, not fixed** — out of scope; Phase 1.3 / 2. *(Renumbered **SEC-026** in Task 1.3: SEC-024 was already in use.)* |

#### Files changed
`frontend/src/lib/api.ts` (allow-list + `requiresRealBackend` + guard) · `frontend/src/app/(app)/settings/page.tsx` (demo guard on password change) · `frontend/src/hooks/use-auth.demo-boundary.test.tsx`

#### Tests — 19 total (was 18; +7 added, −1 tautological removed)
Group F (6) drives `apiRequest` **directly**, bypassing Task 1.1's clearing, so only the transport guard can make them pass. Group G proves demo reload restore. Group H proves Task 1.1's in-flight discard.

**Verified by reversion, twice:** removing the transport guard fails **2** tests; removing the in-flight discard fails **1**; and every demo test keeps passing throughout, confirming the demo is untouched.

#### Validation
Frontend **19/19** · typecheck ✅ · build ✅ · backend **107/107** unchanged. Frontend lint unchanged (2 pre-existing errors).

#### SEC-001 — still OPEN at HIGH
Diversion is now closed at both layers. **Exposure is not**: the demo password and 838 lines of fabricated PII still compile into the public production bundle. **Only Task 1.3 closes SEC-001.**

#### Docs updated
`SECURITY_AUDIT.md` (SEC-001 item 2 closed; **SEC-024** added) · `BUGS_AND_ISSUES.md` (BUG-001 note; **BUG-031** added) · `DECISIONS.md` (**D-013**) · `CURRENT_STATE.md` · `FEATURE_STATUS.md` · `INTEGRATION_MAP.md` · `PRODUCTION_READINESS.md` (X21 added; 156 items) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` · `CHANGELOG.md`

#### Next
**Task 1.3** — gate the demo module out of production builds. Closes SEC-001.

---

### 2026-09-01 — Task 1.1: demo mode cleared on entry into a real session · **BUG-001 FIXED**

**Phase:** 1 (Demo isolation + authentication integrity) · **Task:** 1.1 · **Type:** bug fix + security — **first behavioural change of the project** · committed in the *"Secure demo mode and authentication"* checkpoint

#### Root cause
Demo mode is a `sessionStorage` flag, and `frontend/src/lib/api.ts:118` diverts **every** call into the in-browser fixture layer while it is set. Nothing cleared it on the way into a real session, so a real sign-in in a tab that had once run the demo was routed to `demoRequest` — which has no `/auth/login` handler — and failed with *"Endpoint not found"*. A reload re-entered the demo and made the login form unreachable.

#### Fixed — three clearing points, all frontend
| Where | File | Why there |
|---|---|---|
| `signIn`, **real** branch | `hooks/use-auth.tsx` | After the demo-credential check, **before the request is built**. Ordering is the fix: clearing first would break entering the demo; clearing later would not stop the diversion |
| `onForcedSignOut` handler | `hooks/use-auth.tsx` | A session ending must not leave the tab in demo mode |
| Login page **mount only** | `app/login/page.tsx` | `/login` is outside `DEMO_ROUTES`, so arriving mid-demo means leaving it. **Mount-only is deliberate** — on every render it would clear the flag `signIn` sets a moment earlier, in the window before `router.push` leaves the page, breaking demo sign-in |

#### Plus a race the original analysis missed
In a contaminated tab, `AuthProvider`'s `/auth/refresh` is **already in flight** when the login page mounts. Clearing the flag does not cancel it — it resolved ~140 ms later and re-set the demo user, re-trapping the tab. `AuthProvider` now captures `startedInDemo` before the call and discards the response if the demo was exited while it was in flight.

#### Added
- `exitDemoSession()` on the auth context — ends a demo session without a network round trip and reports whether one was running.
- **The repository's first frontend test infrastructure**: `vitest@^3.2.4` + `jsdom` only, no component library (**D-012**). React 19 exports `act` and `react-dom/client` is already a dependency, so the provider is mounted in ~25 lines of helper — 2 packages instead of 5.
- `frontend/vitest.config.ts`, `frontend/src/test-setup.ts`, and `test` / `test:watch` scripts.

#### Files changed
`frontend/src/hooks/use-auth.tsx` · `frontend/src/app/login/page.tsx` · `frontend/package.json` (+2 devDeps, +2 scripts)
**New:** `frontend/src/hooks/use-auth.demo-boundary.test.tsx` · `frontend/vitest.config.ts` · `frontend/src/test-setup.ts`

#### Tests — 11 added, and **proven to catch the regression**
Groups A–E as specified: fresh-tab real login · demo login · **demo active then real login (the regression)** · leaving a demo session · demo still works in both directions.

**The fix was temporarily reverted and the suite re-run: 3 tests failed** — the two in group C and the demo→real→demo scenario in E. The other 8 passed, correctly, because they cover behaviour that already worked. A regression test that passes before the fix would have been worthless.

#### Validation
| Gate | Result |
|---|---|
| Frontend tests | ✅ **11/11** (2.41 s) |
| Frontend typecheck | ✅ 0 errors |
| Frontend build | ✅ 21 routes |
| Backend tests | ✅ **107/107** unchanged |
| Frontend lint | 2 errors, both **pre-existing** and proven so — `settings/page.tsx:133` (untouched file) and `use-auth.tsx:116` (`setUser(parsed)`, present at HEAD line 108; every one of my hunks starts at +125). **Zero new problems** in the files touched |

#### Status changes
- **BUG-001 → RESOLVED** (pending review).
- **SEC-001 → still OPEN, CRITICAL → HIGH.** The *accidental* contamination path is closed; the *deliberate* one is not. `DEMO_PASSWORD` and 838 lines of fixtures still ship in the production bundle (Task 1.3), and `apiRequest` still intercepts `/auth/*` when the flag is set by other means (Task 1.2). **Deliberately not marked fixed.**

#### New finding recorded, not fixed
`npm run lint` in `frontend/` was never one of the five documented gates, so its **2 errors and 85 warnings** had never been surfaced. Both errors are `react-hooks/set-state-in-effect`. Out of scope for Task 1.1; candidates for Phase 14.

#### Docs updated
`BUGS_AND_ISSUES.md` (BUG-001 resolved) · `SECURITY_AUDIT.md` (SEC-001 partial) · `DECISIONS.md` (**D-012**) · `CURRENT_STATE.md` · `FEATURE_STATUS.md` · `INTEGRATION_MAP.md` · `PRODUCTION_READINESS.md` (X15 → DONE, Q5 → IN PROGRESS; 46 → 47 DONE of 155) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` (rewritten for **Task 1.2**) · `CHANGELOG.md`

#### Next
**Task 1.2** — exclude `/auth/*` from the `apiRequest` short-circuit. Note the trade-off documented in `NEXT_TASK.md`: a blanket exclusion would break demo session persistence across reloads, because the demo relies on intercepting `/auth/refresh`.

---

### 2026-09-01 — Tasks 0.6–0.7: README corrected, demo mode documented · **PHASE 0 COMPLETE**

**Phase:** 0 (Repository safety and baseline) · **Tasks:** 0.6, 0.7 · **Type:** documentation — **no application code modified** · committed in the Phase 0 checkpoint

#### Corrected in `README.md` — five verifiable falsehoods
| Claim | Was | Now | Verification |
|---|---|---|---|
| Triggers | "**9 triggers**" | **7** | `grep -ciE "^CREATE TRIGGER" drizzle/*.sql` → 7 |
| Tests | "**82 tests** across three files" | **107 across four** | 26 + 22 + 34 + 25; verified by Task 0.1 |
| Frontend | "`frontend/` — **UNMODIFIED**, reference only until Step 3" | Removed | It was mechanically rewritten before the first commit — D-009 |
| Deployment | "`backend/` … **deployed to Railway**" | Removed | Contradicted by the same file's *"Not deployed."* |
| Test engine | "a real **PostgreSQL 18** engine" | "a real PostgreSQL engine compiled to WASM" | **Unverifiable** — PGlite states no version in its package. Softened rather than restated as fact |

#### Corrected — one overstated claim
`frontend-contract.test.ts` was described as *"replays **every** request the frontend actually issues"*. It replays a **hand-maintained list of 25 GET requests**, is GET-only, and runs **every** request as `super_admin`. The description now says so, and notes it does not prove the frontend calls those endpoints. Also added: *"There are currently no frontend tests and no end-to-end tests, and no CI pipeline."*

#### Added
- **A "Demo mode — client presentations only" section.** The word "demo" previously appeared **zero times** in the README, despite a demo layer that intercepts every API call. Documents the credential (clearly labelled fictional — see D-011), that it is frontend-only and never transmitted, that no such user exists in `users`, what the demo employee can see, **the stickiness defect (BUG-001) with its workaround**, and that Phase 1 will stop the credential working in production builds.
- **A project-status banner** at the top pointing at `docs/README.md` as the source of truth, and stating plainly that the frontend is incomplete and the app has never been deployed.
- **The 5 env vars missing from the table** — `NODE_ENV`, `PORT`, `COOKIE_DOMAIN`, `FRONTEND_URL`, `MAX_UPLOAD_MB` — plus `LOG_LEVEL`, with `.env.example` named as authoritative.
- `POST /:id/reset-password` to the `/api/users` row, stale since `583897f`.

#### Deliberately left unchanged — verified correct
The index counts (**121 / 49**) are right when counted from `pg_indexes`, which includes implicit primary-key indexes: 94 explicit `CREATE [UNIQUE] INDEX` statements + 27 table PKs. A clarifying parenthetical was added rather than a correction. Also untouched: 27 tables, 62 FKs, the architecture diagram, roles table, permission model, Excel-import walkthrough, data-protection section, and the `cd CMBBACKEND && cp .env.example .env` instruction (made correct by Task 0.3) and the `.gitignore` claim (made correct by Task 0.4).

#### `frontend/README.md` — marked historical (Task 0.7)
Prefixed with an unmissable **HISTORICAL / LEGACY DOCUMENTATION** notice, a table of its **seven** known-false statements each checked against the code, and pointers to current docs. Original content preserved beneath, per instruction not to delete or rewrite it.

#### Validation — 9 checks, all passing
`.env.example` referenced correctly and exists · `.gitignore` claim now true and root file exists · demo credentials documented · stale strings (`UNMODIFIED`, `82 tests`, `9 triggers`, `PostgreSQL 18`, `deployed to Railway`) all absent · corrected values present · `frontend/README.md` marked historical with content preserved (77 → 105 lines) · **no application source, backend, database, migration or dependency change** · **the staged `__pycache__` deletion remains staged** · Phase 0 docs internally consistent.

#### Docs updated
`DECISIONS.md` (**D-011** — the demo-credential decision and its Task 1.3 expiry) · `CURRENT_STATE.md` · `FEATURE_STATUS.md` · `PRODUCTION_READINESS.md` (new item O0d; scorecard 45 → 46 DONE of 155, **30%**) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` (rewritten for **Task 1.1**) · `CHANGELOG.md`

---

## ✅ PHASE 0 — COMPLETE

Seven tasks, 2026-08-31 → 2026-09-01. Deliberately non-behavioural: **verify, protect, configure, document**.

| Task | Outcome |
|---|---|
| 0.1 | Baseline verified — 5/5 gates, 107/107 tests |
| 0.2 | Employee work reviewed against 15 criteria, committed as **`583897f`** |
| 0.3 | `.env.example` — 17 variables, schema-validated in 5 postures |
| 0.4 | Root `.gitignore` — 8 validation tests |
| 0.5 | Tracked Python bytecode untracked (staged); D-009 executed |
| 0.6–0.7 | README corrected, demo mode documented, `frontend/README.md` marked historical |

**Definition of Done — all six satisfied.** Readiness moved **40 → 46 of 155 (27% → 30%)**.

**What Phase 0 did *not* do:** it advanced **no feature and no security finding**. All 13 fake handlers, the demo-mode hijack, the missing file storage and the missing email subsystem are exactly as recorded. The one code commit was pre-existing work reviewed and committed, not new development.

All Phase 0 output was packaged into a single checkpoint commit, **"Complete Phase 0 repository preparation"**, containing `.env.example`, the root `.gitignore`, the `__pycache__` removal, the `README.md` / `frontend/README.md` corrections, and the full `docs/` tree. `frontend/next-env.d.ts` was deliberately excluded as a generated build artefact.

**Next: PHASE 1 — the first work that changes application behaviour.**

---

### 2026-09-01 — Task 0.5: tracked Python bytecode artefact untracked

**Phase:** 0 (Repository safety and baseline) · **Task:** 0.5 · **Type:** repository hygiene — **no application code modified** · committed in the Phase 0 checkpoint

#### Removed from tracking
`frontend/__pycache__/rewire.cpython-312.pyc` — 12,489 bytes of CPython 3.12 bytecode, blob `28e3028`, introduced by `beac90c` ("first commit").

Removed with **`git rm --cached`**. The file **remains on disk**, deliberately: the roadmap says *untrack*, not *delete*, and the artefact is the only surviving physical evidence of the conversion script described in [DECISIONS.md](DECISIONS.md) D-009. It now costs nothing to keep locally because Task 0.4's `.gitignore` covers it.

#### Why it did not belong
Build output rather than source · **no Python toolchain exists anywhere in the project** (no `.py`, no `requirements.txt`, no `pyproject.toml`, no CI step) · compiled bytecode is unauditable in a diff and its `rewire.py` source is absent · version-locked to CPython 3.12.

#### Safety checks before acting
1. File confirmed tracked (blob shown). 2. Confirmed already matched by `.gitignore:76:__pycache__/`. 3. Confirmed it was the **only** tracked Python artefact repository-wide.

#### Validation — 5 tests, all passing
| # | Test | Result |
|---|---|---|
| 1 | File still exists on disk | ✅ 12,489 bytes, unchanged |
| 2 | Git no longer tracks it | ✅ `git ls-files frontend/__pycache__/` empty |
| 3 | `.gitignore` now ignores it | ✅ `git check-ignore` reports it **without** `--no-index` |
| 4 | No other tracked `__pycache__` / `*.pyc` remain | ✅ **zero** repository-wide |
| 5 | No application source changed | ✅ `src`, `frontend/src`, `drizzle/`, both `package.json`, both lockfiles all clean |

Tracked file count **146 → 145** — exactly one path left the index.

#### A git behaviour worth remembering
Before this task the file was in the unusual state of being **matched by a gitignore rule yet fully tracked**. `.gitignore` is not retroactive — it only affects untracked files — and `git check-ignore` **skips tracked files by default**, so a naive check reports nothing. The fact that `git check-ignore` now succeeds without `--no-index` is itself the proof the removal worked.

#### State
The removal is **staged and uncommitted** (`git status` shows `D  frontend/__pycache__/rewire.cpython-312.pyc`). It takes effect in the repository only when committed.

#### Docs updated
`DECISIONS.md` (D-009 marked **EXECUTED**, with a full execution record — updated in place rather than duplicated) · `CURRENT_STATE.md` · `PRODUCTION_READINESS.md` (new item O0c; scorecard 44 → 45 DONE of 154) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` (rewritten for Tasks 0.6–0.7) · `CHANGELOG.md`

#### Next
**Tasks 0.6–0.7** — correct the stale claims in `README.md` ("9 triggers" → 7, "82 tests" → 107, the "UNMODIFIED frontend" line), add a demo-mode section, and mark `frontend/README.md` historical. **This completes Phase 0.**

---

### 2026-09-01 — Task 0.4: root `.gitignore` created

**Phase:** 0 (Repository safety and baseline) · **Task:** 0.4 · **Type:** repository hygiene — **no application code modified** · committed in the Phase 0 checkpoint

#### Added
Root `.gitignore`, closing two real gaps:

1. **There was no root `.gitignore` at all.** A `.env` created at the repository root — beside the `.env.example` that invites exactly that `cp` — would have been committed.
2. **`frontend/.gitignore` covers only `.env*.local`.** A plain `frontend/.env`, created by the same habit `README.md:28` teaches for the backend, would have been committed.

`README.md:52` already claimed *"Never commit `.env`. `.gitignore` covers it."* — now true for the first time.

#### Categories protected
Secrets (`.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`) · dependencies (`node_modules/`) · build output (`.next/`, `out/`, `dist/`, `build/`, `*.tsbuildinfo`) · Python artefacts (`__pycache__/`, `*.py[cod]`, `*$py.class`) · logs · coverage · editor/OS files · `.vercel`.

Negations preserve the documented setup path: `!.env.example` and `!.env.*.example`, placed **after** `.env.*` because the last matching pattern wins.

#### Non-contradictory by design
`.gitignore` and `frontend/.gitignore` are **unmodified** and remain the more specific authority. Verified layering: `.env` resolves via `.gitignore:4`, `frontend/.env.local` via `frontend/.gitignore:8`, and `frontend/.env` via the new root rule — the gap that previously had no cover. `frontend/next-env.d.ts` is deliberately **not** ignored; Next.js regenerates it and the project tracks it.

#### Validation — 8 tests, all passing
| # | Test | Result |
|---|---|---|
| 1 | All three `.env.example` files remain visible to git | ✅ **critical** — `.env.example` is untracked, so a mis-ordered negation would have silently undone Task 0.3 |
| 2 | `.env` ignored at root, `backend/`, `frontend/`, `docs/`, plus `.env.local` / `.env.production` variants | ✅ recursive |
| 3 | `node_modules`, `.next`, `dist`, `build`, `out`, `__pycache__`, `*.pyc`, `*.log`, `coverage`, `.DS_Store` ignored at every depth | ✅ |
| 4 | Legitimately tracked files (`next-env.d.ts`, `README.md`, `package.json`, source, migrations) still visible | ✅ no false positives |
| 5 | Tracked-file count **146 before, 146 after**; `comm` diff shows none lost, none gained | ✅ |
| 6 | The pre-existing tracked `.pyc` was **not** silently removed | ✅ |
| 7 | Which tracked files are now ignored-but-tracked | ✅ exactly one, below |
| 8 | `git status` free of surprises | ✅ |

#### Already-tracked artefact found — cleanup deliberately DEFERRED
`frontend/__pycache__/rewire.cpython-312.pyc` (12,489 bytes, committed in `beac90c`) **matches** the new rule at `.gitignore:76` — but `.gitignore` only affects untracked files, so it remains in the index and **will still be committed** until explicitly removed.

Per the task's git-safety instruction it was **not** removed here. That is **Task 0.5**, which needs its own [DECISIONS.md](DECISIONS.md) D-009 record.

Behavioural note worth remembering: `git check-ignore` **skips tracked files by default**, which is why test 7 appeared empty. `git check-ignore --no-index` confirms the match. A file can be simultaneously "matched by .gitignore" and "fully tracked" — the rule is not retroactive.

#### Docs updated
`CURRENT_STATE.md` · `PRODUCTION_READINESS.md` (new item O0b; scorecard 43 → 44 DONE of 153, 29%) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` (rewritten for Task 0.5) · `CHANGELOG.md`

#### Next
**Task 0.5** — untrack `frontend/__pycache__/rewire.cpython-312.pyc` with `git rm --cached` (leaving it on disk).

---

### 2026-09-01 — Task 0.3: `.env.example` created

**Phase:** 0 (Repository safety and baseline) · **Task:** 0.3 · **Type:** config template — **no application code modified** · committed in the Phase 0 checkpoint

#### Added
`.env.example` — the file `README.md` had referenced twice without it existing, which made the documented setup fail at step 3 of 6.

#### Variables discovered — 17, from three sources
| Source | Count | Notes |
|---|---|---|
| `src/config/env.ts` zod schema | 16 | The authority; validated on boot, throws on failure |
| `src/lib/logger.ts:3` | 1 (`LOG_LEVEL`) | Read **raw**, outside the schema, **unvalidated** — a typo falls through silently |
| `drizzle.config.ts:7` | 0 new | Reads `DATABASE_URL` directly, **not** `DIRECT_DATABASE_URL` — an inconsistency with `db:migrate`, documented in the file |

Required (no default): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
Optional (no default): `DIRECT_DATABASE_URL`, `COOKIE_DOMAIN`, `BOOTSTRAP_SUPERADMIN_EMAIL`, `BOOTSTRAP_SUPERADMIN_PASSWORD`.
Defaulted: `NODE_ENV`, `PORT`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `CORS_ORIGIN`, `FRONTEND_URL`, `RECYCLE_BIN_RETENTION_DAYS`, `MAX_UPLOAD_MB`, `AADHAAR_PEPPER`.

Five production tripwires are called out in comments: `NODE_ENV` (drives the refresh-cookie flags — wrong value silently signs users out on reload), `AADHAAR_PEPPER` (boot fails on the default; rotating invalidates every stored hash), `JWT_*` (≥32 chars, must differ in production), `BOOTSTRAP_SUPERADMIN_*` (if either is unset the seed creates **no user at all**), `COOKIE_DOMAIN` (leave unset for a split deployment).

Two variables documented honestly rather than aspirationally: `FRONTEND_URL` is declared and defaulted but **read by nothing in application code** — only the test harness; `RECYCLE_BIN_RETENTION_DAYS` only stamps `purge_after` because the job that would act on it does not exist.

#### Deliberate design choice
`AADHAAR_PEPPER` ships as the **dev default** rather than a fresh-looking placeholder. The production guard rejects only that exact string, so shipping anything else would let a copied file boot in production under a pepper published in this repository. Leaving the default intact means a verbatim copy **fails loudly at boot** — the designed behaviour. Confirmed by validation posture 2 below.

#### Validated against the real zod schema
Executed `loadEnv()` with the file's parsed values in five postures — no database, no server:

| # | Posture | Result |
|---|---|---|
| 1 | dev, copied verbatim | **BOOTS** — `NODE_ENV=development`, `PORT=8080` ✅ |
| 2 | production, copied verbatim | **REFUSES** — *"AADHAAR_PEPPER must be set to a unique value in production"* ✅ |
| 3 | production, pepper replaced | **BOOTS** ✅ |
| 4 | production, identical JWT secrets | **REFUSES** — *"JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ"* ✅ |
| 5 | `DATABASE_URL` removed | **REFUSES** ✅ |

Key diff `comm`-verified: every one of the 16 schema keys is present; the only extra is `LOG_LEVEL`, which is a genuine raw read.

#### README
**No edit required.** Creating the file made both previously broken references (`README.md:28` and `:202`) resolve correctly.

Noted, **not changed** (Task 0.6 scope): the README env-var table omits five schema variables — `NODE_ENV`, `PORT`, `COOKIE_DOMAIN`, `FRONTEND_URL`, `MAX_UPLOAD_MB`; and the root `.env.example` now duplicates the backend file while omitting `AADHAAR_PEPPER` and carrying a frontend-only key.

#### Security finding recorded (not fixed — out of scope, candidate for Phase 13)
`AADHAAR_PEPPER` has a known-bad-value guard that fails production boot. **`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` have no equivalent guard** — only a "must differ" check. A deploy that copies the example's placeholder secrets therefore **boots in production with a publicly known signing key**. Posture 3 above demonstrates this.

#### Docs updated
`CURRENT_STATE.md` (§6 setup reality) · `PRODUCTION_READINESS.md` (new item O0; scorecard 42 → 43 DONE of 152) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` (rewritten for Task 0.4) · `CHANGELOG.md`

#### Next
**Task 0.4** — add a root `.gitignore`. There is currently none, so a `.env` at the repository root would be committed, and `frontend/.gitignore` covers only `.env*.local`.

---

### 2026-09-01 — Task 0.2: employee management flow reviewed and committed

**Phase:** 0 (Repository safety and baseline) · **Task:** 0.2 · **Type:** review + commit
**Commit:** [`583897f`](https://github.com/RiseNext/Risenext-Banking-CRM/commit/583897fc3eb46ac894fc24ffeb5f0de60a7d70be) — *"Complete employee management flow"* · 12 files, **+1,426 / −184** · **not pushed** (`main` is 1 ahead of `origin/main`)

#### Reviewed
The complete 12-file change set was read and checked against 15 criteria before committing. Tests passing was explicitly **not** treated as sufficient evidence.

| Check | Finding |
|---|---|
| Employee creation calls the real backend | ✅ `POST /users` → `admin.routes.ts:159`, path matches exactly |
| Frontend consumes the returned temporary password | ✅ `employees/page.tsx:177-183` — the value HEAD discarded |
| Password displayed appropriately | ✅ One-time panel, explicit copy, honest "will not be shown again" warning |
| Password exposed anywhere it should not be | ✅ **No** `console.*`, `localStorage`, `sessionStorage`, or network echo in any changed file |
| Admin reset uses the real backend | ✅ `POST /users/:id/reset-password`, `users.reset_password` + hierarchy guard, transactional, revokes all refresh tokens, audited |
| Forced password change works | ✅ Shell guard + `/change-password` page → `POST /auth/change-password` |
| Employee logs in through normal auth | ✅ Proven by `employee-lifecycle.test.ts:124-130` |
| Role / team / bank assignment | ✅ One transaction; `teamId` gated on `teams.assign` and existence-checked |
| Default employee role safe | ✅ **Defect fixed** — was `roles[0]` (Super Admin, ascending level); now an explicit required choice |
| Accidental Super Admin assignment | ✅ None. A Super Admin may still *deliberately* select it, matching `assertCanAssignRole` |
| Existing permissions preserved | ✅ `lib/permissions.ts` **untouched** |
| Existing users unaffected | ✅ No seed, migration or data change — see the operational note below |
| Unrelated functionality modified | ✅ None. Settings diff is confined to the password section |
| Accidental backend/database changes | ✅ **None** — `drizzle/`, `db/schema/`, `db/seed.ts`, both `package.json` and both lockfiles all untouched |
| Security problems introduced | ✅ None found. Net security improvement |

**Demo mode untouched:** `frontend/src/lib/api.ts` and all of `frontend/src/lib/demo/` are byte-identical. Credentials unchanged.

#### Changed on `main`
Four flows that previously simulated success now perform it: employee creation (credential handed over instead of discarded), admin password reset (real route replacing a fabricated *"Reset link sent — emailed to …"* toast), revoke/restore access (real `PATCH` replacing local state), and the settings password change (real call replacing a bare toast over unbound inputs). The fake employee-permissions panel was removed. `generateTemporaryPassword()` replaces `randomToken(12)`, which was never validated against the password policy.

#### Not committed (deliberate)
- `frontend/next-env.d.ts` — Next.js build artefact from Task 0.1, unrelated to this work.
- All of `docs/` — documentation, kept out of an application commit.

#### Verified
Backend gates re-run immediately before committing: typecheck **PASS**, lint **PASS**, tests **107/107 PASS** (39.50 s). Frontend gates were verified in Task 0.1 and the frontend files were not altered during review.

#### Operational note — behaviour change on existing deployments
The forced-password-change guard is **live for the first time**. `mustChangePassword` is now returned on the profile and honoured by the shell. Any existing account with `must_change_password = true` — **including the seeded bootstrap Super Admin** (`seed.ts:121`) — will be redirected to `/change-password` on next sign-in until they set their own password. Intended and correct, but visible.

#### Limitations that remain (unchanged by this commit)
- **Credential delivery is still manual.** No email exists; the password is read off a screen with no record of delivery. Phase 3.
- **Forced change is enforced only in React** (SEC-010 / BUG-005 — *this line said SEC-009 until 2026-09-02; SEC-009 is a different, still-open P0*). A temporary password still grants full API access via curl. Phase 2.3. **Closed 2026-09-02 by Task 2.3.**
- **`PATCH /users/:id` still has no self-guard and no last-super-admin guard** (SEC-003 / BUG-003) — and this commit wires the UI button that reaches it, so the one-click lockout is now genuinely reachable. Phase 2.1.
- **Demo mode still hijacks real login** (BUG-001). Unchanged. The employee screen remains unreachable in a contaminated tab. Phase 1.
- Employee **edit** and **delete** UIs still do not exist; bank/team reassignment after creation is still impossible. Phase 2.

#### Docs updated
`CURRENT_STATE.md` (§1 tree state collapsed to committed) · `FEATURE_STATUS.md` (9 rows lose the "working tree only" footnote) · `PRODUCTION_READINESS.md` (A8 → DONE; E1–E4, E8, E9 unqualified; scorecard 41 → 42 DONE, 28%) · `BUGS_AND_ISSUES.md` (tree-state note) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` (rewritten for Task 0.3) · `CHANGELOG.md`

#### Next
**Task 0.3** — create `.env.example` complete against `env.ts`, including `AADHAAR_PEPPER`.

---

### 2026-08-31 — Task 0.1: baseline verification

**Phase:** 0 (Repository safety and baseline) · **Task:** 0.1 · **Type:** verification — **no application code was modified**

#### Verified
All five documented quality gates run against the working tree at commit `7ef5da5`. **5 of 5 PASS.**

| Gate | Result |
|---|---|
| Backend typecheck (`tsc --noEmit`) | ✅ PASS — 0 errors |
| Backend lint (`eslint src`) | ✅ PASS — 0 errors, 0 warnings |
| Backend tests (`vitest run`) | ✅ PASS — **107 passed / 107**, 4 files, 43.83 s |
| Frontend typecheck (`tsc --noEmit`) | ✅ PASS — 0 errors |
| Frontend build (`next build`) | ✅ PASS — 21 routes, compiled 9.0 s |

Per-file: `employee-lifecycle` 25 · `authorization` 26 · `workflow` 22 · `frontend-contract` 34. **Matches the documented 107 exactly** — no discrepancy to explain. Suite ran entirely on in-memory PGlite; no external database was contacted. Dependencies were already installed; **no `npm ci` or `npm install` was run**.

#### Outcome
- **Known failures: none.** No gate failed; no pre-existing defect was surfaced.
- **The uncommitted employee work is verified** — it compiles, lints, builds, and its 25 tests pass, including the create→login end-to-end assertion at `src/tests/employee-lifecycle.test.ts:124-130`. It is safe to commit (Task 0.2).
- ⚠️ A green baseline proves the code compiles and the backend contracts hold. It proves **nothing** about the 13 fake handlers, the demo-mode hijack, the missing file storage or the missing email — there are zero frontend and zero E2E tests, and every backend test runs as `super_admin`.

#### Side effect
`frontend/next-env.d.ts` was rewritten by `next build` (`./.next/dev/types/routes.d.ts` → `./.next/types/routes.d.ts`). Next.js-generated, semantically inert, flips back on the next `next dev`. **Deliberately not reverted** — reverting requires a `git checkout` over the working tree, prohibited by this task's constraints.

#### Corrected
- Frontend page count: **18** under `(app)` in the working tree (17 at HEAD + the untracked `change-password`), not 17. Earlier docs said 17 without the qualifier.

#### Docs updated
`CURRENT_STATE.md` (new §5 Baseline Verification) · `claude/CURRENT_PROGRESS.md` · `claude/NEXT_TASK.md` (rewritten for Task 0.2) · `PRODUCTION_READINESS.md` (new item Q0; scorecard 150→151 items, 40→41 DONE) · `CHANGELOG.md`

#### Next
**Task 0.2** — review the uncommitted employee work in full and commit it as one reviewed commit. **Blocked on explicit user approval.**

---

### 2026-08-31 — Documentation system and production roadmap established

**Phase:** 0 (Repository safety and baseline) · **Type:** documentation only — **no application code was modified**

#### Added
- **22 documentation files** under `docs/` and `docs/claude/`, establishing `docs/` as the single source of truth.
- [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md) — the master execution plan: 16 phases from the current state to production, each with a goal, the problems it solves, existing functionality to reuse, tasks with effort estimates, dependencies, required tests, and a Definition of Done.
- [AUDIT_VERIFICATION.md](AUDIT_VERIFICATION.md) — independent re-verification of every claim in the previous audit, with **12 documented corrections**.
- `docs/claude/` — a five-file session-continuity system (`PROJECT_CONTEXT`, `CURRENT_PROGRESS`, `NEXT_TASK`, `RULES`, `SESSION_HANDOFF`) so context survives between sessions.
- [DECISIONS.md](DECISIONS.md) — 10 recorded decisions and **10 open decisions** that block their phases.

#### Verified (read-only; no changes made)
- **96 endpoints** in the working tree, **95 at HEAD** — 52/51 hand-written + 44 factory-generated, with the per-resource arithmetic recorded.
- **27 database tables**, 62 foreign keys, 7 triggers, **zero CHECK constraints**, **zero schema drift** between the TS schema, the migration SQL and the drizzle snapshot.
- **107 backend test cases** across 4 files; **zero** frontend tests, **zero** E2E tests, **zero** CI workflows.
- **No email subsystem of any kind** — no provider, transport, template, config key or stub, confirmed by exhaustive grep.
- **No file storage** — `multer` is used only by the Excel importer, in memory, and the buffer is discarded.
- **13 UI controls** report success and issue no HTTP request.
- **Demo mode is sticky** — `disableDemoMode` has exactly one call site, inside `signOut`. This is the confirmed root cause of "Super Admin cannot add an employee".
- The `app_settings` table and the `notifications` producers are completely absent from the codebase.

#### Corrected from the previous audit
| # | Was | Now |
|---|---|---|
| D-1 | "~10 fake actions" | **13**, enumerated with file:line |
| D-2 | Documents rated PARTIAL | **BROKEN** — the UI asserts the file was stored and offers a Download for a file that does not exist |
| D-3 | Employee failure = "temp password discarded" | Correct but **secondary**. The primary cause is demo-mode stickiness, unfixed in both HEAD and the working tree |
| D-4 | Demo "can remain in the demo path" | Understated — a reload **auto-authenticates the visitor as the demo Executive with no credentials** |
| D-5 | not stated | The demo password and all 838 lines of fabricated PII **ship in the production bundle for every visitor** |
| D-6 | "sensitive PII handling" | Specifically: the peppered Aadhaar **hash is returned in every customer response**, under a pepper with a committed default |
| D-7 | not checked | `README.md` claims **9 triggers**; there are **7** |
| D-8 | not identified | The `app_settings` table is **completely dead** — the root cause of Settings persisting nothing |
| **D-9** | "27 endpoints used, 69 dead (72%)" | **38 used, 58 dead (60%).** The 27 figure counted only the GET-only `FRONTEND_CALLS` test array and omitted all 16 write paths |
| **D-10** | "96 endpoints" | **96 in the working tree, 95 at HEAD** — `POST /users/:id/reset-password` exists only in the uncommitted work |
| **D-11** | Ledger 403 = "lacks `system.access_all_banks`" | **Wrong cause.** Manager/Team Leader/Executive lack **`ledger.create` itself** and are rejected at `requirePermission` before any bank check. Two independent defects |
| **D-12** | "`storage_key` never populated" | Imprecise — it **is** accepted by the create schema and would persist if sent. What is true is that nothing ever produces one |

#### Known state at the time of writing
- Working tree **dirty**: 8 modified + 4 untracked files (~1,242 lines) implementing employee creation, temporary passwords, admin reset and forced password change. **Never verified to compile, lint or pass.** Task 0.1 addresses this.
- Overall completion **≈45%** — backend ~80%, database ~90%, frontend ~35%, integration ~40%, operations ~5%.
- Production readiness: **40 of 150 criteria met (27%)**. Verdict **NO-GO**.

#### Next
Task 0.1 — run the four quality gates against the working tree and record the baseline in [CURRENT_STATE.md](CURRENT_STATE.md). See [claude/NEXT_TASK.md](claude/NEXT_TASK.md).

---

## Prior history (from git, before this changelog existed)

| Date | Commit | Summary |
|---|---|---|
| 2026-08-29 | `7ef5da5` | **"Add frontend-only employee demo"** — 2,300 lines across 13 files: a complete parallel fake backend under `frontend/src/lib/demo/` (1,814 lines), a new `/my-work` route, and a 17-line global short-circuit in `lib/api.ts`. **No backend code, no test, no documentation.** |
| 2026-08-18 | `d156f7d`…`7b04295` | Six frontend-only commits: customer page refactor, settings phone state, `updateUser` on AuthContext, import and button-action changes. |
| 2026-08-17 | `291419f` | "Initial project setup" — lands **four days after** "first commit" and adds 260 lines to three files that already existed. Evidence of two snapshots being reconciled. |
| 2026-08-13 | `beac90c`…`a18f575` | **`beac90c` "first commit" dumps the entire system in one shot: 134 files, 44,623 insertions** — the whole backend (27 tables, 3 migrations, 21 route modules, 3 test files), the rewired frontend, `README.md` and `docs/FRONTEND_ANALYSIS.md`. There is **no incremental record of the backend being built**, and it has been touched by **exactly one commit in its entire life**. |

**Observations worth carrying forward:** 11 of 13 commit messages are non-descriptive (`Update page.tsx` ×3). `README.md` and both other docs have been touched by exactly one commit and have never been updated despite ~3,500 lines of subsequent change. A tracked `frontend/__pycache__/rewire.cpython-312.pyc` — Python bytecode whose source is not in the repository, in a project with no Python toolchain — indicates the frontend was mechanically converted from a mock module by an unversioned script that tolerated per-function failures. See [DECISIONS.md](DECISIONS.md) D-009.

---

## ENTRY TEMPLATE

```markdown
### YYYY-MM-DD — <short title>

**Phase:** <n> (<name>) · **Task:** <n.n> · **Type:** feature | fix | security | docs | refactor | test | infra

#### Added / Changed / Fixed / Removed
- <what, and why> — `<file:line>`

#### Verified
- backend: typecheck <pass/fail> · lint <pass/fail> · tests <n passed / m failed>
- frontend: typecheck <pass/fail> · build <pass/fail>
- End-to-end trace: <what was proven, with file:line>

#### Docs updated
- <list>

#### Next
- <the task now in claude/NEXT_TASK.md>
```
