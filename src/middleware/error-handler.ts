import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { captureException } from "../lib/observability.js";

interface PostgresError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  customers_bank_reference_unique:
    "A customer with this Bank Reference ID already exists for the selected bank",
  customers_code_unique: "A customer with this code already exists",
  users_email_unique: "A user with this email address already exists",
  users_employee_code_unique: "A user with this employee code already exists",
  banks_code_unique: "A bank with this code already exists",
  teams_name_unique: "A team with this name already exists",
  roles_key_unique: "A role with this key already exists",
};

/**
 * Drizzle wraps driver errors in a DrizzleQueryError, so the pg error code
 * lives on `.cause` (sometimes nested). Without this, every unique-constraint
 * violation surfaces as a 500 instead of a 409.
 */
function rootCause(error: unknown, depth = 0): unknown {
  if (depth > 5 || !error || typeof error !== "object") return error;
  const cause = (error as { cause?: unknown }).cause;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^\d{5}$/.test(code)) return error;
  return cause ? rootCause(cause, depth + 1) : error;
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: "validation_failed",
        message: "The submitted data is not valid",
        details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) logger.error({ err: error, requestId: req.requestId }, error.message);
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details ?? undefined },
    });
    return;
  }

  const pg = rootCause(error) as PostgresError;
  if (pg?.code === "23505") {
    const message = pg.constraint ? CONSTRAINT_MESSAGES[pg.constraint] : undefined;
    res.status(409).json({
      error: {
        code: "conflict",
        message: message ?? "That record already exists",
        details: pg.constraint ? { constraint: pg.constraint } : undefined,
      },
    });
    return;
  }
  if (pg?.code === "23503") {
    res.status(409).json({
      error: { code: "conflict", message: "That record is still referenced by other records" },
    });
    return;
  }

  /*
   * 23514 — check_violation. Task 13.13 / audit U-10.
   *
   * Migration `0014` takes this repository from 4 CHECK constraints to 13.
   * Without a branch here every one of them would turn a data-integrity refusal
   * into a **500 with an error-level stack trace** — a constraint added to make
   * bad data impossible would have become an availability event and a log
   * amplifier, which is the shape SEC-018 was.
   *
   * ── ONLY VOCABULARY CONSTRAINTS MAP TO 4xx, AND THAT IS THE WHOLE POINT ───
   *
   * A CHECK violation is a 4xx **only when the value came from the caller**.
   * Every constraint in this repository named `*_status_check` or
   * `*_stage_check` guards a status vocabulary that a request body supplies, so
   * violating one means the submitted value is not a member — the same class as
   * a failed zod parse, and it gets the same `validation_failed` envelope.
   *
   * Any OTHER check violation is an internal integrity failure the caller did
   * not cause and cannot fix, so it deliberately falls through to the 500 below.
   * `factory-transaction.test.ts` relies on exactly this: it breaks the audit
   * insert by adding a CHECK to `audit_logs`, and a 4xx there would tell the
   * client their input was bad when the server's own audit table is broken.
   *
   * Reaching this branch at all means the service layer's vocabulary and the
   * database's have drifted — every status column is guarded by a zod enum
   * first. The constraint name is therefore LOGGED at `warn` so an operator can
   * see which pair drifted, and deliberately NOT returned: `pg.constraint` is a
   * raw internal identifier, and returning it is SEC-020.
   */
  const VOCABULARY_CHECK = /_(status|stage)_check$/;
  if (pg?.code === "23514" && pg.constraint && VOCABULARY_CHECK.test(pg.constraint)) {
    logger.warn(
      { constraint: pg.constraint, requestId: req.requestId },
      "A status CHECK rejected a write — the service-layer vocabulary and the database have drifted",
    );
    res.status(422).json({
      error: {
        code: "validation_failed",
        message: "The submitted data is not valid",
        details: [{ path: "status", message: "That value is not permitted for this field" }],
      },
    });
    return;
  }

  /*
   * The only place a 500 is produced, so the only place error tracking needs to
   * hook — Task 15.5. Fire-and-forget: a collector outage must not turn a
   * handled 500 into an unhandled rejection, and must not add its timeout to a
   * response the client is already waiting on.
   *
   * The context is **scalars the operator needs to find the request**, and
   * nothing else. No body, no params, no query: a refused customer write
   * carries Aadhaar and PAN, and an error tracker is a third party.
   */
  void captureException(error, {
    scope: "http",
    method: req.method,
    // `req.route?.path` is the PATTERN (`/api/customers/:id`), not the filled
    // URL, so a record id never leaves the process through this field.
    route: (req.route as { path?: string } | undefined)?.path ?? req.baseUrl ?? "unknown",
    requestId: req.requestId,
  });

  logger.error({ err: error, requestId: req.requestId }, "Unhandled error");
  res.status(500).json({
    error: { code: "internal_error", message: "Unexpected server error" },
  });
}
