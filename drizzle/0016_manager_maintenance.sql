/*
 * 0016 — MANAGER MAINTENANCE. Task MM-1, DECISIONS.md D-095.
 *
 * Adds the organisational geography the manager's tracking sheets are grouped
 * by, the FVR checklist findings, and one manager-maintained receipt flag.
 *
 * ADDITIVE ONLY. Three new tables, sixteen new columns, every one of them
 * NULLABLE with no default and no backfill. Nothing is dropped, nothing is
 * renamed, no existing column changes type or nullability, and no data is
 * rewritten. There are no down-migrations in this repository (D-090), so the
 * rule is that the PREVIOUS application version must keep working against this
 * schema — it does, because it never reads or writes any of the below.
 *
 * A migration never invents data (D-084). Nothing here backfills: a branch, a
 * BT lead id or a house confirmation that was not recorded stays NULL, which is
 * what the manager's own part-filled sheets show.
 *
 * WHY THE CHECKS ARE "NOT VALID" THEN "VALIDATE".
 *
 * Every checked column is CREATED BY THIS SAME MIGRATION, so every existing row
 * holds NULL and every predicate below admits NULL explicitly. The offender set
 * is provably empty and the pre-flight query beneath each one will return zero
 * rows on any database. The two-step form is used regardless, for the reasons
 * 0014 and 0015 give: ADD CONSTRAINT ... CHECK in one shot takes ACCESS
 * EXCLUSIVE for a full scan, whereas NOT VALID takes it only briefly and
 * VALIDATE CONSTRAINT runs under SHARE UPDATE EXCLUSIVE. It also splits the
 * work so that the guard stops new offenders from the first statement, and the
 * scan is a separate RETRYABLE step.
 *
 * Note the pre-flight queries carry no deleted_at filter, deliberately and for
 * the reason 0014 records: a CHECK has no WHERE clause, so a soft-deleted
 * offender fails VALIDATE exactly as a live one does.
 *
 * CONSTRAINT NAMING. Every CHECK below ends "_status_check" so that
 * middleware/error-handler.ts turns a 23514 into a 422 rather than letting it
 * fall through to a 500 with a stack trace. That handler matches on the SUFFIX
 * and check-violation-mapping.test.ts pins that a name merely containing the
 * word does not qualify.
 *
 * NO TRIGGERS ARE ADDED. The count stays at 7 (D-057). These CHECKs are
 * vocabulary only; they constrain WHICH values may exist and say nothing about
 * transitions, which is correct because none of these columns has a transition.
 */

CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone,
	CONSTRAINT "regions_status_check" CHECK ("regions"."status" in ('Active', 'Inactive'))
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone,
	CONSTRAINT "areas_status_check" CHECK ("areas"."status" in ('Active', 'Inactive'))
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"bank_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone,
	CONSTRAINT "branches_status_check" CHECK ("branches"."status" in ('Active', 'Inactive'))
);
--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "payment_status" text;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "bt_lead_id" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "fvr_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "takeover_from_lender" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "fvr_done_by_name" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "fvr_done_by_designation" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "house_confirmation" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "annual_income" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "chola_relationship" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "chola_outstanding_details" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "new_kyc_customer" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "zensify_rm_signature" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "sharvika_rm_signature" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "chola_sign" text;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_region_name_unique" ON "areas" USING btree ("region_id",lower("name")) WHERE "areas"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "areas_region_idx" ON "areas" USING btree ("region_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_area_name_unique" ON "branches" USING btree ("area_id",lower("name")) WHERE "branches"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "branches_area_idx" ON "branches" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "branches_bank_idx" ON "branches" USING btree ("bank_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_name_unique" ON "regions" USING btree (lower("name")) WHERE "regions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "regions_status_idx" ON "regions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loans_branch_idx" ON "loans" USING btree ("branch_id");--> statement-breakpoint

-- Pre-flight, expected to return 0 on any database because payment_status was
-- created by this migration and therefore holds NULL in every existing row:
--   SELECT count(*) FROM disbursements
--    WHERE payment_status IS NOT NULL
--      AND payment_status NOT IN ('Received', 'Not Received');
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_payment_status_check" CHECK ("disbursements"."payment_status" is null or "disbursements"."payment_status" in ('Received', 'Not Received')) NOT VALID;--> statement-breakpoint
ALTER TABLE "disbursements" VALIDATE CONSTRAINT "disbursements_payment_status_check";--> statement-breakpoint

-- Pre-flight, expected to return 0 for the same reason:
--   SELECT count(*) FROM verifications
--    WHERE house_confirmation IS NOT NULL
--      AND house_confirmation NOT IN ('Owned', 'Rented');
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_house_confirmation_status_check" CHECK ("verifications"."house_confirmation" is null or "verifications"."house_confirmation" in ('Owned', 'Rented')) NOT VALID;--> statement-breakpoint
ALTER TABLE "verifications" VALIDATE CONSTRAINT "verifications_house_confirmation_status_check";--> statement-breakpoint

-- Pre-flight, expected to return 0 for the same reason:
--   SELECT count(*) FROM verifications
--    WHERE chola_relationship IS NOT NULL
--      AND chola_relationship NOT IN ('Yes', 'No');
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_chola_relationship_status_check" CHECK ("verifications"."chola_relationship" is null or "verifications"."chola_relationship" in ('Yes', 'No')) NOT VALID;--> statement-breakpoint
ALTER TABLE "verifications" VALIDATE CONSTRAINT "verifications_chola_relationship_status_check";--> statement-breakpoint

-- Pre-flight, expected to return 0 for the same reason:
--   SELECT count(*) FROM verifications
--    WHERE new_kyc_customer IS NOT NULL
--      AND new_kyc_customer NOT IN ('Yes', 'No');
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_new_kyc_customer_status_check" CHECK ("verifications"."new_kyc_customer" is null or "verifications"."new_kyc_customer" in ('Yes', 'No')) NOT VALID;--> statement-breakpoint
ALTER TABLE "verifications" VALIDATE CONSTRAINT "verifications_new_kyc_customer_status_check";
