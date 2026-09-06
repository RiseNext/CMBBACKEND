/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE LIVE BANK ORDER PER LOAN — Task 6.4
 * DECISIONS.md D-027, D-070 · BUSINESS_FLOW.md 3.3
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * One partial unique index. No column is altered and no row is touched.
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header opens a second comment whose terminator closes only
 * the inner one, swallowing the statement below.)
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Task 6.4 makes a loan submission create its bank order automatically, inside
 * the same database transaction as the loan. A bank order tracks ONE file's
 * progress through ONE lender's pipeline, and a loan names exactly one bank, so
 * a second order for the same loan is not a richer record -- it is the same
 * file counted twice on the Kanban board, in every SLA query and in the "open
 * orders" figure the dashboard reports.
 *
 * ── THE SERVICE CHECK IS NOT ENOUGH, AND THAT IS THE POINT ──────────────────
 *
 * `afterCreate` looks for an existing order before inserting. That is
 * check-then-write against a row read moments earlier, which is the posture
 * D-027 fixes for the whole repository: no row locks, at any of the transaction
 * sites. So two concurrent submissions of the same loan can both find nothing
 * and both insert.
 *
 * Atomicity does not help here -- both transactions are complete and internally
 * consistent. This is the same distinction migration 0010 records for the
 * settlement chain: **atomicity prevents a partial write, a unique index
 * prevents a duplicate one**, and the system needs both. D-027 forbids locks;
 * it does not forbid constraints.
 *
 * With this index the loser of the race gets 23505 and its whole transaction
 * unwinds -- which, because the insert is inside the loan's own transaction,
 * means the duplicate SUBMISSION fails cleanly rather than leaving a second
 * order behind.
 *
 * ── WHY PARTIAL ─────────────────────────────────────────────────────────────
 *
 * `deleted_at is null` matches every other unique index in this schema
 * (`bank_orders_code_unique`, `loans_code_unique`, `customers_code_unique`).
 * A soft-deleted order must not permanently prevent re-submitting the loan --
 * the recycle bin is recoverable, and a purge should not be required before a
 * file can move again.
 *
 * ── PRE-FLIGHT: run this against production BEFORE deploying ────────────────
 *
 *   select loan_id, count(*)
 *   from bank_orders
 *   where deleted_at is null
 *   group by loan_id having count(*) > 1;
 *
 * It must return zero rows. Unlike a CHECK, an index has no NOT VALID form:
 * CREATE UNIQUE INDEX fails outright on a duplicate, so this query is the only
 * warning available.
 *
 * If it returns rows they predate this constraint and a human must decide which
 * order is the real one -- they may carry different stages, officers and
 * remarks. **Do not deduplicate automatically.** Soft-delete the redundant one
 * (`deleted_at = now()`) rather than hard-deleting it; the partial predicate
 * then excludes it and the file trail survives.
 *
 * ── VERIFICATION ────────────────────────────────────────────────────────────
 *
 * `src/tests/migration-populated.test.ts` proves the index accepts one order
 * per loan, rejects a second live one with 23505, and permits a replacement
 * once the first is soft-deleted.
 */
CREATE UNIQUE INDEX "bank_orders_loan_unique" ON "bank_orders" USING btree ("loan_id") WHERE "bank_orders"."deleted_at" is null;
