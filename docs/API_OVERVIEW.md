# API Overview

Complete inventory of the HTTP surface of the Risenext Banking/Lending Operations CRM backend, and of which parts of it the frontend actually uses.

> ⚠️ **This inventory predates `/api/maintenance/*` (2026-09-11, D-095).** Twelve endpoints are
> missing from the counts and tables below: four sheet reads (`/fvr`, `/transfer`, `/apts`,
> `/payment`), three maintenance writes (`PATCH /fvr/:id`, `/loan/:id`, `/payment/:id`), three
> master-data reads (`/regions`, `/areas`, `/branches`) and three master-data writes. They are
> documented in full — permission, source, and what each one may and may not write — in
> [MANAGER_MAINTENANCE.md](MANAGER_MAINTENANCE.md). The rest of this document is unchanged and
> still accurate for the endpoints it does cover.

**Baseline for this document**

| Item | Value |
|---|---|
| Commit | `7ef5da5` — "Add frontend-only employee demo" |
| Working tree | **DIRTY** — 8 modified, 4 untracked files |
| Endpoints at HEAD | **95** (51 hand-written + 44 factory-generated) |
| Endpoints in working tree | **96** (52 hand-written + 44 factory-generated) |
| Delta | `POST /api/users/:id/reset-password` is **new in the working tree** (`src/modules/admin.routes.ts:328`); it does not exist at HEAD |
| Route mounts | 22, all in `src/app.ts:78-99` |

Every claim below is traceable to a `file:line`. Where a fact differs between HEAD and the working tree, both are stated. Anything that could not be established from code is marked **UNVERIFIED**.

---

## 1. Conventions

### 1.1 Base URL construction

The browser has exactly one path to the API: `apiRequest` in `frontend/src/lib/api.ts:114`.

```ts
// frontend/src/lib/api.ts:129
const url = new URL(`${API_BASE_URL}/api${path.startsWith("/") ? path : `/${path}`}`);
```

- `API_BASE_URL` is `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"` with a trailing slash stripped (`frontend/src/lib/api.ts:13-15`).
- The literal `/api` segment is added by the client, so every path passed to `api.*` / `apiRequest` is written **without** it (`"/customers"`, not `"/api/customers"`).
- Query parameters come from `options.query`; `undefined`, `null` and `""` values are dropped rather than sent as empty strings (`frontend/src/lib/api.ts:130-134`).
- There is **no** Next.js API route layer and **no** middleware: no `frontend/src/app/api/` directory and no `middleware.ts`. All requests go cross-origin to the Express server.

Two call sites bypass `apiRequest` and build the URL themselves, because they need a non-JSON response or a raw `Response`:

| Call site | URL | Reason |
|---|---|---|
| `frontend/src/lib/api.ts:87` | `${API_BASE_URL}/api/auth/refresh` | Refresh must not recurse into the 401 retry path |
| `frontend/src/components/shared/customer-import-dialog.tsx:47` | `${API_BASE_URL}/api/imports/template/customers` | Response is an `.xlsx` blob, not JSON |

### 1.2 The demo short-circuit

`apiRequest` checks `isDemoMode()` **before** constructing a URL (`frontend/src/lib/api.ts:118-127`). In demo mode no request is built, no token is attached, and nothing leaves the tab — `demoRequest` serves the response from `frontend/src/lib/demo/`. Every endpoint-usage claim in this document refers to the real (non-demo) branch.

### 1.3 Response envelopes

The API has three response shapes. There is no single enforced serializer; each handler writes its own `res.json`.

| Shape | Used by | Example |
|---|---|---|
| `{ data: T }` | Single-record reads and all writes that return a body | `scoped-resource.ts:158`, `banks.routes.ts:67` |
| `{ data: T[], meta: {...} }` | Paginated and unpaginated lists | `scoped-resource.ts:135-144` |
| Bare object (no `data`) | `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me`, `GET /api/health`, `GET /api/health/ready`, `GET /api/customers/check/reference` | `auth.routes.ts:142-147` |

`meta` is not uniform:

| Producer | `meta` fields | Source |
|---|---|---|
| `createScopedResource` list | `page, pageSize, total, totalPages, scoped` | `scoped-resource.ts:137-143` |
| `GET /api/customers` | `page, pageSize, total, totalPages` (no `scoped`) | `customers.routes.ts:133-138` |
| `GET /api/banks` | `count, scoped` (no pagination) | `banks.routes.ts:46` |
| `GET /api/service-providers` | `count` | `operations.routes.ts:457` |
| `GET /api/users` | `page, pageSize, total` (no `totalPages`) | `admin.routes.ts:152` |
| `GET /api/audit-logs` | `page, pageSize` (no `total`) | `admin.routes.ts:938` |
| `GET /api/notifications` | `total, unread` | `admin.routes.ts:967` |
| `GET /api/roles`, `GET /api/teams`, `GET /api/recycle-bin`, `GET /api/dashboard/loan-status`, `GET /api/dashboard/bank-performance` | **no `meta` at all** | `admin.routes.ts:489`, `:710`, `:825`; `operations.routes.ts:593`, `:617` |

The client's `Paginated<T>` type declares `meta` optional (`frontend/src/lib/api.ts:172-175`), and `useResource` falls back to `body.data.length` when `meta.total` is absent (`frontend/src/hooks/use-api.ts:60`), so the inconsistency does not break the UI.

Two write endpoints return a field **outside** the envelope:

```ts
// src/modules/admin.routes.ts:241-245  (POST /api/users)
res.status(201).json({
  data: { id, email, name },
  temporaryPassword: input.password ? undefined : password,   // sibling of `data`
});
```

The same pattern is at `admin.routes.ts:373-378` (`POST /api/users/:id/reset-password`, working tree only). `api.create<T>()` types the response as `{ data: T }` and would discard the sibling field, which is why both call sites use raw `apiRequest<CredentialResponse>` instead (`frontend/src/app/(app)/employees/page.tsx:158`, `:199`).

### 1.4 Error body shape

Every error path produces the same envelope, from `src/middleware/error-handler.ts`:

```json
{ "error": { "code": "string", "message": "string", "details": "unknown | undefined" } }
```

| Condition | Status | `code` | `details` | Source |
|---|---|---|---|---|
| Unmatched route | 404 | `not_found` | — | `error-handler.ts:36-38` |
| `ZodError` thrown by any `.parse()` | **422** | `validation_failed` | `[{ path, message }]` per issue | `error-handler.ts:46-55` |
| `AppError` | `error.status` | `error.code` | `error.details` | `error-handler.ts:57-63` |
| Postgres `23505` (unique violation) | 409 | `conflict` | `{ constraint }` | `error-handler.ts:66-76` |
| Postgres `23503` (FK violation) | 409 | `conflict` | — | `error-handler.ts:77-82` |
| Anything else | 500 | `internal_error` | — | `error-handler.ts:84-87` |

Drizzle wraps driver errors, so the pg error code is unwrapped from `.cause` up to 5 levels deep by `rootCause` (`error-handler.ts:28-34`). Seven unique constraints have human-readable messages mapped in `CONSTRAINT_MESSAGES` (`error-handler.ts:12-21`); any other constraint yields `"That record already exists"`.

`AppError` factories and their status codes (`src/lib/errors.ts:15-41`):

| Factory | Status | `code` |
|---|---|---|
| `badRequest` | 400 | `bad_request` |
| `unauthorized` | 401 | `unauthorized` |
| `forbidden` | 403 | `forbidden` |
| `notFound` | 404 | `not_found` |
| `conflict` | 409 | `conflict` |
| `unprocessable` | 422 | `unprocessable_entity` |
| `tooManyRequests` | 429 | `too_many_requests` |
| `internal` | 500 | `internal_error` |

**Status-code semantics worth knowing:**

- **422, not 400, for validation.** Zod parse failures are 422 (`error-handler.ts:47`). 400 is reserved for hand-written business-rule rejections (`badRequest`).
- **403 and 404 are deliberately conflated in one direction only.** Out-of-scope records return 404 ("not found"), because the scope filter is folded into the `WHERE` clause and the row simply does not come back (`scoped-resource.ts:157`, comment at `:156`). Missing *permissions* return 403 with the message `Missing required permission: <key>` (`services/access.ts:93-97`), which does disclose the key name.
- **204 on success with no body.** `DELETE /api/customers/:id`, `DELETE /api/banks/:id`, all factory `DELETE /:id`, `DELETE /api/users/:id`, `DELETE /api/roles/:id`, `DELETE /api/teams/:id`, `POST /api/auth/logout`, `POST /api/auth/change-password`, `POST /api/notifications/read-all`. `apiRequest` returns `undefined` for 204 (`frontend/src/lib/api.ts:168`).
- **201 on create.** All factory `POST /`, plus `POST /api/banks`, `POST /api/customers`, `POST /api/users`, `POST /api/roles`, `POST /api/teams`, `POST /api/service-providers`, `POST /api/loans/:id/verification`, `POST /api/imports/customers`.
- **200 on approve, restore, purge, import-confirm, and both password-issuing routes.**

### 1.5 Auth header and `credentials: "include"`

```ts
// frontend/src/lib/api.ts:136-149
const headers: Record<string, string> = {};
if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
if (!options.formData && options.body !== undefined) headers["Content-Type"] = "application/json";

fetch(url.toString(), { method, headers, credentials: "include", signal, body });
```

- The **access token** is a module-scope variable (`frontend/src/lib/api.ts:17`), never `localStorage`. JWT HS256, 15-minute TTL (`ACCESS_TOKEN_TTL` default `"15m"`, `src/config/env.ts:13`).
- The **refresh token** is an httpOnly cookie set by the server (`auth.routes.ts:55`), 7-day TTL (`REFRESH_TOKEN_TTL_DAYS` default `7`, `src/config/env.ts:14`). `credentials: "include"` is what makes the browser attach it — required on every request because a 401 can trigger an in-place refresh.
- `Content-Type: application/json` is set only when there is a JSON body. For `FormData` uploads the header is deliberately omitted so the browser can add the multipart boundary (`frontend/src/lib/api.ts:138`).
- **401 retry:** one refresh attempt, then one replay of the original request. A second 401 calls `forceSignOut()` and throws (`frontend/src/lib/api.ts:153-165`). Concurrent 401s share a single in-flight refresh promise (`:85-101`) so they cannot invalidate each other's rotated token. Callers that must not recurse pass `skipAuthRetry: true` — used by login, the bootstrap refresh, and both change-password forms.
- **Server side:** `requireAuth` reads the bearer token, verifies it, then **re-reads role, permissions and bank assignments from the database on every request** (`src/middleware/auth.ts:21-31`, `services/access.ts:30-86`). A revoked permission or deactivated account takes effect on the next request, not at token expiry.
- **CORS:** explicit allow-list, no wildcard (wildcard is incompatible with `credentials: true`). Origin checked against `corsOrigins(CORS_ORIGIN)` (`src/app.ts:50-66`).
- **Body limit:** 1 MB for JSON and urlencoded (`src/app.ts:71-72`). Multipart uploads are bounded separately by `MAX_UPLOAD_MB` (default 10) in the multer config (`imports.routes.ts:29`).

### 1.6 Rate limiting

There is **no** rate-limiting middleware anywhere in the app. The only throttle is a per-account login lockout: 8 failed attempts locks the account for 15 minutes (`auth.routes.ts:28-29`, enforced at `:103-106` and `:113-126`).

---

## 2. Full endpoint table (all 96)

**Legend**

- *Permission* — the key passed to `requirePermission`. "auth only" means the router applies `requireAuth` but the handler has no permission gate. "none" means no auth at all.
- *Validation* — the Zod schema applied, or "path param only" where nothing is validated beyond Express routing.
- *Audited?* — whether the handler writes an `audit_logs` row via `recordAudit` / `recordAuthEvent`, directly or through `softDelete` / `restore` / `permanentDelete`.
- *Frontend caller* — a real HTTP call site in `frontend/src`, excluding `frontend/src/lib/demo`. `NONE` means no code in the frontend ever issues this request.

### 2.1 Mount `/api` — `healthRouter` (`app.ts:78`)

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/health` | `health.routes.ts:8` | **none** | — | none (never touches DB) | No | NONE |
| GET | `/api/health/ready` | `health.routes.ts:13` | **none** | — | `select 1` | No | NONE |

### 2.2 Mount `/api/auth` — `authRouter` (`app.ts:79`)

No router-level `requireAuth`; each route opts in.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| POST | `/api/auth/login` | `auth.routes.ts:81` | none | `loginSchema` (`:23-26`) | UPDATE `users` (attempts / lock / `last_login_at`), INSERT `refresh_tokens` | **Yes** — `login_failed` or `login_succeeded` (`:104`, `:127`, `:140`) | `hooks/use-auth.tsx:187` |
| POST | `/api/auth/refresh` | `auth.routes.ts:157` | none (refresh cookie) | cookie + JWT verify | UPDATE `refresh_tokens` (revoke old), INSERT new | No | `lib/api.ts:87`; `hooks/use-auth.tsx:118` |
| POST | `/api/auth/logout` | `auth.routes.ts:195` | none | cookie only | UPDATE `refresh_tokens.revoked_at` | No | `hooks/use-auth.tsx:223` |
| GET | `/api/auth/me` | `auth.routes.ts:212` | `requireAuth` only | — | none beyond `loadAuthContext` | No | **NONE** |
| POST | `/api/auth/change-password` | `auth.routes.ts:221` | `requireAuth` only | `changePasswordSchema` (`:216-219`) + `passwordProblems` (`:237`) | UPDATE `users` (hash, `password_changed_at`, `must_change_password=false`), revoke **all** refresh tokens | **Yes** — `password_changed` (`:256`) | `app/(app)/settings/page.tsx:301`; `app/(app)/change-password/page.tsx:48` — **both working-tree only; NONE at HEAD** |

### 2.3 Mount `/api/banks` — `banksRouter` (`app.ts:80`)

Router-level `requireAuth` (`banks.routes.ts:14`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/banks` | `banks.routes.ts:33` | `banks.view` | — | SELECT, `bankScope` on `banks.id` | No | `hooks/use-reference.tsx:67`; `app/(app)/banks/page.tsx:35` |
| GET | `/api/banks/:id` | `banks.routes.ts:52` | `banks.view` | path param only; `assertBankAccess` **before** the read (`:58`) | SELECT | No | **NONE** |
| POST | `/api/banks` | `banks.routes.ts:73` | `banks.create` | `bankInput` (`:16-31`) | INSERT `banks` | **Yes** (`:90`) | `app/(app)/banks/page.tsx:69` |
| PATCH | `/api/banks/:id` | `banks.routes.ts:104` | `banks.edit` | `bankInput.partial()` | UPDATE `banks` | **Yes** (`:130`) | `app/(app)/banks/page.tsx:97` |
| DELETE | `/api/banks/:id` | `banks.routes.ts:145` | `banks.delete` | path param only | `softDelete` → sets `deleted_at`, INSERT `recycle_bin_entries` | **Yes** (`recycle-bin.ts:143`) | **NONE** |

### 2.4 Mount `/api/customers` — `customersRouter` (`app.ts:81`)

Router-level `requireAuth` (`customers.routes.ts:16`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/customers` | `customers.routes.ts:91` | `customers.view` | `listQuery` (`:69-75`) — `page`, `pageSize` ≤ 500, `search`, `bankId`, `status` | SELECT + COUNT, `bankScope` | No | `customers/page.tsx:63`; `dashboard/page.tsx:53`; `disbursement/page.tsx:39`; `documents/page.tsx:49`; `employees/page.tsx:92`; `loans/page.tsx:48`; `bank-orders/page.tsx:49`; `transactions/page.tsx:30`; `my-work/page.tsx:57`; `reports/page.tsx:40`; `components/layout/topbar.tsx:67` |
| GET | `/api/customers/:id` | `customers.routes.ts:145` | `customers.view` | path param only | SELECT, scope folded into WHERE | No | `customers/[id]/page.tsx:60` |
| POST | `/api/customers` | `customers.routes.ts:166` | `customers.create` | `customerInput` (`:24-67`) — PAN regex, 10-digit mobile, 12-digit Aadhaar, 6-digit pincode, CIBIL 300–900 | INSERT `customers`; Aadhaar stored as peppered SHA-256 + last 4 only (`:78-84`) | **Yes** (`:200`) | `customers/page.tsx:314` |
| PATCH | `/api/customers/:id` | `customers.routes.ts:214` | `customers.edit` | `customerInput.partial()` | UPDATE `customers` | **Yes** (`:251`) | **NONE** — the detail page's "Save changes" is a toast only (`customers/[id]/page.tsx:458`) |
| DELETE | `/api/customers/:id` | `customers.routes.ts:266` | `customers.delete` | path param only | `softDelete` + recycle-bin entry | **Yes** (`recycle-bin.ts:143`) | `customers/page.tsx:261` |
| GET | `/api/customers/check/reference` | `customers.routes.ts` | `customers.view` | inline `z.object({ bankId: uuid, bankReferenceId })` | SELECT; throws 409 if taken | No | `customers/page.tsx` create form (advisory, **Task 4.6**) |

### 2.5 Mount `/api/users` — `usersRouter` (`app.ts:82`)

Router-level `requireAuth` (`admin.routes.ts:39`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/users` | `admin.routes.ts:85` | `users.view` | inline query schema (`:89-95`) | SELECT + COUNT + `user_bank_access` join; `password_hash` never selected (`:147`) | No | `hooks/use-reference.tsx:68`; `employees/page.tsx:91` |
| POST | `/api/users` | `admin.routes.ts:159` | `users.create` | `userInput` (`:41-57`); `assertCanAssignRole` (`:168`); `assertBankAccess` per bank (`:171`); `teams.assign` required if `teamId` (`:177`) | TX: INSERT `users` (`must_change_password=true`), INSERT `user_bank_access`, INSERT `team_members` | **Yes** (`:226`) | `employees/page.tsx:158` |
| PATCH | `/api/users/:id` | `admin.routes.ts:251` | `users.edit` | `userInput.partial()`; `assertCanManageRoleLevel` (`:261`); `assertCanAssignRole` on role change (`:266`) | UPDATE `users`; a supplied password sets `must_change_password=true` (`:293`) | **Yes** (`:302`) | `employees/page.tsx:222` |
| POST | `/api/users/:id/reset-password` | `admin.routes.ts:328` **(working tree only)** | `users.reset_password` | path param only; `assertCanManageRoleLevel` (`:340`) | TX: UPDATE `users` (new hash, `must_change_password=true`, clears `failed_login_attempts` / `locked_until`), revoke all refresh tokens | **Yes** — `password_reset` (`:365`) | `employees/page.tsx:199` — **working-tree only; route and caller both absent at HEAD** |
| POST | `/api/users/:id/resend-invitation` | `admin.routes.ts:599` **(working tree only)** | `users.reset_password` | path param only; `assertCanManageRoleLevel` (`:611`); 409 if `invite_accepted_at` is set; 409 if `status != 'Active'`; 404 for a soft-deleted user via `targetUserRole` | TX: `issueInvitation` — consumes any outstanding `invitations` row, INSERTs a new one (digest only, 72h), UPDATEs `users.invited_at`. Email sent **after** the commit | **Yes** — `invitation_resent` (`:647`) | `employees/page.tsx:369` — **working-tree only** |
| PUT | `/api/users/:id/banks` | `admin.routes.ts:386` | `users.assign` | `z.object({ bankIds: uuid[] })` (`:390`); `assertCanManageRoleLevel`; `assertBankAccess` per bank | TX: DELETE + re-INSERT `user_bank_access` | **Yes** (`:419`) | **NONE** |
| DELETE | `/api/users/:id` | `admin.routes.ts:434` | `users.delete` | path param only; self-delete blocked (`:438`); last active Super Admin blocked (`:444-451`) | UPDATE `users` `deleted_at` + `status='Inactive'` — **direct soft delete, no recycle-bin entry** (`:453-456`) | **Yes** (`:458`) | **NONE** |

### 2.6 Mount `/api/roles` — `rolesRouter` (`app.ts:83`)

Router-level `requireAuth` (`admin.routes.ts:474`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/roles` | `admin.routes.ts:476` | `roles.view` | — | SELECT `roles` + `role_permissions` join | No | `employees/page.tsx:94` |
| GET | `/api/roles/permissions` | `admin.routes.ts:500` | `roles.view` | — | SELECT `permissions` catalogue | No | **NONE** |
| POST | `/api/roles` | `admin.routes.ts:524` | `roles.create` | `roleInput` (`:512-522`) — snake_case key regex, level 1–1000; `assertCanManageRoleLevel` (`:531`); `assertCanGrantPermissions` (`:533`) | TX: INSERT `roles` + `role_permissions` | **Yes** (`:559`) | **NONE** |
| PATCH | `/api/roles/:id` | `admin.routes.ts:575` | `roles.edit` | `roleInput.partial().omit({key:true})`; level guarded twice (`:584-585`) | UPDATE `roles`; a system role's `level` is ignored (`:593`) | **Yes** (`:600`) | **NONE** |
| PUT | `/api/roles/:id/permissions` | `admin.routes.ts:614` | `roles.assign_permissions` | `z.object({ permissions: string[] })`; 403 on system role (`:626`); `assertCanGrantPermissions` (`:629`) | TX: DELETE + re-INSERT `role_permissions` | **Yes** (`:647`) | **NONE** |
| DELETE | `/api/roles/:id` | `admin.routes.ts:663` | `roles.delete` | `assertRoleMutable` (`:671`); 409 if any user still holds it (`:678`) | **Hard** `DELETE FROM roles` (`:682`) | **Yes** (`:683`) | **NONE** |

### 2.7 Mount `/api/teams` — `teamsRouter` (`app.ts:84`)

Router-level `requireAuth` (`admin.routes.ts:698`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/teams` | `admin.routes.ts:700` | `teams.view` | — | SELECT `teams` + `team_members` join | No | `hooks/use-reference.tsx:69` |
| POST | `/api/teams` | `admin.routes.ts:728` | `teams.create` | `teamInput` (`:721-726`) | INSERT `teams` | **Yes** (`:737`) | **NONE** |
| PUT | `/api/teams/:id/members` | `admin.routes.ts:749` | `teams.assign` | `z.object({ userIds: uuid[] })` (`:753`) | TX: DELETE + re-INSERT `team_members` | **Yes** (`:770`) | **NONE** |
| DELETE | `/api/teams/:id` | `admin.routes.ts:784` | `teams.delete` | path param only — **no existence check** | UPDATE `teams.deleted_at` — no recycle-bin entry | **Yes** (`:792`) | **NONE** |

### 2.8 Mount `/api/loans` — `loansRouter` (`app.ts:85`)

6 factory routes + 1 hand-written. Config at `operations.routes.ts:107-190`, with the ratified state machine transcribed immediately above it at `:79-105` (authoritative copy: BUSINESS_FLOW.md §3.3).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/loans` | `scoped-resource.ts:102` | `requests.view` | `listQuery` + `filterable`: `status`, `loanType`, `priority`, `customerId`, `assignedUserId`, `assignedTeamId` | SELECT + COUNT, scoped | No | `loans/page.tsx:51`; `dashboard/page.tsx:50`; `banks/page.tsx:36`; `bank-orders/page.tsx:52`; `customers/page.tsx:68`; `customers/[id]/page.tsx:62`; `disbursement/page.tsx:42`; `employees/page.tsx:93`; `my-work/page.tsx:56`; `reports/page.tsx:43` |
| GET | `/api/loans/:id` | `scoped-resource.ts:155` | `requests.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/loans` | `scoped-resource.ts:170` | `requests.create` | `createSchema`; `assertBankAccess(parsed.bankId)`; **`initialStatuses` — only `Draft` and `Submitted` are accepted, anything else is 422**; `beforeWrite` asserts customer is in the same bank | INSERT `loans`, code `LN-1001+`, **in one transaction with the audit row** | **Yes** | `loans/page.tsx:83` |
| PATCH | `/api/loans/:id` | `scoped-resource.ts:205` | `requests.edit` | `patchSchema(createSchema)`; bank reassignment re-asserted; **`status` and `amountApproved` are REFUSED with 422 (`notOnThisRoute`, D-056)** | UPDATE `loans` | **Yes** | **NONE** — `loans/page.tsx:68` `updateStatus` is a toast only |
| DELETE | `/api/loans/:id` | `scoped-resource.ts:252` | `requests.delete` | path param only | `softDelete` + recycle-bin entry | **Yes** | **NONE** |
| POST | `/api/loans/:id/approve` | `scoped-resource.ts:272` | `requests.approve` | **`z.object({ status: z.enum(loanStatuses), notes? })`** (Task 5.3 — was `z.string().min(1)`), then the `from → to` edge is checked against the loaded `before` row and refused **422** if absent from the ratified machine (Task 5.2) | UPDATE `status`, `approved_by`, `approved_at` | **Yes** | **NONE** |
| POST | `/api/loans/:id/verification` | `operations.routes.ts:107` | `verification.create` | inline schema (`:120-128`); 400 if `required` without a provider (`:133`); 409 if a verification already exists (`:142`) | INSERT `verifications` + UPDATE `loans.verification_required` | **Yes** (`:169`) | `loans/page.tsx` — `VerificationPanel.recordVerification` (Task 5.6) |

> **Task 5.6 — the request the verification panel sends.** Exactly four fields:
> `{ required, serviceProviderId, providerReference, notes }`. Nothing else, and
> the omissions are deliberate:
>
> - **`handledByBank` is never sent.** The route parses it and then **overwrites
>   it** with `required ? false : true` (`operations.routes.ts:234`), so a
>   control for it would be a control the server discards — the defect **D-059**
>   removed from the loan create dialog on the same screen.
> - **`status`, `result`, `requestedAt` and `completedAt` are never sent.** All
>   four are derived from `required` by the route (`:236-241`).
> - **`customerId` / `bankId` are never sent.** Both are copied off the loan.
> - `serviceProviderId` is sent **only when `required` is true**; on the
>   bank-handled path it is `null`, because the row records that the bank did the
>   work and a provider on it would claim a third party was engaged.
>
> **The client branches on the status code, never on the message.** `409` means
> "one already exists" — the panel re-reads and renders the stored row. `400` is
> the missing-provider rule, and because it is raised with `badRequest` rather
> than `unprocessable` it carries **no `details` array**, so `field-errors`
> yields nothing from it and it is surfaced as a form-level line. Anything else,
> including a schema `422` (which *does* carry `details`, mapped per **D-031**),
> is reported as itself. Message matching would break on the 409 in particular:
> the same situation produces the route's *"This loan already has a verification
> record"* or the handler's generic *"That record already exists"* depending on
> whether the check-then-write or the `verifications_loan_unique` index refuses
> it, and that constraint is **absent from `CONSTRAINT_MESSAGES`**
> (`error-handler.ts:12-21`).

### 2.9 Mount `/api/verifications` — `verificationsRouter` (`app.ts:86`)

Factory, config at `operations.routes.ts:185-213`. No `delete` permission → **no DELETE route**.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/verifications` | `scoped-resource.ts:102` | `verification.view` | `listQuery`; filters `status`, `serviceProviderId`, `loanId` | SELECT + COUNT | No | `loans/page.tsx` — `VerificationPanel`, `?loanId=` (Task 5.6) |
| GET | `/api/verifications/:id` | `scoped-resource.ts:155` | `verification.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/verifications` | `scoped-resource.ts:170` | `verification.create` | `createSchema` (`operations.routes.ts:196-212`) | INSERT `verifications` (no code prefix) | **Yes** | **NONE — deliberately.** See the note below |
| PATCH | `/api/verifications/:id` | `scoped-resource.ts:205` | `verification.edit` | `createSchema.partial()` | UPDATE | **Yes** | **NONE** |
| POST | `/api/verifications/:id/approve` | `scoped-resource.ts:272` | `verification.approve` | free-form `status` string | UPDATE `status` | **Yes** | **NONE** |

> **`POST /api/verifications` must not be used to create one (Task 5.6).** The
> factory route has **no `beforeWrite`**, so it skips `assertSameBank` **and both
> business rules** — the provider requirement and the one-verification-per-loan
> check. A client calling it could file a verification against another bank's
> loan, or a second verification on a loan that already has one, or a `required`
> verification with no provider. The loan sub-route
> (`POST /api/loans/:id/verification`) is the only writer with the rules
> attached, and it is the only one the UI calls. A backend test pinning the
> factory route's gap belongs to **Phase 14.1**, which owns `/api/verifications`
> coverage; nothing here changes the route.
>
> `PATCH /api/verifications/:id` remains uncalled. It needs `verification.edit`,
> which **Team Leader and Executive do not hold**, and amending a verification is
> claimed by no roadmap row — so the panel hides its create form once a record
> exists rather than offering an edit that most operational roles could not
> perform.

### 2.10 Mount `/api/bank-orders` — `bankOrdersRouter` (`app.ts:87`)

Factory, config at `operations.routes.ts:215-246`. No `approve` permission → **no approve route**.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/bank-orders` | `scoped-resource.ts:102` | `bank_orders.view` | `listQuery`; filters `status`, `stage`, `loanId`, `customerId` | SELECT + COUNT | No | `bank-orders/page.tsx:54`; `dashboard/page.tsx:51`; `my-work/page.tsx:58`; `customers/[id]/page.tsx:73` |
| GET | `/api/bank-orders/:id` | `scoped-resource.ts:155` | `bank_orders.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/bank-orders` | `scoped-resource.ts:170` | `bank_orders.create` | `createSchema` (`operations.routes.ts:228-240`); `beforeWrite` asserts loan **and** customer share the bank (`:241-245`) | INSERT, code `BO-2401+` | **Yes** | **NONE** |
| PATCH | `/api/bank-orders/:id` | `scoped-resource.ts:205` | `bank_orders.edit` | `createSchema.partial()` | UPDATE | **Yes** | **NONE** — `bank-orders/page.tsx:58` `moveStage` and `:64` `saveRemark` are toasts only; **this page makes zero write calls** |
| DELETE | `/api/bank-orders/:id` | `scoped-resource.ts:252` | `bank_orders.delete` | path param only | `softDelete` | **Yes** | **NONE** |

### 2.11 Mount `/api/disbursements` — `disbursementsRouter` (`app.ts:88`)

Factory, config at `operations.routes.ts:248-281`. No `delete` → **no DELETE route**.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/disbursements` | `scoped-resource.ts:102` | `disbursements.view` | `listQuery`; filters `status`, `mode`, `loanId`, `customerId`, `fundingSourceId` | SELECT + COUNT | No | `disbursement/page.tsx:43` |
| GET | `/api/disbursements/:id` | `scoped-resource.ts:155` | `disbursements.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/disbursements` | `scoped-resource.ts:170` | `disbursements.create` | `createSchema` (`operations.routes.ts:262-275`); same-bank check on loan and customer | INSERT, code `DSB-5001+` | **Yes** | `disbursement/page.tsx:63` |
| PATCH | `/api/disbursements/:id` | `scoped-resource.ts:205` | `disbursements.edit` | `createSchema.partial()` | UPDATE | **Yes** | **NONE** — `disbursement/page.tsx:81` `markCredited` and `:87` `retry` are toasts only |
| POST | `/api/disbursements/:id/approve` | `scoped-resource.ts:272` | `disbursements.approve` | free-form `status` string | UPDATE `status` | **Yes** | **NONE** |

### 2.12 Mount `/api/settlements` — `settlementsRouter` (`app.ts:89`)

Factory, config at `operations.routes.ts:283-319`. No `delete` → **no DELETE route**.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/settlements` | `scoped-resource.ts:102` | `settlements.view` | `listQuery`; filters `status`, `period` | SELECT + COUNT | No | `settlements/page.tsx:32`; `banks/page.tsx:37`; `dashboard/page.tsx:52` |
| GET | `/api/settlements/:id` | `scoped-resource.ts:155` | `settlements.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/settlements` | `scoped-resource.ts:170` | `settlements.create` | `createSchema` (`operations.routes.ts:297-309`); `beforeWrite` rejects `netPayable ≠ gross − tds` beyond 0.01 (`:310-318`) | INSERT, code `STL-3301+` | **Yes** | **NONE** |
| PATCH | `/api/settlements/:id` | `scoped-resource.ts:205` | `settlements.edit` | `createSchema.partial()` + same arithmetic check | UPDATE | **Yes** | **NONE** — `settlements/page.tsx:35` `markPaid` and `:44` `raiseDispute` are toasts only |
| POST | `/api/settlements/:id/approve` | `scoped-resource.ts:272` | `settlements.approve` | free-form `status` string | UPDATE `status` | **Yes** | **NONE** |

### 2.13 Mount `/api/transactions` — `transactionsRouter` (`app.ts:90`)

Factory, config at `operations.routes.ts:321-349`. No `delete`, no `approve` → **4 routes**.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/transactions` | `scoped-resource.ts:102` | `transactions.view` | `listQuery`; filters `status`, `txnType`, `loanId`, `customerId`; ordered by `occurredAt` | SELECT + COUNT | No | `transactions/page.tsx:33`; `customers/[id]/page.tsx:68` |
| GET | `/api/transactions/:id` | `scoped-resource.ts:155` | `transactions.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/transactions` | `scoped-resource.ts:170` | `transactions.create` | `createSchema` (`operations.routes.ts:335-348`) | INSERT, code `TXN-77001+` | **Yes** | **NONE** |
| PATCH | `/api/transactions/:id` | `scoped-resource.ts:205` | `transactions.edit` | `createSchema.partial()` | UPDATE | **Yes** | **NONE** — `transactions/page.tsx:36` `settle` is a toast only |

### 2.14 Mount `/api/ledger` — `ledgerRouter` (`app.ts:91`)

Factory, config at `operations.routes.ts:351-378`. No `delete`, no `approve` → **4 routes**.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/ledger` | `scoped-resource.ts:102` | `ledger.view` | `listQuery`; filters `category`, `mode`; ordered by `entryDate` | SELECT + COUNT | No | `ledger/page.tsx:46` |
| GET | `/api/ledger/:id` | `scoped-resource.ts:155` | `ledger.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/ledger` | `scoped-resource.ts:170` | `ledger.create` | `createSchema` (`operations.routes.ts:365-377`) — **`bankId` is optional** | INSERT, code `LG-9001+` | **Yes** | `ledger/page.tsx:63` — **403s for every bank-scoped user, see §5.1** |
| PATCH | `/api/ledger/:id` | `scoped-resource.ts:205` | `ledger.edit` | `createSchema.partial()` | UPDATE | **Yes** | **NONE** |

### 2.15 Mount `/api/documents` — `documentsRouter` (`app.ts:92`)

Factory, config at `operations.routes.ts:380-403`. `create` and `edit` both map to `documents.upload`. No `approve`.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/documents` | `scoped-resource.ts:102` | `documents.view` | `listQuery`; filters `status`, `docType`, `customerId`, `loanId` | SELECT + COUNT | No | `documents/page.tsx:52`; `my-work/page.tsx:59`; `customers/[id]/page.tsx:63` |
| GET | `/api/documents/:id` | `scoped-resource.ts:155` | `documents.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/documents` | `scoped-resource.ts:170` | `documents.upload` | `createSchema` (`operations.routes.ts:391-402`) — **JSON metadata only; there is no file transport** | INSERT `documents` | **Yes** | `documents/page.tsx:81` |
| PATCH | `/api/documents/:id` | `scoped-resource.ts:205` | `documents.upload` | `createSchema.partial()` | UPDATE | **Yes** | **NONE** — `documents/page.tsx:104` `setStatus` is a toast only |
| DELETE | `/api/documents/:id` | `scoped-resource.ts:252` | `documents.delete` | path param only | `softDelete` | **Yes** | **NONE** — `documents/page.tsx:109` `remove` is a toast only |

> **No file storage exists.** `/api/documents` is JSON CRUD over a metadata table. `documents.storage_key` is accepted by the create schema (`operations.routes.ts:399`) but nothing in the frontend ever sends it, so it is never written. The upload dialog reads `file.name`, `file.size` and `file.type` and discards the bytes (`documents/page.tsx:81-89`). The only `multer` usage in the codebase is the Excel importer, which uses `memoryStorage` and drops the buffer after parsing (`imports.routes.ts:27-42`).

### 2.16 Mount `/api/funding-sources` — `fundingSourcesRouter` (`app.ts:93`)

Factory, config at `operations.routes.ts:405-430`. No `approve`.

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/funding-sources` | `scoped-resource.ts:102` | `funding_sources.view` | `listQuery`; filters `sourceType`, `status` | SELECT + COUNT | No | **NONE** |
| GET | `/api/funding-sources/:id` | `scoped-resource.ts:155` | `funding_sources.view` | path param only | SELECT | No | **NONE** |
| POST | `/api/funding-sources` | `scoped-resource.ts:170` | `funding_sources.create` | `createSchema` (`operations.routes.ts:416-423`); `beforeWrite` requires `bankId` when `sourceType === "bank"` (`:424-428`) | INSERT | **Yes** | **NONE** |
| PATCH | `/api/funding-sources/:id` | `scoped-resource.ts:205` | `funding_sources.edit` | `createSchema.partial()` | UPDATE | **Yes** | **NONE** |
| DELETE | `/api/funding-sources/:id` | `scoped-resource.ts:252` | `funding_sources.delete` | path param only | `softDelete` | **Yes** | **NONE** |

### 2.17 Mount `/api/service-providers` — `serviceProvidersRouter` (`app.ts:94`)

Hand-written, **not** factory-generated — service providers have no `bank_id`, and feeding a null column into `bankScope` would hide every row from scoped users (`operations.routes.ts:432-436`). Router-level `requireAuth` (`:438`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/service-providers` | `operations.routes.ts:450` | `service_providers.view` | — | SELECT all non-deleted, ordered by name; **no bank scoping** | No | `loans/page.tsx` — `VerificationPanel`, permission-gated (Task 5.6) |
| POST | `/api/service-providers` | `operations.routes.ts:463` | `service_providers.create` | `providerInput` (`:440-448`) | INSERT | **Yes** (`:477`) | **NONE** |
| PATCH | `/api/service-providers/:id` | `operations.routes.ts:489` | `service_providers.edit` | `providerInput.partial()` | UPDATE | **Yes** (`:501`) | **NONE** |

> `service_providers.delete` exists in the catalogue (`lib/permissions.ts:80`) but **no route references it** — there is no delete endpoint for service providers.

> **Non-standard envelope.** `GET /api/service-providers` answers
> `{ data, meta: { count } }` — **no `page`, `pageSize`, `total` or
> `totalPages`**, and no pagination at all. `useResource` tolerates it: `total`
> falls back to `data.length` (`use-api.ts:60`). Nothing in the UI reads `total`
> for this list.
>
> **Task 5.6 — the permission split, and why the panel is shaped around it.**
> **Manager and Team Leader hold `verification.create` but NOT
> `service_providers.view`** (`lib/permissions.ts:247`, `:280-281`), while the
> loan sub-route *requires* a provider whenever `required` is true. Those two
> roles can therefore create a verification and cannot list the providers the
> server demands one of.
>
> The panel **does not widen the grant** (RULES §5), **does not invent a
> provider-lookup endpoint** (backend scope no row owns), and **does not render
> an empty dropdown** — an empty `<Select>` asserts that the directory is empty,
> which an account that cannot read it is in no position to claim. It offers only
> the bank-handled path (`required: false`) and names the permission. That is
> **D-049**'s pattern applied unchanged. On a *stored* record the provider is
> resolved to a name when the directory is readable and shown by its
> `providerReference` otherwise — never as a raw uuid.
>
> Providers are **global, not bank-scoped**, deliberately (`:432-436`): they have
> no `bank_id`, so feeding a null column into `bankScope` would hide every row
> from scoped users. The `Active` filter is applied **client-side** because the
> route offers no status filter.
>
> A service-provider **admin CRUD screen is still unbuilt** and is owned by no
> row; `POST` and `PATCH` keep zero callers.

### 2.18 Mount `/api/recycle-bin` — `recycleBinRouter` (`app.ts:95`)

Router-level `requireAuth` (`admin.routes.ts:807`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/recycle-bin` | `admin.routes.ts:809` | `recycle_bin.view` | — | SELECT ≤ 200 entries, scoped; `snapshot` stripped from the response (`:829`) | No | `recycle-bin/page.tsx:43` |
| POST | `/api/recycle-bin/:id/restore` | `admin.routes.ts:841` | `recycle_bin.restore` | path param; `assertBankAccess` if the entry carries a bank (`:854`) | `restore()` — clears `deleted_at` on the source row, sets `restored_at` | **Yes** (`recycle-bin.ts:187`) | `recycle-bin/page.tsx:50` |
| POST | `/api/recycle-bin/:id/permanent-delete` | `admin.routes.ts:869` | `recycle_bin.permanent_delete` | `z.object({ confirm: z.literal(true) })` (`:876`) — a missing flag is a 422 | `permanentDelete()` — hard delete of the source row, sets `purged_at` | **Yes** (`recycle-bin.ts:228`) | `recycle-bin/page.tsx:69` |

### 2.19 Mount `/api/audit-logs` — `auditRouter` (`app.ts:96`)

Router-level `requireAuth` (`admin.routes.ts:898`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/audit-logs` | `admin.routes.ts:902` | `audit_logs.view` | inline query schema (`:905-913`) — `page`, `pageSize` ≤ 500, `recordType`, `recordId`, `action` | SELECT, scoped by bank OR own-actor rows (`:920-927`) | No | **NONE** |

> There is no write route. The table also rejects UPDATE and DELETE at the database level via a trigger in `0001_governance_guards.sql`. See §5.5 for a filtering defect on this endpoint.

### 2.20 Mount `/api/notifications` — `notificationsRouter` (`app.ts:97`)

Router-level `requireAuth` (`admin.routes.ts:949`). **No permission gate on any of the three routes** — a user only ever sees rows addressed to them (`WHERE user_id = ctx.userId`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/notifications` | `admin.routes.ts:955` | auth only | — | SELECT ≤ 100 own rows | No | `notifications/page.tsx:72`; `my-work/page.tsx:60`; `components/layout/topbar.tsx:71` |
| POST | `/api/notifications/read-all` | `admin.routes.ts:974` | auth only | — | UPDATE own unread rows | No | **NONE** |
| POST | `/api/notifications/:id/read` | `admin.routes.ts:987` | auth only | path param only | UPDATE one own row | No | **NONE** |

> **Nothing ever creates a notification row.** Grepping for an insert into `notifications` across `src` outside the schema definition returns zero results. These three endpoints operate on a table that is only ever read.

### 2.21 Mount `/api/imports` — `importsRouter` (`app.ts:98`)

Router-level `requireAuth` (`imports.routes.ts:17`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/imports/template/customers` | `imports.routes.ts:112` | `customers.import` | — | none — generates an `.xlsx` from `CUSTOMER_COLUMNS` (`:50-64`) | No | `components/shared/customer-import-dialog.tsx:47` (raw `fetch`, blob download) |
| POST | `/api/imports/customers` | `imports.routes.ts:155` | `customers.import` | multer: 1 file, `MAX_UPLOAD_MB`, mimetype allow-list (`:27-42`); then `rowSchema` per row (`:66-100`); per-row `assertBankAccess` (`:241`) | TX: INSERT `import_batches` (`status='previewed'`, 24 h expiry) + `import_rows`. **Nothing is written to `customers`.** | No | `customer-import-dialog.tsx:70` |
| GET | `/api/imports/:batchId` | `imports.routes.ts:334` | `customers.import` | path param; 403 unless `batch.createdBy === ctx.userId` (`:343`) | SELECT batch + all rows | No | **NONE** |
| POST | `/api/imports/:batchId/confirm` | `imports.routes.ts:361` | `customers.import` **AND** `customers.create` (`:363`) | ownership check; 409 if already imported or expired (`:377-378`); 400 if no valid rows (`:386`); `assertBankAccess` re-checked per row at confirm time (`:400`) | TX: INSERT only `status='valid'` rows into `customers`; UPDATE `import_rows` and `import_batches` | **Yes** (`:446`) | `customer-import-dialog.tsx:86` |

### 2.22 Mount `/api/dashboard` — `dashboardRouter` (`app.ts:99`)

Router-level `requireAuth` (`operations.routes.ts:519`).

| Method | Path | Source | Permission | Validation | DB effect | Audited? | Frontend caller |
|---|---|---|---|---|---|---|---|
| GET | `/api/dashboard/stats` | `operations.routes.ts:521` | `reports.view` | — | one raw SQL statement, 13 scalar sub-selects (`:534-570`) | No | `dashboard/page.tsx:40` |
| GET | `/api/dashboard/loan-status` | `operations.routes.ts:580` | `reports.view` | — | `SELECT status, count(*) FROM loans GROUP BY status`, scoped | No | `dashboard/page.tsx:42` |
| GET | `/api/dashboard/bank-performance` | `operations.routes.ts:599` | `reports.view` | — | `SELECT bank_id, count, sum(amount_approved), sum(commission) FROM loans GROUP BY bank_id`, scoped | No | `dashboard/page.tsx:49` |

---

## 3. The factory-generated route shape

`createScopedResource(config)` in `src/modules/scoped-resource.ts:72` builds a router where every handler passes through the same four gates: **authenticate → permission → bank scope → audit**. The stated rationale (`:64-71`) is that hand-writing ten near-identical resources is how one of them ends up missing its scope filter; the factory makes that structurally impossible by assembling the `WHERE` clause in exactly one place (`scopedWhere`, `:90-96`).

### 3.1 The five (or six) generated handlers

| # | Route | Line | Behaviour |
|---|---|---|---|
| 1 | `GET /` | `:102` | Parses `listQuery` (`page`, `pageSize` 1–500 default 25, `search` ≤ 160 chars, `bankId`). A supplied `bankId` is validated with `assertBankAccess` — a client filter can narrow the scope but never widen it (`:110-113`). Exact-match filters from `config.filterable`; `ILIKE %needle%` across `config.searchable` (`:116-123`). Returns `{data, meta}` with `total`, `totalPages`, `scoped`. |
| 2 | `GET /:id` | `:155` | Single row through `scopedWhere`. Out-of-scope and non-existent are indistinguishable — both 404 (`:156`). |
| 3 | `POST /` | `:170` | `config.createSchema.parse(req.body)`; `assertBankAccess(ctx, parsed.bankId)` against the **payload**, so a hand-crafted `bankId` is rejected; `config.initialStatuses` refuses an illegal starting status with 422 when configured; optional `config.beforeWrite` hook; the `code` is minted **before** the transaction opens (reading through the base handle from inside one deadlocks a single-connection driver — D-032). **Then one `db.transaction`:** insert → optional `config.afterCreate(row, { tx, … })` → audit. A throw anywhere inside rolls all of it back. Returns **201**. |
| 4 | `PATCH /:id` | `:205` | `patchSchema(createSchema)`, extended with `notOnThisRoute()` for every field in `config.patchRefusals`; loads the `before` row through `scopedWhere` (404 if out of scope); re-asserts bank access when `bankId` changes, so scoping cannot be escaped by moving a record out; audits with a field-level `diff`. |
| 5 | `DELETE /:id` | `:252` | **Only emitted when `config.permissions.delete` is set** (`:251`). Verifies the row is in scope, then `softDelete` → `deleted_at` + a `recycle_bin_entries` row. Returns **204**. |
| 6 | `POST /:id/approve` | `:272` | **Only emitted when `config.permissions.approve` is set** (`:271`). Parses `{ status, notes? }` — `z.enum(config.allowedStatuses)` when a vocabulary is configured, otherwise the historical `z.string().min(1)`. When `config.allowedTransitions` is configured, the `before` row's status is compared to the requested one and an undeclared edge is refused **422**. Sets `status`, plus `approved_by`/`approved_at` if the table has those columns, plus `notes` if supplied and the column exists. Audits with `action: "approved"`. |

**All four state-machine config fields are opt-in, and only `loans` opts in.** `allowedStatuses`, `allowedTransitions`, `initialStatuses` and `patchRefusals` are absent from every other resource, so verifications, bank orders, disbursements and settlements behave exactly as they did — a free-form `status` string on approve included. That is roadmap 6.5's, 7.3's and 13.13's to change, and `loan-state-machine.test.ts` pins the current behaviour so the boundary cannot move unnoticed. `afterCreate` is likewise used by one resource only (disbursements, Task 5.7).

`nextCode()` (`:78-82`) derives the human-readable code as `${prefix}-${codeStart + rowCount + 1}` from a `COUNT(*)` over the whole table — **not** a database sequence, and **not** filtered by `deleted_at`. **UNVERIFIED:** whether concurrent creates can collide on a code; no unique constraint on `code` was inspected for these tables as part of this document.

### 3.2 Which resources get DELETE and/or approve

| Resource | Mount | Config | `delete`? | `approve`? | Routes |
|---|---|---|---|---|---|
| loans | `/api/loans` | `operations.routes.ts:50` | ✅ `requests.delete` | ✅ `requests.approve` | **6** |
| verifications | `/api/verifications` | `operations.routes.ts:185` | ❌ | ✅ `verification.approve` | **5** |
| bank-orders | `/api/bank-orders` | `operations.routes.ts:215` | ✅ `bank_orders.delete` | ❌ | **5** |
| disbursements | `/api/disbursements` | `operations.routes.ts:248` | ❌ | ✅ `disbursements.approve` | **5** |
| settlements | `/api/settlements` | `operations.routes.ts:283` | ❌ | ✅ `settlements.approve` | **5** |
| transactions | `/api/transactions` | `operations.routes.ts:321` | ❌ | ❌ | **4** |
| ledger | `/api/ledger` | `operations.routes.ts:351` | ❌ | ❌ | **4** |
| documents | `/api/documents` | `operations.routes.ts:380` | ✅ `documents.delete` | ❌ | **5** |
| funding-sources | `/api/funding-sources` | `operations.routes.ts:405` | ✅ `funding_sources.delete` | ❌ | **5** |
| | | | | **Total** | **44** |

Deviations worth noting:

- **documents** maps both `create` and `edit` to the single `documents.upload` permission (`operations.routes.ts:385-386`) — the catalogue has no `documents.edit`.
- **ledger** and **funding-sources** declare `bankId` as **optional** in their create schemas (`:366`, `:419`), while the factory calls `assertBankAccess` unconditionally. See §5.1.
- **transactions** and **ledger** override `orderColumn` to `occurredAt` / `entryDate` respectively (`:331`, `:361`); everything else orders by `createdAt` descending.

---

## 4. Summary counts

### 4.1 Totals

| | HEAD (`7ef5da5`) | Working tree |
|---|---|---|
| Hand-written endpoints | 51 | 52 |
| Factory-generated endpoints | 44 | 44 |
| **Total endpoints** | **95** | **96** |
| Distinct METHOD+path pairs called by the frontend | 36 | **38** |
| Endpoints with **zero** frontend callers | **59** (62%) | **58** (60%) |

> **Correction to the working baseline.** The figure of "27 distinct METHOD+path pairs / 69 dead endpoints" that circulated with earlier notes is **wrong**. Enumerating every `api.*`, `apiRequest` and raw `fetch` call site in `frontend/src` (excluding `frontend/src/lib/demo` and `.next`), and resolving the paths passed into `useResource` / `useRecord` / `useStats` in `frontend/src/hooks/use-api.ts`, yields **38** distinct pairs in the working tree and **36** at HEAD. The 27 figure appears to derive from the 25-entry `FRONTEND_CALLS` array in `src/tests/frontend-contract.test.ts:62-88`, which covers **GET requests only** and omits every write path.

Per-module endpoint counts:

| Module | Endpoints |
|---|---|
| `health.routes.ts` | 2 |
| `auth.routes.ts` | 5 |
| `banks.routes.ts` | 5 |
| `customers.routes.ts` | 6 |
| `admin.routes.ts` — users | 6 (5 at HEAD) |
| `admin.routes.ts` — roles | 6 |
| `admin.routes.ts` — teams | 4 |
| `admin.routes.ts` — recycle-bin | 3 |
| `admin.routes.ts` — audit-logs | 1 |
| `admin.routes.ts` — notifications | 3 |
| `imports.routes.ts` | 4 |
| `operations.routes.ts` — service-providers | 3 |
| `operations.routes.ts` — dashboard | 3 |
| `operations.routes.ts` — loans/:id/verification | 1 |
| `scoped-resource.ts` (×9 resources) | 44 |
| **Total** | **96** |

### 4.2 The 38 endpoints the frontend calls (working tree)

| Method | Path | Primary caller |
|---|---|---|
| POST | `/api/auth/login` | `hooks/use-auth.tsx:187` |
| POST | `/api/auth/refresh` | `lib/api.ts:87` |
| POST | `/api/auth/logout` | `hooks/use-auth.tsx:223` |
| POST | `/api/auth/change-password` | `change-password/page.tsx:48` *(working tree only)* |
| GET | `/api/banks` | `hooks/use-reference.tsx:67` |
| POST | `/api/banks` | `banks/page.tsx:69` |
| PATCH | `/api/banks/:id` | `banks/page.tsx:97` |
| GET | `/api/customers` | `customers/page.tsx:63` |
| GET | `/api/customers/:id` | `customers/[id]/page.tsx:60` |
| POST | `/api/customers` | `customers/page.tsx:314` |
| DELETE | `/api/customers/:id` | `customers/page.tsx:261` |
| GET | `/api/users` | `hooks/use-reference.tsx:68` |
| POST | `/api/users` | `employees/page.tsx:158` |
| PATCH | `/api/users/:id` | `employees/page.tsx:222` |
| POST | `/api/users/:id/reset-password` | `employees/page.tsx:199` *(working tree only)* |
| POST | `/api/users/:id/resend-invitation` | `employees/page.tsx:369` *(working tree only)* |
| GET | `/api/roles` | `employees/page.tsx:94` |
| GET | `/api/teams` | `hooks/use-reference.tsx:69` |
| GET | `/api/loans` | `loans/page.tsx:51` |
| POST | `/api/loans` | `loans/page.tsx:83` |
| GET | `/api/bank-orders` | `bank-orders/page.tsx:54` |
| GET | `/api/disbursements` | `disbursement/page.tsx:43` |
| POST | `/api/disbursements` | `disbursement/page.tsx:63` |
| GET | `/api/settlements` | `settlements/page.tsx:32` |
| GET | `/api/transactions` | `transactions/page.tsx:33` |
| GET | `/api/ledger` | `ledger/page.tsx:46` |
| POST | `/api/ledger` | `ledger/page.tsx:63` |
| GET | `/api/documents` | `documents/page.tsx:52` |
| POST | `/api/documents` | `documents/page.tsx:81` |
| GET | `/api/recycle-bin` | `recycle-bin/page.tsx:43` |
| POST | `/api/recycle-bin/:id/restore` | `recycle-bin/page.tsx:50` |
| POST | `/api/recycle-bin/:id/permanent-delete` | `recycle-bin/page.tsx:69` |
| GET | `/api/notifications` | `notifications/page.tsx:72` |
| GET | `/api/imports/template/customers` | `customer-import-dialog.tsx:47` |
| POST | `/api/imports/customers` | `customer-import-dialog.tsx:70` |
| POST | `/api/imports/:batchId/confirm` | `customer-import-dialog.tsx:86` |
| GET | `/api/dashboard/stats` | `dashboard/page.tsx:40` |
| GET | `/api/dashboard/loan-status` | `dashboard/page.tsx:42` |
| GET | `/api/dashboard/bank-performance` | `dashboard/page.tsx:49` |

### 4.3 The 58 dead endpoints, grouped by area

**Operations — mutation surface never reached (24)**

The nine factory resources expose 44 endpoints; the frontend calls 12 of them (9 lists, 3 creates). Every `GET /:id`, every `PATCH`, every `DELETE` and every `approve` is unreachable from the UI.

| Area | Dead endpoints |
|---|---|
| loans | `GET /:id`, `DELETE /:id` (2) — ~~`PATCH /:id`~~ wired by **5.5**, ~~`POST /:id/approve`~~ by **5.4**, ~~`POST /:id/verification`~~ by **5.6** |
| verifications | `GET /:id`, `PATCH /:id`, `POST /:id/approve` (3) — ~~`GET /`~~ wired by **5.6**. `POST /` is reachable but **deliberately not called**: it has no `beforeWrite` and so skips `assertSameBank` and both business rules |
| bank-orders | `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` (4) |
| disbursements | `GET /:id`, `PATCH /:id`, `POST /:id/approve` (3) |
| settlements | `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/approve` (4) |
| transactions | `GET /:id`, `POST /`, `PATCH /:id` (3) |
| ledger | `GET /:id`, `PATCH /:id` (2) |
| documents | `GET /:id`, `PATCH /:id`, `DELETE /:id` (3) |
| funding-sources | all 5 — the entire resource is unreachable |
| service-providers | `POST /`, `PATCH /:id` (2) — ~~`GET /`~~ wired by **5.6**, permission-gated on `service_providers.view`. The two writes need an admin screen no roadmap row owns |

Ten UI actions call `refresh()` and raise a toast **without issuing any HTTP request**, while the matching backend route exists and is never called:

| Handler | File:line | Route it should call |
|---|---|---|
| `updateStatus` | `loans/page.tsx:68` | `PATCH /api/loans/:id` or `POST /api/loans/:id/approve` |
| `moveStage` | `bank-orders/page.tsx:58` | `PATCH /api/bank-orders/:id` |
| `saveRemark` | `bank-orders/page.tsx:64` | `PATCH /api/bank-orders/:id` |
| `markCredited` | `disbursement/page.tsx:81` | `PATCH` or `POST /:id/approve` |
| `retry` | `disbursement/page.tsx:87` | `PATCH /api/disbursements/:id` |
| `markPaid` | `settlements/page.tsx:35` | `PATCH` or `POST /:id/approve` |
| `raiseDispute` | `settlements/page.tsx:44` | `PATCH` or `POST /:id/approve` |
| `settle` | `transactions/page.tsx:36` | `PATCH /api/transactions/:id` |
| `setStatus` | `documents/page.tsx:104` | `PATCH /api/documents/:id` |
| `remove` | `documents/page.tsx:109` | `DELETE /api/documents/:id` |
| ~~"Save changes"~~ | `customers/[id]/page.tsx` | ✅ **WIRED by Task 4.1, 2026-09-05** — `PATCH /api/customers/:id`, changed fields only |
| ~~"Delete"~~ | `customers/[id]/page.tsx` | ✅ **WIRED by Task 4.2, 2026-09-05** — `DELETE /api/customers/:id`, gated on `customers.delete` |
| "Print" | `customers/[id]/page.tsx` | — (no backend equivalent). **Still fake; owned by Phase 11.4.** |
| ~~`handleManualFormUpload`~~ | `customers/page.tsx` | ✅ **REMOVED by Task 4.4, 2026-09-05** — control, handler and hidden input deleted; no file storage exists to wire |

`bank-orders/page.tsx` makes **zero** write calls of any kind. *(`customers/[id]/page.tsx` did too until Phase 4; it now issues `PATCH` and `DELETE`.)*

**Identity & governance administration (16)**

| Endpoint | Source |
|---|---|
| `GET /api/auth/me` | `auth.routes.ts:212` |
| `PUT /api/users/:id/banks` | `admin.routes.ts:386` |
| `DELETE /api/users/:id` | `admin.routes.ts:434` |
| `GET /api/roles/permissions` | `admin.routes.ts:500` |
| `POST /api/roles` | `admin.routes.ts:524` |
| `PATCH /api/roles/:id` | `admin.routes.ts:575` |
| `PUT /api/roles/:id/permissions` | `admin.routes.ts:614` |
| `DELETE /api/roles/:id` | `admin.routes.ts:663` |
| `POST /api/teams` | `admin.routes.ts:728` |
| `PUT /api/teams/:id/members` | `admin.routes.ts:749` |
| `DELETE /api/teams/:id` | `admin.routes.ts:784` |
| `GET /api/audit-logs` | `admin.routes.ts:902` |
| `POST /api/notifications/read-all` | `admin.routes.ts:974` |
| `POST /api/notifications/:id/read` | `admin.routes.ts:987` |
| `GET /api/banks/:id` | `banks.routes.ts:52` |
| `DELETE /api/banks/:id` | `banks.routes.ts:145` |

There is no roles-and-permissions management screen, no team management screen, and no audit-log viewer in the frontend. The whole RBAC editing surface is server-only.

**Customers & imports (3)**

| Endpoint | Source | Note |
|---|---|---|
| ~~`PATCH /api/customers/:id`~~ | `customers.routes.ts` | [WIRED] **Task 4.1, 2026-09-05** - the detail edit dialog is its first caller |
| ~~`GET /api/customers/check/reference`~~ | `customers.routes.ts` | [WIRED] **Task 4.6, 2026-09-05** - the create form calls it as an **advisory** pre-flight; the unique constraint remains the authority |
| `GET /api/imports/:batchId` | `imports.routes.ts:334` | the dialog keeps `preview` in React state from the upload response, so it never re-fetches |

**Operations & health (2)**

| Endpoint | Source |
|---|---|
| `GET /api/health` | `health.routes.ts:8` |
| `GET /api/health/ready` | `health.routes.ts:13` |

Both are intended for an external orchestrator. There is no CI configuration, no `Dockerfile`, no `vercel.json`, no `railway.*` and no `Procfile` in the repository, so nothing currently polls them.

---

## 5. Known API defects

Each item below was reproduced by reading the code path end to end. Severity is the author's judgement; the mechanism is cited.

### 5.1 `POST /api/ledger` returns 403 for every bank-scoped user

**Files:** `src/modules/operations.routes.ts:366`, `src/modules/scoped-resource.ts:177`, `src/services/access.ts:121-127`, `frontend/src/app/(app)/ledger/page.tsx:63-71`

The ledger create schema declares `bankId` optional:

```ts
// operations.routes.ts:366
bankId: uuidField.optional().nullable(),
```

The factory nevertheless asserts bank access unconditionally on the parsed payload:

```ts
// scoped-resource.ts:177
assertBankAccess(ctx, parsed.bankId);
```

and `assertBankAccess` throws on a falsy `bankId` whenever the caller is scoped:

```ts
// services/access.ts:121-124
export function assertBankAccess(ctx: AuthContext, bankId: string | null | undefined): void {
  if (ctx.bankIds === null) return;                       // unscoped: pass
  if (!bankId) throw forbidden("A bank must be specified for this operation");
```

The ledger form never sends a `bankId` (`ledger/page.tsx:63-71` posts `particulars`, `party`, `category`, `debit`, `credit`, `mode`, `entryDate` and nothing else). Consequently **every user who does not hold `system.access_all_banks` gets a 403 with "A bank must be specified for this operation"** when posting a voucher. Only Super Admin (and Admin, which holds `system.access_all_banks` by default, `lib/permissions.ts:230`) can create a ledger entry. Manager, Team Leader and Executive cannot — and Manager only holds `ledger.view` anyway.

`funding_sources` has the same optional-`bankId` shape (`operations.routes.ts:419`) and would fail identically, but it has no frontend caller so the defect is latent there.

### 5.2 `/api/dashboard/*` requires `reports.view`, which Executive does not hold

**Files:** `src/modules/operations.routes.ts:521`, `:580`, `:599`; `src/lib/permissions.ts:291-311`

All three dashboard endpoints are gated on `PERMISSIONS.reports.view`. The default Executive role (level 40) is granted exactly twelve permissions and `reports.view` is not among them (`lib/permissions.ts:298-310`):

| Role | Level | Holds `reports.view`? |
|---|---|---|
| super_admin | 0 | ✅ (`"*"`) |
| admin | 10 | ✅ (`lib/permissions.ts:213`) |
| manager | 20 | ✅ (`:256`) |
| team_leader | 30 | ✅ (`:286`) |
| **executive** | **40** | **❌** |

The dashboard is the application's landing route (`login/page.tsx:29` and `:53` both redirect to `/dashboard`). For an Executive, `useStats("/dashboard/stats")` swallows the 403 and sets `data` to `null` (`hooks/use-api.ts:159-161`), so every KPI renders as `0` rather than as an error — the failure is silent and indistinguishable from an empty database. The two `useResource` dashboard calls surface the error string but the page has no error UI wired for them.

### 5.3 `POST /api/imports/customers` returns 500 on a rejected file type or an oversized file

**Files:** `src/modules/imports.routes.ts:30-41`, `:46`; `src/middleware/error-handler.ts:84-87`

multer's `fileFilter` rejects with a bare `Error`:

```ts
// imports.routes.ts:36-39
if (!ok) { cb(new Error("Only .xlsx, .xls and .csv files are accepted")); return; }
```

That value reaches `errorHandler` as neither a `ZodError` nor an `AppError`; `rootCause` finds no five-digit `code`, so it falls through every branch to the catch-all:

```ts
// error-handler.ts:84-87
logger.error({ err: error, requestId: req.requestId }, "Unhandled error");
res.status(500).json({ error: { code: "internal_error", message: "Unexpected server error" } });
```

The user uploads a `.pdf` and is told "Unexpected server error" — the specific, actionable message written in `fileFilter` is discarded. The same applies to multer's `LIMIT_FILE_SIZE` `MulterError` when a file exceeds `MAX_UPLOAD_MB` (default 10 MB, `imports.routes.ts:29`): its `code` is the string `"LIMIT_FILE_SIZE"`, which does not match `/^\d{5}$/` in `rootCause` (`error-handler.ts:32`), so it too becomes a 500. Correct behaviour would be 415 or 422 with the real message. The frontend shows whatever `errorMessage` extracts, so the dialog reads "Validation failed — Unexpected server error" (`customer-import-dialog.tsx:74`).

### 5.4 `POST /:id/approve` accepts any status string

**File:** `src/modules/scoped-resource.ts:288-290`

```ts
const status = z
  .object({ status: z.string().min(1), notes: z.string().max(1000).optional() })
  .parse(req.body);
```

Every resource's `createSchema` constrains `status` to an enum — loans to seven values (`operations.routes.ts:83-85`), disbursements to three (`:271`), settlements to three (`:304`), verifications to seven (`:204-206`) — but the approve handler bypasses that entirely and writes the raw string:

```ts
// scoped-resource.ts:283
.set({ status: status.status, ... })
```

There are **zero CHECK constraints** in the database, so `POST /api/loans/{id}/approve` with `{"status":"banana"}` succeeds with 200 and persists `loans.status = 'banana'`. Any subsequent `PATCH` on that row is unaffected (the partial schema only validates supplied fields), but every status-based aggregate silently misclassifies it — `dashboard/stats` counts it in neither `pending_loans` nor `approved_loans` (`operations.routes.ts:540-545`), and `dashboard/loan-status` reports it as its own bucket. The fix is to derive the enum from `config.createSchema`.

### 5.5 `GET /api/audit-logs` silently drops query filters through SQL operator precedence

**File:** `src/modules/admin.routes.ts:915-929`

The handler pushes each query filter and then, for a scoped caller, an unparenthesised raw fragment containing a top-level `or`:

```ts
// admin.routes.ts:916-926
if (query.recordType) filters.push(eq(auditLogs.recordType, query.recordType));
if (query.recordId)   filters.push(eq(auditLogs.recordId,   query.recordId));
if (query.action)     filters.push(eq(auditLogs.action,     query.action));

if (ctx.bankIds !== null) {
  filters.push(
    ids.length === 0 ? sql`false`
    : sql`(${auditLogs.bankId} is null and ${auditLogs.actorId} = ${ctx.userId}) or ${auditLogs.bankId} in (...)`,
  );
}
const where = filters.length ? and(...filters) : undefined;   // :929
```

Drizzle's `and()` wraps the **whole list** in one pair of parentheses and joins with `" and "`; it does **not** parenthesise the individual conditions (`drizzle-orm/sql/expressions/conditions.js:36-40`). For a scoped caller who passes `?recordType=loan`, the emitted predicate is:

```sql
(record_type = 'loan' and (bank_id is null and actor_id = $u) or bank_id in ($banks))
```

`AND` binds tighter than `OR`, so Postgres reads this as:

```sql
((record_type = 'loan' AND bank_id IS NULL AND actor_id = $u) OR (bank_id IN ($banks)))
```

**The `recordType` filter is discarded for every row that has a bank.** A scoped user filtering the audit trail by record type, record id or action receives their entire bank-scoped log instead. The bug requires both a query filter and a scoped caller: with no filters, `and()` receives one condition and returns it unwrapped (`conditions.js:33-35`), which is correct; unscoped callers push no `or` fragment at all. The fix is to wrap the scope fragment in its own parentheses.

The structurally similar fragment in `GET /api/users` (`admin.routes.ts:106`) is **not** affected — `exists (...)` is self-contained with no top-level `or`.

### 5.6 Any `/:id` route returns 500 on a malformed UUID

**Files:** `src/modules/scoped-resource.ts:159`, `:209`, `:257`, `:281`; `src/middleware/error-handler.ts:65-87`

No `/:id` handler validates the path parameter. The factory casts and passes it straight into the query:

```ts
// scoped-resource.ts:159
.where(scopedWhere(req, [eq(idColumn, req.params.id as string)]))
```

Postgres rejects a non-UUID literal against a `uuid` column with SQLSTATE **`22P02`** (`invalid input syntax for type uuid`). `errorHandler` maps only `23505` and `23503`; everything else falls to the catch-all, so `GET /api/loans/abc` returns **500 `internal_error`** where it should return 400 or 404. This affects every `/:id` route across the codebase — the 44 factory routes plus the hand-written `banks`, `customers`, `users`, `roles`, `teams`, `recycle-bin`, `imports/:batchId` and `notifications/:id/read` handlers. A single `z.string().uuid().parse(req.params.id)` (which would surface as a clean 422 via the existing Zod branch) is absent everywhere.

### 5.7 `GET /api/health/ready` leaks the raw driver error to unauthenticated callers

**File:** `src/modules/health.routes.ts:13-27`

```ts
// health.routes.ts:25
res.status(503).json({
  status: "degraded",
  database: { connected: false, error: (error as Error).message },
  ...
});
```

The route has **no** `requireAuth` and no permission gate. When the Neon connection fails, the node-postgres error message is returned verbatim to any anonymous caller. Depending on the failure mode, that message can contain the database host, port, database name, role name, and the reason for refusal — the exact information an unauthenticated probe should not receive. The rest of the API is careful about this: `errorHandler` logs the real error and returns a fixed `"Unexpected server error"` string (`error-handler.ts:84-86`). This route is the one place that inverts that policy.

### 5.8 `mustChangePassword` is never enforced server-side

**Files:** `src/services/access.ts:19`, `:82`; `src/modules/auth.routes.ts:70`, `:145`; `frontend/src/components/layout/app-shell.tsx:39-48`

`mustChangePassword` is written on user creation (`admin.routes.ts:208`), on an admin-set password (`:293`), and on password reset (`:350`, working tree). It is loaded into every request's auth context (`access.ts:82`) and returned on the login response (`auth.routes.ts:145`) and on the profile (`:70`, **working-tree addition**).

It is **never asserted as a guard**. There is no middleware in `src/middleware/` that checks it, and no route handler references it as a precondition. A user on a temporary password holds a fully valid access token and can call every endpoint their permissions allow. The only enforcement is a React redirect:

```ts
// frontend/src/components/layout/app-shell.tsx:39-48
const mustChangePassword =
  ready && Boolean(user?.mustChangePassword) && pathname !== CHANGE_PASSWORD_ROUTE;
React.useEffect(() => { if (mustChangePassword) router.replace(CHANGE_PASSWORD_ROUTE); }, [...]);
if (!ready || !user || outOfScope || mustChangePassword) { return <Loading/>; }
```

Anyone issuing HTTP requests directly bypasses it entirely. At HEAD the situation is worse still: `profileOf` did not carry `mustChangePassword` (see the diff on `auth.routes.ts:65-70`), so the flag was lost on every page reload and even the client-side guard did not survive a refresh.

### 5.9 Related frontend-side defect: `disableDemoMode` is never called on a real sign-in

**File:** `frontend/src/hooks/use-auth.tsx:212`

`disableDemoMode()` has exactly one call site, inside the demo branch of `signOut` (`use-auth.tsx:212`). The real branch of `signIn` never clears the flag. Since `apiRequest` short-circuits to `demoRequest` whenever `isDemoMode()` is true (`lib/api.ts:118`), a session that entered demo mode and then signs in with real credentials without signing out first will have **every** subsequent API call served from browser fixtures instead of the server.

---

## 6. Absent endpoints implied by the permission catalogue

`src/lib/permissions.ts:11-134` declares the complete capability vocabulary. Ten declared keys are referenced by **no** route in `src/modules/`:

| Permission key | Declared at | Routes referencing it | Missing endpoint |
|---|---|---|---|
| `settings.view` | `lib/permissions.ts:121` | **0** | `GET /api/settings` |
| `settings.edit` | `lib/permissions.ts:122` | **0** | `PATCH`/`PUT /api/settings` |
| `customers.export` | `lib/permissions.ts:18` | **0** | `GET /api/customers/export` |
| `banks.assign` | `lib/permissions.ts:25` | **0** | a bank-assignment route on `/api/banks` |
| `teams.edit` | `lib/permissions.ts:45` | **0** | `PATCH /api/teams/:id` |
| `requests.assign` | `lib/permissions.ts:54` | **0** | `POST /api/loans/:id/assign` |
| `requests.import` | `lib/permissions.ts:56` | **0** | a loan importer (only `customers.import` is implemented) |
| `service_providers.delete` | `lib/permissions.ts:80` | **0** | `DELETE /api/service-providers/:id` |

Beyond unreferenced keys, four capabilities are implied by the schema or by the routes that do exist, and are simply not routed:

| Missing endpoint | Why it is implied | Evidence it is absent |
|---|---|---|
| **`/api/settings`** | The `app_settings` table is created by the migrations and modelled at `db/schema/governance.ts:95`. `settings.view` and `settings.edit` exist in the catalogue and `settings.view` is granted to Admin by default (`lib/permissions.ts:229`). | No `settings` mount in `app.ts:78-99`. Grepping `appSettings` across `src` outside `db/schema` returns **zero** hits — the table is entirely dead. |
| **Role `isActive` toggle** | `roles.is_active` is read on every single request: login rejects a user whose role is disabled (`auth.routes.ts:132`) and `loadAuthContext` throws 403 for the same reason (`services/access.ts:53`). The disable switch is therefore load-bearing. | `PATCH /api/roles/:id` sets only `name`, `description` and (for non-system roles) `level` (`admin.routes.ts:589-596`). Grepping `isActive` in `admin.routes.ts` returns **zero** hits. There is no way through the API to flip the flag; it can only be changed directly in the database. |
| **`/api/users/me` self-service** | Every user needs to update their own profile — name, phone, avatar colour — and today the only self-directed route is `POST /api/auth/change-password`. `PATCH /api/users/:id` is gated on `users.edit`, which Manager, Team Leader and Executive do not hold (`lib/permissions.ts:243`, `:270`, `:298`), and additionally on `assertCanManageRoleLevel` (`admin.routes.ts:261`), which requires the target's role level to be **strictly greater** than the actor's — a user can never satisfy that against themselves. | `GET /api/auth/me` (`auth.routes.ts:212`) is read-only and has no frontend caller. There is no `PATCH /api/auth/me` and no `/api/users/me` route of any method. |
| **`/api/reports`** | `reports.view` exists (`lib/permissions.ts:110`) and is granted to four of the five default roles. The frontend has a `/reports` page (`app/(app)/reports/page.tsx`). | `reports.view` gates only the three `/api/dashboard/*` endpoints (`operations.routes.ts:521`, `:580`, `:599`). There is no `/api/reports` mount. The reports page derives everything client-side from `GET /api/customers` (`reports/page.tsx:40`) and `GET /api/loans` (`:43`) — there is no server-side reporting endpoint at all. |

Two further capability gaps are worth naming because they are frequently assumed to exist:

- **Email.** There is no email capability anywhere in the system: zero provider dependencies, zero transport code, zero templates, and no `EMAIL_*`, `SMTP_*` or `MAIL_*` variables in `src/config/env.ts`. Consequently a temporary password can only be delivered by reading it off the screen once — which is why both credential-issuing endpoints return it in the response body (§1.3) and why the working tree adds `frontend/src/components/shared/credential-handover.tsx`.
- **File storage.** No object-storage client, no upload endpoint, no signed-URL route. See the note under §2.15.

---

## Appendix: verification method

Every table in this document was built from a direct read of the source at commit `7ef5da5` plus the dirty working tree, not from prior notes.

| Fact | How it was established |
|---|---|
| Route inventory | `grep -rnE "Router\.(get\|post\|patch\|put\|delete)\(" src/modules/` plus a full read of `scoped-resource.ts` for the six conditional factory routes |
| Mounts | Full read of `src/app.ts:78-99` |
| Factory shape and per-resource DELETE/approve | Full read of `scoped-resource.ts` and of the nine `createScopedResource` configs in `operations.routes.ts` |
| Frontend callers | `grep` for `api.(list\|get\|create\|update\|replace\|remove\|action\|upload)`, `apiRequest` and `fetch(` across `frontend/src`, excluding `frontend/src/lib/demo` and `.next`; then resolution of every `useResource` / `useRecord` / `useStats` path argument |
| HEAD vs working tree | `git diff HEAD` on each modified backend module, and `git show HEAD:<path>` for the four frontend files whose call sites changed |
| Drizzle `and()` parenthesisation (§5.5) | Read of `node_modules/drizzle-orm/sql/expressions/conditions.js:26-41` |
| Permission-to-route mapping | `grep -rn "PERMISSIONS.<key>" src/modules/` for each catalogue key |

**Not verified in this document:** whether `nextCode()` can produce duplicate codes under concurrency (§3.1); the runtime behaviour of any endpoint against a live database — all findings are derived from static reading of the code paths.
