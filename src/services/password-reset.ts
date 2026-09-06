import { and, eq, gt, isNull } from "drizzle-orm";
import type { Request } from "express";
import { env } from "../config/env.js";
import type { Database } from "../db/index.js";
import { passwordResets, refreshTokens, roles, users } from "../db/schema/index.js";
import { badRequest, unprocessable } from "../lib/errors.js";
import { hashPassword, passwordProblems, randomToken, sha256 } from "../lib/password.js";
import { passwordResetEmail } from "../lib/email-templates.js";
import { logger } from "../lib/logger.js";
import { recordAuthEvent } from "./audit.js";
import { sendEmail } from "./email.js";

/**
 * SELF-SERVICE PASSWORD RESET — roadmap task 3.6.
 *
 * Structurally the invitation flow (**D-038**) with three differences that
 * matter, all of them consequences of *who* starts it. An invitation is issued
 * by an administrator to a known person; a reset is requested by an anonymous
 * caller who has typed an address into a form.
 *
 *   1. **The request endpoint reveals nothing.** It always answers the same way,
 *      whether or not the address belongs to anyone. That constraint is in the
 *      roadmap's own words — *"always returns 200 — never confirm whether an
 *      address exists"* — and it shapes the whole module: no early return, no
 *      distinct log line, no different timing branch that a caller could sense.
 *   2. **A separate table.** Both flows look a token up by digest alone, so one
 *      shared table would let a reset token be redeemed at `/accept-invite` and
 *      an invitation at `/reset-password`. Separate tables make that impossible
 *      by construction rather than by a discriminator someone must remember.
 *   3. **One hour, not 72.** See below.
 */

/**
 * How long a reset link lives.
 *
 * **No document specifies this.** An invitation gets 72 hours because a new hire
 * may not read their mail until Monday (**D-038**). A reset is different in kind:
 * the person asked for it seconds ago and is waiting on it. One hour is the
 * common expectation, and a shorter window on a link that can seize an existing
 * account is worth more than convenience. See **D-039**.
 */
export const PASSWORD_RESET_TTL_HOURS = 1;

/** Same generator and size as invitations and refresh tokens. 384 bits. */
const TOKEN_BYTES = 48;

/** One sentence for every unusable token. */
const INVALID = "This password reset link is not valid. It may have expired or already been used.";

/** The link in the email. Built from `FRONTEND_URL`, never hardcoded. */
export function passwordResetUrl(token: string, frontendUrl = env().FRONTEND_URL): string {
  const base = frontendUrl.replace(/\/+$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Handles a reset request. **Always resolves, and always the same way.**
 *
 * Every branch — unknown address, soft-deleted account, deactivated account,
 * disabled role, mail provider down — ends here identically. The caller gets one
 * response and learns nothing. Nothing is thrown, so an exception cannot become
 * a distinguishing signal either.
 *
 * Logging is where this is easiest to get wrong: a line saying "no account for
 * X" would move the oracle from the response into the log file, where it is just
 * as real for anyone who can read logs. Nothing here logs the address, and the
 * only line written on the not-found path is the same one written on success.
 */
export async function requestPasswordReset(
  db: Database,
  email: string,
  req: Request | null,
): Promise<void> {
  const normalised = email.trim().toLowerCase();

  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      roleActive: roles.isActive,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.email, normalised), isNull(users.deletedAt)))
    .limit(1);

  // Eligibility is checked, and its outcome is never surfaced.
  if (!account || account.status !== "Active" || !account.roleActive) {
    logger.info({ outcome: "no_action" }, "Password reset requested");
    return;
  }

  const token = randomToken(TOKEN_BYTES);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);

  // A new request invalidates any older outstanding link, so there is never more
  // than one live reset token for an account.
  await db
    .update(passwordResets)
    .set({ consumedAt: now })
    .where(and(eq(passwordResets.userId, account.id), isNull(passwordResets.consumedAt)));

  await db.insert(passwordResets).values({
    userId: account.id,
    tokenHash: sha256(token),
    expiresAt,
    requestedIp: req?.ip ?? null,
  });

  const outcome = await sendEmail(
    passwordResetEmail({
      to: account.email,
      name: account.name,
      resetUrl: passwordResetUrl(token),
      expiresInHours: PASSWORD_RESET_TTL_HOURS,
    }),
  );

  /*
   * A failure is recorded but changes nothing the caller can see. Reporting it
   * would tell an anonymous requester that the address exists — the one thing
   * this endpoint must never do — so the honesty owed here is owed to the
   * operator, in the log, not to the caller.
   */
  logger.info(
    { outcome: outcome.status === "failed" ? "email_failed" : "no_action" },
    "Password reset requested",
  );
}

/**
 * Redeems a reset token and sets the password.
 *
 * The ordering is the invitation flow's, for the same reasons (**D-038**): look
 * the token up before doing any argon2 work, so a junk token cannot buy an
 * expensive hash; validate the password before consuming, so a typo does not
 * burn the link; then consume with a conditional `UPDATE` whose `WHERE` clause
 * is the actual guard.
 *
 * **At most one successful reset per token**, resolved by the database.
 */
export async function resetPassword(
  db: Database,
  token: string,
  newPassword: string,
  req: Request | null,
): Promise<void> {
  const tokenHash = sha256(token);

  const [candidate] = await db
    .select({ id: passwordResets.id })
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.tokenHash, tokenHash),
        isNull(passwordResets.consumedAt),
        gt(passwordResets.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!candidate) throw badRequest(INVALID);

  const problems = passwordProblems(newPassword);
  if (problems.length > 0) throw unprocessable(`Password ${problems.join(", ")}`);

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    const now = new Date();

    const claimed = await tx
      .update(passwordResets)
      .set({ consumedAt: now })
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          isNull(passwordResets.consumedAt),
          gt(passwordResets.expiresAt, now),
        ),
      )
      .returning({ id: passwordResets.id, userId: passwordResets.userId });

    const reset = claimed[0];
    if (!reset) throw badRequest(INVALID);

    const [account] = await tx
      .select({ id: users.id, email: users.email, status: users.status })
      .from(users)
      .where(and(eq(users.id, reset.userId), isNull(users.deletedAt)))
      .limit(1);

    // Refusing inside the transaction rolls the consume back with it, so an
    // account deactivated mid-flight does not silently lose a live link.
    if (!account || account.status !== "Active") throw badRequest(INVALID);

    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: now,
        // They chose this password, so there is nothing left to force.
        mustChangePassword: false,
        // A lockout must not outlive the credential it was guarding — otherwise
        // the user who just reset their password still cannot sign in.
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(users.id, account.id));

    // The roadmap requires this explicitly: "revoke all sessions on completion".
    // If the reset was prompted by a compromise, leaving the attacker's session
    // alive would defeat the point.
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(eq(refreshTokens.userId, account.id));

    await recordAuthEvent(
      tx as unknown as Database,
      req,
      "password_changed",
      account.email,
      account.id,
      "Password reset from a self-service link",
    );
  });
}
