# CURRENT STATE

> ## ✅ MANAGER MAINTENANCE — ADDED 2026-09-11 (migration `0016`, **D-095**)
>
> **Gates:** backend **1349/1349 · 57 files** (was 1309/56) · frontend **1176/1176 · 53 files** (was 1143/52) · both typechecks clean · backend lint clean · frontend lint **58** (1 pre-existing error, unchanged) · `db:generate` zero diff · `drizzle-kit check` fine · migrations/snapshots/journal **17/17/17** · `next build` exit 0, **31 routes** · backend `tsc -p tsconfig.build.json` exit 0.
>
> The four tracking formats management already works in — **FVR**, **Transfer / Disbursement**, **APTS**, **Payment** — are now produced by the CRM at `/maintenance/*`, with management's own headings, wording and column order. They are **read projections** over `customers`, `loans`, `verifications` and `disbursements`. **No `*_tracking` table was created and none may be.**
>
> **Migration `0016` is additive and entirely nullable:** three master tables (`regions ▸ areas ▸ branches`) and sixteen nullable columns on `loans`, `verifications` and `disbursements`. 30 → **33 tables**, 65 → **69 FKs**, 13 → **20 CHECKs**. **Triggers stay at 7** (D-057). No backfill, no column dropped or retyped, so the previous application version still runs against it (D-090).
>
> **Two long-standing unknowns were settled by the supplied sheets, not by inference.** `Fund Credited to Customer` is a **credit timestamp** (`disbursements.approved_at`, guarded on `status = 'Credited'` — the same column is stamped on `→ Failed`). `Payment Status` is **not** any existing financial state: every row of the manager's Payment sheet carries a credit time and still reads `Not Received`, so it is a manager-maintained receipt flag, structurally walled off from the disbursement state machine.
>
> ⚠️ **What APTS and BT stand for is still not established** anywhere in the repository or the supplied material, and nothing was invented for them. Eight open questions are recorded in [MANAGER_MAINTENANCE.md](MANAGER_MAINTENANCE.md) §10.
>
> ⚠️ **Existing deployments must grant `maintenance.*` on the Roles screen** — `seed()` tops up non-system roles only at creation, so only `super_admin` (holding `*`) receives the new keys automatically.
>
> ⚠️ **Several sheet columns will be blank in current data** — `MANAGER NAME`, `REMARK` and `Customer Profile` have no UI writer anywhere in the product. They are left blank rather than filled with a plausible value (D-004).

> ## ✅ WAVE 5 + WAVE 6 (CLAUDE-DOABLE) COMPLETE — 2026-09-06
>
> ## THE REPOSITORY IS READY FOR THE HUMAN PRODUCTION-SETUP PHASE
>
> **Gates:** backend **1258/1258 · 55 files** · frontend **1143/1143 · 52 files** · both typechecks clean · backend lint clean · frontend lint **58** (1 pre-existing error) · `db:generate` zero diff · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16** · demo exclusion PASSED · `next build` exit 0. **No new migration.**
>
> **Everything a deployment needs now exists** and did not before: a CI pipeline (there was not one `.yml` in the repository), a Dockerfile, `railway.json`, `vercel.json`, a migration release step with a pooled-URL guard, four scheduled jobs, error tracking, and six operational documents.
>
> **SEC-019 closed** — redaction was `*.password`-shaped, and a pino `*` matches exactly one level, so `req.body.password` was never covered. Now a walker by key name at any depth, proven through a real pino instance.
>
> **SEC-009's retention half is BUILT and NOT IN EFFECT.** The job destroys the plaintext Aadhaar that `import_rows` retained forever, and a test proves the value is gone from the database. **Nothing purges until the cron is wired.** The finding stays open, deliberately.
>
> **Q9 closed** — all five roles against 37 endpoints. **Zero-fake now sweeps all twenty screens**, and proves it can detect a planted offender.
>
> ⚠️ **NOT DONE, and not doable here.** The Docker image has never been built (daemon unavailable). CI has never run on GitHub Actions. **No migration has ever run against real Postgres.** S3 has never made a network call. No email has ever reached Resend. No restore has been rehearsed. OD-5 (DPDP counsel) and OD-6 (penetration test) are external. See `docs/GO_LIVE_CHECKLIST.md`.


> ## (superseded) ✅ WAVE 4 — ADMIN UI (PHASE 12) — COMPLETE 2026-09-06
>
> **Gates:** backend **1188/1188 · 51 files** (was 1102/47) · frontend **1105/1105 · 49 files** (was 997/44) · both typechecks clean · backend lint clean · frontend lint **58** (1 pre-existing error, unchanged) · `db:generate` **no schema changes** · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16** · demo exclusion PASSED on both bundlers · `next build` exit 0, **27 routes**. **No migration was created — Wave 4 needed no schema change.**
>
> **Three screens that did not exist now do**, over routes that had shipped with the first migration and had **zero callers**: `/roles` (12.1), `/teams` (12.2) and `/audit-logs` (12.4). A fresh deployment previously had no in-product way to create a team at all.
>
> **Two backend defects closed.** **SEC-014 / 12.5** — the audit bank-scope disjunct was unparenthesised inside `and(...filters)`, so every operator-selected filter was silently dropped for the in-scope half of a scoped caller's query. **Reversion-proven, 5 of 21.** And **12.3** — `PATCH /api/teams/:id` did not exist, so `teams.edit` was granted to two roles and consumed by no route: a team's name, description, leader and status were fixed for the life of the record.
>
> **`app_settings` is alive** (12.6). It shipped in the first migration and had zero references outside the schema file. It now has a closed key registry, and one of its keys has a **live consumer** — `recycleBin.retentionDays` feeds `purgeDate()`, measured through the real delete path. **`settings.edit` is Super Admin and Admin** (U-14 / OD-8 → **D-086**).
>
> **Sessions are real** (12.8). The panel that listed three hardcoded devices dated 2024 with sign-out buttons that revoked nothing is replaced by the caller's actual `refresh_tokens`, with a revoke proven by using the cookie afterwards.
>
> **Navigation follows permissions** (12.10). All fourteen entries rendered for all five roles; an Executive was invited into four screens that answer 403.
>
> ⚠️ **What Wave 4 deliberately did NOT build, and why.** Per-user preferences and alert preferences stay `NotConfigurable` — `app_settings` is keyed by `key` alone and has **no user column**, so storing them there would make one operator's choice everybody's. The reason on those panels was corrected from "no routes yet" to "no table that can hold it" (**D-087**). Invoice numbering likewise: settlement numbers come from `code_sequences`, so a prefix stored here would be read by nothing.
>
> ⚠️ **Waves 5 and 6 are NOT started.** No CI, no container, no deploy config, no backups, no error tracking, no scheduled jobs. **The application has never been deployed, the migrations have never run against real Postgres, and the S3 adapter has never made a live network call.**


**What actually works today, verified by tracing code.** No aspirational statements.

**As of:** 2026-09-06 · **Phases 0–10 are COMPLETE. Phases 11–16 remain, and none has been started.**

> ⚠️ **This header was eight phases stale until 2026-09-06.** It described Phase 1 as the latest completion and "Phase 2 is next" while Phases 2–10 had all landed. That is audit item **U-13**, corrected in Wave 0. The dated sections further down are **intentionally historical** and are left as written.

### Measured state — 2026-09-06, executed rather than quoted

| | |
|---|---|
| Backend tests | **967 passed / 967, 38 files** |
| Frontend tests | **949 passed / 949, 39 files** |
| Backend / frontend `tsc --noEmit` | **both clean** |
| `npm run db:generate` | **exit 0 — "No schema changes, nothing to migrate"** |
| `drizzle-kit check` | **"Everything's fine"** |
| Migrations | **`0000`–`0013`**, 14 journal entries |
| Snapshots | **`0000`–`0013`** — `0008`–`0013` reconstructed in Wave 0 (**D-081**) |
| Tables / foreign keys | **30 tables**, 65 FK references (15 cascade, 16 restrict, 34 set null) |
| CHECK constraints | **4** — `loans.status`, `bank_orders.stage`, `bank_orders.status`, `disbursements.status`. Eleven further status columns are unconstrained; that is Phase **13.13** and it owns SEC-016's closure |
| Deployment | **none.** Not one `.yml`, `Dockerfile`, `vercel.json`, `railway.*` or `.github/` exists |

### What changed since this document last described reality

**Phase 2** — real employee management, the last-Super-Admin invariant (SEC-003), server-side forced password change (SEC-010).
**Phase 3** — Resend wired end to end: invitation links and self-service password reset both send real mail and both complete in a browser.
**Phase 4** — the customer screen: edit, delete, server-side search, filtering and pagination.
**Phase 5** — the loan workflow: create, update, verify, approve and reject, with a state machine in the service layer and the repository's first CHECK constraint.
**Phase 6–10** — 42 rows in one block: bank orders with two machines, disbursement, transactions and settlements including the settlement→transaction→ledger chain, **real document storage**, and notifications with event identity. Migrations `0008`–`0013`.

**The thirteen controls that showed a success toast and issued no request are gone.** The last nine are pinned by `frontend/src/app/(app)/fake-controls.test.tsx`, which fails if any regresses. **BUG-002 is closed.**

⚠️ **That is not the same as "nothing lies any more."** The master audit found **17 further controls** that claim an outcome and issue no request, concentrated in `settings/page.tsx` (a 2FA switch reporting "2FA enabled" for a feature in no layer, a fabricated three-row active-sessions table with a working-looking "Sign out", company profile and invoice-numbering inputs that discard what is typed) and `reports/page.tsx` (`window.print()` followed by "PDF ready", an HTML table saved as `.xls`). The dashboard renders **₹0 for a 403** rather than admitting it cannot see the figures. These were never part of BUG-002's count. They are owned by Phases 11.4, 12.6, 12.7, 12.8 and audit item U-4.

Per-feature detail: [FEATURE_STATUS.md](FEATURE_STATUS.md). Per-screen detail: [INTEGRATION_MAP.md](https://github.com/RiseNext/CMBFRONTEND/blob/main/docs/INTEGRATION_MAP.md). Remaining work: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md) Phases 11–16.

---

> **Everything below this line is dated and historical.** It records what was true when written and is deliberately not rewritten.

---

## 1. TREE STATE

**Clean as of Task 0.2.** The employee-management work was reviewed and committed as **`583897f`** — *"Complete employee management flow"* (12 files, +1,426 / −184). `main` is **1 commit ahead of `origin/main`; nothing has been pushed.**

The only uncommitted application file is `frontend/next-env.d.ts`, a Next.js build artefact rewritten by `next build` during Task 0.1 and deliberately excluded from the commit.

The table below is retained as a **historical record** of what that commit changed — left column = the previously deployed state, right column = what is now on `main`.

| | Before (`7ef5da5`) | Now on `main` (`583897f`) |
|---|---|---|
| Employee creation | Creates the row, then **discards the returned temporary password**. Button reads "Send invite"; no mailer exists | Full flow with a one-time credential hand-over dialog |
| Admin password reset | **Route does not exist.** The button was `toast.info("Reset link sent", …Emailed to…)` | Real endpoint with session revocation and audit |
| Deactivate employee | Fake — local state + toast, no request | Real `PATCH /users/:id` |
| Settings password change | Fake — bare toast, inputs unbound | Real `POST /auth/change-password` |
| Forced password change | Does not exist | Wired end to end (client-side enforcement only) |
| Employee permissions panel | **Fake** — 6 hardcoded labels not matching the real catalogue, toast-only switches | Removed, replaced with a read-only role catalogue |
| Default role on the create form | **Super Admin** (`roles[0]`, ordered by ascending level) | Explicit required choice, filtered to assignable roles |
| Tests | 82 | 107 |

**Committed in `583897f`.** Verified green before commit: backend typecheck, lint, and **107/107 tests**.

---

## 2. WHAT GENUINELY WORKS END TO END

Traced UI → handler → HTTP → route → authz → service → database → response → UI.

### Authentication
- **Login** — argon2id verification, a real argon2 dummy hash for timing equalisation on unknown users, account lockout after 8 attempts / 15 minutes, `status`/`role.isActive` checks, audit row, `lastLoginAt` update.
- **Session** — JWT HS256 access token (15 min) held in a module variable; refresh token as a rotating httpOnly cookie (7 days), **stored hashed**, with **reuse detection that revokes the entire token family**.
- **Logout** — revokes the presented token server-side and clears the cookie.
- **Change password** — verifies the current password, enforces the 12-char policy server-side, clears `mustChangePassword`, revokes **all** sessions.

### CORS *(Task 1.6, 2026-09-02)*
- An allowed origin is served with `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials`; a preflight answers 204. Unchanged.
- A **disallowed** origin — ordinary request or preflight — gets **403 `cors_origin_denied`**, one `warn` log containing the origin, and **no stack trace**. It was a 500 with an error-level stack trace (BUG-022 / SEC-018, both now closed).
- The refusal happens **before any route executes**, which matters because the refresh cookie is `SameSite=None` in production. Proven positively: an unknown path under a denied origin returns 403, not 404.
- A request with no `Origin` header is unaffected — curl, server-to-server and health probes still work.
- **Known gap:** the rejection log has no `requestId` (assigned after the CORS middleware). Follow-up, not part of 1.6.

### Customer identifier validation *(Task 1.9, 2026-09-02)*
- `GET`/`PATCH`/`DELETE /api/customers/:id` parse `z.object({ id: z.string().uuid() })` **after** `requirePermission`. A malformed id is **422 `validation_failed`** with `details:[{path:"id",message:"Invalid UUID"}]` — the same envelope a bad `bankId` already produced.
- Before this it was a **500**, and the server wrote the SQL, the bound parameters and a stack trace to the log on every mistyped URL.
- The command palette navigates by `customer.id`; the human-readable code is still what the result row displays.
- **`middleware/error-handler.ts` is unchanged.** Mapping `22P02` centrally was rejected: it also fires on integer/numeric/boolean/json input, and `services/access.ts:48` raises it on *every* request if a token carries a non-uuid `sub` — that outage would have become an unlogged 4xx (D-021).
- Unchanged and asserted: a valid uuid resolves, an absent uuid is still 404, unauthenticated is still 401, a caller without `customers.view` is still 403, and a genuine database fault is still 500 with one `logger.error`.
- **Scope:** three endpoints. **45 others share the pattern** and still 500 (Phase 8); the `filterable` query loop is **BUG-035**.

### Session invalidation *(Task 1.8, 2026-09-02)*
- A deactivated account or a disabled role returns **403 with `account_inactive` / `role_disabled`** — dedicated codes raised by the per-request session gates in `services/access.ts`. The client signs out on those two codes and nothing else.
- **Every ordinary 403 keeps `forbidden`** and leaves the user signed in: missing permission, bank scope, role hierarchy, import ownership, system-role edits, and the demo layer's fabricated refusals.
- Soft-deletion still returns **401**, and the 401 refresh ladder is unchanged.
- Before this, all 403s shared one code, so a deactivated session stayed visible until access-token expiry — up to 15 minutes. Never an authorization bypass; the backend refused every request throughout (BUG-034).

### Configuration validation *(Task 1.7, 2026-09-02)*
- `NODE_ENV` is **required** — no default. The backend refuses to start without it, naming the variable and saying why. Previously it defaulted to `development`, and because nothing in the repo sets it, a production deploy that forgot it shipped `Secure=false; SameSite=Lax` refresh cookies (**SEC-028**).
- A typo (`prod`, `Production`, `staging`, `""`) was already rejected by the enum and still is. Only *absence* was silent.
- Production also refuses to boot on the shipped default `AADHAAR_PEPPER` or on identical JWT secrets — unchanged, and asserted by test.
- Nothing is inferred from `CORS_ORIGIN`, `DATABASE_URL` or any other variable, so the check has no false positives (D-019).

### Authorization
- Permissions resolved **from the database on every request**, so a revoked permission takes effect on the next request rather than at token expiry.
- Role hierarchy from one rule (act only on a strictly greater level) with **zero role-name string comparisons** anywhere in authorization code.
- Bank scoping applied **in the SQL `WHERE` clause** and **failing closed** — a user with no assignments sees nothing. **No IDOR/BOLA hole was found.**
- Escalation guards: you cannot assign a role at or above your own, and you cannot grant a permission you do not hold.

### Data
- **Customers** — list, create, delete (soft), detail view; bank-scoped; audited; Aadhaar peppered on write.
- **Excel customer import** — the most complete feature in the application. Template download, multipart upload, per-row validation, staged preview, transactional confirm, bank access re-checked at confirm time, 24-hour batch expiry, 409 on double-confirm.
- **Banks** — list, create, pause/resume.
- **Loans** — list and create (with customer↔bank consistency enforced).
- **Disbursements** — list and create.
- **Ledger** — list, and create **for Super Admin and Admin only**.
- **Recycle bin** — list, restore, permanent delete. The best-implemented page: real API, permission gating, and loading/error/empty states all present.
- **Dashboard** — KPIs and two charts from real bank-scoped SQL aggregates.

### Employee management *(committed `583897f`)*
- Create with role, bank scope and team in one transaction; server-generated temporary password returned once and displayed once; admin reset with session revocation; forced password change; the created employee can log in — **proven end to end** by `src/tests/employee-lifecycle.test.ts:124-130`.

### Forced password change, enforced server-side *(Task 2.3, 2026-09-02 — uncommitted)*
- An account on an administrator-issued temporary password can **authenticate, see who it is, and replace the password. Nothing else.** Every other authenticated route answers **403 `password_change_required`**.
- **The exemption is which middleware a route chooses, not its URL.** `requireAuth` is the strict default; `GET /api/auth/me` and `POST /api/auth/change-password` opt out via `requireAuthAllowPasswordChange`. A path allow-list was measured and rejected — inside `requireAuth` (mounted by `router.use()` on twelve routers plus the `createScopedResource` factory) `req.path` is relative to the mount, so it would never have matched and would have locked flagged users out of their own recovery route (D-023).
- `/login`, `/refresh` and `/logout` needed **no** exemption — they carry no `requireAuth` at all.
- **A workflow restriction is not a session termination.** `password_change_required` is deliberately not one of Task 1.8's two session-ending codes, and a frontend test fails if it is added to them. A deactivated *and* flagged account still reports `account_inactive` — the session gates run first.
- **Refresh stays reachable**, and the rotated token is exactly as restricted. Refresh tokens are not revoked merely because the flag is set: that would strand a flagged user on every page reload.
- Once the flag clears, **the same access token works immediately** — the context is re-read per request.
- Was React-only: `app-shell.tsx` redirected, and any non-browser client had full role-scoped access. A flagged Super Admin could create accounts and reset other users' passwords — both measured at 201/200 before the fix.
- 18 backend + 1 frontend test; 4 mutations reversion-proven.

### Super Admin lockout protection *(Tasks 2.1 + 2.2, committed `9fdec8d`)*
- `PATCH /api/users/:id` refuses **self-deactivation** and **self-demotion off the system role** with **400**, and any change that would leave zero Active, non-deleted, system-role users with **409**. `DELETE /api/users/:id` shares the same `assertSuperAdminRemains` helper, so the invariant is stated exactly once.
- **The guard is field-scoped.** A Super Admin can still edit their own name, phone and branch, and a full-form save that echoes the current `status` and `roleId` is still 200 — `DELETE`'s unconditional self-refusal was deliberately **not** copied (D-022).
- **Both paths are covered**, not just `status`: self-demotion by `roleId` is the quieter failure, because the account stays Active and the resulting `forbidden` 403s do not end the session under Task 1.8's rule.
- **`DELETE`'s two guards are unchanged for every case they already handled** and are now tested for the first time in the repository's history. Its one behaviour change is the Task 2.2 fix: deleting an **already-inactive** Super Admin while exactly one active one remains is **204**, where it was a spurious 409.
- **Not race-safe, stated plainly.** The count and the write are separate statements with no lock, exactly as `DELETE` has always been — **BUG-037**. **Still no break-glass recovery script** (SEC-003 remediation 4).
- 26 tests; 9 fail against the pre-fix code; 4 mutations reversion-proven.

### Infrastructure
- 29-table schema, 6 migrations, **zero drift**, 64 FKs, 7 triggers including a real append-only guard on `audit_logs`. `0003` added `invitations` (3.5), `0004` added `password_resets` (3.6), `0005` added the two invitation-state columns on `users` (3.7).
- Audit rows written on every mutating admin/customer/bank/factory route.
- **687 backend tests** — 571 of them running the **real shipped migrations** against in-memory Postgres, plus 116 that need no database (16 CORS, 17 cookie/config, 22 email-config, 32 email-service, 29 email-templates).

---

## 3. WHAT DOES NOT WORK

### Nine controls show success and issue no request *(of thirteen originally recorded)*
Bank-order stage move · bank-order remark · disbursement "mark credited" · disbursement "re-initiate" · settlement "mark paid" · settlement "raise dispute" · transaction "mark successful" · document verify/reject · document delete.

> **Count reconciled 2026-09-05, Wave 0.** This heading said *"Thirteen"* while the list beneath it enumerated **nine** and the two notes below disagreed with each other — one said *"Nine remain"*, the other *"Ten remain"*. The list is correct: **nine**, matching the nine open entries in [BUG-002](BUGS_AND_ISSUES.md#bug-002) after 4.1, 4.2, 4.4 and 5.4 closed four. Thirteen is the historical total, kept for continuity.
>
> **Not counted here, and each owned elsewhere:** "Print" (**11.4**) · three controls in `settings/page.tsx` that remain **UNOWNED**, including a **2FA switch reporting "2FA enabled" for a feature that does not exist** (**OPEN-8**) · the documents upload, which is not fake but **misleading** — it issues a real awaited POST of metadata while the file bytes are never attached (**BUG-004**, Phase 9).

> **Loan approve/reject was closed by Task 5.4 on 2026-09-05** — *"the single most business-critical unreachable operation in the system"* now issues a real `POST /api/loans/:id/approve`, gated on `requests.approve`, with rollback on failure and adoption of the server's returned row. **Nine remain**, all owned by Phases 6–9.
> Phase 5 also removed two false controls that no row had owned until Wave 0 assigned them: the *"EMI is calculated on submit"* claim (**5.10**) and the no-op Bank selector (**5.11**), both on the loan create dialog.

> **Three of the original thirteen were closed by Phase 4 on 2026-09-05** — ~~customer edit (detail)~~ (**4.1**), ~~customer delete (detail)~~ (**4.2**) and ~~customer "re-upload written form"~~ (**4.4**, removed rather than wired). ~~**Ten remain**, all owned by Phases 5–11.~~ *(Stale — written at Phase 4 close, before Task 5.4 closed the loan approve/reject control. **Nine remain**, as the note above states; corrected 2026-09-05, Wave 0.)*
> Two further fabrications on the customer screens were closed by rows Wave 0 added: the false *"Record locked for audit after disbursal"* badge (**4.10**) and the *"Draft application"* generator (**4.11**).
> **Still fake on a customer screen and owned elsewhere:** "Print" (`customers/[id]/page.tsx`), Phase **11.4**.

**In every case the backend route exists and is never called.** All of them call `refresh()`, which re-fetches unchanged rows — so the table reverts while the dialog shows the fake value, and because no request is made there is **no failure path and no possible rollback**.

One file makes **zero** write requests despite importing the API client: `bank-orders/page.tsx` — **Phase 6.1 owns it**. *(`loans/page.tsx` was wired by Tasks 5.1/5.4/5.5/5.6 on 2026-09-05.)* *(`customers/[id]/page.tsx` was the other until Phase 4; it now issues `PATCH` and `DELETE` — Tasks 4.1 and 4.2, 2026-09-05.)*

### Broken features
| Feature | Failure |
|---|---|
| Notifications | Three independent failures: no producer ever inserts a row; the page's `useState(rows)` never syncs so it is **permanently empty even when the API returns rows**; mark-read never persists. The bell badge works and the page it links to is blank. |
| Reports | Empty on load (stale `useMemo` with an eslint suppression); default date range hardcoded to 2024; the `to` day is always excluded by a string/timestamp comparison. |
| Excel / PDF export | "Excel" is an HTML table saved as `.xls`. "PDF" is `window.print()` with a toast claiming "PDF ready". |
| Ledger | `POST /api/ledger` succeeds **only for Super Admin and Admin**. Manager/Team Leader/Executive are rejected at `requirePermission` because **they do not hold `ledger.create` at all**; a *separate* defect means the UI never sends `bankId`, so any bank-scoped holder of that permission would also 403. Rows land `bank_id = NULL` and are **invisible to every scoped user**; `balance` is always 0. |
| Documents | File bytes discarded in the browser; no upload endpoint; `storage_key` never written; download and preview are toasts. |
| Loans create dialog | Never closes (wrong state variable) → duplicate loans. |
| ~~Customer global search~~ | ✅ **FIXED — Task 1.9, 2026-09-02 (BUG-017).** The palette links by `id`; a malformed `:id` is a **422** naming `id`. Row kept for history. |
| Dashboard for Executive | The role lacks `reports.view`; the 403 is swallowed and rendered as zeroes. |

### Missing entirely
Email (no provider, transport, template, config key or stub) · file storage · self-service password reset · invitations · background jobs · roles / teams / permissions / audit-log / settings admin UIs · rate limiting · security headers · frontend tests · E2E tests · CI/CD · deployment configuration · monitoring · error tracking · backups · API documentation.

### Demo mode contamination — ✅ FIXED (Tasks 1.1 + 1.2 + 1.3 in `a77b3c5`; Tasks 1.4 + 1.10 in the *"Secure demo build isolation and visibility"* checkpoint)
Demo mode is now cleared on every entry into a real session: in `signIn`'s real branch (after the demo-credential check, before the request is built), in `forceSignOut`, and on login-page mount. A guard in `AuthProvider` also discards an in-flight demo `/auth/refresh` whose session was exited mid-flight — a race the original analysis missed.

Verified by 11 frontend tests, **3 of which fail against the pre-fix code**. Both directions work in the same tab: demo → real → demo, and real → sign-out → demo.

**Task 1.2 added the transport guard.** `apiRequest` now consults an allow-list: the demo may answer only `/auth/refresh` — which is what restores a demo session across a page reload — while every other `/auth/*` path reaches the real backend regardless of the flag. It fails closed, so the auth routes planned for Phase 3 are protected before they exist. Inspection found the demo's `/auth/logout` and `/auth/me` handlers were already unreachable dead code.

**Task 1.3 removed the demo from production builds — SEC-001 is CLOSED.** `frontend/next.config.ts` reads `NEXT_PUBLIC_ENABLE_DEMO` and, when the demo is off, aliases `@/lib/demo` to the inert `frontend/src/lib/demo-disabled.ts`. `src/lib/demo/` is then never resolved by the bundler, so the credential and all ~1,500 lines of fixture code are **absent from the shipped JavaScript** rather than dead code inside it. `isDemoMode()` becomes a compile-time `false`, so planting the `sessionStorage` flag on a deployed site activates nothing.

Default behaviour is the safe one: unset → `next dev` includes the demo, `next build` excludes it. A client-facing demo build is produced deliberately with `NEXT_PUBLIC_ENABLE_DEMO=true`. Every build prints which variant it produced.

Evidence is from the build output, not the source: **256 string literals exclusive to `src/lib/demo/`, 0 present anywhere in `.next/static`.** *(The count reads 254 in later documents — Task 1.4's test made two of them non-exclusive. The result is unchanged.)*

✅ **This holds on every build path as of Task 1.10 (2026-09-02).** It briefly did not: `next build --webpack` ignored `turbopack.resolveAlias` and shipped the credential and all fabricated PII while printing `EXCLUDED` (**SEC-027 / BUG-033**, found and fixed the same day). The fix is three layers (D-017) — `NormalModuleReplacementPlugin` for webpack, because `resolve.alias` loses to Next's `JsConfigPathsPlugin`; a tripwire in `lib/demo/config.ts` that **fails the build** on any bundler if the demo is reachable; and `npm run verify:demo-exclusion`, which builds on both bundlers into clean output and searches it. Verified: turbopack `ufkrYTID9IX04lO1yrqSq` clean, webpack `aHLz-pqI8lE6rIui1AvSR` clean, demo-enabled `LThCbPhRQ6fqy0JWttN1g` contains the demo. Full record in [SECURITY_AUDIT.md](SECURITY_AUDIT.md) SEC-001; mechanism and rejected alternatives in [DECISIONS.md](DECISIONS.md) D-014.

**One operational rule now carries this:** `NEXT_PUBLIC_ENABLE_DEMO=true` must never be set on a production deployment. **One accepted limitation:** `tsc` always resolves `@/lib/demo` to the real module, so the substituted build's types are not checked against consumers — compensated by `typeof`-derived signatures, a `Substitute` assertion that fails `npm run typecheck`, and a runtime parity test. Both are recorded in D-014.

---

## 4. THE NUMBERS

| Metric | Value |
|---|---|
| Backend endpoints | **96** working tree / **95** HEAD (52 or 51 hand-written + 44 factory-generated) |
| Called by the frontend | **38** (40%) |
| Dead endpoints | **58** (60%) |
| Database tables | **29** (zero schema drift) |
| Foreign keys / triggers / CHECK constraints | 62 / 7 / **0** |
| Backend test cases | **687** across 25 files |
| Frontend / E2E tests | **454 / 0** across 20 files |
| CI workflows | **0** (not a single `.yml` in the repository) |
| Frontend pages | 18 under `(app)` + login (17 at HEAD; `change-password` is untracked) |
| Controls that fake success | **9** *(13 originally; 4 closed by 4.1, 4.2, 4.4, 5.4 — corrected 2026-09-05)* |
| Email providers integrated | **1** — Resend, via `services/email.ts` (**D-035**), four templates (**D-036**). **Two product emails now send for real**: the invitation on employee creation (3.5) and the reset link on request (3.6). **Both links now work end to end** — `/accept-invite` (3.11) and `/reset-password` (3.12), plus `/forgot-password` so a user can request a link without an administrator. **Phase 3 is complete** (**D-045**, **D-046**) |
| File storage providers integrated | **0** |
| Commits touching the backend | **1** (the first commit) |

---

## 5. BASELINE VERIFICATION

**Established by Task 0.1 on 2026-08-31.** All five gates were run against the working tree exactly as documented. **No application source file was modified to achieve these results.**

### Context at time of verification

| | |
|---|---|
| Date | 2026-08-31 |
| Commit | `7ef5da571921b7ab09632209d1ff0992bb3e88e8` (`7ef5da5` — "Add frontend-only employee demo") |
| Branch | `main` |
| Working tree | **DIRTY** — 8 modified + 4 untracked application paths (unchanged from the audit record) |
| Diff stat | 8 files changed, 691 insertions(+), 184 deletions(-) |
| Dependencies | Already installed in both packages. **No `npm ci` or `npm install` was run** |
| Node toolchain | vitest resolved to 3.2.7; Next.js 16.2.12 (Turbopack) |

### Results — 5 of 5 PASS

| # | Gate | Command | Result | Detail |
|---|---|---|---|---|
| 1 | Backend typecheck | `npm run typecheck` (`tsc --noEmit`) | ✅ **PASS** | **0 errors.** Exit code 0 |
| 2 | Backend lint | `npm run lint` (`eslint src`) | ✅ **PASS** | **0 errors, 0 warnings.** Exit code 0 |
| 3 | Backend tests | `npm test` (`vitest run`) | ✅ **PASS** | **107 passed / 107 total**, 4 files passed / 4. Duration 43.83 s. Exit code 0 |
| 4 | Frontend typecheck | `npm run typecheck` (`tsc --noEmit`) | ✅ **PASS** | **0 errors.** Exit code 0 |
| 5 | Frontend build | `npm run build` (`next build`) | ✅ **PASS** | Compiled in 9.0 s; TypeScript in 5.8 s; **21 routes** generated (20 static, 1 dynamic). Exit code 0 |

### Test breakdown — confirms the documented figure exactly

| File | Cases | Duration |
|---|---|---|
| `src/tests/employee-lifecycle.test.ts` *(untracked)* | 25 | 4,454 ms |
| `src/tests/authorization.test.ts` | 26 | 4,004 ms |
| `src/tests/workflow.test.ts` | 22 | 3,332 ms |
| `src/tests/frontend-contract.test.ts` | 34 (9 static `it()` + `it.each` × 25) | 2,851 ms |
| **Total** | **107** | 43.83 s |

**This matches the 107 recorded in [AUDIT_VERIFICATION.md](AUDIT_VERIFICATION.md) §13 exactly.** No discrepancy to explain. The suite ran entirely against in-memory PGlite; **no external database was contacted**.

### Known failures

**None.** No gate failed. No pre-existing defect was surfaced by any gate.

> ⚠️ **This is a statement about the gates, not about the application.** All five passing is fully consistent with every defect recorded in [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md) and [SECURITY_AUDIT.md](SECURITY_AUDIT.md) still being present — because **there are zero frontend tests and zero E2E tests**, and the backend suite runs every request as `super_admin`. A green baseline means the code compiles, lints and its backend contracts hold. It does **not** mean the 13 fake handlers, the demo-mode hijack, the missing storage, or the missing email have been affected in any way. See [TESTING_STRATEGY.md](TESTING_STRATEGY.md) §4.

### Is the uncommitted work verified?

**Yes — to the limit of what these gates can prove.**

The employee-management work (8 modified + 4 untracked files) **compiles, lints, builds, and its 25 new tests pass**, including the decisive end-to-end assertion at `src/tests/employee-lifecycle.test.ts:124-130` that a created employee can log in with the returned temporary password. It is therefore **safe to commit** (Task 0.2).

What this does **not** establish: that the employee screen behaves correctly in a browser (no frontend tests exist), or that it is reachable at all when demo mode is active (BUG-001, unfixed).

### Side effect recorded for completeness

`frontend/next-env.d.ts` was rewritten by `next build`:

```diff
-import "./.next/dev/types/routes.d.ts";
+import "./.next/types/routes.d.ts";
```

This is a Next.js auto-generated file (its own comment reads *"This file should not be edited"*) whose import path toggles between the dev and build variants depending on which command last ran. It was **not** edited by hand, carries no semantic meaning, and will flip back on the next `next dev`. It was deliberately **not** reverted, because reverting requires a `git checkout` over the working tree, which Task 0.1's constraints prohibit.

### Route count reconciliation

`next build` generated **21 routes**. Under `(app)` there are now **18** `page.tsx` files — 17 at HEAD plus the untracked `change-password/page.tsx`. With `/login`, `/` and `/_not-found`, that totals 21. Earlier documentation said "17 pages under `(app)` + login", which was correct for HEAD; the working-tree figure is 18.

---

## 6. CAN THE APPLICATION BE RUN TODAY?

**Locally, with caveats.**

1. `.env.example` **now exists** (Task 0.3) and covers all 16 schema variables plus `LOG_LEVEL`. `README.md` now references it correctly and documents every variable (Task 0.6). `cp .env.example .env` from `backend/` produces a config that boots in development — verified against the real zod schema. Copied verbatim to production it **deliberately refuses to start**, because `AADHAAR_PEPPER` is left at the value the production guard rejects.
2. `npm run db:migrate` then `npm run db:seed`. **If `BOOTSTRAP_SUPERADMIN_EMAIL` and `_PASSWORD` are not both set, the seed logs a warning and creates no user at all — nobody can log in.** The root `.env.example` ships the password key empty.
3. The seed inserts only permissions, roles and (optionally) one super admin. **No business data.** Every screen renders empty.
4. The frontend needs `NEXT_PUBLIC_API_URL`. It is inlined at build time, so a production build made without it permanently bakes in `http://localhost:8080`.
5. The demo account works with no backend at all and renders ~8 of 10 screens with convincing fabricated data.

**In production: it has never been deployed.** `README.md` self-certifies "Not deployed", and there is no deployment artifact of any kind in the repository.

---

## 7. CLASSIFICATION

**DEMO** — one grade above Prototype, three below Production candidate.

Split verdict: the **backend is a Production candidate with named gaps**; the **frontend is a Demo wearing its clothes**. The overall verdict is set by the frontend, because that is the entire product surface.

Not an MVP, because an MVP's core loop works. The core loop of a lending CRM is: onboard customer → collect KYC documents → submit to bank → advance the file → record disbursement → reconcile settlement. **Step 2 discards the file, and steps 4, 5 and 6 do not write to the database.**
