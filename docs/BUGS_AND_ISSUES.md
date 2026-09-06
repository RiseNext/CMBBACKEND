# Bug and Issue Register

**Repository:** `Risenext-Banking-CRM` — Banking / Lending Operations CRM
**Baseline commit:** `7ef5da5` *Add frontend-only employee demo*
**Working tree at time of writing:** DIRTY — 8 modified files, 4 untracked files (the employee create / temporary-password / reset / forced-change work).
**Register compiled:** 2026-08-31

> **Tree-state note (2026-09-01, Task 0.2).** The employee-management work is now **committed as `583897f`**. Every "Present at: working tree" / "HEAD + working tree" annotation below should now be read as **"present on `main`"** — the two states have merged. No entry in this register was resolved by that commit: the register already described the post-work state. The HEAD-only employee defects it *did* fix (temp password discarded, fabricated "Reset link sent" toast, fake deactivate, fake settings password change, role defaulting to Super Admin) were never open entries here — they are recorded in [AUDIT_VERIFICATION.md](AUDIT_VERIFICATION.md) §2 and [CURRENT_STATE.md](CURRENT_STATE.md) §1.

## How to read this document

Every entry below was re-verified against source before being written. Line
references are `path:line` against the **working tree** unless the entry says
otherwise. Each entry carries a **Present at** field with one of three values:

| Value | Meaning |
| --- | --- |
| `HEAD + working tree` | The defect exists identically in the committed code and in the uncommitted work. |
| `HEAD only` | The uncommitted work already fixes it. Documented so the fix is not lost. |
| `Working tree only` | The defect was introduced by the uncommitted work. |

Anything that could not be confirmed from source is marked **UNVERIFIED** and
labelled as such. Nothing in this register is inferred from comments,
documentation, or naming — only from code that was read.

Files changed in the working tree, for reference:

| File | State |
| --- | --- |
| `src/lib/password.ts` | modified — adds `generateTemporaryPassword()` |
| `src/modules/admin.routes.ts` | modified — adds `POST /users/:id/reset-password`, `teamId` on create |
| `src/modules/auth.routes.ts` | modified — `mustChangePassword` on the profile payload |
| `src/services/access.ts` | modified — `mustChangePassword` on `AuthContext` |
| `frontend/src/app/(app)/employees/page.tsx` | modified — real create / reset / revoke wiring |
| `frontend/src/app/(app)/settings/page.tsx` | modified — real password change |
| `frontend/src/components/layout/app-shell.tsx` | modified — forced-password-change route guard |
| `frontend/src/hooks/use-auth.tsx` | modified — `mustChangePassword` on `SessionUser` |
| `src/tests/employee-lifecycle.test.ts` | untracked — 25 new cases |
| `frontend/src/app/(app)/change-password/page.tsx` | untracked |
| `frontend/src/components/shared/credential-handover.tsx` | untracked |
| `frontend/src/lib/password-policy.ts` | untracked |

---

## Summary

| ID | Severity | Feature | Present at | Status |
| --- | --- | --- | --- | --- |
| [BUG-001](#bug-001) | CRITICAL | Authentication / demo mode | HEAD + working tree | ✅ **RESOLVED** 2026-09-01 (Tasks 1.1–1.3) |
| ~~[BUG-002](#bug-002)~~ | ~~CRITICAL~~ | Loans, bank orders, disbursement, settlements, transactions, documents, customers | ~~HEAD + working tree~~ | ✅ **CLOSED 2026-09-06** — 4 by Phases 4–5, the remaining 9 by Phase 6–10. Pinned by `fake-controls.test.tsx`. **See the scope caveat in the entry: 17 *other* dishonest controls remain and were never counted here** |
| [BUG-003](#bug-003) | CRITICAL | User administration | HEAD + working tree | ✅ **RESOLVED** 2026-09-02 (Tasks 2.1 + 2.2) |
| [BUG-004](#bug-004) | CRITICAL | Documents | HEAD + working tree | OPEN |
| [BUG-005](#bug-005) | MEDIUM | Authentication / forced password change | HEAD + working tree | RESOLVED 2026-09-02 (Task 2.3) |
| [BUG-006](#bug-006) | HIGH | Notifications | HEAD + working tree | OPEN |
| [BUG-007](#bug-007) | HIGH | Reports | HEAD + working tree | OPEN |
| [BUG-008](#bug-008) | HIGH | Reports | HEAD + working tree | OPEN |
| [BUG-009](#bug-009) | HIGH | Ledger | HEAD + working tree | OPEN |
| [BUG-010](#bug-010) | HIGH | Ledger | HEAD + working tree | OPEN |
| ~~[BUG-011](#bug-011)~~ | HIGH | Record code generation (7 resources) | HEAD + working tree | ✅ **CLOSED 2026-09-05** (Task 4.9) |
| [BUG-012](#bug-012) | HIGH | Authentication / account lockout | HEAD + working tree | OPEN |
| [BUG-013](#bug-013) | HIGH | Banks / recycle bin | HEAD + working tree | OPEN |
| [BUG-014](#bug-014) | HIGH | CSV export (every list screen) | HEAD + working tree | OPEN |
| ~~[BUG-015](#bug-015)~~ | MEDIUM | Loans | HEAD + working tree | ✅ **CLOSED 2026-09-05** (Task 5.1) |
| ~~[BUG-039](#bug-039)~~ | ~~LOW~~ | Loans | ~~HEAD + working tree~~ | ✅ **CLOSED 2026-09-06 (Wave 1)** — the column carried `key: "type"` while the field is `loanType`, so `DataTable`'s `row[column.key] ?? "—"` fallback rendered an em dash for every row. An explicit `render` now makes the column independent of the key. **The same defect existed unregistered on the employees Role column** (`key: "role"` vs `roleName`) and is fixed with it. Regression: `reports-load-and-dates.test.tsx` case 7 |
| ~~[BUG-016](#bug-016)~~ | ~~MEDIUM~~ | Audit log | ~~HEAD + working tree~~ | ✅ **CLOSED 2026-09-06 (Wave 4, Task 12.5)** — the same defect as **SEC-014**. The bank-scope disjunct is parenthesised; nothing else about the predicate changed. **Reversion-proven: 5 of 21 cases in `audit-query.test.ts` fail against the pre-fix code.** Two corrections from measurement: it was never a cross-tenant leak (case 12 asserts that separately), and it was **unreachable with the seeded roles** — `audit_logs.view` is held only by Super Admin and Admin, and Admin also holds `system.access_all_banks`, so `ctx.bankIds` was `null` for both. It needed the bespoke bank-scoped auditor the permission catalogue anticipates, which the tests create through the real route |
| [BUG-017](#bug-017) | MEDIUM | Global search / customer profile | HEAD + working tree | ✅ **FIXED** 2026-09-02 (Task 1.9) |
| [BUG-018](#bug-018) | MEDIUM | Dashboard | HEAD + working tree | OPEN |
| [BUG-019](#bug-019) | MEDIUM | User administration / recycle bin | ~~HEAD + working tree~~ | ✅ **CLOSED — Task 2.9 / D-030.** Register was stale; corrected 2026-09-05, Wave 0 |
| [BUG-020](#bug-020) | MEDIUM | User administration | HEAD + working tree | RESOLVED 2026-09-03 (Task 2.5) |
| [BUG-021](#bug-021) | MEDIUM | Excel import | HEAD + working tree | OPEN |
| [BUG-022](#bug-022) | MEDIUM | HTTP / CORS | HEAD + working tree | ✅ **RESOLVED** 2026-09-02 (Task 1.6) |
| ~~[BUG-023](#bug-023)~~ | ~~MEDIUM~~ | Navigation / RBAC | ~~HEAD + working tree~~ | ✅ **CLOSED 2026-09-06 (Wave 4, Task 12.10)** — `NavItem` gains a permission, and `visibleNavSections()` filters the sidebar **and** the Ctrl+K palette against the session's real grants. **Not security** (**D-089**): the API still enforces every route and each screen keeps its own honest refusal for direct URL access. 17 cases across all five seeded roles |
| [BUG-024](#bug-024) | MEDIUM | Notifications | HEAD + working tree | OPEN |
| [BUG-025](#bug-025) | LOW | Data fetching | HEAD + working tree | OPEN |
| [BUG-026](#bug-026) | LOW | Banks, disbursement, documents | HEAD + working tree | OPEN |
| [BUG-027](#bug-027) | ~~LOW~~ | Customers (backend routing) | — | ❌ **INVALID — misdiagnosis** 2026-09-02 (Task 1.9) |
| [BUG-028](#bug-028) | LOW | Multiple pages | HEAD + working tree | OPEN |
| [BUG-029](#bug-029) | LOW | Multiple pages | HEAD + working tree | OPEN |
| [BUG-030](#bug-030) | LOW | Customers | HEAD + working tree | OPEN |
| [BUG-031](#bug-031) | MEDIUM | Demo mode / Settings | Working tree only | ✅ **FIXED** 2026-09-01, same task that introduced it (1.2) |
| [BUG-032](#bug-032) | MEDIUM | Demo mode / layout | HEAD + working tree | ✅ **FIXED** 2026-09-02 (Task 1.4) |
| [BUG-033](#bug-033) | HIGH | Build tooling / demo gating | HEAD + working tree | ✅ **FIXED** 2026-09-02 (Task 1.10) |
| [BUG-034](#bug-034) | MEDIUM | Authentication / session state | HEAD + working tree | ✅ **FIXED** 2026-09-02 (Task 1.8) |
| [BUG-035](#bug-035) | LOW | Operations list endpoints | HEAD + working tree | **OPEN** — found in Task 1.9. ⚠️ **Its sibling was closed 2026-09-06 (Wave 2):** `error-handler.ts` now maps `23514` (CHECK violation) so migration `0014`'s nine new constraints cannot turn a data-integrity refusal into a 500. **`22P02` — a malformed uuid in a `filterable` query param — is still unmapped and still 500s.** Audit item U-10, half done |
| [BUG-036](#bug-036) | HIGH | Partial updates (users, banks, customers, + 9 factory routers) | HEAD + working tree | RESOLVED 2026-09-02 |
| [BUG-037](#bug-037) | MEDIUM | User administration / concurrency | HEAD + working tree | OPEN — found in Task 2.1, deliberately deferred |
| [BUG-038](#bug-038) | HIGH | Teams / authorization | HEAD + working tree | ✅ **FIXED** 2026-09-03 (BUG-038 remediation) |

Counts: **1 CRITICAL, 8 HIGH, 4 MEDIUM, 6 LOW — 19 open**, of **39 recorded**.

> **Wave 4 movement, 2026-09-06.** **BUG-016 CLOSED** (the audit-filter precedence defect, also registered as SEC-014) and **BUG-023 CLOSED** (the sidebar offering every screen to every role). −2 MEDIUM open; 21 → 19.
>
> ⚠️ **BUG-004 and BUG-006 are still deliberately open**, unchanged from Wave 0's note below. Wave 4 did not re-read either one against code, and closing a finding on the strength of a neighbouring change is exactly what that note forbids.

> **Wave 1 movement, 2026-09-06.** **BUG-039 CLOSED** (−1 LOW open), together with its unregistered twin on the employees Role column. 22 → 21 open.

> **Recount, 2026-09-06 (Wave 0) — the previous tally disagreed with its own table in four places.** It read *"3 CRITICAL, 9 HIGH, 8 MEDIUM, 6 LOW — 26 open, of 35 recorded"*. The table already held **39** `BUG-` entries: the recorded total had not been incremented since BUG-035, so BUG-036 through BUG-039 existed in the table and were absent from the count. The severity split was also wrong independently of BUG-002 — the table supported 2/8/6/7 = 23 open before this session, not 3/9/8/6 = 26.
>
> The figures above are **recomputed mechanically from the summary table**, counting a row as closed when its status contains RESOLVED, CLOSED, FIXED or INVALID. **The only status this session changed is BUG-002's**, and it changed by measurement. This is audit item **U-13**.
>
> **Open, by id** *(as at Wave 4; BUG-016, BUG-023 and BUG-039 have since closed)***:** BUG-004 · BUG-006 · BUG-007 · BUG-008 · BUG-009 · BUG-010 · BUG-012 · BUG-013 · BUG-014 · BUG-018 · BUG-021 · BUG-024 · BUG-025 · BUG-026 · BUG-028 · BUG-029 · BUG-030 · BUG-035 · BUG-037.
>
> ⚠️ **Two of these look closable and are deliberately left OPEN.** **BUG-004** records `documents.storage_key` as a column nothing ever writes — Phase 9.4 made the server write it from `buildStorageKey`. **BUG-006** records notifications as having zero producers — Phase 10.3 added five. Both probably close. Neither is closed here, because Wave 0's mandate is to make the tally honest, not to adjudicate findings it has not re-read one at a time against code — which is exactly the discipline that made BUG-002's closure trustworthy. **Re-verify both before Phase 11 starts**; if they close, the register drops to 20 open with **zero CRITICAL**.

> **Phase-label warning, unchanged.** The `### Roadmap phase` fields in the entries below use **obsolete numbering**. Grepping this file for "Phase 5" returns the *reporting* bugs, not Phase 5's. Those labels are not authoritative — follow [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md).

> **Task 1.9 register movements, 2026-09-02.** **BUG-017 FIXED** (−1 MEDIUM open). **BUG-027 reclassified INVALID** — it was a misdiagnosis, nothing was broken, so it leaves the open count without being counted as a fix (−1 LOW open). **BUG-035 added** and left OPEN (+1 LOW open). Net: 28 → 27 open, 34 → 35 recorded.

> **Register correction, 2026-09-02.** BUG-031 was written up by the Task 1.2 session but never added to this table; BUG-032 is new. Both are above. The open count drops from 30 to 29 because **BUG-001 is resolved** — the two additions are already fixed and add nothing to it.

> **BUG-038 remediation register movements, 2026-09-03.** **BUG-038 FIXED** (−1 HIGH open). Net: 27 → 26 open; 35 recorded, unchanged. No new defect was found while closing it. Recorded as **[SEC-029](SECURITY_AUDIT.md#sec-029)** in the security register at the same time — the first privilege-boundary finding raised after the original audit.

> **Task 2.5 register movements, 2026-09-03.** **BUG-020 FIXED** (−1 MEDIUM open). **BUG-038 added** and left OPEN (+1 HIGH open). Found while investigating BUG-020 and recorded rather than fixed, per RULES §10.

> **Task 2.1 + 2.2 register movements, 2026-09-02.** **BUG-003 FIXED** (−1 CRITICAL open). **BUG-036 added** and left OPEN (+1 HIGH open). **BUG-037 added** and left OPEN (+1 MEDIUM open). Net: 27 → 28 open, 35 → 37 recorded. Both additions were found while closing BUG-003 and are recorded rather than fixed, per RULES §10.

---

# CRITICAL

<a id="bug-038"></a>
## BUG-038 — `PUT /api/teams/:id/members` applies no per-member authorization, so a Manager can enrol or evict a Super Admin

| Field | Value |
| --- | --- |
| **ID** | BUG-038 |
| **Severity** | HIGH |
| **Feature** | Teams / authorization |
| **Location** | `src/modules/admin.routes.ts:826-901` (the fix); the defect was at `:826-859` |
| **Present at** | HEAD — fixed in the working tree |
| **Status** | ✅ **RESOLVED 2026-09-03** |

> ### ✅ RESOLVED — 2026-09-03
>
> The handler now authorizes **every affected member** inside the transaction it already had, using the same `assertCanManageRoleLevel` the other nine hierarchy-bearing routes call. No authorization function was modified, no role name is compared, no new endpoint was added, and the response contract is byte-identical.
>
> **The affected set is `previous ∪ submitted`, not `submitted`.** This is the part that actually closes the bug. Because the write replaces the whole roster, omitting a name is an act upon that person exactly as much as adding one is — authorizing only the submitted list would have left the measured eviction path completely open. See **[D-027](DECISIONS.md)**, which also records the alternative that was rejected.
>
> | Reproduction (Manager, level 20, holds `teams.assign`) | Before | After |
> |---|---|---|
> | Add a Super Admin | **200, placed** | **403**, roster unchanged |
> | Add an Admin | **200, placed** | **403** |
> | Add a peer Manager | **200, placed** | **403** |
> | Submit a roster omitting an existing Super Admin | **200 — evicted silently** | **403**, victim still on the roster |
> | Non-existent `userId` | **409** *"still referenced by other records"* | **400** *"One or more users do not exist"* |
> | Soft-deleted user | **200, row written** | **400** |
> | Add an Executive / a Team Leader | 200 | **200 — unchanged** |
> | Super Admin adds an Admin, or clears a roster | 200 | **200 — unchanged** (`system.manage_any_user`) |
> | Inactive user | 200 | **200 — unchanged**; deactivation is not deletion |
> | Employee scoped to another bank | 200 | **200 — unchanged, deliberately.** Teams carry no bank column and are documented "Not bank-scoped" (`claude/PROJECT_CONTEXT.md:71`); adding a scope check would be new policy, not a fix. |
>
> The audit row now carries `changes: { members: { from, to } }`, so an eviction is recoverable from the log by difference — the question the old row could not answer.
>
> **Two regressions the fix itself introduced, caught by adversarial review and fixed before it landed.** Both were reproduced over real HTTP before being believed, and both now have their own tests:
>
> 1. **An actor who was on the team could no longer edit that team's roster** — not even to remove themselves. Their own row entered `previous`, so the union check ran `assertCanManageRoleLevel` against their own level, and "strictly greater" means nobody outranks themselves. Measured **403** for keep-self, remove-self and add-self alike. Reachable through normal use: `POST /api/users` places a new employee on a team at creation. The actor is now excluded from the hierarchy loop **by identity, not by level** — `team_members` is never consulted by any authorization decision (`services/access.ts` does not mention teams at all), so joining or leaving a team grants and removes nothing. A test asserts a *peer* at the same level is still refused, so the exclusion cannot be widened into a level check.
> 2. **An uppercase uuid for a live user was rejected 400 "One or more users do not exist"** — the same class of untruth the fix was written to remove. Postgres emits uuids lower-cased and `z.uuid()` accepts any case without normalising, so the raw request id never matched the id read back. Submitted ids are now canonicalised once at the boundary, which also makes case variants of one id dedupe correctly instead of violating the `(team_id, user_id)` primary key.
>
> **43 tests** in `src/tests/team-membership.test.ts`, every refusal asserting both the roster in the database *and* that no audit row was written. Reversion-proven with six mutations, each failing exactly what it should: narrowing the affected set to `submitted` fails **3** (all evictions), removing the hierarchy loop fails **10**, removing the existence check fails **3**, dropping the audit `changes` fails **3**, removing the self-exclusion fails **3**, and dropping the id canonicalisation fails **3**. Backend **302/302** across 13 files.
>
> **One deviation from the fix sketched below**, decided on evidence: members are resolved by a single batched read rather than a `targetUserRole` call per member, and a bad id returns **400**, not `targetUserRole`'s 404. `PRD.md:1267` (NFR-SEC-10) reserves 404 for path-id lookups, and `PRD.md:257` already sets the precedent — *"A non-existent bank id returns `400`"*. Here the missing thing is in the payload; the team in the path was found. The existence check is also applied to **submitted** ids only: soft-deleting a user leaves their `team_members` rows behind, so requiring every prior member to be live would make any team containing a departed employee permanently unmanageable.

### Problem

The handler applied **exactly one** check — `requirePermission(PERMISSIONS.teams.assign)` — and then a team-exists lookup. Between that gate and the write there is **no** `assertCanManageRoleLevel`, no `assertBankAccess`, no check that each `userId` exists or is not soft-deleted, and no per-member loop of any kind.

Because the write is a whole-roster replace — `await tx.delete(teamMembers).where(eq(teamMembers.teamId, id))` followed by an insert of the submitted list — the omission cuts both ways: anyone with `teams.assign` can **add** any user to a team, and can **evict** any user by simply leaving them out of the list.

`manager` holds `teams.assign` by seed (`lib/permissions.ts`), at role level 20. `super_admin` is level 0.

### Evidence

Measured over real HTTP with a bespoke level-15 actor holding `users.assign` + `teams.assign` and scoped to one bank:

```
PUT /api/teams/:id/members { userIds: [<super-admin>, <out-of-scope executive>] }
  -> 200
  placedCount=2  superAdminPlaced=true  outOfScopePlaced=true
  perMemberRoleCheck = NONE
```

The same actor is refused by `PATCH /api/users/<super-admin>` at `assertCanManageRoleLevel`, and refused by `PUT /api/users/<super-admin>/banks` for the same reason (**403** in both cases, measured). The hierarchy rule this codebase states once is simply not consulted on the team-membership path.

### Why it matters

- **The one hierarchy rule is bypassable.** `PROJECT_CONTEXT.md` §5 describes a single rule producing the whole authorization model; this route ignores it.
- **Silent eviction.** The audit row records only `Set N member(s) on team X` with **no `changes` from/to**, so evicted members are not recoverable from the log — unlike `PUT /users/:id/banks`, which records `{ banks: { from, to } }`.
- **No bank scope.** A Manager scoped to bank X can enrol users scoped to bank Y.
- **No referent validation.** A non-existent `userId` hits the FK and surfaces as a raw **409 conflict**, not a `400`, unlike the banks route's explicit `throw badRequest("One or more banks do not exist")`.

### Exposure while it was open

`PUT /api/teams/:id/members` had **zero frontend callers** throughout — verified by exhaustive grep. That bounded the exposure to a direct API caller holding `teams.assign` (seeded: `super_admin`, `admin`, `manager`), and it is why this was recorded rather than fixed inside Task 2.5. Roadmap **2.7** wires this route to the UI; it was blocked on this fix and is now unblocked.

### Fix as originally sketched

Mirror `PUT /users/:id/banks`: resolve each submitted `userId` through `targetUserRole`, apply `assertCanManageRoleLevel` per member, reject a non-existent or soft-deleted user with `badRequest`, and record `changes: { members: { from, to } }` in the audit row. Decide separately whether eviction should additionally require authority over the members being removed, not just those being added.

That open question was the substance of the bug, and it was answered **yes** — see the RESOLVED block above and **[D-027](DECISIONS.md)**. Resolving it any other way would have left the eviction path open.

---

<a id="bug-036"></a>
## BUG-036 — `schema.partial()` injects `.default()` values, so a one-field PATCH overwrites stored data

| Field | Value |
| --- | --- |
| **ID** | BUG-036 |
| **Severity** | HIGH |
| **Feature** | Partial updates — users, banks, customers, service providers, and the nine routers built on `createScopedResource` |
| **Location** | `src/lib/zod.ts` (the fix); previously `admin.routes.ts:42-58` (schema; defaults at `:49`, `:51`, `:52`) and six `.partial()` call sites |
| **Present at** | HEAD + working tree |
| **Status** | RESOLVED 2026-09-02 |

> ### RESOLVED — 2026-09-02
>
> One shared helper, `patchSchema()` in **`src/lib/zod.ts`**, strips `ZodDefault` wrappers before applying `.partial()`. Applied at **all six** `.partial()` call sites — `admin.routes.ts` (users **and** roles), `banks.routes.ts`, `customers.routes.ts`, `operations.routes.ts` (service providers) and **`scoped-resource.ts`, which alone covers nine routers**.
>
> Uses only zod's public surface — `.shape`, the exported `z.ZodDefault` class and its documented `.unwrap()`. Nothing reaches into `_def`/`_zod`, so a zod upgrade cannot silently change the result. The inner schema is reused **by reference**, so every `min`/`max`, enum, uuid, email, coercion and field-level `.transform()`/`.refine()` still runs on a value the caller does send. Only the "what if it is missing" answer changes — from "substitute the default" to "leave it out". Base/create schemas were **not** touched, so POST still applies every default it always did.
>
> **Verified after the fix**, same reproductions that found it, measured over real HTTP with DB assertions:
>
> | Reproduction | Before | After |
> |---|---|---|
> | Inactive employee + `{name}` | `status Inactive→Active`, login **403→200**, `target 8,000,000→0`, `achieved 3,250,000→0` | `Inactive→Inactive`, login **403→403**, figures **unchanged** |
> | Paused bank + `{name}` | `Paused→Active`, `commissionRate 2.75→0`, `productsOffered→[]` | all three **unchanged** |
> | Verified/Closed customer + `{name}` | `monthlyIncome 250,000→0`, `kyc Verified→Pending`, `status Closed→Active` | all three **unchanged** |
> | Approved loan + `{notes}` | every money column →0, `status Approved→Draft`, `priority High→Normal` | all nine fields **unchanged** |
>
> **27 regression tests** in `src/tests/partial-update.test.ts`, all asserting database state rather than status codes — a 200 was never the problem. Reversion-proven: making `patchSchema` stop stripping defaults fails **19 of 27**. Backend suite **242/242**.
>
> **Scope correction.** This entry originally read *"A name-only `PATCH /users/:id` …"* and was filed under **User administration**. That understated it: the same `.partial()` + `.default()` shape existed in five more places, and three of them (`scoped-resource.ts`, `banks.routes.ts`, `customers.routes.ts`) spread the parsed body **wholesale with no `!== undefined` guard at all**, making them strictly more destructive than the users case. The title, feature and location above were corrected on 2026-09-02 rather than a second finding being filed. `rolesRouter` shares the parse shape but writes only `name`/`description`/`level`, so its `permissions: []` default never reached the database — no defect there, and none introduced.
>
> **The live exposure was not hypothetical.** Both PATCH call sites that exist in the frontend today tripped it: `employees/page.tsx:222` ("Revoke access"/"Restore access", body `{ status }`) zeroed the employee's `target` and `achieved` on **every click**, and `banks/page.tsx:97` (pause/resume, body `{ status }`) wiped `commissionRate` and `productsOffered`. Neither needed the not-yet-built edit dialog.
>
> **Interaction with SEC-003 / Task 2.1 — now genuinely correct rather than accidentally correct.** The note below said "both new guards compare `input.status` against the value already stored". That was only half true while this bug existed: the self-guard did, but `assertSuperAdminRemains` received a fabricated `"Active"` and the `?? target.status` fallback at `admin.routes.ts:317` was unreachable dead code. The fix makes `input.status` genuinely `undefined` when omitted, so that fallback is now the live path and the statement is true for both guards. Covered by a dedicated test (`partial-update.test.ts`, group C, "`input.status ?? target.status` is now genuinely reachable"): renaming an **Inactive** Super Admin must leave them Inactive. No SEC-003 behaviour changed — `super-admin-lockout.test.ts` still passes 26/26 unmodified.

### Problem

`userInput` declares three fields with defaults:

```ts
status: z.enum(["Active", "Inactive"]).default("Active"),
target: z.coerce.number().int().min(0).default(0),
achieved: z.coerce.number().int().min(0).default(0),
```

`PATCH` parses the body with `userInput.partial()`. **In zod 4.4.3 `.partial()` does
not suppress `.default()`** — it wraps each field in `ZodOptional`, and the default
still fires when the key is absent. So every partial update arrives with
`status: "Active"`, `target: 0` and `achieved: 0` already populated, and the
conditional spread at `:331-333` writes all three because they are not `undefined`.

### Evidence

Measured over real HTTP (supertest + PGlite), one `PATCH` sending only `{ name }`:

```
http=200
status    Inactive -> Active
target     5000000 -> 0
achieved    250000 -> 0
name    Test User 2 -> Only A Rename
```

And directly against the schema:

```
userInput.partial().parse({ name: "Renamed Self", phone: "9848012345" })
  -> { name: "Renamed Self", status: "Active", target: 0, achieved: 0, phone: "9848012345" }
```

### Why it matters

**Revoked access is silently restored by an unrelated edit.** Deactivation is the
only way this product removes an employee's access short of deletion — it is what
the "Revoke access" button does, and what `services/access.ts:59` enforces on every
request. Correcting a typo in a revoked employee's name hands their account back,
with a `200` and no indication that anything but the name changed. The audit row
does record the `status` transition, but nothing surfaces it.

The `target`/`achieved` reset is a data-loss defect on the same line: those are the
employee's sales figures, and Task 2.4's edit dialog will PATCH without them.

### Relationship to other entries

- **Not** [BUG-020](#bug-020), which is the opposite failure — `teamId`, `bankIds`
  and `joinedOn` are accepted and *discarded*. This one **invents** values for
  fields the caller never sent. Roadmap **2.5** covers BUG-020 and should absorb
  this too.
- **It does not weaken [SEC-003](SECURITY_AUDIT.md#sec-003--irreversible-super-admin-lockout-via-patch-apiusersid)'s fix**, and that was checked rather than assumed: the injected default is
  `"Active"`, which is the *safe* direction, and both new guards compare
  `input.status` against the value already stored. No lockout path opens. It does
  mean a PATCH on an inactive Super Admin reactivates them — an unwanted
  reactivation, never an unwanted deactivation.

### Fix — as implemented

The originally-proposed fix (a second hand-written `userPatchInput` schema) was
rejected during implementation: it solves one route and would need repeating at
six call sites, drifting from its create counterpart every time a field is added.
A single derivation helper keeps one schema per resource as the source of truth:

```ts
// src/lib/zod.ts
export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ]),
  ) as WithoutDefaults<T>;

  return z.object(shape).partial();
}
```

It returns a `ZodObject`, so the roles route can still chain `.omit({ key: true })`.
See **D-024**.

---

<a id="bug-037"></a>
## BUG-037 — The last-super-admin invariant is check-then-write with no lock, so two concurrent requests can both pass

| Field | Value |
| --- | --- |
| **ID** | BUG-037 |
| **Severity** | MEDIUM |
| **Feature** | User administration / concurrency |
| **Location** | `src/services/access.ts:253-275`; callers at `admin.routes.ts:313`, `:492` |
| **Present at** | HEAD + working tree — **pre-existing on `DELETE` since the first commit**, and inherited by `PATCH` in Task 2.1 |
| **Status** | OPEN — **deliberately deferred by Task 2.1**, see D-022 |

### Problem

`assertSuperAdminRemains` counts, returns, and then the caller writes. The count
and the write are separate autocommit statements with no row lock and no
transaction. Two simultaneous requests removing the last two Super Admins both
observe `remaining = 1`, both pass, and the population reaches zero.

This is **not new** — `DELETE`'s original inlined guard had exactly the same shape
(`count` at `:445-449`, `update` at `:453-456`, `recordAudit` at `:458-463`, three
independent round trips). Task 2.1 preserved it deliberately rather than making
this the codebase's first row lock.

### Scope — this is a class, not one site

Repository-wide survey: **11 `db.transaction` call sites, zero row locks, zero
`FOR UPDATE`, zero advisory locks, zero isolation-level settings, zero
optimistic-concurrency version columns.** Check-then-write is the *established*
pattern — e.g. the role-holder count at `admin.routes.ts:674-681`, which has the
same race. `pool.max` is 5 in development and 10 in production, so real
concurrency exists.

### Why it was not fixed in Task 2.1

The defect Task 2.1 existed to close is **one administrator, one mis-click** — a
single-actor path, now fully closed. The race needs two simultaneous destructive
requests against the same two rows. Introducing `SELECT … FOR UPDATE` here alone
would leave ten unprotected siblings and would not be a coherent architecture.

### Fix

Treat the whole class at once (Phase 13): wrap each guarded mutation in a
transaction and take `FOR UPDATE` on the rows the precondition counted, or move to
`SERIALIZABLE` for these handlers with a retry. Either is a cross-cutting change
that needs its own decision record.

### Not testable today

The PGlite harness runs a single in-process connection, so a concurrency test
there would prove nothing. This needs a real Postgres with two connections —
which the suite does not have.

---

<a id="bug-035"></a>
## BUG-035 — Unvalidated uuid query filters: `?customerId=<non-uuid>` returns 500 on six list endpoints

| Field | Value |
| --- | --- |
| **ID** | BUG-035 |
| **Severity** | LOW |
| **Feature** | Operations list endpoints (factory-generated) |
| **Location** | `src/modules/scoped-resource.ts:115-120`; declared at `operations.routes.ts:63, 195, 227, 260, 333, 390` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN — **found during Task 1.9, deliberately not fixed there** |

### Problem

The same root cause as [BUG-017](#bug-017), through a different input channel.
`createScopedResource`'s `filterable` loop puts a raw query-string value straight
into an `eq()`:

```ts
for (const field of config.filterable ?? []) {
  const value = req.query[field];
  if (typeof value === "string" && value.length > 0) {
    extra.push(eq(table[field] as PgColumn, value));
  }
}
```

There is no zod schema on this path — `listQuery` (`scoped-resource.ts:47-52`)
covers only `page`, `pageSize`, `search` and `bankId`. **14 of the declared
`filterable` keys are uuid-typed columns** across 6 list endpoints:
`customerId` (loans, bank-orders, disbursements, transactions, documents),
`loanId` (verifications, bank-orders, disbursements, transactions, documents),
`assignedUserId`, `assignedTeamId`, `serviceProviderId`, `fundingSourceId`.

### Evidence

Measured against the real application:

```
GET /api/loans?customerId=CUS-10001      -> 500 {"error":{"code":"internal_error", ...}}
GET /api/documents?customerId=CUS-10001  -> 500  (same)
GET /api/loans?customerId=<real uuid>    -> 200
GET /api/customers?bankId=not-a-uuid     -> 422  (zod-guarded, for contrast)
```

The last two lines are the point: the **same** parameter shape is a clean 422
when zod sees it and a 500 when the `filterable` loop does.

### Why it is not reachable by a user today

Before Task 1.9 it was. `customers/[id]/page.tsx:62-72` passed the route segment
to three sibling `useResource` calls as `{ customerId }`, so one command-palette
click produced **four** 500s — one from the path parameter and three from here.
Task 1.9 fixed the palette to link by `id`, so all four now carry a real uuid.
Verified: `GET /api/loans?customerId=<uuid>` → 200.

It is now reachable only by a hand-typed URL or a bookmark saved before the fix.

### Recommended fix

Not a `22P02` mapping in the error handler — see [DECISIONS.md](DECISIONS.md)
D-021 for why that was rejected. Validate in the factory, where one change
covers all 14 keys: give `filterable` an optional per-field zod schema, or infer
`uuid` from the Drizzle column type and parse before `eq()`.

### Roadmap phase

Phase 8 — Frontend/API contract cleanup, with the other 45 parameterised
endpoints. Not Phase 1.

---

<a id="bug-034"></a>
## BUG-034 — A deactivated account's session stayed visible to the client, because every 403 looked the same

**Severity:** MEDIUM · **Status:** ✅ **FIXED 2026-09-02** (Task 1.8) · **Found:** 2026-09-02, during the Task 1.8 investigation · **Present at:** HEAD + working tree

### Problem

`loadAuthContext` re-reads the account on **every** request, so deactivating an employee took effect server-side immediately. The client never noticed. `apiRequest` had a sign-out ladder for **401 only**; a deactivated user's requests came back **403**, fell through to the generic error path, and the shell stayed mounted with their name and role in the sidebar while every panel silently failed.

The reason it could not simply be fixed client-side: **403 is deliberately overloaded here.** Measured against the real app, every one of these returned the *same* `code`:

| Situation | Status | Code | Message |
|---|---|---|---|
| **Account deactivated** | 403 | `forbidden` | `Account is not active` |
| **Assigned role disabled** | 403 | `forbidden` | `Assigned role has been disabled` |
| Missing permission | 403 | `forbidden` | `Missing required permission: reports.view` |
| Outside bank scope | 403 | `forbidden` | `You do not have access to this resource` |
| Role-hierarchy refusal | 403 | `forbidden` | various |
| **Demo layer, fabricated** | 403 | `forbidden` | `You do not have access to this resource` |

The last row is **byte-identical** to the bank-scope row. Signing out on a bare 403 would have logged real users out for opening a page their role cannot see, and ended a presenter's demo mid-walkthrough.

### Severity, stated accurately

**This was never an authorization bypass.** The backend refused every request from a deactivated account correctly. And the session did not survive indefinitely: once the access token expired (`ACCESS_TOKEN_TTL`, default **15 minutes**), the next request 401'd, `refreshAccessToken()` called `/auth/refresh`, which re-runs `loadAuthContext` and also failed — so `forceSignOut()` fired.

The defect was therefore a **window of up to 15 minutes** in which the UI looked healthy and nothing loaded. A session-state and UX problem, not an access-control hole. The roadmap's wording — *"stays visually logged in while every request fails"* — was true only within that window.

### Fix (Task 1.8)

Two dedicated error codes for the two **session gates** in `services/access.ts`, which fire on every request regardless of what was asked for:

- `account_inactive` — the account is no longer `Active`
- `role_disabled` — the assigned role has been disabled

Status stays **403** (the caller genuinely is authenticated) and the response shape is unchanged. Every ordinary authorisation refusal keeps `forbidden`. Soft-deletion keeps its **401**.

`apiRequest` calls the existing `forceSignOut()` when it sees one of those two codes **and** an access token is currently held. No message parsing, no path matching, no new logout mechanism. See [DECISIONS.md](DECISIONS.md) D-020.

### Verified in both directions

| Reversion | Result |
|---|---|
| Remove the sign-out branch — the original defect | **2 tests fail** — deactivation no longer ends the session |
| Sign out on **any** 403 — the plausible over-broad fix | **1 test fails** — an ordinary `forbidden` logs the user out |

11 backend tests and 7 frontend tests. The frontend tests assert the authenticated state **before and after** the request, so a pass cannot be explained by the session never having existed.

---

<a id="bug-033"></a>
## BUG-033 — The build banner reports `demo module: EXCLUDED` while the webpack build includes it

**Severity:** HIGH · **Status:** ✅ **FIXED 2026-09-02** (Task 1.10) · **Found:** 2026-09-02, by adversarial review of the Task 1.5 supersession decision

**This is the reporting half of [SEC-027](SECURITY_AUDIT.md); the security analysis lives there.** It is recorded separately because [RULES.md](claude/RULES.md) §4 makes "a security control that reports being enabled when it is not" a first-class defect class in this repository — the same class as the 2FA switch it calls *"the worst example in the repository"*.

**Problem.** `frontend/next.config.ts:44-47` prints which demo variant the build produced. It reports what was **configured** (`NEXT_PUBLIC_ENABLE_DEMO` + `NODE_ENV`), not what the bundler actually **did**. `turbopack.resolveAlias` is honoured only by Turbopack, so:

```
$ npm run build -- --webpack          # no env vars set
[next.config] demo module: EXCLUDED (NEXT_PUBLIC_ENABLE_DEMO=unset, NODE_ENV=production)
… printed four times, exit 0 …
$ grep -rl "Demo@12345" .next/static
.next/static/chunks/4532-….js
```

The operator is told the demo was excluded, by the very line `SECURITY_AUDIT.md` offered as a safety property, while the credential and all fabricated PII ship.

**Why it matters more than a wrong log line.** SEC-001 was closed on a manual build-output search. There is no automated guard — `vitest.config.ts` includes only `src/**/*.test.{ts,tsx}`, so nothing inspects `.next`. The banner was the only per-build signal, and it is wrong on the path where it matters.

**Fixed (Task 1.10).** The banner now reads the bundler from `process.env.TURBOPACK` and names the mechanism it actually applied:

```
[next.config] demo module: EXCLUDED via webpack alias (bundler=webpack, NEXT_PUBLIC_ENABLE_DEMO=unset, NODE_ENV=production)
```

More importantly, **a false `EXCLUDED` is now structurally impossible rather than merely less likely**: `lib/demo/config.ts` carries a tripwire that throws when the demo module is reachable from a demo-disabled production build, and `next build` prerenders on the server, so the build fails instead of shipping. A banner claiming `EXCLUDED` over a build that included the demo can no longer be produced — that build does not complete. Asserted by `demo-build-isolation.test.ts` group C and by `npm run verify:demo-exclusion`. See [DECISIONS.md](DECISIONS.md) D-017 and [SECURITY_AUDIT.md](SECURITY_AUDIT.md) SEC-027.

---

<a id="bug-032"></a>
## BUG-032 — Demo mode had no on-screen signal once the sidebar was collapsed (fixed by Task 1.4)

**Severity:** MEDIUM · **Status:** ✅ **FIXED 2026-09-02** (Task 1.4) · **Found:** documented from the outset as roadmap Task 1.4 and [RULES.md](claude/RULES.md) §3; never carried a BUG id until now

**Problem.** The only on-screen indication that the data was fabricated was a caption in the sidebar's footer card:

```tsx
// sidebar.tsx:118 — the wrapper
{!collapsed && (
  <div className="mb-3 rounded-lg bg-white/5 p-3">
    …
    {demo && <p …>Preview workspace · sample data</p>}   // :127-131
  </div>
)}
```

Collapsing the sidebar removed it. So did being on mobile with the drawer shut — the default there. What remained on screen was seven fabricated customers with structurally valid PANs, real-prefix mobile numbers, valid IFSC codes and loan amounts, with **nothing anywhere saying they were invented**. In a lending business shown to a client, an unlabelled screen of that is a claim about a real pipeline.

Two lesser faults in the same caption: *"Preview workspace · sample data"* never states the data is not real, and it sat below *"Signed in as Executive"*, which reads as a genuine session.

**Fix (Task 1.4).** `components/layout/demo-mode-indicator.tsx` — a banner in `AppShell` above the topbar and outside the sidebar subtree, a badge inside the `sticky` topbar so the signal survives scrolling, and the sidebar marker lifted out of the `!collapsed` wrapper so it shrinks to its icon instead of unmounting. Neither component accepts a prop that could hide it. See [DECISIONS.md](DECISIONS.md) D-015.

**Verified against the real regression, not restated.** The test mounts the whole `AppShell` in a live demo session, clicks the actual collapse control, asserts the sidebar genuinely collapsed, then asserts the indicators are still in the document. **Two independent reversions fail it:** removing the banner from `AppShell`, and re-hiding the sidebar marker when collapsed.

**Known and deliberately not fixed:** the indicator's UI copy ("Demo mode", "sample data", "Nothing is real") is present in the production bundle, in a component that can never render there — `isDemoMode()` is a compile-time `false`, but it is an imported call, so the minifier cannot prove the strings dead. This is UI text, not fixture data and not a credential; SEC-001's build-output evidence is unaffected and was re-verified after the change. Gating it would mean adding exports to `demo-disabled.ts` and enlarging the surface D-014 must keep in lockstep, for no security gain.

**Also still true:** `isDemoMode()` is read as a plain render expression rather than reactive state, so a flag planted by devtools mid-render does not surface an indicator until the next render. Same caveat already recorded against [SEC-026](SECURITY_AUDIT.md).

---

<a id="bug-031"></a>
## BUG-031 — Demo Settings password form transmitted a typed credential (introduced and fixed within Task 1.2)

**Severity:** MEDIUM · **Status:** ✅ **FIXED same task** · **Found:** 2026-09-01, by adversarial review

**What happened.** Task 1.2 correctly stopped `/auth/change-password` being answered by fixtures — but `/settings` **is** a demo route (`demo/config.ts:67`) and its Security tab calls that exact path with no demo gating. The change therefore turned a contained in-tab 404 into a **real cross-origin POST carrying whatever the presenter typed**, from a session whose stated premise is that nothing leaves the tab and that it works with the backend stopped (`demo/api.ts:5-7`, `demo/config.ts:11-12`). With the backend down — the demo's normal operating mode — the toast degraded from a coherent "Endpoint not found" to a raw *"Failed to fetch"*.

**Fix.** An early return in `handlePasswordUpdate` (`settings/page.tsx:288`): the demo account is not a database record and has no password to change, so it now says so and sends nothing.

**Not caught by the test suite, and honestly so.** The natural test mirrors the guard's condition in the test body rather than executing the component, which makes it tautological — it passes even with the guard deleted. That was verified, and the test was **removed rather than kept as false assurance**. Real coverage needs page-level rendering, which needs React Testing Library and is deferred to Phase 14. **This guard is currently protected by code review only.**

**Lesson worth keeping.** The regression came from reasoning about `/auth/change-password` as "an auth path" without checking which *screens* reach it. A transport-layer change needs a caller-by-caller review, not just a path-by-path one.

**Scope after Task 1.3 (2026-09-01).** The guard is now a **demo-build-only** concern: in a production build `isDemoMode()` is a compile-time `false`, so the early return never fires and the Security tab behaves exactly as it always has for real users. It remains necessary — and untested — in `npm run dev` and in a client-demo build, which is where presenters actually type into that form.



<a id="bug-001"></a>
## BUG-001 — Demo mode is sticky and silently hijacks every real login attempt

> ## ✅ **FIXED — Task 1.1, 2026-09-01.** Status: **OPEN → RESOLVED.**
>
> **Fix.** `disableDemoMode()` + `resetDemoData()` now run at three points, all in the frontend:
> 1. `frontend/src/hooks/use-auth.tsx` — in `signIn`'s **real** branch, *after* the demo-credential check and *before* the request is built. Ordering is the fix: clearing first would break entering the demo; clearing later would not stop the diversion.
> 2. `frontend/src/hooks/use-auth.tsx` — in the `onForcedSignOut` handler, so a session ending never leaves the tab in demo mode.
> 3. `frontend/src/app/login/page.tsx` — a **mount-only** effect calling the new `exitDemoSession()`. Mount-only is deliberate: on every render it would clear the flag `signIn` had just set, in the window before `router.push` leaves the page, and demo sign-in would break.
>
> **Plus a race the original analysis missed.** In a contaminated tab, `AuthProvider`'s `/auth/refresh` is *already in flight* when the login page mounts; clearing the flag does not cancel it, and it resolved ~140 ms later and re-set the demo user — re-trapping the tab. `use-auth.tsx` now captures `startedInDemo` before the call and discards the response if the demo was exited while it was in flight.
>
> **Verified.** 11 frontend tests in `frontend/src/hooks/use-auth.demo-boundary.test.tsx`. **3 of them fail against the pre-fix code** — confirmed by temporarily reverting the `signIn` clear and re-running. Backend suite still 107/107.
>
> **Task 1.2 follow-up (2026-09-01) — the transport half.** `apiRequest` now consults an allow-list (`lib/api.ts` `requiresRealBackend`): the demo may answer **only** `/auth/refresh`; every other `/auth/*` path reaches the real backend even when the flag is set by devtools, tab duplication, or any future `enableDemoMode()` call. Six further tests drive `apiRequest` directly, bypassing Task 1.1's clearing, so only the transport guard can make them pass — **2 fail if the guard is removed**. See [DECISIONS.md](DECISIONS.md) D-013.
>
> **Task 1.3 (2026-09-01) — the exposure half, and the end of this bug.** The demo module is no longer compiled into a production build at all: `next.config.ts` aliases `@/lib/demo` to the inert `lib/demo-disabled.ts` unless `NEXT_PUBLIC_ENABLE_DEMO=true`, so `src/lib/demo/` never enters the module graph. `isDemoMode()` becomes a compile-time `false`, which means **the sticky flag has nothing left to be sticky about** — planting it by hand in devtools on a deployed site reaches no fixture layer, because there is none. 10 further tests; **3 fail** if the substitute's `isDemoMode()` is made to read storage. Proven against the built output, not the source: 256 demo-exclusive string literals, **0** present in `.next/static`. See [DECISIONS.md](DECISIONS.md) D-014 and [SECURITY_AUDIT.md](SECURITY_AUDIT.md) SEC-001.
>
> **All three layers now hold:** the flag is cleared on entry into a real session (1.1); a real auth request cannot be answered by fixtures even when it is set (1.2); and in production the fixtures do not exist (1.3). **SEC-001 is closed.**

| Field | Value |
| --- | --- |
| **ID** | BUG-001 |
| **Severity** | CRITICAL |
| **Feature** | Authentication / demo mode |
| **Location, as found** | `frontend/src/hooks/use-auth.tsx:174-204`, `frontend/src/lib/api.ts:118-127`, `frontend/src/lib/demo/api.ts:240-250`, `frontend/src/lib/demo/session.ts:36-41` |
| **Present at** | HEAD + working tree |
| **Status** | ✅ **RESOLVED 2026-09-01** (Tasks 1.1 + 1.2 + 1.3) |

### Problem

`signIn` has two branches. The demo branch calls `enableDemoMode()`, which
writes a flag into `sessionStorage`. The real branch never calls
`disableDemoMode()`. `disableDemoMode` has exactly **one** call site in the
whole frontend — inside `signOut`'s demo branch — confirmed by exhaustive grep:

```
frontend/src/hooks/use-auth.tsx:212:      disableDemoMode();
```

Meanwhile `apiRequest` short-circuits on that same flag before any URL is even
built. So while the flag is set, a real `POST /auth/login` never leaves the
browser; it is routed into the demo handler, which does not implement `login`
and throws a 404.

### Evidence

`frontend/src/hooks/use-auth.tsx:174-197` — the real branch, with no flag clear:

```ts
      if (isDemoCredentials(email, password)) {
        enableDemoMode();

        setAccessToken(null);
        setUser(DEMO_SESSION_USER);
        persistAuthUser(null);

        return;
      }

      const body = await apiRequest<{
        accessToken: string;
        user: SessionUser;
      }>("/auth/login", {
        method: "POST",
        body: { email, password },
        skipAuthRetry: true,
      });
```

`frontend/src/lib/api.ts:118-127` — the short-circuit:

```ts
  if (isDemoMode()) {
    try {
      return await demoRequest<T>(path, options);
    } catch (error) {
      if (error instanceof DemoHttpError) {
        throw new ApiError(error.status, error.code, error.message);
      }
      throw error;
    }
  }
```

`frontend/src/lib/demo/api.ts:240-250` — `login` is not handled:

```ts
function auth(action: string, method: string): unknown {
  if (action === "refresh" && method === "POST") {
    return { accessToken: "", user: DEMO_SESSION_USER };
  }
  if (action === "logout" && method === "POST") return { data: null };
  if (action === "me" && method === "GET") return { data: DEMO_SESSION_USER };
  throw notFound("Endpoint");
}
```

### Expected behaviour

Entering real credentials on the login form authenticates against the API and
starts a real session, regardless of whatever the tab was doing before.

### Actual behaviour

If the demo flag is set in `sessionStorage` and `user` is `null` — which is the
state of the tab between mount and the completion of the `/auth/refresh`
bootstrap in `AuthProvider` (`use-auth.tsx:116-142`), and any state reached
without going through `signOut` — the real login is answered locally with
`ApiError(404, "not_found", "Endpoint not found")`. The login page surfaces that
verbatim (`frontend/src/app/login/page.tsx:55`), so the user sees "Endpoint not
found" and has no way to recover except by clearing browser storage. The demo
data key is likewise left behind by any path that does not run `signOut`.

### Impact

A production user who has ever touched the presentation account in that tab is
locked out of the real system with an error message that gives no indication of
the cause or the remedy. There is no UI affordance anywhere in the app that
clears the flag other than the demo Sign out button.

### Recommended fix

Call `disableDemoMode()` unconditionally at the top of `signIn`'s real branch,
and again in `AuthProvider`'s bootstrap effect when a real refresh succeeds. As
defence in depth, make the demo router answer `POST /auth/login` by exiting demo
mode and re-dispatching over the network, or refuse to short-circuit `/auth/*`
paths entirely.

### Roadmap phase

Phase 1 — Authentication hardening.

---

<a id="bug-002"></a>
## BUG-002 — Thirteen write actions were pure theatre: they toast success and issue no request — ✅ **ALL THIRTEEN CLOSED**

| Field | Value |
| --- | --- |
| **ID** | BUG-002 |
| **Severity** | CRITICAL |
| **Feature** | Loans, bank orders, disbursement, settlements, transactions, documents, customers |
| **Location** | See table below |
| **Present at** | HEAD + working tree |
| **Status** | ✅ **CLOSED 2026-09-06.** 4 of 13 closed by Phases 4–5; the remaining **nine** closed by the Phase 6–10 block. |

> ### ✅ CLOSED — 2026-09-06
>
> **All nine remaining controls now issue a real, awaited HTTP request, and the toast follows the server's answer rather than preceding it.** Delivered by the Phase 6–10 block: 6.1 and 6.2 (bank-order stage and remarks), 7.1 and 7.2 (mark credited, re-initiate), 8.3 and 8.4 (settle, dispute), 8.5 (`markPaid`), 9.6 (upload, download, preview) and 9.9.
>
> **Two of them deliberately call the approve route, not `PATCH`, and the roadmap rows said `PATCH`.** Following the rows literally would have reopened one resource over the privilege bypass **D-056** closed for loans: `edit` is a lower bar than `approve`. The server now refuses `status` on `PATCH` for both resources, so a `PATCH`-based control would be a 422 every time (**D-066**).
>
> **Pinned, not merely fixed.** `fake-controls.test.tsx` (CMBFRONTEND: `src/app/(app)/fake-controls.test.tsx`) drives all nine through the **real pages** and asserts the one thing a screenshot cannot: that a request actually left the page. One group inverts it — when the server refuses, no success is claimed and the row does not move. The file fails if any control regresses to a toast. Verified green 2026-09-06 as part of **949/949** frontend tests.
>
> ### ⚠️ Scope caveat — this closure is narrower than it sounds
>
> **BUG-002 counted thirteen controls on the business screens. It never counted the settings or reports pages.** The master production-readiness audit of 2026-09-06 found **17 further controls** that claim an outcome and issue no request. They are **not** covered by `fake-controls.test.tsx` and they are **not** closed by this entry:
>
> | Where | Controls | Owner |
> |---|---|---|
> | `settings/page.tsx` | "Save changes" (profile — local state only), avatar change/remove (`avatarFile` is explicitly discarded), company record (6 uncontrolled inputs), invoice numbering (3), bank "Logging enabled" switch, alert preferences (5 switches), delivery channels (3, no handler at all), preferences (3, no handler), default-landing-page select, the **fabricated three-row active-sessions table**, its per-session "Sign out", the **2FA switch reporting "2FA enabled"**, "Reset demo data" (a bare `window.location.reload()`) | 12.6, **12.7 (OPEN-8)**, 12.8 |
> | `reports/page.tsx` | "Excel" (an HTML table named `.xls`), "PDF" (`window.print()` then *"PDF ready"*), the permanently empty trend chart | 11.4, 11.5 |
> | `hooks/use-api.ts` | `useStats` swallows a 403 and `num()` returns `0`, so an Executive sees a dashboard of **₹0 indistinguishable from a genuinely empty book** | audit **U-4**, unowned |
>
> **Phase 16.3's Definition of Done — *"confirm zero fake handlers remain"* — is not met by this closure.** For most of the seventeen the honest minimum is deletion, not implementation.

> **Register corrected 2026-09-05, Wave 0.** Every handler below was re-read against the working tree. **Four entries were already fixed or deleted and the register still listed all thirteen as open**; the count in the title, the per-row statuses and two narrative claims were stale. Corrections are marked inline. The nine live cases map to rows **6.1, 6.2, 7.1, 7.2, 8.1, 8.3, 8.4** and **9.7 (×2)**.
>
> **Also corrected:** the claim elsewhere in this entry that *"two whole files issue **zero** write calls"* is now true of **`bank-orders/page.tsx` only** — `customers/[id]/page.tsx` issues real writes since Tasks 4.1/4.2.
>
> **Not a fake handler, and never was:** `recordDisbursal` (`disbursement/page.tsx:56-79`) awaits a real `api.create` at `:63` and toasts at `:75` **after** the write succeeds, with an error path at `:76-78`. A toast following an awaited successful write is not theatre. *(A Phase 5 close-out note in `PRODUCTION_ROADMAP.md` briefly mislabelled it; that note is corrected.)*

### Problem

Thirteen handlers that present themselves to the user as writes call
`refresh()` and/or `toast.success(...)` and nothing else. No `api.*` call, no
`apiRequest`, no `fetch`. In several cases they also mutate local component
state so the UI *appears* to have changed until the row is re-fetched. The
matching backend endpoint exists in every case and is never called.

### Evidence

| # | Handler | Location (re-verified 2026-09-05) | Backend endpoint | Status |
| --- | --- | --- | --- | --- |
| 1 | ~~`updateStatus` (Approve / Reject)~~ | ~~`loans/page.tsx:68`~~ → now `decide()` at **`:360`**, calling `api.action` at **`:374`** | `POST /api/loans/:id/approve` | ✅ **CLOSED — Task 5.4** |
| 2 | `moveStage` | `frontend/src/app/(app)/bank-orders/page.tsx:58-62` | `PATCH /api/bank-orders/:id` | 🔴 OPEN — **6.1** |
| 3 | `saveRemark` | `frontend/src/app/(app)/bank-orders/page.tsx:64-73` | `PATCH /api/bank-orders/:id` | 🔴 OPEN — **6.2** |
| 4 | `markCredited` | `frontend/src/app/(app)/disbursement/page.tsx:81-85` | `POST /api/disbursements/:id/approve` | 🔴 OPEN — **7.1** |
| 5 | `retry` | `frontend/src/app/(app)/disbursement/page.tsx:87-91` | **creates a NEW disbursement** (D-066; the Failed row is immutable) | 🔴 OPEN — **7.2** |
| 6 | `markPaid` | `frontend/src/app/(app)/settlements/page.tsx:35-42` | `POST /api/settlements/:id/approve` | 🔴 OPEN — **8.3** |
| 7 | `raiseDispute` | `frontend/src/app/(app)/settlements/page.tsx:44-48` | `POST /api/settlements/:id/approve` | 🔴 OPEN — **8.4** |
| 8 | `settle` | `frontend/src/app/(app)/transactions/page.tsx:36-40` | `PATCH /api/transactions/:id` | 🔴 OPEN — **8.1** |
| 9 | `setStatus` | `frontend/src/app/(app)/documents/page.tsx:104-107` | `PATCH /api/documents/:id` | 🔴 OPEN — **9.7** |
| 10 | `remove` | `frontend/src/app/(app)/documents/page.tsx:109-112` | `DELETE /api/documents/:id` | 🔴 OPEN — **9.7 / 9.8** |
| 11 | ~~Save changes (customer edit dialog)~~ | ~~`customers/[id]/page.tsx:458-464`~~ → now `saveEdit` at **`:334-379`**, `api.update` at **`:355`** | `PATCH /api/customers/:id` | ✅ **CLOSED — Task 4.1** |
| 12 | ~~Delete (customer delete dialog)~~ | ~~`customers/[id]/page.tsx:483-492`~~ → now `confirmDelete` at **`:395-416`**, `api.remove` at **`:402`** | `DELETE /api/customers/:id` | ✅ **CLOSED — Task 4.2** |
| 13 | ~~`handleManualFormUpload`~~ | **GONE** — zero occurrences anywhere in `frontend/`; removal documented in place at `customers/page.tsx:315-327` | — | ✅ **DELETED — Task 4.4** (D-043 named 4.4 as owner) |

> **Entry 13 is still cited as live in eight other documents** (`ARCHITECTURE.md`, `BUSINESS_FLOW.md`, `PRD.md`, `INTEGRATION_MAP.md`, `AUDIT_VERIFICATION.md`, `TESTING_STRATEGY.md` and this file's own appendix). Those references are stale; they are recorded here rather than swept, because sweeping unrelated documents is outside the Phase 6–10 block.
>
> **Still fake and owned elsewhere:** "Print" (`customers/[id]/page.tsx`) → **11.4**. **Still fake and UNOWNED:** three controls in `settings/page.tsx`, including a **2FA switch that reports "2FA enabled" for a feature that does not exist** — that one is **OPEN-8**, whose text already states leaving it *"is not an option"* on a banking application.

`frontend/src/app/(app)/loans/page.tsx:68-74`:

```tsx
  function updateStatus(loan: Loan, status: LoanStatus) {
    refresh();
    setSelected((prev) => (prev ? { ...prev, status } : prev));
    toast.success(`Marked ${status.toLowerCase()}`, {
      description: `${loan.id} · ${customerName(loan.customerId)}`,
    });
  }
```

`frontend/src/app/(app)/settlements/page.tsx:35-42`:

```tsx
  function markPaid(row: Settlement) {
    const settledOn = new Date().toISOString().slice(0, 10);
    refresh();
    setSelected((prev) => (prev ? { ...prev, status: "Paid", settledOn } : prev));
    toast.success("Settlement closed", {
      description: `${row.invoiceNo} marked paid for ${bankName(row.bankId)}`,
    });
  }
```

`frontend/src/app/(app)/customers/[id]/page.tsx:456-465`:

```tsx
            <Button
              onClick={() => {
                setEditOpen(false);
                toast.success("Profile updated", { description: `${customer.name} saved.` });
              }}
            >
              Save changes
            </Button>
```

`frontend/src/app/(app)/customers/page.tsx:232-244`:

```tsx
  function handleManualFormUpload(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    toast.success("Written form uploaded", {
      description:
        `${file.name} has been queued for verification.`,
    });

    event.target.value = "";
  }
```

Two whole files issue **zero** write calls of any kind:
`app/(app)/bank-orders/page.tsx` and `app/(app)/customers/[id]/page.tsx`.
A separate, non-write instance of the same pattern is the Print button at
`app/(app)/customers/[id]/page.tsx:185`, which toasts "Sent to printer" without
invoking `window.print()`.

### Expected behaviour

Approving a loan, moving a bank order stage, marking a disbursement credited,
closing a settlement, verifying or deleting a document, and editing or deleting
a customer each persist to the API and reflect the server's response.

### Actual behaviour

The user is told the operation succeeded. Nothing is written. The optimistic
local state survives until the next refetch, at which point the row silently
reverts to its old value. No audit-log row is created either, because the audit
trail is written by the endpoints that were never called.

### Impact

Operationally the worst class of defect in this codebase: staff will believe
files were approved, money was marked credited, invoices were settled, and KYC
documents were verified. Reconciliation, commission settlement, and the audit
trail all diverge from what operators believe happened. Case 13 additionally
tells the user a physical KYC form was "queued for verification" while the
`File` object is read and discarded on the next line.

### Recommended fix

Replace each handler with the corresponding `api.update` / `api.action` /
`api.remove` call, awaited, with error handling that surfaces the API message
and does **not** toast success on failure. Gate each control behind the
matching `can(...)` check. Until then, disable the controls rather than leave
them clickable.

### Roadmap phase

Phase 2 — Wire the write path.

---

<a id="bug-003"></a>
## BUG-003 — `PATCH /users/:id` has neither a self-guard nor a last-super-admin guard, and the UI exposes a one-click permanent lockout

| Field | Value |
| --- | --- |
| **ID** | BUG-003 |
| **Severity** | CRITICAL |
| **Feature** | User administration |
| **Location** | `src/modules/admin.routes.ts:251-314` (PATCH) versus `src/modules/admin.routes.ts:434-451` (DELETE); trigger at `frontend/src/app/(app)/employees/page.tsx:219-231` and `:491-498` |
| **Present at** | HEAD + working tree (the route is byte-identical in both; the working tree adds the UI button that triggers it) |
| **Status** | ✅ **RESOLVED 2026-09-02** (Tasks 2.1 + 2.2) |

> ### ✅ RESOLVED — Tasks 2.1 + 2.2, 2026-09-02
>
> `PATCH` now carries a **field-scoped** self-guard (`admin.routes.ts:282-310`) and calls the **shared** `assertSuperAdminRemains` helper (`services/access.ts:183-275`), which `DELETE` also calls. Self-deactivation and self-demotion off the system role are `400`; any change that would leave zero Active, non-deleted, system-role users is `409`.
>
> **The one-click UI path is closed at the backend, which is the only place it counts.** `employees/page.tsx:219-231` still renders "Revoke access" for every row including your own — that button is gated only by `can("users.edit")`, a client-side check. It now receives a `400` with `"You cannot deactivate your own account"`, which `toggleStatus`'s catch surfaces through `toast.error("Could not change access", { description })`. No frontend change was made or needed; hiding the button is Task 2.4's business.
>
> **Harmless self-edits still work** — name, phone, branch, and a full-form save that echoes the current `status` and `roleId`. That is why the guard is field-scoped rather than a copy of `DELETE`'s unconditional refusal. See **D-022**.
>
> Full security write-up: [SEC-003](SECURITY_AUDIT.md#sec-003--irreversible-super-admin-lockout-via-patch-apiusersid). 26 regression tests in `src/tests/super-admin-lockout.test.ts`; nine fail against the pre-fix code.

### Problem

`DELETE /users/:id` carries two protections. `PATCH /users/:id` carries
neither, and `status` is a field `PATCH` accepts. Setting your own status to
`Inactive` is therefore equivalent to deleting yourself, with none of the
checks. A Super Admin holds `system.manage_any_user`, so
`assertCanManageRoleLevel` returns immediately without comparing levels
(`src/services/access.ts:144-149`), meaning the actor's own row is a
legal target.

`loadAuthContext` then refuses every subsequent request for that account:

```ts
  if (row.status !== "Active") throw forbidden("Account is not active");
```
— `src/services/access.ts:52`

There is no self-service reactivation route. Reactivation requires
`users.edit`, which requires an active account.

### Evidence

The guards that exist on DELETE, `src/modules/admin.routes.ts:436-451`:

```ts
    const id = req.params.id as string;
    if (id === ctx.userId) throw badRequest("You cannot delete your own account");

    const target = await targetUserRole(id);
    assertCanManageRoleLevel(ctx, target.roleLevel);

    // The last active super admin must not be removable, or the system locks out.
    if (target.roleIsSystem) {
      const [{ remaining = 0 } = {}] = await getDb()
        .select({ remaining: count() })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(and(eq(roles.isSystem, true), eq(users.status, "Active"), isNull(users.deletedAt)));
      if (remaining <= 1) throw conflict("The last active Super Admin cannot be removed");
    }
```

The complete guard set on PATCH, `src/modules/admin.routes.ts:254-267`:

```ts
    const id = req.params.id as string;
    const input = userInput.partial().parse(req.body);
    const db = getDb();

    const target = await targetUserRole(id);
    // Blocks editing a peer or a superior, which is what stops an Admin
    // touching a Super Admin.
    assertCanManageRoleLevel(ctx, target.roleLevel);

    if (input.roleId && input.roleId !== target.roleId) {
      const nextRole = await roleOrThrow(input.roleId);
      assertCanAssignRole(ctx, nextRole);
    }
```

The UI that fires it, `frontend/src/app/(app)/employees/page.tsx:219-231`:

```tsx
  async function toggleStatus(employee: Employee) {
    const status = employee.status === "Active" ? "Inactive" : "Active";
    try {
      await apiRequest(`/users/${employee.id}`, { method: "PATCH", body: { status } });
```

and the button, `frontend/src/app/(app)/employees/page.tsx:491-498`:

```tsx
                {can("users.edit") && (
                  <Button
                    variant={selected.status === "Active" ? "destructive" : "success"}
                    onClick={() => toggleStatus(selected)}
                  >
                    {selected.status === "Active" ? "Revoke access" : "Restore access"}
                  </Button>
                )}
```

`GET /users` (`admin.routes.ts:85-157`) returns the caller's own row, so the
actor's own record is clickable in the very table this dialog opens from.

### Expected behaviour

An actor cannot deactivate their own account, and the last active Super Admin
cannot be deactivated by anyone — the same rules `DELETE` already enforces.

### Actual behaviour

A Super Admin who opens their own row in Employees and clicks **Revoke access**
sends `PATCH /users/<self> {status:"Inactive"}`, receives `200 OK`, and is
locked out on their next request. If they are the only Super Admin, the
installation has no path back short of direct SQL against the database.

### Impact

Irreversible, single-click, permanent loss of administrative access to a
production banking system, reachable from the product's own UI with no
confirmation dialog. The untracked test suite
`src/tests/employee-lifecycle.test.ts` covers revoke/restore
(`describe("revoking and restoring access")`, lines 327-368) but contains no
case for the self-target or last-super-admin paths, so CI would not catch it —
and there is no CI in this repository regardless.

### Recommended fix

Add to `PATCH /users/:id`, before the update:

1. `if (input.status === "Inactive" && id === ctx.userId) throw badRequest(...)`.
2. The same `roleIsSystem` + `remaining <= 1` conflict check DELETE performs,
   applied whenever `status` moves away from `Active` **or** `roleId` moves off
   a system role.

Extract both into a shared `assertNotLastSuperAdmin(db, targetId, nextStatus)`
so `PATCH`, `DELETE`, and any future route cannot diverge again. Add regression
cases to `employee-lifecycle.test.ts`.

### Roadmap phase

Phase 1 — Authentication hardening / RBAC completeness.

---

<a id="bug-004"></a>
## BUG-004 — Document uploads discard the file; only metadata is stored

| Field | Value |
| --- | --- |
| **ID** | BUG-004 |
| **Severity** | CRITICAL |
| **Feature** | Documents |
| **Location** | `frontend/src/app/(app)/documents/page.tsx:62-102`, `src/modules/operations.routes.ts:380-403` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The Documents screen presents a drag-and-drop uploader with a progress bar. It
stages real `File` objects, then posts **only their name, size, and MIME type**
as JSON. `/api/documents` is a plain JSON CRUD resource produced by
`createScopedResource`; it has no multipart handler, no storage adapter, and no
byte sink. The `documents.storage_key` column exists in the schema and is
accepted by the create schema, but nothing in the backend ever writes it.

### Evidence

`frontend/src/app/(app)/documents/page.tsx:80-90` — the bytes are never sent:

```tsx
      for (const file of staged) {
        await api.create<DocumentRecord>("/documents", {
          customerId: customer.id,
          bankId: customer.bankId,
          docType,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || null,
          status: "Pending",
        });
      }
```

`src/modules/operations.routes.ts:391-402` — the accepting schema:

```ts
  createSchema: z.object({
    customerId: uuidField.optional().nullable(),
    loanId: uuidField.optional().nullable(),
    bankId: uuidField,
    docType: z.string().trim().min(2).max(80),
    fileName: z.string().trim().min(1).max(255),
    fileSize: z.coerce.number().int().min(0).default(0),
    mimeType: z.string().trim().max(120).optional().nullable(),
    storageKey: z.string().trim().max(500).optional().nullable(),
    checksum: z.string().trim().max(128).optional().nullable(),
    status: z.enum(["Verified", "Pending", "Rejected"]).default("Pending"),
  }),
```

The only `multer` usage in the backend is the Excel importer
(`src/modules/imports.routes.ts:26-44`), which uses
`multer.memoryStorage()`, parses the workbook out of `file.buffer`, and lets
the buffer go out of scope. No object storage client, no filesystem write, and
no signed-URL issuer exists anywhere in `backend/`.

### Expected behaviour

An uploaded KYC document is persisted to durable storage, `storage_key` and
`checksum` are recorded, and the document can be retrieved or downloaded later.

### Actual behaviour

A row appears in the documents table naming a file that exists nowhere. The
Download and Eye (preview) affordances on that screen have nothing to resolve.
The customer's actual PAN card, Aadhaar, bank statement, salary slip, or ITR is
discarded by the browser as soon as the dialog closes.

### Impact

For a lending business, KYC document retention is a regulatory obligation. The
system records that a document was collected while destroying it. Combined with
BUG-002 case 9 (`setStatus`), a document can be shown as "Verified" in the UI
while neither the verification nor the file itself exists.

### Recommended fix

Introduce a real storage path: a `POST /api/documents/:id/file` multipart
endpoint (or presigned-URL issuer) backed by S3-compatible object storage,
writing `storage_key`, `file_size`, `mime_type`, and a SHA-256 `checksum`.
Add a matching download endpoint that re-checks bank scope. Until storage
exists, the uploader UI should be removed rather than left as a convincing
simulation.

### Roadmap phase

Phase 3 — Document storage.

---

# HIGH

<a id="bug-005"></a>
## BUG-005 — `mustChangePassword` is enforced only in React; the API accepts every request from a temporary-password account

| Field | Value |
| --- | --- |
| **ID** | BUG-005 |
| **Severity** | MEDIUM — **downgraded from HIGH on 2026-09-02**, see the reconciliation note below |
| **Feature** | Authentication / forced password change |
| **Location** | `frontend/src/components/layout/app-shell.tsx:39-48`; absent from `src/middleware/auth.ts` and every route |
| **Present at** | HEAD + working tree (the employee work was committed in `583897f`) |
| **Status** | RESOLVED 2026-09-02 (Task 2.3) |

> ### RESOLVED — Task 2.3, 2026-09-02
>
> `requireAuth` is now the strict default and raises **403 `password_change_required`** when `ctx.mustChangePassword` is true (`middleware/auth.ts:52-70`). Exactly two routes opt out through `requireAuthAllowPasswordChange` — `GET /api/auth/me` and `POST /api/auth/change-password` — because they are the only ones a flagged account needs in order to stop being flagged.
>
> **No path allow-list was used, and that was a measurement rather than a preference.** Inside `requireAuth`, `req.path` is relative to the router's mount, so the roadmap's proposed `req.path === "/api/auth/change-password"` check would never have matched and would have locked every flagged user out of their own recovery route. Recorded as **D-023**.
>
> Full security write-up: [SEC-010](SECURITY_AUDIT.md#sec-010--mustchangepassword-is-enforced-only-in-react). 18 backend tests in `src/tests/forced-password-change.test.ts` plus 1 frontend test; four mutations reversion-proven.
>
> **Severity reconciliation.** This entry rated the defect **HIGH** while [SEC-010](SECURITY_AUDIT.md) rated the same defect **MEDIUM** — the two registers disagreed, and nothing recorded why. Settled at **MEDIUM** in both: neither authentication nor authorization was ever defeated (every permission, hierarchy and bank-scope check held), and reaching the state needed an administrator-issued temporary password or deploy-dashboard access. That is the register's MEDIUM definition — *a control that is documented or believed to exist does not actually hold* — not its HIGH one, which requires an unauthenticated attacker or exposed regulated data. The measured impact is recorded in SEC-010 rather than softened.

### Problem

The working tree threads `mustChangePassword` from the `users` table through
`AuthContext` and onto the `/auth/me`, `/auth/login`, and `/auth/refresh`
profile payloads. The only thing that acts on it is a client-side redirect.
An exhaustive grep of `src` shows the flag is written and read back but
never asserted:

```
./db/schema/identity.ts:107      (column definition)
./db/seed.ts:121                 (seed sets true)
./modules/admin.routes.ts:208    (set true on create)
./modules/admin.routes.ts:293    (set true on admin password set)
./modules/admin.routes.ts:350    (set true on reset)
./modules/auth.routes.ts:70      (returned on profile)
./modules/auth.routes.ts:93      (selected at login)
./modules/auth.routes.ts:145     (returned in login response)
./modules/auth.routes.ts:245     (cleared on change-password)
./services/access.ts:19,38,82    (carried on AuthContext)
```

There is no occurrence in `src/middleware/`.

### Evidence

`frontend/src/components/layout/app-shell.tsx:39-48` — the entire enforcement:

```tsx
  const mustChangePassword =
    ready && Boolean(user?.mustChangePassword) && pathname !== CHANGE_PASSWORD_ROUTE;

  React.useEffect(() => {
    if (mustChangePassword) router.replace(CHANGE_PASSWORD_ROUTE);
  }, [mustChangePassword, router]);

  // Held on the loading state rather than mounting the page, so a screen the
  // account cannot reach never renders even for a frame.
  if (!ready || !user || outOfScope || mustChangePassword) {
```

`src/middleware/auth.ts:21-31` — `requireAuth` in full, with no check:

```ts
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearerFrom(req);
    if (!token) throw unauthorized("Missing bearer token");
    const claims = verifyAccessToken(token);
    req.auth = await loadAuthContext(getDb(), claims.sub);
    next();
  } catch (error) {
    next(error);
  }
}
```

### Expected behaviour

An account still holding an administrator-issued temporary password can reach
only `POST /auth/change-password`, `POST /auth/logout`, `GET /auth/me`, and
`POST /auth/refresh`. Everything else is refused server-side.

### Actual behaviour

The React shell redirects the browser to `/change-password`, and that is the
whole of it. The access token issued at login is a normal, fully privileged
15-minute JWT. Any client that is not this React app — curl, Postman, a script,
a second browser tab hitting the API directly — has unrestricted access with a
credential the issuing administrator also knows.

### Impact

The temporary password is, by construction, known to two people: the employee
and the administrator who read it off the hand-over dialog. The forced-change
gate is the control that limits that window, and it is bypassable by anyone who
does not use the supplied SPA. Note the app is client-rendered end to end —
there is no `middleware.ts` and no `app/api/` route in `frontend/`, so nothing
sits between the browser and the API.

### Recommended fix

Add a `blockWhilePasswordTemporary` middleware mounted after `requireAuth` on
every router except `authRouter`, returning `403 password_change_required` when
`ctx.mustChangePassword` is true. Keep the client redirect as UX, not as the
control.

### Roadmap phase

Phase 1 — Authentication hardening.

---

<a id="bug-006"></a>
## BUG-006 — Notifications page seeds `useState` from an async list and never syncs

| Field | Value |
| --- | --- |
| **ID** | BUG-006 |
| **Severity** | HIGH |
| **Feature** | Notifications |
| **Location** | `frontend/src/app/(app)/notifications/page.tsx:72-88` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

`useResource` starts with `data: []` (`frontend/src/hooks/use-api.ts:24`) and
fills it when the request resolves. The page passes that initial `[]` as the
*initial value* of a separate `useState`, which React uses only on first render.
When the fetch resolves, `rows` updates and `items` does not. Nothing in the
component watches `rows`.

### Evidence

`frontend/src/app/(app)/notifications/page.tsx:71-88`:

```tsx
export default function NotificationsPage() {
  const { data: rows, loading, error, refresh } = useResource<NotificationItem>("/notifications");
  const activity: ActivityItem[] = [];
  const [items, setItems] = React.useState<NotificationItem[]>(rows);

  const markAll = React.useCallback(() => {
    setItems((prev) => prev.map((item) => ({ ...item, read: true })));
    toast.success("All caught up", { description: "Every alert marked as read." });
  }, []);

  const toggle = React.useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, read: !item.read } : item)));
  }, []);

  const unread = items.filter((item) => !item.read);
```

Every render path — the three tabs, the unread badge, the "N unread of M"
subtitle at line 111 — reads `items`, never `rows`.

### Expected behaviour

The list renders whatever `/notifications` returned.

### Actual behaviour

The list is permanently empty and shows the `EmptyState` at lines 35-43, the
subtitle permanently reads "0 unread of 0", and the "Mark all read" button is
permanently disabled (`disabled={!unread.length}` at line 101). `loading`,
`error`, and `refresh` are destructured and never used.

Additionally, `markAll` and `toggle` mutate local state only. The endpoints
`POST /api/notifications/read-all` (`src/modules/admin.routes.ts:974`)
and `POST /api/notifications/:id/read` (`:987`) exist and are never called from
this page, so a read state would not survive a reload even if the list rendered.

### Impact

The notifications feature is inert. Note that this is currently masked by
BUG-024 — nothing ever creates a notification row — so the two defects hide
each other, and fixing only the producer would still leave this page blank.

### Recommended fix

Delete the mirrored `items` state and render `rows` directly, with
`setData` from `useResource` used for the optimistic update, and wire `markAll`
/ `toggle` to the two existing endpoints with a `refresh()` on success.

### Roadmap phase

Phase 4 — Notifications.

---

<a id="bug-007"></a>
## BUG-007 — Reports memo omits `loans` from its dependency array behind an eslint suppression

| Field | Value |
| --- | --- |
| **ID** | BUG-007 |
| **Severity** | HIGH |
| **Feature** | Reports |
| **Location** | `frontend/src/app/(app)/reports/page.tsx:58-67` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The report body is a `useMemo` over `loans`, but `loans` is not in the
dependency array, and the lint rule that would have caught it is explicitly
suppressed on the line above the array.

### Evidence

`frontend/src/app/(app)/reports/page.tsx:58-67`:

```tsx
  const rows = React.useMemo(() => {
    return loans.filter((loan) => {
      const inRange = (loan.appliedOn ?? loan.createdAt) >= from && (loan.appliedOn ?? loan.createdAt) <= to;
      const matchesBank = bank === "All" || bankName(loan.bankId) === bank;
      const matchesEmployee = employee === "All" || employeeName(loan.assignedUserId) === employee;
      const matchesStatus = status === "All" || loan.status === status;
      return inRange && matchesBank && matchesEmployee && matchesStatus;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, bank, employee, status, applied]);
```

`loans` arrives asynchronously from
`useResource<Loan>("/loans", { pageSize: 500 })` at line 43. `bankName` and
`employeeName` are also omitted; both are recreated whenever `useReference`
resolves (`frontend/src/hooks/use-reference.tsx:86-105`).

### Expected behaviour

The report recomputes when loan data arrives or changes.

### Actual behaviour

The memo runs on mount with `loans === []` and produces `[]`. It does not
recompute when the loans request resolves. Every downstream figure — Records,
Report value, Commission, Approval rate (lines 232-256), the results table
(325-342), and all four exports (Excel, CSV, PDF, Tally) — reads the empty
`rows`. The table renders "Nothing matched this range."

The `applied` counter incremented by the **Apply** button (line 222) *is* in the
deps, so the report only ever populates after the user presses Apply — and the
toast fired alongside it, `${rows.length} records matched` (line 223), reads the
pre-update value, so it reports the previous count.

### Impact

The reporting and export screen for a commission-driven business appears empty
on arrival and produces empty Excel / CSV / PDF / Tally files. Users who do
press Apply get a success toast citing the wrong record count.

### Recommended fix

Remove the suppression and add `loans`, `bankName`, and `employeeName` to the
dependency array. Delete the `applied` counter, which exists only to force
recomputation that correct dependencies would give for free. If a deliberate
"apply on click" UX is wanted, hold the applied filters in a single state object
and derive from that.

### Roadmap phase

Phase 5 — Reporting.

---

<a id="bug-008"></a>
## BUG-008 — Reports default to a hardcoded 2024 date window

| Field | Value |
| --- | --- |
| **ID** | BUG-008 |
| **Severity** | HIGH |
| **Feature** | Reports |
| **Location** | `frontend/src/app/(app)/reports/page.tsx:51-52` and `:126-128` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

Both the initial state and the Reset handler pin the range to a fixed
five-month window in 2024.

### Evidence

`frontend/src/app/(app)/reports/page.tsx:51-52`:

```tsx
  const [from, setFrom] = React.useState("2024-01-05");
  const [to, setTo] = React.useState("2024-05-31");
```

`frontend/src/app/(app)/reports/page.tsx:126-134`:

```tsx
  function reset() {
    setFrom("2024-01-05");
    setTo("2024-05-31");
    setBank("All");
    setEmployee("All");
    setStatus("All");
    setApplied((prev) => prev + 1);
    toast.info("Filters cleared");
  }
```

The filter is a string comparison against `loan.appliedOn ?? loan.createdAt`
(line 60), so any record created after 2024-05-31 is excluded.

### Expected behaviour

The default range is relative to today — current month, quarter, or financial
year — and Reset restores that relative default.

### Actual behaviour

Every user opening Reports sees a window that closed on 2024-05-31. Every
record created since is filtered out, and Reset puts them back into that window.

### Impact

The default report view excludes essentially the entire live book. Users who do
not notice the date inputs will conclude the system has no data; users who do
will re-set the range on every visit.

### Recommended fix

Derive the defaults, e.g. start of the current Indian financial year to today,
computed once with `useState(() => …)`. Extract the default into a single
helper used by both the initialiser and `reset()` so they cannot drift.

### Roadmap phase

Phase 5 — Reporting.

---

<a id="bug-009"></a>
## BUG-009 — Ledger voucher creation is 403 for every bank-scoped user, and NULL-bank entries are invisible to them

| Field | Value |
| --- | --- |
| **ID** | BUG-009 |
| **Severity** | HIGH |
| **Feature** | Ledger |
| **Location** | `frontend/src/app/(app)/ledger/page.tsx:57-78` and `:178-180`; `src/modules/scoped-resource.ts:94-100` and `:177`; `src/services/access.ts:108-127`; `src/modules/operations.routes.ts:366` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

`ledger_entries.bank_id` is nullable, and it is the only resource on the scoped
factory where that is true. The factory was written for mandatory-bank
resources and asserts bank access against the payload unconditionally. The
Ledger UI never sends a `bankId`, so the payload's `bankId` is `undefined`.

`assertBankAccess` treats a missing bank id as a refusal for scoped callers:

```ts
export function assertBankAccess(ctx: AuthContext, bankId: string | null | undefined): void {
  if (ctx.bankIds === null) return;
  if (!bankId) throw forbidden("A bank must be specified for this operation");
  if (!ctx.bankIds.includes(bankId)) {
    throw forbidden("You do not have access to this resource");
  }
}
```
— `src/services/access.ts:121-127`

The read side has the mirror-image problem: `bankScope` renders
`inArray(bank_id, [...])`, and `NULL IN (...)` is never true in SQL, so any row
with a NULL `bank_id` is invisible to every scoped user.

### Evidence

The create call, `frontend/src/app/(app)/ledger/page.tsx:63-71` — no `bankId`:

```tsx
      await api.create<LedgerEntry>("/ledger", {
        particulars: form.particulars.trim(),
        party: form.party || null,
        category: form.category,
        debit: form.direction === "debit" ? Number(form.amount) || 0 : 0,
        credit: form.direction === "credit" ? Number(form.amount) || 0 : 0,
        mode: form.mode || null,
        entryDate: new Date().toISOString(),
      });
```

The assertion, `src/modules/scoped-resource.ts:176-177`:

```ts
      // Asserted against the *payload*, so a hand-crafted bankId is rejected.
      assertBankAccess(ctx, parsed.bankId);
```

The nullable field, `src/modules/operations.routes.ts:366`:

```ts
    bankId: uuidField.optional().nullable(),
```

The scope filter, `src/services/access.ts:108-111`:

```ts
export function bankScope(ctx: AuthContext, column: PgColumn): SQL | undefined {
  if (ctx.bankIds === null) return undefined;
  return inArray(column, ctx.bankIds.length > 0 ? ctx.bankIds : [NO_BANK_SENTINEL]);
}
```

The "New voucher" button has no permission gate at all
(`frontend/src/app/(app)/ledger/page.tsx:178-180`), so it is offered to every
role including Executive, which holds no `ledger.*` permission
(`src/lib/permissions.ts:293-312`).

Note the codebase is aware of this hazard elsewhere —
`src/modules/operations.routes.ts:432-436` explicitly declines to put
service providers on the scoped factory *because* "feeding a null bank column
into the scope filter would silently hide every row from scoped users."

### Expected behaviour

Either the ledger is a business-level book with no bank scoping, or `bank_id` is
mandatory and the form collects it. In both cases, a user with `ledger.create`
can post a voucher.

### Actual behaviour

- A scoped user with `ledger.create` gets `403 "A bank must be specified for
  this operation"` on every voucher, with no field in the form to satisfy it.
- Any voucher that does get created with `bank_id = NULL` is invisible to every
  scoped user on the list, so the ledger a manager sees is not the ledger.
- A Manager (who holds `ledger.view` but not `ledger.create`) and an Executive
  (who holds neither) are both shown the New voucher button and both get a 403.

### Impact

The ledger — the single book of receipts, payouts, expenses, and tax for the DSA
business — cannot be written to by anyone who is bank-scoped, and reads
inconsistently depending on who is asking.

### Recommended fix

Decide the ledger's tenancy model explicitly. If it is business-level: give
`ledgerRouter` its own unscoped router as `serviceProvidersRouter` already does.
If it is bank-level: make `bankId` required in `createSchema`, add a bank picker
to the voucher dialog, and backfill existing NULLs. Either way, add a
`can("ledger.create")` gate on the New voucher button.

### Roadmap phase

Phase 6 — Ledger and settlements.

---

<a id="bug-010"></a>
## BUG-010 — Ledger running balance is always zero; the schema comment claims otherwise

| Field | Value |
| --- | --- |
| **ID** | BUG-010 |
| **Severity** | HIGH |
| **Feature** | Ledger |
| **Location** | `src/db/schema/operations.ts:342-344`, `src/modules/operations.routes.ts:375`, `frontend/src/app/(app)/ledger/page.tsx:63-71` and `:186-191` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

`ledger_entries.balance` is a stored column with a documented promise that it is
recomputed on insert. Nothing recomputes it. A repository-wide grep for
`balance` in `src` (excluding tests) returns four hits, all of them
declarations:

```
src/db/schema/operations.ts:342   (comment)
src/db/schema/operations.ts:344   balance: money("balance").notNull().default("0"),
src/modules/operations.routes.ts:364   numericFields: ["debit", "credit", "balance"],
src/modules/operations.routes.ts:375   balance: money.default(0),
```

There is no `sum`, no window function, no trigger, and no post-insert update.

### Evidence

`src/db/schema/operations.ts:342-344` — the untrue comment:

```ts
    /** Running balance is stored for display parity with the frontend, but it is
     *  recomputed inside the same transaction that inserts the row. */
    balance: money("balance").notNull().default("0"),
```

The factory inserts the parsed payload verbatim
(`src/modules/scoped-resource.ts:181-189`), and the client omits
`balance` entirely, so `money.default(0)` supplies `0` on every row.

The UI reads it in two places —
`frontend/src/app/(app)/ledger/page.tsx:140-147` (the Balance column) and
`:186-191`:

```tsx
        <StatCard
          label="Closing balance"
          value={formatCurrency(rows[0]?.balance ?? 0, { compact: true })}
          icon={Scale}
          helper="as on latest voucher"
        />
```

### Expected behaviour

`balance` reflects the running balance of the book as at that voucher, and
"Closing balance" is the balance of the most recent entry.

### Actual behaviour

Every row's Balance column reads `₹0`, and the "Closing balance" KPI reads `₹0`
regardless of how many receipts and payments are in the book. The three
neighbouring KPIs (Total receipts, Total payments, Net movement, lines 192-215)
*are* computed client-side from `credit`/`debit` and are correct, so the screen
shows a non-zero net movement beside a zero closing balance.

### Impact

The headline financial figure on the ledger screen is wrong and internally
contradicts the figures next to it. Anyone reading the schema comment will
believe the column is maintained.

### Recommended fix

Compute the balance server-side inside the insert transaction —
`select coalesce(sum(credit) - sum(debit), 0)` over the preceding entries for
the same book, ordered by `entry_date, code` — or drop the stored column and
compute the running balance in the read query with a window function
(`sum(credit - debit) over (order by entry_date, code)`). Correct or delete the
schema comment either way. Backfill existing rows.

### Roadmap phase

Phase 6 — Ledger and settlements.

---

<a id="bug-011"></a>
## BUG-011 — Human-readable codes are generated from `count(*)` and collide after a permanent delete or under concurrency

| Field | Value |
| --- | --- |
| **ID** | BUG-011 |
| **Severity** | HIGH |
| **Feature** | Record code generation — loans, bank orders, disbursements, settlements, transactions, ledger entries, customers |
| **Location** | `src/modules/scoped-resource.ts:87-91`, `src/modules/customers.routes.ts:86-89`, `src/modules/imports.routes.ts:388-407`, `src/services/recycle-bin.ts:203-237` *(line numbers as filed; all three generator sites have since moved)* |
| **Present at** | HEAD; **fixed in the working tree** |
| **Status** | ✅ **CLOSED 2026-09-05 — Task 4.9** |

> **Closed by migration `0006_code_sequences`.** All three generators — `customers.routes.ts`, the `scoped-resource.ts` factory and the `imports.routes.ts` batch path — now call one `nextResourceCode()` backed by **seven Postgres sequences**, one per prefix, each `setval` from `GREATEST(codeStart, max over the table, max over retained recycle-bin snapshots)`. Counting is gone, so a permanent delete no longer lowers the next number and two concurrent creates can no longer read the same value.
>
> **The `deleted_at` clause of this entry was NOT actioned, deliberately.** This register already said *"Soft delete alone is safe, because the row remains and still counts"*, and adding the filter the roadmap once prescribed would have reissued a soft-deleted row's code past the **partial** `customers_code_unique` index and made recycle-bin restore impossible — PRD **R3.1 AC3**. See **D-050**. A test asserts the soft-deleted row is still restorable.
>
> Verified adversarially: reverting to the count-based generator fails three tests, and fixing only the route while leaving the importer on its own count fails two more with a genuine `customers_code_unique` 23505. 13 tests in `src/tests/code-sequences.test.ts`.

### Problem

Every code (`LN-1001`, `DSB-5001`, `CUS-10001`, …) is derived by counting the
rows currently in the table and adding one. The count is not a sequence: it goes
down when a row is physically removed, and two concurrent creates read the same
value.

Permanent delete from the recycle bin *does* physically remove rows.

### Evidence

`src/modules/scoped-resource.ts:87-91`:

```ts
  async function nextCode(): Promise<string | undefined> {
    if (!config.codePrefix) return undefined;
    const [row] = await getDb().select({ total: count() }).from(table);
    return `${config.codePrefix}-${(config.codeStart ?? 1000) + (row?.total ?? 0) + 1}`;
  }
```

`src/modules/customers.routes.ts:86-89`:

```ts
async function nextCustomerCode(): Promise<string> {
  const [row] = await getDb().select({ total: count() }).from(customers);
  return `CUS-${10000 + (row?.total ?? 0) + 1}`;
}
```

`src/services/recycle-bin.ts:221` — the physical delete:

```ts
    await tx.delete(table).where(eq(table.id, entry.recordId));
```

The unique indexes that then reject the duplicate
(`drizzle/0002_operations.sql`, `drizzle/0000_init.sql`):

```
loans_code_unique          ON loans(code)          WHERE deleted_at is null
bank_orders_code_unique    ON bank_orders(code)    WHERE deleted_at is null
disbursements_code_unique  ON disbursements(code)  WHERE deleted_at is null
settlements_code_unique    ON settlements(code)    WHERE deleted_at is null
customers_code_unique      ON customers(code)      WHERE deleted_at is null
ledger_entries_code_unique ON ledger_entries(code)   (unconditional)
transactions_code_unique   ON transactions(code)     (unconditional)
```

The importer repeats the pattern independently at
`src/modules/imports.routes.ts:388-392`:

```ts
        const [{ total = 0 } = {}] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(customers);
        let sequence = total;
```

### Expected behaviour

Codes are monotonically increasing and never reused, whatever happens to older
rows.

### Actual behaviour

- **After a purge:** the count drops by one, so the next create produces a code
  that already belongs to a live row. Postgres raises `23505`; the error handler
  (`src/middleware/error-handler.ts:66-76`) turns it into
  `409 "That record already exists"`. The resource becomes permanently
  un-creatable until enough rows are added to climb back past the collision.
- **Under concurrency:** two simultaneous `POST /loans` both read the same count
  and both attempt the same code; one gets a 409. The code read is outside the
  insert transaction (`nextCode()` is awaited at
  `scoped-resource.ts:180`, before `db.insert` at `:181`), so there is no lock
  serialising them.
- **Soft delete alone is safe**, because the row remains and still counts.

### Impact

Creating loans, disbursements, settlements, transactions, ledger entries, or
customers fails with a confusing "That record already exists" that names no
field, after any administrator has ever used the recycle bin's permanent delete.
The importer can fail mid-batch for the same reason, though its transaction
means the whole batch rolls back rather than partially landing.

### Recommended fix

Replace both generators with a Postgres `SEQUENCE` per prefix (or a single
`code_counters` table row updated with `UPDATE … RETURNING` inside the same
transaction as the insert). Sequences do not decrease, are transactional, and
are concurrency-safe. Backfill the sequence start from `max(code)` per table.

### Roadmap phase

Phase 7 — Data integrity.

---

<a id="bug-012"></a>
## BUG-012 — `failed_login_attempts` is never reset when a lockout expires, so an account locks permanently in 15-minute steps

| Field | Value |
| --- | --- |
| **ID** | BUG-012 |
| **Severity** | HIGH |
| **Feature** | Authentication / account lockout |
| **Location** | `src/modules/auth.routes.ts:28-29`, `:103-129`, `:134-137` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The counter is only reset on a **successful** login. When the 15-minute lockout
expires, the counter is still at 8. The next single failed attempt increments it
to 9, which is `>= MAX_FAILED_ATTEMPTS`, so the account locks again immediately.

### Evidence

`src/modules/auth.routes.ts:28-29`:

```ts
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;
```

`src/modules/auth.routes.ts:113-126` — the failure branch:

```ts
    if (!account || !ok) {
      if (account) {
        const attempts = account.failedLoginAttempts + 1;
        await db
          .update(users)
          .set({
            failedLoginAttempts: attempts,
            lockedUntil:
              attempts >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
                : null,
          })
          .where(eq(users.id, account.id));
      }
```

`src/modules/auth.routes.ts:134-137` — the only reset:

```ts
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, account.id));
```

The lock check at `:103-106` reads `lockedUntil` only; nothing clears the
counter when the window elapses.

### Expected behaviour

After the lockout window elapses, the user gets a fresh allowance of attempts.

### Actual behaviour

After the eighth lifetime failure, every subsequent typo re-locks the account
for another 15 minutes. A user who mistypes once, waits out the lock, and
mistypes once more is locked again — indefinitely, until either a correct
password is entered on the very first try after a window expires, or an
administrator resets the password (`POST /users/:id/reset-password`, working
tree only, which does clear the counter at
`src/modules/admin.routes.ts:353-354`).

### Impact

Progressive, effectively permanent account lockout from ordinary typing errors.
At HEAD there is no password-reset route at all, so the only remedy is direct
database access. Note also there is no rate limiting anywhere in the app
(`src/app.ts` mounts helmet, cors, json, urlencoded, cookie-parser and
pino-http — no limiter), so this per-account counter is the sole brute-force
control and it degrades into a denial-of-service against legitimate users.

### Recommended fix

Reset `failed_login_attempts` to 0 whenever `locked_until` is in the past, in
the same statement that increments it — e.g. compute
`attempts = (lockedUntil && lockedUntil <= now) ? 1 : failedLoginAttempts + 1`.
Separately, add a real IP- and account-keyed rate limiter in front of
`/api/auth/login`.

### Roadmap phase

Phase 1 — Authentication hardening.

---

<a id="bug-013"></a>
## BUG-013 — Soft-deleting a bank orphans its customers, loans, and every downstream record

| Field | Value |
| --- | --- |
| **ID** | BUG-013 |
| **Severity** | HIGH |
| **Feature** | Banks / recycle bin |
| **Location** | `src/modules/banks.routes.ts:145-155`, `src/services/recycle-bin.ts:105-151`, `frontend/src/hooks/use-reference.tsx:98` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

`softDelete(db, ctx, req, "bank", id)` sets `deleted_at` on the `banks` row and
writes one recycle-bin entry. It touches no other table. Every child record —
customers, loans, bank orders, disbursements, settlements, transactions, ledger
entries, documents — keeps its `bank_id` pointing at a bank that no longer
appears in any list.

### Evidence

`src/modules/banks.routes.ts:145-155` — the whole delete handler:

```ts
banksRouter.delete("/:id", requirePermission(PERMISSIONS.banks.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    assertBankAccess(ctx, id);
    await softDelete(getDb(), ctx, req, "bank", id);
    res.status(204).end();
```

`src/services/recycle-bin.ts:127-141` — single-table scope:

```ts
    await tx
      .update(table)
      .set({ deletedAt: now, deletedBy: ctx.userId, purgeAfter })
      .where(eq(table.id, recordId));

    await tx.insert(recycleBinEntries).values({
      recordType,
      recordId,
      bankId: entry.bankIdOf(row as Record<string, unknown>),
      ...
```

`GET /customers` filters only on `customers.deleted_at`
(`src/modules/customers.routes.ts:97`) and never joins `banks`, so the
orphans stay in every list. The name lookup then fails:

`frontend/src/hooks/use-reference.tsx:98`:

```ts
      bankName: (id) => (id ? (bankMap.get(id)?.name ?? "Unassigned") : "Unassigned"),
```

`user_bank_access` rows are also left intact, so a scoped user's `ctx.bankIds`
still contains the deleted bank and they continue to read and write its records.

Purging the bank afterwards fails: `customers.bank_id` is
`ON DELETE restrict` (`drizzle/0000_init.sql:251`), so
`permanentDelete` raises `23503`, which the error handler turns into
`409 "That record is still referenced by other records"`
(`src/middleware/error-handler.ts:77-82`).

### Expected behaviour

Deleting a bank either cascades the soft delete to its dependent records, or is
refused while dependents exist, with a clear message naming the counts.

### Actual behaviour

The bank vanishes from Banks, from filter dropdowns, and from the reference map.
Its customers, loans, and financial records remain fully live and editable, now
labelled "Unassigned". Reports grouped by bank silently drop those rows into an
"Unassigned" bucket. Restoring the bank from the recycle bin brings the name
back; permanently deleting it is impossible while any customer remains.

### Impact

Silent, partial data corruption of the tenancy model, reachable by one click
from the Banks screen, with no warning and no way to see the blast radius
beforehand.

### Recommended fix

Add a pre-flight dependency count to `DELETE /banks/:id` and refuse with a `409`
listing the counts, matching the pattern already used for roles
(`src/modules/admin.routes.ts:674-680`). If cascading soft delete is
wanted instead, extend `softDelete` with an optional `cascade` descriptor per
`BIN_REGISTRY` entry and cascade `restore` symmetrically. Either way,
`user_bank_access` rows for the bank must be removed or flagged.

### Roadmap phase

Phase 7 — Data integrity.

---

<a id="bug-014"></a>
## BUG-014 — "Export CSV" exports only the page the client happens to hold, and the row-count badge presents that as the total

| Field | Value |
| --- | --- |
| **ID** | BUG-014 |
| **Severity** | HIGH |
| **Feature** | CSV export (every list screen) |
| **Location** | `frontend/src/components/shared/data-table.tsx:128-143` and `:198-204`; callers at `frontend/src/app/(app)/loans/page.tsx:51`, `ledger/page.tsx:46`, `settlements/page.tsx:32`, `transactions/page.tsx:33`, `disbursement/page.tsx:43`, `documents/page.tsx:52`, `bank-orders/page.tsx:54` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

`DataTable` only ever sees the array it is handed. Seven pages call
`useResource` with no `pageSize`, and the server default is 25
(`src/modules/scoped-resource.ts:49`:
`pageSize: z.coerce.number().int().min(1).max(500).default(25)`). The table's
export and its "N of M" badge both operate on that 25-row slice. `useResource`
does return the true `meta.total` (`frontend/src/hooks/use-api.ts:60`), but
`DataTable` has no prop to receive it and no caller passes it.

### Evidence

`frontend/src/components/shared/data-table.tsx:128-143`:

```tsx
  function handleExport() {
    const data = filtered.map((row) => {
      const record: Record<string, string | number> = {};
      columns.forEach((column) => {
        const value = column.exportValue
          ? column.exportValue(row)
          : column.sortValue
            ? (column.sortValue(row) ?? "")
            : String((row as Record<string, unknown>)[column.key] ?? "");
        record[column.header] = value ?? "";
      });
      return record;
    });
    exportCsv(exportName, data);
    toast.success("Exported", { description: `${data.length} rows saved as ${exportName}.csv` });
  }
```

`frontend/src/components/shared/data-table.tsx:198-201` — the badge:

```tsx
          <Badge variant="outline" className="gap-1.5">
            <SlidersHorizontal className="size-3" />
            {filtered.length} of {rows.length}
          </Badge>
```

`frontend/src/app/(app)/loans/page.tsx:51` — no `pageSize`:

```tsx
  const { data: rows, loading, error, refresh } = useResource<Loan>("/loans");
```

The table's own paginator (`pageSize` default 8, line 74) then paginates the
25 rows locally, and the page buttons are capped at six
(`Array.from({ length: totalPages }).slice(0, 6)`, line 293), so with a larger
client page size the later pages are unreachable except via Next.

### Expected behaviour

Export produces the full result set for the current filters, and the badge
distinguishes "shown" from "total".

### Actual behaviour

On a book of 4,000 loans, the Loans screen loads 25, the badge reads "25 of 25",
and Export CSV writes a 25-row file with a toast confirming "25 rows saved". The
user has no indication that 3,975 rows were omitted. The same applies to the
Ledger, Settlements, Transactions, Disbursement, Documents, and Bank orders
screens.

### Impact

Silently truncated financial exports presented as complete. These CSVs feed
commission reconciliation and Tally import.

### Recommended fix

Two independent changes:
1. Add a `total?: number` prop to `DataTable`, pass `useResource`'s `total`, and
   render `{filtered.length} of {total ?? rows.length}`.
2. Make `handleExport` fetch the full set — either an `onExport` callback that
   pages the API to exhaustion, or dedicated server-side `?format=csv` export
   endpoints that stream and re-apply bank scope. The second is preferable for
   large books.

### Roadmap phase

Phase 5 — Reporting.

---

# MEDIUM

<a id="bug-015"></a>
## BUG-015 — Loans create dialog closes the wrong state variable, so it stays open after a successful submit

> ✅ **CLOSED 2026-09-05 by Task 5.1.** All four items of the Recommended fix landed, not just the state variable: `setOpen(false)` → `setCreateOpen(false)`, the unused `open` state **deleted**, `form` reset to its initial values on success, and both footer buttons disabled while the request is in flight.
>
> **The guard is a ref, not the `saving` state**, and that distinction is load-bearing: mutation testing showed that swapping the ref for the state makes two clicks in one React batch fire **two** `POST /api/loans` requests while the "disabled while in flight" test still passes. `disabled` and a state check only take effect after a re-render. The roadmap-mandated test *"double-submit produces one loan"* dispatches two clicks inside a single `act` and asserts exactly one request.
>
> Reversion-proven: restoring the original behaviour fails 6 tests. 32 tests in `frontend/src/app/(app)/loans/loans-create-dialog.test.tsx`.
>
> *(This entry's **Roadmap phase** field below reads "Phase 2 — Wire the write path" — an obsolete numbering scheme that predates the current roadmap. Under the roadmap in force this was **Task 5.1**. The field is left as written for historical honesty.)*


| Field | Value |
| --- | --- |
| **ID** | BUG-015 |
| **Severity** | MEDIUM |
| **Feature** | Loans |
| **Location** | `frontend/src/app/(app)/loans/page.tsx:53-54`, `:95`, `:316` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The page holds two booleans. `createOpen` drives the create dialog. `open` is
declared, never used to open anything, and is the one `createLoan` closes.

### Evidence

`frontend/src/app/(app)/loans/page.tsx:53-54`:

```tsx
  const [createOpen, setCreateOpen] = React.useState(false);
  const [open, setOpen] = React.useState(false);
```

`frontend/src/app/(app)/loans/page.tsx:93-97` — the success path:

```tsx
      });
      setOpen(false);
      refresh();
      toast.success("Loan file created", { description: created.data.code });
```

`frontend/src/app/(app)/loans/page.tsx:316` — the dialog that is actually open:

```tsx
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
```

The trigger sets `createOpen` (`:197`, `onClick={() => setCreateOpen(true)}`).
The form fields are never cleared on success either.

### Expected behaviour

A successful create closes the dialog and resets the form.

### Actual behaviour

The loan is created, a success toast fires, and the dialog remains open with the
same customer, bank, amount, tenure, and rate still populated. The Submit button
is not disabled during the request (`:409`).

### Impact

The natural reaction to a dialog that did not close is to click Submit again.
Each click creates another identical loan file against the same customer. There
is no idempotency key or duplicate check on `POST /api/loans`.

### Recommended fix

Change `setOpen(false)` to `setCreateOpen(false)`, delete the unused `open`
state, reset `form` to its initial value, and disable the submit button while
the request is in flight — the pattern the working tree already uses on the
Employees screen (`frontend/src/app/(app)/employees/page.tsx:98`, `:681`).

### Roadmap phase

Phase 2 — Wire the write path.

---

<a id="bug-016"></a>
## BUG-016 — Audit-log bank-scope filter has an operator-precedence bug that defeats every other filter

| Field | Value |
| --- | --- |
| **ID** | BUG-016 |
| **Severity** | MEDIUM |
| **Feature** | Audit log |
| **Location** | `src/modules/admin.routes.ts` |
| **Present at** | ~~HEAD + working tree~~ |
| **Status** | ✅ **CLOSED 2026-09-06 — Wave 4, Task 12.5** |

> **Closed.** The fragment is now `sql\`((…) or (…))\``, and nothing else about the predicate changed — the defect was punctuation, and a broader edit would have been a scope change wearing a bug fix's clothes. Registered in parallel as **[SEC-014](SECURITY_AUDIT.md#sec-014)**, which carries the security analysis.
>
> **Regression:** `src/tests/audit-query.test.ts` group B. **Reversion-proven — 5 of 21 fail against the pre-fix predicate.**
>
> **Two corrections to the analysis below, both from measurement.** It was **never a cross-tenant leak** — the escaping disjunct was still `bank_id in (caller's banks)`, and case 12 asserts that directly rather than leaving it inferred. And it was **unreachable with the shipped role set**: no seeded role is both bank-scoped and able to read the trail, because Admin holds `system.access_all_banks`. Reaching it needed the bespoke auditor role `permissions.ts` names in its own comment, which the tests build through the real `POST /api/roles`.

### Problem

The bank-scope predicate is a raw `sql` fragment containing a top-level `or`,
pushed into the same `filters` array as the `recordType` / `recordId` / `action`
equality predicates. Drizzle's `and()` parenthesises the **group**, not the
individual operands, so the `or` binds loosely against everything to its left.

Verified against the installed implementation,
`node_modules/drizzle-orm/sql/expressions/conditions.js`:

```js
function and(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter((c) => c !== void 0);
  if (conditions.length === 0) return void 0;
  if (conditions.length === 1) return new SQL(conditions);
  return new SQL([
    new StringChunk("("),
    sql.join(conditions, new StringChunk(" and ")),
    new StringChunk(")")
  ]);
}
```

### Evidence

`src/modules/admin.routes.ts:915-929`:

```ts
    const filters: SQL[] = [];
    if (query.recordType) filters.push(eq(auditLogs.recordType, query.recordType));
    if (query.recordId) filters.push(eq(auditLogs.recordId, query.recordId));
    if (query.action) filters.push(eq(auditLogs.action, query.action));

    if (ctx.bankIds !== null) {
      const ids = ctx.bankIds;
      filters.push(
        ids.length === 0
          ? sql`false`
          : sql`(${auditLogs.bankId} is null and ${auditLogs.actorId} = ${ctx.userId}) or ${auditLogs.bankId} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
      );
    }

    const where = filters.length ? and(...filters) : undefined;
```

For a scoped caller filtering by `action=deleted`, the emitted WHERE is:

```sql
(action = 'deleted' and (bank_id is null and actor_id = $1) or bank_id in ($2, $3))
```

Because `AND` binds tighter than `OR` in SQL, that parses as:

```sql
((action = 'deleted' AND bank_id IS NULL AND actor_id = $1)
 OR (bank_id IN ($2, $3)))
```

### Expected behaviour

The scope predicate narrows the result set; the `action` / `recordType` /
`recordId` filters narrow it further. All four apply conjunctively.

### Actual behaviour

The second `OR` arm escapes every user-supplied filter. A scoped caller
requesting `?action=deleted` receives **every** audit row for their assigned
banks regardless of action, plus the correctly-filtered NULL-bank rows they
authored. Filtering by `recordType` or `recordId` behaves the same way.

Unscoped callers (`ctx.bankIds === null`) are unaffected, because no fragment is
pushed. There is currently no frontend page consuming `/api/audit-logs`, so this
is latent — but it is a scoping predicate, and the failure direction is
"returns more than asked for", not less.

### Impact

The audit-log filter is unreliable for exactly the users it is scoped for. The
class of mistake — an un-parenthesised `or` inside an `and()` list — is a
tenant-isolation hazard wherever it appears; here it happens not to leak across
banks, but the same construct in a different predicate would.

### Recommended fix

Wrap the whole fragment in its own parentheses:

```ts
sql`((${auditLogs.bankId} is null and ${auditLogs.actorId} = ${ctx.userId}) or ${auditLogs.bankId} in (...))`
```

Better, express it with Drizzle's `or(and(isNull(...), eq(...)), inArray(...))`,
which parenthesises correctly by construction. Add a test asserting that
`?action=X` combined with bank scope returns only action `X`.

### Roadmap phase

Phase 7 — Data integrity.

---

<a id="bug-017"></a>
## BUG-017 — Global search links customers by code, and the API's `/:id` route rejects it with a 500

| Field | Value |
| --- | --- |
| **ID** | BUG-017 |
| **Severity** | MEDIUM |
| **Feature** | Global search / customer profile |
| **Location** | `frontend/src/components/layout/topbar.tsx:203` *(cited as `:190-201` before Task 1.9 and `:198` immediately after; the call moved to `:203` when Task 1.9 added its explanatory comment. Corrected 2026-09-02.)*, `frontend/src/app/(app)/customers/[id]/page.tsx:57-72`, `src/modules/customers.routes.ts:181-200, :253-, :305-`, `src/middleware/error-handler.ts:84-88` |
| **Present at** | HEAD + working tree |
| **Status** | ✅ **FIXED 2026-09-02** (Task 1.9) |

### Problem

The command palette builds its href from `customer.code` (`CUS-10001`). The
customer profile page passes that path segment straight to
`GET /api/customers/:id`, which compares it to a `uuid` column. Postgres raises
`22P02 invalid input syntax for type uuid`. The error handler only special-cases
`23505` and `23503`; everything else falls through to a 500.

### Evidence

`frontend/src/components/layout/topbar.tsx:195-198` (as it stood before the fix):

```tsx
                {customerMatches.map((customer) => (
                  <button
                    key={customer.code}
                    onClick={() => go(`/customers/${customer.code}`)}
```

`frontend/src/app/(app)/customers/[id]/page.tsx:56-60`:

```tsx
  const params = useParams<{ id: string }>();
  const customerId = params?.id ?? "";
  const { data: customer, loading: customerLoading } = useRecord<Customer>(
    customerId ? `/customers/${customerId}` : null,
  );
```

`src/modules/customers.routes.ts:147-156` — no code fallback:

```ts
    const ctx = authOf(req);
    const filters: SQL[] = [eq(customers.id, req.params.id as string), isNull(customers.deletedAt)];
    const scope = bankScope(ctx, customers.bankId);
    if (scope) filters.push(scope);

    const [row] = await getDb()
      .select()
      .from(customers)
      .where(and(...filters))
      .limit(1);
```

`src/middleware/error-handler.ts:84-88` — the fall-through:

```ts
  logger.error({ err: error, requestId: req.requestId }, "Unhandled error");
  res.status(500).json({
    error: { code: "internal_error", message: "Unexpected server error" },
  });
```

The demo backend, by contrast, resolves both forms
(`frontend/src/lib/demo/api.ts:283-287`: `rows.find((row) => row.id === id || row.code === id)`),
so this path works in the demo and fails against the real API — which is why it
has not been noticed.

### Expected behaviour

Selecting a customer from the command palette opens their profile.

### Actual behaviour

The profile page loads, fires `GET /api/customers/CUS-10001`, and the API
returns `500 internal_error`. `useRecord` catches it and sets `data: null`
(`frontend/src/hooks/use-api.ts:120-125`), so the user sees the page's
not-found/empty branch. A stack trace is written to the server log on every
search selection. The **three** sibling `useResource` calls on that page (`?customerId=CUS-10001`)
also return **500**, from the same `22P02`.

> **Correction, 2026-09-02 (Task 1.9).** This paragraph previously claimed those
> siblings *"fail their own Zod `uuid()` validation and return 422"*. **Measured
> false — all three return 500.** `customerId` is not in the factory's
> `listQuery` (`scoped-resource.ts:47-52`); it goes through the **unvalidated**
> `filterable` loop at `scoped-resource.ts:115-120`. So one palette click cost
> **four** 500s, not one. Tracked as [BUG-035](#bug-035).

### Impact

Global customer search — the primary navigation affordance, bound to Ctrl/Cmd-K
— is broken end to end, and every use logs a server error.

### Fix (Task 1.9, 2026-09-02)

**Backend** — `z.object({ id: z.string().uuid() })` parsed inside each of the three handlers, after `requirePermission`:

```ts
const { id } = idParam.parse(req.params);
```

**Frontend** — `topbar.tsx:203` now navigates by `customer.id`. The code is still displayed in the result row; only the link target changed.

**Error handler unchanged — zero lines.** See [DECISIONS.md](DECISIONS.md) D-021 for why the `22P02` mapping suggested above was rejected: it would convert a mis-minted-JWT outage into an unlogged 4xx.

### Measured before → after

| Request | Before | After |
|---|---|---|
| `GET /customers/<uuid>` | 200 | 200 |
| `GET /customers/<absent uuid>` | 404 `Customer not found` | 404 (unchanged) |
| `GET /customers/CUS-10001` | **500** | **422** `validation_failed`, `details[0].path = "id"` |
| `PATCH /customers/not-a-uuid` | **500** | **422** |
| `DELETE /customers/not-a-uuid` | **500** | **422** |
| `GET /customers/check` | **500** | **422** naming `id` |
| `GET /customers/check/reference?…` | 200 / 409 | unchanged |
| Unauthenticated, malformed id | 401 | 401 (unchanged) |
| No `customers.view`, malformed id | 403 | 403 (unchanged) |
| Real DB fault | 500 + `logger.error` | 500 + `logger.error` (unchanged) |

20 backend tests (`src/tests/customer-lookup.test.ts`) and 2 frontend tests (`frontend/src/components/layout/topbar.navigation.test.tsx`). Reverting the backend fix fails 9 of the 20; reverting the frontend line fails 1 of the 2.

### Scope, stated accurately

**This fixed three endpoints, not the class.** The identical pattern — an unvalidated path segment reaching a `uuid` column — exists on **45 other endpoints**, all measured returning 500 on a malformed segment: banks 3, admin 12, imports 2, operations 28 (26 generated by `createScopedResource`). They are authenticated-only and no user journey reaches them. Deferred to **Phase 8**.

The sibling query filters are tracked separately as **[BUG-035](#bug-035)**.

### Accepted narrowing

Postgres accepts unhyphenated (`054bfa18ca47…`) and brace-wrapped (`{054bfa18-…}`) uuids; all four spellings returned 200 before this change. zod rejects those two, so they now return 422. No client emits them — all 17 customer-href sites use `id`/`customerId` straight from this API. Recorded rather than discovered later (D-021).

### Roadmap phase

**Phase 1, Task 1.9 — DONE 2026-09-02.** *(This entry previously said "Phase 8", which contradicted the roadmap; the roadmap scheduled it as 1.9.)*

---

<a id="bug-018"></a>
## BUG-018 — Dashboard renders a 403 as a screen full of zeroes

| Field | Value |
| --- | --- |
| **ID** | BUG-018 |
| **Severity** | MEDIUM |
| **Feature** | Dashboard |
| **Location** | `frontend/src/hooks/use-api.ts:139-176`, `frontend/src/app/(app)/dashboard/page.tsx:40`, `:68-88`; permission at `src/modules/operations.routes.ts:521` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

`useStats` swallows every error and leaves `data` as `null`. Its `num()` accessor
then coalesces every missing key to `0`. A `403` is therefore indistinguishable
from an empty database.

`/dashboard/stats` requires `reports.view`. The Executive role does not have it
(`src/lib/permissions.ts:293-312` lists exactly twelve permissions, none
of them `reports.*`), and the login page sends every non-demo user to
`/dashboard` (`frontend/src/app/login/page.tsx:53`).

### Evidence

`frontend/src/hooks/use-api.ts:154-173`:

```ts
    api
      .get<T>(path)
      .then((body) => {
        if (!cancelled) setData(body.data);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, user]);

  const num = React.useCallback(
    (key: string): number => Number((data as Record<string, unknown> | null)?.[key] ?? 0),
    [data],
  );
```

`src/modules/operations.routes.ts:521`:

```ts
dashboardRouter.get("/stats", requirePermission(PERMISSIONS.reports.view), async (req, res, next) => {
```

`frontend/src/app/(app)/dashboard/page.tsx:68-88` — sixteen figures, all from
`stat(...)`, plus three hardcoded constants:

```tsx
  const stats = {
    totalCustomers: stat("total_customers"),
    ...
    unreadNotifications: 0,
    ...
    ledgerBalance: 0,
    ...
  };
```

### Expected behaviour

An authorisation failure is distinguishable from an empty database. Either the
Dashboard is not offered to roles that cannot read it, or it shows an explicit
"You do not have access to these figures" state.

### Actual behaviour

An Executive signing in lands on `/dashboard`, every KPI reads `0` / `₹0`, and
the page states "Live position across every partner lender" beneath them. The
same three `useResource` calls to `/dashboard/loan-status` and
`/dashboard/bank-performance` 403 as well and render as empty charts. Nothing
tells the user anything is wrong. A genuine outage of `/dashboard/stats`
presents identically.

### Impact

Users are shown fabricated-looking zeroes for their business position with no
error indication — the exact failure mode `useResource`'s doc comment says it
was designed to avoid ("Returns an empty array (never fixtures) while loading or
on error, so a failure can't be mistaken for real data",
`frontend/src/hooks/use-api.ts:18-21`). `useStats` does not honour that
contract.

### Recommended fix

Give `useStats` the same `error` channel `useResource` has, and have the
Dashboard render an explicit forbidden / error state instead of zeroes. Gate the
`/dashboard` nav entry and the post-login redirect on `can("reports.view")`,
sending users who lack it to `/my-work`.

### Roadmap phase

Phase 8 — Frontend/API contract cleanup.

---

<a id="bug-019"></a>
## BUG-019 — Deleted users never appear in the recycle bin and cannot be restored

| Field | Value |
| --- | --- |
| **ID** | BUG-019 |
| **Severity** | MEDIUM |
| **Feature** | User administration / recycle bin |
| **Location** | ~~`admin.routes.ts:453-456`, `recycle-bin.ts:28-91`~~ — see the fix below |
| **Present at** | ~~HEAD + working tree~~ |
| **Status** | ✅ **CLOSED — Task 2.9, D-030 (2026-09-03).** Register was stale; corrected 2026-09-05, Wave 0 |

> **Verified fixed 2026-09-05.** `BIN_REGISTRY.user` exists at `src/services/recycle-bin.ts:107-114`, and `DELETE /users/:id` calls `softDelete(getDb(), ctx, req, "user", id)` at `src/modules/admin.routes.ts:769`. Deleted users now reach the bin and are restorable. **The summary table listed this as OPEN, making the open count off by one.**
>
> ⚠️ **The fix widened [SEC-016's neighbour, SEC-013](SECURITY_AUDIT.md).** `BIN_REGISTRY.user` sets `bankIdOf: () => null` (`recycle-bin.ts:111`), creating a **second** null-bank record type alongside `service_provider` — and the mutating bin routes skip bank scoping for null-bank entries. `assertCanActOnBinnedUser` guards **role hierarchy only, not bank scope**. SEC-013's write-up names only `service_provider` and should be extended when **13.9** is worked. Recorded here rather than fixed: Phase 13 owns it.

### Problem

`BIN_REGISTRY` has twelve entries — `customer`, `bank`, `loan`, `bank_order`,
`verification`, `disbursement`, `settlement`, `transaction`, `ledger_entry`,
`document`, `funding_source`, `service_provider`. There is no `user` entry.
`DELETE /users/:id` therefore does not call `softDelete`; it writes `deleted_at`
directly and no bin entry is created.

### Evidence

`src/modules/admin.routes.ts:453-456`:

```ts
    await getDb()
      .update(users)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId, status: "Inactive" })
      .where(eq(users.id, id));
```

Compare `src/modules/customers.routes.ts:282`, which does it correctly:

```ts
    await softDelete(getDb(), ctx, req, "customer", id);
```

`src/services/recycle-bin.ts:28-89` — the registry, `user` absent.
`BinRecordType` is `keyof typeof BIN_REGISTRY` (`:91`), so `"user"` is not even
expressible.

### Expected behaviour

A deleted employee lands in the recycle bin like every other soft-deleted
record, with the same 30-day retention and one-click restore.

### Actual behaviour

The user disappears from Employees. The recycle bin shows nothing.
`POST /recycle-bin/:id/restore` cannot target them. The only route back is a
direct `UPDATE users SET deleted_at = NULL`, which the API exposes no way to
perform — `PATCH /users/:id` resolves its target through `targetUserRole`, which
filters on `isNull(users.deletedAt)` (`src/modules/admin.routes.ts:79`)
and 404s.

Note also that the `users_email_unique` and `users_employee_code_unique` indexes
are partial (`WHERE deleted_at is null`,
`drizzle/0000_init.sql:277-278`), so the address is immediately
re-usable — meaning a mistaken delete may become genuinely unrecoverable once
someone else is created with that email.

### Impact

Employee deletion is irreversible through the product, while every other record
type is reversible for 30 days. Asymmetric and surprising.

### Recommended fix

Add a `user` entry to `BIN_REGISTRY` (label `name`, `bankIdOf` returning `null`)
and switch `DELETE /users/:id` to `softDelete(...)`. Ensure `restore` also
resets `status` to `Active` or leaves it `Inactive` deliberately — decide and
document which.

### Roadmap phase

Phase 7 — Data integrity.

---

<a id="bug-020"></a>
## BUG-020 — `PATCH /users/:id` accepts `teamId`, `bankIds`, and `joinedOn` and silently discards them

| Field | Value |
| --- | --- |
| **ID** | BUG-020 |
| **Severity** | MEDIUM |
| **Feature** | User administration |
| **Location** | `src/modules/admin.routes.ts:43-59` (schema) versus `:352-377` (update); the fix is at `:78-85` and `src/lib/zod.ts:62-93`. *(This row read `:41-57` / `:276-300` until 2026-09-03 — both were stale. Corrected.)* |
| **Present at** | HEAD + working tree (`teamId` was added to the schema by the working tree; `bankIds` and `joinedOn` are dropped at HEAD too) |
| **Status** | RESOLVED 2026-09-03 (Task 2.5) |

> ### RESOLVED — Task 2.5, 2026-09-03
>
> **The three fields were not one problem, and the fix treats them differently.** That split is the whole decision, and it came from the schema rather than from convenience:
>
> | Field | What it is | Outcome |
> |---|---|---|
> | `joinedOn` | a plain nullable column on `users`; **no other route can change it** after creation | **PERSISTED** by PATCH — one conditional branch in the existing `.set()`, no transaction |
> | `bankIds` | many-to-many through `user_bank_access`, owned by `PUT /api/users/:id/banks` | **REFUSED — 422** |
> | `teamId` | many-to-many through `team_members`; **`users` has no team column at all** | **REFUSED — 422** |
>
> Rejecting rather than implementing was deliberate. `PUT /api/users/:id/banks` already does bank assignment transactionally, with `assertCanManageRoleLevel` on the target and `assertBankAccess` per bank, and an audit row carrying `from`/`to`. Duplicating that inside PATCH would put tenant-isolation logic in two places (**D-003**: grep for an existing endpoint before writing one). `teamId` is worse than duplication — a scalar would be **inventing a relationship the schema does not have**, since a user can belong to many teams.
>
> **Mechanism.** A new `notOnThisRoute()` helper in `lib/zod.ts` marks a field as belonging to a different endpoint, and the PATCH body is derived — not hand-written, per **D-024** — as `patchSchema(userInput).extend({ bankIds: …, teamId: … })`. `userInput` itself is untouched, so `POST /users` still accepts and applies all three.
>
> It is `z.never({ error }).optional()` rather than `.strict()` on purpose: `.strict()` would reject **every** unrecognised key on the route and report `path: ""`, naming the offending field only inside the message. This names it in `path`, and an unknown key is still ignored exactly as before — asserted by test.
>
> The 422 shape is inherited, not invented: `middleware/error-handler.ts` already turns any `ZodError` into `validation_failed`, so no error-handler change was needed and **D-021** is respected.
>
> **Measured after the fix:**
>
> ```
> PATCH { joinedOn: "2026-01-15" }  -> 200, column updated
> PATCH { name }                    -> 200, joinedOn untouched
> PATCH { joinedOn: null }          -> 200, column cleared
> PATCH { bankIds: [...] }          -> 422 details[].path = "bankIds", grants unchanged
> PATCH { teamId: ... }             -> 422 details[].path = "teamId",  memberships unchanged
> PATCH { name, bankIds }           -> 422, and the name is NOT applied either
> ```
>
> **17 tests** in `src/tests/assignment-fields.test.ts`, every one asserting database state. Reversion-proven: removing the omit protection fails **6**; removing the `joinedOn` branch fails **2**. Backend **259/259**; the 27 `partial-update.test.ts` cases and all 26 `super-admin-lockout.test.ts` cases still pass unmodified.
>
> **Not changed, deliberately:** `PUT /api/users/:id/banks` and `PUT /api/teams/:id/members` are byte-identical, and no frontend file was touched — Task 2.4's dialog never sent any of the three fields, so it cannot now trip the 422. Wiring the two assignment routes to the UI remains roadmap **2.6** and **2.7**.
>
> **Found while investigating, NOT fixed here:** `PUT /api/teams/:id/members` applies no per-member authorization at all — filed as **[BUG-038](#bug-038)**.

### Problem

`PATCH` parses with `userInput.partial()`, which accepts all fourteen fields of
the create schema. The `.set()` object handles eleven. `bankIds`, `teamId`, and
`joinedOn` are parsed, validated, and then never referenced.

### Evidence

The schema, `src/modules/admin.routes.ts:41-57` (abridged):

```ts
const userInput = z.object({
  ...
  joinedOn: z.coerce.date().optional().nullable(),
  ...
  bankIds: z.array(z.string().uuid()).optional(),
  /** Optional team membership, applied in the same transaction as the user. */
  teamId: z.string().uuid().optional().nullable(),
  password: z.string().min(1).max(512).optional(),
});
```

The update, `src/modules/admin.routes.ts:276-300` — complete `.set()`:

```ts
    const [after] = await db
      .update(users)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.branch !== undefined ? { branch: input.branch } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.achieved !== undefined ? { achieved: input.achieved } : {}),
        ...(input.avatarColor !== undefined ? { avatarColor: input.avatarColor } : {}),
        ...(input.password
          ? {
              passwordHash: await hashPassword(input.password),
              passwordChangedAt: new Date(),
              mustChangePassword: true,
            }
          : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
```

`POST /users` handles all three (`:170-172` bankIds, `:174-184` and `:220-224`
teamId, `:204` joinedOn). `PUT /users/:id/banks` (`:386`) is the only route that
changes bank access after creation; there is no equivalent for team membership
outside `PUT /teams/:id/members` (`:749`).

### Expected behaviour

Either the fields are applied, or they are rejected with a `422` naming them.

### Actual behaviour

`PATCH /users/:id {"bankIds":[...], "teamId":"...", "joinedOn":"..."}` returns
`200 OK` with a body echoing `{id, name, email}`. Nothing changed. The audit
entry recorded at `:302-308` uses `diff(before, after)`, so it truthfully
records no change — but the caller has already been told the request succeeded.

### Impact

A silent no-op on a write API. Any client that assumes PATCH is a general
updater will corrupt its own view of the data. The current Employees screen does
not exercise these fields, so this is latent rather than active.

### Recommended fix

Either implement the three fields inside a transaction (replacing
`user_bank_access` and `team_members` rows as `POST` does), or add
`.strict()` to the PATCH schema so unhandled fields produce a `422`. The second
is a one-line change and closes the class of defect, not just this instance.

### Roadmap phase

Phase 8 — Frontend/API contract cleanup.

---

<a id="bug-021"></a>
## BUG-021 — A rejected or oversized import file returns 500 instead of 400/413

| Field | Value |
| --- | --- |
| **ID** | BUG-021 |
| **Severity** | MEDIUM |
| **Feature** | Excel import |
| **Location** | `src/modules/imports.routes.ts:26-46`, `src/middleware/error-handler.ts:28-34` and `:84-88` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The multer `fileFilter` rejects with a bare `Error`. Multer forwards it to
`next(err)`. The error handler recognises `ZodError`, `AppError`, and Postgres
error codes matching `/^\d{5}$/`; a bare `Error` matches none of them and falls
through to the 500 branch. Multer's own `LIMIT_FILE_SIZE` error has
`code === "LIMIT_FILE_SIZE"`, which also fails the five-digit test.

### Evidence

`src/modules/imports.routes.ts:30-41`:

```ts
  fileFilter(_req, file, cb) {
    const ok = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ].includes(file.mimetype);
    if (!ok) {
      cb(new Error("Only .xlsx, .xls and .csv files are accepted"));
      return;
    }
    cb(null, true);
  },
```

`src/middleware/error-handler.ts:28-34` — the pg-code test the bare
`Error` fails:

```ts
function rootCause(error: unknown, depth = 0): unknown {
  if (depth > 5 || !error || typeof error !== "object") return error;
  const cause = (error as { cause?: unknown }).cause;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^\d{5}$/.test(code)) return error;
  return cause ? rootCause(cause, depth + 1) : error;
}
```

Contrast the handler's own validation failures, which correctly use `AppError`
subclasses via `badRequest(...)` — e.g. `imports.routes.ts:163`, `:169`, `:186`,
`:280`.

### Expected behaviour

Uploading a `.pdf` returns `400` with "Only .xlsx, .xls and .csv files are
accepted". Exceeding `MAX_UPLOAD_MB` returns `413`.

### Actual behaviour

Both return `500 {"error":{"code":"internal_error","message":"Unexpected server
error"}}` and write a stack trace to the server log. The precise message the
developer wrote is discarded. The frontend surfaces "Unexpected server error".

### Impact

A routine user mistake presents as a server fault, generates log noise, and
gives the user no actionable feedback. It will also skew any error-rate alerting
built on 5xx counts.

### Recommended fix

Change `cb(new Error(...))` to `cb(badRequest("Only .xlsx, .xls and .csv files
are accepted"))`, and add a `MulterError` branch to the error handler mapping
`LIMIT_FILE_SIZE` → `413` and everything else → `400`.

### Roadmap phase

Phase 9 — Error handling and observability.

---

<a id="bug-022"></a>
## BUG-022 — A disallowed CORS origin produces a 500

> ## ✅ **RESOLVED — Task 1.6, 2026-09-02**
>
> A disallowed origin now returns **403** with `{"error":{"code":"cors_origin_denied","message":"Origin is not permitted"}}`, logged once at **`warn`** with the origin, and **no stack trace**.
>
> **One-line cause, one-line fix.** The callback rejected with a bare `Error`; `error-handler.ts` cannot classify one, so it fell to the terminal 500 branch. It now rejects with `new AppError(403, "cors_origin_denied", …)`, which the handler already understands. **No change to the error handler itself** — giving it a 4xx logging branch would have altered logging for every 401/403/404 in the API.
>
> **Preflight was affected too, and is now fixed — this was not previously recorded.** `cors@2` forwards the rejection to `next()` *before* its own preflight branch runs, so a disallowed `OPTIONS` returned 500 as well. It returns 403 now.
>
> **The security property that had to survive.** Rejection happens *before any route executes*. That is load-bearing, not incidental: the refresh cookie is `SameSite=None` in production (`lib/tokens.ts:82`), so a browser attaches it to cross-site requests. The idiomatic-looking alternative, `callback(null, false)`, merely omits the CORS headers and lets the request into the handler — a hostile page could then rotate a victim's refresh token and simply be unable to read the reply. **Deliberately not used.**
>
> **Evidence.** 16 new tests in `src/tests/cors.test.ts`, no database required (~80 ms). Reverting the fix to the original bare `Error` fails **7 of them**, including the preflight and the `warn`-logging cases. Route non-execution is proven positively, not inferred: an unknown path under a denied origin returns **403 rather than 404**, so `notFoundHandler` was never reached; and `/api/health`'s own payload is absent from the response.
>
> **Deliberately left open:** the rejection log still carries **no `requestId`** — it is assigned at `app.ts:65`, after the CORS middleware, and `pino-http` is mounted later still. Fixing it means reordering global middleware, which is out of scope here. Recorded as a follow-up.

| Field | Value |
| --- | --- |
| **ID** | BUG-022 |
| **Severity** | MEDIUM |
| **Feature** | HTTP / CORS |
| **Location, as found** | `src/app.ts:52-63`, `src/middleware/error-handler.ts:84-88` |
| **Fixed in** | `src/app.ts` — the origin callback only |
| **Present at** | HEAD + working tree |
| **Status** | ✅ **RESOLVED 2026-09-02** (Task 1.6) |

### Problem

Same root cause as BUG-021: the origin callback rejects with a bare `Error`,
which the error handler cannot classify.

### Evidence

`src/app.ts:52-63`:

```ts
  app.use(
    cors({
      // credentials:true forbids a wildcard origin, so the allow-list is
      // checked explicitly. Set CORS_ORIGIN to the Vercel URL in production.
      origin(origin, callback) {
        if (!origin || allowed.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not permitted`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );
```

### Expected behaviour

A request from an unlisted origin is simply not given CORS headers; the browser
blocks it. The server should not treat this as an exception.

### Actual behaviour

Every request from a non-allow-listed origin — including every preflight
`OPTIONS` — throws, is logged as `"Unhandled error"` at `error` level with a
stack trace, and returns `500`. The full origin string is echoed into the log
message.

### Impact

Two practical consequences. First, a misconfigured `CORS_ORIGIN` in a new
environment presents as "the API is returning 500s" rather than "CORS is
misconfigured", which is a materially harder diagnosis. Second, an unauthenticated
third party can generate unbounded `error`-level log volume by pointing a browser
at the API from any origin.

### Recommended fix

Return `callback(null, false)` instead of throwing. The `cors` package then
omits the CORS headers and the browser enforces the policy, which is the
intended mechanism. If an explicit signal is wanted, throw `forbidden(...)` so
the handler emits a `403` rather than a `500`.

### Roadmap phase

Phase 9 — Error handling and observability.

---

<a id="bug-023"></a>
## BUG-023 — The sidebar offers every screen to every role

| Field | Value |
| --- | --- |
| **ID** | BUG-023 |
| **Severity** | MEDIUM |
| **Feature** | Navigation / RBAC |
| **Location** | `frontend/src/lib/nav.ts` |
| **Present at** | ~~HEAD + working tree~~ |
| **Status** | ✅ **CLOSED 2026-09-06 — Wave 4, Task 12.10** |

> **Closed.** `NavItem` gains `permission: string | null`; `visibleNavSections()` filters the catalogue and drops sections left empty. Both consumers use it — the sidebar and the Ctrl+K command palette, which was the same menu by another route and had the same defect. `null` is reserved for Dashboard, Notifications and Settings, which are gated by identity rather than by role; a user must always be able to reach their own password.
>
> **Read the severity honestly.** This was rated MEDIUM as an *RBAC* defect and it is really a usability one: the routes were enforced server-side throughout, and the screens behind them refuse honestly. What it cost was users being invited into dead ends — for an Executive, four of them. **D-089** records why the fix is not treated as a security control.
>
> **Regression:** `frontend/src/lib/nav-permissions.test.ts`, 17 cases, all five seeded roles. Group D asserts the properties that keep this a convenience rather than a control.

### Problem

The navigation model has no permission field. Every entry is rendered for every
authenticated user. The only route filtering that exists anywhere is the demo
allow-list (`frontend/src/components/layout/app-shell.tsx:28-32`), which applies
solely to the presentation account.

### Evidence

`frontend/src/lib/nav.ts:18-24` (the item type) has `label`, `href`, and `icon`
and no permission key; the fifteen entries at `:34-63` are unconditional:

```ts
      { label: "Dashboard", href: "/dashboard", icon: Gauge },
      { label: "Customers", href: "/customers", icon: Users },
      ...
      { label: "Employees", href: "/employees", icon: Users },
      ...
      { label: "Recycle bin", href: "/recycle-bin", icon: Trash2 },
```

`useAuth` exposes `can` / `canAny` (`frontend/src/hooks/use-auth.tsx:259-272`),
and individual pages do use them for action buttons — e.g.
`frontend/src/app/(app)/employees/page.tsx:338`, `:484`, `:491` — but no page is
gated as a whole and the nav is not gated at all.

### Expected behaviour

A user sees only the screens their permissions allow them to use.

### Actual behaviour

An Executive sees Employees, Banks, Recycle bin, Reports, Ledger, and
Settlements in the sidebar. Clicking any of them loads the page, which fires its
requests, receives `403`s, and renders as empty tables and zeroed statistics —
see BUG-018 for how those failures are presented.

### Impact

Every role is presented with a workspace that is mostly non-functional for them,
with no explanation. Server-side authorisation holds — the data is not exposed —
so this is a usability and trust defect rather than a security one. It also
reveals the full administrative surface to every employee.

### Recommended fix

Add `permission?: string | string[]` to the nav item type, populate it from the
`PERMISSIONS` catalogue, and filter with `canAny(...)` in `Sidebar`. Add a
route-level guard in `AppShell` that redirects to `/my-work` when the current
path's required permission is absent, so URL entry behaves the same as
navigation.

### Roadmap phase

Phase 8 — Frontend/API contract cleanup.

---

<a id="bug-024"></a>
## BUG-024 — Nothing in the system ever creates a notification

| Field | Value |
| --- | --- |
| **ID** | BUG-024 |
| **Severity** | MEDIUM |
| **Feature** | Notifications |
| **Location** | `src/modules/admin.routes.ts:948-1002` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The `notifications` table exists, is imported into `admin.routes.ts`
(`src/modules/admin.routes.ts:13`), and has three endpoints — list,
mark-all-read, mark-one-read. All three are read/update. A repository-wide grep
for an insert into `notifications` across `src` returns zero hits. No
route, service, or trigger produces a row.

### Evidence

The three handlers, `src/modules/admin.routes.ts:955-1002`, are
`select` (`:958`), `update` (`:977`), and `update … returning` (`:990`). There
is no `.insert(notifications)` anywhere in the backend.

The UI depends on it in two places: the topbar unread badge
(`frontend/src/components/layout/topbar.tsx:71`, `:86`, `:131-135`) and the
Notifications page (BUG-006).

### Expected behaviour

Operational events — SLA breach on a bank order, settlement raised or disputed,
KYC document rejected, a file assigned to you — produce a notification row for
the relevant user.

### Actual behaviour

`GET /api/notifications` always returns `{data: [], meta: {total: 0, unread: 0}}`.
The bell badge never appears. The Notifications page is permanently empty
(which BUG-006 would cause independently).

### Impact

A shipped, navigable, permanently inert feature. Users are trained to ignore a
notification centre that never has anything in it, which undermines it if it is
later made to work.

### Recommended fix

Introduce a `notify(tx, {userId, title, message, severity, link})` service and
call it from the events that matter: bank-order SLA expiry, settlement status
change, document rejection, loan assignment, and password reset. Emit within the
same transaction as the triggering write so a notification cannot exist for an
event that rolled back.

Related: `app_settings` is a comparable dead table — grep for `appSettings`
outside `src/db/schema` returns zero hits. It is not a bug in itself and
is not registered here, but it should either be used or dropped.

### Roadmap phase

Phase 4 — Notifications.

---

# LOW

<a id="bug-025"></a>
## BUG-025 — `useResource` creates an `AbortController` and never gives its signal to `fetch`

| Field | Value |
| --- | --- |
| **ID** | BUG-025 |
| **Severity** | LOW |
| **Feature** | Data fetching |
| **Location** | `frontend/src/hooks/use-api.ts:44`, `:55-56`, `:63`, `:72-75`; plumbing at `frontend/src/lib/api.ts:104-112`, `:142-149`, `:177-179` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The hook constructs a controller and calls `controller.abort()` on cleanup, but
the request is issued through `api.list`, whose signature accepts only a path
and a query. `RequestOptions.signal` exists and `apiRequest` does pass it to
`fetch`, but nothing populates it from this call path.

### Evidence

`frontend/src/hooks/use-api.ts:44-45` and `:55-56`:

```ts
    const controller = new AbortController();
    let cancelled = false;
    ...
    api
      .list<T>(path, JSON.parse(queryKey) as Query)
```

`frontend/src/lib/api.ts:177-179` — no signal parameter:

```ts
export const api = {
  list: <T>(path: string, query?: RequestOptions["query"]) =>
    apiRequest<Paginated<T>>(path, { query }),
```

`frontend/src/hooks/use-api.ts:63` — a check that can never be true:

```ts
        if (cancelled || controller.signal.aborted) return;
```

`cancelled` is already `true` in every case where `aborted` would be, so the
second clause is dead.

### Expected behaviour

Unmounting or changing the query cancels the in-flight request.

### Actual behaviour

The request runs to completion; only the state update is discarded. Rapid
navigation or fast typing in the command palette (debounced 250 ms,
`frontend/src/components/layout/topbar.tsx:43-50`) leaves superseded requests
running. There is no correctness bug — `cancelled` correctly suppresses stale
writes — only wasted work.

### Impact

Minor. Wasted bandwidth and server capacity, most visible on the search path.

### Recommended fix

Add an optional `signal` to `api.list` / `api.get` and pass
`controller.signal` from both `useResource` and `useRecord` (which does not even
create a controller). Then drop the dead `controller.signal.aborted` clause.

### Roadmap phase

Phase 10 — Cleanup.

---

<a id="bug-026"></a>
## BUG-026 — Unguarded division renders `NaN%` and `₹NaN` on empty result sets

| Field | Value |
| --- | --- |
| **ID** | BUG-026 |
| **Severity** | LOW |
| **Feature** | Banks, Disbursement, Documents |
| **Location** | `frontend/src/app/(app)/banks/page.tsx:139`, `frontend/src/app/(app)/disbursement/page.tsx:200-205`, `frontend/src/app/(app)/documents/page.tsx:230` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

Three KPI tiles divide by `rows.length` with no zero check. `formatCurrency`
does not defend against `NaN` either — its normaliser is `Number(input ?? 0)`,
and `NaN` is neither `null` nor `undefined`, so it passes straight through to
`Intl.NumberFormat`.

### Evidence

`frontend/src/app/(app)/banks/page.tsx:137-140`:

```tsx
        <StatCard
          label="Average slab"
          value={`${(rows.reduce((total, row) => total + num(row.commissionRate), 0) / rows.length).toFixed(2)}%`}
```

`frontend/src/app/(app)/disbursement/page.tsx:199-205`:

```tsx
        <StatCard
          label="Average ticket"
          value={formatCurrency(
            Math.round(rows.reduce((total, row) => total + num(row.amount), 0) / rows.length),
            { compact: true },
          )}
```

`frontend/src/app/(app)/documents/page.tsx:225-231`:

```tsx
        <StatCard
          label="Verified"
          value={String(verified.length)}
          icon={CheckCircle2}
          accent="var(--success)"
          helper={`${Math.round((verified.length / rows.length) * 100)}% of the vault`}
```

`frontend/src/lib/format.ts:3-18` — the unprotected normaliser:

```ts
export function formatCurrency(
  input: number | string | null | undefined,
  options?: { compact?: boolean },
) {
  const value = Number(input ?? 0);
```

Two neighbouring pages get this right and are the model to follow:
`frontend/src/app/(app)/reports/page.tsx:251` (`rows.length ? … : 0`),
`frontend/src/app/(app)/settlements/page.tsx:197` (`total ? … : 0`), and
`frontend/src/app/(app)/customers/page.tsx:594-605` (explicit
`rows.length > 0 ?` guards).

### Expected behaviour

An empty list shows `0.00%`, `₹0`, and `0%`.

### Actual behaviour

Banks shows `NaN%`, Disbursement shows `₹NaN`, and Documents shows `NaN% of the
vault` whenever the corresponding list is empty — which is the state of a fresh
installation, and the state every bank-scoped user sees for a resource they have
no rows in.

### Impact

Cosmetic, but it is the first thing a new deployment shows and it reads as a
crash.

### Recommended fix

Guard each expression with `rows.length ? … : 0`, matching the existing pattern.
Additionally harden `formatCurrency`, `formatNumber`, and `formatPercent` with
`Number.isFinite(value) ? value : 0`, so the class of defect cannot recur at any
other call site.

### Roadmap phase

Phase 10 — Cleanup.

---

<a id="bug-027"></a>
## BUG-027 — ~~`GET /api/customers/check/reference` is unreachable~~ — **INVALID (misdiagnosis)**

| Field | Value |
| --- | --- |
| **ID** | BUG-027 |
| **Severity** | ~~LOW~~ — n/a |
| **Feature** | Customers (backend routing) |
| **Location** | `src/modules/customers.routes.ts:181` versus `:329-363` |
| **Present at** | — |
| **Status** | ❌ **INVALID — CLOSED 2026-09-02 (Task 1.9).** The route was never shadowed. Its one accurate observation is carried forward below. |

### Why it is invalid

The premise is true and the conclusion does not follow. `GET /:id` **is**
registered before `GET /check/reference`, but **`:id` matches exactly one path
segment**, so it can never match a two-segment path.

Measured with the installed `path-to-regexp@8.4.2`, `/:id` compiles to:

```
^(?:\/([^\/]+))(?:\/$)?$
```

The `[^\/]+` class excludes the slash. `regexp.test("/check/reference")` is
`false`. Dumping the live `customersRouter.stack` and calling each layer's own
`.match()` confirms only the literal layer matches `/check/reference`.

End to end against the real application, **before** any Task 1.9 change:

```
GET /check/reference?bankId=<uuid>&bankReferenceId=NEW   -> 200 {"available":true}
GET /check/reference?bankId=<uuid>&bankReferenceId=TAKEN -> 409 conflict, details.existingCustomerCode
GET /check/reference   (no query)                        -> 422 on bankId/bankReferenceId
```

So every one of these claims in the original entry is **measurably false**:

| Original claim | Measured |
|---|---|
| "is unreachable" | Reachable; returns 200/409 correctly |
| "matches `/:id` with `id = \"check\"`" | No layer for `/:id` matches `/check/reference` |
| "`500 internal_error` from a Postgres `22P02`" | 200, 409 or 422 depending on the query |
| Fix: "move the registration above `/:id`" | A no-op — would have closed a ticket that fixed nothing |

[PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md) Phase 4 already stated the
correct opposite — *"`GET /customers/check/reference` exists, **works**, and has
zero callers"* — so the register contradicted the roadmap for two days.

### What was accurate, and is kept

1. **Zero callers.** Verified: a repository-wide grep for `check/reference`
   returns only the declaration. The docstring describes a use never built.
   Wiring it into the create form remains **roadmap Task 4.6**.
2. **The forward-looking rule is sound, for a reason the entry did not give.** A
   **single-segment** literal added after `/:id` on the same method *would* be
   captured — `/export`, `/stats`, `/search`. Measured: `GET /api/customers/check`
   returned **500** before Task 1.9. It now returns a legible 422 naming `id`,
   and `customer-lookup.test.ts` group D pins both that and the reachability of
   `/check/reference` by response signature rather than by registration order.

### Disposition

**INVALID (misdiagnosis), superseded by [BUG-017](#bug-017).** Not counted as a
fixed defect — nothing was broken. The single-segment hazard is carried as a
note on the `:id` guard, and the zero-callers observation moves to Task 4.6.

---

<a id="bug-028"></a>
## BUG-028 — `loading` and `error` are destructured from `useResource` and never rendered

| Field | Value |
| --- | --- |
| **ID** | BUG-028 |
| **Severity** | LOW |
| **Feature** | Multiple list pages |
| **Location** | See table |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

Nine pages pull `loading` and/or `error` out of `useResource` and never use
them. The hook maintains both correctly; the pages discard them.

### Evidence

| Page | Line | Destructured |
| --- | --- | --- |
| `app/(app)/loans/page.tsx` | 51 | `loading, error` |
| `app/(app)/ledger/page.tsx` | 46 | `loading, error` |
| `app/(app)/bank-orders/page.tsx` | 54 | `loading, error` |
| `app/(app)/banks/page.tsx` | 35 | `loading, error` |
| `app/(app)/disbursement/page.tsx` | 43 | `loading, error` |
| `app/(app)/documents/page.tsx` | 52 | `loading, error` |
| `app/(app)/settlements/page.tsx` | 32 | `loading, error` |
| `app/(app)/transactions/page.tsx` | 33 | `loading, error` |
| `app/(app)/notifications/page.tsx` | 72 | `loading, error, refresh` |

`frontend/src/app/(app)/ledger/page.tsx:46`:

```tsx
  const { data: rows, loading, error, refresh } = useResource<LedgerEntry>("/ledger");
```

`frontend/src/hooks/use-api.ts:62-67` sets `error` from `errorMessage(err, "Could
not load this list")` and clears `data` to `[]` on failure.

### Expected behaviour

A loading skeleton while the request is in flight, and a visible error state
with a retry when it fails.

### Actual behaviour

Every one of these screens renders an empty table during load and an identical
empty table on a `403`, `422`, `500`, or network failure. The message the hook
captured is thrown away. Coupled with BUG-023 (every screen offered to every
role), this means a permission failure and an empty book are visually identical
on nine screens.

### Impact

Individually cosmetic; collectively it is the reason several other bugs in this
register are invisible to users and were only found by reading source.

### Recommended fix

Add a shared `<ListState loading error onRetry>` wrapper and use it on all nine.
Passing the state into `DataTable`'s existing `emptyState` prop
(`frontend/src/components/shared/data-table.tsx:62`, `:268`) is the smallest
change that works.

### Roadmap phase

Phase 10 — Cleanup.

---

<a id="bug-029"></a>
## BUG-029 — Dead imports across the page tree

| Field | Value |
| --- | --- |
| **ID** | BUG-029 |
| **Severity** | LOW |
| **Feature** | Multiple pages |
| **Location** | See evidence |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

A repeated import block — `useRecord`, `useStats`, `api`, `errorMessage`, `num`,
plus assorted unused types — was copied across pages and left in place where the
symbols are not used. It is the residue of the demo-to-API migration.

### Evidence

`frontend/src/app/(app)/notifications/page.tsx:16-19`:

```tsx
import { useResource, useRecord, useStats } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { num } from "@/lib/types";
import type { ActivityItem, NotificationItem, Team } from "@/lib/types";
```

Of those, the page uses only `useResource`, `NotificationItem`, and
`ActivityItem`. `useRecord`, `useStats`, `api`, `errorMessage`, `num`, and
`Team` are unreferenced.

The same `useResource, useRecord, useStats` triple appears with unused members
in `reports/page.tsx:33`, `ledger/page.tsx:32`, `loans/page.tsx:32`,
`documents/page.tsx:43`, `dashboard/page.tsx:31`, and
`customers/[id]/page.tsx:49`. Unused type imports include `Bank` in
`loans/page.tsx:35`, `ledger/page.tsx:35`, `documents/page.tsx:46`, and
`reports/page.tsx:36`.

Related dead code in the same family: `frontend/src/app/(app)/reports/page.tsx:49-50`
and `frontend/src/app/(app)/dashboard/page.tsx:56-58` declare
`const monthlyTrend: […] = []` and `const activity: ActivityItem[] = []`, which
are passed to `<TrendChart>` and rendered as an activity list respectively —
permanently empty placeholders left where demo fixtures used to be.

### Expected behaviour

No unused imports; no permanently-empty placeholder arrays feeding live
components.

### Actual behaviour

Dead symbols in nine files, and two charts/lists that render empty by
construction on the Dashboard and Reports screens.

### Impact

No runtime effect beyond marginal bundle size. The real cost is that these
imports make it look as though a page fetches data it does not, which is
actively misleading when auditing the frontend/API contract.

### Recommended fix

Enable `@typescript-eslint/no-unused-vars` as an error (currently not failing the
build — there is no CI in this repository at all: no `.github/`, no `*.yml`, no
Dockerfile, no `vercel.json`) and clear the reported set. Either wire
`monthlyTrend` and `activity` to real endpoints or delete the components that
consume them.

### Roadmap phase

Phase 10 — Cleanup.

---

<a id="bug-030"></a>
## BUG-030 — Customers page holds a `search` state with no setter, so server-side search is permanently disabled

| Field | Value |
| --- | --- |
| **ID** | BUG-030 |
| **Severity** | LOW |
| **Feature** | Customers |
| **Location** | `frontend/src/app/(app)/customers/page.tsx:59-66` |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The page declares `search` with the setter destructured away, then passes it to
`useResource` as the API's `search` parameter. It can therefore only ever be
the empty string.

### Evidence

`frontend/src/app/(app)/customers/page.tsx:59-67`:

```tsx
  const [search] = React.useState("");

  const {
    data: rows,
    refresh,
  } = useResource<Customer>("/customers", {
    search,
    pageSize: 100,
  });
```

`apiRequest` skips empty-string query values
(`frontend/src/lib/api.ts:130-134`), so the parameter is not even sent. The
backend's `ilike` search over `name`, `mobile`, `code`, and `bankReferenceId`
(`src/modules/customers.routes.ts:109-118`) is never exercised from this
page. The only search the user gets is `DataTable`'s client-side filter over the
100 rows already loaded.

### Expected behaviour

Typing in the Customers search box narrows the query server-side across the
whole book.

### Actual behaviour

Search is confined to the first 100 rows the page happened to load. A customer
at position 101 cannot be found from the Customers screen. (The command palette
does search server-side — `frontend/src/components/layout/topbar.tsx:66-70` —
but landing on the result is broken by BUG-017.)

### Impact

Low in a small book, and it becomes a functional gap as the customer table
grows past 100 rows.

### Recommended fix

Either wire the setter to `DataTable`'s search input via a debounced callback
prop, or delete the `search` state and the query parameter so the code stops
implying a server-side search that does not happen.

### Roadmap phase

Phase 10 — Cleanup.

---

## Corrections to previously circulated summaries

Two claims that were carried into this register's brief did **not** survive
verification and are recorded here so they are not re-raised:

1. **"`customers/page.tsx` renders `NaN%` / `₹NaN` on empty data."** False. That
   page guards both computations explicitly with `rows.length > 0 ?`
   (`frontend/src/app/(app)/customers/page.tsx:594-605`). The NaN defect is real
   but lives on the Banks, Disbursement, and Documents pages — see BUG-026.

2. **"Thirteen fake write handlers, including the Print button."** The Print
   control at `frontend/src/app/(app)/customers/[id]/page.tsx:185` is not a
   write. There are thirteen fake *writes*, itemised in BUG-002, plus that one
   non-write toast, which is noted at the end of BUG-002 rather than counted.

## Items deliberately not registered as bugs

These are verified facts about the system that are absent features rather than
defects, and are recorded elsewhere in the documentation set:

| Fact | Verification |
| --- | --- |
| Email delivery does not exist. | Zero provider dependencies, zero transport code, zero templates, zero `EMAIL_`/`SMTP_`/`MAIL_` environment variables. |
| File storage does not exist. | `multer` appears only in `imports.routes.ts`, `memoryStorage`, buffer discarded. Underlies BUG-004. |
| `app_settings` is a dead table. | Grep for `appSettings` outside `src/db/schema` returns zero hits. |
| No rate limiting. | `src/app.ts:44-76` mounts helmet, cors, request id, json, urlencoded, cookie-parser, pino-http. No limiter. Underlies BUG-012. |
| No CI and no E2E tests. *(Frontend tests now exist — 55 across 5 files from Phase 1 — covering the demo/auth boundary and the palette link target only. Corrected 2026-09-02.)* | No `.github/`, no `*.yml` in the repository, no Dockerfile / `vercel.json` / `railway.*` / `Procfile`. 107 backend runtime test cases only. |
| 58 of 96 backend endpoints (60%) have no frontend caller. | The frontend issues 38 distinct METHOD+path pairs. (An earlier figure of 27/69/72% counted only the GET-only `FRONTEND_CALLS` test array and omitted all 16 write paths.) Partly a consequence of BUG-002. |

---

<a id="bug-039"></a>
## BUG-039 — The loans table's Type column renders `—` for every row

| Field | Value |
| --- | --- |
| **ID** | BUG-039 |
| **Severity** | LOW |
| **Feature** | Loans |
| **Location** | `frontend/src/app/(app)/loans/page.tsx` — the `columns` array, Type column |
| **Present at** | HEAD + working tree |
| **Status** | OPEN |

### Problem

The Type column is declared with `key: "type"` and no `render`, but the field on `Loan` is **`loanType`**. `DataTable` falls back to `String(row[key] ?? "—")`, so the cell shows an em-dash on every row while the data is present and correct.

### Evidence

Found during Task 5.5 (2026-09-05) while adding the loan edit dialog, which does read `loanType` correctly. The CSV export is **unaffected** — it falls back to `sortValue`, which resolves the right field — so the defect is visible only on screen.

This is the same class as the employees screen's Role column (`key: "role"` with no `render`, field `roleName`), carried in `docs/claude/NEXT_TASK.md` since Task 3.7, and the silent-fallback hazard recorded in **D-040**.

### Expected behaviour

The column shows the loan type.

### Recommended fix

Either key the column `loanType`, or give it an explicit `render`. One line.

### Why it was not fixed in Phase 5

Out of scope for every row in the phase — 5.8 owns the *query*, not the column set — and **RULES §10** requires recording an unrelated defect rather than fixing it opportunistically. Recorded here instead.
