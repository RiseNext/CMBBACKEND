import { describe, expect, it, vi } from "vitest";
import {
  accountDeactivatedEmail,
  employeeInvitationEmail,
  escapeHtml,
  passwordChangedEmail,
  passwordResetEmail,
} from "../lib/email-templates.js";
import { sendEmail } from "../services/email.js";
import { loadEnv } from "../config/env.js";

/**
 * EMAIL TEMPLATES — roadmap task 3.4
 *
 * Four pure functions. No database, no network, no environment, no clock — a
 * template that reached any of those would not be testable like this, and group
 * F asserts it stays that way.
 *
 * Group B is the one that matters most. Employee names reach these messages, so
 * a name containing markup must arrive as **text**, and a link must be a real
 * `http(s)` URL — a `javascript:` href in a credential email is a phishing
 * primitive aimed at exactly the message a recipient has been told to trust.
 *
 * On the invitation: it is built for the **link** model, which **OPEN-3 has not
 * approved**. See D-036 and the note in group A. These tests deliberately assert
 * that no password is present rather than asserting a link model is correct
 * forever — if OPEN-3 resolves the other way, the template is replaced and so
 * are they.
 */

const INVITE = {
  to: "anitha.rao@risenext.com",
  name: "Anitha Rao",
  setupUrl: "https://app.risenext.in/accept-invite?token=abc123",
  expiresInHours: 48,
};

const RESET = {
  to: "anitha.rao@risenext.com",
  name: "Anitha Rao",
  resetUrl: "https://app.risenext.in/reset-password?token=xyz789",
  expiresInHours: 1,
};

const ALL = () => [
  employeeInvitationEmail(INVITE),
  passwordResetEmail(RESET),
  passwordChangedEmail({ to: INVITE.to, name: INVITE.name, changedAt: "4 September 2026 at 10:15 IST" }),
  accountDeactivatedEmail({ to: INVITE.to, name: INVITE.name }),
];

/* ------------------------------------------------------------------ group A */

describe("A — each template produces a usable message", () => {
  it("1. every template returns recipient, subject, text and html", () => {
    for (const message of ALL()) {
      expect(message.to).toBe(INVITE.to);
      expect(message.subject.trim().length).toBeGreaterThan(0);
      expect(message.text.trim().length).toBeGreaterThan(0);
      expect(message.html?.trim().length).toBeGreaterThan(0);
    }
  });

  it("2. subjects are distinct and describe the message", () => {
    const subjects = ALL().map((m) => m.subject);

    expect(new Set(subjects).size).toBe(4);
    expect(subjects[0]).toContain("Set up your");
    expect(subjects[1]).toContain("Reset your");
    expect(subjects[2]).toContain("was changed");
    expect(subjects[3]).toContain("turned off");
  });

  it("3. the text part stands on its own — a reader who never sees HTML can act", () => {
    // The link must be readable as text, not only clickable in the HTML part.
    expect(employeeInvitationEmail(INVITE).text).toContain(INVITE.setupUrl);
    expect(passwordResetEmail(RESET).text).toContain(RESET.resetUrl);
  });

  it("4. the invitation carries a link and NO password", () => {
    /*
     * OPEN-3 is unresolved. What this pins is the property that matters either
     * way: this message never contains a credential. It is built for the link
     * model on roadmap 3.5's instruction (D-036), not on an approved decision.
     */
    const message = employeeInvitationEmail(INVITE);
    const body = `${message.subject} ${message.text} ${message.html}`;

    expect(message.text).toContain(INVITE.setupUrl);
    expect(body).not.toMatch(/temporary password|your password is|password:/i);
  });

  it("5. dynamic values appear — name and expiry", () => {
    const message = employeeInvitationEmail(INVITE);

    expect(message.text).toContain("Anitha Rao");
    expect(message.text).toContain("48 hours");
    expect(message.html).toContain("48 hours");
  });

  it("6. singular expiry reads correctly", () => {
    expect(passwordResetEmail(RESET).text).toContain("1 hour");
    expect(passwordResetEmail(RESET).text).not.toContain("1 hours");
  });

  it("7. the optional changed-at is included when given and omitted when not", () => {
    const withTime = passwordChangedEmail({ to: INVITE.to, name: INVITE.name, changedAt: "4 September 2026" });
    const without = passwordChangedEmail({ to: INVITE.to, name: INVITE.name });

    expect(withTime.text).toContain("4 September 2026");
    expect(without.text).toContain("was changed.");
    expect(without.text).not.toContain("undefined");
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — untrusted input cannot become markup or a script", () => {
  const HOSTILE = 'Anitha "><script>alert(1)</script> Rao';

  it("8. escapes a name containing markup in the HTML part", () => {
    const message = employeeInvitationEmail({ ...INVITE, name: HOSTILE });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("9. escapes the quote that would break out of an attribute", () => {
    const message = employeeInvitationEmail({ ...INVITE, name: HOSTILE });

    expect(message.html).toContain("&quot;");
    // The raw sequence that would close the heading and open a tag.
    expect(message.html).not.toContain('"><script');
  });

  it("10. escapes hostile names in every template", () => {
    const messages = [
      employeeInvitationEmail({ ...INVITE, name: HOSTILE }),
      passwordResetEmail({ ...RESET, name: HOSTILE }),
      passwordChangedEmail({ to: INVITE.to, name: HOSTILE }),
      accountDeactivatedEmail({ to: INVITE.to, name: HOSTILE }),
    ];

    for (const message of messages) {
      expect(message.html).not.toContain("<script>");
    }
  });

  it("11. leaves the text part unescaped — it is not markup", () => {
    // Escaping the plain-text part would show the reader "&lt;" literally.
    const message = passwordChangedEmail({ to: INVITE.to, name: "O'Brien & Sons" });

    expect(message.text).toContain("O'Brien & Sons");
    expect(message.text).not.toContain("&amp;");
  });

  it("12. refuses a javascript: link", () => {
    // A hostile href in a credential email is a phishing primitive.
    expect(() =>
      employeeInvitationEmail({ ...INVITE, setupUrl: "javascript:alert(1)" }),
    ).toThrow(/http\(s\) URL/);
  });

  it("13. refuses a data: link and a relative one", () => {
    expect(() =>
      passwordResetEmail({ ...RESET, resetUrl: "data:text/html;base64,PHNjcmlwdD4=" }),
    ).toThrow(/http\(s\) URL/);
    expect(() => passwordResetEmail({ ...RESET, resetUrl: "/reset?token=x" })).toThrow(
      /absolute URL/,
    );
  });

  it("14. escapes a URL containing an attribute-breaking character", () => {
    const message = employeeInvitationEmail({
      ...INVITE,
      setupUrl: 'https://app.risenext.in/accept?token=a"onmouseover="alert(1)',
    });

    expect(message.html).not.toContain('"onmouseover="');
  });

  it("15. escapeHtml covers the five characters that matter", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — missing or invalid data fails clearly", () => {
  it("16. requires a recipient and a name", () => {
    expect(() => employeeInvitationEmail({ ...INVITE, to: "" })).toThrow(/to is required/);
    expect(() => employeeInvitationEmail({ ...INVITE, name: "   " })).toThrow(/name is required/);
  });

  it("17. requires the link", () => {
    expect(() => employeeInvitationEmail({ ...INVITE, setupUrl: "" })).toThrow(
      /setupUrl is required/,
    );
    expect(() => passwordResetEmail({ ...RESET, resetUrl: "" })).toThrow(/resetUrl is required/);
  });

  it("18. requires a positive expiry rather than inventing one", () => {
    // The roadmap says "time-limited" and names no duration, so the caller must.
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => employeeInvitationEmail({ ...INVITE, expiresInHours: bad })).toThrow(
        /positive number of hours/,
      );
    }
  });

  it("19. names the field that is wrong", () => {
    expect(() => passwordResetEmail({ ...RESET, resetUrl: "nonsense" })).toThrow(/resetUrl/);
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — no secret is added that the caller did not supply", () => {
  it("20. no template embeds an API key or any credential of its own", () => {
    for (const message of ALL()) {
      const body = `${message.subject} ${message.text} ${message.html}`;
      expect(body).not.toMatch(/re_[A-Za-z0-9]{8,}/);
      expect(body).not.toMatch(/EMAIL_API_KEY|Authorization|Bearer /);
    }
  });

  it("21. the token stays out of every subject", () => {
    // Subjects surface on lock screens and in more logs than bodies do.
    expect(employeeInvitationEmail(INVITE).subject).not.toContain("abc123");
    expect(passwordResetEmail(RESET).subject).not.toContain("xyz789");
  });

  it("22. the notification templates carry no link at all", () => {
    const messages = [
      passwordChangedEmail({ to: INVITE.to, name: INVITE.name }),
      accountDeactivatedEmail({ to: INVITE.to, name: INVITE.name }),
    ];

    for (const message of messages) {
      expect(message.html).not.toContain("<a href");
      expect(message.text).not.toMatch(/https?:\/\//);
    }
  });

  it("23. no template invents a domain of its own", () => {
    // `FRONTEND_URL` has no consumer; building a URL is the caller's job.
    for (const message of ALL()) {
      const urls = `${message.text} ${message.html}`.match(/https?:\/\/[^\s"'<]+/g) ?? [];
      for (const url of urls) {
        expect(url.startsWith("https://app.risenext.in")).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — the output is what sendEmail accepts", () => {
  it("24. a rendered template sends through the real service contract", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "re_1" }),
      text: async () => "{}",
    })) as unknown as typeof globalThis.fetch;

    const config = loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
      JWT_ACCESS_SECRET: "access-secret-that-is-definitely-long-enough-x",
      JWT_REFRESH_SECRET: "refresh-secret-that-is-definitely-long-enough-y",
      AADHAAR_PEPPER: "a-real-production-pepper-value-long-enough!!",
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "re_placeholder_not_a_real_key",
      EMAIL_FROM: "no-reply@risenext.in",
      EMAIL_REPLY_TO: "support@risenext.in",
      // Storage added by Task 9.2 (D-072) — production will not boot without it.
      STORAGE_PROVIDER: "s3",
      STORAGE_BUCKET: "risenext-kyc-placeholder",
      STORAGE_REGION: "ap-south-1",
      STORAGE_ACCESS_KEY_ID: "AKIA_PLACEHOLDER_NOT_REAL",
      STORAGE_SECRET_ACCESS_KEY: "placeholder-not-a-real-secret",
    });

    const result = await sendEmail(employeeInvitationEmail(INVITE), {
      config,
      fetch: fetchMock,
      sleep: async () => {},
    });

    expect(result.status).toBe("sent");
  });

  it("25. every template passes the service's own recipient validation", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "re_1" }),
      text: async () => "{}",
    })) as unknown as typeof globalThis.fetch;

    const config = loadEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://localhost:5432/dev",
      JWT_ACCESS_SECRET: "access-secret-that-is-definitely-long-enough-x",
      JWT_REFRESH_SECRET: "refresh-secret-that-is-definitely-long-enough-y",
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "re_placeholder_not_a_real_key",
      EMAIL_FROM: "no-reply@risenext.in",
      EMAIL_REPLY_TO: "support@risenext.in",
      // Storage added by Task 9.2 (D-072) — production will not boot without it.
      STORAGE_PROVIDER: "s3",
      STORAGE_BUCKET: "risenext-kyc-placeholder",
      STORAGE_REGION: "ap-south-1",
      STORAGE_ACCESS_KEY_ID: "AKIA_PLACEHOLDER_NOT_REAL",
      STORAGE_SECRET_ACCESS_KEY: "placeholder-not-a-real-secret",
  // Required in EVERY environment since Task 13.4 (SEC-007) — there is no
  // default any more, not even in development.
  AADHAAR_PEPPER: "a-development-pepper-that-is-long-enough!!",
});

    for (const message of ALL()) {
      const result = await sendEmail(message, { config, fetch: fetchMock, sleep: async () => {} });
      expect(result.status).toBe("sent");
    }
  });
});

/* ------------------------------------------------------------------ group F */

describe("F — templates are pure", () => {
  it("26. rendering issues no network request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    ALL();

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("27. the same input renders the same output, twice", () => {
    // No clock, no randomness, no environment read.
    expect(employeeInvitationEmail(INVITE)).toEqual(employeeInvitationEmail(INVITE));
    expect(accountDeactivatedEmail({ to: INVITE.to, name: INVITE.name })).toEqual(
      accountDeactivatedEmail({ to: INVITE.to, name: INVITE.name }),
    );
  });

  it("28. rendering does not mutate its input", () => {
    const input = { ...INVITE };
    employeeInvitationEmail(input);

    expect(input).toEqual(INVITE);
  });

  it("29. the module imports no database and no provider", async () => {
    // A template that reached either would not be testable without a harness.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../lib/email-templates.ts", import.meta.url), "utf8"),
    );

    expect(source).not.toMatch(/from "\.\.\/db\//);
    expect(source).not.toMatch(/getDb|drizzle|resend|api\.resend\.com/i);
    expect(source).not.toMatch(/process\.env|env\(\)/);
  });
});
