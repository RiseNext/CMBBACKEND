import { Router, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { refreshTokens, roles, users } from "../db/schema/index.js";
import { env } from "../config/env.js";
import { forbidden, notFound, unauthorized, unprocessable } from "../lib/errors.js";
import { hashPassword, passwordProblems, sha256, verifyPassword } from "../lib/password.js";
import {
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/tokens.js";
import { authOf, requireAuth, requireAuthAllowPasswordChange } from "../middleware/auth.js";
import { loadAuthContext } from "../services/access.js";
import { acceptInvitation } from "../services/invitations.js";
import { requestPasswordReset, resetPassword, PASSWORD_RESET_TTL_HOURS } from "../services/password-reset.js";
import { rateLimit, withHashSlot } from "../middleware/rate-limit.js";
import { recordAuthEvent } from "../services/audit.js";
import { randomUUID } from "node:crypto";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().min(3).max(255),
  password: z.string().min(1).max(512),
});

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

/*
 * LOGIN IS THROTTLED ON TWO AXES — SEC-005, Task 13.1.
 *
 * `POST /api/auth/login` is the route SEC-005 names first and the one Task 3.6
 * could not cover. It was completely unthrottled: an anonymous caller could
 * drive unlimited argon2id verifications, and each one is memory-hard by
 * design.
 *
 * **Per address** stops one host hammering the whole login surface.
 * **Per account** stops a *distributed* attempt at one inbox — which per-IP
 * limiting cannot see, because every request comes from somewhere new. Only
 * both together answer the finding.
 *
 * The account limiter keys on the **normalised** address, so `A@x.com` and
 * `a@x.com ` share a bucket; otherwise case and whitespace are a trivial
 * bypass. It opts OUT (`null`) when the body carries no usable address, because
 * bucketing every malformed request under one key would let junk exhaust a real
 * user's allowance — a denial of service built out of the defence.
 *
 * 20 per 15 minutes per address is far above human use and far below useful
 * for guessing; the account lockout at 8 failures (below) is the tighter of the
 * two for a real target, and this bounds the *cost* of reaching it.
 *
 * Neither limiter reveals anything: both answer the same uninformative 429 for
 * an address that exists and one that does not, so SEC-004 stays closed.
 */
const loginIpLimit = rateLimit({ name: "login-ip", windowMs: 15 * 60 * 1000, max: 20 });

const loginAccountLimit = rateLimit({
  name: "login-account",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFor: (req) => {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof raw !== "string") return null;
    const normalised = raw.trim().toLowerCase();
    return normalised.length > 0 ? normalised : null;
  },
});

async function issueSession(req: Request, res: Response, userId: string) {
  const db = getDb();
  const ctx = await loadAuthContext(db, userId);

  const jti = randomUUID();
  const refresh = signRefreshToken({ sub: userId, jti });
  const expiresAt = new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(refresh),
    expiresAt,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
  });

  const access = signAccessToken({
    sub: userId,
    email: ctx.email,
    roleId: ctx.roleId,
    roleKey: ctx.roleKey,
    roleLevel: ctx.roleLevel,
  });

  res.cookie(REFRESH_COOKIE_NAME, refresh, refreshCookieOptions());
  return { access, ctx };
}

function profileOf(ctx: Awaited<ReturnType<typeof loadAuthContext>>) {
  return {
    id: ctx.userId,
    name: ctx.name,
    email: ctx.email,
    role: { id: ctx.roleId, key: ctx.roleKey, name: ctx.roleName, level: ctx.roleLevel },
    permissions: [...ctx.permissions].sort(),
    bankIds: ctx.bankIds,
    unrestrictedBankAccess: ctx.bankIds === null,
    // Carried on the profile, not just the login response, so a page reload
    // cannot drop the client out of the forced password change.
    mustChangePassword: ctx.mustChangePassword,
  };
}

/**
 * POST /api/auth/login
 *
 * Note what is absent: the client does not tell us which role it wants. The
 * demo frontend let the user pick from a dropdown; the role now comes from the
 * user record and nowhere else.
 */
authRouter.post("/login", loginIpLimit, loginAccountLimit, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const db = getDb();
    const normalised = email.trim().toLowerCase();

    const [account] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        failedLoginAttempts: users.failedLoginAttempts,
        lockedUntil: users.lockedUntil,
        roleActive: roles.isActive,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.email, normalised), isNull(users.deletedAt)))
      .limit(1);

    const now = new Date();
    const locked = Boolean(account?.lockedUntil && account.lockedUntil > now);

    /*
     * ── THE LOCKOUT WINDOW HAS ELAPSED, SO THE COUNTER RESETS — SEC-006 ─────
     *
     * Task 13.3. `failedLoginAttempts` used to be cleared on **successful login
     * only**. Once it reached MAX_FAILED_ATTEMPTS the account was locked for 15
     * minutes, and then the very next wrong password computed
     * `account.failedLoginAttempts + 1` from a counter still sitting at 8 — so
     * it re-locked immediately. One request every 15 minutes, from an
     * unauthenticated attacker who needs only a valid email address, kept any
     * account permanently unreachable. The victim could not recover by waiting,
     * because waiting is exactly what the attacker was waiting for.
     *
     * Serving out the lockout is what earns the reset. `expired` is computed
     * from the row we already read, so this costs no extra query.
     */
    const lockExpired = Boolean(account?.lockedUntil && account.lockedUntil <= now);
    const priorAttempts = lockExpired ? 0 : (account?.failedLoginAttempts ?? 0);

    /*
     * ── NO ENUMERATION ORACLE — SEC-004, Task 13.2 ─────────────────────────
     *
     * A locked account used to answer **429** while an unknown address answered
     * **401**. Only a real account can be locked, so the status code alone
     * confirmed existence — no password required, and the 8 failures needed to
     * induce the lock are cheap. Registration is admin-only, so an enumerated
     * list of live corporate addresses is directly useful for phishing.
     *
     * A locked account now answers with the **identical 401** an unknown address
     * gets. The lockout still holds — the password is never checked below — but
     * it is no longer observable from outside. `recordAuthEvent` still records
     * the true reason, because the audit log is not the attacker's to read.
     *
     * `tooManyRequests` is deliberately no longer thrown here. Throttling is
     * SEC-005's job (Task 13.1) and belongs in front of the handler, where a 429
     * is a statement about the *caller*, not about the account.
     */
    if (locked) {
      await recordAuthEvent(db, req, "login_failed", normalised, account!.id, "Account locked");
      throw unauthorized("Invalid email or password");
    }

    /*
     * Always run a verification so response timing does not reveal whether the
     * address exists. The dummy hash below is a real argon2id digest.
     *
     * `withHashSlot` is SEC-005's other half — Task 13.1. That timing-equalising
     * dummy verification means EVERY login attempt, including one for an address
     * that does not exist, costs a full argon2id hash. Unbounded concurrency
     * there is a memory-exhaustion primitive that no per-source counter can see.
     * Over the cap a request WAITS rather than failing, so a legitimate user in
     * a burst is slowed, not refused — and waiting reveals nothing about the
     * address, so SEC-004 stays closed.
     */
    const hash = account?.passwordHash ?? DUMMY_HASH;
    const ok = await withHashSlot(() => verifyPassword(hash, password));

    if (!account || !ok) {
      if (account) {
        const attempts = priorAttempts + 1;
        await db
          .update(users)
          .set({
            failedLoginAttempts: attempts,
            lockedUntil:
              attempts >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
                : null,
          })
          .where(eq(users.id, account.id));
      }
      await recordAuthEvent(db, req, "login_failed", normalised, account?.id ?? null, "Bad credentials");
      throw unauthorized("Invalid email or password");
    }

    if (account.status !== "Active") throw forbidden("Account is not active");
    if (!account.roleActive) throw forbidden("Assigned role has been disabled");

    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, account.id));

    const { access, ctx } = await issueSession(req, res, account.id);
    await recordAuthEvent(db, req, "login_succeeded", ctx.email, ctx.userId, "Signed in");

    res.json({
      accessToken: access,
      expiresIn: env().ACCESS_TOKEN_TTL,
      mustChangePassword: account.mustChangePassword,
      user: profileOf(ctx),
    });
  } catch (error) {
    next(error);
  }
});

/** A fixed argon2id hash of a random string, used only for timing equalisation. */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zdGF0aWMtc2FsdA$3Ppw0kZ0i0Nn2m1S8kQmVJv0k1r3sPqZ8Xa9Yb0cDeE";

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (!cookie) throw unauthorized("No refresh token");

    const claims = verifyRefreshToken(cookie);
    const db = getDb();
    const tokenHash = sha256(cookie);

    const [stored] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Reuse of a revoked token is treated as compromise: kill every session.
      if (stored?.revokedAt) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.userId, claims.sub));
      }
      throw unauthorized("Session expired");
    }

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    const { access, ctx } = await issueSession(req, res, claims.sub);
    res.json({ accessToken: access, expiresIn: env().ACCESS_TOKEN_TTL, user: profileOf(ctx) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    const db = getDb();
    let revokedFor: string | null = null;

    if (cookie) {
      /*
       * LOGOUT IS AUDITED — Task 13.12.
       *
       * `logout` is a declared `AuditAction` (`db/schema/governance.ts`) that
       * **nothing ever wrote**. Login success and failure were both recorded,
       * so the audit trail could show a session beginning and never ending —
       * which makes "was this session still open at 02:00?" unanswerable during
       * an incident, exactly when it is asked.
       *
       * `returning()` gives the owning user, so the row names WHO logged out.
       * Without it the actor would be null: this route carries no `requireAuth`
       * (it authenticates by cookie), so there is no `AuthContext` to read.
       */
      const [revoked] = await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, sha256(cookie)))
        .returning({ userId: refreshTokens.userId });
      revokedFor = revoked?.userId ?? null;
    }

    /*
     * Only a token that actually existed is recorded. A logout with no cookie,
     * or with one already revoked, revoked nothing — writing a row for it would
     * let an anonymous caller fill the immutable audit table at will, which is
     * SEC-002's shape one route over.
     */
    if (revokedFor) {
      await recordAuthEvent(db, req, "logout", "", revokedFor, "Signed out");
    }

    res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------- sessions */

/**
 * ACTIVE SESSIONS — Task 12.8.
 *
 * The settings screen used to list **three hardcoded devices dated 2024**, each
 * with a "Sign out" button that raised a success toast and revoked nothing.
 * Wave 1 deleted the table and named this row as its owner. `refresh_tokens`
 * has held the real data since the first migration — hashed, rotating, with
 * reuse detection — and no route ever exposed it.
 *
 * ── WHAT IS RETURNED, AND WHAT IS DELIBERATELY NOT INVENTED ─────────────────
 *
 * Four columns exist and all four are real: `created_at`, `expires_at`,
 * `user_agent` and `ip_address`. They are returned as they are stored.
 *
 * There is **no device name, no browser name, no city and no "last active"**.
 * The rows carry none of those. A user agent could be parsed into "Chrome on
 * Windows", but it is a self-reported header that any client may set to
 * anything, so rendering it as an identified device would state as fact
 * something the server cannot know — and on a security screen, whose entire
 * purpose is deciding what to revoke, that is the worst place to guess. The UI
 * shows the string and says where it came from. Likewise "last active": a
 * refresh token records when it was **issued**, and rotation replaces the row,
 * so `created_at` is the last time this session refreshed — which is what it is
 * labelled, rather than being dressed up as activity.
 *
 * The token hash never leaves the server. `current` is derived by comparing the
 * caller's own refresh cookie against each row's hash, so the screen can mark
 * "this device" without the client ever seeing a token digest.
 *
 * ── SELF-SERVICE ONLY ───────────────────────────────────────────────────────
 *
 * Both routes are scoped to the caller's own `user_id`, with no permission key
 * and no `?userId=`. Administrative revocation of somebody else's sessions is a
 * different capability with different authorization (it would need the role
 * hierarchy, as every other route that acts on a person does), and inventing it
 * here to fill out a screen would be widening the permission model by accident.
 * An administrator already has a supported path: `POST
 * /api/users/:id/reset-password` revokes every session for that user.
 */
authRouter.get("/sessions", requireAuth, async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    const currentHash = cookie ? sha256(cookie) : null;

    const rows = await getDb()
      .select({
        id: refreshTokens.id,
        tokenHash: refreshTokens.tokenHash,
        createdAt: refreshTokens.createdAt,
        expiresAt: refreshTokens.expiresAt,
        userAgent: refreshTokens.userAgent,
        ipAddress: refreshTokens.ipAddress,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, ctx.userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(refreshTokens.createdAt));

    res.json({
      // `tokenHash` is compared here and dropped — it is the credential digest
      // and must not reach a client.
      data: rows.map(({ tokenHash, ...row }) => ({
        ...row,
        current: currentHash !== null && tokenHash === currentHash,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/auth/sessions/:id — revoke one session for real.
 *
 * The `user_id` predicate is part of the UPDATE, not a check before it, so
 * another user's session id cannot be revoked even under a race. A row that
 * does not exist, belongs to somebody else, or is already revoked all answer
 * **404** identically: distinguishing them would turn this into an oracle for
 * which session ids exist.
 *
 * Revoking the session you are sitting in is allowed and clears the cookie, so
 * the next refresh fails rather than silently continuing. The access token
 * already issued stays valid until it expires — that is inherent to stateless
 * access tokens and is why the copy on the screen says sessions end at the next
 * refresh rather than instantly.
 */
authRouter.delete("/sessions/:id", requireAuth, async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = z.string().uuid().parse(req.params.id);
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    const db = getDb();

    const [revoked] = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.id, id),
          eq(refreshTokens.userId, ctx.userId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ tokenHash: refreshTokens.tokenHash });

    if (!revoked) throw notFound("Session not found");

    await recordAuthEvent(db, req, "logout", ctx.email, ctx.userId, "Revoked a session");

    if (cookie && sha256(cookie) === revoked.tokenHash) {
      res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/*
 * The two routes below use `requireAuthAllowPasswordChange` rather than the
 * strict default: an account on a temporary password must be able to see who it
 * is and replace the password, and nothing else (SEC-010 / D-023). Every other
 * authenticated route in the API keeps `requireAuth` and is therefore closed to
 * a flagged session.
 *
 * `/login`, `/refresh` and `/logout` need no exemption because they carry no
 * `requireAuth` at all — they authenticate by credential or by cookie.
 */
authRouter.get("/me", requireAuthAllowPasswordChange, (req, res) => {
  res.json({ user: profileOf(authOf(req)) });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

authRouter.post("/change-password", requireAuthAllowPasswordChange, async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const db = getDb();

    const [account] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    if (!account || !(await verifyPassword(account.passwordHash, currentPassword))) {
      throw unauthorized("Current password is incorrect");
    }

    const problems = passwordProblems(newPassword);
    if (problems.length > 0) throw unprocessable(`Password ${problems.join(", ")}`);

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.userId));

    // Force re-authentication everywhere else.
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, ctx.userId));

    await recordAuthEvent(db, req, "password_changed", ctx.email, ctx.userId, "Password changed");
    res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/**
 * Redeem an invitation and set a password — roadmap 3.5.
 *
 * **Public and credential-granting.** It carries no `requireAuth`, by necessity:
 * the whole point is that the employee has no credential yet. That makes it the
 * most security-sensitive route in the application, and the reasoning lives in
 * `services/invitations.ts` — one generic failure for every unusable token, an
 * atomic conditional consume, and no argon2 work before the token is known to
 * be plausible.
 *
 * **204, with no body.** Nothing about the account is returned — not the name,
 * not the email, not the role. A public endpoint that echoed user fields back
 * would confirm which addresses have pending invitations to anyone holding a
 * guessed token. The employee signs in afterwards through the normal flow; no
 * session is created here.
 */
/**
 * The same limiter guards `accept-invite`. It predates this middleware (Task
 * 3.5 shipped before it existed) and is the third public credential-granting
 * endpoint; leaving one of the three unguarded once the mechanism exists would
 * be an inconsistency rather than a decision. Its allowance matches
 * `reset-password` — both redeem a token someone was legitimately sent.
 */
const acceptInviteLimit = rateLimit({ name: "accept-invite", windowMs: 15 * 60 * 1000, max: 10 });

const acceptInviteSchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(1).max(512),
});

authRouter.post("/accept-invite", acceptInviteLimit, async (req, res, next) => {
  try {
    const { token, password } = acceptInviteSchema.parse(req.body);
    await acceptInvitation(getDb(), token, password, req);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------ self-service reset (3.6) */

/**
 * The rate limits roadmap 3.6 asks for — *"Single-use, expiring, **rate-limited**
 * tokens"*. Focused on the credential endpoints, not an application-wide
 * framework: **SEC-005** stays open and Phase 13 still owes the general fix.
 *
 * `forgot-password` is the tighter of the two because it *sends mail* for an
 * anonymous caller. Unthrottled it is a mail-bomb primitive aimed at a third
 * party's inbox, and it would drain the Resend free tier's 100/day (D-033) in
 * under a minute.
 */
const forgotPasswordLimit = rateLimit({ name: "forgot-password", windowMs: 15 * 60 * 1000, max: 5 });
const resetPasswordLimit = rateLimit({ name: "reset-password", windowMs: 15 * 60 * 1000, max: 10 });

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

/**
 * Ask for a reset link. **Always 204, whatever happens.**
 *
 * Unknown address, soft-deleted account, deactivated account, disabled role,
 * provider outage — every one of them ends here identically, because the
 * roadmap requires this endpoint never to confirm whether an address exists.
 * The service does the eligibility work and reports nothing back; there is
 * deliberately no branch here to give a different answer.
 */
authRouter.post("/forgot-password", forgotPasswordLimit, async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    await requestPasswordReset(getDb(), email, req);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(1).max(512),
});

/**
 * Redeem a reset link. Public, credential-granting, and 204 with no body — the
 * same posture as `accept-invite`, for the same reason: a response carrying
 * user fields would confirm an account to anyone holding a guessed token.
 *
 * No session is created. Signing in afterwards is the normal flow.
 */
authRouter.post("/reset-password", resetPasswordLimit, async (req, res, next) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await resetPassword(getDb(), token, password, req);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Exposed so the reset page can say how long the link lasts without guessing. */
export const passwordResetTtlHours = PASSWORD_RESET_TTL_HOURS;
