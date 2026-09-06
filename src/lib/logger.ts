import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");

/**
 * WHAT MAY NEVER REACH A LOG SINK — SEC-019, Task 15.7.
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────
 *
 * The previous configuration used pino `redact` paths of the form `*.password`.
 * **A pino `*` matches exactly one intervening level.** So `password` was
 * redacted at `something.password` and *not* at `req.body.password`, which is
 * depth three and the single most likely shape for such a leak. Nor at
 * `err.request.body.password`. Nor at `audit.changes.pan`, which
 * `services/audit.ts` logs wholesale on its own failure path.
 *
 * The comment promised "even if a handler logs a whole request body, these
 * never reach the log sink". That was the intent and it was not true.
 *
 * ── WHY A WALKER RATHER THAN MORE PATHS ─────────────────────────────────────
 *
 * The remediation SEC-019 suggested — enumerate the concrete deep paths — fixes
 * today's shapes and fails on tomorrow's. `req.body.customer.aadhaar` is depth
 * four; a batch is depth five; an array puts a numeric index in the middle.
 * There is no finite list of paths, and a list that is nearly right is worse
 * than none because it reads as coverage.
 *
 * So redaction is **by key name at any depth**, applied in `formatters.log` to
 * every object that is logged. Depth and node budgets keep it bounded, and a
 * `WeakSet` makes a cyclic object safe rather than fatal.
 *
 * ── WHAT IS DELIBERATELY *NOT* REDACTED, AND WHY ────────────────────────────
 *
 * `email`, `name`, `city`, `state`, `code`, and every id. This is the same line
 * `services/audit.ts` draws and for the same reason: they are the *label* the
 * log line is about. An incident log in which the actor is `[redacted]` acting
 * on `[redacted]` is not a privacy win, it is an unusable log — and the failure
 * mode of an unusable log during an incident is that somebody turns redaction
 * off. The line is drawn at values that **identify or authenticate a person on
 * their own**, or that are regulated identifiers.
 *
 * `aadhaarLast4` is likewise kept: four digits carry no reconstruction risk and
 * they are how an operator recognises a record.
 *
 * ── WHAT THIS STILL DOES NOT SOLVE ──────────────────────────────────────────
 *
 * Recorded rather than smoothed over: a **free-text** field can contain
 * anything. If an operator types a PAN into a bank-order `remarks` and a
 * handler logs the row, no key-based rule can catch it. That is the same
 * residual `services/audit.ts` records for SEC-017, and it is why `LOG_LEVEL`
 * must stay at `info` in production — `debug` widens what is logged at all.
 */
const REDACTED_KEYS = new Set(
  [
    // ── credentials and tokens ──
    "password",
    "passwordhash",
    "password_hash",
    "currentpassword",
    "newpassword",
    "confirmpassword",
    "token",
    "tokenhash",
    "token_hash",
    "refreshtoken",
    "accesstoken",
    "replacedbytokenhash",
    "replaced_by_token_hash",
    "secret",
    "apikey",
    "api_key",
    "authorization",
    "cookie",
    "set-cookie",
    "jwt_access_secret",
    "jwt_refresh_secret",
    "email_api_key",
    "aadhaar_pepper",
    "storage_secret_access_key",
    "storage_access_key_id",
    "error_tracking_token",
    "bootstrap_superadmin_password",

    // ── regulated identifiers ──
    "aadhaar",
    "aadhaarhash",
    "aadhaar_hash",
    "pan",
    "gstin",
    "voterid",
    "voter_id",
    "passportno",
    "passport_no",
    "drivinglicence",
    "driving_licence",

    // ── contact details, which identify a person on their own ──
    "mobile",
    "altmobile",
    "alt_mobile",
    "phone",
    "spocphone",
    "address",
    "pincode",

    // ── financial instruments ──
    "accountno",
    "account_no",
    "ifsc",
    "upiid",
    "upi_id",

    // ── personal attributes ──
    "dob",
    "fathername",
    "father_name",
    "mothername",
    "mother_name",
  ].map((key) => key.toLowerCase()),
);

export const CENSOR = "[redacted]";

/** Bounds, so a pathological object cannot turn a log call into a hang. */
const MAX_DEPTH = 12;
const MAX_NODES = 5_000;

/** True when a key must never have its value logged, at any depth. */
export const isRedactedLogKey = (key: string): boolean =>
  REDACTED_KEYS.has(key.toLowerCase());

/**
 * Returns a redacted copy. The input is never mutated — a log call must not
 * change the object the caller is still using.
 */
export function scrub(value: unknown): unknown {
  let nodes = 0;
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH || nodes > MAX_NODES) return "[truncated]";
    if (input === null || typeof input !== "object") return input;

    // A cycle is a bug in the caller, not a reason to crash the logger.
    if (seen.has(input)) return "[circular]";
    seen.add(input);
    nodes += 1;

    if (Array.isArray(input)) return input.map((item) => walk(item, depth + 1));

    /*
     * `Error` needs handling by name, and getting this wrong is easy: `name`,
     * `message` and `stack` are **non-enumerable**, so `Object.entries` on an
     * Error returns only whatever was attached to it. Walking one like a plain
     * object therefore produces `{}` and **destroys the error message** — which
     * is exactly what the first cut of this walker did, and what case 11 in
     * `log-redaction.test.ts` caught.
     *
     * The three standard fields are read explicitly and the enumerable extras
     * — `AppError.details`, a driver error's attached request — are still
     * walked, so a body hidden on a custom field is scrubbed.
     */
    if (input instanceof Error) {
      const extras: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(input)) {
        extras[key] = isRedactedLogKey(key) ? CENSOR : walk(child, depth + 1);
      }
      return { type: input.name, message: input.message, stack: input.stack, ...extras };
    }

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
      out[key] = isRedactedLogKey(key) ? CENSOR : walk(child, depth + 1);
    }
    return out;
  };

  return walk(value, 0);
}

export const logger = pino({
  level,
  formatters: {
    /*
     * Runs on every logged object, after pino's serializers. This is the whole
     * of the SEC-019 fix: path patterns cannot express "at any depth", and a
     * walker can.
     */
    log(object) {
      return scrub(object) as Record<string, unknown>;
    },
  },
  /*
   * The header paths are KEPT as well as walked. `req`/`res` are handled by
   * pino-http's serializers, which run before `formatters.log`, and belt and
   * braces on the three headers that carry a live credential costs nothing.
   */
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
    ],
    censor: CENSOR,
  },
});
