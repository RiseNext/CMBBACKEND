import type { NextFunction, Request, Response } from "express";
import { getDb } from "../db/index.js";
import { AppError, passwordChangeRequired, unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { assertPermission, loadAuthContext, type AuthContext } from "../services/access.js";
import { recordAudit } from "../services/audit.js";
import { logger } from "../lib/logger.js";

function bearerFrom(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Verifies the access token, then re-reads the user's role, permissions and
 * bank assignments from the database on every request. Slightly more expensive
 * than trusting claims in the JWT, and worth it: a revoked permission or a
 * deactivated account takes effect immediately rather than at token expiry.
 *
 * The single place token verification and context loading happen. Both exported
 * middlewares below delegate here, so they can never drift apart on
 * authentication, on the three session gates, or on what lands in `req.auth`.
 */
async function authenticate(req: Request): Promise<AuthContext> {
  const token = bearerFrom(req);
  if (!token) throw unauthorized("Missing bearer token");
  const claims = verifyAccessToken(token);
  const ctx = await loadAuthContext(getDb(), claims.sub);
  req.auth = ctx;
  return ctx;
}

/**
 * THE DEFAULT. Authenticate, then refuse the request if the account is still on
 * an administrator-issued temporary password (SEC-010 / BUG-005).
 *
 * The refusal is deliberately here and not in `loadAuthContext`. That function
 * holds the three *session* gates, whose codes the client treats as "this
 * session is over" (D-020); a forced password change is the opposite — the user
 * needs the session to fix it. Ordering matters and is asserted by test: an
 * account that is both flagged and deactivated still reports `account_inactive`,
 * because `authenticate` raises it first.
 *
 * Path matching was measured and rejected. `requireAuth` is applied by
 * `router.use()` on twelve routers plus the `createScopedResource` factory, so
 * inside it `req.path` is relative to the mount — a literal
 * `"/api/auth/change-password"` comparison never matches, and every flagged user
 * would be locked out of the one route that can unflag them. The exemption is
 * expressed by *which middleware a route chooses*, not by its URL. See D-023.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await authenticate(req);
    if (ctx.mustChangePassword) throw passwordChangeRequired();
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * THE EXCEPTION. Identical to `requireAuth` in every respect except that it
 * permits a session still carrying `mustChangePassword`.
 *
 * Exactly two routes may use this — `GET /api/auth/me` and
 * `POST /api/auth/change-password` — because they are the only ones a flagged
 * account needs in order to stop being flagged. Everything else, including any
 * router added in future, gets the strict default by simply not opting out,
 * so the enforcement fails closed rather than open.
 */
export async function requireAuthAllowPasswordChange(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authenticate(req);
    next();
  } catch (error) {
    next(error);
  }
}

export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Route guard. Always reference PERMISSIONS.*, never a role name. */
/**
 * FAILED AUTHORIZATION LEAVES A TRACE — Task 13.12.
 *
 * `permission_denied` is a declared `AuditAction` (`db/schema/governance.ts`)
 * that **nothing ever wrote**, so a refused attempt to reach another bank's
 * data, or to touch a route above one's role, was invisible: the caller got a
 * 403 and the organisation got no record. During an incident that is the single
 * most useful signal there is — it distinguishes a misconfigured client from
 * someone probing the authorisation boundary, and only the audit trail can.
 *
 * ── WHY THE WRITE IS FIRE-AND-FORGET ────────────────────────────────────────
 *
 * The refusal must reach the caller whether or not the audit row lands. If the
 * insert is awaited and the database is unhealthy, a 403 turns into a hung
 * request or a 500 — a logging failure escalating into an availability failure,
 * and on the *authorisation* path specifically. So the write is dispatched and
 * its failure is logged, never propagated.
 *
 * This is deliberately the opposite trade-off from `recordAudit`, which is
 * awaited inside the caller's transaction (D-060). There the audit row and the
 * write it describes must commit together or not at all. Here there is no write
 * to be atomic with — the operation was refused — so the only question is
 * whether the record is worth a request failure. It is not.
 *
 * ── ONLY AUTHORISATION REFUSALS ─────────────────────────────────────────────
 *
 * `assertPermission` throws `forbidden`; `authOf` throws `unauthorized` when
 * there is no session at all. Only the former is recorded. An unauthenticated
 * request has no actor to attribute and is already covered by `login_failed`,
 * and recording every anonymous 401 would let an unauthenticated caller fill an
 * immutable, unpurgeable table — SEC-002 exactly.
 */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const ctx = authOf(req);
      for (const key of keys) assertPermission(ctx, key);
      next();
    } catch (error) {
      if (error instanceof AppError && error.status === 403) {
        void recordPermissionDenied(req, keys, error);
      }
      next(error);
    }
  };
}

/** Writes the refusal without letting its failure become the caller's. */
function recordPermissionDenied(req: Request, keys: string[], error: AppError): void {
  let ctx: ReturnType<typeof authOf>;
  try {
    ctx = authOf(req);
  } catch {
    return; // no session — nothing to attribute, and see the note above
  }

  void recordAudit(getDb(), ctx, req, {
    action: "permission_denied",
    recordType: "authorization",
    recordId: null,
    summary: `Denied ${req.method} ${req.originalUrl}`,
    metadata: {
      /*
       * The permission KEYS are recorded, not the request body. The body on a
       * refused customer write is full customer PII, and `audit_logs` is
       * trigger-immutable with no retention job (SEC-017) — putting PII from an
       * operation that never happened into a table that can never be purged
       * would be strictly worse than not recording it.
       */
      required: keys.join(", "),
      method: req.method,
      path: req.originalUrl,
      reason: error.code,
    },
  }).catch((err: unknown) => {
    logger.error({ err, path: req.originalUrl }, "Failed to record permission_denied");
  });
}

/** Passes if the caller holds ANY of the listed permissions. */
export function requireAnyPermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const ctx = authOf(req);
      if (!keys.some((k) => ctx.permissions.has(k))) {
        assertPermission(ctx, keys[0] ?? "unknown");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
