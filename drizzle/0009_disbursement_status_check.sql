/*
 * ─────────────────────────────────────────────────────────────────────────────
 * DISBURSEMENT STATUS VOCABULARY — Task 7.3
 * DECISIONS.md D-010, D-057, D-066 · SECURITY_AUDIT.md SEC-016
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The repository's FOURTH CHECK constraint on a status column, and the one with
 * genuine populated-data risk.
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header opens a second comment whose terminator closes only
 * the inner one — the statements below get swallowed and the migration fails
 * with 42601 at position 1.)
 *
 * ── WHY THIS COLUMN IS DIFFERENT FROM 0008's ────────────────────────────────
 *
 * `bank_orders` has no approve route, so every write path to its workflow
 * columns was already enum-validated and migration 0008 used NOT VALID as
 * procedure rather than necessity.
 *
 * `disbursements` DOES have an approve route, and it has been able to write
 * arbitrary text to this column since launch:
 *
 *     POST /api/disbursements/:id/approve  {"status": "Credited "}
 *
 * `approveBody` fell back to `z.string().min(1)` whenever a resource configured
 * no `allowedStatuses`, and disbursements configured none. SEC-016 is written
 * against exactly this route, and D-010 opens with exactly this example: a
 * trailing space produces an off-books disbursement that every reconciliation
 * query misses while the UI shows it approved.
 *
 * **So an offending row is not hypothetical here.** Any production database
 * that has ever served an approve call on this resource may hold one. NOT VALID
 * is load-bearing, not ceremonial: a plain validating ADD CONSTRAINT would
 * abort the migration and take the deployment with it.
 *
 * ── VOCABULARY, NEVER A TRANSITION. NO TRIGGER. ─────────────────────────────
 *
 * `In Transit -> Credited` and `In Transit -> Failed` are the only legal edges,
 * `Credited` and `Failed` are terminal, and `->Credited` additionally requires a
 * non-null UTR. **None of that is expressible here** — a CHECK sees one row and
 * cannot see the row's own previous value. All of it lives in the service layer
 * (`scoped-resource.ts`, from the machine ratified at BUSINESS_FLOW.md 3.3).
 *
 * The trigger count stays at 7 (D-057).
 *
 * ── WHAT THIS DOES NOT CLOSE ────────────────────────────────────────────────
 *
 * A CHECK guards the vocabulary. It cannot see WHO is writing, so it does
 * nothing about the two privilege holes D-066 closes in the same task:
 *
 *   POST  /api/disbursements        {"status":"Credited"}  -> 201 on `create`
 *   PATCH /api/disbursements/:id    {"status":"Credited"}  -> 200 on `edit`
 *
 * Manager holds both `create` and `edit` and holds neither approve permission.
 * `initialStatuses` and `patchRefusals` close those; this file does not.
 *
 * ── PRE-FLIGHT: run this against production BEFORE deploying ────────────────
 *
 *   select id, code, status, utr, deleted_at
 *   from disbursements
 *   where status not in ('Credited', 'In Transit', 'Failed');
 *
 * It must return zero rows. There is deliberately NO `deleted_at is null`
 * filter: VALIDATE reads soft-deleted rows too, and filtering here would hide
 * exactly the offenders that abort the migration.
 *
 * If it returns rows, they are almost certainly whitespace variants of a legal
 * value. Correct them to the intended value -- do NOT widen the vocabulary to
 * accommodate them, and do NOT delete them: a disbursement row is a record that
 * money moved.
 *
 *   -- the expected repair, run and reviewed one row at a time:
 *   -- update disbursements set status = btrim(status)
 *   --  where btrim(status) in ('Credited','In Transit','Failed')
 *   --    and status <> btrim(status);
 *
 * ── VERIFICATION ────────────────────────────────────────────────────────────
 *
 * `src/tests/migration-populated.test.ts` populates a database with the exact
 * `'Credited '` row this route could have written and asserts the full
 * sequence: NOT VALID succeeds, VALIDATE fails with 23514, the pre-flight query
 * finds it, and VALIDATE succeeds once it is trimmed.
 */
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_status_check" CHECK ("disbursements"."status" in ('Credited', 'In Transit', 'Failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "disbursements" VALIDATE CONSTRAINT "disbursements_status_check";
