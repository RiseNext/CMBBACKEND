/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SETTLEMENT -> TRANSACTION -> LEDGER IDEMPOTENCY — Task 8.8
 * DECISIONS.md D-027, D-070 · BUGS_AND_ISSUES.md BUG-037
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two PARTIAL unique indexes. No CHECK, no trigger, and above all no lock.
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header opens a second comment whose terminator closes only
 * the inner one, swallowing the statements below.)
 *
 * ── IDEMPOTENCY IS NOT ATOMICITY ────────────────────────────────────────────
 *
 * Task F1 made the approve route transactional, so the settlement's status
 * change, the generated transaction, the generated ledger entry and all three
 * audit rows now commit or roll back together. That prevents a HALF-WRITTEN
 * chain.
 *
 * It does nothing whatever about a SECOND chain. Enforcement everywhere in this
 * codebase is check-then-write against the row read for the 404, so two
 * concurrent approvals can both observe `Pending`, both pass the transition
 * check, and both post a complete, internally consistent chain -- doubling the
 * commission in the books. Both transactions commit; neither is partial.
 *
 * These are different guarantees and the system needs both.
 *
 * ── WHY AN INDEX AND NOT A LOCK ─────────────────────────────────────────────
 *
 * D-027 settled the concurrency posture for the whole repository: no row locks,
 * check-then-write stays the pattern at all eleven transaction sites, and
 * BUG-037 stays deferred. That decision is about `SELECT ... FOR UPDATE`.
 *
 * A unique index is not a lock. It is a constraint, it costs nothing on the
 * read path, and it converts the race from "silently double-post" into "the
 * second writer gets 23505 and its whole transaction rolls back" -- which,
 * because of F1, is a clean no-op rather than a partial write. D-070 records
 * this as the compliant remedy.
 *
 * ── WHY PARTIAL, AND WHY THIS EXACT PREDICATE ───────────────────────────────
 *
 * Most transactions have no settlement and most ledger entries have no
 * transaction. In Postgres, NULLs are distinct in a unique index, so an
 * unconditional index would technically allow many NULLs -- but it would also
 * index every row in two large and growing tables to enforce a rule that
 * concerns a small subset. The partial predicate keeps the index to the rows
 * the rule is about.
 *
 * `deleted_at is null` is included because BOTH tables carry the soft-delete
 * mixin (`lifecycle` in `db/schema/operations.ts`) -- verified before this file
 * was written, because the predicate is wrong without knowing it. A voided or
 * soft-deleted chain must not permanently block a legitimate re-post of the
 * same settlement.
 *
 * ── WHAT THIS DOES NOT CONSTRAIN ────────────────────────────────────────────
 *
 * Multi-tranche disbursement (many disbursements per loan) is untouched -- that
 * is a different chain and is explicitly legitimate (`afterCreate` in
 * operations.routes.ts returns early for an already-Disbursed loan).
 *
 * Reversals are untouched: a correction is a NEW `Refund` transaction with its
 * own ledger entry and no `settlement_id`, per D-069's immutability policy. It
 * does not collide with the original.
 *
 * ── PRE-FLIGHT: run this against production BEFORE deploying ────────────────
 *
 *   select settlement_id, count(*)
 *   from transactions
 *   where settlement_id is not null and deleted_at is null
 *   group by settlement_id having count(*) > 1;
 *
 *   select transaction_id, count(*)
 *   from ledger_entries
 *   where transaction_id is not null and deleted_at is null
 *   group by transaction_id having count(*) > 1;
 *
 * Both must return zero rows. They are expected to: `grep insert(transactions)`
 * and `grep insert(ledgerEntries)` across `backend/src` both returned ZERO
 * before Task 8.8, so neither column has ever been populated by the
 * application. If either query returns rows, the data arrived by direct INSERT
 * and must be reviewed by a human before anything is deleted -- these are
 * financial records, and D-069 makes them immutable. **Do not deduplicate
 * automatically.**
 *
 * Unlike a CHECK, an index has no NOT VALID form: CREATE UNIQUE INDEX fails
 * outright on a duplicate. The pre-flight is the only warning available, which
 * is why it is two queries rather than a footnote.
 *
 * ── VERIFICATION ────────────────────────────────────────────────────────────
 *
 * `src/tests/migration-populated.test.ts` proves the index accepts many NULLs,
 * accepts a soft-deleted duplicate, and rejects a live one with 23505.
 */
CREATE UNIQUE INDEX "transactions_settlement_unique" ON "transactions" USING btree ("settlement_id") WHERE "transactions"."settlement_id" is not null and "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_transaction_unique" ON "ledger_entries" USING btree ("transaction_id") WHERE "ledger_entries"."transaction_id" is not null and "ledger_entries"."deleted_at" is null;
