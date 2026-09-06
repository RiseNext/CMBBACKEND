# PRODUCTION ROADMAP — MASTER EXECUTION PLAN

> ## ⚠️ 2026-09-06 — THIS PLAN HAS BEEN EXECUTED AS FAR AS IT CAN BE
>
> **Waves 0–6 are complete.** Phases 0–14 are done or deliberately deferred with
> a recorded reason; Phase 15's code and configuration all exist; Phase 16's
> automatable half is done.
>
> **What remains in this document is either external or optional.** Do not treat
> an unticked row here as "the next task" — read
> [claude/NEXT_TASK.md](claude/NEXT_TASK.md), which points at
> [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md).
>
> Several rows below describe a state that is no longer true. The guiding
> principles immediately after this box are the clearest example — "13 handlers
> currently show a success toast and issue no request" was true when written and
> **all 26 such controls are now closed**, with a sweep across all twenty screens
> that fails if one returns. The rows are kept rather than rewritten because they
> record what the plan was answering; **the registers, not this file, are the
> current state.**

**This was the ordered plan that took this project from a demo to a deployable
Banking/Lending Operations CRM.**

**Read [claude/SESSION_HANDOFF.md](claude/SESSION_HANDOFF.md) first if you are a new session.**
**Never start a task without reading [claude/RULES.md](claude/RULES.md).**

---

## 0. HOW TO USE THIS DOCUMENT

1. Open [claude/NEXT_TASK.md](claude/NEXT_TASK.md) — it names the exact task to do now.
2. Find that task's phase below. Read the whole phase before touching code.
3. Do **only** that task. Do not skip ahead. Phases have hard dependencies.
4. When done, satisfy the phase's **Definition of Done**, then update:
   [claude/CURRENT_PROGRESS.md](claude/CURRENT_PROGRESS.md) · [claude/NEXT_TASK.md](claude/NEXT_TASK.md) · [FEATURE_STATUS.md](FEATURE_STATUS.md) · [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md) · [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) · [CHANGELOG.md](CHANGELOG.md).

### Guiding principles for every phase

| Principle | Why it matters here |
|---|---|
| **The backend is mostly built. Wire it, do not rebuild it.** | 58 of 96 endpoints (60%) already work and have zero callers. Most "features" are a frontend wiring job, not a backend job. Always check whether the route already exists before writing one. |
| **Never ship a control that lies.** | 13 handlers currently show a success toast and issue no request. The rule going forward: a control either performs the action or is disabled/removed. |
| **Trace end to end before claiming completion.** | UI → handler → HTTP → route → authz → service → DB → response → UI state. Every link, every time. |
| **Do not break the demo; isolate it.** | The demo must stay usable for client presentations. It must become incapable of touching production auth. |
| **Backend is the authority.** | Any rule enforced only in React is not enforced. |

### Effort scale

`S` ≈ half a day · `M` ≈ 1–2 days · `L` ≈ 3–5 days · `XL` ≈ 1–2 weeks. Estimates assume one engineer familiar with the codebase.

---

## PHASE OVERVIEW

| Phase | Name | Effort | Blocks |
|---|---|---|---|
| **0** | Repository safety and baseline | S | everything |
| **1** | Demo isolation + authentication integrity | M | ✅ **COMPLETE 2026-09-02** |
| **2** | Real employee management | M | 3, 12 |
| **3** | Credential delivery, invitation and email | L | production onboarding |
| **4** | Customer functionality | M | ✅ **COMPLETE 2026-09-05** |
| **5** | Loan / file workflow | L | ✅ **COMPLETE 2026-09-05** |
| **F1** | *Phase 6–10 prerequisite* — factory transaction extension | M | **6.1, 7.3, 8.8, 10.3** |
| **6** | Bank order workflow | ~~M~~ **L** | 7 |
| **7** | Disbursement | M | 8 |
| **8** | Transactions and settlements | M | 11 |
| **9** | Document storage | L | KYC compliance |
| **10** | Notifications | M | — |
| **11** | Reports and ledger | M | — |
| **12** | Roles / teams / permissions / admin UI | L | — |
| **13** | Security hardening | L | go-live |
| **14** | Testing | L | go-live |
| **15** | Production infrastructure | L | go-live |
| **16** | Final QA and production audit | M | go-live |

Phases 4–12 are **largely parallelisable** once Phases 0–3 are complete. Phases 13–16 must come last, in order.

> **Phase 6–10 reconciled 2026-09-05 (Wave 0).** The block was gated as READY and carries **42 rows** — 39 official, plus `F1`, `9.11` and `10.9`. Row `7.6` is **merged** (delivered by Task 5.7); rows `10.7` and `10.8` are **deferred** to 12.6 and 15.9 on their own stated dependencies; proposed rows `6.7`, `7.8` and `8.9` were **withdrawn** into 6.6, 7.3 and 8.3. Six false premises in the row text were corrected in place — each carries a dated note. Migration order is `0008` → `0009` → `0010` → `0011`, strictly serial under **D-050**. See **D-062**…**D-079** in [DECISIONS.md](DECISIONS.md) and the ratified machines in [BUSINESS_FLOW.md](BUSINESS_FLOW.md) §3.3.1.
>
> **Two owner decisions remain open and are the only things that can pause the block:** **OPEN-2** (storage provider — pauses at 9.4's adapter) and the **KYC-pack definition** (pauses 9.11 alone). Neither blocks starting: 40 of 42 rows proceed without an owner answer.

---

# PHASE 0 — REPOSITORY SAFETY AND BASELINE

**Goal:** establish a known-good, reproducible starting point, and stop the current work from being lost.

### Problems being solved
- **1,242 lines of completed, tested work sit uncommitted** in the working tree (8 modified + 4 untracked files). A `git checkout` or a machine failure destroys it. This work converts four demonstrably fake flows into real ones.
- The repo cannot be built or verified reproducibly: `.env.example` does not exist despite `README.md` referencing it twice, and there is **no root `.gitignore`** despite the README asserting one covers `.env`.
- `AADHAAR_PEPPER` — the one variable that hard-fails production boot — is **absent from `.env.example`**.
- `frontend/__pycache__/rewire.cpython-312.pyc` is tracked in git: 12 KB of Python bytecode whose source is not in the repo, in a project with no Python toolchain. It is the residue of an unversioned code-generation script that mechanically rewired the frontend, and it explains the pattern of half-wired handlers found throughout.

### Existing functionality to reuse
`npm run typecheck && npm run lint && npm test` in `backend/`, and `npm run typecheck && npm run build` in `frontend/`. Both gates already work.

### Tasks
| # | Task | Effort |
|---|---|---|
| 0.1 | Run all four gates on the **current working tree** and record the exact output in [CURRENT_STATE.md](CURRENT_STATE.md). This is the baseline every later phase is measured against. | S |
| 0.2 | Review the uncommitted diff in full (`git diff`, plus the 4 untracked files), confirm it is correct, and **commit it as one reviewed commit**. Do not push. *(Requires explicit user approval — see RULES.md.)* | S |
| 0.3 | Create `.env.example` with every key from `src/config/env.ts`, including `AADHAAR_PEPPER`, `NODE_ENV`, `PORT`, `COOKIE_DOMAIN`, `FRONTEND_URL`, `MAX_UPLOAD_MB`. Placeholder values only. | S |
| 0.4 | Add a root `.gitignore` covering `.env`, `.env.*` (with `!.env.example`), `node_modules`, `.next`, `dist`, `__pycache__`, `*.pyc`. | S |
| 0.5 | Remove `frontend/__pycache__/` from git tracking. Record the decision in [DECISIONS.md](DECISIONS.md). | S |
| 0.6 | Correct the stale claims in `README.md`: "9 triggers" → 7; "82 tests across three files" → 107 across four; the `frontend/ — UNMODIFIED, reference only` line; the reference to a non-existent `.env.example`. Add a prominent section documenting that demo mode exists. | S |
| 0.7 | Confirm `frontend/README.md` is obsolete (it describes the pre-backend app: a role dropdown that no longer exists, a `risenext.session` localStorage key that is not used, a `src/lib/data/` directory that does not exist, and an empty demo-credentials table). Replace or clearly mark it as historical. | S |

### Dependencies
None. Must be first.

### Tests required
The four existing gates must pass unchanged. No new tests.

### Definition of Done
- [ ] All four gates pass and their output is recorded in `CURRENT_STATE.md`.
- [ ] The working tree is clean (the employee work is committed).
- [ ] `.env.example` exists and is complete against `env.ts`.
- [ ] Root `.gitignore` exists.
- [ ] `README.md` contains no claim contradicted by the code, and documents demo mode.
- [ ] `DECISIONS.md` records the `__pycache__` removal.

---

# PHASE 1 — DEMO ISOLATION + AUTHENTICATION INTEGRITY

**Goal:** make it structurally impossible for demo mode to interfere with real authentication, while keeping the demo fully usable for client presentations.

> **This phase fixes the root cause of "Super Admin cannot add an employee." Nothing else should be attempted first.**

### Problems being solved
| Ref | Problem |
|---|---|
| BUG-001 | Demo mode is sticky. `disableDemoMode` has exactly one call site — inside `signOut`'s demo branch (`frontend/src/hooks/use-auth.tsx:212`). A real sign-in never clears the flag. |
| BUG-002 | `frontend/src/lib/api.ts:118` short-circuits **every** request when the flag is set, including `POST /auth/login`. The demo router has no `login` case (`frontend/src/lib/demo/api.ts:249`), so a real sign-in fails with **"Endpoint not found"**. |
| BUG-003 | On reload, `/auth/refresh` is intercepted and returns the demo user with no credentials (`demo/api.ts:245`), the login page bounces away (`login/page.tsx:29`), and `/employees` is redirected to `/my-work`. The user cannot escape. |
| SEC-001 | `DEMO_PASSWORD` and all 838 lines of fabricated PII ship in the **production bundle for every visitor**, because `lib/api.ts:10-11` deep-imports the demo module at module scope. |
| SEC-028 | Cookie `secure`/`sameSite` hinge on `NODE_ENV === "production"`, which **defaulted** to `"development"`. Misconfigure it and every reload silently logs users out — and the cookie loses `Secure`. **✅ Resolved by Task 1.7.** *(This row previously read "SEC-014", which is a different, still-open finding — the audit-log SQL-precedence bug. Corrected 2026-09-02.)* |
| SEC-018 | A rejected CORS origin returns a plain `Error` → HTTP **500** plus an error-level log line, so a config mistake looks like a crash. **✅ Resolved by Task 1.6.** *(This row previously read "SEC-013", which is a different, **still-open P1** finding — recycle-bin restore/permanent-delete skip all scoping for `null`-bank entries, `admin.routes.ts:854,885`. Nothing in Phase 1 touched it. Corrected 2026-09-02 by the Phase 1 final review; the register was always right.)* |

### Existing functionality to reuse
The entire demo layer stays. `enableDemoMode`/`disableDemoMode`/`isDemoMode` already exist and work. The real auth chain (login → rotating refresh → logout) is correct and must not be altered.

### Tasks
| # | Task | Effort |
|---|---|---|
| ✅ 1.1 | **Clear the demo flag on every entry into a real session.** Call `disableDemoMode()` + `resetDemoData()` at the top of `signIn`'s non-demo branch, in `forceSignOut`, and whenever the login page mounts. — **DONE 2026-09-01.** Plus an in-flight-refresh guard the original analysis missed. | S |
| ✅ 1.2 | **Make the demo unable to intercept auth.** Exclude `/auth/*` from the `apiRequest` short-circuit, or have `demoRequest` explicitly refuse and clear the flag. A real credential must always reach the network. — **DONE 2026-09-01**, as an **allow-list** rather than the deny-list suggested here: the demo may answer `/auth/refresh` only, so it fails closed for auth routes that do not exist yet ([DECISIONS.md](DECISIONS.md) D-013). | S |
| ✅ 1.3 | **Build-time isolation.** Gate the `lib/demo` import behind an env flag (e.g. `NEXT_PUBLIC_ENABLE_DEMO`) so the fixtures and the password are **tree-shaken out of production builds entirely**. Use a dynamic import so the module is not statically linked. — **DONE 2026-09-01, by a different mechanism.** Neither tree-shaking nor a dynamic import can *guarantee* absence: the first depends on minifier heuristics, the second would force `apiRequest`'s synchronous decision to become async. Implemented instead as **bundler module replacement** — `turbopack.resolveAlias` maps `@/lib/demo` to an inert substitute, so the real module is never resolved ([DECISIONS.md](DECISIONS.md) D-014). **This closed SEC-001.** | M |
| ✅ 1.4 | **Make demo mode visible.** A persistent, unmissable banner whenever the flag is set — not the current small sidebar caption that disappears when the sidebar collapses. — **DONE 2026-09-02.** Three surfaces rather than one: the banner asked for, plus a badge in the sticky topbar (so the signal survives scrolling) and the sidebar caption lifted out of its `!collapsed` wrapper ([DECISIONS.md](DECISIONS.md) D-015). | S |
| ~~1.5~~ | ~~Move the demo credential out of a source literal into the demo-only env-gated config so it is never a constant in shipped JS.~~ — **SUPERSEDED 2026-09-02, not implemented** ([DECISIONS.md](DECISIONS.md) D-016). Its remedy cannot achieve its goal: `NEXT_PUBLIC_*` values are inlined into client JS at build time (proven with a sentinel build), and a server-only variable cannot reach `isDemoCredentials()`, which runs in the browser with no network. The objective — no credential in the shipped bundle — was met by **Task 1.3**. The credential was never the gate into demo mode either; the `sessionStorage` flag alone is sufficient. | — |
| ✅ 1.6 | Fix the CORS rejection path to return **403**, not 500, and log at `warn`. — **DONE 2026-09-02.** The origin callback now rejects with `AppError(403, "cors_origin_denied")` and logs once at `warn` **at the rejection site** — the generic error handler is untouched, so no other 4xx changed its logging. Also fixes disallowed **preflight**, which returned 500 too and was not recorded anywhere ([DECISIONS.md](DECISIONS.md) D-018). 16 tests, no database, ~80 ms; reverting fails 7. | S |
| ✅ 1.7 | Fail fast on cookie misconfiguration — **DONE 2026-09-02, AMENDED.** The wording asked to assert that `NODE_ENV=production` implies `secure`+`sameSite=none`; investigation proved that **tautological** (both flags are computed from that same expression, so the assertion passes against the broken code — demonstrated). The real defect was that `NODE_ENV` **defaulted** to `development` while nothing in the repo sets it, so a production deploy that forgot it shipped `Secure=false; SameSite=Lax` cookies. Fixed by making `NODE_ENV` a **required declaration** ([DECISIONS.md](DECISIONS.md) D-019, **SEC-028**). The second clause — validate `COOKIE_DOMAIN` against the API host — is **not implementable**: no authoritative API-host value exists in the schema. Follow-up. | S |
| ✅ 1.8 | Handle **403 deactivation** on the client — **DONE 2026-09-02, AMENDED.** The wording implied a frontend-only fix; it is not possible, because **every** 403 carried `code: "forbidden"` — deactivation, missing permission, bank scope, and the demo's fabricated refusals were indistinguishable. Two dedicated codes (`account_inactive`, `role_disabled`) are now raised by the session gates in `services/access.ts`, and `apiRequest` signs out on those alone ([DECISIONS.md](DECISIONS.md) D-020, **BUG-034**). Also corrected: the ladder is at `lib/api.ts:209-221`, not `:153`, and deactivation previously resolved itself at access-token expiry — a ≤ 15-minute UX window, not an authorization bypass. | S |
| ✅ **1.10** | **DONE 2026-09-02.** **Make the demo exclusion bundler-independent and self-verifying.** `turbopack.resolveAlias` is honoured only by the Turbopack path, so `next build --webpack` — a documented flag — ships the credential and all fixture PII while the build prints `demo module: EXCLUDED`. **SEC-027 (HIGH).** Add the webpack `resolve.alias` equivalent *or* make a non-Turbopack build fail loudly; make the banner report what was **bundled**, not what was configured; and add the automated post-build output check this phase's test list asked for and never got. Found 2026-09-02 while reviewing 1.5. — **Done in three layers ([DECISIONS.md](DECISIONS.md) D-017).** `resolve.alias` alone proved insufficient: Next's `JsConfigPathsPlugin` outruns it, so webpack needed `NormalModuleReplacementPlugin`. A tripwire in `lib/demo/config.ts` now fails the build on *any* bundler if the demo is reachable, and `npm run verify:demo-exclusion` builds on both bundlers and searches the output. | S |
| ✅ 1.9 | Fix the customer global-search 500 — **DONE 2026-09-02.** Both sides fixed as the wording asked: the palette navigates by `customer.id` (the call is at `topbar.tsx:203` at HEAD — it was `:193` before `a77b3c5`, `:198` before this task, and Task 1.9's own explanatory comment moved it a further +5), and the three customer `:id` handlers parse `z.object({id: z.string().uuid()})` after `requirePermission`, yielding the project's standard **422 `validation_failed`**. **The error handler was deliberately NOT changed** ([DECISIONS.md](DECISIONS.md) D-021): mapping `22P02` centrally would convert a mis-minted-JWT outage — which fails inside `requireAuth` on *every* request — into an unlogged 4xx. Two register corrections fell out of the investigation: **BUG-027 is INVALID** (`/:id` matches one segment, so `/check/reference` was never shadowed — measured 200/409), and BUG-017's claim that the sibling calls returned 422 was measured false (**500**; now **BUG-035**). Scope stated honestly: 3 endpoints fixed, **45 others share the pattern and are deferred to Phase 8**. | S |

### Dependencies
Phase 0.

### Tests required
- Backend: ~~`22P02` on any `/:id` route returns 404/422, never 500 *(Task 1.9)*~~ — **done for the three customer routes, 422.** Narrowed deliberately: "any `/:id` route" would have meant a central `22P02` mapping, which was measured to hide a real auth-path outage (D-021). The other 45 endpoints are Phase 8. ~~Rejected CORS origin returns 403~~ — **done, Task 1.6**, plus disallowed preflight and the `warn` log.
- **Frontend (new — first frontend tests in the repo):** with the demo flag set, `signIn` with real credentials clears the flag and issues a real network request; `apiRequest` never routes `/auth/*` to the demo handler; a production build contains neither `DEMO_PASSWORD` nor any fixture string.
- Manual: demo → navigate to login without signing out → sign in as Super Admin → land on `/dashboard` with real data.

### Definition of Done
- [x] Demo mode cannot be active during a real session, by construction. — **1.1 + 1.2**
- [x] A production build contains no demo credential and no fixture data — verified by grepping the build output. — **1.3 + 1.10.** True on **every** build path now, not just the default: `npm run verify:demo-exclusion` builds on Turbopack *and* webpack into clean output and searches it, and a tripwire fails the build if the demo is ever reachable. This box was briefly ticked on a one-time manual grep against one bundler — which is exactly how SEC-027 went unnoticed — and is now backed by a re-runnable check.
- [x] Demo mode is unmistakably visible when active. — **1.4.** Proved by mounting the real `AppShell` in a demo session and clicking the collapse control; two independent reversions fail the test.
- [x] Signing in as Super Admin from a previously-demoed tab works. — **1.1**, covered by regression test group C (`use-auth.demo-boundary.test.tsx:204-252`), which plants the demo flag, signs in with real credentials and asserts the request reached the network with `isDemoMode() === false`.
  - ⚠️ **Corrected 2026-09-02 by the Phase 1 final review.** This box previously read *"… and reaches `/employees`"*, attributed to the same test. **Group C proves no such thing** — it renders no page, and it mocks `next/navigation` into a throwaway object, so no route is observable. The application has no post-login `/employees` flow at all: `login/page.tsx:69` routes to **`/dashboard`**, which the Manual line above also says. What the fix actually achieves is that `isDemoMode()` becomes false, so `app-shell.tsx:29`'s `outOfScope` guard stops redirecting `/employees` to `DEMO_HOME` — the mechanism is sound and the flag half is tested, but **the navigation half is manual and unverified.** No test anywhere in the frontend suite mentions `/employees`.
- [x] Deactivating a user mid-session signs them out client-side. — **1.8.** Two dedicated codes (`account_inactive`, `role_disabled`); ordinary `forbidden` 403s leave the user signed in. Proven in both directions by reversion.
- [x] **Selecting a customer from the global search opens their profile.** — **1.9.** The palette links by `id`; a malformed `:id` is a 422 naming `id` rather than a 500 with a logged stack trace. 20 backend + 2 frontend tests; reverting the backend fails 9, reverting the frontend line fails 1.
- [x] BUG-001, SEC-001 closed in `BUGS_AND_ISSUES.md` / `SECURITY_AUDIT.md`. *(BUG-002 and BUG-003 as listed above are symptoms of BUG-001 and were closed with it; the IDs in the register itself denote different defects.)*

---

# PHASE 2 — REAL EMPLOYEE MANAGEMENT

**Goal:** complete the employee lifecycle so a Super Admin can create, edit, scope, deactivate and delete employees entirely from the UI.

### Problems being solved
- The uncommitted work delivers create + temp password + reset + forced change. **After committing it (Phase 0.2), what remains missing is edit, delete, and post-creation access management.**
- `PUT /api/users/:id/banks` exists and has **zero callers** — after creation, an employee's bank access can never be changed.
- `DELETE /api/users/:id` exists and has **zero callers**.
- There is **no employee edit UI at all**, though `PATCH /api/users/:id` supports 11 fields.
- `PATCH /api/users/:id` silently **accepts and discards** `teamId`, `bankIds` and `joinedOn` — it returns 200 for a no-op.
- ~~**SEC-003 (CRITICAL):** `PATCH /api/users/:id` has neither the self-check nor the last-super-admin guard that `DELETE` has, so a Super Admin can lock the entire organisation out using the UI's own "Revoke access" button, with no API recovery path.~~ ✅ **CLOSED 2026-09-02 by Tasks 2.1 + 2.2.**
- **Found while closing it, still open:** **BUG-036 (HIGH)** — `userInput.partial()` does not suppress `.default("Active")` in zod 4.4.3, so a name-only `PATCH` silently **reactivates a deactivated account** and zeroes `target`/`achieved`. Same handler, opposite failure to BUG-020; **Task 2.5 should absorb it.** **BUG-037 (MEDIUM)** — the invariant is check-then-write with no lock, a whole-codebase class deferred to Phase 13.
- ~~**BUG-038 (HIGH) / [SEC-029](SECURITY_AUDIT.md#sec-029) (MEDIUM):** `PUT /api/teams/:id/members` consults the role hierarchy nowhere, so any `teams.assign` holder can enrol **or silently evict** any user, a Super Admin included.~~ ✅ **CLOSED 2026-09-03.** Found by measurement during Task 2.5, not by the security audit, and fixed as its own task **before** Task 2.7 wires the route to the UI. Authorization now covers the **union of the previous and submitted rosters** — see **D-027**. This is a sequencing insertion inside Phase 2, not a reordering of tasks: 2.7 keeps its number, its scope and its position.
- Deleted users never enter the recycle bin (`user` is absent from `BIN_REGISTRY`) and are unrecoverable through any endpoint.
- ~~**SEC-010:** `mustChangePassword` is enforced only in React.~~ **CLOSED 2026-09-02 by Task 2.3.** *(This line said **SEC-009** until 2026-09-02. SEC-009 is a different, still-open P0 — plaintext Aadhaar in `import_rows`. The `mustChangePassword` finding is **SEC-010**. See the note under Task 2.3.)*

### Existing functionality to reuse
`POST /api/users` (transactional: users + user_bank_access + team_members + audit) · `POST /api/users/:id/reset-password` · `PATCH /api/users/:id` · `PUT /api/users/:id/banks` · `DELETE /api/users/:id` · `generateTemporaryPassword()` · `CredentialHandover` component · the whole hierarchy guard set in `src/services/access.ts`.

### Tasks
| # | Task | Effort |
|---|---|---|
| ✅ 2.1 | **Add the self-guard and last-super-admin guard to `PATCH /api/users/:id`.** Block self-`status` and self-`roleId` changes. Highest priority in this phase. — **DONE 2026-09-02.** Field-scoped self-guard (not a copy of `DELETE`'s unconditional one) + the shared `assertSuperAdminRemains` invariant. **SEC-003 / BUG-003 CLOSED.** | S |
| ✅ 2.2 | Fix the last-super-admin count to exclude the target row — currently a deactivated super admin can never be deleted while exactly one active one remains. — **DONE 2026-09-02, through the same shared helper, not a second implementation.** The end-state formulation only refuses when the operation actually removes the target from the protected population, so an already-inactive Super Admin is now deletable (204, was 409). Landed with 2.1 because the *only* formulation correct for both routes is the 2.2 one; writing it twice would have left two subtly different statements of one rule. See **D-022**. | S |
| ✅ 2.3 | **Enforce `mustChangePassword` server-side.** — **DONE 2026-09-02. SEC-010 / BUG-005 CLOSED.** *Amended during implementation, on measurement:* the original wording said *"in `requireAuth`: reject with 403 unless the path is `/api/auth/change-password`, `/api/auth/me`, or `/api/auth/logout`"*. **No path allow-list was used** — inside `requireAuth` (applied by `router.use()` on twelve routers plus the `createScopedResource` factory) `req.path` is relative to the mount, so that comparison never matches and would have locked every flagged user out of their own recovery route. Instead `requireAuth` became the strict default and exactly two routes opt out via `requireAuthAllowPasswordChange`. **`/api/auth/logout` was also wrong** — it carries no `requireAuth` at all, so it never needed an exemption, and neither do `/login` or `/refresh`. See **D-023**. | S |
| ✅ 2.4 | Build the **employee edit** dialog and wire it to `PATCH /api/users/:id`. — **DONE 2026-09-03.** Gated on `can("users.edit")`; sends **only changed fields**, so an explicit `0` survives and opening a revoked employee to fix a typo does not reactivate them. Backend 400/409/403/422 messages surfaced verbatim. `bankIds`/`teamId`/`joinedOn` deliberately not offered — **BUG-020 is still open** and they would report a success that never happened. | M |
| ✅ 2.5 | Make `PATCH /api/users/:id` actually apply `teamId` and `bankIds`, or reject them explicitly. Silent discard is worse than either. — **DONE 2026-09-03. BUG-020 CLOSED.** Answered per field rather than as one choice: **`joinedOn` is persisted** (a plain column no other route can change), while **`bankIds` and `teamId` are refused with 422** because `PUT /api/users/:id/banks` and `PUT /api/teams/:id/members` already own them transactionally — and `users` has no team column at all, so a scalar `teamId` would invent a relationship the schema does not have. See **D-025**. | S |
| ✅ 2.6 | Wire **bank access management** to `PUT /api/users/:id/banks`. — **DONE 2026-09-03.** A "Bank access" dialog on the employee detail view, gated on `can("users.assign")` — the permission the route actually requires, which is **not** `users.edit`. Sends the complete desired set to the existing route (a whole-list replace); never adds `bankIds` back to `PATCH`, which refuses it since 2.5. The UI adopts the server's returned list rather than the one it sent. 22 frontend tests. | S |
| ✅ 2.7 | Wire **team membership** management (`PUT /api/teams/:id/members`) from the employee screen. — **DONE 2026-09-03.** A **Team** dialog on the employee detail view, gated on `can("teams.assign")` — a third distinct permission on that screen, not inferred from `users.*` or from a role name. The route replaces a team's **whole roster**, so the client re-reads `GET /teams` at save time and resubmits every other member unchanged; a move is two requests, removal first. See **D-028**. 30 frontend tests plus 5 backend integration cases. Was blocked on BUG-038 / SEC-029, fixed first as its own task. | S |
| ✅ 2.8 | Wire **delete** to `DELETE /api/users/:id` with a confirmation dialog and clear messaging that it is a soft delete. — **DONE 2026-09-03.** A **Delete** button on the employee detail view, gated on `can("users.delete")` — a fourth distinct permission on that screen — opening a confirmation that must be accepted before any request is sent. The copy states plainly that the deletion **cannot be undone from the product**, because `user` is absent from `BIN_REGISTRY` and 2.9 has not landed; it points at **Revoke access** as the reversible alternative. 204 is reconciled by re-reading, not merging. See **D-029**. 23 frontend tests plus 6 backend cases. | S |
| ✅ 2.9 | Add `user` to `BIN_REGISTRY` so deleted employees are restorable, and route the delete through `softDelete`. — **DONE 2026-09-03.** `user` is the registry's 13th type, with `bankIdOf: () => null` (following `service_provider`) and two declarative additions the other types did not need: `redact` keeps the argon2 hash out of the retained snapshot, and `deleteFields` preserves the deactivation the hand-rolled delete used to do inline. `DELETE /api/users/:id` now calls `softDelete` while keeping all three of its guards ahead of the write. **The bin routes gained a hierarchy check for user entries** — `recycle_bin.restore` is seeded to `manager`, so without it a Manager could restore a Super Admin. See **D-030**. 23 backend tests; Task 2.8's confirmation copy and its tests were inverted to match. | M |
| ✅ 2.10 | Surface `loading`/`error` on the employees page — they are currently destructured and discarded, so a failure looks like an empty database. Surface the server's per-field `error.details` on validation failures instead of the generic message. — **DONE 2026-09-03.** The page took **neither** value (it destructured only `data` and `refresh`), and because `useResource` also clears `data` on rejection a failed fetch rendered the "no employees" empty state. It now shows a skeleton while loading, an error banner with a **Try again** that calls `refresh`, and suppresses the table entirely on failure. Server `details` are mapped onto the control they name in the create and edit dialogs — the frontend's **first** consumer of that field. See **D-031**. 38 frontend tests. | S |
| ✅ 2.11 | Replace the client-side employee-code suggestion (derived from at most 200 loaded rows) with a server-generated code, and fix the underlying `count(*)`-based generator, which collides after any permanent-delete. — **DONE 2026-09-03.** `employeeCode` is now optional on `POST /api/users`; omit it and the server assigns `EMP-0002`, `EMP-0003`, … from the **maximum suffix ever issued**, read from `users` (no `deleted_at` filter) **and** the retained recycle-bin snapshots of purged employees. `suggestEmployeeCode()` is deleted from the browser. See **D-032**. 15 backend tests; the lifecycle test fails against a `count(*)` implementation. *(**Correction:** this row's second clause was inaccurate. **No `count(*)` generator ever underlay employee codes** — they were required client input. The `count(*)` generators are for customers and the nine factory routers, and are tracked separately as **[BUG-011](BUGS_AND_ISSUES.md#bug-011)** (HIGH, open), which names seven resources, none of them users. That bug is untouched here.)* | M |

### Dependencies
Phase 0 (the work must be committed), Phase 1 (the screen must be reachable).

### Tests required
Backend: self-deactivation blocked · last super admin protected on PATCH as well as DELETE · `mustChangePassword` blocks a non-auth route · edit applies every field it accepts · bank reassignment · team reassignment · delete → recycle bin → restore.
Frontend: **every mutating control on the employees page issues an HTTP request.**

### Definition of Done
- [ ] A Super Admin can create, edit, scope, assign, deactivate, delete and restore an employee entirely from the UI.
- [ ] A Super Admin cannot lock themselves or the last peer out.
- [ ] A temporary password grants access to nothing except changing it.
- [ ] No control on the page shows success without a request.

---

# PHASE 3 — CREDENTIAL DELIVERY, INVITATION AND EMAIL

**Goal:** build the email subsystem — it does not exist in any form today — and use it for onboarding and self-service reset.

### Problems being solved
- **No email provider, no transport, no template, no config key, no stub.** The subsystem was never begun.
- Credentials are delivered by a human reading a password off a screen. There is no record that delivery occurred.
- **There is no self-service password reset.** The "Forgot password?" link is a toast telling the user to contact an administrator. If the last Super Admin is locked out, nobody can recover the tenant.
- The UI has made several email promises with nothing behind them (all removed in the working tree except the Settings "Request export" toast).

### Existing functionality to reuse
`POST /api/users/:id/reset-password` already generates a credential, revokes sessions and audits. Invitation is that flow plus delivery. `generateTemporaryPassword()` and `randomToken()` already exist. The forced-change flow from Phase 2 is the landing point for an invited user.

### Tasks
| # | Task | Effort |
|---|---|---|
| ✅ 3.1 | **Choose a provider and record the decision in [DECISIONS.md](DECISIONS.md).** Consider deliverability from India, cost, and Railway compatibility. — **DONE 2026-09-04. Resend**, starting on the free tier (3,000/month, 100/day as stated), upgrading within the same provider when volume requires it. Decided by the project owner; recorded as **D-033**, which resolves **OPEN-1**. Documentation only — no SDK, no service, no config key, no secret. **OPEN-3** (invitation link vs emailed password) was a separate question, still open at the time of this task; it gated **3.5**, not 3.2–3.4. ✅ **Resolved 2026-09-04 by D-037** — the link. | S |
| ✅ 3.2 | Add config: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`. Validate in `env.ts`. Required in production, optional in development with a console transport. — **DONE 2026-09-04.** All four are optional in the schema and required by the production block, the same split `AADHAAR_PEPPER` already uses. `EMAIL_PROVIDER` is an **allowlist of one** (`resend`, per D-033), so a typo is a boot failure rather than a silent no-op. `emailTransport()` resolves `resend` or `console`; production cannot reach `console` because it refuses to boot. Configuration only — no SDK, no service, nothing sent. See **D-034**. 22 tests. | S |
| ✅ 3.3 | Build `src/services/email.ts`: a provider-agnostic interface, retries with backoff, structured logging, and **guaranteed non-blocking failure** — a mail outage must never fail user creation. — **DONE 2026-09-04.** `sendEmail(message)` **never throws**, returning a discriminated `sent`/`logged`/`failed` outcome, so `void sendEmail(...)` in a request path can neither fail it nor leak an unhandled rejection — while a failure is still *reported* rather than swallowed. Bounded retries (3 attempts, 200/400 ms) on transport errors, 429 and 5xx; a 4xx refusal is **not** retried. **No SDK** — one `fetch` POST, no dependency added (**D-035**). Resend appears in exactly two source files. 32 tests. Nothing calls it yet: templates are 3.4 and the invitation flow is 3.5. | M |
| ✅ 3.4 | Templates: employee invitation, password reset, password changed, account deactivated. Plain text + HTML. — **DONE 2026-09-04.** Four pure functions in `src/lib/email-templates.ts`, each returning an `EmailMessage` for `sendEmail()`. No database, no network, no environment, no clock. Every dynamic value — URL, expiry, name, timestamp — is a **typed input**, so no template invents a domain, an expiry or a credential rule. Names are HTML-escaped and links are refused unless `http(s)`. 29 tests. The invitation was built for the **LINK** model on 3.5's own instruction, recorded as an assumption in **D-036**; ✅ **confirmed 2026-09-04 by D-037**, which resolved **OPEN-3** in favour of the link. No code changed — the assumption matched the decision. Nothing calls the templates. | M |
| ✅ 3.5 | **Invitation flow.** Add an `invitations` table (token hash, user, expiry, consumed_at) and `POST /api/auth/accept-invite`. Send a single-use, time-limited link rather than a password in an email — a password in an inbox is a permanent credential. — **DONE 2026-09-04.** Migration `0003`; only the SHA-256 digest is stored. Issued inside the create transaction, emailed after it commits. Acceptance is guarded by an atomic `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()`, so **at most one password establishment per invitation** — proven by two simultaneous requests. Every unusable token gets one identical refusal. **72-hour expiry, 48-byte token, `/accept-invite?token=…`** — all three recorded in **D-038**. 49 tests. ⚠️ **The frontend page does not exist**: the roadmap names only the endpoint, so this row is complete, but the phase's first Definition-of-Done box needs that page. | L |
| ✅ 3.6 | **Self-service password reset.** `POST /api/auth/forgot-password` (always returns 200 — never confirm whether an address exists) + `POST /api/auth/reset-password`. Single-use, expiring, rate-limited tokens; revoke all sessions on completion. — **DONE 2026-09-04.** Migration `0004` adds `password_resets` — a **separate** table from `invitations`, so a reset token cannot be redeemed at `/accept-invite` or the reverse. `forgot-password` answers **204 identically** for unknown, deleted, deactivated and disabled-role addresses, and the **logs are enumeration-safe too**. **1-hour** expiry, atomic consume, all sessions revoked, lockout cleared. **Rate limiting implemented locally** on all three public credential endpoints (**SEC-005 narrowed, still open**). 43 tests. See **D-039**. ⚠️ **No frontend page** — same documented gap as `/accept-invite`. | L |
| ✅ 3.7 | Record delivery state on the user (`invited_at`, `invite_accepted_at`) and surface it in the employees list. — **DONE 2026-09-04.** Migration `0005` adds both columns, written inside the very transactions that write the `invitations` row so they cannot drift. **`invited_at` means ISSUED, not delivered** — `sendEmail` reports provider acceptance at best and the console transport delivers nothing, so a column gated on send outcome would be null on every developer machine and still would not mean *received*. It is the **latest** issuance, which is what 3.8's resend needs. The employees list shows Accepted / Invited / Not invited with a filter, and the wording never says "Emailed" (**D-004**). 33 tests. See **D-040**. | S |
| ✅ 3.8 | Add a **resend invitation** action. — **DONE 2026-09-04.** `POST /api/users/:id/resend-invitation`, plus a gated button on the employee detail view. The mechanics are inherited whole from 3.5–3.7 — `issueInvitation` already supersedes the outstanding link, stores only the digest, applies the 72-hour TTL and moves `invited_at` — so the task was really four decisions: the gate is **`users.reset_password`** (the only candidate that grants nobody a capability they did not already have), the **hierarchy rule applies** (the BUG-038 lesson, on a route that looks equally harmless), an **already-accepted employee is refused 409** (the invitation email would lie, and it would be a quieter second password-reset path), and a **non-Active one is refused** because the link would be dead on arrival. Audited as `invitation_resent`. 105 tests, 23 mutations all caught. See **D-041**. | S |
| ✅ 3.9 | Keep the on-screen credential hand-over as an explicit fallback for when email is unavailable — do not remove it. — **DONE 2026-09-04.** Verified first: the hand-over already survived a mail outage and **no backend change was made**. Two things were missing. It was not **test-protected** — there was no frontend test for it at all, and nothing anywhere asserted it survives an outage, so deleting it broke nothing. And it was not **explicit**: the create flow discarded `invitation` entirely, so an outage and a successful send produced *identical* screens. The outcome is now threaded through and the copy follows it, with `logged` grouped with `failed` rather than `sent` — the console transport delivers nothing (**D-035**). The password is still shown for every outcome; only the words change. 53 tests, 14 mutations all caught. See **D-042**. | S |
| ✅ 3.10 | Remove the last false email promise: `settings/page.tsx:329-333` "Export queued — You'll get an email when it's ready." Either implement the export or remove the control. — **DONE 2026-09-04. Removed.** The handler was one `toast.success` and nothing else: no request, no queue, no job, no file, no `sendEmail`. Implementation was weighed rather than dismissed — a real export mechanism does exist in `lib/export.ts` — and rejected on three grounds: a four-dataset archive needs a zip dependency or server-side generation, which **11.9 already owns**; the PRD states there is *"no server-side export, no scheduled export"* and requires none; and this phase's own preamble records that the other false email promises were **removed**. Nothing was lost — every list page still exports CSV through `DataTable`. The repo-wide sweep confirms this **was** the last false *email* promise; the two remaining fake-*async* claims are owned by **4.4** and **11.4**. 17 tests, 6 mutations all detected. See **D-043**. | S |
| ✅ 3.11 | **Build the `/accept-invite` page.** Let an invited employee set their own password through the single-use, time-limited link from Task 3.5, using the existing `POST /api/auth/accept-invite`. Handle the invalid, expired, consumed and successful states without weakening backend validation. — **DONE 2026-09-04.** A public route beside `/login`. **The form was the easy half.** The page branches on **HTTP status, never on the message**: **400** is the only status that means the invitation is unusable, and it renders the backend's own single sentence verbatim; **422** (password policy), **429** (the 3.6 limiter) and 5xx / offline explicitly do **not** blame the link — telling a user their invitation is dead because the server hiccuped costs them the one working link they have. A missing `?token=` renders **identically** to a server refusal and contacts no server. Success links to `/login` because the endpoint creates no session, and the spent token is stripped from the address bar. `accept-invite-link.test.ts` closes the seam neither side's unit tests could see — it parses the emailed URL as a browser does and feeds *that* token to the endpoint. 69 tests, 16 mutations all caught. See **D-045**. | M |
| ✅ 3.12 | **Build the `/reset-password` page.** Let a user set a new password from a valid single-use reset link, using the existing `POST /api/auth/reset-password` from Task 3.6. Handle the invalid, expired, consumed and successful states without weakening backend validation. — **DONE 2026-09-04.** Inherits **D-045** unchanged: branch on **status, never message**, so only a 400 means the link is dead — a 422 keeps the form open, and a backend test proves a rejected password **does not consume the token**, which is why that matters. **It also wired the request entry point**, because box 2 says *unaided* and `POST /auth/forgot-password` had **zero product callers**: `/login`'s "Forgot password?" was a toast reading *"Contact your administrator"* — true when written, false since 3.6. The new `/forgot-password` page carries the phase's real enumeration risk and answers it with a **conditional confirmation that is byte-identical** for known, unknown and deactivated addresses, shown on 204 only. **No backend change.** 116 tests, 19 mutations all caught. See **D-046**. | M |

### Dependencies
Phase 2.

### Tests required
Email service unit tests with a mock transport · invitation accept/expire/reuse · forgot-password does not leak existence · reset revokes sessions · **user creation still succeeds when the mail provider is down** · rate limiting on both public endpoints (depends on Phase 13, or implement locally here).


> **Ownership note — 2026-09-04.** Rows **3.11** and **3.12** were added *after* 3.1–3.10 were built, by an explicit project-owner decision. The gap they close was found by working the phase: 3.5 and 3.6 each delivered a complete, tested backend flow and an emailed link, and each roadmap row was written to name only the endpoint — so both rows were legitimately complete while the pages their links point at **did not exist**. Every invitation and reset link therefore landed on a 404, and Definition-of-Done boxes 1 and 2 could not be met by any row then on the roadmap.
>
> That was recorded as an unowned gap through Tasks 3.7–3.10 rather than absorbed into them. The project owner has now assigned it: **Phase 3 is not complete while `/accept-invite` and `/reset-password` are broken 404s.** Both pages are user-facing work over already-shipped, already-tested endpoints — **neither task changes the backend, the credential model, the token security of 3.5/3.6, or the status of SEC-005.** See **D-044**.
>
> **Dependency chain: 3.11 → 3.12 → Phase 3 complete → Phase 4.**

### Definition of Done
- [x] A new employee receives an invitation email and can set their own password without an administrator reading anything to them. — **met 2026-09-04 by Task 3.11.**
- [x] A user who forgets their password can recover it unaided. — **met 2026-09-04 by Task 3.12** (`/forgot-password` → email → `/reset-password` → sign in, with no administrator involved).
- [x] No UI text promises an email that is not sent. — **met by Task 3.10**, test-enforced.
- [x] A mail outage degrades gracefully and is visible in logs. — **met by Tasks 3.3, 3.5 and 3.9**; the outage is visible to the operator as well as the log.

> ## ✅ PHASE 3 IS COMPLETE — 2026-09-04
>
> All twelve rows are done and **all four Definition-of-Done boxes are genuinely satisfied**, including the two that were blocked by pages no row owned until **D-044** assigned them as 3.11 and 3.12.
>
> Both credential flows now work end to end for a real person: an invited employee follows the emailed link, sets a password and signs in; a user who has forgotten theirs clicks **Forgot password?**, receives a link, sets a new password and signs in — **with no administrator involved at any point**.
>
> **What this phase did NOT do**, stated plainly so it is not mistaken for finished business: **SEC-005 remains OPEN at P0.** The limiter added in 3.6 guards five routes out of ninety-six, is per-process, in-memory and fixed-window; `POST /api/auth/login` is still unguarded. Phase 13 owes the general answer.

---

# PHASE 4 — CUSTOMER FUNCTIONALITY

**Goal:** complete customer management, which is the closest to done of all business areas.

### Problems being solved
- The **customer detail page performs no writes at all.** Its edit dialog uses uncontrolled `defaultValue` inputs with no `onChange` and no refs — the typed values are never read — and Save, Delete and Print are all toasts. `PATCH /api/customers/:id` exists and has zero callers.
- `customers/page.tsx:232` "Re-upload written form" reads a `File` and discards it while toasting "queued for verification".
- The **customer timeline is fabricated**: three events with hardcoded clock times asserted unconditionally, under the heading *"Chronological trail for audit"*, while a real `audit_logs` table sits unused. It also produces malformed date strings by concatenating a time onto an ISO timestamp.
- Search is dead: `const [search] = React.useState("")` — destructured **without a setter**, so the server-side `?search=` parameter is never sent. All filtering is client-side over at most 100 loaded rows, and **customer 101+ is unreachable**.
- `GET /customers/check/reference` exists, works, and has zero callers despite its own docstring claiming two.
- `assignedUserId`/`assignedTeamId` are validated as UUIDs but never checked for existence or bank-scope membership.

### Existing functionality to reuse
Full customer CRUD backend with bank scoping, soft delete, recycle bin, audit, Aadhaar peppering, and duplicate detection by `(bank_id, bank_reference_id)`. **The Excel importer is fully wired end to end and is the reference implementation** — study `components/shared/customer-import-dialog.tsx` before writing new API code.

### Tasks
| # | Task | Effort |
|---|---|---|
| ✅ 4.1 | Make the detail edit dialog controlled and wire it to `PATCH /api/customers/:id`. — **DONE 2026-09-05.** Four fields (name, mobile, email, address), controlled, sending **only changed fields** via a dedicated `frontend/src/lib/customer-patch.ts` — the `employee-patch.ts` pattern. Aadhaar is absent **by construction**: `aadhaar: ""` or `null` nulls both `aadhaarHash` and `aadhaarLast4` irreversibly, and the API only ever returns the last four, so it is not round-trippable (**D-052**). A cleared box sends `null`, not `""` — `POST` normalises but `PATCH` spreads `...rest` raw. Server `details` land on the control they name through the existing `field-errors.ts` (**D-031**); duplicate submits are blocked by refs, not `disabled`, because state only applies after a re-render. Success is toasted only after an awaited 2xx and the view reconciles from the server (**D-004**). 48 tests. | M |
| ✅ 4.2 | Wire detail-page delete to `DELETE /api/customers/:id` (the list page already does this correctly — copy it). — **DONE 2026-09-05.** The detail dialog now awaits `DELETE /api/customers/:id`, then navigates to `/customers` rather than re-fetching a deleted record into `notFound()`. The list page supplied the *request* pattern, not the control — its `window.confirm` was not copied, and its then-ungated button was not copied either. Gated on `can("customers.delete")`, matching the route's own guard. 15 tests. | S |
| ✅ 4.3 | Replace the fabricated timeline with real data from `GET /api/audit-logs` filtered by `recordType=customer&recordId=…`. — **DONE 2026-09-05.** Wired to `GET /api/audit-logs?recordType=customer&recordId=…`. **`audit_logs.view` was NOT widened** (**D-049**): the three roles that lack it get an explicit permission-aware state, kept as its own `forbidden` flag rather than folded into `error`, so a 403 can never read as an empty history. **Only field NAMES are rendered — never a `from` or a `to`** — because `audit_logs.changes` carries unredacted PAN, mobile, email, account number and IFSC (**SEC-017**, still open). The trail is honestly thinner than the fabrication it replaced: `recordType` is scalar, so loan/document/transaction activity is unreachable, and the footer says so. 17 tests, including one that seeds ten sensitive values and asserts every one is absent from the DOM. | M |
| ✅ 4.4 | Remove or implement "Re-upload written form" — it must not claim to queue anything. Defer to Phase 9 if it needs real upload. — **DONE 2026-09-05. Removed.** Handler, button and hidden file input deleted together. There is no file storage anywhere in the repository, so "implement" was not available and metadata-only persistence would have been a second lie (**RULES §4**). | S |
| ✅ 4.5 | Wire server-side search, filter and pagination. Send `page`, `search`, `status`, `bankId`; consume `meta.total`. Extend `DataTable` to accept server-driven paging (it currently has no `total`/`page`/`onPageChange` props). — **DONE 2026-09-05.** `page`/`pageSize`/`search`/`status`/`bankId`/`kyc` now reach the server and `meta.total` drives the pager. `DataTable` gained five **optional** props; server mode engages only when `total`+`page`+`onPageChange` are all present, so the **ten other consumers are byte-identical** — proven by a 27-test regression suite written and run green against the *unmodified* component first (**D-051**). The six-button pager cap is gone: a sliding window pins both ends, so page 7+ is one click away. Four honesty fixes shipped with it: **PAN search was preserved**, not dropped, by the one-line backend extension D-053 prefers; the misleading global sort affordance is hidden (no server sort contract exists); export names its scope; and the stat cards no longer present a page-scoped figure as a book-wide fact. 48 tests. | L |
| ✅ 4.6 | Wire `GET /customers/check/reference` into the create form for pre-flight duplicate detection. — **DONE 2026-09-05.** Uses `apiRequest` directly, because the route answers `{available:true}` rather than the `{data}` envelope. **Advisory only** — nothing gates the save button and the unique index stays the authority. Only a **409** means "taken"; a 404, a 5xx, an offline client or a 200 whose body is not `available:true` becomes an explicit *unchecked* state. `ilike` is a superset of the index's `upper()` equality, so it can only ever produce a false *taken*, never a false *available*; when the reference contains `_` or `%` the warning says so instead of asserting a duplicate. The demo layer gained the branch it was missing, so demo mode no longer 404s into a false warning. 25 tests. | S |
| ✅ 4.7 | Validate `assignedUserId`/`assignedTeamId` existence and bank-scope membership on the backend — the `assertSameBank` pattern already exists in `operations.routes.ts:33-48` and was simply not applied here. — **DONE 2026-09-05.** Both fields validated on `POST` and `PATCH`. **Teams get existence and liveness only** — `teams` has no bank column and no join table, so "bank-scope membership" is undefined for them and inventing one would have been new product policy inside an S row (**D-047**). Users get existence, liveness and bank membership, with **unrestricted Admin/Super Admin accepted**: they hold `system.access_all_banks` and therefore carry *zero* `user_bank_access` rows, which means unrestricted, never "no access" (**D-048**). Refusals are **422** with `details:[{path,message}]` so the field errors map (**D-031**), replacing the FK's misleading 409 *"still referenced by other records"*. This is data integrity, not confidentiality — there is no assignment-driven read path, and a test pins that. 28 tests. | S |
| ✅ 4.8 | Surface `loading`/`error` (currently not even destructured on the list page). Gate the delete button on `can("customers.delete")`. — **DONE 2026-09-05.** `loading`, `error` and `total` are destructured at last. A failed load now shows a banner with a retry and **suppresses the table**, so an empty grid can never be mistaken for an empty database — the Task 2.10 lesson applied to customers. Delete is gated on `can("customers.delete")`, which Team Leader and Executive do not hold; the route enforces the same permission, so this matches enforcement rather than widening it. 13 tests. | S |
| ✅ 4.9 | Fix customer code generation. `count(*) + 1` with no locking collides under concurrency and **deterministically fails after any permanent-delete**. Use a Postgres sequence, initialised from the highest code ever issued. **Three sites are one defect and must share one mechanism**: `customers.routes.ts:123` (`nextCustomerCode`), the shared factory `scoped-resource.ts:88` (`nextCode`, six further series), and the Excel importer `imports.routes.ts:388`, which mints `CUS-` codes independently — fixing fewer than all three makes the route and the importer collide with *each other*. ⚠️ **Do NOT add a `deleted_at` filter.** Its absence is load-bearing: a soft-deleted row still counts, so its code stays reserved — [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md#bug-011) states *"Soft delete alone is safe, because the row remains and still counts."* Adding the filter would reissue a soft-deleted row's code past the partial unique index and make recycle-bin restore permanently impossible (PRD **R3.1 AC3**), and would raise an immediate `23505` on `ledger_entries`/`transactions`, whose code indexes are unconditional. The defect is reuse after **permanent** delete and under concurrency. *(Corrected 2026-09-05, Wave 0 — see **D-050**. This row previously read "shared with Phase 2.11" and blamed the missing `deleted_at` filter; **Task 2.11 shipped no `count(*)` generator at all** — its own correction at Phase 2 says so, and `nextEmployeeCode` is a max-based generator, not a sequence. **BUG-011 stays open until all three sites land.**)* — **DONE 2026-09-05.** Migration `0006_code_sequences` creates **seven** sequences and `setval`s each from `GREATEST(codeStart, max over the table, max over retained bin snapshots)`. All three sites now call one `nextResourceCode`, and **the importer passes its transaction handle**, so route-created and importer-created customers draw from the same `customer_code_seq` and can no longer collide with each other. **No `deleted_at` filter was added** — its absence is what keeps a soft-deleted row's code reserved, and a test asserts the soft-deleted row is still restorable (PRD **R3.1 AC3**). First codes are unchanged (`CUS-10001`, `LN-1001`, …). 13 tests, adversarially validated: reverting to the count-based generator fails three of them, and fixing only the route while leaving the importer on its own count fails two more with a genuine `customers_code_unique` 23505. **BUG-011 CLOSED.** | L |
| ✅ 4.10 | Remove the false **"Record locked for audit after disbursal"** claim on the customer detail page (`customers/[id]/page.tsx:422`). No such lock exists: `PATCH /:id` and `DELETE /:id` contain no loan-status check, so a disbursed customer is fully editable and deletable. Remove the badge or replace it with a statement the backend actually enforces. **Do not invent loan/disbursal locking** — the PRD specifies none. Verify the screen asserts no unsupported lock. *(Added 2026-09-05, Wave 0 — see **D-054**.)* — **DONE 2026-09-05. Removed.** No lock exists — `PATCH /:id` and `DELETE /:id` contain no loan-status check whatsoever, so a disbursed customer was always fully editable and deletable. No locking was invented (**D-054**). The claim survives only as a comment recording why it went. | S |
| ✅ 4.11 | Remove the fabricated **"Draft application"** generator on the customer list page (`customers/page.tsx:107-226`, button `:619-627`). It builds a document from create-dialog defaults, so clicked standalone it emits an applicant named *"Customer"*, `banks[0]`, and a hardcoded ₹45,000 income, in a file describing itself as *"for manual verification and onboarding"*. Remove the control unless the PRD authoritatively specifies a real document. **Do not emit default values as though they were customer facts, and do not build a document-generation backend.** *(Added 2026-09-05, Wave 0 — see **D-055**.)* — **DONE 2026-09-05. Removed.** Generator and button deleted. Nothing replaced it: there is no document-generation backend and building one would be Phase 9/11 scope (**D-055**). A test asserts none of the values it invented — the placeholder applicant, `banks[0]`, the hardcoded income — is emitted anywhere on the page. | S |

### Dependencies
Phase 1 for the code. **Phase 3 in sequence** — D-044 records the chain *3.11 → 3.12 → Phase 3 complete → Phase 4*, and Task 4.1 moves behind both. Both statements are true of different things: Phase 1 is the last *technical* dependency, Phase 3 the last *scheduled* one.

### Tests required
Detail edit persists and survives reload · delete → recycle bin → restore · server-side search/pagination returns different rows on page 2 · duplicate reference rejected · cross-bank assignment rejected · code generation survives a permanent-delete.

**This line is a floor, not the complete contract** — 4.3, 4.4, 4.8, 4.10 and 4.11 have no clause in it. A DataTable regression test proving the ten non-customer consumers keep their client-side behaviour must be written **before** 4.5 touches `data-table.tsx` (**D-051**); there is no test for that component today.

### Definition of Done
- [x] Every customer control persists to the database. — **met 2026-09-05.** Detail edit → `api.update` (`customers/[id]/page.tsx:355`), detail delete → `api.remove` (`:402`), list delete (`page.tsx:343`), list create (`:396`), pre-flight check (`:247`). Every success toast follows an awaited 2xx. The two controls that persist nothing are honest about it: "Export" is a real local CSV, and **"Print" is a fake owned by Phase 11.4** — see the note below.
- [x] Customers beyond the first page are reachable. — **met by 4.5.** Server paging plus the pager rewrite; `slice(0, 6)` is gone and `pageWindow()` pins both ends. Test *"10. page 7 is directly clickable"* (`data-table-server.test.tsx:293`) is the direct evidence.
- [x] The timeline shows real audit data — **to those permitted to see it**, per the scope note and **D-049**. `GET /api/audit-logs` for holders of `audit_logs.view`; an explicit permission state for the three roles that lack it. **The permission was not widened.** No fabricated event can render.
- [x] No fabricated data on any customer screen — **for every fabrication Phase 4 owns.** The timeline (4.3), "queued for verification" (4.4), "Profile updated" (4.1), "Customer archived" (4.2), the audit-lock badge (4.10) and the Draft application (4.11) are all gone, and 4.5's three self-inflicted risks (stat wording, sort affordance, export scope) shipped honest. **One fabrication remains and is owned elsewhere: "Sent to printer" (`customers/[id]/page.tsx:521`), Phase 11.4.**

> ## ✅ PHASE 4 IS COMPLETE — 2026-09-05
>
> All eleven rows are done, including the two (**4.10**, **4.11**) that Wave 0 added because DoD box 4 was only *partially* owned. Verified: backend **732/732** across 27 files (from 687/25), frontend **656/656** across 30 files (from 454/20), both typechecks clean, backend lint clean, frontend lint **85** problems against a baseline of **87** (2 pre-existing errors unchanged; 2 warnings retired), `next build` exit 0.
>
> The customer detail page, which made **zero** write requests when the phase began, now edits and deletes through the API and shows a real audit trail. The list page reaches every customer rather than the first hundred. **BUG-011 is closed** across all three generator sites.
>
> **What this phase did NOT do**, stated plainly so it is not mistaken for finished business:
> - **SEC-007 remains OPEN at P0** — `aadhaarHash` still ships to the client from the unprojected customer reads. Phase **13.4** owns it. Phase 4 edited that file and deliberately left it.
> - **SEC-005 remains OPEN at P0.** Phase 13.
> - **SEC-017 remains OPEN** — customer PII is still written unredacted to `audit_logs.changes`. 4.3 renders field *names* only so it exposes nothing new, but the underlying finding is untouched and its risk profile rose the day 4.1 shipped: an endpoint with zero callers became one operations staff use daily.
> - **BUG-016 / SEC-014 remains OPEN** — the audit-log filter precedence defect. Latent today because both roles holding `audit_logs.view` are unscoped, and 4.3 does not change that.
> - **"Print" is still a fake** on the customer detail page. Phase **11.4**.
> - **`customer.code` is still rendered nowhere** on either customer screen; the raw UUID remains the visible identifier. Unowned, recorded in D-053.
> - **KYC is still frozen** — creation hardcodes `kyc: "Pending"` and no screen exposes a transition. Unowned.

> **Scope note — 2026-09-05 (Wave 0).** Read the four boxes against the *whole* customer surface before ticking them; three carry qualifications that the task rows alone do not make visible.
>
> - **Box 2** is not satisfied by wiring `meta.total` alone. `data-table.tsx:293` renders at most six numbered page buttons (`Array.from({length: totalPages}).slice(0, 6)`), invisible today only because `totalPages` derives from ≤100 client rows. Under real totals, pages 7+ are reachable only by repeated Next clicks. **4.5 owns the pager cap.**
> - **Box 3 is not satisfiable for every role, and must not be made so by widening a permission.** `audit_logs.view` is held only by Super Admin and Admin (`permissions.ts:227`); Manager, Team Leader and Executive hold `customers.view` but not it. Read the box as *"the timeline shows real audit data to those permitted to see it"* — the other three roles get an honest permission-aware state (**D-049**). RULES §5 forbids the alternative.
> - **Box 4 was partially unowned until this note.** Four fabrications belong to rows (timeline → 4.3, "queued for verification" → 4.4, "Profile updated" → 4.1, "Customer archived" → 4.2). Two more had **no owner at all** and are now **4.10** and **4.11**. Three further items are *caused or worsened by 4.5* and are 4.5's to keep honest (**D-051**): the `% of book` stat card, page-scoped sort and KYC filtering presented as table-wide, and the export row-count toast. Two remain owned elsewhere and are **out of scope**: "Print" (Phase **11.4**) and the CSV export mechanism (Phase **11.9**).
>
> This note exists because Phase 3 closed two Definition-of-Done boxes that no row owned until **D-044** created 3.11 and 3.12. A partially-owned box is the more dangerous case: the ticked box reads as done while the unowned residue survives.

---

# PHASE 5 — LOAN / FILE WORKFLOW

**Goal:** make the core lending workflow real. This is the heart of the product.

### Problems being solved
- **Loan approve/reject is fake** (`loans/page.tsx:68`). `PATCH /api/loans/:id` and `POST /api/loans/:id/approve` both exist and are never called. **This is the single most business-critical unreachable operation in the system.**
- The create dialog **never closes**: `setOpen(false)` sets the wrong state variable (`open` vs `createOpen`), so a second click creates a **duplicate loan**.
- **No state machine exists.** Statuses are free-text columns with no CHECK constraints; zod validates the value set on create/patch but never the *transition*; and the approve route accepts **any string** — `{"status":"banana"}` is written and audited as `"approved"`.
- **No cross-stage side effects.** Creating a disbursement does not move the loan to Disbursed. Approving does not notify. Nothing links the stages.
- The **entire verification workflow is backend-only** — `POST /api/loans/:id/verification` and all 5 `/api/verifications` endpoints have zero callers.
- All list stats are computed over the server default `pageSize: 25` and presented as book-wide totals.

### Existing functionality to reuse
`POST /api/loans` is wired and enforces customer↔bank consistency. The factory provides list/get/patch/delete/approve for free. `POST /api/loans/:id/verification` is a complete, permissioned, business-rule-enforcing endpoint waiting for a caller.

### Tasks
| # | Task | Effort |
|---|---|---|
| ✅ 5.1 | Fix the duplicate-submission bug (wrong state variable). — **DONE 2026-09-05.** All four BUG-015 criteria, not just the state variable: `setCreateOpen(false)`, the dead `open` state **deleted**, the form reset, and both footer buttons disabled in flight. Duplicate submission is blocked by a **ref** checked as the first statement of `createLoan`, not by `disabled` — proven load-bearing by mutation: swapping the ref for the `saving` state makes a double-click fire **two** requests while "disabled while in flight" still passes. **BUG-015 CLOSED.** 32 tests. | S |
| ✅ 5.2 | **Define the loan state machine** in `BUSINESS_FLOW.md`, then enforce it: an `allowedTransitions` map in the factory config, validated server-side, plus DB `CHECK` constraints on the status columns. Reject illegal transitions with 422. — **DONE 2026-09-05.** `BUSINESS_FLOW.md` §3.3 ratified **first** per D-010, with the *"Proposed target. None of this exists today."* caveat removed and the four deferred preconditions recorded. Ten legal edges over the seven statuses; `Rejected` and `Closed` terminal; legal initial statuses **{Draft, Submitted}**. Enforced at **create** and **approve**, 422 with `details:[{path:"status"}]`. **PATCH refuses `status` and `amountApproved`** via `notOnThisRoute()` (**D-056**). Migration `0007_loan_status_check` adds a **vocabulary-only** CHECK on `loans.status` alone, `NOT VALID` + a separate `VALIDATE`, **no trigger**. 62 tests, 7 mutations. | L |
| ✅ 5.3 | Constrain the approve route to an enum instead of `z.string().min(1)`. — **DONE 2026-09-05.** `allowedStatuses` added to `ScopedResourceConfig` (opt-in; resources omitting it are byte-identical), wired for loans to the previously **unused** `loanStatuses` const — collapsing two duplicate copies of the vocabulary. `{"status":"banana"}` → **422 `validation_failed`**. | S |
| ✅ 5.4 | Wire approve/reject to `POST /api/loans/:id/approve` with permission gating and optimistic-update rollback. — **DONE 2026-09-05.** The fake `updateStatus` is gone. Approve and Reject both `POST /api/loans/:id/approve`, gated on `can("requests.approve")` — which Team Leader and Executive do not hold. Optimistic update **with rollback**, and on success the **server's returned row replaces the guess** (**D-026**); a test makes the server answer `Disbursed` for an `Approved` request and asserts the UI follows the server. 30 tests. | M |
| ✅ 5.5 | Wire loan edit to `PATCH /api/loans/:id`. — **DONE 2026-09-05.** New `frontend/src/lib/loan-patch.ts` builds a diff-only payload over **exactly seven** fields. `status` and `amountApproved` are absent **by construction** — the type has no index signature, and a `@ts-expect-error` test makes `tsc` fail if it ever widens; 52 generated combinations assert no forbidden key appears. Caught a real defect while testing: `Number("")` is `0`, so a cleared amount box would have PATCHed `amountRequested: 0` onto a live loan. 90 tests. | M |
| ✅ 5.6 | Build the **verification UI** and wire it to `POST /api/loans/:id/verification` and the `/api/verifications` routes. Include service-provider selection (`/api/service-providers` is backend-complete with zero callers). — **DONE 2026-09-05.** Verification panel on the loan detail dialog: reads `GET /verifications?loanId=`, creates through `POST /loans/:id/verification` (**never** the factory `POST /api/verifications`, which has no `beforeWrite` and skips both business rules). **Branches on HTTP status, never message text** — a test sends the *other* 409 sentence and demands byte-identical behaviour, because `verifications_loan_unique` is absent from `CONSTRAINT_MESSAGES`. **No permission widened**: roles without `service_providers.view` get the bank-handled path with copy stating this is a limit on their role, not that no providers exist. Demo layer gained both resources. 56 tests. | L |
| ✅ 5.7 | Implement cross-stage side effects **atomically**: creating a disbursement advances the loan status, inside one transaction with the disbursement insert. *(Corrected 2026-09-05, Wave 0 — see **D-060**. The row previously read "inside the existing transactions" and named `approvedBy`/`approvedAt` as work. **Both premises were wrong.** `approvedBy`/`approvedAt` are **already stamped** on the approve route (`scoped-resource.ts:403`), and there is **no existing transaction to work inside** — `grep .transaction(` returns zero hits in `scoped-resource.ts` and `operations.routes.ts`. 5.7 must therefore **create** the transaction boundary and an `afterWrite`-style factory hook that receives the transaction handle, because `beforeWrite` fires before the insert and cannot see the created row.)* — **DONE 2026-09-05.** `approvedBy`/`approvedAt` were **already shipped** and were not reimplemented (**D-060**). The real work was the boundary that did not exist: a new `afterCreate` hook carrying a `TransactionHandle`, with disbursement insert + loan advancement + audit in **one** `db.transaction`. Named `afterCreate`, not `afterWrite`, because `beforeWrite` fires on create *and* patch. Mutation **M7 removes only the transaction, keeping the hook — exactly the rollback test fails**, proving the boundary is independently load-bearing. | M |
| ✅ 5.8 | Wire server-side pagination/filter on the **primary loans list**. The backend already supports `status`, `loanType`, `priority`, `customerId`, `assignedUserId`, `assignedTeamId`, plus `page`/`pageSize`/`search`/`bankId`. The loans page sends **none** of them — `useResource<Loan>("/loans")` has no query argument at all (`loans/page.tsx:51`). *(Corrected 2026-09-05, Wave 0 — see **D-061**. The row previously said "none are ever sent", which is false: `customerId` **is** sent by the customer-detail contextual list (`customers/[id]/page.tsx:260`) and is pinned by `frontend-contract.test.ts:123`. The premise was wrong; the target — the loans list — is unchanged.)* — **DONE 2026-09-05.** Sends `page`/`pageSize`/`search`/`status`/`loanType`/`bankId` and consumes `meta.total`. **`DataTable` needed no change** — Phase 4's optional prop surface sufficed, so D-051 rule 1 holds and the ten other consumers are untouched. The 25-vs-8 double pagination is gone (`PAGE_SIZE` feeds both the request and the table). Search reworded to *"Search by loan code or application number"* with `searchText` aligned to the same corpus (**D-061**); stat cards now say *"matching these filters"* on the one that uses `meta.total` and *"on this page"* on the rest. 33 tests. | M |
| ✅ 5.9 | Surface `loading`/`error` on **both** loan-primary screens: `/loans` and `/my-work`. *(Widened 2026-09-05, Wave 0. `my-work/page.tsx:56` destructures only `{ data, loading }`, so a failed `/loans` request renders the affirmative business claim "Every file in your book has reached a decision." (`:252-253`) — the Task 2.10 / 4.8 defect one screen over. **`my-work` contains no fake handler**; this is a load-state defect, not a fabricated control.)* — **DONE 2026-09-05.** Three honest states on **both** loan-primary screens. On `/loans` the error branch suppresses the table **and** the stat cards. On `/my-work` `error` is destructured at last: mutating the fix back makes *"Every file in your book has reached a decision."* reappear on a failed load, while a separate test asserts it **still shows when the book is genuinely empty** — the fix distinguishes the two rather than deleting the message. 20 tests. | S |
| ✅ 5.10 | Remove the false **"EMI is calculated on submit using the rate and tenure you enter."** claim on the loan create dialog (`loans/page.tsx:320-322`). `createLoan` never sends `emi` (`:83-94`); the backend defaults it to `0` (`operations.routes.ts:81`); the detail dialog renders `—` forever (`:284`); and **no EMI is computed anywhere in `src`**. Delete the sentence. **Do not build an EMI calculator** — that is new product arithmetic, exactly what D-054 refused for disbursal locking. *(Added 2026-09-05, Wave 0 — see **D-058**.)* — **DONE 2026-09-05. Removed.** No EMI is computed anywhere in `src`; `createLoan` never sent `emi`. No calculator was built (**D-058**). | S |
| ✅ 5.11 | Remove the **no-op Bank selector** from the loan create dialog (`loans/page.tsx:345-356`). The control writes `form.bankId`, but `createLoan` submits `bankId: customer.bankId` (`:87`), so the choice is silently discarded — and `resolvedBankId` defaults to `banks[0]`, usually displaying a *different* bank than the one actually used. Already graded **MISSING** at `INTEGRATION_MAP.md:310`. Show the customer's bank read-only instead. **Do not add a second bank-selection contract and do not alter backend bank scoping.** *(Added 2026-09-05, Wave 0 — see **D-059**.)* — **DONE 2026-09-05. Removed.** The selector wrote `form.bankId` while `createLoan` submitted `customer.bankId`. Replaced with a read-only display of the customer's bank; `createLoan`'s payload is unchanged (**D-059**). | S |

### Dependencies
Phase 4.

### Tests required
Illegal transitions rejected at the API and the DB · approve requires `requests.approve` · approve is audited · verification business rule (a service provider is required when `required` is true) · one-verification-per-loan 409 · double-submit produces one loan · full workflow test: create customer → create loan → verify → approve.

### Definition of Done
- [x] A loan can be created, verified, approved or rejected entirely from the UI, and every transition persists and is audited. — **met 2026-09-05.** Create → `api.create` (5.1); verify → `api.create` on `/loans/:id/verification` (5.6); approve/reject → `api.action` on `/loans/:id/approve` (5.4). **All four success toasts follow an awaited 2xx** — verified by reading each call site. Auditing is server-side and unchanged (`scoped-resource.ts:411-418`).
- [x] Illegal transitions are impossible at both the API and DB layers. — **met 2026-09-05.** API: a ten-edge `allowedTransitions` map enforced at **create** and **approve**, 422 with `details:[{path:"status"}]`; PATCH cannot reach status at all (**D-056**). DB: `loans_status_check`, verified against a **populated** database — see the note below.
- [x] No fake handler remains on any loan screen. — **met 2026-09-05**, under the scope note's reading. `updateStatus` is gone from `loans/page.tsx`; `/my-work` contains **zero** `toast` calls. The **two** disbursement stubs remain **Phase 7.1's and 7.2's**, as recorded. *(Corrected 2026-09-05 Wave 0: this line previously said "three … Phase 7.6's" and was wrong on both counts — see the scope note below.)*

> ## ✅ PHASE 5 IS COMPLETE — 2026-09-05
>
> All eleven rows are done, including the two Wave 0 added. Verified: backend **795/795** across 28 files (from 732/27), frontend **917/917** across 38 files (from 656/30), both typechecks clean, backend lint clean, frontend lint **82** against a baseline of **82** (unchanged; the 2 errors are pre-existing), `next build` exit 0.
>
> **The migration was verified against a populated database**, which the test suite structurally cannot do — `harness.ts:43-45` migrates a fresh empty PGlite instance. A separate harness applied `0000`–`0006`, inserted all seven legal statuses **plus an off-vocabulary `'banana'` row** of the kind the unconstrained approve route could write, and proved: `NOT VALID` **succeeds** on the dirty table; `VALIDATE` **fails with 23514** on the offender; the pre-flight query finds exactly it; `VALIDATE` succeeds after correction; and a later invalid insert is refused with **23514**. **A plain validating `ADD CONSTRAINT` — what drizzle-kit generates by default — would have aborted the migration.**
>
> **Two previously unrecorded privilege bypasses were found and closed**, both during implementation rather than investigation:
> - `PATCH /api/loans/:id` could set `status: "Approved"` on `requests.edit` alone — leaving `approved_by` NULL and auditing as `"updated"` (**D-056**).
> - `POST /api/loans {"status":"Approved"}` returned **201** on `requests.create` alone — a permission held by **Team Leader and Executive**, neither of whom holds `requests.approve`.
>
> **What this phase did NOT do**, stated plainly:
> - **SEC-016 remains OPEN.** Phase 5 delivered partial remediation only — items 3 and 4 span **6.5**, **7.3** and the **13.13** sweep. Two tests deliberately pin that **disbursements still accept any status string**, so the finding cannot be mistaken for closed.
> - **The four deferred guards** — verification precondition, document completeness, four-eyes, and the `amount_approved` disbursement sum — are recorded in `BUSINESS_FLOW.md` §3.3 with reasons (**D-057**). `amount_approved` is still never populated, so 5.4 increments the sanctioned *count* while "Approved value" stays ₹0 (**D-056/D-6**); the stat wording was made honest rather than the column invented.
> - **SEC-005, SEC-007, SEC-017, BUG-016/SEC-014 and BUG-035 all remain OPEN.** BUG-035 is *worsened* in reachability by 5.8 and is cross-referenced, not closed.
> - **`PATCH /api/verifications/:id` is still uncalled** — it needs `verification.edit`, which Team Leader and Executive lack, and no row owns it.

> **Scope note — 2026-09-05 (Wave 0).** Two clauses were ambiguous enough to change what the phase annexes. Both readings are settled here so the boxes cannot be ticked over a different meaning than the one implemented.
>
> - **Box 1 — "created, verified, approved or rejected"** enumerates **four UI operations**, not all seven status edges. The trailing *"every transition persists and is audited"* modifies those four. Owners: create → **5.1**, verified → **5.6**, approved/rejected → **5.4**; auditing is already free from the factory (`scoped-resource.ts:411-418`). `→Disbursed` is **5.7** and happens server-side; `→Closed` is reachable from no screen and is claimed by no row — **out of scope, recorded**.
> - **Box 3 — "any loan screen"** means screens whose **primary resource is a loan** — `/loans` and `/my-work`. Under the wider reading Phase 5 would annex the **two** disbursement stubs — `markCredited` (`disbursement/page.tsx:81-85`) and `retry` (`:87-91`) — owned by **7.1** and **7.2**, and the bank-order stubs owned by **6.1** and **6.2**. It does not. *(`/my-work` contains no fake handler at all; its defect is the load state, owned by 5.9.)*
>
>   **Corrected 2026-09-05, Wave 0.** This note previously read *"the three disbursement stubs (`disbursement/page.tsx:75,84,90`), which Phase 7.6 explicitly owns"*. Every part of that was wrong and was introduced by the Phase 5 close-out, not by the original roadmap:
>   - **Count:** two, not three. `:75` is a `toast.success` **after** an awaited `api.create` at `:63` — `recordDisbursal` is a **real** handler, and a toast following a successful awaited write is not a stub.
>   - **Lines:** `:81` and `:87` are the handlers; `:84` and `:90` were their *toast* lines.
>   - **Owner:** rows **7.1** and **7.2** name these two controls explicitly. **7.6** is *"Link disbursement to loan status"*, which Task **5.7 already delivered** (`operations.routes.ts:387-437`).
>   - The bank-order stubs belong to **6.1** (`moveStage`) and **6.2** (`saveRemark`), not to 6.5, which is the migration row.
> - **Box 2 — "both the API and DB layers"**: the API layer enforces **transition legality**; the DB layer enforces **vocabulary** via a `CHECK` on `loans.status` only. A `CHECK` sees one row and cannot express a transition, and **no trigger is added** (**D-057**). Other status columns belong to **6.5**, **7.3** and the **13.13** sweep.
>
> This note exists because Phase 3 closed two DoD boxes no row owned until **D-044**, and Phase 4's box 4 was only partially owned until Wave 0 added rows 4.10/4.11.

---

# PHASE 6–10 PREREQUISITE

**Added 2026-09-05, Wave 0 — [D-062](DECISIONS.md), [D-079](DECISIONS.md).** One cross-phase factory change that rows **6.1**, **7.3**, **8.8** and **10.3** each independently require. It is not a Phase 6 row: numbering it `6.0` would misassign it.

### Problem being solved
`createScopedResource` makes **CREATE** transactional (`scoped-resource.ts:513`, `afterCreate` `:526`, `recordAudit(tx …)` `:528`) but **PATCH is not** (update `:568`, audit `:578` — two autocommits, no hook) and **APPROVE is not** (audit `:661`). A write can commit while its audit row fails. Four separate rows are blocked on the same absence, and roadmap rows 8.8 and 10.3 both assume a transactional post-write hook that does not exist.

### Tasks
| # | Task | Effort |
|---|---|---|
| F1 | Factory transaction extension. **F1-a:** wrap PATCH and APPROVE in `db.transaction`, moving `recordAudit` inside. **F1-b:** add `afterApprove(before, after, {tx, ctx, req, input})`. **F1-c:** add `transitionColumn?: string` (default `"status"`) plus PATCH-side transition enforcement where configured. | M |

### Dependencies
None. **Must land before 6.1, 7.3, 8.8 and 10.3.**

### Tests required
`afterApprove` throws → status rolls back, no audit row · audit failure → primary write rolls back · a resource configuring neither new field is behaviourally unchanged · `transitionColumn` guards a non-`status` column · the full backend baseline stays green.

### Definition of Done
- [ ] PATCH and APPROVE are atomic with their audit rows.
- [ ] `afterApprove` exists and receives the transaction handle.
- [ ] `transitionColumn` enforces transitions on a configured non-`status` column.
- [ ] No API response shape changes; no resource behaves differently without new configuration.

> **Do NOT** generalise `afterCreate` into `afterWrite`. The factory states the convention at `scoped-resource.ts:227-229`, and generalising would fire disbursements' loan-advance hook (`operations.routes.ts:422-436`) on every PATCH. **Do NOT** add row locks (D-027) or triggers (D-057). Hooks receive `tx` and must never call `getDb()` (D-032).

---

# PHASE 6 — BANK ORDER WORKFLOW

**Goal:** make bank-file processing real.

### Problems being solved
- `bank-orders/page.tsx` imports the API client and **makes zero write requests**. Both actions — stage move and remark — are fake, and `PATCH /api/bank-orders/:id` exists and is never called.
- **No bank order can be created from the UI at all** — `POST /api/bank-orders` has zero callers. Orders can only appear via direct DB insert.
- The Kanban board is derived from fetched rows, so a "moved" card visibly does not move while the toast claims it did.
- SLA dates are sorted as strings.
- **`bank_orders` carries TWO workflow columns** — `stage` and `status` (`operations.routes.ts:317-320`) — and both are unconstrained. *(Recorded Wave 0; see D-063.)*

### Existing functionality to reuse
The full factory CRUD for `/api/bank-orders` — **5 endpoints**: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` — with bank scoping and audit already applied. *(Corrected 2026-09-05 Wave 0 from "6 endpoints": `bankOrdersRouter.permissions` configures no `approve` (`operations.routes.ts:301-306`) and the approve route is conditional on it (`scoped-resource.ts:613`), so **`POST /api/bank-orders/:id/approve` does not exist**. PATCH is the only transition point, which is why 6.1 needs F1-c.)*

### Tasks
| # | Task | Effort |
|---|---|---|
| 6.1 | Wire stage moves to `PATCH /api/bank-orders/:id` with validated **`stage` and `status`** transition maps, using F1-c's `transitionColumn`. *(Scope corrected Wave 0 — D-063.)* | ~~M~~ **L** |
| 6.2 | Wire remarks to `PATCH /api/bank-orders/:id`. **Overwrite the single `remarks` column**; the audit diff is the file trail. UI copy becomes *"Remarks updated"*. *(Resolved Wave 0 — D-064; the "consider append-only" option is declined, with reasons.)* | ~~M~~ **S** |
| 6.3 | ✅ **DONE 2026-09-06.** Bank-order creation wired to `POST /api/bank-orders`, linked to a loan. **No bank selector** — `beforeWrite` calls `assertSameBank` on both the loan and the customer, so a free choice could only ever produce a refusal (D-059). Loans that already have an order are excluded from the picker. Evidence: `fake-controls.test.tsx` 21–26. | M |
| 6.4 | ✅ **DONE 2026-09-06.** Submitting a loan opens its bank order **inside the loan's own transaction**, from both doors into `Submitted` (create and the approve route). Migration `0013` adds a partial unique index as the concurrency backstop the service check structurally cannot be — D-027 forbids a lock, not a constraint. `nextResourceCode` receives `tx` (D-032). Evidence: `loan-bank-order-link.test.ts`, 13 cases. The §3.3 cross-record preconditions remain **deferred with reasons**. | M |
| 6.5 | Add **`stage` and `status`** enums + DB CHECK constraints (same pattern as Phase 5.2; `NOT VALID` then `VALIDATE`). *(Scope corrected Wave 0 — D-063.)* | ~~S~~ **M** |
| 6.6 | Fix SLA sorting, surface `loading`/`error`, load the board at `pageSize: 500`, and **relabel statistics to the scope they actually measure**. *(Absorbs the honest-stats work — D-065; row 6.7 was proposed and withdrawn.)* | S |

### Dependencies
Phase 5, **and the F1 prerequisite** — 6.1 enforces transitions on PATCH via `transitionColumn`, which F1-c introduces.

### Tests required
Stage transition persists and is audited · illegal stage rejected · **status transition persists; illegal status rejected** · remark persists and the audit diff records before/after · bank-scope isolation on every bank-order route · **both CHECK constraints reject off-vocabulary values** · board honesty above 500 rows.

### Definition of Done
- [x] Bank orders can be created, advanced and annotated from the UI, and every change persists and is audited. — **met 2026-09-06.** *Created:* `fake-controls.test.tsx` case 21 (the UI posts to `POST /api/bank-orders`) and `loan-bank-order-link.test.ts` case 1 (submitting a loan opens one automatically). *Advanced:* case 16 (`Z`) proves a refused stage move claims nothing; `factory-transaction.test.ts` group D proves the transition map is enforced on PATCH. *Annotated:* cases 1–3. *Persists and is audited:* `loan-bank-order-link.test.ts` case 5, and `factory-transaction.test.ts` group A proves the write and its audit row are atomic.

> **Scope note added 2026-09-05, Wave 0 ([D-065](DECISIONS.md)).** *"From the UI"* requires that a card be **reachable**, so the board loads at `pageSize: 500` and states plainly when `meta.total` exceeds it. It does **not** require whole-bank aggregates: no DoD clause asks for them, and building an aggregate endpoint would pull Phase 11 reporting forward (D-043). What the box does require is that the page not **claim** figures it has not measured — so StatCard copy names its scope. **Server pagination and `sortBy` are Phase 11**, because D-051 constraint 5 (*"sorting must not lie"*) would otherwise force hiding sort affordances on a board whose SLA ordering is the point.

---

# PHASE 7 — DISBURSEMENT

**Goal:** make disbursement status real. **This phase handles money movement — treat every defect here as high severity.**

### Problems being solved
- **"Mark credited" is fake** (`disbursement/page.tsx:81`). The toast asserts *"UTR confirmed in bank statement"* — a claim about a real financial event — and writes nothing.
- **"Re-initiate" is fake** (`:87`). The toast claims *"Transfer resubmitted with corrected beneficiary."* Nothing is resubmitted.
- The create form's defaults are seeded from `useState` initialisers that read async data, so `loanId` is permanently `""` and `amount` permanently `"0"` until the user manually picks.
- `₹NaN` renders on an empty database (division by `rows.length` with no zero guard).
- The approve route accepts any status string, so `{"status":"Credited "}` (trailing space) creates an **off-books disbursement invisible to every reconciliation query** while the UI shows it approved.
- Money crosses the wire as a float in the dashboard aggregates and is a JS double in every frontend read.

### Existing functionality to reuse
`POST /api/disbursements` is wired and works. `PATCH` and `POST /:id/approve` exist with correct permissions and audit.

### Tasks
| # | Task | Effort |
|---|---|---|
| 7.1 | Wire "mark credited" to **`POST /api/disbursements/:id/approve`** with a status enum and permission gating. *(Corrected Wave 0 — **D-066**. This row previously said `PATCH /api/disbursements/:id`; wiring status through PATCH reopens the privilege bypass D-056 closed, because Manager holds `disbursements.edit` but not `.approve` (`lib/permissions.ts:251`). Non-authoritative fields such as `credited_to` and `disbursed_on` remain ordinary PATCH fields.)* | M |
| 7.2 | Wire "re-initiate" to a real operation, or remove the control. It must not claim a transfer occurred. **Ratified: re-initiate CREATES a new disbursement** with a new UTR at `In Transit`; the Failed row is immutable and is never re-used ([BUSINESS_FLOW.md](BUSINESS_FLOW.md) §3.3). | M |
| 7.3 | Add the disbursement state machine + DB CHECK constraints. Constrain the approve route to an enum. **Also closes the create/PATCH privilege holes**: `initialStatuses: ["In Transit"]` and `patchRefusals` on `status`. **Absorbs 7.6 as a verification checkpoint.** *(Absorbs proposed row 7.8, withdrawn — D-066, D-079.)* | M |
| 7.4 | Fix the create-form defaults (seed from an effect, not a `useState` initialiser). | S |
| 7.5 | Fix the `₹NaN` stat and surface `loading`/`error`. Harden `formatCurrency`/`formatNumber`/`formatPercent` with `Number.isFinite` — the root cause, not the one call site. | S |
| 7.6 | ~~Link disbursement to loan status (see Phase 5.7).~~ ✅ **ALREADY DELIVERED by Task 5.7** — `operations.routes.ts:387-437` advances the loan to `Disbursed` inside the create transaction, refuses an illegal edge via `loanTransitions` (`:409`) and audits at `:428`. **MERGED into 7.3 as a verification-only checkpoint; do not rebuild.** *(Wave 0 — D-079.)* | ~~S~~ **0** |
| 7.7 | Audit money handling end to end: keep `numeric` in the DB and **stop casting to `::float` in the dashboard aggregates** (5 sites: `operations.routes.ts:705,707,709,769,770`). **Frontend decimal/paise representation is deferred to Phase 11.** *(Scope corrected Wave 0 — **D-068**.)* | ~~L~~ **S** |

### Dependencies
Phase 5, **and the F1 prerequisite**.

### Tests required
Status change persists and is audited · illegal status rejected · duplicate UTR still 409s · **a second `utr: null` row is accepted and neither may reach `Credited`** · **`POST {"status":"Credited"}` is 422** · **`PATCH {"status": …}` is 422** · **Manager cannot approve** · permission gating · no floating-point drift across create → read → aggregate.

### Definition of Done
- [x] Every disbursement status change persists, is permission-gated and is audited. — **met 2026-09-06.** `disbursement-state-machine.test.ts` group C: create refuses `Credited` (case 9), PATCH refuses `status` (case 11), **Manager cannot reach Credited by any of the three routes** (case 13). `fake-controls.test.tsx` case 4 pins that the UI calls **approve**, not PATCH.
- [x] No control claims a financial event that did not occur. — **met 2026-09-06.** `fake-controls.test.tsx` case 5 (the "confirmed in bank statement" claim is gone) and case 17 (a refused credit reports nothing). "Re-initiate" now creates a new disbursement rather than claiming a resubmission — `disbursement-state-machine.test.ts` case 7 proves the Failed row is immutable.
- [x] Money is exact from input to aggregate. — **met 2026-09-06 under the scope note below.** The five `::float` casts are gone and `numeric` sums are exact.

> **Scope note ([D-068](DECISIONS.md)).** Box 3 is met **from input through the server aggregate**. Frontend decimal representation is **Phase 11** (11.7, 11.8) — this box must not be read as covering it.

> **Scope note added 2026-09-05, Wave 0 ([D-068](DECISIONS.md)).** Box 3 is met **from input through the server aggregate**: the five `::float` casts are removed, `numeric` aggregation stays exact, and the display formatters reject non-finite values. **Frontend decimal representation is Phase 11**, which owns the rows that actually perform frontend money arithmetic (11.7 running balance, 11.8 decimal input). Adopting a decimal library here would need a superseding decision under **D-006** and is not taken. **This box must not be marked met without this note.**
>
> **Scope note ([D-067](DECISIONS.md)).** *"Duplicate UTR still 409s"* covers real UTRs only. A **NULL UTR is a valid in-flight state** and multiple NULL rows are correct — `disbursements_utr_unique` (`drizzle/0000_init.sql:314`) is already partial and is **not changed**. The rule *"→Credited requires a non-null UTR"* is temporal and lives in 7.3's transition guard.

---

# PHASE 8 — TRANSACTIONS AND SETTLEMENTS

**Goal:** make the financial reconciliation layer real.

### Problems being solved
- **Transactions:** `settle` is fake (`transactions/page.tsx:36`). A financial-ledger row is declared "settled" purely in component state. Nothing in the UI can create a transaction; nothing in the backend auto-creates one either.
- **Settlements:** "Mark paid" and "Raise dispute" are both fake. The dispute toast claims *"Query sent to SPOC"* with **no messaging path anywhere in the repo**. The period filter is hardcoded to two 2024 strings.
- Neither `transactions` nor `settlements` has a `DELETE` route (the factory omits it when no delete permission is configured), so a mistaken financial record cannot be removed through the API at all.
- All settlement stats are computed over the 25-row default page.

### Existing functionality to reuse
Both resources have full factory CRUD with scoping and audit. Settlements have a real arithmetic invariant in `beforeWrite` (`gross − tds = net`, tolerance 0.01).

### Tasks
| # | Task | Effort |
|---|---|---|
| 8.1 | Wire transaction status to `PATCH /api/transactions/:id` with an enum, `initialStatuses: ["Pending"]` and a transition guard. Transactions have **no approve route and no `transactions.approve` key** (`lib/permissions.ts:94-97`), so PATCH is the only status writer and carries the guard directly via F1-c. | M |
| 8.2 | ✅ **DONE 2026-09-06.** Transaction creation wired to `POST /api/transactions`, bank derived from the loan (D-059). **The form has no status field**: `initialStatuses` admits only `Pending`, and the reason is a privilege boundary — Manager holds `transactions.create` and NOT `.edit`, so a form that could post `Success` would mint an already-final record. Evidence: `fake-controls.test.tsx` 27–32, especially 28 (`status` is never sent). | M |
| 8.3 | Wire settlement "mark paid" to **`POST /api/settlements/:id/approve`**, constrain the approve route to an enum, and refuse `status` on PATCH. `→Paid` re-runs the `net_payable = gross − tds` invariant. *(Corrected Wave 0 — **D-066**. This row previously said `PATCH /api/settlements/:id`. The approve route currently accepts `z.string().min(1)` and persists any string (`scoped-resource.ts:369`). Absorbs proposed row 8.9, withdrawn — D-079.)* | M |
| 8.4 | Implement dispute properly — a real status change plus a recorded reason — or remove the control. It must not claim a message was sent. **D-040:** *"Query sent to SPOC"* is the literal banned form and there is no messaging path in the repo. | M |
| 8.5 | Generate the period filter from data instead of hardcoding 2024. | S |
| 8.6 | Tighten the settlement arithmetic check: it is skipped entirely when `netPayable` is omitted on a PATCH. `settlementsRouter.beforeWrite` takes only `input` (`operations.routes.ts:467`) and must take `{ existing }` to merge. | S |
| 8.7 | ~~Decide and document whether financial records should be correctable at all; if yes, add a soft-delete/void path with elevated permission.~~ ✅ **RESOLVED Wave 0 — [D-069](DECISIONS.md): terminal financial states are immutable; corrections are compensating `Refund` entries.** Answered from [BUSINESS_FLOW.md](BUSINESS_FLOW.md) §3.3, which already states it. **This row now builds nothing** — it records the decision and adds tests proving a terminal transaction or settlement cannot be modified through ordinary routes. | ~~M~~ **S** |
| 8.8 | Implement the cross-stage links: approving a settlement creates a transaction; a transaction creates a ledger entry. **Uses F1-b's `afterApprove`** — see the premise correction below. Add two **partial** unique indexes for idempotency. Set `bank_id` from the settlement. | L |

### Dependencies
Phase 7, **and the F1 prerequisite** — 8.8 needs `afterApprove`; 8.1 needs `transitionColumn`.

### Tests required
Status changes persist and are audited · **`POST {"status":"Paid"}` and `POST {"status":"Success"}` are both 422** · **`PATCH {"status": …}` is 422 on both resources** · approve enum rejects an unknown string · terminal records cannot be modified · arithmetic invariant enforced on both create and patch, **including a PATCH that omits `netPayable`** · settlement → transaction → ledger chain · **a second approve produces exactly one chain** · **`bank_id` propagates from the settlement** · partial rollback leaves nothing behind · bank-scope isolation.

### Definition of Done
- [x] Transaction and settlement state changes persist and are audited. — **met 2026-09-06.** `settlement-chain.test.ts` groups A and B: approve refuses an arbitrary string (case 1), create refuses `Paid`/`Disputed` (case 2), PATCH refuses `status` (case 4), Manager cannot approve (case 6). Group C proves both terminal states are immutable (D-069). UI wiring pinned by `fake-controls.test.tsx` cases 7, 8, 10.
- [x] No control claims an external communication that does not occur. — **met 2026-09-06.** `fake-controls.test.tsx` case 9 asserts the words *"sent to"* and *"SPOC"* appear nowhere: the dispute is a real, audited status change and there is still no messaging path in the repository.
- [x] The settlement → transaction → ledger chain is real. — **met 2026-09-06.** `settlement-chain.test.ts` group D: one settlement → one Commission transaction → one ledger entry, `bank_id` inherited, all three writes and all three audit rows in **one** transaction (case 20), and a refused approval posts nothing (case 22). Group E proves idempotency — a second chain is refused by migration `0010`'s partial unique indexes, which is a **different** guarantee from atomicity.

> **Premise correction, 2026-09-05 Wave 0 ([D-070](DECISIONS.md)).** Row 8.8 was written assuming the chain could be built *"inside existing transactions"*. **It cannot.** `afterCreate` fires on **create only** (`scoped-resource.ts:227`) and the approve route audits on the base handle (`:661`), so approve has neither a hook nor a transaction. 8.8 depends on **F1-b**.
>
> **OPEN-7 does NOT block 8.8.** Bank ownership flows settlement → transaction → ledger: `settlements.bank_id` is NOT NULL (proved by `settlements_bank_period_unique`, `drizzle/0000_init.sql:343`), `transactions.createSchema.bankId` is required (`operations.routes.ts:494`), and 8.8 passes the bank explicitly. **Every 8.8-generated row carries a non-null `bank_id`.** `ledger_entries.bank_id` stays nullable for hand-created global entries — which is what OPEN-7 is about. **It remains with Phase 11.6. No migration, no backfill, no NOT NULL change in Phase 8.**
>
> **Idempotency is not atomicity.** Atomicity prevents a partial chain; it does not prevent a second one. Two **partial** unique indexes do — on `transactions (settlement_id)` and `ledger_entries (transaction_id)`. Partial is essential: most rows carry NULL there, and an unconditional index would permit exactly one NULL row each. **This is D-027-compliant — D-027 forbids row locks, not constraints.** Confirm the predicates against the real schema (specifically whether `ledger_entries` carries `deleted_at`) and pre-flight for duplicates before writing the migration.
>
> **Ledger `balance` stays `0`** — Phase **11.7** owns the running balance — and **`commission` stays `0`** (**D-058**).

---

# PHASE 9 — DOCUMENT STORAGE

**Goal:** implement real file storage. Today there is none.

> **For a KYC-driven lending business this is disqualifying on its own.** A DSA cannot evidence KYC completion to a partner bank from this system, because the system cannot hold the document that proves it.

### Problems being solved
- **File bytes are discarded in the browser.** `documents/page.tsx:81-89` posts JSON metadata; the `File` is never attached. `api.upload()` (multipart) exists in the API layer and is not used here.
- **There is no document upload endpoint.** `multer` appears in exactly one file — the Excel importer.
- `documents.storage_key` is in the schema, is commented *"Object-store key"*, and **nothing ever writes it**. Every row is a dangling pointer.
- Preview and Download are toasts. Verify and Delete are fake.
- `uploaded_by`/`verified_by` are never written, so the "By" column is always `—`.
- The upload silently attaches to `customers[0]` when no customer is selected — **documents can be filed against the wrong borrower**.

### Existing functionality to reuse
The `documents` table and its full factory CRUD, with bank scoping and audit. `api.upload()` in the frontend API layer. The Excel importer is the working reference for multipart handling.

### Tasks
| # | Task | Effort |
|---|---|---|
| 9.1 | **Choose a storage provider and record it in [DECISIONS.md](DECISIONS.md).** Consider data-residency requirements for Indian KYC documents. ⚠️ **Wave 0: engineering default recorded — AWS S3 `ap-south-1`, private, SSE ([D-071](DECISIONS.md)). OWNER RATIFICATION OUTSTANDING.** | S |
| 9.2 | Add config keys and validate them in `env.ts`, following **D-034** (optional in schema, required in the production block, provider allowlist of one). **Add `MAX_DOCUMENT_MB` — do NOT reuse `MAX_UPLOAD_MB`, which is SEC-008's zip-bomb budget** ([D-072](DECISIONS.md)). | S |
| 9.3 | Build `src/services/storage.ts`: put/get/delete/signed-URL behind a provider-agnostic interface. Local filesystem adapter for dev/test. | M |
| 9.4 | Add `POST /api/documents/upload` (multipart): validate size, extension **and magic bytes** (not client-declared MIME), compute a checksum, store the object, write the row with a real `storage_key`, set `uploaded_by`. **Stream — do not use `memoryStorage`. REMOVE client-supplied `storageKey` AND `checksum` from `createSchema`** (`operations.routes.ts:556`, `:557` — SEC-024). **Map multer errors to `AppError` at the multer boundary** (D-021), never in `error-handler.ts` — copying the importer's bare-`Error` filter produces a 500 and fails this row's own test. ⚠️ **Concrete adapter pauses on OPEN-2.** | L |
| 9.5 | Add `GET /api/documents/:id/content` — authorization-checked, short-lived signed URL or streamed. **Never a public bucket URL.** Set `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` — **this row creates a stored-content surface that does not exist today**, and 13.5 (origin headers) lands later. | M |
| 9.6 | Wire real upload, download and preview in the UI, with progress (the existing `progress` state is dead code — `setProgress` is never called). **Also fix the two demo defects**: the dispatcher discards the third path segment (`lib/demo/api.ts:222-223`), so `GET /documents/:id/content` returns **200 with the metadata row** (a forged success) and `POST /documents/upload` is refused citing `documents.delete` (`:706`) though the demo user holds `documents.upload`. Demo must refuse content honestly — it stores no bytes. | M |
| 9.7 | Wire verify/reject to `PATCH /api/documents/:id` and delete to `DELETE /api/documents/:id`, setting `verified_by`. **Add the `documents.verify` permission and move `permissions.edit` onto it** — today `edit` maps to `documents.upload` (`operations.routes.ts:543`), so **this row as originally written ships KYC self-verification** ([D-074](DECISIONS.md)). | M |
| 9.8 | Delete the object when the row is purged from the recycle bin. **Object first, row second, idempotent, inside the purge transaction. The customer and loan purge paths must enumerate document objects explicitly** — `documents.customerId`/`loanId` cascade, so a customer purge destroys rows without passing through `softDelete` ([D-075](DECISIONS.md)). | ~~S~~ **M** |
| 9.9 | Fix the wrong-customer default and disable the upload button while a request is in flight (currently double-submittable). The `customers[0]` fallback (`documents/page.tsx:75`) files KYC against the **wrong borrower** with a toast naming the wrong person. | S |
| 9.10 | ~~Add virus scanning, or record accepting the risk in `DECISIONS.md`.~~ ✅ **RESOLVED Wave 0 — [D-073](DECISIONS.md): residual risk explicitly accepted; no antivirus subsystem in Phase 9.** Size, extension allowlist, magic bytes, streaming, SHA-256, private storage and safe headers are still all enforced. **Nothing may claim files are scanned.** Revisit in Phase 13. | ~~M~~ **S** |
| **9.11** | **NEW (Wave 0 — [D-076](DECISIONS.md)).** Implement the KYC pack: a **`required_document_types`** reference table, a **per-customer completeness view**, and a **manifest** of Verified documents (type, filename, upload date, verifier, checksum), each document retrievable through 9.5. **Not a PDF, not a ZIP, no new dependency.** ⚠️ **OWNER DECISION REQUIRED** — the phrase *"KYC pack"* occurs exactly once in the repository, in this phase's own DoD. **This row owns Phase 9 DoD box 3.** | L |

### Dependencies
Phase 4.

### Tests required
Upload → row with `storage_key` → download returns the same bytes · unauthorized download blocked · cross-bank download blocked · oversize/wrong-type rejected with **4xx, not 500** · magic-byte mismatch rejected · purge removes the object.

### Definition of Done
- [x] A document uploaded through the UI is stored, retrievable, and access-controlled. — **met 2026-09-06.** `document-storage.test.ts` case 1 (a real file round-trips and the row carries a `storage_key`), case 11 (the owner gets the exact bytes with `attachment` + `nosniff`), case 12 (unauthenticated gets nothing), case 14 (a legacy traversal key is refused at the dereference point). ⚠️ **Verified against the LOCAL adapter** — see the S3 note below.
- [x] No document control simulates an action. — **met 2026-09-06.** `fake-controls.test.tsx` cases 11–15: verify, reject and delete all issue real requests, and a row with no stored file offers no download. The two demo defects are fixed — the content route refuses honestly instead of returning 200 with metadata.
- [x] A KYC pack can be assembled and produced from the system. — **met 2026-09-06.** `kyc-pack.test.ts`, 11 cases. ⚠️ Under **[D-076](DECISIONS.md)**'s definition — required types, completeness, and a manifest of Verified documents. **Not a PDF and not a ZIP.** Case 8 is the one that matters: an unconfigured system reports `complete: false`, never a false assurance.

> ⚠️ **S3 is UNVERIFIED against a live bucket.** `@aws-sdk/client-s3` is not a dependency and this block may not add one, so requests are signed with hand-written SigV4 over `node:crypto`. The algorithm is unit-tested (`storage-service.test.ts`); there is no bucket, no credentials and no network in this environment, and dev/test run the local filesystem adapter. **Box 1 is met for the storage interface and its local implementation. The S3 path's first real exercise will be the first deployment.**

> **Ownership note added 2026-09-05, Wave 0 ([D-076](DECISIONS.md)).** Box 3 previously had **no owning task**. The phrase *"KYC pack"* occurs **exactly once in the entire repository — this line** — with no PRD requirement, no business-flow definition and no data model behind it. Row **9.11** now owns it, under engineering's minimum reading: required document types, per-customer completeness, and a manifest of Verified documents. **This is an owner-gated definition.** If the owner declines to define it, the honest close-out is to **reword this box, not to mark it met**.
>
> **Box 2 note:** a **Reject** control does not exist in the UI today — 9.7 must **build** it, not wire it.

---

# PHASE 10 — NOTIFICATIONS

**Goal:** make notifications real end to end. Currently all three layers are broken independently.

### Problems being solved
- **No producer.** `grep insert(notifications)` across the backend returns **zero**. The table can never contain a row in production.
- **The page never displays what it fetches.** `notifications/page.tsx:74` is `useState(rows)` with no syncing effect — even with 100 rows returned it shows "Nothing to read here". Meanwhile `topbar.tsx:71` reads `data` directly, so **the bell badge works and the page it links to is blank**.
- **Read state never persists.** `POST /api/notifications/read-all` and `POST /api/notifications/:id/read` both exist and have zero callers.
- The "Team activity" panel is a hardcoded empty array.
- `GET /api/notifications` returns `meta.total = rows.length` capped at 100 — not a real total.

### Existing functionality to reuse
The `notifications` table (with `severity`, `read`, `read_at`, `link_href`) and all three routes, correctly scoped to `ctx.userId`.

### Tasks
| # | Task | Effort |
|---|---|---|
| 10.1 | Fix the page state bug — **render `rows` directly**. *(Wave 0: "or sync via effect" is not available — `react-hooks/set-state-in-effect` is a lint **error** in this repo.)* | S |
| 10.2 | Wire mark-read and mark-all-read to the existing endpoints. **Remove the "Mark unread" control** (`notifications/page.tsx:63`) — no unread endpoint exists on the real or demo API, and building one to justify a button is the annexation D-043 forbids ([D-078](DECISIONS.md)). | S |
| 10.3 | Build `src/services/notifications.ts` and emit from real events: loan approved/rejected, verification completed, disbursement credited, settlement raised/paid, document verified/rejected, record assigned to you, import completed, SLA breach. **Extend the schema first** — `record_type`, `record_id`, `event_type`, `event_key`, `user_id` NOT NULL, plus a partial unique index ([D-077](DECISIONS.md)). **Emit only for events whose sources exist**; each later row wires its own. | L |
| 10.4 | Populate `link_href` so a notification navigates to its record. Absent rather than dead. | S |
| 10.5 | Add pagination and a real `meta.total`. | S |
| 10.6 | Replace the "Team activity" placeholder with real audit-log data, or remove the panel. **Render it only for holders of `audit_logs.view` (Super Admin, Admin); omit it entirely for the other three roles. Do NOT widen `audit_logs.view`** (D-049, [D-078](DECISIONS.md)). | M |
| 10.7 | ~~Add email notifications…~~ ⏸️ **DEFERRED to Phase 12.6** (Wave 0 — D-079). The row's own text says it *"needs the Phase 12 settings persistence"*, which does not exist. **Not in the 6–10 block.** | M |
| 10.8 | ~~Add the SLA-breach scheduled job…~~ ⏸️ **DEFERRED to Phase 15.9** (Wave 0 — D-079). The row's own text says it *"needs Phase 15 infrastructure"*; there is no scheduler in this system. **Carries the undefined SLA-recipient decision with it** — recommended rule when built: the assigned user plus their team leader where `teamId` resolves one. | M |
| **10.9** | **NEW (Wave 0 — [D-078](DECISIONS.md)).** Make the bell badge and the notifications page agree, via a `NotificationsProvider` React context in the app shell — the existing house pattern (`use-auth.tsx`, `use-reference.tsx`). **No new library (D-006). This row owns Phase 10 DoD box 3.** | S |

### Dependencies
Phases 5–8 (the events to notify about must exist first), Phase 3 for email.

### Tests required
Each producing event writes exactly one notification row · notifications are user-scoped · read state persists across reload · the page renders returned rows.

### Definition of Done
- [x] Real events generate notifications. — **met 2026-09-06.** `notification-events.test.ts` case 1: approving a loan writes a row, from a table that had **zero** producers. Group B proves emission is inside the caller's transaction — a refused approval leaves no alert claiming it happened (cases 7, 8). Group C proves idempotency: a retry cannot duplicate (case 10) while the same event for a different recipient still fans out (case 11).
- [x] The page displays them and read state persists. — **met 2026-09-06.** The page renders the canonical array rather than a stale `useState(rows)` copy, and mark-read calls the real endpoint through the shared provider with rollback on refusal.
- [x] The bell badge and the page agree. — **met 2026-09-06.** `use-notifications.tsx` is the single source both consumers read; `topbar.tsx` no longer runs its own fetch. `topbar.navigation.test.tsx` mounts the provider, which is what makes the badge's count and the page's list the same number by construction rather than by coincidence.

> **Premise correction and ownership note, 2026-09-05 Wave 0 ([D-077](DECISIONS.md), [D-078](DECISIONS.md)).**
>
> **10.3's "inside existing transactions" is false for most of its events.** Only *import completed* and *settlement raised* sit on an already-transactional path; the status-change events run through PATCH or approve, neither of which was transactional before **F1**.
>
> **The event list is 9 comma-separated items but 11 distinct events** — three items carry a slash. Three exist today (loan approved, loan rejected, import completed); the rest arrive with their owning rows in Phases 7–9. **SLA breach is deferred with 10.8.**
>
> **Box 3 previously had no owning task.** The badge (`topbar.tsx:72`) and the page (`notifications/page.tsx:72`) each run an independent `useResource`, so 10.1 and 10.2 could both pass with the box still failing. Row **10.9** now owns it.
>
> **`notifications.user_id` is nullable** (`db/schema/operations.ts:436`) while the route scopes on `ctx.userId` — a null-recipient row is invisible to everyone, permanently. 10.3's migration makes it NOT NULL.

---

# PHASE 11 — REPORTS AND LEDGER

**Goal:** make reporting and the ledger correct and trustworthy.

### Problems being solved — Reports
- **The page renders empty on load** — `loans` is omitted from the `useMemo` dependency array with an explicit eslint suppression.
- The default date range is hardcoded to **2024-01-05 → 2024-05-31**; the current year is excluded entirely.
- The `to` boundary is compared as a string against an ISO timestamp, so **the entire final day is always excluded**.
- **"Excel" is an HTML table** saved as `.xls`. **"PDF" is `window.print()`**, followed by a toast claiming "PDF ready".
- The trend chart is fed a hardcoded empty array; there is no trend endpoint.
- Everything is computed client-side from a capped `/loans` fetch — there is no reporting endpoint.

### Problems being solved — Ledger
- **`POST /api/ledger` succeeds only for Super Admin and Admin.** Two independent defects: (a) Manager/Team Leader/Executive **do not hold `ledger.create`** and are rejected at `requirePermission`; (b) the UI never sends `bankId` and the factory asserts it unconditionally, so any bank-scoped holder of the permission would also 403. **Fix both.**
- Entries created by unscoped users land with `bank_id = NULL`, and `bankScope` uses `inArray`, which **never matches NULL** — so **every ledger entry created through this UI is permanently invisible to every scoped user**.
- **`balance` is always 0.** The schema comment claims it "is recomputed inside the same transaction"; no such recomputation exists. The "Closing balance" tile is permanently ₹0.00 while the dialog says it updates immediately.
- The amount input strips all non-digits, so **paise cannot be entered**.

### Existing functionality to reuse
`/api/dashboard/stats`, `/loan-status` and `/bank-performance` are real bank-scoped SQL aggregates. `exceljs` is already a backend dependency (used for import) and can generate real workbooks.

### Tasks
| # | Task | Effort |
|---|---|---|
| 11.1 | Fix the stale `useMemo` and remove the eslint suppression. | S |
| 11.2 | Default the date range to a sensible relative window; fix the boundary comparison to use dates, not strings. | S |
| 11.3 | Build real reporting endpoints that aggregate in SQL rather than over a capped client fetch. | L |
| 11.4 | Generate **real** `.xlsx` server-side with `exceljs`, and a **real** PDF, or rename the controls honestly. | L |
| 11.5 | Add a trend endpoint and wire the chart, or remove the chart. | M |
| 11.6 | **Fix ledger access**: (a) decide which roles should hold `ledger.create` and grant it; (b) send `bankId` from the UI; (c) decide whether bank-less entries are legitimate — if so `bankScope` must include NULL for authorised users, if not make the column `NOT NULL`. | M |
| 11.7 | **Implement the running balance** in the same transaction as the insert, as the schema comment already promises. | M |
| 11.8 | Allow decimals in the amount input. | S |
| 11.9 | Fix exports repo-wide: they currently ship only the 25-row server page while the toast reports that count as the total. Either fetch all pages or export server-side. Add CSV-injection guarding for cells beginning `=`, `+`, `-`, `@`. | M |

### Dependencies
Phases 5–8 (real data must exist to report on).

### Tests required
Report returns correct rows for a known dataset · date boundaries inclusive · exports open in Excel and contain **all** matching rows · ledger post succeeds for a scoped user · balance is correct after N entries · scoped users see their entries.

### Definition of Done
- [ ] Reports show correct data on load with correct dates.
- [ ] Exports are real files containing the full result set.
- [ ] Ledger works for every role and balances are correct.

---

# PHASE 12 — ROLES / TEAMS / PERMISSIONS / ADMIN UI

**Goal:** build the five missing administrative screens. Every backend for these is already complete.

### Problems being solved
- **Roles:** full CRUD + permission assignment exist with correct escalation guards. **Zero frontend callers. No page.**
- **Teams:** create/members/delete exist. **Zero callers. No page.** And there is **no `PATCH /api/teams/:id` at all** — `teams.edit` is a permission granted to admin and manager that **no route consumes**, so a team's name, description or leader can never be changed after creation.
- **Permissions:** `GET /api/roles/permissions` returns the full catalogue. Zero callers. At HEAD the Employees page showed a **fake** permissions panel with six hardcoded labels that do not match the real catalogue.
- **Audit logs:** the endpoint exists, is bank-scoped, and has **zero frontend references — there is no audit viewer**. Its filters are also silently dropped by a SQL operator-precedence bug.
- **Settings:** the `app_settings` table exists and is **completely dead** — zero references outside the schema file. This is the root cause of the Settings page being UI-only.
- `roles.is_active` gates login (`loadAuthContext` hard-fails on it) but **no route can toggle it**.

### Existing functionality to reuse
Everything. This phase is almost purely frontend plus two small backend additions.

### Tasks
| # | Task | Effort |
|---|---|---|
| 12.1 | Build the **Roles** page: list, create, edit, delete, and a permission matrix wired to `PUT /api/roles/:id/permissions`. Respect `assertCanGrantPermissions` in the UI as well as the API. | L |
| 12.2 | Build the **Teams** page: list, create, member management, delete. | M |
| 12.3 | Add the missing `PATCH /api/teams/:id` and wire it. | S |
| 12.4 | Build the **Audit Log** viewer with filters, pagination and a real `meta.total` (currently absent from the response). | M |
| 12.5 | Fix the audit-log filter precedence bug (an unparenthesised `or` inside `and()`). | S |
| 12.6 | **Wire the Settings page to `app_settings`**: add routes, then connect the company profile, invoice numbering and notification preferences. Remove every control that cannot be backed. | L |
| 12.7 | **Remove the fake 2FA switch** — it reports "2FA enabled" for a feature that exists in no layer. Either implement TOTP or delete the control. On a banking application a false security assurance is worse than a missing feature. | M |
| 12.8 | Replace the mock active-sessions table (three hardcoded 2024 literals) with real data from `refresh_tokens`, and wire real per-session revocation. | M |
| 12.9 | Add a `roles.is_active` toggle route and UI. | S |
| 12.10 | Add permission-based nav gating — `frontend/src/lib/nav.ts` currently carries **no permission field at all**, so every role sees every nav item. | M |

### Dependencies
Phase 2.

### Tests required
Role CRUD respects escalation guards · a user cannot grant a permission they lack · system role protected (DB trigger) · team CRUD · audit filters return filtered results · settings persist and survive reload · session revocation invalidates the token.

### Definition of Done
- [ ] Roles, teams, permissions, audit logs and settings are all manageable from the UI.
- [ ] No settings control fails to persist.
- [ ] No security control is simulated.
- [ ] Navigation reflects the user's actual permissions.

---

# PHASE 13 — SECURITY HARDENING

**Goal:** close every open finding in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

### Problems being solved
See `SECURITY_AUDIT.md` for full detail. Headline items: no rate limiting anywhere · user enumeration via a status-code oracle · permanently re-lockable accounts · Aadhaar hash exposure under a defaulted pepper · no CSP/HSTS/X-Frame-Options anywhere · an open SSRF image proxy · PII accreting in an immutable, unpurgeable audit table.

### Existing functionality to reuse
The authorization core, refresh-token rotation with family revocation, argon2 configuration, bank scoping, and the error handler's no-leak policy are all sound and must be preserved.

### Tasks
| # | Task | Effort |
|---|---|---|
| 13.1 | Add IP + account rate limiting on `/api/auth/*` and a global limiter. Put a concurrency cap in front of argon2. **(SEC-005)** | M |
| 13.2 | Remove the enumeration oracle: return an identical 401 for locked accounts; increment a counter for unknown addresses too. **(SEC-004)** | S |
| 13.3 | Reset `failedLoginAttempts` when `lockedUntil` elapses. **(SEC-006)** | S |
| 13.4 | Stop returning `aadhaarHash`: replace the four unprojected `.select()`/`.returning()` calls with explicit column lists. Remove the `AADHAAR_PEPPER` default so it is required in every environment. Move from SHA-256 to HMAC or a slow KDF. **(SEC-007)** | M |
| 13.5 | Add security headers in `next.config.ts`: CSP (the inline theme script needs a nonce), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. **(SEC-011)** | M | *(Was labelled SEC-010 — that finding is `mustChangePassword` is enforced only in React, `SECURITY_AUDIT.md:973`, which this row does not address. The finding this row fixes is SEC-011, `:1048`. Corrected 2026-09-05, Wave 0.)*
| 13.6 | Remove `images.remotePatterns: hostname "**"` — no remote image is used anywhere in the app. **(SEC-012)** | S | *(Was labelled SEC-011. The open-fetch-proxy finding is SEC-012, `SECURITY_AUDIT.md:1104`. Corrected 2026-09-05, Wave 0.)* **Phase 9.6 must not enlarge `remotePatterns`** — do not use `next/image` for remote document previews, or this row stops being a one-line deletion.
| 13.7 | Harden the Excel importer: extension + magic-byte validation, a decompressed-size ceiling, a row-count cap, chunked inserts, and **4xx instead of 500** for rejected files. **(SEC-008)** | M |
| 13.8 | Extend `REDACTED_FIELDS` to cover `pan`, `mobile`, `email`, `dob`, `accountNo`, `ifsc`, `address`, `aadhaarLast4`, or store `changes` as a key list. Add an audit retention/anonymisation path. **(SEC-017)** | M | *(Was labelled SEC-016 — that is the approve-route status finding, `SECURITY_AUDIT.md:1291`, owned by Phases 6–8 and 13.13. The PII-in-audit finding is SEC-017, `:1351`. Corrected 2026-09-05, Wave 0.)* **Phases 6.2 and 10.3 each add a new unredacted free-text sink** (bank-order remarks, notification titles); per D-049 they **record** that rather than fixing it here.
| 13.9 | Fix the null-bankId scope skip on recycle-bin restore and permanent-delete. **(SEC-013)** | S | *(Was labelled SEC-012. The recycle-bin scoping finding is SEC-013, `SECURITY_AUDIT.md:1133`. Corrected 2026-09-05, Wave 0.)* ⚠️ **Sequencing hazard:** Phase 13 depends on Phases 1–12, so this lands **after 9.8** — which converts an out-of-scope purge from destroying a row to destroying a KYC file. Recorded, not resolved (D-075).
| 13.10 | Stop leaking the raw driver error from `/api/health/ready`. **(SEC-015)** | S | *(Was labelled SEC-014 — a different, still-open P2 finding, the audit-log SQL-precedence bug. Corrected 2026-09-02.)*
| 13.11 | Pin `algorithms: ["HS256"]` on JWT verification. **(SEC-022)** | S |
| 13.12 | Add an audit row for `logout` and for `permission_denied` — both are declared audit actions that are never written, so **failed authorization attempts currently leave no trace**. | S |
| 13.13 | Add `CHECK` constraints on every status column (pairs with Phases 5–8). | M |
| 13.14 | Mask PAN and account number at rest or in responses by role level; add them to the logger redaction list. | M |
| 13.15 | Add a `refresh_tokens` cleanup job — the table grows on every login **and every refresh**, and nothing ever deletes from it (~672 rows/week per active user). | S |
| 13.16 | Commission an independent penetration test once the above are closed. | L |

### Dependencies
Phases 1–12 (do not harden a moving target).

### Tests required
A security regression suite: rate limit enforced · enumeration closed (identical responses) · lockout recovers · IDOR attempts blocked for every role pair · headers present · upload rejects malicious files · no PII in responses or logs.

### Definition of Done
- [ ] Every CRITICAL and HIGH finding is closed and has a regression test.
- [ ] MEDIUM findings are closed or explicitly accepted in `DECISIONS.md`.
- [ ] An external penetration test has been passed.

---

# PHASE 14 — TESTING

**Goal:** build a test suite that proves the application works, not merely that the backend answers.

### Problems being solved
- **Zero E2E tests. No CI.** *(Frontend tests now exist — 55 across 5 files, added in Phase 1 — but they cover only the demo/auth boundary and the command-palette link target. Corrected 2026-09-02.)*
- `frontend-contract.test.ts` is not a frontend test: it imports nothing from the frontend, checks 7 of ~35 `Customer` fields, is GET-only, and **runs every call as `super_admin`** — so no non-admin persona is ever exercised.
- **Zero coverage** of refresh success, refresh rotation, refresh reuse detection, logout, and account lockout.
- A fully green suite is compatible with production cookie flags, CORS, driver behaviour, all frontend rendering, email, storage and deployment being completely broken.

### Existing functionality to reuse
The PGlite harness is genuinely good — it runs the **real shipped migrations** and the real seed. Keep it and build on it.

### Tasks
| # | Task | Effort |
|---|---|---|
| 14.1 | Close the backend coverage gaps: refresh rotation and reuse detection, logout, lockout and recovery, every approve route, bank-order creation, funding sources, standalone verifications, team-member reassignment, bank reassignment, role permission replacement, user deletion, audit-log listing, pagination correctness. | L |
| 14.2 | Add frontend component tests (vitest + @testing-library/react). **Priority one: a test asserting that every mutating control issues an HTTP request** — this single test class would have caught all 13 fake handlers. | L |
| 14.3 | Add E2E tests (Playwright): full journeys for each of the 5 roles. | XL |
| 14.4 | Add a demo-isolation regression test: demo → real login → real data; and a production build contains no demo string. | M |
| 14.5 | Replace `frontend-contract.test.ts` with a real contract mechanism — generate types from the backend, or assert against a shared schema — and run it as **each** role, not only super admin. | L |
| 14.6 | Add the security regression suite from Phase 13. | M |
| 14.7 | Add a CI pipeline (GitHub Actions): typecheck, lint, backend tests, frontend tests, E2E, build, on every PR. | M |
| 14.8 | Add coverage reporting with a minimum threshold on new code. | S |
| 14.9 | Run the suite against a **real Postgres** in CI, not only PGlite, to catch driver-level differences. | M |

### Dependencies
Runs alongside Phases 4–13; must be complete before go-live.

### Definition of Done
- [ ] Every business workflow has an E2E test.
- [ ] Every role has an authorization test.
- [ ] Every mutating UI control is proven to issue a request.
- [ ] CI blocks merges on failure.
- [ ] The suite runs against real Postgres.

---

# PHASE 15 — PRODUCTION INFRASTRUCTURE

**Goal:** make the application deployable, observable and recoverable. **None of this exists today** — there is not a single `.yml` file in the repository.

### Problems being solved
No CI/CD · no Dockerfile · no deployment config · no monitoring · no error tracking · no backups · no retention job · no alerting · no runbook. `README.md` self-certifies **"Not deployed."**

### Tasks
| # | Task | Effort |
|---|---|---|
| 15.1 | Containerise the backend; define the frontend build. | M |
| 15.2 | Define infrastructure as code for the chosen hosts. Record the choice in `DECISIONS.md`. | L |
| 15.3 | Build the deployment pipeline: staging → production, with an approval gate and a documented rollback. | L |
| 15.4 | **Define the production migration strategy.** Migrations are currently a manual `npm run db:migrate`; nothing runs them on boot. Decide, document, and automate. | M |
| 15.5 | Add error tracking (e.g. Sentry) to both frontend and backend. | M |
| 15.6 | Add metrics and alerting: latency, error rate, DB pool saturation, failed logins, queue depth. | M |
| 15.7 | Ship structured logs to a searchable sink with retention. Verify redaction end to end — note the current pino redaction is **depth-2 only**, contrary to its own comment. | M |
| 15.8 | Configure automated database backups and **rehearse a restore**. | M |
| 15.9 | Build the scheduled-job runner (none exists). First jobs: recycle-bin retention purge — `RECYCLE_BIN_RETENTION_DAYS` is read and `purge_after` is stamped, but **the job that would act on it does not exist**, so records sit soft-deleted forever — plus refresh-token cleanup, import-batch expiry, SLA breach detection. | L |
| 15.10 | Move secrets into a managed secret store; document rotation, especially for `AADHAAR_PEPPER` (rotating it invalidates every stored hash — the procedure must say so). | M |
| 15.11 | Add readiness/liveness probes that do not leak internals, and wire them to the platform's health checks. | S |
| 15.12 | Write the operational runbook: deploy, rollback, restore, incident response, on-call. | M |

### Dependencies
Phase 14 (CI is the delivery vehicle).

### Definition of Done
- [ ] A commit to main deploys to staging automatically and to production on approval.
- [ ] Errors and metrics are visible and alerting works.
- [ ] A database restore has been rehearsed successfully.
- [ ] Scheduled jobs run reliably.
- [ ] No secret lives in a source file or an env example.

---

# PHASE 16 — FINAL QA AND PRODUCTION AUDIT

**Goal:** prove production readiness rather than assume it.

### Tasks
| # | Task | Effort |
|---|---|---|
| 16.1 | Re-run the complete audit that produced [AUDIT_VERIFICATION.md](AUDIT_VERIFICATION.md) and confirm every finding is closed or explicitly accepted. | M |
| 16.2 | Verify every row in [FEATURE_STATUS.md](FEATURE_STATUS.md) end to end by hand, as each of the 5 roles. | L |
| 16.3 | Confirm **zero** fake handlers remain: assert that every success toast in the codebase is preceded by an awaited request. | M |
| 16.4 | Load-test the critical paths: login, customer list, loan create, import. | M |
| 16.5 | Data-protection review: Aadhaar/PAN handling, retention, subject-access and deletion rights under India's DPDP Act. | L |
| 16.6 | Accessibility audit (WCAG 2.2 AA). | M |
| 16.7 | Cross-browser and mobile verification. | M |
| 16.8 | Disaster-recovery drill: restore from backup and verify integrity. | M |
| 16.9 | Sign off [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) — every item DONE or explicitly accepted. | S |
| 16.10 | Produce go-live and rollback plans; agree a hypercare window. | M |

### Definition of Done
- [ ] Every checklist item is DONE or has a recorded, accepted exception.
- [ ] No CRITICAL or HIGH bug or security finding is open.
- [ ] All tests green against real Postgres in CI.
- [ ] Restore rehearsed; go-live and rollback plans signed off.

---

## CRITICAL PATH

```
0 ──► 1 ──► 2 ──► 3
            │
            ├──► 4 ──► 5 ──► 6 ──► 7 ──► 8 ──┐
            │           │                     │
            │           └──► 9                ├──► 11
            │                                 │
            ├──► 12                           └──► 10
            │
            └──────────────────────────────────────► 13 ──► 14 ──► 15 ──► 16
```

**Phases 0 and 1 are strictly sequential and block everything.** Once Phase 3 is done, 4–12 can be parallelised across engineers. 13–16 are sequential and last.

## SEQUENCING RATIONALE

| Decision | Why |
|---|---|
| Demo isolation before anything else | It is the confirmed root cause of the reported failure and the top security finding. Every other phase's manual testing is unreliable until a real login is guaranteed to reach the real backend. |
| Employee management before the business workflows | You cannot test role-based behaviour without being able to create the roles' users. |
| Email as its own phase | It is a genuinely absent subsystem with a provider choice, a delivery contract and failure semantics — not a wiring task. |
| Business workflows in business order (4→5→6→7→8) | Each stage's data is the next stage's input, and the cross-stage side effects only make sense built in sequence. |
| Documents deferred to 9 | It needs a provider decision and is independent of the status-transition work, but it is a **hard compliance blocker** — do not let it slip past Phase 11. |
| Security hardening after feature work | Hardening a moving target wastes effort and re-opens findings. |
| Testing alongside, completed before infrastructure | CI is the delivery vehicle for the tests; the tests must exist first. |

---

**Maintenance:** when a phase completes, tick its Definition of Done, move it to Completed in [claude/CURRENT_PROGRESS.md](claude/CURRENT_PROGRESS.md), rewrite [claude/NEXT_TASK.md](claude/NEXT_TASK.md) for the next task, and add a [CHANGELOG.md](CHANGELOG.md) entry. Do not silently reorder phases — if the order changes, record why in [DECISIONS.md](DECISIONS.md).
