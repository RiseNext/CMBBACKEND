import { and, eq, gt, isNull } from "drizzle-orm";
import type { Request } from "express";
import { env } from "../config/env.js";
import type { Database } from "../db/index.js";
import { invitations, refreshTokens, users } from "../db/schema/index.js";
import { badRequest, unprocessable } from "../lib/errors.js";
import { hashPassword, passwordProblems, randomToken, sha256 } from "../lib/password.js";
import { recordAuthEvent } from "./audit.js";

/**
 * EMPLOYEE INVITATIONS — roadmap task 3.5.
 *
 * The credential model is settled by **D-037**: a single-use, time-limited link.
 * No password is ever emailed. This module issues those links and redeems them.
 *
 * **Only the digest is stored.** The raw token exists in the generated URL and in
 * the accepting request — never at rest, never in a log, never in an audit
 * summary, never in an error. Same treatment `refresh_tokens` already gives a
 * bearer secret.
 *
 * **One generic failure.** Every unusable token — unknown, expired, already
 * consumed, or belonging to a deleted or deactivated employee — produces the
 * same message. Distinguishing them would turn a public endpoint into an oracle
 * for which addresses have pending invitations.
 */

/**
 * How long an invitation stays valid.
 *
 * **No document specifies this.** The roadmap says "time-limited" and names no
 * duration, and D-037 deliberately left it to this task. 72 hours is chosen so
 * an employee created on a Friday can still act on Monday, while keeping the
 * window short enough that a link found in an old inbox is usually dead. See
 * D-038; change it here, not at a call site.
 */
export const INVITATION_TTL_HOURS = 72;

/**
 * 48 random bytes, base64url — the same generator and size `refresh_tokens`
 * uses. 384 bits, so guessing is not a threat model; the interesting attacks are
 * all about storage and replay, which is where the effort went.
 */
const TOKEN_BYTES = 48;

/** Identical for every failure mode. See the module note. */
const INVALID = "This invitation link is not valid. It may have expired or already been used.";

export interface IssuedInvitation {
  /** The raw token. Belongs in the URL and nowhere else. */
  token: string;
  expiresAt: Date;
}

/** The link an employee follows. Built from `FRONTEND_URL`, never hardcoded. */
export function invitationUrl(token: string, frontendUrl = env().FRONTEND_URL): string {
  const base = frontendUrl.replace(/\/+$/, "");
  return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
}

/**
 * Issues an invitation, returning the raw token **once**.
 *
 * Any outstanding invitation for the same employee is consumed first, so a
 * reissue invalidates the previous link rather than leaving two live tokens.
 * That keeps "consumed" meaning exactly "no longer usable" and adds no fifth
 * column beyond the four the roadmap names.
 *
 * Takes a `db` handle so it can join the caller's transaction — an invitation
 * for a user whose creation rolled back would be garbage.
 */
export async function issueInvitation(
  db: Database,
  userId: string,
  actorId: string | null,
): Promise<IssuedInvitation> {
  const token = randomToken(TOKEN_BYTES);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

  await db
    .update(invitations)
    .set({ consumedAt: now })
    .where(and(eq(invitations.userId, userId), isNull(invitations.consumedAt)));

  await db.insert(invitations).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    createdBy: actorId,
  });

  /*
   * Roadmap 3.7. Written here rather than at the call site so it cannot drift
   * from the row above — the two happen in one statement pair, inside whatever
   * transaction the caller supplied.
   *
   * `invitedAt` is when an invitation was last ISSUED, deliberately: the email
   * has not even been attempted at this point, and `sendEmail` would only ever
   * report provider acceptance anyway (D-035). Recording issuance also means
   * roadmap 3.8 gets correct "last invited" behaviour for free — a resend calls
   * this function and the timestamp moves with it. See D-040.
   */
  await db.update(users).set({ invitedAt: now }).where(eq(users.id, userId));

  return { token, expiresAt };
}

/**
 * Redeems an invitation and sets the employee's password.
 *
 * Ordering matters and is deliberate:
 *
 *  1. **Look the token up before hashing anything.** argon2 is expensive by
 *     design, so hashing a password for a garbage token would hand an
 *     unauthenticated caller an amplification primitive — the exact shape of
 *     **SEC-005**. A junk token is refused having done one indexed SELECT.
 *  2. **Validate the password** — still cheap.
 *  3. **Hash** — only now, and only for a token that looked redeemable.
 *  4. **Consume atomically, then write.** The check in step 1 is advisory and
 *     racy; the guard is the conditional `UPDATE … WHERE consumed_at IS NULL AND
 *     expires_at > now()`, which the database resolves for exactly one of two
 *     simultaneous callers. Whoever does not get a row back never sets a
 *     password. The invariant is **at most one successful password
 *     establishment per invitation**, and it does not depend on application
 *     timing.
 */
export async function acceptInvitation(
  db: Database,
  token: string,
  newPassword: string,
  req: Request | null,
): Promise<void> {
  const tokenHash = sha256(token);

  // 1 — cheap rejection, no argon2.
  const [candidate] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, tokenHash),
        isNull(invitations.consumedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!candidate) throw badRequest(INVALID);

  // 2 — the existing policy, unchanged.
  const problems = passwordProblems(newPassword);
  if (problems.length > 0) throw unprocessable(`Password ${problems.join(", ")}`);

  // 3 — expensive, and now justified.
  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    const now = new Date();

    // 4 — the real guard. One row, or nobody.
    const claimed = await tx
      .update(invitations)
      .set({ consumedAt: now })
      .where(
        and(
          eq(invitations.tokenHash, tokenHash),
          isNull(invitations.consumedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .returning({ id: invitations.id, userId: invitations.userId });

    const invitation = claimed[0];
    if (!invitation) throw badRequest(INVALID);

    /*
     * The employee must still be a live, active account. A deleted or
     * deactivated one gets the same generic refusal — and because this runs
     * inside the transaction, the consume above rolls back with it, so the link
     * survives a temporary deactivation rather than being silently burned.
     */
    const [account] = await tx
      .select({ id: users.id, email: users.email, status: users.status })
      .from(users)
      .where(and(eq(users.id, invitation.userId), isNull(users.deletedAt)))
      .limit(1);

    if (!account || account.status !== "Active") throw badRequest(INVALID);

    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: now,
        // They chose this password themselves — there is nothing left to force.
        mustChangePassword: false,
        // A wrong-password lockout must not outlive the credential it guarded.
        failedLoginAttempts: 0,
        lockedUntil: null,
        // Roadmap 3.7, in the same statement that establishes the credential.
        inviteAcceptedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, account.id));

    // Same posture as `POST /auth/change-password`: establishing a credential
    // ends every session that predates it.
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(eq(refreshTokens.userId, account.id));

    // No token, raw or hashed, in the summary — audit rows are immutable.
    await recordAuthEvent(
      tx as unknown as Database,
      req,
      "password_changed",
      account.email,
      account.id,
      "Password set from an invitation link",
    );
  });
}
