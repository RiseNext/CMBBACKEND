# Documentation — Rise Next Banking CRM

**This directory is the single source of truth for what this project is, what actually works, and what happens next.**

If you are an AI session, start with **[claude/SESSION_HANDOFF.md](claude/SESSION_HANDOFF.md)**.
If you are a human joining the project, start with **[claude/PROJECT_CONTEXT.md](claude/PROJECT_CONTEXT.md)**.

> ## THE PROJECT IS NOW TWO REPOSITORIES
>
> | | |
> |---|---|
> | **Backend — this one, and the operations home** | <https://github.com/RiseNext/CMBBACKEND> |
> | **Frontend** | <https://github.com/RiseNext/CMBFRONTEND> |
>
> These documents were written against the original monorepo. At the split,
> every `backend/<path>` reference was rewritten to `<path>`, which is correct
> here. **`frontend/<path>` references were deliberately left intact** — they
> now mean *that path inside CMBFRONTEND*. Rewriting them would have damaged
> prose that carries real history for no gain.
>
> Two documents moved out of this directory because they are frontend-owned:
> **`INTEGRATION_MAP.md`** and **`FRONTEND_ANALYSIS.md`** now live in
> [CMBFRONTEND `docs/`](https://github.com/RiseNext/CMBFRONTEND/tree/main/docs).
> `API_OVERVIEW.md` and `ROLES_AND_PERMISSIONS.md` are interface contracts and
> exist in **both** repositories; this one is authoritative.
>
> See [REPOSITORY_SPLIT.md](REPOSITORY_SPLIT.md) for what moved where.

---

## THE 30-SECOND VERSION

> **Updated 2026-09-06, end of Wave 5 / Wave 6.** The paragraph this replaces described the repository as it was before Waves 0–6 and is kept below for the record, because the distance travelled is part of the story.

A Banking / Lending Operations CRM for a loan-origination business. **The backend is real and well engineered** — argon2id auth with rotating refresh tokens, database-resolved RBAC, fail-closed per-bank isolation, and a trigger-enforced audit trail. **The frontend is now a real client over it**: every screen exists and is wired, and a repository-wide sweep clicks every control on all twenty screens and fails any success claim not backed by a request or a produced file.

**Gates:** backend **1258/1258 · 55 files** · frontend **1143/1143 · 52 files** · both typechecks clean · `drizzle-kit check` fine · `db:generate` zero diff · demo exclusion PASSED · `next build` exit 0.

**Readiness 130/160 = 81%. Security: 0 CRITICAL · 1 HIGH · 2 MEDIUM · 6 LOW.**

**Status: READY FOR THE HUMAN PRODUCTION-SETUP PHASE.** Not deployed — and everything needed to deploy exists. Start at **[GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md)**.

*(superseded, 2026-08-31)* ~~38 of 96 endpoints are called, 13 controls show a success message and issue no HTTP request, there is no email and no file storage anywhere. Overall completion ≈ 45%. Classification: DEMO, not MVP.~~

---

## MAP

### Start here
| Document | What it answers |
|---|---|
| [claude/SESSION_HANDOFF.md](claude/SESSION_HANDOFF.md) | How to start and end a session on this repo |
| [claude/PROJECT_CONTEXT.md](claude/PROJECT_CONTEXT.md) | What the project is, the architecture, the terminology, the surprises |
| [claude/RULES.md](claude/RULES.md) | Non-negotiable constraints. **Read before touching anything** |
| [claude/NEXT_TASK.md](claude/NEXT_TASK.md) | **The exact task to do right now** |
| [claude/CURRENT_PROGRESS.md](claude/CURRENT_PROGRESS.md) | Where the work stands |

### The plan
| Document | What it answers |
|---|---|
| **[PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md)** | **The master execution plan — 16 phases from here to production.** The most important file in the repository |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | 160-item go/no-go checklist. **Currently 81% met**, recomputed mechanically |
| [DECISIONS.md](DECISIONS.md) | Why things are the way they are, and the 10 decisions still open |
| [CHANGELOG.md](CHANGELOG.md) | What changed, when, and why |

### Going to production — **start here**
| Document | What it answers |
|---|---|
| **[GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md)** | **The ordered list of what remains, who owns each row, and 72-hour hypercare** |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Platforms, the migration release step, rollback, backup/restore, the smoke test |
| [SECRETS.md](SECRETS.md) | Every environment variable, classified, with generator commands and the Aadhaar-pepper procedure |
| [BOOTSTRAP.md](BOOTSTRAP.md) | The first Super Admin — and the silent failure that costs a first deployment |
| [EMAIL.md](EMAIL.md) | Every mail flow audited from source, plus a 14-step production test |
| [RUNBOOK.md](RUNBOOK.md) | Day-2 operations, incidents, jobs, credential rotation, recovery |

### What is true today
| Document | What it answers |
|---|---|
| [CURRENT_STATE.md](CURRENT_STATE.md) | What actually works, verified by tracing code |
| [FEATURE_STATUS.md](FEATURE_STATUS.md) | Per-feature A–G status table with next actions |
| INTEGRATION_MAP.md → [CMBFRONTEND `docs/`](https://github.com/RiseNext/CMBFRONTEND/blob/main/docs/INTEGRATION_MAP.md) | **Screen by screen: does this control reach the database?** Moved at the split — it is frontend-owned |
| [BUGS_AND_ISSUES.md](BUGS_AND_ISSUES.md) | Every confirmed bug with evidence and a fix |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | Every confirmed security finding, plus a verified-safe list |
| [AUDIT_VERIFICATION.md](AUDIT_VERIFICATION.md) | The previous audit re-checked claim by claim, with 12 corrections |

### Reference
| Document | What it answers |
|---|---|
| [PRD.md](PRD.md) | What the product should do, with honest per-requirement status |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The architecture that actually exists, component by component |
| [BUSINESS_FLOW.md](BUSINESS_FLOW.md) | The end-to-end operational flow, annotated with where it breaks |
| [MANAGER_MAINTENANCE.md](MANAGER_MAINTENANCE.md) | The four manager tracking formats (FVR, Transfer, APTS, Payment) — field-by-field sources, what is authoritative vs derived vs maintenance, and the 8 questions still open for management |
| [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md) | The 5 roles, 76 permissions, and a per-role capability matrix |
| [DATA_MODEL.md](DATA_MODEL.md) | All 27 tables, relationships, triggers, and which are dead |
| [API_OVERVIEW.md](API_OVERVIEW.md) | All 96 endpoints with permission, validation, DB effect and caller |
| [TESTING_STRATEGY.md](TESTING_STRATEGY.md) | What is tested, what gives false confidence, what to add |

### The split
| Document | What it answers |
|---|---|
| [REPOSITORY_SPLIT.md](REPOSITORY_SPLIT.md) | What moved where when the monorepo became CMBBACKEND + CMBFRONTEND, and what to do about a path that no longer resolves |

### Historical — not authoritative
| Document | Note |
|---|---|
| FRONTEND_ANALYSIS.md → [CMBFRONTEND `docs/`](https://github.com/RiseNext/CMBFRONTEND/blob/main/docs/FRONTEND_ANALYSIS.md) | A pre-backend reconnaissance report from the first commit. **Superseded**, but its §2 missing-UI list and its §8 unresolved product question are still live. Moved at the split |

---

## THE NUMBERS

| Metric | Value |
|---|---|
| Backend endpoints | **96** (working tree) / 95 (HEAD) |
| Called by the frontend | **38** (40%) |
| Dead endpoints | **58** (60%) |
| Database tables | **27** — zero schema drift |
| Foreign keys / triggers / CHECK constraints | 62 / 7 / **1** (`loans_status_check`, Task 5.2) |
| Backend test cases | **795** across 28 files (verified 2026-09-05) |
| Frontend tests / E2E tests / CI workflows | **917** across 38 files / 0 / 0 (verified 2026-09-05) |
| Controls that fake success | **13** |
| Email providers / storage providers | **0 / 0** |
| Commits touching the backend | **1** (the first commit) |

---

## HOW THIS DOCUMENTATION STAYS TRUE

This is **living documentation**. Stale docs are treated as a defect, not an inconvenience — the repository already demonstrates the cost: `README.md` claims a trigger count that is wrong and a test count that is stale, and references a `.env.example` that does not exist; `frontend/README.md` describes an application that no longer exists.

After any meaningful change, update: `claude/CURRENT_PROGRESS.md`, `claude/NEXT_TASK.md`, `CHANGELOG.md`, and whichever of `FEATURE_STATUS.md`, `BUGS_AND_ISSUES.md`, `SECURITY_AUDIT.md`, `PRODUCTION_READINESS.md`, `PRODUCTION_ROADMAP.md`, `API_OVERVIEW.md`, `DATA_MODEL.md` or `DECISIONS.md` the change touched — and `INTEGRATION_MAP.md` **in CMBFRONTEND** if the change altered whether a screen reaches the database.

**If the documentation and the code disagree, the code wins — fix the documentation in the same session.**

---

## GROUND RULES, IN ONE SCREEN

1. **Trace before you claim.** A page, button, type or route existing proves nothing. Cite `file:line` for every link in the chain.
2. **Wire the backend; do not rebuild it.** 58 endpoints already work and have no caller.
3. **Never create fake functionality.** No success toast without an awaited request. Disable it or remove it instead.
4. **The backend is the only authority.** Anything enforced only in React is not enforced.
5. **Keep demo mode; isolate it.** It must never touch production authentication.
6. **Never commit or push** unless asked in the user's most recent message.
7. **Never print a secret value.** File and variable name only.
