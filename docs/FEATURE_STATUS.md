# FEATURE STATUS

**The authoritative per-feature status table.** Update it whenever a feature's status changes.

> ## ⚠️ THIS TABLE IS STALE — last maintained 2026-09-03, before Waves 1–6
>
> It was written when the question was "which features are fake?", and it has not
> been updated through six waves of implementation. **Nearly every 🎭 and ❌ in it
> is now wrong.** Do not read a row here as the current state.
>
> **Current state lives in:**
> [CURRENT_STATE.md](CURRENT_STATE.md) · [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
> (160 items, recomputed mechanically, **81%**) ·
> [SECURITY_AUDIT.md](SECURITY_AUDIT.md) (**0 CRITICAL · 1 HIGH · 2 MEDIUM · 6 LOW**) ·
> [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md) · [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md).
>
> It is kept rather than deleted because it is the record of what the project
> looked like at the start, and several waves cite it. **Rewriting it accurately
> would mean re-verifying forty rows one at a time against code** — which is the
> discipline that made every other closure in this project trustworthy, and it is
> not a thing to do carelessly at the end of a session. It is flagged instead.

*(as of 2026-09-03)* Tasks 2.5 and 2.6 are implemented and **uncommitted** (2.1–2.4 and the BUG-036 fix are committed, latest `fef34e3`). **Phase 1 is complete and committed** — Tasks 1.1–1.4 and 1.6–1.10, in six checkpoints ending with *"Fix customer ID validation and complete Phase 1"*; 1.5 superseded (D-016).

---

## LEGEND

| Column | Values |
|---|---|
| **Frontend** | ✅ complete · ⚠️ partial · 🎭 fake (UI shows success, no request) · ❌ absent |
| **Backend** | ✅ complete · ⚠️ partial · ❌ absent |
| **Database** | ✅ table + writes · ⚠️ table, no writes · ❌ no table |
| **Integration** | ✅ wired end to end · ⚠️ partially wired · ❌ not wired |
| **Status** | **A** fully implemented · **B** partial · **C** frontend only · **D** backend only · **E** mock/demo · **F** broken · **G** missing |

A feature is **A** only when the full chain is traced: UI → handler → HTTP → route → authz → service → DB → response → UI state.

---

## 1. FOUNDATION

| Feature | FE | BE | DB | Int | Status | Problems | Next action |
|---|---|---|---|---|---|---|---|
| Login | ✅ | ✅ | ✅ | ✅ | **A** | Enumeration oracle via distinct 429/403 (SEC-004); no rate limiting (SEC-005) | Phase 13 |
| Logout | ✅ | ✅ | ✅ | ✅ | **A** | No audit row despite `logout` being a declared action | Phase 13.12 |
| Token refresh + rotation + reuse detection | ✅ | ✅ | ✅ | ✅ | **A** | **Zero test coverage** on the most security-sensitive block in the codebase | Phase 14.1 |
| Change password | ✅ | ✅ | ✅ | ✅ | **A** | No password-history check | Phase 13 |
| Forced password change | ✅ | ✅ | ✅ | ✅ | **A** | **Task 2.3, 2026-09-02 — SEC-010 / BUG-005 CLOSED.** Enforced server-side: `requireAuth` answers a flagged session with **403 `password_change_required`** on every authenticated route, and exactly two opt out (`GET /api/auth/me`, `POST /api/auth/change-password`). `/login`, `/refresh` and `/logout` needed no exemption — they carry no `requireAuth`. Was React-only, so a temporary password granted full API access via curl. *(This row cited **SEC-009** until 2026-09-02; the correct id is **SEC-010**.)* **Residual:** temporary credentials never expire | Phase 13 (expiry) |
| Self-service password reset | 🎭 | ❌ | ❌ | ❌ | **G** | No route, no token table. "Forgot password?" is a toast | Phase 3.6 |
| Account lockout | — | ⚠️ | ✅ | ✅ | **B** | Account-keyed only, never IP. Counter never decays → permanently re-lockable (SEC-006) | Phase 13.3 |
| Rate limiting | — | ❌ | — | — | **G** | None anywhere in the application | Phase 13.1 |
| Session invalidation (deactivated account) | ✅ | ✅ | ✅ | ✅ | **A** | **Task 1.8, 2026-09-02.** A deactivated account or disabled role returns 403 with a dedicated code (`account_inactive` / `role_disabled`) and the client ends the session on the next request. Ordinary `forbidden` 403s — permission, bank scope, hierarchy, demo fixtures — leave the user signed in. Was a ≤ 15-minute window of a healthy-looking but non-functional UI (BUG-034). 11 backend + 7 frontend tests | — |
| Environment/config validation | — | ✅ | — | ✅ | **A** | **Task 1.7, 2026-09-02.** `NODE_ENV` is **required** — the backend refuses to start without it, so a production deploy can no longer boot as `development` and ship `Secure=false; SameSite=Lax` refresh cookies (**SEC-028**). Production also refuses the shipped default `AADHAAR_PEPPER` and identical JWT secrets. 17 tests | — |
| CORS origin allow-list | — | ✅ | — | ✅ | **A** | **Task 1.6, 2026-09-02.** A disallowed origin — ordinary request *or* preflight — gets **403 `cors_origin_denied`**, logged once at `warn`, refused before any route runs. Was a 500 with an error-level stack trace (BUG-022 / SEC-018). 16 tests | — |
| Authorization / RBAC | ⚠️ | ✅ | ✅ | ✅ | **A** (backend) | Frontend nav has **no permission gating at all** | Phase 12.10 |
| Bank-level data scoping | — | ✅ | ✅ | ✅ | **A** | Fails closed. No IDOR found | — |
| Audit logging (write) | — | ✅ | ✅ | ✅ | **A** | `logout` and `permission_denied` never written; PII not redacted in `changes` | Phase 13.8, 13.12 |
| Demo mode | ✅ | — | — | — | **E** | **Isolated from real auth AND absent from production builds (Tasks 1.1 + 1.2 + 1.3).** Flag cleared on entry into a real session; transport refuses any `/auth/*` except `/auth/refresh` (kept for demo reload restore); `@/lib/demo` is aliased to an inert module unless `NEXT_PUBLIC_ENABLE_DEMO=true`, so no credential and no fixture reaches a production bundle — verified by searching the build output. **Enforced on every bundler (Task 1.10)** — webpack needs `NormalModuleReplacementPlugin`, not just an alias; a tripwire in `lib/demo/config.ts` fails the build if the demo is ever reachable; `npm run verify:demo-exclusion` proves it on both paths. SEC-027 / BUG-033 resolved. **Unmistakable while active (Task 1.4)** — a banner above the topbar, a badge in the sticky topbar, and a sidebar marker that shrinks to its icon rather than disappearing when the sidebar collapses; verified by mounting the real `AppShell` and clicking the collapse control. **37 regression tests. SEC-001 CLOSED.** Remaining: nothing in Phase 1 — 1.5 may be superseded by 1.3 | — |

---

## 2. EMPLOYEE MANAGEMENT

| Feature | FE | BE | DB | Int | Status | Problems | Next action |
|---|---|---|---|---|---|---|---|
| List employees | ✅ | ✅ | ✅ | ✅ | **A** | Client-side search/filter/paginate over ≤200 rows. **Task 2.10:** `loading` and `error` are surfaced — a skeleton while loading, an error banner with a working **Try again**, and the table suppressed on failure. Server `error.details` map onto the control they name (**D-031**). **Task 3.7, 2026-09-04:** a **Setup** column and filter showing Accepted / Invited / Not invited, with the dates on the detail view; the wording never claims delivery (**D-040**). **Known unrelated defect:** the **Role** column renders `—` for every row — declared `key: "role"` with no `render`, while the field is `roleName`, so `DataTable` falls back to `row["role"]`. Found during 3.7, recorded not fixed | — |
| Create employee | ✅ | ✅ | ✅ | ✅ | **A** | Committed in `583897f`. Role/bank/team assigned in one transaction; temp password handed over once | — |
| Temporary password generation | — | ✅ | ✅ | ✅ | **A** | Committed in `583897f`. Policy-guaranteed, ambiguity-free alphabet | — |
| One-time credential hand-over | ✅ | ✅ | — | ✅ | **A** | Committed in `583897f`. Rendered unmasked; clipboard never cleared (SEC-023) | Phase 13 |
| Admin password reset | ✅ | ✅ | ✅ | ✅ | **A** | Committed in `583897f`. Hierarchy-guarded, revokes all sessions, audited | — |
| Role assignment | ⚠️ | ✅ | ✅ | ⚠️ | **B** | At create only. The Super-Admin-by-default defect is **fixed** in `583897f` — role is now an explicit required choice | Phase 2.4 |
| Team assignment | ✅ | ✅ | ✅ | ✅ | **A** | **Task 2.7, 2026-09-03 — wired end to end.** A "Team" dialog on the employee detail view calls `PUT /api/teams/:id/members`, gated on `can("teams.assign")` — a third distinct permission on that screen. The route replaces a team's **entire** roster, so the client re-reads `GET /teams` at save time and resubmits every other member unchanged; a move is two requests, removal first, with a partial failure reported honestly (**D-028**). **BUG-038 / [SEC-029](SECURITY_AUDIT.md#sec-029) closed the same day:** the route authorizes every affected member against the role hierarchy over the union of the previous and submitted rosters, so removals are guarded as well as additions. `PATCH` still refuses `teamId` with a 422 (Task 2.5, **BUG-020**). **Known limitation:** one team per employee, following the create form and `teamOf()`; the schema permits more and no UI exposes that | — |
| Bank access assignment | ✅ | ✅ | ✅ | ✅ | **A** | **Task 2.6, 2026-09-03 — wired end to end.** A "Bank access" dialog on the employee detail view calls `PUT /api/users/:id/banks`, gated on `can("users.assign")` — the permission the route requires, **not** `users.edit`. Whole-list replace; the UI adopts the server's returned list rather than the one it sent, so a refused or altered save cannot be hidden. `PATCH` still refuses `bankIds` (Task 2.5). **Known limitation:** every seeded holder of `users.assign` is unscoped, so the picker shows all banks; a bespoke *scoped* assigner editing an employee who holds a bank they cannot see would get a **403**, not silent data loss | — |
| Activate / deactivate | ✅ | ✅ | ✅ | ✅ | **A** | Real `PATCH` committed in `583897f`. **Guarded as of Tasks 2.1 + 2.2, 2026-09-02 — SEC-003 / BUG-003 CLOSED.** Self-deactivation and self-demotion off the system role are **400**; any change emptying the Super Admin population is **409**, through one `assertSuperAdminRemains` helper shared with `DELETE`. Harmless self-edits and no-op echoes stay 200 — the guard is field-scoped, not a copy of `DELETE`'s unconditional refusal. 26 tests. **Open on the same handler:** BUG-036 — a PATCH that never mentions `status` still writes `Active`, silently reactivating a revoked account | Phase 2.5 (BUG-036) |
| Edit employee | ✅ | ✅ | ✅ | ✅ | **A** | **Task 2.4, 2026-09-03.** An Edit dialog on the employee detail view, gated on `can("users.edit")`, sends **only the fields the administrator changed** — an untouched form issues no request at all. Nine editable fields: name, email, phone, employeeCode, branch, roleId, status, target, achieved. `bankIds`/`teamId`/`joinedOn` are **deliberately absent** — `PATCH` discards them (**BUG-020**, open), and a control offering them would report a success that never happened. 52 frontend tests | Phase 2.5 (BUG-020), 2.6, 2.7 |
| Delete employee | ✅ | ✅ | ✅ | ✅ | **A** | **Tasks 2.8 + 2.9, 2026-09-03 — wired end to end, and restorable.** A Delete button on the employee detail view calls `DELETE /api/users/:id`, gated on `can("users.delete")` — a fourth distinct permission on that screen — behind an explicit confirmation that issues nothing until accepted. 204 is reconciled by re-reading the list, since there is no body to adopt. Its two guards were **tested for the first time** in Tasks 2.1 + 2.2 and share the invariant with PATCH; 400/409/403 are surfaced verbatim. **Task 2.9 made them restorable:** `user` joined `BIN_REGISTRY`, the delete runs through `softDelete`, and the round trip active → DELETE → bin → restored works end to end. A restored employee returns **deactivated**, so the record coming back is not the same as access coming back. The retained snapshot is stripped of the password hash, and the bin's restore/purge routes apply the role hierarchy to user entries. **D-029**, **D-030** | — |
| Invitation / resend invite | ❌ | ❌ | ❌ | ❌ | **G** | Does not exist in any layer | Phase 3.5 |

---

## 3. CUSTOMERS

| Feature | FE | BE | DB | Int | Status | Problems | Next action |
|---|---|---|---|---|---|---|---|
| List customers | ✅ | ✅ | ✅ | ✅ | **A** | ✅ **4.5/4.8 DONE 2026-09-05.** Server-side page/search/status/bank/KYC; `meta.total` drives a pager that reaches every page. Loading and error states are honest. PAN search preserved. | — |
| Create customer | ✅ | ✅ | ✅ | ✅ | **A** | ✅ **4.6/4.9 DONE 2026-09-05.** Advisory pre-flight wired; codes come from a Postgres sequence shared with the importer. **BUG-011 closed.** | — |
| View customer detail | ✅ | ✅ | ✅ | ✅ | **A** | **Task 1.9, 2026-09-02 — BUG-017 closed.** Global search now opens the profile: the palette links by `id`, and a malformed `:id` returns **422** naming `id` instead of a 500. Remaining: any 5xx still renders as a Next.js 404 (`page.tsx:88`) | Phase 4.8 |
| Edit customer | ✅ | ✅ | ✅ | ✅ | **A** | ✅ **4.1 DONE 2026-09-05.** Controlled, changed-fields-only `PATCH`. Aadhaar excluded by construction (**D-052**). | — |
| Delete customer (list) | ✅ | ✅ | ✅ | ✅ | **A** | ✅ **4.8 DONE 2026-09-05.** Gated on `can("customers.delete")`, matching the route. | — |
| Delete customer (detail) | ✅ | ✅ | ✅ | ✅ | **A** | ✅ **4.2 DONE 2026-09-05.** Real `DELETE`, navigates on 204, permission-gated. Both screens now tell the same truth. | — |
| Excel import | ✅ | ✅ | ✅ | ✅ | **A** | **The reference implementation.** Zip-bomb risk (SEC-008); rejected files → 500. *4.9 moved its code generation onto the shared sequence.* | Phase 13.7 |
| Customer timeline | ✅ | ✅ | ✅ | ✅ | **A** | ✅ **4.3 DONE 2026-09-05.** Real `GET /api/audit-logs`. Field **names** only — never a value (**SEC-017**). Roles without `audit_logs.view` get an honest permission state; the grant was not widened (**D-049**). | — |
| ~~"Re-upload written form"~~ | — | — | — | — | **REMOVED** | ✅ **4.4 DONE 2026-09-05.** Control, handler and hidden input deleted — no file storage exists, so there was nothing honest to wire. | — |

---

## 4. LOANS / FILES

| Feature | FE | BE | DB | Int | Status | Problems | Next action |
|---|---|---|---|---|---|---|---|
| List loans | ✅ | ✅ | ✅ | ✅ | **A** | Stats computed over the 25-row default page, shown as book-wide totals | Phase 5.8 |
| Create loan | ✅ | ✅ | ✅ | ✅ | **A** | **Dialog never closes** (wrong state variable) → duplicate loans | Phase 5.1 |
| Edit loan | ❌ | ✅ | ✅ | ❌ | **D** | Zero callers | Phase 5.5 |
| **Approve / reject loan** | 🎭 | ✅ | ✅ | ❌ | **C** | **The most business-critical unreachable operation in the system** | **Phase 5.4** |
| Loan state machine | ❌ | ❌ | ❌ | ❌ | **G** | No transition validation anywhere. Approve accepts **any string**; zero CHECK constraints | Phase 5.2 |
| Verification workflow | ✅ | ✅ | ✅ | ✅ | **A** | ✅ **5.6 DONE 2026-09-05.** A verification panel in the loan detail dialog reads `GET /api/verifications?loanId=` and creates through `POST /api/loans/:id/verification` — the loan sub-route, **never** the factory `POST /api/verifications`, which has no `beforeWrite` and so skips `assertSameBank` and both business rules. Four fields are sent (`required`, `serviceProviderId`, `providerReference`, `notes`); `handledByBank`, `status`, `result` and the timestamps are all **derived by the route** and get no control (**D-059**'s lesson). Failures **branch on the HTTP status, never on the message** — 409 re-reads and shows the stored row, 400 is the missing-provider rule as a form-level line (it carries no `details`), 422 lands per **D-031**, and a 5xx/offline is reported as itself. The panel is a component mounted per dialog open, so a load in flight, a genuinely empty result and a failed request are three distinct states. 41 frontend tests. **Residual:** amending a verification is not offered — `PATCH /api/verifications/:id` needs `verification.edit`, which Team Leader and Executive do not hold, and no row owns it | Notifications → Phase 10.3 · broader `/verifications` backend tests → Phase 14.1 |
| Service providers | ⚠️ | ✅ | ✅ | ✅ | **B** | ✅ **5.6 DONE 2026-09-05 (read path).** `GET /api/service-providers` is called by the verification panel, filtered client-side to `status === "Active"` because the route offers no status filter, and gated on `service_providers.view`. **The D-049 case:** Manager and Team Leader hold `verification.create` but **not** `service_providers.view`, while the server *requires* a provider when `required` is true. The grant was **not widened**, no endpoint was invented, and **no empty dropdown is rendered** — an empty `<Select>` would claim the directory is empty, which that account cannot know. Those roles are offered the bank-handled path only, with copy naming the permission. On a stored record the provider resolves to a name when readable and to its `providerReference` otherwise, never a raw uuid. **Residual: `POST` and `PATCH` still have zero callers** — a provider admin screen is owned by no roadmap row | Provider admin CRUD — unowned |
| Funding sources | ❌ | ✅ | ✅ | ❌ | **D** | 5 endpoints, zero callers, no screen | Phase 5 |

---

## 5. BANK OPERATIONS

| Feature | FE | BE | DB | Int | Status | Problems | Next action |
|---|---|---|---|---|---|---|---|
| List banks | ✅ | ✅ | ✅ | ✅ | **A** | `NaN%` stat on empty data | Phase 11 |
| Create bank | ✅ | ✅ | ✅ | ✅ | **A** | `accentColor`/`settlementCycle` hardcoded on every new bank | — |
| Edit bank | ⚠️ | ✅ | ✅ | ⚠️ | **B** | UI sends only `{status}` — **13 of 14 fields unreachable** | Phase 6 |
| Delete bank | ❌ | ✅ | ✅ | ❌ | **D** | Soft delete **orphans its customers** (RESTRICT bypassed by UPDATE) | Phase 4/6 |
| List bank orders | ✅ | ✅ | ✅ | ✅ | **A** | SLA sorted as a string | Phase 6.6 |
| Create bank order | ❌ | ✅ | ✅ | ❌ | **D** | **No bank order can be created from the UI at all** | Phase 6.3 |
| Bank order stage change | 🎭 | ✅ | ✅ | ❌ | **C** | Kanban card visibly does not move while the toast claims it did | Phase 6.1 |
| Bank order remarks | 🎭 | ✅ | ✅ | ❌ | **C** | Toast says "saved to the file trail"; nothing is written | Phase 6.2 |

---

## 6. MONEY

| Feature | FE | BE | DB | Int | Status | Problems | Next action |
|---|---|---|---|---|---|---|---|
| List disbursements | ✅ | ✅ | ✅ | ✅ | **A** | `₹NaN` on empty data | Phase 7.5 |
| Create disbursement | ✅ | ✅ | ✅ | ✅ | **A** | Form defaults seeded from a `useState` initialiser reading async data → permanently blank | Phase 7.4 |
| Disbursement "mark credited" | 🎭 | ✅ | ✅ | ❌ | **C** | Toast asserts *"UTR confirmed in bank statement"* — a claim about a real financial event | **Phase 7.1** |
| Disbursement "re-initiate" | 🎭 | ✅ | ✅ | ❌ | **C** | Toast claims *"Transfer resubmitted with corrected beneficiary."* | Phase 7.2 |
| List transactions | ✅ | ✅ | ✅ | ✅ | **A** | Stats over 25 rows | Phase 8 |
| Create transaction | ❌ | ✅ | ✅ | ❌ | **D** | Nothing in the UI **or** the backend auto-creates one | Phase 8.2 |
| Transaction "mark successful" | 🎭 | ✅ | ✅ | ❌ | **C** | A ledger row declared settled purely in component state | Phase 8.1 |
| List settlements | ✅ | ✅ | ✅ | ✅ | **A** | Period filter hardcoded to two 2024 strings | Phase 8.5 |
| Settlement "mark paid" | 🎭 | ✅ | ✅ | ❌ | **C** | Reverts on refresh while the dialog claims Paid | Phase 8.3 |
| Settlement "raise dispute" | 🎭 | ✅ | ✅ | ❌ | **C** | Claims *"Query sent to SPOC"* — **no messaging path exists** | Phase 8.4 |
| Ledger list | ✅ | ✅ | ✅ | ✅ | **A** | 25-row page | Phase 11 |
| Ledger create | ⚠️ | ⚠️ | ✅ | ⚠️ | **F** | Only Super Admin/Admin can post — the other three roles **lack `ledger.create` entirely**. Separately, the UI never sends `bankId`, so rows land `bank_id = NULL` and are **invisible to all scoped users** | **Phase 11.6** |
| Ledger balance | ❌ | ❌ | ⚠️ | ❌ | **F** | Always `0`. The promised in-transaction recomputation **does not exist** | Phase 11.7 |
| Money precision | ⚠️ | ⚠️ | ✅ | ⚠️ | **B** | Correct `numeric(16,2)` columns; JS double in the frontend; `::float` casts in the dashboard | Phase 7.7 |

---

## 7. DOCUMENTS

| Feature | FE | BE | DB | Int | Status | Problems | Next action |
|---|---|---|---|---|---|---|---|
| List documents | ✅ | ✅ | ✅ | ✅ | **A** | `NaN%` stat; `uploadedBy` column always `—` | Phase 9.7 |
| **Upload document** | 🎭 | ❌ | ⚠️ | ❌ | **F** | **File bytes discarded in the browser.** No upload endpoint. `storage_key` never written. Silently attaches to `customers[0]` if none selected | **Phase 9.4** |
| Object storage | — | ❌ | — | — | **G** | **Does not exist.** `multer` is used only for the Excel import | Phase 9.1–9.3 |
| Download / preview | 🎭 | ❌ | — | ❌ | **G** | `toast.success("Download started")`. No download route anywhere | Phase 9.5 |
| Verify / reject document | 🎭 | ✅ | ✅ | ❌ | **C** | Toast only | Phase 9.7 |
| Delete document | 🎭 | ✅ | ✅ | ❌ | **C** | Toast only; `DELETE` route unused | Phase 9.7 |
| File validation | — | ❌ | — | — | **G** | None for documents | Phase 9.4 |

---

## 8. NOTIFICATIONS, REPORTS, ADMIN

| Feature | FE | BE | DB | Int | Status | Problems | Next action |
|---|---|---|---|---|---|---|---|
| Notification producers | — | ❌ | ⚠️ | ❌ | **G** | **Zero `insert(notifications)` anywhere.** Table can never be populated | **Phase 10.3** |
| Notifications page | 🎭 | ✅ | ⚠️ | ❌ | **F** | `useState(rows)` never syncs → **permanently empty even when the API returns rows.** The bell badge works; the page it links to is blank | Phase 10.1 |
| Mark as read | 🎭 | ✅ | ✅ | ❌ | **C** | Both endpoints exist, zero callers. Resets on reload | Phase 10.2 |
| Dashboard KPIs + charts | ✅ | ✅ | ✅ | ✅ | **A** | **403 for Executive** (lacks `reports.view`) renders as zeroes, indistinguishable from an empty DB | Phase 11 |
| Dashboard trend chart | ❌ | ❌ | — | ❌ | **G** | Hardcoded `[]`; no trend endpoint | Phase 11.5 |
| Reports | 🎭 | ❌ | ✅ | ⚠️ | **F** | **Empty on load** (stale memo); 2024 default range; `to` day always excluded; no reporting endpoint | **Phase 11.1–11.3** |
| Excel export | 🎭 | ❌ | — | ❌ | **F** | **An HTML table saved as `.xls`** | Phase 11.4 |
| PDF export | 🎭 | ❌ | — | ❌ | **F** | **`window.print()`** with a toast claiming "PDF ready" | Phase 11.4 |
| CSV / Tally export | ⚠️ | — | — | ⚠️ | **B** | Real files, but **only the 25-row server page**, reported as the total | Phase 11.9 |
| Recycle bin | ✅ | ✅ | ✅ | ✅ | **A** | **The best-implemented page.** Retention job does not exist → records sit forever | Phase 15.9 |
| Audit log viewer | ❌ | ✅ | ✅ | ❌ | **D** | **No page exists.** Filters silently dropped by a SQL precedence bug | Phase 12.4, 12.5 |
| Roles admin | ❌ | ✅ | ✅ | ❌ | **D** | Full CRUD + permission assignment, **zero callers, no page** | Phase 12.1 |
| Teams admin | ❌ | ⚠️ | ✅ | ❌ | **D** | Zero callers, no page. **No `PATCH /teams/:id` exists at all** — `teams.edit` is a dead permission | Phase 12.2, 12.3 |
| Permissions matrix | ❌ | ✅ | ✅ | ❌ | **D** | Catalogue endpoint has zero callers. At HEAD the UI showed a **fake** panel with labels that do not match the real catalogue | Phase 12.1 |
| Settings — password | ✅ | ✅ | ✅ | ✅ | **A** | **The only settings control that persists** | — |
| Settings — everything else | 🎭 | ❌ | ⚠️ | ❌ | **C** | ~29 of 30 controls persist nothing. **`app_settings` table is completely dead** | Phase 12.6 |
| Settings — 2FA | 🎭 | ❌ | ❌ | ❌ | **E** | Reports *"2FA enabled"* for a feature that exists in **no layer** | **Phase 12.7** |
| Settings — active sessions | 🎭 | ❌ | ✅ | ❌ | **E** | Three hardcoded 2024 literals; "Sign out" is a toast | Phase 12.8 |
| My work | ⚠️ | ✅ | ✅ | ⚠️ | **B** | **Not filtered by `assignedUserId`** — it is not "my" work | Phase 5 |

---

## 9. NON-FUNCTIONAL

| Area | Status | Problems | Next action |
|---|---|---|---|
| **Email** | **B** | **Two real product emails now send.** Employee creation issues an invitation and emails the setup link (3.5, **D-038**); `POST /api/auth/forgot-password` emails a reset link (3.6, **D-039**). Both are single-use, expiring and atomically consumed; a mail outage fails neither. Underneath: `services/email.ts` (3.3, **D-035**), four templates (3.4, **D-036**), configuration (3.2, **D-034**), provider (**D-033**). **Both credential flows now work end to end** — `/accept-invite` (3.11, **D-045**) and `/forgot-password` → `/reset-password` (3.12, **D-046**). An invited employee sets their own password from the emailed link; a user who forgot theirs recovers **unaided**, with no administrator involved. Both request pages preserve the backend's single-identical-refusal and 204-always contracts — a rendered difference would itself be the oracle | — |
| **File storage** | **G** | Does not exist | Phase 9 |
| **Background jobs** | **G** | No runner. `RECYCLE_BIN_RETENTION_DAYS` is read and stamped but **nothing acts on it** | Phase 15.9 |
| **Security headers** | **G** | **No CSP, HSTS, X-Frame-Options or Referrer-Policy anywhere.** Helmet disables CSP citing a frontend CSP that does not exist | Phase 13.5 |
| **Backend tests** | **B** | **687 cases across 25 files**, 571 of them against real migrations in PGlite. Zero coverage of refresh rotation, reuse detection, logout, lockout. **Both `DELETE /users/:id` guards are now exercised** — they had never been, in the repository's whole history (Tasks 2.1 + 2.2 added 26 cases). Team-membership authorization added 48 cases (BUG-038 / SEC-029, plus Task 2.7's move-sequence integration cases) | Phase 14.1 |
| **Frontend tests** | **B** | vitest + jsdom, no component-testing library (D-012); **454 tests across 20 files** cover the demo/real auth boundary, the transport allow-list, demo visibility, build-time demo exclusion, the command-palette link target, and the employee screen's edit / bank-access / team-membership / delete flows driven through the real page. Every other screen untested | Phase 14.2 |
| **E2E tests** | **G** | Zero | Phase 14.3 |
| **CI/CD** | **G** | **Not a single `.yml` file in the repository** | Phase 14.7, 15.3 |
| **Deployment config** | **G** | No Dockerfile, `vercel.json`, `railway.*` or `Procfile`. README self-certifies "Not deployed." | Phase 15 |
| **Monitoring / error tracking** | **G** | None | Phase 15.5–15.6 |
| **Backups** | **G** | None documented or configured | Phase 15.8 |
| **API documentation** | **G** | No OpenAPI, no Postman collection | Phase 15 |

---

## SUMMARY

| Status | Count | Meaning |
|---|---|---|
| **A** Fully implemented | 27 | Traced end to end |
| **B** Partial | 13 | Some links present |
| **C** Frontend only | 15 | **Includes all 13 fake handlers** |
| **D** Backend only | 13 | Route works, nothing calls it |
| **E** Mock / demo | 4 | Fabricated data presented as real |
| **F** Broken | 8 | Wired but demonstrably fails |
| **G** Missing | 20 | Nothing exists |

**Overall completion ≈ 45%** — backend ~80%, database ~90%, frontend ~35%, integration ~30%, operations ~5%.
