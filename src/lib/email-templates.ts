import type { EmailMessage } from "../services/email.js";

/**
 * TRANSACTIONAL EMAIL TEMPLATES — roadmap task 3.4.
 *
 * Four messages: employee invitation, password reset, password changed,
 * account deactivated. Each is a **pure function returning an `EmailMessage`**,
 * so `sendEmail(employeeInvitationEmail({...}))` is the whole calling contract.
 *
 * Deliberately in `lib/` rather than `services/`: nothing here does I/O. The
 * repository already splits that way — `services/` reaches a database or a
 * provider, `lib/` (errors, password, permissions, tokens, zod) is pure and
 * directly testable. These read no environment, touch no database, call no
 * provider and make no authorization decision.
 *
 * **Nothing calls them yet.** The invitation flow is 3.5 and password reset is
 * 3.6; wiring is not part of this task.
 *
 * **No values are invented.** The PRD prescribes no copy, and neither the
 * roadmap nor the PRD names an expiry duration or a link. Every dynamic value —
 * URL, expiry, name, timestamp — is a typed input supplied by the caller, so
 * this file cannot promise a behaviour the system has not decided on. In
 * particular there is no hardcoded domain: `FRONTEND_URL` exists in `env.ts`
 * with no consumer, and building a URL from it is the caller's job.
 */

/** The product name as it appears to a recipient. */
const PRODUCT = "Rise Next";

/**
 * Escapes text for an HTML body **and** for a quoted attribute.
 *
 * Employee names reach these templates, so a name containing `<` or `"` must
 * become text rather than markup. Both quote forms are escaped because the same
 * function guards `href="..."`.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A URL is untrusted input even when this codebase built it.
 *
 * Refuses anything that is not `http:` or `https:` — a `javascript:` or `data:`
 * href in a credential email is a phishing primitive, and these links are
 * exactly the ones a recipient has been told to trust.
 */
function assertSafeUrl(url: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field} must be an http(s) URL`);
  }
  return parsed.toString();
}

function required(value: string, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

function requiredPositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number of hours`);
  }
  return value;
}

const hours = (n: number) => (n === 1 ? "1 hour" : `${n} hours`);

/**
 * One shell for all four, so they read as the same sender.
 *
 * Inline styles only, and a table-free single column: an HTML email cannot rely
 * on a stylesheet, flexbox or grid. `paragraphs` and `button` are pre-escaped by
 * their callers — everything reaching here is already safe.
 */
function layout(options: { heading: string; paragraphs: string[]; button?: { href: string; label: string } }): string {
  const body = options.paragraphs
    .map((p) => `      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">${p}</p>`)
    .join("\n");

  const button = options.button
    ? `      <p style="margin:0 0 16px;">
        <a href="${options.button.href}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#ffffff;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;">${options.button.label}</a>
      </p>\n`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border-radius:10px;">
      <p style="margin:0 0 20px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;">${escapeHtml(PRODUCT)}</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#111827;">${options.heading}</h1>
${body}
${button}    </div>
  </body>
</html>`;
}

/* ------------------------------------------------------------- invitation */

export interface EmployeeInvitationData {
  to: string;
  /** The employee's name, as entered. Escaped before it reaches the HTML. */
  name: string;
  /** The single-use setup link. Built by the caller from `FRONTEND_URL`. */
  setupUrl: string;
  /** How long the link is valid. Supplied by the caller — never assumed here. */
  expiresInHours: number;
}

/**
 * Invites a new employee to set their own password.
 *
 * ⚠️ **This template assumes the LINK credential model, and that assumption is
 * not an approved decision.** **OPEN-3** — invitation link vs emailed temporary
 * password — is still open and owned by the project owner. It is built this way
 * because roadmap task **3.5** states the design imperatively: *"Send a
 * single-use, time-limited link rather than a password in an email — a password
 * in an inbox is a permanent credential."* See **D-036**.
 *
 * If OPEN-3 ever resolves the other way, this function is replaced — it is pure
 * and has no callers, so that costs one file and its tests. **Do not read this
 * as OPEN-3 being settled.**
 *
 * No password, temporary or otherwise, appears anywhere in this message.
 */
export function employeeInvitationEmail(data: EmployeeInvitationData): EmailMessage {
  const to = required(data.to, "to");
  const name = required(data.name, "name");
  const url = assertSafeUrl(required(data.setupUrl, "setupUrl"), "setupUrl");
  const validFor = hours(requiredPositive(data.expiresInHours, "expiresInHours"));

  const text = [
    `Hello ${name},`,
    "",
    `An account has been created for you on ${PRODUCT}. Choose your own password to finish setting it up:`,
    "",
    url,
    "",
    `This link can be used once and expires in ${validFor}. If it expires, ask your administrator to send a new one.`,
    "",
    "If you were not expecting this, you can ignore this email — the account cannot be used until the link is opened.",
  ].join("\n");

  return {
    to,
    // No token or credential in the subject — subjects are logged in more places
    // than bodies and are visible on a locked screen.
    subject: `Set up your ${PRODUCT} account`,
    text,
    html: layout({
      heading: `Set up your ${escapeHtml(PRODUCT)} account`,
      paragraphs: [
        `Hello ${escapeHtml(name)},`,
        `An account has been created for you on ${escapeHtml(PRODUCT)}. Choose your own password to finish setting it up.`,
        `This link can be used once and expires in ${escapeHtml(validFor)}. If it expires, ask your administrator to send a new one.`,
        "If you were not expecting this, you can ignore this email — the account cannot be used until the link is opened.",
      ],
      button: { href: escapeHtml(url), label: "Set your password" },
    }),
  };
}

/* --------------------------------------------------------- password reset */

export interface PasswordResetData {
  to: string;
  name: string;
  /** The single-use reset link. Built by the caller. */
  resetUrl: string;
  expiresInHours: number;
}

/**
 * Sent in response to a password-reset request (roadmap 3.6).
 *
 * Says nothing about whether an account exists beyond the fact that this address
 * received the mail — 3.6 requires `forgot-password` to answer 200 regardless,
 * and copy that says "we found your account" would give that away to anyone who
 * can see the inbox.
 */
export function passwordResetEmail(data: PasswordResetData): EmailMessage {
  const to = required(data.to, "to");
  const name = required(data.name, "name");
  const url = assertSafeUrl(required(data.resetUrl, "resetUrl"), "resetUrl");
  const validFor = hours(requiredPositive(data.expiresInHours, "expiresInHours"));

  const text = [
    `Hello ${name},`,
    "",
    `Someone asked to reset the password for your ${PRODUCT} account. Choose a new one here:`,
    "",
    url,
    "",
    `This link can be used once and expires in ${validFor}.`,
    "",
    "If you did not ask for this, no action is needed — your password has not changed.",
  ].join("\n");

  return {
    to,
    subject: `Reset your ${PRODUCT} password`,
    text,
    html: layout({
      heading: `Reset your ${escapeHtml(PRODUCT)} password`,
      paragraphs: [
        `Hello ${escapeHtml(name)},`,
        `Someone asked to reset the password for your ${escapeHtml(PRODUCT)} account. Choose a new one below.`,
        `This link can be used once and expires in ${escapeHtml(validFor)}.`,
        "If you did not ask for this, no action is needed — your password has not changed.",
      ],
      button: { href: escapeHtml(url), label: "Choose a new password" },
    }),
  };
}

/* ------------------------------------------------------- password changed */

export interface PasswordChangedData {
  to: string;
  name: string;
  /** When it changed, already formatted by the caller. Optional. */
  changedAt?: string;
}

/**
 * Confirms a password change. Carries no link and no credential.
 *
 * The closing line says to contact an administrator, which is the truth: there
 * is no self-service account-recovery path, and inventing a "secure your
 * account" URL would promise something the product does not have (**D-004**).
 */
export function passwordChangedEmail(data: PasswordChangedData): EmailMessage {
  const to = required(data.to, "to");
  const name = required(data.name, "name");
  const when = data.changedAt?.trim();

  const text = [
    `Hello ${name},`,
    "",
    when
      ? `The password for your ${PRODUCT} account was changed on ${when}.`
      : `The password for your ${PRODUCT} account was changed.`,
    "",
    "If that was you, nothing further is needed.",
    "",
    "If it was not, contact your administrator immediately — someone else may have access to your account.",
  ].join("\n");

  return {
    to,
    subject: `Your ${PRODUCT} password was changed`,
    text,
    html: layout({
      heading: `Your ${escapeHtml(PRODUCT)} password was changed`,
      paragraphs: [
        `Hello ${escapeHtml(name)},`,
        when
          ? `The password for your ${escapeHtml(PRODUCT)} account was changed on ${escapeHtml(when)}.`
          : `The password for your ${escapeHtml(PRODUCT)} account was changed.`,
        "If that was you, nothing further is needed.",
        "If it was not, contact your administrator immediately — someone else may have access to your account.",
      ],
    }),
  };
}

/* ---------------------------------------------------- account deactivated */

export interface AccountDeactivatedData {
  to: string;
  name: string;
}

/**
 * Tells someone their access has been revoked.
 *
 * States only that access has ended. It gives no reason, because the system does
 * not record one that could be shown here, and no reinstatement promise, because
 * whether that happens is a human decision.
 */
export function accountDeactivatedEmail(data: AccountDeactivatedData): EmailMessage {
  const to = required(data.to, "to");
  const name = required(data.name, "name");

  const text = [
    `Hello ${name},`,
    "",
    `Your access to ${PRODUCT} has been turned off, and you will no longer be able to sign in.`,
    "",
    "Work you recorded remains in the system.",
    "",
    "If you think this is a mistake, contact your administrator.",
  ].join("\n");

  return {
    to,
    subject: `Your ${PRODUCT} access has been turned off`,
    text,
    html: layout({
      heading: `Your ${escapeHtml(PRODUCT)} access has been turned off`,
      paragraphs: [
        `Hello ${escapeHtml(name)},`,
        `Your access to ${escapeHtml(PRODUCT)} has been turned off, and you will no longer be able to sign in.`,
        "Work you recorded remains in the system.",
        "If you think this is a mistake, contact your administrator.",
      ],
    }),
  };
}
