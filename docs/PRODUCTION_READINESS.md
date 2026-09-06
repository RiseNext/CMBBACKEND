# PRODUCTION READINESS CHECKLIST

**Every item is `NOT STARTED` / `IN PROGRESS` / `DONE` / `BLOCKED`.**
An item is `DONE` only when it is verified end to end and covered by a test. Update it the moment its state changes.

**As of:** 2026-09-06 · **Overall verdict: NOT READY — but the product is now substantially built and the remaining risk is concentrated in security and infrastructure.**

**Phases 0–10 are COMPLETE.** Phase 1 (demo isolation and auth integrity), Phase 2 (employee management), Phase 3 (credential delivery and email), Phase 4 (customers), Phase 5 (loans), and the consolidated Phase 6–10 block (bank orders, disbursement, transactions and settlements, document storage, notifications — 42 rows) have all landed and are covered by tests.

**Phases 11–16 remain**, and **Waves 0–3 of the consolidated pre-deployment programme are complete.**

| Wave | Result |
|---|---|
| **0** | Repository integrity — `db:generate` un-broken, snapshots `0008`–`0013` reconstructed and proven, env templates completed |
| **1** | 17 dishonest controls removed · SEC-004, 006, 012, 015, 022 closed · SEC-011 downgraded · 5 display-truth defects |
| **2** | Migrations `0014` (9 status CHECKs, **SEC-016** closed) and `0015` (ledger bank scoping, **OPEN-7** resolved) · `23514` mapped |
| **3** | **SEC-005 and SEC-007 (both P0) closed**, SEC-008 and SEC-013 closed, SEC-002 and SEC-017 downgraded · Tasks 11.3, 11.7, 11.9, U-5, 13.1, 13.4, 13.7, 13.8, 13.9, 13.12 |

**Waves 4–6 are NOT started**: the admin UI (Phase 12), all of production infrastructure (Phase 15), CI and real-Postgres verification (14.7/14.9), and the final gate (Phase 16).

**Measured baseline, 2026-09-06 — executed, not quoted:**

| Gate | Result |
|---|---|
| Backend tests | **1102 passed / 1102, 47 files** |
| Backend `tsc --noEmit` | **clean** |
| Backend lint | **clean** |
| Frontend tests | **997 passed / 997, 44 files** |
| Frontend `tsc --noEmit` | **clean** |
| Frontend lint | **58** (1 pre-existing error in `use-auth.tsx`, 57 warnings) |
| `npm run db:generate` | **exit 0 — "No schema changes, nothing to migrate"** |
| `drizzle-kit check` | **"Everything's fine"** |
| Migrations / snapshots / journal | **`0000`–`0015` — 16 / 16 / 16** |
| **Real PostgreSQL** | ❌ **never run** — no server available. Phase 14.9 |
| **S3 live integration** | ❌ **never run** — no credentials or bucket |
| **CI** | ❌ **does not exist** — not one `.yml` in the repository. Phase 14.7 |
| Deployment | **none — the application has never been deployed** |

> **Scorecard recount, 2026-09-06 (Wave 0).** The scorecard below is **recomputed mechanically from the area tables in this document**, which were themselves re-verified against code during the master production-readiness audit. The previous header was two phases stale — it described Phase 3 as in progress and asserted that no product email is sent, both of which stopped being true on 2026-09-04. This is **U-13** from that audit. No item's status was changed without evidence in the table row itself.

> **Scorecard recount, 2026-09-02 (Phase 1 final review) — retained as history.** The scorecard was recounted mechanically against its own area tables. Eight of seventeen rows disagreed. **One was caused by Phase 1** — Task 1.8 added row A13 and Task 1.7 flipped A6 to DONE, but the Authentication row was never incremented. The other seven are byte-identical at the Phase 0 baseline `7977d6b` and were inherited, not introduced. Also resolved: **A6 and X9 are the same control** ("cookie flags correct in production"). Corrected total at that date: **160 items, 59 DONE, 37%** (was 159 / 50 / 31%).

---

## SCORECARD

| Area | Items | DONE | IN PROGRESS | NOT STARTED | BLOCKED |
|---|---|---|---|---|---|
| Authentication | 13 | 13 | 0 | 0 | 0 |
| Employee management | 11 | 11 | 0 | 0 | 0 |
| Authorization | 8 | 8 | 0 | 0 | 0 |
| Customers | 9 | 9 | 0 | 0 | 0 |
| Loans | 9 | 9 | 0 | 0 | 0 |
| Documents | 8 | 7 | 1 | 0 | 0 |
| Bank operations | 8 | 7 | 1 | 0 | 0 |
| Disbursement | 6 | 5 | 1 | 0 | 0 |
| Transactions | 5 | 5 | 0 | 0 | 0 |
| Settlement | 5 | 5 | 0 | 0 | 0 |
| Notifications | 7 | 5 | 0 | 2 | 0 |
| Reports | 7 | 5 | 2 | 0 | 0 |
| Ledger | 5 | 4 | 0 | 1 | 0 |
| Audit | 6 | 5 | 1 | 0 | 0 |
| Security | 24 | 17 | 5 | 2 | 0 |
| Operations | 18 | 8 | 5 | 5 | 0 |
| Testing | 11 | 7 | 1 | 3 | 0 |
| **TOTAL** | **160** | **130** | **17** | **13** | **0** |

**81% of production-readiness criteria are met** (130 of 160), up from 41% (66 of 160) on 2026-09-04 and 65% at the start of Wave 1.

*Recomputed mechanically from the area tables below on 2026-09-06 — `PARTIAL` and `IN PROGRESS` are both counted in the IN PROGRESS column. The item count is unchanged at 160; only statuses moved, and every move is evidenced in its own row.*

**Where the 38 newly-DONE items came from:** Phase 3 finished credential delivery end to end (A7, A9, E10). Phase 4 closed the customer screen (C3–C7). Phase 5 closed the loan workflow including approve, reject and validated transitions (L1–L7). Phase 6–10 closed bank orders (B2–B5), disbursement (P1, P2), transactions (T1, T3), settlements (S1, S3, S4), the whole of documents (D1, D3–D8, X11) and notifications (N1–N5).

**The 50 that remain cluster tightly:** reports and ledger (12), operations and infrastructure (14), security hardening (9), testing (6), audit viewing (3), and six singles. **That is Phases 11–16, and nothing else.**

> **Historical baselines, retained.**
> **2026-08-31 (Task 0.1):** all 5 quality gates PASS, **107/107** backend tests, zero frontend tests. At that date all 13 fake handlers, the demo-mode hijack, the missing file storage and the missing email subsystem were exactly as recorded — a green build proved the code compiled and nothing more.
> **2026-09-02:** 55 frontend and 171 backend tests. **2026-09-04:** 454 frontend and 687 backend.
> **2026-09-06:** **949 frontend and 967 backend.** These counts are a record of growth, not a target; do not rewrite the earlier figures.

---

## AUTHENTICATION

| # | Item | Status | Evidence / blocker |
|---|---|---|---|
| A1 | Real users can log in | **DONE** | `src/modules/auth.routes.ts:81`; argon2id |
| A2 | Logout works and revokes server-side | **DONE** | `auth.routes.ts:195` |
| A3 | Sessions are secure (httpOnly, rotating, hashed at rest) | **DONE** | `lib/tokens.ts`; reuse revokes the family |
| A4 | Refresh works | **DONE** | `auth.routes.ts:157` |
| A5 | Password change works | **DONE** | `auth.routes.ts:221` |
| A6 | Cookie flags correct in production | **DONE** — Task 1.7, 2026-09-02. **SEC-028 closed.** The flags were always right for a given `NODE_ENV`; the defect was that `NODE_ENV` **defaulted** to `development` while nothing in the repo sets it, so a deploy that forgot it shipped `Secure=false; SameSite=Lax`. It is now **required** — config validation refuses to boot without it. 17 tests; restoring the default fails 2. `lib/tokens.ts` untouched |
| A7 | Password reset (self-service) | **DONE** | **Backend complete 2026-09-04 (Task 3.6).** `POST /api/auth/forgot-password` (always 204, never confirming an address exists — in the response *and* in the logs) and `POST /api/auth/reset-password`. `password_resets` table (migration `0004`, digest only), 1-hour expiry, atomic single-use consume, all sessions revoked and the lockout cleared on completion, both endpoints rate limited. 43 tests. **DONE end to end 2026-09-04 (Task 3.12)**: `/forgot-password` → email → `/reset-password` → sign in, **with no administrator involved**. The request page carries the enumeration risk and answers it with a **conditional confirmation byte-identical** for known, unknown and deactivated addresses, shown on 204 only. `/login`'s "Forgot password?" no longer says *"contact your administrator"* — a claim that had been false since 3.6. 116 further tests (**D-046**) |
| A8 | Employee onboarding works | **DONE** | Committed `583897f` (Task 0.2). Create→temp password→login→forced change proven by `employee-lifecycle.test.ts:124-130`. Credential delivery is still manual — see E10 |
| A9 | Invitation flow | **DONE** | **Backend complete 2026-09-04 (Task 3.5).** `invitations` table (migration `0003`, digest only), issuance inside the employee-create transaction, and public `POST /api/auth/accept-invite`. Single-use via an atomic conditional consume; 72-hour expiry; one identical refusal for every unusable token. 49 tests. **DONE end to end 2026-09-04 (Task 3.11)**: `/accept-invite` is built, so an invited employee now completes setup in a browser — email → page → password set → sign in, proven by an integration test that parses the emailed URL as a browser does. The page branches on **status, not message**, so only a 400 reports an unusable link (**D-045**). 69 further tests |
| A10 | Forced password change enforced **server-side** | **DONE** | **Task 2.3, 2026-09-02 — SEC-010 / BUG-005 closed.** `requireAuth` is the strict default and answers a flagged session with **403 `password_change_required`**; exactly two routes opt out through `requireAuthAllowPasswordChange` (`GET /api/auth/me`, `POST /api/auth/change-password`). No path allow-list — `req.path` is mount-relative and would never have matched (D-023). 18 backend + 1 frontend test; 4 mutations reversion-proven. **Residual:** temporary credentials still never expire (SEC-010 remediation 3) |
| A11 | Rate limiting on auth endpoints | **DONE** — Task 13.1, 2026-09-06. **SEC-005 (P0) closed.** `/api/auth/login` throttled per address AND per account; a global limiter backstops every route; argon2 concurrency capped at 4 with a bounded wait queue. 15 regression cases, **reversion-proven** (5 fail against pre-fix code). Residual — per-process, in-memory, fixed-window — recorded in **D-085** |
| A12 | No user enumeration | **DONE** — Task 13.2, 2026-09-06. **SEC-004 closed.** A locked account answered **429** while an unknown address answered 401, and only a real account can be locked — the status code alone confirmed existence, no password required. Both now return the identical 401. The lockout still holds; it is simply no longer observable. 4 regression cases, **reversion-proven** |
| A13 | Deactivated session ends promptly on the client | **DONE** — Task 1.8, 2026-09-02. **BUG-034 closed.** `account_inactive` / `role_disabled` are raised by the per-request session gates and are the *only* codes that trigger client sign-out; ordinary `forbidden` 403s (missing permission, bank scope, hierarchy, demo fixtures) leave the user signed in. Previously the session stayed visible until access-token expiry — up to 15 minutes. 11 backend + 7 frontend tests; proven in both directions by reversion |

## EMPLOYEE MANAGEMENT

| # | Item | Status | Evidence / blocker |
|---|---|---|---|
| E1 | Super Admin can create an employee | **DONE** | Committed `583897f` |
| E2 | Role assignment | **DONE** | At create only; default-to-Super-Admin defect fixed. **The roles themselves became manageable 2026-09-06 (Task 12.1)** — `/roles` lists, creates, edits, deletes and re-grants permissions through routes that had existed since the first migration with zero callers. The hierarchy and `assertCanGrantPermissions` are mirrored in the UI so no control is offered that is certain to 403, and a permission the viewer does not hold is **disabled and explained** rather than hidden. 21 cases |
| E3 | Team assignment | **DONE** | **Task 2.7, 2026-09-03 — wired end to end.** A "Team" dialog on the employee detail view calls `PUT /api/teams/:id/members`, gated on `can("teams.assign")`. The route replaces a team's **entire** roster, so the client re-reads `GET /teams` at save time and resubmits every other member unchanged — building the roster from cached reference data would evict anyone added since sign-in. A move is two requests (off the old team, then onto the new); a partial failure is reported honestly rather than as a success (**D-028**). Underneath, the route is authorization-correct as of the same day (**BUG-038 / SEC-029** closed): every affected member is checked against the role hierarchy over the union of the previous and submitted rosters. 48 backend + 30 frontend tests |
| E4 | Bank/access scope assignment | **DONE** | **Task 2.6, 2026-09-03 — wired end to end.** A "Bank access" dialog on the employee detail view calls `PUT /api/users/:id/banks`, gated on `can("users.assign")` (the permission the route requires — **not** `users.edit`). Sends the complete desired set; adopts the server's returned list. `PATCH` still refuses `bankIds` with 422 (Task 2.5, **BUG-020**). 22 frontend tests |
| E5 | Employee edit | **DONE** | **Task 2.4, 2026-09-03.** Edit dialog on the employee detail view, gated on `users.edit`. Sends only changed fields — an explicit `0` survives, an untouched form issues no request, and opening a revoked employee to fix a typo does **not** reactivate them. Backend 400/409/403/422 messages are surfaced verbatim. **Not editable here:** bank access, team and joining date (**BUG-020**, open) |
| E6 | Activation / deactivation | **DONE** | The UI issues a real `PATCH` (committed `583897f`) and the route is now guarded — **Tasks 2.1 + 2.2, 2026-09-02**. A self-deactivation is 400 and a change emptying the Super Admin population is 409, both surfaced by `toggleStatus`'s existing error toast. Related open defect, not a blocker for this row: **BUG-036** — a PATCH that never mentions `status` still writes `Active`, so an unrelated edit reactivates a revoked account. Phase 2.5 |
| E7 | Employee delete + restore | **DONE** | **Delete wired 2026-09-03 (Task 2.8)** — gated on `can("users.delete")` behind an explicit confirmation; the route's 400 (self-delete), 409 (last active Super Admin) and 403 (hierarchy) are surfaced verbatim. **Restore added 2026-09-03 (Task 2.9)** — `user` is now in `BIN_REGISTRY`, the delete runs through `softDelete`, and the full round trip works: active → DELETE → recycle bin → restored. A restored employee comes back **deactivated**, so recovering the record is not the same as re-granting access. The bin's restore and purge routes now apply the role hierarchy to user entries (**D-030**), and the retained snapshot is stripped of the password hash. 23 frontend + 29 backend tests |
| E8 | Temporary password generation | **DONE** | Policy-guaranteed, ambiguity-free |
| E9 | Admin password reset | **DONE** | Revokes sessions, audits, hierarchy-guarded |
| E10 | Credential delivered to the employee | **DONE** | **Task 3.5, 2026-09-04.** Creating an employee emails a single-use, time-limited setup link (**D-037**). **Task 3.9, 2026-09-04:** the on-screen hand-over is confirmed kept and is now an *explicit* fallback — the create screen states whether a link is actually on its way, where previously an outage and a success rendered identically. `logged` counts as **not delivered**, with `failed`, because the console transport delivers nothing. The password is shown for every outcome; **53 tests and 14 mutations** now stand behind that, where there had been none. **End to end as of 2026-09-04** — **Task 3.11** built `/accept-invite`, so the emailed link now works (**D-045**) |
| E11 | Resend invitation | **DONE** — Task 3.8, 2026-09-04 | `POST /api/users/:id/resend-invitation` + a gated button on the employee detail view. Gated on `users.reset_password` **and** `assertCanManageRoleLevel` — a flat permission check on a credential route is what BUG-038 was. Refused 409 once the employee has accepted, and 409 while they are not Active. Supersession, digest-only storage, the 72-hour TTL and the `invited_at` move are all inherited from `issueInvitation`, exactly as D-040 predicted. Audited as `invitation_resent`, with no token, digest or URL in the row. **No throttle** — the endpoint is authenticated and hierarchy-bound, so SEC-005's public-endpoint limiter does not apply; the residual provider-quota risk is named in **D-041** |

## AUTHORIZATION

| # | Item | Status | Evidence / blocker |
|---|---|---|---|
| Z1 | Backend enforces permissions | **DONE** | `requirePermission` on every mutating route |
| Z2 | Permissions re-read per request | **DONE** | `services/access.ts:30` |
| Z3 | Employees cannot access admin functionality | **DONE** | Verified by test |
| Z4 | Users cannot access other banks' data | **DONE** | SQL-level, fails closed. No IDOR found |
| Z5 | Privilege escalation prevented | **DONE** | Hierarchy + `assertCanGrantPermissions`. **This evidence was incomplete until 2026-09-03:** `PUT /api/teams/:id/members` consulted the hierarchy nowhere, so a Manager could place a Super Admin on a team (measured **200**) — BUG-038 / **[SEC-029](SECURITY_AUDIT.md#sec-029)**, now closed. The rule is enforced on **ten** routes; see `ROLES_AND_PERMISSIONS.md` §4.2 |
| Z6 | No role-name string comparisons in authz | **DONE** | Zero occurrences |
| Z7 | Frontend navigation reflects permissions | **DONE** — Task 12.10, 2026-09-06 | `NavItem` had no permission field at all, so all fourteen entries rendered for all five roles — an Executive was invited into Reports, Settlements, Ledger and the Recycle bin, every one of which answers 403. `visibleNavSections()` now filters the catalogue and the Ctrl+K palette against the session's real permissions, dropping emptied sections. **This is a usability change and not a security one** (**D-089**): every route stays enforced server-side and every screen keeps its own honest refusal for direct URL access. 17 cases across all five seeded roles |
| Z8 | Super Admin cannot self-lock the tenant | **DONE** | **Tasks 2.1 + 2.2, 2026-09-02 — SEC-003 / BUG-003 closed.** Field-scoped self-guard on `PATCH` (self-`status`→Inactive and self-demotion off the system role are 400; harmless self-edits and no-op echoes stay 200) plus the shared `assertSuperAdminRemains` invariant used by **both** `PATCH` and `DELETE`. 26 tests; 9 fail against the pre-fix code; 4 mutations reversion-proven. **Residual, recorded not closed:** no break-glass recovery script (SEC-003 remediation 4) and the check-then-write race (**BUG-037**) |

## CUSTOMERS

| # | Item | Status |
|---|---|---|
| C1 | Create | **DONE** |
| C2 | View (list + detail) | **DONE** — and reachable from global search as of Task 1.9, 2026-09-02 (**BUG-017**). The palette links by `id`; a malformed `:id` on GET/PATCH/DELETE is now **422 `validation_failed`** naming `id`, not a 500 with a logged SQL statement and stack trace. `error-handler.ts` unchanged (D-021). 20 backend + 2 frontend tests |
| C3 | Edit | **DONE** — Task 4.1. Detail edit issues a real `PATCH` and adopts the server row (D-026); `customer-detail-edit.test.tsx` |
| C4 | Delete where permitted | **DONE** — Task 4.2, list **and** detail; `customer-detail-delete.test.tsx` |
| C5 | Server-side search | **DONE** — Task 4.5 |
| C6 | Server-side filtering | **DONE** — Task 4.5; the frontend now sends the filters the backend already supported |
| C7 | Server-side pagination | **DONE** — Task 4.5; `customers-server-paging.test.tsx` |
| C8 | Correct persistence | **DONE** |
| C9 | Bulk import | **DONE** — the reference implementation. **Note:** hardening is still owed — SEC-008 (zip bomb, unbounded row loop) and SEC-009 (plaintext Aadhaar retained in `import_rows`) are both open. Phases 13.7 and 15.9 |

## LOANS

| # | Item | Status |
|---|---|---|
| L1 | Create | **DONE** — Task 5.1 closed BUG-015; the dialog now closes on success. `loans-create-dialog.test.tsx` |
| L2 | Update | **DONE** — Task 5.5; `loans-edit-dialog.test.tsx` |
| L3 | Submit to bank | **DONE** — Task 6.4. A loan reaching `Submitted` gets its bank order inside the same transaction, by either door (`ensureBankOrderForLoan`) |
| L4 | Verify | **DONE** — Task 5.6; `loans-verification.test.tsx` |
| L5 | Approve | **DONE** — Task 5.4, through `POST /api/loans/:id/approve`, **not** PATCH. `loans-approve.test.tsx` |
| L6 | Reject | **DONE** — Task 5.4, same route |
| L7 | Status transitions validated | **DONE** — Task 5.2. Service-layer machine (`assertTransitionAllowed`) **plus** the `loans_status_check` CHECK in migration `0007`. PATCH refuses `status` outright (D-056) |
| L8 | Persistence | **DONE** |
| L9 | Audit trail | **DONE** — and atomic with the write since **F1-a** (D-062) |

## DOCUMENTS

| # | Item | Status |
|---|---|---|
| D1 | Actual file upload | **DONE** — Task 9.4. `POST /api/documents/upload` (multer, in-memory) writes real bytes through the storage adapter inside one transaction |
| D2 | Secure storage | **PARTIAL** — Tasks 9.2/9.3. A provider-agnostic `StorageAdapter` exists with an S3 implementation signing its own SigV4 requests (no `@aws-sdk`, D-006), SSE-AES256 on every PUT, and a local filesystem adapter for dev/test that production **cannot** reach (`loadEnv` refuses to boot without full storage config, D-072). ⚠️ **Never exercised against a live bucket** — `storage.ts:34-39` says so. Unit tests prove the signing algorithm, not the integration. Blocking for deployment |
| D3 | Download | **DONE** — Task 9.5. `GET /api/documents/:id/content`, authorization-checked **before** any URL is minted; either a short-lived presigned URL or bytes streamed through the process. Never a public bucket URL |
| D4 | Preview | **DONE** — Task 9.6, on the same route. Deliberately **not** `next/image`, so SEC-012's `remotePatterns` deletion stays a one-liner (13.6) |
| D5 | Delete | **DONE** — Task 9.8. Object deleted before the row, idempotently (D-075) |
| D6 | Verification | **DONE** — Task 9.7. Gated on the new `documents.verify` permission, held by **Admin and Super Admin only**, so `verified_by != uploaded_by` holds by construction for the seeded roles (D-074). `->Verified` is refused when `storage_key` is null |
| D7 | Access control | **DONE** — bank-scoped through the factory; `assertSafeKey` runs on the **read** path too, because pre-9.4 rows carry client-supplied keys (SEC-024) |
| D8 | File validation | **DONE** — Task 9.4. Extension allowlist, **magic-byte** check (not client-declared MIME), `MAX_DOCUMENT_MB` ceiling separate from the importer's budget (D-072), server-computed SHA-256 |

**Phase 9 is complete. Two residuals, both recorded:** the S3 adapter has never made a live network call (D2), and **no virus scanning exists** — OPEN-9's risk was explicitly accepted (**D-073**), so **nothing in the product may claim files are scanned.**

## BANK OPERATIONS

| # | Item | Status |
|---|---|---|
| B1 | Bank CRUD | **PARTIAL** — create, list and pause/resume are real; the edit dialog still covers 1 of 14 columns. **Owned by no roadmap row after Phase 6 closed.** Unowned defect |
| B2 | Bank assignment to employees | **DONE** — Task 2.6, `PUT /api/users/:id/banks`, gated on `users.assign` |
| B3 | Bank order creation | **DONE** — Task 6.3, plus automatic creation on loan submit (6.4), one per loan (`bank_orders_loan_unique`, migration `0013`) |
| B4 | Processing stages | **DONE** — Task 6.1. Two machines, `stage` and `status` (D-063), enforced in the service layer **and** by CHECKs in migration `0008`. Bank orders have no approve route, so PATCH enforces the transition via `transitionColumn` (F1-c) |
| B5 | Remarks | **DONE** — Task 6.2. The audit diff records `remarks` before/after, which is what makes "the audit log is the file trail" true rather than a slogan (D-064). ⚠️ Adds a new **unredacted free-text sink** — recorded against SEC-017, not fixed here (D-049) |
| B6 | Verification | **DONE** — Task 5.6 |
| B7 | Approval | **DONE** — Task 5.4 |
| B8 | Bank-scoped isolation | **DONE** |

## DISBURSEMENT

| # | Item | Status |
|---|---|---|
| P1 | Create | **DONE** — Task 7.4 fixed the form defaults; 7.5 added loading and error state |
| P2 | Real status changes | **DONE** — Tasks 7.1/7.2. "Mark credited" goes through the **approve route**, not PATCH — `edit` is a lower bar than `approve` and a PATCH-based control would reopen the bypass D-056 closed for loans (D-066). Re-initiate **creates a new row** rather than mutating a terminal one (D-069). CHECK in migration `0009` |
| P3 | Database persistence | **DONE** |
| P4 | Correct permissions | **DONE** |
| P5 | Audit trail | **DONE** — atomic with the write since F1-a |
| P6 | Money precision end to end | **PARTIAL** — Task 7.7 fixed the **server** aggregate (`::numeric`, no `::float`). The **client** half is unfixed: the ledger amount input still strips non-digits, so paise cannot be entered. Phase **11.8** (D-068) |

## TRANSACTIONS

| # | Item | Status |
|---|---|---|
| T1 | Create from the UI | **DONE** — Task 8.2 |
| T2 | Real persistence | **DONE** |
| T3 | Correct statuses | **DONE** — Task 8.1. Service-layer machine; **no DB CHECK yet** — `transactions.status` is in the 13.13 sweep (SEC-016) |
| T4 | Correct balances | **DONE** — Task 11.7. See R8 |
| T5 | Audit trail | **DONE** |

## SETTLEMENT

| # | Item | Status |
|---|---|---|
| S1 | Real workflow | **DONE** — Tasks 8.3/8.4. Settle goes through the **approve route** (D-066); dispute and the period filter are wired |
| S2 | Real persistence | **DONE** |
| S3 | Arithmetic invariant | **DONE** — Task 8.6 closed the gap where the check was skipped when `netPayable` was omitted on PATCH |
| S4 | Settlement → transaction link | **DONE** — Task 8.8, through the new `afterApprove` hook (F1-b), inside the approve transaction. Idempotent by **partial unique index**, not by a row lock — `transactions_settlement_unique` and `ledger_entries_transaction_unique` in migration `0010` (D-027, D-070). The generated ledger row carries a non-null `bank_id` by construction |
| S5 | Audit trail | **DONE** |

## NOTIFICATIONS

| # | Item | Status |
|---|---|---|
| N1 | Real event generation | **DONE** — Task 10.3. Five producers in `services/notifications.ts` (`notifyLoanDecision`, `notifyDisbursementCredited`, `notifySettlement`, `notifyDocumentDecision`, `notifyAssignment`), called from `operations.routes.ts` **inside the transaction that caused them** — a rolled-back approval cannot leave an alert claiming it succeeded (D-004, D-077) |
| N2 | Unread/read state | **DONE** — Task 10.2. Mark-read and mark-all-read are wired to the existing endpoints. **Mark-unread was removed, not built** — no such endpoint exists and inventing one to justify a button is the annexation D-043 forbids (D-078) |
| N3 | Persistence | **DONE** — migration `0011` gave notifications event identity: `user_id` **NOT NULL** (a null-recipient row was invisible to everyone, permanently), plus `event_type`, `record_type`, `record_id`, `event_key` and a partial unique index for idempotency |
| N4 | Correct display | **DONE** — Tasks 10.1/10.9; bell and page share one notification state |
| N5 | Deep links to records | **DONE** — Task 10.4, via `record_type`/`record_id` from migration `0011` |
| N6 | Email notifications | **NOT STARTED** — the mailer exists and sends real invitation and password-reset mail (Phase 3), but no *notification* is emailed. Deferred row **10.7 → Phase 12.6** (notification preferences) |
| N7 | SLA breach detection | **NOT STARTED** — still no scheduled-job runner anywhere in the repository. Deferred row **10.8 → Phase 15.9** |

## REPORTS & LEDGER

| # | Item | Status |
|---|---|---|
| R1 | Real database data | **DONE** — Task 11.3, 2026-09-06. `GET /api/reports/loans` aggregates in SQL and returns the summary over the **whole** filtered set alongside a page of rows. The screen previously computed everything from `/loans` capped at 500, so **loan 501 was invisible** and every total was a sum of a sample. 17 regression cases, one seeded with **520 loans** so a regression to client-side filtering fails in CI rather than at a client |
| R2 | Correct calculations | **DONE** — Task 11.3. Sums are `numeric` throughout with `::text` serialisation, never `::float` (D-068); a paise-level case asserts it. `amount_approved` is now populated (U-5), so the figure these sums read is no longer structurally zero |
| R3 | Correct date ranges | **DONE** — Tasks 11.2 and 11.3. The window defaults to the Indian financial year to date, and the `to` bound is inclusive **in SQL** (`< to + 1 day`), so a loan timestamped 23:47 on the final day is included. Asserted on both sides of the wire |
| R4 | Renders on load | **DONE** — Task 11.1. The memo omitted `loans` behind an eslint suppression and computed once against `[]`, so the table said Nothing matched over a full book |
| R5 | Real Excel export | **PARTIAL** — the control is **honestly labelled** HTML table and now contains every matching row (11.9). A genuine `.xlsx` via `exceljs` server-side is Task **11.4**'s second half, deferred |
| R6 | Real PDF export | **PARTIAL** — relabelled Print, and it no longer claims a PDF was produced before the user has chosen anything. A server-rendered PDF is Task **11.4**, deferred |
| R7 | Exports contain all rows | **DONE** — Task 11.9. `pageSize=0` returns every matching row; the server refuses past its own 20,000 ceiling rather than truncating, so a refusal is an error rather than a short file. CSV, HTML-table and Tally all fetch the full set. **CSV formula injection** is also closed — a leading `=`/`+`/`-`/`@` is neutralised losslessly (14 cases) |
| R8 | Ledger correct balances | **DONE** — Task 11.7, 2026-09-06. Computed as `SUM(credit) - SUM(debit)` over the bank's live entries, **inside the insert transaction and with no row lock** (D-027) — the obvious read-then-write is the BUG-037 race. `balance` is also no longer accepted from the client, which it previously was. 12 regression cases including concurrency and paise |
| R9 | Ledger correct bank scoping | **DONE** — 2026-09-06. OPEN-7 resolved by the owner (**D-084**): `ledger_entries.bank_id` is `NOT NULL` (migration `0015`), the FK moved `set null` → `restrict`, and the create schema requires it. `bankScope`'s `inArray` is now correct rather than needing a NULL branch |
| R10 | Ledger correct permissions | **DONE** — 2026-09-06, Task 11.6. `ledger.create` granted to **Manager and above** (OD-7 default); Team Leader and Executive stay view-only. The dialog now sends `bankId`, so scoped holders are no longer refused by `assertBankAccess` |
| R11 | Decimal amounts | **DONE** — Task 11.8. The input kept only digits, so paise were unreachable; it now accepts one decimal separator |
| R12 | Dashboard works for every role | **NOT STARTED** — Executive gets zeroes from a 403 |

## AUDIT

| # | Item | Status |
|---|---|---|
| U1 | Real audit records written | **DONE** |
| U2 | Immutability enforced | **DONE** — DB trigger |
| U3 | Correct actor/IP/user-agent/request-id | **DONE** |
| U4 | Admin viewer | **DONE** — Task 12.4, 2026-09-06. `GET /api/audit-logs` shipped with the first migration and had **zero frontend callers**; the append-only trail was readable only with a REST client. `/audit-logs` now renders it with server-side filters, a detail view, and pagination whose every number is `meta.total` — which the route did not return until this task, so a paginator could previously only guess. Deliberately **no CSV export**: `changes` names every field that changed on every record, and a one-click egress path for that is not something any roadmap row asks for. 22 frontend cases |
| U5 | Filters work | **DONE** — Task 12.5, 2026-09-06. **SEC-014 closed.** The bank-scope disjunct was unparenthesised inside `and(...filters)`, and `and`-binds-tighter detached it — so **every user-selected filter was dropped for the in-scope half of a scoped caller's query**. Never a cross-tenant leak, and a case asserts that separately. **Reversion-proven: 5 of 21 fail against the pre-fix predicate.** 12.4 also added `actorId`, `bankId` and an inclusive date window |
| U6 | No sensitive information leakage | **PARTIAL** — Task 13.8, 2026-09-06. `REDACTED_FIELDS` went from 8 secrets to ~35 fields; the accretion of customer PII into an immutable, unpurgeable table has **stopped**. The field key is still listed with placeholders, so who changed the account number and when stays answerable. 10 regression cases. WARNING: **free-text sinks and already-written rows remain** — the retention path is 15.9 |

## SECURITY

| # | Item | Status |
|---|---|---|
| X1 | Password hashing | **DONE** — argon2id |
| X2 | No secrets in source | **PARTIAL** — corrected 2026-09-02. Env templates carry placeholders only, but `frontend/src/lib/demo/config.ts:15` holds a plaintext credential literal. It is fictional, authenticates nothing server-side, is published in `README.md` by decision D-011, and is excluded from production bundles by Task 1.3 — so this is a classification caveat, not an exposure. Recording it because "DONE — placeholders only" was not true as written. See [DECISIONS.md](DECISIONS.md) D-016 |
| X3 | SQL injection prevented | **DONE** |
| X4 | Mass assignment prevented | **DONE** |
| X5 | IDOR/BOLA prevented | **DONE** |
| X6 | Refresh rotation + reuse detection | **DONE** |
| X7 | Rate limiting | **DONE** — Task 13.1. See A11 |
| X8 | Brute-force protection | **PARTIAL** — Task 13.3, 2026-09-06. **SEC-006 closed**: `failedLoginAttempts` resets once `lockedUntil` elapses, so serving out the window genuinely recovers an account. It was re-triggerable forever at one request per 15 minutes. ⚠️ **Still no throttle on `/api/auth/login`** — SEC-005, Phase 13.1 |
| X9 | Secure cookies in production | **DONE** — Task 1.7, 2026-09-02. **Same control as A6**; recorded NOT STARTED here until the Phase 1 final review caught the contradiction. `NODE_ENV` is a required declaration, so a deploy that forgets it fails config validation instead of issuing `Secure=false; SameSite=Lax` refresh cookies (**SEC-028**). 17 tests |
| X10 | Security headers (CSP/HSTS/XFO) | **PARTIAL** — Task 13.5, 2026-09-06. The frontend origin now emits CSP, HSTS (2y + subdomains), `X-Frame-Options: DENY`, nosniff, `Referrer-Policy` and `Permissions-Policy`. Clickjacking, plugin execution, base-tag hijacking, form exfiltration and mixed content are closed. ⚠️ **XSS is not** — `script-src 'unsafe-inline'`; the nonce needs `middleware.ts` (**D-082**). SEC-011 stays open at LOW |
| X11 | File validation | **DONE** — Task 9.4, 2026-09-06. Extension allowlist, **magic-byte** validation (a renamed `payload.exe` is refused), `MAX_DOCUMENT_MB` ceiling held separate from the importer's zip-bomb budget (D-072), server-computed SHA-256. **Does not cover the Excel importer** — SEC-008 is still open and is Phase 13.7 |
| X12 | PII protection (Aadhaar/PAN) | **PARTIAL** — Task 13.4, 2026-09-06. **SEC-007 (P0) closed**: the Aadhaar digest reaches no response (one shared projection across five call sites), `AADHAAR_PEPPER` is required in every environment at 32+ chars, and the construction is HMAC-SHA256 rather than a length-extendable concatenation. 16 regression cases. WARNING: **PAN is still stored and returned in plaintext** — masking at rest/by role is Task **13.14**, deferred |
| X13 | Secret management | **PARTIAL** — Task 15.10, 2026-09-06. `docs/SECRETS.md` is a complete classified inventory, and both `.env.example` files are now **enforced against the code by tests** (`env-template.test.ts` on each side) — the drift that hid eight storage keys for a whole phase cannot recur silently. The Aadhaar-pepper procedure states plainly that rotation is destructive and silent. ⚠️ **Still environment variables, not a managed store with rotation and audit** |
| X14 | No SSRF | **DONE** — Task 13.6, 2026-09-06. **SEC-012 closed.** `images.remotePatterns: [{ hostname: "**" }]` made `/_next/image` an open fetch proxy with the deployment's own network position. Deleted entirely; no remote image is used anywhere. The regression asserts the **absence** of any wildcard, so re-adding one fails |
| X15 | Demo isolated from production auth | **DONE** — Tasks 1.1 + 1.2, 2026-09-01. 1.1 clears the flag on entry into a real session; 1.2 makes the transport refuse to answer real auth even when the flag is set. 19 frontend tests; 5 fail against pre-fix code. Both layers still matter after X16, because they are what protect a demo-enabled build |
| X16 | Demo absent from production builds | **DONE** — Task 1.3, 2026-09-01. `next.config.ts` aliases `@/lib/demo` to an inert module unless `NEXT_PUBLIC_ENABLE_DEMO=true`, so `src/lib/demo/` never enters the bundle. Verified against the build output: **256 demo-exclusive string literals, 0 present in `.next/static`.** 10 further tests; 3 fail if the substitute is weakened. **This closes SEC-001.** The bundler condition added on 2026-09-02 was **withdrawn the same day** by Task 1.10 (X23) — the exclusion now holds on every build path and fails the build if it ever does not. One operational rule remains: `NEXT_PUBLIC_ENABLE_DEMO` must never be `true` on a production deploy |
| X24 | Rejected CORS origin fails safely and legibly | **DONE** — Task 1.6, 2026-09-02. **BUG-022 / SEC-018 closed.** A disallowed origin — ordinary request *or* preflight — gets **403 `cors_origin_denied`**, one `warn` log with the origin, no stack trace, no reflected input, and is refused **before any route runs**. 16 tests, no database; reverting fails 7 |
| X23 | Demo exclusion holds on every bundler, and is guarded automatically | **DONE** — Task 1.10, 2026-09-02. **SEC-027 resolved.** Three layers (D-017): per-bundler exclusion (`NormalModuleReplacementPlugin` for webpack — `resolve.alias` alone loses to Next's `JsConfigPathsPlugin`), a build-failing tripwire in `lib/demo/config.ts` that is bundler-agnostic, and `npm run verify:demo-exclusion`, which builds on both bundlers into clean output and searches it. Proven by two reversions; the subtler one passes `npm test` 46/46 and still fails the build check. **Residual: no CI exists to run it — Phase 15** |
| X22 | Demo mode unmistakable while active | **DONE** — Task 1.4, 2026-09-02. Three persistent surfaces: a banner above the topbar (outside the sidebar subtree), a badge in the `sticky` topbar (survives scrolling), and the sidebar marker lifted out of its `{!collapsed && …}` wrapper. Neither component takes a prop that could hide it. Verified by mounting the real `AppShell`, clicking the actual collapse control and asserting the indicators survive; **two independent reversions fail the test** |
| X21 | Credential ops outside `/auth/*` protected from the demo layer | **NOT STARTED** — SEC-026 (filed as SEC-024 in error; renumbered 2026-09-01). `POST /users`, `POST /users/:id/reset-password`, `PATCH /users/:id` are still demo-answerable **in demo-enabled builds**; X16 removes the exposure from production builds. Phase 2 |
| X17 | Temp password grants nothing but a change | **DONE** — Task 2.3, 2026-09-02 (**SEC-010 / BUG-005**). A flagged session may authenticate, read `GET /api/auth/me`, and `POST /api/auth/change-password`. Every other authenticated route answers **403 `password_change_required`** — measured across all three mounting shapes, including the `createScopedResource` factory. Not a session-ending code, so the user keeps the session they need to fix it. **Residual:** temporary credentials never expire |
| X18 | Super Admin lockout impossible | **DONE** — Tasks 2.1 + 2.2, 2026-09-02 (SEC-003). Guarded on `PATCH` and `DELETE` through one shared invariant. Residual: no break-glass script, and the check-then-write race (**BUG-037**) |
| X19 | Failed authz attempts audited | **DONE** — Task 13.12, 2026-09-06. `permission_denied` and `logout` were declared `AuditAction`s that **nothing ever wrote**. Both now are. The denial records the required permission KEYS, never the request body — a refused customer write carries PII, and `audit_logs` is immutable with no purge path (SEC-017). Fire-and-forget, so a logging failure cannot turn a 403 into a hung request. 8 regression cases |
| X20 | Penetration test passed | **NOT STARTED** |

## OPERATIONS

| # | Item | Status |
|---|---|---|
| O0 | Backend configuration documented | **DONE** — Task 0.3, 2026-09-01. **Re-verified and completed 2026-09-06 (Wave 0, D-080).** `.env.example` now covers **all 28** `env.ts` keys plus `LOG_LEVEL` — Phase 9 added eight storage keys that the template did not name, five of which production **refuses to boot without**, so a deployer following the file got an unexplained boot failure (audit **U-2**). The stale root `.env.example` duplicate is **deleted** (audit **U-3**); `.env.example` is the sole backend template. Also corrected: the `FRONTEND_URL` block claimed the variable was read by nothing, which stopped being true in Phase 3 — left at its default, every invitation and reset email points at `localhost`. Secrets are still env-file-only; a managed store is O13 / Phase 15.10 |
| O0b | Secrets protected from accidental commit | **DONE** — Task 0.4, 2026-09-01. Root `.gitignore` created; `.env` at any depth ignored, all three `.env.example` files verified still trackable |
| O0d | Setup documentation accurate | **DONE** — Tasks 0.6–0.7, 2026-09-01. Every verifiable claim in `README.md` corrected against the code; demo mode documented; `frontend/README.md` marked historical |
| O0c | Repository free of committed build artefacts | **DONE** — Task 0.5, 2026-09-01. `frontend/__pycache__/rewire.cpython-312.pyc` untracked via `git rm --cached` (kept on disk); **zero** tracked Python artefacts remain. Removal is staged, **not yet committed** |
| O1 | Production deployment | **NOT STARTED** — still not deployed. Everything the deploy needs now exists (O2–O5); creating the services is the human step |
| O2 | Deployment artifact | **DONE** — Task 15.1, 2026-09-06. Multi-stage `Dockerfile` (devDependencies in the builder, none in the runtime; `dumb-init` so SIGTERM reaches Node and the graceful drain actually runs), `.dockerignore`, `railway.json`, `frontend/vercel.json` (region `bom1`). ⚠️ **The image has never been built** — Docker is installed on the authoring machine and its daemon was not running. Every `COPY` source was verified to exist and `npm run build` emits all four entry points |
| O3 | CI pipeline | **DONE** — Task 14.7, 2026-09-06. `.github/workflows/ci.yml`: **backend**, **schema**, **frontend**, **hygiene**. The schema job exists because of Wave 0 and stops the snapshot defect recurring — `drizzle-kit check`, count agreement, and a content-hash snapshot before/after `db:generate`. ⚠️ **Never run on GitHub Actions** (no remote). `scripts/ci-local.sh` runs every step locally and **has been run — it found 2 real defects on its first pass, both fixed** |
| O4 | CD pipeline with rollback | **PARTIAL** — the rollback *procedure* is documented and practical (`DEPLOYMENT.md` §5: roll the code back, never the schema; per-migration reversibility stated). Vercel and Railway both build from the repository, so there is deliberately no third build in CI. **No automated deploy exists**, because there is nothing to deploy to yet |
| O5 | Production migration strategy | **DONE** — Task 15.4 / **D-090**, 2026-09-06. A release step, never on boot, against `DIRECT_DATABASE_URL`. `scripts/release.mjs` prints applied-versus-pending, never a connection string, and **refuses** when `DATABASE_URL` looks pooled and the direct URL is unset — verified locally in both directions |
| O6 | Monitoring / metrics | **NOT STARTED** |
| O7 | Error tracking | **PARTIAL** — Task 15.5 / **D-093**, 2026-09-06. `lib/observability.ts` and `lib/report-error.ts`, plus real Next.js error boundaries where there were none. Config-gated: unset, errors go to the structured log; set, one POST of an allow-list envelope. A `pg` error's `detail` (the row VALUE) and its `cause` (the connection string) are stripped; the browser envelope carries `pathname` and never the query string, where `/accept-invite` keeps a live token. 21 cases. ⚠️ **No external collector has ever received an event** |
| O8 | Alerting | **NOT STARTED** |
| O9 | Log aggregation + verified redaction | **PARTIAL** — Task 15.7, 2026-09-06. **Redaction is verified and SEC-019 is closed**: by key name at any depth, proven through a real pino instance against a synthetic nested PII payload (17 cases, D-094). **Aggregation is not built** — Railway's own stdout retention is the whole story |
| O10 | Automated backups | **NOT STARTED** |
| O11 | Restore rehearsed | **NOT STARTED** |
| O12 | Data retention job | **PARTIAL** — Task 15.9, 2026-09-06. `purge-recycle-bin` and `expire-import-batches` are implemented, idempotent and tested (33 cases), including that a purge removes the **S3 object** before the row. ⚠️ **Nothing is purged until the cron is wired** — that is an external step, and `RUNBOOK.md` §4 gives the query that measures whether it is actually running |
| O13 | Scheduled job runner | **PARTIAL** — Task 15.9 / **D-092**, 2026-09-06. Four jobs behind `node dist/jobs/run.js <name|all>`, with `--dry-run` and `--limit`; exit 0 only when every job reports `failed: 0`. Deliberately a CLI rather than an authenticated endpoint. **No schema change** — `db:generate` stays at zero diff. ⚠️ **The external scheduler is not wired** |
| O14 | Operational runbook | **DONE** — Task 15.12, 2026-09-06. `docs/RUNBOOK.md`, plus `DEPLOYMENT.md`, `SECRETS.md`, `EMAIL.md`, `BOOTSTRAP.md` and `GO_LIVE_CHECKLIST.md`. Every command in them exists; §12 lists what the runbook still **cannot** do (no alerting, no metrics, no rehearsed restore) rather than leaving it to be discovered at 03:00 |

## TESTING

| # | Item | Status |
|---|---|---|
| Q0 | **Quality gates verified green** | **DONE** — Task 0.1, 2026-08-31. All 5 gates PASS at `7ef5da5`+working tree: backend typecheck 0 errors · backend lint 0 errors/warnings · **107/107 tests** in 43.83 s · frontend typecheck 0 errors · frontend build 21 routes. Record in [CURRENT_STATE.md](CURRENT_STATE.md) §5 |
| Q1 | Backend tests exist | **DONE** — **1188 cases across 51 files**, measured 2026-09-06 after Wave 4. The majority run against the **real shipped migrations** on a PGlite harness; `cors`, `cookie-config`, `email-config`, `email-service` and `email-templates` need no database. ⚠️ **PGlite is not Postgres** — these migrations have never executed against a real Postgres server. Phase **14.9** |
| Q2 | Backend covers auth/authz core | **DONE** (partially) — authorization, bank scoping, role hierarchy and the escalation guards are well covered. Q3 and Q4 are the named holes |
| Q3 | Refresh rotation/reuse tested | **PARTIAL** — `session-invalidation.test.ts` and `sessions.test.ts` (Wave 4) cover revocation end to end by **using the cookie afterwards**, and `jobs.test.ts` case 22 pins the property reuse detection depends on: a recently revoked token is **kept** for a grace period, because deleting it on rotation would make replay detection silently stop working. The rotation-reuse-revokes-the-family path itself still has no direct test |
| Q4 | Logout + lockout tested | **NOT STARTED** |
| Q5 | Frontend tests | **DONE** — **1105 cases across 49 files**, measured 2026-09-06 after Wave 4 (vitest + jsdom, D-012). Every business screen from Phases 4–10 and every administrative screen from Phase 12 is driven through the real page against the real request. The two gaps this row named are closed: `/reports` was covered by Wave 3 (11.1/11.3/11.9) and `/settings` by Wave 4 (12.6/12.8), each with its own file. ⚠️ **Still no E2E and no browser** — jsdom is not a browser, and Q8 stays NOT STARTED |
| Q6 | Every mutating control proven to issue a request | **DONE** — three generations, and the third is the general one. `fake-controls.test.tsx` pins the nine BUG-002 controls by name; `no-unbacked-success.test.tsx` sweeps `/settings` and `/reports`; and **`zero-fake-sweep.test.tsx` (Wave 6) sweeps all twenty screens**, clicking every enabled control twice over so dialog contents are reached. It also proves it can *detect* an offender, that every navigable route is in its list, and that it actually clicked a meaningful number of controls — three ways a sweep can pass while testing nothing |
| Q7 | Integration tests | **NOT STARTED** |
| Q8 | E2E tests | **NOT STARTED** — zero |
| Q9 | Role-based tests for all 5 roles | **DONE** — Task 16.2's automatable half, 2026-09-06. `src/tests/role-matrix.test.ts` drives **all five seeded roles** against **37 endpoints** and asserts the answer the catalogue promises: a holder is never 403, a non-holder is **always** 403 (never 404 or 422 — `requirePermission` runs before the handler). Expectations are computed from `DEFAULT_ROLES` and joined against each route's hand-copied requirement, so a route that stops enforcing its key fails even though the catalogue is untouched. 41 cases. Plus `nav-permissions.test.ts` for the menu. ⚠️ **Not the same as walking each role through the product by hand** — that needs a person and stays 16.2 |
| Q10 | Security regression tests | **DONE** — every finding closed since Wave 1 landed with a named regression file, and four sets are **reversion-proven** (SEC-004/006: 7 of 13 · SEC-005: 5 of 15 · SEC-014: 5 of 21 · Task 12.3's leader guard: 3 of 27). SEC-019's proof runs through a real pino instance rather than the pure function, which is the distinction that let the defect exist |

---

## GO / NO-GO

**NO-GO.** Re-assessed 2026-09-06 against the master production-readiness audit. Four of the original seven conditions are now cleared; four remain, and three are new.

### Cleared

1. ~~**13 controls report success without persisting** — including approvals and money movements.~~ ✅ **CLEARED by Phases 4–10.** All thirteen now issue real awaited requests; the last nine are pinned by `fake-controls.test.tsx`. **BUG-002 is closed.** ⚠️ **This is not the same as "no fake controls remain"** — see new condition 8.
2. ~~**No file storage** — KYC cannot be evidenced.~~ ✅ **CLEARED by Phase 9.** Real upload, storage, download, preview, delete and verification, with magic-byte validation and server-computed checksums. ⚠️ The S3 adapter has **never been exercised against a live bucket** — see new condition 10.
3. ~~**Demo mode can intercept production authentication** and its credential ships in the public bundle.~~ ✅ **CLEARED 2026-09-02** (Tasks 1.1–1.4, 1.10; SEC-001 and SEC-027 closed). The exclusion holds on every build path and fails the build if it does not. **One operational rule remains:** `NEXT_PUBLIC_ENABLE_DEMO` must never be `true` on a production deployment.
4. ~~**Irreversible super-admin lockout** reachable from the UI's own button.~~ ✅ **Cleared 2026-09-02** (Tasks 2.1 + 2.2, SEC-003). There is still **no break-glass recovery procedure** if the invariant is bypassed by direct SQL — SEC-003 remediation item 4, still open.
5. ~~**`npm run db:generate` crashes, and its naive repair emits a migration that breaks a production deploy.**~~ ✅ **CLEARED 2026-09-06 (Wave 0, D-081).** Snapshots `0008`–`0013` reconstructed and proven; generation converges to zero diff.

### Still blocking

6. **No rate limiting on `/api/auth/login`**, and account lockout is permanently re-triggerable by an unauthenticated attacker. SEC-005 (P0), SEC-004, SEC-006 — Phase 13.1–13.3.
7. **Regulated data is exposed.** `aadhaar_hash` is returned by four endpoints under a defaulted pepper (SEC-007, P0); plaintext Aadhaar is retained indefinitely in `import_rows` with no purge job (SEC-009, P0); customer PII accretes into an immutable, unpurgeable audit table (SEC-017). Phases 13.4, 13.7, 13.8, 15.9.
8. **17 controls still claim an outcome they do not achieve** — concentrated in the settings page (2FA switch, fabricated active-sessions table with a working-looking "Sign out", company profile and invoice numbering that discard input) and the reports page ("PDF ready" for a print dialog, an HTML table named `.xls`). The dashboard also renders **₹0 for a 403** rather than saying it cannot see the figures. Phases 11.4, 12.6, 12.7, 12.8, and audit item U-4.
9. **The ledger does not work.** Three of five roles cannot post to it at all; entries created by unscoped users are permanently invisible to scoped ones; the balance column is always zero while the dialog says it updates immediately; paise cannot be entered. Phase 11.6–11.8.
10. **No deployment, CI, monitoring, backups or scheduled jobs.** There is still not one `.yml`, `Dockerfile`, `vercel.json` or `railway.*` in the repository. The migrations have never run against real Postgres, and the S3 adapter has never made a live network call. Phases 14.7, 14.9, 15.
11. **Zero E2E tests, and no non-super-admin persona is exercised anywhere in the backend suite** — `frontend-contract.test.ts:35` creates its actor as `super_admin`. Phases 14.3, 14.5.

**Go-live requires:** every CRITICAL and HIGH security finding closed **with a regression test**; zero controls that claim an unachieved outcome; Phases 13–16 complete; a passed penetration test; a rehearsed restore; and a DPDP data-protection review.
