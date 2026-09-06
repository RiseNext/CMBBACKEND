export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);

/**
 * Deliberately identical shape for "you lack the permission" and "that record
 * belongs to a bank you cannot see". Returning 404 for out-of-scope records
 * would leak existence; a distinct message would leak which banks exist.
 */
export const forbidden = (message = "You do not have access to this resource") =>
  new AppError(403, "forbidden", message);

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SESSION-INVALIDATING 403s — BUG-034
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `forbidden` above means "you are signed in and may not do this". These two
 * mean something categorically different: **the session itself is over.** The
 * user is still authenticated in the sense that their token verifies, but the
 * account behind it can no longer act at all, on any endpoint.
 *
 * They keep status 403 — 403 is correct, the caller *is* authenticated — but
 * carry their own `code` so a client can tell the two apart **without parsing
 * the message**. That distinction is the whole of BUG-034: every 403 used to
 * be `code: "forbidden"`, so the frontend could not sign a deactivated user
 * out without also signing out anyone who merely opened a page their role
 * cannot see.
 *
 * Keep these confined to `services/access.ts`'s per-request session gates.
 * An ordinary permission or bank-scope refusal must stay `forbidden`, or the
 * client will start ending sessions for routine browsing — and the demo layer
 * fabricates `forbidden` 403s of its own (SEC-026), which must never log a
 * presenter out mid-walkthrough.
 */

/** The account exists but is no longer `Active`. The session is over. */
export const accountInactive = (message = "Account is not active") =>
  new AppError(403, "account_inactive", message);

/** The account's assigned role has been disabled. The session is over. */
export const roleDisabled = (message = "Assigned role has been disabled") =>
  new AppError(403, "role_disabled", message);

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * WORKFLOW RESTRICTION — SEC-010 / BUG-005
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Deliberately NOT one of the two codes above. Those mean "the session is over";
 * this means "the session is fine, and there is exactly one thing you may do
 * with it". The user needs their session in order to clear the condition, so a
 * client that signed out on this code would make the state unfixable.
 *
 * It must therefore never be added to the frontend's SESSION_ENDED_CODES
 * (`frontend/src/lib/api.ts`), and it must never be raised from
 * `services/access.ts`'s session gates — a frontend test and a backend test each
 * fail if either happens. Raised by `middleware/auth.ts` instead, after the
 * session gates have had their say, so an inactive account still reports
 * `account_inactive` rather than this.
 */

/** The account is on an admin-issued temporary password and must replace it. */
export const passwordChangeRequired = (
  message = "You must change your password before continuing",
) => new AppError(403, "password_change_required", message);

export const notFound = (message = "Record not found") => new AppError(404, "not_found", message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);

export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, "unprocessable_entity", message, details);

export const tooManyRequests = (message = "Too many attempts, try again later") =>
  new AppError(429, "too_many_requests", message);

export const internal = (message = "Unexpected server error") =>
  new AppError(500, "internal_error", message);
