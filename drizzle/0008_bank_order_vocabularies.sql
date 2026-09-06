/*
 * ─────────────────────────────────────────────────────────────────────────────
 * BANK ORDER VOCABULARIES — Task 6.5, DECISIONS.md D-010, D-057, D-063
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The repository's SECOND and THIRD CHECK constraints on status columns.
 * Migration 0007 added the first (`loans_status_check`); before it there were
 * none at all. After this migration, 3 of 29 tables carry one.
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header opens a second comment, and the trailing terminator
 * then closes only the inner one — the statements below get swallowed and the
 * migration fails with 42601 at position 1.)
 *
 * ── SCOPE: BOTH bank-order workflow columns ─────────────────────────────────
 *
 * `bank_orders` is the only table in the schema with TWO workflow columns:
 *
 *   stage  — the lender's pipeline position (Login -> ... -> Disbursal Queue)
 *   status — the health of that file      (In Progress / On Hold / Cleared /
 *                                          Returned)
 *
 * Roadmap 6.5 originally read "stage enums + DB CHECK constraints" and named
 * `status` nowhere, which would have left a live workflow column unconstrained
 * while its neighbour was guarded. D-063 assigns both to Phase 6. Both machines
 * are ratified at BUSINESS_FLOW.md 3.3.
 *
 * Not `disbursements.status` (Task 7.3, migration 0009), not
 * `settlements.status` (Task 8.2), not `transactions.status` (Task 8.1), not
 * `documents.status` or `verifications.status` — D-010 scopes per-resource
 * CHECKs to Phases 5-8 and 13.13 is the sweep.
 *
 * ── VOCABULARY, NEVER A TRANSITION. NO TRIGGER. ─────────────────────────────
 *
 * A CHECK is evaluated against the candidate row and can see no other. It can
 * say "Sanction is a word this column may hold"; it can NEVER say "Sanction may
 * only follow Field Verification". Transition legality is enforced in the
 * service layer -- `scoped-resource.ts`, reached through the `transitionColumn`
 * field F1-c added, because bank orders have NO approve route and PATCH is
 * therefore their only transition point.
 *
 * A trigger could express the transition and D-057 declines to add one: it
 * would put the machine in two languages with two ways to drift. The trigger
 * count stays at 7 (0001_governance_guards.sql).
 *
 * ── WHY NOT VALID, ON A COLUMN THAT LOOKS SAFE ──────────────────────────────
 *
 * Both columns are enum-validated on create AND on PATCH today, because
 * `patchSchema` strips the `.default()` and keeps the enum (D-024), and bank
 * orders have no approve route -- which is the route that writes free text on
 * every other resource. So unlike `loans.status` in 0007, there is no known
 * write path that could have produced an off-vocabulary value.
 *
 * The procedure is used anyway, and deliberately. "No write path could have
 * done it" is an argument about the code as it stands, not about the rows that
 * are actually in the table -- which may have arrived by direct INSERT, by an
 * older build, or by a data fix. A plain validating ADD CONSTRAINT would abort
 * the whole migration on the first offender and take the deployment with it.
 * NOT VALID plus a separate VALIDATE fails in a way an operator can read, and
 * costs one extra statement.
 *
 * ── PRE-FLIGHT: run this against production BEFORE deploying ────────────────
 *
 *   select id, code, stage, status
 *   from bank_orders
 *   where stage not in ('Login', 'Credit Check', 'Field Verification',
 *                       'Sanction', 'Disbursal Queue')
 *      or status not in ('In Progress', 'On Hold', 'Cleared', 'Returned');
 *
 * It must return zero rows. Note there is deliberately NO `deleted_at is null`
 * filter: a soft-deleted row is still a row, and VALIDATE reads every one of
 * them. Filtering here would hide exactly the offenders that abort the
 * migration.
 *
 * If it returns rows, correct them and re-run. Do not widen the vocabulary to
 * accommodate a typo -- that is how a vocabulary stops meaning anything.
 *
 * ── VERIFICATION ────────────────────────────────────────────────────────────
 *
 * The test harness migrates a FRESH EMPTY PGlite database
 * (`src/tests/harness.ts`), so it proves this file's SYNTAX and can never prove
 * its DATA compatibility. `src/tests/migration-0008-0011.test.ts` closes that
 * gap: it populates a database with representative and off-vocabulary rows and
 * asserts NOT VALID succeeds, VALIDATE fails on the offender, the pre-flight
 * query finds exactly it, and VALIDATE succeeds once corrected.
 */
ALTER TABLE "bank_orders" ADD CONSTRAINT "bank_orders_stage_check" CHECK ("bank_orders"."stage" in ('Login', 'Credit Check', 'Field Verification', 'Sanction', 'Disbursal Queue')) NOT VALID;--> statement-breakpoint
ALTER TABLE "bank_orders" VALIDATE CONSTRAINT "bank_orders_stage_check";--> statement-breakpoint
ALTER TABLE "bank_orders" ADD CONSTRAINT "bank_orders_status_check" CHECK ("bank_orders"."status" in ('In Progress', 'On Hold', 'Cleared', 'Returned')) NOT VALID;--> statement-breakpoint
ALTER TABLE "bank_orders" VALIDATE CONSTRAINT "bank_orders_status_check";
