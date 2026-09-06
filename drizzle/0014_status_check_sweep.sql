/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STATUS-VOCABULARY SWEEP — Task 13.13
 * DECISIONS.md D-010, D-057 · SECURITY_AUDIT.md SEC-016 (closes it)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nine CHECK constraints, taking the repository from 4 to 13. This is the sweep
 * 13.13 names, and it is what finally closes SEC-016.
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header opens a second comment whose terminator closes only
 * the inner one — the statements below get swallowed and the migration fails
 * with 42601 at position 1.)
 *
 * ── WHY THIS CLOSES SEC-016 AND 0007-0009 DID NOT ───────────────────────────
 *
 * SEC-016 is "POST /:id/approve accepts any status string; no state machine, no
 * CHECK constraints". `approveBody` falls back to `z.string().min(1)` for any
 * resource that configures no `allowedStatuses`, so an approve route on an
 * unconfigured resource could write arbitrary text.
 *
 * 0007 closed loans. 0008 closed both bank-order columns. 0009 closed
 * disbursements. That left **verifications** — a resource that HAS an approve
 * route (`permissions.approve` is `verification.approve`) and was named by no
 * roadmap row in any phase. NEXT_TASK.md carried it forward five separate times
 * as "belongs to the 13.13 sweep". This is that sweep.
 *
 * With `verifications_status_check` in place there is no approve-route status
 * column left unconstrained at the database, and SEC-016 closes.
 *
 * ── VOCABULARY, NEVER A TRANSITION. NO TRIGGER. ─────────────────────────────
 *
 * Every constraint below is `status in (...)` and nothing else. A CHECK is
 * evaluated against the candidate row and can see no other — not the row's own
 * previous value, not the actor, not another table. So it cannot express that
 * `Pending -> Verified` is legal while `Verified -> Pending` is not, and it
 * cannot express that only an `approve` holder may make the move.
 *
 * All of that stays in the service layer, where `allowedTransitions`,
 * `initialStatuses` and `patchRefusals` already carry it (`scoped-resource.ts`,
 * from the machines ratified at BUSINESS_FLOW.md 3.3.1). **D-057.**
 *
 * The trigger count stays at 7. No trigger is added here.
 *
 * ── WHAT IS DELIBERATELY NOT CONSTRAINED ────────────────────────────────────
 *
 * `teams.status`         no route writes it and no zod enum guards it. The
 *                        vocabulary is not settled, and inventing one here
 *                        would be policy rather than remediation.
 * `import_batches.status`
 * `import_rows.status`   lowercase, free-form, written directly by the importer
 *                        with no enum in front of them. SEC-008 / Task 13.7 is
 *                        about to rewrite that whole path; constraining it now
 *                        would freeze a vocabulary that is about to change.
 *
 * Both are recorded rather than swept, so the omission is a decision and not an
 * oversight.
 *
 * ── PRE-FLIGHT: run this against production BEFORE deploying ────────────────
 *
 * It deliberately does NOT filter `deleted_at`. A CHECK has no WHERE clause, so
 * a soft-deleted offender fails VALIDATE exactly as a live one does. Every
 * previous status migration in this repository made the same point, and Phase 5
 * proved it was not theoretical.
 *
 *   select 'users' t, status, count(*) from users
 *     where status not in ('Active','Inactive') group by status
 *   union all select 'banks', status, count(*) from banks
 *     where status not in ('Active','Paused') group by status
 *   union all select 'customers', status, count(*) from customers
 *     where status not in ('Active','Follow Up','Closed') group by status
 *   union all select 'documents', status, count(*) from documents
 *     where status not in ('Verified','Pending','Rejected') group by status
 *   union all select 'funding_sources', status, count(*) from funding_sources
 *     where status not in ('Active','Inactive') group by status
 *   union all select 'service_providers', status, count(*) from service_providers
 *     where status not in ('Active','Inactive') group by status
 *   union all select 'settlements', status, count(*) from settlements
 *     where status not in ('Paid','Pending','Disputed') group by status
 *   union all select 'transactions', status, count(*) from transactions
 *     where status not in ('Success','Pending','Failed') group by status
 *   union all select 'verifications', status, count(*) from verifications
 *     where status not in ('Pending','Requested','In Progress','Verified','Rejected','Failed','Expired')
 *     group by status;
 *
 * It must return zero rows. If it does not, the offenders are real records and
 * the business must say what each should become — do NOT silently UPDATE them.
 *
 * ── NOT VALID, THEN A SEPARATE VALIDATE ─────────────────────────────────────
 *
 * Each constraint is added `NOT VALID` and validated in its own statement.
 * `ADD CONSTRAINT ... NOT VALID` takes ACCESS EXCLUSIVE only for the catalogue
 * write; the table scan happens under `VALIDATE CONSTRAINT`, which takes only
 * SHARE UPDATE EXCLUSIVE and does not block reads or writes. On `customers` and
 * `transactions` — the two tables that actually grow — that is the difference
 * between a lock held for milliseconds and one held for the length of a scan.
 *
 * It also means a deploy that hits an offender fails at a VALIDATE it can retry
 * after the data is fixed, with the constraint already in place stopping any
 * NEW offender, rather than aborting the whole migration.
 *
 * `drizzle-kit generate` emits the one-shot form for all nine. This file is
 * hand-written for that reason, as 0007-0013 were. See D-081.
 */

ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("users"."status" in ('Active', 'Inactive')) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" VALIDATE CONSTRAINT "users_status_check";--> statement-breakpoint

ALTER TABLE "banks" ADD CONSTRAINT "banks_status_check" CHECK ("banks"."status" in ('Active', 'Paused')) NOT VALID;--> statement-breakpoint
ALTER TABLE "banks" VALIDATE CONSTRAINT "banks_status_check";--> statement-breakpoint

ALTER TABLE "customers" ADD CONSTRAINT "customers_status_check" CHECK ("customers"."status" in ('Active', 'Follow Up', 'Closed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "customers" VALIDATE CONSTRAINT "customers_status_check";--> statement-breakpoint

ALTER TABLE "documents" ADD CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('Verified', 'Pending', 'Rejected')) NOT VALID;--> statement-breakpoint
ALTER TABLE "documents" VALIDATE CONSTRAINT "documents_status_check";--> statement-breakpoint

ALTER TABLE "funding_sources" ADD CONSTRAINT "funding_sources_status_check" CHECK ("funding_sources"."status" in ('Active', 'Inactive')) NOT VALID;--> statement-breakpoint
ALTER TABLE "funding_sources" VALIDATE CONSTRAINT "funding_sources_status_check";--> statement-breakpoint

ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_status_check" CHECK ("service_providers"."status" in ('Active', 'Inactive')) NOT VALID;--> statement-breakpoint
ALTER TABLE "service_providers" VALIDATE CONSTRAINT "service_providers_status_check";--> statement-breakpoint

ALTER TABLE "settlements" ADD CONSTRAINT "settlements_status_check" CHECK ("settlements"."status" in ('Paid', 'Pending', 'Disputed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "settlements" VALIDATE CONSTRAINT "settlements_status_check";--> statement-breakpoint

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_status_check" CHECK ("transactions"."status" in ('Success', 'Pending', 'Failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "transactions" VALIDATE CONSTRAINT "transactions_status_check";--> statement-breakpoint

ALTER TABLE "verifications" ADD CONSTRAINT "verifications_status_check" CHECK ("verifications"."status" in ('Pending', 'Requested', 'In Progress', 'Verified', 'Rejected', 'Failed', 'Expired')) NOT VALID;--> statement-breakpoint
ALTER TABLE "verifications" VALIDATE CONSTRAINT "verifications_status_check";
