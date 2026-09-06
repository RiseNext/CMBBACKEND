# RULES — permanent instructions for every session

**Read this before touching anything. These rules are not advisory.**

---

## 1. THE CARDINAL RULE — TRACE BEFORE YOU CLAIM

Never state that a feature works without following the complete chain and citing a `file:line` for each link:

```
UI control → handler → frontend API function → HTTP request
  → backend route → authentication → authorization → validation
  → service → database write/read → response → frontend state → UI
```

If any link is missing, the feature does **not** work. Say so plainly and classify it.

**This repository was previously documented as more complete than it is because pages, buttons, types and endpoints were counted as evidence of working features. They are not.** Thirteen controls currently show a success message and issue no HTTP request at all. A page existing means nothing. A route existing means nothing. Only a traced chain means something.

---

## 2. DO NOT BREAK EXISTING FUNCTIONALITY

- The backend is substantially correct and well built. **Wire it; do not rewrite it.** 58 of 96 endpoints (60%) already work and simply have no caller.
- Before writing any new endpoint, service or helper, **grep for an existing one**. It probably exists.
- Do not refactor code you are not fixing. The task is production readiness, not restyling.
- Run the existing gates after every change: `cd CMBBACKEND && npm run typecheck && npm run lint && npm test`, and `cd frontend && npm run typecheck && npm run build`.

---

## 3. DEMO MODE — KEEP IT, ISOLATE IT

- **Do not remove demo mode.** It is a required client-presentation feature.
- **Do not let demo mode touch production authentication.** They must be structurally incapable of interacting.
- Anything under `frontend/src/lib/demo/` is fabricated data. It must never be presented as, confused with, or leak into real data.
- Demo mode must be visibly obvious to the user whenever it is active.
- After Phase 1, the demo layer must be absent from production builds — verify by grepping the build output.

---

## 4. DO NOT CREATE FAKE FUNCTIONALITY

**This is the defect that dominates this codebase. Do not add to it.**

Forbidden, without exception:
- A success toast that is not preceded by an awaited, successful request.
- A handler that calls `refresh()` and `setState` to simulate persistence.
- A control that promises an email, an export, a print job, or any external effect that does not occur.
- A security control that reports being enabled when it is not (the existing 2FA switch is the worst example in the repository — a false security assurance on a banking application).
- Hardcoded arrays standing in for API data.

If you cannot implement a control, **disable it or remove it**. A missing feature is honest; a lying feature is a defect.

---

## 5. SECURITY IS NOT OPTIONAL

- **Backend is the authority.** Anything enforced only in React is not enforced. A hidden button is not a permission check.
- Never store or log a plaintext password. Temporary passwords are generated, returned exactly once, and hashed immediately.
- Never print a secret value — in code, in logs, in documentation, or in a report. Reference the **file and variable name**, redact the value.
- Never widen an authorization check to make something work. If a role cannot do something, that is either correct or a permission-model bug — fix the model, not the guard.
- Bank scoping must **fail closed**. A user with no assignments sees nothing, never everything.
- New endpoints require `requireAuth` **and** an explicit `requirePermission`, **and** resource-scope validation.

---

## 6. PRESERVE THE ARCHITECTURE

- Express 5 + Drizzle + PostgreSQL on the backend; Next.js App Router on the frontend. Do not introduce a competing framework, ORM or state library without recording the decision in [../DECISIONS.md](../DECISIONS.md).
- Use the existing patterns: `createScopedResource` for scoped CRUD, `PERMISSIONS.*` constants (never a role-name string comparison — there are currently zero in authorization code and it must stay that way), `recordAudit` for mutations, `softDelete` for deletions.
- Schema changes go through a Drizzle migration. Never edit an applied migration file. The repository currently has **zero schema drift** — protect that.

---

## 7. TESTING

- Run the tests after every change. Do not report success on an unrun suite.
- New backend behaviour requires a backend test. New UI behaviour requires a frontend test.
- **Every mutating control you wire must get a test asserting it issues an HTTP request.** This is the specific regression guard for the 13 fake handlers.
- Never weaken or delete a test to make a change pass.
- Report test results honestly. If something fails, say so and show the output.

---

## 8. DOCUMENTATION IS PART OF THE WORK

After any meaningful change, update:

| File | When |
|---|---|
| [CURRENT_PROGRESS.md](CURRENT_PROGRESS.md) | Always |
| [NEXT_TASK.md](NEXT_TASK.md) | Always — rewrite it for the next task |
| [../FEATURE_STATUS.md](../FEATURE_STATUS.md) | When a feature's status changes |
| [../BUGS_AND_ISSUES.md](../BUGS_AND_ISSUES.md) | When a bug is fixed or found |
| [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md) | When a finding is closed or found |
| [../PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md) | When a checklist item changes state |
| [../PRODUCTION_ROADMAP.md](../PRODUCTION_ROADMAP.md) | When a phase completes |
| [../CHANGELOG.md](../CHANGELOG.md) | Always |
| [../DECISIONS.md](../DECISIONS.md) | When you make a non-obvious choice |

**Stale documentation is worse than none.** This repository already demonstrates that: `README.md` claims a trigger count that is wrong, a test count that is stale, and a `.env.example` that does not exist; `frontend/README.md` describes an application that no longer exists.

---

## 9. GIT

- **Never commit or push unless the user explicitly asks in that message.** Prior approval does not carry forward.
- Never use `--no-verify`, never skip hooks, never force-push.
- Never `git checkout`/`reset --hard` over uncommitted work without confirming — there were 1,242 lines of completed, tested work sitting uncommitted in this repository.
- Read-only git (`log`, `show`, `diff`, `status`) is always fine.

---

## 10. SCOPE DISCIPLINE

- Do exactly the task in [NEXT_TASK.md](NEXT_TASK.md). Do not skip ahead — phases have hard dependencies.
- If you find an unrelated bug, **record it in [../BUGS_AND_ISSUES.md](../BUGS_AND_ISSUES.md) and keep going.** Do not fix it opportunistically.
- If the task is blocked, say so, record why, and propose the unblocking step. Do not invent a workaround that adds fake functionality.
- If a task turns out to be wrong or already done, say so rather than manufacturing work.

---

## 11. HONESTY

- Report what you actually did and what actually happened.
- If tests fail, show the output.
- If you skipped something, say so and say why.
- If you are unsure, verify — or write `UNVERIFIED` and say what evidence would settle it.
- Do not describe partial work as complete. Do not hedge finished, verified work.

---

## 12. WHAT COUNTS AS "DONE"

A task is done when **all** of these hold:

1. The chain is traced end to end and cited.
2. Tests exist, are new where the behaviour is new, and pass.
3. All four gates pass (backend typecheck/lint/test, frontend typecheck/build).
4. No control shows success without a request.
5. Documentation is updated.
6. The relevant Definition of Done in [../PRODUCTION_ROADMAP.md](../PRODUCTION_ROADMAP.md) is satisfied.
