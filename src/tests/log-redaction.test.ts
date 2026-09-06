import { describe, expect, it } from "vitest";
import pino from "pino";
import { CENSOR, isRedactedLogKey, scrub } from "../lib/logger.js";

/**
 * LOG REDACTION AT ANY DEPTH — SEC-019, Task 15.7.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * `logger.ts` used pino `redact` paths of the form `*.password`, and **a pino
 * `*` matches exactly one intervening level**. So the pattern covered
 * `x.password` and missed `req.body.password` — depth three, and the single
 * most likely shape for the leak the comment claimed to prevent. It also missed
 * `err.request.body.password` and `audit.changes.pan`, the last of which
 * `services/audit.ts` logs wholesale on its own failure path.
 *
 * ── HOW THIS FILE PROVES THE FIX ────────────────────────────────────────────
 *
 * Group A works on `scrub` directly, which is quick to read. **Group B is the
 * one that matters**: it builds a synthetic nested payload of the exact shape a
 * careless handler would produce, pushes it through a **real pino instance**
 * writing to a captured stream, and asserts the emitted JSON line contains
 * none of the values. Testing `scrub` alone would prove a pure function works
 * while saying nothing about whether it is wired into the logger — which is
 * precisely the gap that let SEC-019 exist behind a comment claiming otherwise.
 *
 * Group C pins the deliberate NON-redactions. Over-redaction is not a free win:
 * a log in which the actor and the record are both `[redacted]` is unusable
 * during an incident, and an unusable log is one somebody turns off.
 */

/** A pino instance writing into an array, so the emitted line can be read. */
function capturingLogger() {
  const lines: string[] = [];
  const instance = pino(
    {
      level: "debug",
      formatters: { log: (object) => scrub(object) as Record<string, unknown> },
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
        censor: CENSOR,
      },
    },
    {
      write(chunk: string) {
        lines.push(chunk);
      },
    },
  );
  return { instance, lines, last: () => lines.at(-1) ?? "" };
}

/**
 * The payload a careless handler produces: a whole request, with the body
 * nested inside it, and a customer nested inside that.
 */
const NESTED_REQUEST = {
  req: {
    id: "req-123",
    method: "PATCH",
    url: "/api/customers/abc",
    headers: {
      authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIGNATURE",
      cookie: "rn_refresh=THE-REFRESH-TOKEN",
      "user-agent": "Mozilla/5.0",
    },
    body: {
      name: "Priya Raman",
      email: "priya@example.com",
      password: "SuperSecret123!",
      customer: {
        aadhaar: "999912345678",
        aadhaarLast4: "5678",
        pan: "ABCDE1234F",
        mobile: "9848000000",
        dob: "1990-04-12",
        bank: {
          accountNo: "50100123456789",
          ifsc: "HDFC0001234",
          nominee: { fatherName: "Raman Iyer", address: "4th floor, MG Road" },
        },
      },
    },
  },
};

/** Every value above that must never appear in a log line. */
const SECRETS = [
  "SuperSecret123!",
  "eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIGNATURE",
  "THE-REFRESH-TOKEN",
  "999912345678",
  "ABCDE1234F",
  "9848000000",
  "1990-04-12",
  "50100123456789",
  "HDFC0001234",
  "Raman Iyer",
  "4th floor, MG Road",
];

/* ══ A — the walker ═══════════════════════════════════════════════════════ */

describe("A · scrub redacts by key name at any depth", () => {
  it("1. THE FINDING: a depth-3 password is redacted", async () => {
    // `req.body.password`. The old `*.password` pattern matched exactly one
    // intervening level and let this through.
    const out = scrub({ req: { body: { password: "hunter2" } } }) as {
      req: { body: { password: string } };
    };
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(out.req.body.password).toBe(CENSOR);
  });

  it("2. …and so is a depth-6 one", async () => {
    const deep = { a: { b: { c: { d: { e: { aadhaar: "999912345678" } } } } } };
    expect(JSON.stringify(scrub(deep))).not.toContain("999912345678");
  });

  it("3. it reaches through arrays", async () => {
    const batch = { rows: [{ raw: { pan: "ABCDE1234F" } }, { raw: { pan: "ZZZZZ9999Z" } }] };
    const text = JSON.stringify(scrub(batch));
    expect(text).not.toContain("ABCDE1234F");
    expect(text).not.toContain("ZZZZZ9999Z");
  });

  it("4. matching is case-insensitive, because keys arrive in three casings", async () => {
    // `passwordHash`, `password_hash` and `PasswordHash` all occur in this
    // codebase's own vocabulary.
    for (const key of ["passwordHash", "password_hash", "PASSWORD", "AadhaarHash"]) {
      expect(isRedactedLogKey(key)).toBe(true);
    }
  });

  it("5. the input object is NOT mutated — a log call must not change the caller's data", async () => {
    const original = { req: { body: { password: "hunter2" } } };
    scrub(original);
    expect(original.req.body.password).toBe("hunter2");
  });

  it("6. a cyclic object is handled rather than crashing the logger", async () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => scrub(cyclic)).not.toThrow();
    expect(JSON.stringify(scrub(cyclic))).toContain("[circular]");
  });

  it("7. depth is bounded, so a pathological object cannot hang a log call", async () => {
    let deep: Record<string, unknown> = { password: "leaf" };
    for (let i = 0; i < 100; i += 1) deep = { nested: deep };
    const text = JSON.stringify(scrub(deep));
    expect(text).toContain("[truncated]");
    expect(text).not.toContain("leaf");
  });

  it("8. primitives and null pass through untouched", async () => {
    expect(scrub(null)).toBeNull();
    expect(scrub(42)).toBe(42);
    expect(scrub("plain")).toBe("plain");
  });
});

/* ══ B — the real logger, end to end ══════════════════════════════════════ */

describe("B · a synthetic nested PII payload emits none of its values", () => {
  it("9. THE PROOF: every secret in a nested request body is absent from the line", async () => {
    const { instance, last } = capturingLogger();
    instance.info(NESTED_REQUEST, "Handling a customer update");

    const line = last();
    expect(line.length).toBeGreaterThan(0);
    for (const secret of SECRETS) {
      expect(line, `"${secret}" reached the log sink`).not.toContain(secret);
    }
  });

  it("10. and the line is still USEFUL — the label survives", async () => {
    // Over-redaction is not a free win. A log where the actor and the record
    // are both [redacted] is one somebody turns off.
    const { instance, last } = capturingLogger();
    instance.info(NESTED_REQUEST, "Handling a customer update");

    const line = last();
    expect(line).toContain("req-123");
    expect(line).toContain("/api/customers/abc");
    expect(line).toContain("Priya Raman");
    expect(line).toContain("Handling a customer update");
  });

  it("11. the audit-failure shape is covered — `logger.error({ err, audit })`", async () => {
    // `services/audit.ts` logs the whole `AuditInput` when a write fails, and
    // `changes` is where customer PII lives. Depth 4.
    const { instance, last } = capturingLogger();
    instance.error(
      {
        err: new Error("audit write failed"),
        audit: {
          action: "updated",
          recordType: "customer",
          changes: { pan: { from: "AAAAA1111A", to: "BBBBB2222B" } },
        },
      },
      "Failed to write audit log",
    );

    const line = last();
    expect(line).not.toContain("AAAAA1111A");
    expect(line).not.toContain("BBBBB2222B");
    // The error itself is still reported.
    expect(line).toContain("audit write failed");
  });

  it("12. an error carrying a body on a custom field is covered too", async () => {
    // `AppError.details` and driver errors both attach arbitrary objects.
    const { instance, last } = capturingLogger();
    const error = Object.assign(new Error("upstream failed"), {
      request: { body: { newPassword: "NotInTheLog!1" } },
    });
    instance.error({ err: error }, "Unhandled error");
    expect(last()).not.toContain("NotInTheLog!1");
  });

  it("13. environment-shaped objects are covered — a config dump leaks nothing", async () => {
    const { instance, last } = capturingLogger();
    instance.debug(
      {
        config: {
          NODE_ENV: "production",
          DATABASE_URL: "postgres://u:p@host/db",
          JWT_ACCESS_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          AADHAAR_PEPPER: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          EMAIL_API_KEY: "re_live_deadbeef",
          STORAGE_SECRET_ACCESS_KEY: "cccccccccccccccccccccccc",
        },
      },
      "Configuration",
    );

    const line = last();
    for (const secret of [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "re_live_deadbeef",
      "cccccccccccccccccccccccc",
    ]) {
      expect(line, `${secret} reached the log`).not.toContain(secret);
    }
    // NODE_ENV is not a secret and is exactly what an operator needs.
    expect(line).toContain("production");
  });

  it("14. the three credential HEADERS are redacted by both mechanisms", async () => {
    const { instance, last } = capturingLogger();
    instance.info(
      { req: { headers: { authorization: "Bearer AAA", cookie: "rn_refresh=BBB" } } },
      "Request",
    );
    const line = last();
    expect(line).not.toContain("Bearer AAA");
    expect(line).not.toContain("rn_refresh=BBB");
  });
});

/* ══ C — the deliberate non-redactions ════════════════════════════════════ */

describe("C · what is kept, on purpose", () => {
  it("15. `email` and `name` are NOT redacted — they are the label, not the payload", async () => {
    // Same line `services/audit.ts` draws. An audit trail or a log in which
    // "someone changed something about someone" is the whole content is worse
    // than useless during an investigation.
    expect(isRedactedLogKey("email")).toBe(false);
    expect(isRedactedLogKey("name")).toBe(false);
    expect(isRedactedLogKey("city")).toBe(false);
    expect(isRedactedLogKey("code")).toBe(false);
  });

  it("16. `aadhaarLast4` is kept — four digits carry no reconstruction risk", async () => {
    expect(isRedactedLogKey("aadhaarLast4")).toBe(false);
    const line = JSON.stringify(scrub({ customer: { aadhaarLast4: "5678" } }));
    expect(line).toContain("5678");
  });

  it("17. ids are kept, because an id with no record is a log you cannot follow", async () => {
    for (const key of ["id", "userId", "bankId", "recordId", "requestId", "loanId"]) {
      expect(isRedactedLogKey(key)).toBe(false);
    }
  });
});
