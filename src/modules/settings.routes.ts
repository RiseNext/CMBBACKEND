import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { appSettings } from "../db/schema/index.js";
import { badRequest, unprocessable } from "../lib/errors.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";
import {
  isSettingKey,
  readSettings,
  SETTINGS,
  SETTING_KEYS,
  type SettingKey,
} from "../services/settings.js";

/**
 * THE SETTINGS ROUTES — Task 12.6.
 *
 * The registry these read and write lives in `services/settings.ts`, because
 * `services/recycle-bin.ts` consumes one of the settings and a service must not
 * depend on a routes module.
 */

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", requirePermission(PERMISSIONS.settings.view), async (_req, res, next) => {
  try {
    res.json({
      data: await readSettings(getDb()),
      meta: {
        keys: SETTING_KEYS.map((key) => ({ key, description: SETTINGS[key].description })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/settings — U-14 / OD-8: `settings.edit`, held by Super Admin and
 * Admin.
 *
 * The whole submitted object is validated before anything is written, and the
 * writes share one transaction, so a body with one bad field changes nothing at
 * all. A partial save reported as a success is the failure mode this shape
 * exists to prevent.
 *
 * The response is the SERVER's resulting state for every key, read back after
 * the write — not the request echoed. D-026: the client adopts the server row.
 */
settingsRouter.patch("/", requirePermission(PERMISSIONS.settings.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const body = z.record(z.string(), z.unknown()).parse(req.body ?? {});

    const unknownKeys = Object.keys(body).filter((key) => !isSettingKey(key));
    if (unknownKeys.length > 0) {
      throw badRequest(`Unknown setting(s): ${unknownKeys.slice(0, 5).join(", ")}`);
    }

    const updates: { key: SettingKey; value: unknown }[] = [];
    const issues: { path: string; message: string }[] = [];
    for (const [key, raw] of Object.entries(body)) {
      if (!isSettingKey(key)) continue;
      const parsed = SETTINGS[key].schema.safeParse(raw);
      if (!parsed.success) {
        issues.push({ path: key, message: parsed.error.issues[0]?.message ?? "Invalid value" });
        continue;
      }
      updates.push({ key, value: parsed.data });
    }

    // 422 with `details[].path`, so the screen can put each message under the
    // field it names (D-031) rather than showing one generic line.
    if (issues.length > 0) throw unprocessable("One or more settings are invalid", issues);

    const db = getDb();
    if (updates.length > 0) {
      const before = await readSettings(db);
      await db.transaction(async (tx) => {
        for (const { key, value } of updates) {
          await tx
            .insert(appSettings)
            .values({
              key,
              value: value as never,
              description: SETTINGS[key].description,
              updatedBy: ctx.userId,
            })
            .onConflictDoUpdate({
              target: appSettings.key,
              set: { value: value as never, updatedAt: new Date(), updatedBy: ctx.userId },
            });
        }

        const changes = Object.fromEntries(
          updates
            .filter(({ key, value }) => JSON.stringify(before[key]) !== JSON.stringify(value))
            .map(({ key, value }) => [key, { from: before[key], to: value }]),
        );
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx as never, ctx, req, {
            action: "updated",
            recordType: "setting",
            recordId: null,
            summary: `Updated ${Object.keys(changes).length} setting(s)`,
            changes,
          });
        }
      });
    }

    res.json({ data: await readSettings(db) });
  } catch (error) {
    next(error);
  }
});
