# DECISION LOG

Architectural and process decisions, newest first. **Record every non-obvious choice here**, including accepted risks and deliberate deferrals.

**Format:** ID · date · status (`ACCEPTED` / `SUPERSEDED` / `PROPOSED` / `OPEN`) · context · decision · consequences.

---

## OPEN DECISIONS — must be made before their phase can start

| ID | Decision needed | Blocks | Owner |
|---|---|---|---|
| ~~**OPEN-1**~~ | ✅ **RESOLVED 2026-09-04 — Resend**, free tier to start. See [D-033](#d-033--2026-09-04--accepted--resend-is-the-transactional-email-provider-starting-on-the-free-tier). | ~~Phase 3~~ | Project owner |
| **OPEN-2** | Object storage provider for KYC documents. **Data residency for Indian KYC documents is a legal constraint, not a preference.** ⚠️ **2026-09-05 — engineering default recorded, owner ratification outstanding.** [D-071](#d-071--2026-09-05--accepted--open-2-storage-is-provider-agnostic-with-aws-s3-ap-south-1-as-the-default-owner-ratification-outstanding) selects **AWS S3 `ap-south-1`** behind a provider-agnostic interface. **Does not block Phase 9**: 9.1–9.3 proceed on the interface; the pause point is **9.4's concrete adapter**. | Phase 9.4 | **Project owner** |
| ~~**OPEN-3**~~ | ✅ **RESOLVED 2026-09-04 — a single-use, time-limited invitation link.** No password is emailed. See [D-037](#d-037--2026-09-04--accepted--open-3-resolved-employee-credentials-are-delivered-by-a-single-use-time-limited-invitation-link). | ~~Phase 3~~ | Project owner |
| ~~**OPEN-4**~~ | ✅ **RESOLVED 2026-09-05 — financial records are immutable in terminal states; corrections are compensating `Refund` entries.** Answered from `BUSINESS_FLOW.md:690-694`, which already states it. No void workflow is built. See [D-069](#d-069--2026-09-05--accepted--open-4-resolved-financial-records-are-immutable-corrections-are-compensating-entries). | ~~Phase 8.7~~ | Ratification welcome, not blocking |
| ~~**OPEN-5**~~ | ✅ **RESOLVED 2026-09-06 — Vercel + Railway + Neon + AWS S3 `ap-south-1`.** OD-3's recorded default applied; every Wave 5 artefact is platform-shaped and could not be written without it. See [D-091](#d-091--2026-09-06--accepted--od-3-ratified-vercel--railway--neon--aws-s3-ap-south-1). | ~~Phase 15~~ | Project owner (default applied) |
| ~~**OPEN-6**~~ | ✅ **RESOLVED 2026-09-06 — a release step against `DIRECT_DATABASE_URL`, never on boot.** See [D-090](#d-090--2026-09-06--accepted--od-4-resolved-migrations-run-as-a-release-step-against-direct_database_url-never-on-boot). | ~~Phase 15.4~~ | Project owner (default applied) |
| ~~**OPEN-7**~~ | ✅ **RESOLVED 2026-09-06 by the project owner — bank-less entries are NOT legitimate.** `ledger_entries.bank_id` becomes `NOT NULL` (migration `0015`) and the FK moves `set null` → `restrict`. See [D-084](#d-084--2026-09-06--accepted--open-7-resolved-by-the-owner-bank-less-ledger-entries-are-not-legitimate-ledger_entriesbank_id-becomes-not-null). *(original text)* Whether bank-less ledger entries are legitimate. If yes, `bankScope` must include NULL for authorised users; if no, make `ledger_entries.bank_id` NOT NULL. **2026-09-05 — confirmed NOT to block Phase 8.8**: bank ownership flows settlement → transaction → ledger, and `settlements.bank_id` is NOT NULL, so every 8.8-generated entry carries a bank. This decision concerns **hand-created** global entries only. See [D-070](#d-070--2026-09-05--accepted--the-88-chain-its-idempotency-and-why-open-7-does-not-block-it). | Phase 11.6 | — |
| ~~**OPEN-8**~~ | ✅ **RESOLVED 2026-09-06 — the switch is deleted; real TOTP is post-launch.** See [D-083](#d-083--2026-09-06--accepted--od-2-resolved-by-the-recorded-default-the-fake-2fa-switch-is-deleted-totp-is-post-launch). *(original text)* Whether to implement real TOTP 2FA or remove the switch. **Leaving a switch that reports "2FA enabled" for a non-existent feature is not an option** on a banking application. | Phase 12.7 | — |
| ~~**OPEN-9**~~ | ✅ **RESOLVED 2026-09-05 — residual risk explicitly accepted; no antivirus subsystem in Phase 9.** Row 9.10's own text pre-authorises this alternative. Size, extension allowlist, magic-byte validation, streaming, SHA-256, private storage and safe response headers are all still enforced. **Nothing may claim files are scanned.** Revisit in Phase 13. See [D-073](#d-073--2026-09-05--accepted--upload-security-architecture-and-open-9-resolved-by-recorded-risk-acceptance). | ~~Phase 9.10~~ | Engineering (delegated by the row) |
| ~~**OD-8**~~ | ✅ **RESOLVED 2026-09-06 — `settings.edit` is Super Admin and Admin.** Answered by the recorded default once Task 12.6 gave the key a consumer. See [D-086](#d-086--2026-09-06--accepted--u-14--od-8-settingsedit-is-super-admin-and-admin-and-stops-there). | ~~Phase 12.6~~ | Project owner (default applied) |
| **OPEN-10** | The unresolved product question from [FRONTEND_ANALYSIS.md](https://github.com/RiseNext/CMBFRONTEND/blob/main/docs/FRONTEND_ANALYSIS.md) §8 — *"the frontend and the brief describe two different businesses"*, options A/B/C. **No answer was ever recorded.** The backend went with a hybrid. This should be settled and written down. | PRD | — |

---

## D-095 · 2026-09-11 · ACCEPTED — The manager's four tracking sheets are projections over existing records, not four new tables

**Context.** The project owner supplied the four formats management actually works in: an FVR checklist, a Transfer / Disbursement register, an APTS register and a Payment register, with the instruction that the CRM must support *"the exact headings, terminology, and column structure management currently uses"* — and the explicit constraint that this must **not** become four standalone tables imitating the spreadsheets.

A prior audit had mapped the headings and found roughly two-thirds of them already backed by `customers`, `loans`, `verifications` and `disbursements`, with four terms it could not interpret from the repository at all: **APTS**, **BT Lead ID**, **Fund Credited to Customer** and **Payment Status**, plus the three signature lines.

**Decision.** Four **read projections** at `/api/maintenance/*` over the records that were already authoritative, plus migration `0016`: three master tables (`regions ▸ areas ▸ branches`) and sixteen nullable columns on `loans`, `verifications` and `disbursements`. No `*_tracking` table exists and none may be added. A single frontend module, `lib/maintenance/formats.ts`, owns every heading, every column order and every cell's text, and both the screen and the CSV export read it — so the downloaded sheet is the screen by construction rather than by careful copying.

**Two of the four unknown terms were settled BY THE SCREENSHOTS, not by inference.** The APTS sheet writes `Fund Credited Customer` as `01-08-2026 (10:50 AM)` and the Payment sheet writes it as `1:01 PM` — so it is a **credit timestamp**, not a Yes/No and not a beneficiary account. Its honest source is `disbursements.approved_at` **guarded on `status = 'Credited'`**, because `Credited` is reachable only through the approve route (`initialStatuses` forbids creating one, `patchRefusals` forbids PATCH) and that route stamps `approved_at` — while the same column is *also* stamped on `→ Failed`, which is exactly why the guard is load-bearing. And every row of the Payment sheet carries a credit time while reading `Not Received`, which proves **`Payment Status` is not any existing financial state**; it is a downstream receipt flag the manager keeps by hand.

**Alternatives rejected.** *Four tracking tables mirroring the sheets* — forbidden by the brief and wrong regardless: a disbursement's amount appears on three of the four sheets, and a second editable copy is two numbers that can disagree about how much money moved. *`payment_status` as a value in the disbursement state machine* — it would make a manager's clerical note a financial state transition; instead the column is absent from `createSchema` (so POST cannot set it), absent from the derived `patchSchema` (so PATCH cannot), and read by no guard, hook or approval, which makes the separation structural rather than a convention someone must remember. *Deriving `Annual Income` as `monthly_income × 12`* — it would print a figure nobody verified onto a verification document. *Denormalising region and area onto `loans`* — a branch could then disagree with itself about which area it is in. *Auto-generating `BT Lead ID`* — it is issued outside this system, and a synthesised external reference is one no other system recognises.

**The unknowns that stayed unknown are recorded, not guessed.** What **APTS** and **BT** stand for is established nowhere in this repository or in the supplied material, so no APTS-specific workflow, status or rule was invented and no BT identifier is ever minted. The three signature lines are **plain nullable text that authorises nothing** — there is no electronic-signature workflow here, no route treats a non-null value as an approval, and the UI is forbidden from rendering a tick or the word "Signed". All eight open questions are listed in [MANAGER_MAINTENANCE.md](MANAGER_MAINTENANCE.md) §10 rather than settled by assumption (D-043).

**Consequences.** The trigger count **stays at 7** (D-057); the seven new CHECKs are vocabulary-only and every one is named `*_status_check` so `error-handler.ts` answers 422 rather than 500 — including the four on maintenance columns, whose vocabularies are caller-supplied and therefore belong in the 4xx class. Migration `0016` is additive and entirely nullable, so the previous application version keeps working against it, which matters because there are no down-migrations (D-090). `customers.branch` and `users.branch` are **untouched** — they mean different things and both still work. Management's own spelling inconsistencies are preserved deliberately (`SI.NO` vs `Sl No`, `Fund Credited Customer` vs `Fund Credited to Customer`, and the transposed `Transfer Amount` / `Branch Name` order between APTS and Payment); a test transcribes them independently from the screenshots so "tidying" one fails the build. **Accepted risk:** several columns will be blank in current data — `MANAGER NAME`, `REMARK` and `Customer Profile` have no UI writer anywhere in the product — and they are left blank rather than filled with a plausible value (D-004). **Operational note:** `seed()` tops up non-system roles only at creation, so existing Admin and Manager rows must be granted `maintenance.*` on the Roles screen after deploy.

---

## D-094 · 2026-09-06 · ACCEPTED — SEC-019 closes with a key-name walker, not more redaction paths

**Context.** `lib/logger.ts` used pino `redact` paths of the form `*.password`. **A pino `*` matches exactly one intervening level**, so the pattern covered `x.password` and missed `req.body.password` — depth three, and the single most likely shape for the leak the file's own comment promised to prevent. It also missed `err.request.body.password` and `audit.changes.pan`, the last of which `services/audit.ts` logs wholesale on its own failure path.

**Decision.** Redact **by key name at any depth**, through a walker applied in pino's `formatters.log`. Bounded at depth 12 and 5,000 nodes, cycle-safe via a `WeakSet`, and non-mutating.

**Alternatives rejected.** *Enumerate the deep paths*, which is what SEC-019 itself suggested — it fixes today's shapes and fails on tomorrow's. `req.body.customer.aadhaar` is depth four, a batch is depth five, and an array puts a numeric index in the middle. There is no finite list, and a list that is nearly right is worse than none because it reads as coverage. *Redact everything* — see below.

**Consequences.** `email`, `name`, `city`, `code`, `aadhaarLast4` and every id are **deliberately kept**, the same line `services/audit.ts` draws: they are the label the line is about, and a log in which the actor and the record are both `[redacted]` is unusable during an incident — and an unusable log is one somebody turns off. Two residuals, both recorded: a **free-text** field can contain anything no key rule can catch, and `LOG_LEVEL=debug` widens *what is logged at all*, which is why the runbook forbids it in production.

**One defect of this decision's own implementation was caught by its tests.** The first walker treated `Error` like a plain object — but `name`, `message` and `stack` are **non-enumerable**, so it produced `{}` and destroyed the error message. Case 11 of `log-redaction.test.ts` caught it.

---

## D-093 · 2026-09-06 · ACCEPTED — Error tracking is a JSON envelope to a configured collector, not an SDK

**Context.** Task 15.5. There is no error-tracking account, no DSN and no network in this repository, so any SDK integration written here could only be asserted to compile.

**Decision.** `lib/observability.ts` on the backend and `lib/report-error.ts` on the frontend. One POST of a fixed envelope to `ERROR_TRACKING_URL` / `NEXT_PUBLIC_ERROR_TRACKING_URL` when set; a structured log line and nothing else when not. The **external wiring is a human setup step and is listed as one.**

**Alternatives rejected.** *The Sentry SDK* — D-006 forbids a dependency without a reason, D-035 settled the same question for email, and in the browser it is worse: an SDK is third-party JavaScript, and this application's CSP has no allowance for one. Widening a banking application's CSP to gain error reports is a bad trade, and doing it quietly would undo half of what SEC-011 is about.

**Consequences.** The envelope is an **allow-list**, because a tracker is a third party and this system holds Aadhaar and PAN. A `pg` error's `detail` — which contains the offending row value (`Key (mobile)=(9848000000) already exists`) — is stripped, and so is the `cause` chain, which carries the connection string; context accepts scalars only, and non-scalars are dropped at runtime rather than merely forbidden by a type. The browser envelope carries `pathname` and **never the query string**, because `/accept-invite` and `/reset-password` take a live single-use token from there. `NEXT_PUBLIC_ERROR_TRACKING_URL` is public, so **there is deliberately no token to go with it** — the collector must accept unauthenticated posts and rate-limit itself, and the runbook says so. `captureException` never throws and is never awaited: a collector outage must not turn a handled 500 into an unhandled rejection.

---

## D-092 · 2026-09-06 · ACCEPTED — Scheduled jobs are a CLI entry point invoked by an external scheduler, and they add no schema

**Context.** Task 15.9. Four things were stamped by the application and acted on by **nothing**: `recycle_bin_entries.purge_after`, `import_batches.expires_at` (**SEC-009**, the last open HIGH), dead `refresh_tokens` (13.15), and `bank_orders.sla`.

**Decision.** `src/jobs/`, one plain async function per job over a `Database` handle, behind `node dist/jobs/run.js <name|all>`. Railway Cron invokes it. **Exit 0 only when every job completed with `failed === 0`.**

**Alternatives rejected.** *An authenticated HTTP trigger* — an endpoint that purges records is a destructive surface needing its own shared secret, rate limit and audit path: three new things to get wrong for no gain. *In-process `setInterval`* — it competes with request traffic for the same narrow Neon pool, and in a multi-instance deployment every replica fires it. *A `job_runs` table* — observability through structured logs and the audit rows the jobs already write, rather than a migration; the counters are in the log line and `overdueStagedRowCount()` measures the one claim that matters.

**Consequences.** **No migration** — Wave 5 keeps `db:generate` at zero diff. Two signatures widened to accept a null actor: `permanentDelete(db, ctx: AuthContext | null, …)` and `notifications.emit(tx, ctx: AuthContext | null, …)`. A job has no user, so `actor_id` and `purged_by` are null, which is the truthful record of a system action; manufacturing a service account would put a real, loginable row in `users` purely so the audit table looked tidier. Every job is **idempotent by a predicate its own effect falsifies**, and `detect-sla-breach` gets that for free from migration `0011`'s partial unique index on `(user_id, event_key)` rather than from a flag column — with the stated consequence that a person is told **once per bank order, ever**. `cleanup-refresh-tokens` keeps dead rows for **7 days**, because `/auth/refresh` detects replay of a rotated token by finding a *revoked* row: deleting on rotation would make the detection silently stop working, and the attacker gets the same 401 either way, so no endpoint test would notice.

**SEC-009's retention half is implemented and tested and NOT YET IN EFFECT.** Nothing is purged until the cron is wired, and the runbook gives the query that measures whether it is.

---

## D-091 · 2026-09-06 · ACCEPTED — OD-3 ratified: Vercel + Railway + Neon + AWS S3 `ap-south-1`

**Context.** OD-3 carried a recorded default and no ratification. Wave 5 cannot write a Dockerfile, a release script or a runbook without committing to one.

**Decision.** Apply the default. Frontend **Vercel** (`bom1`), backend **Railway**, database **Neon Postgres**, storage **AWS S3 `ap-south-1`**, email **Resend** (D-033).

**Alternatives rejected.** *Keep it open* — every artefact in Wave 5 is platform-shaped, and writing four variants of each would produce four untested ones. *Consolidate onto one platform* — a real option, and a migration rather than a decision; the split is what the repository has always assumed, and nothing in it is hard to move.

**Consequences.** `ap-south-1` is **not a preference**: OPEN-2 records Indian data residency for KYC documents as a legal constraint, and moving the bucket re-opens that decision. `railway.json` sets `numReplicas: 1` — which makes the migration race impossible today but is **not** the protection, since scaling is a dashboard toggle; D-090 is the protection. Two consequences of the split deployment are load-bearing and both are in the smoke test: `NODE_ENV=production` is required for `SameSite=None; Secure`, and `CORS_ORIGIN` must name the Vercel origin exactly.

---

## D-090 · 2026-09-06 · ACCEPTED — OD-4 resolved: migrations run as a release step against `DIRECT_DATABASE_URL`, never on boot

**Context.** OPEN-6 / OD-4 asked whether migrations run on boot, as a release step, or manually. Nothing in the repository ran them at all — `db:migrate` existed and was invoked by no deployment mechanism, because there was no deployment mechanism.

**Decision.** A release step: `npm run release` → `scripts/release.mjs`, against `DIRECT_DATABASE_URL`, one at a time, before the new backend starts. Never from `CMD`, and no down-migrations.

**Alternatives rejected.** *On boot* — every replica races to apply the same DDL on every restart. Drizzle's advisory lock makes that survivable rather than safe, and "survivable" is not a reason to design it that way; D-050 already says one migration in flight. *Through the pooled endpoint* — Neon's pooler is PgBouncer in transaction mode, so the advisory lock can be held on one backend while the DDL runs on another and the protection silently stops working. The script **refuses** when `DATABASE_URL` looks pooled and `DIRECT_DATABASE_URL` is unset. *Generate down-migrations* — Drizzle does not, and a hand-written `down` that has never been executed is worse than none because it reads as a safety net.

**Consequences.** Rollback is **roll the code back, not the schema** — every migration is written so the previous application version still runs against the new schema, and `DEPLOYMENT.md` §5 states which of the sixteen are reversible and which are not. A genuinely bad schema change is recovered by restore, which is why a verified backup is step one of every release. The script prints applied-versus-pending counts and **never a connection string** — not the host, not the user (the lesson SEC-015 taught the readiness probe). `--check` reports without changing anything and needs no compiled application code, so it works against an unbuilt checkout.

---

## D-089 · 2026-09-06 · ACCEPTED — Navigation filtering is a usability change, and every screen keeps its own refusal

**Context.** `frontend/src/lib/nav.ts` had **no permission field at all**, so all fourteen entries rendered for all five roles. An Executive holds no `reports.view`, `settlements.view`, `ledger.view` or `recycle_bin.view` and was offered every one of them. The demo already did this properly (`lib/demo/nav.ts` filters an identically-shaped catalogue and says in its own header that administrative sections should be *absent rather than merely disabled*), and that idea was never moved to real sessions.

**Decision.** `NavItem` gains `permission: string | null`, and `visibleNavSections(permissions)` filters the catalogue and drops sections left empty. The sidebar and the Ctrl+K command palette both use it. `null` is reserved for screens gated by identity rather than role: **Dashboard** (the landing route — hiding it leaves a role with no home, and since U-4 it reports a refusal rather than rendering zeroes), **Notifications**, and **Settings** (which is also where a user changes their own password and reviews their own sessions; only the organisation panels inside it are gated).

**Alternatives rejected.** *Disable rather than hide* — a greyed-out entry still asserts the screen exists for you and is merely off, which is the claim being withdrawn. *Role-name checks* — every string is a permission key from `src/lib/permissions.ts`, so adding a role never touches this file. *Gate `/settings` on `settings.view`* — that would lock three of five roles out of their own password.

**Consequences.** **This is not security and must never be relied on as such.** Hiding a link stops nobody; every route is enforced by `requirePermission` server-side, and `/roles`, `/teams`, `/audit-logs` and the settings panels each render an honest "your role cannot see this" when reached by URL. Deleting the filter would make the menu noisier and open no hole — `nav-permissions.test.ts` group D asserts the properties that keep that true, and each screen's own refusal is asserted in its own test file. The five seeded grants are **transcribed** into that test rather than imported, deliberately: widening a grant should force a human to re-derive the expectations.

---

## D-088 · 2026-09-06 · ACCEPTED — Sessions expose only what `refresh_tokens` records; no device, location or last-active is derived

**Context.** Task 12.8 needed an active-sessions panel. The table it replaces listed three hardcoded devices dated 2024, each with a sign-out button that raised a success toast and revoked nothing. `refresh_tokens` carries exactly four descriptive columns: `created_at`, `expires_at`, `user_agent`, `ip_address`.

**Decision.** `GET /api/auth/sessions` returns those four and a derived `current`, and nothing else. The user-agent string is rendered **verbatim**, labelled as reported by the browser. `created_at` is labelled "signed in" rather than "last active". `current` is computed server-side by comparing the caller's refresh cookie against each row's hash, so the digest never leaves the server.

**Alternatives rejected.** *Parse the user agent into "Chrome on Windows"* — it is a self-reported header any client may set to anything. On the one screen whose entire purpose is deciding what to revoke, presenting a guess as an identified device is the worst possible false claim. *Geolocate the IP* — the same objection, plus a third-party dependency. *Call `created_at` "last active"* — rotation replaces the row, so it is the last time the session **refreshed**, which is what it is labelled.

**Consequences.** The panel is less impressive than the fiction it replaces and every line of it is true. Both routes are **self-service only** — scoped to the caller's own `user_id`, no permission key, no `?userId=`. Administrative revocation of somebody else's sessions is a different capability needing different authorization (the role hierarchy, as every route acting on a person uses), and inventing it here to fill out a screen would widen the permission model by accident; an administrator already has `POST /api/users/:id/reset-password`, which revokes everything. Accepted residual: an access token already issued stays valid until it expires, and the copy says so rather than claiming an instant sign-out.

---

## D-087 · 2026-09-06 · ACCEPTED — `app_settings` gets a closed key registry, and per-user preferences are refused because the table cannot hold them

**Context.** Task 12.6. `app_settings` shipped in the first migration and was **completely dead** — zero references outside `db/schema/governance.ts`. Wave 1 removed the settings screen's Company, Preferences, Alerts and Delivery panels because they had nowhere to persist to, and named this row as their owner. The table is `key text primary key, value jsonb`.

**Decision.** A **closed registry** in `src/services/settings.ts`: seven declared keys, each with its own zod schema, a fallback and a description. `PATCH /api/settings` refuses an undeclared key with a **400 naming it**, validates the whole body before writing anything, writes inside one transaction, and returns the server's re-read state for every key. The registry lives in `services/` rather than in the routes module because `services/recycle-bin.ts` consumes one of the settings, and a service must not depend on a routes module.

**One setting has a live consumer**, deliberately: `recycleBin.retentionDays` feeds `purgeDate()`, so changing it changes when a deleted record becomes purgeable. Absent — or stored as something that no longer satisfies its schema — it falls back to `RECYCLE_BIN_RETENTION_DAYS`, so an untouched deployment behaves exactly as before.

**Alternatives rejected.** *An open key/value endpoint* — the primary key is free text, so anyone holding `settings.edit` could create unbounded rows and no reader could know what a value should look like. *Silently dropping unknown keys* — a screen reporting success for a field the server ignored is precisely the D-004 shape this wave exists to remove. *Storing per-user preferences here* — **the table has no user column.** Alert preferences, table density and a default landing page are per-person; putting them in a globally-keyed table would make one operator's choice everybody's. That needs a `user_settings` table, which is a schema change this wave does not make, so those panels stay `NotConfigurable` with the reason **corrected** from "no routes yet" to "no table that can hold it". *Invoice numbering* — likewise refused: settlement invoice numbers come from `code_sequences`, so a prefix stored here would be read by nothing and the panel would claim an effect it does not have.

**Consequences.** The organisation record is genuinely persisted and read back, and the screen says only that — it does **not** claim the details are printed anywhere, because nothing prints them. Adding a setting means adding a registry entry, which is one place. A stored value that fails its schema falls back rather than propagating, so one bad row cannot break every soft delete in the system.

---

## D-086 · 2026-09-06 · ACCEPTED — U-14 / OD-8: `settings.edit` is Super Admin **and** Admin, and stops there

**Context.** `settings.edit` has been in the catalogue since the first migration, held by Super Admin alone, and **consumed by no route** — so the question of who should hold it had never had to be answered. Task 12.6 gives it a consumer. OD-8's recorded default is Admin + Super Admin.

**Decision.** Grant `settings.edit` to **Admin** as well as Super Admin. Nobody below.

**Alternatives rejected.** *Super Admin only* — the route writes the registered company record and the recycle-bin retention window, which is operational administration, exactly what the Admin role is described as ("Operational administration below Super Admin"). Admin already holds `settings.view`, `banks.*`, `users.*` and `recycle_bin.restore`, all strictly more consequential than a retention window; withholding this one would be arbitrary. *Manager as well* — a records-retention window that field management can shorten is a retention control with no control. Manager holds neither settings key and now cannot even read the organisation record.

**Consequences.** OD-8 is closed and must not be re-asked. `settings.test.ts` group D pins all five roles, including that Manager, Team Leader and Executive are refused on **both** routes. The settings screen renders the organisation record read-only for anybody without the key, rather than hiding it — a Manager can see what the company details are and cannot change them.

---

## D-085 · 2026-09-06 · ACCEPTED — SEC-005 closes with an in-process limiter; the distributed one is post-launch and its residue is named

**Context.** Task 13.1 had to close **SEC-005** (*"No HTTP rate limiting anywhere; argon2id pile-up denial of service"*), a P0. Task 3.6 had already built a narrow limiter for three public credential endpoints and its header said plainly that Phase 13 owed the general answer.

**Decision.** Extend that limiter rather than replace it, and close SEC-005 on the in-process implementation while **naming what it still is not**.

**What closes the finding.** Both halves of it, which are different problems:

| Half | Answer |
|---|---|
| Unthrottled surface | `POST /api/auth/login` throttled **per address** (20/15 min) and **per account** (10/15 min). A global limiter (300/min) covers every route so a new endpoint is protected the moment it is mounted. |
| argon2id pile-up | `withHashSlot` — max **4** concurrent hashes, requests over the cap **wait** rather than fail, queue bounded at 100. A request limiter cannot solve this: it caps arrivals, not simultaneous memory-hard cost, and a distributed attempt spreads across addresses where no per-source counter can see it. |

**Why per-account as well as per-IP, and why they are different.** Per-IP stops one host hammering the whole login surface. It is blind to a distributed attempt at **one inbox** — every request arrives from somewhere new. Only the account axis sees that, and it is keyed on the *normalised* address so `A@x.com`, `a@x.com` and `a@x.com ` share a bucket. A request carrying no usable address opts **out** of the account limiter entirely: bucketing junk under one key would let it exhaust a real user's allowance, a denial of service built out of the defence.

**Why the queue waits instead of rejecting.** A legitimate user arriving during a burst gets a slower login, not a failure — and waiting reveals nothing about whether the address exists, so it does not reopen **SEC-004**.

**Why `/api/health` is exempt from the global limiter.** Railway polls liveness continuously from a small set of internal addresses. Counting those would eventually throttle the platform's own health check and cause a restart loop. **The limiter taking the service down is a worse outcome than the one it prevents.** The probe touches no database, so leaving it uncounted costs nothing.

**What it still is not — recorded, not hidden.**

- **Per process.** Two Railway instances keep separate counters, so the effective limit multiplies by the instance count. A distributed limiter needs shared state (Redis), which is both a dependency decision (**D-006**) and an infrastructure one.
- **In memory.** A restart forgets every counter.
- **Fixed window**, not sliding: an allowance can be spent at the end of one window and again at the start of the next, so the true short-term burst ceiling is 2× `max`.

**SEC-005 closes anyway**, and that is a judgement worth stating: the finding is that *nothing* was throttled and that argon2 cost was unbounded. Both are now false. The residue is a scaling property of a single-container deployment, not the vulnerability. A Redis-backed limiter belongs with the multi-instance decision in Phase 15 and is on the post-launch backlog.

**Test isolation is not a weakened limit.** `tests/setup.ts` resets the counters before every test, because the whole suite arrives from one address and would otherwise throttle itself — a failure that would look like a product defect and invite someone to raise the limits until they meant nothing. `auth-rate-limit.test.ts` deliberately does **not** reset inside a case; it would pass with that hook deleted.

---

## D-084 · 2026-09-06 · ACCEPTED — OPEN-7 resolved by the owner: bank-less ledger entries are **not** legitimate; `ledger_entries.bank_id` becomes NOT NULL

**Context.** **OPEN-7** has been open since the decision log was created: *"Whether bank-less ledger entries are legitimate. If yes, `bankScope` must include NULL for authorised users; if no, make `ledger_entries.bank_id` NOT NULL."* It was the last decision blocking Phase 11's ledger work.

The defect it describes is severe and silent. `bankScope` filters with `inArray` (`services/access.ts:117`), and **`IN` never matches NULL**. So an entry created by an unscoped user — Super Admin or Admin, the only two roles holding `ledger.create` today — lands with `bank_id = NULL` and is **permanently invisible to every scoped user**, with no error and nothing on screen to suggest a row exists. A financial record written into a hole.

**D-070** established the scope precisely: bank ownership flows `settlement → transaction → ledger` and `settlements.bank_id` is `NOT NULL`, so **every entry the 8.8 chain generates already carries a bank**. OPEN-7 concerns hand-created entries only.

**Decision — the project owner answered: bank-less entries are NOT legitimate.** `ledger_entries.bank_id` becomes `NOT NULL`. Every ledger entry belongs to exactly one bank, and the ledger is uniformly bank-scoped.

**Pre-flight, run 2026-09-06 against a fully migrated and seeded database:**

```
ledger_entries total : 0
ledger_entries NULL  : 0
current FK on delete : n  (SET NULL)
```

⚠️ **That result is about THIS repository, not about any deployed database.** `db:seed` writes no business data by design, so zero is the expected answer here and proves nothing about production. **The operator must run the pre-flight in the migration header against the real database before deploying.** If it returns rows, the business must say what each entry's bank is — the migration **fails loudly rather than backfilling**, per D-010 and the standing rule that a migration never invents financial data.

**The FK action had to change with it, and this was not foreseen in OPEN-7.** `bank_id` was declared `onDelete: "set null"`. That is *incompatible* with `NOT NULL`: deleting a bank would attempt to write NULL into a column that forbids it, and the delete would fail with a constraint violation instead of a legible refusal. It becomes **`onDelete: "restrict"`**, which is what every other `NOT NULL` `bank_id` in this schema already uses (`loans:160`, `verifications:235`, `bank_orders:321`). Refusing to delete a bank that still owns ledger entries is the correct answer for immutable financial records (**D-069**) — and banks are soft-deleted in normal operation anyway, so this changes nothing about ordinary use.

**Consequences.**

- Migration **`0015`** applies it in four staged steps rather than one `SET NOT NULL`, so an offender fails at a retryable `VALIDATE` with the guard already in place, instead of aborting a deployment. See the file header.
- `ledgerRouter.createSchema.bankId` stops being `.optional().nullable()`. A create without a bank is now a **422 naming the field**, one layer before the database — the same shape every other bank-owned resource gives.
- **`bankScope` is unchanged.** The whole point of answering "no" is that its `inArray` semantics become correct rather than needing a NULL branch.
- **OPEN-7 is struck from the open-decisions table**, resolved, owner recorded.
- Task **11.6(c)** is complete. 11.6(a) — which roles hold `ledger.create` — remains **OD-7**.

---

## D-083 · 2026-09-06 · ACCEPTED — OD-2 resolved by the recorded default: the fake 2FA switch is deleted; TOTP is post-launch

**Context.** **OPEN-8** has stood since the decision log was created: *"Whether to implement real TOTP 2FA or remove the switch. Leaving a switch that reports '2FA enabled' for a non-existent feature is not an option on a banking application."* No owner answer was ever recorded. Roadmap row **12.7** says the same thing in stronger terms: *"a false security assurance is worse than a missing feature."*

`settings/page.tsx:993-1005` renders a `Switch` whose `onCheckedChange` raises `toast.success("2FA enabled", { description: "Applies from your next sign in." })` and issues **no request**. There is no TOTP secret column, no enrolment route, no verification step at login, and no recovery codes — the feature exists in **no layer**.

**Decision.** **Delete the control.** Recorded here as engineering acting on the audit's documented recommended default, under the operating instruction that OD-2 may be resolved that way rather than blocking Wave 1.

**Why deletion and not implementation.** Real TOTP is enrolment + QR provisioning + verification at login + recovery codes + an admin reset path + a migration. That is `M`–`L` on the **pre-deployment critical path** for a control nobody can currently use. Deletion is `S` and removes the lie today. The half-measure — shipping enrolment without enforcement at login — would be the same defect with more code behind it.

**What replaces it.** Nothing. No disabled switch, no "coming soon" badge. A greyed-out security control still communicates that the capability exists and is merely off, which is the claim being withdrawn.

**Consequences.**

- **OPEN-8 is struck from the open-decisions table**, resolved, owner recorded as engineering-by-default.
- Real TOTP moves to the **post-launch backlog**, tracked in the roadmap rather than dropped. `12.7` is satisfied by the deletion; it always offered both alternatives.
- **Nothing in the product may claim 2FA exists** — the same rule D-073 imposes for virus scanning.
- If the owner later requires MFA before launch, this decision is cheap to reverse: nothing was built on it.

---

## D-082 · 2026-09-06 · ACCEPTED — CSP ships from `next.config.ts` with `'unsafe-inline'` on `script-src`; the nonce needs middleware and is follow-up

**Context.** **SEC-011**: the frontend origin emitted **no security headers at all** — no CSP, no HSTS, no `X-Frame-Options`, no `Referrer-Policy`. `next.config.ts` had no `headers()` and no `middleware.ts` existed. The API emits helmet's defaults minus CSP (`app.ts:48`, disabled deliberately — an API serves no documents), but the API is not the origin a browser renders.

Roadmap row **13.5** specifies *"CSP (the inline theme script needs a nonce)"*.

**The conflict.** A nonce **cannot** be delivered from `next.config.ts`. `headers()` is static configuration evaluated at build time; a nonce must be fresh per response. Emitting a fixed string named `nonce` would be strictly worse than none — a control that looks real and is a constant.

**Decision.** Ship the policy from `next.config.ts` now, with `script-src 'self' 'unsafe-inline'`, and record the nonce as follow-up rather than doing it badly.

**Why not middleware immediately.** A nonce-based policy requires **every** inline script in the response to carry the nonce, including Next's own bootstrap and hydration scripts. Getting that wrong produces a blank page **in production and nowhere else** — no test catches it, because the dev server and the test environment do not exercise the same injection path. That is precisely the failure shape this repository has already been burned by (**SEC-027**, where a bundler-specific path shipped the demo while printing `EXCLUDED`).

**What is genuinely closed, and what is not.**

| Directive | Effect |
|---|---|
| `frame-ancestors 'none'` + `X-Frame-Options: DENY` | **Clickjacking closed** |
| `object-src 'none'` | Plugin execution closed |
| `base-uri 'self'` | Base-tag hijacking closed |
| `form-action 'self'` | Form exfiltration closed |
| `default-src 'self'`, `connect-src` pinned to the API origin | Exfiltration surface narrowed |
| `upgrade-insecure-requests`, HSTS 2y + subdomains | Mixed content and downgrade closed |
| `script-src 'unsafe-inline'` | **XSS is NOT closed by the policy.** Injected inline script still runs |

**So SEC-011 is downgraded, not eliminated.** The finding stays open in the register with its residue named, and closes when middleware mints a per-request nonce. Claiming otherwise would be the D-004 shape applied to a security control.

**`connect-src` is derived from `NEXT_PUBLIC_API_URL`**, the same variable the client uses, so the policy cannot drift from the transport. A malformed value logs a warning at build time rather than silently producing a policy that blocks every request.

---

## D-081 · 2026-09-06 · ACCEPTED — Snapshots `0008`–`0013` are reconstructed by reverse application, and prose is banned from `meta/`

**Context.** Wave 0 of the production-readiness audit found `npm run db:generate` **crashing**, not merely degraded:

```
SyntaxError: Unexpected token '#', "# Migratio"... is not valid JSON
    at validateWithReport (drizzle-kit/bin.cjs:8157:32)
```

`drizzle-kit` discovers snapshots by **listing `meta/`** — `readdirSync(meta).filter(it => !it.startsWith("_"))` (`bin.cjs:8127`) — not by reading `_journal.json`. `meta/README.md`, written the previous day to *document* the missing snapshots, was therefore parsed as a snapshot and threw. The file recording the gap was preventing anyone from closing it.

Removing it exposed the worse problem the README itself predicted: with `0007` the newest snapshot, `drizzle-kit generate` re-emitted every DDL statement from `0008`–`0013` as one new migration. Applied to a database that has already run them it fails on statement one (`42P07 relation "required_document_types" already exists`).

**Decision 1 — `meta/` holds no prose.** The documentation moves to `drizzle/SNAPSHOTS.md`. Renaming it `_README.md` would also satisfy the filter and is rejected: `meta/` is machine-owned, and a directory a tool enumerates blindly should contain only what that tool writes.

**Decision 2 — reconstruct the six snapshots by reverse application, not by re-generation.** The README's own proposed remedy (apply `0000`–`0012` to a live database, generate, delete the SQL, renumber the snapshot) needs a real Postgres this environment does not have, and its step 3 is a hand-renumbering with no independent check. The procedure used instead needs no database:

1. Generate the drizzle-canonical snapshot of the **current** schema in a scratch directory. Discard its SQL — that SQL is the hazard.
2. Reverse-apply each shipped migration to it, newest first, asserting that every removed object was present.
3. **Require** that reverse-applying `0008` lands **byte-identically** on the known-good `0007_snapshot.json` under a recursively key-sorted comparison.

Step 3 is what makes this safe rather than plausible. It anchors the chain to the shipped SQL and to the live schema **at the same time**; a snapshot wrong anywhere could not land on `0007` exactly. It passed. Each snapshot was then independently checked by installing `0000`–`N` and confirming the delta drizzle-kit still wanted equals exactly migration `N+1` — the table is in `SNAPSHOTS.md`.

**Consequences.**

- `npm run db:generate` exits 0 reporting **"No schema changes, nothing to migrate"**. `drizzle-kit check` reports *"Everything's fine"*.
- **No `.sql` file and no `_journal.json` entry changed** — all fifteen verified byte-identical by MD5 before and after. No migration was created; `0014` and `0015` remain Wave 2's.
- **The staged-DDL divergence is permanent and accepted.** drizzle-kit emits CHECKs without `NOT VALID`/`VALIDATE`, and `0011`'s `event_type` without the staged `DEFAULT 'legacy'`/`DROP DEFAULT`. Those forms are load-bearing on a populated table. The snapshots record the *end state*, which matches; the generated SQL does not, which is why **migrations touching populated tables must still be written by hand**. The snapshots make `generate` safe to run — they do not make its output shippable.
- **This is not a durable guarantee until CI enforces it.** The convergence check is a manual step today and belongs in **14.7**. It is exactly the step whose absence opened the gap.

---

## D-080 · 2026-09-06 · ACCEPTED — `.env.example` is the sole backend environment template; the root copy is deleted

**Context.** Two environment templates described the backend, and they disagreed. `.env.example` documented 21 of the 28 keys in `src/config/env.ts`; the root `.env.example` documented 18 and was worse in kind — it omitted `AADHAAR_PEPPER` (**SEC-025**), omitted all eight storage keys added in Phase 9, omitted `LOG_LEVEL`, and mixed a frontend key (`NEXT_PUBLIC_API_URL`) into a backend template.

The storage omission was the deployment-blocking one. `env.ts:193-200` **refuses to boot in production** without `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY` — and **neither template named any of them**. A deployer following either file to completion would get an unexplained boot failure.

**Decision — delete the root `.env.example`.** Evidence that nothing consumes it:

| Check | Result |
|---|---|
| Root `package.json` / workspace / compose file | **none exist** |
| `dotenv` consumers | exactly one: `src/config/env.ts:1`, loaded from the `backend/` CWD every npm script runs in |
| `README.md:70-71` | already states *"**`.env.example`** is the authoritative template"* |
| `README.md:39` and `:218` | both `cp .env.example …` lines sit inside `cd CMBBACKEND` / `cd frontend` blocks |

So the root file had no reader, no instruction pointing at it, and no way to be right — three templates for two applications, one of them unreachable. Parity was the alternative and is rejected: keeping a duplicate in sync is the failure mode that produced the drift.

**`.env.example` is completed in the same change:** all eight storage keys with D-071/D-072's reasoning, and the honest limitation that the S3 adapter has never made a live network call. Two credential keys ship **empty**, not with realistic placeholders.

**One correction of substance, not merely coverage.** The `FRONTEND_URL` block asserted the variable was *"read by NOTHING in application code … safe to leave at the default"*. True when written; false since Phase 3 — `invitations.ts:55` and `password-reset.ts:51` both build their absolute link from it. Left at the default on a deployed backend, **every invitation and password-reset email points at `http://localhost:3000`**, sends successfully, and is useless. Nothing detects it, because a well-formed URL is all that is checked.

**Consequences.**

- All 28 `env.ts` keys are documented in one place. `LOG_LEVEL` is the only documented key outside the zod schema, correctly — it is read raw at `lib/logger.ts:3`.
- **SEC-025's template half closes**; its `.gitignore` half was already closed by Task 0.4. The finding closes entirely.
- No secret value is introduced anywhere.
- Anyone with a root `.env` keeps it — `.gitignore` still ignores `.env` at every depth. Only the *template* is removed.

---

## D-079 · 2026-09-05 · ACCEPTED — Phase 6–10 task numbering: `F1` is a prerequisite block, not a phase row

**Context.** The Phase 6–10 readiness gate identified one cross-phase factory change (`F1`) serving rows in Phases 6, 8 and 10, and proposed six new rows. Numbering it `6.0` would falsely assign it to Phase 6; calling it `5.12` would reopen a closed phase.

**Decision.** Add a short **`PHASE 6–10 PREREQUISITE`** block immediately before Phase 6 in the roadmap, containing exactly one row, **`F1`**. This uses the roadmap's existing phase-block structure, invents no hierarchy and renumbers nothing.

**Three of the six proposed rows are withdrawn**, because verification showed each was already covered:

| Proposed | Disposition | Why |
|---|---|---|
| ~~6.7~~ server paging + honest stats | **folded into 6.6** | 6.6 already reads *"surface `loading`/`error`"*; the honest-stats work is one copy change (D-065) |
| ~~7.8~~ disbursement privilege closure | **folded into 7.3** | 7.3 already owns the machine; `initialStatuses` + `patchRefusals` are two config lines (D-066) |
| ~~8.9~~ settlement approve enum | **folded into 8.3** | 8.3 owns the settlement transition; the enum is the same config (D-066) |

**Added:** **9.11** (KYC pack — D-076) and **10.9** (bell/page agreement). **Merged:** **7.6** becomes a verification checkpoint under 7.3, delivered by Task 5.7. **Deferred:** **10.7 → 12.6**, **10.8 → 15.9**, on the rows' own stated dependencies.

**Final count: 42 rows** — 39 official + `F1` + 9.11 + 10.9.

---

## D-078 · 2026-09-05 · ACCEPTED — Notification UI: remove mark-unread, gate Team activity, share one notification state

**Context.** Three separate Phase 10 defects, one decision each.

**Mark-unread is removed, not built.** `notifications/page.tsx:63` renders a *"Mark unread"* button. Row 10.2's own text is *"Wire mark-read and mark-all-read to the **existing** endpoints"*, and no unread endpoint exists on the real or the demo API. Building one to justify a button is the annexation **D-043** forbids; leaving it is the false claim **D-004** forbids. The control becomes a one-way *"Mark read"*.

**Team activity is permission-gated, not widened.** `notifications/page.tsx:73` is `const activity: ActivityItem[] = []` feeding a live panel. Only Super Admin and Admin hold `audit_logs.view`. Per **D-049**, the panel renders real audit rows for those two roles and is **omitted entirely** for the other three — not an empty list implying nothing happened, and not a hidden button. Row 10.6's own text permits *"or remove the panel"*. **`audit_logs.view` is not widened.**

**The bell and the page share one state.** `topbar.tsx:72` and `notifications/page.tsx:72` each run an independent `useResource("/notifications")`, so 10.1 and 10.2 can both pass while the badge still disagrees — the Phase 10 DoD's third box. The fix is a `NotificationsProvider` React context in the app shell, following the **existing house pattern** (`use-auth.tsx`, `use-reference.tsx` are both context providers over fetched data). **No new library — D-006 is satisfied by reusing a pattern, not by exception.** Multi-tab consistency is out of scope; no realtime transport exists.

---

## D-077 · 2026-09-05 · ACCEPTED — Notifications get event identity and a required recipient; no event bus

**Context.** `grep insert(notifications)` across the backend returns **zero** — the table can never hold a row in production. Row 10.3 requires *"each producing event writes **exactly one** notification row"*, which the current schema cannot express: `db/schema/operations.ts:435-448` has no event identity, no record reference and no uniqueness, and **`user_id` is nullable** (`:436`) while the route scopes on `ctx.userId` — so a null-recipient row is invisible to everyone, permanently.

**Decision — four columns and one partial index.**

| Change | Why |
|---|---|
| `user_id` → **NOT NULL** | closes the invisible-row hole |
| `+ event_type text NOT NULL` | which event produced it |
| `+ record_type text`, `+ record_id uuid` | powers `link_href`; lets a record's notifications be found |
| `+ event_key text` | the idempotency key |
| `UNIQUE (user_id, event_key) WHERE event_key IS NOT NULL` | delivers *"exactly one row"* |

`event_key` is `{event_type}:{record_type}:{record_id}:{discriminator}`, the discriminator being whatever makes a **legitimate** repeat distinct — so retries collide and genuine repeats do not.

**Event catalog.** Row 10.3 lists **9 comma-separated items**, which expand to **11 distinct events**. Three exist today (loan approved, loan rejected, import completed); the rest arrive with their owning rows. **Do not emit events for functionality that does not exist.** 10.3 ships the service plus the events whose sources exist; each later row wires its own.

**Fan-out.** One row per recipient, resolved by a pure function from columns that already exist (`assigned_user_id`, `created_by`, `uploaded_by`, bank scope). **SLA-breach recipients are undefined in every project document** and are deferred with row 10.8 to Phase 15.9; the recommended rule when it is built is *the assigned user plus their team leader where `teamId` resolves one*.

**Deliberately not built:** an outbox table, a queue, a retry table, a subscription model. None is required by any row and the system has no scheduler to drive them.

---

## D-076 · 2026-09-05 · ACCEPTED — "KYC pack" is required types + completeness + a manifest; not a PDF and not an archive

**Context.** Phase 9's third DoD box reads *"A KYC pack can be assembled and produced from the system"* (`PRODUCTION_ROADMAP.md:548`). **The phrase `KYC pack` occurs exactly once in the entire repository — that line.** No PRD requirement, no `BUSINESS_FLOW.md` definition, no data model. **D-057** already recorded the adjacent gap: there is *"no `required document types` table among the 27"*, so the document-completeness guard *"has nothing to read"*.

**Decision.** Implement the smallest thing that honestly satisfies *"assembled and produced"*, as row **9.11**:

1. A **`required_document_types`** reference table, seeded from the five types the UI already hardcodes at `documents/page.tsx:53`.
2. A **per-customer completeness view** — required versus present-and-Verified, naming the gap.
3. A **manifest** — an ordered, authorization-checked list of that customer's Verified documents with type, filename, upload date, verifier and checksum. Each underlying document stays individually retrievable through 9.5.

**Explicitly not built:** a generated PDF (**D-055** forbade building a document-generation backend in Phase 4 and nothing has authorised one since) and a ZIP archive (a new production dependency, **D-006**).

**This is an owner-gated row.** The requirement is genuinely underspecified and the definition above is engineering's minimum reading. If the owner declines to define it, the honest close-out is to **reword the DoD box, not to mark it met**. 9.11 is the only row in the block fully gated on an owner answer; Phase 9's other ten rows proceed.

---

## D-075 · 2026-09-05 · ACCEPTED — Document objects are deleted before their rows, idempotently, including the cascade path

**Context.** `permanentDelete` (`services/recycle-bin.ts:245`) is a genuine hard delete. `documents.customerId` and `documents.loanId` both carry `onDelete: "cascade"`, so **purging a customer destroys document rows at the database level without passing through `softDelete`** — a document-scoped hook could never fire, and the objects would orphan.

**Decision.**

1. **Object first, row second, inside the purge transaction.** If the object delete fails the transaction rolls back and the row survives — recoverable. The reverse order can leave a KYC file that outlived its erasure, which is the compliance failure **SEC-017** names.
2. **Deletes are idempotent** — "already absent" is success.
3. **The customer and loan purge paths must enumerate document objects explicitly** before deleting the parent. This is inside row **9.8**, which re-rates **S → M**.
4. **Keep the FK cascade.** Removing it would make purge fail on FK violations — a data-model change no row owns.
5. **No orphan-sweeper job.** There is no scheduler in this system; a queue would be a permanently unprocessed table.

**`BIN_REGISTRY.document` (`services/recycle-bin.ts:75-79`) reads `row.bankId ?? null`, and `documents.bank_id` is `.notNull()`** — so no null-bank document can exist and **SEC-013 is not inherited** by Phase 9. It does, however, raise the blast radius of that finding's route from a database row to a KYC file. **SEC-013 stays OPEN with 13.9**, and the sequencing hazard — 13.9 lands *after* 9.8 — is recorded here rather than silently accepted.

---

## D-074 · 2026-09-05 · ACCEPTED — `documents.verify` is a new permission granted to Admin and Super Admin only

**Context.** `PERMISSIONS.documents` (`lib/permissions.ts:104-107`) has only `view`, `upload` and `delete` — **no verify key**. `documentsRouter.permissions.edit` maps to `PERMISSIONS.documents.upload` (`operations.routes.ts:543`), which is the exact route row 9.7 wires verify/reject to. Team Leader (`:288`) and Executive (`:310`) both hold `documents.upload`. **Row 9.7 as written ships KYC self-verification.**

**Decision.**

1. Add **`documents.verify`**; move `documentsRouter.permissions.edit` onto it. `documents.upload` no longer grants PATCH.
2. Grant to **Super Admin and Admin only**. Manager currently receives `...flat(PERMISSIONS.documents)` (`lib/permissions.ts:256`) and would silently inherit the new key — Manager's document permissions must therefore be **explicitly enumerated**.
3. **Four-eyes is achieved structurally, not by a runtime guard.** Because the roles that upload (Team Leader, Executive) are disjoint from the roles that verify (Admin, Super Admin), `verified_by != uploaded_by` holds by construction for the seeded role set. This is stronger than a check that can be satisfied accidentally, and it does not break the one-person case an unconditional guard would — the same tension **D-057** deferred four-eyes over for loans.
4. **Recorded consequence:** a sole Super Admin can both upload and verify. Accepted; the runtime guard stays deferred, not forgotten.
5. Frontend shows an **honest disabled state with a reason** for non-holders — **D-049**, not a hidden control and not a 403 toast.

**No permission is widened.** One narrower permission is created and granted deliberately. Its placement in the permission-matrix UI belongs to **12.1**.

---

## D-073 · 2026-09-05 · ACCEPTED — Upload security architecture, and OPEN-9 resolved by recorded risk acceptance

**Context.** Row 9.4 must add real multipart upload. The Excel importer is the roadmap's named reference for multipart handling, and it carries two defects Phase 9 must not copy.

**Decision — the upload contract.** Server-enforced size limit (`MAX_DOCUMENT_MB`) · extension allowlist (`pdf, jpg, jpeg, png`) · **magic-byte validation**, with client-declared MIME recorded but never trusted · **streaming, not `memoryStorage`** · **server-computed SHA-256** · **server-generated `storage_key`** shaped `{bankId}/{customerId}/{documentId}/{uuid}{ext}` · `assertBankAccess` plus `assertSameBank` on customer and loan · audit records filename, size, checksum and doc type and **never the bytes**.

**`storageKey` and `checksum` are removed from `createSchema`** (`operations.routes.ts:556`, `:557`). Both are client-supplied today and neither is ever written by the server — **SEC-024**. That finding must be **re-rated LOW → HIGH the day 9.3 lands**, because it is rated LOW only while no dereference point exists; **9.5 is the detonation, not 9.4.**

**Malformed multipart maps to `AppError` at the multer boundary, never in `error-handler.ts`** — **D-021** settled that a malformed input *"is rejected in the handler, not mapped in the error handler."* The importer's `fileFilter` rejects with a bare `Error` that the error handler cannot classify, producing a **500** — which contradicts row 9.4's own required test, *"oversize/wrong-type rejected with 4xx, not 500"*. Extracting a shared upload middleware closes **BUG-021** for the importer as a side effect. **SEC-008 is not inherited** — 9.4 stores, it does not parse — and remains OPEN with 13.7.

**OPEN-9 — RESOLVED by recorded risk acceptance.** Row 9.10's own text pre-authorises this: *"Add virus scanning, **or record accepting the risk** in DECISIONS.md."* Grounds: the bucket is private with no public access and no execution; content is served only through an authorization-checked route with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; magic-byte validation blocks the trivial masquerade. **Residual risk, stated plainly: a malicious PDF or JPEG can reach an operator's machine.** Revisit in Phase 13. **Nothing in the product may claim files are scanned.**

---

## D-072 · 2026-09-05 · ACCEPTED — Storage configuration follows D-034, and `MAX_UPLOAD_MB` is not reused

**Context.** No storage configuration exists — `config/env.ts` carries only `MAX_UPLOAD_MB` (`:69`), consumed solely by the Excel importer.

**Decision.** Add `STORAGE_PROVIDER` (a `z.enum` **allowlist of one**, mirroring `EMAIL_PROVIDER` at `config/env.ts:89`), `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_ENDPOINT` (optional, for S3-compatible providers), `STORAGE_SIGNED_URL_TTL_SECONDS` (default 300) and **`MAX_DOCUMENT_MB`** (default 15). Optional in the schema, **required in the production block**, per **D-034** — and production failure **names keys only, never values**.

**`MAX_UPLOAD_MB` must not be reused.** **SEC-008** frames it explicitly as the **zip-bomb decompression budget** for the importer. Raising the limit to fit a scanned multi-page bank statement would raise the importer's inflation ceiling as a side effect. Two limits, two risk profiles.

**Dev and test use a local filesystem adapter** behind the same interface, so the suite needs no network and no credentials. **No secret value is ever recorded in documentation.**

---

## D-071 · 2026-09-05 · ACCEPTED — OPEN-2: storage is provider-agnostic with AWS S3 `ap-south-1` as the default; owner ratification outstanding

**Context.** **OPEN-2** declares data residency for Indian KYC documents *"a legal constraint, not a preference"*, with **no owner assigned**. No statement of that obligation exists anywhere else in the repository: `README.md:14` records that file storage does not exist, `README.md:25` fixes the deployment as Vercel + Railway + Neon, and no India-region or residency requirement is written down.

**Decision — engineering default, pending owner ratification.** **AWS S3, region `ap-south-1` (Mumbai)** — private bucket, server-side encryption, no public access. Of the providers compatible with the documented deployment, it is the only one with an India region: Cloudflare R2 and Backblaze B2 have none, and Supabase Storage's nearest is not India.

**This does not block Phase 9.** Row 9.3 already mandates *"put/get/delete/signed-URL behind a **provider-agnostic interface**"*. **9.1, 9.2 and 9.3 proceed under the default; the pause point is 9.4's concrete adapter.** If the owner selects a different S3-compatible provider, the change is an endpoint and a credential — the interface, the tests and every consuming row are unaffected.

**Owner decision still required**, and recorded as such: engineering cannot confirm a legal data-residency obligation. Choosing a non-India region may create a compliance exposure this project cannot assess.

---

## D-070 · 2026-09-05 · ACCEPTED — The 8.8 chain, its idempotency, and why OPEN-7 does not block it

**Context.** Row 8.8 reads *"approving a settlement creates a transaction; a transaction creates a ledger entry."* Two premises had to be checked.

**Premise 1 — "inside existing transactions" — is false.** `afterCreate` fires on **create only** (`scoped-resource.ts:227`), and approve audits on the base handle (`:661`), so approve has neither a hook nor a transaction. **8.8 depends on D-062's `afterApprove`.**

**Premise 2 — that OPEN-7 blocks it — is also false, and the earlier gate report said otherwise in error.** Bank ownership flows down the chain: `settlements.bank_id` is `NOT NULL` (proved by `settlements_bank_period_unique` on `("bank_id", lower("period"))`, `drizzle/0000_init.sql:343` — a nullable column could not carry that predicate) → `transactions.createSchema.bankId` is **required** (`operations.routes.ts:494`) → the ledger entry is created *by 8.8*, which passes the bank explicitly. **Every 8.8-generated row carries a non-null `bank_id`.** `ledger_entries.bank_id` stays nullable (`:523`) only for hand-created global entries, which is what **OPEN-7 is actually about**. **OPEN-7 remains with Phase 11.6. No migration, no backfill, no `NOT NULL` change in Phase 8.**

**Chain semantics.** Trigger: the `→ Paid` edge on `POST /api/settlements/:id/approve`. Transaction: `txn_type = Commission`, `amount = settlement.net_payable`, `commission = 0` (**D-058** — commission arithmetic is not Phase 8's), `status = Success`, `settlement_id`, `bank_id` from the settlement. Ledger: `category = Commission`, `credit = net_payable`, `debit = 0`, **`balance = 0`** (**11.7** owns the running balance), `transaction_id`. All writes and all three audit rows on the **same** transaction handle. `nextResourceCode` **must receive `tx`** — reading through the base handle from inside a transaction deadlocks on a single-connection driver (**D-032**).

**Idempotency is not atomicity.** Atomicity prevents a *partial* chain; it does not prevent a *second* chain. Two partial unique indexes do:

```sql
CREATE UNIQUE INDEX transactions_settlement_unique
  ON transactions (settlement_id) WHERE settlement_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ledger_entries_transaction_unique
  ON ledger_entries (transaction_id) WHERE transaction_id IS NOT NULL;
```

**Partial is essential** — most transactions carry no settlement and most ledger entries no transaction; an unconditional index would permit exactly one NULL row each and break both tables. **This is D-027-compliant: D-027 forbids row locks, not constraints.** The predicates must be confirmed against the real schema (specifically whether `ledger_entries` carries `deleted_at`) and pre-flighted for existing duplicates before the migration is written.

**Legitimacy check.** One settlement produces one transaction because `Paid` is terminal; one transaction produces one ledger entry because reversals are a **new Refund transaction** with their own entry (D-069). Multi-tranche behaviour is a *disbursement* concept and is not in this chain.

---

## D-069 · 2026-09-05 · ACCEPTED — OPEN-4 resolved: financial records are immutable; corrections are compensating entries

**Context.** **OPEN-4** asks *"whether financial records (transactions, settlements) may be corrected or voided at all, and by whom"*, with no owner assigned, blocking row 8.7.

**The repository already answers it.** `BUSINESS_FLOW.md:690-694` defines the transaction machine as `[Pending] ──confirm──> [Success] (terminal, immutable)` and `└──reject──> [Failed] (terminal; **reversal is a NEW Refund txn**)`, with *"Guard: neither terminal state may be edited or deleted."* Corroborating: the factory emits no DELETE for either resource (`operations.routes.ts:481-485`, `:443-447`), neither permission set has a `delete` key (`lib/permissions.ts:88-97`), and `txn_type` already includes **`Refund`** (`:501`) — the compensating vocabulary is in place.

**Decision.** Financial records are **immutable in terminal states**; corrections are made by **compensating entries**, using the existing `Refund` transaction type. **No void or edit workflow is built in Phase 8.**

**Row 8.7 therefore builds nothing.** It records the decision, documents the Refund flow in `BUSINESS_FLOW.md`, and adds tests proving a terminal transaction or settlement cannot be modified through ordinary routes. **Effort M → S.**

**Owner ratification is welcome but not blocking**, because choosing this option means writing no code — nothing must be unwound if the owner later prefers a void path. The consequence of choosing otherwise is a new Phase 8 row and a new elevated permission.

---

## D-068 · 2026-09-05 · ACCEPTED — Phase 7 fixes money on the server only; the frontend representation is Phase 11

**Context.** Row 7.7 reads *"keep `numeric` in the DB, stop casting to `::float` in the dashboard aggregates, and adopt a decimal type or integer paise in the frontend instead of `Number()`."* Measured: **5** `::float` casts, all in `operations.routes.ts` (`:705`, `:707`, `:709`, `:769`, `:770`); **115** `num()` call sites in the frontend; 14 money columns, all `numeric NOT NULL DEFAULT '0'` (`DATA_MODEL.md:214`).

**Decision — Phase 7 ships part A only.** Remove the five `::float` casts, aggregate exactly, return the sums as strings, and harden `formatCurrency`/`formatNumber`/`formatPercent` with `Number.isFinite` — which also fixes the `₹NaN` defect (row 7.5) at its root rather than at one call site. **Blast radius: five dashboard aggregate fields. This is the block's only wire-format change.**

**Deferred to Phase 11**, which owns reports and the ledger: transporting per-row money as strings (14 columns across 5 resources plus demo fixtures and `lib/types.ts` — a genuinely breaking contract change) and any frontend decimal representation. **11.7** (running balance) and **11.8** (decimal input) are the rows that actually perform frontend money arithmetic.

**No new dependency, and therefore no D-006 gate.** JS doubles carry 15–17 significant digits, far more than INR amounts in this product require for display; the exposure is *arithmetic*, and part A removes float arithmetic from the server entirely. A decimal library would need a superseding decision under **D-006** and is not taken here.

**Mandatory rider.** Phase 7's third DoD box, *"Money is exact from input to aggregate"*, receives a recorded scope note — *"exact from input through server aggregate; frontend decimal representation is Phase 11"* — following the precedent of Phase 5's DoD scope notes. **The box must not be silently marked met.**

---

## D-067 · 2026-09-05 · ACCEPTED — A NULL UTR is a valid in-flight state; the partial unique index is already correct

**Context.** `disbursements_utr_unique` (`drizzle/0000_init.sql:314`) is partial: `WHERE deleted_at is null and utr is not null`. Unlimited rows may therefore share `utr = NULL`, and the Phase 7 test line *"duplicate UTR still 409s"* does not cover that.

**Decision — change nothing in SQL.** A disbursement is recorded when the transfer is initiated; the UTR arrives from the bank afterwards, and the create form already treats it as optional (`disbursement/page.tsx:68`). Several in-flight transfers may legitimately await their UTRs at once, so **multiple NULL rows are correct** and uniqueness must apply to real UTRs only — which is exactly what the existing predicate expresses.

**The rule is temporal, not structural**, and `BUSINESS_FLOW.md:665` already states it: ***"Guard on ->Credited : utr must be non-null."*** It belongs in row **7.3's transition guard**, where the row is already loaded.

**Add one test** — a second disbursement with `utr: null` is accepted (201) and neither may reach `Credited` — closing the gap the roadmap's test line leaves. A `NOT NULL` column or a full unique index would both **break** legitimate in-flight state.

---

## D-066 · 2026-09-05 · ACCEPTED — Workflow status is written by the approve route alone, on disbursements and settlements as it is on loans

**Context.** **D-056** closed two privilege bypasses on loans and handed the same question to bank orders (6.5) and disbursements (7.3), but **under-specified the remedy**: those rows add enums and CHECK constraints, and neither adds a PATCH refusal. Verification found the bypass live one resource over. `patchSchema` retains the create enum, so vocabulary *is* guarded on create and PATCH — **the hole is privilege, not vocabulary.**

| Instance | Role that gains | Evidence |
|---|---|---|
| `POST /api/disbursements {"status":"Credited"}` → 201 on `create` alone | Manager holds create, not approve | `lib/permissions.ts:250-251` |
| `PATCH /api/disbursements/:id {"status":"Credited"}` on `edit` alone | Manager holds edit, not approve | `:251` |
| `POST /api/transactions {"status":"Success"}` → 201 on `create` alone | Manager holds create, not edit | `:253-254` |
| `POST /api/settlements/:id/approve {"status":"banana"}` persists | any approver | `operations.routes.ts:447` + the `z.string().min(1)` fallback at `scoped-resource.ts:369` |

**Decision — the same three-part rule loans already follow, applied per resource.**

| Route | Rule | Mechanism |
|---|---|---|
| CREATE | only a legal initial status | `initialStatuses` |
| PATCH | `status` **refused, 422** | `patchRefusals` + `notOnThisRoute()` (**D-025**) |
| APPROVE | vocabulary + legal edge + preconditions | `allowedStatuses`, `allowedTransitions` |

Initial statuses: disbursements `In Transit`; settlements `Pending`; transactions `Pending`; bank orders `Login` / `In Progress`.

**Two roadmap rows must be corrected**, because following them literally reopens what D-056 closed. Row 7.1 reads *"Wire 'mark credited' to `PATCH /api/disbursements/:id`"* and row 8.3 reads *"Wire settlement 'mark paid' to `PATCH /api/settlements/:id`"*. **Both must call the approve route.** Non-authoritative fields (`credited_to`, `disbursed_on`, `settled_on`) carry no authority and remain ordinary PATCH fields.

**Transactions are the exception that proves the rule:** they have **no approve route and no `transactions.approve` key** (`lib/permissions.ts:94-97`), so PATCH is their only status writer and must carry the transition guard directly — via **D-062's `transitionColumn`** mechanism.

**No permission is widened.** Every closure narrows what a route accepts (**D-049**).

---

## D-065 · 2026-09-05 · ACCEPTED — Phase 6 loads the whole board and labels its statistics honestly; it does not adopt server pagination

**Context.** The bank-orders Kanban board and every StatCard derive from `useResource<BankOrder>("/bank-orders")` (`bank-orders/page.tsx:54`) at the 25-row default (`scoped-resource.ts:250`), so **a card can be invisible and therefore unadvanceable** — which touches the DoD's *"advanced … from the UI"*.

**Decision — no new row, no new endpoint.** Fold into **6.6**: the board fetches with `pageSize: 500`, the schema's documented maximum, using the idiom the page already applies to reference data (`:49`, `:52`); StatCards are relabelled to state the scope they actually measure; and when `meta.total > 500` the board surfaces an honest notice rather than truncating silently.

**Server pagination is deliberately not adopted here.** **D-051** constraint 5 — *sorting must not lie* — bites immediately: there is no `sortBy` query parameter, so adopting server paging would force hiding sort affordances on a board whose SLA ordering is the point. Server pagination and `sortBy` belong to **Phase 11**, alongside the global export **11.9** already owns.

**No aggregate endpoint is built.** No DoD clause requires whole-bank statistics, and building one would pull Phase 11 reporting forward (**D-043**). What the DoD requires is that the page not *claim* whole-bank figures — which is a copy change, not an architecture.

---

## D-064 · 2026-09-05 · ACCEPTED — Bank-order remarks overwrite a single column; the audit log is the file trail

**Context.** Row 6.2 says *"Wire remarks to `PATCH /api/bank-orders/:id` so the 'file trail' is real. **Consider** an append-only remark history rather than overwriting a single column."*

**What the documentation actually requires.** PRD **R6.2**: *"An operator shall move a bank order to the next stage and **record a remark against the file trail**"* (`PRD.md:727-728`). `DATA_MODEL.md:708` lists `officer`, `remarks` as `text` — **one column, and no remark-history table among the 29.** No PRD requirement, no state machine and no DoD clause asks for history. The phrase *"file trail"* originates in the fake handler's own toast string (`bank-orders/page.tsx:72`), not in any requirement.

**Decision — Option A: keep the single `remarks` column and overwrite it.** A history table would add a migration (serialising against seven other rows under **D-050**), a new API surface, bank scoping, ordering and soft-delete semantics — to satisfy a requirement no document states. That is the annexation **D-043** forbids.

**Mandatory rider under D-004.** Overwriting is honest only if the UI stops implying a ledger: the control's copy changes to **"Remarks updated"** and the field is presented as a single current remark. **The audit log is the file trail** — `diff()` already records the before and after of `remarks` on every PATCH, so history is preserved where this system already keeps history.

**Recorded for a later phase:** if a true append-only trail is wanted, it is a new row in a phase that owns bank-order data modelling, specified in full then. **Not Phase 6.** Row 6.2 re-rates **M → S**.

---

## D-063 · 2026-09-05 · ACCEPTED — Bank orders have two workflow machines, and Phase 6 owns both

**Context.** `bank_orders` carries **both** `stage` (default `Login`) and `status` (default `In Progress`), both `text NOT NULL` with no CHECK, both enum-validated on create (`operations.routes.ts:317-320`). Row 6.1 names only *"a validated **stage** transition map"* and row 6.5 only *"**stage** enums + DB CHECK constraints"* — **leaving `bank_orders.status` owned by no Phase 6 row.**

**Both are real workflow state machines.** `BUSINESS_FLOW.md:636-647` and `:649-656` define two separate diagrams. Neither column is derived, deprecated or future-phase. `stage` is the lender's pipeline position; `status` is the health of that file. They are **coupled**: `Cleared` requires a terminal stage, and `Returned → rework` resets the stage to `Login`.

**Decision.** **6.5 adds both CHECK constraints in one migration; 6.1 configures both transition maps** — one mechanism applied twice. Correct both row texts accordingly. **Neither column is left unowned.**

**A combined machine over the `(stage, status)` pair is rejected:** the two have different alphabets and different terminal semantics, and the coupling is two guards, not a product state space.

**6.1 needs a factory extension, not configuration.** Phase 5's machine is bound to a column literally named `status` and enforced at create and approve. Bank orders have **no approve route** (`operations.routes.ts:301-306` configures no `approve`, and the route is conditional at `scoped-resource.ts:613`), so PATCH is the only transition point — which is what **D-062's `transitionColumn`** exists for. Row 6.1 re-rates **M → L**; 6.5 re-rates **S → M**.

---

## D-062 · 2026-09-05 · ACCEPTED — The factory gets a transactional PATCH/approve and an `afterApprove` hook; `afterCreate` is never generalised

**Context.** Four rows in four phases — 6.1, 7.3, 8.8 and 10.3 — each independently require something the factory does not have. Verified: **CREATE is transactional** (`db.transaction` at `scoped-resource.ts:513`, `afterCreate` at `:526`, `recordAudit(tx …)` at `:528`), but **PATCH is not** (update `:568`, audit `:578` — two autocommits, no hook) and **APPROVE is not** (audit `:661` — same shape). A write can therefore commit while its audit row fails.

**Decision — three narrow changes, shipped as one prerequisite task `F1`.**

**F1-a — transactional PATCH and APPROVE.** Wrap both handlers in `db.transaction` and move `recordAudit` inside, passing `tx`. No new configuration, no API change.

**F1-b — `afterApprove(before, after, { tx, ctx, req, input })`**, symmetric with `afterCreate`'s shape and receiving the transaction handle.

**F1-c — `transitionColumn?: string`, default `"status"`**, plus PATCH-side transition enforcement gated on it being configured. This is what 6.1 needs; a hook is not.

**`afterCreate` must NOT be generalised to `afterWrite`.** The factory's own comment states the convention (`scoped-resource.ts:227-229`): *"Named `afterCreate`, not `afterWrite`, because it fires on create only. `beforeWrite` runs on create and patch, so reusing that word would promise a symmetry that does not exist."* Generalising it here would be **actively dangerous**: disbursements' `afterCreate` advances the loan to `Disbursed` and audits it (`operations.routes.ts:422-436`), and firing that on every PATCH would re-run a state transition on unrelated edits. **A general transaction callback is rejected for the same reason.**

**Hooks receive `tx` and must never call `getDb()` or open a nested transaction** — reading through the base handle from inside a transaction deadlocks on a single-connection driver (**D-032**). `nextResourceCode` already accepts a `CodeExecutor` (`scoped-resource.ts:100-103`) and must be passed `tx`.

**Compatibility.** `afterApprove` and `transitionColumn` are **opt-in**, following the discipline the existing state-machine fields already document (`:162-169`): a resource configuring neither is byte-for-byte unchanged. Responses are built from the `returning()` row (`:587`) and do not change. `recordAudit(tx as never, …)` is the established house pattern, documented at `:86-88`.

**One observable change, and it is the intended fix:** an audit failure now rolls the data write back instead of leaving it committed.

**Do not:** add row locks (**D-027**) · add triggers (**D-057**) · redesign the ORM abstraction.

---

## D-061 · 2026-09-05 · ACCEPTED — Task 5.8 redefines the loans search promise honestly rather than adding a JOIN

**Context.** Phase 5 Wave 0. Moving the loans list to server-side search changes which fields are matched.

| | Fields |
|---|---|
| Server searchable (`operations.routes.ts:63`) | `code` · `applicationNo` |
| Client `searchText` (`loans/page.tsx:237-239`) | `code` · `applicationNo` · customer name · bank name · `loanType` |
| Placeholder promises (`:236`) | *"Search loan ID, application number, or customer"* |

**D-053 puts preservation first.** For customers that was one line — `pan` is a column on `customers`, so `ilike(customers.pan, needle)` joined the existing disjunction. **Here it is not.** `loans` carries only a `customerId` FK (`db/schema/operations.ts:92`); customer name lives on another table, so preserving the promise would require a **JOIN** — a new search architecture, which D-053 explicitly does not authorise (*"Extending the existing `or(...)` is in scope; a search service, an index or a new endpoint is not."*).

**Decision.** Take D-053's **second** branch: redefine honestly. The placeholder is reworded to name only `code` and `applicationNo`, and `searchText` is aligned to the same corpus so the two cannot drift.

**The backend corpus is not shrunk** — it is untouched. What changes is a UI claim that currently over-promises. **No API contract change.**

**The frontend query contract, settled:**

| Param | Primary `/loans` | Contextual | Note |
|---|---|---|---|
| `search`, `page`, `pageSize`, `status`, `loanType`, `bankId` | **sent** | — | `pageSize` must equal the `DataTable` prop |
| `customerId` | not sent | **sent** by `customers/[id]/page.tsx:260` | Already live, pinned by `frontend-contract.test.ts:123` — **preserve** |
| `priority`, `assignedUserId`, `assignedTeamId` | **not sent** | — | No UI control exists. **Do not invent one**; the server capability stays intact |

**Consequences.** Losing customer-name search is a real, recorded loss; what replaces it searches the whole book rather than one loaded page. A JOIN-backed search is a legitimate later row, in a phase that owns search.

---

## D-060 · 2026-09-05 · ACCEPTED — Task 5.7 must create the transaction it was written to reuse, and its first clause is already shipped

**Context.** Row 5.7 read *"Implement cross-stage side effects inside the existing transactions: approving sets `approvedBy`/`approvedAt`; creating a disbursement advances the loan status."* Both halves were verified against the code and both are wrong.

**Clause 1 is already implemented.** `scoped-resource.ts:403`:
```ts
...(table.approvedBy ? { approvedBy: ctx.userId, approvedAt: new Date() } : {}),
```
`table.approvedBy` is a Drizzle column object — truthy whenever present — and all four approve-enabled tables define it (`db/schema/operations.ts:123-124`, `:170-171`, `:241-242`, `:276-277`). Independently confirmed at `BUSINESS_FLOW.md:296` and by PRD R8.1 AC2 (**IMPLEMENTED**).

**There are no "existing transactions" to work inside.** `grep '\.transaction('` returns **zero** hits in `scoped-resource.ts` and `operations.routes.ts`. All fourteen sites in `src` are in `admin.routes.ts`, `imports.routes.ts`, `services/invitations.ts`, `services/password-reset.ts` and `services/recycle-bin.ts`. The approve, create and patch paths each issue their write and their audit insert as **separate autocommitted statements**.

**Decision.** 5.7 **creates** the boundary:

1. A new `afterWrite`-style hook on `ScopedResourceConfig` that receives the **transaction handle** and the created row. `beforeWrite` cannot serve — it fires at `scoped-resource.ts:275`, before the insert, so the new row does not yet exist.
2. Disbursement creation wraps insert + loan-status advancement + audit in one `db.transaction`.
3. **Clause 1 is not reimplemented.**

**Groundwork already exists:** `CodeExecutor` (`scoped-resource.ts:72`) is typed so a transaction handle can mint codes, and `recordAudit` *"deliberately accepts the same `db` handle the caller is using, so that when the caller is inside a transaction the audit row commits or rolls back atomically"* (`services/audit.ts:45-49`). Neither is used that way today.

**Consequences.** `workflow.test.ts:218` creates a `"Submitted"` loan and `:285-298` disburses against it — a fixture the new state machine makes illegal. It must be walked through the real workflow. That is a **correction**, not a weakening: `BUSINESS_FLOW.md:707` already records that the test *"never asserts that the loan status changed. The name overstates what is verified."*

---

## D-059 · 2026-09-05 · ACCEPTED — The loan create dialog's Bank selector is removed, not wired

**Context.** Phase 5 Wave 0, row 5.11. `loans/page.tsx:345-356` renders a Bank `<Select>` bound to `resolvedBankId` and writing `form.bankId`. `createLoan` submits `bankId: customer.bankId` (`:87`). **The selection is discarded.** `resolvedBankId` falls back to `banks[0]?.id` (`:65`), so the control usually displays a bank other than the one used. `INTEGRATION_MAP.md:310` already grades it **MISSING** — *"the control has no effect on the request"*.

The code even comments on it (`:85-86`): *"The loan always belongs to the customer's bank; the backend rejects a mismatch, so there is no point offering a free choice here."* The reasoning was right; the control was left rendered.

**Decision.** **Remove** the selector; display the customer's bank read-only where it aids context. Do **not** make the choice live — `assertSameBank` (`operations.routes.ts:34-49`) enforces the customer↔bank pairing, so a free choice can only ever produce a refusal.

**Consequences.** A control users can interact with today disappears. That is the guiding principle at `PRODUCTION_ROADMAP.md` §0 — *"a control either performs the action or is disabled/removed"* — and the same call D-055 made for the Draft application. **No second bank-selection contract is created and backend scoping is untouched.**

---

## D-058 · 2026-09-05 · ACCEPTED — The "EMI is calculated on submit" claim is removed, and no EMI is computed

**Context.** Phase 5 Wave 0, row 5.10. `loans/page.tsx:320-322` tells the user: *"EMI is calculated on submit using the rate and tenure you enter."*

**Verified false.** `createLoan` (`:83-94`) sends `customerId`, `bankId`, `loanType`, `amountRequested`, `interestRate`, `tenureMonths`, `status`, `appliedOn` — **`emi` is not among them**. The server applies `emi: money.default(0)` (`operations.routes.ts:81`) and writes zero; the demo layer hardcodes `emi: "0"`. The detail dialog then renders `—` forever (`:284`). **No EMI is computed anywhere in `src`.**

**Decision.** Delete the sentence. **Do not implement an EMI calculator.**

**Consequences.** Computing an EMI is new product arithmetic — an interest formula, a rounding convention and a rate basis nobody has specified — inside a row rated **S**. That is precisely what **D-054** refused when it declined to invent disbursal locking to make a badge true. If EMI is wanted it is its own row, with its own decision, in a phase that owns loan mathematics. `processingFee` and `commission` are always `0` for the same reason and stay recorded, not fixed.

---

## D-057 · 2026-09-05 · ACCEPTED — Phase 5's state machine guards transition legality only, and the DB guards vocabulary only

**Context.** Row 5.2 requires *"an `allowedTransitions` map… plus DB `CHECK` constraints on the status columns"*, and **D-010** requires *"explicit transition validation in the service layer **and** DB `CHECK` constraints, per resource, in Phases 5–8"*. `BUSINESS_FLOW.md:552-580` already carries a candidate machine — labelled *"Proposed target. None of this exists today."* — whose guard block reaches well beyond transition legality.

**Decision — the Phase 5 guard set is exactly three things:** legal `from→to` transitions, a legal **initial** status on create, and the approve-route **vocabulary** enum (5.3).

**Deferred, with the reason recorded rather than the guard quietly dropped:**

| Guard | Why not Phase 5 |
|---|---|
| Verification row required on `Submitted→Under Review`; `verification.status IN (Verified)` on `→Approved` (`BUSINESS_FLOW.md:573-574`) | **Business preconditions, not transition legality.** Named by no roadmap row and no DoD clause |
| All required documents Verified (`:575`) | **Phase 9.** There is no file storage anywhere in the repository |
| `sum(disbursements WHERE Credited) >= amount_approved` on `→Disbursed` (`:576-577`) | `amount_approved` is **never populated** (**D-056**) — the guard would make the transition permanently impossible |
| Four-eyes, `actor != loans.created_by` (`:578`) | A **new business rule**. No row in any phase owns it |

**This does not weaken the machine.** Phase 5 ships the **complete transition graph** over all seven statuses; what is deferred is a different class — additional preconditions gating an otherwise-legal edge.

**DB scope: `loans.status` only.** 6.5 owns bank-order stages (*"same pattern as Phase 5.2"*, `PRODUCTION_ROADMAP.md:391`), 7.3 owns disbursements (`:425`), and 13.13 is the sweep (`:680`). `verifications.status` is named by no row; the loan sub-route **derives** it server-side (`operations.routes.ts:151-158`) and the factory route already constrains it with `z.enum`.

**A CHECK enforces vocabulary, never a transition** — it sees only the candidate row. **No trigger is added.** Migration `0007` uses `ADD CONSTRAINT … NOT VALID` followed by a separate `VALIDATE CONSTRAINT`, with a documented pre-flight offender query: the approve route has written arbitrary strings since launch, and the test harness migrates a **fresh empty** PGlite database (`tests/harness.ts:43-45`), so it can prove syntax but never data compatibility. Concurrency posture is unchanged — **D-027** keeps check-then-write and BUG-037 deferred; **no row locks are added**.

---

## D-056 · 2026-09-05 · ACCEPTED — Loan status and `amountApproved` are refused on PATCH; the approve route is the only writer

**Context.** Phase 5 Wave 0. `PATCH /api/loans/:id` requires `requests.edit` (`operations.routes.ts:57`) and spreads the parsed body wholesale (`scoped-resource.ts:333-341`). `patchSchema` strips the `.default` but **keeps the enum** (`lib/zod.ts:50-59`), so `PATCH {"status":"Approved"}` succeeds today.

**This is a privilege bypass, and it was recorded nowhere.** **Team Leader holds `requests.edit` but not `requests.approve`** (`lib/permissions.ts:276-279`). A Team Leader can therefore approve a loan through PATCH — leaving `approved_by` **NULL**, because only the approve route stamps it (`scoped-resource.ts:403`), and auditing the change as `"updated"` rather than `"approved"`. **SEC-016 covers only the approve endpoint**, so this is outside it. `BUSINESS_FLOW.md:297` independently flags that PATCH *"would accept `status`, `amountApproved`…"*.

**Guarding the transition would not close it.** `Draft→Submitted→Under Review→Approved` are all *legal* edges, so a `requests.edit` holder could still walk a loan to Approved lawfully. **Only refusal closes it.**

**Decision.** `PATCH /api/loans/:id` **refuses `status` and `amountApproved`** with 422, using the existing `notOnThisRoute()` helper (`lib/zod.ts:93`) — exactly as `PATCH /api/users/:id` refuses `bankIds`/`teamId` under **D-025**, and for the identical reason: *the field belongs to the route that owns it*.

**Task 5.5's editable set is therefore exactly seven fields:** `loanType`, `amountRequested`, `interestRate`, `tenureMonths`, `priority`, `dueDate`, `notes`.

**Verified safe:** **no test PATCHes a loan status** (grep across `src/tests`), and `PATCH /api/loans/:id` has **zero frontend callers**. Nothing breaks.

**Consequences.** The approve route becomes the single writer of loan status, which is what 5.2, 5.3 and 5.4 all assume. Applied to **loans only** — bank orders (6.5) and disbursements (7.3) own their own. 5.7 writes status server-side inside its transaction, not through PATCH, so it is unaffected.

---

## D-055 · 2026-09-05 · ACCEPTED — The "Draft application" generator must not emit default values as customer facts

**Context.** Phase 4 Wave 0. `customers/page.tsx:107-226`, button at `:619-627`, builds an HTML document from the **create-dialog form state**, which sits at its initial values unless that dialog was opened.

Clicked standalone it emits: applicant **`"Customer"`** (`:109` — `form.name.trim() || "Customer"`), bank **`banks[0]`** (`:172` via `resolvedBankId` at `:94-95`), income **₹45,000** (`:193`, from the hardcoded `monthlyIncome: "45000"` default at `:91`) — inside a document whose own body reads *"Use this draft for manual verification and re-upload the filled form when needed"* (`:198-201`).

**This is not a D-004 violation.** The toast *"Draft application downloaded"* (`:222`) is **true** — a file really is produced. The defect is the artefact's **content**: fabricated values presented as a specific customer's details, in a document offered for verification and onboarding.

**Decision.** Owned by new roadmap row **4.11**. Remove the control unless the PRD authoritatively specifies a real draft-application document — it does not; R3 contains no such requirement. **No document-generation backend may be built in Phase 4**, and default values must never be emitted as though they were customer facts.

**Consequences.**
- A control users have today is removed. That is the guiding principle at [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md) §0: *"a control either performs the action or is disabled/removed."*
- If a real draft application is wanted later it is its own row, with its own decision, in a phase that owns document generation.
- Phase 4 DoD box 4 cannot be honestly ticked while this control stands, which is why it is a row and not a note.

---

## D-054 · 2026-09-05 · ACCEPTED — The "Record locked for audit after disbursal" badge is a false compliance claim and must go

**Context.** Phase 4 Wave 0. `customers/[id]/page.tsx:422` renders, unconditionally and to every role:

```tsx
<Badge variant="outline">Record locked for audit after disbursal</Badge>
```

**Verified false.** A grep for `Disbursed` / `loanStatus` / `loans` / `locked` across `src/modules/customers.routes.ts` returns **nothing**. `PATCH /:id` (`:252-307`) and `DELETE /:id` (`:309-330`) carry exactly four guards — `requirePermission`, `idParam.parse`, `isNull(deletedAt)` and `bankScope`. **A disbursed customer is fully editable and fully deletable.**

The badge sits **one line above the Delete button** that Task 4.2 wires (`:423-425`), so 4.2's implementer will read it and leave it.

**Decision.** Owned by new roadmap row **4.10**. Remove the badge, or replace it with a statement the backend actually enforces. **Do not invent loan/disbursal locking to make the claim true** — the PRD specifies no such rule, and inventing one is a new business rule, not a fix.

**Consequences.**
- On a banking application a false assurance in a compliance register is the same defect class RULES §4 names for the 2FA switch: *"a security control that reports being enabled when it is not."*
- Whether disbursed customers *should* be locked is a real product question. It is **not** answered here and belongs with the loan workflow (Phase 5) or a data-integrity phase.
- Removal is not a regression: nothing was ever enforced.

---

## D-053 · 2026-09-05 · ACCEPTED — Task 4.5 must not silently regress the customer search contract

**Context.** Phase 4 Wave 0. Moving search server-side changes **which fields are searched**, and nobody had noticed the corpora differ:

| | Fields |
|---|---|
| Client today (`customers/page.tsx:733`) | `name` · `id` · `mobile` · `pan` · `city` |
| Placeholder promises (`:731`) | *"Search by name, ID, mobile, or PAN"* |
| Server (`customers.routes.ts:146-152`) | `name` · `mobile` · `code` · `bankReferenceId` |

Task 4.5's row says only *"Send `page`, `search`, `status`, `bankId`"*. Implemented literally, the search silently **loses `id`, `pan` and `city`** and **gains `code` and `bankReferenceId`** — while the placeholder keeps promising ID and PAN. Worse, `customer.code` is rendered **nowhere** on either customer screen (both display the raw `id`), so a user cannot know what the box now matches.

**Decision.** The search promise may be **preserved** or **honestly redefined**, but never silently changed.

1. First determine whether the authoritative backend contract can honour the current promise within 4.5 — **without inventing a new search architecture.** Extending the existing `or(...)` in `listQuery` is in scope; a search service, an index or a new endpoint is not.
2. If it can, preserve the promise.
3. If it cannot, **the placeholder text changes in the same commit** to name exactly what is searched.

**Under no circumstances may the UI claim a field the server does not match.**

**Consequences.**
- A user searching by PAN and getting nothing is the same class of quietly-wrong UI as the dead search box 4.5 exists to fix.
- The `code`-is-invisible problem is noted, not fixed here: making `code` the displayed identifier is unowned and stays out of scope (see the raw-UUID entry in Phase 4's out-of-scope list).

---

## D-052 · 2026-09-05 · ACCEPTED — The customer edit dialog keeps its four fields; Aadhaar and the assignment fields stay out

**Context.** Phase 4 Wave 0, Task 4.1. `PATCH /api/customers/:id` accepts **27** fields (`patchSchema(customerInput)`, `customers.routes.ts:261`); the existing dialog renders **four** — name, mobile, email, address (`customers/[id]/page.tsx:437-452`). The row says *"make the detail edit dialog controlled and wire it"*, not *"expand it"*, and is rated **M**.

**Decision.** Ship exactly the four existing fields, with changed-fields-only PATCH semantics.

**Excluded, each for its own reason:**

| Field | Why it stays out |
|---|---|
| `aadhaar` | Not round-trippable and **destructive**. `aadhaar: ""` or `null` passes the schema and `aadhaarFields` (`:114-121`) nulls **both** `aadhaarHash` and `aadhaarLast4` — irreversible. A 12-digit mask would silently overwrite the real hash. The employee precedent (`employee-patch.ts:32-53`) makes un-round-trippable fields **absent by construction**. |
| `assignedUserId` / `assignedTeamId` | Owned by **4.7**, which is itself decision-blocked (**D-047**, **D-048**). |
| `bankId` | Moving a customer between banks is a scope-changing operation, not a profile edit. |
| the other 20 | Each added field multiplies the round-trip surface and the SEC-017 audit-diff surface for no DoD gain. |

**Changed-fields-only is mandatory, not stylistic.** Re-sending unchanged values would be *accepted* by the API and would silently overwrite whatever a colleague changed since the dialog opened — turning a data-loss bug into a lost-update bug. Build the diff in a dedicated module (the `lib/employee-patch.ts` pattern) so it is testable in isolation.

**Consequences.**
- **KYC stays unreachable.** No screen exposes a KYC transition and creation hardcodes `kyc: "Pending"` (`customers/page.tsx:327`). DoD box 1 says *"every customer control"*, not *"every customer field"*, so 4.1 satisfies it literally — but this is **recorded, not absorbed**, so nobody reads the ticked box as "customer editing is finished".
- **Backend empty-string asymmetry, recorded not fixed:** `POST` normalises `email`/`altMobile`/`pan`/`pincode` `""` → `null` (`:228-231`); `PATCH` spreads `...rest` raw (`:285`) and writes `""`. **The client therefore sends `null` for a cleared box**, keeping 4.1 entirely in the frontend. The backend asymmetry is a finding for whoever next opens that file.
- Expanding the field set later is a separate decision, taken once one field set is proven safe end to end.

---

## D-051 · 2026-09-05 · ACCEPTED — Task 4.5 moves paging to the server without creating a misleading table

**Context.** Phase 4 Wave 0. `data-table.tsx` is a **317-line shared component with eleven consumers**, and owns search, filters, sort *and* paging as internal state (`:79-83`), slicing client-side at `:116`. The backend list route already reads `page`/`pageSize`/`search`/`bankId`/`status` and returns `meta.total` (`customers.routes.ts:141-176`), and `useResource` already exposes `total`/`loading`/`error` (`use-api.ts:7-14`) — the page simply never destructures them. So 4.5 is **entirely frontend**, and its risk is **blast radius**, not difficulty.

**Decision.** Seven binding constraints:

1. **Additive props only.** `total`/`page`/`onPageChange` and the search/filter callbacks are **optional**; absent them, `DataTable` keeps its exact current client-side behaviour. The ten non-customer consumers must not change.
2. **Write the DataTable regression test first.** There is no test for this component today, and none for either customer page. The test that proves default client paging still works must exist **before** the component is edited.
3. **Fix the pager cap.** `:293` renders at most six numbered buttons. Under real totals, pages 7+ have no button — DoD box 2 fails.
4. **Add the server-side `kyc` filter.** `listQuery` accepts only page/pageSize/search/bankId/status. Without `kyc`, a user filtering `KYC=Rejected` reads *"0 records match"* while rejected customers sit on page 3. Extending the enum filter mirrors `status` two lines above it. **This is the one backend edit 4.5 may make.**
5. **Sorting must not lie.** There is no `sortBy` parameter and the server orders unconditionally by `desc(createdAt)`. A header that sorts only the visible page while presenting itself as table-wide is the defect 4.5 exists to remove. **Hide the affordance**; real server sorting is a follow-up, not scope creep inside an L row.
6. **Export scope must be honest.** The export maps the client array and toasts that count (`:129-142`). Under server paging it silently becomes per-page. **Relabel it "current page"** — Phase **11.9** owns a real global export.
7. **StatCard wording must be truthful for the loaded view.** `% of book` (`:698`) is computed over the loaded rows and gets *worse* under paging. The page already sets the honest precedent itself: the first card reads `"in this view"` (`:690`).

**Consequences.**
- 4.5 is a cross-cutting shared-component change, not a customer-page change. Sequence it **before Phase 5.8** so loans consume this prop surface rather than inventing a rival one.
- 4.5 must run **after 4.8** — 4.8 builds the loading/error scaffolding 4.5's new fetch states reuse.
- Constraints 5–7 keep DoD box 4 honest for defects 4.5 itself introduces. See **D-053** for the search corpus.

---

## D-050 · 2026-09-05 · ACCEPTED — Customer code generation is one defect across three sites, and the roadmap's stated diagnosis is wrong

**Context.** Phase 4 Wave 0, Task 4.9. The row as written was wrong in three ways, and a literal implementation would have **introduced** a defect.

**(1) "Shared with Phase 2.11" is false.** Task 2.11's own in-line correction says so: *"**No `count(*)` generator ever underlay employee codes**… That bug is untouched here."* `nextEmployeeCode` (`admin.routes.ts:128-141`) is a **max-based** generator, not a sequence, and its docstring says *"Not `count(*)`"*. **4.9 is 100% untouched work.**

**(2) Three sites, not one.** `customers.routes.ts:123`, the shared factory `scoped-resource.ts:88` (six further series — LN, BO, DSB, STL, TXN, LG), and the Excel importer `imports.routes.ts:388`, which mints `CUS-` codes **independently**. Customer codes come from **two** implementations sharing **one** partial unique index. Putting the route on a sequence while the importer keeps counting would make them collide **with each other** — a regression Phase 4 would introduce.

**(3) ⚠️ The `deleted_at` clause is backwards.** The row blamed *"`count(*) + 1` with no `deleted_at` filter"*. **The absence of that filter is load-bearing correctness.** [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md#bug-011) states it plainly: *"**Soft delete alone is safe**, because the row remains and still counts."*

Add the filter and: soft-delete a customer → the count drops → the next create is issued **that customer's code** → `customers_code_unique` is **partial** (`WHERE deleted_at is null`, `0000_init.sql:286`) so it permits the duplicate → **restoring that customer from the recycle bin becomes permanently impossible.** That directly violates PRD **R3.1 AC3** — *"A restored-from-bin record does not permanently poison a reference id."* For `ledger_entries` and `transactions`, whose code indexes are **unconditional** (`0002_operations.sql:325,345`), it is an immediate `23505`.

**Decision.**
- The three sites are **one logical defect** and must share **one** generation mechanism.
- **Use a Postgres sequence**, as the roadmap requires — one per prefix, lock-free.
- **Initialise from the highest code ever issued**, including soft-deleted rows and retained recycle-bin snapshots of purged records, so no code is ever reissued. This honours BUG-011's *"never reused, whatever happens to older rows"* and follows **D-032**'s reasoning for the employee analogue.
- **Preserve the existing first-issued value** (`codeStart + 1`): no test constrains it, and D-032 set the precedent that a generator continues the existing series.
- **Do NOT add a `deleted_at` filter.** The real defect is reuse after **permanent** delete and under concurrency.

**Consequences.**
- **Re-rated M → L**: three implementations, seven code series, six resources Phase 4 otherwise never touches, plus the phase's only migration with a `setval` backfill drizzle-kit cannot generate.
- **4.9 is the phase's serialization point.** `drizzle/meta/_journal.json` admits one in-flight migration **repo-wide** — 4.9 serializes against every migration-producing task in every phase, not just Phase 4.
- **BUG-011 stays OPEN until all three sites land**, and its register line (scheduled "Phase 7") should follow the roadmap, per the BUG-017 precedent.
- `nextEmployeeCode` is **not** migrated to a sequence here. D-032 is ACCEPTED and tested, and employees have a genuinely different requirement — administrator-supplied explicit codes a bare sequence cannot step around. Uniformity, if wanted, is its own task superseding D-032.

---

## D-049 · 2026-09-05 · ACCEPTED — The customer timeline shows real audit data to those permitted to see it, and an honest state to everyone else

**Context.** Phase 4 Wave 0, Task 4.3. `GET /api/audit-logs` is gated on `audit_logs.view` (`admin.routes.ts:1304`), which of the five seeded roles is held **only** by Super Admin and Admin (`permissions.ts:227`). **Manager, Team Leader and Executive all hold `customers.view`** — they can open the customer detail page — **and none holds `audit_logs.view`** (`:269-272`, `:299-301`). Three of five roles would get a 403 on the tab.

DoD box 3 reads *"The timeline shows real audit data."* Taken as *"for every role"*, it is satisfiable only by widening a permission grant — which [RULES.md](claude/RULES.md) §5 forbids: *"Never widen an authorization check to make something work."*

**Decision.**
- Wire the timeline to the real endpoint for the roles entitled to it.
- **Do not widen `audit_logs.view`.**
- The other three roles get an **honest, permission-aware state** — never fabricated events, and never an empty list implying nothing happened.
- **Do not invent a new customer-scoped audit endpoint in Phase 4.** That is backend scope no row owns, and it would repeat exactly the drift D-044 exists to prevent.
- Read box 3 as *"the timeline shows real audit data to those permitted to see it."* Box 4 — no fabricated data — is satisfied for **every** role.

**Consequences.**
- **The real timeline will be thinner than the fabricated one.** `recordType` is a scalar filter (`admin.routes.ts:1311-1312`), so filtering `recordType=customer` makes the fabricated *"Documents uploaded"*, *"Loan submitted"*, *"Loan approved"* and *"Amount disbursed"* events — four of five — unreachable in one request. That is the correct outcome of removing invented data. Set the expectation before implementing.
- **Render field *names*, actor and timestamp — not values.** `audit_logs.changes` carries unredacted customer PII: `REDACTED_FIELDS` (`audit.ts:18-27`) covers Aadhaar, its hash and all password/token material, but **not** `pan`, `mobile`, `altMobile`, `email`, `dob`, `address`, `accountNo`, `ifsc`, `aadhaarLast4`, `cibil`, `monthlyIncome`, `fatherName`, `motherName` (**SEC-017**, P2, OPEN). A raw diff dump would print an unmasked bank account number on a page that masks it elsewhere.
- **SEC-017's risk profile changes the day 4.1 ships** — an endpoint with zero callers becomes one operations staff use daily. This is **accepted and recorded, not fixed**; SEC-017 keeps its own owner. Extending `REDACTED_FIELDS` would change audit semantics for all 13 record types.
- **BUG-016 / SEC-014** (the bare-`OR` precedence defect that discards `recordType`/`recordId` for bank-scoped callers) is **latent, not active**: both roles holding `audit_logs.view` also hold `system.access_all_banks`, so `ctx.bankIds` is `null` and the defective fragment is never pushed. It stops being latent the moment a custom role holds the one without the other. **Flagged, owned elsewhere, not fixed here.**
- Whether operational roles *should* see a customer's audit trail is a real product question, raised explicitly for **Phase 12**, not answered inside 4.3.

---

## D-048 · 2026-09-05 · ACCEPTED — Task 4.7 accepts an unrestricted assignee, mirroring the bank-access authority it validates against

**Context.** Phase 4 Wave 0, Task 4.7. The obvious implementation of *"validate `assignedUserId` bank-scope membership"* is to require a `user_bank_access` row for the customer's bank. That rule **refuses assigning a customer to any Admin or Super Admin.**

`loadAuthContext` (`access.ts:70-77`) only queries `user_bank_access` when `system.access_all_banks` is **absent**; a holder has `bankIds === null`, meaning *unrestricted*, and typically **zero rows** in that table. `assertBankAccess` (`:128-134`) encodes exactly this: `if (ctx.bankIds === null) return;`. Zero rows means "unrestricted", never "no access".

**Decision.** A user with unrestricted/all-bank authority **passes** the bank-membership validation. Mirror the semantics of the existing bank-access authority rather than writing a second, stricter rule against the same table.

**Consequences.**
- Prevents a functional regression — being unable to assign a customer to an administrator — that **no current test would catch**.
- The validation reuses the one authorisation vocabulary already in `access.ts`; a divergent second answer to "does this user have access to this bank?" would be exactly the drift RULES §6 warns about.
- Existence and liveness are still checked for every assignee, unrestricted or not.
- A backend test must pin **both** directions: an unrestricted assignee is accepted; a scoped assignee from another bank is refused.

---

## D-047 · 2026-09-05 · ACCEPTED — Task 4.7 validates team existence only, because teams are not bank-scoped in this data model

**Context.** Phase 4 Wave 0, Task 4.7, whose row reads: *"Validate `assignedUserId`/`assignedTeamId` existence and bank-scope membership on the backend — the `assertSameBank` pattern already exists in `operations.routes.ts:33-48` and was simply not applied here."*

**The premise does not survive contact with the schema.** `assertSameBank`'s entire mechanism is `table.bankId`, and its type is `typeof customers | typeof loans` (`operations.routes.ts:34-49`; the row's citation `33-48` is off by one at both ends — `:33` is the docstring terminator). Neither target has a bank column:

- **`users` has no `bank_id`.** Bank membership lives in the `user_bank_access` join table (`domain.ts:60-76`).
- **`teams` has no bank relationship of any kind** (`identity.ts:190-213`) — no column, no join table. **"Bank-scope membership" for a team is undefined in the data model as it stands.**

`assertSameBank` is also module-private — reusing it at all requires exporting it.

**Decision.** For `assignedTeamId`: validate **existence and not-deleted/assignable state only**.

- **Do not invent `teams.bank_id`.**
- **Do not derive a team's bank from its members** — teams span banks by construction, and a derived rule would be a new product policy invented inside an "S" row.
- **No migration for team-bank ownership in Task 4.7.**

For `assignedUserId`, the full bank check applies, subject to **D-048**.

**Consequences.**
- **The row's premise is partly unimplementable and is corrected here rather than quietly worked around.** RULES §5 forbids widening an authorization check to make something work; inventing a team↔bank relationship is the data-model equivalent.
- **The asymmetry is deliberate and documented**: users get a bank check, teams do not, because only one of them has a bank.
- **Effort is understated.** The row's "S" assumes a reusable helper; there is none for either field.
- **Severity is lower than first assessed, and 4.7 must not be justified as a security fix.** Traced end to end, assigning a customer to an out-of-bank user grants that user **nothing**: `listQuery` (`customers.routes.ts:70-76`) has no `assignedUserId` filter and there is no "assigned to me" endpoint, so every customer read still passes through `bankScope`. **This is a data-integrity and referential-correctness defect, not a confidentiality one** — its visible symptom today is a bad UUID surfacing as the misleading 409 *"That record is still referenced by other records"* (`error-handler.ts:77-82`), because both columns are real FKs (`domain.ts:120-121`).
- A cross-bank or non-existent assignee should answer **422** with `details: [{path, message}]` so **D-031** maps it onto the control that names it; a bare 400 would land in `formLevelError` and the user would not learn which field is wrong. This deviates from `assertSameBank`'s `badRequest` and is recorded rather than diverged from silently.
- If teams should become bank-scoped, that is its own decision, its own migration and its own row — most naturally in Phase 12, which owns teams.

---

## D-046 · 2026-09-04 · ACCEPTED — Task 3.12 also wires the request entry point, because "unaided" requires it

**Context.** Task 3.12 builds `/reset-password`. Phase 3's Definition of Done box 2 is *"A user who forgets their password can recover it **unaided**."*

### The gap that only appears when you check the box, not the row

`/reset-password` redeems a token. Something has to **send** that token, and that is `POST /api/auth/forgot-password` — which had **zero product callers**. `/login`'s "Forgot password?" control was:

```tsx
onClick={() => toast.info("Password reset", {
  description: "Contact your administrator to have your password reset.",
})}
```

True when it was written. **False since Task 3.6 shipped self-service reset** — and the literal opposite of *unaided*.

So building only the roadmap row would have produced a door nobody could reach: the page would work, every test would pass, and box 2 would still be unmet. That is the third time in this phase a row was complete while the outcome it served was not (3.5 and 3.6 both shipped endpoints whose pages did not exist, which is what **D-044** was created to fix). Repeating the pattern knowingly would have been worse than the first two, which were at least discovered rather than foreseen.

**The decision: 3.12 includes the request entry point.** Scope is bounded deliberately — a new public page, one element changed on `/login`, and **no backend change of any kind**. The endpoint, its 204-always contract, its logs and its 5-per-15-minute limiter are all untouched.

### The enumeration risk lives here, not on the redeeming page

`/reset-password` handles a token someone already holds. `/forgot-password` takes an **email address**, and the backend's entire defence is that it answers **204 for every address** — unknown, soft-deleted, deactivated, disabled role, even a mail-provider outage — with enumeration-safe logs to match.

**That guarantee is destroyed by one careless sentence.** If the screen said *"we sent a reset link to that address"*, the **absence** of that sentence for a different address is the oracle. So the confirmation:

- is **conditional** — *"If that address belongs to an active account…"*;
- **never echoes the address back**;
- is **byte-identical** for a known, an unknown and a deactivated address — asserted by rendering all of them and comparing;
- is shown on **204 only**, never optimistically. A 500 or a dropped connection reports a failure instead, because telling someone a link is on its way when the request never landed leaves them waiting for an email nobody attempted (**D-004**).

A backend test walks the same ground from the other side: a known, a deactivated, a deleted and a never-existing address all produce **identical status and body**, while only the eligible one actually generates a link.

### `/reset-password` inherits D-045 unchanged

Branch on **HTTP status, never on the message**. Only **400** means the link is unusable. **422** is the password policy — and a backend test proves a rejected password **does not consume the token**, which is exactly why the page keeps the form open rather than declaring the link dead. **429** is the limiter; **5xx / offline** is nobody's link being broken. The user holds one link that expires in an hour, so a wrong verdict here is expensive.

It is a **separate file** from `/accept-invite`, not a shared component. The two flows are kept apart deliberately all the way down — separate tables so a token cannot cross (**D-039**) — and merging their UIs is the one place that separation could quietly erode.

### One honest residual, recorded rather than smoothed over

The confirmation says a link *"is on its way"*, and the page **cannot know whether the provider actually accepted it** — reporting that would leak whether an account exists. The mitigation is in the copy, not in a claim: the screen immediately adds *"Nothing arrived? Check spam, then ask an administrator to reset your password directly."* The alternative — silence about non-arrival — would be worse for the user and no more honest.

**Consequences.**

- Three public routes now exist beside `/login`: `/accept-invite`, `/reset-password`, `/forgot-password`. None sits under the authenticated `(app)` shell.
- **116 tests** (94 frontend, 22 backend). **19 mutations reversion-proven, all 19 caught** — naming "expired" fails **7**, "already used" **7**, treating every `ApiError` as a dead link **4**, a 422 as a dead link **1**, a network failure **3**, echoing the raw server message **6**, redirecting into the app **1**, persisting the token **1**, logging it **1**, leaving it in the URL **1**, bypassing validation **2**, duplicate submits **1**, and on the request page: confirming an email was sent **3**, echoing the address **2**, confirming after a failure **6**, leaking account state on a 429 **1**. Restoring the *"contact your administrator"* dead end fails **5**.
- **Phase 3 Definition of Done box 2 is met, and with it the phase.**

---

## D-045 · 2026-09-04 · ACCEPTED — The invitation page discriminates failures by **status**, never by message

**Context.** Task 3.11 built `/accept-invite` over the endpoint Task 3.5 shipped. The form itself is small; the whole difficulty is what the page is allowed to *say* when something goes wrong.

### The rule, and the trap

`acceptInvitation` answers **one identical refusal** — *"This invitation link is not valid. It may have expired or already been used."* — for an unknown token, an expired one, an already-consumed one, and one belonging to a deleted or deactivated employee (**D-038**). Distinguishing them would turn a public page into an oracle for which addresses have a pending invitation.

Preserving that is the obvious half. **The non-obvious half is the opposite failure**, and it is the one a naive implementation gets wrong:

```ts
catch (err) { setStage("refused"); }        // ← plausible, and wrong
```

That treats a 500, a dropped connection, a rate-limit and a rejected *password* as "your invitation is dead". Each of those is a lie, and an expensive one: the user has exactly one working link, and the page has just told them to stop using it. A mutation that does precisely this fails 4 tests.

### The decision

**Branch on HTTP status. Never on the message.**

| Status | Meaning | What the page does |
|---|---|---|
| **400** | The invitation is unusable — the only status that means this | The terminal refusal state, showing the backend's own sentence verbatim |
| **422** | The password failed the policy; **the token is still good** | Inline error, form stays open, link still usable |
| **429** | The Task 3.6 limiter (10 / 15 min) | "Too many attempts" — explicitly not about the link |
| **anything else** | 5xx, offline, DNS | A generic retry message that does not mention the invitation |

This is safe to rely on because the split is structural, not incidental: `acceptInviteSchema.parse` produces a ZodError → **422**, `passwordProblems` produces `unprocessable` → **422**, and `badRequest(INVALID)` is the *only* producer of **400** on this route. A backend test asserts all five unusable-token cases return byte-identical status **and** message, so the page can only be as safe as the endpoint — and the endpoint is pinned.

### Three smaller decisions that fall out of it

**A missing `?token=` is refused without contacting the server.** There is nothing to check, no token-validation endpoint exists, and inventing one would leak exactly what the single refusal protects. It renders **identically** to a server refusal — asserted by comparing the two rendered outputs — so the absence of a token reveals nothing either.

**The refusal is terminal: the form is withdrawn.** Leaving it open invites the user to retry a dead token, which burns the rate limit for a link that can never work.

**Success links to `/login`; it does not redirect into the application.** The endpoint answers **204** and creates no session — a backend test asserts no `Set-Cookie` — so entering `(app)` would land on an unauthenticated shell and bounce straight back. The spent token is also stripped from the address bar with `history.replaceState`, so a dead credential does not linger in browser history or in the referrer of the next link the user clicks.

### One seam neither side's unit tests could see

The page reads its token with `useSearchParams().get("token")`, which URL-**decodes**; the backend builds the link with `encodeURIComponent`. Both suites use a *raw* token and never cross the URL, so a change to the alphabet, the parameter name, the path, or an accidental double-encode would break **every real invitation** while both sides stayed green.

`accept-invite-link.test.ts` closes that: it creates a real employee, pulls the URL out of the console transport, parses it exactly as a browser would, and feeds **that** token to the endpoint — then signs in with the password it set.

**Consequences.**

- `/accept-invite` is a public route beside `/login`, outside the authenticated `(app)` shell. `useSearchParams` is wrapped in `Suspense`, which Next requires for a statically prerendered client page — without it the production build fails.
- **69 tests** (53 frontend, 16 backend). **16 mutations reversion-proven, all 16 caught**: naming "expired" fails **8**, "already used" **8**, echoing the server message from any status **5**, treating every `ApiError` as a dead invitation **4**, blaming a network failure **3**, a redirect into the app **4**, persisting the token **1**, logging it **1**, rendering it **2**, bypassing password validation **3**, allowing duplicate submits **1**, and reporting success on failure **11**.
- **Phase 3 DoD box 1 is now met end to end.** Box 2 stays open until **Task 3.12** builds `/reset-password`.

---

## D-044 · 2026-09-04 · ACCEPTED — `/accept-invite` and `/reset-password` are assigned as Tasks 3.11 and 3.12

**Decision made by the project owner.** Recorded here, not invented here.

**Context.** Tasks 3.5 and 3.6 each delivered a complete, tested backend credential flow — `POST /api/auth/accept-invite` (49 tests) and `POST /api/auth/forgot-password` / `reset-password` (43 tests) — and each emails a working single-use link. Both roadmap rows were written to name **only the endpoint**, so both were legitimately complete. But the pages those links point at **did not exist**, so every invitation and every reset link landed on a **404**.

That is the gap. It was found by working the phase rather than by reading it, and it was **recorded rather than absorbed**: Tasks 3.7, 3.8, 3.9 and 3.10 each carried it forward as an explicitly unowned item, because no roadmap row covered it and quietly building the pages inside an unrelated task would have been exactly the kind of scope drift this project's rules forbid. The roadmap ran straight from 3.10 into Phase 4, so on paper the phase's task list was exhausted while two of its four Definition-of-Done boxes were unreachable.

**The decision.** *Phase 3 must not be considered complete while `/accept-invite` and `/reset-password` are broken 404s.* Both pages get explicit roadmap ownership and are built before Phase 4 begins:

- **3.11** — the `/accept-invite` page, over the existing Task 3.5 endpoint.
- **3.12** — the `/reset-password` page, over the existing Task 3.6 endpoint.

### What these tasks are, and are not

| | |
|---|---|
| **They are the user-facing half of work already shipped** | Both endpoints exist, are tested, and are unchanged by these rows. |
| **They change no backend code** | No route, no migration, no schema, no dependency, no authentication behaviour. |
| **They change no credential model** | **D-037** stands: a single-use, time-limited link; no password is ever emailed. **OPEN-3 stays resolved.** |
| **They change no token security** | 3.5's digest-only storage, 72-hour expiry and atomic single-use consume (**D-038**) and 3.6's equivalents (**D-039**) are untouched. |
| **Neither resolves SEC-005** | It stays **OPEN at P0**. The rate limiter on the public credential endpoints already exists and is not part of these rows. |

### The constraint that makes them harder than they look

Both endpoints answer **one identical refusal** for every unusable token — unknown, expired, already consumed, or belonging to a deleted or deactivated account. That is deliberate: distinguishing them turns a public endpoint into an oracle for which addresses have pending invitations or resets.

**The pages must preserve that.** A screen that says "this link has expired" where the server said only "this link is not valid" would re-introduce, in the UI, precisely the disclosure the backend was built to avoid. The four states the rows name — invalid, expired, consumed, successful — are **two** states as far as the user may be told: *it worked* or *it did not*. Weakening backend validation to make a friendlier message is out of scope for both tasks.

### Effort: M each, calibrated against comparable rows

Not assigned arbitrarily. **2.10** (surfacing loading/error and field errors on an *existing* page) is **S**; **12.2** (build the Teams page: list, create, member management, delete) is **M**; **12.1** (build the Roles page with a permission matrix) is **L**. Each of these is a single public route with one form, one endpoint and a small state machine — more than an S-sized change to an existing screen, since it is a **new public route outside the authenticated `(app)` shell** and must mirror the password policy and the refusal contract, but well short of a CRUD screen. `frontend/src/app/login/page.tsx` is the existing public-page pattern to model on.

**Consequences.**

- Phase 3 stays **IN PROGRESS**. Boxes 1 and 2 now have owners; boxes 3 and 4 are substantively met (3.10, and 3.3/3.5/3.9) but the phase is not finished.
- **Dependency chain: 3.11 → 3.12 → Phase 3 complete → Phase 4.** Task 4.1 moves behind both.
- Nothing in this decision is retrospective. The historical records of Tasks 3.5–3.10 are **not** rewritten to suggest the pages were ever assigned to them; each correctly records the gap as unowned at the time it was written.

---

## D-043 · 2026-09-04 · ACCEPTED — The workspace export control was removed, not implemented

**Context.** Task 3.10: *"Remove the last false email promise: `settings/page.tsx:329-333` 'Export queued — You'll get an email when it's ready.' **Either implement the export or remove the control.**"* Effort **S**. The roadmap hands over a genuine either/or and does not choose, so the choice is the substance of the task.

### What was actually there

The handler was one statement and nothing else:

```ts
function handleExportRequest() {
  toast.success("Export queued", { description: "You'll get an email when it's ready." });
}
```

No request, no queue, no job, no file, no `sendEmail`. It promised an asynchronous archive **and** an email delivery, and the system has neither. The surrounding copy promised *"Customers, loans, documents index, and ledger as a single archive"* — four datasets, zipped, mailed. None of that exists.

### Why removal, and not implementation

**A real export mechanism does exist** — `frontend/src/lib/export.ts`, used in five places (`DataTable`, reports, ledger, settlements, customer detail). It builds CSV / JSON / Tally XML **in the browser and downloads immediately**. So "implement it" was not obviously off the table, and was weighed rather than dismissed.

It was rejected on three pieces of evidence, all from the repository:

| | |
|---|---|
| **Phase 11.9 already owns this work** | *"Fix exports repo-wide: they currently ship only the 25-row server page… Either fetch all pages or **export server-side**."* Effort **M**. A four-dataset archive means either a zip dependency or server-side generation — precisely the change 11.9 owns. Building it inside an **S**-sized Phase 3 row would pull a Phase 11 task forward. |
| **The PRD says this capability does not exist** | R12.2: *"a client-side string builder over data already in the browser — there is **no server-side export, no scheduled export**…"* Nothing in the PRD requires a workspace archive; R12.2 (Tally) and R14.2 (report export) are the export requirements, and both already work. |
| **The roadmap's own remedy for these was removal** | Phase 3's preamble: *"The UI has made several email promises with nothing behind them (**all removed** in the working tree except the Settings 'Request export' toast)."* This was the last of a set, and the set was removed. |

**Nothing was lost.** Every list page still exports CSV immediately through `DataTable`; the ledger and settlements still export Tally XML. What went was a button that had never done anything.

### The roadmap's "last" claim was checked, not trusted

A repository-wide sweep for future-email language found **`settings/page.tsx:347` was genuinely the only one**. Every other "emailed"/"sent" string is a test assertion, a source comment, or Task 3.9's create-dialog copy, which is gated on the real `sent` outcome and says the opposite on `failed`/`logged`.

Two other **fake-async** claims do remain, and are deliberately untouched because they promise no email and **each already has an owner**:

- `customers/page.tsx:241` — *"has been queued for verification"* on an upload that reads a `File` and discards it. **Roadmap 4.4** owns it, by name.
- `customers/[id]/page.tsx:185` — *"Sent to printer · Profile sheet queued."* Part of the fake print/PDF family **Phase 11.4** owns.

Fixing either here would have been expanding past the task into rows that already exist.

### `passwordChangedEmail` and `accountDeactivatedEmail` were left alone

Both are still caller-less, built in Task 3.4. They are **valid unused infrastructure, not false promises** — nothing in the UI claims either is sent. 3.10 is about claims the product makes, not about templates it has not wired yet. Deleting them would destroy work a later task needs.

**Consequences.**

- The **Request export** control, its descriptive copy and its handler are gone; the unused `Building2` import went with them. The Danger zone card keeps its remaining action and is unchanged otherwise.
- **17 frontend tests.** The load-bearing group sweeps the **whole page** — the `Tabs` stub mounts every panel at once, so a promise parked on an inactive tab cannot hide from it. **Phase 3 DoD box 3 is now genuinely met** and test-enforced.
- **6 mutations, all detected — but by two different tools, which is the honest description.** Restoring the button with its handler fails **6** tests; a dead restored button **5**; the same row with a *differently worded* fake **6**; orphaned descriptive copy **2**; the promise moved to another tab **5**. The sixth — restoring **only** the handler with no button — is caught by **lint**, not by the suite: `@typescript-eslint/no-unused-vars` takes the frontend from **87** findings to **88**. A rendering test cannot observe a function that is never rendered and never called, and pretending otherwise would be the wrong guard for the right problem.

---

## D-042 · 2026-09-04 · ACCEPTED — The on-screen hand-over stays, and is now *explicit* about whether email worked

**Context.** Task 3.9: *"Keep the on-screen credential hand-over as an explicit fallback for when email is unavailable — do not remove it."* Effort **S**. This is the only roadmap row in the project phrased as a **prohibition**, and it protects something that already existed — so the first job was to establish whether anything needed doing at all.

### What was already true, verified by measurement

`POST /api/users` generates a temporary password when the caller supplies none, returns it in the creating response only, stores nothing but the argon2id hash, sets `mustChangePassword`, and returns it **regardless of the mail outcome**. The employees page renders it in `CredentialHandover`, also regardless of outcome. Nothing is emailed, nothing is logged, nothing is readable afterwards.

**So the preservation half of 3.9 was already satisfied, and no backend change was made.** The `admin.routes.ts` diff for this task is empty.

### The two things that were not true

**1. It was not a *test-protected* fallback.** There was **no frontend test for the hand-over at all**, and no test anywhere asserted it survives a mail outage — the one property the roadmap actually names. `employee-lifecycle.test.ts` covered generation, storage and login on the happy path only. Deleting the hand-over, or gating it on the email having succeeded, broke nothing. For a row whose entire content is *"do not remove it"*, that is the wrong kind of green.

**2. It was not *explicit*.** The word is load-bearing and it was not met. The create flow's response type omitted `invitation` entirely, so the outcome was **silently discarded** — a mail outage and a successful send produced **identical screens**. The administrator was told *"Hand these details to X so they can sign in"* in both cases, with no way to know whether a working link was already on its way or whether the password was the only way in. That is a fallback in mechanism but not in meaning.

### The change

Frontend only, and small: thread `invitation.status` into `HandoverCredential.delivery` and let the copy follow it.

| Outcome | What the screen now says |
|---|---|
| `sent` | *"An invitation link was also emailed to … this password is the fallback if it does not arrive."* |
| `failed` | *"The invitation email could not be sent, so no link is on its way. This password is the only way in."* |
| `logged` | *"Email is not configured here … nothing was delivered. This password is the only way in."* |
| absent | Nothing — a password **reset** issues no invitation, so it has no delivery to report. |

**`logged` is grouped with `failed`, not with `sent`** — deliberately. It is the development console transport: the message went to the server log and **nothing left the machine** (**D-035**). From the employee's side that is indistinguishable from an outage, so treating it as delivery would be the exact false-success **D-004** forbids. A mutation giving `logged` the wording of a delivered email fails a test.

**The password itself is shown for every outcome, unchanged.** That is the preservation requirement and it does not vary — only the surrounding words do. Two mutations pin it: removing the hand-over fails 6 tests, showing it *only* on failure fails 10.

### What was deliberately not done

- **No new temporary-password system**, and no change to the invitation model. D-037 stands: the normal path is the link, passwords are never emailed. A test asserts the invitation email still carries the link and never the password.
- **No backend change.** The server already did the right thing; inventing a diff to look busy would have been worse than none.
- **Task 3.8's resend was not touched.** Resend mints a link and hands over no password; 3.9 does not turn it into password distribution.
- **SEC-005 untouched**, still open at P0.

**Consequences.**

- **53 tests** (30 backend, 23 frontend), where there were previously **zero** on the frontend for this feature.
- **14 mutations reversion-proven, all 14 caught** — removing the fallback fails **6**, showing it only on failure **10**, withholding it on outage **2**, withholding it entirely **35**, reporting `sent` unconditionally **2**, giving `logged` delivered-wording **1**, claiming an email went out on failure **3**, dropping the delivery note **5**, persisting the plaintext **3**, logging it **2**, emailing it **2**, exposing the hash through the list **1**, dropping `mustChangePassword` **14**, and opening the control to `users.view` **2**.
- **Two mutations were malformed on the first attempt and redone.** One injected a duplicate object key, where the later key wins, so it was a silent no-op; the other recoloured the `logged` banner without changing its words, which the text assertions correctly ignored. Neither green result was accepted.

---

## D-041 · 2026-09-04 · ACCEPTED — Resend is gated by `users.reset_password`, bound by the hierarchy, and refused after acceptance

**Context.** Task 3.8: *"Add a **resend invitation** action."* Effort **S**. The roadmap says nothing else, and no other document names a permission, a supersession rule or an already-accepted behaviour. The mechanics were all settled by 3.5–3.7, so the entire task is these four decisions.

### 1. The permission is `users.reset_password`

Three candidates existed. The deciding test is **which one grants nobody a capability they did not already have.**

| Gate | What it would mean |
|---|---|
| `users.edit` | Anyone who can correct a phone number could mail a password-setting link. Plainly too broad. |
| `users.create` | Defensible — creating an employee is what issues the first invitation. But it **adds reach**: a create-only role has no other power over an *existing* employee, and this would hand it one. |
| **`users.reset_password`** | **Adds nothing.** A holder can already mint a temporary password for the same target through `POST /:id/reset-password`, which is total account takeover. A setup link is strictly weaker than that. |

So the gate is the permission that already governs credential delivery, and the route sits beside the one it mirrors. With the seeded roles the practical effect is identical — only `admin` holds any `users.*`, and `super_admin` holds `*` — so this decision is entirely about **bespoke roles**, which `POST /api/roles` can mint freely. A test pins the boundary in both directions: a level-10 role holding `users.edit` is refused; the same role holding `users.reset_password` succeeds.

**This reverses a leaning recorded in the Task 3.8 planning note**, which had said *"It is not `users.reset_password` — that route issues a temporary password, a different credential model (D-037)."* That note invited the decision rather than making it (*"Pick deliberately and record it"*), and its argument does not survive examination: it reasons from what the permission is **named after** rather than from what its **holders can already do**. D-037 governs what may be *emailed*, not which permission should gate a capability. The blast-radius test above points the other way, and decisively — so the leaning is recorded as considered and rejected, not silently overridden.

### 2. The hierarchy rule applies — the BUG-038 lesson, applied before it bites

`assertCanManageRoleLevel(ctx, target.roleLevel)`, exactly as `reset-password` does it.

**BUG-038 was a route that looked harmless and did `requirePermission(...)` with no target authorization.** The same shape here would let a level-10 bespoke role mail a password-setting link for a Super Admin's account — through a route whose name suggests it only re-sends an email. The full 5×5 actor × target matrix is walked by tests rather than reasoned about, including the case that actually matters: **holding the permission is not authorization to act on a particular subject.**

Order is deliberate: permission → existence (404) → hierarchy (403) → state (409). An actor who may not touch a target learns nothing about whether that target has finished setting up.

### 3. Already accepted → 409, refused

The alternative was to allow it, and it is wrong twice over:

- **The email would lie.** `employeeInvitationEmail` says *"An account has been created for you… choose your own password to finish setting it up."* That is false for someone who set their password weeks ago.
- **It would be a second password-reset path.** Redeeming the link sets a new password — but without the session revocation and the `password_reset` audit row the real reset route writes. A quieter way to do a louder thing is not a feature.

**Non-Active employees are refused too**, for a different reason: `acceptInvitation` rejects any account that is not Active, so inviting one mails a link that is **dead on arrival** — a control reporting a success it cannot achieve (**D-004**). The route does **not** reactivate them as a side effect. Soft-deleted employees get 404 from `targetUserRole` with no special case. **Restore does not reactivate**, so a restored employee stays refused until someone turns their access back on — that falls out of the Active guard for free, and is asserted rather than assumed.

**A never-invited employee IS invitable through this route.** Every employee predating Task 3.5 has no invitation at all; refusing them would leave them with no path to a credential link. The guard is on *acceptance*, not on whether a previous invitation exists — and the button and toast say **"Send"**, not "Resend", for them.

### 4. Supersession, expiry and delivery state are inherited, not reimplemented

`issueInvitation` already consumes any outstanding invitation, mints 48 random bytes, stores only the SHA-256 digest, applies `INVITATION_TTL_HOURS` and moves `users.invited_at` (**D-038**, **D-040**). The route calls it and adds nothing — no second token path, no second expiry constant, no cleanup logic. **D-040 predicted exactly this**: *"roadmap 3.8 gets correct behaviour for free."* It did.

One thing worth stating plainly: **supersession is not rolled back when the email fails.** It is a database fact settled before the mail is attempted, and the response says `failed` so the operator knows. Rolling it back would be worse — the operator would believe nothing happened while the link they superseded stayed live.

### 5. No rate limit, and the residual risk is named rather than hidden

Task 3.6's limiter guards **public, unauthenticated** credential endpoints — that is what SEC-005 is about. Resend is authenticated, permission-gated and hierarchy-bound, so the abuse case is not an anonymous attacker but an authorized administrator clicking repeatedly. Nothing in the roadmap or the security design asks for a throttle here, and inventing one would be redesigning SEC-005 uninvited.

**The residual risk is real and recorded:** a loop of resends consumes the Resend free-tier quota (100/day, 3,000/month), which would silently degrade *other* mail. The button disables while in flight, which stops the accidental double-click, and every resend is audited, so abuse is visible after the fact. If quota exhaustion is ever observed, the smallest fix is a per-target cooldown — not a global limiter.

### 6. Audited as `invitation_resent`

Credential delivery is security-sensitive, so the route writes an audit row inside the same transaction as the reissue: actor, target, action, summary, timestamp. `action` is typed `AuditAction | string` and `password_reset` already set the precedent for a credential action outside the enum, so no parallel format was invented. **No token, no digest, no URL** — audit rows are append-only, and a test asserts all three are absent.

### 7. What an adversarial review changed

An independent multi-agent review raised 20 candidate defects; refutation against the real code killed all 20 as *security* findings, but three were right about **the tests and the copy**, and were fixed:

- **Success was the fallthrough branch in the UI.** `failed` and `logged` were checked explicitly and *everything else* — including a missing or unrecognised `invitation.status` — rendered "Invitation resent". "We do not know what happened" must not be drawn as success (**D-004**). `sent` is now asserted explicitly. Worse, the test covering it asserted only that no *error* appeared, so it passed against the defect; it now pins the half that matters. A mutation restoring the old shape fails 2 tests.
- **"Resend invitation" was shown to employees who had never been invited** — untrue, and this codebase already polices wording with tests (**D-040**). The label and the toast are now conditional; mutations flattening either fail.
- **The API-key assertion was vacuous.** It ran on the console transport, where no key exists, so it could never fail. It now runs against a configured provider with a stubbed failing `fetch`.

**Known limitations, accepted and not fixed here** — each is pre-existing or out of this task's scope, and none is a privilege boundary:

| | |
|---|---|
| `invite_accepted_at` only marks the **invitation** path | An employee who used the on-screen temporary password and changed it via `/auth/change-password` still reads as "not accepted", so a resend is allowed. It mails a confusing but harmless link — the token goes to *their* mailbox, and the actor already holds `users.reset_password`. Roadmap **3.9** deliberately keeps that parallel hand-over path alive, so narrowing the guard is 3.9's question, not 3.8's. |
| Supersession is not atomic under true concurrency | Two simultaneous resends can each insert a live invitation. The invariant that matters — **at most one password establishment per invitation** — is still enforced by the atomic CAS in `acceptInvitation`. This is 3.5's mechanism (**D-038**), unchanged here, and PGlite's single connection cannot exercise it. |
| The open detail dialog keeps its pre-resend date | The list is re-read, but `selected` is a snapshot. Fixing it would mean inventing a client-side timestamp the server did not return, which is worse than staleness. |
| The role's `is_active` is not checked | Only `users.status` is. A user on a disabled role could accept and then fail to log in. Pre-existing across the whole invitation flow. |

**Consequences.**

- `POST /api/users/:id/resend-invitation`, no body, `200 { data, invitation: { status, expiresInHours } }`. **The raw token is never in the response** — it exists only in the email.
- The employees detail view gains the control beside **Reset password**, shown only for an active employee who has not accepted.
- **105 tests** (72 backend, 33 frontend). **23 mutations reversion-proven, all 23 detected** — dropping the hierarchy check fails **5**, gating on `users.edit` **2**, on `users.view` **3**, allowing an accepted target **3**, silently reactivating **4**, clearing `invite_accepted_at` **1**, freezing `invited_at` **2**, removing supersession **10**, returning the raw token **1**, logging it **1**, leaking the API key **2**, reporting `sent` unconditionally **2**, dropping the audit row **4**, putting the URL in the audit summary **1**, and eight frontend mutations **1–2** each.

---

## D-040 · 2026-09-04 · ACCEPTED — `invited_at` means *issued*, not *delivered*, and it is the **latest** issuance

**Context.** Task 3.7: *"Record delivery state on the user (`invited_at`, `invite_accepted_at`) and surface it in the employees list."* Effort **S**. Nothing in the PRD, data model or API documentation defines either field, so the roadmap row is the only authority — and it leaves two questions that decide whether the feature tells the truth.

### 1. What does `invited_at` record?

**Issuance. Not delivery, and not an attempt to deliver.**

The task is titled *"delivery state"*, which invites the reading *"the email went out"*. That reading cannot be implemented honestly:

- `sendEmail` returns `sent` when the **provider accepted** the message — **not** when it arrived. **D-035** says so explicitly, and nothing in this system can know the difference.
- In development and test the console transport returns `logged` and **nothing leaves the machine**. A column gated on send outcome would be `null` on every developer machine and in the whole test suite.
- The send happens **after** the create transaction commits, by design (**D-038**), so at the moment the invitation exists there is no outcome to record.

So `invited_at` is written where the invitation is issued, inside `issueInvitation`, regardless of what the mail service later reports. It answers *"have we invited this person, and when?"* — which is the question the employees list actually needs.

**The consequence is a wording rule, and it is enforced by a test.** Nothing user-facing may say "Emailed", "Sent" or "Delivered". The column reads **Invited**, and a test fails if that changes — a control claiming an outcome the system never achieved is exactly what **D-004** forbids.

### 2. Which issuance, once 3.8 adds resend?

**The latest.** The question an administrator asks is *"when did we last invite them?"*, because that is what decides whether to chase or resend. "First ever invited" is not actionable, and 3.5 already supersedes an outstanding invitation when a new one is issued, so "latest" is consistent with there being exactly one live link.

The write lives inside `issueInvitation`, so **roadmap 3.8 gets correct behaviour for free** — a resend calls that function and the timestamp moves with it. Two tests pin it: reissuing moves `invited_at` forward, and reissuing does **not** clear an existing `invite_accepted_at`.

### 3. Denormalised onto `users`, deliberately

`invitations.created_at` and `consumed_at` hold the same two moments, so these columns duplicate them. That is against this codebase's usual instinct (**D-024**, derive rather than duplicate), and it was still the right call here:

| | |
|---|---|
| **The roadmap says so** | *"Record delivery state **on the user**"*, naming both fields. Effort **S**. A correlated subquery per row plus a derived-state layer is not an S-sized change. |
| **They cannot drift** | Both are written inside the very transactions that write the `invitations` rows — one statement pair at issue, one field added to the existing update at accept. There is no path that writes one without the other. |
| **They outlive the source** | Nothing purges invitations today, but roadmap **15.9** will. The employee record should not forget that someone was invited because a token row aged out. |

**Consequences.**

- **Migration `0005`** — two nullable timestamps, additive, no backfill. Existing rows read as "never invited", which is true of them.
- The employees list gains a **Setup** column and filter — Accepted / Invited / Not invited — and the detail view shows the dates.
- **33 tests** (21 backend, 12 frontend). Reversion-proven with six mutations: gating `invited_at` on delivery fails **6**, making it first-not-latest fails **1**, dropping the acceptance stamp fails **2**, letting a resend clear acceptance fails **1**, changing the label to "Emailed" fails **1**, inverting the state precedence fails **3**.
- **A weakness in the first draft of the frontend tests was caught by that same mutation testing**: a fixture named *"Anitha Accepted"* made `toContain("Accepted")` pass against the **name** rather than the state cell, so inverting the precedence went undetected. Fixtures renamed, assertions moved onto the specific cell.

**Found and not fixed:** the employees table's **Role** column renders `—` for every row. It is declared `key: "role"` with no `render`, while the field is `roleName`, so `DataTable` falls back to `String(row["role"] ?? "—")`. Pre-existing, unrelated to this task, recorded in `NEXT_TASK.md`.

---

## D-039 · 2026-09-04 · ACCEPTED — Password resets get their own table, a one-hour window, and the project's first rate limiter

**Context.** Task 3.6: *"Self-service password reset. `POST /api/auth/forgot-password` (always returns 200 — never confirm whether an address exists) + `POST /api/auth/reset-password`. Single-use, expiring, **rate-limited** tokens; revoke all sessions on completion."* Structurally this is the invitation flow (**D-038**), but three things differ because of *who* starts it: an invitation is issued by an administrator to a known person, a reset is requested by an anonymous caller who typed an address into a form.

| Choice | Why, and what was rejected |
|---|---|
| **A separate `password_resets` table, not a `purpose` column on `invitations`** | Both flows look a token up **by digest alone**. One shared table would let a reset token be redeemed at `/accept-invite`, and an invitation at `/reset-password` — two endpoints with different eligibility rules and different session effects. A discriminator column would work only for as long as everybody remembers to check it; separate tables make the confusion impossible by construction. Either way needed a migration, so the safer shape cost nothing. |
| **One hour, not 72** | No document specifies a duration. An invitation gets 72 hours because a new hire may not read their mail until Monday (**D-038**); a reset is different in kind — the person asked for it seconds ago and is waiting on it. One hour is the common expectation, and a short window matters more on a link that can **seize an existing account** than on one that activates a fresh one. |
| **`forgot-password` always answers 204 — and the logs match** | The roadmap's own constraint. Unknown address, soft-deleted, deactivated, disabled role, provider outage: identical response, identical body, no exception that could become a distinguishing signal. **The logs were the easy half to get wrong** — a line reading *"no account for alice@example.com"* moves the oracle from the response into the log file, where it is just as real for anyone who can read logs. Nothing logs the address, and the not-found path writes the same line as the success path. A test asserts both. |
| **A mail failure changes nothing the caller sees** | Reporting it would tell an anonymous requester the address exists — the one thing this endpoint must not do. The honesty owed here is owed to the operator, in the log, not to the caller. |
| **Token, hashing, ordering and atomicity are D-038's** | 48 random bytes stored as SHA-256; token looked up **before** any argon2 work so a junk token cannot buy an expensive hash; password validated **before** the consume so a typo does not burn the link; consume by conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()`. **At most one successful reset per token**, resolved by the database, proven by two simultaneous requests. |
| **All sessions revoked, lockout cleared** | Revocation is the roadmap's explicit words: if the reset was prompted by a compromise, leaving the attacker's session alive defeats the point. Clearing `failedLoginAttempts`/`lockedUntil` is the other half — a lockout that outlives the credential it guarded would leave the user unable to sign in with the password they just set. |
| **No session is created; 204 with no body** | Same posture as `accept-invite`. Signing in afterwards is the normal flow, and a response carrying user fields would confirm an account to anyone holding a guessed token. |

### The rate limiter — SEC-005 narrowed, not closed

Task 3.6's own wording asks for **rate-limited** tokens, which is stronger than the phase test list's *"depends on Phase 13, or implement locally here"*. So this task built the local option: a **small fixed-window, in-process limiter** in `middleware/rate-limit.ts`, applied to named routes only.

It guards **all three** public credential-granting endpoints — `forgot-password` (5 per 15 min, tighter because it *sends mail* for an anonymous caller and would otherwise be a mail-bomb primitive and a way to drain Resend's 100/day), plus `reset-password` and `accept-invite` (10 per 15 min each). `accept-invite` shipped in 3.5 before the mechanism existed; leaving one of three unguarded once it did would have been an oversight rather than a decision.

**What it is not, stated so nobody mistakes it for the fix:** per-process (two instances behind a load balancer each keep their own counters), in-memory (a restart forgets everything), fixed-window rather than sliding, and attached to five routes out of ninety-six. **SEC-005 stays OPEN at P0** and Phase 13 still owes the general answer.

**Consequences.**

- **Migration `0004_oval_the_enforcers.sql`**, generated by `drizzle-kit generate` with its journal entry and snapshot.
- **43 tests** in `password-reset.test.ts`, plus one added to `invitations.test.ts` for the newly-guarded `accept-invite`. Reversion-proven with nine mutations: storing the raw token fails **16**, ignoring expiry **1**, a non-atomic consume **1**, logging the address on the not-found path **1**, skipping session revocation **1**, dropping supersede **1**, leaving the lockout **1**, removing the limiter **3**.
- **The frontend `/reset-password` page does not exist**, exactly as `/accept-invite` does not. Roadmap 3.6 names only the two endpoints, so the task is complete as defined — but **Phase 3's second Definition-of-Done box** (*"A user who forgets their password can recover it unaided"*) needs that page, and now **two** roadmap-less pages block the phase.

---

## D-038 · 2026-09-04 · ACCEPTED — Invitations: 72-hour expiry, a 48-byte token stored only as a digest, and an atomic consume

**Context.** Task 3.5 built the invitation flow. **D-037** settled *what* is delivered — a single-use, time-limited link — and deliberately left three things to this task, because no document names them: the **expiry duration**, the **token format** and the **acceptance URL**. None was invented silently; each is below.

### The three parameters D-037 left open

| | Decision | Why |
|---|---|---|
| **Expiry** | **72 hours**, one constant in `services/invitations.ts` | Nothing in the PRD or roadmap names a duration. 72 hours means an employee created on a Friday can still act on Monday — the realistic onboarding case — while a link found in an old inbox is usually dead. Short enough to bound exposure, long enough not to generate support traffic. It is a named constant, not a literal at a call site, and the template already required `expiresInHours` as an input so the number appears in the email automatically. |
| **Token** | **48 random bytes, base64url**, stored as **SHA-256** | Exactly what `refresh_tokens` already does, using the same `randomToken`/`sha256` helpers rather than new ones. 384 bits of entropy, so guessing is not a threat model. No sequential id, no UUID-as-secret, no employee code, nothing timestamp-derived. |
| **URL** | **`${FRONTEND_URL}/accept-invite?token=…`** | `FRONTEND_URL` is the existing configuration and had **no consumer** before this; nothing is hardcoded. The path follows the frontend's own convention for pages outside the authenticated group — `login` sits at the top level, not under `(app)`, and an unauthenticated invitee is in the same position. |

### The invariant that matters

**At most one password establishment per invitation.** The guard is a conditional update:

```
UPDATE invitations SET consumed_at = now()
WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
RETURNING id, user_id
```

Whoever does not get a row back never writes a password. The database resolves it; nothing depends on application timing, and there is no read-then-write window. Two simultaneous acceptances are tested for real and produce exactly one 204 and one 400, with exactly one of the two passwords live.

### The rest of the design

| Choice | Why, and what was rejected |
|---|---|
| **Only the digest is stored** | A plaintext column would hand every pending invitation to anyone with a database read. The raw token exists in the generated URL and in the accepting request — nowhere else. Storing it raw fails **19** tests. |
| **One identical refusal for every unusable token** | Unknown, expired, consumed, deleted employee, deactivated employee — all produce the same 400 and the same sentence. Distinguishing them turns a public endpoint into an oracle for which addresses have pending invitations. |
| **The token is checked before any argon2 work** | argon2 is expensive by design, so hashing a password for a garbage token hands an unauthenticated caller an amplification primitive — the exact shape of **SEC-005**. A junk token is refused after one indexed `SELECT`. See the SEC-005 note below. |
| **A rejected password does not consume the invitation** | Policy validation happens before the consume, so one typo cannot permanently burn an employee's only link. Moving the hash after the consume fails **5** tests. |
| **A deactivated or deleted employee's refusal rolls back the consume** | The account check runs inside the transaction, so refusing also undoes the consume. A temporary deactivation therefore does not silently destroy a live invitation — reactivating restores a usable link, and that is tested. |
| **Reissuing supersedes** | Issuing a new invitation consumes any outstanding one for that employee, so there are never two live links. That keeps `consumed_at` meaning exactly "no longer usable" and adds no fifth column beyond the four the roadmap names — which matters for **3.8** (resend). |
| **Issued inside the create transaction, emailed after it commits** | An invitation must never outlive a rolled-back user creation, so issuance joins the transaction. The send does not: holding a transaction open across a network call is how the employee-code deadlock happened (**D-032**), and the roadmap requires **creation to succeed when the provider is down**. |
| **The response reports delivery honestly** | `invitation: { status }` is `sent`, `logged` or `failed` — the outcome `sendEmail` actually returned. The route never claims an email arrived (**D-004**). |
| **Accepting creates no session** | It establishes a credential; signing in is the normal flow. The response is **204 with no body** — a public endpoint that echoed user fields would confirm which addresses have invitations to anyone holding a guessed token. |
| **Sessions predating the credential are revoked** | Same posture as `POST /auth/change-password`. A lockout counter is cleared too: it must not outlive the credential it was guarding. |
| **`password_changed` reused as the audit action** | The credential was established. Adding an enum value would need a second migration for no analytical gain; the summary distinguishes it. |

**`sendEmail` was hardened, and a Task 3.5 test is why.** Its "never throws" guarantee covered provider failures but not its own body — a logger that threw escaped into the route and turned employee creation into a 500. The whole function is now wrapped, so the guarantee is absolute rather than conditional. **D-035**'s claim is unchanged; it is simply now true in every case.

**Consequences.**

- **Migration `0003_minor_edwin_jarvis.sql`** — the first since the initial three, generated by `drizzle-kit generate` with its journal entry and snapshot, so the established workflow is now exercised.
- **49 tests** in `invitations.test.ts`, full lifecycle over real HTTP against real migrations. Reversion-proven: storing the raw token fails **19**, a non-atomic consume fails **1** (the concurrency test), ignoring expiry fails **1**, hashing after the consume fails **5**, dropping supersede fails **1**.
- **The `/accept-invite` page does not exist.** Roadmap 3.5 names only the endpoint, so the task is complete as defined — but the phase's first Definition-of-Done box ("can set their own password") needs that page, and it is recorded as outstanding rather than glossed over.
- **The argon2 ordering is enforced by code structure, not by a test.** It is a performance property and a timing assertion would be flaky; the observable proxy — an invalid token returns the token error rather than the password error — is tested.

---

## D-037 · 2026-09-04 · ACCEPTED — OPEN-3 resolved: employee credentials are delivered by a single-use, time-limited invitation link

**Context.** **OPEN-3** had been open since the decision log was created and blocked Phase 3's credential work:

> **OPEN-3** | Credential delivery model: email a single-use invitation link (recommended) vs email a temporary password. A password in an inbox is a permanent credential. | Phase 3 | — |

Task 3.4 built the invitation template for the link model on roadmap 3.5's instruction and recorded that explicitly as an **assumption, not a decision** (**D-036**), leaving the question to its owner. Task 3.5 was held as blocked, because a table, a migration and an endpoint are what make a credential model permanent.

**Decision — made by the project owner, 2026-09-04.**

**Employee credential delivery uses a single-use, time-limited invitation/setup link. There is no emailed temporary password.**

| | |
|---|---|
| **Delivery** | A link, emailed to the employee |
| **Single use** | The link is consumed when used and cannot be replayed |
| **Time limited** | It expires; **the duration is not decided here** |
| **Password** | The employee sets their own through the link |
| **Not emailed** | No password, temporary or otherwise, is ever sent by email |
| **Decided by** | Project owner |

**Why this is the right answer, in the register's own words:** *a password in an inbox is a permanent credential*. Mail is stored, forwarded, backed up and searched; a credential sent that way keeps working long after the message is forgotten, and its lifetime is the mailbox's, not the system's. A single-use expiring link inverts that — it is worthless once used and worthless after its window.

**This confirms the existing direction rather than changing it.** Roadmap **3.5** already read *"Send a single-use, time-limited link rather than a password in an email"*; the register simply had not been reconciled with it. **The roadmap's wording is unchanged** — the decision aligned with it, which is not a reason to edit it.

**What this decision does NOT settle.** Deliberately, because these belong to Task 3.5 and inventing them here would be the same error D-036 avoided:

- **The expiry duration.** No document names one, and this decision does not either. `employeeInvitationEmail` takes `expiresInHours` as a **required input** for exactly that reason. Task 3.5 chooses the value and records it.
- **The token format**, its length and its hashing. The roadmap says the table stores a *token hash*; how the token is generated and hashed is 3.5's.
- **The acceptance URL.** `FRONTEND_URL` exists in `env.ts` with no consumer; building the link is 3.5's.

**Consequences.**

- **OPEN-3 is struck from the open-decisions table**, resolved, owner recorded.
- **D-036's assumption is confirmed.** `employeeInvitationEmail` and its tests stand as written — no code changes, because the assumption matched the decision. D-036 keeps its wording as the record of what was assumed and why; an addendum there points here.
- **Task 3.5 is unblocked and remains NOT STARTED.** Nothing in this turn implements it: no table, no migration, no token, no endpoint, no wiring.
- **[SEC-010](SECURITY_AUDIT.md#sec-010) remediation 3 is narrowed, not closed.** An expiring invitation removes the *emailed* permanent credential once 3.5 lands, but the **on-screen temporary password remains** — roadmap **3.9** keeps that hand-over deliberately as the fallback for when email is unavailable. Its expiry is still unaddressed.
- **[SEC-005](SECURITY_AUDIT.md) (P0, no HTTP rate limiting anywhere) becomes more pressing.** `POST /api/auth/accept-invite` will be unauthenticated and credential-granting.

---

## D-036 · 2026-09-04 · ACCEPTED — The four email templates are pure functions, and the invitation is built on an **assumption** that OPEN-3 has not approved

**Context.** Task 3.4: *"Templates: employee invitation, password reset, password changed, account deactivated. Plain text + HTML."* **D-035** built the service; nothing calls it.

**The invitation template needed a credential model, and the project has not chosen one.**

**OPEN-3** is still open, owned by the project owner, and unanswered:

> **OPEN-3** | Credential delivery model: email a single-use invitation link (**recommended**) vs email a temporary password. A password in an inbox is a permanent credential. | Phase 3 | — |

But roadmap task **3.5** does not hedge — it states the design as an instruction:

> *"Send a **single-use, time-limited link** rather than a password in an email — a password in an inbox is a permanent credential."*

**Decision.** Build the invitation for the **link** model, on that instruction, and record it here as an **assumption rather than a decision**. **OPEN-3 stays open.**

This is not the owner's decision being made by proxy. It is the roadmap's own words being followed, with the gap between the two documents written down instead of quietly resolved. **Nothing here closes OPEN-3, and the entry above is untouched.**

**It is cheap to reverse, deliberately.** `employeeInvitationEmail` is a pure function with **no callers** — templates are not wired until 3.5. If OPEN-3 resolves the other way, one function and its tests are replaced; no route, table or migration depends on it. The tests were written to pin *"this message contains no password"* rather than *"the link model is correct"*, so they do not harden the assumption into a contract.

**3.5 is the point of no return, not this task.** Wiring the invitation flow adds a table, a migration and an endpoint. **The owner should answer OPEN-3 before 3.5 lands.**

**Decision — the templates themselves.**

| Choice | Why, and what was rejected |
|---|---|
| **Pure functions in `lib/`, not `services/`** | The repository already splits that way: `services/` reaches a database or a provider, `lib/` (errors, password, permissions, tokens, zod) is pure. These read no environment, touch no database, call no provider and make no authorization decision — a test asserts the module imports none of them. |
| **`template(data) -> EmailMessage`** | The exact input `sendEmail` already takes, so the calling contract is one expression and there is no adapter layer. Two tests render a template and put it through the real service. |
| **No template engine** | Four messages. A dependency would have been the second one this phase declined (**D-035** declined the Resend SDK), and inline-styled HTML email cannot use a normal view layer anyway. |
| **Every dynamic value is a typed input** | No template invents a domain, an expiry, a login URL or a credential rule. The roadmap says the link is *"time-limited"* and names no duration, so `expiresInHours` is a required parameter and a missing one throws — the alternative was hardcoding "24 hours", which the product has not agreed. `FRONTEND_URL` exists in `env.ts` with **no consumer**; building the URL stays the caller's job. |
| **Names are escaped; links are validated** | An employee name reaches every one of these, so `<` must arrive as text — asserted against a hostile name in all four. A URL is refused unless `http(s)`: a `javascript:` or `data:` href in a credential email is a phishing primitive aimed at precisely the message a recipient has been told to trust. |
| **No token in any subject** | Subjects surface on lock screens and in more logs than bodies do. |
| **The plain-text part stands alone** | The link is readable as text, not only clickable in the HTML — the text part is what survives a broken client, and the roadmap asks for both. |
| **Notification templates carry no link at all** | "Password changed" and "account deactivated" tell the reader to contact an administrator, which is the truth: there is **no self-service recovery path** in this product yet. Inventing a "secure your account" URL would promise something that does not exist (**D-004**). |

**Consequences.**

- **Nothing calls the templates.** Invitation is 3.5, reset 3.6.
- **29 tests** in `email-templates.test.ts` — no network, no database. Reversion-proven with five mutations: removing HTML escaping fails **4**, removing the URL protocol guard fails **2**, removing required-field checks fails **2**, putting the token in the subject fails **1**, removing the expiry check fails **1**.
- **The invitation copy is provisional.** If OPEN-3 resolves to the temporary-password model, this template, its tests and this entry are superseded.

> **Confirmed 2026-09-04 by [D-037](#d-037--2026-09-04--accepted--open-3-resolved-employee-credentials-are-delivered-by-a-single-use-time-limited-invitation-link).** The project owner resolved **OPEN-3** in favour of the single-use, time-limited link — the model this template was built for. **The assumption recorded above is now a formal decision**, and the invitation copy is no longer provisional.
>
> No code changed: the assumption matched the decision, so `employeeInvitationEmail` and its tests stand exactly as written. The reasoning above is left intact as the record of what was assumed, on what grounds, and how cheaply it could have been reversed had the answer gone the other way.

---

## D-035 · 2026-09-04 · ACCEPTED — The email service is one `fetch` call, never throws, and reports failure rather than swallowing it

**Context.** Task 3.3: *"Build `src/services/email.ts`: a provider-agnostic interface, retries with backoff, structured logging, and **guaranteed non-blocking failure** — a mail outage must never fail user creation."* **D-033** chose Resend; **D-034** validated its configuration.

**Decision.** One module, no dependency, and an outcome instead of an exception.

| Choice | Why, and what was rejected |
|---|---|
| **No Resend SDK — one `fetch` POST** | The backend has **no HTTP-client dependency and makes no outbound request anywhere else**; Resend's send is a single POST to one endpoint, and Node has global `fetch`. The SDK would have been the repository's first HTTP dependency, added on the path that carries the API key, for roughly twenty lines of code. Not worth the supply-chain surface. Revisit if batching, attachments or webhooks arrive — those are where an SDK earns its place. |
| **`sendEmail` never throws** | This is what *"guaranteed non-blocking failure"* has to mean in practice. `POST /api/users` already does real work in a transaction and, since Task 2.11, assigns the employee code inside the request; a Resend outage must not stop the business creating employees, because a third party taking down a core workflow is worse than no email at all. Because the promise cannot reject, `void sendEmail(...)` is safe — there is no unhandled rejection to leak — and a caller that wants the outcome can await it. A test asserts exactly that. |
| **…but failure is reported, not swallowed** | The outcome is a discriminated union — `sent` / `logged` / `failed` — so an outage can never be mistaken for delivery (**D-004**). "Non-blocking" must not quietly become "pretend it worked". `sent` also means *accepted by the provider*, not *delivered*; nothing here can know whether it reached an inbox, and callers should say so. |
| **No `AppError` from the service** | Transport concerns stay in the service and the caller decides how to surface them. Throwing an HTTP error from here would put route semantics in a module that has no request. |
| **Bounded retries; refusals are not retried** | 3 attempts, 200 ms then 400 ms, on transport errors, **429** and **5xx**. A **4xx is returned immediately** — a rejected address or a bad key will be rejected identically forever, so retrying only adds latency to a request path. The bound also caps the cost of the free tier's 100/day cap (**D-033**) turning into a 429. |
| **The API key is scrubbed from every reason** | Found by its own test. Both failure paths echo text this module did not write — a provider response body, or a transport error's message — into a reason the caller sees and logs. Neither *should* contain the key, but "should" is not a control, so the key is stripped from any reason before it leaves. The guarantee is structural rather than a bet on what Resend and undici put in their strings. |
| **The console transport logs the body in full** | Deliberately, and only there. It exists so a developer can read an invitation link out of their terminal; truncating it would make it useless. It is unreachable outside development and test, it is marked `delivered: false`, and it returns `logged` — never `sent`. The real transport logs metadata only. |
| **Production can never fall back to the console** | `loadEnv` already refuses to boot production without the configuration (**D-034**), so this is unreachable — and it is still guarded, returning `failed` rather than logging a credential email and calling it sent. |

**Provider containment.** Resend appears in exactly two source files: the `EMAIL_PROVIDER` enum in `config/env.ts` and this service. Nothing else knows the provider exists, so swapping it is a change in those two places. No dependency was added, so there is nothing for the frontend to bundle — verified: no `resend` in either `package.json`, and no reference to it anywhere under `frontend/`.

**Consequences.**

- **Nothing calls the service.** Templates are **3.4**, the invitation flow **3.5**, password reset **3.6**. Wiring it into `POST /api/users` needs **OPEN-3** answered first, which it is not.
- **32 tests** in `email-service.test.ts` — no network, no database, no real key, the `fetch` boundary injected. The suite found the API-key echo described above before it could ship.
- **The retry bound sits inside a request path.** Three attempts with 200/400 ms backoff is at most ~600 ms added if a caller awaits it. A caller that cannot afford that should not await — which is safe precisely because the promise cannot reject.

---

## D-034 · 2026-09-04 · ACCEPTED — Email configuration is optional in the schema and required by the production block, and the provider is an allowlist of one

**Context.** Task 3.2: *"Add config: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`. Validate in `env.ts`. Required in production, optional in development with a console transport."* Configuration only — **D-033** picked Resend, and roadmap **3.3** builds the service that will actually send.

**Decision.** Four optional schema fields, enforced as required inside the existing production block, plus one derived transport mode.

| Choice | Why, and what was rejected |
|---|---|
| **Optional in the schema, required in the production block** | This is exactly how `AADHAAR_PEPPER` and the JWT-secrets-differ rule already work (`env.ts`), so it adds no second validation mechanism. Marking the fields required in the schema would break every developer and the whole test suite, which boot with no mail credentials by design. |
| **Production fails fast, and the message names only keys** | Without the config, an invitation would be accepted, written to stdout by the console transport and reported as sent — a control claiming an outcome it never achieved (**D-004**). Refusing to boot is the honest answer, and it is the same shape as **SEC-028**'s `NODE_ENV` fix. `EMAIL_API_KEY` is a secret, so the error interpolates **no values**; a test asserts the key never appears in any error this file can raise. |
| **`EMAIL_PROVIDER` is an allowlist of one** | `z.enum(["resend"])`. Free text would let `EMAIL_PROVIDER=sendgrid` boot a production deploy whose mail can never be delivered, because nothing implements SendGrid. A typo should be a boot failure, not a silent no-op. Widen the enum when a second provider genuinely exists — **not** to look extensible. |
| **`EMAIL_FROM` is NOT `z.email()`** | The display-name form — `Rise Next <no-reply@risenext.in>` — is what a real From header usually is, and Resend accepts it. A bare `z.email()` would reject it and **stop a correct production deployment from booting**: a false positive, which is precisely the failure mode the `NODE_ENV` note in this file warns against. A small regex accepts both forms, and both are tested. |
| **`emailTransport()` lives in `env.ts`** | It resolves `"resend"` or `"console"` from the configuration and does nothing else. Putting the mode beside the configuration keeps 3.2 from growing a service; `services/email.ts` (3.3) is what reads it and sends. Production cannot return `"console"` — `loadEnv` would have refused to boot. |
| **Half-configured development falls back, but says so** | A key with no provider cannot send, so the transport is `console`. Falling back silently would be the same dishonesty in miniature, so `missingEmailConfig()` names the gap and `server.ts` logs it at `warn` on boot — key names only. |

**`cookie-config.test.ts`'s fixture was updated, not weakened.** Its `PROD_ENV` is documented as *"a complete, valid production environment"*, and after this task a complete one includes email — so `loadEnv` rightly rejected it. The four keys were added to the fixture; **no assertion changed**, and all 17 of its cases still pass. Weakening the production requirement to keep the old fixture green would have been the wrong repair.

**Consequences.**

- **`.env.example` and `.env.example` both carry the keys**, with `EMAIL_API_KEY` shipped **empty** rather than with a realistic-looking placeholder, so a copied `.env` cannot look configured when it is not. No real key is in this repository. (**SEC-025** — `AADHAAR_PEPPER` missing from the root example — is untouched and still open.)
- **Nothing sends mail.** No SDK is installed, `services/email.ts` does not exist, and no route, template or workflow was added. That is **3.3** and beyond.
- **OPEN-3 is untouched.** Invitation link vs emailed temporary password is about what is *sent*; this task is about who is configured to send it. It still gates **3.5**.
- **22 tests** in `email-config.test.ts`, no database. Reversion-proven with five mutations: dropping the production requirement fails **5**, free-text provider fails **3**, dropping address validation fails **2**, hardcoding the transport fails **3**, and interpolating the API key into the error fails **1**.

---

## D-033 · 2026-09-04 · ACCEPTED — Resend is the transactional email provider, starting on the free tier

**Context.** Roadmap Task **3.1** is a decision, not an implementation: *"Choose a provider and record the decision in DECISIONS.md. Consider deliverability from India, cost, and Railway compatibility."* It was tracked as **OPEN-1**, which blocked the whole of Phase 3 and had no owner recorded. The project owner has now made the choice.

**Decision.** **Resend** is the transactional email provider for the CRM.

| | |
|---|---|
| **Provider** | Resend |
| **Initial plan** | Free tier |
| **Stated free capacity** | 3,000 emails/month, 100 emails/day |
| **Intended use** | Transactional CRM mail only — employee invitations, password setup and reset, and account security notifications, as the Phase 3 tasks require |
| **Upgrade path** | Move to the appropriate paid Resend plan when production volume requires it |

**Reasoning, as recorded by the owner.**

- A developer-oriented transactional email platform rather than a marketing suite.
- Its Node.js SDK and plain HTTP API fit the existing Express backend without new infrastructure.
- The free tier is appropriate for the project's initial scale — one CRM issuing invitations and password mail, not bulk sending.
- Upgrading is a plan change inside the same provider, so growing out of the free tier costs no migration.

**Capacity, stated rather than assumed.** The 3,000/month and 100/day figures are Resend's published free-tier limits **as stated at the time of this decision**; they are not verified here and no code depends on them. The daily cap is the one worth watching: it is a per-day ceiling, so a bulk onboarding of employees in a single sitting is the realistic way to hit it long before the monthly figure matters. Whoever implements **3.3** should make a quota rejection visible in logs rather than silent.

**What this decision does not settle.**

- **OPEN-3 remains open.** The credential delivery model — a single-use invitation link versus a temporary password in an inbox — is a separate question about what is *sent*, not who sends it, and the owner has not answered it. Task **3.5** builds the invitation flow and depends on it. The document's own recommendation is the link, on the stated grounds that a password in an inbox is a permanent credential; that remains a recommendation, not a decision.
- **No implementation is authorised by this entry.** Task 3.1's deliverable is this record. No SDK is installed, no service exists, no configuration key is added, and no secret is in the repository. Tasks **3.2** (config keys) and **3.3** (the provider-agnostic service) do that work.

**The provider stays replaceable.** Task 3.3 specifies a provider-agnostic interface in `src/services/email.ts`, so the choice recorded here should reach exactly one module. That abstraction does **not** exist yet and was deliberately not created by this task — building it is 3.3's job, and building it early would have prejudged an interface with no caller.

**Consequences.**

- **OPEN-1 is resolved** and struck from the open-decisions table above, pointing here.
- **Phase 3 is unblocked on the provider question.** It is still gated on OPEN-3 at Task 3.5; 3.2, 3.3 and 3.4 can proceed without it.
- `docs/CURRENT_STATE.md` still reports **0** email providers integrated, and `FEATURE_STATUS.md` still grades Email **G — does not exist**. Both are correct: a decision is not an integration, and neither line moves until 3.2/3.3 land.
- **No secret belongs in this repository.** `EMAIL_API_KEY` is named by Task 3.2 as a configuration key; its value is deployment configuration and must never be committed, in `.env.example` or anywhere else.

---

## D-032 · 2026-09-03 · ACCEPTED — Employee codes are assigned from the highest number ever issued, not from a row count, and the unique index stays the final word

**Context.** Task 2.11 asked for a server-generated employee code and for a fix to *"the underlying `count(*)`-based generator, which collides after any permanent-delete."*

**The roadmap's second clause was wrong, and the code says so.** There was **no server-side employee-code generator at all**: `employeeCode` was a required field on `POST /api/users` (`z.string().trim().min(2).max(40)`), inserted verbatim from the request. The only thing producing one was `suggestEmployeeCode()` in the browser, scanning the at-most-200 rows the employees page had loaded — so two administrators with the dialog open got the same suggestion, and past 200 employees it derived from an arbitrary subset.

The `count(*)` generators that do exist — `customers.routes.ts` and `scoped-resource.ts` — are tracked as **[BUG-011](BUGS_AND_ISSUES.md#bug-011)** (HIGH, open), whose own Feature line reads *"loans, bank orders, disbursements, settlements, transactions, ledger entries, customers"*. **Users are not among them**, and none of BUG-011's four cited locations touches employee codes. Per `docs/README.md:88` — *"if the documentation and the code disagree, the code wins — fix the documentation in the same session"* — the roadmap row now carries the correction, and **BUG-011 was not fixed here**: it is a different bug about seven other resources.

**Decision.** Make `employeeCode` optional on create and assign it server-side from the **maximum suffix ever issued**.

| Choice | Why, and what was rejected |
|---|---|
| **Maximum ever issued, not `count(*)`** | A count goes *down*. Delete a record and the next code repeats one already used — precisely BUG-011's failure, and precisely what this task must not reproduce in the new generator. A maximum only moves forward. |
| **Read `users` with no `deleted_at` filter** | `users_employee_code_unique` is **partial** (`WHERE deleted_at is null`), so a soft delete *releases* the code — documented and intended (`PRD.md:1073` AC6). Releasing it is not the same as re-issuing it: the generator skips past a soft-deleted employee's number so the code cannot be silently handed to someone else while the original is still restorable. |
| **Also read the recycle-bin snapshots** | A **permanent** delete removes the `users` row entirely, so `users` alone cannot remember the number. The retained bin entry can: `permanentDelete` keeps the entry and only stamps `purged_at`, and Task 2.9 deliberately kept `employeeCode` in the user snapshot (only `passwordHash` is redacted). This is the one source that survives a purge, which is exactly the case the roadmap named. |
| **Format unchanged: `EMP-` + four zero-padded digits** | The seed writes `EMP-0001` (`seed.ts:111`) and `DATA_MODEL.md:347` gives the same example. The generator continues that series rather than starting a second one. It widens past four digits instead of wrapping. Note the deleted client helper produced `EMP-1001` — unpadded, from 1000 — so it never matched the documented format. |
| **Explicit codes still honoured** | An administrator can still supply one and keep an existing numbering scheme; it is validated by the same schema and refused by the same 409. A generated code is always numerically above every `EMP-` code in use, so it cannot walk into one. Non-conforming codes like `CONTRACT-77` contribute nothing to the maximum and cannot collide. |
| **The unique index remains the final guard** | Generation is check-then-insert: two simultaneous creates can read the same maximum and the loser gets `users_employee_code_unique`'s 409. That is the established pattern at every write site here (**BUG-037**, an accepted whole-codebase class), and the task brief asked to preserve it rather than add locking. **It is documented rather than papered over** — the code comment and the test both say so. |

**A real deadlock was found and fixed while building this.** The first cut called the generator *inside* `db.transaction(...)` while it read through the base handle. On a single-connection driver that is a deadlock — the read waits for the transaction that is waiting for the read — and every test in the new suite timed out at 60 s. The read now happens **before** the transaction opens, which also keeps the write transaction short. The cost is a marginally wider check-then-insert window, already closed by the unique index.

**Consequences.**

- `suggestEmployeeCode()` is deleted. The create form's code field is optional, placeholdered *"Assigned automatically"*, and says what happens if left blank.
- **15 backend tests** in `employee-code.test.ts`. Reverting the generator to `count(*)` fails **3** — the full create → delete → purge → create lifecycle, the repeated-purge case, and generation above an explicit `EMP-` code.
- **True concurrency is not tested**, and the test says why: PGlite is a single in-process connection, so `Promise.all` over four creating requests serialises rather than racing. The interleaving is modelled deterministically instead — two callers given the same code, one refused.
- **BUG-011 remains open** and is now the only `count(*)` generator left in the codebase.

---

## D-031 · 2026-09-03 · ACCEPTED — Server `error.details` is consumed by shape, not by status code, and an unmapped issue is never dropped

**Context.** Task 2.10 made the frontend the **first** consumer of `ApiError.details` — before it, `api.ts` set the field and nothing read it. There was therefore no convention to follow and one to establish, for every form that will surface field errors after this.

**The contract, read off `src/middleware/error-handler.ts` rather than assumed:**

| Source | Status | `details` |
|---|---|---|
| `ZodError` (`:46-55`) | 422 `validation_failed` | `{ path, message }[]`, `path` **dot-joined** — `"email"`, `"bankIds.0"` |
| `AppError` (`:57-63`) | any | whatever was thrown with it, or absent |
| 23505 unique violation (`:66-76`) | 409 `conflict` | `{ constraint: string }` — an **object** |
| 23503 FK violation (`:77-82`) | 409 `conflict` | absent |

**Decision.** Discriminate on the payload's **shape**, in one helper (`lib/field-errors.ts`), and keep every message the server sent.

| Choice | Why, and what was rejected |
|---|---|
| **Shape, not status or code** | The obvious implementation — "if 422, map `details`" — is fragile for a subtler reason than it looks: the 409 branch puts an **object** in the same field, so any code that reaches for `details.map(...)` on the wrong branch throws inside a `catch`, which would replace a useful server message with a blank dialog. Anything that is not an array of `{path, message}` yields no field errors and the caller's existing top-line message stands. A test uses the real `{ constraint }` payload. |
| **Match on the first path segment** | `bankIds.0` attaches to the `bankIds` control. The element index is not something the user can act on, and rendering "bankIds.0" beside a checkbox list would be worse than the generic message. |
| **First message per field wins** | zod can report several issues for one field; the first is the one the user hits. |
| **An unmapped issue is appended, never dropped** | A 422 naming a field the form does not render (`avatarColor`, say) would otherwise vanish, leaving only "The submitted data is not valid" — strictly less information than before this task. It is appended to the dialog line as `path: message`. This is the case the requirement calls out and the easiest one to get silently wrong. |
| **The generic line is cleared once every issue has a field** | "The submitted data is not valid" adds nothing beside a message pinned to the offending control, and repeating it reads as two separate problems. |
| **Duck-typed rather than `instanceof ApiError`** | The guard that matters is the payload's shape. A network failure, a thrown `Error` and a 409's object all fall through the same path, and the helper stays independent of the api module. |

**Loading and failure are three distinct states, not two.** The page previously had one: rows, or no rows. It now distinguishes **loading** (skeleton), **failed** (banner + Try again, and the table suppressed entirely), and **genuinely empty** (the existing empty state). Suppressing the table on failure is deliberate — an empty grid beside an error banner still invites the reader to conclude there is no data. A background refresh keeps the existing rows on screen rather than blanking them.

**`useResource` was not changed.** It clears `data` on rejection, which is what made the old behaviour indistinguishable from an empty list. Changing that would alter every page that uses the hook, so the page compensates locally instead — the smallest change that fixes the reported defect. If a later task wants stale-while-error semantics, that is a hook-level decision with its own blast radius.

**Client validation is untouched.** `validateEmployeeForm` still refuses an address with no `@` before any request, asserted by a test. Server details **complement** it; they do not replace it with something weaker.

**Consequences.**

- `lib/field-errors.ts` is the convention for every form that surfaces server validation from here on — customers, banks and loans all have the same generic-message problem today.
- The verbatim 400/403/409 surfacing that Tasks 2.4–2.9 depend on is unchanged, and tests in this suite re-assert it for both dialogs.
- **38 frontend tests** — 16 on the helper against the real payload shapes, 22 through the page. Reversion-proven with six mutations (5 / 3 / 4 / 1 / 3 / 4 failures), including one that treats `details` as always-an-array and one that drops unmapped issues.

---

## D-030 · 2026-09-03 · ACCEPTED — Employees are binnable like any other record, with two things no other type needed: a redacted snapshot and the role hierarchy

**Context.** Task 2.9 added `user` to `BIN_REGISTRY` and moved `DELETE /api/users/:id` onto `softDelete`. Every other binnable type is a business record. A **person** is not, and two consequences fall out that the existing twelve entries never had to answer.

**Decision.** Register `user` through the established mechanism and declare the differences as data, rather than special-casing the delete path.

| Choice | Why, and what was rejected |
|---|---|
| **`bankIdOf: () => null`** | A user belongs to many banks through `user_bank_access`, or to none, so there is no single bank to stamp. `service_provider` already answers `null` the same way, and the list route already keeps null-bank entries visible only to unscoped actors. Inventing a "primary bank" would have been new policy. It does mean user entries sit inside the blast radius of **[SEC-013](SECURITY_AUDIT.md)** (restore/purge skip `assertBankAccess` when `bankId` is null) — that finding is pre-existing and unchanged, and the hierarchy guard below is what stops it mattering for people. |
| **`redact: ["passwordHash"]`** | The snapshot is a full row copy, and bin entries **outlive the rows they describe** — a purge keeps the entry and only stamps `purged_at`. An unredacted user snapshot would park a live argon2 credential in a second table indefinitely, reachable by anything that can read `recycle_bin_entries`. The field name matches the audit log's own `REDACTED_FIELDS` vocabulary rather than inventing a second one. The list route already withheld `snapshot` from responses; this fixes the storage, not the exposure. |
| **`deleteFields: { status: "Inactive" }`** | The hand-rolled delete forced `status: "Inactive"` alongside the soft-delete stamps. `softDelete` writes only `deletedAt`/`deletedBy`/`purgeAfter`, so moving to it would have silently dropped the deactivation — and since `restore()` does not touch `status`, a restored employee would then have come back **able to sign in**. Declaring it keeps the old behaviour and makes restore safe by construction. |
| **A restored employee comes back deactivated** | Restoring a record is not the same as re-granting access. The admin reactivates deliberately through the existing `PATCH`. Asserted in both directions: a restored user is refused **403** at login until reactivated, then succeeds. |
| **The role hierarchy applies inside the bin** | The one thing this task had to add rather than configure. `recycle_bin.restore` is seeded to **`manager`** as well as `admin`, and the bin routes gated only on that permission plus bank access — sufficient while every binned record was a business row. Putting *people* in the bin meant a Manager could restore, or an actor with a bespoke purge role could permanently delete, a Super Admin they could never have deleted. **That is BUG-038's hole arriving through a different door, created by this task rather than inherited**, so it is fixed here. `assertCanActOnBinnedUser` keys on the **record type**, never a role name, and leaves non-user entries untouched. |

**What was NOT changed.** No new permission was introduced. `softDelete`, `restore` and `permanentDelete` keep their signatures and their behaviour for all twelve existing types — the two new registry fields are optional and only `user` supplies them. The route keeps its **204**, and its self-delete 400, hierarchy 403 and last-Super-Admin 409 still run *before* any write, because `softDelete` knows nothing about them and must not be trusted to.

**Relationships are untouched by design.** `team_members` and `user_bank_access` rows survive a delete and are therefore still correct after a restore — nothing rebuilds them because nothing removed them. This is the existing recycle-bin semantics (the row is hidden, not dismantled) and it is asserted across the round trip. It also composes with **D-027**: the team route already tolerates `team_members` rows pointing at deleted users, so a binned employee cannot lock a roster.

**Consequences.**

- `BIN_REGISTRY` goes from twelve types to **thirteen**; the recycle-bin screen labels the new one *"Employee"*.
- **Task 2.8's confirmation copy was inverted, not patched over.** It said the deletion could not be undone, which was true then. It now describes the bin and warns that a restored employee returns deactivated. Group D of `employees-delete.test.tsx` was inverted with it, and the backend test that asserted **zero** bin entries now asserts **one** — that test existed to fail here, and it did.
- **23 backend tests** in `user-recycle-bin.test.ts` plus the updated lifecycle group. Reversion-proven with five mutations (1 / 3 / 1 / 1 / 17 failures). The purge-guard test initially passed for the wrong reason — `manager` does not hold `recycle_bin.permanent_delete`, so `requirePermission` refused before the guard ran — and was rewritten to use a bespoke role that actually reaches it.

---

## D-029 · 2026-09-03 · ACCEPTED — The delete confirmation says the deletion cannot be undone, rather than waiting for 2.9 to make that false

**Context.** Task 2.8 wired `DELETE /api/users/:id` from the employee screen. The roadmap asks for *"a confirmation dialog and clear messaging that it is a soft delete"*, and `NEXT_TASK.md` flagged the problem in its own bite list: the route soft-deletes, but `user` is **absent from `BIN_REGISTRY`**, so it writes **no recycle-bin entry** and nothing in the product can bring the record back. Roadmap **2.9** — a separate task — adds that. The choice was named there and required to be recorded: *"Either say plainly that it cannot be undone from the UI, or do 2.9 first — decide and record it."*

**Decision.** Say plainly that it cannot be undone. Do **not** pull 2.9 forward.

| Choice | Why, and what was rejected |
|---|---|
| **The copy states the deletion cannot be undone from the product** | "Soft delete" is an implementation detail; to the person clicking the button the only question that matters is whether it can be reversed, and today it cannot. Copy that said "soft delete" and stopped there would be technically accurate and practically misleading — **RULES §4** and **D-004**: no control may report a capability the system does not have. The dialog names the consequence instead: no recycle bin, no restore screen, recovery would take a database restore. |
| **2.9 was not pulled forward** | It is its own roadmap row (*"Add `user` to `BIN_REGISTRY` … route the delete through `softDelete`"*, effort **M**), it changes backend behaviour, and it needs its own tests. Doing it inside an **S**-sized frontend wiring task would have been a silent scope expansion, and the roadmap's own maintenance rule forbids reordering without recording why. E7 is therefore **PARTIAL**, not DONE — delete is wired, restore is not. |
| **The claim is pinned by a backend test** | The dialog asserts something about the backend, so `employee-lifecycle.test.ts` asserts it too: deleting an employee writes **zero** `recycle_bin_entries` rows. When 2.9 lands that test fails **on purpose** — the signal that the copy has become a lie and must be rewritten with it. A comment in both files says so. |
| **The dialog points at Revoke access** | The likeliest mistake this screen enables is reaching for Delete when Revoke was meant. Naming the reversible alternative in the confirmation is cheaper than any recovery path. |
| **Gated on `users.delete`** | The route requires it. A **fourth** distinct permission on this screen after `users.edit`, `users.assign` and `teams.assign`. A test asserts the control is absent for a holder of all the others, even though the mocked actor is a Super Admin. |
| **204 is reconciled by re-reading** | There is no body to adopt, unlike Tasks 2.6 and 2.7 where the route echoes what it stored. Success calls `refresh()` and `refreshReference()` and clears `selected`, because the detail dialog would otherwise be showing a record that no longer exists. |

**Measured, not assumed.** A deleted employee's login returns **401**, not the **403** a *revoked* employee gets: the login lookup filters `deletedAt IS NULL`, so a deleted account is indistinguishable from one that never existed. That is the better answer — it leaks nothing — and it is now asserted so the difference between revoke and delete stays deliberate. The first draft of the test asserted 403 and was wrong.

**Consequences.**

- The employee detail view now carries **five** separately-gated controls: Team (`teams.assign`), Bank access (`users.assign`), Edit and Revoke/Restore (`users.edit`), Reset password (`users.reset_password`), Delete (`users.delete`).
- **Task 2.9 inherits an obligation:** adding `user` to `BIN_REGISTRY` must also rewrite the confirmation copy and the group D tests in `employees-delete.test.tsx`. The failing backend test is the reminder.

> **Discharged 2026-09-03 by [D-030](#d-030--2026-09-03--accepted--employees-are-binnable-like-any-other-record-with-two-things-no-other-type-needed-a-redacted-snapshot-and-the-role-hierarchy).** The backend test failed exactly as intended when `user` joined `BIN_REGISTRY`, and the copy, group D and that assertion were all inverted together. The mechanism worked: a factual claim in the UI was pinned by a test that broke when the fact changed.
- **23 frontend tests** in `employees-delete.test.tsx` plus **6 backend cases**. Reversion-proven with five mutations (5 / 2 / 2 / 4 / 1 failures), including one that replaces the copy with a false restorability promise and one that reports success on a refusal.

---

## D-028 · 2026-09-03 · ACCEPTED — The employee screen resubmits the whole roster from a fresh read, and a move is remove-then-add

**Context.** Task 2.7 wired `PUT /api/teams/:id/members` into the employee screen. The route is **team-shaped** and the screen is **employee-shaped**: it replaces one team's entire roster, while the screen knows about one person. `NEXT_TASK.md` required the resulting questions to be answered explicitly rather than settled in passing.

**Decision.** A **Team** dialog on the employee detail view, gated on `can("teams.assign")`, which re-reads the rosters from the server and resubmits them complete.

| Choice | Why, and what was rejected |
|---|---|
| **The rosters are re-read from `GET /teams` at save time** | The important one. `useReference()` loads teams at sign-in and refreshes only on demand, so a roster built from it can be minutes stale — and submitting a stale roster **evicts whoever another administrator added in the meantime**, with a 200 and no warning. A cached read is not good enough to submit. A test seeds a member into the server's answer that is absent from reference data and asserts it survives. |
| **Every other member is resubmitted unchanged** | `{ userIds: [employeeId] }` is the single most damaging mistake available here: the route accepts it, returns 200, and empties the team. A test asserts no request body ever equals `[employeeId]`, and a backend test demonstrates the eviction that would follow. |
| **A move is two requests — removal first** | One team's roster cannot express membership of another, so moving is `PUT` old-minus-employee then `PUT` new-plus-employee. They cannot be atomic across two endpoints. Removal goes first because the failure it leaves — on **no** team — is visible and recoverable, whereas add-first leaves the employee on **two** teams and `teamOf()` reports only the first match, hiding it. The half-completed case is reported verbatim and says exactly what happened; it is not dressed up as success (**D-004**). |
| **The server's returned `userIds` decides success** | The route echoes what it stored. If the employee is not in the confirmation, the save failed no matter what the status code was — a test makes the server answer without them and asserts no success toast. Same reasoning as **D-026** for bank access. |
| **One team per employee, via a Select** | Follows the existing model rather than inventing one: the create form assigns a single `teamId`, and `teamOf()` resolves an employee with `.find()`. `team_members` would permit several, but nothing in the product exposes that, so a multi-team picker would have been new product design. Recorded as a known limitation rather than hidden. |
| **Gated on `teams.assign`** | The route requires it. It is a **third** distinct permission on this screen after `users.edit` and `users.assign`, and the fourth counting `users.reset_password`. No role names appear in the frontend; `can()` is UI convenience and the backend decides. A test asserts the control is absent for a holder of `users.edit` + `users.assign` without `teams.assign`. |

**No backend change.** Task 2.7 needed nothing that the API did not already provide. The BUG-038 remediation (**D-027**) is untouched: `assertCanManageRoleLevel` over `previous ∪ submitted` still runs on every request this screen sends, and a backend test asserts a Manager is still refused when the target roster holds a Super Admin — a member the UI resubmitted without altering.

**Consequences.**

- The employee detail view now carries four separately-gated controls: Team (`teams.assign`), Bank access (`users.assign`), Edit and Revoke/Restore (`users.edit`), Reset password (`users.reset_password`).
- **The two-request move has an unavoidable window.** It is bounded by ordering and reported honestly, but it is real; a single atomic "set this employee's team" endpoint would remove it and does not exist. Not built here — that is API design, not Task 2.7.
- Task 2.6 test 12 was titled *"no team endpoint is ever called — BUG-038 stays unwired"*. Its assertions only ever covered the **bank access** flow, so they still pass untouched — but the title claimed something about the repository that Task 2.7 made false. Retitled to what it actually pins: the bank access dialog calls no team endpoint. **No assertion was changed, weakened or removed.**
- **30 frontend tests** in `employees-team.test.tsx`, plus **5 backend integration cases** pinning the move sequence over HTTP. Reversion-proven with six mutations (5 / 4 / 4 / 1 / 1 / 2 failures).

---

## D-027 · 2026-09-03 · ACCEPTED — Team-membership authorization covers the union of the previous and submitted rosters; teams stay un-bank-scoped

**Context.** BUG-038 / [SEC-029](SECURITY_AUDIT.md#sec-029): `PUT /api/teams/:id/members` ran one permission check and then replaced the whole roster, consulting the role hierarchy nowhere. Measured: a seeded Manager enrolled a Super Admin (**200**) while the same actor was refused **403** by `PATCH /api/users/<that super admin>`. D-025 and D-026 both recorded it as deliberately-not-fixed and both stated that roadmap 2.7 must not wire the route first. `NEXT_TASK.md` left one question explicitly open: *"Decide explicitly whether **removing** a member should also require authority over them."*

**Decision.** Authorize the **union of the previous and submitted rosters** — `previous ∪ submitted` — with the existing `assertCanManageRoleLevel`, inside the transaction the route already had.

| Choice | Why, and what was rejected |
|---|---|
| **The union, not the submitted list** | This is the whole decision. The route *replaces* the roster, so a member is removed by being **absent** from the request. Authorizing only `userIds` — the obvious reading, and what the original BUG-038 write-up proposed — returns 200 for a Manager who submits a roster containing only people they may manage, and silently evicts the Super Admin who was on it. Every id in that request is legitimate; the victim is never named. Three tests fail if the affected set is narrowed back to `submitted`. |
| **The union, not the symmetric difference** | Authorizing only what actually changes (added ∪ removed) is *sufficient* for security and less restrictive. It was rejected for a smaller invariant: "you must be able to manage everyone on this roster, before and after" is one sentence, holds under concurrent writes, and fails closed. The cost is real and is tested rather than hidden — a Manager cannot edit a roster containing a Super Admin **even to leave them in place**. Given a team is a "grouping of employees" and no seeded flow puts a Super Admin on one, that trade is worth one sentence of strictness. Revisit if a real roster ever legitimately mixes levels. |
| **No bank scoping** | `claude/PROJECT_CONTEXT.md:71` records teams as *"Grouping of employees. **Not bank-scoped.**"* and neither `teams` nor `team_members` carries a bank column. A Manager scoped to bank A rostering an employee scoped to bank B stays **200**, and a test asserts it. Adding `assertBankAccess` here would have been inventing policy under cover of a bug fix — the opposite of what the documents say. |
| **400, not `targetUserRole`'s 404** | The original sketch said to resolve each member through `targetUserRole`. That helper throws `notFound`, which would claim the **team** in the path was missing when in fact the payload was wrong. `PRD.md:1267` (NFR-SEC-10) reserves 404 for path-id lookups; `PRD.md:257` sets the precedent for the payload case — *"A non-existent bank id returns `400`"*. One batched read replaces N helper calls, and the raw **409** *"still referenced by other records"* FK leak is gone. |
| **Existence enforced on submitted ids only** | Soft-deleting a user leaves their `team_members` rows in place. Requiring every *previous* member to be live would make any team containing a departed employee permanently unmanageable — a self-inflicted lockout in the name of a fix. Dropping an already-deleted member grants nobody anything, so it needs no authority. A Manager cannot reach this as an escalation route: soft-deleting a Super Admin already requires `users.delete` plus hierarchy, which they fail. |
| **Inactive users stay assignable** | Nothing in the documents says otherwise, and rostering someone temporarily deactivated is ordinary. Deactivation is not deletion. |
| **The actor is excluded from the hierarchy loop, by identity** | Added after adversarial review. Without it the union check runs against the actor's *own* membership row, and "strictly greater" means nobody outranks themselves — so anyone below Super Admin who was on a team could never edit that team's roster, not even to leave it. Measured **403** for keep-self, remove-self and add-self. It is reachable normally, because `POST /api/users` places a new employee on a team at creation. Safe because `team_members` is never consulted by any authorization decision — `services/access.ts` does not mention teams at all — so joining or leaving a team grants and removes nothing. **By identity, never by level:** a test asserts a peer at the same level is still refused. |
| **Submitted ids are canonicalised to lower case** | Also from review. Postgres emits uuids lower-cased and `z.uuid()` accepts any case without normalising, so an uppercase id for a live user was rejected **400 "One or more users do not exist"** — the same class of untruth this fix existed to remove. Normalising once at the boundary also makes case variants of a single id dedupe correctly rather than violating the `(team_id, user_id)` primary key. |

**No authorization function was touched.** `assertCanManageRoleLevel` is byte-identical and `authorization.test.ts` (26 tests) passes unchanged. There are still **zero role-name string comparisons** in authorization code (`claude/PROJECT_CONTEXT.md:90`). No migration, no new endpoint, no response change, no `error-handler.ts` change (**D-021**), and no row lock — check-then-write remains the established pattern at all eleven transaction sites, so **BUG-037** stays deferred.

**Consequences.**

- `ROLES_AND_PERMISSIONS.md` §4.2 goes from **nine** hierarchy-enforcing routes to **ten**. That table was the clearest evidence the route was an outlier: every sibling appeared in it and this one did not.
- **The two assignment routes now differ, and that is a known asymmetry.** `PUT /api/teams/:id/members` authorizes removals; `PUT /api/users/:id/banks` still loops `assertBankAccess` over the submitted list only — the scoped-revocation gap in D-026. That gap remains unreachable with the seeded roles, so it was not closed here, but the precedent for closing it now exists.
- **Task 2.7 is unblocked** and its scope is unchanged: wire the existing route from the employee screen.
- **43 tests** in `src/tests/team-membership.test.ts`. Backend **302/302** across 13 files. Reversion-proven with six mutations (3 / 10 / 3 / 3 / 3 / 3 failures), the last two guarding the review fixes above.
- **The fix was reviewed adversarially and the review paid for itself**, costing two regressions that the original 35 tests did not catch — every one of them seeded rosters with users *other than* the actor, so the self-lock was invisible. Worth repeating on any change that adds a per-item authorization loop over a set the actor may belong to.

---

## D-026 · 2026-09-03 · ACCEPTED — Bank access is gated on `users.assign` and shows the reference bank list; the scoped-revocation gap is recorded, not designed around

**Context.** Task 2.6 wired `PUT /api/users/:id/banks` into the employee screen. Two questions had to be settled first, and `NEXT_TASK.md`'s own Definition of Done required the second to be recorded rather than decided silently.

**Decision.** Gate the control on `can("users.assign")`, populate it from `useReference().banks`, and **document** the scoped-revocation gap instead of building UI around a role that does not exist.

| Choice | Why, and what was rejected |
|---|---|
| **Gate on `users.assign`, not `users.edit`** | Not a preference — the route declares `requirePermission(PERMISSIONS.users.assign)`. `users.edit` gates the Task 2.4 edit dialog, and the two are genuinely different permissions. Reusing `users.edit` would show a button that always 403s for any role holding one without the other. Tested in both directions; pointing the gate at `users.edit` fails four tests. |
| **The picker lists `useReference().banks`** | That is `GET /api/banks`, which is already bank-scoped server-side, so a scoped actor is shown exactly the banks they may grant — the same source the create form's picker already uses (**D-003**: reuse what exists). A second, differently-scoped bank list would have been a new source of truth. |
| **Adopt the server's returned list, not the submitted one** | `res.json({ data: { userId, bankIds } })` is the route's confirmation of what its transaction wrote. Taking that (plus `refresh()`) means a refused or altered save cannot be masked by optimistic state. A test makes the server answer with a different set and asserts the UI follows it. |
| **Do not add `bankIds` back to `PATCH`** | **D-025** settled this: the relationship belongs to the route that owns it transactionally. Assignment is a separate request, from a separate dialog, with its own permission gate. A test asserts no PATCH body ever contains `bankIds`. |

**The scoped-revocation gap, stated plainly.** `assertBankAccess` is looped over the **submitted** list only, so it guards banks being *granted* and never banks being *revoked*. `bankIds: []` from a bank-scoped actor would therefore clear grants to banks that actor cannot see.

It is **not reachable with the seeded roles**: `users.assign` is held only by `super_admin` (via the `"*"` grant) and `admin` (which also holds `system.access_all_banks`), and both are unscoped — `assertBankAccess` returns immediately for them. Reaching it needs a bespoke role holding `users.assign` without `system.access_all_banks`.

And in that bespoke case the outcome is a **403, not silent data loss**: the employee's invisible bank is still present in `assignedBanks`, so it rides in the submitted set and `assertBankAccess` refuses it. The actor is blocked rather than quietly destroying a grant.

**So no UI was built for it.** Filtering the submitted set to the actor's visible banks would convert that honest 403 into exactly the silent revocation the gap describes — strictly worse. Fixing it properly means guarding revocations in the route, which is a backend change outside Task 2.6's scope and would alter behaviour for a role nobody currently has. Recorded here and carried in `NEXT_TASK.md`; if a scoped assigner role is ever created, this must be closed first.

**Consequences.**

- One frontend file changed and one test file added. **No backend file was touched**, no new endpoint, no duplicated assignment logic.
- The employee screen now has three separately-gated controls: Bank access (`users.assign`), Edit (`users.edit`), Revoke/Restore (`users.edit`), plus Reset password (`users.reset_password`).
- **Team assignment stays unwired.** `PUT /api/teams/:id/members` applies no per-member authorization (**BUG-038**, HIGH, open), and Task 2.7 must not land before it is fixed. A test asserts the employee UI calls no team endpoint.

> **Discharged 2026-09-03 by [D-027](#d-027--2026-09-03--accepted--team-membership-authorization-covers-the-union-of-the-previous-and-submitted-rosters-teams-stay-un-bank-scoped).** BUG-038 is fixed and Task 2.7 is unblocked. The route is still unwired — that is 2.7's job, not this decision's. The frontend test asserting the employee UI calls no team endpoint stays valid until 2.7 lands, and must be updated then, not before.
>
> D-027 also creates a deliberate asymmetry with the gap recorded immediately above: the teams route now authorizes **removals** as well as additions, while `PUT /api/users/:id/banks` still checks only the banks being granted. That gap stays open on its own merits — it is unreachable with the seeded roles — but it is no longer true that no route in this codebase guards a revocation.

---

## D-025 · 2026-09-03 · ACCEPTED — PATCH persists `joinedOn` and refuses `bankIds`/`teamId`; the relationships keep their own routes

**Context.** BUG-020: `PATCH /api/users/:id` parsed `joinedOn`, `bankIds` and `teamId` and wrote none of them — a 200, no database change, and an audit row listing only `updatedAt`. Roadmap Task 2.5 framed it as one choice: *"apply them, or reject them explicitly. Silent discard is worse than either."* Investigation established the three fields are not one problem.

**Decision.** Split by what the schema actually says. `joinedOn` is **persisted**; `bankIds` and `teamId` are **refused with 422**.

| Choice | Why, and what was rejected |
|---|---|
| **`joinedOn` persisted** | A plain nullable column on `users`. No transaction, no extra query, one conditional branch in the existing `.set()`. Decisively: **no other route can change it after creation**, so rejecting it would leave a field permanently unwritable — the opposite of fixing the bug. |
| **`bankIds` refused** | `PUT /api/users/:id/banks` already does the job transactionally, with `assertCanManageRoleLevel` on the target, `assertBankAccess` per bank, an existence check, and an audit row carrying `from`/`to`. Implementing it again inside PATCH would put tenant-isolation logic in two places. **D-003** says grep for an existing endpoint before writing one; this one exists and is correct. |
| **`teamId` refused** | Stronger than duplication: **`users` has no team column at all.** Membership is many-to-many through `team_members`, whose PK `(team_id, user_id)` permits a user in N teams — measured. A scalar `teamId` on PATCH would be inventing a relationship the schema does not have, and would need a policy ("replace all memberships"? "add one"?) that nothing in the data model states. |
| **`z.never({ error }).optional()`, not `.strict()`** | `.strict()` rejects *every* unrecognised key on the route and reports `path: ""`, naming the offending field only inside the message. The guard names it in `path`, and leaves unknown-key handling exactly as it was — asserted by a test that an unknown key is still ignored. |
| **Derived, not hand-written** | `patchSchema(userInput).extend({ … })`. **D-024** forbids a second hand-written schema per resource; `userInput` stays the single source of truth and is itself untouched, so `POST /users` still accepts and applies all three fields. |
| **No error-handler change** | `middleware/error-handler.ts` already turns any `ZodError` into `422 validation_failed`, so the shape is inherited. **D-021** is respected. |
| **No transaction** | Nothing multi-table is written: `joinedOn` joins a row update already in flight, and the other two are refused before any write. **BUG-037** stays untouched. |

**A rejection is a behaviour change, and it was checked rather than assumed.** `PATCH` previously returned 200 for these fields. Verified before changing anything: Task 2.4's edit dialog cannot emit them (`EmployeePatch` has nine keys and none is one of these), and `PUT /users/:id/banks` / `PUT /teams/:id/members` have zero frontend callers. No caller exists that a 422 could break.

**Consequences.**

- `PATCH /api/users/:id` gains one write branch and two refusals. `userInput`, `POST /users`, and both `PUT` assignment routes are byte-identical.
- **No frontend change.** Wiring the two assignment routes to the UI stays roadmap **2.6** and **2.7**, using the existing endpoints as D-003 intends.
- A new `notOnThisRoute()` helper sits beside `patchSchema` in `lib/zod.ts`, reusable wherever a create-schema field belongs to a different endpoint once the record exists.
- **Discovered and deliberately not fixed:** `PUT /api/teams/:id/members` applies **no per-member authorization** — a Manager can enrol or evict a Super Admin. Filed as **BUG-038** (HIGH). It has no frontend caller today, which bounds the exposure, but **roadmap 2.7 must not wire it before that is fixed.**

> **Discharged 2026-09-03 by [D-027](#d-027--2026-09-03--accepted--team-membership-authorization-covers-the-union-of-the-previous-and-submitted-rosters-teams-stay-un-bank-scoped).** BUG-038 is fixed; 2.7 may now wire the route. Recording it here rather than fixing it inside Task 2.5 was the right call — the fix turned on a design question (whether removals require authority over the person removed) that deserved its own investigation, and answering it casually inside an unrelated task would have shipped the eviction hole under the appearance of a fix.

---

## D-024 · 2026-09-02 · ACCEPTED — One `patchSchema()` derivation, not a second hand-written schema per resource

**Context.** BUG-036: in zod 4.4.3 `.default()` survives `.partial()`. The field becomes `ZodOptional<ZodDefault<…>>`, and because a successfully applied default is not an "absent" result, the optional wrapper passes it straight through. Measured: `userInput.partial().parse({ name: "x" })` returns `{ name: "x", status: "Active", target: 0, achieved: 0 }`. Every PATCH handler then wrote those invented values.

**Decision.** A single helper, `patchSchema()` in `src/lib/zod.ts`, that strips `ZodDefault` wrappers before `.partial()`. Applied at all six `.partial()` call sites.

| Choice | Why, and what was rejected |
|---|---|
| **Derive, don't duplicate** | The register's original proposal was a second hand-written `userPatchInput` per resource. That fixes one route, needs repeating six times, and drifts from its create counterpart the moment a field is added — the create schema stays the single source of truth this way. |
| **Fix all six sites, not just users** | BUG-036 was filed under "User administration". Three of the other five — `scoped-resource.ts`, `banks.routes.ts`, `customers.routes.ts` — spread the parsed body **wholesale with no `!== undefined` guard**, making them strictly more destructive. `scoped-resource.ts` alone covers nine routers, so the one-line change there is the highest-leverage part of the fix. Fixing users only would have closed the finding while leaving loans, settlements and the ledger corrupting on every PATCH. |
| **Public API only** | `.shape`, the exported `z.ZodDefault` class, and its documented `.unwrap()`. No `_def`/`_zod` access, so a zod upgrade cannot silently change the result. Verified against 4.4.3 that `.unwrap()` exists, that `instanceof z.ZodDefault` discriminates correctly, and that `min(0)` still rejects `-1` after unwrapping. |
| **Reuse the inner schema by reference** | The unwrapped schema is the *same object*, not a rebuild, so `min`/`max`, enums, uuid/email checks, coercion and field-level `.transform()`/`.refine()` are preserved by construction rather than by re-listing them. `customerInput.aadhaar`'s transform+refine chain is the case that would have broken under a rebuild. |
| **Return a `ZodObject`** | `rolesRouter` chains `.omit({ key: true })` onto the result. A `ZodType` return would have forced that route into a different shape. |
| **Leave base/create schemas alone** | POST depends on the defaults, and `status`/`kyc`/`priority`/`Draft` are correct create-time behaviour. Asserted by test: creating a user, bank, customer and loan with those fields omitted still yields every documented default. |

**An accidental correctness became a real one.** Task 2.1's `assertSuperAdminRemains(..., { status: input.status ?? target.status, … })` had an unreachable fallback: `input.status` was never `undefined`, so the helper always received a fabricated `"Active"`. SEC-003 was safe only because the injected value pointed the *safe* direction, not because the code compared anything. After this fix `input.status` is genuinely absent when omitted, the fallback is the live path, and the guard compares against stored state as its comment always claimed. A dedicated test pins it: renaming an **Inactive** Super Admin must leave them Inactive.

**Consequences.**

- One new file (`lib/zod.ts`), six one-line call-site swaps, no handler logic changed and no API response shape changed.
- **Not** addressed, and deliberately: `teamId`/`bankIds`/`joinedOn` are still parsed and discarded (**BUG-020**) — a separate defect in the same handler, and the roadmap's Task 2.5 owns it. The check-then-write race (**BUG-037**) is untouched; no transaction or lock was introduced, and none was needed.
- Task 2.4 (the employee edit dialog) is unblocked: a form that saves name and phone no longer destroys sales figures or reactivates revoked staff.

---

## D-023 · 2026-09-02 · ACCEPTED — The forced-password-change exemption is a middleware choice, not a path allow-list

**Context.** Roadmap Task 2.3 asked to *"enforce `mustChangePassword` server-side in `requireAuth`: reject with 403 unless the path is `/api/auth/change-password`, `/api/auth/me`, or `/api/auth/logout`."* Investigation measured that the mechanism cannot work as written and that one of the three exempted paths does not need exempting.

**Decision.** `requireAuth` becomes the strict default and raises `403 password_change_required`. Exactly two routes opt out by using a second exported middleware, `requireAuthAllowPasswordChange`. **No path is compared anywhere.**

| Choice | Why, and what was rejected |
|---|---|
| **No path allow-list** | Measured under Express 5.2.1: inside a middleware registered by `router.use()` on a router mounted at `/api/users`, `req.path` is **`/abc123`** — relative to the mount — while `req.baseUrl` is `/api/users` and only `req.originalUrl` carries the full path (plus the query string). `requireAuth` is applied that way on twelve routers plus the `createScopedResource` factory, so `req.path === "/api/auth/change-password"` would **never** match. Every flagged user would have been 403'd out of the one route that can clear the flag — an instant, permanent, self-inflicted lockout for anyone holding a temporary password. This was the single highest-risk failure mode of the task, and it is now impossible by construction because no string is compared. |
| **Inside `requireAuth`, not a separate `requirePasswordChanged`** | SEC-010's remediation proposed a separate middleware applied to the business routers. That shape **fails open**: it needs adding at thirteen mount points, and any future router that forgets it is silently unguarded. Putting the gate in the default and making the *exception* explicit means a new router is protected by doing nothing. Two call sites changed instead of thirteen. |
| **Not in `loadAuthContext`** | That function holds the three *session* gates, and D-020 fixed their contract: their codes mean "this session is over" and the client signs out on them. A forced password change is the opposite — the user needs the session to fix it. The check therefore sits in `requireAuth`, *after* `authenticate()`, so an account that is both flagged and deactivated still reports `account_inactive`. Asserted by test, on the exempt routes as well. |
| **A new code, not `forbidden`** | `password_change_required` lets a client distinguish "you may never do this" from "you may do this once you have changed your password", without parsing prose. It is deliberately **not** added to the frontend's `SESSION_ENDED_CODES`; a frontend test fails if it ever is. `frontend/src/lib/api.ts` is byte-identical — Task 1.8's allow-list design meant an unknown code already fails safe. |
| **A private `authenticate()` shared by both exports** | Token verification and `loadAuthContext` exist once, so the strict and permissive middlewares cannot drift on authentication, on the session gates, or on the shape of `req.auth`. |
| **`/api/auth/logout` dropped from the exemption set** | It carries **no** `requireAuth` at all — it authenticates by cookie, and returns 204 with no bearer token (measured). Listing it would have been dead code implying logout is authenticated when it is not. The same applies to `/login` and `/refresh`. The real exemption set is exactly two routes, and both already used per-route `requireAuth`, which is why this design fits without moving anything. |

**Refresh stays open, deliberately.** A flagged session can still rotate its cookie, and its refresh tokens are **not** revoked because of the flag. Two reasons, both measured: the frontend's session restore on page reload *is* `POST /auth/refresh`, so blocking it would sign a flagged user out on every reload and strand them before the form that fixes the state; and once the gate exists, an indefinitely-extendable flagged session can do nothing except change the password, so the risk it used to represent collapses. The rotated token is asserted to be exactly as restricted as the one it replaced.

**Consequences.**

- One new error helper, one middleware file, two route lines. No router, no route path, and no authorization function moved.
- **`frontend/src/lib/api.ts` is unchanged** — no frontend source edit was required at all. Only a test was added, pinning that `password_change_required` does not end the session.
- Once the flag clears, **the same access token immediately works**, because the context is re-read per request. The user is never stranded holding a token minted while flagged.
- Enforcement **fails closed**: a router added in future is gated unless it explicitly opts out.
- **Two register IDs were corrected rather than propagated.** `PRODUCTION_ROADMAP.md` and `FEATURE_STATUS.md` both called this finding **SEC-009**, which is a different, still-open **P0** (plaintext Aadhaar in `import_rows`). The correct id is **SEC-010**. This is the third instance of this collision class in the repository, and the roadmap carries a wider off-by-one from SEC-010 upward that is recorded but not fixed here.
- **`BUG-005` (HIGH) and `SEC-010` (MEDIUM) described the same defect at two severities.** Reconciled to **MEDIUM** in both: neither authentication nor authorization was ever defeated, and reaching the state required an administrator-issued temporary password or deploy-dashboard access. The measured impact is recorded in full rather than softened.

---

## D-022 · 2026-09-02 · ACCEPTED — One end-state invariant for both routes; the PATCH self-guard is field-scoped, not a copy of DELETE's

**Context.** Roadmap Task 2.1 asked to *"add the self-guard and last-super-admin guard to `PATCH /api/users/:id`"* — i.e. lift the two interlocks `DELETE` has carried since the first commit. Task 2.2, listed separately, asked to *"fix the last-super-admin count to exclude the target row"*. Investigation measured that the obvious reading of 2.1 — copy `DELETE`'s two checks — is wrong on both counts.

**Decision.** Land 2.1 and 2.2 together as **one** helper, `assertSuperAdminRemains(db, targetId, before, after)` in `services/access.ts`, called by `PATCH` and `DELETE`; and give `PATCH` a **field-scoped, change-scoped** self-guard that is deliberately *not* `DELETE`'s rule.

| Choice | Why, and what was rejected |
|---|---|
| **Field-scoped self-guard** | `DELETE`'s `if (id === ctx.userId) throw` is unconditional, and copying it verbatim would refuse a Super Admin editing **their own name**. Measured: a mutation that refuses on the mere *presence* of `status` or `roleId` fails four tests, including the full-form self save that Task 2.4's edit dialog will issue. Each rule therefore compares against the value already stored: `input.status === "Inactive" && target.status !== "Inactive"`, and `input.roleId !== target.roleId && target.roleIsSystem && !nextRoleIsSystem`. |
| **Cover `roleId`, not just `status`** | A status-only guard leaves a second, **quieter** path open. Measured: self-demotion returns 200, the account stays Active, re-login returns 200 — and every administrative call then returns a bare `forbidden`, which the Task 1.8 client deliberately does **not** sign out on. The user is left in a permanently broken session with no explanation. `DELETE` has no analogue to copy, because `DELETE` cannot change a role. |
| **The self-guard and the invariant are two rules, not one** | Measured: deactivating yourself while a peer Super Admin exists leaves `remaining = 1`, so the invariant is satisfied — and you are still permanently locked out. Neither rule subsumes the other; both are separately reversion-proven. |
| **End-state signature, not `(targetId, nextStatus, nextRoleId)`** | SEC-003's remediation proposed the latter. The end-state form is the only shape that also expresses `DELETE`'s soft delete, so one statement covers three different writes. Callers pass what they are about to write; `DELETE` literally passes `{ status: "Inactive", deleted: true }`. |
| **2.2 lands inside 2.1, not after it** | The only formulation correct for **both** routes is *"count the protected population excluding the target; refuse if the operation removes the target and the count reaches zero"* — which **is** the 2.2 fix. Implementing 2.1 as a second private copy would have left two subtly different statements of one invariant in one file. For an Active target the new form is provably equivalent to the old `remaining <= 1` over a count that included them, so `DELETE`'s behaviour on active targets is unchanged; for an Inactive target the old form produced a spurious 409, and now does not. Reversion-proven: restoring the pre-2.2 count fails **exactly one** test (18). |
| **Population is `roles.is_system`, not "holds `system.manage_any_user`"** | It is what `DELETE` has always enforced and what the register and roadmap mean. It also cannot be granted by accident: `POST /api/roles` hardcodes `isSystem: false` (measured — sending `isSystem: true` returns 201 with `false` stored), and `0001_governance_guards.sql` blocks deleting, re-keying or deactivating a system role. **Known and accepted divergence:** a Super Admin can mint a non-system role holding the full 76-permission catalogue and move onto it — measured, the `is_system` count drops to 0 while they keep `manage_any_user` and full API access. That is a *false-refusal* risk, not a lockout risk, and there is no UI for role creation. Widening the population to a permission-based definition would change `DELETE` too and is deferred rather than smuggled in. |

**Rejected: enforcing the invariant in the database (SEC-003 remediation item 3).** A table-wide aggregate cannot be a `CHECK`, so it needs a trigger. A trigger raises `restrict_violation` (**`23001`**), and `middleware/error-handler.ts` maps only `23505` and `23503` — `23001` falls through to the terminal branch and becomes a **500 with an error-level stack trace**. Making it a clean 409 requires adding a SQLSTATE mapping to `error-handler.ts`, which **D-021 explicitly forbids**. The trigger would also fire on every `users` write, including the seed and the test harness. Rejected on measured grounds, not taste.

**Rejected for now: closing the race.** The count and the write are separate statements with no lock — exactly as `DELETE` has always been. Repository-wide there are **11 `db.transaction` sites, zero row locks, zero `FOR UPDATE`, zero advisory locks, zero isolation-level settings**; check-then-write is the *established* pattern (e.g. the role-holder count at `admin.routes.ts:674-681`, which has the same race). Adding this codebase's first row lock at one of eleven sites is not an architecture. The defect Task 2.1 exists to close is one administrator and one mis-click — a single-actor path, now fully closed. Recorded as **BUG-037**, deferred to Phase 13.

**Consequences.**

- `PATCH` gains two `400`s and shares one `409` with `DELETE`. Status codes are inherited, not invented: `badRequest` matches `admin.routes.ts:438`'s existing self-refusal, `conflict` matches `:450`'s existing message, and the message string is byte-identical so no client parsing changes.
- `DELETE` is **behaviour-preserving on every case it already handled** — self-delete 400, last active Super Admin 409, ordinary user 204, one-of-two 204 — and all four are now covered by tests for the first time. Its one behaviour *change* is the 2.2 fix: an already-inactive Super Admin is 204 where it was 409.
- `targetUserRole()` now also selects `users.status`. Additive; both routes read it, neither reads the user row twice.
- **No authorization function was touched.** `assertCanManageRoleLevel` and `assertCanAssignRole` are byte-identical; the new rule sits beside them, and `authorization.test.ts` (26 tests) still passes unchanged. Zero role-name string comparisons were introduced — the population is `is_system`, a column, and the two role names that appear do so only in user-facing message text, as `:450`'s already did.
- **Found and deliberately not fixed:** `userInput.partial()` does not suppress `.default("Active")` in zod 4.4.3, so a name-only PATCH silently reactivates a deactivated account and zeroes `target`/`achieved` (**BUG-036**, HIGH). It does not weaken this fix — the injected default is the *safe* direction and both guards compare against the stored value — and that was verified rather than assumed. One test echoes `status` explicitly with a comment, so the suite does not quietly depend on the defect.

---

## D-021 · 2026-09-02 · ACCEPTED — A malformed `:id` is rejected in the handler, not mapped in the error handler

**Context.** Roadmap Task 1.9 proposed two remedies for BUG-017: *"navigate by id; validate the param"*, and the bug register additionally suggested *"map Postgres `22P02` to a `400`/`404` in the error handler so a malformed identifier never produces a 500."* Investigation measured that the second one is the wrong tool, and that a third option — a `router.param()` hook — is worse than either.

**Decision.** Parse `z.object({ id: z.string().uuid() })` **inside** each of the three customer handlers, after `requirePermission` has run. `middleware/error-handler.ts` is not touched.

| Rejected option | Why, measured |
|---|---|
| **Map `22P02` centrally** | `22P02` is `invalid_text_representation`, not "bad uuid" — measured firing on integer, numeric, boolean and json input as well. Decisively: `services/access.ts:48` puts the JWT `sub` into `eq(users.id, …)` on **every** request, so a token minted with a non-uuid subject 22P02s on 100% of traffic. Measured: that returns 500 today. Mapping the code globally would convert a total outage into a polite 4xx that `error-handler.ts:58` does not even log, because it only logs at `error` for status ≥ 500. `tests/cors.test.ts:211-213` already carries the opposite commitment in writing: *"Task 1.6 must not turn unknown failures into 4xx."* |
| **A `router.param()` hook** | Measured: `router.param` runs **before** the per-route `requirePermission`. It would turn today's 403 into a 422 for callers who lack `customers.view`, changing authorization precedence across the API in the last task of the authentication-integrity phase. It also binds by parameter *name*, so it silently no-ops on `importsRouter`'s `:batchId`. |
| **Accept `code` as a second identifier** (`or(eq(id), eq(code))`, as the demo does) | Promotes a display string to a public API identifier, doubles the lookup surface on every request, and adds a permanent branch to fix a link. The demo does it for fixture continuity, not as a contract. |

**Status is 422 `validation_failed`, and that is inherited rather than invented.** `error-handler.ts:46-55` already turns any `ZodError` into that shape, and a bad uuid in a zod-guarded field already returns exactly it — `GET /api/customers?bankId=not-a-uuid` → `422 details:[{path:"bankId",message:"Invalid UUID"}]`. The path segment was the only uuid in this module not validated (`:25`, `:64`, `:65`, `:73`, `:300` all are). Not 400: `badRequest` is used 15 times and every one is a well-formed-but-semantically-wrong business rule. Not 404: it would be a lie, and it would conflate "you typed garbage" with the deliberate missing-vs-out-of-scope collapse at `:158-159`.

**The object form is load-bearing.** `z.object({ id })` reports `path: "id"`; a bare `z.string().uuid()` reports `path: ""`. The tests assert the path, and `/check/reference`'s reachability test distinguishes itself from a shadowed route purely by whether the failing path is `bankId`/`bankReferenceId` or `id`.

**Accepted narrowing, taken deliberately.** Postgres accepts four uuid spellings; all four returned **200** before this change (measured: canonical, uppercase, unhyphenated `054bfa18ca47…`, brace-wrapped `{054bfa18-…}`). zod 4.4.3 accepts only the first two, so the last two now return 422. Nothing emits them — all 17 customer-href sites in `frontend/src` use `id`/`customerId` straight from this API, which returns the canonical form. A bespoke Postgres-equivalent regex was rejected: it would diverge from the 15+ existing `z.string().uuid()` sites to accommodate a spelling no client produces.

**Consequences.**

- Fixed: the three customer routes. **Not** fixed, and not claimed: the other 45 parameterised endpoints (BUG-017, Phase 8) and the `filterable` query loop (**BUG-035**). Both are recorded as open.
- No leak. Every value in a `uuid` column is uuid-parseable by definition, so "this is not a uuid" is computable from the caller's own input and carries no existence information. The 404/403 indistinguishability contract at `lib/errors.ts:21-25` is unaffected — verified: an absent uuid still returns `404 "Customer not found"`.
- `customer-lookup.test.ts` group F destroys the `customers` table and asserts a real fault still yields 500 with one `logger.error`. It fails if anyone later ships the central `22P02` mapping.

---

## D-020 · 2026-09-02 · ACCEPTED — Only two dedicated error codes end a session; 403 alone never does

**Context.** Roadmap Task 1.8 asked to *"handle 403 deactivation on the client"*. Investigation showed that a client cannot act on 403 at all: every 403 in the API carried `code: "forbidden"` — a deactivated account, a missing permission, an out-of-scope record, a hierarchy refusal, and the demo layer's fabricated refusals were indistinguishable except by their human-readable message (**BUG-034**).

**Decision.** Add two codes for the **session gates only** — `account_inactive` and `role_disabled`, raised by `services/access.ts` — and have `apiRequest` sign out on those and nothing else.

| Choice | Why, and what was rejected |
|---|---|
| **Keep status 403** | The caller *is* authenticated; 403 is correct. Switching to 401 would have reused the existing ladder with no frontend change at all, but it invites re-authentication — which also fails for a deactivated account — and would spend a wasted refresh round trip on every request. |
| **Codes, not messages** | Message matching is fragile and the messages are user-facing prose. The task forbade it, and rightly. |
| **Only the two session gates** | They fire on *every* request regardless of what was asked for, which is exactly what makes them safe to generalise from. A permission refusal is per-route and says nothing about the session. |
| **Gate on `getAccessToken()`** | It gates on there being a session to end at all: `forceSignOut()` clears the token and redirects, which is meaningless on the login screen. **Corrected 2026-09-02 (Phase 1 final review):** this row previously read *"`POST /auth/login` against a deactivated account returns the same code"* — **measurably false.** `auth.routes.ts:131-132` returns plain `forbidden`, as the Consequences section below already said; the two halves of this decision contradicted each other. The guard is therefore defence in depth, not a live case, and is retained so that changing login to the specific codes cannot silently start bouncing the login page. |
| **Reuse `forceSignOut()`** | It already clears demo mode and redirects via the Task 1.1 listener. A second logout path would drift. |

**Demo safety has two independent guarantees, and one is stronger than the other.** The allow-list excludes `forbidden`, which is what the demo fabricates. But the demo is protected more fundamentally than that: `apiRequest` short-circuits to `demoRequest` *before* the response-handling branch exists, so a demo error never reaches the sign-out check at all. **The demo test therefore proves the demo keeps working, but would not catch an over-broad rule** — that is what the `forbidden`-stays-signed-in test is for. Recorded so nobody mistakes the demo test for the guard it is not.

**Consequences.**

- A deactivated or role-disabled user is signed out on their **next request** instead of up to `ACCESS_TOKEN_TTL` later.
- Ordinary 403s are untouched — asserted by backend tests on permission, bank-scope and hierarchy refusals, and by a frontend test that fails if the rule is widened to any 403.
- The 401 refresh ladder is untouched and still ends the session when refresh fails; the new codes shorten the window rather than replacing that path.
- **`auth.routes.ts:131-132` (login) still raises `forbidden`** for an inactive account. Left alone deliberately: it is a different flow with no session, the frontend ignores it, and changing it would be churn. Worth revisiting only if the login screen ever wants to distinguish the reason.

---

## D-019 · 2026-09-02 · ACCEPTED — `NODE_ENV` is a required declaration; production is never inferred

**Context.** Roadmap Task 1.7 asked to *"assert at boot that `NODE_ENV=production` implies `secure`+`sameSite=none`"*. Investigation showed that assertion is a **tautology**: `refreshCookieOptions()` computes both flags from the single expression `config.NODE_ENV === "production"`, in one function, with no other input. Nothing can falsify it.

**Demonstrated, not argued.** With the defective `.default("development")` restored, the cookie-attribute assertions **pass 5/5** while the two tests that actually carry the security claim fail. An assertion that passes against the broken implementation is not a security control. This project has already written and deleted two such tests (BUG-031's settings guard, Task 1.4's `Function.length` arity check); a third would have been a regression in discipline.

**The real defect** was that `NODE_ENV` defaulted to `development` while **nothing in the repository sets it** — no Dockerfile, `railway.*`, `nixpacks.*`, `Procfile`, CI or `vercel.json`, and `npm start` is a bare `node dist/server.js`. A production deploy that forgot the variable booted as development and shipped `Secure=false; SameSite=Lax` refresh cookies (**SEC-028**).

**Decision.** Remove `.default("development")` from the schema. `NODE_ENV` must be declared. Nothing else changes; `lib/tokens.ts` is untouched.

**Alternatives rejected.**

| Option | Why not |
|---|---|
| **Assert prod ⇒ secure**, as written | Tautological. Proven to pass against the defect. |
| **Infer production** from an `https` `CORS_ORIGIN` and refuse to boot | Catches one extra case — a deploy that sets `development` deliberately — but introduces a false positive: a developer testing against a deployed https frontend would be refused a boot. Availability cost for a narrow gain, and it makes the config depend on unrelated variables. **Not adopted**; recorded here so the option is not re-derived. |
| **Infer from `DATABASE_URL` not being localhost** | Would break the documented local workflow outright — `README.md` tells developers to point local dev at Neon. (`db/index.ts:24` does infer SSL this way, so the precedent exists; it is simply the wrong signal for this purpose.) |
| **Add a new `APP_ENV` / production-mode variable** | Inventing a second source of truth for the thing `NODE_ENV` already means. No evidence the project needs one. |
| **Derive the cookie flags from deployment topology instead of `NODE_ENV`** | Changes authentication-cookie behaviour itself — the riskiest option for the smallest benefit. |

**Why requiring the declaration is the right shape.** It infers nothing, so it cannot produce a false positive; it fails closed at the existing config-validation site rather than adding a new mechanism; and it costs the documented workflow nothing — `.env.example` already ships `NODE_ENV=development`, `README.md` already instructs `cp .env.example .env`, and `tests/setup.ts:5` sets it explicitly.

**Consequences.**

- **A runtime that does not declare `NODE_ENV` no longer starts.** That is the point, and it is a real operational change: any deployment relying on the old default will fail loudly on its next boot, with a message naming the variable and explaining why.
- The pre-existing production guards (`AADHAAR_PEPPER`, identical JWT secrets) are untouched and are asserted to still fire.
- The cookie-attribute tests are kept, but **relabelled honestly** as a contract lock on the `NODE_ENV → cookie` mapping — they would catch an edit to `tokens.ts` and they prove nothing about misconfiguration.
- It **narrows SEC-007** — whose abuse scenario is a container platform with `NODE_ENV` unset — without closing it: `NODE_ENV=development` set deliberately still bypasses the pepper guard.
- **Still open:** `COOKIE_DOMAIN` cannot be validated against the API host, because no authoritative API-host value exists in the schema. Dropping the roadmap's second clause is deliberate, not an oversight.

---

## D-018 · 2026-09-02 · ACCEPTED — A refused CORS origin is a typed 403 logged at the rejection site, and is still refused before the route runs

**Context.** [BUG-022](BUGS_AND_ISSUES.md) / [SEC-018](SECURITY_AUDIT.md): a disallowed `Origin` produced **HTTP 500** with an error-level log carrying a full stack trace and absolute filesystem paths. A configuration mistake looked like a crash, and any unauthenticated caller could drive error-level logging at will.

**Root cause, in one line.** The origin callback rejected with a bare `Error`. `middleware/error-handler.ts` classifies `ZodError`, `AppError` and Postgres codes; anything else falls to the terminal 500 branch. The error was simply untyped.

**Decision.** Reject with `new AppError(403, "cors_origin_denied", "Origin is not permitted")` and `logger.warn({ origin }, …)` **in the callback**. Four choices inside that, each deliberate:

| Choice | Why, and what was rejected |
|---|---|
| **Keep rejecting before the route** | The documented-looking alternative, `callback(null, false)`, makes `cors@2` call `next(undefined)`: the request proceeds without CORS headers and **the handler executes**. With the refresh cookie at `SameSite=None` in production (`lib/tokens.ts:82`), a hostile page could then rotate a victim's refresh token and merely be unable to read the reply. **Rejected outright.** |
| **Log at the rejection site, not in `errorHandler`** | The handler cannot see the origin, and giving it a 4xx branch would change logging for **every** 401, 403 and 404 in the API. The blast radius is the whole product; the callback's is one line. |
| **A distinct code, `cors_origin_denied`** | Not the existing `forbidden()` helper. A transport-level refusal and an authorization refusal are different events and should be separable in logs and alerting. |
| **Do not reflect the origin into the response** | It is attacker-controlled. It belongs in the log, where operators need it, and nowhere else. The previous message interpolated it. |

**Preflight came along for free, and was never recorded as broken.** `cors@2` forwards whatever the callback passes to `next()` *before* reaching its own preflight branch (`node_modules/cors/lib/index.js:218-224`), so a disallowed `OPTIONS` returned 500 as well. Neither the roadmap, BUG-022 nor SEC-018 mentioned it. It returns 403 now, and a test pins it.

**Consequences.**

- Generic error handling is **untouched** — an unrecognised error still returns 500 and still logs at `error`, and a sub-500 `AppError` still logs nothing. Both are asserted directly, so the fix cannot be mistaken for a softening of the default.
- The refusal is now cheap to monitor: one `warn` per rejected origin, with the origin, and no stack.
- **Known limitation, deliberately not fixed here:** the rejection log carries **no `requestId`**. It is assigned at `app.ts:65`, *after* the CORS middleware, and `pino-http` is mounted later still — so CORS refusals are uncorrelatable and never appear in the request log. Fixing it means moving global middleware above `cors`, which affects every request in the application and is not what a status-code task should carry. **Recorded as follow-up work.**
- The tests need no database — `createApp()` opens no connection and CORS is refused before any route — so they run in ~80 ms and a pass cannot be explained by fixture setup.

---

## D-017 · 2026-09-02 · ACCEPTED — Demo exclusion is enforced in three layers, because configuring each bundler is not enough

**Context.** [SEC-027](SECURITY_AUDIT.md): Task 1.3 excluded the demo with `turbopack.resolveAlias`, a key only Turbopack reads. `next build --webpack` ignored it and shipped the credential and every fabricated customer record to the public bundle — while the build printed `EXCLUDED`. The obvious fix is "add the webpack alias too". **That fix does not work**, and this decision records why, so nobody re-derives it painfully.

**What the obvious fix misses.** Next registers `JsConfigPathsPlugin` in webpack's `resolve.plugins` to implement `tsconfig` `paths`. It resolves `@/lib/demo` to the real directory **before** `resolve.alias` is consulted. An alias-only fix therefore compiles cleanly, prints `EXCLUDED`, and still ships the demo. This was not reasoned out in advance — it was caught by layer 2 below, which failed the build, and then confirmed by instrumenting the webpack hook and printing `config.resolve.plugins`.

**Decision. Three layers, each covering what the one before it cannot.**

| Layer | What it is | What it catches |
|---|---|---|
| **1 · Per-bundler exclusion** | `turbopack.resolveAlias` for Turbopack; **`NormalModuleReplacementPlugin`** for webpack, which rewrites the *request* before resolution begins, so no resolve plugin can win the race. `resolve.alias` is kept beside it for requests that never reach the paths plugin. | The known bundlers, correctly |
| **2 · A tripwire inside the demo module** | `lib/demo/config.ts` throws when `NODE_ENV === "production"` and the demo is not explicitly enabled. `next build` prerenders every page on the server, so it fires during static generation and **fails the build**. | *Any* bundler, present or future, plus deep imports of `@/lib/demo/*` that the exact-match alias cannot see. Every other file in that directory imports `config.ts`, so nothing there can be bundled without it |
| **3 · A build-output check** | `npm run verify:demo-exclusion` builds on **both** bundlers into clean output and searches the result | The whole property, empirically, on demand and in CI |

**Why layer 2 is the important one.** Layers 1 and 3 both enumerate: layer 1 enumerates bundlers, layer 3 enumerates builds to run. Layer 2 does not enumerate anything — it is a property of the module itself, so it holds for a bundler Next has not shipped yet and for an import path nobody has written yet. It converts a silent leak into a hard, loud build failure. It is also what caught the `JsConfigPathsPlugin` problem in the first place.

**Why layer 3 exists at all, given 1 and 2.** Because unit tests provably cannot cover this class of defect, and that was **demonstrated, not assumed**: with the replacement plugin removed and only the alias left — the plausible wrong fix — `npm test` passes **46/46** while `npm run verify:demo-exclusion` fails. Anything that only inspects source or config will miss a resolution-order bug. The property is about build *output*, so only a build can check it.

**On the verification script's search terms.** They are derived at run time from the source — every string literal exclusive to `src/lib/demo/` — not hand-picked, because hand-picked terms only prove the terms you thought of. Two precision filters keep it usable: candidates containing code punctuation are dropped (the regex is not a JS tokenizer and produced fragments like `")[0].split("`), and candidates must look like *data* — a capital, digit, space or `@` — which excludes bare lowercase identifiers such as `"forbidden"`, a word the demo happens to own in our source and Next's App Router also ships. The credential, demo email and both storage keys are named explicitly and searched unconditionally, so the filter can never hide them.

**The script also builds with the demo ENABLED and asserts it is present.** Without that, a build that silently stopped emitting client JavaScript would pass the two exclusion checks and the script would report success while proving nothing.

**Consequences.**

- A demo-disabled production build **cannot** contain the demo on any bundler: if the exclusion fails, the build fails. That is a stronger guarantee than Task 1.3 ever had.
- **SEC-001's closure is no longer bundler-conditional**, and the condition added to it on 2026-09-02 is withdrawn.
- The banner now reports the bundler and the mechanism actually applied, not the flag it was configured with — that is BUG-033.
- `npm run verify:demo-exclusion` costs three production builds (~40 s). It is deliberately **not** in `npm test`: the unit suite must stay fast, and this belongs in CI next to the build, not in the inner loop. **Phase 15 must wire it into CI** — until then it is a command someone has to run, which is weaker than it should be and is recorded as such.
- The tripwire adds a hard failure mode to a file that previously had none. If it ever fires unexpectedly, the answer is never to soften it — it is reporting a real leak.

---

## D-016 · 2026-09-02 · ACCEPTED — Roadmap Task 1.5 is **SUPERSEDED**: its remedy is unachievable and its objective was met by Task 1.3

**Context.** Phase 1 Task 1.5 reads, verbatim: *"Move the demo credential out of a source literal into the demo-only env-gated config so it is never a constant in shipped JS."* It was written when `DEMO_PASSWORD` was compiled into the bundle every visitor downloaded. This decision records why it is closed without being implemented.

**Decision. Closed as SUPERSEDED — not implemented, not deferred.** Three independent reasons, each sufficient on its own.

**1. The prescribed mechanism cannot achieve the stated goal. Proven, not argued.** Next inlines `NEXT_PUBLIC_*` values into client JavaScript at build time, so a `NEXT_PUBLIC_DEMO_PASSWORD` would be a string literal in the bundle exactly as the source constant is. Verified by building with a sentinel:

```
$ NEXT_PUBLIC_ENABLE_DEMO=true NEXT_PUBLIC_API_URL="https://inlining-probe-9f2c1d40.example" npm run build
$ grep -r "inlining-probe-9f2c1d40" .next/static
  let y="https://inlining-probe-9f2c1d40.example".replace(/\/$/,"")
```

The value moves from one literal to another. *"Never a constant in shipped JS"* is unreachable this way. Three reviewers reproduced this independently with their own sentinels.

**2. A non-public variable cannot work either.** `isDemoCredentials()` runs **in the browser**, inside `signIn`, before any request is built (`lib/demo/config.ts:82`, `use-auth.tsx:199`). A server-only variable is not available there. Reaching one would require a network round trip, breaking the demo's defining property — that it works with the CRM backend stopped ([RULES.md](claude/RULES.md) §3). *(A reviewer correctly noted the Next server is not the CRM backend, so a Next route handler could technically serve the value locally. It is still rejected: it relocates a string that README.md publishes on purpose, for no gain.)*

**3. The credential is not a gate, so moving it protects nothing.** Entering demo mode never required the password. `sessionStorage.setItem("risenext.demo.session", "active")` alone produces a full demo Executive session — asserted by an existing test (`use-auth.demo-boundary.test.tsx` group G) and by this document's own SEC-001 impact analysis: *"No password is required."* In a demo-enabled build the credential guards nothing; in a production build neither entry path exists.

**And the objective is already met where it matters.** A default `npm run build` excludes the whole demo module ([D-014](#d-014--2026-09-01--accepted--the-demo-is-removed-from-production-builds-by-bundler-module-replacement-not-by-a-runtime-flag)). Verified with no environment variables set: the credential, the demo email, `DEMO_PASSWORD`, the persona and every fabricated customer are absent from `.next/static`, and of 254 string literals exclusive to `src/lib/demo/`, **zero** appear in any of the 46 client assets.

**Alternatives rejected.** *Implement as written* — cannot work (reason 1). *Re-scope to per-engagement credential rotation* — a real operational convenience, but not a security objective and not what the task says; if wanted, raise it as new work rather than smuggling it in under a security task. *Hash the credential in source* — security theatre against a format-known value that [D-011](#d-011--2026-09-01--accepted--the-demo-credential-is-documented-in-readmemd) deliberately publishes, and it would license a false claim in an audit that prides itself on executed evidence.

**Consequences, stated honestly.**

- **This is "superseded", not "implemented".** The demo credential remains a plaintext literal at `frontend/src/lib/demo/config.ts:15`. That is accepted: it is fictional, authenticates nothing on the server, and is published in `README.md` by decision D-011.
- **The closure rationale is bundler-conditional, and that condition was found during this review.** *"In a production build there is no demo module at all"* is true of the default Turbopack build and **false** of `next build --webpack`, which ships the credential and all fixture PII while printing `EXCLUDED`. Filed as **SEC-027** (HIGH) against Task 1.3 / D-014 — **not** against 1.5, because 1.5's remedy would not have fixed it: in a webpack build the module resolves, so an env-sourced credential would be inlined anyway, and the 838 lines of fabricated PII — the larger exposure — were never in 1.5's scope at all.
- **A gap this closure must not bury:** the property SEC-001 was closed on has **no automated guard**. It was searched once, by hand. Phase 1's own test list asked for it *"in CI-runnable form, not by eye"* and that was never built. Now owned by **roadmap Task 1.10**, alongside SEC-027.
- **SEC-001 remediation #2** — *remove the credential unconditionally and seed a real demo user* — remains unadopted, by D-002. It is a stronger, different remedy than 1.5 and is now recorded explicitly under SEC-001 so closing 1.5 does not leave it ownerless.

---

## D-015 · 2026-09-02 · ACCEPTED — Demo mode is signalled on three surfaces, none of them the sidebar alone

**Context.** Task 1.4 asked for *"a persistent, unmissable banner whenever the flag is set — not the current small sidebar caption that disappears when the sidebar collapses."* The named defect was real: the caption lived inside the sidebar footer card's `{!collapsed && …}` wrapper (`sidebar.tsx:118`), so collapsing the sidebar, or being on mobile with the drawer shut, removed the only sign that the data was invented. Its wording — *"Preview workspace · sample data"* — did not say the data was fabricated either.

**Decision.** One component file, `components/layout/demo-mode-indicator.tsx`, rendered on **three** surfaces:

| Surface | Where | The failure it covers |
|---|---|---|
| `DemoModeBanner` | `AppShell`, above the topbar, **outside the sidebar subtree** | Sidebar collapse, and every route change — `AppShell` wraps all `(app)` routes |
| `DemoModeBadge` | inside `Topbar`, which is `sticky top-0` | **Scrolling.** The banner is at the top of the page; a long customer table scrolls it away |
| sidebar marker | `sidebar.tsx`, lifted **out** of the `!collapsed` wrapper | The original defect. It now shrinks to its icon, with an `sr-only` label and a `title`, rather than unmounting |

**Why three and not the one banner the roadmap asked for.** The banner alone satisfies the four conditions the task listed — collapse, navigation, page change, refresh — but not scrolling, which the task did not list and which is the commonest way a presenter actually loses sight of the top of the page. The badge costs one line in the topbar and closes it. The sidebar marker was kept because the task named it explicitly: *"Fix that."* Deleting it would have been a defensible reading, but leaving the sidebar with no demo signal at all while the card beside it still says "Signed in as Executive" would be a worse one.

**Neither component accepts a prop that could suppress it** — only an optional `className`. That is the point: the defect being fixed was a visibility signal wired to unrelated layout state, and a `collapsed` or `hidden` prop would reintroduce exactly that failure mode one caller at a time. **Proved by mutation:** the tests render each component with `collapsed`, `hidden`, `visible` and `disabled` spread on and assert the indicator survives; reintroducing a `collapsed` prop that the component honours fails both.

> *A first version of that guard asserted `DemoModeBanner.length === 1`, on the theory that "one parameter" meant "only `className`". It did not. `Function.prototype.length` counts formal parameters, not destructured properties, so `({ className, collapsed, hidden })` also has length 1 — the assertion passed with the defect reintroduced, and would have **failed** had the component been hardened to take no props. Vacuous and inverted. Caught by adversarial review before this work was committed and replaced with the render assertions above, the same call made for BUG-031.*

**On testing — the useful discovery.** `NEXT_TASK.md` had assumed this needed React Testing Library and flagged it as a decision to make. It does not. **The whole `AppShell` mounts under the existing vitest + jsdom setup**, with `ThemeProvider` + `AuthProvider` and a `next/navigation` mock, using `react-dom/client` and React 19's native `act` — the same approach [D-012](#d-012--2026-09-01--accepted--frontend-tests-use-vitest--jsdom-only-with-no-component-testing-library) already chose. So the test enters a real demo session, **clicks the actual collapse button**, confirms the sidebar collapsed, and only then asserts the indicators survive. **D-012 stands, and its scope is wider than it looked** — full-shell rendering is available without a component library. Radix and framer-motion need a `ResizeObserver` stub and nothing else.

**Consequences.**

- The demo is now labelled on every `(app)` route, in both sidebar states, at every scroll position, and after a refresh — the flag is read fresh on each render, so nothing is threaded through props or state.
- **The indicator's UI copy ships in the production bundle** even though it can never render there, because `isDemoMode()` is an imported call the minifier cannot prove constant. It is UI text, not fixture data and not a credential; SEC-001's evidence is unaffected (254 demo-exclusive literals, 0 in `.next/static`, re-verified after this change). Recorded as **BUG-032**, not fixed — gating it would mean adding exports to `demo-disabled.ts`, enlarging the surface [D-014](#d-014--2026-09-01--accepted--the-demo-is-removed-from-production-builds-by-bundler-module-replacement-not-by-a-runtime-flag) has to keep in lockstep, for no security gain.
- `isDemoMode()` is read as a plain render expression, not reactive state — the same pattern `AppShell` and `Sidebar` already used. A flag planted by devtools **mid-render** will not surface an indicator until the next render. Accepted: entering the demo always navigates, and the alternative is threading the flag through context, which is the coupling this decision exists to avoid.

---

## D-014 · 2026-09-01 · ACCEPTED — The demo is removed from production builds by bundler module replacement, not by a runtime flag

**Context.** Task 1.3 had to make the demo module absent from production builds while keeping it fully working for client presentations. The roadmap suggested two routes: wrap every use in `if (process.env.NEXT_PUBLIC_ENABLE_DEMO === "true")` and rely on dead-code elimination, or switch to a lazy dynamic `import()`.

**Both were rejected, for the same reason.** Neither *guarantees* absence.

| Rejected approach | Why not |
|---|---|
| **Runtime `if (flag)` + tree-shaking** | The import stays at module scope, so the module is still in the graph. Whether the 838 lines of fixture data actually disappear then depends on the minifier's dead-code analysis and on webpack/Turbopack side-effect inference. The user's requirement was that *"the production bundler must be able to statically determine that the demo module is unavailable"* — a minifier heuristic is not a static determination. It might well have worked; it could not have been **promised**. |
| **Lazy `import()`** | `apiRequest` decides synchronously whether to divert, and `isDemoMode()` is called synchronously from five other modules (`use-auth`, `app-shell`, `sidebar`, `login/page`, and `settings/page` since Task 1.2). Making the decision async would change `apiRequest`'s shape and ripple through the app — a large change to a security-critical chokepoint, for no gain over the option below. |
| **A separate demo entry point / route group** | Duplicates routing for a presentation aid. Rejected as disproportionate. |

**Decision.** Replace the module at **resolve time**. `frontend/next.config.ts` reads `NEXT_PUBLIC_ENABLE_DEMO`, and when the demo is off it sets `turbopack.resolveAlias` so `@/lib/demo` resolves to `frontend/src/lib/demo-disabled.ts` — an inert module with the same 13 exports and no data. `src/lib/demo/` is then never resolved, never parsed, and never enters the module graph.

Two supporting changes make the switch airtight:

1. **`lib/api.ts` now imports through the barrel.** It previously deep-imported `@/lib/demo/api` and `@/lib/demo/session`, which would have reached straight past the alias. `@/lib/demo` is now the single specifier the whole application uses — which is what `lib/demo/index.ts`'s own header always asked for.
2. **The default is exclusion.** With the variable unset the build follows `NODE_ENV`: `next dev` includes the demo, `next build` excludes it. A deploy pipeline gets the safe variant without anyone remembering a flag; including the demo in a build is an explicit act. Every build prints which variant it produced.

**Why `NEXT_PUBLIC_`, given it is only read at build time in Node.** The prefix is not needed — no client code reads the variable — but it is kept because the value ("true"/"false") is deliberately non-secret, the prefix says so at a glance, and it matches the name the roadmap already published. No secret is exposed by it.

**Consequences.**

- The demo credential and every fixture are **absent** from a default production build. Verified against the built output rather than the source: of 256 string literals exclusive to `src/lib/demo/`, **zero** appear in `.next/static`. This is what closes **SEC-001**.
- `isDemoMode()` becomes a compile-time `false`, so planting `sessionStorage["risenext.demo.session"] = "active"` on a deployed site does nothing — there is no fixture layer left for it to reach.
- **A demo-enabled build still ships everything**, by design. `NEXT_PUBLIC_ENABLE_DEMO=true` must never be set on a real deployment; a demo build is for a client-facing preview only. This is now the single operational rule that keeps SEC-001 closed.
- **A new drift risk is accepted and guarded.** `tsc` resolves `@/lib/demo` through `tsconfig.json` paths, so consumers are always type-checked against the *real* module and never against the substitute — the swapped build's types are not checked anywhere by default. Three guards compensate: every export in `demo-disabled.ts` is typed `typeof DemoEnabled.<name>`, so a signature cannot drift; a `Substitute` assignment at the foot of the file fails `npm run typecheck` on a missing or spare export; and a runtime test asserts key-for-key parity. All three were confirmed to fire — the type assertion caught a real `phone: null` / `phone: string` mismatch while the file was being written, and injecting a spare export into the real module fails the parity test.
- The alias is Turbopack-specific (`turbopack.resolveAlias`). Next 16 builds with Turbopack by default and this repository uses the default; a future move to `next build --webpack` would need the equivalent `resolve.alias` entry. Recorded rather than pre-solved, so no unused webpack config sits in the file emitting Next's "Webpack is configured while Turbopack is not" warning.

> ### ⚠️ **CORRECTION, 2026-09-02 — this consequence was understated.**
>
> The sentence above frames the webpack path as *"a future move"*. It is not future: `--webpack` is a **documented flag of the installed Next 16.2.12** (`npx next build --help`), needs no source change, and **silently reopens SEC-001's exposure half today** — credential, persona and all fabricated PII back in the public client chunk. Worse, the build prints `demo module: EXCLUDED` four times while doing it, because the banner reports what was *configured*, not what the bundler *did*.
>
> "Recorded rather than pre-solved" was the wrong call for a gap that reopens a CRITICAL finding with one flag and no warning. Filed as **[SEC-027](SECURITY_AUDIT.md)** (HIGH, OPEN), owned by roadmap Task **1.10**. The decision to use resolve-time module replacement stands — it is still the right mechanism; what was missing is that it must be enforced on **every** bundler, and verified by something other than a one-time manual grep.

---

## D-013 · 2026-09-01 · ACCEPTED — The demo may answer exactly one auth path, chosen by allow-list

**Context.** Task 1.2 had to stop the demo layer answering real authentication requests. The roadmap recommended a **deny-list**: exclude `/auth/login` and `/auth/change-password` from the `apiRequest` short-circuit. Code inspection showed that recommendation is safe but weaker than necessary.

**What the inspection found.** Of the three `/auth/*` paths the demo has handlers for, only one is reachable while the demo is active:

| Path | Demo handler | Reachable in demo? | Evidence |
|---|---|---|---|
| `/auth/refresh` | returns `DEMO_SESSION_USER` | **Yes — this IS demo session restoration across a reload** | `use-auth.tsx:139` |
| `/auth/logout` | returns `{data:null}` | **No** — `signOut`'s demo branch returns at `use-auth.tsx:257`, before the call at `:261` | dead handler |
| `/auth/me` | returns `DEMO_SESSION_USER` | **No** — zero call sites in `frontend/src` | dead handler |
| `/auth/login` | **none** — throws `notFound` | Yes → this was BUG-001's symptom | must be real |
| `/auth/change-password` | **none** — throws | Yes → same failure | must be real |

**Decision.** Invert the roadmap's recommendation into an **allow-list**: `DEMO_SERVED_AUTH_PATHS = {"/auth/refresh"}`, and `requiresRealBackend(path)` returns true for every other `/auth/*` path. Same amount of code; strictly stronger.

**Why, over the deny-list.** It **fails closed**. Roadmap Phase 3 adds `/auth/forgot-password`, `/auth/reset-password` and `/auth/accept-invite` — all of which must reach a real server. Under a deny-list each would be silently demo-answerable until someone remembered to add it; under the allow-list each is protected the moment it exists. Given the defect being fixed is *precisely* "an auth request was silently answered by fixtures", the default must be deny.

**Why `/auth/refresh` stays with the demo.** It is the sole mechanism by which a demo session survives a page reload. Excluding it would end the demo on every refresh — a real regression in a feature [claude/RULES.md](claude/RULES.md) §3 requires preserving. The exception is narrow, deliberate and tested.

**Consequences.** `/auth/logout` and `/auth/me` now route to the network in demo mode. Verified to change no behaviour: neither is called while the demo is active, and their demo handlers were already dead code — left in place rather than deleted, since removing them is unrelated to this task. A demo user who tries the settings password change now gets a real 401 instead of *"Endpoint not found"*; both callers set `skipAuthRetry: true`, so no `forceSignOut` fires and the demo session survives. **This did not close SEC-001** — the demo password and fixtures still shipped in the production bundle. **Task 1.3 closed it**, by removing the module from the build entirely ([D-014](#d-014--2026-09-01--accepted--the-demo-is-removed-from-production-builds-by-bundler-module-replacement-not-by-a-runtime-flag)). This allow-list still matters after that change: it is what protects a **demo-enabled** build, and it is the layer that keeps working if the demo module is ever reintroduced somewhere new.

---

## D-012 · 2026-09-01 · ACCEPTED — Frontend tests use vitest + jsdom only, with no component-testing library

**Context.** Task 1.1 needed the repository's first frontend test, to lock down BUG-001 permanently. Nothing test-related was installed in `frontend/`.

**Decision.** Add exactly **two** dev dependencies — `vitest@^3.2.4` and `jsdom` — plus `frontend/vitest.config.ts` and a three-line `src/test-setup.ts`. **No React Testing Library.**

**Why.** `vitest` matches the version the backend already uses, so there is one test runner and one mental model across the repo. React 19 exports `act` directly, and `react-dom/client` is already a production dependency, so a provider can be mounted and driven in ~25 lines of helper without `@testing-library/react` + `@testing-library/dom` + `@vitejs/plugin-react`. That is 2 packages instead of 5 for the same capability at this scope.

**Alternatives rejected.** *React Testing Library* — the standard choice and the right one once component/DOM-interaction tests arrive, but unnecessary weight for a test of an auth-state boundary that renders nothing. *Pure unit tests with no DOM* — could not exercise `signIn`, which is where the ordering bug lives; it would have tested around the defect rather than at it.

**Consequences.** `frontend/package.json` gains `test` and `test:watch`. `tsconfig.json` sets `jsx: "preserve"` for Next, which esbuild passes through untransformed, so `vitest.config.ts` selects the automatic JSX runtime and re-declares the `@/*` path alias. **Revisit when the first test needs to click a button or assert on rendered output** — at that point add React Testing Library rather than hand-rolling queries.

---

## D-011 · 2026-09-01 · ACCEPTED — The demo credential is documented in `README.md`

**Context.** Task 0.7 required documenting demo mode. That raised a question: should the credential itself appear in the README? An earlier draft of `NEXT_TASK.md` recommended against it and pointed readers at `frontend/src/lib/demo/config.ts` instead. The user reviewed that and directed that the credential be documented, clearly labelled as a demo credential.

**Decision.** Document it in `README.md` under a **Demo mode — client presentations only** heading, with the credential in a table explicitly labelled as fictional.

**Why this is acceptable.** It is not a secret in any meaningful sense: it is a module-scope constant compiled into the **public production JavaScript bundle** (SEC-001), so it is already readable by anyone who loads the login page. It authenticates nothing — the match happens in the browser, no token is issued, and the backend rejects the address like any unknown login (asserted by `employee-lifecycle.test.ts`). Documenting it adds no exposure and removes a real friction: the team could not otherwise find how to run the demo.

**Alternatives rejected.** *Point at the source file* — obscures a credential that is already public and makes the demo harder to use for its actual purpose. *Omit demo mode entirely* — the far worse option; the undocumented demo is the confirmed cause of BUG-001.

**Consequences.** The README section must be updated when **Task 1.3** lands: once the demo module is removed from production builds, the credential will no longer work there, and a README that still presents it as usable would become misleading. A reminder to that effect is written into the section itself.

> **Discharged 2026-09-01 by Task 1.3.** The README's Demo mode section now carries a callout stating that the credential works **only in a build that includes the demo**, a table of exactly which build commands include it, and an explanation of why the production build is safe. The *"⚠️ Known defect — demo mode is currently sticky"* subsection was replaced with a record of the three tasks that fixed it.
>
> The reasoning above is otherwise **unchanged but no longer for the reason given**: the credential is no longer public because it ships in the bundle — it does not ship any more. It stays documented because it authenticates nothing on the server, and because the team needs to know how to run a presentation.

---

## D-001 · 2026-08-31 · ACCEPTED — Documentation lives in `docs/`, with a Claude context system in `docs/claude/`

**Context.** The repository had one documentation file (`docs/FRONTEND_ANALYSIS.md`, an obsolete pre-backend reconnaissance report) and a `README.md` containing several claims contradicted by the code. Work was being lost between sessions and an earlier audit's mistakes risked being preserved as fact.

**Decision.** Establish `docs/` as the single source of truth, with `docs/claude/` holding session-continuity files. Documentation is treated as part of the work, not an afterthought — see [claude/RULES.md](claude/RULES.md) §8.

**Consequences.** Every meaningful change must update the living documents. Documentation drift is now a defect. `docs/FRONTEND_ANALYSIS.md` is retained as a historical artefact but is **not** authoritative.

---

## D-002 · 2026-08-31 · ACCEPTED — Demo mode is kept and isolated, not removed

**Context.** `frontend/src/lib/demo/` (1,814 lines, added by the most recent commit) is a complete parallel fake backend. It is also the confirmed root cause of "Super Admin cannot add an employee": once active in a tab, it intercepts every request including the login itself, and only an explicit Sign-out clears it. Its password and all 838 lines of fabricated PII ship in the public production bundle.

**Decision.** Keep it — it is a required client-presentation feature — but make it structurally incapable of interfering with real authentication: clear the flag on every entry into a real session, exclude `/auth/*` from the short-circuit, gate the import behind an env flag so it is tree-shaken out of production builds, and make it unmistakably visible when active.

**Alternatives rejected.** *Delete it* — it has genuine business value for presentations. *Leave it and warn users* — a documented footgun is still a footgun, and this one silently serves fake data inside what looks like the live product.

**Consequences.** Phase 1 is the first behavioural work in the roadmap. Demo mode becomes a build-time-optional feature.

> **Completed 2026-09-01.** All four parts of the decision are now implemented — clearing (Task 1.1), the `/auth/*` exclusion (Task 1.2, refined into an allow-list by [D-013](#d-013--2026-09-01--accepted--the-demo-may-answer-exactly-one-auth-path-chosen-by-allow-list)), and build-time removal (Task 1.3). The mechanism chosen for the last one is **bundler module replacement, not tree-shaking** — see [D-014](#d-014--2026-09-01--accepted--the-demo-is-removed-from-production-builds-by-bundler-module-replacement-not-by-a-runtime-flag). The remaining part, *"unmistakably visible when active"*, was **completed by Task 1.4 on 2026-09-02** — see [D-015](#d-015--2026-09-02--accepted--demo-mode-is-signalled-on-three-surfaces-none-of-them-the-sidebar-alone). **This decision is now fully discharged.**

---

## D-003 · 2026-08-31 · ACCEPTED — Wire the existing backend rather than rewrite it

**Context.** 58 of 96 endpoints (60%) have zero frontend callers. All four `approve` routes, all role and team CRUD, the audit-log endpoint, and every factory `PATCH` are complete, permission-gated, audited, and unreachable. Meanwhile 13 UI controls simulate the operations those endpoints perform.

**Decision.** Treat most remaining feature work as a **frontend wiring** problem. Before writing any endpoint, grep for an existing one.

**Consequences.** Phases 4–12 are predominantly frontend. Backend changes are confined to genuine gaps (state machines, CHECK constraints, guards, storage, email, notification producers).

---

## D-004 · 2026-08-31 · ACCEPTED — A control either works or is removed; it never simulates success

**Context.** Thirteen controls call `refresh()` and show a success toast without issuing any request. Several make claims about real-world events: *"UTR confirmed in bank statement"*, *"Transfer resubmitted with corrected beneficiary"*, *"Query sent to SPOC"*, *"2FA enabled"*, *"You'll get an email when it's ready"*.

**Decision.** No control may report success it did not achieve. If it cannot be implemented in the current phase, disable or remove it.

**Consequences.** Some UI capability will visibly shrink before it grows. This is correct — a user acting on a false confirmation about a disbursement is a materially worse outcome than a greyed-out button. Enforced by a Phase 14 test class asserting that every mutating control issues an HTTP request.

---

## D-005 · 2026-08-31 · ACCEPTED — Backend is the only authority

**Context.** `mustChangePassword` is enforced solely by a React redirect; a temporary password therefore grants full API access via curl. Frontend navigation carries no permission gating at all. Route guards are `router.replace` calls in a client component, with no `middleware.ts` anywhere.

**Decision.** Every rule that matters is enforced server-side. Frontend guards are a usability affordance only, and are never counted as a security control.

**Consequences.** Phase 2.3 adds server-side `mustChangePassword` enforcement. Phase 12.10 adds permission-aware navigation as UX, not security. Any future rule must land in the backend first.

---

## D-006 · 2026-08-31 · ACCEPTED — Preserve the existing architecture

**Context.** Express 5 + Drizzle + PostgreSQL + Next.js App Router. The backend patterns are sound: `createScopedResource` for scoped CRUD, `PERMISSIONS.*` constants with zero role-name comparisons, `recordAudit`, `softDelete`, and a bank-scope choke point that fails closed.

**Decision.** Keep all of it. No new framework, ORM or state-management library without a superseding decision recorded here.

**Consequences.** New scoped resources use the factory. New permissions go in the catalogue. Schema changes go through Drizzle migrations — **never edit an applied migration.** The repository currently has zero schema drift and that must be protected.

**Noted exception to revisit.** The frontend has no data-fetching library, so there is no cache, no dedupe, and no request cancellation (`useResource` creates an `AbortController` and never passes its signal). `/customers?pageSize=500` is fetched independently by four pages. This is a known inefficiency, deliberately not addressed now to avoid a large refactor during correctness work. Revisit after Phase 12.

---

## D-007 · 2026-08-31 · ACCEPTED — Keep the PGlite test harness

**Context.** `src/tests/harness.ts` runs the **real shipped migration files** against in-memory Postgres, then the real seed. That is unusually good and would catch schema drift.

**Decision.** Keep and extend it. **But** because tests substitute a PGlite Drizzle instance for the `node-postgres` one via a forced cast, driver-level behaviour (SSL, pooling, Neon idle termination, type decoding) is untested. Phase 14.9 adds a real-Postgres run in CI alongside it.

**Consequences.** Fast local tests are preserved; driver-specific regressions are caught in CI rather than production.

---

## D-008 · 2026-08-31 · ACCEPTED — Commit the uncommitted employee work before any new development

**Context.** ~1,242 lines across 8 modified + 4 untracked files implement employee creation with role/bank/team assignment, `generateTemporaryPassword()`, `POST /users/:id/reset-password`, forced password change, the credential hand-over dialog, and 25 new tests. It converts four demonstrably fake flows into real ones and fixes a genuine security defect (the create form defaulting to the Super Admin role). It is entirely unprotected by version control.

**Decision.** Verify it (Task 0.1) then commit it as one reviewed commit (Task 0.2) before anything else. **Requires explicit user approval — see [claude/RULES.md](claude/RULES.md) §9.**

**Consequences.** Phase 2 starts from a known state. Until this is done, `git checkout` or a machine failure destroys the work.

---

## D-009 · 2026-08-31 · **EXECUTED 2026-09-01 (Task 0.5)** — Remove the tracked Python bytecode artifact `frontend/__pycache__/rewire.cpython-312.pyc`

**Context.** 12 KB of Python 3.12 bytecode is tracked in git. Its `rewire.py` source is not in the repository, and the project has no Python toolchain — no `requirements.txt`, no `pyproject.toml`, no `.py` file. Its function names (`strip_data_import`, `wrap_money`, `rewrite_fn`) and its `'   !! missing:'` failure-print establish that **the frontend was mechanically converted from a mock module by an unversioned script that tolerated per-function failures.**

**Decision.** Untrack the artefact (Phase 0.5) and record here what it explains.

**Consequences.** This is the single best explanation for the pattern found throughout the frontend: 13 un-wired handlers, `monthlyTrend = []` and `activity = []` placeholders, `useState(rows)` without a sync, `wrap_money`-inserted `num()` float conversions, and an `exhaustive-deps` suppression. **The gaps are not random — they are the residue of a conversion that partially failed and was never reconciled.** Expect more of the same pattern; look for it deliberately rather than assuming each instance is isolated.

### Execution record — Task 0.5, 2026-09-01

**What the file was.** `frontend/__pycache__/rewire.cpython-312.pyc` — 12,489 bytes of CPython 3.12 compiled bytecode, blob `28e3028`, introduced by `beac90c` ("first commit"). Its source `rewire.py` is **not present anywhere in the repository**, and never was.

**Why it does not belong.**
1. **It is build output, not source.** `.pyc` files are a compilation artefact regenerated from `.py` source. Committing one is committing a derived binary.
2. **There is no Python toolchain in this project.** No `.py` file, no `requirements.txt`, no `pyproject.toml`, no Python step in any npm script or CI. Nothing in the repository can produce, consume, verify or execute it.
3. **It is unauditable.** Compiled bytecode cannot be meaningfully reviewed in a diff, and without its source nobody can confirm what it did. In a banking application, an opaque committed binary of unknown provenance is a supply-chain concern in its own right.
4. **It is version-locked.** `.pyc` files are tied to a specific CPython version (3.12 here) and are worthless to anyone on a different interpreter.

**Untracked, not deleted.** Removed from the git index with `git rm --cached`; **the file remains on disk**. A bare `git rm` was deliberately avoided. Two reasons: the roadmap says *untrack*, not *delete*; and the artefact is the only surviving physical evidence of the conversion described above. It now costs nothing to keep locally because it is gitignored, and anyone wanting to examine what the script actually did still can.

**Recurrence prevented.** The root `.gitignore` created in Task 0.4 carries `__pycache__/`, `*.py[cod]` and `*$py.class` (`.gitignore:74-78`). Before this task the file was in the unusual state of being *matched by a gitignore rule yet fully tracked* — `.gitignore` is not retroactive and only affects untracked files. After the removal, `git check-ignore` reports it **without** requiring `--no-index`, which is the proof that it is genuinely untracked and ignored rather than merely matched.

**Verified.** Tracked file count 146 → 145; exactly one path left the index; **zero** tracked Python artefacts remain repository-wide; no application source file changed.

**State.** The removal is **staged and uncommitted** (`git status` shows `D  frontend/__pycache__/rewire.cpython-312.pyc`). It takes effect in the repository only when committed.

---

## D-010 · 2026-08-31 · ACCEPTED — Zero-CHECK-constraint status columns are a defect to fix, not a pattern to follow

**Context.** Every status column is free-text with a default. The TS status arrays are used only by zod on create/patch. The `approve` route validates with `z.string().min(1)` and will write **any** string — `{"status":"Credited "}` with a trailing space produces a disbursement that reconciliation queries cannot see while the UI shows it approved.

**Decision.** Add explicit transition validation in the service layer **and** DB `CHECK` constraints, per resource, in Phases 5–8, with Phase 13.13 as the sweep.

**Consequences.** Existing rows must be validated before constraints are applied. State machines are defined in [BUSINESS_FLOW.md](BUSINESS_FLOW.md) before enforcement is written.

---

## HOW TO ADD A DECISION

Copy this template. Never delete a superseded decision — mark it `SUPERSEDED` and link the replacement.

```markdown
## D-0XX · YYYY-MM-DD · STATUS — <one-line decision>

**Context.** What forced a choice. Include evidence with file:line.

**Decision.** What was chosen, stated plainly.

**Alternatives rejected.** What else was considered, and why not.

**Consequences.** What this obliges or forecloses. Include accepted risks.
```
