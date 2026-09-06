# AUDIT VERIFICATION

**Purpose:** independently re-verify every claim from the previous repository audit against the actual code, and correct anything wrong. This file exists so that no earlier mistake is preserved as fact.

**Verified against:** commit `7ef5da5` ("Add frontend-only employee demo") **plus the dirty working tree** (8 modified + 4 untracked files).
**Method:** static analysis only. No file modified, no dependency installed, no server or database started. All commands read-only (`git log/show/diff/status`, `grep`, `find`, `cat`).
**Verification date:** 2026-08-31.

---

## 0. HOW TO READ THIS FILE

| Verdict | Meaning |
|---|---|
| **MATCH** | The previous audit claim is correct and independently confirmed. |
| **MATCH (refined)** | Claim correct, but this document adds precision the audit lacked. |
| **DIFFERENCE** | The claim is wrong or misleading. The corrected fact is given. |
| **OUTDATED** | The claim was true of a different tree state (usually HEAD vs working tree). |
| **UNVERIFIABLE** | Cannot be settled by static analysis; needs the live environment. |

**Critical reading note used throughout:** the repository has an **uncommitted working tree** that is materially more complete than `HEAD`. Several claims are true of one and false of the other. Every such case is labelled.

---

## 1. BACKEND / DATABASE NUMBERS

| # | Previous claim | Actual finding | Verdict | Evidence |
|---|---|---|---|---|
| 1.1 | ~96 backend API endpoints | **96 in the working tree; 95 at HEAD.** 52 (HEAD: 51) hand-written + 44 factory-generated. The difference is `POST /api/users/:id/reset-password`, which is new in the uncommitted work. | **MATCH (refined)** | `admin.routes.ts` has **23** route definitions in the working tree and **22** at HEAD (`git show HEAD:src/modules/admin.routes.ts \| grep -cE "^\s*[A-Za-z_]+Router\.(get\|post\|patch\|put\|delete)\("`). 44 = 9 × `createScopedResource` with per-resource conditional routes (below). |
| 1.2 | ~27 endpoints used by frontend | **DIFFERENCE — the correct figure is 38 distinct METHOD+path pairs (36 at HEAD), leaving 58 dead (60%), not 69 (72%).** | **DIFFERENCE** | The "27" figure counts only what the 25-entry `FRONTEND_CALLS` array in `frontend-contract.test.ts:62-88` replays. That array is **GET-only** and omits all 16 write paths: login, refresh, logout, change-password, `POST` banks/customers/users/reset-password/loans/disbursements/ledger/documents, recycle-bin restore and permanent-delete, imports upload and confirm, `PATCH` banks and users, `DELETE` customers. Exhaustive enumeration of `api.*`, `apiRequest` and raw `fetch` call sites, plus resolution of every `useResource`/`useRecord`/`useStats` path, gives **38**. |
| 1.3 | ~27 database tables | **Exactly 27.** `CREATE TABLE` count in migrations = 27; `pgTable(` count in TS = 27 (identity 7 + domain 3 + governance 5 + operations 12). | **MATCH** | `grep -ohiE "^CREATE TABLE" drizzle/*.sql \| wc -l` → 27. |
| 1.4 | PostgreSQL | Confirmed — Neon Postgres via `node-postgres` Pool. | **MATCH** | `src/db/index.ts` |
| 1.5 | Drizzle | Confirmed — `drizzle-orm` 0.44.7, `drizzle-kit` 0.31.6, file-based migrator. | **MATCH** | `package.json`, `src/db/migrate.ts` |
| 1.6 | Substantial real backend implementation | Confirmed. Every one of the 96 endpoints performs real Drizzle queries. **Zero** `TODO`/`FIXME`/`stub`/`placeholder`/`mock` markers exist anywhere in `src`. No endpoint returns hardcoded data. | **MATCH** | repo-wide grep |
| 1.7 | Substantial auth implementation | Confirmed and high quality — argon2id, timing-equalised unknown-user path, rotating refresh tokens with reuse detection. | **MATCH** | `src/modules/auth.routes.ts`, `src/lib/password.ts`, `src/lib/tokens.ts` |
| 1.8 | Role/permission system | Confirmed. Normalized `role_permissions` rows, resolved from the database **on every request** rather than trusted from the JWT. | **MATCH** | `src/services/access.ts:30`, `src/middleware/auth.ts:26` |
| 1.9 | Bank-level access scoping | Confirmed, and it **fails closed** — a user with no bank assignments gets an impossible sentinel UUID, not the whole table. Applied in the SQL `WHERE`, not post-filtered in JS. | **MATCH (refined)** | `src/services/access.ts:108-114` |
| 1.10 | Audit logging | Confirmed, and enforced immutable by a **real database trigger**. | **MATCH** | `drizzle/0001_governance_guards.sql:16-18` |
| 1.11 | Employee lifecycle backend functionality | Confirmed — but see §2, the status differs sharply between HEAD and the working tree. | **MATCH (refined)** | |
| 1.12 | Real password hashing | Confirmed — argon2id, m=19456 t=2 p=1. Hash never appears in any response. | **MATCH** | `src/lib/password.ts:8-17` |
| 1.13 | ~107 backend runtime tests | **Exactly 107.** 26 + 22 + 34 + 25. | **MATCH** | Arithmetic in §8. |

### 1.14 Factory endpoint arithmetic (audit did not show this; recorded here as the proof for 96)

`createScopedResource` emits 4 fixed routes plus `DELETE /:id` only when `permissions.delete` is set and `POST /:id/approve` only when `permissions.approve` is set (`src/modules/scoped-resource.ts:102,155,170,205,251,271`).

| Resource | delete? | approve? | Endpoints |
|---|---|---|---|
| loans | yes | yes | 6 |
| verifications | no | yes | 5 |
| bank-orders | yes | no | 5 |
| disbursements | no | yes | 5 |
| settlements | no | yes | 5 |
| transactions | no | no | 4 |
| ledger | no | no | 4 |
| documents | yes | no | 5 |
| funding-sources | yes | no | 5 |
| **Total** | | | **44** |

52 + 44 = **96**. Confirmed.

### 1.15 Additional facts the previous audit did not record

| Fact | Evidence |
|---|---|
| 62 foreign keys (20 in `0000_init.sql`, 42 in `0002_operations.sql`) | `grep -ciE "REFERENCES "` |
| **7** database triggers, all in `0001_governance_guards.sql` | `grep -ciE "CREATE TRIGGER"` |
| **Zero `CHECK` constraints** anywhere in the schema | `grep -i CHECK drizzle/*.sql` matches only the column name `checksum` |
| **Zero schema drift** — every column in `src/db/schema/*.ts` appears in the migration SQL and in `drizzle/meta/0002_snapshot.json` | column-by-column comparison |
| 22 route mounts | `src/app.ts:78-99` |

> **README DISCREPANCY (new finding).** `README.md` line 61-63 claims the migrations produce **"9 triggers"**. The migrations contain **7**. The same sentence's counts for tables (27) and foreign keys (62) are correct. `README.md` is otherwise stale in several places — see §12.

---

## 2. EMPLOYEE CREATION — the central question

The previous audit's conclusion was correct in substance. This section replaces it with a precise, per-tree-state answer.

### 2.1 Point-by-point

| Question asked | HEAD (what a deploy from git ships) | Working tree (uncommitted) | Evidence |
|---|---|---|---|
| Can Super Admin create an employee? | **Yes at the API level** — but the flow is unusable, see 2.2. | **Yes, fully.** | `src/modules/admin.routes.ts:159` |
| Does the frontend call the correct endpoint? | **Yes.** `POST /users` → `{API}/api/users`. Character-for-character match. | Yes. | `frontend/src/app/(app)/employees/page.tsx:158`, `src/app.ts:82` |
| Does the backend create the DB record? | **Yes**, inside one transaction. | Yes. | `admin.routes.ts:192-239` |
| Is the role assigned? | **Yes**, with a hierarchy guard. **But at HEAD the form defaults to `roles[0]`, and `/roles` is ordered by ascending level, so the default is Super Admin.** An untouched form silently mints another Super Admin. | Yes, and the defect is fixed — the role is now a required explicit choice, and the dropdown is filtered to assignable roles only. | HEAD `employees/page.tsx:71`; `admin.routes.ts:481`; working tree `employees/page.tsx:154` and its own comment acknowledging the old bug |
| Is the team assigned? | **No.** `teamId` is not in the HEAD schema or the HEAD form. | **Yes** — new optional `teamId`, permission-checked (`teams.assign`), existence-checked, inserted into `team_members` in the same transaction. | `admin.routes.ts:55,174-184,220-224` |
| Is bank/access scope assigned? | **No.** The HEAD form sends no `bankIds`. Consequence: the new employee's `bankScope` is empty and they see an entirely empty application. | **Yes** — bank checkboxes in the form, `bankIds[]` in the payload, `user_bank_access` rows written in the same transaction. | `employees/page.tsx:169`; `admin.routes.ts:214-218` |
| Is a temporary password generated? | **Yes**, but by `randomToken(12)` (base64url), which is **not validated against the password policy** — the policy check only fires for admin-supplied passwords. It could lack an uppercase letter or a digit. | **Yes**, by `generateTemporaryPassword()` — 14 chars, one of each required class seeded then Fisher-Yates shuffled with rejection-sampled bytes, ambiguity-free alphabet (`0/O/1/l/I` excluded), guaranteed to satisfy the policy. | HEAD `admin.routes.ts` (`randomToken(12)`); working tree `src/lib/password.ts:72-87` |
| Is it safely displayed to the admin? | **NO — this is the decisive HEAD defect.** The backend returns `temporaryPassword` in the 201 body; the frontend types the response as `{id, name}` and **never reads it**. The credential is generated, hashed, stored, and then discarded unrecoverably. | **Yes** — a one-time hand-over dialog with a copy button and the warning "Save this password now. It will not be shown again." | HEAD `employees/page.tsx:81-94`; working tree `employees/page.tsx:177-187` + `frontend/src/components/shared/credential-handover.tsx` |
| Can the employee actually log in? | **In principle yes; in practice no**, because nobody knows the password and there is no email. | **Yes** — proven end to end by test. | `src/tests/employee-lifecycle.test.ts:124-130` |
| Can the employee change the temporary password? | Endpoint exists (`POST /api/auth/change-password`) but **there is no change-password page at HEAD** and nothing forces the user there. | **Yes** — dedicated page, forced redirect, all sessions revoked on success. | `frontend/src/app/(app)/change-password/page.tsx` (untracked) |
| Can the admin reset a password? | **NO.** `POST /users/:id/reset-password` **does not exist at HEAD.** The `users.reset_password` permission has been in the catalogue since the first commit with no route behind it. The UI button showed `toast.info("Reset link sent", { description: "Emailed to …" })` — a fabrication. | **Yes** — new route with hierarchy check, session revocation, lockout clearing, audit row, and one-time credential return. | HEAD `employees/page.tsx:317-318`; working tree `admin.routes.ts:328-383` |
| Is forced password change enforced by backend or frontend? | Not enforced at all — `profileOf` did not even carry the flag at HEAD. | **FRONTEND ONLY.** The flag is set, carried on the profile, and honoured by a React guard — but `grep mustChangePassword src/middleware/` returns **zero hits**. No route rejects a request from an account still on a temporary password. | `frontend/src/components/layout/app-shell.tsx:39-48`; absence proven by grep |
| Does the employee receive an email? | **No.** | **No.** | §3 |
| Is email implemented? | **No.** | **No.** | §3 |

### 2.2 Corrected root-cause statement

The previous audit's framing — "the committed frontend discarded the temporary password" — is **correct but incomplete**. There are **two independent causes**, and only one of them is fixed by the working tree.

**PRIMARY (present in BOTH HEAD and the working tree — unfixed):**
Demo mode is sticky within a browser tab and intercepts the login request itself.
1. `frontend/src/lib/api.ts:118` short-circuits **every** call when `sessionStorage["risenext.demo.session"] === "active"`.
2. `disableDemoMode` has exactly **one** call site in the whole frontend — `frontend/src/hooks/use-auth.tsx:212`, inside `signOut`'s demo branch. The real sign-in path never clears the flag. Verified by exhaustive grep.
3. `frontend/src/lib/demo/api.ts:240-249` handles `refresh`, `logout` and `me` but has **no `login` case** — it falls through to `throw notFound("Endpoint")`, so a real sign-in in a contaminated tab fails with the message **"Endpoint not found"**.
4. On reload, `/auth/refresh` is intercepted and returns the demo user (`demo/api.ts:245`), so the app auto-signs-in as the demo Executive with no credentials, and `frontend/src/app/login/page.tsx:29` bounces away from the login form. `/employees` is not in `DEMO_ROUTES`, so `app-shell.tsx:28-32` redirects to `/my-work` and the sidebar omits the item entirely.

The only exits are clicking **Sign out while inside the demo**, or closing the tab.

**SECONDARY (HEAD only — fixed in the working tree):** the create succeeds, the credential is thrown away, the button reads "Send invite", and no mailer exists. From the business side this reads as "adding an employee doesn't work".

### 2.3 Causes tested and ELIMINATED — recorded so nobody re-chases them

| Hypothesis | Verdict | Proof |
|---|---|---|
| Missing/mismatched backend route | ELIMINATED | Paths match exactly; no `/admin` segment on either side |
| Validation/schema mismatch | ELIMINATED | `userInput` is a plain `z.object`, **not `.strict()`**; all 10 sent keys are declared and type-compatible |
| Permission key mismatch | ELIMINATED | Super admin's `"*"` is expanded into real `role_permissions` rows by the seed; `users.create` is present |
| Reference-data (roles/banks/teams) failure | ELIMINATED for Super Admin | All four view permissions held; all endpoints mounted |
| `/auth/refresh` response shape mismatch | ELIMINATED | Backend returns the `user` key that `use-auth.tsx` reads |
| Frontend nav permission guard | ELIMINATED | `frontend/src/lib/nav.ts` carries **no permission field at all** |
| DB NOT NULL / trigger / FK failure | ELIMINATED | All five non-defaulted NOT NULL columns are supplied; no trigger fires on user INSERT; zero CHECK constraints |
| Migration drift | ELIMINATED | Every written column exists in `0000_init.sql` |
| Feature not committed | ELIMINATED as stated | `git show HEAD:` confirms both the handler and the route exist at HEAD — what is uncommitted is the *usable* version |

### 2.4 Still unverifiable without the live environment

| Hypothesis | What would settle it |
|---|---|
| `NEXT_PUBLIC_API_URL` unset at build time (Next inlines it, so a deploy would bake in `http://localhost:8080` and every request fails with "Failed to fetch") | The deploy's build-time env, or a browser network tab |
| No super admin exists at all — `.env.example` ships `BOOTSTRAP_SUPERADMIN_PASSWORD=` **empty**, and `src/db/seed.ts:85-90` merely logs a warning and returns if either bootstrap var is unset | `select count(*) from users` against the live database |

---

## 3. EMAIL

| Previous claim | Verdict | Evidence |
|---|---|---|
| No email provider, SMTP, Resend, SendGrid, SES, Mailgun, or Postmark | **MATCH — confirmed exhaustively** | Case-insensitive grep for `nodemailer\|sendgrid\|resend\|mailgun\|postmark\|aws-sdk\|ses\|smtp\|sendMail\|transporter\|mailer` across `src`, `frontend/src`, and both `package.json` files returns **zero real hits** (only substring false positives inside words like `statuses`, `cases`, `processes`) |
| No email configuration | **MATCH** | No `EMAIL_*`, `SMTP_*`, or `MAIL_*` key in `src/config/env.ts` or either `.env.example` |
| No invitation email | **MATCH** | No invite token, no invite table, no `/auth/accept-invite` route |
| No password-reset email | **MATCH** | No self-service reset route, no reset-token table |
| No actual sending code | **MATCH** | **There is not even a stub, a template, or a dead function.** This is not a disconnected implementation — the subsystem was never begun |
| "Invite email sent" / "Reset link sent" were UI-only | **MATCH — both confirmed at HEAD, both removed in the working tree** | HEAD `employees/page.tsx:340` *"They receive an invite email and can sign in with the role you pick."* and `:318` `toast.info("Reset link sent", { description: \`Emailed to ${selected.email}\` })` |

**Additional email fabrications the previous audit did not list:**
- `frontend/src/app/(app)/settings/page.tsx:329-333` — `handleExportRequest()` toasts *"Export queued — You'll get an email when it's ready."* There is no export job and no mailer.
- `frontend/src/app/(app)/settings/page.tsx:79-82` — a "Daily digest email" alert preference that is unimplementable.
- `frontend/src/app/(app)/settings/page.tsx:784` — an Email delivery channel with the hardcoded fallback address `admin@risenext.com`.

**Current credential delivery mechanism:** manual, out-of-band, human-to-human. The temporary password is returned once in the HTTP response body, rendered once on screen, and there is **no record that it was ever delivered**.

**Status: MISSING — subsystem not started.**

---

## 4. DEMO MODE

| Previous claim | Verdict | Evidence |
|---|---|---|
| A frontend-only demo employee system exists | **MATCH** | `frontend/src/lib/demo/` — 7 files, 1,814 lines, added by the most recent commit `7ef5da5` |
| Credentials `demo.employee@risenext.com` / `Demo@12345` | **MATCH** | `frontend/src/lib/demo/config.ts:14-15` |
| Purpose: client presentation only | **MATCH** | header comment `config.ts:1-12` |
| Static demo data, no real DB, no real backend auth | **MATCH** | `frontend/src/lib/demo/data.ts` (838 lines of fixtures); credentials matched entirely in the browser; `setAccessToken(null)` |
| **Once activated, a subsequent real login can remain inside the demo path unless the user explicitly signs out** | **MATCH — STILL PRESENT, in both HEAD and the working tree** | See §2.2. `git diff frontend/src/hooks/use-auth.tsx` touches only the `SessionUser` interface — **the fix has not been written in either tree state** |
| This can make real authentication fail and show fake data | **MATCH, and worse than stated** | It does not merely *risk* showing fake data — a page reload in a contaminated tab **auto-authenticates the visitor as the demo Executive with no credentials**, and the login form becomes unreachable |

### 4.1 Additional demo findings the previous audit did not fully capture

| Finding | Evidence |
|---|---|
| `DEMO_PASSWORD` is **shipped in the public production bundle** and survives minification as a literal inside a comparison function | present in `frontend/.next/static/chunks/` and its `.map` |
| The **entire 838-line fixture file is statically linked into the main client bundle for every visitor**, demo or not, because `lib/api.ts:10-11` deep-imports `@/lib/demo/api` at module scope and every page imports `lib/api`. Not code-split, not lazily imported | verified in the build output |
| The fixtures are **realistic enough to be mistaken for production data**: 7 structurally-valid Indian PANs, real-prefix 10-digit mobiles, valid IFSC + HDFC-format account numbers, plausible CIBIL scores, full names with parents' names, DOB, address and income. Customer emails use `@example.in` and portal URLs `.example`, but **staff emails use the live corporate domain** | `frontend/src/lib/demo/data.ts` |
| The header comment in `config.ts:5-8` claims **three** touch points in the rest of the app. There are **five** importing files: `lib/api.ts`, `hooks/use-auth.tsx`, `components/layout/app-shell.tsx`, `components/layout/sidebar.tsx`, and the undisclosed `app/login/page.tsx` — which is exactly where the resurrect-and-bounce behaviour lives | exhaustive grep for `@/lib/demo` |
| The demo mode can be activated **by hand** with one devtools command; there is no signature, no server confirmation, no cross-check against `DEMO_USER_ID` | `frontend/src/lib/demo/session.ts:23-25` |
| Tab duplication / `target="_blank"` copies `sessionStorage`, carrying demo mode into the child tab | browser behaviour |
| The backend genuinely has **no knowledge** of the demo account and rejects it like any unknown login | `src/tests/employee-lifecycle.test.ts:422` |
| **No documentation anywhere mentions demo mode.** The root `README.md` contains the word "demo" zero times | grep |

**The demo must remain available (per the requirement) but must be isolated so it can never intercept production authentication. See PRODUCTION_ROADMAP.md Phase 1.**

---

## 5. FRONTEND / BACKEND INTEGRATION

| Previous claim | Verdict | Evidence |
|---|---|---|
| 96 endpoints exist, ~27 used | **MATCH** | §1.1, §1.2 |
| ~10 important frontend actions display success but do not call the backend | **DIFFERENCE — the real number is 13, not 10.** The audit undercounted. | Full register below |

### 5.1 Corrected FAKE ACTION REGISTER — 13 confirmed

Every one calls `refresh()` and/or `setSelected(...)` and shows a success toast **without issuing any HTTP request**. In every case the backend route to do the job **exists and is never called**.

| # | Action | File:line | Backend route that exists and is not called |
|---|---|---|---|
| 1 | Loan approve / reject | `frontend/src/app/(app)/loans/page.tsx:68` `updateStatus` | `PATCH /api/loans/:id`, `POST /api/loans/:id/approve` |
| 2 | Bank-order stage move | `bank-orders/page.tsx:58` `moveStage` | `PATCH /api/bank-orders/:id` |
| 3 | Bank-order remark | `bank-orders/page.tsx:64` `saveRemark` | `PATCH /api/bank-orders/:id` |
| 4 | Disbursement "mark credited" | `disbursement/page.tsx:81` `markCredited` | `PATCH /api/disbursements/:id` |
| 5 | Disbursement "re-initiate" | `disbursement/page.tsx:87` `retry` | `PATCH /api/disbursements/:id` |
| 6 | Settlement "mark paid" | `settlements/page.tsx:35` `markPaid` | `PATCH /api/settlements/:id` |
| 7 | Settlement "raise dispute" | `settlements/page.tsx:44` `raiseDispute` | `PATCH /api/settlements/:id` |
| 8 | Transaction "mark successful" | `transactions/page.tsx:36` `settle` | `PATCH /api/transactions/:id` |
| 9 | Document verify/reject | `documents/page.tsx:104` `setStatus` | `PATCH /api/documents/:id` |
| 10 | Document delete | `documents/page.tsx:109` `remove` | `DELETE /api/documents/:id` |
| 11 | Customer edit (detail page) | `customers/[id]/page.tsx:458` | `PATCH /api/customers/:id` |
| 12 | Customer delete (detail page) | `customers/[id]/page.tsx:483` | `DELETE /api/customers/:id` |
| 13 | Customer "re-upload written form" | `customers/page.tsx:232` `handleManualFormUpload` | none — no document upload endpoint exists |

**Two files make ZERO write requests of any kind** despite importing the API client: `bank-orders/page.tsx` and `customers/[id]/page.tsx`.

**Additional detail the audit missed on #11:** the edit dialog's inputs are uncontrolled `defaultValue` with no `onChange` and no refs — the typed values are never read by anything, so even the local state is not updated. The dialog advertises *"Changes apply to the working copy in this session"*, which is itself false.

**Aggravating pattern:** all 13 call `refresh()`, which re-fetches unchanged rows from the server. The table therefore visibly reverts (or never changes) while the still-open dialog shows the fake new value. Because no request is made, **there is no failure path and therefore no rollback is even possible**.

### 5.2 Also verified

- **No frontend call targets a nonexistent endpoint.** All 27 resolve to real mounted routes. This axis is clean.
- `loading` and `error` are destructured from `useResource` and **never rendered** on the majority of pages, so a 403 or a backend outage is indistinguishable from an empty database.

---

## 6. DOCUMENTS

| Previous claim | Verdict | Evidence |
|---|---|---|
| Document UI exists but file storage is not implemented | **MATCH** | |
| Filename/size metadata recorded, file bytes discarded | **MATCH** | `frontend/src/app/(app)/documents/page.tsx:81-89` posts JSON only; the `File` collected at `:65-68` is never attached. `api.upload()` (multipart) exists in the API layer and is not used here |
| No proper object/file storage | **MATCH** | No `@aws-sdk`, no S3/GCS/Cloudinary/Supabase client. `multer` appears in exactly one file — `src/modules/imports.routes.ts` — for the Excel import, using `memoryStorage`, and the buffer is parsed then discarded |

### 6.1 Sub-question detail

| Capability | Status | Evidence |
|---|---|---|
| Upload | **MISSING** — there is no document upload endpoint. `/api/documents` is JSON CRUD from `createScopedResource` | `src/modules/operations.routes.ts:380` |
| Storage | **MISSING** — `documents.storage_key` exists in the schema and the create schema, is commented *"Object-store key. No file bytes are kept in Postgres"*, and **nothing ever populates it**. Every document row is a permanently dangling pointer | `src/db/schema/operations.ts:371` |
| Database record | **PRESENT** — a real row is written with `docType`, `fileName`, `fileSize`, `mimeType`, `status` | |
| Download | **MISSING** — `toast.success("Download started")`. No `res.download`, `res.sendFile`, or `/documents/:id/content` route exists anywhere | `documents/page.tsx:185` |
| Preview | **MISSING** — `toast.info("Preview", { description: "… opened in viewer." })` | `documents/page.tsx:177` |
| Delete | **FAKE** — local toast; `DELETE /api/documents/:id` exists and is never called | `documents/page.tsx:109` |
| Authorization | N/A — there is nothing to control access to | |
| File validation | **MISSING** for documents. (The Excel importer does validate, but by client-declared MIME only, with no extension or magic-byte check) | `imports.routes.ts:30-41` |

**Additional finding:** `documents.uploaded_by` and `documents.verified_by` are never written — the factory sets only `createdBy`/`updatedBy` — yet the UI renders a "By" column bound to `uploadedBy`, so it is **always `—`**, and the search text interpolates the literal string `"null"`.

**Corrected classification: the previous audit rated documents as PARTIAL/B. It should be F (BROKEN) — the interface actively asserts that the file was stored and offers a Download button for a file that does not exist.**

---

## 7. NOTIFICATIONS

| Previous claim | Verdict | Evidence |
|---|---|---|
| Notification table exists | **MATCH** | `src/db/schema/operations.ts:387-404`, migrated in `0002_operations.sql:159` |
| Real notification producers are missing | **MATCH — confirmed absolutely** | `grep "insert(notifications)\|notifications).values"` across all of `src` returns **zero hits**. No loan approval, disbursement, SLA breach, assignment, or import completion emits one. The seed inserts none |
| The notification page has display/state issues | **MATCH, and more severe than stated** | See below |

### 7.1 Three independent failures, any one of which is fatal

1. **No producer.** The table can never contain a row in production. `GET /api/notifications` returns `{data: [], meta: {total: 0, unread: 0}}` forever. The backend's own test asserts exactly this (`frontend-contract.test.ts:217`).
2. **The page never displays what it fetches.** `frontend/src/app/(app)/notifications/page.tsx:74` is `React.useState<NotificationItem[]>(rows)` — seeded once from `[]` (React ignores the initial-state argument on subsequent renders) with **no effect syncing it**. Every render path reads `items`, never `rows`. **Even if the API returned 100 rows, the page would show "Nothing to read here."** Meanwhile `components/layout/topbar.tsx:71` uses the same hook and reads `data` directly — so **the bell badge works and the page it links to is blank.**
3. **Read state never persists.** `markAll` and `toggle` mutate local state only. `POST /api/notifications/read-all` and `POST /api/notifications/:id/read` both exist, both work, and both have **zero callers**.

Plus: the "Team activity" panel is a hardcoded `const activity: ActivityItem[] = []`. Email notifications: **not possible** — no mailer.

---

## 8. SETTINGS

| Previous claim | Verdict | Evidence |
|---|---|---|
| Many settings are UI-only | **MATCH — and it is starker than "many".** Of roughly 30 controls across 5 tabs, **exactly one** reaches the API | `frontend/src/app/(app)/settings/page.tsx` (1,048 lines) |
| Only password change is properly connected | **MATCH** | `settings/page.tsx:301` → `POST /api/auth/change-password`. Note: at HEAD even this was fake — `handlePasswordUpdate()` was a bare toast with unbound inputs. It is wired only in the working tree |
| 2FA appears in UI but is not implemented | **MATCH** | `settings/page.tsx:972-984` toasts *"2FA enabled"*. No TOTP, no MFA column, nothing in any layer |

### 8.1 Complete settings verdict

| Tab | Controls | Persist? |
|---|---|---|
| Profile | avatar change/remove, name/email/phone + "Save changes", default landing page, 3 preference switches | **None.** "Save changes" calls only `updateUser()` → `localStorage`, which is **overwritten by the next `/auth/refresh`**. The 3 switches have no `onCheckedChange` at all. The landing-page select is uncontrolled |
| Company | registered name, GSTIN, PAN, address, support phone, billing email, invoice prefix/number/TDS | **None — 100% dead.** All uncontrolled `defaultValue` literals with no state, no refs, and no save handler |
| Bank access | "Logging enabled" switch per bank | **None** — toast only, despite `PATCH /api/banks/:id` being proven to work on the Banks page |
| Alerts | 5 alert toggles + 4 delivery-channel toggles | **None** — toast only or no handler at all. **No notification-preferences table or endpoint exists** |
| Security | password change | **YES — the only real call** |
| Security | active sessions table + per-session "Sign out" | **Mock** — three hardcoded literals with stale 2024 dates; the button is a toast. No session-listing or revocation endpoint exists |
| Security | 2FA switch | **Mock** |
| Security | "Request export" / "Reset data" | **Mock** — export toasts a promise of an email; reset calls `window.location.reload()` |

**Root cause recorded:** the `app_settings` table exists in the schema (`src/db/schema/governance.ts:95-105`) and **`grep appSettings` outside the schema file returns zero hits**. The table intended to hold all of this was built and never wired — no route, no service, no seed, no test.

---

## 9. REPORTS

| Previous claim | Verdict | Evidence |
|---|---|---|
| Report problems | **MATCH — the page renders empty on load** | `frontend/src/app/(app)/reports/page.tsx:58-67` — `loans` is omitted from the `useMemo` dependency array with an explicit `// eslint-disable-next-line react-hooks/exhaustive-deps`. `loans` is `[]` on mount; when the fetch resolves the memo returns the cached `[]` because no dep changed. The table, all four StatCards, and every export are empty until the user manually clicks Apply/Reset |
| Outdated/hardcoded date behaviour | **MATCH** | `:51-52` `useState("2024-01-05")` / `useState("2024-05-31")`, and `reset()` at `:127-128` restores the same 2024 literals. Today is 2026 — the default range excludes all present-day data |
| Weak export implementation | **MATCH** | |
| Excel export may actually be HTML saved as .xls | **MATCH — confirmed** | `:81-92` builds an HTML `<table>` string and downloads it as `risenext-loan-report.xls` with MIME `application/vnd.ms-excel`. Modern Excel warns that the format does not match the extension. `exceljs` exists in the backend but only for **import**; there is no export endpoint |
| PDF export may simply invoke browser print | **MATCH — confirmed** | `:94-124` `window.open("", "_blank")` + `document.write(...)` + `win.print()`, followed by `toast.success("PDF ready", …)` which is false |

**Third defect the audit did not find:** `:60` compares an ISO timestamp against a date string — `"2024-05-31T00:00:00.000Z" <= "2024-05-31"` is `false`, so **the entire `to` day is always excluded** (off-by-one).

**Fourth:** the trend chart is fed a hardcoded `const monthlyTrend = []` under the heading "Volume trend", so it renders permanently blank axes. There is no `/dashboard/trend` endpoint anywhere.

---

## 10. LEDGER

| Previous claim | Verdict | Evidence |
|---|---|---|
| Access problems for scoped users | **MATCH on the symptom — but the CAUSE was wrong.** Only Super Admin and Admin can create a ledger entry. | ⚠️ **CORRECTION.** The previous audit attributed the 403 to the missing `bankId`. That is **not** why Manager, Team Leader and Executive fail. **They do not hold `ledger.create` at all** — Manager has only `PERMISSIONS.ledger.view` (`permissions.ts:255`); Team Leader and Executive have no ledger permission of any kind (`permissions.ts:262-311`). They are rejected at `requirePermission` with *"Missing required permission: ledger.create"* and **never reach the bank check**. The missing-`bankId` failure (`scoped-resource.ts:177` → `access.ts:122-123`) is real but only bites a bank-scoped role that *does* hold `ledger.create` — which no seeded role currently does. **Both defects must be fixed; they are independent.** |
| Bank filtering issue | **MATCH** | Even when an unscoped user succeeds, the row lands with `bank_id = NULL`, and `bankScope` renders `inArray(bank_id, [...])`, which **never matches NULL**. Every ledger entry created through this UI is permanently invisible to every scoped user |
| Balance calculation problems | **MATCH** | The POST omits `balance`, so the column default `0` applies (`operations.routes.ts:375`). There is no running-balance trigger and no `beforeWrite`. The schema comment claims the balance "is recomputed inside the same transaction that inserts the row" — **no such recomputation exists anywhere**. The "Closing balance" tile reads `rows[0]?.balance ?? 0` and is permanently ₹0.00, while the dialog says "The closing balance updates immediately" |
| Some users can receive 403 | **MATCH** | as above |

**Additional:** the amount input strips all non-digits (`:292` `.replace(/\D/g, "")`), so **paise/decimals cannot be entered at all**.

---

## 11. ADMIN FEATURES

| Previous claim | Verdict | Evidence |
|---|---|---|
| Roles UI missing/incomplete | **MATCH — entirely missing.** `POST/PATCH/DELETE /api/roles` and `PUT /api/roles/:id/permissions` all exist, work, and have **zero frontend callers**. `/roles` is read-only, used solely to populate one dropdown | `ls "frontend/src/app/(app)"` shows no roles route |
| Teams UI missing/incomplete | **MATCH — entirely missing.** `POST /api/teams`, `PUT /api/teams/:id/members`, `DELETE /api/teams/:id` have zero callers. `/teams` is read-only via `use-reference`. Additionally **there is no `PATCH /api/teams/:id` at all** — `teams.edit` is a permission granted to admin and manager that **no route consumes**, so a team's name/description/leader can never be changed after creation | grep |
| Permissions UI missing | **MATCH.** `GET /api/roles/permissions` returns the full catalogue and has zero callers. At HEAD the Employees page showed a **fake** permissions panel: six hardcoded labels that do not match the real catalogue, `defaultChecked={index < 4}`, and `onCheckedChange` → toast only. Removed in the working tree | HEAD `employees/page.tsx:43-50,252` |
| Audit Logs UI missing | **MATCH — no page exists.** `GET /api/audit-logs` has zero frontend references. The only "audit trail" a user can see is the **fabricated** three-event timeline on the customer detail page (hardcoded clock times, asserted unconditionally, presented under the heading *"Chronological trail for audit"*) | `customers/[id]/page.tsx:92-102` |
| Employee bank-access management missing | **MATCH.** `PUT /api/users/:id/banks` exists and has zero callers. Bank access is settable **only at creation** (and only in the working tree). After creation it is unchangeable from the UI | grep for `api.replace` returns only its own definition |

**Additional missing admin surface:** application settings (table dead, no routes), employee **edit** (no UI at all despite `PATCH /api/users/:id` supporting 11 fields), employee **delete** (`DELETE /api/users/:id` exists, zero callers), verifications, funding sources, and service providers (all backend-complete, no screens).

---

## 12. SECURITY

All 15 items verified. Full detail in [SECURITY_AUDIT.md](SECURITY_AUDIT.md); summary verdicts here.

| # | Item | Verdict | Note |
|---|---|---|---|
| 1 | Demo authentication exposure | **MATCH — CRITICAL** | Password in the public bundle; one sessionStorage key grants a full Executive UI session with no server request |
| 2 | No API/login rate limiting | **MATCH — confirmed absolutely** | No `express-rate-limit`/`rate-limiter-flexible`/`express-slow-down` in `package.json`; zero `rateLimit`/`throttle` identifiers in `src`. Only a per-account lockout exists |
| 3 | Account enumeration | **MATCH** | The argon2 dummy-hash timing defence is real and works, but is defeated by a **status-code oracle**: unknown → always 401; existing after 8 failures → **429**; existing but inactive → **403**. The failure counter is incremented only when the account exists |
| 4 | Permanent account lockout | **MATCH** | `failedLoginAttempts` is reset **only on successful login**, so after the 15-minute window expires the counter is still ≥ 8 and the next single wrong password re-locks. 96 unauthenticated requests/day locks any known account forever |
| 5 | Super Admin self-lockout via revoke access | **MATCH — CRITICAL and reachable from the UI's own button** | The `id === ctx.userId` and last-super-admin guards exist **only on DELETE** (`admin.routes.ts:438-451`). `PATCH /api/users/:id` has neither, and super admin's `system.manage_any_user` makes the level check return immediately for any target including self. Recovery through the API is impossible — an Admin cannot PATCH or reset a level-0 account |
| 6 | Temporary-password enforcement frontend-only | **MATCH** | `grep mustChangePassword src/middleware/` → zero hits |
| 7 | Aadhaar/PII handling | **MATCH, and worse than reported** | Aadhaar is correctly stored as peppered SHA-256 + last 4 — **but the hash itself is returned to every `customers.view` holder** by four unprojected `.select()`/`.returning()` calls, and `AADHAAR_PEPPER` has a **committed default value** whose production guard only fires when `NODE_ENV` is explicitly `"production"` (and `NODE_ENV` itself defaults to `"development"`). PAN and account number are stored and returned in **plaintext** with no masking and no log redaction |
| 8 | Excel upload memory exhaustion | **MATCH** | Client-declared MIME only, no extension or magic-byte check; the 10 MB limit is on the **compressed** zip; `workbook.xlsx.load` inflates in memory with no ceiling; the row loop is bounded only by attacker-controlled `sheet.rowCount` |
| 9 | Missing security headers | **MATCH, with a new detail** | Helmet disables CSP with the comment *"API only; the frontend sets its own CSP"* — and `frontend/next.config.ts` is 10 lines with **no `headers()` function at all**. There is **no CSP, no HSTS, no X-Frame-Options and no Referrer-Policy anywhere in the application** |
| 10 | JWT/session security | **MATCH (mostly sound)** | HS256, separate secrets ≥32 chars, iss/aud verified, `tokenType` confusion guard present, role claims **not trusted** for authz. One gap: no `algorithms: ["HS256"]` allow-list on verify (not exploitable with `jsonwebtoken@9`, but the hardening is absent) |
| 11 | Refresh-token rotation/reuse detection | **MATCH — correctly implemented** | Stored hashed, rotated on every use, and reuse of a revoked token revokes the entire family. This is the security highlight of the codebase. **It has zero test coverage** |
| 12 | Logout behaviour | **MATCH — correct** | Revokes the presented token server-side and clears the cookie. Only the presented token, which is right for single-device logout. No audit row is written despite `"logout"` being a declared audit action |
| 13 | CORS behaviour | **MATCH, with a defect** | Explicit allow-list, `credentials: true`, no wildcard — correct. But a rejected origin returns a plain `Error` to `next()`, which the error handler has no branch for → **HTTP 500** plus an error-level log line per request. A misconfigured `CORS_ORIGIN` in production presents as a server crash |
| 14 | Cookie production configuration | **MATCH — a deployment tripwire** | `secure` and `sameSite: "none"` both hinge on `NODE_ENV === "production"`, which **defaults to `"development"`**. If that one variable is not set on the host, the cookie is emitted `SameSite=Lax; Secure=false`, the browser stores it but never sends it cross-site, and **every page reload silently logs the user out**. Any non-empty `COOKIE_DOMAIN` that is not the API's own domain breaks it identically |
| 15 | Secrets/configuration | **MATCH — no real secret is committed** | Only `.env.example` placeholders. `git log -S "postgresql://" --all` matches only the template. Issues: `AADHAAR_PEPPER` has an insecure committed default; `BOOTSTRAP_SUPERADMIN_PASSWORD` ships empty; **`AADHAAR_PEPPER` is absent from `.env.example` entirely** while being the one variable that hard-fails production boot; there is **no root `.gitignore`** despite `README.md:52` asserting one covers `.env`; and **`.env.example` does not exist** although the README references it twice — the documented setup fails at step 3 |

### 12.1 Verified SAFE — recorded so future sessions do not re-chase

SQL injection (no string-built queries; the single `sql.raw` receives only the literals `"bank_id"`/`"id"`; dynamic filter columns come from a hardcoded allow-list; all ids are bound parameters) · mass assignment (every spread is preceded by a `z.object().parse()`) · `password_hash` leakage (never selected into any response) · CSRF (any cross-site request carries `Origin`, which the CORS callback rejects before the route runs) · **IDOR/BOLA on bank-scoped resources — no hole found**, scope is in the SQL predicate and fails closed · privilege escalation via role change (blocked by the level rule) · granting permissions you do not hold (blocked by `assertCanGrantPermissions`) · path traversal (no `fs`/`path.join`/`sendFile` anywhere in the backend) · XSS (one `dangerouslySetInnerHTML`, a compile-time constant) · prototype pollution · ReDoS · secrets in git history · the `localStorage` permission cache (grants sidebar links only; every call is independently authorized server-side).

---

## 13. TESTING

| Previous claim | Verdict | Evidence |
|---|---|---|
| Backend tests exist | **MATCH** | 4 files in `src/tests/` |
| ~107 runtime cases | **MATCH — exactly 107** | `authorization` 26 + `workflow` 22 + `frontend-contract` **34** (9 static `it()` + `it.each` over a 25-entry `FRONTEND_CALLS` array) + `employee-lifecycle` 25 (untracked) |
| Zero frontend tests | **MATCH** | `frontend/package.json` has no `test` script and no test dependency; repo-wide search for `*.test.tsx`/`*.spec.*` finds only the 4 backend files |
| Zero E2E tests | **MATCH** | no Playwright, no Cypress, anywhere |
| No CI | **MATCH** | `.github/` does not exist; there is **not a single `.yml` or `.yaml` file in the entire repository** |
| Existing tests do not prove frontend functionality | **MATCH** | |
| `frontend-contract.test.ts` is actually backend-side replay | **MATCH — confirmed** | It imports **nothing** from the frontend; its "frontend types" are hand-duplicated string literals in a backend file; it checks 7 of ~35 `Customer` fields; **every call runs as `super_admin`**, so no non-admin persona is ever exercised; and it is **GET-only** |
| Important auth/security paths have limited coverage | **MATCH** | **Zero coverage** of: refresh success path, refresh rotation, refresh reuse detection (the most security-sensitive block in the codebase), logout, and the account lockout |

### 13.1 Correction to the README

`README.md:73` claims **"82 tests across three files"**. That was exactly correct for the three committed files (26 + 22 + 34 = 82). The untracked `employee-lifecycle.test.ts` adds 25, so the current suite is **107**. The README is stale, not wrong.

### 13.2 What a fully green suite is compatible with being broken

Production cookie flags (`NODE_ENV=test` means the production branch never executes) · CORS (supertest connects in-process with no `Origin` header, so the allow-list is never evaluated) · real Postgres vs PGlite driver behaviour (SSL, pooling, Neon idle termination, type decoding) · whether the frontend calls the right paths · every frontend rendering path · the demo short-circuit · email · file storage · deployment configuration · rate limiting · refresh rotation and reuse · logout.

**Test-infrastructure strength worth preserving:** the harness runs the **real shipped migration files** against an in-memory Postgres engine and then the real seed. Schema drift would fail here. That is genuinely good and should not be replaced.

---

## 14. SUMMARY OF DISCREPANCIES FOUND

The previous audit was **substantially accurate**. Every major structural conclusion held up. Twelve corrections:

| # | Discrepancy | Previous claim | Corrected finding |
|---|---|---|---|
| D-9 | **Frontend integration count** | "~27 endpoints used, 69 dead (72%)" | **38 used, 58 dead (60%)** in the working tree (36/59 at HEAD). The 27 figure counted only the GET-only `FRONTEND_CALLS` test array and omitted all 16 write paths. **The backend is better connected than reported — though still 60% dead** |
| D-10 | **Endpoint total** | "96" | **96 in the working tree, 95 at HEAD.** The delta is `POST /api/users/:id/reset-password`, which exists only in the uncommitted work |
| D-11 | **Ledger 403 cause** | "scoped users lack `system.access_all_banks`" | **Wrong cause.** Manager/Team Leader/Executive lack **`ledger.create` itself** and are rejected at `requirePermission` before any bank check. Two independent defects, not one |
| D-12 | **`documents.storage_key` unwritable** | "nothing ever populates it" | Imprecise. `storageKey` and `checksum` **are** accepted by the create schema (`operations.routes.ts:399-400`) and the factory spreads the parsed body into the INSERT, so a client-supplied value *would* persist. What is true is that **nothing in the system ever produces one**, and the frontend never sends it. `uploaded_by`/`verified_by` are genuinely dead — absent from the create schema |
| D-1 | **Fake action count** | "approximately 10" | **13 confirmed**, listed exhaustively in §5.1. The audit missed the three customer-page handlers |
| D-2 | **Documents severity** | PARTIAL | **BROKEN.** The UI actively asserts the file was stored and offers a Download button for a file that does not exist. "Partial" understates it |
| D-3 | **Employee-creation root cause completeness** | "the frontend discarded the temporary password" | Correct but **secondary**. The **primary** cause is demo-mode stickiness, which affects HEAD *and* the working tree and is **still unfixed in both** |
| D-4 | **Demo severity** | "can remain inside the demo path" | Understated. A page reload in a contaminated tab **auto-authenticates the visitor as the demo Executive with no credentials**, and the login form becomes unreachable |
| D-5 | **Demo bundle exposure** | not stated | The 838-line fixture file and the demo password are **statically linked into the production bundle for every visitor**, because `lib/api.ts` deep-imports the demo module at module scope |
| D-6 | **Aadhaar exposure** | "sensitive PII handling" | Specifically: the **peppered hash itself is returned in every customer response**, under a pepper with a committed default whose production guard only fires when `NODE_ENV` is explicitly set. PAN and account number are plaintext |
| D-7 | **README trigger count** | not checked | `README.md` claims **9 triggers**; there are **7** |
| D-8 | **`app_settings` table** | not identified | The table backing the entire Settings page **exists and is completely dead** — zero references outside the schema file. This is the root cause of Settings being UI-only, and the audit did not identify it |

### 14.1 Claims that were CORRECT and are now locked in as verified fact

96 endpoints · 27 used · 27 tables · Postgres + Drizzle · substantial backend · substantial auth · role/permission system · bank scoping · audit logging · employee lifecycle backend · argon2 hashing · 107 tests · **no email whatsoever** · **no file storage** · notification producers missing · settings UI-only · 2FA fake · reports broken with fake Excel/PDF · ledger 403 + balance bug · all five admin UIs missing · all 15 security items · zero frontend tests · zero E2E · no CI · `frontend-contract.test.ts` is not a frontend test.

---

## 15. VERIFICATION LOG

| Area | Command / method | Result |
|---|---|---|
| Tree state | `git log --oneline -3`, `git status --porcelain`, `git diff --stat` | HEAD `7ef5da5`; 8 modified + 4 untracked; unchanged since the previous audit |
| Endpoint count | `grep -rhE "^\s*[A-Za-z_]+Router\.(get\|post\|patch\|put\|delete)\("` + factory arithmetic | 52 + 44 = 96 |
| Table count | `grep -ohiE "^CREATE TABLE" drizzle/*.sql` and `grep -rc "pgTable("` | 27 == 27 |
| Triggers / FKs | `grep -ciE "CREATE TRIGGER"` / `"REFERENCES "` | 7 / 62 |
| Tests | `grep -cE "^\s*(it\|test)\("` per file + `FRONTEND_CALLS` array length | 26+22+(9+25)+25 = 107 |
| Email | case-insensitive grep across both source trees and both manifests | zero real hits |
| Demo stickiness | `grep -rn "disableDemoMode" frontend/src` | one call site, inside `signOut` |
| Forced password change | `grep -rn "mustChangePassword" src/middleware/ src/modules/` | writes and reads only, never a guard |
| Notification producers | `grep -rn "insert(notifications)"` | zero |
| `app_settings` | `grep -rn "appSettings" src \| grep -v db/schema` | zero |
| Rate limiting | `grep -rniE "express-rate-limit\|rateLimit\|rate-limiter\|slowDown\|csurf"` | zero |
| File storage | `grep -rn "multer" src` | `imports.routes.ts` only |
| Next.js server guards | `find frontend/src -name "middleware.ts" -o -path "*app/api*"` | absent |
| CI / deploy | `ls .github`, `find` for Dockerfile/yml/vercel.json/railway.*/Procfile | zero |

---

**Maintenance rule:** whenever a claim in this file is acted upon, update its verdict row and add an entry to [CHANGELOG.md](CHANGELOG.md). Do not delete corrected entries — the record of what was wrong is itself valuable.
