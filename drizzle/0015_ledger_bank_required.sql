/*
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY LEDGER ENTRY BELONGS TO A BANK — Task 11.6(c)
 * DECISIONS.md D-084 (resolves OPEN-7), D-069, D-070, D-010
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header opens a second comment whose terminator closes only
 * the inner one — the statements below get swallowed and the migration fails
 * with 42601 at position 1.)
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `ledger_entries.bank_id` was nullable. `bankScope` filters with `inArray`
 * (`services/access.ts:117`), and SQL `IN` **never matches NULL**. So a
 * hand-created entry from an unscoped user — Super Admin or Admin, the only
 * roles holding `ledger.create` today — landed with `bank_id = NULL` and was
 * **permanently invisible to every scoped user**. No error, no warning, nothing
 * on screen to suggest the row existed. A financial record written into a hole.
 *
 * D-070 bounded the problem: ownership flows settlement -> transaction ->
 * ledger and `settlements.bank_id` is NOT NULL, so **every entry the 8.8 chain
 * generates already carries a bank**. Only hand-created entries were affected.
 *
 * **The project owner resolved OPEN-7 on 2026-09-06: bank-less entries are not
 * legitimate.** This migration makes that true at the database.
 *
 * ── PRE-FLIGHT: run this against production BEFORE deploying ────────────────
 *
 * It deliberately does NOT filter `deleted_at`. `SET NOT NULL` has no WHERE
 * clause, so a soft-deleted offender blocks it exactly as a live one does.
 *
 *   select id, code, entry_date, particulars, debit, credit, deleted_at
 *     from ledger_entries
 *    where bank_id is null
 *    order by entry_date;
 *
 * It must return zero rows.
 *
 * **If it returns rows, STOP. Do not backfill.** These are financial records
 * and this migration will not invent a bank for one. The business must say
 * which bank each entry belongs to; apply those answers as an explicit,
 * reviewed data change with its own audit trail, then re-run this migration.
 * That is D-010's standing rule and the reason step 2 below is separable — a
 * deployment that meets an offender fails at a step it can retry, with the
 * guard already stopping any NEW offender, rather than aborting wholesale.
 *
 * Measured in this repository on 2026-09-06 against a fully migrated and
 * seeded database: **0 rows total, 0 NULL**. `db:seed` writes no business data
 * by design, so that says nothing about any deployed database. Run it there.
 *
 * ── WHY FOUR STEPS AND NOT ONE `SET NOT NULL` ───────────────────────────────
 *
 * A bare `ALTER COLUMN ... SET NOT NULL` takes ACCESS EXCLUSIVE and holds it
 * for a **full sequential scan** of the table, blocking every read and write on
 * the ledger for the duration. It also aborts the whole migration on the first
 * offender, with no partial protection left behind.
 *
 * The staged form below is the standard Postgres 12+ answer and it matches this
 * repository's NOT VALID + separate VALIDATE convention:
 *
 *   1. ADD CONSTRAINT ... CHECK (bank_id IS NOT NULL) NOT VALID
 *        Catalogue-only, effectively instant. From this moment **no new NULL
 *        can be written**, even though existing rows are unverified.
 *   2. VALIDATE CONSTRAINT
 *        Scans under SHARE UPDATE EXCLUSIVE, which does not block reads or
 *        writes. This is the step that fails on an offender — and it is
 *        retryable once the data is fixed.
 *   3. SET NOT NULL
 *        Postgres recognises the validated CHECK and **skips the scan**, so the
 *        ACCESS EXCLUSIVE lock is held for a catalogue write only.
 *   4. DROP CONSTRAINT
 *        The CHECK is now redundant with the column's own NOT NULL.
 *
 * ── THE FOREIGN KEY HAD TO CHANGE TOO ───────────────────────────────────────
 *
 * `bank_id` was declared `ON DELETE SET NULL`. That is **incompatible** with
 * NOT NULL: deleting a bank would attempt to write NULL into a column that
 * forbids it, turning a legible refusal into a constraint violation from a
 * completely different table.
 *
 * It becomes `ON DELETE RESTRICT`, which is what every other NOT NULL
 * `bank_id` in this schema already uses (`loans`, `verifications`,
 * `bank_orders`). Refusing to delete a bank that still owns ledger entries is
 * the correct answer for immutable financial records (D-069), and banks are
 * soft-deleted in normal operation, so this changes nothing about ordinary use.
 *
 * No trigger is added. The trigger count stays at 7 (D-057).
 */

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bank_id_not_null" CHECK ("ledger_entries"."bank_id" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_entries_bank_id_not_null";--> statement-breakpoint
ALTER TABLE "ledger_entries" ALTER COLUMN "bank_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_bank_id_not_null";--> statement-breakpoint

ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_bank_id_banks_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;
