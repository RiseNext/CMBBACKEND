CREATE TABLE "assignment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"bank_id" uuid,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"from_team_id" uuid,
	"to_team_id" uuid,
	"reason" text,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"loan_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"submitted_on" timestamp with time zone,
	"sla" timestamp with time zone,
	"stage" text DEFAULT 'Login' NOT NULL,
	"status" text DEFAULT 'In Progress' NOT NULL,
	"officer" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"loan_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"funding_source_id" uuid,
	"amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"utr" text,
	"mode" text DEFAULT 'NEFT' NOT NULL,
	"disbursed_on" timestamp with time zone,
	"status" text DEFAULT 'In Transit' NOT NULL,
	"credited_to" text,
	"assigned_user_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"loan_id" uuid,
	"bank_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"mime_type" text,
	"storage_key" text,
	"checksum" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"uploaded_by" uuid,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "funding_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source_type" text DEFAULT 'own_funds' NOT NULL,
	"bank_id" uuid,
	"account_ref" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"entry_date" timestamp with time zone DEFAULT now() NOT NULL,
	"voucher_no" text,
	"particulars" text NOT NULL,
	"party" text,
	"category" text NOT NULL,
	"bank_id" uuid,
	"transaction_id" uuid,
	"debit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"mode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"application_no" text,
	"customer_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"loan_type" text NOT NULL,
	"amount_requested" numeric(16, 2) DEFAULT '0' NOT NULL,
	"amount_approved" numeric(16, 2) DEFAULT '0' NOT NULL,
	"interest_rate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"tenure_months" integer DEFAULT 0 NOT NULL,
	"emi" numeric(16, 2) DEFAULT '0' NOT NULL,
	"processing_fee" numeric(16, 2) DEFAULT '0' NOT NULL,
	"commission" numeric(16, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"applied_on" timestamp with time zone,
	"verification_required" boolean DEFAULT false NOT NULL,
	"funding_source_id" uuid,
	"assigned_user_id" uuid,
	"assigned_team_id" uuid,
	"priority" text DEFAULT 'Normal' NOT NULL,
	"due_date" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"link_href" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider_type" text DEFAULT 'Field Verification' NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"bank_id" uuid NOT NULL,
	"period" text NOT NULL,
	"cases" integer DEFAULT 0 NOT NULL,
	"gross_commission" numeric(16, 2) DEFAULT '0' NOT NULL,
	"tds" numeric(16, 2) DEFAULT '0' NOT NULL,
	"net_payable" numeric(16, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"invoice_no" text,
	"raised_on" timestamp with time zone,
	"settled_on" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"customer_id" uuid,
	"bank_id" uuid NOT NULL,
	"loan_id" uuid,
	"disbursement_id" uuid,
	"settlement_id" uuid,
	"funding_source_id" uuid,
	"amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"commission" numeric(16, 2) DEFAULT '0' NOT NULL,
	"txn_type" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"reference" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"customer_id" uuid,
	"bank_id" uuid NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"handled_by_bank" boolean DEFAULT false NOT NULL,
	"service_provider_id" uuid,
	"provider_reference" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"result" text,
	"requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_from_team_id_teams_id_fk" FOREIGN KEY ("from_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_to_team_id_teams_id_fk" FOREIGN KEY ("to_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_orders" ADD CONSTRAINT "bank_orders_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_orders" ADD CONSTRAINT "bank_orders_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_orders" ADD CONSTRAINT "bank_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_sources" ADD CONSTRAINT "funding_sources_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_assigned_team_id_teams_id_fk" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_disbursement_id_disbursements_id_fk" FOREIGN KEY ("disbursement_id") REFERENCES "public"."disbursements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_service_provider_id_service_providers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."service_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_history_record_idx" ON "assignment_history" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE INDEX "assignment_history_to_user_idx" ON "assignment_history" USING btree ("to_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_orders_code_unique" ON "bank_orders" USING btree ("code") WHERE "bank_orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "bank_orders_loan_idx" ON "bank_orders" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "bank_orders_bank_idx" ON "bank_orders" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "bank_orders_status_idx" ON "bank_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bank_orders_sla_idx" ON "bank_orders" USING btree ("sla");--> statement-breakpoint
CREATE UNIQUE INDEX "disbursements_code_unique" ON "disbursements" USING btree ("code") WHERE "disbursements"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "disbursements_utr_unique" ON "disbursements" USING btree (upper("utr")) WHERE "disbursements"."deleted_at" is null and "disbursements"."utr" is not null;--> statement-breakpoint
CREATE INDEX "disbursements_loan_idx" ON "disbursements" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "disbursements_bank_idx" ON "disbursements" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "disbursements_status_idx" ON "disbursements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_customer_idx" ON "documents" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "documents_loan_idx" ON "documents" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "documents_bank_idx" ON "documents" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_sources_name_unique" ON "funding_sources" USING btree (lower("name")) WHERE "funding_sources"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "funding_sources_bank_idx" ON "funding_sources" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "funding_sources_deleted_idx" ON "funding_sources" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_code_unique" ON "ledger_entries" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ledger_entries_date_idx" ON "ledger_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "ledger_entries_category_idx" ON "ledger_entries" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ledger_entries_bank_idx" ON "ledger_entries" USING btree ("bank_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loans_code_unique" ON "loans" USING btree ("code") WHERE "loans"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "loans_customer_idx" ON "loans" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "loans_bank_idx" ON "loans" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "loans_status_idx" ON "loans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "loans_assigned_user_idx" ON "loans" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "loans_assigned_team_idx" ON "loans" USING btree ("assigned_team_id");--> statement-breakpoint
CREATE INDEX "loans_due_date_idx" ON "loans" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "loans_deleted_idx" ON "loans" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE UNIQUE INDEX "service_providers_name_unique" ON "service_providers" USING btree (lower("name")) WHERE "service_providers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "service_providers_status_idx" ON "service_providers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_providers_deleted_idx" ON "service_providers" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_code_unique" ON "settlements" USING btree ("code") WHERE "settlements"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_bank_period_unique" ON "settlements" USING btree ("bank_id",lower("period")) WHERE "settlements"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "settlements_status_idx" ON "settlements" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_code_unique" ON "transactions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "transactions_customer_idx" ON "transactions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "transactions_bank_idx" ON "transactions" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "transactions_loan_idx" ON "transactions" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transactions_occurred_idx" ON "transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_loan_unique" ON "verifications" USING btree ("loan_id") WHERE "verifications"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "verifications_bank_idx" ON "verifications" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "verifications_status_idx" ON "verifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verifications_provider_idx" ON "verifications" USING btree ("service_provider_id");