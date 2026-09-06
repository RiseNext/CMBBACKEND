# Data Model Reference

Authoritative reference for the PostgreSQL schema of the Risenext Banking / Lending Operations CRM.

**Provenance.** Every statement below is traceable to a file and line in this repository. Claims that could not be verified from code are marked `UNVERIFIED`. Nothing here is aspirational: where a column, table or guard is unused, this document says so.

**Baseline commit:** `7ef5da5` ("Add frontend-only employee demo"). The working tree is dirty (8 modified, 4 untracked files). **None of the uncommitted changes touch the schema or the migrations** — `src/db/schema/*.ts` and `drizzle/*.sql` are identical at HEAD and in the working tree. The only data-model-adjacent working-tree deltas are in route code (`src/modules/admin.routes.ts`, `src/modules/auth.routes.ts`) and are noted inline in the write-activity map.

**Sources read in full for this document:**

| File | Role |
| --- | --- |
| `src/db/schema/index.ts` | Barrel re-export of the four schema files |
| `src/db/schema/identity.ts` | 7 tables — roles, permissions, users, teams |
| `src/db/schema/domain.ts` | 3 tables — banks, bank access, customers |
| `src/db/schema/governance.ts` | 5 tables — audit, recycle bin, settings, imports |
| `src/db/schema/operations.ts` | 12 tables — the lending workflow |
| `drizzle/0000_init.sql` | 15 tables, 20 FKs, 45 indexes |
| `drizzle/0001_governance_guards.sql` | 3 functions, 7 triggers, 0 tables |
| `drizzle/0002_operations.sql` | 12 tables, 42 FKs, 49 indexes |
| `src/db/seed.ts` | The only seed path |
| `src/db/migrate.ts` | Migration runner |

---

## 1. At a glance

| Metric | Value | Verified by |
| --- | --- | --- |
| Tables | **27** | 27 `CREATE TABLE` across `drizzle/*.sql`; 27 `pgTable(` across `src/db/schema/*.ts` |
| Schema drift (SQL vs. TS) | **zero** | Counts match; column-by-column comparison performed for all 27 tables |
| Migrations | **3** | `drizzle/meta/_journal.json` entries idx 0, 1, 2 |
| Foreign keys | **62** (20 + 0 + 42) | `grep -c "ADD CONSTRAINT"` per migration |
| Triggers | **7** | `0001_governance_guards.sql`, all 7 `CREATE TRIGGER` |
| Trigger functions | **3** | `audit_logs_immutable`, `touch_updated_at`, `protect_system_roles` |
| `CHECK` constraints | **1** | `loans_status_check` (`0007_loan_status_check.sql`, Task 5.2). Was **0** until 2026-09-05. Covers the vocabulary of `loans.status` and no other column |
| Postgres `ENUM` types | **0** | No `CREATE TYPE` in any migration; every status column is `text` |
| Unique indexes | **19** | See §6 |
| Partial unique indexes (`WHERE deleted_at is null`) | **13** | See §6 |
| Tables carrying the full 7-column lifecycle block | **15** | See §3.1 |
| Permission rows the seed inserts | **76** | `src/lib/permissions.ts:11-134`, counted |
| Default roles the seed inserts | **5** | `src/lib/permissions.ts:190-313` |
| Business rows the seed inserts | **0** | `src/db/seed.ts` inserts only into `permissions`, `roles`, `role_permissions`, `users` |

Table distribution by schema file:

| File | Count | Tables |
| --- | --- | --- |
| `identity.ts` | 7 | `roles`, `permissions`, `role_permissions`, `users`, `refresh_tokens`, `teams`, `team_members` |
| `domain.ts` | 3 | `banks`, `user_bank_access`, `customers` |
| `governance.ts` | 5 | `audit_logs`, `recycle_bin_entries`, `app_settings`, `import_batches`, `import_rows` |
| `operations.ts` | 12 | `service_providers`, `funding_sources`, `loans`, `verifications`, `bank_orders`, `disbursements`, `settlements`, `transactions`, `ledger_entries`, `documents`, `notifications`, `assignment_history` |

Migration `0000_init.sql` creates the 15 identity + domain + governance tables; `0002_operations.sql` creates the 12 operations tables. `0001_governance_guards.sql` creates no tables — only functions and triggers.

---

## 2. Entity-relationship diagram

Notation: `──>` is a foreign key pointing at the referenced table. `[C]` = `ON DELETE CASCADE`, `[R]` = `ON DELETE RESTRICT`, `[N]` = `ON DELETE SET NULL`. `(PK)` marks composite-PK join tables. No FK in this schema uses anything other than `ON UPDATE no action`.

```
                        ┌───────────────────┐
                        │   permissions     │  76 seeded rows, catalogue only
                        └─────────▲─────────┘
                                  │[C]
                     ┌────────────┴────────────┐
                     │    role_permissions     │ (PK: role_id, permission_id)
                     └────────────┬────────────┘
                                  │[C]
                        ┌─────────▼─────────┐
              ┌────────>│      roles        │  level 0..1000, is_system flag
              │   [R]   └───────────────────┘  ▲ triggers: touch_updated_at,
              │                                │            protect_system_roles
              │
   ┌──────────┴────────────────────────────────────────────────────────────┐
   │                              users                                    │  ▲ trigger: touch_updated_at
   └───▲────▲────▲──────▲────────▲──────────▲──────────▲────────▲────▲─────┘
       │[C] │[C] │[N]   │[N]     │[N]       │[N]       │[N]     │[N] │[N]
       │    │    │      │        │          │          │        │    │
       │    │    │      │        │          │          │        │    └── app_settings.updated_by
       │    │    │      │        │          │          │        └─────── audit_logs.actor_id
       │    │    │      │        │          │          └──────────────── import_batches.created_by / confirmed_by
       │    │    │      │        │          └─────────────────────────── recycle_bin_entries.deleted_by / restored_by / purged_by
       │    │    │      │        └────────────────────────────────────── teams.leader_id
       │    │    │      └─────────────────────────────────────────────── customers.assigned_user_id
       │    │    └────────────────────────────────────────────────────── notifications.user_id [C]
       │    └─────────────────────────────────────────────────────────── team_members.user_id [C]
       └──────────────────────────────────────────────────────────────── refresh_tokens.user_id [C]
                                                                          user_bank_access.user_id [C]

   ┌──────────────────┐            ┌───────────────────────┐
   │      teams       │◄───[C]─────│  team_members  (PK)   │
   └──────────────────┘            └───────────────────────┘
      ▲ trigger: touch_updated_at

   ┌──────────────────┐            ┌───────────────────────┐
   │      banks       │◄───[C]─────│ user_bank_access (PK) │  ← the tenant-isolation spine
   └────────┬─────────┘            └───────────────────────┘
      ▲ trigger: touch_updated_at
      │
      │ referenced by (bank_id) from:
      │   customers[R]  loans[R]  verifications[R]  bank_orders[R]
      │   disbursements[R]  settlements[R]  transactions[R]  documents[R]
      │   funding_sources[N]  ledger_entries[N]
      │   audit_logs.bank_id (NO FK)  recycle_bin_entries.bank_id (NO FK)
      │   import_batches.bank_id (NO FK)  assignment_history.bank_id (NO FK)
      │
   ┌──▼───────────────┐
   │    customers     │  ▲ trigger: touch_updated_at
   └──┬───────────────┘  unique (bank_id, upper(bank_reference_id)) WHERE deleted_at is null
      │
      │[R] customer_id
      ├──────────────> loans ──[C]──> verifications ──[N]──> service_providers
      │                  │
      │                  ├──[R]──> bank_orders
      │                  ├──[R]──> disbursements ──[N]──> funding_sources
      │                  ├──[R]──> transactions  ──[N]──> disbursements
      │                  │                       ──[N]──> settlements
      │                  │                       ──[N]──> funding_sources
      │                  └──[C]──> documents
      │
      └──[C]──────────> documents.customer_id
      └──[R]──────────> bank_orders.customer_id, disbursements.customer_id,
                        transactions.customer_id
      └──[N]──────────> verifications.customer_id

   ┌──────────────────┐        ┌────────────────────┐
   │   transactions   │◄──[N]──│   ledger_entries   │
   └──────────────────┘        └────────────────────┘

   ┌──────────────────┐        ┌────────────────────┐
   │  import_batches  │◄──[C]──│    import_rows     │
   └──────────────────┘        └────────────────────┘

   ┌──────────────────┐   append-only, BEFORE UPDATE OR DELETE trigger raises
   │    audit_logs    │   the ONLY table with a bigserial PK
   └──────────────────┘

   ┌──────────────────────┐  cross-type index over soft-deleted rows;
   │ recycle_bin_entries  │  record_id is a bare uuid with NO foreign key
   └──────────────────────┘

   ISOLATED (no inbound or outbound FK to the rest of the graph):
   ┌──────────────────┐  ┌──────────────────────┐
   │   app_settings   │  │  assignment_history  │  (FKs to users/teams only;
   └──────────────────┘  └──────────────────────┘   record_id has no FK)
```

### 2.1 Referential facts worth stating explicitly

| Fact | Evidence |
| --- | --- |
| `recycle_bin_entries.record_id` is `uuid NOT NULL` with **no** FK — it is a polymorphic pointer resolved in application code through `BIN_REGISTRY` | `0000_init.sql:231`; `services/recycle-bin.ts:28-89` |
| `audit_logs.record_id` is `text`, not `uuid`, and has no FK — deliberate, so a purged record's id survives | `0000_init.sql:187` |
| `audit_logs.bank_id`, `recycle_bin_entries.bank_id`, `import_batches.bank_id`, `assignment_history.bank_id`, `assignment_history.record_id` are `uuid` columns with **no** FK to `banks` | `0000_init.sql:188,232,202`; `0002_operations.sql:5,4` |
| `roles.created_by`, `users.created_by`, `banks.updated_by`, and every other `created_by`/`updated_by`/`deleted_by` on the 15 lifecycle tables are **plain `uuid` with no FK to `users`** | e.g. `identity.ts:40-43`, `operations.ts:21-24`; no matching `ADD CONSTRAINT` in either migration |
| `users.role_id` is `ON DELETE restrict` — a role holding users cannot be dropped by the database, and `admin.routes.ts:674-680` also blocks it at the API | `0000_init.sql:250`; `identity.ts:108-110` |
| `verifications.loan_id` is `ON DELETE cascade` but `bank_orders.loan_id` / `disbursements.loan_id` / `transactions.loan_id` are `restrict` | `0002_operations.sql:301, 269, 272, 297` |

---

## 3. Conventions

### 3.1 The lifecycle block

`operations.ts:18-26` defines a spread object:

```ts
const lifecycle = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by"),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
};
```

The spread is used by the **10** soft-deletable operations tables. The **5** identity/domain tables that carry the same 7 columns declare them **literally, not via the spread** — the constant lives in `operations.ts` and is not exported, so `identity.ts` and `domain.ts` cannot reach it. The columns are byte-identical; the duplication is a maintenance hazard, not a behavioural difference.

| Has the full 7-column block (15 tables) | Declared via | Reference |
| --- | --- | --- |
| `roles`, `users`, `teams` | literal | `identity.ts:38-44, 120-126, 179-185` |
| `banks`, `customers` | literal | `domain.ts:36-42, 123-129` |
| `service_providers`, `funding_sources`, `loans`, `verifications`, `bank_orders`, `disbursements`, `settlements`, `transactions`, `ledger_entries`, `documents` | `...lifecycle` | `operations.ts:45, 70, 126, 173, 204, 244, 279, 314, 346, 377` |

| Lacks the block (12 tables) | What it has instead |
| --- | --- |
| `permissions` | `created_at` only (`identity.ts:65`) |
| `role_permissions` | `granted_at`, `granted_by` (`identity.ts:82-83`) |
| `refresh_tokens` | `created_at`, `revoked_at`, `expires_at` (`identity.ts:154-159`) |
| `team_members` | `joined_at`, `assigned_by` (`identity.ts:205-206`) |
| `user_bank_access` | `assigned_at`, `assigned_by` (`domain.ts:69-70`) |
| `audit_logs` | `occurred_at` only — immutable by trigger (`governance.ts:27`) |
| `recycle_bin_entries` | its own `deleted_at`/`deleted_by`/`purge_after` + `restored_*`/`purged_*`, no `created_at`/`updated_at` (`governance.ts:72-79`) |
| `app_settings` | `updated_at`, `updated_by` (`governance.ts:101-102`) |
| `import_batches` | `created_at`/`created_by`, `confirmed_at`/`confirmed_by`, `expires_at` (`governance.ts:132-136`) |
| `import_rows` | none (`governance.ts:145-163`) |
| `notifications` | `created_at`, `read_at` (`governance.ts` n/a — `operations.ts:397-398`) |
| `assignment_history` | `assigned_at`, `assigned_by` (`operations.ts:419-420`) |

**Asymmetry to know about:** the `touch_updated_at` trigger is attached to only **5** of the 15 lifecycle tables — `banks`, `customers`, `users`, `roles`, `teams` (`0001_governance_guards.sql:29-52`). The 10 operations tables have **no** trigger; their `updated_at` is honest only because `scoped-resource.ts:230` and the hand-written handlers explicitly pass `updatedAt: new Date()`. A direct `UPDATE` in psql against `loans` will leave `updated_at` stale; the same statement against `customers` will not.

### 3.2 The `money()` helper

`operations.ts:28`:

```ts
const money = (name: string) => numeric(name, { precision: 16, scale: 2 });
```

Applied to: `loans.amount_requested`, `loans.amount_approved`, `loans.emi`, `loans.processing_fee`, `loans.commission`, `disbursements.amount`, `settlements.gross_commission`, `settlements.tds`, `settlements.net_payable`, `transactions.amount`, `transactions.commission`, `ledger_entries.debit`, `ledger_entries.credit`, `ledger_entries.balance`. All are `NOT NULL DEFAULT '0'`.

Numeric columns **not** produced by `money()`:

| Column | Type | Reference |
| --- | --- | --- |
| `banks.commission_rate` | `numeric(6,3) NOT NULL DEFAULT '0'` | `domain.ts:30` |
| `customers.monthly_income` | `numeric(14,2) NOT NULL DEFAULT '0'` | `domain.ts:104` |
| `loans.interest_rate` | `numeric(6,3) NOT NULL DEFAULT '0'` | `operations.ts:102` |

Drizzle maps `numeric` to a **JavaScript string**, not a number. Every write path therefore stringifies: `scoped-resource.ts:54-64` (`stringifyNumerics`, driven by the per-resource `numericFields` list), `customers.routes.ts:189`, `banks.routes.ts:84`, `imports.routes.ts:416`. Reads return strings to the client verbatim; there is no serialisation layer that converts them back to numbers.

There is **no `CHECK (amount >= 0)`** anywhere. Non-negativity is enforced only by Zod at the API boundary (`operations.routes.ts:25`, `money = z.coerce.number().min(0).max(1_000_000_000_000)`), which means a direct SQL write or any future code path bypassing the router can store negative money.

### 3.3 Soft-delete semantics

A soft delete sets three columns on the row and leaves it in place:

```
deleted_at  = now
deleted_by  = actor user id
purge_after = now + RECYCLE_BIN_RETENTION_DAYS   (default 30, config/env.ts:23)
```

`services/recycle-bin.ts:127-130` performs the update; `services/recycle-bin.ts:95-98` computes `purge_after`.

Every read path filters `isNull(deletedAt)`. The single choke point for the 9 factory-generated resources is `scoped-resource.ts:94-100`; hand-written equivalents are `customers.routes.ts:97`, `banks.routes.ts:36`, `admin.routes.ts:482, 703`.

**Partial unique indexes make soft deletion release the identifier.** `users_email_unique`, `users_employee_code_unique`, `teams_name_unique`, `banks_code_unique`, `customers_code_unique`, `customers_bank_reference_unique`, `loans_code_unique`, `verifications_loan_unique`, `bank_orders_code_unique`, `disbursements_code_unique`, `disbursements_utr_unique`, `settlements_code_unique`, `settlements_bank_period_unique`, `funding_sources_name_unique`, `service_providers_name_unique` all carry `WHERE deleted_at is null`. A soft-deleted customer frees its `code` and its `(bank_id, bank_reference_id)` pair immediately.

**Two exceptions.** `transactions_code_unique` (`operations.ts:317`, `0002_operations.sql:345`) and `ledger_entries_code_unique` (`operations.ts:349`, `0002_operations.sql:325`) have **no** `WHERE` clause. Soft-deleting a transaction or ledger entry does not free its code, and — because code generation is `count(*)`-based (§11.2) — a later insert can collide with the retired code and fail outright.

### 3.4 The recycle-bin snapshot pattern

`softDelete` (`recycle-bin.ts:105-151`) runs in one transaction and does four things:

1. `SELECT` the live row (`:116-120`).
2. `UPDATE` it with `deleted_at` / `deleted_by` / `purge_after` (`:127-130`).
3. `INSERT` a `recycle_bin_entries` row whose `snapshot` jsonb column holds **the entire pre-delete row** (`:132-141`).
4. Write an audit row through the same transaction handle (`:143-149`).

`restore` (`:153-195`) nulls `deleted_at`/`deleted_by`/`purge_after` on the original table and stamps `restored_at`/`restored_by` on the bin entry. It does **not** read the snapshot — restoration relies on the row still being present, so the snapshot is documentation, not a recovery mechanism.

`permanentDelete` (`:203-237`) hard-`DELETE`s the row and stamps `purged_at`/`purged_by`, **retaining the bin entry and its snapshot**. This is the only place in the codebase where a business row is physically removed, apart from the join-table `DELETE`s that precede re-insertion (`admin.routes.ts:412, 640, 764`) and the hard `DELETE` of a role (`admin.routes.ts:682`).

The snapshot is deliberately withheld from the list API — `admin.routes.ts:829` strips it (`snapshot: undefined`) because it may contain PII.

**The registry does not match the schema.** `BIN_REGISTRY` (`recycle-bin.ts:28-89`) declares 12 record types, but only 6 of them have a reachable `DELETE` route:

| Bin record type | Delete route exists? | Where |
| --- | --- | --- |
| `customer` | yes | `customers.routes.ts:266` |
| `bank` | yes | `banks.routes.ts:145` |
| `loan` | yes | factory, `permissions.delete` set at `operations.routes.ts:57` |
| `bank_order` | yes | factory, `operations.routes.ts:222` |
| `document` | yes | factory, `operations.routes.ts:387` |
| `funding_source` | yes | factory, `operations.routes.ts:412` |
| `verification` | **no** | no `delete` key in config, `operations.routes.ts:188-193` |
| `disbursement` | **no** | `operations.routes.ts:251-256` |
| `settlement` | **no** | `operations.routes.ts:286-291` |
| `transaction` | **no** | `operations.routes.ts:324-328` |
| `ledger_entry` | **no** | `operations.routes.ts:354-358` |
| `service_provider` | **no** | hand-written router has GET/POST/PATCH only, `operations.routes.ts:437-511` |

Conversely, `users`, `teams` and `roles` carry the full lifecycle block but are **absent from `BIN_REGISTRY`**. Their deletes bypass the bin entirely:

- `admin.routes.ts:453-456` — user delete sets `deleted_at`, `deleted_by`, `status: "Inactive"` directly. No `recycle_bin_entries` row, therefore **not restorable through any API**.
- `admin.routes.ts:788-791` — team delete sets `deleted_at`/`deleted_by` directly. Same consequence.
- `admin.routes.ts:682` — role delete is a **hard** `DELETE`, despite `roles` having `deleted_at`.

**Retention is never enforced.** `expiredEntries()` (`recycle-bin.ts:240-251`) selects rows past `purge_after`, and it has **zero callers** anywhere in the repository. There is no cron, no scheduled job, no worker. `purge_after` is written and then ignored.

---

## 4. Table reference — identity (`src/db/schema/identity.ts`)

### 4.1 `roles`

Authorisation subject. Roles are data, not code: `user -> role -> role_permissions -> permission.key` (`identity.ts:14-27`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK `DEFAULT gen_random_uuid()` | `identity.ts:31` |
| `key` | `text NOT NULL` | stable machine id, never shown to users |
| `name` | `text NOT NULL` | renameable display label |
| `description` | `text` | |
| `level` | `integer NOT NULL DEFAULT 100` | **lower == more authority**; super_admin = 0 |
| `is_system` | `boolean NOT NULL DEFAULT false` | protects the super-admin role |
| `is_active` | `boolean NOT NULL DEFAULT true` | checked at login, `auth.routes.ts:132` |
| lifecycle block | 7 columns | `identity.ts:38-44` |

- **PK:** `id`
- **FKs out:** none
- **FKs in:** `role_permissions.role_id` `[C]`, `users.role_id` `[R]`
- **Unique:** `roles_key_unique` on `(key)` — **not partial**, so a soft-deleted role permanently occupies its key
- **Other indexes:** `roles_level_idx (level)`, `roles_deleted_at_idx (deleted_at)`
- **Triggers:** `roles_touch_updated_at`, `roles_protect_system`

### 4.2 `permissions`

Seeded catalogue of capability strings, `resource.action` (`identity.ts:53-55`).

| Column | Type |
| --- | --- |
| `id` | `uuid` PK `DEFAULT gen_random_uuid()` |
| `key` | `text NOT NULL` (e.g. `customers.create`) |
| `resource` | `text NOT NULL` |
| `action` | `text NOT NULL` |
| `description` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

- **PK:** `id` · **FKs out:** none · **FKs in:** `role_permissions.permission_id` `[C]`
- **Unique:** `permissions_key_unique (key)` · **Index:** `permissions_resource_idx (resource)`
- **Lifecycle block:** no

### 4.3 `role_permissions`

| Column | Type |
| --- | --- |
| `role_id` | `uuid NOT NULL` → `roles.id` `[C]` |
| `permission_id` | `uuid NOT NULL` → `permissions.id` `[C]` |
| `granted_at` | `timestamptz NOT NULL DEFAULT now()` |
| `granted_by` | `uuid` (no FK) |

- **PK:** composite `(role_id, permission_id)` — `identity.ts:86`, `0000_init.sql:27`
- **Index:** `role_permissions_permission_idx (permission_id)`
- **Lifecycle block:** no

### 4.4 `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `employee_code` | `text NOT NULL` | e.g. `EMP-0001` |
| `name`, `email` | `text NOT NULL` | email compared lowercased (`auth.routes.ts:85`) |
| `phone` | `text` | |
| `password_hash` | `text NOT NULL` | argon2id, `lib/password.ts:8-17` |
| `password_changed_at` | `timestamptz` | |
| `must_change_password` | `boolean NOT NULL DEFAULT false` | see §9 note |
| `role_id` | `uuid NOT NULL` → `roles.id` `[R]` | |
| `branch` | `text` | |
| `status` | `text NOT NULL DEFAULT 'Active'` | free text; `auth.routes.ts:131` requires exactly `"Active"` |
| `joined_on` | `timestamptz` | |
| `target`, `achieved` | `integer NOT NULL DEFAULT 0` | carried over from the frontend Employee model |
| `avatar_color` | `text` | |
| `failed_login_attempts` | `integer NOT NULL DEFAULT 0` | |
| `locked_until` | `timestamptz` | lockout at 8 attempts / 15 min, `auth.routes.ts:28-29` |
| `last_login_at` | `timestamptz` | |
| lifecycle block | 7 columns | |

- **PK:** `id`
- **FKs out:** `role_id → roles.id [R]`
- **FKs in:** `refresh_tokens.user_id [C]`, `team_members.user_id [C]`, `user_bank_access.user_id [C]`, `notifications.user_id [C]`, plus 17 `[N]` references (`teams.leader_id`, `customers.assigned_user_id`, `loans.assigned_user_id`/`approved_by`, `verifications.approved_by`, `disbursements.assigned_user_id`/`approved_by`, `settlements.approved_by`, `documents.uploaded_by`/`verified_by`, `assignment_history.from_user_id`/`to_user_id`/`assigned_by`, `audit_logs.actor_id`, `app_settings.updated_by`, `import_batches.created_by`/`confirmed_by`, `recycle_bin_entries.deleted_by`/`restored_by`/`purged_by`)
- **Unique (both partial and one functional):**
  - `users_email_unique` on `lower(email)` `WHERE deleted_at is null` — `identity.ts:130-132`, `0000_init.sql:277`
  - `users_employee_code_unique` on `(employee_code)` `WHERE deleted_at is null` — `0000_init.sql:278`
- **Other indexes:** `users_role_idx`, `users_status_idx`, `users_deleted_at_idx`
- **Trigger:** `users_touch_updated_at`

### 4.5 `refresh_tokens`

Server-side session records so logout genuinely revokes (`identity.ts:142-145`). Only the SHA-256 hash of the token is stored (`auth.routes.ts:41`, `lib/password.ts:31-33`).

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `user_id` | `uuid NOT NULL` → `users.id` `[C]` |
| `token_hash` | `text NOT NULL` |
| `expires_at` | `timestamptz NOT NULL` |
| `revoked_at` | `timestamptz` |
| `replaced_by_token_hash` | `text` — **DEAD, never written** (§9) |
| `user_agent`, `ip_address` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

- **Unique:** `refresh_tokens_hash_unique (token_hash)` — not partial
- **Indexes:** `refresh_tokens_user_idx`, `refresh_tokens_expires_idx`
- **Lifecycle block:** no. Expired rows are never deleted by anything.

### 4.6 `teams`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `name` | `text NOT NULL` |
| `description` | `text` |
| `leader_id` | `uuid` → `users.id` `[N]` |
| `status` | `text NOT NULL DEFAULT 'Active'` |
| lifecycle block | 7 columns |

- **Unique:** `teams_name_unique` on `lower(name)` `WHERE deleted_at is null` — functional + partial
- **Indexes:** `teams_leader_idx`, `teams_deleted_at_idx`
- **Trigger:** `teams_touch_updated_at`
- **Note:** there is no `PATCH /api/teams/:id` route, so `name`, `description`, `leader_id` and `status` can only ever be set at creation (`admin.routes.ts:734`).

### 4.7 `team_members`

| Column | Type |
| --- | --- |
| `team_id` | `uuid NOT NULL` → `teams.id` `[C]` |
| `user_id` | `uuid NOT NULL` → `users.id` `[C]` |
| `joined_at` | `timestamptz NOT NULL DEFAULT now()` |
| `assigned_by` | `uuid` (no FK) |

- **PK:** composite `(team_id, user_id)` · **Index:** `team_members_user_idx (user_id)` · **Lifecycle block:** no

---

## 5. Table reference — domain (`src/db/schema/domain.ts`)

### 5.1 `banks`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `code` | `text NOT NULL` | human key, e.g. `BNK-01` |
| `name`, `short_name` | `text NOT NULL` | |
| `vendor_id`, `portal_url`, `logo_text`, `accent_color` | `text` | |
| `status` | `text NOT NULL DEFAULT 'Active'` | vocabulary `Active` / `Paused` (`domain.ts:172`) |
| `commission_rate` | `numeric(6,3) NOT NULL DEFAULT '0'` | |
| `settlement_cycle`, `spoc_name`, `spoc_phone` | `text` | |
| `products_offered` | `text[] NOT NULL DEFAULT '{}'::text[]` | the only array column in the schema |
| `onboarded_on` | `timestamptz` | |
| lifecycle block | 7 columns | |

- **Unique:** `banks_code_unique (code) WHERE deleted_at is null`
- **Indexes:** `banks_status_idx`, `banks_deleted_at_idx`
- **Trigger:** `banks_touch_updated_at`
- **FKs in:** 10 (see §2)

### 5.2 `user_bank_access`

The spine of tenant isolation (`domain.ts:52-59`). Every scoped query filters against the bank ids resolved from this table; `system.access_all_banks` bypasses it.

| Column | Type |
| --- | --- |
| `user_id` | `uuid NOT NULL` → `users.id` `[C]` |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[C]` |
| `assigned_at` | `timestamptz NOT NULL DEFAULT now()` |
| `assigned_by` | `uuid` (no FK) |

- **PK:** composite `(user_id, bank_id)` · **Index:** `user_bank_access_bank_idx (bank_id)` · **Lifecycle block:** no

### 5.3 `customers`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `code` | `text NOT NULL` | `CUS-1000n`, generated (§11.2) |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[R]` | |
| `bank_reference_id` | `text NOT NULL` | required addition over the frontend model |
| `name` | `text NOT NULL` | |
| `father_name`, `mother_name` | `text` | |
| `dob` | `timestamptz` | a date stored as a timestamp |
| `gender`, `marital_status`, `occupation` | `text` | |
| `monthly_income` | `numeric(14,2) NOT NULL DEFAULT '0'` | |
| `mobile` | `text NOT NULL` | |
| `alt_mobile`, `email`, `address`, `city`, `state`, `pincode` | `text` | |
| `pan` | `text` | **stored in the clear** |
| `aadhaar_last4` | `text` | last 4 digits, for display |
| `aadhaar_hash` | `text` | peppered SHA-256, `customers.routes.ts:78-84` |
| `kyc` | `text NOT NULL DEFAULT 'Pending'` | |
| `cibil` | `integer` | |
| `account_no` | `text` | **stored in the clear** |
| `ifsc`, `branch` | `text` | |
| `assigned_user_id` | `uuid` → `users.id` `[N]` | |
| `assigned_team_id` | `uuid` → `teams.id` `[N]` | |
| `status` | `text NOT NULL DEFAULT 'Active'` | |
| lifecycle block | 7 columns | |

- **Unique (both partial; the first is also functional and composite):**
  - `customers_bank_reference_unique` on `(bank_id, upper(bank_reference_id))` `WHERE deleted_at is null` — `domain.ts:140-142`, `0000_init.sql:285`. This is the brief's core constraint: Bank A + REF001 and Bank B + REF001 coexist; a second Bank A + REF001 is rejected.
  - `customers_code_unique (code) WHERE deleted_at is null`
- **Other indexes:** `customers_bank_idx`, `customers_assigned_user_idx`, `customers_assigned_team_idx`, `customers_status_idx`, `customers_mobile_idx`, `customers_deleted_at_idx`
- **Trigger:** `customers_touch_updated_at`
- **FKs in:** `loans[R]`, `bank_orders[R]`, `disbursements[R]`, `transactions[R]`, `verifications[N]`, `documents[C]`

### 5.4 Dead exports in `domain.ts`

`softDeletableTables` (`:168-171`), `isBankActive` (`:175`) and `_softDeleteColumnsPresent` (`:176`) are exported and referenced **nowhere else in the repository** (verified by repo-wide grep). The comment on `softDeletableTables` says it is "Re-exported so the recycle-bin service can validate table names", but `services/recycle-bin.ts` uses its own `BIN_REGISTRY` instead.

---

## 6. Table reference — governance (`src/db/schema/governance.ts`)

### 6.1 `audit_logs`

Append-only. Immutability is enforced by a database trigger, not application code (`governance.ts:15-22`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` PK | the **only** non-uuid PK in the schema |
| `occurred_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `actor_id` | `uuid` → `users.id` `[N]` | |
| `actor_email`, `actor_role_key` | `text` | denormalised so history survives a purged user |
| `action` | `text NOT NULL` | free text; see §10 |
| `record_type` | `text NOT NULL` | |
| `record_id` | `text` | text, not uuid — no FK |
| `bank_id` | `uuid` | no FK |
| `summary` | `text` | |
| `changes`, `metadata` | `jsonb` | |
| `ip_address`, `user_agent`, `request_id` | `text` | |

- **PK:** `id` · **Unique:** none
- **Indexes:** `audit_logs_record_idx (record_type, record_id)`, `audit_logs_actor_idx`, `audit_logs_occurred_idx`, `audit_logs_bank_idx`, `audit_logs_action_idx`
- **Trigger:** `audit_logs_no_update` (`BEFORE UPDATE OR DELETE`)
- **Lifecycle block:** no
- **Doc bug:** the code comment at `governance.ts:20` points at `drizzle/9999_governance_guards.sql`. That file does not exist; the trigger lives in `drizzle/0001_governance_guards.sql`.
- **Secret redaction** happens before the write, in `services/audit.ts:18-27` — `password`, `passwordHash`, `password_hash`, `aadhaar`, `aadhaarHash`, `aadhaar_hash`, `token`, `tokenHash` are dropped from any `changes` diff. Note `pan` and `account_no` are **not** in the redaction set, so a PAN change will land in `audit_logs.changes` in the clear.

### 6.2 `recycle_bin_entries`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `record_type` | `text NOT NULL` | one of the 12 `BIN_REGISTRY` keys |
| `record_id` | `uuid NOT NULL` | **no FK** |
| `bank_id` | `uuid` | no FK; null for `service_provider` (`recycle-bin.ts:87`) |
| `label` | `text NOT NULL` | precomputed display string |
| `snapshot` | `jsonb` | the entire pre-delete row |
| `deleted_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `deleted_by` | `uuid` → `users.id` `[N]` | |
| `purge_after` | `timestamptz NOT NULL` | never acted upon (§3.4) |
| `restored_at` / `restored_by` | `timestamptz` / `uuid → users.id [N]` | |
| `purged_at` / `purged_by` | `timestamptz` / `uuid → users.id [N]` | |

- **Unique (partial, non-`deleted_at` predicate):** `recycle_bin_active_unique (record_type, record_id) WHERE restored_at is null and purged_at is null` — `governance.ts:82-84`, `0000_init.sql:305`. One live bin entry per record.
- **Other indexes:** `recycle_bin_purge_after_idx`, `recycle_bin_bank_idx`, `recycle_bin_type_idx`
- **Lifecycle block:** no (has its own delete-tracking columns)

### 6.3 `app_settings`

| Column | Type |
| --- | --- |
| `key` | `text` **PK** — the only text primary key in the schema |
| `value` | `jsonb NOT NULL` |
| `description` | `text` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_by` | `uuid` → `users.id` `[N]` |

- **Index:** `app_settings_updated_idx (updated_at)` · **Lifecycle block:** no
- **Status: COMPLETELY DEAD.** Repo-wide grep for `appSettings` returns exactly one hit — the declaration at `governance.ts:95`. No route, no service, no test, no migration data reads or writes it. The `settings.view` / `settings.edit` permissions exist (`lib/permissions.ts:120-123`) and are granted to `admin` (`:230`), but there is no `/api/settings` mount in `app.ts:78-99`. The retention value the table was meant to hold is read from the environment instead (`config/env.ts:23`).

### 6.4 `import_batches`

Excel import staging: upload → validate → preview → confirm → import (`governance.ts:107-111`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `import_type` | `text NOT NULL` | always `"customers"` in practice (`imports.routes.ts:293`) |
| `file_name` | `text NOT NULL` | |
| `file_size` | `integer NOT NULL DEFAULT 0` | |
| `bank_id` | `uuid` | **DEAD, never written** (§9) |
| `status` | `text NOT NULL DEFAULT 'validating'` | the default is never observed — inserts write `'previewed'` (`imports.routes.ts:296`) |
| `total_rows`, `valid_rows`, `invalid_rows`, `duplicate_rows`, `imported_rows` | `integer NOT NULL DEFAULT 0` | |
| `error_summary` | `jsonb` | **never written** — no code path sets it |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `created_by` | `uuid` → `users.id` `[N]` | ownership check at `imports.routes.ts:343, 376` |
| `confirmed_at` / `confirmed_by` | `timestamptz` / `uuid → users.id [N]` | |
| `expires_at` | `timestamptz NOT NULL` | +24 h (`imports.routes.ts:302`) |

- **Indexes:** `import_batches_creator_idx`, `import_batches_status_idx`, `import_batches_expires_idx` · **Unique:** none · **Lifecycle block:** no

### 6.5 `import_rows`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `batch_id` | `uuid NOT NULL` → `import_batches.id` `[C]` |
| `row_number` | `integer NOT NULL` |
| `raw` | `jsonb NOT NULL` |
| `normalised` | `jsonb` |
| `status` | `text NOT NULL` (no default) |
| `errors` | `jsonb` |
| `created_record_id` | `uuid` — set to the created customer id, no FK (`imports.routes.ts:431`) |

- **Unique:** `import_rows_batch_row_unique (batch_id, row_number)` — not partial
- **Index:** `import_rows_status_idx (batch_id, status)` · **Lifecycle block:** no
- Staged rows are never deleted. A batch that expires without confirmation leaves its rows in the table forever.

---

## 7. Table reference — operations (`src/db/schema/operations.ts`)

All ten soft-deletable tables below use `...lifecycle` and are wired to the recycle bin. `notifications` and `assignment_history` are not.

### 7.1 `service_providers`

Third-party verification agencies. Not bank-owned, which is why it gets a hand-written router rather than the scoped factory (`operations.routes.ts:432-437`).

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `name` | `text NOT NULL` |
| `provider_type` | `text NOT NULL DEFAULT 'Field Verification'` |
| `contact_name`, `contact_phone`, `contact_email` | `text` |
| `status` | `text NOT NULL DEFAULT 'Active'` |
| `notes` | `text` |
| lifecycle block | 7 columns |

- **Unique:** `service_providers_name_unique` on `lower(name)` `WHERE deleted_at is null`
- **Indexes:** `service_providers_status_idx`, `service_providers_deleted_idx`
- **FKs out:** none · **FKs in:** `verifications.service_provider_id [N]`
- **No `bank_id` column** — deliberate (`operations.routes.ts:433-435`).

### 7.2 `funding_sources`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `name` | `text NOT NULL` |
| `source_type` | `text NOT NULL DEFAULT 'own_funds'` |
| `bank_id` | `uuid` → `banks.id` `[N]` — set only when the source *is* a bank |
| `account_ref` | `text` |
| `status` | `text NOT NULL DEFAULT 'Active'` |
| `notes` | `text` |
| lifecycle block | 7 columns |

- **Unique:** `funding_sources_name_unique` on `lower(name)` `WHERE deleted_at is null`
- **Indexes:** `funding_sources_bank_idx`, `funding_sources_deleted_idx`
- **FKs in:** `loans.funding_source_id [N]`, `disbursements.funding_source_id [N]`, `transactions.funding_source_id [N]`
- **Scoping hazard:** `bank_id` is nullable, and the factory applies `bankScope(ctx, bankColumn)` unconditionally (`scoped-resource.ts:97`). A bank-scoped user therefore cannot see any funding source whose `bank_id` is null. `UNVERIFIED` whether this is intended.

### 7.3 `loans`

The lending request. Mirrors the frontend `Loan` interface with the brief's workflow columns added (`operations.ts:81-84`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `code` | `text NOT NULL` | `LN-1001…`, `codeStart: 1000` (`operations.routes.ts:60-61`) |
| `application_no` | `text` | |
| `customer_id` | `uuid NOT NULL` → `customers.id` `[R]` | |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[R]` | |
| `loan_type` | `text NOT NULL` | |
| `amount_requested`, `amount_approved`, `emi`, `processing_fee`, `commission` | `numeric(16,2) NOT NULL DEFAULT '0'` | `money()` |
| `interest_rate` | `numeric(6,3) NOT NULL DEFAULT '0'` | |
| `tenure_months` | `integer NOT NULL DEFAULT 0` | |
| `status` | `text NOT NULL DEFAULT 'Draft'` | |
| `applied_on` | `timestamptz` | |
| `verification_required` | `boolean NOT NULL DEFAULT false` | |
| `funding_source_id` | `uuid` → `funding_sources.id` `[N]` | |
| `assigned_user_id` | `uuid` → `users.id` `[N]` | |
| `assigned_team_id` | `uuid` → `teams.id` `[N]` | |
| `priority` | `text NOT NULL DEFAULT 'Normal'` | vocabulary exists only in Zod (`operations.routes.ts:92`) — no `loanPriorities` const in the schema |
| `due_date` | `timestamptz` | |
| `approved_by` | `uuid` → `users.id` `[N]` | |
| `approved_at` | `timestamptz` | |
| `notes` | `text` | |
| lifecycle block | 7 columns | |

- **Unique:** `loans_code_unique (code) WHERE deleted_at is null`
- **Indexes:** `loans_customer_idx`, `loans_bank_idx`, `loans_status_idx`, `loans_assigned_user_idx`, `loans_assigned_team_idx`, `loans_due_date_idx`, `loans_deleted_idx`
- **FKs in:** `verifications.loan_id [C]`, `bank_orders.loan_id [R]`, `disbursements.loan_id [R]`, `transactions.loan_id [R]`, `documents.loan_id [C]`

### 7.4 `verifications`

One row per loan, existing even when verification is not required, so the record shows *that* the requesting bank handled it (`operations.ts:140-143`).

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `loan_id` | `uuid NOT NULL` → `loans.id` `[C]` |
| `customer_id` | `uuid` → `customers.id` `[N]` |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[R]` |
| `required` | `boolean NOT NULL DEFAULT false` |
| `handled_by_bank` | `boolean NOT NULL DEFAULT false` |
| `service_provider_id` | `uuid` → `service_providers.id` `[N]` |
| `provider_reference` | `text` |
| `status` | `text NOT NULL DEFAULT 'Pending'` |
| `result` | `text` |
| `requested_at`, `completed_at`, `expires_at` | `timestamptz` |
| `approved_by` | `uuid` → `users.id` `[N]` |
| `approved_at` | `timestamptz` |
| `notes` | `text` |
| lifecycle block | 7 columns |

- **Unique:** `verifications_loan_unique (loan_id) WHERE deleted_at is null` — enforces the one-per-loan rule at the database level
- **Indexes:** `verifications_bank_idx`, `verifications_status_idx`, `verifications_provider_idx`
- **No `code` column** — the factory config omits `codePrefix` (`operations.routes.ts:185-213`)
- The `required ⇒ service_provider_id` rule is enforced only in application code (`operations.routes.ts:133-135`); there is no `CHECK`.

### 7.5 `bank_orders`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `code` | `text NOT NULL` — `BO-2401…`, `codeStart: 2400` |
| `loan_id` | `uuid NOT NULL` → `loans.id` `[R]` |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[R]` |
| `customer_id` | `uuid NOT NULL` → `customers.id` `[R]` |
| `submitted_on`, `sla` | `timestamptz` |
| `stage` | `text NOT NULL DEFAULT 'Login'` |
| `status` | `text NOT NULL DEFAULT 'In Progress'` |
| `officer`, `remarks` | `text` |
| lifecycle block | 7 columns |

- **Unique:** `bank_orders_code_unique (code) WHERE deleted_at is null`
- **Indexes:** `bank_orders_loan_idx`, `bank_orders_bank_idx`, `bank_orders_status_idx`, `bank_orders_sla_idx`

### 7.6 `disbursements`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `code` | `text NOT NULL` — `DSB-5001…`, `codeStart: 5000` |
| `loan_id` | `uuid NOT NULL` → `loans.id` `[R]` |
| `customer_id` | `uuid NOT NULL` → `customers.id` `[R]` |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[R]` |
| `funding_source_id` | `uuid` → `funding_sources.id` `[N]` |
| `amount` | `numeric(16,2) NOT NULL DEFAULT '0'` |
| `utr` | `text` |
| `mode` | `text NOT NULL DEFAULT 'NEFT'` |
| `disbursed_on` | `timestamptz` |
| `status` | `text NOT NULL DEFAULT 'In Transit'` |
| `credited_to` | `text` |
| `assigned_user_id` | `uuid` → `users.id` `[N]` |
| `approved_by` | `uuid` → `users.id` `[N]` |
| `approved_at` | `timestamptz` |
| `notes` | `text` |
| lifecycle block | 7 columns |

- **Unique:**
  - `disbursements_code_unique (code) WHERE deleted_at is null`
  - `disbursements_utr_unique` on `upper(utr)` `WHERE deleted_at is null and utr is not null` — functional + doubly-predicated partial (`operations.ts:250-252`, `0002_operations.sql:314`). A duplicate UTR almost always means a double entry, so it is rejected rather than accepted.
- **Indexes:** `disbursements_loan_idx`, `disbursements_bank_idx`, `disbursements_status_idx`

### 7.7 `settlements`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `code` | `text NOT NULL` — `STL-3301…`, `codeStart: 3300` |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[R]` |
| `period` | `text NOT NULL` |
| `cases` | `integer NOT NULL DEFAULT 0` |
| `gross_commission`, `tds`, `net_payable` | `numeric(16,2) NOT NULL DEFAULT '0'` |
| `status` | `text NOT NULL DEFAULT 'Pending'` |
| `invoice_no` | `text` |
| `raised_on`, `settled_on` | `timestamptz` |
| `approved_by` | `uuid` → `users.id` `[N]` |
| `approved_at` | `timestamptz` |
| `notes` | `text` |
| lifecycle block | 7 columns |

- **Unique:**
  - `settlements_code_unique (code) WHERE deleted_at is null`
  - `settlements_bank_period_unique (bank_id, lower(period)) WHERE deleted_at is null` — one settlement per bank per period
- **Index:** `settlements_status_idx`
- **No FK on `customer_id`** — settlements are bank-level, not customer-level.
- The arithmetic rule `net_payable = gross_commission - tds` (±0.01) is enforced only in `operations.routes.ts:310-318`; there is no `CHECK`.

### 7.8 `transactions`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `code` | `text NOT NULL` — `TXN-77001…`, `codeStart: 77000` |
| `customer_id` | `uuid` → `customers.id` `[R]` (nullable) |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[R]` |
| `loan_id` | `uuid` → `loans.id` `[R]` |
| `disbursement_id` | `uuid` → `disbursements.id` `[N]` |
| `settlement_id` | `uuid` → `settlements.id` `[N]` |
| `funding_source_id` | `uuid` → `funding_sources.id` `[N]` |
| `amount`, `commission` | `numeric(16,2) NOT NULL DEFAULT '0'` |
| `txn_type` | `text NOT NULL` (no default) |
| `status` | `text NOT NULL DEFAULT 'Pending'` |
| `reference` | `text` |
| `occurred_at` | `timestamptz NOT NULL DEFAULT now()` — the list order column (`operations.routes.ts:331`) |
| lifecycle block | 7 columns |

- **Unique:** `transactions_code_unique (code)` — **NOT partial**. See §3.3.
- **Indexes:** `transactions_customer_idx`, `transactions_bank_idx`, `transactions_loan_idx`, `transactions_status_idx`, `transactions_occurred_idx`

### 7.9 `ledger_entries`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `code` | `text NOT NULL` | `LG-9001…`, `codeStart: 9000` |
| `entry_date` | `timestamptz NOT NULL DEFAULT now()` | list order column |
| `voucher_no` | `text` | |
| `particulars` | `text NOT NULL` | |
| `party` | `text` | |
| `category` | `text NOT NULL` (no default) | |
| `bank_id` | `uuid` → `banks.id` `[N]` | nullable; same scoping hazard as `funding_sources` |
| `transaction_id` | `uuid` → `transactions.id` `[N]` | |
| `debit`, `credit` | `numeric(16,2) NOT NULL DEFAULT '0'` | |
| `balance` | `numeric(16,2) NOT NULL DEFAULT '0'` | see below |
| `mode` | `text` | |
| lifecycle block | 7 columns | |

- **Unique:** `ledger_entries_code_unique (code)` — **NOT partial**
- **Indexes:** `ledger_entries_date_idx`, `ledger_entries_category_idx`, `ledger_entries_bank_idx`
- **`balance` is a documented lie.** The schema comment at `operations.ts:342-343` states the running balance "is recomputed inside the same transaction that inserts the row". No such recomputation exists. `balance` appears in the create schema (`operations.routes.ts:376`) and in `numericFields` (`:364`), so it is taken verbatim from the client request body and written as-is by `scoped-resource.ts:182-189`. Nothing derives it from `debit`/`credit` or from the previous row.

### 7.10 `documents`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `customer_id` | `uuid` → `customers.id` `[C]` | |
| `loan_id` | `uuid` → `loans.id` `[C]` | |
| `bank_id` | `uuid NOT NULL` → `banks.id` `[R]` | |
| `doc_type` | `text NOT NULL` | |
| `file_name` | `text NOT NULL` | |
| `file_size` | `integer NOT NULL DEFAULT 0` | |
| `mime_type` | `text` | |
| `storage_key` | `text` | object-store key; **no object store exists** (§9) |
| `checksum` | `text` | |
| `status` | `text NOT NULL DEFAULT 'Pending'` | |
| `uploaded_by` | `uuid` → `users.id` `[N]` | **DEAD, never written** |
| `verified_by` | `uuid` → `users.id` `[N]` | **DEAD, never written** |
| lifecycle block | 7 columns | |

- **Unique:** none — the same `file_name` can be recorded any number of times against the same customer
- **Indexes:** `documents_customer_idx`, `documents_loan_idx`, `documents_bank_idx`, `documents_status_idx`
- `/api/documents` is pure JSON CRUD. There is no upload endpoint, no `multer` usage in this router, and no bytes are ever stored. `multer` appears only in `imports.routes.ts` with `memoryStorage`, where the buffer is parsed and discarded.

### 7.11 `notifications`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `user_id` | `uuid` → `users.id` `[C]` (nullable) |
| `title` | `text NOT NULL` |
| `message` | `text NOT NULL` |
| `severity` | `text NOT NULL DEFAULT 'info'` |
| `read` | `boolean NOT NULL DEFAULT false` |
| `link_href` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `read_at` | `timestamptz` |

- **Indexes:** `notifications_user_idx (user_id)`, `notifications_read_idx (user_id, read)` · **Unique:** none · **Lifecycle block:** no
- **Status: three routes, zero producers.** `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read` exist (`admin.routes.ts:955, 974, 987`) and the two POST routes `UPDATE` the table (`:978, :991`). There is **no `insert(notifications)` anywhere in the repository**. The list endpoint can only ever return an empty array.

### 7.12 `assignment_history`

"Every reassignment is kept, so 'who had this and when' is answerable" (`operations.ts:406`).

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `record_type` | `text NOT NULL` |
| `record_id` | `uuid NOT NULL` (no FK) |
| `bank_id` | `uuid` (no FK) |
| `from_user_id` / `to_user_id` | `uuid` → `users.id` `[N]` |
| `from_team_id` / `to_team_id` | `uuid` → `teams.id` `[N]` |
| `reason` | `text` |
| `assigned_by` | `uuid` → `users.id` `[N]` |
| `assigned_at` | `timestamptz NOT NULL DEFAULT now()` |

- **Indexes:** `assignment_history_record_idx (record_type, record_id)`, `assignment_history_to_user_idx` · **Unique:** none · **Lifecycle block:** no
- **Status: COMPLETELY DEAD.** Repo-wide grep for `assignmentHistory` returns exactly one hit — the declaration at `operations.ts:407`. It has no route, no service, no writer and no reader. Reassignments *are* recorded, but in `audit_logs` via `recordAudit(..., action: "assigned", ...)` (`admin.routes.ts:420, 771`), not here.

---

## 8. Database triggers (`drizzle/0001_governance_guards.sql`)

Three functions, seven triggers. This migration creates no tables.

| # | Trigger | Table | Timing | Function |
| --- | --- | --- | --- | --- |
| 1 | `audit_logs_no_update` | `audit_logs` | `BEFORE UPDATE OR DELETE` | `audit_logs_immutable()` |
| 2 | `banks_touch_updated_at` | `banks` | `BEFORE UPDATE` | `touch_updated_at()` |
| 3 | `customers_touch_updated_at` | `customers` | `BEFORE UPDATE` | `touch_updated_at()` |
| 4 | `users_touch_updated_at` | `users` | `BEFORE UPDATE` | `touch_updated_at()` |
| 5 | `roles_touch_updated_at` | `roles` | `BEFORE UPDATE` | `touch_updated_at()` |
| 6 | `teams_touch_updated_at` | `teams` | `BEFORE UPDATE` | `touch_updated_at()` |
| 7 | `roles_protect_system` | `roles` | `BEFORE UPDATE OR DELETE` | `protect_system_roles()` |

All seven are `FOR EACH ROW`. Each is preceded by `DROP TRIGGER IF EXISTS`, so the migration is re-runnable.

### 8.1 `audit_logs_immutable()` — `0001:6-18`

```sql
CREATE OR REPLACE FUNCTION audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
```

**Enforces:** no `UPDATE` and no `DELETE` on `audit_logs`, from any connection, by any role. The comment at `0001:3-5` explains the choice: revoking privileges was rejected because Neon's role model varies by plan, whereas a trigger holds regardless of which role the app connects as.

### 8.2 `touch_updated_at()` — `0001:21-27`

```sql
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Enforces:** `updated_at` is truthful on `banks`, `customers`, `users`, `roles`, `teams` regardless of what the writer supplies.

### 8.3 `protect_system_roles()` — `0001:56-77`

```sql
IF (TG_OP = 'DELETE') THEN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'System role "%" cannot be deleted', OLD.key ...
  END IF;
  RETURN OLD;
END IF;

IF OLD.is_system AND NEW.key IS DISTINCT FROM OLD.key THEN
  RAISE EXCEPTION 'The key of system role "%" cannot be changed', OLD.key ...
END IF;
IF OLD.is_system AND NEW.is_active = false THEN
  RAISE EXCEPTION 'System role "%" cannot be deactivated', OLD.key ...
END IF;
```

**Enforces, for any row with `is_system = true`:** it cannot be deleted; its `key` cannot be changed; it cannot be deactivated.

### 8.4 What the triggers do NOT enforce

This list matters more than the list above, because these are the invariants a reader might assume are guarded and are not.

| Not enforced | Consequence | Where it *is* handled (if anywhere) |
| --- | --- | --- |
| **No last-super-admin guard** | The database will happily let you delete, deactivate or soft-delete the final `super_admin` *user*. `protect_system_roles` protects the **role row**, not its holders. | Application only: `admin.routes.ts:444-451` counts active system-role holders and refuses at `remaining <= 1`. That check is skipped by any direct SQL, and it does not cover `PATCH /api/users/:id` setting `status` to something other than `"Active"`. |
| **No `role_permissions` guard** | Nothing stops `DELETE FROM role_permissions WHERE role_id = <super_admin>`. The system role can be stripped of every permission at the SQL level, leaving an administratively locked-out system. | Application only: `admin.routes.ts:626` rejects `PUT /api/roles/:id/permissions` when `role.isSystem`. The seed re-grants the full catalogue on the next run (`seed.ts:65-74`), which is the actual recovery path. |
| **No `roles.level` guard** | `UPDATE roles SET level = 0 WHERE key = 'executive'` succeeds. The entire hierarchy rule ("act only on a strictly greater level") rests on a column any writer can change. | Application only: `admin.routes.ts:584-585, 593` — a system role's level is not editable via the API, and a non-system role's new level must still be below the actor's authority. |
| **`is_system` itself is unguarded on UPDATE** | `UPDATE roles SET is_system = false WHERE key = 'super_admin'` succeeds — the function only inspects `OLD.is_system`, and after that statement commits, the role is deletable. | Nothing. |
| **`TRUNCATE` is not covered** | `TRUNCATE audit_logs` fires no row-level trigger and wipes the entire audit trail. The trigger is `FOR EACH ROW`; a `TRUNCATE`-level (statement) trigger would be required. Same for `roles`. | Nothing. |
| **No trigger on the 10 operations tables** | `updated_at` on `loans`, `disbursements`, etc. is only as honest as the writing code. | `scoped-resource.ts:230, 298` |
| **No soft-delete cascade** | Soft-deleting a bank does not soft-delete its customers (§11.3). | Nothing. |

---

## 9. Write-activity map

Legend: **W** = written by the listed code; **DEAD** = no writer anywhere in the repository.

### 9.1 Per table

| Table | Status | Writers (`file:line`) |
| --- | --- | --- |
| `roles` | W | `db/seed.ts:41` (update on re-seed), `db/seed.ts:47` (insert); `modules/admin.routes.ts:537` (POST), `:588` (PATCH), `:682` (**hard** DELETE) |
| `permissions` | W | `db/seed.ts:23` (upsert on `key`); `db/seed.ts:137` (`purgeOrphanedPermissions`, **zero callers**) |
| `role_permissions` | W | `db/seed.ts:72`; `modules/admin.routes.ts:555` (role create), `:640` (delete-all), `:643` (re-insert) |
| `users` | W | `db/seed.ts:110` (bootstrap super admin); `modules/admin.routes.ts:194` (create), `:277` (patch), `:346` (reset-password), `:454` (soft delete + `status: "Inactive"`); `modules/auth.routes.ts:117` (failed-attempt counter), `:135` (login success), `:241` (change-password) |
| `refresh_tokens` | W | `modules/auth.routes.ts:39` (insert on login/refresh), `:176`, `:184`, `:201` (rotation / revocation), `:252` (revoke all on password change); `modules/admin.routes.ts:361` (revoke all on admin reset) |
| `teams` | W | `modules/admin.routes.ts:734` (insert), `:789` (soft delete). **No update path.** |
| `team_members` | W | `modules/admin.routes.ts:222` (on user create), `:764` (delete-all), `:767` (re-insert) |
| `banks` | W | `modules/banks.routes.ts:80` (insert), `:120` (update); `services/recycle-bin.ts:128` (soft delete), `:178` (restore), `:221` (purge) |
| `user_bank_access` | W | `modules/admin.routes.ts:215` (on user create), `:412` (delete-all), `:415` (re-insert) |
| `customers` | W | `modules/customers.routes.ts:185` (insert), `:240` (update); `modules/imports.routes.ts:405` (bulk insert); `services/recycle-bin.ts:128/178/221` |
| `audit_logs` | W (insert only) | `services/audit.ts:57` (`recordAudit`), `:88` (`recordAuthEvent`). UPDATE/DELETE blocked by trigger. |
| `recycle_bin_entries` | W | `services/recycle-bin.ts:132` (insert), `:183` (restore stamp), `:224` (purge stamp) |
| `app_settings` | **DEAD** | No writer, no reader. See §6.3. |
| `import_batches` | W | `modules/imports.routes.ts:291` (insert), `:437` (update on confirm) |
| `import_rows` | W | `modules/imports.routes.ts:306` (insert), `:430` (update on import) |
| `service_providers` | W | `modules/operations.routes.ts:469` (insert), `:496` (update). No delete path. |
| `funding_sources` | W | factory `modules/scoped-resource.ts:182/227/293`, wired at `modules/operations.routes.ts:405`; `services/recycle-bin.ts` on delete |
| `loans` | W | factory `scoped-resource.ts:182/227/293`, wired at `operations.routes.ts:50`; plus `operations.routes.ts:165` (sets `verification_required`); `services/recycle-bin.ts` on delete |
| `verifications` | W | factory, wired at `operations.routes.ts:185`; plus `operations.routes.ts:145` (`POST /api/loans/:id/verification`) |
| `bank_orders` | W | factory, wired at `operations.routes.ts:215`; `services/recycle-bin.ts` on delete |
| `disbursements` | W | factory, wired at `operations.routes.ts:248` |
| `settlements` | W | factory, wired at `operations.routes.ts:283` |
| `transactions` | W | factory, wired at `operations.routes.ts:321` |
| `ledger_entries` | W | factory, wired at `operations.routes.ts:351` |
| `documents` | W | factory, wired at `operations.routes.ts:380`; `services/recycle-bin.ts` on delete |
| `notifications` | **UPDATE only — zero producers** | `modules/admin.routes.ts:978` (read-all), `:991` (read one). No `insert(notifications)` exists. |
| `assignment_history` | **DEAD** | No writer, no reader. See §7.12. |

### 9.2 Dead columns

| Column | Why it is dead | Evidence |
| --- | --- | --- |
| `refresh_tokens.replaced_by_token_hash` | Rotation revokes the old row (`auth.routes.ts:176-201`) but never links it to its successor. | Repo-wide grep for `replacedByTokenHash`: 1 hit, the declaration at `identity.ts:156` |
| `documents.uploaded_by` | Not in the documents create schema (`operations.routes.ts:391-402`); the factory writes only `createdBy`/`updatedBy` (`scoped-resource.ts:186-187`). | Grep for `uploadedBy`: 1 hit, `operations.ts:375` |
| `documents.verified_by` | Same. Not set by the approve handler either — the documents router has no `approve` permission (`operations.routes.ts:383-388`). | Grep for `verifiedBy`: 1 hit, `operations.ts:376` |
| `import_batches.bank_id` | The only insert (`imports.routes.ts:291-303`) does not supply it; the only update (`:437-444`) does not either. | Read of both statements |
| `import_batches.error_summary` | Never supplied by any statement. | Read of `imports.routes.ts:289-317, 436-444` |
| `documents.storage_key`, `documents.checksum` | **Correction to a commonly repeated claim: these are NOT unwritable.** Both appear in the documents create schema (`operations.routes.ts:399-400`) and the factory spreads the parsed body straight into the insert (`scoped-resource.ts:182-189`), so a client that sends `storageKey` will have it persisted. What is true is that *nothing in this system ever produces one*: there is no upload endpoint, no object store, no storage client. In practice the column is always null. |
| `ledger_entries.balance` | Not dead, but not derived either — see §7.9. Written verbatim from the request body. |
| `users.must_change_password` | Written (`admin.routes.ts:208, 293, 350`; `auth.routes.ts:245`) and returned on the profile (`auth.routes.ts:70`), but **never asserted as a guard** in `src/middleware/` or in any route handler. Enforcement is React-only (`frontend/src/components/layout/app-shell.tsx:39-48`, working tree). A client that ignores the flag retains full API access. |

### 9.3 Tables whose columns exist for a capability the system does not have

| Table / column | Missing capability |
| --- | --- |
| `documents.storage_key`, `.checksum`, `.mime_type`, `.file_size` | File storage. `multer` is used only in `imports.routes.ts` with `memoryStorage`; the buffer is parsed and discarded. No object store, no signed URLs, no download route. |
| `notifications.*` | Any producer. No email either: repo-wide there is no mail provider dependency, no transport code, no template, and no `EMAIL_*` / `SMTP_*` / `MAIL_*` variable in `config/env.ts:4-26`. |
| `app_settings.*` | Any consumer. Retention comes from `RECYCLE_BIN_RETENTION_DAYS` (`config/env.ts:23`), not from this table. |
| `recycle_bin_entries.purge_after` | A scheduler. `expiredEntries()` (`recycle-bin.ts:240`) has zero callers. |

---

## 10. Seed data

`src/db/seed.ts` is the only seed path. It is invoked when `process.argv[1]` contains `"seed"` (`seed.ts:141-142`).

### 10.1 What it inserts

| Step | Table | Rows | Idempotency |
| --- | --- | --- | --- |
| 1 | `permissions` | **76** — every key in `PERMISSIONS` (`lib/permissions.ts:11-134`), flattened by `ALL_PERMISSIONS` (`:153-163`) | `INSERT … ON CONFLICT (key) DO UPDATE SET description = excluded.description` (`seed.ts:22-28`). Re-running refreshes descriptions and adds new keys; it never removes. |
| 2 | `roles` | **5** — `super_admin` (level 0, `is_system`), `admin` (10), `manager` (20), `team_leader` (30), `executive` (40) (`lib/permissions.ts:190-313`) | Looked up by `key` (`seed.ts:34`). If present: updates `level`, `is_system`, `updated_at` — and **deliberately not `name`**, because renaming a role is a supported client action a redeploy must not undo (`seed.ts:38-44`). If absent: inserts. |
| 3 | `role_permissions` | `super_admin` → all 76; the other four → their listed sets | `ON CONFLICT DO NOTHING` (`seed.ts:72`). Grants are re-applied **only** when `roleSeed.isSystem` is true **or** the role did not previously exist (`seed.ts:65`). After first creation the client owns a non-system role's permission set; a redeploy will not restore a revoked grant. The system role is always topped up so a newly added permission is never orphaned. |
| 4 | `users` | **0 or 1** — see §10.2 | Skipped entirely if the email already exists (`seed.ts:104-108`). |

### 10.2 Bootstrap super admin

`bootstrapSuperAdmin()` (`seed.ts:80-125`) requires **both** `BOOTSTRAP_SUPERADMIN_EMAIL` and `BOOTSTRAP_SUPERADMIN_PASSWORD` (both `z.string().optional()`, `config/env.ts:20-21`).

| Condition | Behaviour |
| --- | --- |
| Either variable unset or blank | Logs `"BOOTSTRAP_SUPERADMIN_EMAIL / _PASSWORD not set — no super admin created. Set both and re-run db:seed."` at **warn** level and returns. The seed still exits successfully (`seed.ts:85-90`). **The database ends up with 76 permissions, 5 roles, full grants, and zero users — nobody can log in.** |
| Password fails `passwordProblems()` (min 12 chars, one lower, one upper, one digit — `lib/password.ts:89-98`) | **Throws**, aborting the whole seed (`seed.ts:92-95`). |
| `super_admin` role missing | Throws `"super_admin role missing — seed order is wrong"` (`seed.ts:102`). Unreachable in practice because step 2 runs first. |
| A user with that email already exists | Logs `"Super admin <email> already exists — leaving the password untouched"` and returns (`seed.ts:105-108`). |
| Otherwise | Inserts one user: `employee_code: "EMP-0001"`, `name: "Super Admin"`, the given email, argon2id hash of the given password, `role_id` = super_admin, `branch: "Head Office"`, `status: "Active"`, `joined_on: now`, **`must_change_password: true`** (`seed.ts:110-122`). |

The `must_change_password: true` is deliberate — it stops the bootstrap value, which lives in the deployment dashboard, from remaining a valid credential (`seed.ts:119-121`). Note the caveat in §9.2: that flag is not enforced server-side.

**Email lookup bug worth knowing:** `seed.ts:104` queries `eq(users.email, email)` with the already-lowercased address, but the uniqueness index is on `lower(email)` (`identity.ts:130-132`). If a super admin was created through the API with a mixed-case address, the seed's existence check misses it and the subsequent insert violates `users_email_unique`, failing the seed.

### 10.3 What it does NOT insert

**No business data of any kind.** The seed inserts into exactly four tables — `permissions`, `roles`, `role_permissions`, `users`. There are no banks, no customers, no loans, no transactions, no service providers, no funding sources, no settlements, no documents, no notifications. This is stated as an intentional requirement at `seed.ts:13-16`: an empty database must render empty states rather than fabricated records, so there is no demo data to remove later.

Consequence: a freshly seeded system has **zero rows** in 23 of the 27 tables.

### 10.4 Migration execution

`db/migrate.ts:11-26` runs Drizzle's `migrate()` against `DIRECT_DATABASE_URL ?? DATABASE_URL` with `max: 1`, and disables TLS only for `localhost`. The comment at `:7-10` explains the direct endpoint: running DDL through Neon's pooler can fail or deadlock on session-scoped locks. Migrations are tracked in `drizzle/meta/_journal.json` (3 entries, `breakpoints: true`).

---

## 11. Status vocabularies

### 11.1 The vocabularies

Every one of these is a TypeScript `as const` array, and — with **one exception** — none is a database constraint. There are still zero `CREATE TYPE` statements, and every column below is plain `text`.

**The exception is `loanStatuses`.** Since Task 5.2 (2026-09-05) it backs `loans_status_check`, added by `drizzle/0007_loan_status_check.sql`, so `loans.status` is the one status column Postgres itself constrains. That is also why the const moved to `operations.ts:98` — the constraint callback runs while `pgTable(...)` is evaluated, so a const at the foot of the file would still be in its temporal dead zone.

| Constant | Declared at | Values | Column it describes |
| --- | --- | --- | --- |
| `bankStatuses` | `domain.ts:172` | `Active`, `Paused` | `banks.status` |
| `customerStatuses` | `domain.ts:173` | `Active`, `Follow Up`, `Closed` | `customers.status` |
| `kycStatuses` | `domain.ts:174` | `Verified`, `Pending`, `Rejected` | `customers.kyc` |
| `loanStatuses` | `operations.ts:98-106` | `Draft`, `Submitted`, `Under Review`, `Approved`, `Disbursed`, `Rejected`, `Closed` | `loans.status` — **also a DB `CHECK`** |
| `loanTypes` | `operations.ts:474-481` | `Personal Loan`, `Business Loan`, `Gold Loan`, `Vehicle Loan`, `Home Loan`, `Loan Against Property` | `loans.loan_type` |
| `verificationStatuses` | `operations.ts:483-491` | `Pending`, `Requested`, `In Progress`, `Verified`, `Rejected`, `Failed`, `Expired` | `verifications.status` |
| `bankOrderStages` | `operations.ts:493-499` | `Login`, `Credit Check`, `Field Verification`, `Sanction`, `Disbursal Queue` | `bank_orders.stage` |
| `bankOrderStatuses` | `operations.ts:501` | `In Progress`, `On Hold`, `Cleared`, `Returned` | `bank_orders.status` |
| `disbursementModes` | `operations.ts:502` | `NEFT`, `RTGS`, `IMPS` | `disbursements.mode` |
| `disbursementStatuses` | `operations.ts:503` | `Credited`, `In Transit`, `Failed` | `disbursements.status` |
| `settlementStatuses` | `operations.ts:504` | `Paid`, `Pending`, `Disputed` | `settlements.status` |
| `transactionTypes` | `operations.ts:505` | `Disbursement`, `EMI Collection`, `Commission`, `Refund` | `transactions.txn_type` |
| `transactionStatuses` | `operations.ts:506` | `Success`, `Pending`, `Failed` | `transactions.status` |
| `ledgerCategories` | `operations.ts:507-513` | `Commission`, `Disbursement`, `Payout`, `Expense`, `Tax` | `ledger_entries.category` |
| `fundingSourceTypes` | `operations.ts:514` | `own_funds`, `bank`, `external` | `funding_sources.source_type` |
| `auditActions` | `governance.ts:165-181` | `created`, `updated`, `assigned`, `approved`, `disbursed`, `settled`, `deleted`, `restored`, `permanently_deleted`, `login_succeeded`, `login_failed`, `logout`, `password_changed`, `permission_denied`, `imported` | `audit_logs.action` |
| `importStatuses` | `governance.ts:185` | `validating`, `previewed`, `importing`, `imported`, `failed`, `expired` | `import_batches.status` |
| `importRowStatuses` | `governance.ts:186` | `valid`, `invalid`, `duplicate`, `imported`, `skipped` | `import_rows.status` |

Vocabularies with **no** schema constant, existing only as Zod enums in route code:

| Values | Column | Declared at |
| --- | --- | --- |
| `Low`, `Normal`, `High`, `Urgent` | `loans.priority` | `operations.routes.ts:92` |
| `Active`, `Inactive` | `funding_sources.status`, `service_providers.status`, `teams.status` | `operations.routes.ts:421, 446`; `admin.routes.ts:725` |
| `Verified`, `Pending`, `Rejected` | `documents.status` | `operations.routes.ts:401` |
| `Male`, `Female`, `Other` / `Single`, `Married` | `customers.gender`, `customers.marital_status` | `customers.routes.ts:33-34` |

### 11.2 Where enforcement actually happens

| Layer | Enforced? | Notes |
| --- | --- | --- |
| PostgreSQL | **`loans.status` only** | 0 enum types. **1** CHECK constraint, `loans_status_check` (`0007_loan_status_check.sql`), covering the vocabulary of one column. The other 26 tables are unconstrained; bank-order stages are roadmap 6.5, disbursements 7.3, and 13.13 is the sweep |
| Drizzle schema | **`loans.status` only** | Every status column is still `text()` with a string default; `loans` additionally carries a `check()` in its table definition |
| The exported `as const` arrays | **`loanStatuses` only** | Repo-wide grep used to confirm **every one of the 18 arrays was referenced only by its own declaration**. `loanStatuses` now has three consumers — the CHECK constraint, the route's `createSchema`, and the approve route's `allowedStatuses`. The *type* `AuditAction` (`governance.ts:183`) remains consumed by `services/audit.ts:4, 9`; the other 16 arrays are still unreferenced |
| Zod, at the API boundary | **Yes, partially** | The factory `createSchema`s and the hand-written schemas use `z.enum([...])` — with literals typed inline rather than imported, so the two lists can drift silently. **`loans.status` is the exception**: since Task 5.3 it imports `loanStatuses`, so the column, the constraint and the two route schemas cannot drift apart |
| Transition legality (`from → to`) | **`loans` only, service layer** | `allowedTransitions` / `initialStatuses` on `ScopedResourceConfig`, enforced at CREATE and APPROVE. **Not a database rule and not a trigger** — a CHECK sees one candidate row and cannot express a transition (D-057). The machine is ratified at BUSINESS_FLOW.md §3.3 |

**Concrete drift already present:** `admin.routes.ts:366` writes the audit action `"password_reset"`, which is **not** in `auditActions` (`governance.ts:165-181`). Because `audit_logs.action` is free `text`, the row is written without complaint and the declared vocabulary is now incomplete. This is a working-tree change (`admin.routes.ts` is modified), so at HEAD the reset-password route — and therefore the out-of-vocabulary action — does not exist.

The other action values `"disbursed"`, `"settled"`, `"logout"` and `"permission_denied"` are declared but `UNVERIFIED` as ever written — `permission_denied` in particular has no `recordAudit` call site in the routes read for this document.

---

## 12. Known data-model issues

### 12.1 Almost zero `CHECK` constraints — one, since 2026-09-05

There is exactly **one** `CHECK` in the schema, added by Task 5.2. Every other domain rule the design depends on still lives in TypeScript alone:

| Rule | Enforced at | What bypasses it |
| --- | --- | --- |
| Money is non-negative | `operations.routes.ts:25` (`z.coerce.number().min(0)`) | any direct SQL, any future non-router writer |
| `net_payable = gross_commission − tds` | `operations.routes.ts:310-318` | ditto |
| `verifications.required ⇒ service_provider_id is not null` | `operations.routes.ts:133-135` | ditto |
| `funding_sources.source_type = 'bank' ⇒ bank_id is not null` | `operations.routes.ts:424-428` | ditto |
| `debit`/`credit`/`balance` consistency | **nowhere** | — |
| `loans.status` belongs to its vocabulary | **`loans_status_check`, in Postgres** | **nothing** — a direct `UPDATE loans SET status = 'banana'` is refused with SQLSTATE 23514 |
| Every *other* status column belongs to its vocabulary | Zod enums only | any direct SQL, any future non-router writer |
| A loan's `status` transition is legal | `scoped-resource.ts`, CREATE and APPROVE only | any direct SQL — **and deliberately so.** A CHECK cannot express a transition and no trigger was added (D-057) |
| A loan's customer belongs to the loan's bank | `operations.routes.ts:33-48` (`assertSameBank`) | ditto |

The `assertSameBank` check is the one most worth a database-level equivalent: it is the only thing preventing a bank-A customer being attached to a bank-B loan, which would leak the customer's name through the loan endpoint (`operations.routes.ts:28-32`).

### 12.2 `count(*)`-based code generation

Three independent implementations of the same pattern:

| Where | Statement | Produces |
| --- | --- | --- |
| `scoped-resource.ts:87-91` | `select count(*) from <table>` then `${prefix}-${codeStart + total + 1}` | `LN-…`, `BO-…`, `DSB-…`, `STL-…`, `TXN-…`, `LG-…` |
| `customers.routes.ts:86-89` | `select count(*) from customers` then `CUS-${10000 + total + 1}` | `CUS-…` |
| `imports.routes.ts:389-392, 402-407` | one `count(*)`, then an in-loop `sequence += 1` | `CUS-…` for bulk import |

Failure modes, all reachable:

1. **Race.** Two concurrent `POST /api/loans` read the same `count(*)` and generate the same `LN-nnnn`. One insert violates `loans_code_unique` and surfaces as a 500. There is no sequence, no advisory lock, and `nextCode()` runs on `getDb()` **outside** any transaction (`scoped-resource.ts:89`).
2. **Reuse after purge.** `count(*)` includes soft-deleted rows, so a soft delete does not lower the counter. But `permanentDelete` (`recycle-bin.ts:221`) physically removes the row, the count drops, and the next insert regenerates a code that a purged record already used — now present in `audit_logs` and in a retained bin snapshot pointing at a different entity.
3. **Permanent collision on `transactions` / `ledger_entries`.** Their unique indexes are not partial (§3.3), so a soft-deleted row keeps its code reserved while the counter has already moved past it — every subsequent insert after a restore-and-recreate cycle risks a hard failure.
4. **Scope-blind.** `nextCode()` counts the whole table, ignoring bank scope, so codes are global, not per-bank. That is probably intended but is nowhere stated.

### 12.3 Bank soft-delete orphans its children

`banks.routes.ts:145-155` soft-deletes a bank: `banks.deleted_at` is set, a bin entry is written, and nothing else changes.

- `customers.bank_id → banks.id` is `ON DELETE restrict` (`0000_init.sql:251`), but **a soft delete is an `UPDATE`, so the FK never fires**.
- `customers` list and detail queries filter on `customers.deleted_at` only (`customers.routes.ts:97, 148`) and never join `banks`. Customers of a deleted bank remain fully visible and editable.
- The same holds for `loans`, `bank_orders`, `disbursements`, `settlements`, `transactions`, `documents`, all of which carry a `restrict` FK to `banks`.
- `bankScope()` resolves ids from `user_bank_access`, which is untouched by the soft delete, so scoped users keep their access.
- **`permanentDelete` on a bank will fail** if any customer or operations row still references it: `recycle-bin.ts:221` issues a real `DELETE`, and the `restrict` FKs reject it. The bin entry is left un-purged and the transaction rolls back.

There is no cascading soft delete and no "orphaned records" report.

### 12.4 PII handling

| Field | Storage | Reference |
| --- | --- | --- |
| Aadhaar | **Never stored in the clear.** `aadhaar_hash` = `sha256(pepper + ":" + digits)`; `aadhaar_last4` = last 4 digits for display. | `customers.routes.ts:78-84`; `lib/password.ts:35-37` |
| PAN | **Plaintext** in `customers.pan`. Validated (`^[A-Z]{5}\d{4}[A-Z]$`, `customers.routes.ts:47-54`), uppercased, not hashed, not masked on read. | `domain.ts:112` |
| Bank account number | **Plaintext** in `customers.account_no`. Max 40 chars, no format validation. | `domain.ts:117`; `customers.routes.ts:60` |
| Mobile / alt mobile / email / address | Plaintext | `domain.ts:106-111` |
| Date of birth | Plaintext `timestamptz` | `domain.ts:100` |

Notes and caveats:

- The pepper is a single global value, `AADHAAR_PEPPER` (`config/env.ts:25`), defaulting to `"dev-only-pepper-change-me!!"`. Production boot refuses to start on the default (`config/env.ts:44-47`). There is no per-row salt, so the hash supports the intended duplicate detection but is a deterministic, dictionary-attackable digest over a 12-digit space — an attacker with the pepper and the database can enumerate every Aadhaar in roughly 10¹² hashes, and without the pepper the hash is still a stable cross-row join key.
- Rotating the pepper invalidates every stored hash; there is no re-hash path.
- `aadhaar_hash` is **not** unique-indexed, so the duplicate detection the hash exists for is not actually enforced anywhere.
- `services/audit.ts:18-27` redacts `aadhaar`, `aadhaarHash`, `aadhaar_hash`, and password/token fields from audit diffs — but **not** `pan`, `account_no`, `mobile`, `dob` or `address`. Editing a customer's PAN writes both the old and new PAN into `audit_logs.changes`, in a table that cannot be updated or deleted (§8.1). There is no redaction or expiry path for that data.
- `recycle_bin_entries.snapshot` stores the complete customer row, PII included, as jsonb. It is withheld from the list API (`admin.routes.ts:829`) but retained indefinitely after a purge (`recycle-bin.ts:223-226`), by design (`recycle-bin.ts:197-202`).
- No column-level encryption, no `pgcrypto`, no masking view.

### 12.5 Structural issues summary

| # | Issue | Section |
| --- | --- | --- |
| 1 | One CHECK constraint (`loans.status`, 2026-09-05); every other invariant is application-level | §12.1 |
| 2 | `count(*)` code generation: races, reuse after purge, permanent collisions | §12.2 |
| 3 | Bank soft delete orphans customers and blocks later purge | §12.3 |
| 4 | PAN and account number stored in plaintext; PAN leaks into the immutable audit log | §12.4 |
| 5 | 6 of 12 `BIN_REGISTRY` types have no reachable delete route | §3.4 |
| 6 | `users`, `teams`, `roles` are soft-deletable but absent from the bin — unrestorable | §3.4 |
| 7 | Retention (`purge_after`) is written but never acted upon — `expiredEntries()` has no callers | §3.4 |
| 8 | `touch_updated_at` covers 5 of 15 lifecycle tables | §3.1 |
| 9 | `roles.level`, `role_permissions` and the last super admin are guarded only in application code; `TRUNCATE` defeats the audit trigger | §8.4 |
| 10 | `ledger_entries.balance` is documented as derived and is in fact client-supplied | §7.9 |
| 11 | `transactions_code_unique` / `ledger_entries_code_unique` are not partial, breaking soft-delete symmetry | §3.3 |
| 12 | `app_settings` and `assignment_history` are entirely dead tables | §6.3, §7.12 |
| 13 | `notifications` has three routes and zero producers | §7.11 |
| 14 | `funding_sources.bank_id` and `ledger_entries.bank_id` are nullable but scoped unconditionally, hiding null-bank rows from scoped users | §7.2, §7.9 |
| 15 | The `lifecycle` const is not shared with `identity.ts` / `domain.ts`; 5 tables duplicate it literally | §3.1 |
| 16 | Status vocabularies are declared in the schema and consumed by nothing; Zod re-declares them inline | §11.2 |
| 17 | `refresh_tokens` rows are never garbage-collected; expired and revoked sessions accumulate forever | §4.5 |
| 18 | `import_rows` / `import_batches` are never cleaned up after expiry | §6.5 |
| 19 | Seed's super-admin existence check uses `eq(users.email, …)` against a `lower(email)` unique index | §10.2 |
