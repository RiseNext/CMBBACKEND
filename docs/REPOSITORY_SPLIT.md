# THE REPOSITORY SPLIT

**2026-09-06.** The monorepo `RiseNext/Risenext-Banking-CRM` became two
production repositories.

| | |
|---|---|
| **Backend — and the operations home** | <https://github.com/RiseNext/CMBBACKEND> |
| **Frontend** | <https://github.com/RiseNext/CMBFRONTEND> |

The original repository is **unchanged**. Nothing was rewritten in it, no
history was rewritten anywhere, and no migration was edited. Both new
repositories start from a single commit containing the finalized working tree.

---

## 1. WHY IT WAS SAFE TO DO MECHANICALLY

There was **no root `package.json`**, no workspace configuration, and no shared
`node_modules`. `backend/` and `frontend/` were already two independent npm
packages that happened to sit in one directory.

More importantly, **no source file in either package referenced a path outside
its own package root.** Everything resolves from the package root:
`src/tests/env-template.test.ts` uses `path.resolve(__dirname, "..", "..")`,
`src/tests/migration-populated.test.ts` uses `process.cwd()`,
`src/services/storage.ts` uses `process.cwd()`. That was verified by search
before anything was moved, and it is the reason the split needed no code change
at all.

Only four things at the repository root were genuinely shared, and each had to
be decided rather than copied:

| Root file | What happened to it |
|---|---|
| `README.md` | **Rewritten as two.** The original described a monorepo layout that no longer exists. Each new README carries only its own half, plus the cross-repository pointer |
| `.gitignore` | **Merged into each package's own.** The root file was a safety net over both; each repository now carries the union of the root rules and its package rules |
| `.github/workflows/ci.yml` | **Split into two.** Four jobs became three here (`backend`, `schema`, `hygiene`) and two there (`frontend`, `hygiene`). Every `working-directory:` and every `backend/`-prefixed path is gone |
| `scripts/ci-local.sh` | **Split into two**, one per repository, at `scripts/ci-local.sh` in each |

---

## 2. WHERE THE DOCUMENTATION WENT

**This repository is the operations home.** It holds the full documentation set,
because deployment, secrets, migrations, bootstrap, incidents, security findings
and decision records are all operational and all rooted here.

| Document | Where it lives now |
|---|---|
| `INTEGRATION_MAP.md` | **Moved to CMBFRONTEND.** Frontend-owned: it is a screen-by-screen map |
| `FRONTEND_ANALYSIS.md` | **Moved to CMBFRONTEND.** Frontend-owned history |
| `API_OVERVIEW.md` | **In both.** It is the interface contract; the copy *here* is authoritative |
| `ROLES_AND_PERMISSIONS.md` | **In both.** Same reason |
| Everything else in `docs/` | **Here only.** CMBFRONTEND's `docs/README.md` links back rather than duplicating |
| `frontend/README.md` | **Moved to CMBFRONTEND `docs/LEGACY_README.md`.** It was already flagged as historical and known-false; it is retained only as a record of what the app used to claim |

Two copies of a 2,300-line decision log drift, and a drifted operational
document is worse than a link. That is the whole reasoning behind "in both" being
a list of exactly two files.

---

## 3. PATHS INSIDE THESE DOCUMENTS

Every `backend/<path>` reference in this directory was rewritten to `<path>`,
because this repository's root **is** the backend. `cd backend` became
`cd CMBBACKEND`.

**`frontend/<path>` references were deliberately left intact.** They now mean
*that path inside CMBFRONTEND*. Rewriting them would have produced sentences
like "split frontend/correctly" out of prose about the monorepo, and would have
damaged history that is worth more than a broken relative link costs. If you
find one and want the file, prefix it with:

```
https://github.com/RiseNext/CMBFRONTEND/blob/main/
```

after removing the leading `frontend/`.

Bare `backend/` in running prose — "run `npm test` in `backend/`", "Scope:
`backend/`, `frontend/`" — was **not** rewritten either, for the same reason:
it is describing the repository as it was, in documents whose job is to record
what was true when.

---

## 4. WHAT DID NOT CHANGE

- **No application source file was modified by the split.** Not one.
- **No migration was edited, reordered, added or removed.** `0000` … `0015`,
  16 files, 16 snapshots, 16 journal entries, exactly as before.
- **No test was changed, skipped or weakened.**
- **No CI gate was disabled.** The frontend lint step is still *reported, not
  gated* — that was the pre-existing configuration and its reasoning is in the
  workflow file, not a concession made here.
- **The original repository was not touched.**

---

## 5. WHAT A CLEAN CHECKOUT CAN DO

Verified after the split, from a fresh clone with no reference to the old
monorepo path:

```bash
# CMBBACKEND
npm ci && npm run typecheck && npm run lint && npm test && npm run build

# CMBFRONTEND
npm ci && npm run typecheck && npm test && npm run build && npm run verify:demo-exclusion
```

See the CI workflow in each repository, and `scripts/ci-local.sh` for the same
sequence on your own machine.
