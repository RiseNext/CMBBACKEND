/*
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTIFICATION EVENT MODEL — Task 10.3, DECISIONS.md D-077
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Four columns, one partial unique index, and one NOT NULL.
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header opens a second comment whose terminator closes only
 * the inner one, swallowing the statements below.)
 *
 * ── WHY THE TABLE IS EMPTY, AND WHY THAT MATTERS HERE ───────────────────────
 *
 * `grep insert(notifications)` across `backend/src` returns ZERO. The seed does
 * not touch the table either. Nothing in this system has ever been able to
 * create a notification, which is BUG-024 -- the bell badge, the page and the
 * read endpoints all exist and all read a table that cannot contain a row.
 *
 * That is what makes this migration safe to write as strictly as it is. On any
 * database this application has produced, `notifications` is empty, so
 * `SET NOT NULL` cannot fail and `ADD COLUMN ... NOT NULL` needs no backfill.
 *
 * It is written defensively anyway: `event_type` is added WITH a default and the
 * default is then DROPPED, so the statement also succeeds against a table that
 * somehow does hold rows, and no future insert can silently omit the column.
 *
 * ── user_id NOT NULL ────────────────────────────────────────────────────────
 *
 * `GET /api/notifications` scopes on `ctx.userId`. A row with a null recipient
 * was therefore invisible to every user, permanently and silently -- there is no
 * branch anywhere that reads NULL as "broadcast". A fan-out to several people
 * is N rows, one per recipient, which is what the table's shape already
 * implies.
 *
 * ── event_key: idempotency that does not suppress real events ───────────────
 *
 * Row 10.3 requires "each producing event writes EXACTLY ONE notification row".
 * Transaction atomicity cannot deliver that: a retry is a second transaction
 * and commits happily.
 *
 * `event_key` is `{event_type}:{record_type}:{record_id}:{discriminator}`. The
 * discriminator carries whatever makes a LEGITIMATE repeat distinct -- for a
 * tranche disbursement, the disbursement id. Retries of the same event collide
 * on the index; genuinely repeated events do not. A cruder rule (unique on
 * record_id, or a time window) would silently swallow the second tranche's
 * notification, which is worse than a duplicate.
 *
 * The index is PARTIAL: `event_key` is null for any row not produced by the
 * event service, and those must not collide with one another.
 *
 * It is keyed on (user_id, event_key), not event_key alone, because a fan-out
 * writes the same event to several recipients and each must be deduplicated
 * independently.
 *
 * ── PRE-FLIGHT: run this against production BEFORE deploying ────────────────
 *
 *   select count(*) from notifications;                     -- expected: 0
 *   select count(*) from notifications where user_id is null;  -- MUST be 0
 *
 *   -- and, only if the table is somehow non-empty:
 *   select user_id, event_key, count(*) from notifications
 *   where event_key is not null group by user_id, event_key having count(*) > 1;
 *
 * If the second query returns anything, `SET NOT NULL` below will FAIL and the
 * migration will abort. That is deliberate. Those rows are unreachable by every
 * user by construction, so deleting them loses nothing -- but that is a
 * judgement for an operator to make and record, not for this file to make
 * silently. **This migration deletes nothing.** Clear the rows by hand, record
 * what was cleared, then re-run.
 *
 * ── VERIFICATION ────────────────────────────────────────────────────────────
 *
 * `src/tests/migration-populated.test.ts` applies this against a database
 * holding pre-existing notification rows, asserts the NOT NULL takes, asserts a
 * duplicate `event_key` for one user is rejected with 23505 while the same key
 * for a DIFFERENT user is accepted, and asserts many null-`event_key` rows
 * remain legal.
 */
ALTER TABLE "notifications" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_type" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "event_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "record_type" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_key" text;--> statement-breakpoint
CREATE INDEX "notifications_record_idx" ON "notifications" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_unique" ON "notifications" USING btree ("user_id","event_key") WHERE "notifications"."event_key" is not null;
