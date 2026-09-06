# Migration snapshots — reconstructed and converging

**Recorded 2026-09-06, Wave 0 (repository integrity). Supersedes the
`meta/README.md` written earlier the same day.**

`meta/` now holds a `NNNN_snapshot.json` for **every** migration `0000`–`0013`,
and `npm run db:generate` reports **"No schema changes, nothing to migrate"**
against the current schema.

---

## Why this file is not in `meta/`

It used to be, and that was a defect in its own right.

`drizzle-kit` discovers snapshots by **listing the `meta/` directory**, not by
reading `_journal.json`:

```js
// drizzle-kit/bin.cjs — prepareOutFolder
const snapshots = readdirSync(meta).filter(it => !it.startsWith("_")).map(...)
```

`README.md` does not begin with `_`, so it was included in that list and handed
to `JSON.parse`, which threw:

```
SyntaxError: Unexpected token '#', "# Migratio"... is not valid JSON
    at validateWithReport (drizzle-kit/bin.cjs:8157:32)
    at prepareMigrationFolder (drizzle-kit/bin.cjs:8199:22)
```

**`npm run db:generate` crashed outright** — the file written to *document* the
snapshot gap was itself preventing anyone from closing it.

`meta/` is machine-owned. **Put no prose in it.** Renaming to `_README.md` would
also have satisfied the filter, and is the wrong fix for the same reason.

---

## What was reconstructed, and how it was proven

Snapshots `0008`–`0013` were missing: those migrations were hand-written during
Phase 6–10, and `drizzle-kit` cannot be pointed at an existing `.sql` file to
produce a matching snapshot.

They were rebuilt **by reverse application**, entirely in a scratch directory:

1. `drizzle-kit generate` was run against the current schema with only
   `0000`–`0007` present. Its emitted **snapshot** is the drizzle-canonical
   representation of the live schema. Its emitted **SQL was discarded** — that
   SQL is the duplicate-migration hazard this whole exercise exists to remove.
2. Each shipped migration was then reverse-applied to that snapshot, newest
   first: `0013` → `0012` → `0011` → `0010` → `0009` → `0008`. Every removal
   asserted that the object it deleted was actually present.
3. **The proof:** reverse-applying `0008`'s two CHECK constraints from the
   `0008` state produced a document **byte-identical to the known-good
   `0007_snapshot.json`** under a recursively key-sorted comparison.

That single equality ties the reconstructed chain to the shipped SQL **and** to
the live schema simultaneously. A snapshot that was subtly wrong anywhere in the
chain could not have landed on `0007` exactly.

### Per-step verification

Each snapshot was then checked independently: with snapshots `0000`–`N`
installed, `drizzle-kit generate` was asked what it would still emit. The delta
between consecutive runs is exactly one migration.

| Snapshots installed | Delta drizzle-kit still wanted | Shipped migration | Result |
|---|---|---|---|
| `0000`–`0013` | *nothing* | — | **zero diff** |
| `0000`–`0012` | `bank_orders_loan_unique` | `0013` | exact |
| `0000`–`0011` | `required_document_types` + FK + 2 indexes | `0012` | exact |
| `0000`–`0010` | `notifications` NOT NULL + 4 columns + 2 indexes | `0011` | equivalent¹ |
| `0000`–`0009` | `transactions_settlement_unique`, `ledger_entries_transaction_unique` | `0010` | exact |
| `0000`–`0008` | `disbursements_status_check` | `0009` | equivalent² |
| `0000`–`0007` | `bank_orders_stage_check`, `bank_orders_status_check` | `0008` | equivalent² |

**¹ and ² are the two expected divergences, and they are in the *discarded*
SQL — never in the snapshots.**

¹ `0011` ships `ADD COLUMN event_type text DEFAULT 'legacy' NOT NULL` followed
by `DROP DEFAULT`, because a bare `NOT NULL` add fails on a populated table.
drizzle-kit emits the unstaged `ADD COLUMN … text NOT NULL`. The **end state is
the same** — and that is what a snapshot records. `0011_snapshot.json` carries
`event_type` as `{ notNull: true }` with **no default**, which is correct.

² The shipped CHECK migrations use `ADD CONSTRAINT … NOT VALID` followed by a
separate `VALIDATE CONSTRAINT`, so the table is never held under an
`ACCESS EXCLUSIVE` lock while it is scanned. drizzle-kit emits the one-shot
form. Same constraint, same name, same expression, same end state; different
operational cost on a populated table.

**This is the standing reason to keep writing these migrations by hand.** The
snapshots make `drizzle-kit generate` *safe to run*; they do not make its output
suitable to ship for staged DDL.

---

## Invariants this reconstruction preserved

- **No `.sql` file was modified.** All fourteen verified byte-identical by MD5
  before and after.
- **`_journal.json` was not modified.** Verified by the same checksum run.
- **No migration was created.** `0014` and `0015` remain unwritten; they belong
  to Wave 2.
- `drizzle-kit check` reports *"Everything's fine"* — the `prevId` chain from
  `0007` through `0013` is unique-parented and collision-free.

---

## How to keep it converged

Before committing any schema change, `npm run db:generate` must either produce a
new migration **or** report no changes. If it reports a diff you did not intend,
the snapshots and the schema have drifted — **do not commit the generated SQL.**
Diagnose first.

This check belongs in CI (roadmap **14.7**). Until it is there, it is a manual
step and it is easy to skip, which is how the gap opened the first time.

### When a migration must be staged

Write the `.sql` by hand, as `0008`–`0013` were: a pre-flight offender query
that does **not** filter `deleted_at`, `NOT VALID` plus a separate `VALIDATE`,
and verification against a **populated** database. The PGlite harness migrates a
fresh empty database on every run — it proves syntax and can never prove data
compatibility.

Then bring the snapshot back into line by the reverse-application procedure
above, and re-run `npm run db:generate` until it reports no changes.

**One migration in flight repo-wide (D-050).**
