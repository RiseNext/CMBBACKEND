import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./index.js";
import { getDb, closeDb } from "./index.js";
import {
  permissions,
  requiredDocumentTypes,
  rolePermissions,
  roles,
  users,
} from "./schema/index.js";
import { ALL_PERMISSIONS, DEFAULT_ROLES, SUPER_ADMIN_ROLE_KEY } from "../lib/permissions.js";
import { hashPassword, passwordProblems } from "../lib/password.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Seeds ONLY the permission catalogue, the default roles and (optionally) the
 * first Super Admin.
 *
 * It deliberately seeds no banks, customers, loans or transactions. The brief
 * requires that an empty database renders empty states rather than fabricated
 * records, so there is no demo data to remove later.
 *
 * Safe to re-run: permissions and roles are upserted by their stable `key`, so
 * a role renamed by the client is never reverted by a redeploy.
 */
export async function seed(db: Database = getDb()): Promise<void> {
  await db
    .insert(permissions)
    .values(ALL_PERMISSIONS)
    .onConflictDoUpdate({
      target: permissions.key,
      set: { description: sql`excluded.description` },
    });

  const allPermissionRows = await db.select({ id: permissions.id, key: permissions.key }).from(permissions);
  const permissionIdByKey = new Map(allPermissionRows.map((p) => [p.key, p.id]));

  for (const roleSeed of DEFAULT_ROLES) {
    const [existing] = await db.select().from(roles).where(eq(roles.key, roleSeed.key)).limit(1);

    let roleId: string;
    if (existing) {
      // `name` is intentionally NOT overwritten: renaming a role is a supported
      // client action and a redeploy must not undo it.
      await db
        .update(roles)
        .set({ level: roleSeed.level, isSystem: roleSeed.isSystem, updatedAt: new Date() })
        .where(eq(roles.id, existing.id));
      roleId = existing.id;
    } else {
      const [created] = await db
        .insert(roles)
        .values({
          key: roleSeed.key,
          name: roleSeed.name,
          description: roleSeed.description,
          level: roleSeed.level,
          isSystem: roleSeed.isSystem,
        })
        .returning({ id: roles.id });
      roleId = created!.id;
    }

    const wantedKeys =
      roleSeed.permissions === "*" ? allPermissionRows.map((p) => p.key) : roleSeed.permissions;

    // The system role always holds the complete catalogue, so a newly added
    // permission is never orphaned. Non-system roles are only topped up on
    // first creation; afterwards the client owns their permission sets.
    if (roleSeed.isSystem || !existing) {
      const values = wantedKeys
        .map((key) => permissionIdByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId, permissionId }));

      if (values.length > 0) {
        await db.insert(rolePermissions).values(values).onConflictDoNothing();
      }
    }
  }

  await seedRequiredDocumentTypes(db);
  await bootstrapSuperAdmin(db);
}

/**
 * The default KYC requirement set — Task 9.11, DECISIONS.md D-076.
 *
 * These five are exactly the types the product already knew about: they were a
 * hardcoded array in `documents/page.tsx`, invisible to the backend, which is
 * why D-057 recorded that the document-completeness guard had "nothing to
 * read".
 *
 * Seeded with a NULL `bank_id`, which the KYC-pack endpoint reads as "applies
 * to every bank". A bank that requires something different gets its own row and
 * overrides the default for that type — partner banks genuinely differ.
 *
 * `onConflictDoNothing` so a redeploy never resurrects a requirement an
 * operator deliberately removed. The same reasoning as the role seed above not
 * overwriting `name`.
 */
async function seedRequiredDocumentTypes(db: Database): Promise<void> {
  const defaults = [
    { docType: "PAN Card", mandatory: true, sortOrder: 10 },
    { docType: "Aadhaar", mandatory: true, sortOrder: 20 },
    { docType: "Bank Statement", mandatory: true, sortOrder: 30 },
    { docType: "Salary Slip", mandatory: false, sortOrder: 40 },
    { docType: "ITR", mandatory: false, sortOrder: 50 },
  ];

  await db
    .insert(requiredDocumentTypes)
    .values(defaults.map((row) => ({ ...row, bankId: null })))
    .onConflictDoNothing();
}

async function bootstrapSuperAdmin(db: Database): Promise<void> {
  const config = env();
  const email = config.BOOTSTRAP_SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = config.BOOTSTRAP_SUPERADMIN_PASSWORD;

  if (!email || !password) {
    logger.warn(
      "BOOTSTRAP_SUPERADMIN_EMAIL / _PASSWORD not set — no super admin created. Set both and re-run db:seed.",
    );
    return;
  }

  const problems = passwordProblems(password);
  if (problems.length > 0) {
    throw new Error(`BOOTSTRAP_SUPERADMIN_PASSWORD ${problems.join(", ")}`);
  }

  const [superAdminRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.key, SUPER_ADMIN_ROLE_KEY))
    .limit(1);
  if (!superAdminRole) throw new Error("super_admin role missing — seed order is wrong");

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    logger.info(`Super admin ${email} already exists — leaving the password untouched`);
    return;
  }

  await db.insert(users).values({
    employeeCode: "EMP-0001",
    name: "Super Admin",
    email,
    passwordHash: await hashPassword(password),
    roleId: superAdminRole.id,
    branch: "Head Office",
    status: "Active",
    joinedOn: new Date(),
    // Forces a password change on first login so the bootstrap value, which
    // lives in the Railway dashboard, stops being a valid credential.
    mustChangePassword: true,
  });

  logger.info(`Super admin created: ${email} (must change password on first login)`);
}

/** Permission keys present in the DB but no longer in the catalogue. */
export async function orphanedPermissions(db: Database = getDb()): Promise<string[]> {
  const known = ALL_PERMISSIONS.map((p) => p.key);
  const rows = await db.select({ key: permissions.key }).from(permissions);
  return rows.map((r) => r.key).filter((k) => !known.includes(k));
}

export async function purgeOrphanedPermissions(db: Database = getDb()): Promise<number> {
  const orphans = await orphanedPermissions(db);
  if (orphans.length === 0) return 0;
  await db.delete(permissions).where(inArray(permissions.key, orphans));
  return orphans.length;
}

const invokedDirectly = process.argv[1]?.includes("seed");
if (invokedDirectly) {
  seed()
    .then(async () => {
      logger.info("Seed complete");
      await closeDb();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error({ err: error }, "Seed failed");
      await closeDb();
      process.exit(1);
    });
}
