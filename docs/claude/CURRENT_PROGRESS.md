# CURRENT PROGRESS

> ## ✅ WAVE 5 + WAVE 6 (CLAUDE-DOABLE) COMPLETE — 2026-09-06
>
> ## STATUS: **READY FOR THE HUMAN PRODUCTION-SETUP PHASE**
>
> **Gates:** backend **1258/1258 · 55 files** · frontend **1143/1143 · 52 files** · both typechecks clean · backend lint clean · frontend lint **58** (unchanged baseline) · `db:generate` zero diff · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16** · demo exclusion PASSED · `next build` exit 0. **No new migration.**
>
> | Row | Result |
> |---|---|
> | **15.9** | ✅ Four scheduled jobs + CLI, 33 cases. **No schema change** (D-092) |
> | **SEC-009** | 🔶 Retention half **built and tested**; **not in effect** until the cron is wired. Stays OPEN |
> | **15.7** | ✅ **SEC-019 closed.** Redaction by key name at any depth (D-094) |
> | **15.5** | ✅ Error tracking + real error boundaries, config-gated, PII-safe (D-093) |
> | **15.1 / 15.4** | ✅ Dockerfile, railway.json, vercel.json, release script. OD-3 → D-091, OD-4 → D-090 |
> | **14.7** | ✅ CI exists, and `ci-local.sh` **ran it — 2 real defects found and fixed** |
> | **15.15** | ✅ Both `.env.example` files corrected and now **enforced by tests** |
> | **15.12** | ✅ Six operational documents; every command in them exists |
> | **Q9** | ✅ Five-role matrix, 37 endpoints, 41 cases |
> | **16.x** | ✅ Zero-fake sweep across **all twenty screens** |
>
> **Registers:** SEC-019 resolved → **0 CRITICAL · 1 HIGH · 2 MEDIUM · 6 LOW, 9 open / 21 resolved**. Readiness **130/160 = 81%**.
>
> **Three defects of my own were caught by measurement and fixed, not suppressed.** The log walker destroyed `Error` messages (non-enumerable fields) — caught by its own case 11. The CI zero-diff check used `git diff`, which asks a different question and reported a failure unrelated to the schema. And the zero-fake sweep's first mock returned a fresh settings object per render, which loops against Wave 4's render-time adjustment.
>
> ⚠️ **EXTERNAL, and none of it fabricated:** Docker image never built (daemon unavailable) · CI never run on GitHub Actions · **migrations never run against real Postgres** · S3 has never made a network call · no email has ever reached Resend · no restore rehearsed · **OD-5** DPDP counsel · **OD-6** penetration test.


> ## (superseded) ✅ WAVE 4 COMPLETE — 2026-09-06
>
> **Gates:** backend **1188/1188 · 51 files** · frontend **1105/1105 · 49 files** · both typechecks clean · backend lint clean · frontend lint **58** (1 pre-existing error, unchanged baseline) · `db:generate` **no schema changes** · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16** · demo exclusion PASSED · `next build` exit 0, 27 routes. **No new migration — Wave 4 needed no schema change.**
>
> | Row | Result |
> |---|---|
> | **12.3** | ✅ `PATCH /api/teams/:id` — `teams.edit` had two holders and **no route**. The leader designation is authorized like a roster change, and the same guard covers `POST`. **Reversion-proven — 3 of 27** |
> | **12.5** | ✅ **SEC-014 / BUG-016 closed.** One pair of parentheses. **Reversion-proven — 5 of 21** |
> | **12.4** | ✅ `meta.total` + actor/bank/date filters, and `/audit-logs` renders the trail for the first time |
> | **12.1** | ✅ `/roles` — six routes with zero callers now have a screen |
> | **12.2** | ✅ `/teams` — a fresh deployment previously had **no in-product way to create a team at all** |
> | **12.6** | ✅ `app_settings` was dead in the schema; it has a closed registry and **one live consumer** |
> | **U-14** | ✅ OD-8 applied — `settings.edit` = Super Admin + Admin (**D-086**) |
> | **12.8** | ✅ Real `refresh_tokens`, revocation proven by using the cookie afterwards |
> | **12.10** | ✅ **BUG-023 closed.** Fourteen entries rendered for all five roles; the Ctrl+K palette had the same defect |
>
> **Registers:** SEC-014 resolved → **0 CRITICAL · 1 HIGH · 2 MEDIUM · 7 LOW, 10 open / 20 resolved.** BUG-016 + BUG-023 closed → **19 open**. Readiness recomputed mechanically: **123/160 = 77%**.
>
> **Two defects of my own were caught by measurement and fixed, not suppressed.** Seeding the settings draft in a `useEffect` tripped `react-hooks/set-state-in-effect` — replaced with React's render-time adjustment. And `useSettings`/`useSessions` depended on the `user` **object**, which loops against any provider handing back a fresh literal; keyed on `user.id` instead.
>
> **Three things Wave 4 deliberately did not build**, each with the reason recorded on the panel itself: per-user preferences and alert preferences (`app_settings` has **no user column** — a missing table, not a missing route), and invoice numbering (settlement numbers come from `code_sequences`, so a stored prefix would be read by nothing).
>
> ⚠️ **Waves 5 and 6 are NOT started.** No CI, no container, no deploy config, no backups, no error tracking, no scheduled jobs. **The application has never been deployed, the migrations have never run against real Postgres, and the S3 adapter has never made a live network call.** The one open HIGH — **SEC-009** — waits on 15.9's job runner.


> ## (superseded) ✅ WAVE 3 COMPLETE — 2026-09-06
>
> **Gates:** backend **1102/1102 · 47 files** · frontend **997/997 · 44 files** · both typechecks clean · backend lint clean · frontend lint **58** (1 pre-existing error) · `db:generate` **no schema changes** · `drizzle-kit check` fine · migrations/snapshots/journal **16/16/16**. **No new migration** — Wave 3 needed no schema change.
>
> **Both remaining P0 findings are closed. There is no CRITICAL security finding open.**
>
> | Finding | Result |
> |---|---|
> | **SEC-005** (P0) | ✅ login throttled per address AND per account; global limiter; argon2 capped at 4 concurrent. **Reversion-proven — 5 of 15 fail pre-fix** |
> | **SEC-007** (P0) | ✅ one shared projection across 5 call sites; pepper required everywhere at 32+; HMAC-SHA256 |
> | **SEC-008** | ✅ magic bytes, decompression ceiling, row cap that refuses not truncates, 4xx not 500 |
> | **SEC-013** | ✅ — and the **first fix was over-corrected**; four existing tests caught that it would have removed Manager's employee restore |
> | **SEC-002** | ⬇ CRITICAL → LOW. The *unthrottled* half is gone; the write primitive remains, bounded. **Not closed** |
> | **SEC-017** | ⬇ MEDIUM → LOW. Accretion stopped (8 → ~35 fields); free-text sinks and already-written rows remain. **Not closed** |
>
> **Financial correctness:** **11.3** reports aggregate in SQL (the screen was capped at 500 loans, so loan 501 was invisible and every total was a sum of a sample) · **11.7** the running balance is computed in the insert transaction with no row lock · **11.9** CSV formula injection closed losslessly and exports fetch every row · **U-5** `amount_approved` is captured at approval, a column previously written by nothing while the dashboard summed it.
>
> **The one HIGH left open is SEC-009** — plaintext Aadhaar retained in `import_rows`. 13.7 hardened ingest; the retention half needs the scheduled-job runner and is **15.9**, in Wave 5.
>
> ⚠️ **Waves 4–6 are NOT started**: the admin UI (Phase 12), all of production infrastructure (Phase 15), CI and real-Postgres verification (14.7/14.9), and the final gate (Phase 16). **The application has never been deployed, the migrations have never run on real Postgres, and the S3 adapter has never made a live network call.**

> ## (superseded) ✅ WAVES 1 AND 2 COMPLETE — 2026-09-06
>
> **Gates:** backend **996/996 · 40 files** · frontend **978/978 · 43 files** · both typechecks clean · backend lint clean · frontend lint **59** (1 pre-existing error; was 60/2) · `db:generate` **no schema changes** · `drizzle-kit check` fine · demo exclusion passes on both bundlers · migrations/snapshots/journal all **15**.
>
> **Wave 1 removed the last seventeen dishonest controls.** They were never in BUG-002's count. Each was checked against the API first — there is **no self-service profile endpoint** (`assertCanManageRoleLevel` refuses self-edit for every role), no `avatar_url` column, `app_settings` is dead, no sessions endpoint, and 2FA exists in no layer. The 2FA switch is deleted (**OPEN-8 → D-083**). `/reports`' "Excel" and "PDF" now say what they actually do.
>
> **Six security findings closed:** SEC-004, SEC-006, SEC-012, SEC-015, SEC-022 — each with a named regression test, and the auth ones **reversion-proven** (7 of 13 cases fail against pre-fix code). **SEC-011 is downgraded MEDIUM → LOW and stays open**: the headers are real and close clickjacking, plugin execution, base-tag hijacking, form exfiltration and mixed content, but `script-src 'unsafe-inline'` means it does **not** stop XSS (**D-082**).
>
> **Wave 2 landed migration `0014` and closed SEC-016.** Nine status CHECKs, repository total **4 → 13**. `verifications` was the last approve route accepting free text — the column NEXT_TASK carried forward five times as "belongs to the 13.13 sweep". `23514` is now mapped so a CHECK violation is a 422, not a 500 — **but only for `*_status_check` / `*_stage_check`**; any other CHECK is an internal failure and stays 500.
>
> **Three existing tests failed against `0014` and all three were fixed in the implementation, not weakened.** One of them revealed that the first `23514` mapping was too broad.
>
> ⚠️ **STOPPED AT OD-1.** Wave 2's second migration — ledger bank-scoping — needs the owner's answer on **OPEN-7**: are bank-less ledger entries legitimate? That answer decides whether `ledger_entries.bank_id` becomes `NOT NULL` or whether `bankScope` grows a NULL branch. **Waves 3–6 are not started.**

> ## (superseded) ✅ WAVE 0 — REPOSITORY INTEGRITY — COMPLETE 2026-09-06
>
> **No application code, no tests, no migration SQL and no journal entry changed.** Wave 0 repaired the migration tooling, completed the environment template and reconciled the state documents.
>
> **`npm run db:generate` was crashing** — `drizzle-kit` lists `meta/` to find snapshots and was parsing `meta/README.md` as JSON. Removing it exposed the real problem: with `0007` the newest snapshot, generation re-emitted every DDL statement from `0008`–`0013` as one new migration, which fails on statement one against a database that has already run them.
>
> **Snapshots `0008`–`0013` are reconstructed and proven** by reverse application, verified against `0007_snapshot.json` byte-for-byte and per-step against each shipped migration. `db:generate` now reports **"No schema changes"**; `drizzle-kit check` reports **"Everything's fine"**. See **D-081** and [`drizzle/SNAPSHOTS.md`](../../drizzle/SNAPSHOTS.md).
>
> **`.env.example` now covers all 28 `env.ts` keys** — Phase 9 added eight storage keys that no template named, five of which production **refuses to boot without**. The stale root `.env.example` is deleted (**D-080**). **SEC-025 closes.**
>
> **Registers reconciled:** **BUG-002 CLOSED** (39 recorded, 22 open — the old tally disagreed with its own table in four places). **SEC-009 assigned an owner, 13.7 + 15.9** — it had none. `PRODUCTION_READINESS.md` recomputed mechanically: **160 items, 104 DONE (65%)**, up from 66.
>
> ⚠️ **BUG-002's closure is narrower than it sounds.** It never counted the settings or reports pages, where **17 further controls** claim an outcome and issue no request. **Wave 1 owns them** — see [NEXT_TASK.md](NEXT_TASK.md).
>
> **Corrections to the note below:** the Drizzle-snapshot limitation is **resolved**, and `drizzle/meta/README.md` **no longer exists**. The S3 limitation stands. **OPEN-2 is resolved by owner approval** (AWS S3 `ap-south-1`); **nine other owner decisions remain**, listed in `NEXT_TASK.md`.

> ## (superseded) ✅ PHASE 6–10 — ALL 42 ROWS IMPLEMENTED AND VERIFIED
>
> **Updated 2026-09-06, final pass.** Backend **967/38**, frontend **949/39**, both typechecks clean, backend lint clean, frontend lint **60** (better than the 82 baseline), `next build` exit 0. Migrations `0008`–`0013`, each verified against a **populated** database.
>
> **The last three rows landed:** **6.3** (bank-order creation UI — bank derived from the loan, never chosen, because `assertSameBank` guards both) · **6.4** (loan submission opens its bank order inside the loan's own transaction, with migration `0013`'s partial unique index as the concurrency backstop D-027 permits) · **8.2** (transaction creation UI that never sends `status`, because `initialStatuses` admits only `Pending` and Manager holds `create` without `edit`).
>
> **All nine former fake controls are real**, pinned by 32 cases in `fake-controls.test.tsx` — each asserts the exact route called and that a refusal produces **no** success toast.
>
> **Two known limitations, neither a defect:** the S3 adapter has **never been run against a live bucket** (no credentials or network here; dev/test use the local adapter), and Drizzle snapshots are absent for `0008`–`0013` — documented with a safe remediation in `drizzle/meta/README.md`, deliberately not regenerated.
>
> **One owner decision remains:** OPEN-2, the storage-provider ratification. It gates the S3 adapter only.

> ## (superseded) ALL NINE FAKE CONTROLS ARE REAL; THREE ROWS REMAIN
>
> **Updated 2026-09-06, second pass.** Backend **951/37**, frontend **937/39** (+20), both typechecks clean, backend lint clean, frontend lint **61** (better than the 82 baseline), `next build` exit 0.
>
> **All nine remaining BUG-002 fake controls now issue real, awaited requests** and are covered by `fake-controls.test.tsx` (20 cases), which pins the route each one calls and asserts that a server refusal produces **no** success toast.
>
> **UI rows landed:** 6.1 (stage moves), 6.2, 6.6 · 7.1, 7.2, 7.4, 7.5 · 8.1, 8.3, 8.4, 8.5 · 9.6, 9.7, 9.9 + both demo dispatcher defects · 10.1, 10.2, 10.4, 10.5, 10.6, 10.9.
>
> **STILL NOT DONE — three rows:** **6.3** (bank-order creation UI), **6.4** (loan submission → bank-order creation), **8.2** (transaction creation UI). All three are *create* flows; every other control on those screens is real. Their backend routes exist and are enforced.
>
> Two controls deliberately call the **approve** route where the roadmap row said PATCH (7.1, 8.3) — following the rows literally would have reopened the D-056 privilege bypass one resource over.
>
> ⚠️ **Drizzle snapshots for `0008`–`0012` are absent.** Migration application is unaffected; `drizzle-kit generate` is. Recorded with a safe remediation in `drizzle/meta/README.md` — **deliberately not regenerated**, because a subtly wrong hand-written snapshot is worse than an absent one.

> ## (superseded) PHASE 6–10 — BACKEND COMPLETE, FRONTEND NOT STARTED
>
> **Updated 2026-09-06.** **Every backend row in the block is done and verified. No frontend row has been started.**
>
> **Landed:** `F1` · migrations **0008–0012** · **6.1**, **6.5** · **7.3**, **7.6**, **7.7a** · **8.1**, **8.2**, **8.3**, **8.6**, **8.7**, **8.8** · **9.2**, **9.3**, **9.4**, **9.5**, **9.7**, **9.8**, **9.10**, **9.11** · **10.3**.
>
> **Backend 795 → 951** across **37** files (+156). Backend typecheck clean, backend lint clean. Frontend **917**, typecheck clean, lint **82** (baseline), `next build` exit 0.
>
> **NOT started — 17 rows, all UI:** 6.2, 6.3, 6.4, 6.6 · 7.1, 7.2, 7.4, 7.5 · 8.4, 8.5 · 9.6, 9.9 · 10.1, 10.2, 10.4, 10.5, 10.6, 10.9.
>
> ⚠️ **All nine fake controls are still fake.** Every backend route they need now exists, is enforced and is tested — but no button has been wired to one, so **no Definition-of-Done box that says "from the UI" is met.**
>
> **Security closed this block:** four privilege bypasses (disbursement create + PATCH, transaction create, settlement approve free-text), the KYC self-verification hole, the settlement arithmetic hole, and SEC-024's write half.
>
> ⚠️ **Residual, recorded during 9.3 and unchanged:** `@aws-sdk/client-s3` is not a dependency and this block may not add one, so S3 requests are signed with hand-written SigV4 over `node:crypto`. The algorithm is unit-tested; **it has never run against a live bucket here.** Dev and test use the local filesystem adapter, so nothing in the suite exercises the S3 path.
>
> **One owner decision still open:** OPEN-2 (storage provider ratification). It gates the S3 adapter only — the interface, every consumer and all 34 Phase 9 tests run on the local adapter.

**Last updated:** 2026-09-06 · **Updated by:** Phase 6–10 Waves 0–2 + partial Wave 3/4
**Current phase:** **PHASE 5 — Loan / file workflow. ✅ COMPLETE 2026-09-05.** All eleven rows done, including the two Wave 0 added (**5.10**, **5.11**). The loan approve/reject control — *"the single most business-critical unreachable operation in the system"* — now issues a real request, the loan state machine is enforced at the API **and** at the database, and the verification workflow has a UI for the first time. **PHASE 4 IS COMPLETE** (4.1–4.11). **PHASE 3 IS COMPLETE** (3.1–3.12). **PHASE 2** is committed as `13237a9`.
**Status:** Verified 2026-09-05 — backend **795/795** across 28 files (from 732/27), frontend **917/917** across 38 files (from 656/30), both typechecks clean, backend lint clean, frontend lint **82** vs baseline **82**, `next build` exit 0. Migration `0007_loan_status_check` additionally verified against a **populated** database, which the fresh-DB harness cannot do.
**Next task:** **Phase 6 — Bank order workflow**, starting at **Task 6.1**. See [NEXT_TASK.md](NEXT_TASK.md).

> **Two unrecorded privilege bypasses were found and closed during implementation:** `PATCH /api/loans/:id` could set `status: "Approved"` on `requests.edit` alone (**D-056**), and `POST /api/loans {"status":"Approved"}` returned 201 on `requests.create` alone — held by Team Leader and Executive, neither of whom holds `requests.approve`. Both are **partial** SEC-016 remediation; **SEC-016 stays OPEN**.

> **Still open, and not Phase 5's to close:** **SEC-016** (disbursements still accept any status string — 6.5/7.3/13.13 own the rest) · **SEC-005**, **SEC-007**, **SEC-009** (P0) · **SEC-017** · **BUG-016/SEC-014** · **BUG-035** (reachability *worsened* by 5.8, cross-referenced not closed) · **BUG-039** (new: loans Type column renders `—`) · the four deferred state-machine guards (**D-057**) · `amount_approved` is still never populated (**D-6**).

> **Phase 3 through Task 3.7 is committed** - `1cfaa44` (3.1-3.5), `73930ce` (3.6), `6d1864b` (3.7). **Tasks 3.8-3.12 are ALL uncommitted** and share one working tree, along with the D-044 roadmap change. `frontend/next-env.d.ts` remains the generated artefact that is never committed. **Nothing has been pushed** - `main` is 17 ahead of `origin/main`. **Ask before committing.**

---

## PHASE STATUS

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Repository safety and baseline | **✅ COMPLETE** | All of 0.1–0.7 done. Definition of Done satisfied. |
| 1 | Demo isolation + authentication integrity | **✅ COMPLETE** | **1.1–1.3** (`a77b3c5`) — BUG-001 + **SEC-001**. **1.4 + 1.10** — SEC-027 / BUG-033. **1.5 SUPERSEDED** (D-016). **1.6** — BUG-022 / SEC-018. **1.7** — SEC-028 (D-019). **1.8** (`b24da18`) — BUG-034 (D-020). **1.9** — BUG-017 (D-021); BUG-027 reclassified INVALID. All **7** Definition-of-Done boxes ticked. |
| 2 | Real employee management | **COMPLETE** | **2.11 DONE** (2026-09-03) — employee codes are server-assigned from the highest number ever issued, immune to the permanent-delete reuse the roadmap named (**D-032**). **2.10 DONE** (2026-09-03) — a failed employee load is no longer indistinguishable from an empty database, and server `error.details` reach the field they name (**D-031**). **2.9 DONE** (2026-09-03) — deleted employees go to the recycle bin and restore; `user` is `BIN_REGISTRY`'s 13th type, with a redacted snapshot and the role hierarchy applied to bin restore/purge (**D-030**). E7 is now **DONE**. **2.8 DONE** (2026-09-03) — employees can be deleted from the product, gated on `users.delete`, behind a confirmation whose copy states plainly that it cannot be undone because `user` is not in `BIN_REGISTRY` (**D-029**). E7 is **PARTIAL** — restore is Phase 2.9. **2.7 DONE** (2026-09-03) — team membership is manageable from the employee screen, gated on `teams.assign`, resubmitting each team's complete roster from a fresh server read (**D-028**). **BUG-038 / SEC-029 FIXED** (2026-09-03) — `PUT /api/teams/:id/members` authorized no member at all; it now checks the role hierarchy over the **union of the previous and submitted rosters**, so a Manager can neither enrol nor silently evict a Super Admin (**D-027**). **2.7 is UNBLOCKED**, scope unchanged. **2.6 DONE** (2026-09-03) — employee bank access is editable from the product, through the existing `PUT /api/users/:id/banks`, gated on `users.assign`. **2.5 DONE** (2026-09-03) — **BUG-020 CLOSED**: `PATCH` persists `joinedOn` and refuses `bankIds`/`teamId` with 422, pointing at the routes that own them. **2.4 DONE** (2026-09-03) — the employee edit dialog, sending only changed fields. **BUG-036 FIXED** (2026-09-02) — `schema.partial()` kept `.default()` values in zod 4, so a one-field PATCH overwrote data the caller never sent; one `patchSchema()` helper now covers all six call sites, nine of them via the `createScopedResource` factory. **Task 2.4 is unblocked.** | **2.1 + 2.2 DONE** (2026-09-02) — **SEC-003 / BUG-003 CLOSED**, the second P0 and the first on the backend. Field-scoped `PATCH` self-guard plus one `assertSuperAdminRemains` invariant shared with `DELETE`. **2.3 DONE** (2026-09-02) — **SEC-010 / BUG-005 CLOSED**: a temporary password now grants nothing but a password change. **Next: 2.4** (employee edit UI), then 2.5 discarded fields, delete, post-creation bank/team reassignment. |
| 3 | Credential delivery, invitation and email | **✅ COMPLETE** | **3.1–3.12 DONE** (2026-09-04). Email service on Resend (**D-033**, OPEN-3 resolved by **D-037**); invitations and password resets are single-use, time-limited and atomically consumed (**D-038**, **D-039**); delivery state on the user (**D-040**); resend (**D-041**); credential hand-over kept as the outage fallback (**D-042**); the last false email promise removed (**D-043**); `/accept-invite` and `/reset-password` built as Tasks 3.11/3.12 (**D-044**, **D-045**, **D-046**). All four DoD boxes satisfied. **3.8–3.12 are uncommitted.** **SEC-005 remains OPEN at P0 — Phase 13 owes the general answer.** |
| 4 | Customer functionality | **✅ COMPLETE** | **4.1–4.11 DONE 2026-09-05.** Wave 0 reconciliation (documentation only, no implementation): rows **4.10** and **4.11** added for the two unowned DoD-box-4 fabrications; Task **4.9** premise corrected and re-rated **M → L**; decisions **D-047 – D-055** recorded. Then all eleven rows implemented in three file-disjoint lanes. Backend 687→**732** tests, frontend 454→**656**. Migration `0006_code_sequences` unifies seven code series and **closes BUG-011**. `audit_logs.view` was not widened (**D-049**); Aadhaar stayed out of the edit dialog (**D-052**); PAN search was preserved by a one-line backend extension (**D-053**). **Next: Phase 5.** |
| 5 | Loan / file workflow | **✅ COMPLETE** | **5.1–5.11 DONE 2026-09-05.** Wave 0 corrected two stale roadmap premises (5.7's "existing transactions"; 5.8's "none are ever sent") and added rows 5.10/5.11 for two unowned false controls. Ten-edge loan state machine enforced at create + approve (**D-057**); `status`/`amountApproved` refused on PATCH (**D-056**); migration `0007` adds a vocabulary-only CHECK on `loans.status`, `NOT VALID` + separate `VALIDATE`, **no trigger**. Approve/reject, loan edit, server paging, verification UI and honest load states all wired. Backend 732→**795**, frontend 656→**917**. **BUG-015 CLOSED**; **SEC-016 partial, still OPEN**. |
| — | **F1 — factory prerequisite** | **✅ COMPLETE** | **F1-a** PATCH and APPROVE are transactional, audit inside the same transaction. **F1-b** `afterApprove(before, after, {tx, ctx, req, input})`. **F1-c** `transitionColumn`, default `"status"`, turning on PATCH-side transition enforcement when set. `afterCreate` was **not** generalised into `afterWrite` — disbursements' loan-advance hook would then re-run on every PATCH (**D-062**). 21 tests. |
| 6 | Bank order workflow | **PARTIAL** | **6.1 DONE** (backend) — **both** machines enforced: `stage` through F1-c's `transitionColumn` (bank orders have no approve route, so PATCH is the only transition point), `status` through a `beforeWrite` guard (**D-063**). **6.5 DONE** — migration `0008` adds `bank_orders_stage_check` **and** `bank_orders_status_check`; both vocabularies moved above the table to avoid the TDZ that would have thrown on import. **6.2, 6.3, 6.4, 6.6 NOT STARTED** — all frontend. |
| 7 | Disbursement | **PARTIAL** | **7.3 DONE** — machine + migration `0009` + **both privilege bypasses closed**: `initialStatuses: ["In Transit"]` closes `POST {"status":"Credited"}` on `create` alone, `patchRefusals` closes `PATCH {status}` on `edit` alone. Manager holds both and holds neither approve permission. `→Credited` requires a non-null UTR, enforced through `afterApprove` (**D-066**). **7.6 VERIFIED already delivered by 5.7** — not rebuilt. 21 tests. **7.1, 7.2, 7.4, 7.5, 7.7 NOT STARTED.** |
| 8 | Transactions and settlements | **PARTIAL** | **8.6 DONE** — the arithmetic invariant is evaluated against the **merged row** rather than the payload, so a PATCH omitting `netPayable` is no longer skipped and a PATCH omitting gross/tds is no longer compared against zeros. Now 422 with `details[].path` (**D-031**). Migration `0010` (chain idempotency indexes) is written and verified but **8.8 does not yet use it**. 9 tests. **8.1–8.5, 8.7, 8.8 NOT STARTED.** |
| 9 | Document storage | **PARTIAL** | **9.2 DONE** — storage config on D-034's shape; production refuses to boot without it. **`MAX_DOCUMENT_MB` is separate from `MAX_UPLOAD_MB`**, which SEC-008 defines as the importer's zip-bomb budget (**D-072**). **9.3 DONE** — provider-agnostic `services/storage.ts`, working local adapter, S3 adapter signed with **hand-rolled SigV4 over `node:crypto`** because `@aws-sdk/client-s3` is not a dependency and this block may not add one. 17 tests. ⚠️ **The S3 path has never been exercised against a live bucket here.** **9.1 default recorded (D-071), owner ratification outstanding. 9.4–9.11 NOT STARTED.** Hard compliance blocker (KYC) remains. |
| 10 | Notifications | **PARTIAL** | Migration `0011` **DONE** — `user_id` NOT NULL, `event_type`/`record_type`/`record_id`/`event_key`, and a partial unique index on `(user_id, event_key)` giving 10.3 the "exactly one row" it requires. The migration **deletes nothing**: it aborts on a null-recipient row and leaves it for an operator (**D-077**). **10.1–10.6, 10.9 NOT STARTED** — all frontend/service. |
| 11 | Reports and ledger | **PARTIAL** | 11.1, 11.2, 11.3, 11.5, 11.6, 11.7, 11.8, 11.9 DONE in Waves 2–3. **11.4 deferred** — the controls are honestly labelled and export the full set; a real `.xlsx` and a server-rendered PDF are the deferred half. |
| 12 | Roles / teams / permissions / admin UI | **COMPLETE for Wave 4's scope** | **12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 12.10 and U-14 all DONE 2026-09-06.** Three screens built over routes that had zero callers; `PATCH /api/teams/:id` and the settings API written from nothing. **Still deferred and honestly marked:** **12.7** (2FA — deleted by D-083, real TOTP post-launch) and **12.9**. Per-user preferences are blocked on a `user_settings` table that does not exist (**D-087**), and the settings screen says so rather than offering a control. |
| 13 | Security hardening | NOT STARTED | |
| 14 | Testing | **PARTIAL** | 14.2, 14.4, 14.6 and **14.7 (CI)** done. **Q9 closed** by the five-role matrix; zero-fake sweeps all twenty screens. **14.9 — the suite against real Postgres — is NOT done and needs a server.** 14.1/14.3/14.5/14.8 deferred. |
| 15 | Production infrastructure | **PARTIAL** | **15.1, 15.4, 15.5, 15.7, 15.9, 15.11, 15.12, 15.15 done** — the code and configuration for all of them exist and are tested. **15.2/15.3 (deploy + rollback) are documented and unexercised; 15.8 (backups) and 15.10 (secret store) need the platforms.** Nothing has been deployed. |
| 16 | Final QA and production audit | **PARTIAL** | The Claude-doable half is done: zero-fake across all screens, the five-role matrix, register reconciliation, `GO_LIVE_CHECKLIST.md`, hypercare. **16.2 by hand, 16.5 penetration test and 16.8 restore rehearsal are external.** Nobody has signed `PRODUCTION_READINESS.md`. |

---

## COMPLETED

### Task 3.12 - the `/reset-password` page, and Phase 3 completes (2026-09-04)

The redeeming half of Task 3.6. Every reset email has linked here since then and landed on a **404**.

**It inherits D-045 unchanged** - branch on **status, never message**; only a 400 means the link is dead. The **422** branch is the one that pays for itself: a backend test proves a rejected password **does not consume the token**, so declaring the link dead there would strand a user holding a good link.

**Kept as a separate file from `/accept-invite`, not a shared component.** The two flows are held apart all the way down - separate tables so a token cannot cross (**D-039**) - and merging their UIs is the one place that separation could quietly erode.

**Building only the roadmap row would have left DoD box 2 unmet.** Box 2 says *unaided*, and something has to **send** the link: `POST /auth/forgot-password` had **zero product callers**, while `/login`'s "Forgot password?" was a toast reading *"Contact your administrator"* - true when written, **false since 3.6**. So 3.12 also built `/forgot-password` and turned that control into a link. **No backend change of any kind.** This was the third time in the phase a row was complete while its outcome was not; the first two were discovered (**D-044**), and repeating it knowingly would have been worse.

**The enumeration risk lives on the REQUEST page**, not the redeeming one. One careless sentence destroys a 204-always backend: if the screen said *"we sent a link to that address"*, its absence elsewhere is the oracle. The confirmation is conditional, never echoes the address, is **byte-identical** for known / unknown / deactivated addresses, and appears on **204 only**.

**One residual, recorded not smoothed over:** the page cannot know whether the provider accepted the message - reporting that would leak existence. The mitigation is in the copy: *"Nothing arrived? Check spam, then ask an administrator."*

**116 tests** (94 frontend, 22 backend). **19 mutations, all 19 caught.** See **D-046**.

### ✅ PHASE 3 IS COMPLETE

All twelve rows, **all four DoD boxes genuinely satisfied**. Both credential flows work end to end for a real person with no administrator involved.

**SEC-005 remains OPEN at P0** - 3.6's limiter guards 5 routes of 96, per-process, in-memory, fixed-window, `POST /api/auth/login` still unguarded. Phase 13 owes the general answer.

**Gates:** backend **687/687** (was 665, 25 files), frontend **454/454** (was 360, 20 files), both typechecks clean, backend lint clean, frontend lint **87 - unchanged baseline**, `next build` exit 0.

---


### Task 3.11 - the `/accept-invite` page (2026-09-04)

A public route beside `/login`. Every invitation email since Task 3.5 has linked here and landed on a **404**.

**The form was the easy half.** The endpoint answers **one identical refusal** for unknown / expired / consumed / deleted / deactivated (**D-038**), and preserving that is obvious. **The non-obvious failure is the opposite one**, which a naive `catch { setStage("refused") }` commits: reporting a 500, a dropped connection, a rate-limit or a rejected *password* as "your invitation is dead". The user has exactly one working link and has just been told to stop using it.

**So the page branches on HTTP status, never on the message:**

- **400** - the only status meaning the invitation is unusable. Backend's own sentence, verbatim, and **terminal** (form withdrawn, so a dead token is not retried against the limiter).
- **422** - password policy; the token is still good, form stays open.
- **429** - the 3.6 limiter. **5xx / offline** - a generic retry message that never mentions the invitation.

The split is structural: `badRequest(INVALID)` is the only producer of 400 on that route.

**It creates no session** (204, no `Set-Cookie`, asserted), so success **links** to `/login` rather than redirecting into `(app)`. The spent token is stripped from the address bar. A missing `?token=` is refused **without contacting the server** and renders **identically** to a server refusal.

**The seam neither side's unit tests could see:** the page URL-decodes its token, the backend `encodeURIComponent`s it, and both suites use a raw token that never crosses the URL. `accept-invite-link.test.ts` parses the emailed URL as a browser does and feeds *that* token to the endpoint - then signs in with the password it set.

**69 tests** (53 frontend, 16 backend). **16 mutations, all 16 caught.** See **D-045**.

**Phase 3 DoD box 1 is met end to end.** Box 2 stays open until **3.12**.

**Gates:** backend **665/665** (was 649, 24 files), frontend **360/360** (was 307, 17 files), both typechecks clean, backend lint clean, frontend lint **87 - unchanged baseline**, `next build` exit 0.

---


### Roadmap ownership decision - `/accept-invite` and `/reset-password` are now 3.11 and 3.12 (2026-09-04)

**Documentation only. No source, migration or dependency changed.** A project-owner decision, recorded rather than made here.

**The gap.** Tasks 3.5 and 3.6 each shipped a complete, tested backend flow and an emailed single-use link, and each roadmap row named **only the endpoint** - so both rows were legitimately complete while the pages their links point at did not exist. Every invitation and reset link landed on a **404**. The roadmap ran straight from 3.10 into Phase 4, so the task list was exhausted with two of four DoD boxes unreachable by any row on it.

Through Tasks 3.7-3.10 this was **carried forward as explicitly unowned** rather than absorbed into an unrelated task. It now has owners:

- **3.11** - `/accept-invite` over the existing endpoint. **M**.
- **3.12** - `/reset-password` over the existing endpoint. **M**.

**Chain: 3.11 -> 3.12 -> Phase 3 complete -> Phase 4.** Task 4.1 moves behind both.

**Nothing about the backend changes.** No route, migration, schema, dependency or auth behaviour. **D-037** stands, **OPEN-3 stays resolved**, 3.5/3.6 token security is untouched, **BUG-038 stays fixed**, **SEC-005 stays OPEN at P0**.

**The hard part is a security constraint, not the form.** Both endpoints answer **one identical refusal** for every unusable token, so a public endpoint cannot become an oracle. The pages must preserve that: the four states the rows name are, as far as the user may be told, **two** - it worked, or it did not.

**Effort calibrated against comparable rows**, not guessed: 2.10 (existing page) is S, 12.2 (Teams page) is M, 12.1 (Roles page + matrix) is L. See **D-044**.

---


### Task 3.10 - the last false email promise, removed (2026-09-04)

The settings **Request export** control is gone. Its whole handler was one `toast.success("Export queued", { description: "You'll get an email when it's ready." })` - no request, no queue, no job, no file, no `sendEmail`.

**Implementation was weighed, not dismissed.** A real export mechanism exists (`lib/export.ts`, five call sites, immediate browser download). Rejected on repository evidence: **roadmap 11.9 already owns** repo-wide export work ("fetch all pages or export server-side"), the **PRD requires no such feature** and records the absence, and **this phase's own preamble** says the other false email promises were *"all removed"*. Nothing was lost - every list page still exports CSV through `DataTable`.

**The "last" claim was verified.** A repo-wide sweep confirms it was genuinely the only false *email* promise. Two fake-*async* claims remain and were deliberately left because each already has an owner: `customers/page.tsx:241` "queued for verification" (**roadmap 4.4**, by name) and `customers/[id]/page.tsx:185` "Sent to printer" (**Phase 11.4**).

**`passwordChangedEmail` / `accountDeactivatedEmail` untouched** - valid unused infrastructure, not false promises.

**17 tests. 6 mutations, all detected - but by two tools, which is the honest description.** Five fail the suite; restoring **only** the orphan handler is caught by **lint** (`no-unused-vars`, 87 -> 88), because a rendering test cannot see a function that is never rendered or called. **One self-inflicted lint regression** (anonymous component in the new Tabs stub) was caught and fixed - back to 87.

**Phase 3 DoD box 3 is now genuinely met and test-enforced.**

**Gates:** backend **649/649** unchanged (no backend change), frontend **307/307** (was 290, 16 files), both typechecks clean, backend lint clean, frontend lint **87 - unchanged baseline**, `next build` exit 0.

---


### Task 3.9 - the on-screen credential hand-over, kept and made explicit (2026-09-04)

The only roadmap row phrased as a **prohibition** - *"do not remove it"* - protecting something that already existed.

**Verified first, and the backend was already right.** `POST /api/users` returns the temporary password regardless of the mail outcome, keeps only the argon2id hash, sets `mustChangePassword`, and emails nothing. **The `admin.routes.ts` diff for this task is empty.** No change was invented to look busy.

**Two things were genuinely missing:**

- **It was not test-protected.** There was **no frontend test for the hand-over at all**, and nothing asserted it survives a mail outage - the one property the roadmap names. Deleting it broke nothing.
- **It was not explicit.** The create flow discarded `invitation` entirely, so an outage and a success rendered **identical screens** - *"Hand these details to X so they can sign in"* either way. A fallback in mechanism, not in meaning.

**The change is frontend-only:** `invitation.status` threads into `HandoverCredential.delivery` and the copy follows it. **`logged` is grouped with `failed`, not `sent`** - the console transport delivers nothing (**D-035**), so calling it delivery would be the false success **D-004** forbids. The password is shown for every outcome; only the words change.

**53 tests** (30 backend, 23 frontend). **14 mutations reversion-proven, all 14 caught** - removing the hand-over fails 6, showing it only on failure 10, persisting the plaintext 3, logging it 2, emailing it 2, dropping `mustChangePassword` 14. **Two mutations were malformed and redone**: one injected a duplicate object key (later key wins - a silent no-op), the other recoloured a banner without changing its words. Neither green result was accepted.

**Gates:** backend **649/649** (was 619, 23 files), frontend **290/290** (was 267, 15 files), both typechecks clean, backend lint clean, frontend lint **87 - unchanged baseline**, `next build` exit 0.

---


### Task 3.8 - resend invitation (2026-09-04)

`POST /api/users/:id/resend-invitation` plus a gated button on the employee detail view.

**The mechanics were free; the decisions were the task.** `issueInvitation` already supersedes the outstanding link, stores only the digest, applies the 72-hour TTL and moves `invited_at` - **D-040 predicted exactly this**. The route adds authorization, two state guards and an audit row, and nothing else.

- **`users.reset_password` gates it** - the only candidate that grants nobody a capability they did not already have. A holder can already mint a temporary password for the same target, which is strictly more powerful.
- **The hierarchy rule applies.** BUG-038 was a credential route with `requirePermission(...)` and no target authorization; this one would have been the same shape.
- **Already accepted -> 409**; **not Active -> 409** (the link would be dead on arrival). Soft-deleted -> 404. Restore does not reactivate, so a restored employee stays refused - that falls out of the Active guard for free.
- **Never-invited employees CAN be invited here** (everyone predating 3.5 has no invitation), and the copy says **"Send"**, not "Resend", for them.
- **No rate limit** - authenticated and hierarchy-bound, so SEC-005's public-endpoint limiter does not apply. The residual provider-quota risk is named in **D-041**.

**An adversarial review caught three things my own tests missed.** Success was the *fallthrough* branch in the UI, so a missing `invitation.status` rendered "Invitation resent" - and the test covering it asserted only that no error appeared, so **it passed against the defect**. Also: "Resend" was shown to never-invited employees, and the API-key assertion ran on the console transport where no key exists, so it could never fail. All three fixed. Four further limitations were examined and deliberately not fixed - see **D-041**.

**105 tests** (72 backend, 33 frontend), including the whole lifecycle in one chain. **23 mutations reversion-proven, all 23 caught.**

**Gates:** backend **619/619** (was 547, 22 files), frontend **267/267** (was 234, 14 files), both typechecks clean, backend lint clean, frontend lint **87 - unchanged baseline**, `next build` exit 0.

---


### Task 3.7 — invitation state on the employee record (2026-09-04)

Migration `0005` adds `users.invited_at` and `users.invite_accepted_at`; the employees list gains a **Setup** column and filter (Accepted / Invited / Not invited) and the detail view shows the dates.

**`invited_at` means ISSUED, not delivered.** `sendEmail` reports provider acceptance at best (**D-035**), the console transport delivers nothing, and the send happens after the create transaction commits — so a column gated on outcome would be null on every developer machine and still would not mean *received*. **The consequence is a wording rule with a test behind it:** nothing says "Emailed" or "Delivered" (**D-004**).

**It is the LATEST issuance.** The actionable question is *"when did we last invite them?"*. The write lives in `issueInvitation`, so **3.8's resend gets it for free** — and a reissue does not clear an existing acceptance.

**Denormalised onto `users` deliberately** — against D-024's instinct, but the roadmap says "on the user", both are written inside the transactions that write the invitation rows so they cannot drift, and they outlive the eventual purge of token rows (15.9). **D-040**.

**Mutation testing caught a weakness in my own tests:** a fixture named "Anitha Accepted" made `toContain("Accepted")` pass against the *name*, hiding an inverted state precedence. Fixtures renamed, assertions moved onto the state cell.

**Found, not fixed:** the employees **Role** column renders `—` for every row (`key: "role"` with no `render`, field is `roleName`). Pre-existing and unrelated.

**33 tests** (21 backend, 12 frontend). Six mutations reversion-proven (6 / 1 / 2 / 1 / 1 / 3 failures).

**Gates:** backend **547/547** (was 526, 21 files), frontend **234/234** (was 222, 13 files), both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

---

### Task 3.6 — self-service password reset (2026-09-04)

`POST /api/auth/forgot-password` and `POST /api/auth/reset-password`.

**A separate `password_resets` table** (migration `0004`), not a `purpose` column on `invitations`: both look tokens up by digest alone, so one table would let a reset token be redeemed at `/accept-invite` and vice versa. Impossible by construction beats a discriminator someone must remember.

**One hour, not 72** — a reset link can seize an existing account, and the requester is waiting on it.

**The endpoint reveals nothing, including in the logs.** 204 identically for unknown / deleted / deactivated / disabled-role / provider-down. The log half is the easy one to get wrong — a line naming a missing address just moves the oracle — and a mutation that adds one fails a test.

**Everything else follows D-038:** digest-only storage, token checked before any argon2 work, password validated before the consume, atomic conditional consume. All sessions revoked and the lockout cleared on success; no session created.

**The project's first rate limiter** — 3.6's wording requires it. Fixed-window, in-process, on all three public credential endpoints (`accept-invite` retro-fitted from 3.5). **Per-process, in-memory, 5 routes of 96 — SEC-005 stays OPEN at P0.** D-039.

**Not done: the `/reset-password` page**, exactly as `/accept-invite` is not. Two roadmap-less pages now block Phase 3's DoD.

**43 tests** plus one in the invitations suite. Nine mutations reversion-proven (16 / 1 / 1 / 1 / 1 / 1 / 1 / 3 failures).

**Gates:** backend **526/526** (was 483, 20 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

---

### Task 3.5 — the invitation flow (2026-09-04)

Creating an employee issues a single-use, time-limited invitation and emails the setup link; `POST /api/auth/accept-invite` redeems it. No password is emailed (**D-037**).

**The three parameters D-037 left open, all recorded in D-038:** **72-hour** expiry (a Friday hire can act on Monday), **48 random bytes stored as SHA-256** (what `refresh_tokens` already does), **`${FRONTEND_URL}/accept-invite?token=…`** (existing config, and `login`'s top-level convention).

**At most one password establishment per invitation.** A conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()` — the database resolves the race, not application timing. Two simultaneous acceptances are tested for real: exactly one 204, one 400, one live password.

**The raw token is never at rest** — digest only, and absent from logs during acceptance, audit summaries and errors. **One identical refusal** for unknown/expired/consumed/deleted/deactivated, so the endpoint is not an enumeration oracle. **204 with no body, no session created.**

**Creation survives a mail outage:** issuance joins the create transaction, the send happens after commit (D-032's deadlock lesson), and the response reports `sent`/`logged`/`failed` honestly.

**A 3.5 test hardened 3.3:** `sendEmail`'s "never throws" did not cover its own body — a throwing logger escaped and made creation a 500. Now wrapped; the guarantee is absolute.

**SEC-005 stays open at P0.** No general limiter was built. Narrow mitigation only: an invalid token is refused before any argon2 work, removing the amplification. Residual risk documented.

**First migration since the initial three** — `0003`, via `drizzle-kit generate`, journal and snapshot included.

**Not done: the `/accept-invite` page.** The roadmap names only the endpoint, so 3.5 is complete as defined, but the phase DoD needs that page.

**49 tests.** Five mutations reversion-proven (19 / 1 / 1 / 5 / 1 failures).

**Gates:** backend **483/483** (was 434, 19 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

---

### OPEN-3 resolved — credentials are delivered by invitation link (2026-09-04)

The project owner resolved **OPEN-3**: **a single-use, time-limited invitation/setup link; no emailed temporary password.** The employee sets their own password through the link. Recorded as **D-037**.

**This confirms the existing direction rather than changing it.** Roadmap 3.5 already said the link; the register had never been reconciled with it. **D-036's assumption is now a formal decision and no code changed** — the assumption matched the answer, so 3.4's template and tests stand as written.

**Deliberately not decided here:** the expiry duration, the token format and the acceptance URL. No document names any of them, and inventing one would repeat the error D-036 avoided. `expiresInHours` stays a required input. All three belong to 3.5.

**SEC-010 remediation 3 is narrowed, not closed** — the on-screen hand-over stays by design (roadmap 3.9) and its temporary password still has no expiry.

**Nothing implemented.** No table, migration, token, endpoint, wiring, dependency or secret. **Task 3.5 unblocked, NOT STARTED.** No source changed, so no gates were re-run.

---

### Task 3.4 — the four email templates (2026-09-04)

`lib/email-templates.ts`: employee invitation, password reset, password changed, account deactivated. Pure functions returning the `EmailMessage` that `sendEmail()` takes. **Nothing calls them** — invitation is 3.5, reset 3.6.

**The invitation rests on an assumption, and it is recorded as one.** **OPEN-3** (link vs emailed temporary password) is still open and unanswered. Roadmap **3.5** instructs *"Send a single-use, time-limited link rather than a password in an email"*, so the template is built for the link **on that instruction** — as an assumption, **not** a decision. **OPEN-3 is untouched.** The template is pure and uncalled, so reversing it costs one file and its tests; the tests pin *"contains no password"* rather than *"the link model is correct"*. **3.5 is the point of no return** and the owner should answer OPEN-3 first. **D-036**.

**Nothing invented.** No hardcoded expiry, domain or login URL — every dynamic value is a typed input, and a missing `expiresInHours` throws. The notification templates carry no link and point at an administrator, because there is no self-service recovery path (**D-004**).

**Untrusted input cannot become markup.** Names escaped in all four; links refused unless `http(s)`; no token in any subject.

**Architecture:** `lib/` not `services/` — the repo already splits pure from I/O, and a test asserts the module imports no database, provider or environment. No template-engine dependency.

**29 tests**, no network or database. Five mutations reversion-proven (4 / 2 / 2 / 1 / 1 failures).

**Gates:** backend **434/434** (was 405, 18 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

---

### Task 3.3 — the email service (2026-09-04)

`src/services/email.ts` can send. **No product email is sent** — nothing calls it; templates are 3.4, invitation 3.5, reset 3.6.

**The roadmap's clause drove the design.** *"A mail outage must never fail user creation"* → **`sendEmail` never throws**, so `void sendEmail(...)` in a request path can neither fail the request nor leak an unhandled rejection. **But failure is reported, not swallowed**: the outcome is `sent` / `logged` / `failed`, so an outage cannot be mistaken for delivery (**D-004**). `sent` means *accepted by the provider*, not delivered.

**No SDK.** The backend has no HTTP-client dependency and makes no outbound request anywhere else; Resend's send is one POST and Node has `fetch`. Adding the first HTTP dependency — on the path carrying the API key — was not worth ~20 lines. **No dependency added**, so there is nothing for the frontend to bundle.

**Retries are bounded**: 3 attempts, 200/400 ms, on transport errors, 429 and 5xx. A 4xx returns immediately — a rejected address or bad key is rejected identically forever.

**A leak its own test caught.** Both failure paths echoed third-party text (a provider body, a transport error message) into the reason the caller sees. The key is now scrubbed from any reason before it leaves the module — structural, rather than trusting what Resend and undici put in their strings.

**Console transport** logs recipient, subject and the full body — deliberately, since reading the link out of the terminal is why it exists — marked `delivered: false`, returning `logged`. Production cannot reach it and is guarded anyway.

**Resend appears in exactly two source files.** 32 tests, no network, no real key. Decisions: **D-035**.

**Gates:** backend **405/405** (was 373, 17 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

---

### Task 3.2 — email configuration, validated at boot (2026-09-04)

Four keys through the existing `env.ts` schema: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`. **Configuration only** — no SDK, no service, nothing sent.

**Optional in the schema, required by the production block** — the split `AADHAAR_PEPPER` already uses, so no second validation mechanism. Production refuses to boot without all four, because the console fallback is silent by nature: a misconfigured production deploy would accept an invitation, log it and report success (**D-004**). Same shape as SEC-028's `NODE_ENV` fix.

**The provider is an allowlist of one** (`resend`, per D-033) so a typo is a boot failure, not a silent no-op. **`EMAIL_FROM` is deliberately not `z.email()`** — the `Name <address>` form is what production actually uses, and rejecting it would stop a correct deployment from booting.

**The API key never leaves the configuration.** Errors name key names only; four tests assert it appears in no error, no boot log and nothing `NEXT_PUBLIC_`. Both `.env.example` files ship it **empty** rather than with a realistic placeholder.

**One fixture updated, no assertion changed.** `cookie-config.test.ts`'s `PROD_ENV` claims to be "a complete, valid production environment" and after this task a complete one includes email, so `loadEnv` rightly rejected it. Adding the keys to the fixture was the correct repair; weakening the requirement would not have been. All 17 of its cases still pass.

**Proven in both directions.** 22 tests, no database. Five mutations reversion-proven (5 / 3 / 2 / 3 / 1 failures). Decisions: **D-034**.

**Gates:** backend **373/373** (was 351, 16 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

---

### Task 3.1 — Resend chosen as the email provider (2026-09-04)

A decision task, not an implementation. It was blocked on **OPEN-1**, which had no owner recorded; the project owner has now chosen **Resend**, starting on the **free tier** (3,000/month, 100/day as stated), upgrading within the same provider when volume requires it. Recorded as **D-033**, which resolves and strikes OPEN-1.

**Nothing was implemented.** No SDK, no `services/email.ts`, no config key, no environment variable, no route, no migration, no frontend change, **no secret**. Tasks 3.2 and 3.3 do that, and 3.3 owns the provider-agnostic abstraction — building it now would have prejudged an interface with no caller.

**OPEN-3 is still open** and this decision does not touch it: invitation link versus emailed temporary password is a question about what is *sent*, not who sends it. It gates **3.5**, not 3.2–3.4.

**`CURRENT_STATE.md` still reports 0 email providers integrated and `FEATURE_STATUS.md` still grades Email G.** Both remain correct — a decision is not an integration.

**No source code changed**, so no gates were re-run. Phase 2's committed baseline stands: backend 351/351, frontend 222/222, typechecks clean, backend lint clean, frontend lint 87, build passing.

---

### Task 2.11 — employee codes are assigned by the server (2026-09-03)

**The roadmap premise was half wrong, and the code proved it.** There was **no server-side employee-code generator**: `employeeCode` was a *required* field on `POST /api/users`, and the only thing producing one was `suggestEmployeeCode()` in the browser, scanning the at-most-200 loaded rows. The `count(*)` generators that exist belong to customers and the nine factory routers, tracked as **BUG-011** (HIGH, open) — whose Feature line names seven resources, **users not among them**. BUG-011 was not fixed here; the roadmap row carries the correction.

**The generator.** `employeeCode` is now optional on create; omitted, the server assigns from the **maximum suffix ever issued** — read from `users` with **no `deleted_at` filter** (a soft delete releases the code by design, but re-issuing it while the original is still restorable would be wrong) **and** from recycle-bin snapshots of purged employees (the only record that survives a hard delete, which is the case the roadmap named). Format unchanged: `EMP-` plus four zero-padded digits.

**Concurrency, stated plainly.** Check-then-insert; the unique index is the final guard and the loser gets a 409. The established pattern (**BUG-037**), documented rather than papered over.

**A real deadlock, found and fixed.** The first cut called the generator *inside* the create transaction while reading through the base handle — on a single-connection driver the read waits for the transaction that is waiting for the read. Every test timed out at 60 s. Moving the read before the transaction took the suite from over 300 s to **5.4 s**.

**Proven against the failure mode.** 15 backend tests; the centrepiece walks create → confirm → delete → purge → create and asserts no reuse. Reverting to a row count fails **3**. True concurrency is not tested and the test says why — PGlite is a single in-process connection, so concurrent creates serialise rather than race.

**Gates:** backend **351/351** (was 336, 15 files), frontend **222/222 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

**PHASE 2 IS COMPLETE** — 2.1–2.11 all done.

---

### Task 2.10 — the employees page stops reporting failures as emptiness (2026-09-03)

Two quiet lies on one screen.

**A failed load looked like an empty database.** The page took neither `loading` nor `error` from `useResource` — it destructured only `data` and `refresh` — and because the hook clears `data` on rejection, a failed fetch rendered the "no employees" empty state. There are now **three** states: a skeleton while loading, an error banner with a working **Try again**, and the empty state reserved for a genuinely empty list. On failure the table is suppressed entirely; a background refresh keeps existing rows rather than blanking them.

**The server named the field and the form threw it away.** 422 responses carry `details: {path, message}[]`, and the dialogs showed only the generic top line. Field messages now appear under the control they name in the create and edit dialogs — the frontend's **first** consumer of `error.details`, so the logic is extracted to `lib/field-errors.ts`.

**The contract was read, not assumed.** `details` is not uniformly an array: a 23505 unique violation puts `{ constraint }` — an object — in the same field. The helper discriminates on **shape**, never status or code, so the verbatim 400/403/409 surfacing from Tasks 2.4–2.9 is untouched. `bankIds.0` attaches to `bankIds`; an issue naming an unrendered field is appended to the dialog line rather than dropped. **D-031**.

**Not changed:** `useResource` (fixing it there would alter every page) and client-side validation, which still refuses a malformed email before any request.

**Proven in both directions.** 38 frontend tests — 16 on the helper against real payload shapes, 22 through the page. Six mutations reversion-proven (5 / 3 / 4 / 1 / 3 / 4 failures).

**Gates:** frontend **222/222** (was 184, 12 files), backend **336/336 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

---

### Task 2.9 — deleted employees are restorable (2026-09-03)

`DELETE /api/users/:id` soft-deleted by hand and wrote no recycle-bin entry, because `user` was absent from `BIN_REGISTRY`. It is now the registry's **13th** type and the route calls `softDelete`. The round trip **active → DELETE → bin → restored** works end to end.

**Two things no other binnable type needed**, both declared as registry data rather than special-cased:

- **`redact: ["passwordHash"]`** — bin entries outlive the rows they describe (a purge keeps the entry), so an unredacted snapshot would retain a live argon2 credential indefinitely.
- **`deleteFields: { status: "Inactive" }`** — `softDelete` writes only the delete stamps, so without this the deactivation would have been dropped and, since `restore()` ignores `status`, a restored employee would have come back **able to sign in**.

**The hole this task would otherwise have opened.** `recycle_bin.restore` is seeded to `manager`, and the bin routes gated only on permission plus bank access — fine while every binned record was a business row. With *people* in the bin, a Manager could restore a Super Admin they could never have deleted. `assertCanActOnBinnedUser` now applies the hierarchy to user entries on restore and purge, keyed on record type, never a role name. **D-030**.

**Guards preserved.** Self-delete 400, hierarchy 403 and last-Super-Admin 409 still run before any write, each asserted to leave no bin entry. Still 204.

**Task 2.8's copy was inverted, not patched over** — and the backend test that asserted zero bin entries, written to fail here, did exactly that on the first run.

**Proven in both directions.** 23 backend tests plus the updated lifecycle group. Five mutations reversion-proven (1 / 3 / 1 / 1 / 17 failures). One test initially passed for the wrong reason and was rewritten.

**Gates:** backend **336/336** (was 313, 14 files), frontend **184/184**, both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

**E7 is now DONE** — delete and restore both wired.

---

### Task 2.8 — employees can be deleted from the product (2026-09-03)

`DELETE /api/users/:id` had **zero callers**. A **Delete** button on the employee detail view now calls it, gated on `can("users.delete")` — a fourth distinct permission on that screen — behind a confirmation that issues nothing until accepted.

**The confirmation had to be true.** `user` is absent from `BIN_REGISTRY`, so the route writes **no recycle-bin entry** and nothing in the product can reverse the deletion. Roadmap **2.9** adds that and was **not** pulled forward. The dialog therefore says plainly that this **cannot be undone from the product**, and points at **Revoke access** as the reversible alternative (**D-029**, **D-004**). A backend test pins the claim — it fails on purpose when 2.9 lands.

**204 means nothing to adopt.** Unlike 2.6 and 2.7, success re-reads the list rather than merging a response, and clears `selected` so the detail dialog is not left showing a deleted record.

**Server stays the authority.** 400 / 409 / 403 surfaced verbatim, confirmation left open and retryable, no refresh and no success on a refusal.

**Measured, not assumed:** a deleted employee's login is **401**, not the **403** a revoked one gets — the lookup filters `deletedAt IS NULL`, so a deleted account is indistinguishable from a nonexistent one. My first draft asserted 403 and was wrong.

**Proven in both directions.** 23 frontend tests plus 6 backend cases. Five mutations reversion-proven (5 / 2 / 2 / 4 / 1 failures), including a false restorability promise and a success-on-refusal.

**Gates:** frontend **183/183** (was 160), backend **313/313** (was 307), both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

**E7 is PARTIAL, not DONE** — delete is wired, restore is not. Phase 2.9 completes it.

---

### Task 2.7 — employee team membership is manageable from the product (2026-09-03)

`PUT /api/teams/:id/members` had **zero frontend callers**. A **Team** dialog on the employee detail view now calls it, gated on `can("teams.assign")` — a third distinct permission on that screen.

**The whole task is the roster.** The route is team-shaped and the screen is employee-shaped, so:

- **Rosters are re-read from `GET /teams` at save time.** Reference data loads at sign-in; building a roster from it evicts whoever was added since, with a 200 and no warning. A test proves a server-side member absent from cached data survives.
- **Every other member is resubmitted.** `{ userIds: [employeeId] }` returns 200 and empties the team — asserted never to be sent, and a backend test shows the eviction it would cause.
- **A move is two requests, removal first** — chosen because that failure leaves the employee on *no* team (visible) rather than *two* (hidden by `teamOf()`'s `.find()`). A partial failure is reported verbatim, not as success.

**Server is the authority.** Success is decided by the `userIds` the route echoes back; 403/400 are surfaced verbatim with the dialog open. Decisions: **D-028**.

**BUG-038 untouched** — `assertCanManageRoleLevel` over `previous ∪ submitted` still runs on every request the screen sends, pinned by a backend test where a Manager is refused over a Super Admin the UI resubmitted unchanged.

**Proven in both directions.** 30 frontend tests plus 5 backend integration cases. Six mutations reversion-proven (5 / 4 / 4 / 1 / 1 / 2 failures).

**Gates:** frontend **160/160** (was 130), backend **307/307** (was 302), both typechecks clean, backend lint clean, frontend lint **87 — unchanged baseline**, `next build` exit 0.

---

### BUG-038 / SEC-029 — team membership is authorized per member (2026-09-03)

`PUT /api/teams/:id/members` ran **one** check — `requirePermission(teams.assign)` — and then replaced the whole roster. The role hierarchy, which the rest of the codebase enforces through a single helper, was consulted nowhere on this path. `ROLES_AND_PERMISSIONS.md` §4.2 listed **nine** routes that call it and this route was not among them; the gap in the document was an accurate reflection of the gap in the code.

**Measured before the fix**, seeded `manager` (level 20, holds `teams.assign` by seed):

| Request | Before | After |
|---|---|---|
| Add a Super Admin | **200, placed** — while `PATCH /api/users/<same person>` returned **403** | **403** |
| Add an Admin / a peer Manager | **200, placed** | **403** |
| Roster `[super-admin, exec]`, submit `[exec]` | **200 — Super Admin evicted, never named in the request** | **403**, victim still on the roster |
| Audit row for that eviction | `changes: null` — who was removed was unrecoverable | `changes: { members: { from, to } }` |
| Non-existent `userId` | **409** *"still referenced by other records"* | **400** *"One or more users do not exist"* |
| Soft-deleted user | **200, row written** | **400** |
| Executive / Team Leader; Super Admin adds an Admin; roster cleared; Inactive user; other-bank employee | 200 | **200 — all unchanged** |

**The decision that mattered.** Authorization covers `previous ∪ submitted`, not `submitted`. Row three is why: every id in that request is one the Manager may legitimately manage, and the victim is identified only by their **absence**. A fix that checked only the submitted list — the obvious reading, and the one the original BUG-038 write-up proposed — returns 200 there and evicts the Super Admin anyway. Recorded as **D-027**, along with the rejected alternative (symmetric difference: sufficient for security, less restrictive, but a larger invariant).

**Deliberately not done.** No bank scoping — `PROJECT_CONTEXT.md:71` records teams as *"Not bank-scoped"* and neither table has a bank column, so a scope check would be new policy, not remediation; a test asserts the cross-bank case still returns 200. No roster-semantics change, no new endpoint, no migration, no response change, no `error-handler.ts` change (D-021), no row lock (BUG-037 stays deferred), and `assertCanManageRoleLevel` is byte-identical.

**One deviation from the sketch**, decided on evidence: a single batched read instead of N `targetUserRole` calls, returning **400** rather than that helper's 404 — `PRD.md:1267` reserves 404 for path-id lookups and `PRD.md:257` already sets the 400 precedent for a bad id in a payload. Existence is enforced on **submitted** ids only, because soft-deleting a user leaves their `team_members` rows behind and checking prior members too would make any team containing a departed employee permanently unmanageable.

**Two regressions the fix itself introduced, caught by adversarial review and fixed before it landed.** Both were reproduced over real HTTP before being believed, and both now have their own tests:

1. **An actor who was on the team could no longer edit that team's roster** — not even to remove themselves. Their own row entered `previous`, so the union check ran `assertCanManageRoleLevel` against their own level, and "strictly greater" means nobody outranks themselves. Measured **403** for keep-self, remove-self and add-self alike. Reachable through normal use: `POST /api/users` places a new employee on a team at creation. The actor is now excluded from the hierarchy loop **by identity, not by level** — `team_members` is never consulted by any authorization decision (`services/access.ts` does not mention teams at all), so joining or leaving a team grants and removes nothing. A test asserts a *peer* at the same level is still refused, so the exclusion cannot be widened into a level check.
2. **An uppercase uuid for a live user was rejected 400 "One or more users do not exist"** — the same class of untruth the fix was written to remove. Postgres emits uuids lower-cased and `z.uuid()` accepts any case without normalising, so the raw request id never matched the id read back. Submitted ids are now canonicalised once at the boundary, which also makes case variants of one id dedupe correctly instead of violating the `(team_id, user_id)` primary key.

**Proven in both directions.** 43 tests in `src/tests/team-membership.test.ts`, every refusal asserting the roster in the database *and* that no audit row was written. Six reversion mutations: narrowing the affected set to `submitted` fails **3** (all evictions), removing the hierarchy loop fails **10**, removing the existence check fails **3**, dropping the audit `changes` fails **3**, removing the self-exclusion fails **3**, dropping the id canonicalisation fails **3**.

**Gates:** backend **302/302** across 13 files (was 259/12), frontend **130/130 unchanged**, both typechecks clean, backend lint clean, frontend lint **87 — the unchanged documented baseline**, `next build` exit 0.

**Task 2.7 is unblocked**, with its scope unchanged: wire the existing route from the employee screen.

---

### Task 2.6 — employee bank access is editable from the product (2026-09-03)

`PUT /api/users/:id/banks` had existed since the first commit — transactional, audited, guarded — with **zero callers**. Bank access was set at creation and never changeable again.

**A "Bank access" dialog on the employee detail view**, checkbox list over the reference banks, saving through `api.replace`. **No backend file was touched**, no new endpoint, and `bankIds` was *not* added back to PATCH — assignment stays its own operation against the route that owns it (**D-025**).

**Gated on `users.assign`, not `users.edit`.** The route requires the former; the Task 2.4 edit dialog uses the latter. A holder of only `users.edit` would have seen a button that always 403s. Tested in both directions; pointing the gate at `users.edit` fails 4 tests.

**The UI adopts the server's answer** — `result.data.bankIds`, not the array it sent — plus `refresh()`. A test makes the server reply with a different set and asserts the UI follows it; trusting the sent list fails that test.

**Whole-list replace**, so the request is the complete desired set, not a delta — asserted for add, remove, multi-select and clear. An empty selection is allowed and warned about on screen first.

**Known limitation, recorded:** `assertBankAccess` guards grants, not revocations, so `bankIds: []` from a *scoped* actor would clear invisible grants. Unreachable with the seeded roles — every `users.assign` holder is unscoped — and a bespoke scoped assigner gets a **403** rather than silent loss.

**22 tests** driving the real page. Explicit negatives: **no PATCH body ever contains `bankIds`**, and **no `/teams` or `/members` path is ever called**.

Frontend **130/130** (8 files), backend **259/259 unchanged**, all gates green, frontend lint at the unchanged 87 baseline.

**BUG-038 untouched.** `PUT /api/teams/:id/members` remains unwired; Task 2.7 must not land before it is fixed.

> **Superseded 2026-09-03.** BUG-038 is fixed; see the entry at the top of this section. The route is still unwired — that remains Task 2.7's job.

### Task 2.5 — PATCH stops silently discarding assignment fields (2026-09-03) — **BUG-020 CLOSED**

`PATCH /api/users/:id` parsed `joinedOn`, `bankIds` and `teamId` and wrote **none** of them: a 200, no database change, an audit row listing only `updatedAt`.

**The roadmap framed it as one choice — apply or reject. The schema says it is three questions.**

| Field | What it is | Outcome |
|---|---|---|
| `joinedOn` | plain nullable column; **no other route can change it** | **persisted** — one `.set()` branch, no transaction |
| `bankIds` | many-to-many, owned by `PUT /api/users/:id/banks` | **refused, 422** |
| `teamId` | many-to-many; **`users` has no team column at all** | **refused, 422** |

Rejecting was not the lazy option: the banks route already does the job transactionally with per-bank scope and a from/to audit, so re-implementing it in PATCH would put tenant-isolation logic in two places (**D-003**). A scalar `teamId` would invent a relationship the schema does not have — the `(team_id, user_id)` PK permits a user in many teams, measured.

**Mechanism.** A `notOnThisRoute()` helper in `lib/zod.ts`; the body derived as `patchSchema(userInput).extend({…})`, not hand-written (**D-024**). `z.never({ error }).optional()` rather than `.strict()`, so the offending field is named in `path` and unknown keys are still ignored. The 422 shape is inherited — `error-handler.ts` untouched (**D-021**). Recorded as **D-025**.

**A rejection is a behaviour change, and it was checked:** Task 2.4's dialog cannot emit these fields, and both PUT routes have zero frontend callers. No caller exists that a 422 could break.

**17 tests**, every one asserting database state. Reversion-proven: removing the omit fails 6, removing the `joinedOn` branch fails 2. Backend **259/259**, frontend **108/108 unchanged**, all gates green. **No frontend file was touched.**

**Found, not fixed: BUG-038 (HIGH)** — `PUT /api/teams/:id/members` applies **no per-member authorization**. Measured: a level-15 actor enrolled a **Super Admin**, 200. Whole-roster replace means silent eviction too, with no from/to in the audit. Zero frontend callers today; **roadmap 2.7 must not wire it before this is fixed.**

> **Fixed 2026-09-03** as its own task, before 2.7. See the entry at the top of COMPLETED and **D-027**.

### Task 2.4 — employees can finally be edited (2026-09-03)

`PATCH /api/users/:id` supported eleven fields and had exactly one caller — the Revoke/Restore toggle sending `{ status }`. There was **no edit UI at all**.

**Only what changed is sent.** The dialog diffs the form against the row it opened on; an untouched form issues **no request**. Posting the whole form back would have worked and would have silently overwritten whatever a colleague changed since the dialog opened — a lost-update bug in place of a data-loss one. This is only safe because BUG-036 was fixed first.

**Two edge cases with their own tests.** An explicit `0` is a real value (`Number("0")` is falsy, so a truthiness check would drop a deliberate reset — a mutation doing exactly that fails 6 tests). And opening a **revoked** employee to fix a typo sends `{ name }`, never `status`, so it cannot hand their access back.

**The server stays the authority.** `can("users.edit")` is UI visibility only; 400 / 409 / 403 / 422 refusals are surfaced **verbatim** and the dialog stays open. No security logic duplicated in React.

**BUG-020 kept out of scope, visibly.** `bankIds`, `teamId` and `joinedOn` are absent from the form type *and* the payload type, so they cannot reach the request. The dialog says so in its own description. A test asserts no such control exists and no such key is sent.

**Editable:** name, email, phone, employeeCode, branch, roleId, status, target, achieved — nine, each verified against the live handler.

**Proven in both directions.** 52 new tests: 32 on the payload rules, 20 driving the **real page** — real row click, real Edit button, real Save. Sending the whole form fails **29 of 52**; a truthiness check on the numbers fails **6**.

Frontend **108/108** (7 files), backend **242/242 unchanged**, both typechecks clean, backend lint clean, frontend lint 87 (unchanged baseline, none of the new files flagged), `next build` exit 0. **No backend file was touched.**

### BUG-036 — a one-field PATCH no longer overwrites what you did not send (2026-09-02)

**Not a latent hazard waiting for Task 2.4 — both PATCH buttons shipping today tripped it.** `employees/page.tsx:222` ("Revoke access", body `{status}`) zeroed the employee's `target`/`achieved` on **every click**; `banks/page.tsx:97` (pause/resume) wiped `commissionRate` and `productsOffered`.

**Cause.** In zod 4.4.3 `.default()` survives `.partial()`: the field becomes `ZodOptional<ZodDefault<…>>`, and a successfully applied default is not an "absent" result, so it passes through. `userInput.partial().parse({name:"x"})` returns `{name, status:"Active", target:0, achieved:0}`.

**Wider than the register said.** Filed under *User administration*; the same shape existed at **six** `.partial()` call sites, and three spread the parsed body **with no `!== undefined` guard at all**. Measured before the fix: an Inactive employee renamed → **login 403→200**; a Paused bank renamed → un-paused, commission zeroed, products wiped; a customer renamed → **`kyc Verified→Pending`**; an Approved loan given a note → every money column zeroed and **status reverted to Draft**. `scoped-resource.ts` alone covers nine routers including settlements and the ledger. Title, feature and location corrected rather than a second finding filed.

**Fix.** One `patchSchema()` helper in `src/lib/zod.ts` stripping `ZodDefault` before `.partial()`, applied at all six sites. Public zod API only (`.shape`, `z.ZodDefault`, `.unwrap()`) — no `_def`/`_zod`. Inner schemas reused **by reference**, so every constraint, enum, uuid check, coercion and field-level transform/refine survives. Base/create schemas untouched — POST still applies every default, asserted by test. **D-024.**

**An accidental correctness became a real one.** Task 2.1's `input.status ?? target.status` fallback was unreachable dead code — SEC-003 was safe only because the injected `"Active"` pointed the *safe* direction. It is now the live path, pinned by a test: renaming an **Inactive** Super Admin leaves them Inactive. `super-admin-lockout.test.ts` still passes 26/26 unmodified.

**Proven in both directions.** 27 tests, every one asserting **database state**. Breaking the helper fails **19 of 27**. All four original reproductions re-measured after the fix — only the field actually sent changed.

Backend **242/242** (11 files), frontend **56/56**, both typechecks clean, backend lint clean, frontend lint 87 (unchanged baseline), `next build` exit 0. **No frontend source file changed.**

**Not fixed, deliberately:** BUG-020 (`teamId`/`bankIds`/`joinedOn` still discarded — roadmap 2.5) and BUG-037 (no transaction or lock introduced; none needed).

### Task 2.3 — a temporary password grants nothing but a password change (2026-09-02) — **SEC-010 / BUG-005 CLOSED**

`mustChangePassword` was written in four places, returned on the login profile, and **consulted by nothing**. Enforcement was a React redirect, so any non-browser client with an administrator-issued temporary password had full role-scoped API access indefinitely.

**Measured before the fix:** a flagged Executive could `POST /api/customers` (**201** — real business data). A flagged **Super Admin**, which is exactly what `db:seed` creates from a never-rotated deploy-dashboard value, could create accounts (**201**), read the audit log (**200**), and **reset other users' passwords (200), receiving another temporary credential**. `seed.ts:118-121`'s comment claiming the bootstrap password "stops being a valid credential" was false.

**The roadmap's mechanism could not work, and that was measured.** It asked for a path allow-list inside `requireAuth`. Under Express 5.2.1, inside a middleware registered by `router.use()`, `req.path` is **relative to the mount** — `/abc123`, not `/api/users/abc123` — and `requireAuth` is applied that way on twelve routers plus the `createScopedResource` factory. The comparison would never match, and every flagged user would be locked out of the one route that clears the flag.

**So no path is compared anywhere.** `requireAuth` became the strict default raising **403 `password_change_required`**; exactly two routes opt out via `requireAuthAllowPasswordChange` (`GET /api/auth/me`, `POST /api/auth/change-password`). A private `authenticate()` holds the shared token verification and context loading. Chosen over SEC-010's proposed separate middleware because that shape **fails open** across thirteen mount points; this one fails closed (D-023).

**`/api/auth/logout` was wrong in the roadmap too** — it carries no `requireAuth` at all (measured 204 with only a cookie), and neither do `/login` or `/refresh`.

**A workflow restriction is not a session termination.** The new code is deliberately not one of Task 1.8's two session-ending codes, and the check sits *after* the session gates — a flagged **and** deactivated account still reports `account_inactive`, on the exempt routes as well. **`frontend/src/lib/api.ts` is byte-identical**: Task 1.8's allow-list already fails safe for an unknown code, so only a test was added.

**Refresh stays reachable** and its rotated token is exactly as restricted; refresh tokens are not revoked for the flag, because that would strand a flagged user on every page reload. **Once the flag clears the same access token works immediately** — the context is re-read per request.

**Proven in both directions.** 18 backend + 1 frontend test. Four mutations: gate removed fails 8; a business router pointed at the permissive variant fails 5; `/auth/change-password` reverted to strict fails 3 **including the whole recovery path**; adding the code to `SESSION_ENDED_CODES` fails the frontend test.

Backend **215/215** (10 files), frontend **56/56**, both typechecks clean, backend lint clean, frontend lint 87 problems (unchanged baseline), `next build` exit 0.

**Register corrections:** the roadmap and FEATURE_STATUS both called this **SEC-009** — a different, still-open **P0**. Correct id **SEC-010**; third instance of this collision class. And **BUG-005 (HIGH) vs SEC-010 (MEDIUM)** described one defect at two severities — reconciled to **MEDIUM** in both, with the measured impact recorded rather than softened.

**Not fixed, recorded:** temporary-credential expiry (SEC-010 remediation 3) · the access token surviving a password change · PATCH-password session revocation · BUG-036 · the double `requireAuth`.

### Tasks 2.1 + 2.2 — a Super Admin can no longer lock the organisation out (2026-09-02) — **SEC-003 / BUG-003 CLOSED**

**The second P0 closed, and the first on the backend.** `PATCH /api/users/:id` accepted `status: "Inactive"` and a `roleId` demotion against your own row, returned `200`, and left no recovery path inside the product. The UI's "Revoke access" button issued exactly that request against whichever row was open — including your own.

**The obvious fix was wrong twice, and both were measured rather than argued.**

*Copying `DELETE`'s self-guard would have broken ordinary editing.* `DELETE`'s rule is an unconditional `if (id === ctx.userId) throw`; on `PATCH` that also refuses a Super Admin changing their own name. The guard compares against the **stored value** instead and refuses only a real change, so echoing your current `status` or `roleId` — which Task 2.4's edit form will do on every save — stays 200. A mutation that refuses on mere field *presence* fails four tests.

*A `status`-only guard would have left the quieter path open.* Self-demotion returns 200, the account stays **Active**, re-login returns 200 — and every administrative call then returns a bare `forbidden`, which Task 1.8's client deliberately does **not** sign out on. `DELETE` has no analogue to copy, because `DELETE` cannot change a role.

**2.2 landed inside 2.1, not after it.** The only formulation correct for both routes is *"count the protected population **excluding the target**; refuse if the operation removes the target and the count reaches zero"* — which **is** the 2.2 fix. One helper, `assertSuperAdminRemains(db, targetId, before, after)`, called by both routes. For an Active target it is provably equivalent to the old `remaining <= 1` over a count that included them, so `DELETE` is unchanged on active targets; for an Inactive target the old form produced a spurious 409, and deleting an already-deactivated Super Admin is now **204** (D-022).

**The two guards are independent, and that is why both exist.** Deactivating yourself while a peer exists leaves `remaining = 1` — the invariant holds and you are still permanently locked out.

**Two remediation items deliberately not done.** The database trigger (SEC-003 item 3) was **rejected on measured grounds**: a table-wide aggregate cannot be a `CHECK`, and a trigger's `restrict_violation` (`23001`) is unmapped in `error-handler.ts`, so it would surface as a **500** — and mapping it there is forbidden by D-021. The break-glass script (item 4) is an operational deliverable and stays **open**.

**Proven in both directions.** 26 new tests; **9 fail against the pre-fix code**. `DELETE`'s two guards had **never been executed by any test** in the repository's history — written before the refactor touched them. Four mutations: self-guard off → 1/2/2b fail; invariant off → 3/4/4b/15/19 fail; pre-2.2 count restored → **only 18** fails; self-guard on mere presence → 6/7/8/9 fail.

Backend **197/197** (9 files), frontend **55/55**, both typechecks clean, backend lint clean, frontend lint 87 problems (unchanged baseline), `next build` exit 0. No frontend change was made or needed.

**Found while closing it, recorded not fixed:** **BUG-036 (HIGH)** — `userInput.partial()` does not suppress `.default("Active")` in zod 4.4.3, so a name-only `PATCH` writes `status: "Active"` and zeroes `target`/`achieved`: **a revoked employee's access is silently restored by an unrelated edit.** Verified not to weaken this fix (the injected default is the safe direction). **BUG-037 (MEDIUM)** — the check-then-write race, a whole-codebase class. **SEC-003 kept at CRITICAL** with a qualifier: the register's own definition says "no privileged position", and this needs the most privileged one, with an accident as its dominant trigger.

### Phase 1 record correction (2026-09-02) — documentation only

A ten-agent audit plus two adversarial passes checked every Phase 1 claim against code. **The engineering held; the record did not.** Nine tasks verified, ten closed findings confirmed fixed with tests, `error-handler.ts` byte-identical to the Phase 0 baseline.

**Two serious record defects.** `PRODUCTION_ROADMAP.md:115` listed **SEC-013** — a still-open **P1** recycle-bin scoping hole whose code is still present at `admin.routes.ts:854,885` — among the problems Phase 1 solved; the CORS finding is **SEC-018**. And **DoD item 4** was ticked claiming a test proved navigation to `/employees`; the cited test renders no page, no frontend test mentions `/employees`, and login routes to `/dashboard`. Corrected honestly rather than by inventing a flow.

**Readiness recounted:** 8 of 17 scorecard rows disagreed with their tables — one caused by Phase 1 (Authentication row never incremented for A13/A6), seven inherited from `7977d6b`. **159/50/31% → 160/59/37%.** A6 and X9 were the same control with opposite statuses; X9 is now DONE.

**Self-inflicted errors fixed:** the false `getAccessToken()` rationale in `api.ts` (login returns `forbidden`, not the new codes — and D-020 contradicted itself on this), and eight `topbar.tsx:198` references that Task 1.9's own comment had moved to `:203`.

**Nothing was closed.** All open findings verified still open.

### Task 1.9 — A malformed customer id is a 422 (2026-09-02) — **BUG-017 CLOSED · PHASE 1 COMPLETE**

**Fix:** `z.object({ id: z.string().uuid() })` parsed inside the three customer `:id` handlers *after* `requirePermission`, plus `topbar.tsx:203` linking by `customer.id`. `error-handler.ts` changed by **zero lines**.

**The task was mostly about what NOT to do.** Two plausible fixes were measured and rejected: mapping `22P02` centrally (it also fires on integer/numeric/boolean/json, and `services/access.ts:48` raises it on *every* request if a token carries a non-uuid `sub` — that outage would become an unlogged 4xx), and a `router.param()` hook (runs before `requirePermission`; would flip 403→422 across the API). Recorded as D-021.

**Two register corrections.** **BUG-027 is INVALID** — `/check/reference` was never shadowed, because `:id` matches exactly one segment; measured 200/409 before any change, and its "move the route" fix was a no-op. **BUG-017 itself** claimed the sibling `?customerId=` calls returned 422; they returned **500** — now **BUG-035**.

**Scope stated honestly:** 3 endpoints fixed; **45 more share the pattern** and are deferred to Phase 8, along with BUG-035, the malformed-JSON 500, and the `rootCause()` SQLSTATE regex.

**Proven in both directions:** reverting the backend fails 9 of 20 tests; reverting the frontend line fails 1 of 2. Backend **171/171**, frontend **55/55**.

### Task 1.8 — Only two error codes end a session (2026-09-02) — **BUG-034 CLOSED**, amended

**A frontend-only fix was impossible.** Every 403 carried `code: "forbidden"` — deactivation, missing permission, bank scope, hierarchy, and the demo's fabricated refusals, the last byte-identical to the bank-scope one. Signing out on a bare 403 would log people out for browsing and end a presenter's demo.

**Severity corrected downward, honestly.** This was never an authorization bypass: the backend refused every request correctly, and the session already ended at access-token expiry via the refresh ladder. The defect was a **≤ 15-minute window** where the UI looked healthy and nothing loaded.

**Fix:** two codes (`account_inactive`, `role_disabled`) raised by the per-request session gates in `services/access.ts`; `apiRequest` signs out on those alone, and only when an access token is held. Status stays 403, shape unchanged, ordinary refusals keep `forbidden`, soft-delete keeps 401, the 401 ladder is untouched (D-020).

**Proven in both directions:** removing the branch fails 2 tests; widening it to any 403 fails 1. Backend **151/151**, frontend **53/53**.

**Demo note, recorded rather than assumed:** the demo is safe structurally — `apiRequest` returns from the demo short-circuit before the sign-out branch exists — so the demo test proves the demo works but would *not* catch an over-broad rule. The `forbidden`-stays-signed-in test is the real guard.

### Task 1.7 — `NODE_ENV` is required (2026-09-02) — **SEC-028 CLOSED**, amended from the roadmap wording

**The roadmap's remedy was a tautology, and I proved it rather than asserting it.** It asked to assert `NODE_ENV=production ⇒ secure && sameSite=none`; both are computed from that same expression, so with the defect restored the cookie assertions still **pass 5/5** while the two security tests fail.

**The real defect:** `NODE_ENV` defaulted to `development` and **nothing in the repo sets it** — no Dockerfile, railway/nixpacks file, Procfile, CI, and `npm start` is a bare `node dist/server.js`. A production deploy that forgot it booted as development and shipped `Secure=false; SameSite=Lax` refresh cookies — insecure over HTTP, and never sent across the Vercel↔Railway site boundary, so every reload silently signed the user out.

**Fix:** drop `.default("development")`. One schema field. `lib/tokens.ts` untouched — the cookie logic was always right; only its input was unguarded. Nothing is inferred from other variables, so there are no false positives (D-019).

**Verified:** 17 tests (backend **140/140**), no database, ~34 ms. Restoring the default fails 2.

**Found along the way:** the roadmap called this **SEC-014**, which is a *different* still-open finding (audit-log SQL precedence). The cookie hazard had **no id at all**. Filed as **SEC-028** and the roadmap corrected. It also **narrows SEC-007** — whose abuse scenario is exactly "NODE_ENV not set" — without closing it.

**Operational change:** a deployment relying on the old default now fails to boot until `NODE_ENV` is set. Intended.

**Not done:** `COOKIE_DOMAIN` host validation — the backend has no authoritative API-host value. Follow-up.

### Task 1.6 — A refused CORS origin returns 403, not 500 (2026-09-02) — **BUG-022 / SEC-018 CLOSED**

*Committed as the "Fix CORS rejection handling" checkpoint.*

**First backend change of the project.** Everything from 1.1 to 1.10 was frontend or documentation.

**One untyped error was the whole cause.** The origin callback rejected with a bare `Error`; `error-handler.ts` classifies `ZodError`, `AppError` and Postgres codes and sends everything else to the terminal 500 branch with an error-level stack trace. It now rejects with `AppError(403, "cors_origin_denied")` and logs once at `warn` **at the rejection site** — the error handler is untouched, so no other 4xx in the API changed its logging.

**Preflight was broken too and nobody had recorded it.** `cors@2` forwards the rejection before its own preflight branch, so a disallowed `OPTIONS` also returned 500. Now 403, with a test.

**The property that had to survive:** rejection happens before any route runs. With `SameSite=None` on the refresh cookie in production, the idiomatic-looking `callback(null, false)` would have let a hostile page reach `/api/auth/refresh` with the victim's cookie attached. Deliberately not used (D-018).

**Verified:** 16 new tests (backend **123/123**), no database, ~80 ms. Reverting the fix fails 7. Route non-execution proven positively — an unknown path under a denied origin returns 403, not 404, so `notFoundHandler` was never reached.

**Deliberately deferred:** the rejection log has no `requestId` (assigned after the CORS middleware). Fixing it reorders global middleware for every request; recorded as follow-up.

### Task 1.10 — The demo is excluded from every production build path (2026-09-02) — **SEC-027 / BUG-033 CLOSED**

**The obvious fix does not work.** Adding a webpack `resolve.alias` beside the Turbopack one compiles cleanly, prints `EXCLUDED`, and still ships the demo — Next's `JsConfigPathsPlugin` resolves `@/lib/demo` before the alias is consulted. Discovered because the tripwire failed the build, then confirmed by instrumenting the hook. webpack needs **`NormalModuleReplacementPlugin`**, which rewrites the request before resolution.

**Three layers (D-017).** Per-bundler exclusion; a **tripwire in `lib/demo/config.ts`** that fails the build on *any* bundler if the demo is reachable from a demo-disabled production build — and closes the deep-import hole, since every demo file imports config.ts; and `npm run verify:demo-exclusion`, which builds on both bundlers into clean output and searches it.

**Evidence:** three clean builds with distinct BUILD_IDs — turbopack and webpack both clean, demo-enabled build still contains the demo (the anti-vacuity check).

**Proven by two reversions.** Deleting the webpack key fails both `npm test` and the build check. Keeping the alias but dropping the replacement plugin — the plausible wrong fix — **passes `npm test` 46/46** and still fails the build check. That is why the build-output check exists: unit tests cannot catch a resolution-order defect.

**SEC-001's bundler condition is withdrawn.** **Residual:** `verify:demo-exclusion` needs a CI to run it; there is none yet (Phase 15).

### Task 1.5 — reviewed and CLOSED AS SUPERSEDED (2026-09-02) — **not implemented**

**The remedy cannot achieve the objective.** `NEXT_PUBLIC_*` values are inlined into client JS at build time — proven with a sentinel build, not argued — so a `NEXT_PUBLIC_DEMO_PASSWORD` would be a bundle literal exactly as the source constant is. A server-only variable cannot reach `isDemoCredentials()`, which runs in the browser with no network. And the credential was never the gate: the `sessionStorage` flag alone yields a full demo session (existing test group G). The objective was met by Task 1.3. Recorded as **D-016**.

**The review found a real HIGH defect, and it is not 1.5's.** `next build --webpack` — a documented Next 16.2.12 flag — ignores `turbopack.resolveAlias` and ships the credential plus all fabricated PII, **while the build prints `demo module: EXCLUDED` four times**. Filed as **SEC-027 / BUG-033**, owned by new roadmap task **1.10**. **SEC-001 is now recorded as closed *conditionally*** — Turbopack path only — with an explicit reopen trigger.

**Root cause of the miss:** SEC-001 was closed on a build-output search run once, by hand. Nothing inspects `.next`; the phase's own test list asked for this *"in CI-runnable form, not by eye"* and it was never built. That guard is now part of task 1.10.

**Also corrected:** D-014's "future move" framing, SEC-001's "every build prints which variant" safety claim, readiness item X2, the ownerless SEC-001 remediation items #2/#3, and the 256-vs-254 literal count.

### Task 1.4 — Demo mode is unmistakable while it is active (2026-09-02)

**The defect, precisely.** The only on-screen sign that the data was fabricated was a caption inside the sidebar's footer card, nested in that card's `{!collapsed && …}` wrapper (`sidebar.tsx:118`). Collapsing the sidebar — or simply being on mobile with the drawer shut — removed it, leaving structurally valid PANs, IFSC codes and loan amounts on screen with nothing saying they were invented. Its wording, *"Preview workspace · sample data"*, also never said the data was not real.

**Three surfaces, because they fail in different places** (D-015). A banner at the top of the content column in `AppShell` — outside the sidebar subtree, so collapse cannot reach it, and re-rendered on every `(app)` route. A badge in the topbar, which is `sticky top-0`, so the signal survives scrolling a long table. And the sidebar marker itself, lifted out of the `!collapsed` wrapper so it shrinks to its icon instead of vanishing.

**The test actually exercises the regression.** `AppShell` turns out to render fine under the existing vitest + jsdom setup — the whole shell mounts with `ThemeProvider` + `AuthProvider` and a `next/navigation` mock, no React Testing Library needed. So the test enters a real demo session, **clicks the real collapse button**, asserts the sidebar genuinely collapsed, and only then asserts the indicators are still there. **Proved by two independent reversions:** removing the banner from `AppShell` fails it, and re-hiding the sidebar marker when collapsed — the original defect, re-injected — fails it.

**Verified:** 8 new tests (37 total). Typecheck, build and backend 107/107 clean; lint **unchanged at exactly the baseline, 0 new warnings**. Task 1.3's protection re-verified after the change — 254 demo-exclusive literals, 0 in `.next/static`.

**Recorded honestly:** the indicator's own UI copy *does* ship in the production bundle, in a component that renders `null` because `isDemoMode()` is a compile-time `false`. It is UI text, not fixture data and not a credential — see BUG-032.

### Task 1.3 — The demo module is excluded from production builds (2026-09-01) — **SEC-001 CLOSED**

**Not the mechanism the roadmap proposed, and deliberately so.** It suggested a runtime env-flag guard relying on tree-shaking, or a dynamic `import()`. Neither *guarantees* absence — the first depends on minifier heuristics, and the second would force `apiRequest`'s synchronous decision to become asynchronous, reshaping a security-critical chokepoint. Implemented instead as **bundler module replacement**: `next.config.ts` aliases `@/lib/demo` to the inert `lib/demo-disabled.ts`, so `src/lib/demo/` is never resolved and never enters the module graph (D-014).

**The default is the safe one.** Flag unset → `next dev` includes the demo, `next build` excludes it. A client-demo build is an explicit act (`NEXT_PUBLIC_ENABLE_DEMO=true`). Every build prints which variant it produced.

**Evidence is the build output, not the source.** Hand-picked greps prove only the terms you thought of, so the search was run exhaustively: **all 256 string literals exclusive to `src/lib/demo/`, across all 46 client assets — 0 found.** The bundler's own sourcemap `sources[]` agrees: the only demo-related module in any chunk is `demo-disabled.ts`. Both directions verified — a demo-enabled build puts everything back.

**Verified, not assumed:** 10 new tests (29 total). Weakening the substitute's `isDemoMode()` fails 3; adding an export to the real module fails the parity test. Typecheck, build, lint (0 new warnings) and backend 107/107 all clean. `src/lib/demo/` is byte-identical — the demo was not touched.

**Found along the way:** the Task 1.2 session filed a finding as SEC-024, a number already in use, and never added it to the register. Renumbered **SEC-026** and added.

**Deliberately not done:** SEC-026 itself (out of scope, and now a demo-build-only defect since production has no demo layer). Task 1.4's visibility work was deferred at the time and is now **done**.

### Task 1.2 — Real authentication can no longer be answered by the demo layer (2026-09-01)

> **Adversarially reviewed.** Three independent lenses tried to break the change. They found **one real regression I had introduced** (BUG-031, fixed in the same task), **two latent holes in the guard's path matching** (fixed), **one tautological test of my own** (removed rather than kept as false assurance), **one fake test from Task 1.1** (rewritten to drive the real `forceSignOut` path), **one untested Task 1.1 guard** (test H added), and **one new finding out of scope** (filed as SEC-024, **renumbered SEC-026** in Task 1.3 — the number was already taken). Worth the cost.
Task 1.1 stops the flag being *set* on entry into a real session. Task 1.2 makes the interception harmless *even when the flag is set anyway* — by devtools, by a duplicated tab inheriting `sessionStorage`, or by any future `enableDemoMode()` call.

**Auth-path inspection first, not assumptions.** Only **one** of the demo's three `/auth/*` handlers is reachable while the demo is active: `/auth/refresh`, which is what restores a demo session across a page reload. `/auth/logout` is unreachable (`signOut` returns at `use-auth.tsx:257`, before the call at `:261`) and `/auth/me` has **zero** frontend callers — both are dead code.

**Implemented as an allow-list, not the roadmap's deny-list** (D-013). Same code size, strictly stronger: it **fails closed**, so the `/auth/forgot-password`, `/auth/reset-password` and `/auth/accept-invite` routes planned for Phase 3 are protected before they exist. Given the defect is "an auth request was silently answered by fixtures", the default must be deny.

**Verified:** 8 new tests (19 total) — groups F, G and H. Six drive `apiRequest` directly, bypassing Task 1.1's clearing, so only the transport guard can make them pass. The guard was temporarily removed and **2 failed** — while every demo test kept passing, confirming the demo is untouched.

**Demo preserved:** login, data, sign-out, and reload restore all still work — the last explicitly tested by mounting a fresh provider in a flagged tab.

### Task 1.1 — Demo mode cleared on entry into a real session (2026-09-01) — **first behavioural change**
Fixed **BUG-001**, the confirmed root cause of "Super Admin cannot add an employee", and partially remediated **SEC-001**.

Three clearing points, all frontend: `signIn`'s real branch (after the demo check, before the request), `forceSignOut`, and a mount-only login-page effect calling the new `exitDemoSession()`. Plus a guard for a race the original analysis missed — an in-flight demo `/auth/refresh` that resolved after the flag was cleared and re-trapped the tab.

**Verified, not assumed:** 11 new frontend tests; the fix was temporarily reverted and **3 of them failed**, proving they catch the regression. Backend 107/107 unchanged. Typecheck and build pass.

Added the repository's **first frontend test infrastructure** — vitest + jsdom only, no component library (D-012).

**Deliberately still open:** `/auth/*` interception (Task 1.2) and the demo bundle exposure (Task 1.3).

### ✅ PHASE 0 — COMPLETE (2026-08-31 → 2026-09-01)
All seven tasks done. Phase 0 was deliberately non-behavioural: verify, protect, configure, document. **No application logic was changed in any of it** — the one code commit (`583897f`) was pre-existing work reviewed and committed, not new development.

| Task | Outcome |
|---|---|
| 0.1 | Baseline verified — 5/5 gates, **107/107 tests** |
| 0.2 | Employee work reviewed against 15 criteria and committed as **`583897f`** |
| 0.3 | `.env.example` created — 17 variables, validated against the real zod schema |
| 0.4 | Root `.gitignore` created — 8 validation tests, secrets and artefacts covered |
| 0.5 | Tracked Python bytecode untracked (staged), D-009 executed |
| 0.6–0.7 | `README.md` corrected, demo mode documented, `frontend/README.md` marked historical |

**Definition of Done — all satisfied:** gates pass and are recorded · working tree's employee work committed · `.env.example` complete against `env.ts` · root `.gitignore` exists · `README.md` contains no claim contradicted by the code and documents demo mode · `DECISIONS.md` records the `__pycache__` removal.

### Tasks 0.6–0.7 — README corrections and demo documentation (2026-09-01)
Corrected five verifiable falsehoods in `README.md`: **"9 triggers" → 7** · **"82 tests across three files" → 107 across four** · the `frontend/ — UNMODIFIED` line · *"deployed to Railway"* (contradicted by the same file's *"Not deployed"*) · *"PostgreSQL 18"* (unverifiable — PGlite's version is not stated in the package, so the claim was softened rather than restated).

Added a **Demo mode** section documenting the credentials, that it is frontend-only and never transmitted, what the demo employee can see, and — importantly — **the stickiness defect (BUG-001) with its workaround** and the note that Phase 1 will make the credential stop working in production builds.

Added the 5 env vars missing from the README table and pointed it at `.env.example` as authoritative. Corrected the `frontend-contract.test.ts` description, which claimed it *"replays every request the frontend actually issues"* — it is GET-only, hand-maintained, and runs solely as `super_admin`.

**Deliberately left alone** because they are correct: the index counts (121/49 — right when counted from `pg_indexes`, which includes implicit PK indexes), 27 tables, 62 FKs, the architecture diagram, roles table, permission model, Excel-import walkthrough, and data-protection section.

`frontend/README.md` marked **HISTORICAL / LEGACY** with a table of its seven known-false statements and pointers to current docs. Original content preserved beneath.

### Task 0.5 — Python bytecode artefact untracked (2026-09-01)
`frontend/__pycache__/rewire.cpython-312.pyc` (12,489 bytes, blob `28e3028`, introduced by `beac90c`) removed from the git index with **`git rm --cached`** — the file **remains on disk** deliberately, as the only surviving physical evidence of the conversion script described in [../DECISIONS.md](../DECISIONS.md) D-009.

Before this task the file was in the unusual state of being **matched by a gitignore rule yet fully tracked** — `.gitignore` is not retroactive. `git check-ignore` now reports it **without** `--no-index`, which is the proof it is genuinely untracked.

**All 5 validations pass:** file still on disk · no longer tracked · now ignored · **zero** tracked Python artefacts remain repository-wide · no application source changed. Tracked count **146 → 145**, exactly one path removed.

⚠️ **The removal is staged, not committed** (`git status` shows `D  frontend/__pycache__/...`). It takes effect in the repository only when committed.

### Task 0.4 — Root `.gitignore` created (2026-09-01)
Closed two real gaps: **there was no root `.gitignore` at all**, so a `.env` at the repository root would have been committed; and `frontend/.gitignore` covers only `.env*.local`, so a plain `frontend/.env` would have been committed too. `README.md:52` already claimed otherwise.

Additive by design — `.gitignore` and `frontend/.gitignore` are untouched and remain the more specific authority for their packages. Verified non-contradictory: `.env` still resolves via `.gitignore:4`, `frontend/.env.local` via `frontend/.gitignore:8`, while `frontend/.env` is now caught by the new root rule.

**8 validation tests, all passing.** The critical one: all three `.env.example` files remain visible to git — including `.env.example`, which is **untracked**, so a mis-ordered negation would have silently undone Task 0.3. Tracked-file count is **146 before and after**; nothing was lost or gained.

**Already-tracked artefact found and deliberately NOT removed:** `frontend/__pycache__/rewire.cpython-312.pyc` matches the new `__pycache__/` rule (`.gitignore:76`) but is already in the index, so the rule has no effect on it — it will still be committed until it is explicitly untracked. That is **Task 0.5**, which needs its own `DECISIONS.md` D-009 entry.

### Task 0.3 — `.env.example` created (2026-09-01)
The documented setup previously **failed at step 3 of 6**: `README.md:28` and `:202` both referenced a `.env.example` that did not exist.

Discovered **17** environment variables the backend reads, from **three** sources — the zod schema in `config/env.ts` (16), plus two raw reads outside it: `LOG_LEVEL` (`lib/logger.ts:3`, unvalidated) and `DATABASE_URL` (`drizzle.config.ts:7`, used by `db:generate` rather than `DIRECT_DATABASE_URL`).

Created `.env.example` covering all 17, with placeholder values only and the production tripwires called out. **Validated against the real zod schema** in 5 postures — dev boots, production copied verbatim correctly refuses, identical JWT secrets refuse, missing `DATABASE_URL` refuses.

**No README edit was required** — creating the file made both broken references resolve.

**Finding recorded (not fixed, out of scope):** `AADHAAR_PEPPER` has a known-bad-value guard that fails production boot; `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` have **no equivalent guard**, so a deploy that copies the example's placeholder secrets boots in production with a publicly known signing key. Only the "must differ" check applies. Candidate for Phase 13.

### Task 0.2 — Employee work reviewed and committed (2026-09-01)
Full review of the 12-file uncommitted change set against 15 review criteria. **No defect found that blocks commit.** Backend gates re-run green immediately beforehand (107/107).

**Committed as `583897f` — "Complete employee management flow"** (+1,426 / −184).

Verified during review: employee creation calls the real `POST /users`; the temporary password the API already returned is now consumed and handed over once; admin reset calls the real new route (hierarchy-guarded, revokes all sessions, audited); forced password change is wired; the created employee logs in through the normal auth route (proven by test); role/team/bank assignment is correct; **the default-role-is-Super-Admin defect is fixed** (role is now an explicit required choice); no password reaches a log, `localStorage`, `sessionStorage`, or any response it should not; `permissions.ts` is untouched; **no schema, migration, seed, dependency or demo-mode change**; `lib/api.ts` and `lib/demo/` are byte-identical.

**Deliberately excluded from the commit:** `frontend/next-env.d.ts` (Next.js build artefact) and all of `docs/`.

**Operational note recorded:** the forced-change guard is now live for the first time. Any existing account with `must_change_password = true` — which includes the seeded bootstrap Super Admin (`seed.ts:121`) — will be redirected to `/change-password` on next sign-in. Intended and correct, but a visible behaviour change on an existing deployment.

### Task 0.1 — Baseline verification (2026-08-31)
All five documented quality gates run against the working tree at commit `7ef5da5`. **5 of 5 PASS, zero failures.**

| Gate | Result |
|---|---|
| Backend typecheck | ✅ PASS — 0 errors |
| Backend lint | ✅ PASS — 0 errors, 0 warnings |
| Backend tests | ✅ PASS — **107 passed / 107**, 4 files, 43.83 s |
| Frontend typecheck | ✅ PASS — 0 errors |
| Frontend build | ✅ PASS — 21 routes, 9.0 s |

Test total matches the documented 107 exactly. **The uncommitted employee work compiles, lints, builds and passes its 25 tests — it is safe to commit.** No application source file was modified. Full record in [../CURRENT_STATE.md](../CURRENT_STATE.md) §5.

⚠️ A green baseline proves the code compiles and the backend contracts hold. It proves **nothing** about the 13 fake handlers, the demo-mode hijack, the missing storage or the missing email — there are zero frontend and zero E2E tests.

### Documentation & audit (previous session)
- Full read-only repository audit, tracing every feature UI → API → database.
- Independent re-verification of every prior audit claim → [../AUDIT_VERIFICATION.md](../AUDIT_VERIFICATION.md). Prior audit found **substantially accurate**; **8 corrections** recorded.
- Complete documentation system created under `docs/` and `docs/claude/`.
- 16-phase master execution plan → [../PRODUCTION_ROADMAP.md](../PRODUCTION_ROADMAP.md).

**No application code was modified.**

### Pre-existing work found in the repository
Committed (`beac90c` … `7ef5da5`): the full backend (96 endpoints, 27 tables, 3 migrations, auth, RBAC, bank scoping, audit), 17 frontend pages, 82 backend tests, and the frontend-only demo layer.

**Uncommitted (working tree, ~1,242 lines, unverified):** employee creation with role/bank/team assignment, `generateTemporaryPassword()`, `POST /users/:id/reset-password`, forced password change end to end, the credential hand-over dialog, the client password-policy mirror, and 25 new tests. **This work is materially more complete than HEAD and must be verified and committed in Phase 0.**

---

## IN PROGRESS

**Phase 1.** **Demo isolation is finished and committed.** Tasks 1.1–1.3 are in `a77b3c5`; Tasks 1.4 (visible indicator) and 1.10 (exclusion on every bundler) are in the *"Secure demo build isolation and visibility"* checkpoint; Task 1.5 is **superseded** (D-016). **Tasks 1.6–1.9 remain** — four unrelated authentication-integrity defects, starting with the CORS 500.

✅ **SEC-001 is CLOSED** — the first P0 security finding off the list. Diversion (1.1, 1.2) and exposure (1.3) are both fixed, the last proven against the built output rather than the source.

⚠️ **One operational rule now carries it:** `NEXT_PUBLIC_ENABLE_DEMO=true` must never be set on a production deployment. A demo-enabled build ships the credential and every fixture — that is what it is for.

⚠️ **Uncommitted work from Phase 0 — should be committed before Phase 1 begins.** Phase 1 is the first work that changes application behaviour, and starting it from a dirty tree makes it hard to separate new changes from accumulated ones:

| Item | State |
|---|---|
| `.env.example` | untracked (0.3) |
| `.gitignore` | untracked (0.4) |
| `frontend/__pycache__/rewire.cpython-312.pyc` | **staged deletion** (0.5) |
| `README.md`, `frontend/README.md` | modified (0.6–0.7) |
| `docs/` (23 files) | untracked |
| `frontend/next-env.d.ts` | modified — Next.js build artefact |

**Ask the user before committing.**

---

## NOT STARTED

Phases 1–16 — every task that changes application behaviour.

---

## KNOWN BUGS — headline count

Full register: [../BUGS_AND_ISSUES.md](../BUGS_AND_ISSUES.md). Security: [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md).

| Severity | Count | The ones that matter most |
|---|---|---|
| CRITICAL | 2 *(was 3 — **BUG-003 CLOSED** 2026-09-02)* | 13 fake write handlers · document bytes discarded |
| HIGH | 8 *(**BUG-038** added and closed 2026-09-03)* | Notifications page never renders fetched rows · reports empty on load · ledger 403 for scoped users · ledger balance always 0 · `count(*)` code generation · sticky account lockout · bank soft-delete orphans customers · exports ship only 25 rows |
| MEDIUM | 8 *(**BUG-020** fixed 2026-09-03)* | Loans duplicate-submit · audit filter precedence · customer search 500 · dashboard 403-as-zeroes · deleted users unrecoverable · PATCH silently discards fields · imports 500 · CORS 500 |
| LOW | 4 | Dead AbortController · NaN rendering · unrendered loading/error · dead imports |

| Security severity | Count |
|---|---|
| CRITICAL | 1 *(was 2 — **SEC-003 CLOSED** 2026-09-02)* |
| HIGH | 6 |
| MEDIUM | 9 *(SEC-026 added by Task 1.2's review; renumbered from a colliding SEC-024 in Task 1.3)* |
| LOW | 8 |

**22 open · 6 resolved** (SEC-001, SEC-003, SEC-010, SEC-018, SEC-027, SEC-028). Authoritative register: [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md).

---

## COMPLETION ESTIMATE

Derived feature-by-feature from [../FEATURE_STATUS.md](../FEATURE_STATUS.md); **not** a guess.

| Layer | Complete | Basis |
|---|---|---|
| Backend | ~80% | 96 working endpoints; missing rate limiting, email, storage, retention, settings persistence, notification producers |
| Database | ~90% | 27 tables, zero drift, real triggers; missing CHECK constraints and a retention job |
| Frontend | ~35% | 17 pages render; 38/96 endpoints wired; 13 fake handlers; 5 admin screens absent; 5 pages broken |
| Integration | ~30% | 28% of the API is reachable |
| Operations | ~5% | Prose only — no CI, no deploy, no monitoring |
| **Overall** | **~45%** | |

---

## HOW TO UPDATE THIS FILE

After every meaningful change: move the task between sections, update the phase table, adjust the bug counts, revise the completion estimate **only if a feature's status genuinely changed**, and update the header date. Then update [NEXT_TASK.md](NEXT_TASK.md) and [../CHANGELOG.md](../CHANGELOG.md).
