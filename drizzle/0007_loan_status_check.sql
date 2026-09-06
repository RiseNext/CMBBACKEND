/*
 * ─────────────────────────────────────────────────────────────────────────────
 * LOAN STATUS VOCABULARY — Task 5.2, DECISIONS.md D-010, D-057
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The repository's FIRST CHECK constraint on a status column. Before this, a
 * grep for CHECK across every file in `backend/drizzle/` returned 0: 27 tables,
 * 62 foreign keys, 7 triggers, and not one constraint on any status column.
 * Postgres accepted `UPDATE loans SET status = 'banana'` without complaint, and
 * the approve route — which parsed `z.string().min(1)` and wrote the result
 * straight through — has been able to send it one since launch.
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header — a glob like `drizzle/` followed by `*.sql` is the
 * easy way to write one by accident — opens a second comment, and the trailing
 * terminator then closes only the inner one. The statements below get swallowed
 * and the migration fails with 42601 at position 1.)
 *
 * ── SCOPE: `loans.status`, AND NOTHING ELSE ─────────────────────────────────
 *
 * Not `verifications.status`, not `bank_orders.stage`, not any other column.
 * Roadmap 6.5 owns bank-order stages ("same pattern as Phase 5.2"), 7.3 owns
 * disbursements, and 13.13 is the sweep. `verifications.status` is named by no
 * row at all: the loan sub-route DERIVES it server-side
 * (`operations.routes.ts:151-158`) and the factory route already constrains it
 * with a Zod enum.
 *
 * ── VOCABULARY, NEVER A TRANSITION. NO TRIGGER. ─────────────────────────────
 *
 * A CHECK is evaluated against the candidate row and can see no other — not the
 * row's previous state, not another table. It can therefore say "Approved is a
 * word this column may hold" and can NEVER say "Approved may only follow Under
 * Review". Transition legality is enforced in the service layer
 * (`scoped-resource.ts`, from the machine ratified at BUSINESS_FLOW.md §3.3).
 *
 * A trigger COULD express the transition, and D-057 deliberately declines to add
 * one: it would put the state machine in two languages, in two places, with two
 * ways to drift, for a rule the API already refuses. The trigger count stays at
 * 7 (`0001_governance_guards.sql`).
 *
 * ── WHY `NOT VALID` AND THEN A SEPARATE `VALIDATE CONSTRAINT` ───────────────
 *
 * `ADD CONSTRAINT ... NOT VALID` applies the rule to all future writes without
 * scanning the existing table, and takes a far lighter lock than a validating
 * ADD. `VALIDATE CONSTRAINT` then performs the scan in its own statement, under
 * SHARE UPDATE EXCLUSIVE, which does not block reads or writes. Splitting them
 * means that on a populated production database the second statement can be
 * deferred or retried without the first having to be undone.
 *
 * ⚠️ **The test suite cannot prove this migration is safe against real data.**
 * `tests/harness.ts:43-45` creates a fresh, EMPTY PGlite database and migrates
 * it before seeding, so the validation below always scans zero rows. The suite
 * proves the constraint's syntax and its runtime behaviour; it can prove nothing
 * about compatibility with rows written before today.
 *
 * ── PRE-FLIGHT: RUN THIS AGAINST THE TARGET DATABASE FIRST ──────────────────
 *
 * `VALIDATE CONSTRAINT` fails with SQLSTATE 23514 if a single existing row is
 * outside the vocabulary, and the approve route has been able to write arbitrary
 * strings for the whole life of the deployment. Enumerate offenders BEFORE
 * running this migration — including soft-deleted rows, which the constraint
 * still covers because a CHECK has no `WHERE deleted_at is null`:
 *
 *     SELECT status, count(*) AS rows, min(created_at) AS first_seen
 *       FROM loans
 *      WHERE status IS NULL
 *         OR status NOT IN ('Draft', 'Submitted', 'Under Review',
 *                           'Approved', 'Disbursed', 'Rejected', 'Closed')
 *      GROUP BY status
 *      ORDER BY rows DESC;
 *
 * An empty result means this migration applies cleanly. A non-empty result must
 * be resolved by a DATA decision recorded in DECISIONS.md — mapping each stray
 * value to a real status — and never by widening the vocabulary to accommodate a
 * typo. Note that whitespace variants (`'Approved '`) will look correct in a
 * console; the query above catches them and `status NOT IN (...)` is why.
 */
ALTER TABLE "loans" ADD CONSTRAINT "loans_status_check" CHECK ("loans"."status" in ('Draft', 'Submitted', 'Under Review', 'Approved', 'Disbursed', 'Rejected', 'Closed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "loans" VALIDATE CONSTRAINT "loans_status_check";
