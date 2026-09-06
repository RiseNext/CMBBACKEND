import { and, count, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../db/index.js";
import { permissions, rolePermissions, roles, userBankAccess, users } from "../db/schema/index.js";
import { accountInactive, conflict, forbidden, roleDisabled, unauthorized } from "../lib/errors.js";
import { PERMISSIONS, SUPER_ADMIN_ROLE_KEY } from "../lib/permissions.js";

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  status: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleLevel: number;
  roleIsSystem: boolean;
  /** True while the account is still on an admin-issued temporary password. */
  mustChangePassword: boolean;
  permissions: ReadonlySet<string>;
  /** `null` means unrestricted (holder of system.access_all_banks). */
  bankIds: string[] | null;
}

/**
 * Resolves everything authorisation needs in one round trip. Called per request
 * rather than trusted from the JWT so that a permission revoked by an admin
 * takes effect on the user's very next request instead of at token expiry.
 */
export async function loadAuthContext(db: Database, userId: string): Promise<AuthContext> {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      status: users.status,
      deletedAt: users.deletedAt,
      mustChangePassword: users.mustChangePassword,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      roleLevel: roles.level,
      roleIsSystem: roles.isSystem,
      roleIsActive: roles.isActive,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  /*
   * The three session gates. These are the only places that may raise a
   * session-invalidating error: they fire on EVERY request regardless of what
   * was asked for, so a client can safely treat them as "this session is over"
   * (BUG-034). Everything else in this file is an ordinary authorisation
   * refusal and must stay `forbidden`.
   */
  if (!row) throw unauthorized("Account no longer exists");
  if (row.status !== "Active") throw accountInactive();
  if (!row.roleIsActive) throw roleDisabled();

  const grantedRows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, row.roleId));

  const granted = new Set(grantedRows.map((p) => p.key));

  let bankIds: string[] | null = null;
  if (!granted.has(PERMISSIONS.system.accessAllBanks)) {
    const assignments = await db
      .select({ bankId: userBankAccess.bankId })
      .from(userBankAccess)
      .where(eq(userBankAccess.userId, userId));
    bankIds = assignments.map((a) => a.bankId);
  }

  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    status: row.status,
    roleId: row.roleId,
    roleKey: row.roleKey,
    roleName: row.roleName,
    roleLevel: row.roleLevel,
    roleIsSystem: row.roleIsSystem,
    mustChangePassword: row.mustChangePassword,
    permissions: granted,
    bankIds,
  };
}

export const hasPermission = (ctx: AuthContext, key: string): boolean => ctx.permissions.has(key);

export const hasEveryPermission = (ctx: AuthContext, keys: string[]): boolean =>
  keys.every((k) => ctx.permissions.has(k));

export function assertPermission(ctx: AuthContext, key: string): void {
  if (!ctx.permissions.has(key)) {
    throw forbidden(`Missing required permission: ${key}`);
  }
}

export const isUnscoped = (ctx: AuthContext): boolean => ctx.bankIds === null;

/**
 * The single choke point for tenant isolation.
 *
 * Returns a WHERE fragment restricting a query to banks the caller may see.
 * A user with zero bank assignments gets `inArray(column, [])`, which Drizzle
 * renders as a false predicate — they see nothing, rather than everything.
 */
export function bankScope(ctx: AuthContext, column: PgColumn): SQL | undefined {
  if (ctx.bankIds === null) return undefined;
  return inArray(column, ctx.bankIds.length > 0 ? ctx.bankIds : [NO_BANK_SENTINEL]);
}

/** A UUID that can never exist, used to force an empty result set. */
const NO_BANK_SENTINEL = "00000000-0000-0000-0000-000000000000";

/**
 * Called before reading or writing any bank-owned record, including on the
 * bankId supplied in a request body. This is what stops an executive changing
 * a path parameter or a payload field to reach another bank's data.
 */
export function assertBankAccess(ctx: AuthContext, bankId: string | null | undefined): void {
  if (ctx.bankIds === null) return;
  if (!bankId) throw forbidden("A bank must be specified for this operation");
  if (!ctx.bankIds.includes(bankId)) {
    throw forbidden("You do not have access to this resource");
  }
}

export function assertBankAccessMany(ctx: AuthContext, bankIds: string[]): void {
  for (const id of bankIds) assertBankAccess(ctx, id);
}

/**
 * ROLE HIERARCHY
 *
 * Lower level == more authority. An actor may only operate on a subject whose
 * role level is strictly greater than their own. Consequences that fall out of
 * this one rule, with no role names in the code:
 *   - Admin (10) cannot create or edit another Admin (10)  -> not strictly >
 *   - Admin (10) cannot touch Super Admin (0)              -> not strictly >
 *   - Admin (10) can manage Manager (20) and below         -> strictly >
 *   - Super Admin (0) holds system.manage_any_user         -> bypasses
 */
export function assertCanManageRoleLevel(ctx: AuthContext, targetLevel: number): void {
  if (hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) return;
  if (targetLevel <= ctx.roleLevel) {
    throw forbidden("You cannot manage a user at or above your own role level");
  }
}

export function assertCanAssignRole(
  ctx: AuthContext,
  target: { key: string; level: number; isSystem: boolean },
): void {
  if (target.key === SUPER_ADMIN_ROLE_KEY && !hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) {
    throw forbidden("Only a Super Admin may assign the Super Admin role");
  }
  assertCanManageRoleLevel(ctx, target.level);
}

/**
 * Prevents privilege escalation via role editing: you cannot grant a permission
 * you do not hold yourself. Without this, an Admin with roles.assign_permissions
 * could mint a role holding system.access_all_banks and assign it to themselves.
 */
export function assertCanGrantPermissions(ctx: AuthContext, keys: string[]): void {
  if (hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) return;
  const escalations = keys.filter((k) => !ctx.permissions.has(k));
  if (escalations.length > 0) {
    throw forbidden(
      `You cannot grant permissions you do not hold: ${escalations.slice(0, 5).join(", ")}`,
    );
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LAST-SUPER-ADMIN INVARIANT — SEC-003
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is a BUSINESS RULE, not an authorisation check. Everything above answers
 * "may this actor do this?"; this answers "would the organisation survive it?".
 * It applies even to an actor who is fully authorised — in fact especially to
 * one, because `system.manage_any_user` makes every hierarchy check above a
 * no-op for a Super Admin acting on anyone, including themselves.
 *
 * The invariant:
 *
 *   At least one `users` row must remain with `deleted_at IS NULL`, `status =
 *   'Active'`, and a role whose `is_system` is true.
 *
 * Losing that row is unrecoverable inside the product: reactivating an account
 * needs `users.edit`, which needs a session, which needs an Active account with
 * an active role. There is no break-glass route and `db:seed` will not overwrite
 * an existing user.
 *
 * `is_system` is deliberately the population, not "holds system.manage_any_user".
 * It matches what `DELETE` has always enforced, it is the definition the register
 * and the roadmap use, and it cannot be granted by mistake: `POST /api/roles`
 * hardcodes `isSystem: false`, and `0001_governance_guards.sql` stops a system
 * role being deleted, re-keyed or deactivated.
 */

/** The three columns that decide whether a user counts toward the invariant. */
export interface SuperAdminState {
  status: string;
  roleIsSystem: boolean;
  /** True when the proposed end state is soft-deleted. */
  deleted?: boolean;
}

const isProtectedSuperAdmin = (state: SuperAdminState): boolean =>
  state.roleIsSystem && state.status === "Active" && !state.deleted;

/**
 * Refuses an operation that would leave nobody able to administer the system.
 *
 * Callers describe the PROPOSED END STATE rather than the operation, so one
 * rule covers three different writes: `PATCH status → Inactive`, `PATCH roleId
 * → a non-system role`, and `DELETE`'s soft delete.
 *
 * Two properties are load-bearing, and both are asserted by tests:
 *
 *  1. **It only fires on a destructive change.** If the target is not currently
 *     a protected Super Admin — already Inactive, already soft-deleted, or never
 *     a system-role holder — nothing can be lost, so the query is not even run.
 *     Editing the name of a dormant Super Admin, or reactivating them, is not a
 *     removal. This is the Task 2.2 correction: the previous formulation asked
 *     "are there ≤ 1 active Super Admins?" *including* the target, which is
 *     right for an Active target and wrong for an Inactive one — it refused
 *     deleting a deactivated Super Admin whenever exactly one active one
 *     remained.
 *
 *  2. **The count excludes the target row.** With the target excluded, the
 *     threshold is the invariant stated literally: at least one OTHER protected
 *     Super Admin must survive. For an Active target this is exactly equivalent
 *     to the old `remaining <= 1` over a count that included them, so `DELETE`'s
 *     behaviour on active targets is provably unchanged.
 *
 * Not race-safe, and deliberately so for now: the count and the write are
 * separate statements with no lock, exactly as `DELETE` has always been and as
 * every other check-then-write precondition in this codebase is. Two
 * simultaneous destructive requests could still both observe a survivor. That
 * whole class is recorded as a follow-up rather than fixed here.
 */
export async function assertSuperAdminRemains(
  db: Database,
  targetId: string,
  before: SuperAdminState,
  after: SuperAdminState,
): Promise<void> {
  if (!isProtectedSuperAdmin(before) || isProtectedSuperAdmin(after)) return;

  const [{ remaining = 0 } = {}] = await db
    .select({ remaining: count() })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(
      and(
        eq(roles.isSystem, true),
        eq(users.status, "Active"),
        isNull(users.deletedAt),
        ne(users.id, targetId),
      ),
    );

  if (remaining < 1) throw conflict("The last active Super Admin cannot be removed");
}

/** System roles are renameable but never deletable and never key-editable. */
export function assertRoleMutable(role: { isSystem: boolean }, operation: "delete" | "rekey"): void {
  if (role.isSystem) {
    throw forbidden(`The ${operation === "delete" ? "deletion" : "re-keying"} of a system role is not permitted`);
  }
}

export const scopeSummary = (ctx: AuthContext): string =>
  ctx.bankIds === null ? "all banks" : `${ctx.bankIds.length} assigned bank(s)`;
