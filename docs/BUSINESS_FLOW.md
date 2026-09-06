# Business Flow — Intended Operation vs. Implemented Reality

**Subject:** Risenext Banking / Lending Operations CRM
**Baseline commit:** `7ef5da5` — *"Add frontend-only employee demo"*
**Working tree:** DIRTY — 8 modified + 4 untracked files implementing employee create / temporary password / reset / forced change. Where HEAD and the working tree differ, both are documented and labelled.
**Method:** Every claim below is traced to source. Citations are `path:line` against the working tree unless marked `(HEAD)`.

---

## Legend

| Marker | Meaning |
|---|---|
| `[OK]` | Wired end to end. A UI action issues an HTTP request, the backend persists it, and the change survives a reload. |
| `[PARTIAL]` | Works, but incompletely — a subset of the field/state is writable, or enforcement exists on only one side. |
| `[FAKE]` | UI-only. The handler calls `refresh()` and/or `toast()` and issues **no HTTP request**. Nothing is persisted. The screen lies to the user. |
| `[MISSING]` | Neither UI nor backend performs the step, **or** the backend endpoint exists and no UI calls it (noted as *backend-only*). |

A note on `[FAKE]` handlers: the pattern throughout this codebase is `refresh(); setSelected(...); toast.success(...)`. Because `refresh()` re-reads the unchanged server state, the optimistic local mutation is immediately overwritten by the real row — the toast says "saved", the table reverts. This is the single most misleading class of defect in the product.

---

## 1. Master Flow Diagram

```
                          ┌──────────────────────────────────┐
                          │  BOOTSTRAP: Super Admin          │
                          │  db/seed.ts:110-122              │
                          │  mustChangePassword = true       │
                          └────────────────┬─────────────────┘
                                           │ [OK]  seed.ts:121
                                           v
  ╔═══════════════════════════ IDENTITY & ACCESS ═══════════════════════════╗
  ║                                                                          ║
  ║   Super Admin ──[OK]──> Create employee (role, banks, team)              ║
  ║                          POST /api/users     admin.routes.ts:159         ║
  ║                          UI: employees/page.tsx:158                      ║
  ║                             │                                            ║
  ║                             ├──[OK]──> temp password returned ONCE       ║
  ║                             │          admin.routes.ts:241-245           ║
  ║                             │          shown: credential-handover.tsx:93 ║
  ║                             │                                            ║
  ║                             ├──[MISSING]──> DELIVERY TO EMPLOYEE         ║
  ║                             │      no email, no SMS, no delivery record  ║
  ║                             │      (see §5 — verified by exhaustive grep)║
  ║                             │                                            ║
  ║                             ├──[PARTIAL]──> bank access assignment       ║
  ║                             │      set at creation only (page.tsx:169)   ║
  ║                             │      PUT /users/:id/banks exists but has   ║
  ║                             │      ZERO callers (admin.routes.ts:386)    ║
  ║                             │                                            ║
  ║                             └──[OK]──> activate / deactivate             ║
  ║                                    PATCH /users/:id  page.tsx:222        ║
  ╚══════════════════════════════════╤═══════════════════════════════════════╝
                                     │
                                     v
              Employee login ──[OK]──> POST /api/auth/login
                                       auth.routes.ts:81
                                     │
                                     ├──[PARTIAL]──> forced password change
                                     │     CLIENT-SIDE ONLY. app-shell.tsx:39-48
                                     │     NO server guard. See §5 failure mode.
                                     v
  ╔═══════════════════════════ ORIGINATION ════════════════════════════════╗
  ║                                                                         ║
  ║   Bank master ──[OK]──> POST /api/banks   banks/page.tsx:69             ║
  ║        │           ──[PARTIAL]──> PATCH status only  banks/page.tsx:97  ║
  ║        v                                                                ║
  ║   Customer ──[OK]────> POST /api/customers   customers/page.tsx:314     ║
  ║        │     [FAKE]──> edit profile   customers/[id]/page.tsx:458       ║
  ║        │     [OK]────> delete (list)  customers/page.tsx:261            ║
  ║        │     [FAKE]──> delete (detail) customers/[id]/page.tsx:483      ║
  ║        │                                                                ║
  ║        ├──[MISSING]──> KYC state transition                             ║
  ║        │     kyc hardcoded "Pending" at customers/page.tsx:327.         ║
  ║        │     NOTHING in the UI ever moves it to Verified/Rejected.      ║
  ║        v                                                                ║
  ║   Loan / file ──[OK]──> POST /api/loans   loans/page.tsx:83             ║
  ║        │                status hardcoded "Submitted" (page.tsx:92)      ║
  ║        │                                                                ║
  ║        └──[FAKE]──> status change  loans/page.tsx:68 `updateStatus`     ║
  ║              backend POST /loans/:id/approve EXISTS, never called       ║
  ╚═════════════════════════════════╤═══════════════════════════════════════╝
                                    │
                                    v
  ╔═══════════════════════ DOCUMENTS / KYC ═════════════════════════════════╗
  ║   Upload ──[PARTIAL]──> POST /api/documents   documents/page.tsx:81     ║
  ║        metadata row only. File BYTES ARE DISCARDED — no object store,   ║
  ║        no multipart, storage_key never populated (see §4.6).            ║
  ║   Verify/reject ──[FAKE]──> documents/page.tsx:104 `setStatus`          ║
  ║   Remove        ──[FAKE]──> documents/page.tsx:109 `remove`             ║
  ║        backend DELETE /documents/:id EXISTS, never called               ║
  ║                                                                         ║
  ║   ──[MISSING]──> document completeness NEVER gates loan submission      ║
  ╚═════════════════════════════════╤═══════════════════════════════════════╝
                                    │
                                    v
  ╔═══════════════════════ BANK ORDER / LENDER PIPELINE ════════════════════╗
  ║   Create order ──[MISSING: backend-only]──> POST /api/bank-orders       ║
  ║        exists (operations.routes.ts:215). bank-orders/page.tsx makes    ║
  ║        ZERO write calls of any kind.                                    ║
  ║   Move stage   ──[FAKE]──> bank-orders/page.tsx:58 `moveStage`          ║
  ║   Save remark  ──[FAKE]──> bank-orders/page.tsx:64 `saveRemark`         ║
  ╚═════════════════════════════════╤═══════════════════════════════════════╝
                                    │
                                    v
  ╔═══════════════════════ VERIFICATION ════════════════════════════════════╗
  ║   ──[MISSING: backend-only]──> POST /api/loans/:id/verification         ║
  ║        operations.routes.ts:107. The single richest piece of business   ║
  ║        logic in the backend (conditional provider rule, :133).          ║
  ║        There is NO verifications screen. No frontend file references    ║
  ║        /verifications or /loans/:id/verification anywhere.              ║
  ║   ──[MISSING: backend-only]──> 5 CRUD endpoints on /api/verifications   ║
  ╚═════════════════════════════════╤═══════════════════════════════════════╝
                                    │
                                    v
  ╔═══════════════════════ APPROVAL / REJECTION ════════════════════════════╗
  ║   ──[FAKE]──> loans/page.tsx:68 (toast only)                            ║
  ║   ──[MISSING: backend-only]──> POST /api/loans/:id/approve              ║
  ║        scoped-resource.ts:271-319. Accepts ANY non-empty string as      ║
  ║        the new status (:288-290). No transition validation. See §3.     ║
  ╚═════════════════════════════════╤═══════════════════════════════════════╝
                                    │
                                    v
  ╔═══════════════════════ DISBURSEMENT ════════════════════════════════════╗
  ║   Record disbursal ──[OK]──> POST /api/disbursements                    ║
  ║        disbursement/page.tsx:63. UTR uniqueness enforced by DB index    ║
  ║        (operations.ts:250-252) — a genuine, working control.            ║
  ║                                                                         ║
  ║   ──[MISSING]──> creating a disbursement does NOT move the loan to      ║
  ║                  "Disbursed". Verified §4.1.                            ║
  ║   Mark credited ──[FAKE]──> disbursement/page.tsx:81                    ║
  ║   Retry         ──[FAKE]──> disbursement/page.tsx:87                    ║
  ╚═════════════════════════════════╤═══════════════════════════════════════╝
                                    │
                                    v
  ╔═══════════════════════ TRANSACTION ═════════════════════════════════════╗
  ║   Create ──[MISSING: backend-only]──> POST /api/transactions            ║
  ║        exists (operations.routes.ts:321). transactions/page.tsx makes   ║
  ║        ZERO write calls.                                                ║
  ║   Settle ──[FAKE]──> transactions/page.tsx:36 `settle`                  ║
  ║   ──[MISSING]──> a transaction does NOT create a ledger entry. §4.2     ║
  ╚═════════════════════════════════╤═══════════════════════════════════════╝
                                    │
                                    v
  ╔═══════════════════════ SETTLEMENT ══════════════════════════════════════╗
  ║   Create ──[MISSING: backend-only]──> POST /api/settlements             ║
  ║        exists (operations.routes.ts:283), with a real arithmetic guard  ║
  ║        (:310-318). settlements/page.tsx makes ZERO write calls.         ║
  ║   Mark paid     ──[FAKE]──> settlements/page.tsx:35                     ║
  ║   Raise dispute ──[FAKE]──> settlements/page.tsx:44                     ║
  ║   ──[MISSING]──> approving a settlement creates no transaction. §4.3    ║
  ╚═════════════════════════════════╤═══════════════════════════════════════╝
                                    │
              ┌─────────────────────┼─────────────────────┐
              v                     v                     v
  ╔══════ LEDGER ══════╗  ╔═══ NOTIFICATIONS ═══╗  ╔══ AUDIT / REPORTS ══╗
  ║ Manual voucher     ║  ║ [MISSING] NOTHING   ║  ║ Audit WRITE  [OK]   ║
  ║ ──[OK]──> POST     ║  ║ ever inserts a      ║  ║  audit.ts:50-77     ║
  ║  /api/ledger       ║  ║ notification row.   ║  ║ Audit READ [MISSING]║
  ║  ledger/page.tsx:63║  ║ Verified §4.4.      ║  ║  GET /audit-logs    ║
  ║                    ║  ║ "Mark all read"     ║  ║  has ZERO callers   ║
  ║ [MISSING] never    ║  ║ ──[FAKE]──>         ║  ║ Reports [PARTIAL]   ║
  ║ auto-posted from   ║  ║ notifications/      ║  ║  client-side calc   ║
  ║ any transaction    ║  ║ page.tsx:76-79      ║  ║  from /loans+/custs ║
  ╚════════════════════╝  ╚═════════════════════╝  ╚═════════════════════╝
```

### Arrow summary

| # | Transition | Status | Evidence |
|---|---|---|---|
| 1 | Seed → Super Admin exists | `[OK]` | `src/db/seed.ts:110-122` |
| 2 | Super Admin → create employee | `[OK]` | `admin.routes.ts:159`; `employees/page.tsx:158` |
| 3 | Create → temp password displayed | `[OK]` | `admin.routes.ts:244`; `credential-handover.tsx:93` |
| 4 | Temp password → employee's hands | `[MISSING]` | No email/SMS anywhere. §5 |
| 5 | Employee → bank access | `[PARTIAL]` | Create-time only; `PUT /users/:id/banks` uncalled |
| 6 | Employee → login | `[OK]` | `auth.routes.ts:81`; `use-auth.tsx:187` |
| 7 | Login → forced change | `[PARTIAL]` | Client-only `app-shell.tsx:39-48`. §5 |
| 8 | Bank master | `[OK]` create / `[PARTIAL]` edit | `banks/page.tsx:69`, `:97` |
| 9 | Customer create | `[OK]` | `customers/page.tsx:314` |
| 10 | Customer edit / detail-delete | `[FAKE]` | `customers/[id]/page.tsx:458`, `:483` |
| 11 | KYC transition | `[MISSING]` | Hardcoded `"Pending"` at `customers/page.tsx:327` |
| 12 | Loan create | `[OK]` | `loans/page.tsx:83` |
| 13 | Loan status change | `[FAKE]` | `loans/page.tsx:68` |
| 14 | Document upload | `[PARTIAL]` | `documents/page.tsx:81` — metadata only |
| 15 | Document verify / delete | `[FAKE]` | `documents/page.tsx:104`, `:109` |
| 16 | Documents gate loan | `[MISSING]` | §4.5 |
| 17 | Bank order create | `[MISSING]` backend-only | `operations.routes.ts:215` |
| 18 | Bank order stage / remark | `[FAKE]` | `bank-orders/page.tsx:58`, `:64` |
| 19 | Verification request | `[MISSING]` backend-only | `operations.routes.ts:107` |
| 20 | Loan approval | `[FAKE]` UI / backend-only API | `scoped-resource.ts:271` |
| 21 | Disbursement create | `[OK]` | `disbursement/page.tsx:63` |
| 22 | Disbursement → loan Disbursed | `[MISSING]` | §4.1 |
| 23 | Disbursement status | `[FAKE]` | `disbursement/page.tsx:81`, `:87` |
| 24 | Transaction create | `[MISSING]` backend-only | `operations.routes.ts:321` |
| 25 | Transaction → ledger entry | `[MISSING]` | §4.2 |
| 26 | Transaction status | `[FAKE]` | `transactions/page.tsx:36` |
| 27 | Settlement create | `[MISSING]` backend-only | `operations.routes.ts:283` |
| 28 | Settlement approve → transaction | `[MISSING]` | §4.3 |
| 29 | Settlement status | `[FAKE]` | `settlements/page.tsx:35`, `:44` |
| 30 | Ledger manual voucher | `[OK]` | `ledger/page.tsx:63` |
| 31 | Any event → notification | `[MISSING]` | §4.4 |
| 32 | Mark notifications read | `[FAKE]` | `notifications/page.tsx:76-79` |
| 33 | Audit write | `[OK]` | `services/audit.ts:50-77` |
| 34 | Audit read (UI) | `[MISSING]` | `GET /api/audit-logs` has zero callers |
| 35 | Reports | `[PARTIAL]` | Client-side from `/loans` + `/customers` + `/dashboard/*` |

---

## 2. Stage-by-Stage Detail

### 2.1 Employee & Access Management

| Aspect | Detail |
|---|---|
| **Purpose** | Provision staff accounts, assign a role and bank scope, hand over a first credential. |
| **Actors** | Super Admin (level 0), Admin (level 10). Rule: act only on a **strictly greater** role level unless holding `system.manage_any_user` — `services/access.ts:144-149`. |
| **Tables** | `users`, `roles`, `role_permissions`, `permissions`, `user_bank_access`, `team_members`, `refresh_tokens`, `audit_logs` |
| **Endpoints** | `GET /api/users` `:85` · `POST /api/users` `:159` · `PATCH /api/users/:id` `:251` · `POST /api/users/:id/reset-password` `:328` · `PUT /api/users/:id/banks` `:386` · `DELETE /api/users/:id` `:434` (all `src/modules/admin.routes.ts`) |
| **UI** | `frontend/src/app/(app)/employees/page.tsx` |
| **Status** | `[OK]` for create, reset, activate/deactivate. `[PARTIAL]` for bank access. |

The Employees screen issues exactly three write calls: `POST /users` (`employees/page.tsx:158`), `POST /users/:id/reset-password` (`:199`), and `PATCH /users/:id` with `{status}` only (`:222`).

**Backend supported, no UI caller:**

- `PUT /api/users/:id/banks` (`admin.routes.ts:386`) — the only way to *change* an existing employee's bank scope. Never called. Bank access is therefore write-once at creation (`employees/page.tsx:169`) and permanently frozen thereafter through the UI.
- `DELETE /api/users/:id` (`admin.routes.ts:434`) — soft-deletes and guards the last active Super Admin (`:444-451`). Never called; the UI only toggles `status`.
- The entire `rolesRouter` write surface — `POST /api/roles` `:524`, `PATCH /api/roles/:id` `:575`, `PUT /api/roles/:id/permissions` `:614`, `DELETE /api/roles/:id` `:663`. The UI reads `GET /roles` (`employees/page.tsx:94`) and never writes. Roles are configurable by API and not by product.
- The entire `teamsRouter` write surface — `POST /api/teams` `:728`, `PUT /api/teams/:id/members` `:749`, `DELETE /api/teams/:id` `:784`. Teams can be *selected* at employee creation (`employees/page.tsx:170`) but never created or edited from the UI.

**HEAD vs working tree.** At HEAD, `POST /api/users` generated the initial password with `randomToken(12)` — a base64url string that is not guaranteed to satisfy `passwordProblems`. The working tree replaces this with `generateTemporaryPassword()` (`lib/password.ts:72-87`), which seeds one character of each required class before shuffling so the generated credential can never be one the policy would later reject. `POST /api/users/:id/reset-password` and the `teamId` parameter **do not exist at HEAD** — both are working-tree additions.

---

### 2.2 Employee Login

| Aspect | Detail |
|---|---|
| **Purpose** | Authenticate, establish a rotating session, surface the permission set. |
| **Actors** | Any active user with an active role. |
| **Tables** | `users`, `roles`, `refresh_tokens`, `auth_events` |
| **Endpoints** | `POST /api/auth/login` `:81` · `POST /api/auth/refresh` `:157` · `POST /api/auth/logout` `:195` · `GET /api/auth/me` `:212` · `POST /api/auth/change-password` `:221` (all `src/modules/auth.routes.ts`) |
| **UI** | `frontend/src/app/login/page.tsx`; session in `hooks/use-auth.tsx` |
| **Status** | `[OK]` |

Genuinely solid. Timing-equalised verification against a fixed dummy argon2id hash (`auth.routes.ts:110`, `:154-155`); per-account lockout at 8 attempts / 15 minutes (`:28-29`); refresh-token rotation with reuse detection that revokes every session on replay of a revoked token (`:172-181`); permissions re-read from the database on **every** request rather than trusted from the JWT (`middleware/auth.ts:16-31`, `services/access.ts:30-86`).

**Gaps.** There is no rate limiting of any kind beyond the per-account lockout — no IP throttle, no `express-rate-limit` dependency. `GET /api/auth/me` (`:212`) has zero frontend callers; the client uses `POST /auth/refresh` for session restore instead (`use-auth.tsx:118-124`).

`disableDemoMode()` has exactly one call site — `use-auth.tsx:212`, inside `signOut`'s demo branch. `signIn`'s real-login branch (`:187-201`) never clears the flag. A user who enters demo credentials, then signs in for real **without signing out first** retains `isDemoMode()`, and `lib/api.ts:118` will short-circuit every subsequent request into the browser-local demo store rather than the API.

---

### 2.3 Customer

| Aspect | Detail |
|---|---|
| **Purpose** | Borrower master record, scoped to one bank, with a bank-unique reference. |
| **Actors** | Executive and above (`customers.create` held by all four non-system roles — `lib/permissions.ts:190-313`). |
| **Tables** | `customers`, `banks`, `audit_logs`, `recycle_bin_entries` |
| **Endpoints** | `GET /api/customers` `:91` · `GET /api/customers/:id` `:145` · `POST` `:166` · `PATCH /:id` `:214` · `DELETE /:id` `:266` · `GET /api/customers/check/reference` `:293` (all `src/modules/customers.routes.ts`) |
| **UI** | `customers/page.tsx` (list + create), `customers/[id]/page.tsx` (detail) |
| **Status** | `[OK]` create · `[OK]` list-delete · `[FAKE]` edit · `[FAKE]` detail-delete |

Real controls that work: bank-unique reference id enforced by a partial unique index over `lower(bank_reference_id)` scoped to live rows (`db/schema/domain.ts:140-142`); Aadhaar stored as a peppered SHA-256 hash plus last 4 digits, never in the clear (`customers.routes.ts:77-84`, `schema/domain.ts:113-114`).

**The customer detail page makes ZERO write calls.** Its "Save changes" button (`customers/[id]/page.tsx:458`) closes the dialog and fires `toast.success("Profile updated")` at `:461`. Its "Delete" button (`:483`) fires `toast.success("Customer archived")` at `:487`. Its "Print" button (`:185`) toasts `"Sent to printer"`. Meanwhile `PATCH /api/customers/:id` (`customers.routes.ts:214`) is a complete, working, audited update handler with **no caller**.

The list page's delete *is* real — `api.remove('/customers/${id}')` at `customers/page.tsx:261`. The two delete buttons in this product therefore behave differently, and only one of them does anything.

`handleManualFormUpload` (`customers/page.tsx:232-245`) reads a `File` from the input, never transmits it, resets `event.target.value`, and toasts `"${file.name} has been queued for verification"`. Nothing is queued. Nothing is stored.

**KYC never moves.** Customer creation hardcodes `kyc: "Pending"` (`customers/page.tsx:327`). No screen anywhere exposes a KYC transition. `PATCH /api/customers/:id` accepts `kyc` against the enum `["Verified","Pending","Rejected"]` (`customers.routes.ts:57`) and is never called. Every customer in this system is permanently `Pending`.

---

### 2.4 Loan / File

| Aspect | Detail |
|---|---|
| **Purpose** | The funding request. Central spine — `bank_orders`, `verifications`, `disbursements`, `documents`, `transactions` all reference it. |
| **Actors** | Executive+ create; Manager+ approve (`requests.approve` absent from `team_leader` and `executive`). |
| **Tables** | `loans`, `customers`, `banks`, `funding_sources`, `users`, `teams` |
| **Endpoints** | 6 factory-generated (`operations.routes.ts:50-100`) + 1 hand-written (`:107`) |
| **UI** | `loans/page.tsx` |
| **Status** | `[OK]` create · `[FAKE]` every status change |

Loan creation works and enforces a real cross-record rule: `beforeWrite` (`operations.routes.ts:96-99`) calls `assertSameBank` (`:33-48`), which rejects attaching a Bank-A customer to a Bank-B loan with a 400. The UI cooperates by deriving `bankId` from the customer rather than offering a free choice (`loans/page.tsx:87`, with the reasoning in the comment at `:85-86`).

The UI hardcodes `status: "Submitted"` at creation (`loans/page.tsx:92`), so the `Draft` state — the schema default (`schema/operations.ts:108`) — is unreachable from the product.

**Backend supported, no UI caller:**

- `POST /api/loans/:id/approve` — sets status, stamps `approved_by` / `approved_at`, writes an audit row. Never called. `updateStatus` (`loans/page.tsx:68-74`) calls `refresh()` and toasts instead. *Since Task 5.2/5.3 it also validates the vocabulary and the from→to edge; it is now the only client-facing writer of `loans.status`.*
- `PATCH /api/loans/:id` — accepts `assignedUserId`, `assignedTeamId`, `priority`, `dueDate`, `fundingSourceId`, `loanType`, `amountRequested`, `interestRate`, `tenureMonths`, `notes`. Never called. **No loan field is editable after creation through the UI.** *`status` and `amountApproved` were also accepted until Task 5.2; both are now refused with 422 under **D-056**, because `requests.edit` is held by Team Leader while `requests.approve` is not, which made PATCH an approval route for a role that may not approve.*
- `DELETE /api/loans/:id` — never called.
- `POST /api/loans/:id/verification` (`operations.routes.ts:107-183`) — see §2.6.

Consequence: `loans.approved_by`, `loans.approved_at`, `loans.amount_approved`, `loans.assigned_user_id`, `loans.assigned_team_id`, `loans.due_date` and `loans.funding_source_id` are, in practice, never populated after insert. The Disbursement screen filters for loans in `["Approved","Disbursed"]` (`disbursement/page.tsx:46-48`) — a set no loan can ever enter through the UI. **This is the hard wall.** See §6.

---

### 2.5 Documents / KYC

| Aspect | Detail |
|---|---|
| **Purpose** | Evidence file register against a customer and/or loan. |
| **Actors** | Executive+ (`documents.upload` held by all four non-system roles). |
| **Tables** | `documents` |
| **Endpoints** | 5 factory-generated (`operations.routes.ts:380-403`) — GET /, GET /:id, POST /, PATCH /:id, DELETE /:id. No approve route. |
| **UI** | `documents/page.tsx` |
| **Status** | `[PARTIAL]` upload · `[FAKE]` verify · `[FAKE]` delete |

**No file storage exists.** `multer` is the only upload dependency in `package.json`, and it appears exclusively in `modules/imports.routes.ts` (`:2`, `:24-28`) with `memoryStorage()`, where the buffer is parsed as an Excel workbook (`:167`) and then discarded. `/api/documents` is plain JSON CRUD.

`documents.storage_key` (`schema/operations.ts:371`) is accepted by the create schema (`operations.routes.ts:399`) but **no caller ever sends it** — a repo-wide grep for `storageKey` finds only the schema definition, the Zod field, and the migration column. The column is always NULL.

The upload handler (`documents/page.tsx:70-102`) loops over staged `File` objects and posts `{fileName, fileSize, mimeType}` per file. The bytes are never read and never transmitted. The register records that a file *was named*, not that it exists.

`setStatus` (`:104-107`) and `remove` (`:109-112`) are `[FAKE]`. `PATCH /api/documents/:id` and `DELETE /api/documents/:id` both exist and are never called. `documents.verified_by` (`schema/operations.ts:376`) is never written.

---

### 2.6 Verification

| Aspect | Detail |
|---|---|
| **Purpose** | Third-party field verification, or an explicit record that the requesting bank handled it in-house. |
| **Actors** | Team Leader+ create; Manager+ approve. |
| **Tables** | `verifications`, `service_providers`, `loans` |
| **Endpoints** | `POST /api/loans/:id/verification` (`operations.routes.ts:107`) + 5 factory endpoints on `/api/verifications` (`:185-213`) + 3 on `/api/service-providers` (`:450`, `:463`, `:489`) |
| **UI** | **NONE** |
| **Status** | `[MISSING]` — backend-only |

This is the most complete, most carefully-reasoned business logic in the backend, and the product cannot reach it.

`POST /api/loans/:id/verification` enforces the conditional rule properly: if `required` is true a `serviceProviderId` is mandatory (`:133-135`); a loan may hold only one verification (`:137-142`, backed by a partial unique index at `schema/operations.ts:176`); and the row is opened in the correct terminal state either way — `Requested` with `requestedAt` set when required, or `Verified` / `handledByBank: true` / `result: "Handled by the requesting bank"` / `completedAt` set when not (`:151-157`). It then syncs `loans.verification_required` (`:164-167`) — **the only hand-written cross-table write in the entire operations layer**.

No frontend file references `/verifications`, `/service-providers`, or `/loans/:id/verification`. There is no `app/(app)/verifications/` route. `verifications` and `service_providers` are unreachable through the product; `verifications.approved_by` and `verifications.completed_at` are never written by any UI path.

---

### 2.7 Bank Order

| Aspect | Detail |
|---|---|
| **Purpose** | Track a file's progress through the lender's own pipeline (Login → Sanction → Disbursal Queue) with an SLA and an officer. |
| **Actors** | Team Leader+ edit; Manager+ full. |
| **Tables** | `bank_orders`, `loans`, `customers`, `banks` |
| **Endpoints** | 5 factory-generated (`operations.routes.ts:215-246`) — GET /, GET /:id, POST /, PATCH /:id, DELETE /:id. **No approve route** (`permissions.approve` not configured). |
| **UI** | `bank-orders/page.tsx` |
| **Status** | `[MISSING]` create · `[FAKE]` all mutation |

**`bank-orders/page.tsx` makes ZERO write calls of any kind.** It reads `/customers`, `/loans` and `/bank-orders` (`:49`, `:52`, `:54`) and offers no create path. Bank orders can only enter the system via direct API call or seeding.

`moveStage` (`:58-62`) and `saveRemark` (`:64-73`) are both `[FAKE]`. `PATCH /api/bank-orders/:id` would accept `stage`, `status`, `officer`, `remarks`, `sla`, `submittedOn` — every field the screen pretends to edit — and is never called.

`beforeWrite` (`:241-245`) does apply `assertSameBank` for both the loan and the customer, so the endpoint is sound; nothing exercises it.

---

### 2.8 Approval / Rejection

Not a table — a status transition on `loans` (and, per the factory, on `verifications`, `disbursements`, `settlements`).

`POST /:id/approve` is emitted by `createScopedResource` only when `permissions.approve` is configured (`scoped-resource.ts:271`). That is true for exactly four resources:

| Resource | approve route | Configured at |
|---|---|---|
| loans | yes | `operations.routes.ts:58` |
| verifications | yes | `operations.routes.ts:192` |
| disbursements | yes | `operations.routes.ts:255` |
| settlements | yes | `operations.routes.ts:290` |
| bank-orders | **no** | — |
| transactions | **no** | — |
| ledger | **no** | — |
| documents | **no** | — |
| funding-sources | **no** | — |

All four approve routes have **zero frontend callers**. See §3 for what the route does and does not validate.

---

### 2.9 Disbursement

| Aspect | Detail |
|---|---|
| **Purpose** | Record money leaving, against a loan, with a bank UTR. |
| **Actors** | Manager+ create; Admin+ approve. |
| **Tables** | `disbursements`, `loans`, `customers`, `banks`, `funding_sources` |
| **Endpoints** | 5 factory-generated (`operations.routes.ts:248-281`) — no DELETE, has approve. |
| **UI** | `disbursement/page.tsx` |
| **Status** | `[OK]` create · `[FAKE]` all status change |

`recordDisbursal` (`:56-79`) is real. The UTR duplicate guard is a genuine, working, DB-level control: a partial unique index on `upper(utr)` over live rows with a non-null UTR (`schema/operations.ts:250-252`), verified by test at `src/tests/workflow.test.ts:300-312` (expects 409).

`markCredited` (`:81-85`) and `retry` (`:87-91`) are `[FAKE]`. `POST /api/disbursements/:id/approve` and `PATCH /api/disbursements/:id` both exist; neither is called. `disbursements.approved_by`, `approved_at` and `credited_to` are never written.

The create form's loan picker filters to `["Approved","Disbursed"]` (`:46-48`) — see §6 for why that list is always empty.

---

### 2.10 Transaction

| Aspect | Detail |
|---|---|
| **Purpose** | The money-movement fact table, linking loan, disbursement, settlement and funding source. |
| **Actors** | Manager+ create. |
| **Tables** | `transactions` |
| **Endpoints** | 4 factory-generated (`operations.routes.ts:321-349`) — GET /, GET /:id, POST /, PATCH /:id. **No approve, no delete.** |
| **UI** | `transactions/page.tsx` |
| **Status** | `[MISSING]` create · `[FAKE]` settle |

**`transactions/page.tsx` makes ZERO write calls.** It reads `/customers` and `/transactions` (`:30`, `:33`). `settle` (`:36-40`) is `[FAKE]`.

Because there is no approve route on this resource, the *only* way to change a transaction's status is `PATCH /api/transactions/:id`, which no caller invokes. Every transaction is frozen at whatever status it was created with — and nothing in the product creates one.

---

### 2.11 Settlement

| Aspect | Detail |
|---|---|
| **Purpose** | Periodic commission reconciliation per bank. |
| **Actors** | Admin+ create/approve; Manager view only. |
| **Tables** | `settlements`, `banks` |
| **Endpoints** | 5 factory-generated (`operations.routes.ts:283-319`) — no DELETE, has approve. |
| **UI** | `settlements/page.tsx` |
| **Status** | `[MISSING]` create · `[FAKE]` all status change |

**`settlements/page.tsx` makes ZERO write calls.** It reads `/settlements` (`:32`).

The backend carries a real arithmetic guard — `netPayable` must equal `grossCommission - tds` within 0.01 (`:310-318`), tested at `workflow.test.ts:327-338`. It also enforces one settlement per bank per period via a partial unique index on `(bank_id, lower(period))` (`schema/operations.ts:283-285`). Both controls are correct and unreachable.

`markPaid` (`:35-42`) and `raiseDispute` (`:44-48`) are `[FAKE]`. `settlements.settled_on`, `approved_by`, `approved_at` are never written.

---

### 2.12 Ledger

| Aspect | Detail |
|---|---|
| **Purpose** | Double-entry voucher register. |
| **Endpoints** | 4 factory-generated (`operations.routes.ts:351-378`) — no approve, no delete. |
| **UI** | `ledger/page.tsx` |
| **Status** | `[OK]` manual create only |

`api.create("/ledger")` at `ledger/page.tsx:63` works. This is the one operational resource whose create path is genuinely wired end to end besides loans, customers, documents and disbursements.

The schema comment at `schema/operations.ts:342-344` claims the running `balance` "is recomputed inside the same transaction that inserts the row." **This is not true.** `balance` is an ordinary client-supplied numeric field on the create schema (`operations.routes.ts:376`), stringified and inserted verbatim by the generic factory (`scoped-resource.ts:181-189`). No recomputation code exists anywhere. The comment describes an intention, not the implementation.

Ledger entries are never generated automatically from any transaction — see §4.2.

---

### 2.13 Notifications, Audit, Reports

| Aspect | Notifications | Audit | Reports |
|---|---|---|---|
| **Tables** | `notifications` | `audit_logs`, `auth_events` | — (derived) |
| **Endpoints** | `GET /api/notifications` `:955`, `POST /read-all` `:974`, `POST /:id/read` `:987` (`admin.routes.ts`) | `GET /api/audit-logs` `:902` | `GET /api/dashboard/stats` `:521`, `/loan-status` `:580`, `/bank-performance` `:599` |
| **UI** | `notifications/page.tsx`, `topbar.tsx:71` | **none** | `reports/page.tsx`, `dashboard/page.tsx` |
| **Status** | `[MISSING]` production, `[FAKE]` read | `[OK]` write, `[MISSING]` read UI | `[PARTIAL]` |

**Audit writing is real and good.** `recordAudit` (`services/audit.ts:50-77`) is called from every factory create/update/delete/approve (`scoped-resource.ts:191`, `:236`, `:304`) and from every hand-written admin mutation. `audit_logs` is protected by a database trigger that rejects UPDATE and DELETE (`drizzle/0001_governance_guards.sql:6-19`). The writer deliberately re-throws on failure (`audit.ts:71-76`) so an audit gap cannot pass silently.

**Audit reading has no product surface.** `GET /api/audit-logs` — with pagination, record-type/record-id/action filters and a correct bank-scope predicate (`admin.routes.ts:920-927`) — has zero frontend callers. There is no audit screen and no nav entry (`frontend/src/lib/nav.ts:32-63`).

**Reports are client-side.** `reports/page.tsx` reads `/customers` and `/loans` (`:40`, `:43`) and computes everything in the browser; its export buttons (`:282` CSV, `:303` Tally XML, `:91` Excel, `:123` PDF-via-print) are pure client operations. There is no `/api/reports` mount (`app.ts:78-99`).

---

### 2.14 Backend Endpoints With No UI Caller — Consolidated

The verified figure is 58 of 96 endpoints (60%) with zero frontend callers (38 are reached). The operationally significant ones, by stage:

| Stage | Endpoint | File:line | Consequence |
|---|---|---|---|
| Loan approval | `POST /api/loans/:id/approve` | `scoped-resource.ts:272` | No loan can be approved |
| Loan edit | `PATCH /api/loans/:id` | `scoped-resource.ts:205` | No loan field editable post-create |
| Verification | `POST /api/loans/:id/verification` | `operations.routes.ts:107` | Verification unreachable |
| Verification | `GET/POST/PATCH/approve /api/verifications` | `operations.routes.ts:185` | Entire resource unreachable |
| Bank order | `POST /api/bank-orders` | `operations.routes.ts:215` | No bank order can be created |
| Bank order | `PATCH /api/bank-orders/:id` | `scoped-resource.ts:205` | Stage/remark never persist |
| Disbursement | `POST /api/disbursements/:id/approve` | `scoped-resource.ts:272` | Never reaches Credited |
| Settlement | `POST /api/settlements` | `operations.routes.ts:283` | No settlement can be created |
| Settlement | `POST /api/settlements/:id/approve` | `scoped-resource.ts:272` | Never reaches Paid/Disputed |
| Transaction | `POST /api/transactions` | `operations.routes.ts:321` | No transaction can be created |
| Transaction | `PATCH /api/transactions/:id` | `scoped-resource.ts:205` | Status frozen |
| Documents | `PATCH` / `DELETE /api/documents/:id` | `scoped-resource.ts:205`, `:252` | Never verified or removed |
| Customers | `PATCH /api/customers/:id` | `customers.routes.ts:214` | Profile & KYC never editable |
| Identity | `PUT /api/users/:id/banks` | `admin.routes.ts:386` | Bank scope frozen after create |
| Identity | All role & team writes | `admin.routes.ts:524-802` | Roles/teams API-only |
| Governance | `GET /api/audit-logs` | `admin.routes.ts:902` | No audit UI |
| Notifications | `POST /read-all`, `POST /:id/read` | `admin.routes.ts:974`, `:987` | Read state never persists |
| Funding | All 5 `/api/funding-sources` | `operations.routes.ts:405` | No UI at all |
| Providers | All 3 `/api/service-providers` | `operations.routes.ts:450-511` | No UI at all |

---

## 3. State Machines

### 3.1 Declared vocabularies

All from `src/db/schema/operations.ts` and `domain.ts`. With **one exception**, these are **TypeScript `as const` arrays only** — they are not enums in Postgres and carry no runtime authority over the database.

**The exception is `loanStatuses`.** Since Task 5.2 it is read by `loans_status_check` (`ops:176-181`), so that one array *is* the database's rule as well as TypeScript's. It was moved above the `loans` table for that reason — the constraint callback runs during `pgTable(...)` evaluation and a const declared at the foot of the file would still be in its temporal dead zone. Task 5.3 also pointed the route's create schema and its approve enum at it; before that it had **zero consumers** while `operations.routes.ts` carried a second literal copy of the same seven strings.

| Entity | Column | Default (DB) | Vocabulary | Declared at |
|---|---|---|---|---|
| Loan | `status` | `Draft` (`ops:135`) | Draft · Submitted · Under Review · Approved · Disbursed · Rejected · Closed | `ops:98-106` — **the one exception below** |
| Loan | `priority` | `Normal` (`ops:120`) | Low · Normal · High · Urgent | **no const** — Zod only, `operations.routes.ts:92` |
| Loan | `loan_type` | — | Personal · Business · Gold · Vehicle · Home · Loan Against Property | `ops:474-481` |
| Verification | `status` | `Pending` (`ops:164`) | Pending · Requested · In Progress · Verified · Rejected · Failed · Expired | `ops:483-491` |
| Bank order | `stage` | `Login` (`ops:200`) | Login · Credit Check · Field Verification · Sanction · Disbursal Queue | `ops:493-499` |
| Bank order | `status` | `In Progress` (`ops:201`) | In Progress · On Hold · Cleared · Returned | `ops:501` |
| Disbursement | `status` | `In Transit` (`ops:237`) | Credited · In Transit · Failed | `ops:503` |
| Disbursement | `mode` | `NEFT` (`ops:235`) | NEFT · RTGS · IMPS | `ops:502` |
| Settlement | `status` | `Pending` (`ops:272`) | Paid · Pending · Disputed | `ops:504` |
| Transaction | `status` | `Pending` (`ops:311`) | Success · Pending · Failed | `ops:506` |
| Transaction | `txn_type` | — | Disbursement · EMI Collection · Commission · Refund | `ops:505` |
| Ledger | `category` | — | Commission · Disbursement · Payout · Expense · Tax | `ops:507-513` |
| Document | `status` | `Pending` (`ops:374`) | Verified · Pending · Rejected | **no const** — Zod only, `operations.routes.ts:401` |
| Customer | `kyc` | `Pending` (`domain:115`) | Verified · Pending · Rejected | `domain:174` |
| Customer | `status` | `Active` (`domain:122`) | Active · Follow Up · Closed | `domain:173` |
| Bank | `status` | `Active` (`domain:29`) | Active · Paused | `domain:172` |
| Funding source | `source_type` | `own_funds` (`ops:65`) | own_funds · bank · external | `ops:514` |

Note the two vocabularies with **no exported constant at all** — document status and loan priority exist only as inline Zod enums in the route file. Nothing in the schema layer knows them.

### 3.2 Transition validation exists for `loans.status`, and nowhere else

**Updated 2026-09-05 — Phase 5 tasks 5.2 / 5.3 ([DECISIONS.md](DECISIONS.md) **D-010**, **D-056**, **D-057**).** This section previously read *"There is no transition validation anywhere"*, and for every status column **except `loans.status`** it still does. Bank-order stages are **6.5**, disbursements are **7.3**, and **13.13** is the sweep.

**(a) One DB CHECK constraint, on `loans.status`.** `drizzle/0007_loan_status_check.sql` adds `loans_status_check` — a **vocabulary** constraint over the seven statuses in §3.1, applied `NOT VALID` and then validated in a separate statement. `UPDATE loans SET status = 'banana'` is now refused by Postgres with SQLSTATE **23514**, no application code involved.

Everything else in the previous claim still holds: the other 26 tables have no constraint on any status column, so `UPDATE disbursements SET status = 'banana'` is still accepted. The trigger count is unchanged at 7 — **no trigger was added.** A `CHECK` sees only the candidate row and can therefore express a *vocabulary* but never a *transition*; pretending otherwise is what D-057 refused.

**(b) The approve route's vocabulary is now per-resource, and is configured for loans.** The handler used to parse every resource's body as `z.string().min(1)` and write the result straight through, so `POST /api/loans/{id}/approve {"status":"Banana"}` returned **200** and persisted `Banana`. `ScopedResourceConfig` now carries an optional `allowedStatuses`, and when it is present the approve route validates with `z.enum(...)` instead. `loansRouter` sets it to the exported `loanStatuses` const (`db/schema/operations.ts:464-472`), which until then had **zero consumers** — the route and the schema now share one copy of the vocabulary rather than keeping two.

The option is **opt-in**. Verifications, disbursements and settlements configure no `allowedStatuses` and still accept any non-empty string on approve, exactly as before. Those are 6.5's, 7.3's and 13.13's to close.

**(c) from→to rules exist at CREATE and APPROVE, for loans only.** `ScopedResourceConfig.allowedTransitions` holds the ratified §3.3 machine. The approve handler already loaded the current row to produce its 404 and its audit diff; that row's `status` is now also compared against the requested one, and an edge absent from the map is refused **422** (`unprocessable()`, `details: [{path:"status", …}]`, so the frontend's D-031 field mapping applies). Create refuses an illegal **initial** status the same way — `POST /api/loans {"status":"Disbursed"}` was a **201** and is now a 422.

**PATCH is no longer a status writer at all.** Under **D-056**, `PATCH /api/loans/:id` refuses `status` and `amountApproved` with 422 via `notOnThisRoute()`, because `requests.edit` is held by Team Leader while `requests.approve` is not — so PATCH was an approve route for a role that may not approve. `POST /api/loans/:id/approve` is now the single writer of `loans.status` from a client, and 5.7's disbursement transaction is the only server-side writer.

**What is still true everywhere:** there is no state-machine *module*, no guard table and no general `canTransition` helper. The machine is data on one factory config, enforced at two call sites in `scoped-resource.ts`, for one resource.

### 3.3 State machines

The loan machine below is **ratified and enforced**. Every other machine in this section is still a **proposed target that does not exist** — the caveat that used to head this section applies to them and only to them.

**Loan — RATIFIED 2026-09-05 (Task 5.2, D-057). ENFORCED at CREATE and APPROVE.**

**The edge table is authoritative.** The diagram illustrates it. The 2026-09-05 ratification changed no edge; it made two things explicit that the drawing left to the reader — the unlabelled loop back into `[Submitted]`, now named `return`, and the set of legal *initial* statuses, which a diagram cannot express.

```
                     ┌──────────────── return ──────────────┐
                     v                                      │
  [Draft] ──submit──> [Submitted] ──assess──> [Under Review] ┘
     │                     │                        │
     │                     │                        ├──approve──> [Approved]
     │                     │                        │                  │
     │                     └────reject──────────────┴──reject──> [Rejected]
     │                                                                 │
     └──abandon──> [Closed] <──close──┬──[Disbursed] <──disburse───────┘
                                      │
                                      └──[Approved]  (close — expired, never disbursed)
```

**Edges — the complete graph. Ten edges over seven statuses.**

| # | From | To | Verb | Also written server-side by |
|---|---|---|---|---|
| 1 | Draft | Submitted | submit | — |
| 2 | Draft | Closed | abandon | — |
| 3 | Submitted | Under Review | assess | — |
| 4 | Submitted | Rejected | reject | — |
| 5 | Under Review | Submitted | return | — |
| 6 | Under Review | Approved | approve | — |
| 7 | Under Review | Rejected | reject | — |
| 8 | Approved | Disbursed | disburse | **`POST /api/disbursements`**, inside the 5.7 transaction |
| 9 | Approved | Closed | close (expired, never disbursed) | — |
| 10 | Disbursed | Closed | close | — |

**`POST /api/loans/:id/approve` may take any of the ten**, edge 8 included. The map is a graph, not a routing table — it says which edges are legal, never which caller may take them. So a loan can be marked `Disbursed` through the approve route with no disbursement row behind it. That is the deferred `sum(disbursements WHERE Credited) >= amount_approved` precondition in the table below, not an accident, and it is recorded rather than half-closed.

`POST /api/disbursements` is the only **server-side** writer: it takes edge 8 as a side effect of recording a payment, and takes no other edge.

**Terminal: `Rejected` and `Closed`.** No edge leaves either.

**No self-loops.** `X→X` is absent from the graph and is refused. Re-approving an already-`Approved` loan is a 422, not a silent no-op that re-stamps `approved_by`.

**Legal initial statuses on create: `Draft` and `Submitted`. Nothing else.**

`Draft` is the machine's start state and the column default (`schema/operations.ts:108`). `Submitted` is admitted because it is what the product actually creates — `loans/page.tsx:92` hardcodes it — and it is one `submit` edge from the start state, so creating there is `create + submit` compressed into one request.

The other five are refused, and **`Approved` is the one that matters**: `requests.create` is held by Team Leader **and Executive** (`lib/permissions.ts:277`, `:304`) while `requests.approve` is held by neither. Accepting `POST /api/loans {"status":"Approved"}` is therefore the identical privilege bypass **D-056** closed on PATCH, one route over — a loan approved by someone who may not approve, with `approved_by` **NULL** because only the approve route stamps it, audited as `"created"`. `Under Review`, `Rejected`, `Disbursed` and `Closed` are refused for the plainer reason that each asserts an assessment, a decision or a payment that cannot have happened before the record existed.

**Guards DEFERRED, per D-057.** Phase 5 guards **transition legality only**. These four are a different class — additional business preconditions gating an otherwise-legal edge — and each is deferred with its reason recorded rather than quietly dropped:

| Deferred guard | Edge | Why not Phase 5 |
|---|---|---|
| A verification row must exist for the loan | Submitted→Under Review | A **business precondition**, not transition legality. Named by no roadmap row and no DoD clause. The verification UI is **5.6**; until a user can create one from a screen, this guard would block the workflow it is meant to order |
| `verification.status IN (Verified)` | Under Review→Approved | Same class. Additionally, the loan sub-route **derives** verification status server-side (`operations.routes.ts:151-158`), so the guard would gate on a value the client never chose |
| All required documents Verified | Under Review→Approved | **Phase 9.** There is no file storage anywhere in the repository (§2.5), and no `required document types` table among the 27. The guard has nothing to read |
| `sum(disbursements.amount WHERE status=Credited) >= loans.amount_approved` | Approved→Disbursed | `amount_approved` is **never populated** — it is refused on PATCH by D-056 and written by nothing else — so with `0 >= 0` the guard is vacuous today and becomes *permanently blocking* the moment anything writes it. It must land with whatever row makes `amount_approved` real |
| Four-eyes: `actor != loans.created_by` | *→Approved | A **new business rule**. No row in any phase owns it, and the PRD states no such requirement. `actor holds requests.approve` — the other half of that line — **is** enforced, and always was, by `requirePermission(PERMISSIONS.requests.approve)` on the route |

None of these is discarded. Deferring them does not weaken the machine: Phase 5 ships the **complete transition graph** over all seven statuses.

**Not guarded, and deliberately so: concurrency.** Enforcement is check-then-write against the row read for the 404 — two simultaneous approvals can both read `Under Review` and both pass. **D-027** keeps that posture across all eleven transaction sites in the codebase and **BUG-037** stays deferred; **no row lock was added here.**

---

### 3.3.1 Ratified for Phases 6–10 — 2026-09-05

**Five resources are RATIFIED below** — bank orders (both columns), disbursements, settlements, transactions and documents. **D-010** requires the machine to exist here *before* enforcement is written, so this section is the authority the Phase 6–10 implementation reads; `operations.routes.ts` must not drift from it.

Each ratified machine separates three things that the earlier drafts ran together, following **D-057**'s discipline:

| Layer | Enforced by | Notes |
|---|---|---|
| **Vocabulary** | `z.enum` on create/PATCH **and** a DB `CHECK` | A CHECK sees one row and can never express an edge. **No trigger** (D-057) |
| **Transition legality** | the service layer — `allowedTransitions` / `initialStatuses` | The graph says which edges are legal, never which caller may take them |
| **Business preconditions** | named per machine, each either **in scope** or **deferred with a reason** | Deferring is not discarding; nothing below is dropped silently |

**Concurrency is deliberately unguarded** across all of them. Enforcement is check-then-write against the row read for the 404, so two simultaneous transitions can both pass. **D-027** holds this posture and **BUG-037** stays deferred; **no row lock is added** by any Phase 6–10 row. Where a duplicate would corrupt the books rather than merely race — the 8.8 chain — the remedy is a **unique index**, which D-027 permits (**D-070**).

**Still proposed, and owned by no Phase 6–10 row:** **Verification** and **Customer KYC**, immediately below and at the end of this section respectively. `verifications.status` is named by no row in any phase and falls to the **13.13** sweep — which is why **SEC-016 stays OPEN** after this block.

---

**Verification** — ⚠️ **PROPOSED, NOT RATIFIED. Owned by no Phase 6–10 row.**

```
  [Pending] ──request(required=true)──> [Requested] ──ack──> [In Progress]
      │                                                            │
      │                                              ┌─────────────┼─────────────┐
      │                                              v             v             v
      └──record(required=false)──> [Verified] <──pass──      [Rejected]     [Failed]
                                        │                   (adverse)     (could not
                                        │                                  complete)
                                        └──ttl elapsed──> [Expired] ──re-request──> [Requested]

  Terminal: Rejected. Verified is terminal-until-expiry.
  Guard: Verified/Rejected/Failed require completed_at to be set in the same write.
  Guard: Requested requires service_provider_id (ALREADY ENFORCED at
         operations.routes.ts:133-135 — the one guard that exists).
```

**Bank order — `stage`** — ✅ **RATIFIED 2026-09-05. Owner: 6.1 (enforcement), 6.5 (vocabulary + CHECK).**

```
  [Login] ─> [Credit Check] ─> [Field Verification] ─> [Sanction] ─> [Disbursal Queue]
      ^            │                     │                 │
      └────────────┴─────────────────────┴─────────────────┘   (Returned: back to Login)

  Forward moves: exactly one step. Backward moves: only to Login, and only when status = Returned.
  Legal initial stage: Login. Nothing else.
  No skips. No arbitrary backward moves. No self-loops.
```

**Vocabulary** (5): `Login · Credit Check · Field Verification · Sanction · Disbursal Queue` — `db/schema/operations.ts:493-499`, enum at `operations.routes.ts:317-319`.
**Terminal:** none. `Disbursal Queue` is the last stage but the file continues under `status`.

| Business precondition | Edge | Disposition |
|---|---|---|
| loan has a verification row with `status != Pending` | →Field Verification | **DEFERRED → 6.4.** The verification UI is 5.6; until verifications are routinely creatable, this guard blocks the workflow it orders |
| `loan.status IN (Under Review, Approved)` | →Sanction | **DEFERRED → 6.4.** A cross-record read that belongs with the row making loan↔order coupling real |
| `loan.status = Approved` | →Disbursal Queue | **DEFERRED → 6.4.** Same class |

**Bank order — `status`** — ✅ **RATIFIED 2026-09-05. Owner: 6.1 (enforcement), 6.5 (vocabulary + CHECK).**

```
  [In Progress] <──resume/hold──> [On Hold]
        │
        ├──complete──> [Cleared]   (terminal)
        └──return────> [Returned]  ──rework──> [In Progress]
```

**Vocabulary** (4): `In Progress · On Hold · Cleared · Returned` — `operations.routes.ts:320`.
**Legal edges:** `In Progress ↔ On Hold` · `In Progress → Cleared` · `In Progress → Returned` · `Returned → In Progress`.
**Legal initial status: `In Progress`. Nothing else.** **Terminal: `Cleared`.**

| Business precondition / side effect | Edge | Disposition |
|---|---|---|
| requires `stage = Disbursal Queue` | →Cleared | **DEFERRED → 6.4.** Couples the two machines |
| resets `stage` to `Login` | Returned →rework→ In Progress | **DEFERRED → 6.4.** This is a **side effect, not a guard**, and writing two columns atomically needs the transactional PATCH from **D-062 (F1-a)** |

> **Both columns are owned.** Row 6.1 configures both transition maps and row 6.5 adds both CHECK constraints — see **D-063**. Bank orders have **no approve route** (`operations.routes.ts:301-306`), so PATCH is the only transition point; enforcement uses **D-062's `transitionColumn`** mechanism.

**Disbursement — `status`** — ✅ **RATIFIED 2026-09-05. Owner: 7.3.**

```
  [In Transit] ──bank confirms──> [Credited]   (terminal)
       │
       └──bank rejects──> [Failed]             (terminal)

  "Re-initiate" is a CREATE, not an edge: it opens a NEW disbursement with a new UTR.
  A Failed row is never re-used and never mutated.
```

**Vocabulary** (3): `Credited · In Transit · Failed` — `db/schema/operations.ts:503`.
**Legal edges:** `In Transit → Credited` · `In Transit → Failed`.
**Legal initial status: `In Transit`. Nothing else** — this single line closes the `POST {"status":"Credited"}` privilege bypass (**D-066**).
**Terminal: `Credited`, `Failed`.** No edge leaves either.

| Business precondition | Edge | Disposition |
|---|---|---|
| `utr IS NOT NULL` | →Credited | **IN SCOPE, 7.3.** The row is already loaded; cost is one field check. A NULL UTR stays valid for in-flight rows and the partial unique index is unchanged (**D-067**) |
| must set `disbursed_on`, `credited_to` | →Credited | **DEFERRED.** `credited_to` is written by nothing today (§2.9); it is an ordinary PATCH field carrying no authority |
| `approved_by`, `approved_at` | →Credited | **ALREADY ENFORCED** — stamped by the approve route (`scoped-resource.ts`, D-060 clause 1) |

> **Status is written by the approve route alone.** CREATE admits only `In Transit`; PATCH **refuses** `status` with 422; APPROVE owns the transition — **D-066**. Row 7.1's roadmap text says PATCH and **is corrected**: following it literally would reopen the bypass D-056 closed.

**Settlement — `status`** — ✅ **RATIFIED 2026-09-05. Owner: 8.2 (vocabulary + initial), 8.3 (transition + approve).**

```
  [Pending] ──payment received──> [Paid]      (terminal)
      │                              ^
      └──challenge──> [Disputed] ────┘  (resolved in our favour)
                          │
                          └──> [Pending]     (resolved, re-raise)
```

**Vocabulary** (3): `Paid · Pending · Disputed` — `db/schema/operations.ts:504`.
**Legal edges:** `Pending → Paid` · `Pending → Disputed` · `Disputed → Paid` · `Disputed → Pending`.
**Legal initial status: `Pending`. Nothing else.** **Terminal: `Paid`.**
**Who may approve:** `settlements.approve` — **Super Admin and Admin only**; Manager holds `settlements.view` alone (`lib/permissions.ts:252`).

| Business precondition | Edge | Disposition |
|---|---|---|
| `net_payable = gross_commission − tds` | →Paid | **IN SCOPE, 8.3**, reusing 8.6's merged-row helper. Already enforced on create by `settlementsRouter.beforeWrite` |
| `settled_on` required | →Paid | **DEFERRED.** An ordinary PATCH field carrying no authority |
| `approved_by`, `approved_at` | →Paid | **ALREADY ENFORCED** by the approve route |

> **`POST /api/settlements/:id/approve` currently accepts `z.string().min(1)` and persists any string** — the approve body falls back when `allowedStatuses` is absent (`scoped-resource.ts:369`). 8.2/8.3 close it. Row 8.3's roadmap text says PATCH and **is corrected** to the approve route (**D-066**).

**Transaction — `status`** — ✅ **RATIFIED 2026-09-05. Owner: 8.1.**

```
  [Pending] ──confirm──> [Success]  (terminal, immutable)
      │
      └──reject────────> [Failed]   (terminal; reversal is a NEW Refund txn)
```

**Vocabulary** (3): `Success · Pending · Failed` — `db/schema/operations.ts:506`, enum `operations.routes.ts:502`.
**Legal edges:** `Pending → Success` · `Pending → Failed`.
**Legal initial status: `Pending`. Nothing else** — closes the `POST {"status":"Success"}` bypass (**D-066**).
**Terminal: `Success`, `Failed`. Neither may be edited or deleted** — this is the immutability policy **D-069** ratifies; corrections are compensating `Refund` transactions.

| Business precondition | Edge | Disposition |
|---|---|---|
| must post the matching ledger entry in the **same** DB transaction | →Success | **IN SCOPE, 8.8**, using **D-062's `afterApprove`**. Idempotency is a **unique index**, not a lock (**D-070**) |

> **Transactions have no approve route and no `transactions.approve` key** (`lib/permissions.ts:94-97`), so PATCH is their only status writer and carries the transition guard directly, via `transitionColumn`.

**Document — `status`** — ✅ **RATIFIED 2026-09-05. Owner: 9.7.**

```
  [Pending] ──reviewer accepts──> [Verified]
      │
      └──reviewer rejects──────> [Rejected]
```

**Vocabulary** (3): `Verified · Pending · Rejected` — **no schema const exists today**; the vocabulary is Zod-only at `operations.routes.ts`. **9.7 must export one**, matching the house pattern.
**Legal edges:** `Pending → Verified` · `Pending → Rejected`. **Legal initial status: `Pending`.**

| Business precondition | Edge | Disposition |
|---|---|---|
| `storage_key` non-null — a real file must exist | →Verified | **IN SCOPE, 9.7.** Meaningless before Phase 9; enforceable the moment 9.4 lands |
| `verified_by` required | →Verified/Rejected | **IN SCOPE, 9.7** |
| `verified_by != uploaded_by` (four-eyes) | →Verified/Rejected | **DEFERRED as a runtime guard — achieved structurally instead.** `documents.verify` is granted to Admin and Super Admin only, while uploaders hold `documents.upload`, so the sets are disjoint by construction (**D-074**). Recorded consequence: a sole Super Admin can do both |

> **The DB `CHECK` for `documents.status` is NOT in this block.** D-010 scopes per-resource CHECK constraints to *"Phases 5–8"*; documents fall outside it and go to the **13.13** sweep. 9.7 enforces the machine in the service layer.

**Customer KYC** — ⚠️ **PROPOSED, NOT RATIFIED. Owned by no Phase 6–10 row.** Its `→Verified` guard depends on the `required_document_types` model that **9.11** introduces (**D-076**), so it becomes ratifiable only after Phase 9. `customers.kyc` remains permanently `Pending` in the product today (§2.3).

```
  [Pending] ──documents verified──> [Verified]
      │                                 │
      └──adverse finding──> [Rejected] <┘ (re-KYC on adverse re-check)
                                │
                                └──remediated──> [Pending]

  Guard on ->Verified : every doc_type in the mandatory set has a Verified document
  Guard: loan may not leave Submitted while customer.kyc != Verified
```

---

## 4. Cross-Stage Side Effects — one exists, the rest do not

**Updated 2026-09-05 — Task 5.7 ([DECISIONS.md](DECISIONS.md) **D-060**).** §4.1 is fixed. §4.2 through §4.5 are unchanged and still CONFIRMED absent.

The structural fact this section was built on has one exception now. `createScopedResource` still writes to exactly one table on list/get/patch/delete, and `beforeWrite` still can only *read* other tables to validate. But **create is now transactional and has a post-write hook**: `afterCreate` (`scoped-resource.ts:235-243`) receives the transaction handle and the created row, so a resource may propagate to another table with commit-or-rollback atomicity. Exactly one resource uses it — disbursements.

Hand-written writes to operational tables, repo-wide:

```
insert(verifications)  -> operations.routes.ts (POST /api/loans/:id/verification)
update(loans)          -> operations.routes.ts (POST /api/loans/:id/verification — verification_required)
update(loans)          -> operations.routes.ts (disbursementsRouter.afterCreate — status, Task 5.7)
```

### 4.1 Creating a disbursement advances the loan to Disbursed — FIXED 2026-09-05 (Task 5.7)

**Was:** `disbursementsRouter` configured `beforeWrite` and nothing else, and the factory offered no other hook. Record a disbursement for `LN-1001` and the loan stayed `Submitted` forever, so `dashboard/stats.disbursed_value` — `sum(amount_approved) WHERE loans.status = 'Disbursed'` — was a permanent ₹0 regardless of how much money the `disbursements` table said had moved.

**Now:** `POST /api/disbursements` wraps the insert, the loan's advance and both audit rows in **one** `db.transaction`. There was no existing transaction to join — `grep '\.transaction('` returned zero hits in both `scoped-resource.ts` and `operations.routes.ts` — so 5.7 created the boundary rather than reusing one.

Three behaviours, each tested in `loan-state-machine.test.ts` group G:

- Against an **Approved** loan the disbursement is recorded and the loan advances to `Disbursed`, audited as `disbursed` with a `{from, to}` diff.
- Against a loan in **any other** non-`Disbursed` status the whole request is refused **422** and rolled back: **neither** the disbursement nor a loan change survives. The disbursement row is inserted before the hook runs, so without the transaction this would leave a payment recorded against a loan that never moved.
- Against an **already-Disbursed** loan it is recorded and the loan is left alone, because a loan may legitimately be paid out in tranches and `Disbursed→Disbursed` is not an edge. Nothing is audited about a change that did not happen.

The test named *"runs disbursement, settlement and transaction end to end"* (`workflow.test.ts`) used to make three independent POSTs and assert only the 201s and the code formats — *"it never asserts that the loan status changed. The name overstates what is verified."* It now walks the loan through the real machine to `Approved` first and asserts the advance. The fixture it used before — a `Submitted` loan disbursed directly — is one the ratified machine makes illegal.

### 4.2 A transaction does not create a ledger entry — CONFIRMED

Zero occurrences of `insert(ledgerEntries)` anywhere in `src/`. `transactionsRouter` (`operations.routes.ts:321-349`) configures no `beforeWrite` at all. `transactions.id` is a nullable FK target on `ledger_entries.transaction_id` (`schema/operations.ts:337-339`) — the relationship is modelled and never populated.

Ledger entries appear only when a human types a voucher at `ledger/page.tsx:63`. The books and the transaction record are two unrelated data sets.

### 4.3 Approving a settlement does not create a transaction — CONFIRMED

Zero occurrences of `insert(transactions)` anywhere in `src/`. The approve handler (`scoped-resource.ts:272-318`) sets `status`, `approved_by`, `approved_at`, `notes`, `updated_at`, `updated_by` on the one row and writes an audit entry. Nothing else.

`transactions.settlement_id` (`schema/operations.ts:303`) is likewise a modelled, never-populated FK.

### 4.4 Nothing emits a notification — CONFIRMED

Zero occurrences of `insert(notifications)` anywhere in `src/`. A full grep for `notifications` across the backend returns only: the schema definition (`schema/operations.ts:387-404`), the router mount (`app.ts:16`, `:97`), the three read/mark-read handlers (`admin.routes.ts:955-1002`), and two test references. There is no producer.

Consequently `GET /api/notifications` (`admin.routes.ts:955`) always returns `[]` for every user forever. The notifications page (`notifications/page.tsx`) and the topbar bell (`topbar.tsx:71`) render a permanently empty list. `notifications/page.tsx:76-79` `markAll` mutates local React state and toasts `"All caught up"` — the two real endpoints, `POST /read-all` (`:974`) and `POST /:id/read` (`:987`), are never called, so even if rows existed the read state would not survive a reload.

### 4.5 Document verification does not gate loan submission — CONFIRMED

`loansRouter.beforeWrite` (`operations.routes.ts:96-99`) performs a single check: `assertSameBank` on the customer. It never queries `documents`. No route in the codebase joins `documents` to `loans` for a completeness test, and there is no `required document types` configuration table among the 27 tables.

A loan can be created and set to any status with zero documents attached and the customer's KYC at `Pending`. Compounding this, §2.3 establishes that KYC is hardcoded `"Pending"` at creation and can never be changed through the product — so a KYC gate, if added today, would block every loan in the system.

### 4.6 Additional dead paths found during verification

Not in the original scope, but they belong in the same category:

- **`assignment_history` is a completely dead table.** A repo-wide grep for `assignmentHistory` / `assignment_history` outside `db/schema/` and `drizzle/` returns nothing. Its purpose per the schema comment (`schema/operations.ts:406`) is "Every reassignment is kept, so *who had this and when* is answerable." No reassignment is ever recorded, and the UI has no reassignment control.
- **`app_settings` is a completely dead table.** `appSettings` appears only at `schema/governance.ts:95-104` and in a table-name list inside `tests/authorization.test.ts:49`. Nothing reads or writes it.
- **`documents.storage_key` is never populated** (see §2.5), so the `documents` table records filenames for files that do not exist.
- **`ledger_entries.balance` is not computed**, contradicting the comment at `schema/operations.ts:342-344` (see §2.12).

---

## 5. Credential Handover — How It Actually Works Today

This is a **working-tree feature**. `POST /api/users/:id/reset-password`, `generateTemporaryPassword()`, `mustChangePassword` on the auth context, `/change-password`, and `CredentialHandover` do **not exist at HEAD**.

### The flow as implemented

```
 ┌─ 1 ─────────────────────────────────────────────────────────────────────┐
 │ Admin fills the Employees form and submits.                             │
 │   frontend/src/app/(app)/employees/page.tsx:158  POST /api/users        │
 │   Role picker mirrors the server hierarchy so it cannot offer a role    │
 │   the request would be refused for (page.tsx:110-114).                  │
 └────────────────────────────────┬────────────────────────────────────────┘
                                  v
 ┌─ 2 ─────────────────────────────────────────────────────────────────────┐
 │ Server generates a 14-char password from an alphabet excluding 0/O/1/l/I│
 │ (lib/password.ts:51-55), seeded with one lower + one upper + one digit  │
 │ then shuffled, so it always satisfies passwordProblems (:72-87).        │
 │   admin.routes.ts:186   password = input.password ?? generateTemporary()│
 │   admin.routes.ts:200   passwordHash: await hashPassword(password)      │
 │   admin.routes.ts:208   mustChangePassword: true                        │
 │ Only the argon2id hash is persisted. The plaintext exists in this       │
 │ handler's scope and in the single HTTP response — nothing else.         │
 └────────────────────────────────┬────────────────────────────────────────┘
                                  v
 ┌─ 3 ─────────────────────────────────────────────────────────────────────┐
 │ Response carries the plaintext exactly once.                            │
 │   admin.routes.ts:241-245                                               │
 │     { data: {id,email,name}, temporaryPassword: password }              │
 │   Suppressed when the admin supplied their own password (:244).         │
 └────────────────────────────────┬────────────────────────────────────────┘
                                  v
 ┌─ 4 ─────────────────────────────────────────────────────────────────────┐
 │ Rendered on screen with copy-to-clipboard and an explicit warning.      │
 │   employees/page.tsx:177-183 -> setCredential(...)                      │
 │   components/shared/credential-handover.tsx:92-93 (email + password)    │
 │   :98-105 "Save this password now. It will not be shown again."         │
 │   Clipboard failure outside a secure context is surfaced, not swallowed │
 │   (credential-handover.tsx:46-52).                                      │
 └────────────────────────────────┬────────────────────────────────────────┘
                                  v
 ┌─ 5 ── ***THE GAP*** ────────────────────────────────────────────────────┐
 │ MANUAL OUT-OF-BAND DELIVERY.                                            │
 │ The admin reads the password off the screen and conveys it by whatever  │
 │ means they choose — WhatsApp, phone, a sticky note. The system has no   │
 │ part in this step and no knowledge that it occurred.                    │
 └────────────────────────────────┬────────────────────────────────────────┘
                                  v
 ┌─ 6 ─────────────────────────────────────────────────────────────────────┐
 │ Employee signs in.  auth.routes.ts:81                                   │
 │ Response and profile both carry mustChangePassword                      │
 │   (:145 on login body; :70 on profileOf, so a reload cannot drop it).   │
 └────────────────────────────────┬────────────────────────────────────────┘
                                  v
 ┌─ 7 ─────────────────────────────────────────────────────────────────────┐
 │ React redirects to /change-password and refuses to mount any other      │
 │ screen.  components/layout/app-shell.tsx:39-48                          │
 │ POST /api/auth/change-password  auth.routes.ts:221                      │
 │   - verifies the current password (:233)                                │
 │   - enforces >=12 chars, upper, lower, digit (:237-238, password.ts:89-98)│
 │   - clears mustChangePassword (:245)                                    │
 │   - revokes EVERY refresh token for the account (:251-254)              │
 │ Client signs out explicitly and returns to /login                       │
 │   (change-password/page.tsx:57-58).                                     │
 └─────────────────────────────────────────────────────────────────────────┘
```

Password reset follows the identical shape from step 2 — `admin.routes.ts:328-383`, same hierarchy check (`:340`), same one-shot response (`:373-378`), plus it clears the lockout (`:353-354`) and revokes live sessions (`:360-363`).

### Failure modes

**(a) No email. No delivery channel of any kind.**
Verified exhaustively: `package.json` dependencies are `argon2, cookie-parser, cors, dotenv, drizzle-orm, exceljs, express, helmet, jsonwebtoken, multer, pg, pino, pino-http, zod` — no `nodemailer`, `@sendgrid/*`, `resend`, `postmark`, `aws-sdk`/`@aws-sdk/*`, or any transport. No `EMAIL_*` / `SMTP_*` / `MAIL_*` variable exists in `config/env.ts`; the only email-shaped setting is `BOOTSTRAP_SUPERADMIN_EMAIL` (`db/seed.ts:82`). There are no templates and no transport module.

Consequence: credential delivery is entirely outside the system. The password is typically transmitted over a channel less secure than the one it protects.

**(b) No delivery record.**
Nothing records that the credential was handed over, to whom, when, or by what means. The audit row written at creation (`admin.routes.ts:226-236`) says an account was created; it cannot say a password reached its owner. If an employee reports they never received it, the only remedy is `POST /:id/reset-password` — which invalidates the first one — and there is no way to distinguish "never delivered" from "delivered and lost". `admin.routes.ts:369` audits *"Issued a temporary password for X"*, which records the issuing, not the receipt.

**(c) The forced change is not enforced server-side.** — *the material security gap*

`mustChangePassword` is written (`admin.routes.ts:208`, `:293`, `:351`; `db/seed.ts:121`), loaded onto the auth context (`services/access.ts:38`, `:82`), and returned on both the login body (`auth.routes.ts:145`) and the profile (`:70`). It is **never asserted as a guard**.

`src/middleware/auth.ts` contains `requireAuth` (`:21-31`), `authOf` (`:33-36`), `requirePermission` (`:39-49`) and `requireAnyPermission` (`:52-64`). None consults `mustChangePassword`. `loadAuthContext` (`services/access.ts:30-86`) throws for a deleted account (`:51`), an inactive account (`:52`) and a disabled role (`:53`) — but reads `mustChangePassword` purely as data (`:82`). No route file references it as a condition.

The only enforcement is `app-shell.tsx:39-48`, which is React running in the user's own browser.

**Exploit.** An employee holding a live temporary password can obtain a full access token from `POST /api/auth/login` and call every endpoint their role permits — with `curl`, Postman, or by editing client state — without ever changing it. The temporary password, which by design is known to the administrator who issued it, remains a fully privileged credential indefinitely. `change-password/page.tsx:148-149` tells the user *"A temporary password is known to whoever created your account, which is why it has to be replaced before you start work"* — a statement the server does not back.

**Fix.** Add a check in `requireAuth` (or a middleware immediately after it) that rejects any request from a context with `mustChangePassword === true` with 403, allow-listing only `POST /api/auth/change-password`, `POST /api/auth/logout` and `GET /api/auth/me`. The context already carries the flag (`services/access.ts:82`); the guard is a few lines.

**(d) Bank access cannot be corrected after creation.** Per §2.1, `PUT /api/users/:id/banks` has no caller. An employee provisioned with the wrong banks must be deactivated and re-created.

---

## 6. Happy Path Walkthrough — What a User Can Genuinely Do Today

Assume a seeded database, a migrated Neon instance, backend and frontend both running.

### Steps that actually work

| # | Action | Result | Evidence |
|---|---|---|---|
| 1 | Sign in as Super Admin with the bootstrap credential | Session established; `mustChangePassword` is true | `seed.ts:121`; `auth.routes.ts:81` |
| 2 | Redirected to `/change-password`, set a real password | Persisted; all sessions revoked; back to `/login` | `app-shell.tsx:39-48`; `auth.routes.ts:221-262` |
| 3 | Sign in again. Dashboard loads with real, bank-scoped counts | Genuine SQL aggregates, zeroes on an empty DB | `operations.routes.ts:521-578` |
| 4 | Banks → add a bank | Persisted | `banks/page.tsx:69` |
| 5 | Employees → add an employee (role, banks, team) | Persisted; temp password shown once | `employees/page.tsx:158`; `credential-handover.tsx:93` |
| 6 | Copy the password, convey it out-of-band, employee signs in and sets their own | Works | §5 |
| 7 | Customers → add a customer with a bank reference id | Persisted. Duplicate reference within the bank correctly rejected | `customers/page.tsx:314`; `schema/domain.ts:140-142` |
| 8 | Customers → import from Excel | Real preview + commit pipeline | `customer-import-dialog.tsx:70`, `:86`; `imports.routes.ts` |
| 9 | Loans → create a loan for that customer | Persisted as `LN-####`, status `Submitted`. Cross-bank customer correctly rejected with 400 | `loans/page.tsx:83`; `operations.routes.ts:33-48` |
| 10 | Documents → "upload" files against the customer | Metadata rows created. **The files themselves are not stored** | `documents/page.tsx:81`; §2.5 |
| 11 | Ledger → post a manual voucher | Persisted | `ledger/page.tsx:63` |
| 12 | Recycle bin → delete a customer, then restore it | Full working round trip | `customers/page.tsx:261`; `recycle-bin/page.tsx:50` |
| 13 | Reports → filter and export CSV / Excel / Tally XML | Works (client-side over real data) | `reports/page.tsx:282`, `:303` |

### The first wall — step 14

**Open the loan you created and try to approve it.**

The Loans screen offers status actions. Clicking one calls `updateStatus` (`loans/page.tsx:68-74`):

```ts
function updateStatus(loan: Loan, status: LoanStatus) {
  refresh();
  setSelected((prev) => (prev ? { ...prev, status } : prev));
  toast.success(`Marked ${status.toLowerCase()}`, { ... });
}
```

No HTTP request. A green toast says *"Marked approved"*. `refresh()` re-reads the unchanged row from the server, so the table reverts to `Submitted` in front of the user. Reload the page and the loan is still `Submitted`.

`POST /api/loans/:id/approve` exists and works (`scoped-resource.ts:272-318`). Nothing calls it.

### Why the wall is total

The Disbursement screen filters its loan picker to `["Approved","Disbursed"]` (`disbursement/page.tsx:46-48`). Since no loan can leave `Submitted` through the UI, **that dropdown is permanently empty.** The one downstream screen with a genuinely working create path cannot be reached, because its precondition is unreachable.

Every route around the wall is also closed:

| Attempted detour | Why it fails |
|---|---|
| Set the status at loan creation | `loans/page.tsx:92` hardcodes `"Submitted"`. No status control on the create form. |
| Edit the loan afterwards | `PATCH /api/loans/:id` has no caller; no loan-edit UI exists (§2.4). |
| Go through the bank-order pipeline | `bank-orders/page.tsx` makes **zero write calls**. No order can be created, and `moveStage` is `[FAKE]` (§2.7). |
| Complete verification first | No verification UI exists anywhere in the frontend (§2.6). |
| Verify the documents to unblock it | `setStatus` is `[FAKE]`, and document status gates nothing regardless (§2.5, §4.5). |
| Create the transaction directly | `transactions/page.tsx` makes **zero write calls** (§2.10). |
| Create the settlement directly | `settlements/page.tsx` makes **zero write calls** (§2.11). |

### Summary of the walkthrough

A user can, today, genuinely: **provision the organisation** (banks, employees, roles-by-API, credentials), **onboard borrowers** (manually or by Excel import), **open loan files**, **register document metadata**, **post manual ledger vouchers**, **soft-delete and restore**, and **export reports**.

A user cannot, today: **advance a single loan past `Submitted`**. Everything downstream of that point — verification, bank-order progression, approval, disbursement, transaction, settlement, notification — is either UI-only theatre or an endpoint with no caller.

The system is a **complete, well-secured origination front end bolted to an unreachable operations back end.** The backend is largely correct and, in places, unusually careful — timing-equalised login, argon2id, refresh rotation with reuse detection, per-request permission reload, a single choke point for bank scoping that fails closed, an immutable audit log with a DB-level trigger, partial unique indexes for UTR and bank-reference uniqueness. The frontend is a high-fidelity prototype in which roughly a dozen mutation handlers were never connected. The gap between them is the product.

### The shortest path to a working end-to-end flow

Ordered by unblocking value, each item small:

1. **Wire `updateStatus` to `POST /api/loans/:id/approve`** — `loans/page.tsx:68`. One `api.action` call. This alone unblocks the disbursement screen and turns steps 1-13 into a real origination-to-disbursal flow.
2. **Enforce `mustChangePassword` server-side** — `middleware/auth.ts`. Closes the §5(c) security gap in a few lines.
3. **Wire the remaining nine `[FAKE]` handlers** to the endpoints that already exist (§2.14 table).
4. **Add transition validation** — a shared `assertTransition(entity, from, to)` called from both the approve and PATCH paths, replacing `z.string().min(1)` at `scoped-resource.ts:288` with the entity's own enum (§3).
5. **Add the cross-stage side effects** in §4 — at minimum, disbursement → loan `Disbursed`, and transaction → ledger entry, each inside one DB transaction.
6. **Add a notification producer**, or remove the notifications surface — an always-empty bell is worse than no bell.
7. **Decide on file storage** — either add an object store and populate `storage_key`, or rename the feature to what it is: a document register.

---

## Appendix — Verification Notes

- Counts re-verified for this document: 27 `CREATE TABLE` (15 in `0000_init.sql` + 12 in `0002_operations.sql`) == 27 `pgTable` (identity 7, domain 3, governance 5, operations 12) — zero schema drift. 62 FKs (20 + 42). 7 triggers, all in `0001_governance_guards.sql`. **0 CHECK constraints.**
- 44 factory endpoints re-derived from the `permissions` blocks in `operations.routes.ts`: loans 6 (`:53-59`), verifications 5 (`:188-193`), bank-orders 5 (`:218-223`), disbursements 5 (`:251-256`), settlements 5 (`:286-291`), transactions 4 (`:324-328`), ledger 4 (`:354-358`), documents 5 (`:383-388`), funding-sources 5 (`:408-413`).
- 22 route mounts confirmed at `src/app.ts:78-99`.
- `FRONTEND_CALLS` in `src/tests/frontend-contract.test.ts:62-87` contains 25 entries and asserts only that each **GET** returns 200. **No test anywhere exercises a frontend write path**, which is precisely why the `[FAKE]` handlers were never caught. There are zero frontend tests, zero E2E tests, and no CI (`.github` absent; zero `.yml`/`.yaml` files; no Dockerfile, `vercel.json`, `railway.*` or `Procfile`).
- `/my-work` is absent from `frontend/src/lib/nav.ts:32-63`. Its only reference is `DEMO_HOME` in `frontend/src/lib/demo/config.ts:22`, making it URL-only for a real session.

**Deviations from the supplied baseline.** All baseline claims held. Two extensions were found:

1. `notifications/page.tsx:76-79` `markAll` is an additional `[FAKE]` handler not in the supplied list — `POST /api/notifications/read-all` and `POST /api/notifications/:id/read` both exist and are never called.
2. `settlements/page.tsx`, `transactions/page.tsx`, `notifications/page.tsx`, `my-work/page.tsx`, `reports/page.tsx` and `dashboard/page.tsx` also make **zero write calls**, joining `bank-orders/page.tsx` and `customers/[id]/page.tsx`. Eight of eighteen app pages issue no mutation at all.

**Not verified.** The precise 69/96 zero-caller endpoint count was taken from the baseline and not independently recounted; the individually significant cases are enumerated and each independently confirmed in §2.14.
