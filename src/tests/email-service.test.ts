import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv, resetEnvCache, type Env } from "../config/env.js";
import { sendEmail, type EmailDeps } from "../services/email.js";
import { logger } from "../lib/logger.js";

/**
 * EMAIL SERVICE — roadmap task 3.3
 *
 * The claim that matters is the roadmap's own: *"guaranteed non-blocking failure
 * — a mail outage must never fail user creation."* Group C is that claim.
 * `sendEmail` never rejects, so `void sendEmail(...)` in a request path cannot
 * produce an unhandled rejection and cannot fail the request — while a failure
 * is still *reported*, because swallowing it and returning success would be the
 * false-success this codebase refuses (D-004).
 *
 * No network and no database. The provider boundary is one `fetch`, injected —
 * **no real API key, no real send**. `EMAIL_API_KEY` below is a placeholder and
 * group E asserts it never escapes into a log, an error or an outcome.
 */

const SECRET = "re_test_key_that_must_never_be_logged";

const PROD: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
  JWT_ACCESS_SECRET: "access-secret-that-is-definitely-long-enough-x",
  JWT_REFRESH_SECRET: "refresh-secret-that-is-definitely-long-enough-y",
  AADHAAR_PEPPER: "a-real-production-pepper-value-long-enough!!",
  EMAIL_PROVIDER: "resend",
  EMAIL_API_KEY: SECRET,
  EMAIL_FROM: "Rise Next <no-reply@risenext.in>",
  EMAIL_REPLY_TO: "support@risenext.in",
  // Storage added by Task 9.2 (D-072) — production will not boot without it.
  // Placeholders, not credentials; see `storage-service.test.ts`.
  STORAGE_PROVIDER: "s3",
  STORAGE_BUCKET: "risenext-kyc-placeholder",
  STORAGE_REGION: "ap-south-1",
  STORAGE_ACCESS_KEY_ID: "AKIA_PLACEHOLDER_NOT_REAL",
  STORAGE_SECRET_ACCESS_KEY: "placeholder-not-a-real-secret",
};

const DEV_BARE: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://localhost:5432/dev",
  JWT_ACCESS_SECRET: "access-secret-that-is-definitely-long-enough-x",
  JWT_REFRESH_SECRET: "refresh-secret-that-is-definitely-long-enough-y",
  // Required in EVERY environment since Task 13.4 (SEC-007) — there is no
  // default any more, not even in development.
  AADHAAR_PEPPER: "a-development-pepper-that-is-long-enough!!",
};

const prodConfig = (o: NodeJS.ProcessEnv = {}): Env => loadEnv({ ...PROD, ...o });
const devConfig = (o: NodeJS.ProcessEnv = {}): Env => loadEnv({ ...DEV_BARE, ...o });
const devConfigured = (): Env =>
  devConfig({
    EMAIL_PROVIDER: "resend",
    EMAIL_API_KEY: SECRET,
    EMAIL_FROM: "no-reply@risenext.in",
    EMAIL_REPLY_TO: "support@risenext.in",
  });

const MESSAGE = {
  to: "anitha.rao@risenext.com",
  subject: "Your Rise Next account",
  text: "Set your password: https://app.example.com/accept/abc123",
};

/** A `fetch` that never runs — proves the console path makes no request. */
const forbiddenFetch = vi.fn(() => {
  throw new Error("fetch must not be called");
}) as unknown as typeof globalThis.fetch;

const ok = (body: unknown = { id: "re_msg_1" }) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

const fail = (status: number, body = "") =>
  ({ ok: false, status, json: async () => ({}), text: async () => body }) as Response;

/** Deps with an instant clock, so retry tests do not actually wait. */
const deps = (config: Env, fetchImpl: unknown): Partial<EmailDeps> => ({
  config,
  fetch: fetchImpl as typeof globalThis.fetch,
  sleep: async () => {},
});

afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
});
afterAll(() => resetEnvCache());

/* ------------------------------------------------------------------ group A */

describe("A — transport selection", () => {
  it("1. development without configuration uses the console transport", async () => {
    const result = await sendEmail(MESSAGE, deps(devConfig(), forbiddenFetch));

    expect(result).toEqual({ status: "logged", transport: "console" });
  });

  it("2. development WITH configuration uses Resend", async () => {
    const fetchMock = vi.fn(async () => ok());
    const result = await sendEmail(MESSAGE, deps(devConfigured(), fetchMock));

    expect(result.status).toBe("sent");
    expect(result.transport).toBe("resend");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("3. production uses Resend", async () => {
    const fetchMock = vi.fn(async () => ok());
    const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(result).toMatchObject({ status: "sent", transport: "resend", id: "re_msg_1" });
  });

  it("4. production never falls back to the console transport", async () => {
    /*
     * Unreachable in practice — `loadEnv` refuses to boot production without the
     * full configuration (D-034) — so the config is built in development and
     * then relabelled, to reach the guard at all. Silently logging a credential
     * email instead of sending it is the one outcome that must not happen.
     */
    const smuggled = { ...devConfig(), NODE_ENV: "production" } as Env;
    const result = await sendEmail(MESSAGE, deps(smuggled, forbiddenFetch));

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ reason: "Email is not configured in production" });
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });

  it("5. the console transport issues no provider request at all", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendEmail(MESSAGE, deps(devConfig(), fetchMock));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — what reaches the provider", () => {
  /** The JSON body of the first request. The mocks are zero-arg, so the call
   *  tuple is widened before indexing. */
  const callOf = (fetchMock: { mock: { calls: unknown[] } }): [string, { body: string }] =>
    fetchMock.mock.calls[0] as unknown as [string, { body: string }];

  const bodyOf = (fetchMock: { mock: { calls: unknown[] } }) =>
    JSON.parse(callOf(fetchMock)[1].body) as Record<string, unknown>;

  it("6. posts to the provider endpoint with the configured sender", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(callOf(fetchMock)[0]).toBe("https://api.resend.com/emails");
    expect(bodyOf(fetchMock).from).toBe("Rise Next <no-reply@risenext.in>");
  });

  it("7. propagates recipient, subject and text", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));
    const body = bodyOf(fetchMock);

    expect(body.to).toEqual([MESSAGE.to]);
    expect(body.subject).toBe(MESSAGE.subject);
    expect(body.text).toBe(MESSAGE.text);
  });

  it("8. defaults reply-to to EMAIL_REPLY_TO", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(bodyOf(fetchMock).reply_to).toBe("support@risenext.in");
  });

  it("9. lets the caller override reply-to", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendEmail({ ...MESSAGE, replyTo: "security@risenext.in" }, deps(prodConfig(), fetchMock));

    expect(bodyOf(fetchMock).reply_to).toBe("security@risenext.in");
  });

  it("10. sends several recipients as a list", async () => {
    const fetchMock = vi.fn(async () => ok());
    const to = ["a@risenext.in", "b@risenext.in"];
    await sendEmail({ ...MESSAGE, to }, deps(prodConfig(), fetchMock));

    expect(bodyOf(fetchMock).to).toEqual(to);
  });

  it("11. omits html when the caller sends none, rather than sending empty", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect("html" in bodyOf(fetchMock)).toBe(false);
  });

  it("12. includes html when supplied", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendEmail({ ...MESSAGE, html: "<p>hi</p>" }, deps(prodConfig(), fetchMock));

    expect(bodyOf(fetchMock).html).toBe("<p>hi</p>");
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — a mail outage must never fail user creation", () => {
  it("13. does not throw when the provider is unreachable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED api.resend.com");
    });

    // The central claim of task 3.3. `await` must resolve, never reject.
    const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ attempts: 3 });
  });

  it("14. does not throw when the provider returns 500", async () => {
    const fetchMock = vi.fn(async () => fail(500, "upstream boom"));
    const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(result.status).toBe("failed");
  });

  it("15. an ignored call produces no unhandled rejection", async () => {
    // `void sendEmail(...)` is only safe because the promise cannot reject.
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);

    void sendEmail(MESSAGE, deps(prodConfig(), fetchMock));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("16. reports failure rather than reporting success", async () => {
    // Non-blocking must not mean "pretend it worked".
    const fetchMock = vi.fn(async () => fail(500));
    const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(result.status).not.toBe("sent");
    expect(result.status).toBe("failed");
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — retries are bounded, and refusals are not retried", () => {
  it("17. retries a 5xx up to three attempts", async () => {
    const fetchMock = vi.fn(async () => fail(500));
    const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ attempts: 3 });
  });

  it("18. retries a 429", async () => {
    const fetchMock = vi.fn(async () => fail(429));
    await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("19. does NOT retry a 422 — a rejected address is rejected forever", async () => {
    const fetchMock = vi.fn(async () => fail(422, "invalid to field"));
    const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("20. does NOT retry a 401 — a bad key is rejected forever", async () => {
    const fetchMock = vi.fn(async () => fail(401, "invalid api key"));
    await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("21. succeeds on a retry after a transient failure", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call === 1 ? fail(503) : ok();
    });

    const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    expect(result).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("22. backs off between attempts, increasing", async () => {
    const waits: number[] = [];
    const fetchMock = vi.fn(async () => fail(500));
    await sendEmail(MESSAGE, {
      config: prodConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([200, 400]);
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — the API key never escapes this module", () => {
  it("23. is sent as a bearer token and nowhere else in the request", async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    const init = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }])[1];
    expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(init.body).not.toContain(SECRET);
  });

  it("24. never appears in a failure outcome", async () => {
    for (const response of [fail(401, "invalid api key"), fail(500, SECRET)]) {
      const fetchMock = vi.fn(async () => response);
      const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });

  it("25. never appears in a thrown transport error's reported reason", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error(`connect failed using key ${SECRET}`);
    });
    const result = await sendEmail(MESSAGE, deps(prodConfig(), fetchMock));

    // The service must not echo an error message that happens to carry the key.
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("26. never reaches the logger, on success or failure", async () => {
    const lines: unknown[] = [];
    for (const method of ["info", "warn", "error"] as const) {
      vi.spyOn(logger, method).mockImplementation(((...args: unknown[]) => {
        lines.push(args);
      }) as never);
    }

    await sendEmail(MESSAGE, deps(prodConfig(), vi.fn(async () => ok())));
    await sendEmail(MESSAGE, deps(prodConfig(), vi.fn(async () => fail(500))));
    await sendEmail(MESSAGE, deps(devConfig(), forbiddenFetch));

    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain(SECRET);
  });
});

/* ------------------------------------------------------------------ group F */

describe("F — the console transport is honest about not delivering", () => {
  it("27. logs the recipient, subject and body, marked undelivered", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation((() => {}) as never);

    await sendEmail(MESSAGE, deps(devConfig(), forbiddenFetch));

    const [payload, note] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.transport).toBe("console");
    expect(payload.delivered).toBe(false);
    expect(payload.to).toEqual([MESSAGE.to]);
    expect(payload.subject).toBe(MESSAGE.subject);
    // The body is logged in full on purpose: reading the link out of the
    // terminal is the entire reason this transport exists.
    expect(payload.text).toBe(MESSAGE.text);
    expect(note).toContain("NOT sent");
  });

  it("28. returns `logged`, which is not `sent`", async () => {
    const result = await sendEmail(MESSAGE, deps(devConfig(), forbiddenFetch));

    expect(result.status).toBe("logged");
    expect(result.status).not.toBe("sent");
  });
});

/* ------------------------------------------------------------------ group G */

describe("G — malformed input is refused before the provider is called", () => {
  it("29. refuses a recipient that is not an address", async () => {
    const fetchMock = vi.fn(async () => ok());
    const result = await sendEmail({ ...MESSAGE, to: "not-an-address" }, deps(prodConfig(), fetchMock));

    expect(result).toMatchObject({ status: "failed", attempts: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("30. refuses when any one of several recipients is malformed", async () => {
    const fetchMock = vi.fn(async () => ok());
    const result = await sendEmail(
      { ...MESSAGE, to: ["good@risenext.in", "bad"] },
      deps(prodConfig(), fetchMock),
    );

    expect(result.status).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("31. refuses an empty recipient list and an empty subject", async () => {
    const fetchMock = vi.fn(async () => ok());

    expect((await sendEmail({ ...MESSAGE, to: [] }, deps(prodConfig(), fetchMock))).status).toBe(
      "failed",
    );
    expect(
      (await sendEmail({ ...MESSAGE, subject: "   " }, deps(prodConfig(), fetchMock))).status,
    ).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('32. accepts the "Name <address>" recipient form', async () => {
    const fetchMock = vi.fn(async () => ok());
    const result = await sendEmail(
      { ...MESSAGE, to: "Anitha Rao <anitha.rao@risenext.com>" },
      deps(prodConfig(), fetchMock),
    );

    expect(result.status).toBe("sent");
  });
});
