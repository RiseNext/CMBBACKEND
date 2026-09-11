import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/** `banks.status`. Paused stops new files being logged against the lender. */
export const bankStatuses = ["Active", "Paused"] as const;
/** `customers.status`. Mirrors the zod enum on the customers routes. */
export const customerStatuses = ["Active", "Follow Up", "Closed"] as const;
import { teams, users } from "./identity.js";
/**
 * BANKS — maps 1:1 to the frontend `Bank` interface, plus a human-readable
 * `code` (the existing BNK-01 style identifier) kept as a stable display key.
 */
export const banks = pgTable(
  "banks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    vendorId: text("vendor_id"),
    portalUrl: text("portal_url"),
    logoText: text("logo_text"),
    accentColor: text("accent_color"),
    status: text("status").notNull().default("Active"),
    commissionRate: numeric("commission_rate", { precision: 6, scale: 3 }).notNull().default("0"),
    settlementCycle: text("settlement_cycle"),
    spocName: text("spoc_name"),
    spocPhone: text("spoc_phone"),
    productsOffered: text("products_offered").array().notNull().default(sql`'{}'::text[]`),
    onboardedOn: timestamp("onboarded_on", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("banks_code_unique")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index("banks_status_idx").on(t.status),
    index("banks_deleted_at_idx").on(t.deletedAt),
    /*
     * VOCABULARY ONLY — Task 13.13, D-010, D-057. Migration `0014`.
     *
     * A CHECK sees one candidate row and nothing else, so it constrains WHICH
     * values may exist and says nothing about legal transitions or about who
     * may make them. Both stay in the service layer. No trigger.
     */
    check(
      "banks_status_check",
      sql`${t.status} in (${sql.raw(bankStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);
/**
 * USER <-> BANK ACCESS (many-to-many).
 *
 * This is the spine of tenant isolation. Every scoped query filters on the set
 * of bank ids returned by `resolveBankScope()`. A user holding the
 * `system.access_all_banks` permission bypasses the filter; everyone else is
 * restricted to the rows below, enforced in the data layer — never in the UI.
 */
export const userBankAccess = pgTable(
  "user_bank_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid("assigned_by"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bankId] }),
    index("user_bank_access_bank_idx").on(t.bankId),
  ],
);
/**
 * CUSTOMERS — preserves every field on the frontend `Customer` interface so the
 * existing customer table + detail screens bind without redesign.
 *
 * Two deliberate deviations, both flagged in the README:
 *  1. `bankReferenceId` is added and REQUIRED. Unique per (bank_id, reference).
 *  2. Aadhaar is NOT stored in the clear. We keep a peppered SHA-256 hash for
 *     duplicate detection plus the last 4 digits for display. Under the Aadhaar
 *     Act s.29 and the DPDP Act 2023, storing full Aadhaar numbers in an
 *     application database carries obligations this system is not built to meet.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id, { onDelete: "restrict" }),
    bankReferenceId: text("bank_reference_id").notNull(),
    name: text("name").notNull(),
    fatherName: text("father_name"),
    motherName: text("mother_name"),
    dob: timestamp("dob", { withTimezone: true }),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    occupation: text("occupation"),
    monthlyIncome: numeric("monthly_income", { precision: 14, scale: 2 }).notNull().default("0"),
    mobile: text("mobile").notNull(),
    altMobile: text("alt_mobile"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),
    pan: text("pan"),
    aadhaarLast4: text("aadhaar_last4"),
    aadhaarHash: text("aadhaar_hash"),
    kyc: text("kyc").notNull().default("Pending"),
    cibil: integer("cibil"),
    accountNo: text("account_no"),
    ifsc: text("ifsc"),
    branch: text("branch"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    assignedTeamId: uuid("assigned_team_id").references(() => teams.id, { onDelete: "set null" }),
    status: text("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    /**
     * THE constraint from the brief:
     *   Bank A + REF001  -> allowed
     *   Bank B + REF001  -> allowed
     *   Bank A + REF001  -> rejected
     * Scoped to live rows so a restored-from-bin record does not permanently
     * poison the reference id.
     */
    uniqueIndex("customers_bank_reference_unique")
      .on(t.bankId, sql`upper(${t.bankReferenceId})`)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("customers_code_unique")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index("customers_bank_idx").on(t.bankId),
    index("customers_assigned_user_idx").on(t.assignedUserId),
    index("customers_assigned_team_idx").on(t.assignedTeamId),
    index("customers_status_idx").on(t.status),
    index("customers_mobile_idx").on(t.mobile),
    index("customers_deleted_at_idx").on(t.deletedAt),
    /*
     * VOCABULARY ONLY — Task 13.13, D-010, D-057. Migration `0014`.
     *
     * A CHECK sees one candidate row and nothing else, so it constrains WHICH
     * values may exist and says nothing about legal transitions or about who
     * may make them. Both stay in the service layer. No trigger.
     */
    check(
      "customers_status_check",
      sql`${t.status} in (${sql.raw(customerStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);
/**
 * ORGANISATIONAL GEOGRAPHY — Region ▸ Area ▸ Branch. Task MM-1, D-095.
 *
 * The manager's Transfer sheet has `REGION NAME`, `AREA NAME` and `BRANCH`
 * columns, and the APTS and Payment sheets have `Branch Name`. Nothing in the
 * schema could carry any of them: `customers.branch` sits beside `account_no`
 * and `ifsc` and is the customer's own *bank-account* branch, `users.branch` is
 * an employee's posting, and both are unvalidated free text with no master
 * list. Grouping a manager report by either would group by whatever anyone
 * typed. **Neither column is touched by this work and both keep working
 * exactly as before.**
 *
 * Three tables rather than three text columns on `loans`, because the manager's
 * own sheet proves the hierarchy: `AREA NAME = HYDERABAD` with
 * `BRANCH = OMKAR NAGAR`, and the APTS sheet lists Uppal, LB NAGAR and
 * Kompally under the same area. A branch names its area once; an area names its
 * region once. Denormalising all three onto every loan would let one file say
 * Uppal is in Hyderabad and the next say it is not.
 *
 * `status` rather than a delete route: master data is deactivated, never
 * removed, so a historical file keeps resolving the branch it was booked at.
 * The soft-delete columns are present for shape uniformity only — these tables
 * are deliberately absent from `softDeletableTables` below, so nothing offers a
 * delete and nothing reaches the recycle bin.
 */
export const locationStatuses = ["Active", "Inactive"] as const;

export const regions = pgTable(
  "regions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: text("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("regions_name_unique")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("regions_status_idx").on(t.status),
    /*
     * VOCABULARY ONLY — D-010, D-057. The name ends `_status_check` because
     * `middleware/error-handler.ts` matches `/_(status|stage)_check$/` to turn a
     * 23514 into a 422; any other name falls through to a 500 with a stack
     * trace (`check-violation-mapping.test.ts` pins the suffix, not the words).
     */
    check(
      "regions_status_check",
      sql`${t.status} in (${sql.raw(locationStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

export const areas = pgTable(
  "areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    // Unique WITHIN a region — two regions may both run a "Central" area.
    uniqueIndex("areas_region_name_unique")
      .on(t.regionId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("areas_region_idx").on(t.regionId),
    check(
      "areas_status_check",
      sql`${t.status} in (${sql.raw(locationStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id, { onDelete: "restrict" }),
    /**
     * The lender whose branch this is. NULLABLE on purpose: the manager's sheets
     * name branches (Uppal, LB NAGAR) without always naming the lender, and a
     * required column would block recording one.
     *
     * It is therefore **never fed to `bankScope`** — that helper filters with
     * `inArray`, which never matches NULL, so every branch with a null lender
     * would become invisible to every scoped user (the D-084 defect). The
     * maintenance projections scope on the *operational* row's `bank_id`
     * instead, which is NOT NULL on `loans` and `disbursements`.
     */
    bankId: uuid("bank_id").references(() => banks.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("branches_area_name_unique")
      .on(t.areaId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("branches_area_idx").on(t.areaId),
    index("branches_bank_idx").on(t.bankId),
    check(
      "branches_status_check",
      sql`${t.status} in (${sql.raw(locationStatuses.map((v) => `'${v}'`).join(", "))})`,
    ),
  ],
);

export const regionsRelations = relations(regions, ({ many }) => ({
  areas: many(areas),
}));
export const areasRelations = relations(areas, ({ one, many }) => ({
  region: one(regions, { fields: [areas.regionId], references: [regions.id] }),
  branches: many(branches),
}));
export const branchesRelations = relations(branches, ({ one }) => ({
  area: one(areas, { fields: [branches.areaId], references: [areas.id] }),
  bank: one(banks, { fields: [branches.bankId], references: [banks.id] }),
}));

export const banksRelations = relations(banks, ({ many }) => ({
  customers: many(customers),
  userAccess: many(userBankAccess),
}));
export const userBankAccessRelations = relations(userBankAccess, ({ one }) => ({
  user: one(users, { fields: [userBankAccess.userId], references: [users.id] }),
  bank: one(banks, { fields: [userBankAccess.bankId], references: [banks.id] }),
}));
export const customersRelations = relations(customers, ({ one }) => ({
  bank: one(banks, { fields: [customers.bankId], references: [banks.id] }),
  assignedUser: one(users, { fields: [customers.assignedUserId], references: [users.id] }),
  assignedTeam: one(teams, { fields: [customers.assignedTeamId], references: [teams.id] }),
}));
/** Re-exported so the recycle-bin service can validate table names. */
export const softDeletableTables = {
  banks,
  customers,
} as const;
/*
 * `bankStatuses` and `customerStatuses` MOVED to the top of this file in Task
 * 13.13. Their CHECK constraints read them during `pgTable(...)` evaluation,
 * and a const declared here is still in the temporal dead zone at that point —
 * the same trap `operations.ts` documents for `bankOrderStages`. The values are
 * unchanged.
 */
export const kycStatuses = ["Verified", "Pending", "Rejected"] as const;
export const isBankActive = (status: string): boolean => status === "Active";
export const _softDeleteColumnsPresent: boolean = Boolean(banks.deletedAt && customers.deletedAt);
