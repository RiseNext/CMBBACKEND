import {
  emailTransport,
  env,
  isEmailAddress,
  missingEmailConfig,
  type EmailTransport,
  type Env,
} from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * TRANSACTIONAL EMAIL — roadmap task 3.3.
 *
 * One module. Nothing outside this file knows the provider is Resend (**D-033**);
 * callers see `sendEmail` and an outcome, and swapping providers is a change
 * here and in the `EMAIL_PROVIDER` enum, nowhere else.
 *
 * **`sendEmail` never throws.** That is the whole point of the roadmap's
 * *"guaranteed non-blocking failure — a mail outage must never fail user
 * creation"*. `POST /api/users` already does real work in a transaction, and a
 * Resend outage must not stop the business creating employees: a third party
 * taking down a core workflow is worse than no email at all. Because it cannot
 * reject, `void sendEmail(...)` is safe — there is no unhandled rejection to
 * leak — and a caller that wants the outcome can await it.
 *
 * **Failure is reported, not swallowed.** The outcome is a discriminated union,
 * so `failed` is distinguishable from `sent` and a caller can never mistake an
 * outage for delivery (**D-004**). What it does *not* do is convert a provider
 * error into an HTTP error — transport concerns stay here and the caller decides
 * how to surface them.
 *
 * **No SDK.** The backend has no HTTP-client dependency and makes no outbound
 * request anywhere else; Resend's send is one POST and Node has `fetch`. Adding
 * the first HTTP dependency to the repository — on the path that carries the API
 * key — was not worth ~20 lines. See D-035.
 *
 * Not here, deliberately: templates (3.4), the invitation flow (3.5), password
 * reset (3.6), and any queue. This sends a message it is handed.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Bounded, and small: this can sit in a request path. */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

export interface EmailMessage {
  /** One address, or several. `user@example.com` or `Name <user@example.com>`. */
  to: string | string[];
  subject: string;
  /** Always required — a text part is what makes mail readable everywhere. */
  text: string;
  html?: string;
  /** Defaults to `EMAIL_REPLY_TO`. */
  replyTo?: string;
}

export type EmailOutcome =
  | { status: "sent"; transport: "resend"; id: string | null; attempts: number }
  | { status: "logged"; transport: "console" }
  | { status: "failed"; transport: EmailTransport; attempts: number; reason: string };

/** Seams for tests. Nothing outside this module supplies them. */
export interface EmailDeps {
  config: Env;
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const recipients = (to: string | string[]): string[] => (Array.isArray(to) ? to : [to]);

/** Retry a transport failure or a server-side one. Never retry a refusal. */
const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/**
 * Sends one message. **Never throws** — see the module note.
 *
 * @returns `sent` when the provider accepted it, `logged` when the console
 * transport recorded it instead, `failed` when it could not be handed over.
 * `sent` means *accepted for delivery*, not delivered; nothing here can know
 * whether it reached an inbox.
 */
export async function sendEmail(
  message: EmailMessage,
  overrides: Partial<EmailDeps> = {},
): Promise<EmailOutcome> {
  /*
   * A blanket net, and deliberately blanket.
   *
   * The retry loop already turns provider failures into a `failed` outcome, but
   * "never throws" has to be true of the WHOLE function or callers cannot rely
   * on it — and `void sendEmail(...)` in a request path relies on it completely.
   * Anything unexpected in here (a logger that throws, a malformed config, a
   * serialisation failure) must still come back as an outcome rather than
   * escaping into a route and failing employee creation, which is exactly what
   * roadmap 3.3 forbids. Found by a Task 3.5 test that made the logger throw.
   */
  try {
    return await send(message, overrides);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "failed", transport: "console", attempts: 0, reason };
  }
}

async function send(
  message: EmailMessage,
  overrides: Partial<EmailDeps> = {},
): Promise<EmailOutcome> {
  const config = overrides.config ?? env();
  const doFetch = overrides.fetch ?? globalThis.fetch;
  const sleep = overrides.sleep ?? defaultSleep;

  const transport = emailTransport(config);
  const to = recipients(message.to);

  // Validation first: a malformed recipient is the caller's bug, and reporting
  // it beats letting the provider reject it three times over.
  if (to.length === 0) {
    return { status: "failed", transport, attempts: 0, reason: "No recipient was supplied" };
  }
  const malformed = to.filter((address) => !isEmailAddress(address));
  if (malformed.length > 0) {
    return {
      status: "failed",
      transport,
      attempts: 0,
      reason: `Not an email address: ${malformed.join(", ")}`,
    };
  }
  if (!message.subject.trim()) {
    return { status: "failed", transport, attempts: 0, reason: "Subject is empty" };
  }

  if (transport === "console") {
    /*
     * Production can never reach this: `loadEnv` refuses to boot without the
     * full email configuration (**D-034**). If it somehow does, that is a defect
     * and the honest answer is a failure — silently logging a credential email
     * instead of sending it is exactly the false success this codebase refuses.
     */
    if (config.NODE_ENV === "production") {
      logger.error(
        { missing: missingEmailConfig(config) },
        "Email is unconfigured in production — refusing to fall back to the console transport",
      );
      return {
        status: "failed",
        transport,
        attempts: 0,
        reason: "Email is not configured in production",
      };
    }

    /*
     * The body IS logged here, in full. This transport exists so a developer can
     * read the invitation link out of their terminal, and truncating it would
     * make it useless. It is unreachable outside development and test, and the
     * real transport below logs metadata only.
     */
    logger.info(
      {
        transport: "console",
        delivered: false,
        to,
        subject: message.subject,
        replyTo: message.replyTo ?? config.EMAIL_REPLY_TO ?? null,
        text: message.text,
      },
      "[console transport] email NOT sent — no provider is configured",
    );
    return { status: "logged", transport: "console" };
  }

  return sendViaResend(message, to, { config, fetch: doFetch, sleep });
}

/**
 * The only place Resend exists.
 *
 * `EMAIL_API_KEY` goes into the Authorization header and nowhere else — not into
 * a log line, not into a returned reason, not into a thrown error. The provider's
 * own response body is echoed back as a reason, so a 422 about a bad address
 * stays readable, and Resend does not repeat the key in it.
 */
async function sendViaResend(
  message: EmailMessage,
  to: string[],
  deps: EmailDeps,
): Promise<EmailOutcome> {
  const { config, fetch: doFetch, sleep } = deps;

  /*
   * Everything below echoes text this module did not write — a provider response
   * body, or a transport error's message — into a reason the caller will see and
   * log. Neither should ever contain the API key, but "should" is not a control.
   * This makes the guarantee structural instead of a bet on what Resend and
   * undici put in their strings. Two tests supply a key-bearing response and a
   * key-bearing error and assert it does not survive.
   */
  const scrub = (text: string): string =>
    config.EMAIL_API_KEY ? text.split(config.EMAIL_API_KEY).join("[redacted]") : text;

  const payload = {
    from: config.EMAIL_FROM,
    to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    reply_to: message.replyTo ?? config.EMAIL_REPLY_TO,
  };

  let lastReason = "Unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.EMAIL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { id?: string } | null;
        logger.info(
          { transport: "resend", to, subject: message.subject, id: body?.id ?? null, attempt },
          "Email accepted by the provider",
        );
        return { status: "sent", transport: "resend", id: body?.id ?? null, attempts: attempt };
      }

      const detail = await response.text().catch(() => "");
      lastReason = scrub(`Provider responded ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);

      if (!isRetryableStatus(response.status)) {
        // A rejected address or a bad key is rejected identically forever.
        logger.warn(
          { transport: "resend", to, subject: message.subject, status: response.status, attempt },
          "Email refused by the provider — not retrying",
        );
        return { status: "failed", transport: "resend", attempts: attempt, reason: lastReason };
      }
    } catch (error) {
      // A transport failure: DNS, TLS, socket, timeout. Worth another attempt.
      lastReason = scrub(error instanceof Error ? error.message : String(error));
    }

    if (attempt < MAX_ATTEMPTS) {
      logger.warn(
        { transport: "resend", to, subject: message.subject, attempt, reason: lastReason },
        "Email attempt failed — retrying",
      );
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }

  logger.error(
    { transport: "resend", to, subject: message.subject, attempts: MAX_ATTEMPTS, reason: lastReason },
    "Email could not be delivered — giving up",
  );
  return { status: "failed", transport: "resend", attempts: MAX_ATTEMPTS, reason: lastReason };
}
