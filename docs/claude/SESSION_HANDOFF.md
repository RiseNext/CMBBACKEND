# SESSION HANDOFF

**The contract for starting and ending a session on this repository.**

> ## ⚠️ 2026-09-06 — ALL CLAUDE-OWNED WORK IS COMPLETE
>
> Waves 0–6 are done. **The next action is not a coding task**: it is creating
> the external services (Neon, S3, Resend, Railway, Vercel) and connecting them.
>
> **If you are an AI session, read [NEXT_TASK.md](NEXT_TASK.md) first.** It says
> the same thing and points at
> [`../GO_LIVE_CHECKLIST.md`](../GO_LIVE_CHECKLIST.md).
>
> Do not invent a task. If the operator wants more engineering before deploying,
> NEXT_TASK.md lists the genuine candidates in priority order — **14.9, the test
> suite against real PostgreSQL, is the highest-value one**, because 1,258
> backend cases run on PGlite and PGlite is not PostgreSQL.
>
> **Do not claim any external gate has passed.** Nothing has been deployed, no
> migration has run against a real server, S3 has never made a network call, and
> no email has ever reached Resend.

---

## STARTING A SESSION — read in this order

| # | File | Why | Skippable? |
|---|---|---|---|
| 1 | [RULES.md](RULES.md) | Non-negotiable constraints. Violating these costs more than the task is worth. | **Never** |
| 2 | [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) | What the project is, the architecture, the terminology, the five surprising facts. | **Never** |
| 3 | [CURRENT_PROGRESS.md](CURRENT_PROGRESS.md) | Where the work stands right now. | **Never** |
| 4 | [NEXT_TASK.md](NEXT_TASK.md) | The exact task to do. | **Never** |
| 5 | [../PRODUCTION_ROADMAP.md](../PRODUCTION_ROADMAP.md) — the current phase only | Goal, dependencies, Definition of Done. | **Never** |
| 6 | [../INTEGRATION_MAP.md](https://github.com/RiseNext/CMBFRONTEND/blob/main/docs/INTEGRATION_MAP.md) | If the task touches a screen — tells you whether it currently reaches the database. | If backend-only |
| 7 | [../API_OVERVIEW.md](../API_OVERVIEW.md) | If the task touches an endpoint — **check whether it already exists before writing one**. | If frontend-only |
| 8 | [../BUGS_AND_ISSUES.md](../BUGS_AND_ISSUES.md) / [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md) | Known defects in the area you are about to touch. | Rarely |

Then, **before writing any code**:

```bash
git status --porcelain          # confirm the tree matches CURRENT_PROGRESS
git log --oneline -5
```

If the tree does not match what the documentation says, **stop and reconcile before doing anything else.** Update the documentation to reality first.

---

## THE 60-SECOND ORIENTATION

If you read nothing else, read this:

- The **backend is real and good**; the **frontend is largely a shell over it**. 58 of 96 endpoints (60%) have zero callers.
- **Thirteen UI controls show a success toast and issue no HTTP request.** Never add a fourteenth.
- **Email is real since Phase 3** (Resend, `services/email.ts`; invitation and password-reset flows send for real). **There is still no file storage** anywhere in the repository — not a stub, not a template. *(Corrected 2026-09-05: this line said "no email and no file storage" until Phase 3 shipped.)*
- **Demo mode is sticky and intercepts login.** It is the confirmed root cause of "Super Admin cannot add an employee". Phase 1 fixes it.
- **Trace before you claim.** A page, a button, a type or a route existing proves nothing.

---

## WHILE WORKING

- Do **only** the task in `NEXT_TASK.md`. Phases have hard dependencies.
- Grep for an existing implementation before writing a new one — it usually exists.
- Found an unrelated bug? **Record it in `BUGS_AND_ISSUES.md` and move on.** Do not fix it opportunistically.
- Blocked? Say so, record why, propose the unblocking step. **Do not invent a workaround that adds fake functionality.**
- Run the gates as you go, not only at the end.

---

## ENDING A SESSION — mandatory

**A session is not finished until the documentation reflects reality.** Work is worth little if the next session cannot find it.

### 1. Verify
```bash
cd CMBBACKEND  && npm run typecheck && npm run lint && npm test
cd frontend && npm run typecheck && npm run build
```
Record the real result. **If something fails, say so and show the output.**

### 2. Update — every time
| File | What to write |
|---|---|
| [CURRENT_PROGRESS.md](CURRENT_PROGRESS.md) | Move the task between sections; update the phase table, bug counts and header date |
| [NEXT_TASK.md](NEXT_TASK.md) | **Rewrite completely** for the next task. Never leave a completed task here |
| [../CHANGELOG.md](../CHANGELOG.md) | A dated entry: what changed, why, which files |

### 3. Update — when applicable
| File | When |
|---|---|
| [../FEATURE_STATUS.md](../FEATURE_STATUS.md) | A feature's status changed |
| [../BUGS_AND_ISSUES.md](../BUGS_AND_ISSUES.md) | A bug was fixed or found |
| [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md) | A finding was closed or found |
| [../PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md) | A checklist item changed state |
| [../PRODUCTION_ROADMAP.md](../PRODUCTION_ROADMAP.md) | A phase completed — tick its Definition of Done |
| [../DECISIONS.md](../DECISIONS.md) | You made a non-obvious choice (provider, pattern, trade-off, accepted risk) |
| [../INTEGRATION_MAP.md](https://github.com/RiseNext/CMBFRONTEND/blob/main/docs/INTEGRATION_MAP.md) | You wired or unwired a UI→API path |
| [../API_OVERVIEW.md](../API_OVERVIEW.md) | You added, changed or removed an endpoint |
| [../DATA_MODEL.md](../DATA_MODEL.md) | You added a migration |

### 4. Hand off
Close with a summary in this exact shape:

```
## SESSION SUMMARY

COMPLETED
- <task id and one-line result>

VERIFIED
- backend: typecheck <pass/fail> · lint <pass/fail> · tests <n passed / m failed>
- frontend: typecheck <pass/fail> · build <pass/fail>
- End-to-end trace: <what you proved works, with file:line>

CHANGED
- <file> — <why>

FOUND (recorded, not fixed)
- <BUG-xxx / SEC-xxx> — <one line>

BLOCKED
- <what, and what would unblock it>   (or "Nothing")

DOCS UPDATED
- <list>

NEXT
- <the task now in NEXT_TASK.md>
```

---

## WHAT NOT TO DO AT HANDOFF

- ❌ Report a task complete when the chain is not traced end to end.
- ❌ Report tests passing without having run them.
- ❌ Leave `NEXT_TASK.md` describing a task you already finished.
- ❌ Commit or push without an explicit request **in the user's most recent message**. Prior approval does not carry forward.
- ❌ Leave the working tree dirty without saying so in the summary.
- ❌ Describe partial work as done, or hedge work that is genuinely finished.

---

## IF THE DOCUMENTATION AND THE CODE DISAGREE

**The code wins. Fix the documentation immediately, in the same session, before continuing.**

This repository has already been damaged by stale documentation: `README.md` claims a trigger count that is wrong and a test count that is stale, references a `.env.example` that does not exist, and describes the frontend as "UNMODIFIED" when it was mechanically rewritten before the first commit. `frontend/README.md` describes an application that no longer exists.

That is the failure mode this documentation system exists to prevent. Do not recreate it.
