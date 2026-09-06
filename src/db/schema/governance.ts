import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";

/**
 * AUDIT LOG — append-only.
 *
 * Immutability is enforced in the database itself by a BEFORE UPDATE OR DELETE
 * trigger (see drizzle/9999_governance_guards.sql), not by application code.
 * Revoking privileges was rejected because Neon's role model varies by plan;
 * a trigger holds regardless of which role the app connects as.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    actorRoleKey: text("actor_role_key"),

    action: text("action").notNull(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id"),
    bankId: uuid("bank_id"),

    summary: text("summary"),
    changes: jsonb("changes"),
    metadata: jsonb("metadata"),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
  },
  (t) => [
    index("audit_logs_record_idx").on(t.recordType, t.recordId),
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_occurred_idx").on(t.occurredAt),
    index("audit_logs_bank_idx").on(t.bankId),
    index("audit_logs_action_idx").on(t.action),
  ],
);

/**
 * RECYCLE BIN INDEX
 *
 * The rows themselves stay in their own tables with `deleted_at` set. This
 * table is a cross-type index so the Bin screen can page through everything
 * without a UNION over a dozen tables, and so restore/purge can be audited.
 */
export const recycleBinEntries = pgTable(
  "recycle_bin_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    bankId: uuid("bank_id"),
    label: text("label").notNull(),
    snapshot: jsonb("snapshot"),

    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),

    restoredAt: timestamp("restored_at", { withTimezone: true }),
    restoredBy: uuid("restored_by").references(() => users.id, { onDelete: "set null" }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    purgedBy: uuid("purged_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("recycle_bin_active_unique")
      .on(t.recordType, t.recordId)
      .where(sql`restored_at is null and purged_at is null`),
    index("recycle_bin_purge_after_idx").on(t.purgeAfter),
    index("recycle_bin_bank_idx").on(t.bankId),
    index("recycle_bin_type_idx").on(t.recordType),
  ],
);

/**
 * SETTINGS — key/value application configuration editable by Super Admin
 * (recycle bin retention, import limits, feature switches).
 */
export const appSettings = pgTable(
  "app_settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    description: text("description"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("app_settings_updated_idx").on(t.updatedAt)],
);

/**
 * EXCEL IMPORT STAGING
 * Upload -> validate -> preview -> confirm -> import.
 * Rows are staged and validated first; nothing touches the live tables until
 * the batch is explicitly confirmed, and only rows with status 'valid' insert.
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importType: text("import_type").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull().default(0),
    bankId: uuid("bank_id"),

    status: text("status").notNull().default("validating"),

    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),

    errorSummary: jsonb("error_summary"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("import_batches_creator_idx").on(t.createdBy),
    index("import_batches_status_idx").on(t.status),
    index("import_batches_expires_idx").on(t.expiresAt),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").notNull(),
    normalised: jsonb("normalised"),
    status: text("status").notNull(),
    errors: jsonb("errors"),
    createdRecordId: uuid("created_record_id"),
  },
  (t) => [
    uniqueIndex("import_rows_batch_row_unique").on(t.batchId, t.rowNumber),
    index("import_rows_status_idx").on(t.batchId, t.status),
  ],
);

export const auditActions = [
  "created",
  "updated",
  "assigned",
  "approved",
  "disbursed",
  "settled",
  "deleted",
  "restored",
  "permanently_deleted",
  "login_succeeded",
  "login_failed",
  "logout",
  "password_changed",
  "permission_denied",
  "imported",
] as const;

export type AuditAction = (typeof auditActions)[number];

export const importStatuses = ["validating", "previewed", "importing", "imported", "failed", "expired"] as const;
export const importRowStatuses = ["valid", "invalid", "duplicate", "imported", "skipped"] as const;
