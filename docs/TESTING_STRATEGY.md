# Testing Strategy

> ⚠️ **Staleness notice, added 2026-09-02 by the Phase 1 final review.** The baseline commit below is now **seven commits behind `HEAD` (`7b33b35`)** and this document received no Phase 1 update. Its test figures are correct **for that baseline only**. Current measured totals are **171 backend cases across 8 files** (was 107 across 4 — Phase 1 added `cors` 16, `cookie-config` 17, `session-invalidation` 11 and `customer-lookup` 20) and **55 frontend cases across 5 files** (was zero). `employee-lifecycle.test.ts` is no longer untracked — it was committed in `583897f`. Treat every "107", "82" and "zero frontend tests" below as history, not as current fact; the live figures live in [CURRENT_STATE.md](CURRENT_STATE.md) and [FEATURE_STATUS.md](FEATURE_STATUS.md).

**Scope:** what is tested today, what a green suite does *not* prove, and the test architecture this codebase needs before it can be trusted in production.

**Baseline for every claim below:** commit `7ef5da5` ("Add frontend-only employee demo") with the working tree as of writing. The working tree is dirty: 8 modified files and 4 untracked files. One of the four test files — `src/tests/employee-lifecycle.test.ts` — is **untracked**, so the numbers in this document differ between HEAD and the working tree. Both are given.

Every factual claim cites `file:line`. Anything that could not be traced to code is marked **UNVERIFIED**.

---

## 1. Current state

### 1.1 Harness

There is exactly one test harness, and it is a genuinely good one for its layer.

| Element | Implementation | Reference |
|---|---|---|
| Runner | Vitest 3.2.4, `environment: "node"` | `vitest.config.ts:5`, `package.json:52` |
| Test discovery | `src/**/*.test.ts` | `vitest.config.ts:6` |
| Global setup file | `src/tests/setup.ts` — sets `NODE_ENV=test` plus 8 `??=` env defaults so config exists no matter which module loads first | `vitest.config.ts:7`, `src/tests/setup.ts:5-13` |
| Database | `@electric-sql/pglite` — PostgreSQL compiled to WASM, in-process, in-memory, one instance per test file | `src/tests/harness.ts:1,40` |
| Schema creation | `migrate(db, { migrationsFolder: "./drizzle" })` — runs the **real shipped migration SQL**, not a `push` of the TS schema | `src/tests/harness.ts:43` |
| Migration files executed | `0000_init.sql`, `0001_governance_guards.sql`, `0002_operations.sql` | `drizzle/` |
| Seed | `seed()` from production code: permission catalogue upsert, 5 default roles, role→permission grants | `src/tests/harness.ts:45`, `src/db/seed.ts:21-78` |
| App under test | `createApp()` — the real Express app, all 22 route mounts, real middleware | `src/tests/harness.ts:47`, `src/app.ts:37-105` |
| HTTP driver | `supertest` against the app object (no socket, no network) | `package.json:48` |
| Isolation | `fileParallelism: false` — files run sequentially; each gets a fresh PGlite and closes it in `afterAll` | `vitest.config.ts:12`, `src/tests/harness.ts:50-53` |
| Timeouts | `testTimeout: 60_000`, `hookTimeout: 90_000` (argon2id hashing is deliberately slow) | `vitest.config.ts:8-9` |

Two consequences of running the real migrations are worth stating explicitly, because they are the harness's main value:

- A wrong FK, index or trigger fails in CI-equivalent conditions, not in production. The suite proves this directly: three tests assert that the **governance triggers** from `0001_governance_guards.sql` actually fire, by issuing raw SQL and expecting a rejection (`src/tests/authorization.test.ts:420-426`, `:478-490`).
- Because `seed()` is production code, a seed regression breaks the suite.

**What the harness does *not* do:** `createUser()` inserts directly into the `users` table with Drizzle (`src/tests/harness.ts:78-88`); it does **not** go through `POST /api/users`. Most personas in the suite therefore never exercise the user-creation route. `createBank()` is likewise a direct insert (`:104-112`). No `BOOTSTRAP_SUPERADMIN_EMAIL/_PASSWORD` is set in `TEST_ENV` (`src/tests/harness.ts:18-28`), so `bootstrapSuperAdmin` short-circuits (`src/db/seed.ts:85-90`) and the seeded database contains **zero users**.

### 1.2 Case counts

| File | Cases | Composition |
|---|---:|---|
| `src/tests/authorization.test.ts` | 26 | 26 static `it()` across 10 `describe` blocks |
| `src/tests/workflow.test.ts` | 22 | 22 static `it()` across 6 `describe` blocks |
| `src/tests/frontend-contract.test.ts` | 34 | 9 static `it()` + `it.each` over the 25-entry `FRONTEND_CALLS` array (`:62-88`) → 9 + 25 = 34 |
| `src/tests/employee-lifecycle.test.ts` **(untracked)** | 25 | 25 static `it()` across 4 `describe` blocks |

**Arithmetic:** 26 + 22 + (9 + 25) + 25 = **107 runtime cases in the working tree.**
**At HEAD (`7ef5da5`):** 26 + 22 + 34 = **82 cases.** `employee-lifecycle.test.ts` does not exist at HEAD, and could not pass there even if added: it depends on `generateTemporaryPassword` (`src/lib/password.ts:72`, added in the working tree), on the `POST /api/users/:id/reset-password` route (`src/modules/admin.routes.ts:328-329`, added in the working tree), on `userInput.teamId` (`admin.routes.ts:54-55`, added), and on `user.mustChangePassword` being present on the login profile (`src/modules/auth.routes.ts:70`, added).

`harness.ts` and `setup.ts` contain no `it()` and contribute no cases.

### 1.3 How to run

```
cd CMBBACKEND
npm test          # → "vitest run"   (package.json:14)
```

Notes that will otherwise cost someone an hour:

- **Must be run from `backend/`.** The migrations folder is a relative path, `"./drizzle"` (`src/tests/harness.ts:43`).
- No database is required. PGlite is in-memory; `DATABASE_URL` is set to a dummy value that is never dialled (`src/tests/harness.ts:21`).
- No coverage reporter is installed — `package.json` has no `@vitest/coverage-*` dependency, so `vitest run --coverage` will prompt to install one. There is no coverage baseline, threshold or report anywhere in the repo.
- The frontend has **no test script and no test dependency at all** (`frontend/package.json:6-12` — `dev`, `build`, `start`, `lint`, `typecheck`; `:38-48` devDependencies contain no test runner, no `@testing-library/*`, no Playwright).
- Total wall-clock runtime: **UNVERIFIED** (the suite was not executed while producing this document).

---

## 2. Per-file summary — what is actually asserted

### 2.1 `authorization.test.ts` (26 cases)

| Block | Endpoints / units touched | Asserted |
|---|---|---|
| schema migration (`:42-76`) | raw `information_schema` | 15 named tables exist after migration; >50 permission rows seeded; `super_admin` has `isSystem = true`, `level = 0` |
| authentication (`:78-116`) | `POST /api/auth/login`, `GET /api/customers` | Wrong password and unknown account both return 401 with an **identical** error message (`:88-90`); stored hash matches `/^\$argon2id\$/` and does not contain the plaintext (`:99-100`); an unauthenticated `GET /api/customers` is 401 (`:103-106`); a `role` field in the login body is ignored — the response role is `executive`, not the requested "Super Admin" (`:108-115`) |
| bank scoping (`:118-199`) | `POST/GET/PATCH/DELETE /api/customers`, `GET /api/customers/:id`, `GET /api/banks` | Another bank's customer is absent from the list, 404 on direct id, 404 on PATCH (`:134-151`); creating under an unassigned bank is 403 (`:154-164`); moving a customer to an unassigned bank is 403 (`:166-181`); a user with zero bank assignments gets `data.length === 0`, not everything (`:183-189`); a super admin gets `meta.scoped === false` and ≥2 banks (`:191-198`) |
| permission gating (`:201-254`) | `POST/DELETE /api/customers`, `GET /api/customers` | Executive can create but gets 403 on delete (`:202-217`); deleting the `customers.view` grant from `role_permissions` mid-session turns the very next `GET /api/customers` from 200 into 403 — proving per-request re-resolution (`:219-253`, mechanism at `src/middleware/auth.ts:21-31` and `src/services/access.ts:30-86`) |
| role hierarchy (`:256-307`) | **unit** calls into `services/access.ts` — no HTTP | `assertCanManageRoleLevel` / `assertCanAssignRole` throw for peer-admin and super-admin, pass for manager (`:265-271`); super admin may assign anything (`:280-281`); a manager cannot grant `system.access_all_banks` but can grant `customers.view` (`:289-292`); renaming a role keeps `id` and `key` (`:295-306`) |
| bank reference uniqueness (`:309-361`) | `POST/DELETE /api/customers` | Same reference in two different banks → both 201; repeat within one bank → 409; lowercase variant of the same reference → 409 (case-insensitive) (`:314-337`); after soft delete the reference is free again (`:340-360`) |
| recycle bin (`:363-399`) | `DELETE /api/customers/:id` | Row survives with `deletedAt` and `purgeAfter` non-null; a `recycle_bin_entries` row exists with `recordType = "customer"` and a snapshot; `GET /api/customers/:id` is 404 |
| audit trail (`:401-453`) | `POST/PATCH /api/customers` | An audit row exists with `action = "created"` and the correct `actorEmail`; raw `UPDATE` and `DELETE` on `audit_logs` both **reject** (trigger-enforced, `:420-426`); neither the old nor the new Aadhaar value appears anywhere in the serialised audit rows (`:429-452`) |
| data protection (`:455-475`) | `POST /api/customers` | Aadhaar stored as a 64-char hash + `aadhaarLast4`; the digits never appear in the row |
| protected system role (`:477-498`) | raw SQL | `DELETE`, re-`key`, and `is_active = false` on `super_admin` all reject; `name` may still be changed |
| health (`:500-510`) | `GET /api/health`, `GET /api/health/ready` | 200; `status = "ok"`; `database.connected = true` |

### 2.2 `workflow.test.ts` (22 cases)

| Block | Endpoints | Asserted |
|---|---|---|
| admin cannot escalate (`:42-141`) | `POST /api/users`, `PATCH /api/users/:id`, `POST /api/roles`, `GET /api/users` | Admin creating an Admin → 403 (`:50-62`); creating a Super Admin → 403 (`:64-76`); creating a Manager → **201** (`:78-90`); patching a Super Admin → 403 (`:92-98`); promoting a Manager to Admin → 403 (`:100-120`); minting a role at `level: 5` with `system.manage_any_user` → 403 (`:122-133`); `GET /api/users` body contains neither `$argon2` nor `passwordHash` (`:135-140`) |
| roles are configurable (`:143-196`) | `POST/PATCH/DELETE /api/roles`, `GET/POST /api/customers` | A custom role created at runtime with `["customers.view","transactions.view"]` grants exactly that: `GET /api/customers` 200, `POST /api/customers` 403 (`:144-169`); rename preserves `id` and `key` (`:171-184`); deleting a role that still has users → 409 (`:186-195`) |
| funding / LOC workflow (`:198-375`) | `POST /api/customers`, `POST /api/loans`, `POST /api/loans/:id/verification`, `POST /api/service-providers`, `POST /api/disbursements`, `POST /api/settlements`, `POST /api/transactions`, `GET /api/loans`, `GET /api/loans/:id`, `GET /api/{disbursements,transactions,bank-orders}` | Loan code matches `/^LN-\d+$/` (`:221`); a loan whose customer is in another bank → 400 (`:225-236`); `{required:false}` verification yields `handledByBank:true`, `status:"Verified"` (`:238-247`); `{required:true}` without a provider → 400, with one → 201 / `status:"Requested"` (`:249-283`); disbursement code `/^DSB-\d+$/`, and a repeat UTR differing only in case → 409 (`:285-313`); a settlement whose `netPayable` ≠ gross − TDS → 400 (`:328-338`); transaction code `/^TXN-\d+$/` (`:355`); a bank-B executive sees zero loans, 404 on the bank-A loan by id, and empty lists on three more resources (`:358-374`) |
| dashboard (`:377-391`) | `GET /api/dashboard/stats` | Super admin: `total_customers > 0`, `meta.scoped === false`; a manager with no bank assignments: `total_customers === 0` and `disbursed_value === 0` |
| recycle bin round trip (`:393-484`) | `DELETE /api/customers/:id`, `GET /api/recycle-bin`, `POST /api/recycle-bin/:id/restore`, `POST /api/recycle-bin/:id/permanent-delete` | Entry appears with `daysRemaining > 28`; restore → 200 and the customer is fetchable again; permanent delete **without** `{confirm:true}` → 422, with it → 200; the row is physically gone; an audit row with `action = "permanently_deleted"` survives the purge (`:454-458`); restoring another bank's entry → 403 (`:461-483`) |
| excel import (`:486-595`) | `POST /api/imports/customers`, `POST /api/imports/:id/confirm`, `GET /api/imports/template/customers` | A 6-row workbook classifies as total 6 / valid 2 / invalid 2 / duplicate 2; the **preview writes nothing** (customer count unchanged); confirm imports 2 and skips 4; re-confirming the same batch → 409 (`:502-549`); a team-leader scoped to bank A gets the bank-B row rejected with an error matching `/not assigned/i` (`:551-575`); the generated template's header row contains the exact strings the validator expects (`:577-594`) |

### 2.3 `frontend-contract.test.ts` (34 cases)

| Block | Asserted |
|---|---|
| `it.each(FRONTEND_CALLS)` (`:91-97`), 25 cases | For each of the 25 hand-listed `{page, path, query}` tuples: `GET` returns **200** and the body has a `data` property. Nothing else. |
| pagination bound (`:99-110`) | `pageSize=500` is accepted on customers, loans and settlements; `pageSize=5000` → 422. Matches the schema at `src/modules/scoped-resource.ts:49` (`max(500)`, default 25). |
| `?customerId` filter (`:113-135`) | With two customers each holding a loan, `GET /api/loans?customerId=…` returns exactly 1 row with the right `customerId`; unfiltered returns >1. **The test title says "loans, documents and transactions" but only `/api/loans` is requested.** |
| customer shape (`:139-148`) | 7 keys present (`id, code, bankId, bankReferenceId, name, mobile, status`), plus `aadhaarLast4` present, `aadhaar` absent, `typeof monthlyIncome === "string"` |
| loan shape (`:150-158`) | `loanType`, `assignedUserId`, `code` present; the demo-era `type` and `assignedTo` absent |
| user shape (`:160-167`) | `roleName` and `assignedBanks` present, `assignedBanks` is an array, no `$argon2` in the body |
| dashboard stats shape (`:169-187`) | All 12 snake_case keys present |
| recycle bin shape (`:189-207`) | `label` present, `daysRemaining` is a number, `snapshot` is `undefined` |
| roles shape (`:209-215`) | `super_admin.permissions` is an array containing `system.access_all_banks` |
| notifications (`:217-222`) | 200, `data` deep-equals `[]`, `meta.unread === 0` |

### 2.4 `employee-lifecycle.test.ts` (25 cases, untracked)

| Block | Endpoints | Asserted |
|---|---|---|
| create an employee (`:62-211`), 11 cases | `POST /api/users`, `GET /api/users`, `GET /api/teams`, `POST /api/auth/login`, `POST /api/auth/change-password` | One call sets role + `bankIds` + `teamId` → 201 (`:66-87`); `temporaryPassword` is ≥12 chars, passes `passwordProblems()`, and contains none of `0 O 1 l I` (`:89-95`); the DB stores an `$argon2id$` hash, not the plaintext, with `mustChangePassword = true` (`:97-102`); `GET /api/users` leaks neither `passwordHash`, `password_hash`, `$argon2id$` nor the temp password (`:104-111`); `assignedBanks` and team membership are readable back (`:113-122`); the employee can log in and both `body.mustChangePassword` and `body.user.mustChangePassword` are `true` (`:124-130`); the Executive permission set contains `customers.view / requests.create / documents.upload` and **none** of 10 named administrative permissions, with `unrestrictedBankAccess === false` (`:132-157`); `GET` on `/api/users`, `/api/roles`, `/api/audit-logs`, `/api/dashboard/stats` all 403, and self-promotion via `POST /api/users` 403 (`:159-177`); wrong password → 401 (`:179-183`); change-password → 204, old password then 401, new password 200 with `mustChangePassword === false` (`:185-201`); a 5-char replacement → 422 (`:203-210`) |
| password reset (`:213-325`), 6 cases | `POST /api/users/:id/reset-password` | Returns a policy-valid password that logs in with `mustChangePassword = true` (`:230-245`); two consecutive resets produce different values and the first is dead (`:247-263`); a reset **revokes existing refresh cookies** — `POST /api/auth/refresh` with the pre-reset cookie → 401 (`:265-280`); the response contains no `$argon2id$` and no `passwordHash` (`:282-289`); an Admin resetting a peer Admin or a Super Admin → 403, resetting an Executive → 200 (`:291-313`); an Executive resetting anyone → 403 (`:315-324`) |
| revoke / restore (`:327-367`), 2 cases | `PATCH /api/users/:id`, `POST /api/auth/login` | `status: "Inactive"` → subsequent login 403 (`:346-357`); `status: "Active"` → login 200 again (`:359-366`) |
| creation guard rails (`:369-445`), 6 cases | `POST /api/users`, `POST /api/auth/login` | Duplicate email → 409 with a message matching `/email/i` (`:370-382`); duplicate employee code → 409 matching `/employee code/i` (`:384-396`); `roleId: ""` → 422 (`:398-404`); Admin creating a Super Admin → 403 (`:406-420`); the frontend demo credentials `demo.employee@risenext.com / Demo@12345` posted to the real login route → **401**, i.e. the demo is not a backend bypass (`:422-430`); a non-existent `teamId` → 404 (`:432-444`) |

---

## 3. Coverage matrix

Legend: **Y** covered; **P** partially covered (the happy path or one branch only); **N** not covered; **N/A** the feature does not exist in the codebase.

| Behaviour | Tested? | Where | What is actually asserted |
|---|:--:|---|---|
| Login — success | Y | `authorization.test.ts:26-30` (helper, asserts 200 on every call site), `employee-lifecycle.test.ts:124-130` | 200; `user.role.key`; `mustChangePassword` on both the envelope and the profile |
| Login — wrong password | Y | `authorization.test.ts:79-91`; `employee-lifecycle.test.ts:179-183` | 401; response does not contain the real password |
| Login — deactivated account | Y | `employee-lifecycle.test.ts:346-357` | `status: "Inactive"` → 403 at the login route (`auth.routes.ts:131`) |
| Deactivation applied to a **live access token** | N | — | `services/access.ts:52` throws `forbidden` for a non-Active account on every request; no test carries a token across a deactivation |
| Role disabled mid-session | N | — | `access.ts:53` / `auth.routes.ts:132` never exercised |
| User enumeration | P | `authorization.test.ts:79-91` | Only that the two 401 **messages are equal**. Not asserted: response timing, and the lockout oracle — `auth.routes.ts:103-106` returns **429** for a locked *existing* account while an unknown address still returns 401, which distinguishes real accounts after 8 failures |
| Token refresh — success | **N** | — | `POST /api/auth/refresh` (`auth.routes.ts:157-193`) is called exactly once in the entire suite, at `employee-lifecycle.test.ts:278`, and only to assert **401** |
| Refresh rotation (old cookie invalid, new cookie issued) | **N** | — | `auth.routes.ts:183-188` revokes the used token and issues a new one. Zero tests |
| Refresh reuse → revoke all sessions | **N** | — | `auth.routes.ts:172-181` — the compromise-detection branch. Zero tests |
| Logout | **N** | — | `POST /api/auth/logout` (`auth.routes.ts:195-210`) appears in **zero** test files (verified by grep across `src/tests/`) |
| Change password | Y | `employee-lifecycle.test.ts:185-210` | 204; old password dies; new password works; `mustChangePassword` flips to `false`; a weak replacement → 422 |
| Change password revokes other sessions | N | — | `auth.routes.ts:251-254` revokes all refresh tokens for the user. Never asserted |
| Forced-change **enforcement** | **N** | — | The flag is asserted (`employee-lifecycle.test.ts:101,128-129,199-200,244`) but **no backend guard exists to test**: grep for `mustChangePassword` in `src/middleware/` returns nothing. Enforcement is React-only, at `frontend/src/components/layout/app-shell.tsx:39-48`, which has no test |
| Employee create | Y | `employee-lifecycle.test.ts:66-87`; `workflow.test.ts:78-90` | 201; email echoed; role/bank/team applied |
| Employee create — duplicate email | Y | `employee-lifecycle.test.ts:370-382` | 409, message matches `/email/i` |
| Employee create — duplicate employee code | Y | `employee-lifecycle.test.ts:384-396` | 409, message matches `/employee code/i` |
| Employee update | P | `employee-lifecycle.test.ts:346-366`; `workflow.test.ts:92-120` | Only `status` toggling and the two 403 denials. No test PATCHes name/branch/target/phone and reads the value back |
| Employee deactivate / reactivate | Y | `employee-lifecycle.test.ts:346-366` | Login 200 → 403 → 200 |
| Admin password reset | Y | `employee-lifecycle.test.ts:230-324` (6 cases) | New credential works; old dies; sessions revoked; no hash leaked; hierarchy and permission both enforced |
| Role assignment | P | `workflow.test.ts:78-120`; `authorization.test.ts:269-271,280-281` | Assignment at creation and the denial paths. `assertCanAssignRole` is unit-tested. No test changes a role on an existing user **and then verifies the new permission set takes effect** |
| Team assignment | P | `employee-lifecycle.test.ts:113-122,432-444` | Create-with-`teamId` and a 404 for a ghost team. The dedicated team-membership routes are never called |
| Bank assignment | P | `employee-lifecycle.test.ts:116` | Only `bankIds` at creation. `PUT /api/users/:id/banks` (`admin.routes.ts:386`) is **never called by any test** |
| Permission denial (403) | Y | `authorization.test.ts:202-217,219-253`; `employee-lifecycle.test.ts:159-177` | Missing permission → 403; mid-session revocation applies on the next request |
| Bank-scope isolation | Y | `authorization.test.ts:118-199`; `workflow.test.ts:358-374` | List, direct-id, create, update and cross-resource isolation; empty-assignment fails closed |
| Privilege escalation | Y | `workflow.test.ts:42-141`; `authorization.test.ts:256-293`; `employee-lifecycle.test.ts:406-420` | Peer/superior creation, modification, promotion, and role-minting all 403 |
| Customer CRUD | Y | `authorization.test.ts:124-152,207-217,344-360`; `workflow.test.ts:394-459` | Create 201, read, update, soft delete 204, restore, purge |
| Customer full-field round trip | N | — | The frontend `Customer` interface declares **30 fields** (`frontend/src/lib/types.ts:92-122`); no test posts more than the 6 in `customerPayload` (`harness.ts:116-127`) plus `aadhaar` |
| Customer import | Y | `workflow.test.ts:486-595` | Preview/confirm/idempotency/scoping/template headers — the most thoroughly tested feature in the repo |
| Loan workflow | P | `workflow.test.ts:202-283` | Creation, cross-bank rejection and both verification branches only. **No test PATCHes a loan status** and no test calls any `POST /api/{resource}/:id/approve` |
| Bank-order creation | **N** | — | `POST /api/bank-orders` is never called. Only `GET` appears (`frontend-contract.test.ts:77`; `workflow.test.ts:369-373`, asserting an empty list) |
| Document upload | **N** | — | No test POSTs to `/api/documents`; only `GET` (`frontend-contract.test.ts:82`). There is no upload path to test: `multer` appears only in `src/modules/imports.routes.ts:2,27-28` with `memoryStorage`, and `documents.storage_key` (`db/schema/operations.ts:371`) is only ever an optional string in a JSON body (`operations.routes.ts:399`) |
| Notifications | P | `frontend-contract.test.ts:217-222` | Only that `GET /api/notifications` returns `[]` and `meta.unread === 0`. That is all it *can* assert — nothing in the backend ever inserts a notification row |
| Audit write | Y | `authorization.test.ts:402-427,429-452`; `workflow.test.ts:454-458` | Row created with actor; immutable under raw SQL; PII never in the diff; survives a purge |
| Audit-log **listing** | P | `employee-lifecycle.test.ts:162-165` | Only the 403 case for an Executive. No test asserts a successful `GET /api/audit-logs` body or its filters |
| Recycle bin | Y | `authorization.test.ts:363-398`; `workflow.test.ts:393-483`; `frontend-contract.test.ts:189-207` | Soft delete, listing, `daysRemaining`, restore, confirmation-gated purge, cross-bank denial |
| Pagination correctness | P | `frontend-contract.test.ts:99-110` | Only the **bounds**: 500 accepted, 5000 → 422. No test requests page 2, asserts non-overlapping rows, or checks `meta.total` / `meta.page` |
| Validation | P | scattered: `frontend-contract.test.ts:109`; `employee-lifecycle.test.ts:209,403`; `workflow.test.ts:235,338` | Five one-off rejections (422 ×3, 400 ×2). No systematic per-schema negative testing — the vast majority of Zod schemas have no test that a malformed body is rejected |
| Rate limiting | **N/A → N** | — | No rate limiter exists anywhere in `src`. The only throttle is the per-account lockout at `auth.routes.ts:114-129` (8 attempts / 15 min), and **it has zero tests** — no test ever fails a login 8 times |
| Email | **N/A** | — | The feature does not exist: no provider dependency in `package.json`, no transport code, no templates, no `EMAIL_/SMTP_/MAIL_` variables. Nothing to test, and no test pretends otherwise |

**Derived endpoint coverage:** counting every distinct `METHOD + path` combination that appears across the four test files (including the 17 distinct paths inside `FRONTEND_CALLS`) gives **46** — 23 GET, 18 POST, 3 PATCH, 2 DELETE, **0 PUT**. Against the project's 96 endpoints that is roughly 48%: about **50 endpoints are never invoked by any test**, including every `POST /:id/approve` the resource factory generates and every `PUT` route in the codebase.

---

## 4. False confidence

A green run of all 107 cases is a weaker signal than it looks. This section exists so nobody reads "107 passing" as "the product works".

### 4.1 `frontend-contract.test.ts` is not a frontend test

It is the file most likely to be mistaken for one, and it is the most misleading.

- **It imports nothing from the frontend.** Its entire import list is `vitest`, `supertest`, and `./harness.js` (`:1-10`). There is no path into `frontend/`, no shared package, no generated client, no OpenAPI document. The name is the only connection.
- **Its "frontend types" are hand-copied literals in a backend file.** The 25 `FRONTEND_CALLS` entries (`:62-88`) and the expected-key lists (`:142`, `:171-184`) were transcribed by a human. If a page changes `pageSize: 500` to `1000`, or starts sending a new query parameter, this file keeps passing while the page 422s. Nothing links the two, so nothing can detect the divergence.
- **It checks 9 of 30 Customer fields.** The `Customer` interface declares 30 fields (`frontend/src/lib/types.ts:92-122`). The shape test loops over 7 names, then adds `aadhaarLast4` and `monthlyIncome` (`:142-147`). The other 21 — `fatherName`, `dob`, `gender`, `pan`, `cibil`, `ifsc`, `assignedTeamId`, and the rest — could all vanish from the API response and the suite stays green while the customer detail page renders blanks.
- **Every call runs as `super_admin`.** The `beforeAll` creates one user with `roleKey: "super_admin"` and every request in the file uses that token (`:35-39`, `:30`). No Admin, Manager, Team Leader or Executive persona is exercised anywhere in this file. It therefore proves nothing about what the four non-admin roles — i.e. almost all real users — actually see when they open a page. A page that 403s for every Executive would pass this file unchanged.
- **It is GET-only.** The `it.each` body is `request(ctx.app).get(path)` (`:92`); all 25 entries are reads. Not one mutating call the UI performs is contract-tested.
- **One title over-promises.** `"honours ?customerId on loans, documents and transactions"` (`:114`) requests only `/api/loans`. Documents and transactions are named in the title and never called.

### 4.2 What a fully green suite is compatible with

Each of the following can be completely broken while all 107 cases pass.

| Broken thing | Why the suite cannot see it |
|---|---|
| **Production cookie flags** | `refreshCookieOptions()` branches on `NODE_ENV === "production"` (`src/lib/tokens.ts:75-86`). The harness forces `NODE_ENV: "test"` (`harness.ts:19`, `setup.ts:5`), so the tests only ever observe `secure: false, sameSite: "lax"`. The `sameSite: "none"` + `Secure` + `COOKIE_DOMAIN` combination that production depends on for a cross-site Vercel↔Railway deployment is **never executed even once** |
| **CORS** | The allow-list callback at `app.ts:56-59` passes unconditionally when no `Origin` header is present. supertest sends none. The rejection branch never runs; a `CORS_ORIGIN` that excludes the real frontend origin is invisible |
| **`pg` vs PGlite driver behaviour** | Production runs node-postgres against Neon (`pg` in `package.json:30`); tests run `drizzle-orm/pglite` (`harness.ts:2`). Connection pooling, statement timeouts, SSL, serialisation failures, numeric/`bigint` return typing and Neon's proxy behaviour are all untested. The suite proves the SQL is *valid*, not that the shipped driver behaves the same way |
| **Whether the frontend calls the right paths** | See 4.1. The suite tests a hand-copy of the frontend's intentions, not the frontend |
| **All frontend rendering** | Zero tests exist for any React component, hook, page or route (`frontend/package.json` has no test tooling). Every table, form, guard, chart and empty state is unverified |
| **The demo short-circuit** | The demo branch lives in the browser (`frontend/src/hooks/use-auth.tsx`), and `disableDemoMode()` has exactly one call site — inside `signOut`'s demo branch at `use-auth.tsx:212`. The real-login path never clears the flag, so a demo session followed by a real sign-in can leave the flag set. `employee-lifecycle.test.ts:422-430` proves only that the demo *credentials* are rejected by the API; it cannot reach the client-side branch that never sends them |
| **The 13 fake handlers** | Thirteen UI controls call `refresh()` and raise a toast without issuing any HTTP request — e.g. `loans/page.tsx:68` `updateStatus`, `bank-orders/page.tsx:58` `moveStage` and `:64` `saveRemark`, `settlements/page.tsx:35` `markPaid` and `:44` `raiseDispute`. The matching backend routes exist and are correct; the suite tests those routes; the buttons never call them. A backend-only suite is structurally incapable of catching this class of bug |
| **Email** | Does not exist |
| **File storage** | Does not exist. A "document upload" that persists nothing would pass every test in the repo |
| **Deployment** | No Dockerfile, no `vercel.json`, no `railway.*`, no `Procfile`, no CI. Nothing verifies the build, the migration step, or the runtime env contract |
| **Rate limiting** | Does not exist. The account lockout that partially substitutes for it has no test |
| **Refresh rotation and reuse detection** | The rotation branch (`auth.routes.ts:183-188`) and the compromise branch (`:172-181`) are both untested. Session rotation could be silently issuing non-rotating tokens |
| **Logout** | Untested end to end. The route could fail to revoke the token or fail to clear the cookie |

---

## 5. Gaps — proven, not asserted

**Zero frontend tests.**
`frontend/package.json:6-12` defines `dev`, `build`, `start`, `lint`, `typecheck` — no `test`. `frontend/package.json:38-48` lists 10 devDependencies: `@eslint/eslintrc`, `@tailwindcss/postcss`, `@types/node`, `@types/react`, `@types/react-dom`, `eslint`, `eslint-config-next`, `tailwindcss`, `typescript`. No Vitest, no Jest, no `@testing-library/*`, no `jsdom`. `git ls-files | grep -Ei 'playwright|cypress|jest|\.spec\.'` returns nothing.

**Zero E2E tests.**
No Playwright, Cypress, WebdriverIO or Puppeteer dependency in either `package.json`; no `playwright.config.*`, no `cypress/`, no `*.spec.ts` tracked anywhere in the repo (same `git ls-files` check). Both `vitest.config.ts` and the backend suite drive Express in-process via supertest — no browser is ever launched.

**No CI.**
`.github` does not exist (`ls .github` → "No such file or directory"). `git ls-files | grep -Ei '\.(yml|yaml)$'` returns **zero** tracked YAML files of any kind. There is no Dockerfile, `vercel.json`, `railway.json/toml` or `Procfile` in the repo. Repository root contains only `.env.example`, `README.md`, `backend/`, `docs/`, `frontend/`. Nothing runs `npm test` except a human, on a laptop, when they remember.

---

## 6. Target strategy

### 6.1 The pyramid we need

```
              ┌───────────────────────────┐
              │  E2E — Playwright         │   ~25 specs, 5 role personas
              │  real browser, real API   │   the only layer that sees
              └───────────────────────────┘   the fake handlers
          ┌───────────────────────────────────┐
          │  Component / hook — Vitest +      │  ~80 tests
          │  @testing-library/react + jsdom   │  every page's mutating controls,
          └───────────────────────────────────┘  guards, empty & error states
    ┌───────────────────────────────────────────────┐
    │  API integration — Vitest + supertest + PGlite │  ~200 tests
    │  (the layer that already exists — extend it)   │  all 96 endpoints × role matrix
    └───────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│  Unit — Vitest. permissions.ts, password.ts, tokens.ts, │  ~60 tests
│  scoped-resource query building, Excel row validation   │  fast, no DB
└────────────────────────────────────────────────────────┘
```

The base layer is the one that already works well; the two upper layers do not exist at all. The inversion is the problem: today the suite is a single mid-layer band with nothing above and very little below it.

### 6.2 Required additions, per layer

| Layer | Tool | Location | Required additions |
|---|---|---|---|
| Unit | Vitest (already installed) | `src/**/*.test.ts` | `generateTemporaryPassword` — 10 000 samples, assert every one passes `passwordProblems` and excludes `[0O1lI]` (`password.ts:72-87`); `passwordProblems` — a table of ~20 inputs → expected problem arrays; `signAccessToken`/`verifyAccessToken` — expiry, wrong secret, `tokenType` confusion between access and refresh (`tokens.ts:40-64`); `refreshCookieOptions()` under **both** `NODE_ENV` values, asserting `secure`/`sameSite`/`domain` (`tokens.ts:66-87`) — this closes the single most dangerous prod-only branch; the level rules in `permissions.ts:190-313` as an exhaustive 5×5 role matrix |
| API integration | Vitest + supertest + PGlite (already installed) | `src/tests/` | Extend the harness with a **persona fixture** returning tokens for all 5 default roles, then drive a `describe.each(ROLES) × describe.each(ENDPOINTS)` matrix over all 96 endpoints asserting the expected status per role — this alone takes endpoint coverage from ~48% to 100% and role coverage from 1 to 5. Plus the specific holes in §3: full auth-session lifecycle, pagination page-2 correctness, per-schema validation rejections, the approve endpoints, `PUT /api/users/:id/banks`, `GET /api/audit-logs` success path |
| Component | Vitest + `@testing-library/react` + `jsdom` + `msw` (**all to be added** to `frontend/package.json`, plus a `test` script) | `frontend/src/**/*.test.tsx` | Every page's mutating controls (see §6.3); `useAuth` — demo enter/exit, token refresh on 401, `disableDemoMode` on the **real** sign-in path (`use-auth.tsx:212`); `AppShell` guards — unauthenticated redirect, demo out-of-scope redirect, and `mustChangePassword` redirect (`app-shell.tsx:20-48`), which is currently the *only* enforcement of forced password change anywhere in the system; loading / empty / error branches of every table |
| E2E | Playwright (**to be added**) | `e2e/` at the repo root | Full journeys against a built Next.js app and a real Express server on a throwaway Postgres, per §6.3 |

### 6.3 Must-have tests

**1. The "every mutating control issues a request" test — the single highest-value test in this plan.**

Design: for each page under `frontend/src/app/(app)/`, render it with an `msw` handler set that records every intercepted request. Query all interactive elements whose accessible name matches a mutation vocabulary (`/save|delete|remove|approve|reject|mark|move|retry|settle|dispute|upload|print|submit|create|update|assign|revoke/i`). Click each. Assert that at least one request with a method other than `GET` was recorded, and that its path is in the backend's route table.

This one test file would have caught **all 13** current fake handlers: `loans/page.tsx:68`; `bank-orders/page.tsx:58` and `:64` (a file that makes zero write calls at all); `disbursement/page.tsx:81` and `:87`; `settlements/page.tsx:35` and `:44`; `transactions/page.tsx:36`; `documents/page.tsx:104` and `:109`; `customers/[id]/page.tsx:458`, `:483` and `:185` (also zero write calls); plus `customers/page.tsx:232` `handleManualFormUpload`, which reads a `File`, discards it, and toasts "queued for verification". It is also a permanent regression guard: any future button wired to a toast instead of the API fails immediately.

**2. Role-based E2E, one journey per default role** (`src/lib/permissions.ts:190-313`).

| Persona | Journey the spec must complete |
|---|---|
| `super_admin` (level 0) | Create a bank → create an employee → hand over the temp password → view audit log → purge a recycle-bin entry |
| `admin` (level 10) | Create a Manager → **fail** to create an Admin or Super Admin → reset a junior's password → confirm the Employees screen offers no Super Admin option |
| `manager` (level 20) | See only assigned banks → create and progress a loan → **fail** to open Roles or Audit Logs |
| `team_leader` (level 30) | Import a customer workbook → see the cross-bank row rejected → assign work within the team |
| `executive` (level 40) | Log in with a temp password → be **forced** to `/change-password` and blocked from every other route → create a customer → **fail** on `/employees`, `/settings`, `/audit-logs` |

Each spec asserts on rendered DOM, not on API responses. The forced-change journey is the only way to test `app-shell.tsx:39-48`, because no backend guard exists.

**3. Security regression tests.**

| Test | Asserts | Currently |
|---|---|---|
| Rate limit | N rapid requests from one IP to `/api/auth/login` → 429 | The limiter does not exist. This test must be written **with** the limiter, and must fail until it ships |
| Enumeration | Unknown vs known email: identical status, identical body, and response times within a tolerance band. Critically: an account locked by `auth.routes.ts:103-106` must **not** return 429 where an unknown address returns 401 | Only message equality is checked (`authorization.test.ts:88-90`) |
| Lockout + recovery | 8 failures → 429 (`MAX_FAILED_ATTEMPTS`, `auth.routes.ts:28-29`); a correct password during the window still fails; after `POST /api/users/:id/reset-password` the account is immediately usable (`admin.routes.ts` clears `failedLoginAttempts` and `lockedUntil`) | Zero tests touch the lockout counter |
| IDOR | For every resource, a bank-B token requesting a bank-A record by id gets 404 (not 403 — 403 confirms existence). Run as `describe.each` over all 9 factory resources, not just customers | Only customers and loans (`authorization.test.ts:141-144`, `workflow.test.ts:366`) |
| Session lifecycle | Refresh rotates and invalidates the old cookie; replaying a rotated cookie revokes **all** sessions (`auth.routes.ts:172-181`); logout revokes and clears; a deactivated user's live access token is rejected on the next request (`access.ts:52`) | Untested |
| Mass assignment | POST/PATCH bodies containing `id`, `code`, `passwordHash`, `createdBy`, `deletedAt` are ignored or rejected | Untested |

**4. A CI workflow — described here, deliberately not created.**

The definition below is the target; creating `.github/workflows/*.yml` is a separate, explicitly-authorised change.

- **Trigger:** `push` to `main`, and `pull_request` targeting `main`.
- **Runner:** `ubuntu-latest`, Node 20 (matching `package.json:7` `engines.node >= 20`), npm cache keyed on both lockfiles.
- **Job `backend`:** `npm ci` in `backend/` → `npm run typecheck` → `npm run lint` → `npm test`. No database service needed — PGlite is in-process.
- **Job `frontend`:** `npm ci` in `frontend/` → `npm run typecheck` → `npm run lint` → `npm test` (once the script exists) → `npm run build`. The build step alone would catch Next.js App Router regressions that nothing currently catches.
- **Job `e2e`** (needs both above): a `postgres:16` service container, run the real migrations and seed against it, start the Express server and a production `next start`, run Playwright across the 5 role personas, upload traces and videos as artifacts on failure.
- **Job `migrations`:** apply `drizzle/*.sql` to an empty database, then assert the Drizzle schema generates **no new migration** — a mechanical guard on the current zero-schema-drift state (27 `CREATE TABLE` == 27 `pgTable`).
- **Branch protection:** `backend`, `frontend` and `migrations` required to pass before merge; `e2e` required once it is stable.

### 6.4 Practices to adopt alongside

- Add a coverage provider and publish the number. Do not set a percentage gate before the pyramid exists — a high line-coverage number on a suite with one persona is exactly the false confidence §4 describes.
- Replace the hand-copied `FRONTEND_CALLS` array with something derived: either generate a typed client from the route table and have both the pages and the contract test import it, or have the frontend export its call table and import **that** into the backend test. Until one of those exists, `frontend-contract.test.ts` is documentation with a green tick, not a contract.
- Every bug fixed from now on ships with the test that reproduces it, in the layer that would have caught it.

---

## 7. Definition of adequate coverage, per phase

Phase names below are descriptive of the work this codebase actually needs. If `docs/ROADMAP.md` numbers its phases differently, treat these as a mapping by content, not by number.

### Phase 1 — Make the UI honest (remove the fake handlers)

The product currently shows success toasts for operations that never happen. Nothing else matters until that is closed.

| Requirement | Bar |
|---|---|
| The §6.3 "every mutating control" test | Exists and passes for **all** pages under `frontend/src/app/(app)/` |
| Frontend test infrastructure | `frontend/package.json` has a `test` script, Vitest, `@testing-library/react`, `jsdom`, `msw` |
| Component tests | Every page that mutates data has one test proving the request is issued and one proving the failure path surfaces an error rather than a success toast |
| `AppShell` guards | All three redirects tested (`app-shell.tsx:20-48`), including the forced-password-change redirect |
| CI | `backend` + `frontend` jobs green and required on every PR |
| Backend | The existing 107 stay green; `PATCH /api/loans/:id` and the `approve` endpoints gain tests, since the buttons are about to start calling them |

**Exit criterion:** no UI control anywhere in the app can report success without an HTTP request having been made.

### Phase 2 — Complete the operational workflow

| Requirement | Bar |
|---|---|
| Endpoint coverage | 100% of 96 endpoints invoked by at least one integration test — up from the derived ~48% |
| Role coverage | Every endpoint tested against all 5 default roles via `describe.each`, asserting the expected status per role — up from 1 role in `frontend-contract.test.ts` |
| Auth lifecycle | Refresh success, rotation, reuse detection, logout, deactivation-mid-session, change-password session revocation — all covered |
| Validation | Every Zod schema has at least one rejection test |
| Pagination | Page-2 correctness and `meta` accuracy for every list endpoint |
| E2E | Playwright installed; the 5 role journeys of §6.3 pass against a real browser and a real Postgres |
| Notifications / documents | If either feature is implemented in this phase, it ships with tests that assert **persistence** — a row written, a file retrievable — not merely a 200 |

**Exit criterion:** no endpoint and no role is untested, and a full user journey is verified in a browser.

### Phase 3 — Production readiness

| Requirement | Bar |
|---|---|
| Security regression suite | All six rows of §6.3 item 3 pass, including rate limiting (which requires the limiter to exist) |
| Production-branch coverage | `refreshCookieOptions()` tested under `NODE_ENV=production`; CORS tested with explicit allowed and disallowed `Origin` headers; both currently unreachable |
| Driver parity | At least one smoke suite run against real Postgres via `pg`, not PGlite, so Neon-specific behaviour is exercised before release |
| Email / file storage | If either is built, it ships with integration tests against a fake transport / storage backend and a negative test proving failures surface to the user |
| Deployment | The `migrations` CI job passes; a documented rollback path is exercised at least once |
| Load | A basic throughput and p95 latency baseline on the dashboard aggregates and the largest list endpoints — **UNVERIFIED** whether any performance target has been agreed |
| Gate | `e2e` required for merge; coverage published per PR with a no-regression rule |

**Exit criterion:** every branch that only executes in production has been executed at least once in CI, and the security suite would fail loudly if any of the six regressions were reintroduced.
