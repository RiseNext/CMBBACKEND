import { Router } from "express";
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { banks } from "../db/schema/index.js";
import { notFound } from "../lib/errors.js";
import { patchSchema } from "../lib/zod.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";
import { softDelete } from "../services/recycle-bin.js";

export const banksRouter = Router();
banksRouter.use(requireAuth);

const bankInput = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(160),
  shortName: z.string().trim().min(1).max(60),
  vendorId: z.string().trim().max(80).optional().nullable(),
  portalUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal("")),
  logoText: z.string().trim().max(6).optional().nullable(),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  status: z.enum(["Active", "Paused"]).default("Active"),
  commissionRate: z.coerce.number().min(0).max(100).default(0),
  settlementCycle: z.string().trim().max(80).optional().nullable(),
  spocName: z.string().trim().max(120).optional().nullable(),
  spocPhone: z.string().trim().max(20).optional().nullable(),
  productsOffered: z.array(z.string().trim().min(1)).default([]),
  onboardedOn: z.coerce.date().optional().nullable(),
});

banksRouter.get("/", requirePermission(PERMISSIONS.banks.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const filters: SQL[] = [isNull(banks.deletedAt)];
    const scope = bankScope(ctx, banks.id);
    if (scope) filters.push(scope);

    const rows = await getDb()
      .select()
      .from(banks)
      .where(and(...filters))
      .orderBy(asc(banks.name));

    res.json({ data: rows, meta: { count: rows.length, scoped: ctx.bankIds !== null } });
  } catch (error) {
    next(error);
  }
});

banksRouter.get("/:id", requirePermission(PERMISSIONS.banks.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    // Scope is asserted BEFORE the read, so a guessed id cannot even confirm
    // that the record exists.
    const id = req.params.id as string;
    assertBankAccess(ctx, id);

    const [row] = await getDb()
      .select()
      .from(banks)
      .where(and(eq(banks.id, id), isNull(banks.deletedAt)))
      .limit(1);

    if (!row) throw notFound("Bank not found");
    res.json({ data: row });
  } catch (error) {
    next(error);
  }
});

banksRouter.post("/", requirePermission(PERMISSIONS.banks.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = bankInput.parse(req.body);
    const db = getDb();

    const [created] = await db
      .insert(banks)
      .values({
        ...input,
        portalUrl: input.portalUrl || null,
        commissionRate: String(input.commissionRate),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "bank",
      recordId: created?.id,
      bankId: created?.id,
      summary: `Created bank ${created?.name}`,
    });

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

banksRouter.patch("/:id", requirePermission(PERMISSIONS.banks.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    assertBankAccess(ctx, id);
    // patchSchema, not .partial(): `status`, `commissionRate` and
    // `productsOffered` carry defaults, and `...input` is spread wholesale —
    // a pause would otherwise zero the rate and empty the product list (BUG-036).
    const { commissionRate, ...input } = patchSchema(bankInput).parse(req.body);
    const db = getDb();

    const [before] = await db
      .select()
      .from(banks)
      .where(and(eq(banks.id, id), isNull(banks.deletedAt)))
      .limit(1);
    if (!before) throw notFound("Bank not found");

    const [after] = await db
      .update(banks)
      .set({
        ...input,
        ...(commissionRate !== undefined ? { commissionRate: String(commissionRate) } : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(banks.id, id))
      .returning();

    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "bank",
      recordId: id,
      bankId: id,
      summary: `Updated bank ${after?.name}`,
      changes: diff(before as Record<string, unknown>, after as Record<string, unknown>),
    });

    res.json({ data: after });
  } catch (error) {
    next(error);
  }
});

banksRouter.delete("/:id", requirePermission(PERMISSIONS.banks.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    assertBankAccess(ctx, id);
    await softDelete(getDb(), ctx, req, "bank", id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
