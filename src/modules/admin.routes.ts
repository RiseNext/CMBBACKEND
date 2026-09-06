import { Router } from "express";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb } from "../db/index.js";
import {
  auditLogs,
  banks,
  permissions as permissionsTable,
  recycleBinEntries,
  refreshTokens,
  rolePermissions,
  roles,
  notifications,
  teamMembers,
  teams,
  userBankAccess,
  users,
} from "../db/schema/index.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { notOnThisRoute, patchSchema } from "../lib/zod.js";
import { generateTemporaryPassword, hashPassword, passwordProblems } from "../lib/password.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { logger } from "../lib/logger.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import {
  assertBankAccess,
  assertCanAssignRole,
  assertCanGrantPermissions,
  assertCanManageRoleLevel,
  assertPermission,
  assertRoleMutable,
  assertSuperAdminRemains,
  bankScope,
  hasPermission,
  type AuthContext,
} from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";
import { employeeInvitationEmail } from "../lib/email-templates.js";
import { INVITATION_TTL_HOURS, invitationUrl, issueInvitation } from "../services/invitations.js";
import { sendEmail } from "../services/email.js";
import { permanentDelete, restore, softDelete } from "../services/recycle-bin.js";

/* ------------------------------------------------------------------ users */

export const usersRouter = Router();
usersRouter.use(requireAuth);

const userInput = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(20).optional().nullable(),
  /**
   * Optional since Task 2.11: omit it and the server assigns the next free code.
   * An explicit value is still honoured, and still validated by the same unique
   * index, so an administrator can keep an existing numbering scheme.
   */
  employeeCode: z.string().trim().min(2).max(40).optional(),
  roleId: z.string().uuid(),
  branch: z.string().trim().max(160).optional().nullable(),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  joinedOn: z.coerce.date().optional().nullable(),
  target: z.coerce.number().int().min(0).default(0),
  achieved: z.coerce.number().int().min(0).default(0),
  avatarColor: z.string().trim().max(20).optional().nullable(),
  bankIds: z.array(z.string().uuid()).optional(),
  /** Optional team membership, applied in the same transaction as the user. */
  teamId: z.string().uuid().optional().nullable(),
  password: z.string().min(1).max(512).optional(),
});

/**
 * The PATCH body — BUG-020.
 *
 * Derived from `userInput` rather than hand-written, so the two cannot drift
 * (D-024). Two of the create schema's fields are refused here instead of being
 * parsed and dropped:
 *
 * `bankIds` and `teamId` are many-to-many relationships, not user columns.
 * `PUT /api/users/:id/banks` and `PUT /api/teams/:id/members` already own them,
 * transactionally and with their own authorisation, and duplicating that inside
 * this handler would put tenant-isolation logic in two places. `teamId` is worse
 * than duplication: `users` has no team column at all, so a scalar here would be
 * inventing a relationship the schema does not have.
 *
 * `joinedOn` is different and IS accepted — it is a plain nullable column on
 * `users`, and no other route can change it after creation.
 */
const userPatchInput = patchSchema(userInput).extend({
  bankIds: notOnThisRoute(
    "Bank access is not editable here. Use PUT /api/users/:id/banks instead.",
  ),
  teamId: notOnThisRoute(
    "Team membership is not editable here. Use PUT /api/teams/:id/members instead.",
  ),
});

/**
 * The next employee code — `EMP-0002`, `EMP-0003`, …
 *
 * The format is the one the seed and the data model already document
 * (`EMP-0001`, `DATA_MODEL.md:347`), zero-padded to four digits and widening
 * past that rather than wrapping.
 *
 * **Not `count(*)`.** Counting rows is what BUG-011 describes for the seven
 * factory-generated record types: delete a record and the count drops, so the
 * next code repeats one already issued. This takes the **maximum suffix ever
 * issued** instead, which only ever moves forward. Two sources, because neither
 * alone survives the whole lifecycle:
 *
 *   - `users`, with **no `deleted_at` filter** — a soft-deleted employee still
 *     holds their number even though the partial unique index has released it.
 *   - `recycle_bin_entries` snapshots for purged employees — a permanent delete
 *     removes the `users` row entirely, and the retained bin entry is the only
 *     remaining record that the number was ever used. Task 2.9 put employees in
 *     the bin and deliberately kept `employeeCode` in the snapshot; only
 *     `passwordHash` is redacted.
 *
 * Codes that do not match the pattern — anything hand-typed like `CONTRACT-7` —
 * contribute nothing to the maximum and cannot collide with a generated one,
 * since a generated code is always numerically above every `EMP-` code in use.
 *
 * **This is check-then-insert, and the unique index is the final word.** Two
 * simultaneous creates can read the same maximum; the loser gets the 409 that
 * `users_employee_code_unique` already produces. That is the established pattern
 * at every write site in this codebase (BUG-037) and is not papered over here.
 */
async function nextEmployeeCode(): Promise<string> {
  const db = getDb();
  const suffix = (column: SQL | PgColumn) =>
    sql<number | null>`max(nullif(substring(${column} from '^EMP-([0-9]+)$'), '')::int)`;

  const [fromUsers] = await db.select({ max: suffix(users.employeeCode) }).from(users);
  const [fromBin] = await db
    .select({ max: suffix(sql`${recycleBinEntries.snapshot}->>'employeeCode'`) })
    .from(recycleBinEntries)
    .where(eq(recycleBinEntries.recordType, "user"));

  const highest = Math.max(Number(fromUsers?.max ?? 0), Number(fromBin?.max ?? 0), 0);
  return `EMP-${String(highest + 1).padStart(4, "0")}`;
}

async function roleOrThrow(roleId: string) {
  const [role] = await getDb().select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw notFound("Role not found");
  return role;
}

/**
 * The target's role level, which is what the hierarchy rule operates on — plus
 * the `status` and `isSystem` pair the last-super-admin invariant needs, so both
 * routes decide from one read rather than two.
 */
async function targetUserRole(userId: string) {
  const [row] = await getDb()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      roleId: roles.id,
      roleKey: roles.key,
      roleLevel: roles.level,
      roleIsSystem: roles.isSystem,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!row) throw notFound("User not found");
  return row;
}

usersRouter.get("/", requirePermission(PERMISSIONS.users.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const db = getDb();
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(50),
        status: z.enum(["Active", "Inactive"]).optional(),
      })
      .parse(req.query);

    const filters: SQL[] = [isNull(users.deletedAt)];
    if (query.status) filters.push(eq(users.status, query.status));

    // A scoped user only sees colleagues who share at least one of their banks.
    if (ctx.bankIds !== null) {
      const ids = ctx.bankIds;
      filters.push(
        ids.length === 0
          ? sql`false`
          : sql`exists (select 1 from user_bank_access uba where uba.user_id = ${users.id} and uba.bank_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))`,
      );
    }

    const where = and(...filters);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(users).where(where);

    const rows = await db
      .select({
        id: users.id,
        employeeCode: users.employeeCode,
        name: users.name,
        email: users.email,
        phone: users.phone,
        branch: users.branch,
        status: users.status,
        joinedOn: users.joinedOn,
        target: users.target,
        achieved: users.achieved,
        avatarColor: users.avatarColor,
        lastLoginAt: users.lastLoginAt,
        // Roadmap 3.7 — surfaced so the employees list can tell "never invited"
        // from "invited, waiting" from "accepted".
        invitedAt: users.invitedAt,
        inviteAcceptedAt: users.inviteAcceptedAt,
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        roleLevel: roles.level,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(where)
      .orderBy(asc(users.name))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const access = rows.length
      ? await db
          .select({ userId: userBankAccess.userId, bankId: userBankAccess.bankId })
          .from(userBankAccess)
          .where(inArray(userBankAccess.userId, rows.map((r) => r.id)))
      : [];

    res.json({
      // password_hash is never selected, so it cannot leak through this route.
      data: rows.map((row) => ({
        ...row,
        assignedBanks: access.filter((a) => a.userId === row.id).map((a) => a.bankId),
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    });
  } catch (error) {
    next(error);
  }
});

usersRouter.post("/", requirePermission(PERMISSIONS.users.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = userInput.parse(req.body);
    const db = getDb();

    const role = await roleOrThrow(input.roleId);
    // THE rule. An Admin (level 10) fails here for another Admin or a Super
    // Admin, without the word "admin" appearing anywhere.
    assertCanAssignRole(ctx, role);

    if (input.bankIds?.length) {
      for (const bankId of input.bankIds) assertBankAccess(ctx, bankId);
    }

    if (input.teamId) {
      // Placing someone on a team is a team assignment, so it needs the same
      // permission the dedicated membership route requires.
      assertPermission(ctx, PERMISSIONS.teams.assign);
      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.id, input.teamId), isNull(teams.deletedAt)))
        .limit(1);
      if (!team) throw notFound("Team not found");
    }

    const password = input.password ?? generateTemporaryPassword();
    const problems = passwordProblems(password);
    if (input.password && problems.length > 0) {
      throw badRequest(`Password ${problems.join(", ")}`);
    }

    /*
     * Resolved BEFORE the transaction opens, deliberately. The generator is a
     * read on the base handle, and issuing it inside the transaction deadlocks
     * on a single-connection driver — the read waits for the transaction that is
     * waiting for the read. It also keeps the write transaction short.
     *
     * The cost is a slightly wider check-then-insert window, which the unique
     * index already closes.
     */
    const employeeCode = input.employeeCode ?? (await nextEmployeeCode());

    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          employeeCode,
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          passwordHash: await hashPassword(password),
          roleId: role.id,
          branch: input.branch ?? null,
          status: input.status,
          joinedOn: input.joinedOn ?? new Date(),
          target: input.target,
          achieved: input.achieved,
          avatarColor: input.avatarColor ?? null,
          mustChangePassword: true,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();

      if (input.bankIds?.length) {
        await tx.insert(userBankAccess).values(
          input.bankIds.map((bankId) => ({ userId: user!.id, bankId, assignedBy: ctx.userId })),
        );
      }

      if (input.teamId) {
        await tx
          .insert(teamMembers)
          .values({ teamId: input.teamId, userId: user!.id, assignedBy: ctx.userId });
      }

      await recordAudit(tx as never, ctx, req, {
        action: "created",
        recordType: "user",
        recordId: user!.id,
        summary: `Created user ${input.name} with role ${role.name}`,
        metadata: {
          roleKey: role.key,
          bankCount: input.bankIds?.length ?? 0,
          teamId: input.teamId ?? null,
        },
      });

      /*
       * Issued INSIDE the transaction, so an invitation can never outlive a
       * user creation that rolled back. The raw token is returned to this scope
       * only — it is put in the link below and nowhere else.
       */
      const issued = await issueInvitation(tx as unknown as typeof db, user!.id, ctx.userId);

      return { user: user!, issued };
    });

    /*
     * The email is sent AFTER the transaction commits, deliberately.
     *
     * Holding a database transaction open across a network call is how the
     * employee-code deadlock happened (D-032), and a mail provider is far slower
     * than a `SELECT`. More importantly the roadmap requires that **user
     * creation still succeeds when the mail provider is down**: `sendEmail`
     * never throws (D-035) and reports `failed` instead, so the outcome is
     * surfaced rather than swallowed — this route does not claim the invitation
     * was delivered when it was not.
     */
    const outcome = await sendEmail(
      employeeInvitationEmail({
        to: created.user.email,
        name: created.user.name,
        setupUrl: invitationUrl(created.issued.token),
        expiresInHours: INVITATION_TTL_HOURS,
      }),
    );

    if (outcome.status === "failed") {
      // Key names and an outcome only — never the token, never the reason's body.
      logger.warn(
        { userId: created.user.id, transport: outcome.transport },
        "Employee created, but the invitation email could not be sent",
      );
    }

    res.status(201).json({
      data: { id: created.user.id, email: created.user.email, name: created.user.name },
      /*
       * The on-screen hand-over stays, deliberately — roadmap 3.9 keeps it as
       * the explicit fallback for when email is unavailable, and removing it
       * here would strand an administrator whose provider is down.
       */
      temporaryPassword: input.password ? undefined : password,
      /*
       * Honest, not optimistic: `sent` means the provider accepted it, not that
       * it arrived. `logged` is the development console transport. A caller must
       * be able to tell "we emailed a link" from "we could not" (D-004).
       */
      invitation: { status: outcome.status, expiresInHours: INVITATION_TTL_HOURS },
    });
  } catch (error) {
    next(error);
  }
});

usersRouter.patch("/:id", requirePermission(PERMISSIONS.users.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    // patchSchema, not .partial(): a bare .partial() lets `status`, `target`
    // and `achieved` arrive with their create-time defaults and be written
    // over stored values the caller never mentioned (BUG-036).
    const input = userPatchInput.parse(req.body);
    const db = getDb();

    const target = await targetUserRole(id);
    // Blocks editing a peer or a superior, which is what stops an Admin
    // touching a Super Admin.
    assertCanManageRoleLevel(ctx, target.roleLevel);

    let nextRoleIsSystem = target.roleIsSystem;
    if (input.roleId && input.roleId !== target.roleId) {
      const nextRole = await roleOrThrow(input.roleId);
      // Blocks promotion above the actor's own authority.
      assertCanAssignRole(ctx, nextRole);
      nextRoleIsSystem = nextRole.isSystem;
    }

    if (input.password) {
      const problems = passwordProblems(input.password);
      if (problems.length > 0) throw badRequest(`Password ${problems.join(", ")}`);
    }

    /*
     * SELF-LOCKOUT GUARD — SEC-003.
     *
     * Deliberately field-scoped. DELETE's blanket `id === ctx.userId` refusal is
     * NOT copyable here: a Super Admin must still be able to change their own
     * name, phone or branch, and the employee edit form submits every field at
     * once. So each rule compares against the value already stored and refuses
     * only a real change — echoing your current status or your current role back
     * is a no-op and stays allowed.
     *
     * This is a separate rule from the invariant below, not a special case of
     * it: deactivating yourself while a peer Super Admin exists leaves the
     * organisation administrable but leaves *you* with no way back in, because
     * reactivation needs `users.edit`, which needs an Active account.
     */
    if (id === ctx.userId) {
      if (input.status === "Inactive" && target.status !== "Inactive") {
        throw badRequest("You cannot deactivate your own account");
      }
      if (
        input.roleId !== undefined &&
        input.roleId !== target.roleId &&
        target.roleIsSystem &&
        !nextRoleIsSystem
      ) {
        throw badRequest("You cannot remove the Super Admin role from your own account");
      }
    }

    // ...and nobody, acting on anybody, may empty the Super Admin population.
    // The same helper backs DELETE, so the invariant is stated exactly once.
    await assertSuperAdminRemains(
      db,
      id,
      { status: target.status, roleIsSystem: target.roleIsSystem },
      { status: input.status ?? target.status, roleIsSystem: nextRoleIsSystem },
    );

    const [before] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    const [after] = await db
      .update(users)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.branch !== undefined ? { branch: input.branch } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.joinedOn !== undefined ? { joinedOn: input.joinedOn } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.achieved !== undefined ? { achieved: input.achieved } : {}),
        ...(input.avatarColor !== undefined ? { avatarColor: input.avatarColor } : {}),
        ...(input.password
          ? {
              passwordHash: await hashPassword(input.password),
              passwordChangedAt: new Date(),
              mustChangePassword: true,
            }
          : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(users.id, id))
      .returning();

    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "user",
      recordId: id,
      summary: `Updated user ${after?.name}`,
      changes: diff(before as Record<string, unknown>, after as Record<string, unknown>),
    });

    res.json({ data: { id: after?.id, name: after?.name, email: after?.email } });
  } catch (error) {
    next(error);
  }
});

/**
 * PASSWORD RESET — issues a fresh temporary credential.
 *
 * `users.reset_password` has been in the catalogue since the first migration
 * but nothing implemented it, which is why an administrator had no way to give
 * a colleague a working password after the one-time value at creation was lost.
 *
 * The plaintext exists only inside this handler and inside the single response
 * it is returned in. What is persisted is the argon2id hash, exactly as at
 * creation, and every existing session for the account is revoked so a stolen
 * refresh cookie cannot outlive the reset.
 */
usersRouter.post(
  "/:id/reset-password",
  requirePermission(PERMISSIONS.users.resetPassword),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const db = getDb();

      const target = await targetUserRole(id);
      // The same hierarchy rule the edit route enforces: you cannot reset the
      // password of a peer or a superior and take over their account.
      assertCanManageRoleLevel(ctx, target.roleLevel);

      const password = generateTemporaryPassword();

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            passwordHash: await hashPassword(password),
            passwordChangedAt: new Date(),
            mustChangePassword: true,
            // A locked-out account is usable again after a reset, which is the
            // other half of why an administrator reaches for this.
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(eq(users.id, id));

        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));

        await recordAudit(tx as never, ctx, req, {
          action: "password_reset",
          recordType: "user",
          recordId: id,
          summary: `Issued a temporary password for ${target.name}`,
        });
      });

      res.json({
        data: { id: target.userId, name: target.name, email: target.email },
        // Returned once. Never stored in the clear, never logged, never
        // retrievable again.
        temporaryPassword: password,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Resend an employee's setup invitation — roadmap task 3.8.
 *
 * Deliberately thin. Every mechanism it needs already exists: `issueInvitation`
 * supersedes the outstanding link, mints the token, stores only the digest and
 * moves `invited_at` (D-038, D-040); `employeeInvitationEmail` + `sendEmail`
 * deliver it without ever claiming more than the provider actually reported
 * (D-035). This route adds authorization, two state guards and an audit row —
 * nothing else. See **D-041**.
 *
 * **`users.reset_password`, not `users.edit` or `users.create`.** This mints a
 * fresh credential-granting link, so it is gated by the permission that already
 * governs handing someone a way in. That choice grants nobody a new capability:
 * a holder can already mint a temporary password for the same target, which is
 * strictly more powerful. Gating on `users.create` would have *added* reach —
 * a create-only role has no other power over an existing employee.
 *
 * **The hierarchy rule applies**, exactly as it does to a password reset. A flat
 * permission check on a credential route is what BUG-038 was; a Manager must not
 * be able to mail themselves a password-setting link for an Admin's account.
 */
usersRouter.post(
  "/:id/resend-invitation",
  requirePermission(PERMISSIONS.users.resetPassword),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const db = getDb();

      // Authorization first, and complete, before any state is disclosed: a
      // 404 for a deleted user, then 403 for one outside the actor's boundary.
      const target = await targetUserRole(id);
      assertCanManageRoleLevel(ctx, target.roleLevel);

      const [state] = await db
        .select({ inviteAcceptedAt: users.inviteAcceptedAt })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      /*
       * Refused once the employee has set their own password. The template says
       * "an account has been created for you… choose your own password", which
       * would be false, and honouring it would make this a second password-reset
       * path that skips the session revocation and the `password_reset` audit
       * row the real one writes. An administrator who means to reset uses
       * `POST /:id/reset-password`.
       */
      if (state?.inviteAcceptedAt) {
        throw conflict(
          "This employee has already completed setup. Reset their password instead.",
        );
      }

      /*
       * `acceptInvitation` refuses any account that is not Active, so inviting
       * one would mail a link that is dead on arrival — a control reporting a
       * success it cannot achieve (D-004). Reactivating them is a separate,
       * deliberate act; this route does not do it as a side effect.
       */
      if (target.status !== "Active") {
        throw conflict("This employee is not active. Reactivate them before inviting them again.");
      }

      const issued = await db.transaction(async (tx) => {
        const result = await issueInvitation(tx as unknown as typeof db, id, ctx.userId);

        // No token, no digest, no URL — the audit table is append-only.
        await recordAudit(tx as never, ctx, req, {
          action: "invitation_resent",
          recordType: "user",
          recordId: id,
          summary: `Resent the account setup invitation to ${target.name}`,
        });

        return result;
      });

      // After the commit, for the reasons the create route gives: a mail
      // provider is far slower than a SELECT, and D-032 was a deadlock.
      const outcome = await sendEmail(
        employeeInvitationEmail({
          to: target.email,
          name: target.name,
          setupUrl: invitationUrl(issued.token),
          expiresInHours: INVITATION_TTL_HOURS,
        }),
      );

      if (outcome.status === "failed") {
        logger.warn(
          { userId: id, transport: outcome.transport },
          "Invitation reissued, but the email could not be sent",
        );
      }

      res.json({
        data: { id: target.userId, name: target.name, email: target.email },
        /*
         * The superseding link exists either way — that is a database fact. What
         * the caller must not be told is that it arrived: `sent` is provider
         * acceptance, `logged` is the development console (D-004, D-035).
         */
        invitation: { status: outcome.status, expiresInHours: INVITATION_TTL_HOURS },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Bank assignment. Replaces `Employee.assignedBanks[]` from the frontend. */
usersRouter.put("/:id/banks", requirePermission(PERMISSIONS.users.assign), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const { bankIds } = z.object({ bankIds: z.array(z.string().uuid()) }).parse(req.body);
    const db = getDb();

    const target = await targetUserRole(id);
    assertCanManageRoleLevel(ctx, target.roleLevel);
    // You cannot grant access to a bank you cannot see yourself.
    for (const bankId of bankIds) assertBankAccess(ctx, bankId);

    const existing = await db
      .select({ bankId: banks.id })
      .from(banks)
      .where(and(inArray(banks.id, bankIds.length ? bankIds : [id]), isNull(banks.deletedAt)));
    if (bankIds.length && existing.length !== bankIds.length) {
      throw badRequest("One or more banks do not exist");
    }

    await db.transaction(async (tx) => {
      const previous = await tx
        .select({ bankId: userBankAccess.bankId })
        .from(userBankAccess)
        .where(eq(userBankAccess.userId, id));

      await tx.delete(userBankAccess).where(eq(userBankAccess.userId, id));
      if (bankIds.length) {
        await tx
          .insert(userBankAccess)
          .values(bankIds.map((bankId) => ({ userId: id, bankId, assignedBy: ctx.userId })));
      }

      await recordAudit(tx as never, ctx, req, {
        action: "assigned",
        recordType: "user",
        recordId: id,
        summary: `Set bank access for ${target.name} to ${bankIds.length} bank(s)`,
        changes: { banks: { from: previous.map((p) => p.bankId), to: bankIds } },
      });
    });

    res.json({ data: { userId: id, bankIds } });
  } catch (error) {
    next(error);
  }
});

usersRouter.delete("/:id", requirePermission(PERMISSIONS.users.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    if (id === ctx.userId) throw badRequest("You cannot delete your own account");

    const target = await targetUserRole(id);
    assertCanManageRoleLevel(ctx, target.roleLevel);

    // The last active super admin must not be removable, or the system locks
    // out. The end state passed here is exactly what the update below writes,
    // and the helper is the same one PATCH uses — one statement of the rule.
    await assertSuperAdminRemains(
      getDb(),
      id,
      { status: target.status, roleIsSystem: target.roleIsSystem },
      { status: "Inactive", roleIsSystem: target.roleIsSystem, deleted: true },
    );

    /*
     * The guards above still run here, before anything is written — `softDelete`
     * knows nothing about self-deletion, the role hierarchy or the last-Super-
     * Admin invariant, and must not be trusted to enforce them.
     *
     * What it does own is the write: one transaction that stamps the row and
     * inserts the recycle-bin entry, so a user can never be marked deleted
     * without a restorable entry beside them. It also deactivates the account
     * via the registry's `deleteFields`, which is what the hand-rolled update
     * used to do inline.
     */
    await softDelete(getDb(), ctx, req, "user", id);

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ roles */

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

rolesRouter.get("/", requirePermission(PERMISSIONS.roles.view), async (_req, res, next) => {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(roles)
      .where(isNull(roles.deletedAt))
      .orderBy(asc(roles.level));
    const grants = await db
      .select({ roleId: rolePermissions.roleId, key: permissionsTable.key })
      .from(rolePermissions)
      .innerJoin(permissionsTable, eq(rolePermissions.permissionId, permissionsTable.id));

    res.json({
      data: rows.map((role) => ({
        ...role,
        permissions: grants.filter((g) => g.roleId === role.id).map((g) => g.key),
      })),
    });
  } catch (error) {
    next(error);
  }
});

rolesRouter.get("/permissions", requirePermission(PERMISSIONS.roles.view), async (_req, res, next) => {
  try {
    const rows = await getDb()
      .select()
      .from(permissionsTable)
      .orderBy(asc(permissionsTable.resource), asc(permissionsTable.action));
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

const roleInput = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,40}$/, "Key must be lowercase snake_case"),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  level: z.coerce.number().int().min(1).max(1000),
  permissions: z.array(z.string()).default([]),
});

rolesRouter.post("/", requirePermission(PERMISSIONS.roles.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = roleInput.parse(req.body);
    const db = getDb();

    // A new role may not be created at or above the creator's own authority.
    assertCanManageRoleLevel(ctx, input.level);
    // ...and may not carry a permission the creator does not hold.
    assertCanGrantPermissions(ctx, input.permissions);

    const created = await db.transaction(async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          level: input.level,
          isSystem: false,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();

      if (input.permissions.length) {
        const perms = await tx
          .select({ id: permissionsTable.id })
          .from(permissionsTable)
          .where(inArray(permissionsTable.key, input.permissions));
        await tx
          .insert(rolePermissions)
          .values(perms.map((p) => ({ roleId: role!.id, permissionId: p.id, grantedBy: ctx.userId })));
      }

      await recordAudit(tx as never, ctx, req, {
        action: "created",
        recordType: "role",
        recordId: role!.id,
        summary: `Created role ${input.name}`,
        metadata: { permissions: input.permissions.length },
      });
      return role!;
    });

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

rolesRouter.patch("/:id", requirePermission(PERMISSIONS.roles.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const input = patchSchema(roleInput).omit({ key: true }).parse(req.body);
    const db = getDb();

    const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!role) throw notFound("Role not found");
    assertCanManageRoleLevel(ctx, role.level);
    if (input.level !== undefined) assertCanManageRoleLevel(ctx, input.level);

    const [after] = await db
      .update(roles)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        // A system role's level is fixed; everything else about it is editable.
        ...(input.level !== undefined && !role.isSystem ? { level: input.level } : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(roles.id, id))
      .returning();

    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "role",
      recordId: id,
      summary: `Renamed role ${role.name} to ${after?.name}`,
      changes: diff(role as Record<string, unknown>, after as Record<string, unknown>),
    });

    res.json({ data: after });
  } catch (error) {
    next(error);
  }
});

rolesRouter.put(
  "/:id/permissions",
  requirePermission(PERMISSIONS.roles.assignPermissions),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const { permissions: keys } = z.object({ permissions: z.array(z.string()) }).parse(req.body);
      const db = getDb();

      const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
      if (!role) throw notFound("Role not found");
      if (role.isSystem) throw forbidden("The system role's permissions cannot be edited");

      assertCanManageRoleLevel(ctx, role.level);
      assertCanGrantPermissions(ctx, keys);

      await db.transaction(async (tx) => {
        const perms = keys.length
          ? await tx
              .select({ id: permissionsTable.id, key: permissionsTable.key })
              .from(permissionsTable)
              .where(inArray(permissionsTable.key, keys))
          : [];
        if (perms.length !== keys.length) throw badRequest("One or more permissions do not exist");

        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        if (perms.length) {
          await tx
            .insert(rolePermissions)
            .values(perms.map((p) => ({ roleId: id, permissionId: p.id, grantedBy: ctx.userId })));
        }

        await recordAudit(tx as never, ctx, req, {
          action: "updated",
          recordType: "role",
          recordId: id,
          summary: `Set ${keys.length} permission(s) on role ${role.name}`,
          changes: { permissions: { from: "(replaced)", to: keys } },
        });
      });

      res.json({ data: { roleId: id, permissions: keys } });
    } catch (error) {
      next(error);
    }
  },
);

rolesRouter.delete("/:id", requirePermission(PERMISSIONS.roles.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const db = getDb();

    const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!role) throw notFound("Role not found");
    assertRoleMutable(role, "delete");
    assertCanManageRoleLevel(ctx, role.level);

    const [{ holders = 0 } = {}] = await db
      .select({ holders: count() })
      .from(users)
      .where(and(eq(users.roleId, id), isNull(users.deletedAt)));
    if (holders > 0) {
      throw conflict(`This role is still assigned to ${holders} user(s). Reassign them first.`);
    }

    await db.delete(roles).where(eq(roles.id, id));
    await recordAudit(db, ctx, req, {
      action: "deleted",
      recordType: "role",
      recordId: id,
      summary: `Deleted role ${role.name}`,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ teams */

export const teamsRouter = Router();
teamsRouter.use(requireAuth);

teamsRouter.get("/", requirePermission(PERMISSIONS.teams.view), async (_req, res, next) => {
  try {
    const db = getDb();
    const rows = await db.select().from(teams).where(isNull(teams.deletedAt)).orderBy(asc(teams.name));
    const members = await db
      .select({ teamId: teamMembers.teamId, userId: teamMembers.userId, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(isNull(users.deletedAt));

    res.json({
      data: rows.map((team) => ({
        ...team,
        members: members.filter((m) => m.teamId === team.id),
      })),
    });
  } catch (error) {
    next(error);
  }
});

const teamInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  leaderId: z.string().uuid().optional().nullable(),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});

/**
 * Authorizes a team-leader designation and canonicalises the id — Task 12.3.
 *
 * Shared by POST and PATCH deliberately. Applying the hierarchy on PATCH alone
 * would leave the same designation reachable by deleting the team and creating
 * it again, which is not a guard.
 */
async function assertCanLead(ctx: AuthContext, leaderId: string): Promise<string> {
  const id = leaderId.toLowerCase();
  const [leader] = await getDb()
    .select({ userId: users.id, roleLevel: roles.level })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  /*
   * Explicit, rather than letting the foreign key do it: a 23503 surfaces as a
   * 409 reading "still referenced by other records", which says the opposite of
   * what happened.
   */
  if (!leader) throw badRequest("That user does not exist");
  // Nobody outranks themselves, and leadership is consulted by no authorization
  // decision, so leading your own team needs no authority over yourself.
  if (leader.userId !== ctx.userId) assertCanManageRoleLevel(ctx, leader.roleLevel);
  return id;
}

teamsRouter.post("/", requirePermission(PERMISSIONS.teams.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = teamInput.parse(req.body);
    if (input.leaderId) input.leaderId = await assertCanLead(ctx, input.leaderId);
    const db = getDb();
    const [created] = await db
      .insert(teams)
      .values({ ...input, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning();
    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "team",
      recordId: created?.id,
      summary: `Created team ${created?.name}`,
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/teams/:id — Task 12.3.
 *
 * `teams.edit` was seeded to Super Admin and Admin and **consumed by no route**.
 * A team's name, description, leader and status were fixed at creation for the
 * life of the record: `POST` set them, `PUT /:id/members` changed only the
 * roster, and nothing else touched the row. A typo in a team name was permanent.
 *
 * ── THE LEADER IS AUTHORIZED LIKE A MEMBER, NOT LIKE A COLUMN ───────────────
 *
 * `leaderId` is a foreign key to `users` and naming someone to it is an act upon
 * that person, exactly as rostering them is. `PUT /:id/members` already applies
 * the role hierarchy over `previous ∪ submitted` because omitting a name is as
 * much an act as adding one (BUG-038 / SEC-029); if leadership were exempt, the
 * same designation could be made here instead and the check bypassed one field
 * over. So the same rule applies, with the same self-exemption and for the same
 * reason: nobody outranks themselves, and `team_members`/`teams.leader_id` are
 * consulted by **no** authorization decision — `services/access.ts` does not
 * mention teams at all — so leading a team grants nothing.
 *
 * The leader must also be a live user. Without the explicit check a bogus uuid
 * reaches the foreign key and surfaces as a 409 whose message ("still referenced
 * by other records") says the opposite of what happened.
 *
 * Clearing the leader (`leaderId: null`) needs no authorization beyond
 * `teams.edit`: the schema already does it unbidden — `onDelete: "set null"` —
 * and it grants nobody anything. It is audited like any other change.
 *
 * No audit row is written when nothing actually changed. `audit_logs` is
 * immutable and has no purge path yet (SEC-017); a no-op PATCH should not grow
 * it.
 */
const teamPatchInput = patchSchema(teamInput);

teamsRouter.patch("/:id", requirePermission(PERMISSIONS.teams.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const input = teamPatchInput.parse(req.body);
    const db = getDb();

    const [team] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
      .limit(1);
    if (!team) throw notFound("Team not found");

    // Lower-cased inside `assertCanLead` for the same reason `PUT /:id/members`
    // does it: Postgres emits uuids lower-cased and `z.uuid()` accepts any case
    // without normalising, so a mixed-case id would fail a comparison it should
    // pass.
    if (input.leaderId) input.leaderId = await assertCanLead(ctx, input.leaderId);

    const patch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.leaderId !== undefined ? { leaderId: input.leaderId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };

    if (Object.keys(patch).length === 0) {
      res.json({ data: team });
      return;
    }

    const after = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(teams)
        .set({ ...patch, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(teams.id, id))
        .returning();

      /*
       * Diffed over the SUBMITTED columns only. A full-row diff always reports
       * `updatedAt` and would make "nothing actually changed" unrepresentable,
       * which is the case this guard exists to catch.
       */
      const submitted = Object.keys(patch);
      const pick = (row: Record<string, unknown> | undefined) =>
        Object.fromEntries(submitted.map((key) => [key, row?.[key]]));
      const changes = diff(pick(team as Record<string, unknown>), pick(updated));
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx as never, ctx, req, {
          action: "updated",
          recordType: "team",
          recordId: id,
          summary: `Updated team ${updated?.name ?? team.name}`,
          changes,
        });
      }
      return updated;
    });

    res.json({ data: after });
  } catch (error) {
    next(error);
  }
});

teamsRouter.put("/:id/members", requirePermission(PERMISSIONS.teams.assign), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const { userIds: submitted } = z.object({ userIds: z.array(z.string().uuid()) }).parse(req.body);
    /*
     * Postgres stores and emits uuids lower-cased, but `z.uuid()` accepts any
     * case and does not normalise. Comparing a raw request id against ids read
     * back from the database would reject a perfectly real user, so canonicalise
     * once here and let everything downstream — the membership check, the
     * insert, the audit row and the response — agree on one spelling.
     */
    const userIds = submitted.map((userId) => userId.toLowerCase());
    const db = getDb();

    const [team] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
      .limit(1);
    if (!team) throw notFound("Team not found");

    await db.transaction(async (tx) => {
      const previous = await tx
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, id));
      const previousIds = previous.map((row) => row.userId);

      /*
       * The hierarchy rule applies to the UNION of the old and new rosters, not
       * just the submitted list. This route replaces the roster wholesale, so
       * omitting a name is an act upon that person exactly as much as adding one
       * is — checking only `userIds` would still let a Manager evict a Super
       * Admin by simply leaving them out (BUG-038).
       */
      const affected = [...new Set([...previousIds, ...userIds])];

      if (affected.length) {
        const live = await tx
          .select({ userId: users.id, roleLevel: roles.level })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .where(and(inArray(users.id, affected), isNull(users.deletedAt)));
        const liveIds = new Set(live.map((row) => row.userId));

        /*
         * Every SUBMITTED member must be a real, live user. Without this the
         * insert fails on the foreign key and surfaces as a 409 whose message
         * ("still referenced by other records") says the opposite of the truth.
         *
         * Deliberately not applied to `previousIds`: soft-deleting a user leaves
         * their `team_members` rows in place, so requiring every prior member to
         * be live would make any team containing a departed employee permanently
         * unmanageable. Dropping an already-deleted member grants nobody
         * anything, so it needs no authorization.
         */
        if (userIds.some((userId) => !liveIds.has(userId))) {
          throw badRequest("One or more users do not exist");
        }

        for (const row of live) {
          /*
           * Your own membership is not something you need authority over.
           * `team_members` is never consulted by any authorization decision —
           * `services/access.ts` does not mention teams at all — so joining or
           * leaving a team grants and removes nothing. Without this, an actor who
           * is on a team could never edit that team's roster, not even to remove
           * themselves, because the hierarchy rule is "strictly greater" and
           * nobody outranks themselves. `POST /api/users` can place a Manager on
           * a team at creation, so that state is reachable through normal use.
           */
          if (row.userId === ctx.userId) continue;
          assertCanManageRoleLevel(ctx, row.roleLevel);
        }
      }

      await tx.delete(teamMembers).where(eq(teamMembers.teamId, id));
      if (userIds.length) {
        await tx
          .insert(teamMembers)
          .values(userIds.map((userId) => ({ teamId: id, userId, assignedBy: ctx.userId })));
      }
      await recordAudit(tx as never, ctx, req, {
        action: "assigned",
        recordType: "team",
        recordId: id,
        summary: `Set ${userIds.length} member(s) on team ${team.name}`,
        changes: { members: { from: previousIds, to: userIds } },
      });
    });

    res.json({ data: { teamId: id, userIds } });
  } catch (error) {
    next(error);
  }
});

/**
 * Task 12.3's companion correction.
 *
 * This route used to `UPDATE … WHERE id = :id` with no prior read, so deleting a
 * uuid that names no team — or one already in the bin — matched zero rows, wrote
 * an audit entry for a record that does not exist, and answered **204**. A UI
 * cannot tell a successful delete from a miss, which is the shape D-004 forbids.
 * It now reads first and answers 404, exactly as PATCH does.
 */
teamsRouter.delete("/:id", requirePermission(PERMISSIONS.teams.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const db = getDb();

    const [team] = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
      .limit(1);
    if (!team) throw notFound("Team not found");

    await db
      .update(teams)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(teams.id, id));
    await recordAudit(db, ctx, req, {
      action: "deleted",
      recordType: "team",
      recordId: id,
      summary: `Deleted team ${team.name}`,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ----------------------------------------------------------- recycle bin */

export const recycleBinRouter = Router();
recycleBinRouter.use(requireAuth);

/**
 * The role hierarchy still applies to an employee sitting in the recycle bin.
 *
 * `recycle_bin.restore` is held by `manager` as well as `admin` (`permissions.ts`),
 * and the bin routes gate only on that permission plus bank access. Every other
 * binned type is a business record, so that was sufficient — but Task 2.9 put
 * *people* in the bin, and without this a Manager could restore or permanently
 * delete a Super Admin they could never have deleted in the first place. That is
 * the same hole BUG-038 was, arriving by a different door.
 *
 * Keyed on the record type, not on any role name. Non-user entries are untouched.
 */
async function assertCanActOnBinnedUser(
  ctx: AuthContext,
  recordType: string,
  recordId: string,
): Promise<void> {
  if (recordType !== "user") return;

  const [row] = await getDb()
    .select({ roleLevel: roles.level })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, recordId))
    .limit(1);

  // A purged entry has no row left; there is nothing to escalate to.
  if (!row) return;
  assertCanManageRoleLevel(ctx, row.roleLevel);
}

/**
 * SEC-013, Task 13.9 — a bin entry with no bank is NOT unscoped.
 *
 * Both write routes below read `if (entry.bankId) assertBankAccess(...)`, so an
 * entry whose `bank_id` is NULL **skipped the scope check entirely**: any holder
 * of `recycle_bin.restore` or `recycle_bin.permanent_delete` could act on it,
 * from any bank. `recycle_bin.restore` is granted to **Manager**, so this was
 * never a Super-Admin-only reach.
 *
 * ⚠️ **The blast radius grew after the finding was written.** D-075 records it:
 * Task 9.8 wired object deletion into the purge path, so an out-of-scope
 * permanent-delete no longer destroys just a row — it destroys the **KYC file**
 * behind it, irreversibly, from object storage.
 *
 * ── WHY THIS IS NOT SIMPLY "REFUSE EVERY SCOPED CALLER ON A NULL BANK" ──────
 *
 * That was the first fix and it was wrong. Exactly two record types carry a
 * null bank by design — `BIN_REGISTRY`'s two `bankIdOf: () => null` entries —
 * and they are not the same case:
 *
 *   **`user`** is not bank-owned, and its authority is the **role hierarchy**,
 *   not bank scope. D-030 designed that deliberately: a Manager may restore
 *   someone they outrank, and `assertCanActOnBinnedUser` (immediately below)
 *   enforces it. Refusing every scoped caller here would silently delete that
 *   capability and leave employee restore to Super Admin alone — a regression
 *   dressed as a security fix. Four tests in `user-recycle-bin.test.ts` caught
 *   it.
 *
 *   **`service_provider`** is not bank-owned either, and has **no** alternative
 *   guard — no hierarchy, no owner. It is the type BUG-019's fix added, which
 *   is what widened this finding in the first place. There is nothing to check,
 *   so it is unscoped-callers-only.
 *
 *   **Anything else** with a null bank is a bank-owned record whose bank is
 *   unexpectedly missing. That is corrupt data, not a category, so it fails
 *   closed.
 */
const BANKLESS_BY_DESIGN = new Set(["user", "service_provider"]);

function assertBinScope(ctx: AuthContext, recordType: string, bankId: string | null): void {
  if (bankId) {
    assertBankAccess(ctx, bankId);
    return;
  }
  // `user` defers to the role hierarchy, applied by the caller immediately
  // after this returns.
  if (recordType === "user") return;

  // Everything else with no bank — whether bank-less by design or by
  // corruption — is reachable only by a caller with no bank scope at all.
  if (ctx.bankIds !== null) {
    throw forbidden(
      BANKLESS_BY_DESIGN.has(recordType)
        ? "This record belongs to no bank, so only an unrestricted account may act on it"
        : "You do not have access to this resource",
    );
  }
}

recycleBinRouter.get("/", requirePermission(PERMISSIONS.recycleBin.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const filters: SQL[] = [isNull(recycleBinEntries.restoredAt), isNull(recycleBinEntries.purgedAt)];
    // Bin entries carrying no bank (e.g. service providers) stay visible only to
    // unscoped users; scoped users see their own banks' entries.
    const scope = bankScope(ctx, recycleBinEntries.bankId);
    if (scope) filters.push(scope);

    const rows = await getDb()
      .select()
      .from(recycleBinEntries)
      .where(and(...filters))
      .orderBy(desc(recycleBinEntries.deletedAt))
      .limit(200);

    res.json({
      data: rows.map((row) => ({
        ...row,
        // The full snapshot is not needed by the list UI and may contain PII.
        snapshot: undefined,
        daysRemaining: Math.max(
          0,
          Math.ceil((row.purgeAfter.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        ),
      })),
    });
  } catch (error) {
    next(error);
  }
});

recycleBinRouter.post(
  "/:id/restore",
  requirePermission(PERMISSIONS.recycleBin.restore),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const [entry] = await getDb()
        .select()
        .from(recycleBinEntries)
        .where(eq(recycleBinEntries.id, id))
        .limit(1);
      if (!entry) throw notFound("Recycle bin entry not found");
      assertBinScope(ctx, entry.recordType, entry.bankId);
      await assertCanActOnBinnedUser(ctx, entry.recordType, entry.recordId);

      await restore(getDb(), ctx, req, id);
      res.json({ data: { restored: true, recordType: entry.recordType } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Hard delete. The frontend shows a plain "Are you sure?" with No/Yes and no
 * typing, per the brief, so the confirmation lives in the UI; the API requires
 * an explicit flag so a stray DELETE cannot purge anything by accident.
 */
recycleBinRouter.post(
  "/:id/permanent-delete",
  requirePermission(PERMISSIONS.recycleBin.permanentDelete),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const { confirm } = z.object({ confirm: z.literal(true) }).parse(req.body);
      if (!confirm) throw badRequest("Confirmation is required");

      const [entry] = await getDb()
        .select()
        .from(recycleBinEntries)
        .where(eq(recycleBinEntries.id, id))
        .limit(1);
      if (!entry) throw notFound("Recycle bin entry not found");
      assertBinScope(ctx, entry.recordType, entry.bankId);
      await assertCanActOnBinnedUser(ctx, entry.recordType, entry.recordId);

      await permanentDelete(getDb(), ctx, req, id);
      res.json({ data: { purged: true, recordType: entry.recordType } });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------ audit logs */

export const auditRouter = Router();
auditRouter.use(requireAuth);

/**
 * Read-only by construction: there is no write route, and the table rejects
 * UPDATE and DELETE at the database level.
 *
 * ── SEC-014 / TASK 12.5 — THE PRECEDENCE BUG ────────────────────────────────
 *
 * The bank-scope clause used to be pushed into `filters` as a bare
 * `A or B` fragment. `and(...)` joins its arguments with ` and ` and parenthesises
 * only the WHOLE expression, not each part, so the emitted predicate was:
 *
 *     (record_type = 'loan' and bank_id is null and actor_id = :me or bank_id in (…))
 *
 * and `and` binds tighter than `or`, which reads as:
 *
 *     ((record_type = 'loan' and bank_id is null and actor_id = :me)
 *      or (bank_id in (…)))
 *
 * Every user-selected filter was therefore **silently dropped for the entire
 * in-scope branch**: asking for `recordType=loan` returned every audit row for
 * every record type in the caller's banks. Re-verified during the Wave 3 audit:
 * this is filter DROPPING, not a scope escape — the second disjunct is still
 * `bank_id in (caller's banks)`, so no out-of-scope row was ever returned. That
 * is why it is a correctness defect rather than a tenancy breach, and group D
 * below pins both halves.
 *
 * The fix is the parentheses. Nothing about the scope predicate changes.
 *
 * ── TASK 12.4 — `meta.total`, AND FILTERS THE VIEWER NEEDS ──────────────────
 *
 * The response carried `page` and `pageSize` and **no total**, so a paginator
 * could not know whether a further page existed. A UI can only either invent a
 * total or offer a Next button that might land on nothing; both are D-004
 * failures. The count runs over the same `where`, so it describes the same set
 * the rows came from.
 *
 * `actorId` and `bankId` narrow; `bankId` can never widen — an out-of-scope bank
 * is a 403 through the shared `assertBankAccess`, exactly as `/api/reports/loans`
 * answers it (D-051: a filter must not quietly return a different set than the
 * one asked for). The `to` bound is inclusive of the whole day, the same
 * convention as the reports window.
 */
auditRouter.get("/", requirePermission(PERMISSIONS.auditLogs.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(50),
        recordType: z.string().trim().max(60).optional(),
        recordId: z.string().trim().max(60).optional(),
        action: z.string().trim().max(60).optional(),
        actorId: z.string().uuid().optional(),
        bankId: z.string().uuid().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);

    const filters: SQL[] = [];
    if (query.recordType) filters.push(eq(auditLogs.recordType, query.recordType));
    if (query.recordId) filters.push(eq(auditLogs.recordId, query.recordId));
    if (query.action) filters.push(eq(auditLogs.action, query.action));
    if (query.actorId) filters.push(eq(auditLogs.actorId, query.actorId.toLowerCase()));
    if (query.bankId) {
      // Throws 403 when the bank is outside the caller's scope, so a narrowing
      // filter can never become a widening one.
      assertBankAccess(ctx, query.bankId);
      filters.push(eq(auditLogs.bankId, query.bankId.toLowerCase()));
    }
    if (query.from) filters.push(sql`${auditLogs.occurredAt} >= ${query.from}`);
    if (query.to) {
      // A date input means the whole day; comparing a 23:47 timestamp against a
      // midnight bound silently empties the final day of every window.
      const end = new Date(query.to);
      end.setHours(23, 59, 59, 999);
      filters.push(sql`${auditLogs.occurredAt} <= ${end}`);
    }

    if (ctx.bankIds !== null) {
      const ids = ctx.bankIds;
      filters.push(
        ids.length === 0
          ? sql`false`
          : // The outer pair of parentheses is the whole of the 12.5 fix.
            sql`((${auditLogs.bankId} is null and ${auditLogs.actorId} = ${ctx.userId}) or ${auditLogs.bankId} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))`,
      );
    }

    const where = filters.length ? and(...filters) : undefined;
    const db = getDb();
    const rows = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.occurredAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(auditLogs).where(where);

    res.json({
      data: rows,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
        scoped: ctx.bankIds !== null,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { hasPermission, softDelete };

/* --------------------------------------------------------- notifications */

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/**
 * Notifications are per-user, not per-bank, so they are not bank-scoped —
 * a user only ever sees rows addressed to them.
 */
notificationsRouter.get("/", async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const rows = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(100);

    res.json({
      data: rows,
      meta: { total: rows.length, unread: rows.filter((r) => !r.read).length },
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/read-all", async (req, res, next) => {
  try {
    const ctx = authOf(req);
    await getDb()
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.userId), eq(notifications.read, false)));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/:id/read", async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const [updated] = await getDb()
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(
        and(eq(notifications.id, req.params.id as string), eq(notifications.userId, ctx.userId)),
      )
      .returning();
    if (!updated) throw notFound("Notification not found");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});
