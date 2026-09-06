/*
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIRED DOCUMENT TYPES — Task 9.11, DECISIONS.md D-076
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * One new table. Purely additive: no column is altered, no row is touched, and
 * nothing that exists today depends on it.
 *
 * (Note for future editors: Postgres block comments NEST. A literal slash-star
 * anywhere in this header opens a second comment whose terminator closes only
 * the inner one, swallowing the statements below.)
 *
 * ── WHY THIS TABLE DID NOT EXIST ────────────────────────────────────────────
 *
 * D-057 deferred the loan machine's "all required documents Verified" guard
 * with a precise reason: "there is no `required document types` table among the
 * 27. The guard has nothing to read." That was correct — the five document
 * types the product knows about were a hardcoded array in the UI
 * (`documents/page.tsx`), invisible to the backend.
 *
 * Phase 9's third DoD box — "A KYC pack can be assembled and produced from the
 * system" — had **no owning task** at all until Wave 0. The phrase "KYC pack"
 * appears exactly ONCE in this repository: in that DoD line. There is no PRD
 * requirement, no business-flow definition and no data model behind it.
 *
 * So D-076 records engineering's minimum honest reading rather than inventing
 * product: required types (this table), per-customer completeness, and a
 * manifest of Verified documents. Explicitly NOT a generated PDF (D-055 refused
 * to build a document-generation backend and nothing has authorised one since)
 * and NOT a ZIP archive (a new production dependency, which D-006 gates).
 *
 * ── bank_id IS NULLABLE, AND THAT IS THE DESIGN ─────────────────────────────
 *
 * A NULL `bank_id` is the DEFAULT requirement set, applying to every bank. A
 * row naming a bank overrides it for that bank. Partner banks genuinely differ
 * on what they will accept for the same product, and modelling that as "one
 * global list" would have been wrong within a month.
 *
 * The unique index is therefore on `(bank_id, doc_type)` and partial on
 * `deleted_at is null`, so a soft-deleted requirement does not block re-adding
 * the same type later.
 *
 * Note this is NOT the nullable-bank case OPEN-7 concerns. That decision is
 * about `ledger_entries`, where a null bank hides a financial row from every
 * scoped user because `bankScope` uses `inArray`. Here the null is read as
 * "applies to all" by an explicit `is null or bank_id = $1` predicate, never
 * pushed through `bankScope`.
 *
 * ── SEEDING ─────────────────────────────────────────────────────────────────
 *
 * This migration seeds nothing. The five types the UI hardcodes are inserted by
 * `db/seed.ts` as default (NULL-bank) rows, so a fresh database is usable and
 * an existing one is not silently given requirements nobody agreed to. An empty
 * table means "no requirements configured", which the completeness endpoint
 * reports honestly rather than treating as "complete".
 *
 * ── PRE-FLIGHT ──────────────────────────────────────────────────────────────
 *
 * None required. CREATE TABLE on a name that does not exist cannot fail on
 * data, and `select to_regclass('public.required_document_types')` returning
 * NULL beforehand is the only check worth making.
 */
CREATE TABLE "required_document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid,
	"doc_type" text NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "required_document_types" ADD CONSTRAINT "required_document_types_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "required_document_types_unique" ON "required_document_types" USING btree ("bank_id","doc_type") WHERE "required_document_types"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "required_document_types_bank_idx" ON "required_document_types" USING btree ("bank_id");
