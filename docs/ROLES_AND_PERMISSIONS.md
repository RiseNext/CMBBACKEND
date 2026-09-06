# Roles and Permissions

**Scope.** How authorisation actually works in this repository: where permission strings live, how they reach a request, what the five seeded roles hold, what the hierarchy rule permits, and where the model and the shipped UI disagree.

**Baseline.** Commit `7ef5da5` ("Add frontend-only employee demo"). The working tree is **dirty** — 8 modified files and 4 untracked files implement employee creation, temporary passwords, admin-issued resets and a forced password change. Where HEAD and the working tree differ, both are documented and the difference is labelled.

Every claim below cites `file:line`. Anything that could not be traced to code is marked **UNVERIFIED**.

---

## 1. Model

### 1.1 Permissions are normalised rows, not JSON and not an enum

There is no `permissions jsonb` column and no Postgres enum. Three tables carry the whole model:

| Table | Columns that matter | Definition |
|---|---|---|
| `roles` | `key` (stable, unique), `name` (renameable), `level` (int, default 100), `is_system`, `is_active`, soft-delete columns | `src/db/schema/identity.ts:28-51` |
| `permissions` | `key` (`resource.action`, unique), `resource`, `action`, `description` | `identity.ts:57-71` |
| `role_permissions` | composite PK `(role_id, permission_id)`, `granted_at`, `granted_by`; both FKs `ON DELETE CASCADE` | `identity.ts:73-89` |

`users.role_id` is `NOT NULL` with `ON DELETE restrict` (`identity.ts:108-110`) — a role that is still held cannot be dropped out from under its users. The API adds a second guard: `DELETE /api/roles/:id` refuses while any non-deleted user holds the role (`src/modules/admin.routes.ts:674-680`).

There is **one role per user**. There is no `user_permissions` table and no per-user grant or deny overrides — grep the schema index and you will find only the three tables above. The only per-user authorisation data outside the role is bank scope (`user_bank_access`, section 5).

### 1.2 Resolution chain

```
request  ->  requireAuth  ->  verifyAccessToken  ->  loadAuthContext(db, sub)
             users -> roles -> role_permissions -> permissions.key  ->  Set<string>
```

| Step | Code |
|---|---|
| Extract `Authorization: Bearer` | `src/middleware/auth.ts:7-13` |
| Verify HS256 access token, take `claims.sub` only | `middleware/auth.ts:25-26` |
| Join `users` → `roles`, reject deleted / non-Active / disabled-role | `src/services/access.ts:31-53` |
| Join `role_permissions` → `permissions`, collect `permissions.key` into a `Set` | `access.ts:55-61` |
| Resolve bank scope unless `system.access_all_banks` is held | `access.ts:63-70` |
| Route guard `requirePermission(...keys)` — every key must be present | `middleware/auth.ts:39-49`, `access.ts:93-97` |
| Route guard `requireAnyPermission(...keys)` — at least one must be present | `middleware/auth.ts:52-64` |

### 1.3 Permissions are re-read from the database on every request

`loadAuthContext` is called inside `requireAuth` on each request (`middleware/auth.ts:26`), not decoded from the JWT. The access token carries only `sub`, `email`, `roleId`, `roleKey`, `roleLevel` (`src/modules/auth.routes.ts:47-53`) and **none of those claims are used for authorisation decisions** — the permission set, the bank list and the account status all come from the database. Consequences:

- Revoking a permission, deactivating an account, or disabling a role takes effect on the user's **next request**, not at token expiry (15 minutes).
- Every authenticated request costs at least two queries (user+role, then role permissions) and a third when the caller is bank-scoped. This is a deliberate trade, documented at `middleware/auth.ts:15-20` and `access.ts:25-29`.

### 1.4 Role names never appear in authorisation logic

Route guards reference `PERMISSIONS.*` only (`src/lib/permissions.ts:4-6`). The complete set of places production code compares against a role key or the `is_system` flag:

| Site | Purpose |
|---|---|
| `access.ts:155` | only a holder of `system.manage_any_user` may assign the `super_admin` role |
| `admin.routes.ts:626` | a system role's permission set cannot be edited through the API |
| `admin.routes.ts:444-451` | the last active Super Admin cannot be deleted |
| `access.ts:177-181` | a system role cannot be deleted or re-keyed |
| `src/db/seed.ts:100` | locating the `super_admin` role to attach the bootstrap user |

### 1.5 What the client receives

`GET /api/auth/me`, `/login` and `/refresh` all return the same profile shape (`auth.routes.ts:59-72`): `id`, `name`, `email`, `role {id, key, name, level}`, `permissions` (a sorted array of the resolved keys), `bankIds`, `unrestrictedBankAccess`, and — **working tree only** — `mustChangePassword` (`auth.routes.ts:68-70`, added by the same change as `access.ts:18-19`). The frontend stores this in React state plus `localStorage` and exposes `can()` / `canAny()` over the array (`frontend/src/hooks/use-auth.tsx:259-272`). That is presentation only; the server never trusts it.

---

## 2. Complete permission catalogue

76 keys, declared in exactly one place: `src/lib/permissions.ts:11-134` (counted: 76 literal `key: "resource.action"` entries between lines 11 and 134). `ALL_PERMISSIONS` derives `resource`/`action` by splitting on the first `.` and generates a description as `"{action} {resource}"` with underscores replaced by spaces, unless the key appears in the four-entry `DESCRIPTIONS` override map (`permissions.ts:146-163`).

Legend for **Consumed by**: `factory` means the route is emitted by `createScopedResource` (`src/modules/scoped-resource.ts:74-322`), which reads the key from the resource's `permissions` block.

### customers (6)

| Key | Seeded description | Consumed by |
|---|---|---|
| `customers.view` | view customers | `GET /api/customers` (`customers.routes.ts:91`), `GET /api/customers/:id` (`:145`), `GET /api/customers/check/reference` (`:293-295`) |
| `customers.create` | create customers | `POST /api/customers` (`customers.routes.ts:166`); also required by `POST /api/imports/:batchId/confirm` (`imports.routes.ts:363`) |
| `customers.edit` | edit customers | `PATCH /api/customers/:id` (`customers.routes.ts:214`) |
| `customers.delete` | delete customers | `DELETE /api/customers/:id` (`customers.routes.ts:266`) |
| `customers.import` | import customers | `GET /api/imports/template/customers` (`imports.routes.ts:112-114`), `POST /api/imports/customers` (`:155-157`), `GET /api/imports/:batchId` (`:334`), `POST /api/imports/:batchId/confirm` (`:363`) |
| `customers.export` | export customers | **NOTHING — orphaned.** No route, no service, no test references this key outside the catalogue. |

### banks (5)

| Key | Seeded description | Consumed by |
|---|---|---|
| `banks.view` | view banks | `GET /api/banks` (`banks.routes.ts:33`), `GET /api/banks/:id` (`:52`) |
| `banks.create` | create banks | `POST /api/banks` (`banks.routes.ts:73`) |
| `banks.edit` | edit banks | `PATCH /api/banks/:id` (`banks.routes.ts:104`) |
| `banks.delete` | delete banks | `DELETE /api/banks/:id` (`banks.routes.ts:145`) |
| `banks.assign` | assign banks | **NOTHING — orphaned.** Bank assignment is actually gated by `users.assign` (`admin.routes.ts:386`). |

### users (6)

| Key | Seeded description | Consumed by |
|---|---|---|
| `users.view` | view users | `GET /api/users` (`admin.routes.ts:85`) |
| `users.create` | create users | `POST /api/users` (`admin.routes.ts:159`) |
| `users.edit` | edit users | `PATCH /api/users/:id` (`admin.routes.ts:251`) |
| `users.delete` | delete users | `DELETE /api/users/:id` (`admin.routes.ts:434`) — soft delete |
| `users.assign` | assign users | `PUT /api/users/:id/banks` (`admin.routes.ts:386`) |
| `users.reset_password` | reset password users | `POST /api/users/:id/reset-password` (`admin.routes.ts:328-330`) — **working tree only.** See note below. |

> **`users.reset_password` was orphaned at HEAD.** `git show HEAD:src/modules/admin.routes.ts` contains no `reset-password` route and no `resetPassword` reference: at commit `7ef5da5` the key was seeded, granted to `admin`, and consumed by nothing. The working tree wires it to a real handler that issues a fresh temporary password, sets `must_change_password`, clears `failed_login_attempts` / `locked_until`, and revokes every outstanding refresh token in the same transaction (`admin.routes.ts:342-371`). The handler's own comment states the history (`admin.routes.ts:316-327`).

### roles (5)

| Key | Seeded description | Consumed by |
|---|---|---|
| `roles.view` | view roles | `GET /api/roles` (`admin.routes.ts:476`), `GET /api/roles/permissions` (`:500`) |
| `roles.create` | create roles | `POST /api/roles` (`admin.routes.ts:524`) |
| `roles.edit` | edit roles | `PATCH /api/roles/:id` (`admin.routes.ts:575`) |
| `roles.delete` | delete roles | `DELETE /api/roles/:id` (`admin.routes.ts:663`) |
| `roles.assign_permissions` | *Grant or revoke permissions on a role* (override, `permissions.ts:150`) | `PUT /api/roles/:id/permissions` (`admin.routes.ts:614-616`) |

### teams (5)

| Key | Seeded description | Consumed by |
|---|---|---|
| `teams.view` | view teams | `GET /api/teams` (`admin.routes.ts:700`) |
| `teams.create` | create teams | `POST /api/teams` (`admin.routes.ts:728`) |
| `teams.edit` | edit teams | **NOTHING — orphaned.** There is no team-update route at all. |
| `teams.delete` | delete teams | `DELETE /api/teams/:id` (`admin.routes.ts:784`) |
| `teams.assign` | assign teams | `PUT /api/teams/:id/members` (`admin.routes.ts:826-901`, verified 2026-09-03); also asserted inline when `POST /api/users` carries a `teamId` (`admin.routes.ts:177`). Since the BUG-038 fix the route additionally authorizes **each affected member** with `assertCanManageRoleLevel` and rejects unknown or soft-deleted submitted ids with a **400** |

### requests — loans (7)

The `/api/loans` router is factory-generated from `operations.routes.ts:53-58`.

| Key | Seeded description | Consumed by |
|---|---|---|
| `requests.view` | view requests | `GET /api/loans`, `GET /api/loans/:id` (factory, `scoped-resource.ts:102,155`) |
| `requests.create` | create requests | `POST /api/loans` (factory, `scoped-resource.ts:170`) |
| `requests.edit` | edit requests | `PATCH /api/loans/:id` (factory, `scoped-resource.ts:205`) |
| `requests.delete` | delete requests | `DELETE /api/loans/:id` (factory, `scoped-resource.ts:252`) |
| `requests.approve` | approve requests | `POST /api/loans/:id/approve` (factory, `scoped-resource.ts:274`) |
| `requests.assign` | assign requests | **NOTHING — orphaned.** Granted to `team_leader` (`permissions.ts:279`) but no route reads it. |
| `requests.import` | import requests | **NOTHING — orphaned.** Only customer import exists. |

### verification (4)

| Key | Seeded description | Consumed by |
|---|---|---|
| `verification.view` | view verification | `GET /api/verifications`, `/:id` (`operations.routes.ts:189`) |
| `verification.create` | create verification | `POST /api/verifications` (`operations.routes.ts:190`); `POST /api/loans/:id/verification` (`operations.routes.ts:107`) |
| `verification.edit` | edit verification | `PATCH /api/verifications/:id` (`operations.routes.ts:191`) |
| `verification.approve` | approve verification | `POST /api/verifications/:id/approve` (`operations.routes.ts:192`) |

### bank_orders (4) · funding_sources (4) · service_providers (4)

| Key | Seeded description | Consumed by |
|---|---|---|
| `bank_orders.view` / `.create` / `.edit` / `.delete` | view / create / edit / delete bank orders | `/api/bank-orders` factory (`operations.routes.ts:219-222`) |
| `funding_sources.view` / `.create` / `.edit` / `.delete` | … funding sources | `/api/funding-sources` factory (`operations.routes.ts:409-412`) |
| `service_providers.view` | view service providers | `GET /api/service-providers` (`operations.routes.ts:450`) |
| `service_providers.create` | create service providers | `POST /api/service-providers` (`operations.routes.ts:463`) |
| `service_providers.edit` | edit service providers | `PATCH /api/service-providers/:id` (`operations.routes.ts:489`) |
| `service_providers.delete` | delete service providers | **NOTHING — orphaned.** The service-providers router is hand-written (`operations.routes.ts:437`) and never got a delete handler. |

### disbursements (4) · settlements (4) · transactions (3) · ledger (3)

| Key | Seeded description | Consumed by |
|---|---|---|
| `disbursements.view` / `.create` / `.edit` / `.approve` | … disbursements | `/api/disbursements` factory (`operations.routes.ts:252-255`) |
| `settlements.view` / `.create` / `.edit` / `.approve` | … settlements | `/api/settlements` factory (`operations.routes.ts:287-290`) |
| `transactions.view` / `.create` / `.edit` | … transactions | `/api/transactions` factory (`operations.routes.ts:325-327`). No `delete` or `approve` is configured, so those routes are not emitted (`scoped-resource.ts:251,271`). |
| `ledger.view` / `.create` / `.edit` | … ledger | `/api/ledger` factory (`operations.routes.ts:355-357`). Same — no delete, no approve. |

### documents (3)

| Key | Seeded description | Consumed by |
|---|---|---|
| `documents.view` | view documents | `GET /api/documents`, `/:id` (`operations.routes.ts:384`) |
| `documents.upload` | upload documents | `POST /api/documents` **and** `PATCH /api/documents/:id` — the factory's `create` and `edit` slots are both wired to this one key (`operations.routes.ts:385-386`) |
| `documents.delete` | delete documents | `DELETE /api/documents/:id` (`operations.routes.ts:387`) |

### reports (1) · audit_logs (1) · recycle_bin (3)

| Key | Seeded description | Consumed by |
|---|---|---|
| `reports.view` | view reports | `GET /api/dashboard/stats` (`operations.routes.ts:521`), `/loan-status` (`:580`), `/bank-performance` (`:599`). **No `/api/reports` route exists** — this key gates the dashboard only. |
| `audit_logs.view` | view audit logs | `GET /api/audit-logs` (`admin.routes.ts:902`) |
| `recycle_bin.view` | view recycle bin | `GET /api/recycle-bin` (`admin.routes.ts:809`) |
| `recycle_bin.restore` | restore recycle bin | `POST /api/recycle-bin/:id/restore` (`admin.routes.ts:843`) |
| `recycle_bin.permanent_delete` | *Irreversibly purge a record from the recycle bin* (override, `permissions.ts:149`) | `POST /api/recycle-bin/:id/permanent-delete` (`admin.routes.ts:871`) |

### settings (2)

| Key | Seeded description | Consumed by |
|---|---|---|
| `settings.view` | view settings | **NOTHING — orphaned.** Granted to `admin` (`permissions.ts:230`). There is no settings router; `/api/settings` does not exist, and the `app_settings` table is never read or written. |
| `settings.edit` | edit settings | **NOTHING — orphaned.** Granted to no default role. |

### system (2)

| Key | Seeded description | Consumed by |
|---|---|---|
| `system.access_all_banks` | *Bypass bank scoping and see records for every bank* (override, `permissions.ts:147`) | Not a route guard. Read once per request at `access.ts:64` to decide whether `bankIds` stays `null`. |
| `system.manage_any_user` | *Manage users at or above the actor's own role level* (override, `permissions.ts:148`) | Not a route guard. Bypass branch in `assertCanManageRoleLevel` (`access.ts:145`), `assertCanAssignRole` (`access.ts:155`), `assertCanGrantPermissions` (`access.ts:167`). |

### Orphan summary

Eight catalogue keys are consumed by **no** route, service or middleware anywhere in `src` (verified by grepping every `PERMISSIONS.*` reference and every quoted `resource.action` literal):

`customers.export` · `banks.assign` · `teams.edit` · `requests.assign` · `requests.import` · `service_providers.delete` · `settings.view` · `settings.edit`

`users.reset_password` was a ninth at HEAD and is wired only in the working tree.

Orphans are still seeded into the `permissions` table and are still grantable through `PUT /api/roles/:id/permissions` — granting one changes nothing. `purgeOrphanedPermissions()` (`seed.ts:134-139`) removes keys present in the DB but *absent from the catalogue*; it does not detect keys that are in the catalogue but unused by routes.

---

## 3. The five default roles

Declared as `DEFAULT_ROLES` in `src/lib/permissions.ts:190-313`.

| Key | Display name | Level | `isSystem` | Permissions held | Description (seeded) |
|---|---|---|---|---|---|
| `super_admin` | Super Admin | 0 | **true** | `"*"` → all **76** | Unrestricted access. Protected system role. |
| `admin` | Admin | 10 | false | **69** | Operational administration below Super Admin. |
| `manager` | Manager | 20 | false | **38** | Runs one or more teams across assigned banks. |
| `team_leader` | Team Leader | 30 | false | **21** | Leads a team of executives within assigned banks. |
| `executive` | Executive | 40 | false | **12** | Field executive. Sees only their assigned banks. |

Lower `level` means more authority. `roles.level` defaults to `100` for any role created later (`identity.ts:35`), i.e. below all five defaults.

### 3.1 Super Admin — the `"*"` is expanded by the seed, not by a code bypass

`RoleSeed.permissions` is typed `string[] | "*"` (`permissions.ts:187`). The seed resolves it:

```ts
const wantedKeys =
  roleSeed.permissions === "*" ? allPermissionRows.map((p) => p.key) : roleSeed.permissions;
```
— `src/db/seed.ts:59-60`, inserted as ordinary `role_permissions` rows at `seed.ts:66-73`.

**There is no wildcard at check time.** `assertPermission` is a plain `Set.has` (`access.ts:93-97`); `hasPermission` is `ctx.permissions.has(key)` (`access.ts:88`). No branch anywhere reads `roleKey === "super_admin"` or `roleIsSystem` to short-circuit a permission check.

**Consequence — the Super Admin is exactly as powerful as its `role_permissions` rows.** If those rows were deleted (`DELETE FROM role_permissions WHERE role_id = <super_admin>`), the Super Admin would hold **nothing**: every guarded route would 403, including `PUT /api/roles/:id/permissions`, which would leave no in-app path back. Nothing prevents that at the database level — the only trigger on the roles side is `roles_protect_system` (`drizzle/0001_governance_guards.sql:56-83`), which fires `BEFORE UPDATE OR DELETE ON roles` and blocks deleting a system role, re-keying it, or deactivating it. It does not touch `role_permissions`, and there are **zero** triggers on `role_permissions`.

Two things partially mitigate this:

- The API refuses to edit a system role's permissions: `if (role.isSystem) throw forbidden(...)` at `admin.routes.ts:626`. So the deletion has to come from raw SQL or a direct DB tool, not from the application.
- Re-running `npm run db:seed` repairs it. The top-up branch is `if (roleSeed.isSystem || !existing)` (`seed.ts:65`), so a system role is re-granted the full catalogue on every seed run, while non-system roles are only populated at first creation and are thereafter owned by the client.

Also note `seed.ts:40-43`: on re-run, an existing role has its `level` and `isSystem` overwritten from the seed, but **`name` is deliberately not overwritten** — a client rename survives redeploys.

### 3.2 Admin (level 10) — 69 of 76

Full groups (`permissions.ts:206-219`): `customers` (6), `banks` (5), `teams` (5), `requests` (7), `verification` (4), `bank_orders` (4), `funding_sources` (4), `service_providers` (4), `disbursements` (4), `settlements` (4), `transactions` (3), `ledger` (3), `documents` (3), `reports` (1).

Individually (`permissions.ts:220-231`): `users.view`, `users.create`, `users.edit`, `users.delete`, `users.assign`, `users.reset_password`, `roles.view`, `audit_logs.view`, `recycle_bin.view`, `recycle_bin.restore`, `settings.view`, `system.access_all_banks`.

**The 7 it does not hold:** `roles.create`, `roles.edit`, `roles.delete`, `roles.assign_permissions`, `recycle_bin.permanent_delete`, `settings.edit`, `system.manage_any_user`.

### 3.3 Manager (level 20) — 38

`customers` full (6) · `banks.view` · `users.view` · `teams.view` · `teams.assign` · `requests` full (7) · `verification` full (4) · `bank_orders` full (4) · `disbursements.view/create/edit` · `settlements.view` · `transactions.view/create` · `ledger.view` · `documents` full (3) · `reports.view` · `recycle_bin.view` · `recycle_bin.restore` — `permissions.ts:241-259`.

No `system.access_all_banks`; no `users.create/edit/delete/assign`; no `roles.*`; no `audit_logs.view`; no approve on disbursements or settlements.

### 3.4 Team Leader (level 30) — 21

`customers.view/create/edit/import` · `banks.view` · `users.view` · `teams.view` · `requests.view/create/edit/assign` · `verification.view/create` · `bank_orders.view/edit` · `disbursements.view` · `settlements.view` · `transactions.view` · `documents.view/upload` · `reports.view` — `permissions.ts:269-289`.

Note `requests.assign` is an orphan key (section 2), so that grant is inert.

### 3.5 Executive (level 40) — 12

`customers.view` · `customers.create` · `customers.edit` · `banks.view` · `requests.view` · `requests.create` · `verification.view` · `bank_orders.view` · `disbursements.view` · `transactions.view` · `documents.view` · `documents.upload` — `permissions.ts:299-310`.

No `reports.view`, no `settlements.view`, no `ledger.view`, no `recycle_bin.*`, no `users.*`, no `teams.*`. Corroborated by the untracked test at `src/tests/employee-lifecycle.test.ts:136-150`, which asserts the executive holds `customers.view` / `requests.create` / `documents.upload` and does **not** hold `users.view`, `users.create`, `roles.view`, `reports.view`, `settlements.view`, `ledger.view`, `recycle_bin.view`, `audit_logs.view`, `system.access_all_banks`, `system.manage_any_user`.

---

## 4. The role hierarchy rule

Quoted verbatim from `src/services/access.ts:133-159`:

```ts
/**
 * ROLE HIERARCHY
 *
 * Lower level == more authority. An actor may only operate on a subject whose
 * role level is strictly greater than their own. Consequences that fall out of
 * this one rule, with no role names in the code:
 *   - Admin (10) cannot create or edit another Admin (10)  -> not strictly >
 *   - Admin (10) cannot touch Super Admin (0)              -> not strictly >
 *   - Admin (10) can manage Manager (20) and below         -> strictly >
 *   - Super Admin (0) holds system.manage_any_user         -> bypasses
 */
export function assertCanManageRoleLevel(ctx: AuthContext, targetLevel: number): void {
  if (hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) return;
  if (targetLevel <= ctx.roleLevel) {
    throw forbidden("You cannot manage a user at or above your own role level");
  }
}

export function assertCanAssignRole(
  ctx: AuthContext,
  target: { key: string; level: number; isSystem: boolean },
): void {
  if (target.key === SUPER_ADMIN_ROLE_KEY && !hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) {
    throw forbidden("Only a Super Admin may assign the Super Admin role");
  }
  assertCanManageRoleLevel(ctx, target.level);
}
```

### 4.1 Who can act on whom

Read as: **row = actor**, **column = subject's role**. `YES` = allowed by `assertCanManageRoleLevel`; `NO` = 403 `"You cannot manage a user at or above your own role level"`.

| Actor \ Subject | Super Admin (0) | Admin (10) | Manager (20) | Team Leader (30) | Executive (40) | Custom role (default 100) |
|---|---|---|---|---|---|---|
| **Super Admin (0)** | YES¹ | YES¹ | YES¹ | YES¹ | YES¹ | YES¹ |
| **Admin (10)** | NO | NO | YES | YES | YES | YES |
| **Manager (20)** | NO | NO | NO | YES | YES | YES |
| **Team Leader (30)** | NO | NO | NO | NO | YES | YES |
| **Executive (40)** | NO | NO | NO | NO | NO | YES |

¹ Super Admin passes because it holds `system.manage_any_user`, which returns early at `access.ts:145` — **not** because level 0 is special-cased. Any custom role granted that permission gets the same bypass. Without it, even a level-0 actor would fail against a level-0 subject (`0 <= 0`).

Rows 3-5 are theoretical for user management: Manager, Team Leader and Executive hold no `users.create` / `users.edit` / `users.delete` / `users.assign`, so `requirePermission` rejects them before the hierarchy check runs.

**The Manager row became real on 2026-09-03.** A Manager *does* hold `teams.assign`, so `PUT /api/teams/:id/members` is the first route where a level-20 actor reaches a hierarchy check at all. Read across that row: a Manager may roster a Team Leader or an Executive, and may not roster — **or remove** — a peer Manager, an Admin or a Super Admin.

### 4.2 Where the rule is enforced

| Route | Guard | Hierarchy call |
|---|---|---|
| `POST /api/users` | `users.create` | `assertCanAssignRole(ctx, role)` — `admin.routes.ts:168` |
| `PATCH /api/users/:id` | `users.edit` | `assertCanManageRoleLevel(ctx, target.roleLevel)` (`:261`) plus `assertCanAssignRole(ctx, nextRole)` when the role changes (`:266`) |
| `POST /api/users/:id/reset-password` *(working tree)* | `users.reset_password` | `assertCanManageRoleLevel` — `admin.routes.ts:340` |
| `PUT /api/users/:id/banks` | `users.assign` | `assertCanManageRoleLevel` — `:394` |
| `DELETE /api/users/:id` | `users.delete` | `assertCanManageRoleLevel` — `:441` |
| `POST /api/roles` | `roles.create` | `assertCanManageRoleLevel(ctx, input.level)` — `:531` |
| `PATCH /api/roles/:id` | `roles.edit` | on the current level (`:584`) **and** on the proposed new level (`:585`) |
| `PUT /api/roles/:id/permissions` | `roles.assign_permissions` | `:628` |
| `DELETE /api/roles/:id` | `roles.delete` | `assertRoleMutable` (`:671`) then `assertCanManageRoleLevel` (`:672`) |
| `PUT /api/teams/:id/members` *(added 2026-09-03)* | `teams.assign` | `assertCanManageRoleLevel` per affected member, over the **union of the previous and submitted rosters** — `admin.routes.ts:879` (verified post-fix) |

> **This table is why BUG-038 was findable.** Until 2026-09-03 it listed nine routes and `PUT /api/teams/:id/members` was **absent** — every sibling assignment route appeared here and that one did not. The gap in the document was an accurate reflection of the gap in the code. See **[SEC-029](SECURITY_AUDIT.md#sec-029)** and **D-027**.
>
> The row above carries a **verified** line number. Every other citation in this table dates from the `7ef5da5` baseline in the header and has drifted.

Two further protections sit on top:

- **No self-escalation via role editing.** `assertCanGrantPermissions` (`access.ts:166-174`) rejects any key the actor does not personally hold, listing up to five offenders in the message. It is the reason an Admin with `roles.assign_permissions` could not mint a role holding `system.access_all_banks`. `system.manage_any_user` bypasses it (`access.ts:167`).
- **No self-deletion, no lockout.** `DELETE /api/users/:id` refuses `id === ctx.userId` (`admin.routes.ts:438`) and refuses to remove the last Active user holding a system role (`admin.routes.ts:444-451`).

---

## 5. Bank scoping

Bank scope is the second, orthogonal axis. Permissions decide *what kind of thing* you may do; bank scope decides *which rows* you may do it to.

### 5.1 `user_bank_access`

A join table (`user_id`, `bank_id`, `assigned_by`, `assigned_at`) written by `PUT /api/users/:id/banks` (`admin.routes.ts:406-417`, delete-then-insert inside a transaction) and by `POST /api/users` when `bankIds` is supplied (`admin.routes.ts:214-218`).

### 5.2 Resolution

```ts
let bankIds: string[] | null = null;
if (!granted.has(PERMISSIONS.system.accessAllBanks)) {
  const assignments = await db.select({ bankId: userBankAccess.bankId })
    .from(userBankAccess).where(eq(userBankAccess.userId, userId));
  bankIds = assignments.map((a) => a.bankId);
}
```
— `access.ts:63-70`. `bankIds === null` means **unrestricted**; `isUnscoped(ctx)` is exactly that test (`access.ts:99`).

### 5.3 `bankScope()` fails closed

```ts
export function bankScope(ctx: AuthContext, column: PgColumn): SQL | undefined {
  if (ctx.bankIds === null) return undefined;
  return inArray(column, ctx.bankIds.length > 0 ? ctx.bankIds : [NO_BANK_SENTINEL]);
}
const NO_BANK_SENTINEL = "00000000-0000-0000-0000-000000000000";
```
— `access.ts:108-114`.

A user with **zero** bank assignments does not get an unfiltered query; they get `bank_id IN ('00000000-…-000000000000')`, which matches nothing. The failure mode of a missing assignment is "sees nothing", never "sees everything". `scoped-resource.ts:94-100` is the single place every factory-generated read assembles its `WHERE`, so no resource can accidentally omit the filter.

### 5.4 `assertBankAccess()` — payload and path tampering

```ts
export function assertBankAccess(ctx: AuthContext, bankId: string | null | undefined): void {
  if (ctx.bankIds === null) return;
  if (!bankId) throw forbidden("A bank must be specified for this operation");
  if (!ctx.bankIds.includes(bankId)) throw forbidden("You do not have access to this resource");
}
```
— `access.ts:121-127`.

Call sites:

| Site | Attack it blocks |
|---|---|
| `scoped-resource.ts:111` | `?bankId=` list filter — a client filter can narrow scope, never widen it |
| `scoped-resource.ts:177` | hand-crafted `bankId` in a `POST` body |
| `scoped-resource.ts:222` | moving an existing record to a bank you cannot see, via `PATCH` |
| `banks.routes.ts:58,108,149` | direct `GET`/`PATCH`/`DELETE` on another tenant's bank by path id |
| `customers.routes.ts:105,174,236,303` | same, for customers and the reference-check route |
| `admin.routes.ts:171,396` | granting a colleague access to a bank you do not hold yourself |
| `admin.routes.ts:854,885` | restoring or purging a recycle-bin entry belonging to another bank |
| `imports.routes.ts:241,400` | an Excel row naming a bank outside your scope |

`assertBankAccessMany` (`access.ts:129-131`) loops the same check. `GET /:id` deliberately returns 404 rather than 403 for out-of-scope rows — "out of scope and non-existent are indistinguishable by design" (`scoped-resource.ts:162-163`).

`GET /api/users` applies scope differently: a bank-scoped caller only sees colleagues sharing at least one of their banks, via an `EXISTS` subquery, and a caller with zero banks gets `sql\`false\`` (`admin.routes.ts:100-108`).

### 5.5 Who is unscoped

`system.access_all_banks` is held by `super_admin` (via `"*"`) and by `admin` (`permissions.ts:231`). **Manager, Team Leader and Executive are always bank-scoped**, and see nothing until someone assigns them banks.

---

## 6. Per-role capability matrix

**YES** = backend permits it *and* a UI path exists that issues the request.
**BACKEND-ONLY** = the permission is held and the endpoint works, but no screen ever calls it (or the button is a no-op handler that only calls `refresh()` and shows a toast).
**NO** = the permission is not held; the request 403s.

| Capability | Endpoint(s) | Super Admin | Admin | Manager | Team Leader | Executive |
|---|---|---|---|---|---|---|
| View customers | `GET /api/customers` | YES | YES | YES | YES | YES |
| Create customer | `POST /api/customers` (`customers/page.tsx:314`) | YES | YES | YES | YES | YES |
| Edit customer | `PATCH /api/customers/:id` | BACKEND-ONLY¹ | BACKEND-ONLY¹ | BACKEND-ONLY¹ | BACKEND-ONLY¹ | BACKEND-ONLY¹ |
| Delete customer | `DELETE /api/customers/:id` (`customers/page.tsx:261`) | YES | YES | YES | NO | NO |
| Import customers (Excel) | `/api/imports/*` (`customer-import-dialog.tsx:70,87`) | YES | YES | YES | YES | NO |
| Export customers | — | NO² | NO² | NO² | NO² | NO² |
| View banks | `GET /api/banks` | YES | YES | YES | YES | YES |
| Create bank | `POST /api/banks` (`banks/page.tsx:69`) | YES | YES | NO | NO | NO |
| Change bank status | `PATCH /api/banks/:id` (`banks/page.tsx:97`) | YES | YES | NO | NO | NO |
| Delete bank | `DELETE /api/banks/:id` | BACKEND-ONLY | BACKEND-ONLY | NO | NO | NO |
| View loans | `GET /api/loans` | YES | YES | YES | YES | YES |
| Create loan | `POST /api/loans` (`loans/page.tsx:83`) | YES | YES | YES | YES | YES |
| Approve / change loan status | `POST /api/loans/:id/approve` | BACKEND-ONLY³ | BACKEND-ONLY³ | BACKEND-ONLY³ | NO | NO |
| View verifications | `GET /api/verifications` | BACKEND-ONLY⁴ | BACKEND-ONLY⁴ | BACKEND-ONLY⁴ | BACKEND-ONLY⁴ | BACKEND-ONLY⁴ |
| View bank orders | `GET /api/bank-orders` | YES | YES | YES | YES | YES |
| Move bank-order stage | `PATCH /api/bank-orders/:id` | BACKEND-ONLY³ | BACKEND-ONLY³ | BACKEND-ONLY³ | BACKEND-ONLY³ | NO |
| View disbursements | `GET /api/disbursements` | YES | YES | YES | YES | YES |
| Create disbursement | `POST /api/disbursements` (`disbursement/page.tsx:63`) | YES | YES | YES | NO | NO |
| Approve disbursement | `POST /api/disbursements/:id/approve` | BACKEND-ONLY³ | BACKEND-ONLY³ | NO | NO | NO |
| View settlements | `GET /api/settlements` | YES | YES | YES | YES | NO |
| Create / approve settlement | `POST /api/settlements`, `/:id/approve` | BACKEND-ONLY³ | BACKEND-ONLY³ | NO | NO | NO |
| View transactions | `GET /api/transactions` | YES | YES | YES | YES | YES |
| Create transaction | `POST /api/transactions` | BACKEND-ONLY | BACKEND-ONLY | BACKEND-ONLY | NO | NO |
| View ledger | `GET /api/ledger` | YES | YES | YES | NO | NO |
| Create ledger entry | `POST /api/ledger` (`ledger/page.tsx:63`) | YES | YES | NO | NO | NO |
| View documents | `GET /api/documents` | YES | YES | YES | YES | YES |
| Upload document (metadata) | `POST /api/documents` (`documents/page.tsx:81`) | YES | YES | YES | YES | YES |
| Delete document | `DELETE /api/documents/:id` | BACKEND-ONLY³ | BACKEND-ONLY³ | BACKEND-ONLY³ | NO | NO |
| View dashboard KPIs | `GET /api/dashboard/*` | YES | YES | YES | YES | **NO** |
| View employees | `GET /api/users` | YES | YES | NO | NO | NO |
| Create employee | `POST /api/users` (`employees/page.tsx:158`) | YES | YES | NO | NO | NO |
| Reset employee password | `POST /api/users/:id/reset-password` (`employees/page.tsx:199`) | YES⁵ | YES⁵ | NO | NO | NO |
| Enable / disable employee | `PATCH /api/users/:id` (`employees/page.tsx:222`) | YES⁶ | YES⁶ | NO | NO | NO |
| Assign banks to employee | `PUT /api/users/:id/banks` | BACKEND-ONLY⁷ | BACKEND-ONLY⁷ | NO | NO | NO |
| Delete employee | `DELETE /api/users/:id` | BACKEND-ONLY | BACKEND-ONLY | NO | NO | NO |
| List roles | `GET /api/roles` (`employees/page.tsx:94`) | YES | YES | NO | NO | NO |
| Create / edit / delete role | `POST`/`PATCH`/`DELETE /api/roles` | BACKEND-ONLY | NO | NO | NO | NO |
| Manage role permissions | `PUT /api/roles/:id/permissions` | BACKEND-ONLY⁸ | NO | NO | NO | NO |
| View teams | `GET /api/teams` (`use-reference.tsx:69`) | YES⁹ | YES⁹ | BACKEND-ONLY | BACKEND-ONLY | NO |
| Create / delete team | `POST`/`DELETE /api/teams` | BACKEND-ONLY | BACKEND-ONLY | NO | NO | NO |
| Assign team members | `PUT /api/teams/:id/members` | BACKEND-ONLY | BACKEND-ONLY | BACKEND-ONLY | NO | NO |
| View audit logs | `GET /api/audit-logs` | BACKEND-ONLY¹⁰ | BACKEND-ONLY¹⁰ | NO | NO | NO |
| View recycle bin | `GET /api/recycle-bin` | YES | YES | YES | NO | NO |
| Restore from recycle bin | `POST /api/recycle-bin/:id/restore` (`recycle-bin/page.tsx:50`) | YES | YES | YES | NO | NO |
| Permanently delete | `POST /api/recycle-bin/:id/permanent-delete` (`recycle-bin/page.tsx:69`) | YES | NO | NO | NO | NO |
| Funding sources (all ops) | `/api/funding-sources` | BACKEND-ONLY | BACKEND-ONLY | NO | NO | NO |
| Service providers (all ops) | `/api/service-providers` | BACKEND-ONLY | BACKEND-ONLY | NO | NO | NO |
| Bypass bank scoping | n/a (`system.access_all_banks`) | held | held | NO | NO | NO |
| Manage a peer or superior | n/a (`system.manage_any_user`) | held | NO | NO | NO | NO |
| Change own password | `POST /api/auth/change-password` | YES | YES | YES | YES | YES |
| View notifications | `GET /api/notifications` | YES¹¹ | YES¹¹ | YES¹¹ | YES¹¹ | YES¹¹ |

**Footnotes**

1. The "Save changes" button on `customers/[id]/page.tsx:458` issues no HTTP request — that whole file makes zero write calls. The `PATCH /api/customers/:id` endpoint is fully implemented and unreachable from the UI.
2. `customers.export` is granted to Super Admin, Admin and Manager but no endpoint consumes it. There is no export route to call.
3. No-op handler: calls `refresh()` and a toast, issues no request. `loans/page.tsx:68`, `bank-orders/page.tsx:58,64`, `disbursement/page.tsx:81,87`, `settlements/page.tsx:35,44`, `transactions/page.tsx:36`, `documents/page.tsx:104,109`.
4. No frontend file references `/verifications` at all.
5. Working tree only. At HEAD the route does not exist, so this capability is unavailable to everyone. The button is gated client-side by `can("users.reset_password")` (`employees/page.tsx:484`).
6. Working tree only — at HEAD the employees page issued `POST /users` and nothing else. Gated by `can("users.edit")` (`employees/page.tsx:491`).
7. `bankIds` are sent in the `POST /api/users` body at creation (`employees/page.tsx:169`); nothing ever calls `PUT /api/users/:id/banks`, so bank assignment cannot be changed after the fact from the UI.
8. Additionally blocked by `admin.routes.ts:626` for `is_system` roles — the Super Admin's own permission set is not editable through the API even by a Super Admin.
9. `GET /api/teams` is loaded unconditionally by `use-reference.tsx:69` for every signed-in user; it only surfaces in a UI as the team dropdown in the create-employee form, which only `users.create` holders can open.
10. `GET /api/audit-logs` has no caller anywhere in `frontend/src` (the word "audit" appears in the frontend only in `lib/types.ts`, `lib/demo/api.ts` and three page files, none of which hit the endpoint).
11. `/api/notifications` is guarded by `requireAuth` only, with no permission (`admin.routes.ts:948-955`). Note that **nothing in the backend ever inserts a notification row**, so the list is always empty against a real database.

---

## 7. Gotchas

### 7.1 An Executive's dashboard renders zeroes, not an error

The `executive` role does not hold `reports.view` (`permissions.ts:299-311`), and all three dashboard endpoints require it (`operations.routes.ts:521,580,599`). Every one returns 403 for an Executive.

The UI does not surface that. `useStats` swallows the rejection and sets `data` to `null` (`frontend/src/hooks/use-api.ts:159-161`), and its `num()` accessor coerces a missing key to `0` (`use-api.ts:170-173`). The dashboard therefore renders a complete, plausible-looking page of **zeroes** for an Executive. `useResource` is slightly better — it stores an error string (`use-api.ts:62-67`) — so the loan-status and bank-performance panels can show "Could not load this list", but the KPI tiles cannot.

The same silent-zero behaviour applies to any bank-scoped user with **no** bank assignments: they pass the permission check, `bankScope` returns the sentinel predicate, and every count comes back 0.

Related: the `/reports` page does **not** call any reports endpoint. It reads `/customers` and `/loans` (`reports/page.tsx:40,43`), so it works for an Executive even though `reports.view` is denied.

### 7.2 Bank-scoped roles cannot create head-office ledger or funding-source records

`ledger_entries.bank_id` and `funding_sources.bank_id` are **nullable** (`db/schema/operations.ts:336` and `:66`) and both create schemas make `bankId` optional (`operations.routes.ts:366`, `:419`). But the factory calls `assertBankAccess(ctx, parsed.bankId)` on every `POST` (`scoped-resource.ts:177`), and for a bank-scoped caller a missing `bankId` throws **403 "A bank must be specified for this operation"** (`access.ts:123`). A bank-less (head-office) ledger entry can therefore only be created by a holder of `system.access_all_banks`.

> **Correction to a commonly repeated claim.** It is often stated that "Manager / Team Leader / Executive get a 403 on `POST /api/ledger` because they lack `system.access_all_banks`". The permission check fires first and for a different reason: **none of those three roles holds `ledger.create`** (Manager holds `ledger.view` only, `permissions.ts:255`; Team Leader and Executive hold no ledger permission at all). They receive `403 "Missing required permission: ledger.create"` from `requirePermission`, never reaching the bank check. The `access_all_banks` argument only applies to a *custom* role that has been granted `ledger.create` without `system.access_all_banks`.

### 7.3 The sidebar has no permission gating whatsoever

`frontend/src/lib/nav.ts` defines `NavItem` as `{ label, href, icon, badge? }` — there is no permission field and no filter (`nav.ts:18-66`). `Sidebar` picks `demo ? demoNavSections : navSections` (`components/layout/sidebar.tsx:27`), so **every real signed-in user sees all 15 nav items**, including Dashboard, Settlements, Ledger, Employees, Reports and Recycle bin.

An Executive who clicks "Employees" gets a page that renders and then fails its `GET /api/users` with a 403. Same for Ledger, Settlements and Recycle bin. There is no `middleware.ts` and no route-level guard in the App Router — `AppShell` only redirects unauthenticated users to `/login` (`app-shell.tsx:20-22`), out-of-scope **demo** users to `/my-work` (`:28-32`), and — in the working tree — users flagged `mustChangePassword` to `/change-password` (`:39-44`). None of those consider permissions.

Only four call sites gate anything on `can()` in the entire frontend: `customers/page.tsx:638` (`customers.import`), `employees/page.tsx:338,484,491` (`users.create`, `users.reset_password`, `users.edit`), and `recycle-bin/page.tsx:133,146` (`recycle_bin.restore`, `recycle_bin.permanent_delete`).

### 7.4 `mustChangePassword` is enforced in React only

`users.must_change_password` is set on user creation (`admin.routes.ts:208`), on password reset (`admin.routes.ts:350`) and on the bootstrap Super Admin (`seed.ts:121`); it is returned on the profile (`auth.routes.ts:70`). **No middleware and no route asserts it.** A user on a temporary password holds a valid access token and can call every endpoint their role allows. The only enforcement is the client-side redirect at `app-shell.tsx:39-44`, which an API client simply never executes.

### 7.5 The Admin cannot edit roles, only assign them

`admin` holds `roles.view` but none of `roles.create` / `roles.edit` / `roles.delete` / `roles.assign_permissions` (`permissions.ts:226`). An Admin can put a user into an existing role that is strictly below level 10, and nothing else. Combined with the fact that no role-management screen exists (section 6), the practical route to changing a role's permissions is a direct API call as Super Admin — and even that is refused for the `super_admin` role itself (`admin.routes.ts:626`).

### 7.6 A role created through the API defaults to level 100

`roles.level` defaults to `100` (`identity.ts:35`). `POST /api/roles` takes `level` from the payload and validates it against the actor's own level (`admin.routes.ts:531`), so a Super Admin can create a role at any level, including `0` — which would produce a second role that outranks every Admin. `isSystem` is not settable through that route (verified: the seed is the only writer of `is_system: true`).

---

## 8. The demo persona

`frontend/src/lib/demo/config.ts` defines a fully client-side "Executive" walkthrough account. It exists so the workspace can be demonstrated with no backend and no database reachable (`config.ts:1-12`).

| Item | Value | Location |
|---|---|---|
| Email | `demo.employee@risenext.com` | `config.ts:14` |
| Password | `Demo@12345` | `config.ts:15` |
| Session store | `sessionStorage` key `risenext.demo.session` — deliberately not `localStorage`, so the demo dies with the tab | `config.ts:17-19`, `demo/session.ts:23-41` |
| Landing route | `/my-work` | `config.ts:22` |
| Identity | "Karthik Rao", role `{key: "executive", level: 40}` | `demo/api.ts:60-70` |
| Bank scope | two fabricated UUIDs, `unrestrictedBankAccess: false` | `config.ts:47-50`, `api.ts:68-69` |

### 8.1 `DEMO_PERMISSIONS` is a hardcoded mirror, not a source of truth

`config.ts:29-42` lists 12 keys as a literal array. They match the seeded `executive` role in `src/lib/permissions.ts:299-311` **exactly** — same 12 keys, no additions, no omissions — and the file says so itself: *"Kept as a literal because the demo must work with no backend reachable — it is a mirror, never a source of truth"* (`config.ts:24-28`).

```
customers.view · customers.create · customers.edit · banks.view
requests.view · requests.create · verification.view · bank_orders.view
disbursements.view · transactions.view · documents.view · documents.upload
```

**It grants nothing on the server.** The array is consumed in exactly three places, all in the browser:

| Consumer | Effect |
|---|---|
| `demo/api.ts:53-55` | a local `requirePermission()` that throws a fake `DemoHttpError(403, …)` so demo screens behave like the real API |
| `demo/nav.ts:94` | filters the demo sidebar, so administrative sections are *absent* rather than disabled |
| `demo/api.ts:67` | populates `DEMO_SESSION_USER.permissions`, which feeds `can()` in `use-auth.tsx:259-272` |

The demo credentials are compared entirely in the browser and never transmitted (`config.ts:81-83`, checked in `signIn` before any network call at `use-auth.tsx:174-185`). A request that did reach the server would carry no access token at all (`setAccessToken(null)`, `use-auth.tsx:177`).

### 8.2 Demo route confinement

`DEMO_ROUTES` (`config.ts:57-68`) whitelists ten paths; `isDemoRoute()` matches a path or any child of it (`config.ts:70-74`); `AppShell` bounces anything else back to `/my-work` and holds the loading state so an unreachable screen never renders even for a frame (`app-shell.tsx:28-32,46-57`). `demo/nav.ts` builds its own gated catalogue and leaves `lib/nav.ts` untouched (`demo/nav.ts:1-9`) — which is precisely why real users still see every nav item (section 7.3).

### 8.3 Known demo-mode defect

`disableDemoMode()` has exactly one call site: inside the demo branch of `signOut` (`use-auth.tsx:210-219`). The real branch of `signIn` (`use-auth.tsx:187-201`) never clears the flag. A user who enters the demo, then signs in with real credentials **without signing out first**, leaves `risenext.demo.session` set in `sessionStorage` — so `isDemoMode()` stays true, `persistAuthUser` silently refuses to cache the real profile (`use-auth.tsx:68`), the sidebar keeps showing the demo navigation (`sidebar.tsx:27`), and `AppShell` keeps redirecting non-demo routes to `/my-work` (`app-shell.tsx:28`). `DEMO_SESSION_USER` also carries no `mustChangePassword` field, which is what keeps the demo and the forced-password-change guard from interacting (`app-shell.tsx:34-38`).

---

## Appendix — verification notes

- Permission count (76) obtained by counting literal `key: "resource.action"` declarations between `permissions.ts:11` and `:134`.
- Per-role counts derived by expanding `flat()` (`permissions.ts:167`) over each seed entry; Admin = 76 − 7 excluded keys = 69.
- Orphan list produced by grepping every `PERMISSIONS.<group>.<member>` reference and every quoted `"<resource>.<action>"` literal across `src`, then subtracting hits that occur only inside `lib/permissions.ts` (declarations and role seeds) or `src/tests`.
- UI existence determined by enumerating every `api.*` / `apiRequest` / `useResource` / `useStats` call in `frontend/src` and matching it to the guarding permission on the corresponding route.
- **UNVERIFIED:** none of the above was executed. No server was started, no migration run, no test suite invoked; every statement is read from source. Runtime behaviour of the seed against a live Neon database (in particular the `onConflictDoUpdate` on `permissions.key`, `seed.ts:25-28`) is inferred from the code, not observed.
