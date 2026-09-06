# PROJECT CONTEXT

**Read this first. It is the minimum you need to be useful in this repository.**

---

## 1. WHAT THIS PROJECT IS

**Rise Next Banking CRM** — a Banking / Lending **Operations** CRM.

The business is a **DSA (Direct Selling Agent) / loan-origination operation**: it sources loan customers, prepares their files, submits them to **partner banks**, tracks each file through the bank's processing stages, records disbursement when the bank pays out, and reconciles **commission settlements** with each bank on a cycle.

The system exists to run that operational pipeline and to manage the employees who work it.

---

## 2. THE ONE-PARAGRAPH SUMMARY OF THE CURRENT STATE

The **backend is real and well engineered** — 96 endpoints, 27 tables, argon2id authentication with rotating refresh tokens, a database-resolved role/permission model re-checked on every request, fail-closed per-bank data isolation, and an append-only audit trail enforced by a database trigger. The **frontend is largely a shell over it**: only 38 of the 96 endpoints are ever called, thirteen business actions display a success message and issue no HTTP request at all, and there is no email system and no file storage anywhere in the repository. A frontend-only demo layer used to intercept every API call when one browser flag was set — the confirmed root cause of "Super Admin cannot add an employee" — and shipped its credential to every visitor; **Phase 1 Tasks 1.1–1.3 closed that, and it is now absent from production builds entirely.** Overall completion is roughly **45%**: backend ~80%, frontend ~35%, integration ~30%, operations ~5%.

---

## 3. ARCHITECTURE

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2.12 App Router, React 19, Tailwind 4, Radix/shadcn, Chart.js, sonner |
| Backend | Express 5.1, TypeScript (ESM) |
| Database | PostgreSQL (Neon), `node-postgres` Pool |
| ORM | Drizzle 0.44 + drizzle-kit migrations |
| Auth | argon2id + JWT HS256 access token (15 min, in a module variable) + rotating httpOnly refresh cookie (7 days) |
| AuthZ | `user → role → role_permissions`, resolved **from the database on every request**; per-bank scoping from `user_bank_access` |

```
Browser (Next.js — ALL pages "use client", NO middleware.ts, NO app/api/)
   │
   ├─ IF sessionStorage["risenext.demo.session"] == "active"   ← DEV / DEMO BUILDS ONLY
   │     │   (a production build has no demo module; isDemoMode() is a compile-time false)
   │     │   …and even here, every /auth/* path except /auth/refresh skips this branch
   │     └─► frontend/src/lib/demo/api.ts ─► sessionStorage fixtures  [NOTHING leaves the tab]
   │
   └─► fetch ─► Express
                helmet → cors(allowlist, credentials) → requestId → json(1mb)
                → cookieParser → pino-http → [NO RATE LIMITER]
                → requireAuth (verify JWT → loadAuthContext: 3 SQL queries, no cache)
                → requirePermission → zod → Drizzle (bank scope in the SQL WHERE)
                → Postgres (27 tables, 7 triggers)
                → notFoundHandler → errorHandler
```

**Absent from that diagram, deliberately:** there is no object store, no mail transport, no job runner, no cache, no observability, and no deployment artifact of any kind.

---

## 4. TERMINOLOGY — read this before reading code

| Term | Table | Note |
|---|---|---|
| **Customer** | `customers` | The borrower. Unique per `(bank_id, bank_reference_id)`. |
| **Loan / File / Application** | `loans` | ⚠️ **The permission namespace calls these `requests.*`, not `loans.*`.** There is no `loan_request` table — "requests" and "loans" are the same entity under two names. |
| **Bank** | `banks` | A partner lender. The tenancy boundary. |
| **Bank order** | `bank_orders` | A file's progress through the bank's own processing stages. |
| **Verification** | `verifications` | Field/document verification, optionally via a service provider. One per loan. |
| **Service provider** | `service_providers` | Third-party verification vendor. Not bank-scoped. |
| **Funding source** | `funding_sources` | Where disbursed money comes from (own funds or a bank line). |
| **Disbursement** | `disbursements` | The payout, with a UTR reference. |
| **Settlement** | `settlements` | Periodic commission reconciliation with a bank. |
| **Transaction** | `transactions` | A money movement record. |
| **Ledger entry** | `ledger_entries` | Double-entry-style voucher. |
| **Document** | `documents` | ⚠️ **Metadata only — no file is ever stored.** |
| **Team** | `teams` / `team_members` | Grouping of employees. Not bank-scoped. |
| **Recycle bin** | `recycle_bin_entries` | Soft-delete index with a full JSON snapshot. |
| **Employee / User** | `users` | Every principal. There is no separate employee table. |
| **Bank scope** | `user_bank_access` | Which banks a user may see. `system.access_all_banks` bypasses it. |

---

## 5. ROLES

Five seeded roles. **Lower level = more authority.**

| Key | Name | Level | Notes |
|---|---|---|---|
| `super_admin` | Super Admin | 0 | `isSystem`, holds the **entire** permission catalogue (the `"*"` wildcard is expanded into real DB rows by the seed — it is **not** a code bypass) |
| `admin` | Admin | 10 | Holds `system.access_all_banks` |
| `manager` | Manager | 20 | Bank-scoped |
| `team_leader` | Team Leader | 30 | Bank-scoped |
| `executive` | Executive | 40 | Bank-scoped. ⚠️ **Does not hold `reports.view`**, so `/api/dashboard/*` returns 403 and the dashboard renders zeroes |

**The single hierarchy rule:** an actor may only act on a subject whose role level is **strictly greater** than their own, unless they hold `system.manage_any_user`. That one rule produces the whole model, with **zero role-name string comparisons anywhere in authorization code**. Keep it that way.

---

## 6. MAJOR WORKFLOWS

```
Super Admin → employee & access management → employee login
   → customer → loan/file → documents/KYC → bank → bank order
   → verification → approval/rejection → disbursement → transaction
   → settlement → notifications / audit / reports
```

**Wired end to end today:** customer create/list/delete, Excel customer import, loan create, disbursement create, ledger create (super admin/admin only), bank create/pause, recycle bin restore/purge, the full auth chain, and — in the committed employee work — employee create with a one-time temporary password.

**Everything after "bank order" in that chain is either backend-only or fake.** See [../BUSINESS_FLOW.md](../BUSINESS_FLOW.md) for the annotated diagram.

---

## 7. THE FIVE THINGS THAT WILL SURPRISE YOU

1. **60% of the backend is unreachable.** 58 of 96 endpoints have zero frontend callers, including all four `approve` routes, all role and team CRUD, and the audit-log endpoint. Most "new features" are a wiring job.
2. **Thirteen controls lie.** They call `refresh()` and show a success toast without issuing any request — loan approve, disbursement "mark credited", settlement "mark paid", transaction settle, bank-order stage/remark, document verify/delete, customer edit/delete, and more. The backend routes for all of them exist.
3. ~~**Demo mode is sticky and intercepts login.**~~ ✅ **FIXED 2026-09-01 by Phase 1 Tasks 1.1–1.3.** `disableDemoMode` used to have exactly **one** call site — inside `signOut` — so a tab that once ran the demo silently kept serving fixtures and failed real login with "Endpoint not found". The flag is now cleared on every entry into a real session, `apiRequest` sends every `/auth/*` path except `/auth/refresh` to the real backend regardless of the flag, and **a production build contains no demo module at all**. BUG-001 and SEC-001 are closed.
4. **There is no email and no file storage.** Not a stub, not a template, not a config key. Documents record a filename and discard the bytes.
5. **The `app_settings` table is completely dead** — zero references outside the schema file. That is why the entire Settings page persists nothing.

---

## 8. DEMO ACCOUNT vs PRODUCTION ACCOUNT

| | Demo | Production |
|---|---|---|
| Credentials | `demo.employee@risenext.com` / `Demo@12345`, hardcoded in `frontend/src/lib/demo/config.ts:14-15` | Real rows in `users`, argon2id-hashed |
| Where matched | **In the browser, before any network call** (`use-auth.tsx:174`) | `POST /api/auth/login` |
| Data source | `frontend/src/lib/demo/data.ts` — 838 lines of fixtures in `sessionStorage` | PostgreSQL |
| Persona | "Karthik Rao", Executive, 12 permissions, 2 banks — all client-side literals | Whatever the database says |
| Server knowledge | **None.** The backend rejects the demo address like any unknown login | Full |
| Scope | 10 allow-listed routes; administrative screens are unreachable | Permission-driven |
| Lifetime | `sessionStorage` — dies with the tab | httpOnly refresh cookie, 7 days |

✅ **Fixed 2026-09-01 (Task 1.3).** The demo password and all 838 lines of fabricated PII used to be statically linked into the main client chunk for every visitor, because `lib/api.ts` deep-imported the demo module at module scope. **Inclusion is now a build-time decision**: `next.config.ts` aliases `@/lib/demo` to the inert `lib/demo-disabled.ts` unless `NEXT_PUBLIC_ENABLE_DEMO=true`, so `src/lib/demo/` never enters a production bundle. `next dev` still includes it; `next build` excludes it by default. Verified against the build output — 256 demo-exclusive string literals, 0 present in `.next/static`. See [../DECISIONS.md](../DECISIONS.md) D-014.

⚠️ **The one rule that keeps that true:** `NEXT_PUBLIC_ENABLE_DEMO=true` must never be set on a production deployment. A demo build ships everything in the table above — that is its purpose.

---

## 9. IMPORTANT CONSTRAINTS

- **The demo must remain available.** Isolate it; never delete it.
- **Never create fake functionality.** See [RULES.md](RULES.md) §4.
- **The backend is the authority.** Anything enforced only in React is not enforced.
- **Never commit or push** unless the user explicitly asks in that message.
- **Never print a secret value.** File and variable name only.
- Money is `numeric(16,2)` in the database. It becomes a JS double in the frontend — treat that as a known defect, not a pattern to copy.
- PII: Aadhaar is stored as a peppered SHA-256 plus the last 4 digits. **PAN and account number are plaintext.** India's DPDP Act applies.

---

## 10. WHERE TO LOOK

| Question | File |
|---|---|
| What should the product do? | [../PRD.md](../PRD.md) |
| What is actually built? | [../CURRENT_STATE.md](../CURRENT_STATE.md), [../FEATURE_STATUS.md](../FEATURE_STATUS.md) |
| Does this screen reach the database? | [../INTEGRATION_MAP.md](https://github.com/RiseNext/CMBFRONTEND/blob/main/docs/INTEGRATION_MAP.md) |
| What endpoints exist? | [../API_OVERVIEW.md](../API_OVERVIEW.md) |
| What does the schema look like? | [../DATA_MODEL.md](../DATA_MODEL.md) |
| Who can do what? | [../ROLES_AND_PERMISSIONS.md](../ROLES_AND_PERMISSIONS.md) |
| What is broken? | [../BUGS_AND_ISSUES.md](../BUGS_AND_ISSUES.md) |
| What is insecure? | [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md) |
| **What do I do next?** | [NEXT_TASK.md](NEXT_TASK.md) |
| **What is the plan?** | [../PRODUCTION_ROADMAP.md](../PRODUCTION_ROADMAP.md) |
| Was the old audit right? | [../AUDIT_VERIFICATION.md](../AUDIT_VERIFICATION.md) |

---

## 11. KEY FILES BY IMPORTANCE

**Backend:** `app.ts` (all 22 mounts) · `modules/admin.routes.ts` (1,002 lines — users, roles, teams, recycle bin, audit, notifications) · `modules/scoped-resource.ts` (the CRUD factory behind 9 resources) · `services/access.ts` (the entire authorization model) · `lib/permissions.ts` (the catalogue and the 5 default roles) · `modules/auth.routes.ts` · `db/schema/*.ts`.

**Frontend:** `lib/api.ts` (the single network chokepoint — **and the demo short-circuit**) · `hooks/use-auth.tsx` (session + the demo credential branch) · `hooks/use-api.ts` (`useResource`/`useRecord`/`useStats`) · `components/layout/app-shell.tsx` (every client-side guard) · `lib/demo/` (the fake backend).
