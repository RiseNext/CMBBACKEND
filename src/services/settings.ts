import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/index.js";
import { appSettings } from "../db/schema/index.js";
import { env } from "../config/env.js";

/**
 * APPLICATION SETTINGS — the registry and its readers. Task 12.6.
 *
 * ── WHAT WAS HERE BEFORE ────────────────────────────────────────────────────
 *
 * `app_settings` has existed in the schema since the first migration and was
 * **completely dead**: zero references outside `db/schema/governance.ts`. The
 * settings screen's Company and Preferences tabs were uncontrolled inputs whose
 * contents were discarded on every keystroke, under the words "Printed on
 * invoices". Wave 1 removed them and named this row as their owner.
 *
 * ── A CLOSED REGISTRY, NOT AN ARBITRARY KEY/VALUE ENDPOINT ──────────────────
 *
 * `PATCH /api/settings` accepts only keys declared in `SETTINGS` below, each
 * with its own zod schema. The table's primary key is free text, so a route that
 * wrote whatever it was given would let anyone holding `settings.edit` create
 * unbounded rows, and would make it impossible for a reader to know what a value
 * is supposed to look like. An unknown key is a **400 naming the key**, not a
 * silent drop — a settings screen that reports success for a field the server
 * ignored is the exact defect D-004 forbids.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *
 * **Per-user preferences.** `app_settings` is keyed by `key` alone and has no
 * user column, so it structurally cannot hold "which alerts does *this person*
 * want". Storing them here would make one operator's choice everyone's. That
 * needs a `user_settings` table, which is a schema change this wave does not
 * make; the settings screen continues to say so rather than offering a control.
 *
 * **Invoice numbering.** Settlement invoice numbers come from the backend's own
 * `code_sequences` generator (Task 4.x, BUG-011). A prefix stored here would be
 * read by nothing, so the screen would claim it "applies to new settlement
 * invoices" when it applies to nothing.
 *
 * The organisation record IS stored and read back, and the screen says exactly
 * that — these are your registered details, held on the server. It does not
 * claim they are printed anywhere, because nothing prints them yet.
 *
 * `recycleBin.retentionDays` is the one setting with a live consumer: it feeds
 * `purgeDate()` in `services/recycle-bin.ts`, so changing it changes when
 * deleted records become purgeable. Absent, that falls back to
 * `RECYCLE_BIN_RETENTION_DAYS` and behaviour is exactly what it was.
 */

interface SettingDefinition {
  schema: z.ZodType<unknown>;
  /** Used when no row exists. Never written on read — a GET stays read-only. */
  fallback: () => unknown;
  description: string;
}

const text = (max: number) => z.string().trim().max(max);

export const SETTINGS = {
  "organisation.legalName": {
    schema: text(200),
    fallback: () => "",
    description: "Registered name of the organisation",
  },
  "organisation.gstin": {
    schema: text(20),
    fallback: () => "",
    description: "GSTIN",
  },
  "organisation.pan": {
    schema: text(20),
    fallback: () => "",
    description: "Organisation PAN",
  },
  "organisation.address": {
    schema: text(500),
    fallback: () => "",
    description: "Registered address",
  },
  "organisation.billingEmail": {
    // Not `z.email()`: an empty string is how the field is cleared, and a
    // required-format check would make "unset" unreachable once set.
    schema: text(255),
    fallback: () => "",
    description: "Billing contact email",
  },
  "organisation.billingPhone": {
    schema: text(20),
    fallback: () => "",
    description: "Billing contact phone",
  },
  "recycleBin.retentionDays": {
    schema: z.coerce.number().int().min(1).max(3650),
    fallback: () => env().RECYCLE_BIN_RETENTION_DAYS,
    description: "Days a deleted record stays restorable before it can be purged",
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const isSettingKey = (key: string): key is SettingKey => key in SETTINGS;

/**
 * Every setting's current value, defaults filled in for keys with no row.
 *
 * Takes a handle rather than calling `getDb()` so a caller already inside a
 * transaction passes its own `tx`. On the single-connection test driver a read
 * through the base handle from inside a transaction deadlocks (Task 2.11).
 */
export async function readSettings(db: Database): Promise<Record<SettingKey, unknown>> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, SETTING_KEYS));

  const stored = new Map(rows.map((row) => [row.key, row.value]));
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [
      key,
      stored.has(key) ? stored.get(key) : SETTINGS[key].fallback(),
    ]),
  ) as Record<SettingKey, unknown>;
}

/** One setting, validated, falling back when absent or unparseable. */
export async function readSetting<K extends SettingKey>(db: Database, key: K): Promise<unknown> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, [key]))
    .limit(1);
  if (!row) return SETTINGS[key].fallback();
  const parsed = SETTINGS[key].schema.safeParse(row.value);
  /*
   * A stored value that no longer satisfies its schema — because the schema was
   * tightened after the row was written — falls back rather than propagating.
   * The alternative is that one bad row breaks every soft delete in the system.
   */
  return parsed.success ? parsed.data : SETTINGS[key].fallback();
}
