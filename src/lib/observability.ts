import { logger } from "./logger.js";

/**
 * ERROR TRACKING — Task 15.5.
 *
 * ── WHY THIS IS NOT THE SENTRY SDK ──────────────────────────────────────────
 *
 * D-006 forbids new dependencies without a reason, and D-035 already settled
 * the shape of this problem once: the email service sends to Resend with
 * `fetch` and `node:crypto` rather than pulling in an SDK, because the whole
 * integration is one POST. The same is true here.
 *
 * More importantly, an SDK would be **untestable in this repository**. There is
 * no account, no DSN and no network, so a Sentry integration written here could
 * only ever be asserted to compile. What can be written honestly is a transport
 * with a defined payload, proven by tests, that points at whatever collector
 * the operator configures — Sentry behind a relay, Better Stack, Highlight, or
 * a plain endpoint. The **external wiring is explicitly a human setup step**
 * and is listed as one; nothing here claims an event has ever been received.
 *
 * ── TRANSPORTS ──────────────────────────────────────────────────────────────
 *
 * `console` — the default, and what already happens today: a structured `error`
 * line through pino, which Railway's log drain collects. It is not *nothing*,
 * and pretending otherwise would understate the current state as badly as
 * overstating it.
 *
 * `webhook` — active only when `ERROR_TRACKING_URL` is set. One POST of a JSON
 * envelope, optionally bearing `ERROR_TRACKING_TOKEN`.
 *
 * ── WHAT MAY LEAVE THE PROCESS, AND WHAT MAY NOT ────────────────────────────
 *
 * This is a lending system holding Aadhaar, PAN and bank account numbers, and
 * an error tracker is a **third party**. So the envelope is built from an
 * allow-list, not by serialising an object and hoping:
 *
 *   · `name`, `message` and `stack` from the error;
 *   · scalar context values only — a `Record<string, string | number | boolean>`
 *     that callers populate with ids and route names, never records;
 *   · `service`, `environment`, `release`, `timestamp`.
 *
 * Two specific removals, both from measurement rather than caution:
 *
 *   1. **`pg` error `detail`.** A unique-violation from Postgres reads
 *      `Key (mobile)=(9848000000) already exists.` — the *value* is in the
 *      error. `detail`, `where`, `internalQuery` and `query` are stripped.
 *   2. **`cause` chains are not walked.** A wrapped driver error drags the
 *      whole connection string along with it.
 *
 * `captureException` **never throws and never awaits**. A tracker outage must
 * not turn a handled 500 into an unhandled rejection, and must not add latency
 * to the request that failed. That is the same guarantee `sendEmail` gives and
 * for the same reason (D-035).
 */

export type ErrorTransport = "console" | "webhook";

/** Scalars only. A caller cannot accidentally pass a customer row. */
export type ErrorContext = Record<string, string | number | boolean | null | undefined>;

interface Envelope {
  service: string;
  environment: string;
  release: string | null;
  timestamp: string;
  error: { name: string; message: string; stack: string | null };
  context: Record<string, string | number | boolean>;
}

/** Fields on a `pg` error that can carry row VALUES. Never transmitted. */
const UNSAFE_ERROR_FIELDS = ["detail", "where", "internalQuery", "query", "cause"] as const;

const SERVICE = "risenext-crm-backend";

/** Read lazily from `process.env`, so this module needs no boot-time config. */
function settings() {
  return {
    url: process.env.ERROR_TRACKING_URL?.trim() || null,
    token: process.env.ERROR_TRACKING_TOKEN?.trim() || null,
    environment: process.env.NODE_ENV ?? "unknown",
    release: process.env.RELEASE_SHA?.trim() || null,
    timeoutMs: Number(process.env.ERROR_TRACKING_TIMEOUT_MS ?? 3000),
  };
}

export function errorTransport(): ErrorTransport {
  return settings().url ? "webhook" : "console";
}

/** True when a collector is configured. Reported by the readiness probe. */
export const errorTrackingConfigured = (): boolean => Boolean(settings().url);

function describe(error: unknown): Envelope["error"] {
  if (error instanceof Error) {
    /*
     * Read the three safe fields explicitly rather than spreading. A `pg` error
     * carries `detail` holding the offending row values, and spreading would
     * ship it. `UNSAFE_ERROR_FIELDS` names them so the reason is greppable.
     */
    void UNSAFE_ERROR_FIELDS;
    return {
      name: error.name,
      message: error.message,
      stack: typeof error.stack === "string" ? error.stack.slice(0, 8_000) : null,
    };
  }
  return { name: "NonError", message: String(error).slice(0, 2_000), stack: null };
}

/** Drops anything that is not a scalar, so an object cannot slip through. */
function safeContext(context: ErrorContext): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = typeof value === "string" ? value.slice(0, 500) : value;
    }
  }
  return out;
}

export function buildEnvelope(error: unknown, context: ErrorContext = {}): Envelope {
  const config = settings();
  return {
    service: SERVICE,
    environment: config.environment,
    release: config.release,
    timestamp: new Date().toISOString(),
    error: describe(error),
    context: safeContext(context),
  };
}

/**
 * Reports an error to the configured collector.
 *
 * Fire-and-forget by design; the returned promise is for tests and resolves to
 * the transport that handled it. Callers do not await it.
 */
export function captureException(error: unknown, context: ErrorContext = {}): Promise<ErrorTransport> {
  const config = settings();
  const envelope = buildEnvelope(error, context);

  if (!config.url) {
    // The console transport IS the log line the caller usually also writes.
    // Logging at `debug` avoids doubling every 500 in the log while keeping the
    // envelope inspectable when someone turns the level up.
    logger.debug({ envelope }, "Error captured (no collector configured)");
    return Promise.resolve("console");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  return fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify(envelope),
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) {
        // Status only. A collector's response body is third-party text and has
        // no business in this log.
        logger.warn({ status: response.status }, "Error tracker rejected an event");
      }
      return "webhook" as const;
    })
    .catch(() => {
      /*
       * Swallowed deliberately, and the reason is NOT included — a transport
       * error message can carry the collector URL, and the token is on the same
       * request. The same scrubbing rule `services/email.ts` applies to Resend.
       */
      logger.warn("Error tracker unreachable");
      return "webhook" as const;
    })
    .finally(() => clearTimeout(timer));
}
