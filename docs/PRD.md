# Product Requirements Document — Rise Next Banking / Lending Operations CRM

> ⚠️ **Staleness notice, added 2026-09-02 by the Phase 1 final review.** The baseline commit below is now **seven commits behind `HEAD` (`7b33b35`)** and this document received no Phase 1 update. Its test figures are correct **for that baseline only**. Current measured totals are **171 backend cases across 8 files** (was 107 across 4 — Phase 1 added `cors` 16, `cookie-config` 17, `session-invalidation` 11 and `customer-lookup` 20) and **55 frontend cases across 5 files** (was zero). `employee-lifecycle.test.ts` is no longer untracked — it was committed in `583897f`. Treat every "107", "82" and "zero frontend tests" below as history, not as current fact; the live figures live in [CURRENT_STATE.md](CURRENT_STATE.md) and [FEATURE_STATUS.md](FEATURE_STATUS.md).

**Status of this document:** living. Every factual claim about the current system is
traceable to a `file:line` citation. Claims that could not be verified are marked
**UNVERIFIED**. Nothing here is aspirational unless it appears under a
*Requirement* heading — requirements describe what the system **should** do; the
**Current status** line under each one describes what it **does** today.

**Baseline commit:** `7ef5da5` "Add frontend-only employee demo".
**Working tree is dirty.** Eight modified files and four untracked files together
implement the employee create / temporary-password / reset / forced-change flow.
Where committed (HEAD) and working-tree behaviour differ, both are documented and
labelled `(HEAD)` / `(working tree)`.

| Working-tree change | Files |
|---|---|
| Modified | `src/lib/password.ts`, `src/modules/admin.routes.ts`, `src/modules/auth.routes.ts`, `src/services/access.ts`, `frontend/src/app/(app)/employees/page.tsx`, `frontend/src/app/(app)/settings/page.tsx`, `frontend/src/components/layout/app-shell.tsx`, `frontend/src/hooks/use-auth.tsx` |
| Untracked (new) | `src/tests/employee-lifecycle.test.ts`, `frontend/src/app/(app)/change-password/page.tsx`, `frontend/src/components/shared/credential-handover.tsx`, `frontend/src/lib/password-policy.ts` |

---

## 1. Product summary and business problem

### 1.1 The business

Rise Next operates as a **DSA (Direct Selling Agent) / channel partner** for
retail lenders. The company does not lend its own money as its primary business.
It sources borrowers, assembles their loan files, submits those files to partner
banks and NBFCs, chases each file through the lender's internal stages, and earns
a **commission** on every file the lender sanctions and disburses. Commission is
invoiced and collected per bank on a **settlement cycle** agreed with that bank
(`banks.settlement_cycle`, `src/db/schema/domain.ts:31`;
`banks.commission_rate`, `domain.ts:30`).

The frontend footer states the product's own self-description: *"Multi-bank DSA
workspace"* (`frontend/src/components/layout/app-shell.tsx:78`).

### 1.2 The problem

A DSA business with more than one partner bank has four structural problems that
spreadsheets do not solve:

| Problem | Consequence without a system | What the CRM must provide |
|---|---|---|
| **File volume across lenders** | Nobody can say how many files are sitting at which lender, at which stage, past which SLA | A single pipeline view per bank and per stage (`bank_orders.stage`, `bank_orders.sla`, `src/db/schema/operations.ts:199-200`) |
| **Commission leakage** | The lender's monthly statement is reconciled by hand; under-payments go unnoticed | A per-bank, per-period settlement record with gross, TDS and net (`settlements`, `operations.ts:259-288`) |
| **Bank-partitioned confidentiality** | Every employee can see every lender's customer book | Server-enforced bank scoping via a `user_bank_access` join table (`src/db/schema/domain.ts:60-76`; `src/services/access.ts:108-114`) |
| **Regulatory traceability** | No answer to "who changed this file, and when" | An append-only audit log protected by a database trigger (`src/db/schema/governance.ts:23-53`; `drizzle/0001_governance_guards.sql:6,16`) |

### 1.3 Naming: "loans" are called "requests" in the permission namespace

This is the single most confusing piece of vocabulary in the codebase and every
engineer hits it. **One concept carries three names:**

| Layer | Name | Citation |
|---|---|---|
| Database table | `loans` | `src/db/schema/operations.ts:85` |
| HTTP route mount | `/api/loans` | `src/app.ts:85` |
| Permission namespace | `requests.*` — `requests.view`, `requests.create`, `requests.edit`, `requests.delete`, `requests.assign`, `requests.approve`, `requests.import` | `src/lib/permissions.ts:49-57` |
| Recycle-bin record type | `loan` | `src/services/recycle-bin.ts:39` |

The wiring is explicit: the `loans` router is constructed by the scoped-resource
factory with `permissions.view = PERMISSIONS.requests.view` and so on
(`src/modules/operations.routes.ts:50-59`). **There is no `loans.*`
permission and there never was.** A role that needs to see loans must be granted
`requests.view`.

The table comment records the intent: *"LOANS / FUNDING REQUESTS — mirrors the
frontend `Loan` interface field for field, with the brief's workflow columns
added alongside rather than instead"* (`operations.ts:81-84`). The `requests.*`
naming is the residue of an unresolved architectural question — see
§8.2.

### 1.4 System shape

| Layer | Technology | Citation |
|---|---|---|
| Frontend | Next.js 16.2.12 App Router, React 19, all pages `"use client"`. **No `middleware.ts`, no `app/api/` route handlers.** | `docs/FRONTEND_ANALYSIS.md:9-10`; verified by file enumeration of `frontend/src` |
| Backend | Express 5.1, TypeScript ESM | `src/app.ts:1-9` |
| Database | PostgreSQL (Neon) via `node-postgres` Pool, Drizzle ORM 0.44 | `src/db/index.ts`; `.env.example:5-9` |
| Auth | argon2id password hashing, JWT HS256 access token (15 min, held in a module variable — never `localStorage`), rotating httpOnly refresh cookie (7 days) | `src/lib/password.ts:8-13`; `src/config/env.ts:13-14`; `frontend/src/lib/api.ts:1-8,17` |
| API surface | **96 endpoints** = 52 hand-written + 44 generated by `createScopedResource` across 9 resources | `src/modules/scoped-resource.ts:74`; route-registration count per module |
| Router mounts | 22 | `src/app.ts:78-99` |
| Schema | 27 tables — identity 7, domain 3, governance 5, operations 12. Zero drift between migrations and Drizzle definitions. 62 FKs, 7 triggers, **zero CHECK constraints** | `src/db/schema/{identity,domain,governance,operations}.ts`; `drizzle/000{0,1,2}_*.sql` |
| Tests | 107 runtime cases — authorization 26, workflow 22, frontend-contract 34, employee-lifecycle 25 (untracked). Tests run the **real** migrations against PGlite. **Zero frontend tests, zero E2E, no CI.** | `src/tests/*.test.ts`; no `.github/`, no `*.yml` anywhere in the repo |

---

## 2. Users and personas

Roles are **data, not code**. The catalogue is seeded from `DEFAULT_ROLES`
(`src/lib/permissions.ts:190-313`) and is fully editable afterwards
except for `super_admin`, which is `isSystem` and protected by a database trigger
(`drizzle/0001_governance_guards.sql:56,81`).

**The hierarchy rule** — one rule, no role names in the code: *an actor may only
create, edit, delete or assign a role to a user whose `role.level` is **strictly
greater** than the actor's own, unless the actor holds
`system.manage_any_user`* (`src/services/access.ts:144-149`). Lower
level = more authority.

| Role | `key` | `level` | Bank scope | Notable grants |
|---|---|---|---|---|
| Super Admin | `super_admin` | 0 | Unrestricted (`permissions: "*"`) | Everything, including `system.manage_any_user` and `roles.assign_permissions` |
| Admin | `admin` | 10 | Unrestricted (`system.access_all_banks`) | All operational namespaces; `users.*` including `users.reset_password`; `roles.view` only; `recycle_bin.view` + `restore` but **not** `permanent_delete` |
| Manager | `manager` | 20 | Assigned banks only | Full `customers.*`, `requests.*`, `verification.*`, `bank_orders.*`, `documents.*`; `disbursements` view/create/edit but **not** approve; `settlements.view` only |
| Team Leader | `team_leader` | 30 | Assigned banks only | `customers` view/create/edit/import; `requests` view/create/edit/assign; `verification` view/create; `bank_orders` view/edit; everything downstream read-only |
| Executive | `executive` | 40 | Assigned banks only | `customers` view/create/edit; `requests` view/create; `documents` view/upload; everything else read-only |

Citations: `super_admin` `permissions.ts:191-198`; `admin` `:199-233`; `manager`
`:234-261`; `team_leader` `:262-291`; `executive` `:292-312`.

### 2.1 Day-to-day work

**Super Admin.** Owns the workspace. Creates the role catalogue, defines who may
grant what, onboards the first Admins, and is the only role able to permanently
purge a record from the recycle bin (`recycle_bin.permanent_delete`,
`permissions.ts:118` — granted to no default role other than `super_admin` via
`"*"`). Cannot be deleted while they are the last active holder
(`src/modules/admin.routes.ts:444-451`).

**Admin.** Runs the operation. Onboards employees and hands over the one-time
temporary password, resets forgotten credentials, assigns bank access, maintains
the bank master, and reviews the audit log. Sees every bank
(`system.access_all_banks`, `permissions.ts:231`). Cannot create or edit another
Admin or a Super Admin — the level rule refuses it at
`access.ts:146`.

**Manager.** Owns one or more teams across their assigned banks. Works the loan
pipeline end to end: creates and edits files, records verifications, moves bank
orders, records disbursements. Deliberately **cannot approve a disbursement**
(`disbursements.approve` absent from `permissions.ts:249-251`), and can see but
not raise settlements.

**Team Leader.** Leads a team of executives. Same customer and file work as an
executive, plus the ability to **assign** files (`requests.assign`,
`permissions.ts:279`), bulk-import customers (`customers.import`, `:272`), and
edit bank orders (`:283`).

**Executive.** Field staff. Sources customers, opens files, uploads documents.
Sees only their assigned banks. This is the persona modelled by the browser-only
demo account (`frontend/src/lib/demo/config.ts:29-42`, which mirrors the
executive grant list literally).

---

## 3. Domain glossary

Every term, its table, and the route that serves it.

| Term | Table | Route mount | Notes |
|---|---|---|---|
| **User / Employee** | `users` (`identity.ts:97`) | `/api/users` (`app.ts:82`) | The frontend calls them *employees*; the schema calls them *users*. Carries DSA-specific fields `branch`, `target`, `achieved`, `avatarColor` (`identity.ts:111-116`) alongside the security fields `passwordHash`, `mustChangePassword`, `failedLoginAttempts`, `lockedUntil` (`:105-118`). |
| **Role** | `roles` (`identity.ts:28`) | `/api/roles` (`app.ts:83`) | `key` is the stable machine id; `name` is renameable; `level` is the hierarchy depth; `isSystem` protects Super Admin. |
| **Permission** | `permissions` (`identity.ts:57`), joined via `role_permissions` (`:73`) | `GET /api/roles/permissions` (`admin.routes.ts:500`) | Keys follow `resource.action`. The catalogue is generated from `PERMISSIONS` (`permissions.ts:11-134`). |
| **Team** | `teams` (`identity.ts:171`), `team_members` (`:196`) | `/api/teams` (`app.ts:84`) | A team has one optional leader and many members. |
| **Refresh token** | `refresh_tokens` (`identity.ts:146`) | — (internal to `/api/auth`) | Only the SHA-256 hash is stored (`identity.ts:153`). Server-side session records so logout genuinely revokes. |
| **Bank** | `banks` (`domain.ts:18`) | `/api/banks` (`app.ts:80`) | The partner lender. Carries `commission_rate`, `settlement_cycle`, `spoc_name`, `products_offered[]`, `vendor_id`, `portal_url` (`domain.ts:25-35`). |
| **Bank access** | `user_bank_access` (`domain.ts:60`) | `PUT /api/users/:id/banks` (`admin.routes.ts:386`) | The spine of tenant isolation. Many-to-many between users and banks. |
| **Customer** | `customers` (`domain.ts:88`) | `/api/customers` (`app.ts:81`) | The borrower. `bank_reference_id` is **required** and unique per bank, case-insensitively, among live rows (`domain.ts:140-142`). Aadhaar is stored as a peppered SHA-256 hash plus the last four digits (`:113-114`); the raw number never lands in a column. |
| **Loan / File / Request** | `loans` (`operations.ts:85`) | `/api/loans` (`app.ts:85`) | See §1.3. Statuses: Draft → Submitted → Under Review → Approved → Disbursed → Rejected → Closed (`operations.ts:464-472`). Types: Personal, Business, Gold, Vehicle, Home, Loan Against Property (`:474-481`). |
| **Bank order** | `bank_orders` (`operations.ts:183`) | `/api/bank-orders` (`app.ts:87`) | The file's progress **inside the lender**. Stages: Login → Credit Check → Field Verification → Sanction → Disbursal Queue (`operations.ts:493-499`). Statuses: In Progress / On Hold / Cleared / Returned (`:501`). Carries `sla` and `officer`. |
| **Verification** | `verifications` (`operations.ts:144`) | `/api/verifications` (`app.ts:86`) | Exactly one row per loan (`verifications_loan_unique`, `:176`). A row exists even when verification is **not** required, so the record shows *that the requesting bank handled it* rather than leaving a gap (`:140-143`). Statuses: Pending / Requested / In Progress / Verified / Rejected / Failed / Expired (`:483-491`). |
| **Service provider** | `service_providers` (`operations.ts:34`) | `/api/service-providers` (`app.ts:94`) | Third-party field-verification agencies. **Not bank-owned**, so it deliberately uses a hand-written router rather than the scoped factory (`operations.routes.ts:432-437`). |
| **Funding source** | `funding_sources` (`operations.ts:60`) | `/api/funding-sources` (`app.ts:93`) | `own_funds` / `bank` / `external` (`:514`). `bank_id` is set only when the source *is* a bank, so scoping still works (`:57-59`). A `bank` source without a `bank_id` is rejected (`operations.routes.ts:424-428`). |
| **Disbursement** | `disbursements` (`operations.ts:215`) | `/api/disbursements` (`app.ts:88`) | Money actually moving. Modes NEFT / RTGS / IMPS (`:502`); statuses Credited / In Transit / Failed (`:503`). **UTR is uniquely indexed** among live rows because a duplicate UTR almost always means a double entry (`:248-252`). |
| **Settlement** | `settlements` (`operations.ts:259`) | `/api/settlements` (`app.ts:89`) | The **monthly commission invoice per bank**. `(bank_id, lower(period))` is unique among live rows (`:283-285`). Carries `gross_commission`, `tds`, `net_payable`, `invoice_no`. Statuses Paid / Pending / Disputed (`:504`). |
| **Transaction** | `transactions` (`operations.ts:290`) | `/api/transactions` (`app.ts:90`) | A money event. Types: Disbursement / EMI Collection / Commission / Refund (`:505`). Optionally links to a loan, a disbursement, a settlement and a funding source. |
| **Ledger entry** | `ledger_entries` (`operations.ts:326`) | `/api/ledger` (`app.ts:91`) | Double-entry style row with `debit`, `credit` and a stored running `balance`. Categories: Commission / Disbursement / Payout / Expense / Tax (`:507-513`). |
| **Document** | `documents` (`operations.ts:356`) | `/api/documents` (`app.ts:92`) | KYC and file paperwork. `storage_key` is declared as an object-store key with the comment *"No file bytes are kept in Postgres"* (`:370-371`). |
| **Notification** | `notifications` (`operations.ts:387`) | `/api/notifications` (`app.ts:97`) | Per-user, not per-bank, so it is deliberately **not** bank-scoped (`admin.routes.ts:951-954`). |
| **Assignment history** | `assignment_history` (`operations.ts:407`) | — **no route** | Intended to answer "who had this record and when". |
| **Recycle bin** | `recycle_bin_entries` (`governance.ts:62`) | `/api/recycle-bin` (`app.ts:95`) | A cross-type index over soft-deleted rows so the Bin screen does not need a UNION over a dozen tables (`governance.ts:55-61`). Twelve record types are registered (`recycle-bin.ts:28-89`). |
| **Audit log** | `audit_logs` (`governance.ts:23`) | `/api/audit-logs` (`app.ts:96`) | Append-only, enforced by a `BEFORE UPDATE OR DELETE` trigger rather than by application code (`governance.ts:16-22`; `0001_governance_guards.sql:6,16`). |
| **Import batch** | `import_batches` (`governance.ts:113`), `import_rows` (`:145`) | `/api/imports` (`app.ts:98`) | Upload → validate → preview → confirm → import. Nothing touches the live table until the batch is explicitly confirmed (`governance.ts:107-111`). |
| **App settings** | `app_settings` (`governance.ts:95`) | — **no route** | Key/value configuration intended for Super Admin (retention, import limits, feature switches). |

---

## 4. Core workflows, requirements and acceptance criteria

Status vocabulary:

| Label | Meaning |
|---|---|
| **IMPLEMENTED** | Backend enforces it *and* a UI reaches it. |
| **PARTIAL** | Enforced on one side only, or enforced but incompletely. |
| **DEMO** | The UI presents the action as succeeding but issues no HTTP request; nothing is persisted. |
| **MISSING** | No code path exists. |

---

### R1 — Employee onboarding and access management

**R1.1** An administrator shall create an employee account by supplying name,
work email, employee code, role and (optionally) branch, phone, target, assigned
banks and a team.

- *AC1* — `POST /api/users` with a valid payload returns `201` and a body
  containing `{ id, email, name }`.
- *AC2* — The account is created with `mustChangePassword = true`.
- *AC3* — Bank assignments and team membership are written in the **same
  transaction** as the user row; a failure leaves no partial account.
- *AC4* — The response includes a `temporaryPassword` only when the caller did
  not supply one.

**Current status: IMPLEMENTED (working tree).** Handler
`src/modules/admin.routes.ts:159-249`; transaction `:192-239`;
`mustChangePassword: true` at `:208`; one-time password returned at `:241-245`.
UI at `frontend/src/app/(app)/employees/page.tsx:146-195`.
**At HEAD the Employees screen was frontend-only** — the 622-line diff on that
file is what wired it to the API.

---

**R1.2** An actor shall not be able to create, edit, delete or promote a user
whose role level is less than or equal to their own.

- *AC1* — An Admin (level 10) creating a user with the Admin role receives `403`.
- *AC2* — An Admin editing a Super Admin (level 0) receives `403`.
- *AC3* — A holder of `system.manage_any_user` bypasses both.
- *AC4* — The role picker in the UI does not offer roles the server would refuse.

**Current status: IMPLEMENTED.** Rule at
`src/services/access.ts:144-149`; asserted on create
(`admin.routes.ts:168`), on edit (`:261`), on promotion (`:266`), on password
reset (`:340`), on bank assignment (`:394`) and on delete (`:441`). The UI mirror
that hides unassignable roles is at
`frontend/src/app/(app)/employees/page.tsx:110-114`. Covered by
`src/tests/workflow.test.ts:42` ("admin cannot escalate").

---

**R1.3** An actor shall not be able to grant a permission they do not themselves
hold, whether by creating a role or by editing one.

- *AC1* — Creating a role containing `system.access_all_banks` without holding it
  returns `403` naming the offending keys.
- *AC2* — `PUT /api/roles/:id/permissions` applies the same check.
- *AC3* — The permissions of the `isSystem` role cannot be edited at all.

**Current status: IMPLEMENTED.** `assertCanGrantPermissions`
(`access.ts:166-174`), called at `admin.routes.ts:533` (create) and `:629`
(replace). System-role guard at `:626`. Database-level protection at
`drizzle/0001_governance_guards.sql:56,81`.

---

**R1.4** An administrator shall assign and re-assign the set of banks an employee
may see, and shall not be able to grant access to a bank they cannot see
themselves.

- *AC1* — `PUT /api/users/:id/banks` replaces the assignment set atomically.
- *AC2* — Every bank id in the payload is checked against the actor's own scope.
- *AC3* — A non-existent bank id returns `400`.
- *AC4* — The previous and new sets are both written to the audit log.

**Current status: PARTIAL — backend complete, no UI for re-assignment.**
Handler `admin.routes.ts:386-432`; scope check `:396`; existence check
`:398-404`; audit diff `:419-425`. Banks *can* be set at creation time
(`employees/page.tsx:169` sends `bankIds`), but **no frontend code calls
`PUT /api/users/:id/banks`** — verified by exhaustive grep of `api.*` and
`apiRequest` call sites across `frontend/src`. Once an employee exists, their
bank access cannot be changed from the UI.

---

**R1.5** An administrator shall revoke and restore an employee's access without
deleting the account.

- *AC1* — `PATCH /api/users/:id` with `{ status: "Inactive" }` blocks login.
- *AC2* — A deactivated account is rejected at login and on every subsequent
  authenticated request, not merely at login.

**Current status: IMPLEMENTED.** UI toggle at
`frontend/src/app/(app)/employees/page.tsx:219-231`. Login check
`src/modules/auth.routes.ts:131`. Per-request check
`src/services/access.ts:52` — `loadAuthContext` re-reads the user on
**every** request (`src/middleware/auth.ts:15-26`), so revocation takes
effect on the next request rather than at token expiry. Covered by
`src/tests/employee-lifecycle.test.ts:327`.

---

**R1.6** The last active Super Admin shall not be removable.

- *AC1* — Deleting the sole active `isSystem` role holder returns `409`.
- *AC2* — A user cannot delete their own account.

**Current status: IMPLEMENTED.** `admin.routes.ts:438` (self-delete) and
`:444-451` (last super admin).

---

**R1.7** Teams shall be created, named, given a leader, and have their membership
set.

**Current status: PARTIAL.** `GET /api/teams` (`admin.routes.ts:700`),
`POST /api/teams` (`:728`), `PUT /api/teams/:id/members` (`:749`),
`DELETE /api/teams/:id` (`:784`) all exist. **There is no Teams screen** — no
`frontend/src/app/(app)/teams/` directory, and `frontend/src/lib/nav.ts:30-66`
has no Teams entry. The only frontend consumer is a read of `/teams` to populate
a dropdown (`frontend/src/hooks/use-reference.tsx:69`). Team creation and
membership management are unreachable from the product.

---

### R2 — Authentication and credential lifecycle

**R2.1** A user shall authenticate with email and password. The client shall not
be able to assert its own role.

- *AC1* — `POST /api/auth/login` returns an access token, its TTL, and a profile
  containing the role and permission set resolved **from the database**.
- *AC2* — No request field influences the role granted.

**Current status: IMPLEMENTED.** `auth.routes.ts:81-151`. The handler comment
records the change explicitly: *"the client does not tell us which role it wants.
The demo frontend let the user pick from a dropdown; the role now comes from the
user record and nowhere else"* (`:74-80`). The dropdown is gone from the login
screen (`frontend/src/app/login/page.tsx:47-48`).

---

**R2.2** The access token shall be short-lived and shall never be persisted in
browser storage; the refresh token shall be an httpOnly cookie that rotates on
every use.

- *AC1* — Access token TTL defaults to 15 minutes.
- *AC2* — The access token lives in a module variable, not `localStorage`.
- *AC3* — Each refresh revokes the presented token and issues a new one.
- *AC4* — Presenting an already-revoked refresh token revokes **every** session
  for that user (reuse is treated as compromise).
- *AC5* — Concurrent 401s share a single in-flight refresh.

**Current status: IMPLEMENTED.** TTL `src/config/env.ts:13`; module
variable `frontend/src/lib/api.ts:17`; rotation `auth.routes.ts:183-188`; reuse
detection `:172-181`; single-flight refresh `frontend/src/lib/api.ts:82-102`.
Only the SHA-256 hash of the refresh token is stored
(`identity.ts:153`, `auth.routes.ts:41`).

---

**R2.3** Repeated failed logins shall lock the account temporarily, and response
timing shall not reveal whether an email address exists.

- *AC1* — 8 consecutive failures lock the account for 15 minutes.
- *AC2* — A login attempt against an unknown address performs a full argon2id
  verification against a fixed dummy hash.
- *AC3* — A successful login clears the counter.

**Current status: IMPLEMENTED.** Constants `auth.routes.ts:28-29`; lockout write
`:117-124`; timing equalisation `:108-111` with `DUMMY_HASH` at `:153-155`;
counter reset `:134-137`.

**Gap:** this is a **per-account** lockout only. There is **no rate limiting** of
any kind on the API — no `express-rate-limit`, no per-IP throttle, no global
limiter. An attacker can spray one attempt each against a large list of addresses
without ever tripping a lock. See NFR-SEC-4.

---

**R2.4** An administrator shall issue a temporary password that the recipient
must replace on first sign-in.

- *AC1* — The generated password satisfies the password policy by construction.
- *AC2* — The plaintext is returned exactly once and never stored or logged.
- *AC3* — The recipient's `must_change_password` flag is set.
- *AC4* — The UI presents the credential in a one-time hand-over panel with copy
  affordances and an explicit "this will not be shown again" warning.

**Current status: IMPLEMENTED (working tree).** Generator
`src/lib/password.ts:72-87` — seeds one character of each required class,
fills, then Fisher–Yates shuffles with rejection sampling, so the policy
guarantee does not depend on luck. Ambiguous characters `0/O/1/l/I` are excluded
because the value is read off a screen and typed by hand (`:46-54`). Policy at
`:89-98`: minimum 12 characters, lower + upper + digit. One-time return at
`admin.routes.ts:244` (create) and `:377` (reset). Hand-over UI at
`frontend/src/components/shared/credential-handover.tsx:80-110`.
**All of `password.ts:46-98` is new in the working tree** (43 added lines).

---

**R2.5** An administrator shall reset a colleague's password, and the reset shall
terminate that colleague's existing sessions.

- *AC1* — `POST /api/users/:id/reset-password` returns a fresh temporary password.
- *AC2* — Every non-revoked refresh token for the target is revoked in the same
  transaction.
- *AC3* — A locked-out account becomes usable again (`failed_login_attempts`
  reset, `locked_until` cleared).
- *AC4* — The hierarchy rule applies — you cannot reset a peer's or a superior's
  password and take over their account.

**Current status: IMPLEMENTED (working tree).**
`admin.routes.ts:328-383`. Hierarchy `:340`; transaction `:344-371`; token
revocation `:360-363`; lockout clear `:353-354`. The route comment records why it
was added: *"`users.reset_password` has been in the catalogue since the first
migration but nothing implemented it"* (`:316-327`). UI at
`frontend/src/app/(app)/employees/page.tsx:197-217`. Covered by
`src/tests/employee-lifecycle.test.ts:213`.

---

**R2.6** A user on a temporary password shall be able to do nothing except
replace it.

- *AC1* — Every authenticated route rejects a request from an account with
  `must_change_password = true`, except the change-password route itself.
- *AC2* — A page reload does not drop the user out of the forced change.
- *AC3* — A successful change clears the flag and revokes all sessions.

**Current status: PARTIAL — AC2 and AC3 met, AC1 is NOT met.**

- AC2 ✅ — `mustChangePassword` is carried on the **profile** returned by
  `/auth/refresh` and `/auth/me`, not only on the login response
  (`auth.routes.ts:66-70`, sourced from `access.ts:82`). Both are working-tree
  additions.
- AC3 ✅ — `auth.routes.ts:240-254`: flag cleared, `password_changed_at` set,
  every refresh token for the user revoked.
- AC1 ❌ — **`mustChangePassword` is written and returned but never asserted as a
  guard.** Exhaustive grep across `src` shows the flag appears only in
  the schema, the seed, three write sites in `admin.routes.ts`, the auth
  responses and the auth context. **There is no check in
  `src/middleware/` or in any route handler.** Enforcement is
  **React-only**, at `frontend/src/components/layout/app-shell.tsx:39-48`: the
  shell computes `mustChangePassword`, redirects to `/change-password`, and holds
  the loading state so no other page mounts. Because there is no `middleware.ts`
  and every page is a client component, an account on a temporary password that
  bypasses the browser — a direct API call with the access token it was just
  issued — has **full permissions of its role**. This is a real authorisation
  gap, not a cosmetic one.

---

**R2.7** A user shall change their own password, and doing so shall sign them out
everywhere.

- *AC1* — The current password must be supplied and verified.
- *AC2* — The new password must satisfy the policy; a violation returns `422`.
- *AC3* — All refresh tokens are revoked and the cookie is cleared.
- *AC4* — The client mirrors the policy so the user is told what is wrong while
  typing rather than after a round trip.

**Current status: IMPLEMENTED (working tree).** Handler
`auth.routes.ts:221-262`; verification `:233`; policy `:237-238`; revocation
`:251-254`. Dedicated page
`frontend/src/app/(app)/change-password/page.tsx:37-64`, which signs out
explicitly rather than leaving the user holding a dead session (`:19-23`).
Settings-screen equivalent at
`frontend/src/app/(app)/settings/page.tsx:265-322` — **at HEAD this was a
three-line `toast.success` with no request at all**; the working tree replaces
it with a real call. Client mirror at
`frontend/src/lib/password-policy.ts:9-20`, which documents itself as a mirror
and names the server as the authority (`:1-7`).

---

**R2.8** A presentation account shall be available that demonstrates the product
without a backend.

- *AC1* — Demo credentials are matched entirely in the browser and never
  transmitted.
- *AC2* — The demo session lives in `sessionStorage` so it dies with the tab.
- *AC3* — The demo user is scoped to the Executive route set; administrative
  screens are unreachable even by typing the URL.

**Current status: IMPLEMENTED, with one defect.** Config
`frontend/src/lib/demo/config.ts:14-15,29-68`; browser-only match
`frontend/src/hooks/use-auth.tsx:174-185`; `sessionStorage`
`frontend/src/lib/demo/session.ts:13-25`; route guard
`frontend/src/components/layout/app-shell.tsx:28-32`.

**Defect:** `disableDemoMode()` has exactly **one** call site —
`frontend/src/hooks/use-auth.tsx:212`, inside `signOut`'s demo branch. The real
sign-in path (`:187-201`) never clears the flag. A user who signs in with real
credentials in a tab that previously ran the demo, without signing out first,
keeps `isDemoMode() === true`, and `apiRequest` short-circuits to the browser
fixture layer for every call (`frontend/src/lib/api.ts:118-127`). They will see
demo data under a real identity.

---

### R3 — Customer management

**R3.1** A customer record shall be created against exactly one bank and shall
carry that bank's own reference for the customer.

- *AC1* — `bank_reference_id` is required.
- *AC2* — `(bank, reference)` is unique case-insensitively among live rows;
  the same reference under a different bank is allowed.
- *AC3* — A restored-from-bin record does not permanently poison a reference id.
- *AC4* — A pre-flight availability check exists so the clash is reported before
  the form is submitted.

**Current status: IMPLEMENTED (backend); PARTIAL (frontend).** Column
`domain.ts:96`; partial unique index `domain.ts:140-142` with the three-case
worked example at `:132-139`; validator `customers.routes.ts:27`. Pre-flight
route `GET /api/customers/check/reference` at `customers.routes.ts:293-327` —
**never called by the frontend** (verified by grep). The clash therefore only
surfaces as a database error on submit. Covered by
`src/tests/authorization.test.ts:309`.

---

**R3.2** Customer data shall be validated server-side against Indian formats.

- *AC1* — Mobile: exactly 10 digits.
- *AC2* — PAN: `[A-Z]{5}[0-9]{4}[A-Z]`, upper-cased.
- *AC3* — Aadhaar: exactly 12 digits after whitespace and hyphens are stripped.
- *AC4* — Pincode: exactly 6 digits.
- *AC5* — CIBIL: integer 300–900.

**Current status: IMPLEMENTED.** `customers.routes.ts:18-22` (Aadhaar), `:38`
(mobile), `:45` (pincode), `:47-54` (PAN), `:58` (CIBIL). Note these are **Zod
validators, not database constraints** — the schema has zero CHECK constraints,
so a write that bypasses the API layer is unconstrained.

---

**R3.3** Every customer read and write shall be restricted to banks the caller
may see.

- *AC1* — A list request returns only in-scope rows regardless of query
  parameters; a client filter can narrow the scope but never widen it.
- *AC2* — A direct fetch by id of an out-of-scope customer returns `404`, not
  `403` — out-of-scope and non-existent are indistinguishable.
- *AC3* — Creating a customer under a bank the caller is not assigned to is
  refused even with a hand-crafted payload.
- *AC4* — Moving a customer to another bank requires access to the destination.
- *AC5* — A user with zero bank assignments sees nothing, not everything.

**Current status: IMPLEMENTED.** Scope applied before any client filter
(`customers.routes.ts:99-107`); `404` on out-of-scope id (`:158-159`);
payload-side assertion on create (`:172-174`); destination check on move
(`:234-237`); fail-closed sentinel UUID for the empty-assignment case
(`access.ts:108-114`). Covered by
`src/tests/authorization.test.ts:118`.

---

**R3.4** Customers shall be bulk-imported from Excel through a staged
upload → validate → preview → confirm flow.

- *AC1* — A template download exists whose columns are generated from the same
  definition the validator uses, so the two cannot drift.
- *AC2* — Upload stages every row with a status (`valid` / `invalid` /
  `duplicate`) and per-field errors; **nothing** is written to `customers`.
- *AC3* — Rows referencing a bank the uploader cannot write to are rejected, not
  silently reassigned.
- *AC4* — Duplicates are detected both against existing data and within the file.
- *AC5* — Confirm inserts only `valid` rows, in one transaction, and re-checks
  bank access at confirm time.
- *AC6* — A batch belongs to its uploader and expires after 24 hours.

**Current status: IMPLEMENTED.** Shared column definition
`imports.routes.ts:48-64`; template `:112-149`; staging `:155-331` with
`nothing-written` guarantee documented at `:151-154`; bank-access rejection
`:239-248`; dual duplicate detection `:250-269`; transactional confirm
`:361-472` with re-check at `:398-400`; ownership `:343` and `:376`; 24-hour
expiry `:302` and `:378`. Upload limits: `MAX_UPLOAD_MB` default 10, single file,
xlsx/xls/csv only (`:27-42`). UI at
`frontend/src/components/shared/customer-import-dialog.tsx:44-95`, mounted from
`frontend/src/app/(app)/customers/page.tsx:1031`. Covered by
`src/tests/workflow.test.ts:486`.

---

**R3.5** A customer shall be editable and deletable from the customer detail
screen.

**Current status: DEMO.** `frontend/src/app/(app)/customers/[id]/page.tsx` makes
**zero write calls**. "Save changes" is a `toast.success` and a dialog close
(`:458-465`); "Delete" is a `toast.success` claiming *"moved to archived
records"* (`:483-493`); "Print" is `toast.info("Sent to printer")` (`:185`). The
backing endpoints `PATCH /api/customers/:id` (`customers.routes.ts:214`) and
`DELETE /api/customers/:id` (`:266`) both exist and are fully implemented.
Deletion **is** wired on the customer *list* page
(`frontend/src/app/(app)/customers/page.tsx:261`).

---

**R3.6** A scanned written application form shall be attachable to a customer.

**Current status: DEMO.** `handleManualFormUpload`
(`frontend/src/app/(app)/customers/page.tsx:232-245`) reads the selected `File`,
discards it, and toasts *"has been queued for verification"*. No request is
issued and nothing is queued. See §6.4 for why no file can be stored at all.

---

### R4 — Loan / file lifecycle

**R4.1** A file shall be opened against one customer and one bank, and the
customer must belong to the same bank as the file.

- *AC1* — Creating a loan whose customer belongs to a different bank returns
  `400` with a message naming the mismatch.
- *AC2* — The check runs on both create and update.

**Current status: IMPLEMENTED.** `assertSameBank`
(`operations.routes.ts:28-48`), wired as the loans `beforeWrite`
(`:96-99`). The rationale is recorded at `:28-32`: without it a user could attach
a bank-A customer to a bank-B loan and read the customer's name back through the
loan endpoint.

---

**R4.2** A file shall carry a human-readable code, generated by the system.

- *AC1* — Loans are `LN-1001`+, disbursements `DSB-5001`+, settlements
  `STL-3301`+, bank orders `BO-2401`+, transactions `TXN-77001`+, ledger entries
  `LG-9001`+, customers `CUS-10001`+.
- *AC2* — Codes are unique among live rows.

**Current status: PARTIAL — codes generate, but the generator is not
concurrency-safe.** Prefixes: `operations.routes.ts:60-61` (LN), `:224-225` (BO),
`:257-258` (DSB), `:292-293` (STL), `:329-330` (TXN), `:359-360` (LG);
`customers.routes.ts:86-89` (CUS). Uniqueness indexes at
`operations.ts:129,207,247,282,317,349` and `domain.ts:143-145`.
`nextCode()` is `SELECT count(*) + 1` outside any transaction
(`scoped-resource.ts:87-91`), so two simultaneous creates compute the same code
and the second insert fails on the unique index. It fails safe (a `409`, not a
duplicate) but it is a real availability defect under concurrency.

---

**R4.3** A file shall move through Draft → Submitted → Under Review → Approved →
Disbursed, with Rejected and Closed as terminals.

- *AC1* — Status transitions are recorded with the actor and timestamp.
- *AC2* — An invalid status value is rejected.

**Current status: PARTIAL.** The status enum is enforced on write
(`operations.routes.ts:83-85`) and `POST /api/loans/:id/approve` sets status,
`approved_by`, `approved_at` and writes an audit row
(`scoped-resource.ts:271-318`). **But there is no transition table** — any status
may be set from any other. `Closed → Draft` is accepted. And the UI never calls
it: `updateStatus` in `frontend/src/app/(app)/loans/page.tsx:68-74` calls
`refresh()`, mutates local component state and toasts. **No HTTP request is
issued.** The list page *can* create loans (`:83`) but cannot change one.

---

**R4.4** A file shall be assignable to a user and/or a team, and every
reassignment shall be retained so "who had this and when" is answerable.

**Current status: PARTIAL — columns exist, history does not.**
`loans.assigned_user_id` / `assigned_team_id` (`operations.ts:118-119`) are
writable through the factory's `PATCH` and filterable on list
(`operations.routes.ts:63`). The `assignment_history` table exists
(`operations.ts:407-426`) with a documented purpose — *"Every reassignment is
kept"* (`:406`) — but **grep across all of `src` finds zero references to
`assignmentHistory` outside its own schema definition.** Nothing ever writes a
row. There is also no assignment UI.

---

### R5 — Documents and KYC

**R5.1** A document shall be recorded against a customer and/or a loan, with type,
filename, size, MIME type, checksum and a storage key.

**Current status: PARTIAL — metadata only.** Table `operations.ts:356-385`;
router `operations.routes.ts:380-403`. The UI stages real `File` objects and
posts **metadata only** — `fileName`, `fileSize`, `mimeType` — with no bytes
(`frontend/src/app/(app)/documents/page.tsx:70-99`).

---

**R5.2** The document's bytes shall be stored in an object store and retrievable.

**Current status: MISSING.** There is no file storage of any kind.
`documents.storage_key` is declared (`operations.ts:371`) and accepted by the
create schema (`operations.routes.ts:399`), but **grep across `src` and
`frontend/src` finds no other reference** — nothing ever writes it, nothing ever
reads it. `multer` appears in exactly one module, `imports.routes.ts`, configured
with `memoryStorage()`; the buffer is parsed by ExcelJS (`:167`) and discarded.
`/api/documents` is JSON CRUD over a metadata table. There is no upload endpoint,
no download endpoint, no S3/R2/GCS dependency, and no signed-URL code.

---

**R5.3** A document shall be marked Verified or Rejected by an authorised user,
and shall be deletable.

**Current status: DEMO.** `setStatus`
(`frontend/src/app/(app)/documents/page.tsx:104-107`) and `remove` (`:109-112`)
both call `refresh()` and toast; neither issues a request. The backing routes
`PATCH /api/documents/:id` and `DELETE /api/documents/:id` exist via the factory
(`operations.routes.ts:380-403`, `scoped-resource.ts:205,252`) and are never
called.

---

**R5.4** A customer's KYC status shall be tracked as Verified / Pending /
Rejected.

**Current status: PARTIAL.** Column `customers.kyc` (`domain.ts:115`), enum
enforced on write (`customers.routes.ts:57`), default `Pending`, and set to
`Pending` on every imported row (`imports.routes.ts:422`). There is **no
workflow** connecting document verification to KYC status — nothing transitions
`kyc` automatically, and no UI sets it.

---

### R6 — Bank order processing

**R6.1** A bank order shall track a file's progress inside the lender through
Login → Credit Check → Field Verification → Sanction → Disbursal Queue, against
an SLA and a named officer.

- *AC1* — The loan and the customer on a bank order must belong to the same bank
  as the order.
- *AC2* — Stage and status are enum-validated.
- *AC3* — SLA breaches are visible.

**Current status: PARTIAL.** Table `operations.ts:183-213`; router
`operations.routes.ts:215-246`; cross-bank integrity `:241-245`; enums
`:234-237`; `sla` column and index `operations.ts:199,211`. **SLA breach is not
computed or surfaced anywhere** — no query, no badge, no alert.

---

**R6.2** An operator shall move a bank order to the next stage and record a
remark against the file trail.

**Current status: DEMO.** `frontend/src/app/(app)/bank-orders/page.tsx` makes
**zero write calls of any kind**. `moveStage` (`:58-62`) and `saveRemark`
(`:64-73`) mutate local state and toast — `saveRemark` even claims *"Remark saved
to the file trail"*. `PATCH /api/bank-orders/:id` exists and is never called.

---

### R7 — Verification

**R7.1** Verification shall be conditional. When a file requires third-party
verification a service provider is mandatory; when it does not, the system shall
record **that the requesting bank handled it** rather than leaving a gap.

- *AC1* — `POST /api/loans/:id/verification` with `required: true` and no
  `serviceProviderId` returns `400`.
- *AC2* — With `required: false` the row is created with
  `handled_by_bank = true`, status `Verified`, result
  `"Handled by the requesting bank"`, and `completed_at` set.
- *AC3* — With `required: true` the row is created with status `Requested` and
  `requested_at` set.
- *AC4* — A loan may have at most one verification row; a second attempt returns
  `409`.
- *AC5* — The loan's `verification_required` flag is updated to match.

**Current status: IMPLEMENTED (backend); MISSING (frontend).** Handler
`operations.routes.ts:107-183`; conditional rule `:130-135`; branch `:150-158`;
uniqueness `:137-142` backed by the index at `operations.ts:176`; flag sync
`:164-167`. **There is no verification UI at all** — no
`frontend/src/app/(app)/verification/` directory, no nav entry
(`frontend/src/lib/nav.ts:30-66`), and no frontend call to `/verifications` or
`/loans/:id/verification`. All five verification endpoints are unreachable from
the product.

---

**R7.2** Service providers shall be maintained as a master list.

**Current status: PARTIAL — backend only.** `GET`, `POST` and `PATCH` at
`operations.routes.ts:450`, `:463`, `:489`. Deliberately **not** bank-scoped, with
the reason recorded: feeding a null bank column into the scope filter would
silently hide every row from scoped users (`:432-436`). No UI, no nav entry.

---

### R8 — Approval and rejection

**R8.1** Approval shall be a distinct, separately-permissioned action that
records who approved and when.

- *AC1* — `POST /api/{resource}/:id/approve` requires the resource's `approve`
  permission, which is separate from `edit`.
- *AC2* — The action sets `status`, `approved_by`, `approved_at` and optionally
  `notes`.
- *AC3* — An audit row of action `approved` is written with a full before/after
  diff.
- *AC4* — Approve endpoints exist only where the domain has an approval concept.

**Current status: IMPLEMENTED (backend); MISSING (frontend).** Factory
`scoped-resource.ts:271-318`. Approve is emitted only when
`permissions.approve` is configured, which is true for exactly four resources:
loans (`requests.approve`, `operations.routes.ts:58`), verifications
(`verification.approve`, `:192`), disbursements (`disbursements.approve`,
`:255`) and settlements (`settlements.approve`, `:289`). **No frontend code calls
any `/approve` endpoint.**

---

**R8.2** Rejection shall be recorded with a reason.

**Current status: PARTIAL.** `Rejected` is a valid status for loans
(`operations.ts:464-472`), verifications (`:483-491`) and documents
(`operations.routes.ts:401`), and the approve route accepts an optional `notes`
field of up to 1000 characters (`scoped-resource.ts:289`). **A reason is never
required** — a file can be rejected with no explanation, and no UI exists to
supply one.

---

### R9 — Disbursement

**R9.1** A disbursement shall record the amount, mode, UTR, date, status and
where the money was credited, against a loan, a customer, a bank and optionally a
funding source.

- *AC1* — A duplicate UTR is rejected.
- *AC2* — The loan and customer must belong to the disbursement's bank.
- *AC3* — Mode is one of NEFT / RTGS / IMPS; status is one of Credited /
  In Transit / Failed.

**Current status: IMPLEMENTED (create); PARTIAL overall.** Table
`operations.ts:215-257`; UTR unique index `:248-252` with the rationale recorded
inline (*"a duplicate almost always means a double-entry, so it is rejected
rather than silently accepted"*); cross-bank integrity
`operations.routes.ts:276-280`; enums `:269,271`. The UI **can** create a
disbursement (`frontend/src/app/(app)/disbursement/page.tsx:63`).

---

**R9.2** An operator shall confirm a disbursement as credited once it appears on
the bank statement, and shall retry a failed transfer.

**Current status: DEMO.** `markCredited`
(`frontend/src/app/(app)/disbursement/page.tsx:81-85`) and `retry` (`:87-91`)
call `refresh()` and toast — `retry` claims *"Transfer resubmitted with corrected
beneficiary"*, which is doubly untrue: no request is made and no beneficiary
correction exists anywhere in the system. `PATCH /api/disbursements/:id` and
`POST /api/disbursements/:id/approve` both exist and are never called.

---

**R9.3** Funding sources shall be maintained, and a `bank`-type source shall
reference a bank.

**Current status: PARTIAL — backend only.** Five endpoints via the factory
(`operations.routes.ts:405-430`); the `bank`-type rule at `:424-428`. No UI, no
nav entry, no frontend call.

---

### R10 — Transactions

**R10.1** Every money event shall be recorded as a transaction of type
Disbursement / EMI Collection / Commission / Refund, optionally linked to the
loan, disbursement, settlement and funding source it belongs to.

**Current status: PARTIAL.** Table `operations.ts:290-324` with all four foreign
keys; router `operations.routes.ts:321-349`; ordering by `occurred_at` rather
than `created_at` (`:331`). **Transactions are never created automatically** — a
disbursement does not generate a transaction row, and a settlement does not
generate a commission row. The links are structurally available and functionally
unused. The UI reads `/transactions` but never writes it.

---

**R10.2** A pending transaction shall be settled.

**Current status: DEMO.** `settle`
(`frontend/src/app/(app)/transactions/page.tsx:36-40`) calls `refresh()` and
toasts. `PATCH /api/transactions/:id` exists and is never called.

---

### R11 — Settlement

**R11.1** A settlement shall be a per-bank, per-period commission invoice
carrying case count, gross commission, TDS and net payable.

- *AC1* — One settlement per `(bank, period)` among live rows.
- *AC2* — `net_payable` must equal `gross_commission − tds`; arithmetic that
  cannot be right is rejected.
- *AC3* — Status is one of Paid / Pending / Disputed.

**Current status: PARTIAL — backend enforces, no UI creates.** Table
`operations.ts:259-288`; composite unique index `:283-285`; arithmetic check
`operations.routes.ts:310-318`, with the tolerance and the reasoning recorded
inline (*"Not an invented calculation — it rejects arithmetic that cannot be
right"*, `:314`). The Settlements screen reads the list but has no create form.

---

**R11.2** A settlement shall be marked paid, or disputed with the lender.

**Current status: DEMO.** `markPaid`
(`frontend/src/app/(app)/settlements/page.tsx:35-42`) and `raiseDispute`
(`:44-48`) call `refresh()` and toast — `raiseDispute` claims *"Query sent to
[bank] SPOC"*, which is impossible: there is no email or messaging capability in
the system at all (see R13.1). `PATCH /api/settlements/:id` and
`POST /api/settlements/:id/approve` exist and are never called.

---

**R11.3** Settlement generation shall be derivable from the underlying files.

**Current status: MISSING.** There is no code that aggregates commission across
loans into a settlement. `settlements.cases`, `gross_commission` and `tds` are
all free-entry fields on the create payload
(`operations.routes.ts:300-302`). The dashboard sums `settlements.net_payable`
where status ≠ 'Paid' (`operations.routes.ts:550-551`) but never produces a
settlement.

---

### R12 — Ledger

**R12.1** The ledger shall record dated, categorised entries with debit, credit
and a running balance, optionally linked to a bank and a transaction.

**Current status: PARTIAL.** Table `operations.ts:326-354`; router
`operations.routes.ts:351-378`; ordering by `entry_date` (`:361`). The UI can
create an entry (`frontend/src/app/(app)/ledger/page.tsx:63`).

**The running balance is not maintained.** The schema comment states *"Running
balance is stored for display parity with the frontend, but it is recomputed
inside the same transaction that inserts the row"* (`operations.ts:342-343`).
**No such recomputation exists.** `balance` is an ordinary client-supplied field
on the create payload (`operations.routes.ts:375`), defaulting to 0. Whatever the
client sends is what is stored. **The schema comment is inaccurate as of this
commit.**

---

**R12.2** The ledger shall be exportable to Tally.

**Current status: PARTIAL.** A Tally XML serialiser exists
(`frontend/src/lib/export.ts:41-59`, producing `<ENVELOPE>` / `<VOUCHER>`
structures). It is a **client-side string builder over data already in the
browser** — there is no server-side export, no scheduled export, and no
validation against a Tally schema.

---

### R13 — Notifications

**R13.1** The system shall notify a user of events that need their attention.

**Current status: MISSING.** The `notifications` table exists
(`operations.ts:387-404`) with `title`, `message`, `severity`, `read`,
`link_href`. Three endpoints exist: `GET /api/notifications`
(`admin.routes.ts:955`), `POST /api/notifications/read-all` (`:974`),
`POST /api/notifications/:id/read` (`:987`). **Grep for
`insert(notifications` across all of `src` returns zero results.**
Nothing, anywhere, ever creates a notification row. The list endpoint will always
return `[]`.

**Email does not exist either.** Exhaustive grep across `src`,
`frontend/src`, `package.json` and `frontend/package.json` for
`nodemailer|sendgrid|resend|postmark|mailgun|smtp|sendMail` returns **zero
matches**. There are no `EMAIL_*`, `SMTP_*` or `MAIL_*` environment variables in
`src/config/env.ts:4-26` or in `.env.example`. There is no transport, no
provider, no template and no queue. A temporary password can only be handed over
by reading it off the screen — which is exactly what
`frontend/src/components/shared/credential-handover.tsx:95-107` instructs the
administrator to do.

---

**R13.2** A user shall mark notifications as read.

**Current status: DEMO, and the page is broken.** `markAll`
(`frontend/src/app/(app)/notifications/page.tsx:75-78`) mutates local state and
toasts; `POST /api/notifications/read-all` is never called. Separately, the page
seeds `items` from `rows` once at first render
(`:74 — React.useState<NotificationItem[]>(rows)`) and **never resyncs** — `rows`
is `[]` on the first render because the fetch has not resolved. The Notifications
page therefore renders empty even if the API returns data.

---

### R14 — Reports

**R14.1** Dashboard KPIs shall reflect the database, scoped to the viewer's
banks, and shall show zeroes on an empty database rather than fabricated numbers.

- *AC1* — Thirteen metrics are computed in a single scoped query.
- *AC2* — A Manager's totals reflect their banks; a Super Admin's reflect
  everything.
- *AC3* — An empty database returns zeroes.

**Current status: IMPLEMENTED.** `GET /api/dashboard/stats`
(`operations.routes.ts:521-578`), a single 13-subquery statement with the scope
predicate applied to each (`:527-533`). Companion endpoints
`GET /api/dashboard/loan-status` (`:580`) and `GET /api/dashboard/bank-performance`
(`:599`). All three are consumed by
`frontend/src/app/(app)/dashboard/page.tsx:40-49`. The intent is documented at
`operations.routes.ts:513-517`. Covered by
`src/tests/workflow.test.ts:377`.

---

**R14.2** An operator shall filter loans by date range, bank, employee and status
and export the result to Excel, PDF and CSV.

**Current status: PARTIAL — client-side only.** The Reports page loads up to 500
loans (`frontend/src/app/(app)/reports/page.tsx:43`) and filters them **in the
browser** (`:57-67`). "Excel" export writes an HTML `<table>` with an
`application/vnd.ms-excel` MIME type (`:71-84`) — not a real XLSX. "PDF" opens a
popup window and writes printable HTML (`:86-120`) — not a real PDF. There is
**no server-side report endpoint**, so any dataset larger than the 500-row page
size is silently truncated, and the `reports.view` permission
(`permissions.ts:110`) gates only the dashboard endpoints.

---

**R14.3** A per-employee performance view shall exist (target vs achieved).

**Current status: PARTIAL.** `users.target` and `users.achieved`
(`identity.ts:114-115`) are stored and returned by `GET /api/users`
(`admin.routes.ts:123-124`), and a chart component consumes them
(`frontend/src/components/charts/employee-target-chart.tsx`). **`achieved` is
never computed** — it is a free-entry integer on the create and update payloads
(`admin.routes.ts:51`). Nothing derives it from disbursed volume.

---

### R15 — Audit and data lifecycle

**R15.1** Every state change shall be recorded in an append-only audit log
carrying actor, action, record type, record id, bank, a human summary, a
before/after diff, IP address, user agent and request id.

- *AC1* — The audit row commits or rolls back **atomically** with the change it
  describes.
- *AC2* — `UPDATE` and `DELETE` on `audit_logs` are refused **by the database**,
  not by application code.
- *AC3* — Secrets never reach the audit table through a diff.
- *AC4* — A failed audit write does not mask the operation's own error but is
  logged at error level.

**Current status: IMPLEMENTED.** Table `governance.ts:23-53`; writer
`src/services/audit.ts:50-78`, which accepts the caller's `db` handle so
that in-transaction callers get atomicity (`:45-49`); trigger
`audit_logs_no_update` at `drizzle/0001_governance_guards.sql:6,16`, with
the reason for choosing a trigger over privilege revocation recorded at
`governance.ts:16-22` (Neon's role model varies by plan; a trigger holds
regardless). Redaction list `audit.ts:18-27`. Read route
`admin.routes.ts:902-942` — read-only by construction, there is no write route.
Covered by `src/tests/authorization.test.ts:401`.

**Two defects.**
1. The redaction list covers `password`, `passwordHash`, `password_hash`,
   `aadhaar`, `aadhaarHash`, `aadhaar_hash`, `token`, `tokenHash`
   (`audit.ts:18-27`). It does **not** cover `pan`, `aadhaarLast4`, `mobile`,
   `email`, `dob` or `address`. A customer `PATCH` therefore writes personal data
   into a table that is immutable and undeletable by design. See NFR-DP-3.
2. The action `password_reset` is written at `admin.routes.ts:366` but is **not**
   in the `auditActions` union (`governance.ts:165-181`). Nothing breaks — the
   column is free text and there are no CHECK constraints — but any consumer
   filtering on the declared action list will miss password resets.

---

**R15.2** Deletion shall be reversible for a retention period, and the audit trail
shall survive a permanent purge.

- *AC1* — Delete sets `deleted_at` and writes a recycle-bin index entry in one
  transaction; a record can never be marked deleted without a restorable entry.
- *AC2* — Restore clears the soft-delete columns and marks the entry restored.
- *AC3* — Permanent delete removes the row but **retains** the bin entry marked
  `purged_at`, so the audit trail still shows the record existed, who deleted it
  and who purged it.
- *AC4* — Permanent delete requires an explicit `confirm: true` flag so a stray
  request cannot purge anything by accident.
- *AC5* — Retention defaults to 30 days and is configurable.
- *AC6* — Soft-deleted rows free their unique keys (email, employee code, bank
  reference id, entity codes) for reuse.

**Current status: IMPLEMENTED, with one caveat.** Registry of 12 record types
`recycle-bin.ts:28-89`; transactional soft delete `:105-151`; restore `:153-195`;
permanent delete `:203-237` with the retention rationale at `:197-202`; explicit
confirm flag `admin.routes.ts:876-877` with the reasoning at `:864-868`;
retention `env.ts:23` and `recycle-bin.ts:95-98`; partial unique indexes
`identity.ts:130-135`, `domain.ts:140-145`, `operations.ts:129` et al.

**Caveat (AC3 has a data-protection consequence):** the retained bin entry keeps
its full `snapshot` JSONB (`recycle-bin.ts:137`). `permanentDelete` sets
`purged_at` but **never clears `snapshot`** (`:223-226`). A "permanent delete" of
a customer therefore leaves that customer's complete row — including
`aadhaar_hash`, `aadhaar_last4` and `pan` — in `recycle_bin_entries` forever. The
list endpoint strips `snapshot` from the response (`admin.routes.ts:828`), so it
is invisible in the UI, but it is still in the database. See NFR-DP-4.

---

**R15.3** Expired bin entries shall be purged automatically.

**Current status: MISSING.** `expiredEntries()` exists
(`recycle-bin.ts:239-251`) and its own comment says *"Driven by a scheduled
job"*. **There is no scheduled job.** Grep finds no cron, no `node-cron`, no
worker entry point, and no caller. Retention is advertised but never enforced;
soft-deleted rows accumulate indefinitely.

---

**R15.4** An administrator shall review the audit log filtered by record type,
record id and action, scoped to their banks.

**Current status: PARTIAL — backend only.** `GET /api/audit-logs`
(`admin.routes.ts:902-942`) with filters at `:916-918` and a scope rule at
`:920-927` that shows a scoped user their own bank-less actions plus everything
for their banks. **There is no audit-log screen** — no
`frontend/src/app/(app)/audit-logs/` directory, no nav entry, no frontend call.
The `audit_logs.view` permission is granted to Admin
(`permissions.ts:227`) and reaches nothing.

---

**R15.5** Authentication events shall be audited.

**Current status: IMPLEMENTED.** `recordAuthEvent`
(`audit.ts:80-99`) writes `login_succeeded` (`auth.routes.ts:140`),
`login_failed` (`:104`, `:127`) and `password_changed` (`:256`), each with IP,
user agent and request id. `logout` is in the action list
(`governance.ts:177`) but **is never written** — `auth.routes.ts:195-210` revokes
the token and clears the cookie without an audit call.

---

### R16 — Cross-cutting: the API-to-UI gap

**R16.1** Every implemented endpoint should be reachable from the product.

**Current status: NOT MET.** Enumerating every `api.*` / `apiRequest` /
`useResource` / `useRecord` / `useStats` / raw `fetch` call site across
`frontend/src` yields **38 distinct METHOD + path pairs** (27 if the four auth,
three dashboard, three import and one detail-fetch endpoints are excluded — the
framing matters, so both figures are given). Against a backend surface of **96
endpoints, 58 have zero frontend callers.**

| Backend module | Endpoints | Called by the frontend | Unreachable |
|---|---|---|---|
| Factory-generated (9 resources) | 44 | 11 | 33 |
| `admin.routes.ts` (users, roles, teams, recycle bin, audit, notifications) | 23 | 10 | 13 |
| `operations.routes.ts` (verification-open, service providers, dashboard) | 7 | 3 | 4 |
| `customers.routes.ts` | 6 | 4 | 2 |
| `auth.routes.ts` | 5 | 4 | 1 |
| `banks.routes.ts` | 5 | 3 | 2 |
| `imports.routes.ts` | 4 | 3 | 1 |
| `health.routes.ts` | 2 | 0 | 2 |
| **Total** | **96** | **38** | **58** |

Entire feature areas have a complete, tested backend and no screen at all:
**verifications** (5 endpoints), **funding sources** (5), **service providers**
(3), **teams** (4 of 4 write paths), **roles** (4 write paths), **audit logs**
(1). None of these appear in `frontend/src/lib/nav.ts:30-66`.

---

**R16.2** A UI control that reports success should have caused a change.

**Current status: NOT MET.** Eleven handlers across seven screens call
`refresh()` and raise a success toast while issuing **no HTTP request**. In every
case the corresponding backend route exists and is never called.

| Screen | Handler | Citation | Route that exists and is never called |
|---|---|---|---|
| Loans | `updateStatus` | `frontend/src/app/(app)/loans/page.tsx:68` | `PATCH /api/loans/:id`, `POST /api/loans/:id/approve` |
| Bank orders | `moveStage` | `frontend/src/app/(app)/bank-orders/page.tsx:58` | `PATCH /api/bank-orders/:id` |
| Bank orders | `saveRemark` | `…/bank-orders/page.tsx:64` | `PATCH /api/bank-orders/:id` |
| Disbursement | `markCredited` | `frontend/src/app/(app)/disbursement/page.tsx:81` | `PATCH /api/disbursements/:id` |
| Disbursement | `retry` | `…/disbursement/page.tsx:87` | `PATCH /api/disbursements/:id` |
| Settlements | `markPaid` | `frontend/src/app/(app)/settlements/page.tsx:35` | `PATCH`, `POST …/approve` |
| Settlements | `raiseDispute` | `…/settlements/page.tsx:44` | `PATCH /api/settlements/:id` |
| Transactions | `settle` | `frontend/src/app/(app)/transactions/page.tsx:36` | `PATCH /api/transactions/:id` |
| Documents | `setStatus` | `frontend/src/app/(app)/documents/page.tsx:104` | `PATCH /api/documents/:id` |
| Documents | `remove` | `…/documents/page.tsx:109` | `DELETE /api/documents/:id` |
| Customer detail | Save / Delete / Print | `frontend/src/app/(app)/customers/[id]/page.tsx:458`, `:483`, `:185` | `PATCH`, `DELETE /api/customers/:id` |
| Customers | `handleManualFormUpload` | `frontend/src/app/(app)/customers/page.tsx:232` | (none — no file storage exists) |
| Notifications | `markAll` | `frontend/src/app/(app)/notifications/page.tsx:75` | `POST /api/notifications/read-all` |

Two whole screens — `bank-orders/page.tsx` and `customers/[id]/page.tsx` — make
**zero write calls of any kind**.

**This is the single highest-priority remediation item in the product.** A user
who marks a settlement paid, refreshes, and sees it still pending will not trust
anything else the system tells them.

---

## 5. Requirement status summary

| # | Requirement | Status | Anchor |
|---|---|---|---|
| R1.1 | Create employee | IMPLEMENTED (wt) | `admin.routes.ts:159` |
| R1.2 | Role hierarchy on user management | IMPLEMENTED | `access.ts:144` |
| R1.3 | No privilege escalation via roles | IMPLEMENTED | `access.ts:166` |
| R1.4 | Assign / re-assign bank access | PARTIAL (no UI) | `admin.routes.ts:386` |
| R1.5 | Revoke / restore access | IMPLEMENTED | `employees/page.tsx:219` |
| R1.6 | Last Super Admin protected | IMPLEMENTED | `admin.routes.ts:444` |
| R1.7 | Team management | PARTIAL (no UI) | `admin.routes.ts:700` |
| R2.1 | Server-decided role at login | IMPLEMENTED | `auth.routes.ts:81` |
| R2.2 | Token strategy | IMPLEMENTED | `api.ts:17`, `auth.routes.ts:183` |
| R2.3 | Lockout + timing equalisation | IMPLEMENTED | `auth.routes.ts:28` |
| R2.4 | Temporary password issuance | IMPLEMENTED (wt) | `password.ts:72` |
| R2.5 | Administrative password reset | IMPLEMENTED (wt) | `admin.routes.ts:328` |
| R2.6 | Forced password change **enforced** | **PARTIAL — React-only** | `app-shell.tsx:39` |
| R2.7 | Self-service password change | IMPLEMENTED (wt) | `auth.routes.ts:221` |
| R2.8 | Demo account | IMPLEMENTED + defect | `use-auth.tsx:212` |
| R3.1 | Bank reference uniqueness | IMPLEMENTED / PARTIAL UI | `domain.ts:140` |
| R3.2 | Indian-format validation | IMPLEMENTED (Zod only) | `customers.routes.ts:18` |
| R3.3 | Customer bank scoping | IMPLEMENTED | `customers.routes.ts:99` |
| R3.4 | Excel bulk import | IMPLEMENTED | `imports.routes.ts:155` |
| R3.5 | Edit / delete from detail screen | **DEMO** | `customers/[id]/page.tsx:458` |
| R3.6 | Written-form attachment | **DEMO** | `customers/page.tsx:232` |
| R4.1 | Same-bank integrity | IMPLEMENTED | `operations.routes.ts:33` |
| R4.2 | System-generated codes | PARTIAL (race) | `scoped-resource.ts:87` |
| R4.3 | File status lifecycle | PARTIAL / **DEMO UI** | `loans/page.tsx:68` |
| R4.4 | Assignment + history | PARTIAL (history dead) | `operations.ts:407` |
| R5.1 | Document metadata | PARTIAL | `documents/page.tsx:81` |
| R5.2 | Document bytes stored | **MISSING** | `operations.ts:371` |
| R5.3 | Verify / delete a document | **DEMO** | `documents/page.tsx:104` |
| R5.4 | KYC status workflow | PARTIAL | `domain.ts:115` |
| R6.1 | Bank order stages + SLA | PARTIAL (SLA unused) | `operations.ts:199` |
| R6.2 | Move stage / save remark | **DEMO** | `bank-orders/page.tsx:58` |
| R7.1 | Conditional verification | IMPLEMENTED / **no UI** | `operations.routes.ts:107` |
| R7.2 | Service provider master | PARTIAL (no UI) | `operations.routes.ts:450` |
| R8.1 | Approval as a distinct action | IMPLEMENTED / **no UI** | `scoped-resource.ts:271` |
| R8.2 | Rejection with a reason | PARTIAL | `scoped-resource.ts:289` |
| R9.1 | Disbursement record + UTR uniqueness | IMPLEMENTED | `operations.ts:248` |
| R9.2 | Confirm credited / retry | **DEMO** | `disbursement/page.tsx:81` |
| R9.3 | Funding sources | PARTIAL (no UI) | `operations.routes.ts:405` |
| R10.1 | Transaction ledgering | PARTIAL (never auto-created) | `operations.ts:290` |
| R10.2 | Settle a transaction | **DEMO** | `transactions/page.tsx:36` |
| R11.1 | Settlement invoice + arithmetic | PARTIAL (no create UI) | `operations.routes.ts:310` |
| R11.2 | Mark paid / dispute | **DEMO** | `settlements/page.tsx:35` |
| R11.3 | Derive settlement from files | **MISSING** | — |
| R12.1 | Ledger entries | PARTIAL (balance not maintained) | `operations.ts:342` |
| R12.2 | Tally export | PARTIAL (client-side) | `export.ts:41` |
| R13.1 | Notifications raised | **MISSING** | zero `insert(notifications)` |
| R13.2 | Mark as read | **DEMO** + page defect | `notifications/page.tsx:74` |
| R14.1 | Scoped dashboard KPIs | IMPLEMENTED | `operations.routes.ts:521` |
| R14.2 | Filtered report + export | PARTIAL (client-side) | `reports/page.tsx:71` |
| R14.3 | Employee target vs achieved | PARTIAL (`achieved` free-entry) | `admin.routes.ts:51` |
| R15.1 | Append-only audit log | IMPLEMENTED + 2 defects | `audit.ts:50` |
| R15.2 | Recycle bin | IMPLEMENTED + PII caveat | `recycle-bin.ts:203` |
| R15.3 | Automatic purge of expired entries | **MISSING** | `recycle-bin.ts:239` |
| R15.4 | Audit log review screen | PARTIAL (no UI) | `admin.routes.ts:902` |
| R15.5 | Auth event auditing | IMPLEMENTED (`logout` missing) | `auth.routes.ts:195` |
| R16.1 | Endpoints reachable from the product | **NOT MET — 58/96 unreachable** | §4 R16.1 |
| R16.2 | Success toasts reflect real writes | **NOT MET — 11 fake handlers** | §4 R16.2 |

---

## 6. Non-functional requirements

### 6.1 Security

| Ref | Requirement | Current status |
|---|---|---|
| **NFR-SEC-1** | Passwords stored with a memory-hard KDF | **MET.** argon2id, `m=19456, t=2, p=1` — the OWASP 2024 low-memory baseline, chosen to fit a small container under concurrent logins (`src/lib/password.ts:4-13`). |
| **NFR-SEC-2** | Authorisation decided server-side on every request from current data, never from token claims | **MET.** `requireAuth` re-reads role, permissions and bank assignments per request (`src/middleware/auth.ts:15-26`, `access.ts:30-86`). A revoked permission takes effect on the next request. |
| **NFR-SEC-3** | Tenant isolation enforced in the data layer, never in the UI | **MET.** One choke point (`access.ts:108-114`); the factory assembles the WHERE clause in exactly one place (`scoped-resource.ts:93-100`) with the rationale recorded at `:66-73`. Fails **closed**: zero bank assignments yields a sentinel UUID that can never match (`access.ts:114`). |
| **NFR-SEC-4** | Rate limiting on authentication and on the API | **NOT MET.** No limiter of any kind. Only the per-account lockout at `auth.routes.ts:28-29`. |
| **NFR-SEC-5** | Standard security headers and a locked CORS allow-list | **MET.** `helmet` with `crossOriginResourcePolicy: cross-origin` and CSP disabled for the API (`app.ts:44-49`); explicit CORS origin allow-list because `credentials: true` forbids a wildcard (`:51-63`). |
| **NFR-SEC-6** | Request body size limits | **MET.** 1 MB JSON and urlencoded (`app.ts:70-71`); uploads capped at `MAX_UPLOAD_MB` (default 10) with a single-file limit and a MIME allow-list (`imports.routes.ts:27-42`). |
| **NFR-SEC-7** | Fail fast on missing or unsafe configuration | **MET.** Zod-validated env with production guards rejecting the default Aadhaar pepper and identical JWT secrets (`config/env.ts:36-52`). |
| **NFR-SEC-8** | Secrets never returned or logged | **MET for passwords.** `password_hash` is never selected by `GET /api/users` (`admin.routes.ts:114-131,147`); the temporary password exists only inside its handler and its single response. |
| **NFR-SEC-9** | Forced password change enforced server-side | **NOT MET.** See R2.6. |
| **NFR-SEC-10** | Out-of-scope and non-existent indistinguishable | **MET.** `404` for both, deliberately (`scoped-resource.ts:162-163`, `customers.routes.ts:158-159`, and mirrored in the client at `frontend/src/lib/api.ts:52-56`). |

### 6.2 Performance

| Ref | Requirement | Current status |
|---|---|---|
| **NFR-PERF-1** | Every scoped and filtered column indexed | **MET.** Indexes on `bank_id`, `status`, `deleted_at`, assignment columns and date columns across all operational tables (`operations.ts:128-137, 206-212, 246-256, 281-287, 316-323, 348-353, 379-384`). |
| **NFR-PERF-2** | List endpoints paginated with a hard ceiling | **MET.** Default 25, maximum 500 (`scoped-resource.ts:47-52`); a request for 5000 returns `422`, asserted at `src/tests/frontend-contract.test.ts:100-110`. |
| **NFR-PERF-3** | No N+1 on list rendering | **PARTIAL.** `GET /api/users` batches bank access in one `inArray` query (`admin.routes.ts:139-144`), and `GET /api/roles` and `/api/teams` do the same for grants and members. But **every list screen loads its reference data with `pageSize: 500`** — for example `frontend/src/app/(app)/bank-orders/page.tsx:49,52` loads 500 customers and 500 loans to resolve names on one page of orders. This is client-side N+1 avoidance by brute force and will not survive real volume. |
| **NFR-PERF-4** | Dashboard computed in one round trip | **MET.** Thirteen metrics in a single statement (`operations.routes.ts:534-570`). |
| **NFR-PERF-5** | Concurrency-safe identifier generation | **NOT MET.** See R4.2. |
| **NFR-PERF-6** | Stated latency and throughput targets | **UNVERIFIED.** No target is recorded anywhere in the repo, and no load test exists. |

### 6.3 Availability

| Ref | Requirement | Current status |
|---|---|---|
| **NFR-AVAIL-1** | Liveness probe that does not touch the database | **MET.** `GET /api/health` (`health.routes.ts:8-10`). |
| **NFR-AVAIL-2** | Readiness probe that verifies the database answers, returning `503` when it does not | **MET.** `GET /api/health/ready` (`health.routes.ts:13-29`). |
| **NFR-AVAIL-3** | Stated uptime target and error budget | **UNVERIFIED.** None recorded. |
| **NFR-AVAIL-4** | Graceful shutdown draining in-flight requests | **UNVERIFIED.** Not inspected in `src/server.ts` for this document. |

### 6.4 Data protection (India — DPDP Act 2023, Aadhaar Act s.29)

| Ref | Requirement | Current status |
|---|---|---|
| **NFR-DP-1** | Aadhaar shall not be stored in the clear | **MET.** A peppered SHA-256 hash plus the last four digits (`domain.ts:113-114`); the transform runs before any write (`customers.routes.ts:77-84`, `imports.routes.ts:414-415`). The rationale is documented at `domain.ts:81-87` and in `docs/FRONTEND_ANALYSIS.md:120-127`, which flags it explicitly as a business decision that can be reverted on request. The display form is `•••• •••• 1123`. Covered by `src/tests/authorization.test.ts:455` ("data protection"). |
| **NFR-DP-2** | The Aadhaar pepper shall be unique per deployment | **PARTIAL.** A production guard rejects the development default (`config/env.ts:44-47`), but **`AADHAAR_PEPPER` is absent from `.env.example`** (which lists 12 other variables, `.env.example:1-33`). An operator following the documented setup will not set it, and the process will refuse to boot in production with an error they have no instruction for. |
| **NFR-DP-3** | Personal data shall not accumulate in immutable stores | **NOT MET.** The audit redaction list (`audit.ts:18-27`) omits `pan`, `aadhaarLast4`, `mobile`, `email`, `dob` and `address`. Every customer `PATCH` writes a before/after diff of those fields into `audit_logs`, which is protected against `UPDATE` and `DELETE` by a database trigger. There is no code path that can erase it. |
| **NFR-DP-4** | A permanent deletion shall actually delete the personal data | **NOT MET.** `permanentDelete` removes the source row but retains the bin entry, and never clears its `snapshot` JSONB (`recycle-bin.ts:203-237`, esp. `:223-226`). The full customer record survives a "permanent delete" indefinitely. |
| **NFR-DP-5** | PAN shall be protected commensurately with its sensitivity | **NOT MET.** `customers.pan` is plaintext `text` (`domain.ts:112`). This may be the correct business decision — it is needed for lender submission — but it is an undocumented, unratified one. |
| **NFR-DP-6** | Data residency and cross-border transfer position | **UNVERIFIED.** Neon region is not pinned anywhere in the repo; `.env.example:7` uses a `REGION` placeholder. Under DPDP s.16 the government may restrict transfers to notified countries. No position is recorded. |
| **NFR-DP-7** | Retention schedule per data class | **MISSING.** Only the 30-day recycle-bin window exists (`env.ts:23`), and it is never actually enforced (R15.3). There is no retention policy for customers, loans, audit logs or import batches. |
| **NFR-DP-8** | Consent capture and purpose limitation | **MISSING.** No consent artefact exists in the schema. |

### 6.5 Auditability

Covered by R15.1–R15.5. Summary: the mechanism is sound and database-enforced;
the gaps are the redaction list (NFR-DP-3), the missing `logout` event, the
undeclared `password_reset` action, and the absence of any UI to read the log.

### 6.6 Accessibility

| Ref | Requirement | Current status |
|---|---|---|
| **NFR-A11Y-1** | WCAG 2.2 AA | **UNVERIFIED.** No audit exists, no automated checker is configured, and there are zero frontend tests of any kind. The UI is built on Radix primitives (`frontend/src/components/ui/*`), which supply correct roles, focus management and keyboard behaviour for dialogs, dropdowns, tabs and tooltips — so the baseline is likely better than average, but nothing is measured. |
| **NFR-A11Y-2** | Colour is not the sole carrier of meaning | **UNVERIFIED.** Status is rendered through a `StatusBadge` component that carries text alongside colour (`frontend/src/components/shared/status-badge.tsx`), which is the right shape, but no contrast audit has been run. |
| **NFR-A11Y-3** | Dark mode | **IMPLEMENTED.** Complete `:root` and `.dark` token sets with a pre-hydration theme script (`frontend/src/components/theme-script.tsx`); `docs/FRONTEND_ANALYSIS.md:82-94` notes ~45 hardcoded colour utilities that bypass tokens, 18 of them in the intentionally always-navy sidebar. |

### 6.7 Browser support

**UNVERIFIED.** No `browserslist` key, no `.browserslistrc`, and no support
statement anywhere in the repo. The practical floor is set by the framework —
Next.js 16 / React 19 — and by the runtime APIs the app calls directly:
`navigator.clipboard` (`credential-handover.tsx:44`, which already degrades
gracefully outside a secure context), `URL.createObjectURL`
(`frontend/src/lib/export.ts:20`), `AbortController`
(`frontend/src/hooks/use-api.ts:44`) and `sessionStorage` in a `try/catch` for
private-browsing mode (`frontend/src/lib/demo/session.ts:13-21`). A written
support matrix is required.

---

## 7. Production requirements

### 7.1 Deployment

**Intended topology** (documented in `README.md:192-205`): frontend on Vercel
with root directory `frontend` and `NEXT_PUBLIC_API_URL` pointing at the API;
backend on Railway with root directory `backend`, build
`npm ci && npm run build`, start `npm run start`, health check `/api/health`;
database on Neon, using the **pooled** connection string for the app and the
**direct** string for migrations (`.env.example:5-9`).

**Current status: NOT DEPLOYED.** `README.md:207-212` states this plainly: Neon
and Railway both returned HTTP 403 from the build environment's egress proxy and
no credentials were supplied. Nothing has been verified against a live
deployment.

**Blocking gaps:**

| Gap | Evidence |
|---|---|
| No containerisation | No `Dockerfile` anywhere in the repo |
| No platform config | No `vercel.json`, no `railway.*`, no `Procfile`, no `*.toml` |
| Stale env documentation | `README.md:202` instructs the operator to set every variable in **`.env.example`** — **that file does not exist.** The real files are `.env.example` (repo root) and `frontend/.env.example`. |
| Incomplete env documentation | `AADHAAR_PEPPER` is required in production (`config/env.ts:44-47`) and is not listed in `.env.example` |
| Manual migration step | `npm run db:migrate` then `npm run db:seed` are run by hand (`README.md:204`); no release-phase hook |

### 7.2 CI/CD

**Current status: MISSING ENTIRELY.** There is no `.github/` directory, and a
repo-wide search finds **zero `.yml` or `.yaml` files**. Every gate — `lint`,
`typecheck`, `build`, `test` — exists as an npm script and is run only by a human
who remembers to. The 107 backend tests, which are the product's main quality
asset, gate nothing.

**Required minimum:**

1. A pull-request pipeline running `lint`, `typecheck`, `build` and `test` for
   both `backend/` and `frontend/`, with the merge blocked on failure.
2. A migration check that fails the build when a Drizzle schema change has no
   corresponding SQL migration.
3. Automated dependency and secret scanning.
4. A deployment pipeline that runs migrations before the new revision takes
   traffic, and can roll back.

### 7.3 Monitoring and error tracking

| Concern | Current status |
|---|---|
| Structured logging | **PARTIAL.** `pino` + `pino-http` with a request id propagated from `x-request-id` or generated (`app.ts:65-76`). Disabled under `NODE_ENV=test`. |
| Log aggregation | **MISSING.** Logs go to stdout with no shipper, no retention and no search. |
| Error tracking | **MISSING.** No Sentry, no Rollbar, no equivalent. A 500 is invisible unless someone is reading the container log at that moment. |
| Metrics | **MISSING.** No `/metrics`, no OpenTelemetry, no APM. |
| Uptime checks | **MISSING** as configuration, though the probes exist (`health.routes.ts:8,13`). |
| Alerting | **MISSING.** `audit.ts:72-77` logs a failed audit write at error level *"for alerting"* — there is nothing to alert. |

### 7.4 Backups and recovery

**UNVERIFIED — nothing in the repository addresses this.** Neon provides
point-in-time restore on paid plans, but the plan, the retention window, the RPO
and the RTO are unrecorded, and no restore has ever been rehearsed. Required:
a documented RPO/RTO, an automated backup verification, and a rehearsed restore
runbook.

### 7.5 Secret management

| Concern | Current status |
|---|---|
| Secrets absent from the repo | **MET.** Only `.env.example` files are committed; no `.env` is present. |
| Boot-time validation | **MET.** `config/env.ts:36-52`, including production-only guards. |
| Bootstrap credential hygiene | **PARTIAL.** `README.md:203` instructs that the bootstrap pair be *"set once, used, then removed"*, and the seeded Super Admin is created with `mustChangePassword: true` so the dashboard value stops being a valid credential after first login (`src/db/seed.ts:110-124`, esp. `:119-121`). But R2.6 means that flag is not actually enforced server-side. |
| Rotation | **MISSING.** No procedure for rotating `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` or `AADHAAR_PEPPER`. Rotating the pepper invalidates every stored `aadhaar_hash` and therefore all duplicate detection — this needs a documented migration path before it is ever needed in anger. |
| Secret store | **MISSING.** Platform environment variables only; no vault, no audit of who read what. |

### 7.6 Incident response

**MISSING ENTIRELY.** No runbook, no on-call rota, no severity definitions, no
escalation path, no post-incident review template, and — critically for a system
holding Aadhaar and PAN data — **no data-breach notification procedure**. Under
the DPDP Act 2023 a personal-data breach must be reported to the Data Protection
Board and to affected principals; there is currently no plan, no owner and no
means of determining the blast radius (see NFR-DP-3 and NFR-DP-4, both of which
would widen it).

---

## 8. Out of scope and open questions

### 8.1 Explicitly out of scope

The following are **not** requirements of this system. They are listed so that
their absence is understood as a decision rather than an oversight.

| Item | Note |
|---|---|
| Core banking / loan servicing | The lender services the loan. This system tracks the file and the commission, not the amortisation schedule. `loans.emi` (`operations.ts:105`) is a stored figure for display, not a computed schedule. |
| Payment execution | No payment rail integration. Disbursements are **recorded** after the fact by UTR (`operations.ts:234`); no money moves through this system. |
| Credit decisioning / scoring | `customers.cibil` (`domain.ts:116`) is a stored bureau figure, manually entered. No bureau API, no scorecard, no decision engine. |
| Automated KYC verification | No Aadhaar eKYC, no DigiLocker, no PAN NSDL verification, no video KYC. `customers.kyc` is a manually-set label. |
| Customer-facing portal | Every route is behind `AppShell`, which redirects unauthenticated users to `/login` (`app-shell.tsx:20-22`). There is no borrower login. |
| Mobile applications | Web only. A `use-mobile` hook exists for responsive layout (`frontend/src/hooks/use-mobile.ts`); there is no native client. |
| Multi-currency | All money columns are `numeric(16,2)` with no currency dimension (`operations.ts:28`). INR is assumed throughout. |
| Multi-tenancy across companies | Tenancy is per **bank**, within one Rise Next installation (`domain.ts:52-59`). There is no organisation/company boundary above it. |
| Localisation | English only. No i18n framework is present. |
| Real-time collaboration | No WebSockets, no server-sent events. All data is fetched on mount and on explicit `refresh()`. |
| Offline capability | No service worker, no local queue. |
| Accounting system of record | The ledger is a register for reporting and Tally hand-off, not a general ledger. There is no trial balance and no period close. |

### 8.2 The unresolved architectural question

`docs/FRONTEND_ANALYSIS.md` §8 (lines 135–167) records a question that was put to
the client and, so far as this repository shows, **was never answered**. It is
the most consequential open item in the product, and the `requests.*` permission
namespace described in §1.3 is its fossil.

**The question: which of two different businesses is being modelled?**

| | Business A — what the frontend describes | Business B — what the written brief describes |
|---|---|---|
| Model | **Loan DSA / channel partner.** Introduces borrowers to lenders and earns commission. | **Money-lending intermediary.** Handles funding / letter-of-credit requests and lends or on-lends. |
| Loan entity | `interestRate`, `tenureMonths`, `emi`, `processingFee`, `commission`, `applicationNo` | Funding / LOC requests |
| Settlement | A **monthly commission invoice** per bank: `grossCommission`, `tds`, `netPayable`, `invoiceNo` | A **transfer between a source and a destination** against a disbursement — different columns, different meaning |
| Verification | Not present | Conditional third-party verification |
| Funding source | Not present | Own funds / another bank / external |
| Pipeline | Login → Credit Check → Field Verification → Sanction → Disbursal Queue | Request → verify → fund → pay the requesting bank or the customer directly |
| Transaction types | Includes `"EMI Collection"` | Transfers between sources and destinations |

The analysis states the two *"are not reconcilable by using the frontend fields
wherever possible"* (`FRONTEND_ANALYSIS.md:153-154`) and that roughly ten tables
and every screen bound to them follow from the answer (`:154-155`). Three options
were offered (`:157-165`):

- **(A) Frontend wins** — model the DSA/commission business exactly as the
  existing screens describe; verification, funding sources and service providers
  become new optional tables and new screens.
- **(B) Brief wins** — model the funding/LOC intermediary; the Loans,
  Settlements, Ledger and Transactions screens then show fields that no longer
  exist and must be reworked.
- **(C) Both** — a `requests` table supersetting both shapes with a
  discriminator; more tables, more nullable columns, and the UI still has to
  choose what to show.

**(A) was recommended** (`:166-167`). **No answer was ever recorded** — there is
no decision log, no ADR, no reply in the README, and no note anywhere in `docs/`.

**What was actually built is an unlabelled hybrid.** The DSA shape won the
column layout: `settlements` is a per-bank commission invoice with `tds` and
`invoice_no` (`operations.ts:259-288`), `loans` carries `emi` / `processing_fee`
/ `commission` (`:104-106`), and `transactions.txnType` still includes
`"EMI Collection"` (`:505`). But option (B)'s concepts were added alongside
rather than instead: `funding_sources` (`:60`), `service_providers` (`:34`),
`verifications` with `handled_by_bank` (`:144`), and `loans.funding_source_id`
(`:114`). The schema comment at `operations.ts:81-84` describes exactly this —
*"with the brief's workflow columns added alongside rather than instead"* — which
is option **(C) implemented without the discriminator**. The `requests.*`
permission namespace is the one place where option (B)'s vocabulary survived
intact.

**Consequence:** it is not currently possible to answer "what does a settlement
mean here?" from the code alone, because the table means one thing and the
permission namespace implies another. Every downstream question — whether
settlements should be system-generated (R11.3), whether a funding source should
be mandatory on a disbursement, whether `EMI Collection` is a real transaction
type for this business — is blocked on this.

**This must be answered before any further work on settlements, funding sources
or verification.**

### 8.3 Other open product questions

| # | Question | Why it is blocking | Anchor |
|---|---|---|---|
| Q1 | Should the 11 demo handlers be **wired** to their existing endpoints, or should the corresponding features be **removed** from the UI? | Users currently receive false confirmations. Either answer is defensible; the present state is not. | §4 R16.2 |
| Q2 | Where do document bytes live? S3, R2, Neon large objects, or an explicit decision not to store files at all? | `documents.storage_key` has been reserved since the first operations migration and nothing writes it. `docs/FRONTEND_ANALYSIS.md:110` flagged this as *"needs a blob store decision"* and no decision was recorded. | R5.2 |
| Q3 | How is a temporary password delivered when the recipient is not in the room? | There is no email capability at all. The current answer is "read it off the screen"; that does not scale past a single office. | R13.1 |
| Q4 | What events should raise a notification, and who receives them? | The table and three endpoints exist; nothing creates a row. Without an event list the feature cannot be built. | R13.1 |
| Q5 | Should `must_change_password` be enforced by backend middleware? | Presently a React redirect only. If the answer is yes, it is a small middleware change; if no, the risk must be accepted explicitly. | R2.6 |
| Q6 | Is a loan status transition table required, or is any-to-any acceptable? | Affects whether `Closed → Draft` is a bug or a feature. | R4.3 |
| Q7 | Should settlements be generated from underlying loan commissions, or entered manually from the lender's statement? | Determines whether R11.3 is built at all. Depends on §8.2. | R11.3 |
| Q8 | Is `assignment_history` wanted? | The table exists and nothing writes it. Either wire it or drop it. | R4.4 |
| Q9 | Is `app_settings` wanted? | Completely dead — grep for `appSettings` outside the schema file returns zero results. Retention and import limits are currently environment variables instead. | `governance.ts:95` |
| Q10 | Is storing PAN in plaintext ratified? | It may well be necessary for lender submission, but it is currently an undocumented default rather than a decision. | NFR-DP-5 |
| Q11 | What is the retention schedule per data class, and who owns erasure requests? | DPDP compliance depends on an answer, and NFR-DP-3 / NFR-DP-4 mean the current architecture cannot honour an erasure request even if one arrived. | NFR-DP-7 |
| Q12 | Which teams, roles, verification, funding-source, service-provider and audit-log screens are actually wanted? | 58 of 96 endpoints are unreachable. Some of those features may not be wanted at all, in which case the endpoints should be deleted rather than surfaced. | R16.1 |

---

## Appendix A — Endpoint inventory by resource

Factory-generated endpoints follow a fixed shape: `GET /`, `GET /:id`, `POST /`,
`PATCH /:id`, plus `DELETE /:id` **only if** `permissions.delete` is configured,
plus `POST /:id/approve` **only if** `permissions.approve` is configured
(`src/modules/scoped-resource.ts:102, 155, 170, 205, 251, 271`).

| Resource | Mount | Permission namespace | Endpoints | Delete? | Approve? |
|---|---|---|---|---|---|
| Loans | `/api/loans` | `requests.*` | 6 | yes | yes |
| Verifications | `/api/verifications` | `verification.*` | 5 | no | yes |
| Bank orders | `/api/bank-orders` | `bank_orders.*` | 5 | yes | no |
| Disbursements | `/api/disbursements` | `disbursements.*` | 5 | no | yes |
| Settlements | `/api/settlements` | `settlements.*` | 5 | no | yes |
| Transactions | `/api/transactions` | `transactions.*` | 4 | no | no |
| Ledger | `/api/ledger` | `ledger.*` | 4 | no | no |
| Documents | `/api/documents` | `documents.*` (create/edit both use `documents.upload`) | 5 | yes | no |
| Funding sources | `/api/funding-sources` | `funding_sources.*` | 5 | yes | no |
| **Factory total** | | | **44** | | |

Hand-written: `admin.routes.ts` 23, `customers.routes.ts` 6, `auth.routes.ts` 5,
`banks.routes.ts` 5, `imports.routes.ts` 4, `operations.routes.ts` 7,
`health.routes.ts` 2 = **52**. Grand total **96**.

## Appendix B — Test coverage map

| Suite | Cases | What it proves |
|---|---|---|
| `src/tests/authorization.test.ts` | 26 | Schema migration applies (`:42`), authentication (`:78`), bank scoping enforced server-side (`:118`), permission gating (`:201`), role hierarchy (`:256`), bank-reference uniqueness (`:309`), recycle bin (`:363`), audit trail (`:401`), data protection (`:455`), protected system role (`:477`), health (`:500`) |
| `src/tests/workflow.test.ts` | 22 | Admin cannot escalate (`:42`), roles are configurable not hard-coded (`:143`), funding/LOC workflow (`:198`), dashboard reflects the database not fixtures (`:377`), recycle-bin round trip (`:393`), Excel import (`:486`) |
| `src/tests/frontend-contract.test.ts` | 34 | 9 static cases plus `it.each` over a 25-entry `FRONTEND_CALLS` array — every request the frontend makes returns `200` with a `data` property (`:90`); `?customerId` genuinely filters (`:113`); response shapes match the frontend types (`:138`) |
| `src/tests/employee-lifecycle.test.ts` **(untracked)** | 25 | Super admin creates an employee (`:62`), password reset (`:213`), revoking and restoring access (`:327`), creation guard rails the Employees screen relies on (`:369`) |
| **Total** | **107** | |

Tests run the **real** migration files against PGlite, so a migration that would
fail in production fails in CI — if CI existed. **Zero frontend tests. Zero
end-to-end tests. No CI pipeline.**
