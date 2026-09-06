# Security Audit — Rise Next Banking / Lending Operations CRM

**Audit date:** 2026-08-31
**Commit audited:** `7ef5da5` — *"Add frontend-only employee demo"*
**Working tree state:** DIRTY. 8 modified + 4 untracked files implement employee create / temporary-password / reset / forced-change. Where HEAD and the working tree differ, both are documented.
**Scope:** `backend/`, `frontend/`, `drizzle/`, repository root configuration.
**Method:** static source review. No code was executed, no requests were issued, no database was contacted. Every claim below cites `file:line` at the audited commit or in the working tree, and any claim that could not be established from source is marked **UNVERIFIED**.

> **No secret value appears in this document.** Where a hardcoded or defaulted credential exists, the file and the variable name are given and the value is redacted. See the [Secrets Inventory](#secrets-inventory).

> ### Remediation log
>
> | Date | Finding | Change |
> |---|---|---|
> | 2026-09-03 | **[SEC-029](#sec-029--put-apiteamsidmembers-applies-no-per-member-authorization-so-a-manager-can-enrol-or-evict-a-super-admin) — ADDED and RESOLVED** | BUG-038 remediation. The one hierarchy rule was not consulted on the team-membership path, so any `teams.assign` holder could enrol **or silently evict** any user, including a Super Admin. Now authorized per member over the **union** of the previous and submitted rosters (D-027). Found during Task 2.5, not during this audit — this document's static review did not reach it. |
> | 2026-09-01 | **[SEC-001](#sec-001--client-side-session-forgery-via-the-demo-flag-and-demo_password-shipped-in-the-public-bundle) — RESOLVED** | Phase 1 Tasks 1.1–1.3. The third of these is the first claim in this document established by **executing** something rather than reading it: a production build was produced and its output searched. That evidence is recorded in full under the finding. |
> | 2026-09-02 | **SEC-028 — ADDED and RESOLVED** | Task 1.7. `NODE_ENV` is now a required declaration, so a deploy that forgets it fails at config validation instead of issuing `Secure=false; SameSite=Lax` refresh cookies. The roadmap's original assertion was **tautological** and is not implemented — see D-019. Corrects a numbering collision: the roadmap called this SEC-014, which is a different, still-open finding. |
> | 2026-09-02 | **SEC-018 — RESOLVED** | Task 1.6. The CORS origin callback now rejects with an `AppError(403, "cors_origin_denied")` and logs once at `warn`. No stack trace, no reflected origin, no change to the generic error handler. Disallowed **preflight** is now 403 too — previously unrecorded. 16 tests; reverting the fix fails 7. |
> | 2026-09-02 | **[SEC-027](#sec-027--next-build---webpack-ships-the-demo-credential-and-all-fixture-pii-while-reporting-that-it-did-not) — RESOLVED same day** | Task 1.10. Three layers (D-017); `resolve.alias` alone proved insufficient because `JsConfigPathsPlugin` outruns it. Verified by three clean builds on both bundlers and by two reversions. SEC-001's bundler condition withdrawn. |
> | 2026-09-02 | **SEC-027 — FOUND, HIGH** *(superseded by the row above, same day)* | Found while adversarially reviewing the proposal to close roadmap Task 1.5. `next build --webpack` reopened SEC-001's exposure half in full and printed `EXCLUDED` while doing it, making SEC-001's closure conditional on the bundler for one day. The default build remained clean throughout. |
> | 2026-09-01 | **SEC-024 numbering corrected** | The Task 1.2 session filed a new finding as *SEC-024*, a number already in use, and never added it to the register. It is now **[SEC-026](#sec-026--credential-issuing-users-routes-are-still-answered-by-the-demo-layer)** and appears in the table below. |

---

## Corrections to the intake baseline

Three statements supplied with this audit's brief were tested and found inaccurate. They are corrected here so future sessions do not inherit them.

| Baseline claim | Finding | Evidence |
|---|---|---|
| "NO CSP/HSTS/X-Frame-Options anywhere" | **Partly wrong.** The API *does* emit HSTS, X-Frame-Options, X-Content-Type-Options and Referrer-Policy — helmet 8.3.0 enables them by default and only `contentSecurityPolicy` is switched off. What is missing everywhere is **CSP**; what is missing *entirely* is any security header on the **frontend origin**. | `src/app.ts:44-49` disables only CSP; `node_modules/helmet/index.cjs:342-354` shows `contentSecurityPolicy: false` is the sole opt-out and `index.cjs:564-586` lists HSTS/X-Frame-Options as defaults. `frontend/next.config.ts:1-10` has no `headers()`; no `middleware.ts` exists under `frontend/`. |
| "`documents.storage_key` is never written by anything" | **Wrong.** It is an accepted, client-supplied field on `POST /api/documents`. | `src/modules/operations.routes.ts:399` — `storageKey: z.string().trim().max(500).optional().nullable()`, passed straight into the insert by `src/modules/scoped-resource.ts:181-189`. Recorded as SEC-024. |
| "`mustChangePassword` … Enforcement is React-only" | **Confirmed**, and worse than stated: the seeded bootstrap super admin is created with `mustChangePassword: true` and a comment asserting this "stops the bootstrap value being a valid credential" (`src/db/seed.ts:118-121`). Because nothing enforces it server-side, that assertion is false. Recorded as SEC-010. | `grep mustChangePassword src` returns only schema, seed, three write sites, and read/return sites. Zero occurrences in `src/middleware/`. |

Everything else in the baseline that this audit touched was independently reconfirmed.

---

## Severity model

| Severity | Definition used here |
|---|---|
| **CRITICAL** | Authentication or authorisation can be defeated, or the system can be rendered permanently unrecoverable, by an attacker with no privileged position. |
| **HIGH** | Regulated data (Aadhaar, PAN, account numbers) is exposed or weakly protected, or an unauthenticated attacker can deny service or enumerate accounts. |
| **MEDIUM** | A control that is documented or believed to exist does not actually hold; or a defence-in-depth layer is absent on a path that today has a compensating control. |
| **LOW** | Information disclosure, hygiene, or a latent hazard that requires another defect to become exploitable. |

## Register at a glance

| ID | Sev | Title | Location | Phase |
|---|---|---|---|---|
| ~~SEC-001~~ | ~~CRITICAL~~ | **✅ RESOLVED 2026-09-01** — Client-side session forgery via the `sessionStorage` demo flag; `DEMO_PASSWORD` shipped in the public bundle | `frontend/src/lib/api.ts:174`; `frontend/next.config.ts:35-62` | Phase 1.1–1.3 |
| SEC-002 | CRITICAL → **LOW** | **SUBSTANTIALLY MITIGATED 2026-09-06 (Wave 3, Task 13.1).** The finding is *unauthenticated, **unthrottled**, attacker-controlled inserts*. The unthrottled half is gone: `/api/auth/login` now allows 20/15 min per address and 10/15 min per account, so the unbounded write primitive is bounded to a trickle. **It does not fully close** — a caller can still write ~20 rows per window per address into a trigger-immutable table with no retention job, and the real answer is the audit retention path (15.9). Kept OPEN at reduced severity rather than closed | `src/modules/auth.routes.ts:130` | 15.9 |
| ~~SEC-003~~ | ~~CRITICAL~~ | **✅ RESOLVED 2026-09-02** — Irreversible super-admin lockout via `PATCH /api/users/:id` | `src/services/access.ts:183-275`; `src/modules/admin.routes.ts:282-318,489-497` | Phase 2.1 + 2.2 |
| ~~SEC-004~~ | ~~HIGH~~ | **✅ RESOLVED 2026-09-06 (Wave 1, Task 13.2)** — a locked account now answers the **identical 401** an unknown address gets; the lockout still holds. Regression: `src/tests/auth-hardening.test.ts` cases 1–4 (4 fail against pre-fix code) | `src/modules/auth.routes.ts:127-148` | Wave 1 |
| ~~SEC-005~~ | ~~HIGH/P0~~ | **✅ RESOLVED 2026-09-06 (Wave 3, Task 13.1)** — `POST /api/auth/login` is throttled on **two axes**: per address (20/15 min) and **per account** (10/15 min, keyed on the normalised address so case and whitespace are not a bypass). Per-account is what catches a *distributed* attempt at one inbox, which per-IP cannot see. A **global limiter** (300/min) backstops every route; `/api/health` is exempt so the limiter cannot restart-loop the platform. The **argon2 pile-up** — the half a request limiter cannot solve — is bounded by `withHashSlot`: max 4 concurrent hashes, queue not reject, bounded queue. Regression: `src/tests/auth-rate-limit.test.ts` (15 cases), **reversion-proven — 5 fail against pre-fix code**. ⚠️ **Residual, recorded not hidden:** per-process, in-memory, fixed-window (see D-085) | `src/middleware/rate-limit.ts`; `auth.routes.ts`; `app.ts` | Wave 3 |

> **SEC-005 and the new public endpoint, 2026-09-04 (Task 3.5).** `POST /api/auth/accept-invite` is unauthenticated and credential-granting, so it is exactly the surface this finding is about. **The finding is NOT closed and no general rate limiter was built** — the roadmap allows either Phase 13 or a local implementation, and inventing an application-wide limiting subsystem inside an invitation task would have been unrequested scope.
>
> **What was done instead is narrow and real:** the endpoint refuses an invalid token after one indexed `SELECT`, **before any argon2 work**. Password hashing happens only once a token has been found live and unexpired. That removes the *amplification* this finding names — an anonymous caller cannot spend the server's CPU by posting junk tokens — while leaving the underlying gap untouched.
>
> **Residual risk, stated plainly:** a caller holding a **valid** token can still force repeated argon2 hashing, and there is still no per-IP or per-route limit anywhere in the application. Brute-forcing the token itself is not a concern (48 random bytes). **SEC-005 stays open at P0**, and Phase 3's own test list still requires *"rate limiting on both public endpoints"* — unmet, and 3.6 adds the second one.

> **Narrowed 2026-09-04 (Task 3.6), and still open.** Task 3.6's own wording requires *"rate-limited"* tokens, so a **focused** limiter now exists — `src/middleware/rate-limit.ts`, fixed-window and in-process — applied to all three public credential-granting endpoints: `forgot-password` (5 / 15 min), `reset-password` and `accept-invite` (10 / 15 min each). `accept-invite` was retro-fitted because it shipped in 3.5 before the mechanism existed.
>
> **A new credential route was added 2026-09-04 (Task 3.8), and it is NOT rate limited — deliberately.** `POST /api/users/:id/resend-invitation` mints a fresh invitation link. It is **authenticated**, gated on `users.reset_password`, and bound by `assertCanManageRoleLevel`, so it is not the surface this finding describes: there is no unauthenticated caller and no argon2 work on the request path. The limiter added in 3.6 guards *public* credential endpoints, and extending it here would have been redesigning SEC-005 uninvited.
>
> **The residual risk is a different one and is named rather than hidden:** an authorized administrator can loop the endpoint and burn the Resend free-tier quota (100/day, 3,000/month), degrading *other* mail. Mitigations that exist today: the control disables while in flight, and **every call is audited** as `invitation_resent`, so abuse is visible after the fact. If quota exhaustion is ever observed, the smallest fix is a per-target cooldown, not a global limiter. See **D-041**.

> **This is not the fix and must not be read as one.** It is **per process**, so two instances behind a load balancer each keep their own counters and the effective limit multiplies; it is **in memory**, so a restart forgets everything; it is a **fixed window**, so an allowance can be spent at the end of one window and again at the start of the next; and it guards **5 routes out of 96**. Every other endpoint — including `POST /api/auth/login`, whose argon2 pile-up this finding names first — remains exactly as exposed as described above. **SEC-005 remains OPEN at P0** and Phase 13 owes the general answer. See **D-039**.
| ~~SEC-006~~ | ~~HIGH~~ | **✅ RESOLVED 2026-09-06 (Wave 1, Task 13.3)** — `failedLoginAttempts` resets once `lockedUntil` has elapsed, so serving out the window genuinely recovers the account. Regression: `src/tests/auth-hardening.test.ts` cases 5–8 (case 7 is the finding; fails pre-fix) | `src/modules/auth.routes.ts:109-125` | Wave 1 |
| ~~SEC-007~~ | ~~HIGH/P0~~ | **✅ RESOLVED 2026-09-06 (Wave 3, Task 13.4)** — all three halves. **(1)** A single shared `CUSTOMER_COLUMNS` projection replaces five bare `.select()`/`.returning()` calls across `customers.routes.ts` **and** the KYC pack, so the digest reaches no response; a test asserts the projection covers every column *except* that one, so a new column cannot silently reappear. **(2)** `AADHAAR_PEPPER` has **no default in any environment** — the production-only guard let staging and UAT pepper real data with a published constant — and the minimum rose 16 → 32. **(3)** The digest is **HMAC-SHA256**, not `sha256(pepper + ':' + value)`, which was length-extendable over a 10^12 keyspace. Regression: `src/tests/aadhaar-protection.test.ts` (16 cases) | `customers.routes.ts`; `documents.routes.ts`; `config/env.ts`; `lib/password.ts` | Wave 3 |
| ~~SEC-008~~ | ~~HIGH~~ | **✅ RESOLVED 2026-09-06 (Wave 3, Task 13.7)** — four defects. **Magic bytes** validated before parsing (multer checked only the client-declared MIME type, so a renamed executable reached the parser). A **decompressed-size ceiling** of 20× `MAX_UPLOAD_MB`, read from the ZIP local headers so the decision costs no memory. A **row cap** of 5,000 that **refuses rather than truncates** (a half-imported customer file reported as success is D-004's shape). And **4xx instead of 500** — a malformed workbook was an error-level stack trace any caller could trigger. Regression: `src/tests/import-hardening.test.ts` (12 cases) | `src/modules/imports.routes.ts` | Wave 3 |
| SEC-009 | HIGH | Plaintext Aadhaar and full PII persisted indefinitely in `import_rows` | `src/modules/imports.routes.ts:306-315` | P0 · **13.7 + 15.9** |
| ~~SEC-010~~ | ~~MEDIUM~~ | **✅ RESOLVED 2026-09-02** — `mustChangePassword` enforced only in React | `src/middleware/auth.ts:52,72`; `src/lib/errors.ts:80-82`; `src/modules/auth.routes.ts:222,231` | Phase 2.3 |
| SEC-011 | MEDIUM → **LOW** | **PARTIALLY REMEDIATED 2026-09-06 (Wave 1, Task 13.5).** The frontend origin now emits CSP, HSTS (2y + subdomains), `X-Frame-Options: DENY`, nosniff, `Referrer-Policy` and `Permissions-Policy`. **Clickjacking, plugin execution, base-tag hijacking, form exfiltration and mixed content are closed.** ⚠️ **XSS is NOT** — `script-src` carries `'unsafe-inline'` because a nonce cannot be delivered from static config and needs `middleware.ts` (**D-082**). Regression: `frontend/src/lib/security-headers.test.ts` cases 3–7 | `frontend/next.config.ts` | **stays open** until the nonce lands |
| ~~SEC-012~~ | ~~MEDIUM~~ | **✅ RESOLVED 2026-09-06 (Wave 1, Task 13.6)** — `images.remotePatterns` **deleted entirely**; no remote image is used anywhere. Regression: `frontend/src/lib/security-headers.test.ts` cases 1–2, which assert the ABSENCE of any wildcard so re-adding one fails | `frontend/next.config.ts` | Wave 1 |
| ~~SEC-013~~ | ~~MEDIUM~~ | **✅ RESOLVED 2026-09-06 (Wave 3, Task 13.9)** — `if (entry.bankId) assertBankAccess(...)` skipped scoping entirely for a null bank; `recycle_bin.restore` is granted to Manager, so it was never Super-Admin-only, and post-9.8 an out-of-scope purge destroys a **KYC file** (D-075). ⚠️ **The first fix was over-corrected and four existing tests caught it**: blanket-refusing scoped callers would have removed employee restore from every Manager, a capability D-030 designed. `user` defers to the role hierarchy; `service_provider` (no guard at all) is unscoped-only; anything else with a null bank fails closed. Regression: `src/tests/bin-scope-and-audit.test.ts` groups A (6 cases) | `src/modules/admin.routes.ts` | Wave 3 |
| ~~SEC-014~~ | ~~MEDIUM~~ | **✅ RESOLVED 2026-09-06** — Task 12.5. The bank-scope disjunct is parenthesised, so a scoped caller's `recordType`/`action`/`actorId` filters are no longer dropped for the in-scope branch. **Reversion-proven: 5 of 21 cases in `audit-query.test.ts` fail against the pre-fix predicate.** Never a cross-tenant leak, and case 12 asserts that directly | `src/modules/admin.routes.ts` | Wave 4 |
| ~~SEC-015~~ | ~~MEDIUM~~ | **✅ RESOLVED 2026-09-06 (Wave 1, Task 13.10)** — the driver error goes to `logger.error` where alerting can see it; the unauthenticated response says only that the database is not answering | `src/modules/health.routes.ts:32-46` | Wave 1 |
| ~~SEC-016~~ | ~~MEDIUM~~ | **✅ RESOLVED 2026-09-06 (Wave 2, Task 13.13)** — the sweep is complete. `verifications` was the last resource whose approve route accepted free text: it configured no `allowedStatuses`, so `approveBody` fell back to `z.string().min(1)`. It now opts in, **and** migration `0014` adds `verifications_status_check` behind it. **Every status column with an approve route is now constrained at both layers.** Repository CHECK count 4 → 13. Regression: `loan-state-machine.test.ts` case 6 (which pinned the hole for five phases and now pins its closure), `migration-populated.test.ts` (6 cases incl. a soft-deleted offender), `check-violation-mapping.test.ts` (10 cases) | `drizzle/0014_status_check_sweep.sql`; `operations.routes.ts` verificationsRouter | Wave 2 |
| SEC-017 | MEDIUM → **LOW** | **ACCRETION HALF CLOSED 2026-09-06 (Wave 3, Task 13.8).** `REDACTED_FIELDS` held 8 entries, all secrets, and missed **every piece of customer PII** — one typo-correcting PATCH wrote PAN, mobile, DOB, address, account number and IFSC into a trigger-immutable table with no purge path, twice each. Now ~35 fields. The **key is still listed** with `[redacted]` placeholders, because dropping it would answer *"nothing happened"* during a fraud investigation; comparison uses the real values so an unchanged field still does not appear. Regression: `src/tests/audit-redaction.test.ts` (10 cases). ⚠️ **STAYS OPEN.** Two halves remain: **free-text sinks** (bank-order remarks, notification titles — no field list can catch a PAN typed into prose), and **rows already written**, which need the retention path (15.9) | `src/services/audit.ts` | 15.9 |
| ~~SEC-018~~ | ~~LOW~~ | **✅ RESOLVED 2026-09-02** — rejected CORS origin produced a 500 and an error-level log (unauthenticated log amplification) | `src/app.ts:75-87` | Phase 1.6 |
| ~~SEC-019~~ | ~~LOW~~ | **✅ RESOLVED 2026-09-06 (Wave 5, Task 15.7)** — a pino `*` matches exactly one intervening level, so `*.password` covered `x.password` and missed `req.body.password`. Redaction is now **by key name at any depth**, through a walker in `formatters.log` (**D-094**). Proven by `log-redaction.test.ts`, which pushes a nested PII payload through a **real pino instance** and asserts none of the values are emitted | `src/lib/logger.ts` | Wave 5 |
| SEC-020 | LOW | Raw Postgres constraint names returned to clients | `src/middleware/error-handler.ts:72` | P3 |
| SEC-021 | LOW | Permission keys echoed verbatim in 403 bodies | `src/services/access.ts:95,171` | P3 |
| ~~SEC-022~~ | ~~LOW~~ | **✅ RESOLVED 2026-09-06 (Wave 1, Task 13.11)** — `algorithms: ["HS256"]` pinned on both verifiers, matching what both signers emit. Regression: `src/tests/auth-hardening.test.ts` cases 9–13 (HS512, HS384, `alg:none`, and a forged token refused over HTTP) | `src/lib/tokens.ts:40-88` | Wave 1 |
| SEC-023 | LOW | Temporary password rendered unmasked and written to the OS clipboard | `frontend/src/components/shared/credential-handover.tsx:59-65,44` | P3 |
| SEC-024 | LOW | `documents.storage_key` is client-supplied free text with no traversal guard | `src/modules/operations.routes.ts:399` | P2 |
| ~~SEC-025~~ | ~~LOW~~ | **✅ RESOLVED 2026-09-06** — `AADHAAR_PEPPER` absent from `.env.example`; `frontend/.gitignore` misses non-`.local` env files. Half one closed by Task 0.4; half two by Wave 0, which also caught the **eight storage keys** Phase 9 added and neither template named (**D-080**) | root `.env.example` **deleted**; `.env.example`; root `.gitignore` | Task 0.4 + Wave 0 |
| ~~SEC-028~~ | ~~MEDIUM~~ | **✅ RESOLVED 2026-09-02** — `NODE_ENV` defaulted to `development`, so a production deploy that forgot it issued `Secure=false; SameSite=Lax` refresh cookies | `src/config/env.ts:5` | Phase 1.7 |
| SEC-026 | MEDIUM | Credential-issuing `/users/*` routes answered by the demo layer with a **forged 403** — demo-enabled builds only after Task 1.3 | `frontend/src/lib/demo/api.ts:622-625`; `frontend/src/app/(app)/employees/page.tsx:158,200,222` | P2 |
| ~~SEC-027~~ | ~~HIGH~~ | **✅ RESOLVED 2026-09-02** — `next build --webpack` shipped the demo credential and all fixture PII while logging `EXCLUDED` | `frontend/next.config.ts`; `frontend/src/lib/demo/config.ts` | Phase 1.10 |
| ~~SEC-029~~ | ~~MEDIUM~~ | **✅ RESOLVED 2026-09-03** — `PUT /api/teams/:id/members` consulted no role hierarchy, so a Manager could enrol **or silently evict** a Super Admin | `src/modules/admin.routes.ts:826-901` | Phase 2 |

**Totals:** 0 CRITICAL · 1 HIGH · 2 MEDIUM · 6 LOW · **9 open findings · 21 resolved.**

> ### Wave 5 movements, 2026-09-06 — one closed, one implemented-but-not-in-effect
>
> **SEC-019 is RESOLVED.** The redaction paths were `*.password`-shaped and a pino `*` matches **exactly one** intervening level, so the most likely leak shape — `req.body.password`, depth three — was never covered, nor was `audit.changes.pan`, which `services/audit.ts` logs wholesale on its own failure path. The file's comment promised otherwise. Redaction now walks by key name at any depth (**D-094**), and `log-redaction.test.ts` proves it through a real pino instance rather than by testing the pure function alone — which is the gap that let the defect live behind a comment claiming coverage.
>
> ⚠️ **SEC-009 — the one open HIGH — is now implemented and NOT YET IN EFFECT, and those are different things.** `jobs/expire-import-batches.ts` destroys the staged plaintext Aadhaar that `import_rows` retained forever, and `jobs.test.ts` case 8 proves the value is **gone from the database**, not merely that a status changed. But **nothing purges until the cron is wired**, which is an external step. The finding stays **OPEN** until the operator has scheduled the job and confirmed the measuring query reads zero (`RUNBOOK.md` §4). Closing it on the strength of a passing test would be exactly the claim this register exists to prevent.

> ### Wave 4 movements, 2026-09-06 — one closed
>
> **SEC-014 is RESOLVED** by Task 12.5. The bank-scope fragment was a bare `A or B` pushed into `and(...filters)`, which parenthesises the conjunction and not its members, so `and`-binds-tighter detached the scope disjunct and **every user-selected filter was dropped for the in-scope half of a scoped caller's query**. The fix is the parentheses; the predicate is otherwise unchanged.
>
> **Reversion-proven:** reverting the parentheses fails **5 of the 21** cases in `src/tests/audit-query.test.ts`, measured 2026-09-06.
>
> ⚠️ **Two things worth recording rather than smoothing over.**
>
> 1. **It was never a scope escape**, and the register said so from the start. The escaping disjunct was still `bank_id in (caller's banks)`. Case 12 asserts that separately from the filter cases, because a fix that narrowed the wrong way would pass all of them and fail only there.
> 2. **It was unreachable with the shipped role set.** Measured while writing the tests: `audit_logs.view` is seeded to Super Admin and Admin only, and Admin also holds `system.access_all_banks` — so `ctx.bankIds` is `null` for both and the `or` clause never appeared. Reaching it needs exactly the bespoke bank-scoped auditor that `permissions.ts` names in its own comment. The tests build that role through the real `POST /api/roles`, because the first client to create one would have hit this immediately.
>
> **Nothing else moved.** SEC-009 is still the only open HIGH and still waits on 15.9.

> ### Wave 3 movements, 2026-09-06 — four closed, two downgraded
>
> **Closed, each with a named regression test:** **SEC-005** (P0), **SEC-007** (P0), **SEC-008**, **SEC-013**.
> **Downgraded and kept open:** **SEC-002** CRITICAL → LOW (the *unthrottled* half is gone; the write primitive remains, bounded), **SEC-017** MEDIUM → LOW (accretion stopped; free-text sinks and already-written rows remain).
>
> **`SEC-005`'s tests are reversion-proven** — reverting the two login limiters and the global limiter fails **5 of 15** cases, measured 2026-09-06.
>
> **There is no CRITICAL finding left open.** SEC-002 was the last, and Task 13.1 removed the amplification it depends on. **One HIGH remains: SEC-009** — plaintext Aadhaar retained indefinitely in `import_rows`. Task 13.7 hardened the *ingest* path; the retention half needs the scheduled-job runner and is owned by **15.9**, which is Wave 5.
>
> ⚠️ **Two findings are downgraded rather than closed on purpose.** Both have a genuine remaining half, and marking them resolved because the cheaper half landed is exactly what this register's own rules forbid.
>
> **SEC-011** stays LOW/open from Wave 1: the headers are real and close five attack classes, but `script-src 'unsafe-inline'` means XSS is not among them (D-082).

*(superseded)* Totals: 1 CRITICAL · 4 HIGH · 5 MEDIUM · 5 LOW · **15 open findings · 14 resolved (SEC-016 added) (SEC-001, SEC-003, SEC-004, SEC-006, SEC-010, SEC-012, SEC-015, SEC-018, SEC-022, SEC-025, SEC-027, SEC-028, SEC-029).**

> **Wave 1 movements, 2026-09-06 — five closed, one downgraded.** SEC-004, SEC-006, SEC-012, SEC-015 and SEC-022 are **RESOLVED**, each with a named regression test. **SEC-011 is downgraded MEDIUM → LOW and stays open**: the headers are real and close five attack classes, but `script-src 'unsafe-inline'` means it does not stop XSS, and saying otherwise would be D-004 applied to a security control (**D-082**).
>
> **The SEC-004 and SEC-006 tests are reversion-proven.** Reverting the two handler changes and the algorithm pin fails **7 of the 13** cases in `auth-hardening.test.ts`, measured 2026-09-06.
>
> **The four remaining HIGH findings are SEC-005, SEC-007, SEC-008 and SEC-009 — all P0/P1, all owned by Wave 3.** SEC-005 is the one SEC-002 depends on: throttling `/api/auth/login` is what stops the unauthenticated audit-row insert, and it is untouched.

> **Re-verification, 2026-09-06 (Wave 0).** Every open finding above was re-read **against code**, not against this register, during the master production-readiness audit. **None had closed silently, and none was closed on the strength of a neighbouring feature improving.** Two movements only:
>
> - **SEC-025 → RESOLVED.** Both halves genuinely closed; the template half by Wave 0 (**D-080**), which also found and fixed the eight `STORAGE_*` / `MAX_DOCUMENT_MB` keys Phase 9 added and no template named — five of which production refuses to boot without.
> - **SEC-009 → owner assigned** (**13.7 + 15.9**). It previously had none, which for a P0 is its own defect. **The underlying issue is untouched.**
>
> **Two findings were escalated in consequence rather than in severity, and both are recorded on their entries:** **SEC-013** (recycle-bin null-bank scope skip) now destroys a **KYC file** rather than just a row, because 9.8 wired object deletion into the purge path (**D-075**); and **SEC-017** gained two new unredacted free-text sinks in 6.2 (bank-order remarks) and 10.3 (notification titles), which those tasks **recorded rather than fixed**, per **D-049**.
>
> **SEC-024 is substantially remediated but stays open.** 9.4 removed `storageKey` and `checksum` from the create schema and made the server generate both; `assertSafeKey` guards the **read** path too. It closes only once rows written before 9.4 are confirmed absent from the production database — a data question, not a code one.

> **SEC-029 was added and resolved on the same day, 2026-09-03**, and it is the first finding in this register that **this audit did not find**. It was discovered by measurement during Task 2.5 and carried as BUG-038 until it was fixed. The audit's method was static review (see the header); the defect is an *absence* — no `assertCanManageRoleLevel` call on one route — and an absence in one handler is exactly what reading for the presence of bad patterns misses. Recorded here because the severity model's MEDIUM definition fits it verbatim.

> **SEC-003 closed 2026-09-02 by Tasks 2.1 + 2.2.** Only the **second** P0 closed, and the first on the backend. See the entry below for the field-scoped self-guard, the shared invariant, and the two things that were deliberately **not** done (a database trigger, and the break-glass recovery script — remediation items 3 and 4, both still open).

> **SEC-028 was added and resolved on the same day.** The hazard was described in the original audit but never given an id, and `PRODUCTION_ROADMAP.md` referred to it as *SEC-014* — a number already held by the audit-log SQL-precedence bug. Corrected 2026-09-02; the roadmap reference is fixed.

> ✅ **SEC-001's bundler condition is WITHDRAWN as of 2026-09-02.** It was conditional on the Turbopack path for one day; [SEC-027](#sec-027--next-build---webpack-ships-the-demo-credential-and-all-fixture-pii-while-reporting-that-it-did-not) closed the gap, and the exclusion now holds on **every** build path — enforced by a tripwire that fails the build rather than by configuration alone.

**Numbering note.** SEC-026 was originally filed as *SEC-024*, colliding with the existing `documents.storage_key` finding and never reaching this table. Corrected 2026-09-01 during Task 1.3.

---

# CRITICAL

## SEC-029 — `PUT /api/teams/:id/members` applies no per-member authorization, so a Manager can enrol or evict a Super Admin
> **The BUG-038 pattern was checked for again on 2026-09-04 (Task 3.8)** and did not recur. `POST /api/users/:id/resend-invitation` is a credential-granting route whose name suggests it merely re-sends an email, which is exactly the shape that hid this defect the first time. It applies `assertCanManageRoleLevel` to the target in addition to `requirePermission`, and the full 5×5 actor × target matrix is asserted by tests — including that a bespoke level-10 role holding the permission is still refused a Super Admin target. A mutation removing the hierarchy call fails 5 tests. See **D-041**.


**Severity:** MEDIUM · **Status:** ✅ **RESOLVED 2026-09-03** (BUG-038 remediation) · **Found:** 2026-09-03 by measurement during Task 2.5 — **not by this audit**

> ### ✅ RESOLVED — 2026-09-03
>
> The handler now resolves every affected member inside the transaction it already had and calls the existing `assertCanManageRoleLevel` on each. The affected set is the **union of the previous and submitted rosters**, so removals are authorized as well as additions. `assertCanManageRoleLevel` was **not modified** — `authorization.test.ts` (26 tests) still passes unchanged. See **[DECISIONS.md](DECISIONS.md) D-027** and **[BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md#bug-038)** for the full before/after table.

**Why MEDIUM, when the bug register calls it HIGH.** The two documents use different scales and both are right on their own. This register's [severity model](#severity-model) defines **CRITICAL** as authorisation being defeatable *"by an attacker with no privileged position"* — this needed `teams.assign`, which no unauthenticated party holds. **HIGH** here is reserved for regulated-data exposure or unauthenticated denial of service, neither of which applies. **MEDIUM** fits word for word: *"A control that is documented or believed to exist does not actually hold."* The hierarchy rule is documented three times — `claude/PROJECT_CONTEXT.md:90`, `ROLES_AND_PERMISSIONS.md` §4, and `README.md:153` — and did not hold here. `BUGS_AND_ISSUES.md` rates by blast radius rather than attacker position, and HIGH is correct on that scale.

**Vulnerability.** The handler applied one check — `requirePermission(PERMISSIONS.teams.assign)` — and then a team-exists lookup. Between that gate and the write there was no hierarchy check, no existence check, and no per-member loop of any kind. Because the write is a whole-roster **replace**, the omission cut both ways.

**Measured over real HTTP**, seeded `manager` (level 20, holds `teams.assign`):

| Request | Result |
|---|---|
| `{ userIds: [<super-admin>] }` | **200, placed.** The same actor is refused **403** by `PATCH /api/users/<same super-admin>` |
| Roster `[<super-admin>, <exec>]`, submit `{ userIds: [<exec>] }` | **200 — the Super Admin is evicted without ever being named in the request** |
| Audit row for that eviction | `changes: null` — **who was removed is unrecoverable** |
| `{ userIds: [<nonexistent>] }` | **409** *"That record is still referenced by other records"* — a raw FK leak whose message asserts the opposite of what happened |

**Exposure was bounded.** The route had **zero frontend callers** for its whole life, so reaching it required a direct API call by a `teams.assign` holder. Roadmap Task 2.7 wires it to the UI, which is why it was fixed first.

**The eviction half is the one that mattered.** A fix that checked only the submitted `userIds` — the obvious reading, and the one the original write-up proposed — returns 200 on row two of that table and leaves the Super Admin evicted. Every id in that request is one the Manager is fully entitled to manage; the victim is identified only by their *absence*. This is now pinned by three tests that fail if the affected set is narrowed back to `submitted`.

**Two regressions the fix itself introduced, caught by adversarial review and fixed before it landed.** Both were reproduced over real HTTP before being believed, and both now have their own tests:

1. **An actor who was on the team could no longer edit that team's roster** — not even to remove themselves. Their own row entered `previous`, so the union check ran `assertCanManageRoleLevel` against their own level, and "strictly greater" means nobody outranks themselves. Measured **403** for keep-self, remove-self and add-self alike. Reachable through normal use: `POST /api/users` places a new employee on a team at creation. The actor is now excluded from the hierarchy loop **by identity, not by level** — `team_members` is never consulted by any authorization decision (`services/access.ts` does not mention teams at all), so joining or leaving a team grants and removes nothing. A test asserts a *peer* at the same level is still refused, so the exclusion cannot be widened into a level check.
2. **An uppercase uuid for a live user was rejected 400 "One or more users do not exist"** — the same class of untruth the fix was written to remove. Postgres emits uuids lower-cased and `z.uuid()` accepts any case without normalising, so the raw request id never matched the id read back. Submitted ids are now canonicalised once at the boundary, which also makes case variants of one id dedupe correctly instead of violating the `(team_id, user_id)` primary key.

**Not part of this fix, deliberately.** No bank scoping was added: `claude/PROJECT_CONTEXT.md:71` records teams as *"Not bank-scoped"* and neither table carries a bank column, so a scope check would be new policy rather than remediation. `teams.leaderId` on `POST /api/teams` has the same missing validation — an Admin can set a Super Admin as leader (**201**, measured) — and is recorded in [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md) rather than fixed here.

---

## SEC-028 — `NODE_ENV` defaulted to `development`, so a production deploy that forgot to set it issued insecure refresh cookies

**Severity:** MEDIUM · **Status:** ✅ **RESOLVED 2026-09-02** (Task 1.7) · **Found:** 2026-08-31 in the original audit, but **never given an id** — see the numbering note below

> ### ✅ RESOLVED — Task 1.7, 2026-09-02
>
> `NODE_ENV` is now **required**. `config/env.ts` no longer defaults it, so the backend refuses to start when it is absent:
>
> ```
> Invalid environment configuration:
>   - NODE_ENV: NODE_ENV must be set explicitly to development, test or production.
>     It is not defaulted: it alone decides the refresh cookie's Secure and SameSite
>     flags, so guessing it wrong ships insecure sessions.
> ```
>
> **`lib/tokens.ts` was not touched.** The cookie logic was always correct; only its input was unguarded.

**Vulnerability.** `refreshCookieOptions()` (`lib/tokens.ts:75-82`) derives both `Secure` and `SameSite` from `NODE_ENV === "production"`. `NODE_ENV` was `z.enum([...]).default("development")`, and **nothing in this repository sets it** — verified: no `Dockerfile`, no `railway.*`, no `nixpacks.*`, no `Procfile`, no CI, no `vercel.json`, and `npm start` is a bare `node dist/server.js`. Node does not set it either.

So a genuine production deployment that simply never set the variable booted as `development` and issued the refresh cookie with **`Secure=false; SameSite=Lax`**. Two independent failures, and the quieter one is the security one:

1. **Confidentiality** — without `Secure`, the refresh cookie is transmissible over plain HTTP.
2. **Availability** — across the Vercel↔Railway *site* boundary, `SameSite=Lax` means the browser stores the cookie and never sends it, so **every reload silently signs the user out**. This presents as "sessions randomly drop", not as a security alarm.

**Measured before the fix**, across every realistic state:

| `NODE_ENV` | boots? | `secure` | `sameSite` |
|---|---|---|---|
| `development` / `test` | yes | `false` | `lax` |
| `production` | yes | `true` | `none` |
| **absent** | **yes, as `development`** | **`false`** | **`lax`** |
| `prod` / `Production` / `staging` / `""` | **no** — enum rejects | — | — |

A **typo was already caught** by the enum; only *absence* was silent. That guard existed and was undocumented.

**Why the roadmap's own remedy would not have worked.** Task 1.7 originally asked to *"assert at boot that `NODE_ENV=production` implies `secure` + `sameSite=none`"*. Both values are computed from the **same expression in the same function**, so that assertion reduces to `isProd → isProd` — no configuration can falsify it. Demonstrated, not argued: with the defective `.default("development")` restored, the cookie-attribute assertions **still pass 5/5** while the two tests that carry the security claim fail. See [DECISIONS.md](DECISIONS.md) D-019.

**Fix.** Remove the default; require the declaration. It infers nothing from other variables, so it has no false positives — it simply refuses to guess. Verified by 17 tests in `src/tests/cookie-config.test.ts` (no database, ~34 ms); restoring the default fails 2.

**It also narrows [SEC-007](#sec-007--aadhaar_hash-returned-by-select--under-a-committed-default-pepper-with-a-node_env-only-guard), but does not close it.** SEC-007's abuse scenario is *"deployed to a container platform where `NODE_ENV` is not explicitly set — the exact default the schema encodes"*; that path now fails at boot. A deployment that sets `NODE_ENV=development` **deliberately** still bypasses the pepper guard, so SEC-007 stays open on its own merits.

> ### ⚠️ Numbering note
>
> `PRODUCTION_ROADMAP.md` recorded this problem as **SEC-014**. **SEC-014 is a different finding** — the audit-log bank-scope SQL-precedence bug in `admin.routes.ts`, still open. The cookie hazard was described in the original audit (inside SEC-007's evidence) but **never given an id of its own**, and the roadmap's label collided with a real entry. Corrected here: this is **SEC-028**, and the roadmap reference is fixed. `docs/claude/NEXT_TASK.md` repeated the wrong id when handing off from Task 1.6; that came from trusting the roadmap rather than the register.

**Not fixed, deliberately.** The roadmap's second clause — *"and that `COOKIE_DOMAIN`, if set, is compatible with the API host"* — **is not implementable as written**: the backend has no authoritative API-host value in its schema (`FRONTEND_URL` is the frontend's and is read by nothing). It would require inventing a new configuration variable. Recorded as a follow-up.

---

## SEC-027 — `next build --webpack` ships the demo credential and all fixture PII, while reporting that it did not

**Severity:** HIGH · **Status:** ✅ **RESOLVED 2026-09-02** (Task 1.10) · **Found:** 2026-09-02, by adversarial review of the Task 1.5 supersession decision

> ## ✅ RESOLVED — Task 1.10, 2026-09-02
>
> **Three layers** ([DECISIONS.md](DECISIONS.md) D-017), because configuring each bundler turned out not to be sufficient:
>
> 1. **Per-bundler exclusion.** `turbopack.resolveAlias` for Turbopack; **`NormalModuleReplacementPlugin`** for webpack. **`resolve.alias` alone does not work** — Next registers `JsConfigPathsPlugin` in `resolve.plugins` for `tsconfig` `paths`, and it resolves `@/lib/demo` to the real directory before the alias is consulted. The replacement plugin rewrites the request *before* resolution, so nothing downstream can win the race. The alias is kept beside it as a second line.
> 2. **A tripwire inside the module.** `lib/demo/config.ts` throws when `NODE_ENV=production` and the demo is not explicitly enabled. `next build` prerenders on the server, so it **fails the build** during static generation. Bundler-agnostic by construction, and it also closes the deep-import hole the exact-match alias cannot see — every other file in that directory imports `config.ts`.
> 3. **A build-output check.** `npm run verify:demo-exclusion` builds on **both** bundlers into clean output and searches the result.
>
> ### Evidence — three clean builds, distinct BUILD_IDs
>
> | Variant | BUILD_ID | Banner | Credentials | Fixtures |
> |---|---|---|---|---|
> | turbopack, demo disabled | `ufkrYTID9IX04lO1yrqSq` | `EXCLUDED via turbopack alias` | absent ✓ | absent ✓ |
> | **webpack, demo disabled** | `aHLz-pqI8lE6rIui1AvSR` | `EXCLUDED via webpack alias` | **absent ✓** | **absent ✓** |
> | turbopack, demo **enabled** | `LThCbPhRQ6fqy0JWttN1g` | `INCLUDED` | present ✓ | present ✓ |
>
> 212 demo-exclusive string literals derived from source at run time, plus 4 named critical strings. The third row is the anti-vacuity check: without it, a build that emitted no client JavaScript would pass the first two and prove nothing.
>
> ### Proven by reversion, twice
>
> | Reversion | `npm test` | `verify:demo-exclusion` |
> |---|---|---|
> | Delete the whole webpack key — the original defect | **fails** (1) | **fails** — and the build itself fails on the tripwire |
> | Keep the alias, drop the replacement plugin — the *plausible wrong fix* | **passes 46/46** | **fails** — build fails on the tripwire |
>
> The second row is the reason layer 3 exists: **unit tests cannot catch a resolution-order defect.** Demonstrated, not assumed.
>
> ### Residual
>
> `verify:demo-exclusion` is a command someone must run — there is no CI in this repository yet (Phase 15). It is deliberately outside `npm test`, which must stay fast; three production builds cost ~40 s. **Phase 15 must wire it into CI.** Until then the tripwire (layer 2) is what actually holds the line, and it needs nobody to remember anything. · **Relates to:** [SEC-001](#sec-001--client-side-session-forgery-via-the-demo-flag-and-demo_password-shipped-in-the-public-bundle), [DECISIONS.md](DECISIONS.md) D-014

**Problem.** Task 1.3 excludes the demo module with `turbopack.resolveAlias` (`frontend/next.config.ts:57-60`). **That key is honoured only by the Turbopack build path.** `next build --webpack` is a first-class, documented option of the installed Next 16.2.12 — `npx next build --help` lists `--webpack  Builds using webpack.` — and it ignores `resolveAlias` entirely, so `@/lib/demo` resolves to the real module.

**Reproduced, not inferred.** In `frontend/`, with **no environment variables set**:

```
$ npm run build -- --webpack
[next.config] demo module: EXCLUDED (NEXT_PUBLIC_ENABLE_DEMO=unset, NODE_ENV=production)
▲ Next.js 16.2.12 (webpack)
✓ Compiled successfully
```

| Searched in `.next/static` | Default build | `--webpack` build |
|---|---|---|
| `Demo@12345` | 0 | **1 file** |
| `demo.employee@risenext.com` | 0 | **1 file** |
| `Karthik Rao` (persona) | 0 | **1 file** |
| `Arvind Reddy Kolla` (fabricated customer) | 0 | **1 file** |
| `risenext.demo.session` | 0 | **1 file** |
| demo-exclusive string literals (of 254) | **0** | **~240** |

The full fabricated dataset returns with it — PANs, Aadhaar-adjacent fields, mobile numbers, IFSC codes, account numbers.

**The aggravating factor is the log line.** The build printed `demo module: EXCLUDED` **four times** and exited 0 while shipping the demo. `next.config.ts` reports what was *configured*, not what the bundler actually *did*. [RULES.md](claude/RULES.md) §4 classifies a control that reports being enabled when it is not as a defect in its own right; this is that, applied to a security control. It is also why this is HIGH rather than MEDIUM: the operator has no signal, and the one signal they do have is wrong.

**What this does and does not undo.**

- It reopens **SEC-001's exposure half** — the credential and the fabricated PII — for any deployment built with `--webpack`.
- It does **not** undo Tasks 1.1 or 1.2. The demo-flag clearing and the `/auth/*` transport allow-list are ordinary application code and hold on every bundler. Real authentication cannot be answered by fixtures regardless.
- The default `npm run build` remains clean, and that is what `package.json` runs.

**Why it was not caught.** Two reasons, both worth fixing:
1. **The invariant has no automated guard.** SEC-001 was closed on a build-output search performed once, by hand. `frontend/vitest.config.ts` includes only `src/**/*.test.{ts,tsx}`, so nothing inspects `.next`. `demo-disabled.test.ts:69` reads its own *source* as text and its header says so plainly: *"WHAT THIS FILE DOES NOT PROVE. It cannot show that the fixtures are absent from the shipped JavaScript."* The property regressed the moment a flag was passed, and nothing would have said so.
2. **D-014 recorded the Turbopack-specificity as a forward-looking porting note** — *"a future move to `next build --webpack` would need the equivalent `resolve.alias` entry"* — rather than as a live capability that silently reopens a CRITICAL finding today.

**Remediation** (Phase 1.10, not done here):
1. Add the equivalent webpack `resolve.alias` entry, **or** make a non-Turbopack build fail loudly when the demo is meant to be excluded. Failing loudly is preferable: it cannot drift.
2. Make the banner report what was **bundled**, not what was configured. Printing nothing would be better than printing `EXCLUDED` wrongly.
3. Add an automated post-build check that searches the built client output for the credential and fixture strings and fails the build. This is the regression guard SEC-001's closure should have had — the roadmap's Phase 1 test list asked for it *"in CI-runnable form, not by eye"* and it was never built.
4. Consider an eslint `no-restricted-imports` rule banning `@/lib/demo/*` deep imports in application code, so nothing can resolve around the single aliased specifier.

---

## SEC-026 — Credential-issuing `/users/*` routes are still answered by the demo layer

> **⚠️ RENUMBERED 2026-09-01 (Task 1.3).** This finding was filed as *SEC-024* by the Task 1.2 session, but **SEC-024 was already taken** by the `documents.storage_key` traversal hazard, and this entry was never added to the register table. Both defects are corrected here: it is now **SEC-026** and appears in the register. No other document referenced the old number except `docs/claude/` notes, which are updated.

**Severity:** MEDIUM · **Status:** OPEN, **scope reduced by Task 1.3** · **Found:** 2026-09-01, by adversarial review of Task 1.2 · **Roadmap:** Phase 2

> **Scope after Task 1.3 (2026-09-01).** A production build no longer contains the demo layer, so these three paths reach the real backend there unconditionally — this finding **cannot occur in a production build.** What remains is a **development and client-presentation** defect: in a demo-enabled build an administrator can still be told "403 — you do not have access" by a fixture, about a server that was never asked. That is a misleading-UI problem rather than a production security hole, which is why it stays MEDIUM and moves to Phase 2 rather than being forced into Task 1.3. **Deliberately not fixed here** — the task scope excluded it, and broadening the transport guard is a change to the same security-critical chokepoint that Task 1.2 just modified.

**Problem.** Task 1.2 guards `/auth/*`, but **authentication is not confined to that prefix.** Three real credential operations live under `/users` and are still routed to the fixture layer while the demo flag is set:

| Call site | Path | Real effect | Demo answer |
|---|---|---|---|
| `employees/page.tsx:200` | `POST /users/:id/reset-password` | mints a real temporary password, revokes sessions | fabricated **403** |
| `employees/page.tsx:158` | `POST /users` | creates a user, returns `temporaryPassword` | fabricated **403** |
| `employees/page.tsx:222` | `PATCH /users/:id` | handler accepts `password` and rewrites `passwordHash` | fabricated **403** |

The demo returns a **forged 403** (`demo/api.ts:622-625`), so an administrator is told the server refused them when the server was never asked. No forged *success* is reachable, which is why this is MEDIUM rather than HIGH.

**Mitigating factor, not a fix.** `app-shell.tsx:28` bounces a demo-flagged session off `/employees` (it is absent from `DEMO_ROUTES`), so the buttons are normally unreachable. But `isDemoMode()` is read as a plain render expression, not reactive state, so a flag set by devtools *after* the page mounted does not re-trigger the guard until the next render — precisely the scenario the Task 1.2 guard exists to defend against. **Protection here comes from an unrelated route guard, not from the transport.**

**Remediation.** Extend the transport guard from a URL-prefix rule to a set of credential-operation paths, or — better — have the demo layer refuse rather than fabricate for any path it does not genuinely model. Phase 2, alongside the employee-management work that owns these three call sites.



## SEC-001 — Client-side session forgery via the demo flag, and `DEMO_PASSWORD` shipped in the public bundle

> ## ✅ **RESOLVED — Tasks 1.3 + 1.10, 2026-09-01/02.** Status: **CLOSED.** Was CRITICAL.
>
> > ### ~~⚠️ CONDITION, added 2026-09-02~~ — **WITHDRAWN the same day by Task 1.10.** SEC-027 is resolved: the exclusion now holds on every build path, enforced by a tripwire that fails the build. The original text is kept below as the record of what was wrong and for one day was true.
> >
> > The exposure half is closed **for the Turbopack build path only** — `npm run build`, the default, and what `package.json` runs. **`next build --webpack`, a documented flag of the installed Next 16.2.12, reopens it in full**: the credential, the persona and all fabricated PII return to the public client chunk, and the build prints `demo module: EXCLUDED` while doing it. Reproduced with no environment variables and no source change. Tracked as **[SEC-027](#sec-027--next-build---webpack-ships-the-demo-credential-and-all-fixture-pii-while-reporting-that-it-did-not)** (HIGH, OPEN).
> >
> > **What is unconditionally closed:** the *diversion* half. Tasks 1.1 and 1.2 are ordinary application code and hold on every bundler — a real credential cannot be answered by fixtures no matter how the app is built.
> >
> > **What is conditional:** criteria 3, 4 and 5 below. They were verified once, by hand, against one bundler. **There is no automated guard**, which is how this regressed unnoticed — see SEC-027 for why and for the remediation.
> >
> > This finding is left CLOSED rather than reopened because the shipping configuration is genuinely clean and the residual is a distinct, narrower defect with its own id. **If anything in CI, a Dockerfile or a hosting configuration ever adopts `--webpack`, reopen SEC-001 immediately.**
>
> Three tasks, each closing a different half of the same finding. All seven closure criteria hold:
>
> | # | Criterion | Status | Proven by |
> |---|---|---|---|
> | 1 | Session contamination fixed | ✅ Task 1.1 | 11 tests; 3 fail against pre-fix code |
> | 2 | Auth transport protected | ✅ Task 1.2 | 8 tests; 2 fail with the guard removed |
> | 3 | Demo credentials absent from the production bundle | ✅ Task 1.3 | build-output search |
> | 4 | Demo fixtures absent | ✅ Task 1.3 | build-output search — 256 literals, 0 present |
> | 5 | Demo fake API absent | ✅ Task 1.3 | build-output search; sourcemap `sources[]` |
> | 6 | Planting the session flag activates nothing | ✅ Task 1.3 | `isDemoMode()` is a compile-time `false`; 3 tests fail if it is not |
> | 7 | Real authentication unaffected | ✅ | frontend 29/29, backend 107/107, zero backend changes |
>
> ### The production-build evidence
>
> Built with the default `npm run build` (Next 16.2.12, Turbopack), then searched. **`.next/static` is the set of files actually served to browsers.**
>
> | Searched for | `.next/static` |
> |---|---|
> | `Demo@12345` | **0** |
> | `demo.employee@risenext.com` | **0** |
> | `DEMO_PASSWORD` | **0** |
> | `risenext.demo.session` / `risenext.demo.data` | **0** |
> | `Karthik Rao` (the demo persona) | **0** |
> | `Arvind Reddy Kolla`, `Mohammed Irfan Baig`, `Lavanya Chintalapudi`, `Ganesh Prasad Bhatt` (fabricated customers) | **0** |
> | `+91 98495 60142`, the demo user UUID, the demo bank UUIDs | **0** |
> | `buildDemoDataset`, `getDemoData`, `mutateDemoData`, `nextDemoCode` | **0** |
>
> **Hand-picked terms only prove the terms you thought of**, so the check was also run exhaustively: every string literal of ≥ 8 characters that occurs in `src/lib/demo/` **and nowhere else in the application source** — 256 of them — was searched for across all 46 client assets. **Zero were found.** *(Later documents quote **254**, not 256 — both correct at their date: Task 1.4's new test introduced `"customers.view"` and `"reports.view"`, which stopped being exclusive to `lib/demo`. The denominator moved; the result did not.)* (Two raw matches were inspected and dismissed: `"forbidden"` is Next.js's own App Router boundary prop, and `")[0].split("` is a code fragment the extractor's regex captured as if it were a literal.)
>
> Independently, the bundler's own record agrees: the only demo-related module in any bundled chunk's sourcemap `sources[]` is **`src/lib/demo-disabled.ts`**. No file under `src/lib/demo/` was resolved.
>
> **Two residues, both accounted for, neither a leak.**
> 1. The export *names* `demoRequest`, `demoNavSections` and `DEMO_SESSION_USER` appear in the client chunk — they are the substitute module's export table, and their values are a throwing function, `[]`, and an all-empty object.
> 2. `.next/server/chunks/ssr/*.js.map` contains the words `DEMO_EMAIL` and `src/lib/demo/` — inside the **comment text** of `demo-disabled.ts` and `lib/api.ts`, embedded via `sourcesContent`. Server-side maps are not served to browsers, `.next/static` holds **no** sourcemaps at all, and no credential or fixture appears in them. `.next/cache/.tsbuildinfo` lists demo *file paths* — it is TypeScript's incremental cache, is not deployed, and contains no content.
>
> ### The one operational rule that keeps this closed
>
> **`NEXT_PUBLIC_ENABLE_DEMO=true` must never be set on a production deployment.** A demo-enabled build ships the credential and every fixture — that is its purpose. The default is safe (unset → excluded in `next build`) and Tasks 1.1 and 1.2 still protect a demo-enabled build from the *diversion* half of this finding. But the exposure half returns if that flag is set in production. See [DECISIONS.md](DECISIONS.md) D-014.
>
> ~~*every build prints which variant it produced*~~ — **struck, then repaired, 2026-09-02.** The banner used to report what was *configured* rather than what the bundler *did*, so a `--webpack` build printed `EXCLUDED` while shipping the demo (BUG-033). **Task 1.10 fixed it:** the banner now names the bundler and the mechanism actually applied, and a false `EXCLUDED` can no longer be produced at all — the tripwire fails that build. The assurance to rely on is `npm run verify:demo-exclusion`, not a log line.
>
> ### Where the four recommended remediations stand
>
> | # | Recommendation | Standing |
> |---|---|---|
> | 1 | Gate the whole directory behind a build-time constant so the bundler eliminates it | ✅ **Done** by Task 1.3, essentially as written; **extended to every bundler by Task 1.10** after SEC-027 showed the Turbopack-only version was not enough |
> | 2 | *"Remove `DEMO_PASSWORD` from source unconditionally … seed it in the database and let it authenticate through `POST /api/auth/login`"* | ❌ **Not done, and deliberately not adopted.** It replaces the frontend-only demo with a real database account, which [DECISIONS.md](DECISIONS.md) D-002 decided against and [RULES.md](claude/RULES.md) §3 forbids (the demo must work with no backend). Its *security* premise — *"anyone who opens the deployed bundle recovers a working sign-in"* — is what Task 1.3 addressed. **Recorded so it is not mistaken for an oversight.** Roadmap Task 1.5 was a weaker variant of it, superseded by D-016 |
> | 3 | *"Move the branch out of `apiRequest` and behind an explicit provider swap"* | ⚠️ **Substantially done; precondition now live.** Task 1.3's resolve-time module replacement *is* an explicit provider swap, and in a demo-excluded build no storage value can redirect anything. In a **demo-enabled** build the branch is still inside `apiRequest` keyed on `sessionStorage`, narrowed to non-auth paths by Task 1.2. Residual is demo-build-only, same class as SEC-026 |
> | 4 | Call `disableDemoMode()` on sign-in and forced sign-out | ✅ **Done** by Task 1.1. Placed *after* the demo-credential check rather than "at the top", or entering the demo would undo itself |
>
> ### Still open, tracked separately
>
> - ~~**Task 1.4** — demo mode is not yet visually unmistakable when active~~ ✅ **DONE 2026-09-02.** Three persistent surfaces — a banner above the topbar, a badge inside the sticky topbar, and the sidebar marker lifted out of its `{!collapsed && …}` wrapper. Verified by mounting the real `AppShell` in a demo session and clicking the actual collapse control; two independent reversions fail the test. Was never part of SEC-001's closure criteria — it is a truthfulness-of-warning issue in demo builds only — but it completes [DECISIONS.md](DECISIONS.md) D-002.
> - **[SEC-026](#sec-026--credential-issuing-users-routes-are-still-answered-by-the-demo-layer)** — the `/users/*` credential paths, now a demo-build-only defect.

| | |
|---|---|
| **Severity** | CRITICAL (as found) |
| **Location, as found** | `frontend/src/lib/api.ts:118`; `frontend/src/lib/demo/session.ts:23-34`; `frontend/src/lib/demo/config.ts:15,81-83`; `frontend/src/lib/demo/api.ts:240-250` |
| **Fixed in** | `frontend/src/hooks/use-auth.tsx` · `frontend/src/app/login/page.tsx` (1.1) · `frontend/src/lib/api.ts:39-80,174` (1.2) · `frontend/next.config.ts:35-62` + `frontend/src/lib/demo-disabled.ts` (1.3) |
| **Status** | **RESOLVED 2026-09-01** |
| **Phase** | Phase 1, Tasks 1.1 / 1.2 / 1.3 |

> **What follows is the original finding, preserved unedited as the record of what was wrong.**

**Vulnerability.** The single browser→API funnel short-circuits on a value the browser itself owns. `apiRequest` consults `isDemoMode()` before building any request; `isDemoMode()` is nothing more than a `sessionStorage` string comparison. The credential that is supposed to gate entry into that mode, `DEMO_PASSWORD`, is a plain module-scope constant in a client module that is transitively imported by `lib/api.ts`, so it is compiled into the JavaScript served to every visitor.

**Evidence.**

`frontend/src/lib/api.ts:114-127`:
```ts
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // The demo account is served entirely from the browser. This is the only
  // branch in the app that diverges: no request is built, no token is attached,
  // and nothing leaves the tab. Normal sessions fall straight through.
  if (isDemoMode()) {
    try {
      return await demoRequest<T>(path, options);
```

`frontend/src/lib/demo/session.ts:23-25`:
```ts
export function isDemoMode(): boolean {
  return storage()?.getItem(DEMO_SESSION_KEY) === ACTIVE;
}
```

`frontend/src/lib/demo/api.ts:240-246` — the forged session is minted with no credential of any kind:
```ts
function auth(action: string, method: string): unknown {
  if (action === "refresh" && method === "POST") {
    // Deliberately empty. Nothing in demo mode reaches a server, and an empty
    // token means no Authorization header could be attached even if some
    // future code path did try.
    return { accessToken: "", user: DEMO_SESSION_USER };
  }
```

`frontend/src/lib/demo/config.ts:14-15` — the shipped credential (value redacted):
```ts
export const DEMO_EMAIL = "demo.employee@risenext.com";
export const DEMO_PASSWORD = "<REDACTED — see file:line>";
```

**Bundle-reachability chain, verified link by link.** `lib/api.ts:10` imports `demoRequest` from `@/lib/demo/api`; `lib/demo/api.ts:20-25` imports from `./config`; `config.ts:81-83` defines `isDemoCredentials`, whose body dereferences `DEMO_PASSWORD`; `lib/demo/index.ts:8-14` re-exports `isDemoCredentials`; `hooks/use-auth.tsx:12-19` imports it and calls it at `use-auth.tsx:174`. Every page in the app is `"use client"`. The constant is therefore live-referenced from a client entry point and cannot be tree-shaken.

**Impact.**

1. **Zero-credential UI access.** Executing `sessionStorage.setItem("risenext.demo.session", "active")` in devtools and reloading is sufficient. `AuthProvider`'s mount effect (`use-auth.tsx:116-142`) calls `apiRequest("/auth/refresh")`, which is answered locally with `DEMO_SESSION_USER` — a full Executive identity with 12 permissions and two bank IDs (`demo/api.ts:60-70`). No password is required, the flow never touches the backend, and no audit row is ever written.
2. **Silent substitution of fabricated data under a real session.** The check at `api.ts:118` runs on *every* call and does not consult who is signed in. If the flag is set while a genuine user is authenticated, all subsequent list and detail responses are served from the fixture store (`lib/demo/store.ts`) while the UI continues to present them as live banking records. This is a data-integrity deception, not merely a display bug.
3. **Shipped hardcoded credential in a lending product.** Anyone who opens the deployed bundle recovers a working sign-in for the production frontend.
4. **Sticky-flag lockout.** `disableDemoMode` has exactly one call site — `use-auth.tsx:212`, inside the demo branch of `signOut` (confirmed by exhaustive grep: the only other references are the definition at `demo/session.ts:36`, the re-export at `demo/index.ts:16`, and the import at `use-auth.tsx:14`). `signIn`'s real branch never clears it. Once set, a genuine login attempt is routed to `demoRequest`, hits `auth("login")`, and throws `notFound("Endpoint")` (`demo/api.ts:249`) — the user cannot sign in at all until the tab is closed.

**Abuse scenario.** An analyst on a shared workstation opens the deployed CRM, pastes one line into the console, and reloads. They are inside the workspace as "Karthik Rao, Executive". A colleague glancing at the screen sees a normal session. Every customer record, loan and disbursement shown is fabricated, and nothing about the episode exists in `audit_logs` — the backend was never contacted. Separately, an attacker who lands *any* script execution on the frontend origin (see SEC-011, which removes the CSP that would have blocked it) sets the same flag on a real user's live session and silently replaces every figure that user reads for the remainder of the tab's life.

**Recommended remediation.**
1. Delete `frontend/src/lib/demo/` from the production build path entirely. If the walkthrough must survive, gate the whole directory behind a build-time constant (`process.env.NEXT_PUBLIC_DEMO === "1"`) so the bundler eliminates it, and never set that variable in the production environment.
2. Remove `DEMO_PASSWORD` from source unconditionally. A credential that is compared in the browser cannot be a secret; if a presentation account is required, seed it in the database and let it authenticate through `POST /api/auth/login` like every other account.
3. If demo mode survives as a build-time feature, move the branch out of `apiRequest` and behind an explicit provider swap, so a runtime storage value can never redirect a real session's data source.
4. Call `disableDemoMode()` unconditionally at the top of `signIn` and at the top of the forced-sign-out handler.

---

## SEC-002 — Unauthenticated, unthrottled, attacker-controlled inserts into the immutable `audit_logs` table

| | |
|---|---|
| **Severity** | CRITICAL |
| **Location** | `src/modules/auth.routes.ts:104,127`; `src/services/audit.ts:80-99`; `drizzle/0001_governance_guards.sql:6-18` |
| **Status** | OPEN |
| **Phase** | **P0** |

**Vulnerability.** `POST /api/auth/login` is unauthenticated and unthrottled, and every failed attempt — including attempts against email addresses that do not exist — writes a row into `audit_logs`. That table is protected by a `BEFORE UPDATE OR DELETE` trigger that raises an exception for any non-INSERT operation, so the rows can never be corrected or pruned while the trigger is in place. The attacker controls the content of several columns.

**Evidence.**

`src/modules/auth.routes.ts:127` — the unknown-account path still writes:
```ts
await recordAuthEvent(db, req, "login_failed", normalised, account?.id ?? null, "Bad credentials");
```

`src/modules/auth.routes.ts:23-26` — `email` is *not* validated as an email address, so `actor_email` is arbitrary attacker text:
```ts
const loginSchema = z.object({
  email: z.string().min(3).max(255),
  password: z.string().min(1).max(512),
});
```

`src/services/audit.ts:88-98` — the row, with the raw `User-Agent` header carried through:
```ts
  await db.insert(auditLogs).values({
    actorId: userId,
    actorEmail: email,
    action,
    recordType: "auth",
    recordId: userId,
    summary,
    ipAddress: req?.ip ?? null,
    userAgent: req?.headers["user-agent"] ?? null,
    requestId: req?.requestId ?? null,
  });
```

`drizzle/0001_governance_guards.sql:6-18` — append-only, enforced in the database:
```sql
CREATE OR REPLACE FUNCTION audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
...
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
```

`src/db/schema/governance.ts:30,43` — both attacker-controlled columns are unbounded `text`:
```ts
    actorEmail: text("actor_email"),
    ...
    userAgent: text("user_agent"),
```

The locked-account path writes a *second* row before rejecting (`auth.routes.ts:104`), so a locked account is a cheaper write target than an unlocked one — no argon2 verification is performed on that branch.

**Impact.**
- **Unbounded write amplification against a table that cannot be cleaned.** With `actor_email` capped at 255 characters by Zod and `user_agent` capped only by Node's HTTP header limit, each request deposits roughly 8–16 KB of attacker-chosen text. There is no rate limit anywhere in the stack (SEC-005), so the ceiling is network throughput. On Neon, storage is billed and a full disk stops the entire application.
- **Forensic poisoning.** The evidentiary value of the audit trail is the reason it is immutable. An attacker can flood it with millions of `login_failed` rows carrying forged `actor_email` values that impersonate real staff, permanently, burying any genuine incident. `GET /api/audit-logs` (`admin.routes.ts:902`) offers filtering by `recordType`, `recordId` and `action` but not by date range or actor, and it hard-caps at `pageSize` 500.
- **Irreversible by design.** Cleaning up requires `DROP TRIGGER` — that is, deliberately disabling the control this system's compliance story rests on, with direct database credentials.
- **Log injection.** Newlines and control characters in `actor_email` are not stripped, so any downstream tool that renders the audit table as text is subject to line-splitting.

**Abuse scenario.** A competitor or a disgruntled ex-employee points a trivial script at `POST /api/auth/login` with a rotating 255-character `email` field and a 16 KB `User-Agent`. Within hours the `audit_logs` table has grown by tens of gigabytes, database cost alarms fire, and the RBI-facing audit trail for the affected period is unusable. There is no supported way to remove the rows, and the operator must choose between a full storage outage and dropping the immutability trigger.

**Recommended remediation.**
1. Rate-limit `POST /api/auth/login` per source IP *and* per submitted identifier, ahead of any database write. See SEC-005.
2. Stop writing a `login_failed` audit row for identifiers that do not resolve to an account; count those in a metric instead. The audit trail should record events about *subjects that exist*.
3. Validate the login identifier (`.email()`), and truncate `user_agent` and `summary` to fixed lengths in `recordAudit`/`recordAuthEvent` before insert.
4. Introduce a partitioned or retention-managed authentication-event table separate from `audit_logs`, so authentication noise cannot compete for storage with business-record history. Keep the immutability trigger on `audit_logs`.

---

## SEC-003 — Irreversible super-admin lockout via `PATCH /api/users/:id`

| | |
|---|---|
| **Severity** | CRITICAL — see the severity qualifier below |
| **Location** | `src/modules/admin.routes.ts:251-314` (compare `434-469`); `src/services/access.ts:59,151-156`; `src/db/seed.ts:104-108` |
| **Status** | ✅ **RESOLVED 2026-09-02** (Tasks 2.1 + 2.2) |
| **Phase** | **P0** |

> ### ✅ RESOLVED — Tasks 2.1 + 2.2, 2026-09-02
>
> Three parts, one of which is deliberately *not* a copy of what `DELETE` does.
>
> **1. A field-scoped self-guard on `PATCH`** (`admin.routes.ts:282-310`). `DELETE`'s blanket `id === ctx.userId` refusal is **not** copyable to `PATCH`: a Super Admin must still be able to edit their own name, phone or branch, and Task 2.4's edit form will submit every field at once. Each rule therefore compares against the value already stored and refuses only a **real** change:
> ```ts
> if (id === ctx.userId) {
>   if (input.status === "Inactive" && target.status !== "Inactive") {
>     throw badRequest("You cannot deactivate your own account");
>   }
>   if (input.roleId !== undefined && input.roleId !== target.roleId &&
>       target.roleIsSystem && !nextRoleIsSystem) {
>     throw badRequest("You cannot remove the Super Admin role from your own account");
>   }
> }
> ```
> Echoing your current status or your current role back is a no-op and stays 200 — asserted by three tests, and a mutation that refuses on mere *presence* of the fields fails four of them.
>
> **2. One shared invariant** — `assertSuperAdminRemains` in `services/access.ts:183-275` — called by **both** `PATCH` (`:313`) and `DELETE` (`:492`). Callers describe the **proposed end state**, so one rule covers three different writes: `status → Inactive`, `roleId → a non-system role`, and `DELETE`'s soft delete. Both fields are covered; a status-only fix would have left the `roleId` path open, and that path is the *quieter* of the two — the account stays Active, re-login returns 200, and every administrative call then returns a bare `forbidden` that the Task 1.8 client deliberately does not sign out on.
>
> **3. The self-guard and the invariant are independent rules, not one rule.** Measured: deactivating yourself while a peer Super Admin exists leaves `remaining = 1`, so the invariant is satisfied — and you are still permanently locked out, because reactivation needs `users.edit`, which needs an Active account. Both guards are required and both are separately reversion-proven.
>
> **What was NOT done, and why.** Remediation item 3 (a database trigger) was **rejected on measured grounds**: a table-wide aggregate cannot be a `CHECK`, so it needs a trigger raising `restrict_violation` (`23001`), and `middleware/error-handler.ts` maps only `23505` and `23503` — `23001` falls through to the terminal branch and becomes a **500 with an error-level stack trace**. Turning it into a clean 409 would require adding a SQLSTATE mapping to `error-handler.ts`, which **D-021 explicitly forbids**. Remediation item 4 (a `db:recover-superadmin` break-glass script) is an operational deliverable, not a guard, and remains **open**. Both are recorded in **D-022**.
>
> **Not race-safe, and said plainly.** The count and the write are separate statements with no lock — exactly as `DELETE` has always been, and as every other check-then-write precondition in this codebase is. Two simultaneous destructive requests could still both observe a survivor. That closes the single-actor path, which is 100% of the realistic scenario (one administrator, one mis-click), and leaves the concurrent one open as **BUG-037**.
>
> **Verified:** 26 new tests (`src/tests/super-admin-lockout.test.ts`), backend **197/197**. Nine of them fail against the pre-fix code. Four independent mutations were applied and reverted: disabling the self-guard fails tests 1/2/2b, disabling the invariant fails 3/4/4b/15/19, restoring the pre-2.2 count fails **only** test 18, and making the self-guard fire on mere field presence fails 6/7/8/9.

**Severity qualifier, recorded honestly (2026-09-02).** The severity model above defines CRITICAL as reachable *"by an attacker with no privileged position"*. This finding requires the **most** privileged position in the system, and its dominant realistic trigger is an **accident** — a mis-click on the UI's own "Revoke access" button — not an attack. It is retained at **CRITICAL** on the strength of the other limb: the system is rendered **permanently unrecoverable in-product**, one click, with no API recovery path, and the audit row proving what happened cannot be read afterwards because reading it needs a session. The trigger is privileged and usually accidental; the impact is permanent administrative unrecoverability. Either the qualifier or the severity model's wording should be revisited in Phase 13; the contradiction is stated rather than left silent.

**Vulnerability.** The soft-delete route carries two safety interlocks. The update route, which can reach the same end state through the `status` field, carries neither.

`DELETE /api/users/:id` refuses self-deletion and refuses to remove the last active holder of the system role:

`src/modules/admin.routes.ts:438,443-451`:
```ts
    if (id === ctx.userId) throw badRequest("You cannot delete your own account");
...
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

`PATCH /api/users/:id` has no equivalent guard. Its only authorisation check is the role-level rule, and `status` is a freely writable field:

`src/modules/admin.routes.ts:258-261,285`:
```ts
    const target = await targetUserRole(id);
    // Blocks editing a peer or a superior, which is what stops an Admin
    // touching a Super Admin.
    assertCanManageRoleLevel(ctx, target.roleLevel);
...
        ...(input.status !== undefined ? { status: input.status } : {}),
```

`src/services/access.ts:151-156` — a Super Admin holds `system.manage_any_user` (via the `"*"` grant at `src/lib/permissions.ts:190-198`) and therefore returns at the first line, bypassing the level comparison for *any* target including themselves:
```ts
export function assertCanManageRoleLevel(ctx: AuthContext, targetLevel: number): void {
  if (hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) return;
  if (targetLevel <= ctx.roleLevel) {
    throw forbidden("You cannot manage a user at or above your own role level");
  }
}
```

**Impact.** `status: "Inactive"` is terminal. Both entry points to the system reject the account:

- Login: `src/modules/auth.routes.ts:131` — `if (account.status !== "Active") throw forbidden("Account is not active");`
- Every authenticated request: `src/services/access.ts:59` — `if (row.status !== "Active") throw accountInactive();`, i.e. **403 `account_inactive`**. *(Was cited as `:52` with `forbidden(…)`; Task 1.8 changed both the line and the code. Corrected 2026-09-02.)* Since Task 1.8 the client also **force-signs-out on that code**, so a self-inflicted lockout is now immediate rather than lasting until token expiry — the consequence is worse, not better.

Recovery inside the product requires `users.edit`, which requires a session, which requires an Active account. There is no break-glass route. The seed script is **not** a recovery path — it returns early when the email already exists and explicitly leaves the record untouched:

`src/db/seed.ts:104-108`:
```ts
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    logger.info(`Super admin ${email} already exists — leaving the password untouched`);
    return;
  }
```

The same route also permits `roleId` to be changed to a lower-authority role, producing the identical unrecoverable state by a second path (`admin.routes.ts:263-267,283`).

Recovery therefore requires direct `psql` access to Neon with production credentials — a capability many deployment models deliberately withhold from the operations team that would need it.

**Abuse scenario.** During a routine offboarding an administrator opens the employee list, mis-clicks one row, and saves with Status set to Inactive. The row was the organisation's only Super Admin. The API returns `200 OK`. From that moment nobody can create users, manage roles, view the audit log, or reactivate the account, because every administrative permission ultimately lives on accounts a Super Admin manages. The CRM is intact and running; it is simply no longer administrable. A malicious insider with the Super Admin role achieves the same outcome deliberately with one request, and the `audit_logs` row proving it (`admin.routes.ts:302-308`) cannot be read afterwards because reading it needs a session.

**Recommended remediation.**
1. ✅ **DONE (2.1).** Lift both interlocks from `DELETE` into a shared `assertNotLastSuperAdmin(targetId, nextStatus, nextRoleId)` helper and invoke it from `PATCH` before the update, covering the `status → Inactive` transition *and* the `roleId → non-system role` transition. *Implemented as `assertSuperAdminRemains(db, targetId, before, after)` — the end-state form, because that is the only shape that also expresses `DELETE`'s soft delete and fixes Task 2.2's false refusal in the same statement.*
2. ✅ **DONE (2.1), but deliberately not "the same rule".** Reject self-deactivation and self-demotion in `PATCH` with the same rule already present at `admin.routes.ts:438`. *`:438`'s rule is unconditional; copying it verbatim would have blocked a Super Admin editing their own name. The `PATCH` guard is field-scoped and change-scoped instead. See D-022.*
3. ❌ **REJECTED, measured.** Enforce the invariant in the database as well, as a partial unique/guard trigger. *A table-wide aggregate cannot be a `CHECK`; the trigger's `restrict_violation` (`23001`) is unmapped in `error-handler.ts` and would surface as a 500, and mapping it there is forbidden by D-021. Recorded in D-022.*
4. ⬜ **STILL OPEN.** Document a break-glass procedure (a `db:recover-superadmin` script, run with `DIRECT_DATABASE_URL`) and add it to the runbook, so recovery does not depend on an engineer improvising SQL under pressure. *Not a guard and not in Task 2.1/2.2's scope. Carried forward.*

**Discovered while closing this finding, and NOT fixed:** `PATCH /api/users/:id` **silently reactivates a deactivated account** on any partial update, because `userInput.partial()` does not suppress `.default("Active")` in zod 4.4.3 — a name-only PATCH writes `status: "Active"` and also resets `target`/`achieved` to `0`. Measured over real HTTP. It does not weaken this fix (the injected default is `Active`, the safe direction, and both guards compare against the stored value), but revoked access being restored by a rename is its own access-control defect. Filed as **[BUG-036](BUGS_AND_ISSUES.md#bug-036)**, HIGH, open.

---

# HIGH

## SEC-004 — User enumeration via a 429 that only an existing account can produce

| | |
|---|---|
| **Severity** | HIGH |
| **Location** | `src/modules/auth.routes.ts:103-106,113-129`; `src/lib/errors.ts:37-38` |
| **Status** | OPEN |
| **Phase** | P1 |

**Vulnerability.** The login handler goes to visible lengths to equalise the unknown-account and wrong-password responses — both return `401 "Invalid email or password"`, and a static argon2id digest is verified for unknown accounts so the timing matches. The lockout branch undoes it. Lock state is stored on the `users` row, so only an account that exists can ever be locked, and only a locked account produces a `429`.

**Evidence.**

`src/modules/auth.routes.ts:103-113`:
```ts
    if (account?.lockedUntil && account.lockedUntil > new Date()) {
      await recordAuthEvent(db, req, "login_failed", normalised, account.id, "Account locked");
      throw tooManyRequests("Account temporarily locked. Try again shortly.");
    }

    // Always run a verification so response timing does not reveal whether the
    // address exists. The dummy hash below is a real argon2id digest.
    const hash = account?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(hash, password);
```

`src/modules/auth.routes.ts:28` — the threshold is a known constant, so the probe length is known: `const MAX_FAILED_ATTEMPTS = 8;`

`src/lib/errors.ts:37-38` — the distinguishing status and message:
```ts
export const tooManyRequests = (message = "Too many attempts, try again later") =>
  new AppError(429, "too_many_requests", message);
```

**Impact.** Nine requests per candidate address yield a definitive existence oracle: nine `401`s means no such account, eight `401`s followed by a `429` means the account exists. With no rate limiting (SEC-005), a corporate email-format guess list of thousands of names can be resolved in minutes. The result is a confirmed roster of staff email addresses at a lending business — directly weaponisable for credential stuffing and for finance-sector phishing.

The probe is not passive: it leaves each confirmed account locked (SEC-006) and deposits nine rows per candidate in the immutable audit table (SEC-002).

**Abuse scenario.** An attacker preparing a business-email-compromise campaign scripts `firstname.lastname@risenext.in` across a list scraped from LinkedIn. Nine POSTs per name separate real accounts from noise with certainty. The attacker now has a verified employee list, knows the lockout threshold is 8, and — as a side effect — has locked every confirmed account, which they can hold locked indefinitely (SEC-006) while a spoofed "IT helpdesk" email offers to restore access.

**Recommended remediation.**
1. Return the same `401 "Invalid email or password"` for the locked branch. Lockout is a server-side control; the client does not need to be told it fired.
2. Apply the per-IP throttle (SEC-005) *before* the account lookup, so an attacker exhausts an IP budget rather than an account's lock counter.
3. If operators need lockout visibility, expose it on the authenticated admin surface (employee list / audit log), never on the anonymous login response.

---

## SEC-005 — No HTTP rate limiting anywhere; argon2id pile-up denial of service

| | |
|---|---|
| **Severity** | HIGH |
| **Location** | `src/app.ts:44-99`; `package.json:19-33`; `src/lib/password.ts:8-25`; `src/modules/auth.routes.ts:111` |
| **Status** | OPEN |
| **Phase** | **P0** |

**Vulnerability.** The middleware stack contains no rate limiter, no request throttle and no concurrency guard. Every one of the 96 endpoints — authenticated or not — accepts unlimited requests. The only throttling construct in the entire codebase is the per-account lockout at `auth.routes.ts:28-29`, which is applied *after* the database lookup and does not bound request volume.

**Evidence.**

`src/app.ts:44-76` is the complete middleware chain: helmet, cors, a request-id assigner, `express.json`, `express.urlencoded`, `cookieParser`, `pinoHttp`. Nothing else precedes the routers at lines 78-99.

`package.json` dependency list (lines 19-33) contains `argon2`, `cookie-parser`, `cors`, `dotenv`, `drizzle-orm`, `exceljs`, `express`, `helmet`, `jsonwebtoken`, `multer`, `pg`, `pino`, `pino-http`, `zod`. There is no `express-rate-limit`, no `express-slow-down`, no `rate-limiter-flexible`. Confirmed by grep across `src` and `package.json` for `rate-limit|rateLimit|slow-down`: zero matches.

`src/lib/password.ts:8-13` — each verification allocates 19 MiB:
```ts
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
```

`src/modules/auth.routes.ts:110-111` — and it runs unconditionally, including for addresses that do not exist:
```ts
    const hash = account?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(hash, password);
```

**Impact.** `POST /api/auth/login` is an unauthenticated amplification primitive: a request of a few hundred bytes forces a 19 MiB, two-pass memory-hard KDF plus two database round trips. `node-argon2` dispatches to the libuv thread pool (four threads by default), so the pool saturates almost immediately and the queue grows without bound. Because the pool is *shared* — `pg` uses it for DNS and TLS, `ExcelJS` for zlib — saturating it degrades every other route, not just login. The deployment target named in the code comments is "a small Railway container" (`password.ts:5-7`), where the memory headroom for a queue of in-flight hashes is small.

Every request in the flood additionally writes an immutable audit row (SEC-002), so the attack simultaneously consumes CPU, memory, thread-pool capacity, database write throughput, and permanent storage.

The absence of throttling is also the multiplier on SEC-004 (enumeration becomes free) and SEC-006 (permanent lockout becomes free), and it removes the only practical brake on brute-forcing accounts that are *not* yet locked.

**Abuse scenario.** A single host opens 500 concurrent POSTs to `/api/auth/login` with random addresses. The thread pool saturates; p99 latency across the whole API climbs into tens of seconds; health checks against `/api/health/ready` (which does hit the database) begin timing out; Railway restarts the container; the flood resumes against the cold instance. No credential is ever needed and the attack costs the attacker almost nothing.

**Recommended remediation.**
1. Add `express-rate-limit` (or the platform edge equivalent) as the first middleware after `trust proxy`. Suggested budgets: `/api/auth/login` 10 requests / 15 min per IP and 5 per identifier; all other routes 300 / 15 min per IP; `/api/imports/*` 5 / hour per user.
2. Move the throttle *before* the `users` lookup and before the argon2 call, so a flood is rejected without touching the database or the thread pool.
3. Raise `UV_THREADPOOL_SIZE` deliberately and cap concurrent argon2 verifications with a semaphore, so login pressure cannot starve `pg`.
4. Add a body-size and connection cap at the edge. `express.json({ limit: "1mb" })` (`app.ts:70`) bounds a single body but not the request rate.

---

## SEC-006 — Sticky lockout counter enables permanent remote account denial of service

| | |
|---|---|
| **Severity** | HIGH |
| **Location** | `src/modules/auth.routes.ts:113-137` |
| **Status** | OPEN |
| **Phase** | P1 |

**Vulnerability.** `failed_login_attempts` is a monotonic counter that is reset in exactly two places: a *successful* login, and an administrative password reset. It never decays with time. The lockout condition is evaluated against the raw counter, so once it has crossed the threshold, every subsequent failure re-arms a fresh 15-minute lock.

**Evidence.**

`src/modules/auth.routes.ts:113-129`:
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

`src/modules/auth.routes.ts:134-137` — the only in-band reset, reachable only by succeeding:
```ts
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, account.id));
```

**Impact.** After the eighth failure the counter sits at 8 permanently. When the 15-minute window lapses, the very next wrong password computes `attempts = 9 >= 8` and locks the account again. The steady-state cost to the attacker is **one HTTP request every fifteen minutes** — 96 requests per day — to hold a named account offline indefinitely. There is no rate limit to interfere (SEC-005) and the target account is trivially identified (SEC-004).

The victim's only escape is a race: log in successfully during the sliver between lock expiry and the attacker's next probe. Practically, recovery requires an administrator to call `POST /api/users/:id/reset-password`, which does clear both fields (`admin.routes.ts:352-354`, working tree) — but that route does not exist at HEAD, so at the audited commit there is **no** in-product recovery for a locked account at all.

Because the locked branch short-circuits before the argon2 verification (`auth.routes.ts:103-106`), holding an account locked is also the *cheapest* possible request for the attacker and the most expensive for the audit table.

**Abuse scenario.** On the morning of a month-end settlement run, an attacker who enumerated the finance team via SEC-004 starts a cron job: one wrong password per account every fourteen minutes. Every settlement approver is locked out. The administrator who could reset them is on the same list. At HEAD there is no reset endpoint, so the only remedy is direct database access — while disbursement deadlines pass.

**Recommended remediation.**
1. Reset `failed_login_attempts` to `0` whenever `locked_until` has elapsed, before evaluating the new attempt. That turns the counter into a genuine sliding window.
2. Prefer exponential backoff keyed on the *source* over an account-wide lock: an account-scoped lock is by construction a remote DoS primitive, because the attacker chooses whose account it is.
3. Combine with the per-IP throttle from SEC-005 so a single source cannot reach the threshold on many accounts.
4. Alert on lock events (`login_failed` / `"Account locked"` rows already exist in `audit_logs`) so a lockout campaign is visible rather than merely experienced.

---

## SEC-007 — `aadhaar_hash` returned by `SELECT *` under a committed default pepper with a `NODE_ENV`-only guard

| | |
|---|---|
| **Severity** | HIGH |
| **Location** | `src/config/env.ts:25,44-47`; `src/lib/password.ts:35-37`; `src/modules/customers.routes.ts:78-84,123-132,152-160` |
| **Status** | OPEN |
| **Phase** | **P0** |

**Vulnerability.** Aadhaar numbers are stored as `sha256(pepper + ":" + aadhaar)`. Three facts combine to defeat that: the pepper has a default value committed to the repository; the guard that rejects that default fires only when `NODE_ENV` is *literally* the string `"production"`; and the resulting hash is returned to every caller holding `customers.view`, because the customer read routes use an unprojected `SELECT *`.

**Evidence.**

`src/config/env.ts:25` (value redacted):
```ts
  AADHAAR_PEPPER: z.string().min(16).default("<REDACTED — committed default>"),
```

`src/config/env.ts:44-47` — the guard is conditional on a self-declared environment string:
```ts
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.AADHAAR_PEPPER === "<REDACTED>") {
      throw new Error("AADHAAR_PEPPER must be set to a unique value in production");
    }
```

`src/config/env.ts:5` — and `NODE_ENV` silently defaults to `development`:
```ts
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
```

`src/lib/password.ts:35-37` — a single unsalted, uniterated SHA-256:
```ts
export function peppered(value: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}
```

`src/modules/customers.routes.ts:123-129` and `152-156` — no column projection, so `aadhaar_hash` and `aadhaar_last4` ship to the client:
```ts
    const rows = await db
      .select()
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
```

`.env.example` (33 lines, read in full) does **not** mention `AADHAAR_PEPPER` at all — the operator is never told the variable exists.

**Impact.** The Aadhaar keyspace is 10¹² — a bounded, fully enumerable domain. A single unstretched SHA-256 over that space is minutes of work on commodity GPU hardware, and `aadhaar_last4` is stored and returned alongside the hash (`customers.routes.ts:78-84`), collapsing the search to 10⁸. The pepper is the only thing standing between the stored value and the plaintext, and:

> **Narrowed 2026-09-02 by Task 1.7 — still OPEN.** `NODE_ENV` is now required (**SEC-028**), so the *unset* path below — the one the abuse scenario turns on — fails at boot. A deployment that sets `NODE_ENV=development` **deliberately** still bypasses the pepper guard, so this finding stands on its own merits and remediation #2 (drop the `NODE_ENV` condition entirely) is unchanged.

- If the service starts with `NODE_ENV` unset, or set to anything other than exactly `"production"` — `Production`, `prod`, `staging`, or simply omitted from a container's environment — the guard at line 44 does not run and the **committed default pepper is used silently at boot**. Nothing logs a warning.
- Under that condition, every `aadhaar_hash` in the API response is directly reversible by anyone who has read the repository.
- Even with a strong secret pepper, the design is fragile: a single SHA-256 with no iteration count means the day the pepper leaks (a log, a heap dump, a `.env` in a support bundle), the entire Aadhaar corpus is recovered offline in minutes. There is no work factor to buy time.
- The hash is exposed to the *lowest* privileged role that can read customers. `executive` (level 40) holds `customers.view` (`src/lib/permissions.ts:290-303`) and receives the field on every list page.

This is India-regulated identity data. The Aadhaar Act's storage and disclosure provisions, and RBI's data-localisation and customer-data expectations for lending entities, are directly engaged.

**Abuse scenario.** The service is deployed to a container platform where `NODE_ENV` is not explicitly set — the exact default the schema encodes. The guard never runs. A field executive with the narrowest role in the product opens `/customers`, presses F12, and copies `aadhaar_hash` for 500 customers out of the network tab. Because the pepper is in the public repository, they reverse all 500 Aadhaar numbers on a laptop over lunch. Nothing in `audit_logs` distinguishes this from ordinary browsing — the read was authorised.

**Recommended remediation.**
1. Remove the default. Make `AADHAAR_PEPPER` a required variable with no fallback, so a misconfigured deployment refuses to boot instead of silently degrading. This is the pattern already used for `JWT_ACCESS_SECRET` (`env.ts:11`).
2. Delete the `NODE_ENV === "production"` condition around the check at `env.ts:44` — the pepper must never be the committed value in *any* environment that holds real data.
3. Project the customer read routes explicitly. `aadhaar_hash` has no client consumer; only `aadhaar_last4` is ever displayed. Verified: zero frontend references to `aadhaarHash`.
4. Replace `peppered()` with an HMAC using a dedicated key from a KMS, and stretch it (scrypt/argon2id) so an offline attack against 10¹² candidates is not economically trivial even after key compromise.
5. Add `AADHAAR_PEPPER` to `.env.example` with generation instructions, alongside the existing `openssl rand -base64 48` note for the JWT secrets (SEC-025).

---

## SEC-008 — Excel import: zip-bomb decompression and an unbounded row loop

| | |
|---|---|
| **Severity** | HIGH |
| **Location** | `src/modules/imports.routes.ts:27-29,167,217-278,306-315` |
| **Status** | OPEN |
| **Phase** | P1 |

**Vulnerability.** The upload limit bounds the *compressed* payload. `.xlsx` is a ZIP container; `ExcelJS` inflates it fully into process memory with no expansion ratio check, no cell-count cap and no row cap. The parse loop then iterates to `sheet.rowCount` — a value taken from the attacker's file — and the result is inserted in a single unbatched statement.

**Evidence.**

`src/modules/imports.routes.ts:27-29` — the limit applies to the uploaded bytes only:
```ts
  uploadMiddleware ??= multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
```

`src/modules/imports.routes.ts:167` — full in-memory inflation, no guard:
```ts
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
```

`src/modules/imports.routes.ts:217-218` — the loop bound is attacker-supplied:
```ts
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
```

`src/modules/imports.routes.ts:306-315` — every staged row, valid or not, is inserted in one statement:
```ts
        await tx.insert(importRows).values(
          staged.map((r) => ({
            batchId: created!.id,
            rowNumber: r.rowNumber,
            raw: r.raw as never,
            normalised: r.normalised as never,
            status: r.status,
            errors: r.errors as never,
          })),
        );
```

Aggravating: `imports.routes.ts:199-206` loads **every** non-deleted customer's `bankId` and `bankReferenceId` into a `Set` on each upload, with no bank scoping and no limit — a second unbounded allocation that grows with the customer table.

`MAX_UPLOAD_MB` defaults to 10 (`env.ts:24`). The route requires `customers.import`, held by `team_leader` (level 30) and above (`permissions.ts:270`), so the attacker only needs the second-lowest role in the product.

**Impact.** Spreadsheet XML compresses at ratios well beyond 1000:1; a 10 MB upload can inflate to multiple gigabytes of XML plus the `ExcelJS` object graph. On a small container the process is OOM-killed. Short of that, `staged` holds one object per row and the single `INSERT` builds a statement with `rowCount × 6` bound parameters — Postgres caps a statement at 65535 parameters, so past roughly 10,900 rows the request fails *after* all the memory has been consumed and the work done. Neither outcome is handled: there is no row cap, no chunking and no streaming.

The whole loop runs inside the request; `express.json`'s 1 MB limit is irrelevant to a multipart body.

**Abuse scenario.** A team leader — or anyone who has phished one — uploads a 6 MB `.xlsx` whose sheet declares two million rows of highly compressible content. The container's memory ceiling is reached during `workbook.xlsx.load`, the process dies mid-request, Railway restarts it, and every in-flight session across the CRM drops. Repeating the upload on a timer keeps the service in a restart loop. No warning is generated because the request never reaches the point where anything is logged.

**Recommended remediation.**
1. Reject the workbook before parsing if the declared uncompressed size exceeds a ratio threshold (inspect the ZIP central directory), and cap total inflated bytes.
2. Enforce a hard row cap (5,000 is generous for this use case) and a column cap, and reject with `400` rather than parsing to exhaustion.
3. Stream with `ExcelJS`'s `WorkbookReader` instead of `workbook.xlsx.load`, so the whole file is never resident.
4. Chunk the `import_rows` insert (500 rows per statement) to stay clear of the parameter ceiling.
5. Scope and bound the duplicate-reference pre-load at line 199: filter by the caller's banks and by the reference values actually present in the file.
6. Rate-limit `/api/imports/*` per user (SEC-005) — this route is the most expensive in the API by a wide margin.

---

## SEC-009 — Plaintext Aadhaar and full customer PII persisted indefinitely in `import_rows`

> ### 2026-09-06 (Wave 5) — the retention half is BUILT, and the finding stays OPEN
>
> `src/jobs/expire-import-batches.ts` expires batches past `expires_at` and **destroys their staged rows**, keeping the batch record and its counts. `import_rows.raw` is where the plaintext Aadhaar lives; `jobs.test.ts` case 8 seeds a recognisable value, runs the job, and asserts it is **absent from the database** — the only form of evidence worth having for a retention claim. Case 12 asserts the audit row carries counts and **not** the content, because `audit_logs` is trigger-immutable with no purge path and writing it there would move the problem rather than solve it.
>
> **It is not in effect.** Nothing runs until an external scheduler invokes `node dist/jobs/run.js expire-import-batches`. The finding is closed the day the operator schedules it and the query in `RUNBOOK.md` §4 reads zero — not the day the test went green.

| | |
|---|---|
| **Severity** | HIGH |
| **Location** | `src/modules/imports.routes.ts:219-222,271-277,306-315,324,351`; `src/services/recycle-bin.ts:239-251` |
| **Status** | **OPEN · P0** · **Owner: Phase 13.7 + Phase 15.9** (assigned 2026-09-06 — see below) |

> ### ⚠️ OWNERSHIP ASSIGNED — 2026-09-06 (Wave 0)
>
> **This finding had no roadmap row.** The master production-readiness audit found it orphaned: **13.7** hardens the importer (magic bytes, decompression ceiling, row cap, 4xx instead of 500) and does **not** address persistence; **15.9** builds the scheduled-job runner and lists "import-batch expiry" among its first jobs without naming this finding. Between them the gap was real — a P0 with nobody accountable.
>
> **It is now explicitly owned by both, and neither alone closes it:**
>
> | Row | Obligation |
> |---|---|
> | **13.7** | Stop writing raw Aadhaar into `import_rows` in the first place, or write it peppered as `customers` already does. Ingest-side. |
> | **15.9** | Purge or anonymise staged rows once a batch is confirmed or expires. `import_batches` already carries a 24-hour expiry that nothing acts on, for the same reason `recycle_bin_entries.purge_after` is stamped and never honoured: **there is no scheduler.** Retention-side. |
>
> **Nothing about this finding is fixed by the assignment.** Raw Aadhaar and full customer PII still sit in `import_rows` indefinitely today. The retention *period* is an owner question travelling with the DPDP review (roadmap 16.5), which must answer it before 15.9's job can be written to a number.
| **Phase** | **P0** |

**Vulnerability.** `customers.routes.ts:77` states the design intent plainly: *"Aadhaar never lands in a column in the clear."* The import pipeline violates it. Every uploaded row is staged verbatim — including the Aadhaar column — into two `jsonb` columns, and those rows are never deleted.

**Evidence.**

`src/modules/imports.routes.ts:219-222` — the raw cell text, including Aadhaar, is captured:
```ts
        const raw: Record<string, string> = {};
        headerMap.forEach((key, colNumber) => {
          raw[key] = cell(row.getCell(colNumber).value);
        });
```

`src/modules/imports.routes.ts:271-277` — and the parsed copy retains it too, because `parsed.data` includes `aadhaar` (`rowSchema`, lines 83-88):
```ts
        staged.push({
          rowNumber,
          raw,
          normalised: bank ? { ...parsed.data, bankId: bank.id } : null,
          status,
          errors: errors.length ? errors : null,
        });
```

Both are written to `import_rows` at lines 306-315. The hashing that protects the `customers` table is applied only at confirm time, to the destination row (`imports.routes.ts:414`) — never to the staging row.

Both are returned to the client: `imports.routes.ts:324` (`preview: staged.slice(0, 50)`) and `imports.routes.ts:351` (`res.json({ data: { batch, rows } })`, the full set).

**No deletion path exists.** `expiresAt` (line 302) is consulted once, at confirm time (line 378), purely to reject a stale batch. Grep confirms `expiredEntries` — the one retention helper in the codebase, documented at `recycle-bin.ts:239` as *"Driven by a scheduled job"* — has **zero call sites**, and grep for `cron|setInterval|schedule` across `src` and `package.json` returns nothing but that comment. There is no scheduler in this system.

**Impact.** Every Aadhaar number that has ever passed through the bulk importer sits in `import_rows.raw` and `import_rows.normalised` in cleartext, forever, alongside PAN, mobile, email, income and address. This is precisely the exposure the peppered-hash design was built to prevent, and it is a larger corpus than the `customers` table because *rejected* rows are staged too (`imports.routes.ts:232`) — a file that fails validation still deposits its Aadhaar numbers permanently.

A database snapshot, a Neon branch taken for debugging, or a read-replica credential leak exposes the plaintext directly, with no pepper to reverse and no work factor to slow an attacker down.

**Abuse scenario.** Over a year the operations team bulk-loads 40,000 customers. Some batches are abandoned after preview because the file was wrong; those rows are staged anyway. A developer clones the production Neon branch into a staging environment to reproduce an issue — a routine, sanctioned act. That staging database, protected by weaker credentials and no audit trail, now holds 40,000+ Aadhaar numbers in the clear. Nothing in the product records that this happened.

**Recommended remediation.**
1. Strip Aadhaar (and PAN) from `raw` and `normalised` before staging. Store only what the preview screen needs — last four digits and a validity flag — and hash at parse time rather than at confirm time.
2. Add a retention job that hard-deletes `import_rows` and `import_batches` past `expires_at`. Wire it to a real scheduler; the codebase currently has none, which also leaves `expiredEntries` (`recycle-bin.ts:240`) dead and the recycle bin's 30-day purge policy unimplemented.
3. Exclude the sensitive keys from the preview responses at lines 324 and 351.
4. Add a migration to purge historical `import_rows` content once (1) ships.

---

# MEDIUM

## SEC-010 — `mustChangePassword` is enforced only in React
> **The on-screen credential hand-over was audited and pinned on 2026-09-04 (Task 3.9)**, since it is the one path that puts a usable password in front of a human. Verified by test, not by reading: the plaintext exists only in the creating response and in React state that is dropped when the dialog closes; only the argon2id hash is persisted; it appears in no log on either the happy path or the outage path; it is never placed in an email (**D-037**); it is absent from the employee list and from every later read; and it is unreachable without `users.create` plus the hierarchy rule, so it cannot be used to mint a credential for a superior. `mustChangePassword` is set, so it is a hand-over and not a second permanent credential. Mutations persisting it, logging it, emailing it, or opening the control to `users.view` each fail tests. See **D-042**.


| | |
|---|---|
| **Severity** | MEDIUM — classification confirmed by measurement, see below |
| **Location** | `frontend/src/components/layout/app-shell.tsx:39-48` (working tree); `src/modules/auth.routes.ts:70,145`; `src/db/seed.ts:118-121` |
| **Status** | RESOLVED 2026-09-02 (Task 2.3) |
| **Phase** | P1 |

> ### RESOLVED — Task 2.3, 2026-09-02
>
> **The exemption is expressed by which middleware a route chooses, never by its URL.** That is the whole design, and the roadmap's proposed path allow-list was rejected on a measurement: `requireAuth` is applied by `router.use()` on twelve routers plus the `createScopedResource` factory, so *inside* it `req.path` is relative to the mount — `/abc123`, not `/api/users/abc123` (measured under Express 5.2.1). A literal `req.path === "/api/auth/change-password"` comparison would therefore **never match**, and every flagged user would have been locked out of the one route that can unflag them.
>
> Three parts:
>
> **1. A new code.** `passwordChangeRequired()` gives **403 `password_change_required`** (`lib/errors.ts:80-82`). Deliberately **not** one of the two session-invalidating codes: those mean "the session is over", this means "the session is fine and there is exactly one thing you may do with it". It must never join the frontend's `SESSION_ENDED_CODES` — a frontend test fails if it does.
>
> **2. `requireAuth` became the strict default** (`middleware/auth.ts:52-70`). A private `authenticate()` holds the shared token-verification and context-loading, so the two exported middlewares cannot drift on authentication, on the three session gates, or on what lands in `req.auth`. The flag check happens *after* `loadAuthContext`, so an account that is both flagged and deactivated still reports `account_inactive` — asserted by test.
>
> **3. Exactly two routes opt out**, via `requireAuthAllowPasswordChange`: `GET /api/auth/me` and `POST /api/auth/change-password` (`auth.routes.ts:222,231`). **`/login`, `/refresh` and `/logout` needed no exemption** — they carry no `requireAuth` at all, authenticating by credential or by cookie. The earlier remediation text below, and the roadmap, both listed `/api/auth/logout` as an exemption; that was wrong and is corrected here. Anything added in future gets the strict default by not opting out, so enforcement **fails closed**.
>
> **Refresh stays reachable, deliberately.** A flagged session can still rotate its cookie — which the frontend's session restore depends on — but the rotated token is exactly as restricted, asserted by test. Refresh tokens are **not** revoked merely because the flag is set: doing so would sign a flagged user out on every page reload and strand them before the form that fixes it.
>
> **Once the flag clears, the same access token works immediately**, because the context is re-read per request. The user is never stranded holding a token minted while flagged.
>
> **Verified:** 18 new tests (`src/tests/forced-password-change.test.ts`) plus 1 frontend test; backend **215/215**, frontend **56/56**. Four mutations applied and reverted: removing the gate fails 8, pointing a business router at the permissive variant fails 5, reverting `/auth/change-password` to strict fails 3 (including the whole recovery path — the account becomes permanently unrecoverable), and adding the code to `SESSION_ENDED_CODES` fails the frontend test.

**Severity confirmed MEDIUM, on measured evidence.** The register's model reserves CRITICAL/HIGH for what an attacker *with no privileged position* can do. This required either an administrator-issued temporary password or deploy-dashboard access to `BOOTSTRAP_SUPERADMIN_PASSWORD` — both privileged or compromised-channel positions — and neither authentication nor authorization was ever defeated: every permission, hierarchy and bank-scope check held throughout. It is precisely the MEDIUM definition: *a control that is documented or believed to exist does not actually hold.* Recorded for honesty, the measured teeth were real: a flagged Super Admin could list users (200), **create accounts (201)**, read the audit log (200) and **reset other users' passwords (200), receiving another temporary credential**. **[BUG-005](BUGS_AND_ISSUES.md#bug-005) rated the same defect HIGH**; the two registers disagreed. Reconciled to **MEDIUM** in both, on this reasoning.

**Vulnerability.** The forced-password-change gate is a client-side redirect. The flag is written on account creation and reset, carried on the JWT-backed profile and returned on login — but no middleware or route handler ever asserts it.

**Evidence.**

The only enforcement, `frontend/src/components/layout/app-shell.tsx:39-48` (working tree):
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

An exhaustive grep for `mustChangePassword` across `src` returns 13 non-test hits: one schema definition (`db/schema/identity.ts:107`), three writes (`db/seed.ts:121`, `admin.routes.ts:208,293,350`), one clear (`auth.routes.ts:245`), and the rest are reads that populate a response. **Zero occurrences in `src/middleware/`.** No route calls `assertPasswordChanged` or equivalent — no such function exists.

**Impact.** The flag is advisory. A user holding a temporary password issued by an administrator can call any of the 96 endpoints they are authorised for, indefinitely, by using the access token from the login response directly — the client redirect is simply not present outside a browser.

The concrete consequence is at `src/db/seed.ts:118-121`, where the bootstrap super admin is created with the flag set and this comment:
```ts
    // Forces a password change on first login so the bootstrap value, which
    // lives in the Railway dashboard, stops being a valid credential.
    mustChangePassword: true,
```
That statement is false. `BOOTSTRAP_SUPERADMIN_PASSWORD` — a value stored in a platform dashboard, visible to everyone with deploy access, and never rotated — remains a fully valid credential for the highest-privileged account in the system for as long as nobody voluntarily changes it.

The same gap covers every admin-issued temporary password (`admin.routes.ts:186,208` and the working-tree reset at `admin.routes.ts:342,350`), all of which are transmitted out-of-band over chat or email (there is no email subsystem — verified absent) and are commonly never changed.

**Abuse scenario.** A new executive is onboarded and given a temporary password over WhatsApp. Six months later the WhatsApp backup of the team lead's phone is compromised. The temporary password still authenticates, because the executive dismissed the change-password screen once by hitting the API from a mobile app prototype and never returned to it — or simply because an attacker with the string calls `POST /api/auth/login` and then uses the returned `accessToken` against `/api/customers` directly, never loading the React app that would have redirected them.

**Recommended remediation.**
1. **DONE (2.3).** Add a `requirePasswordChanged` middleware that rejects with `403 password_change_required` when `ctx.mustChangePassword` is true. `loadAuthContext` already loads the field (`access.ts:38,89` — this line previously cited `:82`, which is not the return site; corrected 2026-09-02), so the check is free. *Implemented inside `requireAuth` rather than as a separate middleware, so that a router which forgets to add it still gets the gate — the separate-middleware shape fails open across thirteen mount points.*
2. **DONE (2.3), but not by an allow-list.** Apply it in `requireAuth` and allow-list exactly two routes: `GET /api/auth/me` and `POST /api/auth/change-password`. *Those two routes are exactly right, but "allow-list" is not: a path comparison inside `requireAuth` sees a mount-relative `req.path` and never matches. The two routes opt out by using `requireAuthAllowPasswordChange` instead. See D-023.*
3. **STILL OPEN, and narrowed 2026-09-04.** Add an expiry to temporary credentials — after N days the account is disabled rather than merely nagged. *A policy feature, not this gate. Carried forward.* **OPEN-3 was resolved on 2026-09-04 ([D-037](DECISIONS.md)) in favour of a single-use, time-limited invitation link**, so once roadmap 3.5 lands, a new employee's credential arrives expiring by construction and no password is ever emailed. That removes the *emailed* permanent credential — it does **not** close this item: roadmap **3.9** deliberately keeps the on-screen credential hand-over as the fallback for when email is unavailable, and that temporary password still has no expiry. Nothing is implemented yet.
4. **DONE (2.3), in its own file.** Extend `src/tests/employee-lifecycle.test.ts` with a case asserting that a `mustChangePassword` session is rejected on a business route. *Landed as `src/tests/forced-password-change.test.ts` (18 cases) rather than by extending the lifecycle suite, which is about onboarding rather than enforcement. The lifecycle cases at 101, 128-129, 199-200, 244 still assert only that the flag is returned, and are unchanged.*

**Not fixed here, and not claimed:** an access token issued before a password change keeps working until it expires (15 minutes at most) — true of all three password-setting paths, and not introduced by this fix. `PATCH /api/users/:id`'s password branch still revokes no sessions and clears no lockout state. Both are recorded rather than fixed; see **[BUG-036](BUGS_AND_ISSUES.md#bug-036)** and Phase 13.

---

## SEC-011 — No CSP anywhere; the frontend origin sets no security headers at all

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `src/app.ts:44-49`; `frontend/next.config.ts:1-10` |
| **Status** | OPEN |
| **Phase** | P1 |

**Vulnerability.** The API disables CSP with a comment delegating it to the frontend. The frontend does not implement it — or any other security header.

**Evidence.**

`src/app.ts:44-49`:
```ts
  app.use(
    helmet({
      contentSecurityPolicy: false, // API only; the frontend sets its own CSP.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
```

`frontend/next.config.ts` in its entirety:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
```

There is no `headers()` function, no `middleware.ts` anywhere under `frontend/` (verified by `find`), and no `app/api/` route handlers. The delegation named in the API's comment terminates in nothing.

**Correction to the intake baseline:** the API is *not* header-less. helmet 8.3.0 turns on `strictTransportSecurity`, `xFrameOptions`, `xContentTypeOptions`, `referrerPolicy` and others by default; `getMiddlewareFunctionsFromOptions` (`node_modules/helmet/index.cjs:342-354`) shows `contentSecurityPolicy: false` removes only that one middleware. The gap is (a) CSP on both origins and (b) *every* header on the frontend origin, which is the origin that actually renders HTML and holds the session.

**Impact.** The frontend origin — the one serving the app that holds the in-memory access token and the demo flag — ships with no `Content-Security-Policy`, no `X-Frame-Options`, no `Strict-Transport-Security` and no `Referrer-Policy` beyond browser defaults (Vercel adds none by default). Consequences:

- **No script-injection containment.** CSP is the control that would have made SEC-001's flag-flip attack and any future XSS non-exploitable. Today React's escaping (see [Verified Safe](#verified-safe)) is the *only* layer.
- **Clickjacking.** With no frame-ancestors directive and no `X-Frame-Options`, the CRM can be framed. Every destructive action in the product is a plain button click behind a confirm dialog (`admin.routes.ts:876` requires a JSON flag, not a typed confirmation).
- **No HSTS on the origin users actually type.** A first visit over HTTP to the frontend is downgradeable. HSTS on the API alone does not protect the document.

**Abuse scenario.** An attacker who achieves any script execution on the frontend origin — a compromised npm dependency in the 40+ package frontend tree, a stored payload rendered somewhere React's escaping does not reach, a malicious browser extension — runs `sessionStorage.setItem("risenext.demo.session","active")`. A CSP with a nonce-based `script-src` would have blocked the injected script; there is none. Separately, a phishing page frames `/customers/{id}` beneath a transparent overlay and harvests clicks on Delete.

**Recommended remediation.**
1. Add a `headers()` block to `frontend/next.config.ts` setting `Content-Security-Policy` (nonce-based `script-src`, `frame-ancestors 'none'`, `connect-src` limited to `NEXT_PUBLIC_API_URL`), `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive `Permissions-Policy`.
2. Re-enable `contentSecurityPolicy` on the API with an API-appropriate policy (`default-src 'none'; frame-ancestors 'none'`) — cheap, and correct for a JSON service.
3. Correct the comment at `app.ts:46`, which currently documents a control that does not exist.

---

## SEC-012 — `images.remotePatterns` hostname `**` turns the Next image optimiser into an open fetch proxy

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `frontend/next.config.ts:5-7` |
| **Status** | OPEN |
| **Phase** | P1 |

**Vulnerability.** The image optimiser is configured to accept any HTTPS host.

**Evidence.** `frontend/next.config.ts:5-7`:
```ts
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
```
Next.js 16.2.12 (`frontend/package.json:31`). `/_next/image?url=<any https URL>&w=…&q=…` is served by the deployment's own Node/edge runtime.

**Impact.** Any unauthenticated party can make the frontend's server fetch an arbitrary HTTPS URL on their behalf, with the deployment's source IP and outbound network position. The response body is only returned if it decodes as an image, but the *side effects* of the request happen regardless, and response timing and status leak information. This is a classic SSRF pivot when the hosting platform exposes internal HTTPS endpoints, and an open bandwidth proxy in every case.

There is no legitimate need for it here: no remote image host is referenced anywhere in the app; `avatarUrl` is present on the session type (`use-auth.tsx:27`) and is `null` in the only fixture that sets it (`demo/api.ts:65`).

**Abuse scenario.** An attacker uses `https://risenext-crm.vercel.app/_next/image?url=…` as a laundering hop for scanning, so the traffic originates from the CRM's own hostname and lands in the CRM's egress logs rather than theirs. Where the platform exposes an internal HTTPS metadata or admin endpoint, timing differences between reachable and unreachable targets map the internal network.

**Recommended remediation.** Replace `hostname: "**"` with the explicit hosts that are actually needed. If none are — which the current code suggests — remove the `images.remotePatterns` block entirely and rely on same-origin assets.

---

## SEC-013 — Recycle-bin restore and permanent-delete skip all scoping for `null`-bank entries

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `src/modules/admin.routes.ts:841-893`; `src/services/recycle-bin.ts:84-88,203-237` |
| **Status** | OPEN |
| **Phase** | P1 |

**Vulnerability.** Both mutating recycle-bin routes look the entry up by ID with no scope filter, then apply the bank check only when `bankId` is truthy. Entries with a `null` bank receive no authorisation beyond the permission itself.

**Evidence.**

`src/modules/admin.routes.ts:848-856` (restore) and `879-887` (permanent delete) are structurally identical:
```ts
      const [entry] = await getDb()
        .select()
        .from(recycleBinEntries)
        .where(eq(recycleBinEntries.id, id))
        .limit(1);
      if (!entry) throw notFound("Recycle bin entry not found");
      if (entry.bankId) assertBankAccess(ctx, entry.bankId);
```

`src/services/recycle-bin.ts:84-88` — at least one record type always produces a `null` bank:
```ts
  service_provider: {
    table: serviceProviders,
    label: (row: Record<string, unknown>) => String(row.name ?? "Service provider"),
    bankIdOf: () => null,
  },
```

The listing route, by contrast, *does* scope, and its own comment states the intended rule:

`src/modules/admin.routes.ts:813-816`:
```ts
    // Bin entries carrying no bank (e.g. service providers) stay visible only to
    // unscoped users; scoped users see their own banks' entries.
    const scope = bankScope(ctx, recycleBinEntries.bankId);
    if (scope) filters.push(scope);
```

The mutating routes contradict the read route: a scoped user cannot *see* a `null`-bank entry but can *purge* it.

`permanentDelete` is a genuine hard delete — `recycle-bin.ts:221`: `await tx.delete(table).where(eq(table.id, entry.recordId));`

**Impact.** A bank-scoped user holding `recycle_bin.permanent_delete` who obtains or guesses a bin-entry UUID can irreversibly destroy a soft-deleted service provider that belongs to no bank and that they were never permitted to see. Restore has the mirror problem: they can resurrect a record an unscoped administrator deliberately removed.

Exploitation requires knowing the entry UUID, which the list route withholds from scoped users — that is the compensating control, and it is a weak one (UUIDs leak through logs, screenshots, support tickets, and the `recordId` field of audit rows). By default `recycle_bin.permanent_delete` is held only by `super_admin`, who is unscoped anyway; the exposure materialises the moment a custom role grants it to a scoped user, which `PUT /api/roles/:id/permissions` permits.

**Abuse scenario.** An operations manager is given a custom role including `recycle_bin.restore` and `recycle_bin.permanent_delete` so they can manage their own banks' bin. A super admin soft-deletes a fraudulent verification provider. The manager, who has the entry's UUID from an audit-log line they *can* read, calls `POST /api/recycle-bin/{id}/restore` and the provider is live again — silently, because the manager cannot see the entry in the list and neither can anyone auditing by scope.

**Recommended remediation.**
1. Reuse the list route's predicate for the lookup, so an out-of-scope entry returns `404` and the two surfaces agree.
2. Replace `if (entry.bankId) assertBankAccess(...)` with an unconditional check: for a `null`-bank entry, require `system.access_all_banks` (i.e. `isUnscoped(ctx)`), matching the documented rule at line 813.
3. Add an authorization test case covering a scoped actor against a `service_provider` bin entry; `src/tests/authorization.test.ts` (26 cases) does not currently cover it.

---

## SEC-014 — Audit-log bank-scope predicate binds looser than the user filters

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `src/modules/admin.routes.ts` |
| **Status** | **✅ RESOLVED 2026-09-06 — Task 12.5** |
| **Phase** | Wave 4 |

> **Resolved.** The fragment is now `sql\`((…) or (…))\``. The predicate is otherwise byte-identical — no scope rule changed, which is the point: the defect was punctuation, and anything more would have been a scope change wearing a bug fix's clothes.
>
> **Regression:** `src/tests/audit-query.test.ts` group B, 10 cases. **Reversion-proven — 5 fail against the pre-fix predicate.**
>
> **Two corrections to the analysis below, both from measurement rather than reading.** First, the impact paragraph's "not a cross-tenant leak" is confirmed by case 12, which asserts it directly rather than inferring it. Second, the abuse scenario needs a caller with `audit_logs.view` **and** a bank scope, and **no seeded role is both** — Admin holds `system.access_all_banks`. The defect was real and reachable, but only after a client created the bespoke auditor role the permission catalogue explicitly anticipates.
>
> Task 12.4 also added `meta.total`, `actorId`, `bankId` and a date window to the same route, so the paging concern in the impact paragraph ("the rows they wanted may be paged out entirely") is addressed as well: an investigator can now see how many rows matched.

**Vulnerability.** The bank-scope fragment is a bare `OR` expression with no enclosing parentheses. Drizzle's `and()` wraps the *combined* list once but does not parenthesise the individual members, so SQL's `AND`-binds-tighter-than-`OR` rule detaches the scope disjunct from the user's filters.

**Evidence.**

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

`node_modules/drizzle-orm/sql/expressions/conditions.cjs:64-79` — the combiner adds one outer paren pair and joins with `" and "`, nothing more:
```js
  return new import_sql.SQL([
    new import_sql.StringChunk("("),
    import_sql.sql.join(conditions, new import_sql.StringChunk(" and ")),
    new import_sql.StringChunk(")")
  ]);
```

A scoped caller requesting `?recordType=user` therefore produces:
```sql
(record_type = $1 and (bank_id is null and actor_id = $2) or bank_id in ($3, $4))
```
which Postgres reads as `((record_type = $1 and (…)) or bank_id in ($3, $4))`.

**Impact.** For a bank-scoped caller, **every** row belonging to their banks is returned regardless of the `recordType`, `recordId` and `action` filters — the filters are silently ignored for that branch. This is *not* a cross-tenant leak: the escaping disjunct is still `bank_id in (caller's banks)`, so no other bank's rows are exposed. The harm is to correctness and to investigation: an investigator narrowing to `action=deleted` receives an unfiltered stream, and because the endpoint caps at `pageSize` 500 with no date filter, the rows they actually wanted may be paged out entirely. A defect that makes an audit search quietly return the wrong set is worse than one that errors.

The same author pattern at `admin.routes.ts:106` is safe — it is a self-contained `exists (…)` subquery with no top-level `OR`.

**Abuse scenario.** A compliance officer with two assigned banks investigates a disputed disbursement and filters the audit log to `recordType=disbursement&recordId={id}`. The API returns 500 unrelated rows in reverse-chronological order, of which the relevant ones are not on the first page. The officer concludes no audit entry exists and closes the query.

**Recommended remediation.**
1. Wrap the fragment in explicit parentheses: `sql\`((…) or (…))\``.
2. Better, express it with Drizzle's own combinators — `or(and(isNull(auditLogs.bankId), eq(auditLogs.actorId, ctx.userId)), inArray(auditLogs.bankId, ids))` — which parenthesise correctly by construction.
3. Grep for any other bare-`OR` raw fragment pushed into an `and()` list before extending this pattern.
4. Add `occurredAt` range filters to the query schema so investigations do not depend on paging.

---

## SEC-015 — `/api/health/ready` returns the raw driver error message unauthenticated

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `src/modules/health.routes.ts:13-29`; `src/app.ts:78` |
| **Status** | OPEN |
| **Phase** | P1 |

**Vulnerability.** The readiness probe is mounted before `authRouter` with no guard and serialises the caught exception's `message` straight into the response body.

**Evidence.** `src/modules/health.routes.ts:22-28`:
```ts
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      database: { connected: false, error: (error as Error).message },
      timestamp: new Date().toISOString(),
    });
  }
```

`src/app.ts:78` — mounted unauthenticated: `app.use("/api", healthRouter);`

This deliberately bypasses `errorHandler`, whose entire purpose is to collapse unexpected failures to `{ code: "internal_error", message: "Unexpected server error" }` (`error-handler.ts:84-87`).

**Impact.** `node-postgres` and Neon failure messages routinely embed the host, the database name, the connection role, TLS negotiation detail and pooler topology — for example `getaddrinfo ENOTFOUND ep-<project>-pooler.<region>.aws.neon.tech` or `password authentication failed for user "<role>"`. Anyone on the internet can poll the endpoint and read them the moment the database is unhealthy, which is exactly the moment an attacker probing the service is most interested. The latency field on the success path (`health.routes.ts:19`) additionally provides a free, unauthenticated oracle for database load.

**Abuse scenario.** An attacker polls `/api/health/ready` every ten seconds. During a Neon maintenance window the endpoint returns a DNS or authentication error naming the project, region and role. The attacker now knows the exact managed-Postgres provider, the project identifier and the database role name, and pivots to targeting the Neon console credentials of the engineering team.

**Recommended remediation.**
1. Return only `{ status: "degraded" }` with no `error` field. Log the full message server-side via `logger.error` with the request id.
2. Consider requiring a shared secret header for the *ready* probe, keeping the unauthenticated `/api/health` liveness endpoint (which touches nothing) as the public one.
3. Drop `latencyMs` from the public response or coarsen it into a bucket.

---

## SEC-016 — `POST /:id/approve` accepts any status string; no state machine, no CHECK constraints

| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `src/modules/scoped-resource.ts:613-676` *(was `:271-319`; re-verified 2026-09-05)* |
| **Status** | **OPEN — partially remediated 2026-09-05 for `loans` only** (Phase 5, Tasks 5.2 / 5.3) |
| **Phase** | P2 |

> **Partial remediation, 2026-09-05 — this finding stays OPEN.**
>
> All three recommended remedies below were implemented as **opt-in** factory configuration, and **only `loans` opts in**:
>
> | Remedy | State |
> |---|---|
> | 1. `allowedStatuses` + `z.enum` | Built (`ScopedResourceConfig.allowedStatuses`). Configured for **loans only** |
> | 2. `transitions` map validated against the already-loaded `before` row | Built (`allowedTransitions`, plus `initialStatuses` for create). Configured for **loans only** |
> | 3. DB CHECK constraints on **every** status column | **`loans.status` only**, via `drizzle/0007_loan_status_check.sql` — **the only CHECK constraint in the repository.** 28 of the 29 tables still have none *(counts re-measured 2026-09-05: 29 tables, 64 foreign keys; the figure here previously said 26, and `0007`'s own header says 27 tables / 62 FKs — both are wrong)* |
>
> **The abuse scenario in this finding is unchanged.** It is written against `disbursements`, which configures no vocabulary and no machine, so `POST /api/disbursements/{id}/approve {"status":"Credited"}` on an unfunded disbursement still succeeds exactly as described. `loan-state-machine.test.ts` group A case 6 and group F case 29 **pin that** deliberately, so the remaining exposure cannot be mistaken for closed. **Ownership: bank orders → 6.1/6.5 · disbursements → 7.3 · settlements → 8.2/8.3 · `verifications.status` → 13.13.** This finding closes with the sweep, not before.
>
> **Ownership corrected 2026-09-05, Wave 0.** This paragraph previously read *"Bank orders are roadmap 6.5, **disbursements and settlements 7.3**"*. Assigning settlements to 7.3 contradicted the roadmap's own row text — 7.3 reads *"Add the **disbursement** state machine + DB CHECK constraints"* and names settlements nowhere, while no Phase 8 row named a settlement machine either. Settlements are now owned by **8.2** (vocabulary + legal initial status) and **8.3** (transition map + approve enum), per **D-066**. Bank orders split across **6.1** (enforcement) and **6.5** (vocabulary + CHECK), because they have **no approve route** at all — `bankOrdersRouter.permissions` configures no `approve` (`operations.routes.ts:301-306`) and the route is conditional on it (`scoped-resource.ts:613`).
>
> **Three distinct holes, only one of which is a vocabulary hole.** `patchSchema` retains the create enum, so **vocabulary is already guarded on create and PATCH**; what is unguarded there is **privilege**. Recorded so the remedies are not conflated:
>
> | Path | Vocabulary | Privilege | Closed by |
> |---|---|---|---|
> | CREATE | ✅ `z.enum` | ❌ no legal-initial-status guard | `initialStatuses` |
> | PATCH | ✅ `z.enum` | ❌ no refusal | `patchRefusals` + `notOnThisRoute()` (D-025) |
> | APPROVE | ❌ **free text** (`scoped-resource.ts:369`) | ❌ no transition map | `allowedStatuses` + `allowedTransitions` |
>
> **Live instances, all owned by Phases 6–8 (D-066):** `POST /api/disbursements {"status":"Credited"}` → 201 on `create` alone; `PATCH /api/disbursements/:id {"status":"Credited"}` on `edit` alone — **Manager holds both and holds neither approve permission** (`lib/permissions.ts:250-251`); `POST /api/transactions {"status":"Success"}` → 201 on `create` alone (`:253-254`); and `POST /api/settlements/:id/approve` persists **any** string.
>
> **Line references in the Evidence block below are stale** — `scoped-resource.ts` grew by roughly 340 lines at the approve route during Phase 5. The approve handler is now at **`:613-676`** (body parse `:638`, transition check `:647`, audit `:661`) and the free-text fallback is at **`:369`**. The code quoted below no longer exists in that form; the **defect it describes is unchanged** for every resource except loans.
>
> **A related hole this finding did not cover was also closed**, for loans only: `POST /api/loans` accepted `{"status":"Approved"}` and returned **201**. `requests.create` is held by Team Leader and Executive while `requests.approve` is held by neither (`lib/permissions.ts:277`, `:304`), so that was an approval performed by a role that may not approve — with `approved_by` left NULL and an audit row reading `"created"`. It is the CREATE twin of the PATCH bypass **D-056** closed. Both are now 422. See BUSINESS_FLOW.md §3.3 and `loan-state-machine.test.ts` groups D and E.
>
> **Scope note:** a CHECK constraint is a *vocabulary* guard and can never express a transition — it sees only the candidate row. **No trigger was added** (D-057); the trigger count stays at 7. Transition legality lives in the service layer alone.

**Vulnerability.** The factory-generated approval endpoint validates that `status` is a non-empty string and nothing else. It performs no transition check against the current value and writes the caller's string directly to the status column.

**Evidence.** `src/modules/scoped-resource.ts:288-302`:
```ts
          const status = z
            .object({ status: z.string().min(1), notes: z.string().max(1000).optional() })
            .parse(req.body);

          const [after] = await db
            .update(table)
            .set({
              status: status.status,
              ...(table.approvedBy ? { approvedBy: ctx.userId, approvedAt: new Date() } : {}),
              ...(status.notes && table.notes ? { notes: status.notes } : {}),
              updatedAt: new Date(),
              updatedBy: ctx.userId,
            })
```

The `before` row is fetched (lines 281-286) but used only for the audit diff (line 310) — never to validate the transition. The database offers no backstop: the schema contains **zero** CHECK constraints across all 27 tables.

**Impact.** In a lending workflow the status column *is* the control. A holder of `requests.approve` on `/api/loans/:id/approve` can move a loan from `Draft` straight to any string, skipping verification, bank order and disbursement gates, and set `approvedBy`/`approvedAt` on it in the same call. Nothing detects the skipped states — not the API, not the database, and not the UI, whose stage-transition handlers are non-functional stubs that issue no HTTP request at all (`bank-orders/page.tsx:58,64`; `loans/page.tsx:68`).

The write is parameterised, so this is not SQL injection. The risk is workflow integrity: free-text statuses also silently corrupt any downstream filter or report that matches on exact status values (`scoped-resource.ts:115-120` exposes `status` as an exact-match query parameter).

**Abuse scenario.** An operator with `disbursements.approve` calls `POST /api/disbursements/{id}/approve` with `{"status":"Credited"}` on a disbursement that was never funded. The record now reads as credited, carries their user id in `approved_by`, and appears in the settlement reconciliation as complete. The audit row records the change faithfully — and records it as a legitimate approval, because the API treated it as one.

**Recommended remediation.**
1. Add a per-resource `allowedStatuses` array to `ScopedResourceConfig` and validate with `z.enum`.
2. Add a `transitions: Record<from, to[]>` map and reject transitions that are not declared, using the `before` row that is already loaded.
3. Add database CHECK constraints on every status column as a backstop — the migration set currently has none.
4. Reflect the state machine in the client so the stub handlers listed above become real calls rather than toasts.

---

## SEC-017 — Customer PII in `audit_logs.changes` is not covered by `REDACTED_FIELDS`

> **Risk profile raised 2026-09-05 by Task 4.1 — finding NOT fixed, and still OPEN.**
> When this was filed, `PATCH /api/customers/:id` had **zero callers**, so the unredacted diff was written only by the Excel importer. Task 4.1 wired the customer edit dialog, so this is now an endpoint operations staff use daily: the table accumulates PAN, mobile, email, account number, IFSC and date of birth on **every** customer edit.
> **Task 4.3 does not make it worse.** The customer timeline renders `Object.keys(changes)` mapped to field *labels* and never reads a value — a test seeds ten sensitive values and asserts each is absent from the DOM. But the values are still *in the table*, still unredacted, and still readable by any holder of `audit_logs.view`.
> Phase 4 deliberately did not extend `REDACTED_FIELDS`: that changes audit semantics for all 13 record types and belongs to this finding's owner, not to a customer-functionality row (**D-049**).


| | |
|---|---|
| **Severity** | MEDIUM |
| **Location** | `src/services/audit.ts:18-43`; `src/modules/customers.routes.ts:226-231,251-258` |
| **Status** | OPEN |
| **Phase** | P2 |

**Vulnerability.** The diff helper redacts eight key names. The customer PATCH handler feeds it two complete `SELECT *` rows, so every sensitive customer attribute *outside* that list is copied verbatim into the append-only audit table.

**Evidence.**

`src/services/audit.ts:18-27` — the complete allow-list:
```ts
const REDACTED_FIELDS = new Set([
  "password",
  "passwordHash",
  "password_hash",
  "aadhaar",
  "aadhaarHash",
  "aadhaar_hash",
  "token",
  "tokenHash",
]);
```

`src/modules/customers.routes.ts:226-231,257` — full rows in, full diff out:
```ts
    const [before] = await db
      .select()
      .from(customers)
...
      changes: diff(before as Record<string, unknown>, after as Record<string, unknown>),
```

Cross-referencing the diff input against the redaction set: `aadhaarHash` is covered; **`aadhaarLast4`, `pan`, `mobile`, `altMobile`, `email`, `dob`, `address`, `accountNo`, `ifsc`, `monthlyIncome`, `cibil`, `fatherName` and `motherName` are not.** All are columns on `customers` (`db/schema/domain.ts`) and all are returned by the unprojected select.

The destination is the table that cannot be corrected (`0001_governance_guards.sql:16-18`) and for which no retention job exists (grep for `cron|setInterval|schedule` across `src`: zero hits).

The equivalent user diff at `admin.routes.ts:307` is safe — `passwordHash` is in the set.

**Impact.** Correcting a typo in a customer's PAN writes both the old and new PAN into a permanent, uncorrectable table. Over time `audit_logs` accumulates a second, denormalised copy of the customer PII corpus — including bank account numbers and IFSC codes — with:
- no retention limit (unbounded growth, unbounded exposure window),
- no correction path (a GDPR/DPDP-style erasure request cannot be satisfied; the trigger blocks `DELETE`),
- read access granted to `admin` (level 10) via `audit_logs.view` (`permissions.ts:227`), which is a broader audience than the customer detail screen.

`recycle_bin_entries.snapshot` (`governance.ts:69`) holds the same class of full-row copy; the list route strips it from responses (`admin.routes.ts:829`) but it persists in the database.

**Abuse scenario.** A DPDP erasure request arrives for a customer. Operations soft-deletes and then permanently deletes the record. The `customers` row is gone — but every field ever edited still sits in `audit_logs.changes`, and the full pre-delete row sits in `recycle_bin_entries.snapshot`. The immutability trigger, built to guarantee compliance, now guarantees non-compliance, and the only way to satisfy the request is to drop the trigger.

**Recommended remediation.**
1. Invert the model: instead of a redaction deny-list, pass an explicit *allow-list* of auditable field names per record type, and diff only those.
2. At minimum extend `REDACTED_FIELDS` with `aadhaarLast4`, `pan`, `accountNo`, `ifsc`, `dob`, `address`, `mobile`, `altMobile`, `email`, and their snake_case forms.
3. Record a change *fingerprint* (field name plus a hash) rather than before/after values for regulated fields — this preserves the audit property (proof a value changed and by whom) without duplicating the data.
4. Define a retention policy for `audit_logs` — e.g. monthly partitions detached to cold storage past the statutory window — and design it around the immutability trigger, which currently forecloses every deletion strategy.

---

# LOW

## SEC-018 — Rejected CORS origin produces a 500 and an error-level log

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

| | |
|---|---|
| **Severity** | LOW (as found) |
| **Location, as found** | `src/app.ts:52-63`; `src/middleware/error-handler.ts:84-87` |
| **Fixed in** | `src/app.ts:56-90` (the origin callback only) |
| **Status** | ✅ **RESOLVED 2026-09-02** · Phase 1.6 |

> **What follows is the original finding, preserved as the record of what was wrong.**

**Vulnerability.** A disallowed `Origin` yields an `Error` passed to `next()`, which reaches the terminal branch of the error handler.

`src/app.ts:56-59`:
```ts
      origin(origin, callback) {
        if (!origin || allowed.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not permitted`));
      },
```

`src/middleware/error-handler.ts:84-87` — not a `ZodError`, not an `AppError`, no pg code, so:
```ts
  logger.error({ err: error, requestId: req.requestId }, "Unhandled error");
  res.status(500).json({
    error: { code: "internal_error", message: "Unexpected server error" },
  });
```

**Impact.** A policy decision is reported as a server fault. Two consequences: `500` rates become a useless alerting signal (every stray cross-origin request inflates them), and an unauthenticated attacker can write an unbounded volume of error-level records with a full stack trace and an attacker-chosen `Origin` string into the log sink — a metered, retained resource on most platforms. It also masks genuine faults during an incident.

**Abuse scenario.** An attacker sends a sustained stream of requests with random `Origin` headers. The log pipeline fills with error-level entries; the on-call engineer's `500`-rate alert fires continuously and is muted; a real outage two days later goes unnoticed.

**Remediation.** Reject with `res.status(403).json({ error: { code: "origin_not_allowed", … } })` and log at `warn` (or `debug`) with the origin as a structured field, never a stack trace.

> **Important:** this rejection path is currently load-bearing for CSRF defence — see [Verified Safe → CSRF](#verified-safe). `next(err)` short-circuits the middleware chain and the route never executes, which is what stops a cross-site `POST /api/auth/logout` from revoking a victim's session. Any fix must preserve the short-circuit; return `403` and end the response, do not fall through to the router.

---

## SEC-019 — Pino redaction patterns match at depth 2 only

| | |
|---|---|
| **Severity** | LOW |
| **Location** | `src/lib/logger.ts` |
| **Status** | **✅ RESOLVED 2026-09-06 — Wave 5, Task 15.7** |

> **Closed.** Redaction is now by **key name at any depth** rather than by path pattern, applied in pino's `formatters.log`. Bounded (depth 12, 5,000 nodes), cycle-safe, non-mutating. **D-094.**
>
> The remediation this entry suggested — enumerate the concrete deep paths — was **rejected**, and the reason is worth keeping: it fixes today's shapes and fails on tomorrow's. `req.body.customer.aadhaar` is depth four, a batch is depth five, an array puts a numeric index in the middle. There is no finite list of paths, and a list that is nearly right is worse than none because it reads as coverage.
>
> **Regression:** `src/tests/log-redaction.test.ts`, 17 cases. Group B is the load-bearing half — it logs a synthetic nested payload through a **real pino instance** and asserts none of eleven planted values reaches the sink. Testing `scrub` alone would prove a pure function works while saying nothing about whether it is wired in, which is precisely how this defect survived behind a comment claiming it was covered.
>
> **Two residuals, recorded rather than smoothed over.** A **free-text** field can contain anything and no key rule catches it — the same residual SEC-017 carries. And `LOG_LEVEL=debug` widens *what is logged at all*; the runbook forbids it in production for that reason.
>
> **One defect in the fix itself was caught by its own tests.** The first walker treated `Error` like a plain object, but `name`/`message`/`stack` are non-enumerable — so it produced `{}` and **destroyed the error message**. Case 11 caught it.

`src/lib/logger.ts:19-25` uses single-wildcard paths:
```ts
      "*.password",
      "*.passwordHash",
      "*.password_hash",
      "*.currentPassword",
      "*.newPassword",
      "*.aadhaar",
      "*.aadhaarHash",
```

A pino `*.key` path matches exactly one intervening level. `req.body.password` is depth 3 and is **not** redacted; neither is `err.request.body.password`, nor `audit.changes.aadhaarLast4` (which the `recordAudit` failure path at `audit.ts:75` logs wholesale: `logger.error({ err: error, audit: input }, …)`).

The stated intent — *"even if a handler logs a whole request body, these never reach the log sink"* (`logger.ts:7-10`) — does not hold for the most likely shape of such a log.

**Impact.** Latent. No handler currently logs a request body, so nothing leaks today; the defence-in-depth layer the comment promises simply is not there when someone adds one.

**Remediation.** Add the concrete deep paths in use (`req.body.password`, `req.body.currentPassword`, `req.body.newPassword`, `audit.changes`) and, where a wildcard is genuinely wanted, use pino's bracket wildcard syntax. Add a unit test asserting a redacted line for a nested body.

---

## SEC-020 — Raw Postgres constraint names returned to clients

| | |
|---|---|
| **Severity** | LOW |
| **Location** | `src/middleware/error-handler.ts:66-76` |
| **Status** | OPEN · **Phase** P3 |

`src/middleware/error-handler.ts:66-75`:
```ts
  if (pg?.code === "23505") {
    const message = pg.constraint ? CONSTRAINT_MESSAGES[pg.constraint] : undefined;
    res.status(409).json({
      error: {
        code: "conflict",
        message: message ?? "That record already exists",
        details: pg.constraint ? { constraint: pg.constraint } : undefined,
      },
    });
```

The `details.constraint` field is emitted for *every* unique violation, including the constraints absent from `CONSTRAINT_MESSAGES` (which covers 7 of the schema's unique indexes).

**Impact.** Discloses internal index and column naming — e.g. `customers_bank_reference_unique`, `settlements_period_unique`. Combined with the `409` itself, it also confirms the existence of a record with a submitted value on any table with a unique constraint; the partial unique index on `lower(email)` (`identity.ts:131`) makes `POST /api/users` an authenticated email-existence oracle. Low, because the route requires `users.create`.

**Remediation.** Map unknown constraints to a generic message and drop `details.constraint` from the response; log it server-side with the request id instead.

---

## SEC-021 — Permission keys echoed verbatim in 403 responses

| | |
|---|---|
| **Severity** | LOW |
| **Location** | `src/services/access.ts:93-97,166-174` |
| **Status** | OPEN · **Phase** P3 |

`src/services/access.ts:93-97`:
```ts
export function assertPermission(ctx: AuthContext, key: string): void {
  if (!ctx.permissions.has(key)) {
    throw forbidden(`Missing required permission: ${key}`);
  }
}
```

`src/services/access.ts:170-173` is more expansive, naming up to five keys the caller lacks:
```ts
    throw forbidden(
      `You cannot grant permissions you do not hold: ${escalations.slice(0, 5).join(", ")}`,
    );
```

**Impact.** An authenticated low-privilege user can map the complete permission catalogue and the exact key guarding each endpoint by walking the 96 routes and reading the 403 bodies — useful reconnaissance for choosing an escalation target. This is a deliberate trade-off for operability (`errors.ts:21-27` shows the author reasoning carefully about which distinctions to expose) and it partially conflicts with `GET /api/roles/permissions`, which lists the catalogue to `roles.view` holders anyway.

**Remediation.** Return the bare `"You do not have access to this resource"` default to the client and attach the specific key to the server-side log line. Keep the detailed message for the `assertCanGrantPermissions` path only if product feedback requires it, since that caller is by definition already privileged.

---

## SEC-022 — JWT verification does not pin the algorithm

| | |
|---|---|
| **Severity** | LOW |
| **Location** | `src/lib/tokens.ts:40-64` |
| **Status** | OPEN · **Phase** P2 |

`src/lib/tokens.ts:42-45`:
```ts
    const decoded = jwt.verify(token, env().JWT_ACCESS_SECRET, {
      issuer: "risenext-crm",
      audience: "risenext-crm-api",
    }) as AccessTokenClaims;
```

No `algorithms` option; the same omission at lines 55-58 for the refresh token.

**Impact.** Bounded, and lower than the generic form of this issue. `jsonwebtoken@9` derives the permitted set from the key type: a string secret admits `HS256`/`HS384`/`HS512` only, so `alg: none` is rejected and the classic RS256→HS256 confusion attack is not reachable — there is no asymmetric key in play. The residual risk is (a) an attacker may choose which HMAC variant the server computes, and (b) if the system ever migrates to an asymmetric key, the confusion attack becomes live and the omission will not be noticed.

The mitigations that matter are already present: `tokenType` is asserted after verification (lines 46, 59); issuer and audience are pinned; and `requireAuth` re-reads authority from the database on every request rather than trusting claims (`middleware/auth.ts:26`).

**Remediation.** Add `algorithms: ["HS256"]` to both `jwt.verify` calls. One line, removes the class entirely, and makes a future key-type migration fail loudly instead of silently.

---

## SEC-023 — Temporary password rendered unmasked and written to the OS clipboard

| | |
|---|---|
| **Severity** | LOW |
| **Location** | `frontend/src/components/shared/credential-handover.tsx:42-53,59-65,93` (untracked) |
| **Status** | OPEN · **Phase** P3 |

`credential-handover.tsx:59-65` renders the value as visible text with no masking and no reveal toggle:
```tsx
        <code
          className={`flex-1 truncate rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[13px] ${
            mono ? "numeric tracking-wide" : ""
          }`}
        >
          {value}
        </code>
```

`credential-handover.tsx:44` copies it to the system clipboard: `await navigator.clipboard.writeText(value);`

`credential-handover.tsx:93` applies the component to the credential: `<CopyField label="Temporary password" value={credential.temporaryPassword} mono />`

The backend half is sound: the plaintext exists only in the creating response (`admin.routes.ts:241-245,373-378`), only the argon2id hash is stored, and the logger redacts `*.password` (`logger.ts:19`).

**Impact.** Shoulder-surfing in an open-plan office; the value persisting in the OS clipboard (and, on Windows 11, in clipboard history, which is enabled by default and syncs across devices); and capture by screen-recording or screen-sharing during onboarding. There is no auto-dismiss and no clipboard clear.

**Remediation.** Mask by default with an explicit reveal control, add a visible countdown that clears the panel after ~60 seconds, and clear the clipboard entry after a short delay. Longer term, replace hand-over entirely with a single-use, time-limited set-password link so the administrator never sees the credential at all.

---

## SEC-024 — `documents.storage_key` is client-supplied free text with no traversal guard

| | |
|---|---|
| **Severity** | LOW **today** — ⚠️ **re-rate to HIGH the day Task 9.3 lands.** See the trigger note below |
| **Location** | `src/modules/operations.routes.ts:553-558` *(was `:391-402`; re-verified 2026-09-05 — `storageKey` is now `:556`, `checksum` `:557`)*; `src/db/schema/operations.ts` `documents` table |
| **Status** | OPEN · **Phase** P2 · **Owner: Tasks 9.4 + 9.5.** Closes only when **both** have landed and are tested |

> **Severity trigger recorded 2026-09-05, Wave 0 ([D-073](DECISIONS.md)).** This finding is LOW **only because no dereference point exists** — the Impact paragraph below says so explicitly. **Task 9.3 builds the storage service and Task 9.5 is the detonation**, not 9.4. The moment a content route reads `storage_key`, every historical row becomes a traversal payload. **Re-rate this finding as part of 9.3, before 9.5 is written**, so the implementer meets a HIGH finding rather than a LOW one.
>
> **`checksum` has the same defect and this finding does not mention it.** `operations.routes.ts:557` accepts a client-supplied 128-character `checksum` that the server never writes and never verifies — a client can therefore assert the integrity of its own file. **9.4 must remove both fields from `createSchema`**, not just `storageKey`.
>
> **Do not close this finding when 9.4 lands.** Server-generated keys stop *new* poisoned rows; they do nothing about rows already in the table. 9.5 must treat every pre-existing `storage_key` as untrusted at the dereference point, and that is the second half of the fix.

`src/modules/operations.routes.ts:399` accepts an arbitrary 500-character string:
```ts
    storageKey: z.string().trim().max(500).optional().nullable(),
```

`createScopedResource` writes it straight through (`scoped-resource.ts:181-189`) and returns it on every read (`scoped-resource.ts:132-138,157-161`). The column is nullable text (`operations.ts:371`).

**Impact.** None today, and this is important to state precisely: **file storage does not exist in this system.** There is no `fs`, no `path.join`, no `res.sendFile`, no object-store SDK anywhere in `src` (verified by grep). `multer` appears only in `imports.routes.ts` with `memoryStorage`, where the buffer is parsed and discarded. `/api/documents` is pure JSON CRUD. Nothing ever dereferences `storage_key`.

The finding is latent, not live: the field is an attacker-controlled, unvalidated, path-shaped string being accumulated in the database today. The day a download endpoint is implemented against it — the obvious next step for a documents module — every historical row becomes a traversal payload (`../../etc/passwd`, `s3://other-tenant/...`) unless the implementer independently remembers to distrust a column their own API populated.

**Remediation.** Remove `storageKey` from `createSchema` — it should be server-generated when upload is implemented, never client-supplied. If it must stay for import compatibility, constrain it with a strict pattern (`/^[A-Za-z0-9._\/-]+$/`, no `..`, no leading `/`), and treat existing rows as untrusted when the download path is built.

---

## SEC-025 — `AADHAAR_PEPPER` absent from `.env.example`; `frontend/.gitignore` misses non-`.local` env files

| | |
|---|---|
| **Severity** | LOW |
| **Location** | ~~`.env.example` (33 lines)~~ **deleted**; `.env.example`; `frontend/.gitignore`; repository root |
| **Status** | ✅ **RESOLVED 2026-09-06** — both halves. Half one closed by Task 0.4 (2026-09-01); half two by Wave 0 (**D-080**) |

> ### ✅ RESOLVED — 2026-09-06, in two parts nearly five weeks apart
>
> **Half one — `.gitignore` coverage — closed 2026-09-01 (Task 0.4).** The root `.gitignore` ignores `.env` and `.env.*` **at every depth** while keeping the `.env.example` templates trackable (`!.env.example`, `!.env.*.example`, ordered after the `.env.*` pattern so the negation is not itself hidden). `frontend/.gitignore` covering only `.env*.local` no longer matters: the root rule reaches `frontend/.env` recursively.
>
> **Half two — template coverage — closed 2026-09-06 (Wave 0).** This half had **got worse** since the finding was written, and the audit of 2026-09-06 caught it:
>
> | | Before Wave 0 | After |
> |---|---|---|
> | root `.env.example` | 18 of 28 keys; **no `AADHAAR_PEPPER`**, no storage keys, no `LOG_LEVEL`, and a frontend key mixed in | **deleted** — no root consumer exists (D-080) |
> | `.env.example` | 21 of 28 keys; **no storage keys at all** | **all 28** keys plus `LOG_LEVEL` |
>
> The storage omission was the sharper of the two and was **not** in the original finding, because Phase 9 had not happened yet: `env.ts:193-200` **refuses to boot in production** without five `STORAGE_*` keys, and **neither template named any of them**. A deployer following either file to the letter got an unexplained boot failure.
>
> **No secret value was introduced.** `EMAIL_API_KEY`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` and `BOOTSTRAP_SUPERADMIN_PASSWORD` all ship **empty**, deliberately, so a copied `.env` cannot look configured. `AADHAAR_PEPPER` still ships its **known-bad default on purpose**, so the production boot guard fires with a clear message rather than silently protecting real Aadhaar numbers with a pepper published in this repository.

**Findings, each verified.**

1. **`AADHAAR_PEPPER` is undocumented.** `.env.example` was read in full: it covers server, database, auth, CORS, bootstrap, `RECYCLE_BIN_RETENTION_DAYS`, `MAX_UPLOAD_MB` and the frontend variable. It does not mention `AADHAAR_PEPPER`. An operator following the file exactly will deploy with the committed default (SEC-007) and receive no warning unless `NODE_ENV` is exactly `"production"`.
2. **`frontend/.gitignore` ignores only `.env*.local`.** A `frontend/.env` or `frontend/.env.production` would be committed. `.gitignore` is correct (`.env`, `.env.*`, `!.env.example`).
3. **No repository-root `.gitignore`.** Confirmed absent; nothing protects a root-level `.env`, which is exactly where `dotenv/config` (`src/config/env.ts:1`) looks when the process is started from the repository root.
4. **`.env.example` sets `NODE_ENV=development` on line 2** — copied to a production host verbatim, this is the precise condition that disables the `AADHAAR_PEPPER` and JWT-secret-collision guards at `env.ts:44-51`.

**Impact.** Deployment-time misconfiguration is the delivery mechanism for SEC-007, and the checked-in template actively steers an operator toward it. The `.gitignore` gaps make a future secret commit materially more likely.

**Abuse scenario.** An engineer sets up staging by copying `.env.example` to `.env`, filling in the Neon URL and the two JWT secrets, and deploying. `NODE_ENV` stays `development`; `AADHAAR_PEPPER` is never set. Staging is loaded with a production data extract for UAT. Every Aadhaar hash in that environment is reversible with the repository's committed pepper, and nothing anywhere flagged it.

**Remediation.**
1. Add `AADHAAR_PEPPER=` to `.env.example` with a generation command and a "must be unique per environment; never reuse across environments" note.
2. Extend `frontend/.gitignore` to `.env` and `.env.*` with `!.env.example`, mirroring the backend.
3. Add a root `.gitignore` covering `.env`, `.env.*`, `!.env.example`, `node_modules`, and `__pycache__` (which currently exists untracked at `frontend/__pycache__`).
4. Change the `NODE_ENV` line in `.env.example` to a comment explaining the guards it controls.
5. Add a secret-scanning pre-commit hook — trivially valuable given there is no CI at all (`.github` absent; zero `.yml` files in the repository).

---

<a id="verified-safe"></a>
# Verified safe — do not re-investigate

Each item below was tested against source and found sound. The evidence is recorded so future sessions can skip the work. **A "safe" verdict here is scoped to the audited commit and working tree.**

| # | Class | Verdict | Why, with evidence |
|---|---|---|---|
| 1 | **SQL injection** | **SAFE** | Every query is built with Drizzle's parameterised builders. `sql.raw` appears **zero** times in `src`. The two hand-written `sql` templates that touch user data interpolate only column references (rendered as identifiers) and values (rendered as `$n` binds): `admin.routes.ts:106` (`exists (select 1 from user_bank_access …)`) and `admin.routes.ts:925`. Dynamic column selection in the factory (`scoped-resource.ts:118,125`) indexes a fixed `config.filterable` / `config.searchable` allow-list, never a request key, and guards with `typeof value === "string"`. The remaining `sql` uses are schema-level index predicates. |
| 2 | **Mass assignment / over-posting** | **SAFE** | Every write parses through a Zod object schema, and Zod strips unknown keys by default (no `.passthrough()` anywhere). `customerInput` (`customers.routes.ts:24-67`) and `userInput` (`admin.routes.ts:41-57`) contain no privilege or ownership fields; `createdBy` / `updatedBy` / `deletedBy` are set server-side from `ctx.userId` (`customers.routes.ts:195-196`, `scoped-resource.ts:186-187`, `admin.routes.ts:209-210`). The `...rest` spreads at `customers.routes.ts:187,242` are spreads of *already-parsed* output, not of `req.body`. `PATCH /users/:id` explicitly enumerates the ten assignable fields (`admin.routes.ts:279-295`) rather than spreading. |
| 3 | **`password_hash` leakage** | **SAFE** | `GET /api/users` projects 15 named columns and omits it (`admin.routes.ts:113-131`, with the assertion documented at line 147). `POST /users` returns `{ id, email, name }` (line 242); `PATCH /users/:id` returns `{ id, name, email }` (line 310); `reset-password` returns `{ id, name, email }` (line 374). `profileOf` (`auth.routes.ts:59-72`) builds from `AuthContext`, which never loads the hash (`access.ts:31-49`). The unprojected `select()` at `admin.routes.ts:274` *does* read the hash, but it is consumed only by `diff()`, where `passwordHash` is in `REDACTED_FIELDS` (`audit.ts:20`). |
| 4 | **Refresh-token storage, rotation, reuse detection** | **SAFE — the strongest control in the system** | Stored as `sha256` only, never plaintext (`auth.routes.ts:41`, `password.ts:31-33`). Rotated on every use: the presented token is revoked (lines 183-186) before a new one is issued (line 188). Reuse of an already-revoked token revokes **every** session for that user, treating it as compromise (`auth.routes.ts:172-181`). Expiry and revocation are re-checked in the database, not merely in the JWT. `POST /auth/change-password` revokes all refresh tokens (lines 251-254) and clears the cookie; the working-tree `reset-password` does the same in-transaction (`admin.routes.ts:360-363`). Cookie is `httpOnly`, `secure` in production, `sameSite: "none"` in production with `path: "/api/auth"` (`tokens.ts:66-89`), so it is not sent to business routes at all. |
| 5 | **CSRF** | **SAFE — but the mechanism is non-obvious** | All 94 business endpoints authenticate by `Authorization: Bearer` only (`middleware/auth.ts:7-13,21-31`); a cross-site request cannot set that header, and the access token lives in a module variable, never in a cookie or storage (`lib/api.ts:17`). The two cookie-authenticated routes, `/auth/refresh` and `/auth/logout`, are protected by the CORS origin function: a disallowed `Origin` causes `callback(new Error(…))` → `next(err)`, and Express skips the remaining non-error middleware, so **the route body never runs** (`app.ts:56-59`). This is what stops a simple cross-site form POST to `/auth/logout` from revoking a victim's session under `SameSite=None`. The `if (!origin) return callback(null, true)` allowance is not a hole: browsers always send `Origin` on cross-origin state-changing requests, and a non-browser client has no victim cookies. **Consequence for SEC-018:** the 500 must be replaced with a *terminating* 403, never a fall-through. |
| 6 | **IDOR / BOLA on bank-scoped resources** | **SAFE** | `bankScope()` is the single choke point (`access.ts:108-111`) and fails closed — a user with zero assignments gets `inArray(column, [NO_BANK_SENTINEL])` with an all-zero UUID that cannot exist (`access.ts:113-114`), so they see nothing rather than everything. The factory routes every read through one `scopedWhere` (`scoped-resource.ts:94-100`), used by list (130), detail (160), update (215) and delete (259). A client `bankId` filter narrows and can never widen (`scoped-resource.ts:109-113`, `customers.routes.ts:104-107`). Writes assert against the *payload* `bankId` (`scoped-resource.ts:177`, `customers.routes.ts:174`), and reassignment to another bank re-asserts on the destination (`scoped-resource.ts:221-223`, `customers.routes.ts:235-237`). Out-of-scope and non-existent both return `404` with an identical body, by explicit design (`errors.ts:21-27`; comments at `scoped-resource.ts:162`, `customers.routes.ts:158`). *Exception:* see SEC-013 for the recycle-bin `null`-bank path. |
| 7 | **Privilege escalation via role change** | **SAFE** | One rule, applied consistently: act only on a *strictly greater* role level (`access.ts:144-149`). `POST /users` checks the assigned role (`admin.routes.ts:168`); `PATCH /users/:id` checks both the current target and any new role (lines 261, 266); `reset-password` (line 340) and `PUT /:id/banks` (line 394) check the target. Assigning `super_admin` additionally requires `system.manage_any_user` regardless of level (`access.ts:155-157`). Role creation and level edits are bounded by the actor's own level (`admin.routes.ts:531,584-585`). The database backs it up: system roles cannot be deleted, re-keyed or deactivated (`0001_governance_guards.sql:56-83`). |
| 8 | **Granting permissions you do not hold** | **SAFE** | `assertCanGrantPermissions` (`access.ts:166-174`) rejects any key not in the actor's own set, and is called on both mint and edit paths (`admin.routes.ts:533,629`). The comment names the exact attack it closes — an Admin minting a role carrying `system.access_all_banks` and self-assigning it. `PUT /:id/permissions` additionally refuses to touch the system role at all (`admin.routes.ts:626`) and validates that every submitted key exists (line 638). |
| 9 | **Path traversal / arbitrary file access** | **SAFE (no filesystem surface)** | Grep across `src` for `node:fs`, `from "fs"`, `path.join`, `res.sendFile`, `res.download`: **zero** matches (the only `path.` hits are Zod issue paths in `env.ts:40` and `error-handler.ts:51`). `multer` is used once, with `memoryStorage`, and the buffer is parsed by ExcelJS and dropped (`imports.routes.ts:27-29,167`). Nothing is written to or read from disk. See SEC-024 for the latent hazard when this changes. |
| 10 | **XSS (stored / reflected)** | **SAFE** | Exactly one `dangerouslySetInnerHTML` in the entire frontend, and its payload is a static template literal with no interpolation — the pre-hydration theme script (`frontend/src/components/theme-script.tsx:9-10`). Zero occurrences of `innerHTML`, `eval(`, or `new Function` in `frontend/src` or `src`. Everything else renders through React's escaping JSX. Note this is the *only* layer: SEC-011 removes the CSP that would contain a future regression. |
| 11 | **Prototype pollution** | **SAFE** | No recursive merge, `Object.assign` into a shared target, or `lodash.merge` anywhere. Object construction is by explicit spread of Zod-parsed output into fresh literals (`scoped-resource.ts:183-188`, `customers.routes.ts:186-197`). `rootCause` (`error-handler.ts:28-34`) walks `.cause` read-only with a depth cap of 5. `express.urlencoded({ extended: true })` (`app.ts:71`) uses `qs`, which has had `__proto__` filtering since 6.x; no route reads a nested query object regardless. |
| 12 | **ReDoS** | **SAFE** | Every regex in the codebase is anchored, bounded and free of nested quantifiers: `/^[A-Z]{5}\d{4}[A-Z]$/`, `/^\d{10}$/`, `/^\d{12}$/`, `/^\d{6}$/`, `/^[a-z][a-z0-9_]{1,40}$/`, `/^\d{5}$/`, `/\D/g`, `/\s|-/g`, `/\/$/`, `/\s*\*$/`. Inputs are length-capped by Zod before the regex runs. No user-supplied string is ever compiled into a `RegExp`. |
| 13 | **Secrets in git history** | **SAFE** | 13 commits total. `git log --all --diff-filter=A --name-only` matched against `\.env|secret|credential|\.pem|\.key` returns exactly two files, ever: `.env.example` and `frontend/.env.example`. Both were read in full; both contain placeholders only (`replace-me-min-32-chars-…`, `USER:PASSWORD@ep-xxxx…`, an empty `BOOTSTRAP_SUPERADMIN_PASSWORD=`). No real credential has entered history. See SEC-025 for the `.gitignore` gaps that make a future leak likelier. |
| 14 | **The `localStorage` permission cache** | **SAFE** | `persistAuthUser` writes the profile — permissions included — to `localStorage` under `risenext-auth-user` (`use-auth.tsx:63-78`), and `can()` / `canAny()` read from it (`use-auth.tsx:259-272`). Tampering changes only which menu items render. The server never trusts it: `requireAuth` re-reads role, permissions and bank assignments from the database on **every** request (`middleware/auth.ts:21-31` → `access.ts:30-86`), deliberately preferring the round trip so a revoked permission takes effect immediately rather than at token expiry. Forging permissions client-side yields a UI that renders buttons which return `403`. The access token is correctly **not** persisted (`lib/api.ts:17` holds it in a module variable). |
| 15 | **Login timing side-channel** | **SAFE (structurally)** | `DUMMY_HASH` (`auth.routes.ts:154-155`) is a structurally valid argon2id PHC string — parameters `m=19456,t=2,p=1` match `OPTIONS` (`password.ts:8-13`), the salt segment decodes to 16 bytes and the digest segment to 32 — so `argon2.verify` performs the full KDF for unknown accounts rather than throwing early. Response duration is therefore comparable. *Caveat:* a residual, much smaller difference remains because the known-account path issues an extra `UPDATE` (lines 116-125). The real enumeration oracle is not timing — it is the 429 (SEC-004). |

**Also confirmed absent** (so no finding can be written against them, and no future session should look): **email** — zero provider dependencies, zero transport code, zero templates, zero `EMAIL_`/`SMTP_`/`MAIL_` variables; **file storage** — see row 9; **notifications** — `insert(notifications)` returns zero matches across `src`, so no row is ever created and the two read routes (`admin.routes.ts:955,974,987`) always operate on an empty set; **`app_settings`** — the table is declared at `governance.ts:95` and referenced nowhere outside the schema; **CI** — no `.github`, zero `.yml` files, no `Dockerfile`, no `vercel.json`, no `Procfile`; **any scheduler** — no cron, no `setInterval`, which is why `expiredEntries` (`recycle-bin.ts:240`) is dead code and the recycle bin's 30-day purge is unimplemented.

---

<a id="secrets-inventory"></a>
# Secrets inventory

All values redacted. Sources: `src/config/env.ts:4-26`, `.env.example`, `frontend/.env.example`, `frontend/src/lib/demo/config.ts`, `src/modules/auth.routes.ts`.

| File | Variable name | Required? | Insecure default? | Notes |
|---|---|---|---|---|
| `src/config/env.ts:11` | `JWT_ACCESS_SECRET` | **Yes** — boot fails | No | Min 32 chars enforced by Zod. Placeholder in `.env.example:13` is `replace-me-…`, which *passes* the length check — a copied template boots with a guessable secret. |
| `src/config/env.ts:12` | `JWT_REFRESH_SECRET` | **Yes** — boot fails | No | Same. The "must differ from access secret" check (`env.ts:48-50`) fires **only** when `NODE_ENV === "production"` — the two placeholders in `.env.example` do differ, but only by their trailing filler. |
| `src/config/env.ts:25` | **`AADHAAR_PEPPER`** | No — silently defaults | **YES — committed default** | The value is in the repository. Guard at `env.ts:44-47` fires only when `NODE_ENV === "production"`, which itself defaults to `development` (`env.ts:5`). **Absent from `.env.example` entirely.** Drives SEC-007. |
| `src/config/env.ts:8` | `DATABASE_URL` | **Yes** — boot fails | No | Neon pooled connection string; contains embedded credentials. Format documented at `.env.example:7`. Can surface verbatim in a driver message via SEC-015. |
| `src/config/env.ts:9` | `DIRECT_DATABASE_URL` | No | No | Direct (non-pooled) string for migrations. Same credential exposure class. |
| `src/config/env.ts:21` | `BOOTSTRAP_SUPERADMIN_PASSWORD` | No | No — empty in template | Consumed once by `src/db/seed.ts:83`; validated against `passwordProblems` (`seed.ts:94`). **Remains a valid credential indefinitely** because `mustChangePassword` is unenforced (SEC-010). Lives in the platform dashboard, visible to everyone with deploy access, with no rotation path. |
| `src/config/env.ts:20` | `BOOTSTRAP_SUPERADMIN_EMAIL` | No | Yes — template names a real-looking address (`.env.example:24`) | Not a secret, but it fixes the target for SEC-004/SEC-006 against the highest-privileged account. |
| `src/config/env.ts:15` | `COOKIE_DOMAIN` | No | No | Optional; widens refresh-cookie scope to subdomains when set. Verify before setting. |
| `src/config/env.ts:17` | `CORS_ORIGIN` | No — defaults to `http://localhost:3000` | Yes, for production | Comma-split allow-list (`env.ts:64-68`). Left at the default, production browsers are rejected — and every rejection is a 500 (SEC-018). |
| `src/config/env.ts:5` | `NODE_ENV` | No — defaults to `development` | **Yes** | Controls three security behaviours: the `AADHAAR_PEPPER` guard, the JWT-secret-collision guard (`env.ts:44-51`), and cookie `secure`/`sameSite` (`tokens.ts:75-82`). Anything other than the exact string `"production"` silently degrades all three. `.env.example:2` ships `development`. |
| `frontend/src/lib/demo/config.ts:15` | **`DEMO_PASSWORD`** | n/a — hardcoded constant | ~~YES~~ → **No, as of Task 1.3 (2026-09-01)** | Not an environment variable. It *was* compiled into the JavaScript served to every visitor via `lib/api.ts` → `lib/demo/api.ts` → `./config`, which drove SEC-001. A default `npm run build` now aliases `@/lib/demo` away entirely, so it is absent from the bundle — verified by searching the output. **It still ships in a build made with `NEXT_PUBLIC_ENABLE_DEMO=true`, which must never be a production deployment.** |
| `frontend/src/lib/demo/config.ts:14` | `DEMO_EMAIL` | n/a — hardcoded constant | Same as above | The matching identifier, same module, same build-time switch. |
| `frontend/next.config.ts:35` | `NEXT_PUBLIC_ENABLE_DEMO` | No — unset means "exclude in a production build" | No | **Not a secret**: the value is `"true"`/`"false"` and is read only by `next.config.ts` at build time. It is nonetheless security-relevant, because setting it to `"true"` on a production deploy reinstates the two rows above. |
| `src/modules/auth.routes.ts:154` | `DUMMY_HASH` | n/a — hardcoded constant | No | A fixed argon2id digest used solely for timing equalisation. Not a credential; publishing it costs nothing. Verified structurally valid (Verified Safe, row 15). |
| `frontend/.env.example:4` | `NEXT_PUBLIC_API_URL` | No — defaults to `http://localhost:8080` (`lib/api.ts:13-15`) | No | Public by definition (`NEXT_PUBLIC_` prefix). Not a secret. |
| `frontend/.env.example:6-7` | `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_ENV` | No | No | Public. Neither is read anywhere in `frontend/src` (grep: zero hits) — dead configuration. |
| `src/lib/logger.ts:3` | `LOG_LEVEL` | No | No | Not a secret. Raising it to `debug` in production would widen the blast radius of SEC-019. |

---

# Remediation roadmap

| Phase | Gate | Findings | Rationale |
|---|---|---|---|
| **P0** | **Must close before any deployment holding real customer data** | ~~SEC-001~~ ✅, ~~SEC-027~~ ✅, SEC-002, SEC-003, SEC-005, SEC-007, SEC-009 | An unauthenticated write primitive into an uncorrectable table; a one-request unrecoverable lockout; no throttling of a memory-hard KDF; and two independent paths by which Aadhaar becomes plaintext. Each is exploitable by an attacker with no privileged position, or destroys the system's own recoverability. **SEC-001 — the shipped credential and the storage-flag auth bypass — was closed on 2026-09-01 and is the first P0 off this list.** |
| **P1** | First hardening sprint | SEC-004, SEC-006, SEC-008, SEC-010, SEC-011, SEC-012, SEC-013, SEC-015, SEC-025 | Enumeration and permanent account DoS; import resource exhaustion; the forced-password-change gate that does not exist server-side; the security headers that do not exist on the origin that matters; the open image proxy; the recycle-bin scoping hole; the unauthenticated driver-message leak; and the deployment template that steers operators into SEC-007. |
| **P2** | Before scale-out / first external audit | SEC-014, SEC-016, SEC-017, ~~SEC-018~~ ✅, SEC-019, SEC-022, SEC-024, SEC-026 | Audit-query correctness; the missing workflow state machine (and the zero CHECK constraints behind it); the PII retention problem in an immutable table; log amplification; redaction depth; algorithm pinning; the latent traversal field; and the forged 403 on the `/users/*` credential paths in demo-enabled builds. |
| **P3** | Backlog | SEC-020, SEC-021, SEC-023 | Information disclosure and credential-handling ergonomics. Real, low-yield, safe to schedule. |

**Cross-cutting prerequisites, none of which currently exist and all of which gate the phases above:**

1. **A scheduler.** No cron, no `setInterval`, no platform job. Without one, SEC-009's retention fix, SEC-017's audit retention, and the already-written-but-uncalled `expiredEntries` (`recycle-bin.ts:240`) cannot ship. The recycle bin's advertised 30-day purge is currently unimplemented for the same reason.
2. **CI.** No `.github`, zero `.yml` files, no container or platform manifest. The 171 existing backend runtime test cases (plus 55 frontend cases) — authorization 26, workflow 22, frontend-contract 34, employee-lifecycle 25 (untracked) — run against real migrations on PGlite and are genuinely good, but nothing runs them automatically. Add a pipeline with `npm test`, `npm run typecheck`, `npm run lint`, and secret scanning before attempting the P1 work.
3. **Security regression tests.** Each closed finding should land with a test. `src/tests/authorization.test.ts` is the natural home for SEC-003, SEC-010 and SEC-013; SEC-014 and SEC-016 belong in `workflow.test.ts`.
4. **A break-glass runbook.** SEC-003 has no in-product recovery. Even after the guards are added, document and rehearse the `DIRECT_DATABASE_URL` recovery procedure.

---

## Audit provenance

- **Reviewed in full:** `src/app.ts`, `config/env.ts`, `lib/{errors,logger,password,tokens}.ts`, `lib/permissions.ts:180-315`, `middleware/{auth,error-handler}.ts`, `modules/{auth,admin,customers,health,imports,scoped-resource}.routes.ts`, `modules/operations.routes.ts:385-430`, `services/{access,audit,recycle-bin}.ts`, `db/schema/governance.ts:1-95`, `db/seed.ts:80-130`, `drizzle/0001_governance_guards.sql`, `frontend/next.config.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/demo/{config,session,index,api}.ts`, `frontend/src/hooks/use-auth.tsx`, `frontend/src/components/layout/app-shell.tsx`, `frontend/src/components/shared/credential-handover.tsx`, `frontend/src/components/theme-script.tsx`, `frontend/src/lib/password-policy.ts`, `.env.example`, `frontend/.env.example`, both `.gitignore` files, `package.json`, `frontend/package.json`.
- **Library internals inspected to settle disputed claims:** `helmet@8.3.0` (`index.cjs:342-354,538-586`) for the default header set; `drizzle-orm@0.44.7` (`sql/expressions/conditions.cjs:64-79`) for `and()` parenthesisation.
- **Exhaustive greps run:** `sql.raw`, `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function`, `node:fs`/`path.join`/`sendFile`/`download`, `rate-limit`/`rateLimit`/`slow-down`, `cron`/`setInterval`/`schedule`, `mustChangePassword`, `disableDemoMode`/`enableDemoMode`/`isDemoMode`, `insert(notifications)`, `appSettings`, `storageKey`/`storage_key`, `aadhaar`, `expiredEntries`, and `git log --all --diff-filter=A` filtered for secret-bearing filenames.
- **Not executed:** no build, no test run, no server, no request, no database connection, no `git` command that mutates state. No file outside `docs/SECURITY_AUDIT.md` was created or modified.
- **Open UNVERIFIED items:** none. Every finding in this register was traced to source. The one claim that resisted purely static confirmation — whether `DUMMY_HASH` is a digest that `argon2.verify` will actually compute against rather than reject — was settled structurally (PHC parameters, salt and digest segment lengths all valid) and is recorded with that reasoning in Verified Safe, row 15 rather than asserted from the code comment.
