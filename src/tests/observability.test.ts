import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEnvelope,
  captureException,
  errorTrackingConfigured,
  errorTransport,
} from "../lib/observability.js";

/**
 * ERROR TRACKING — Task 15.5.
 *
 * ── WHAT THIS FILE CAN AND CANNOT PROVE ─────────────────────────────────────
 *
 * There is no error-tracking account and no network here, so **nothing in this
 * repository can show that a real collector received an event.** That is a
 * human setup step and is listed as one. What *can* be proven, and is:
 *
 *   · the transport is chosen from configuration and defaults to not sending;
 *   · the envelope carries what an operator needs and **nothing regulated**;
 *   · a collector outage cannot turn a handled 500 into an unhandled rejection.
 *
 * ── GROUP B IS THE POINT ────────────────────────────────────────────────────
 *
 * An error tracker is a **third party**, and this system holds Aadhaar, PAN and
 * bank account numbers. The envelope is therefore built from an allow-list, and
 * group B pushes the two shapes that actually leak — a `pg` error whose
 * `detail` contains the offending row value, and a caller that passes an object
 * as context — and asserts neither reaches the wire.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.ERROR_TRACKING_URL;
  delete process.env.ERROR_TRACKING_TOKEN;
  vi.unstubAllGlobals();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

/** Captures what would have been POSTed, without a network. */
function captureFetch(response: Partial<Response> = { ok: true, status: 202 }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response as Response;
    }),
  );
  return calls;
}

const bodyOf = (calls: { init: RequestInit }[]) =>
  JSON.parse(String(calls[0]!.init.body)) as Record<string, never>;

/* ══ A — transport selection ══════════════════════════════════════════════ */

describe("A · the transport is chosen from configuration", () => {
  it("1. with no collector configured it does NOT send", async () => {
    // The default must be silence on the wire, not a best-effort POST to
    // somewhere unset.
    const calls = captureFetch();
    expect(errorTransport()).toBe("console");
    expect(errorTrackingConfigured()).toBe(false);

    await captureException(new Error("nothing configured"));
    expect(calls).toHaveLength(0);
  });

  it("2. with ERROR_TRACKING_URL set it POSTs once, to that URL", async () => {
    process.env.ERROR_TRACKING_URL = "https://collector.example/ingest";
    const calls = captureFetch();

    expect(errorTransport()).toBe("webhook");
    await captureException(new Error("boom"));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://collector.example/ingest");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("3. the token is sent as a bearer, and only when set", async () => {
    process.env.ERROR_TRACKING_URL = "https://collector.example/ingest";
    let calls = captureFetch();
    await captureException(new Error("no token"));
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();

    process.env.ERROR_TRACKING_TOKEN = "tok_abc";
    calls = captureFetch();
    await captureException(new Error("with token"));
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok_abc");
  });
});

/* ══ B — what may leave the process ═══════════════════════════════════════ */

describe("B · the envelope is an allow-list, because a tracker is a third party", () => {
  it("4. THE GUARD: a pg error's `detail` — which holds the ROW VALUE — is not sent", async () => {
    // A unique violation from Postgres reads
    //   `Key (mobile)=(9848000000) already exists.`
    // The customer's phone number is inside the error object.
    process.env.ERROR_TRACKING_URL = "https://collector.example/ingest";
    const calls = captureFetch();

    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "customers_mobile_unique",
      detail: "Key (mobile)=(9848000000) already exists.",
      where: "SQL statement \"INSERT INTO customers ...\"",
    });
    await captureException(pgError, { scope: "http" });

    const raw = String(calls[0]!.init.body);
    expect(raw).not.toContain("9848000000");
    expect(raw).not.toContain("Key (mobile)");
    // The part an operator actually needs is still there.
    expect(raw).toContain("duplicate key value violates unique constraint");
  });

  it("5. a `cause` chain is not walked — it drags the connection string along", async () => {
    process.env.ERROR_TRACKING_URL = "https://collector.example/ingest";
    const calls = captureFetch();

    const wrapped = new Error("query failed", {
      cause: new Error("connect ECONNREFUSED postgres://user:hunter2@db.example:5432/crm"),
    });
    await captureException(wrapped);

    expect(String(calls[0]!.init.body)).not.toContain("hunter2");
  });

  it("6. non-scalar context is DROPPED, so a caller cannot pass a customer row", async () => {
    process.env.ERROR_TRACKING_URL = "https://collector.example/ingest";
    const calls = captureFetch();

    await captureException(new Error("x"), {
      requestId: "req-1",
      // @ts-expect-error — the type forbids this; the runtime must too, because
      // a type is not a guarantee at a trust boundary.
      customer: { aadhaar: "999912345678", pan: "ABCDE1234F" },
    });

    const raw = String(calls[0]!.init.body);
    expect(raw).not.toContain("999912345678");
    expect(raw).not.toContain("ABCDE1234F");
    expect(bodyOf(calls).context).toEqual({ requestId: "req-1" });
  });

  it("7. the envelope carries what an operator needs to find the fault", async () => {
    const envelope = buildEnvelope(new Error("kaboom"), {
      scope: "http",
      method: "PATCH",
      route: "/api/customers/:id",
      requestId: "req-9",
    }) as unknown as Record<string, never>;

    expect(envelope.service).toBe("risenext-crm-backend");
    expect(envelope.environment).toBeTruthy();
    expect((envelope.error as unknown as { message: string }).message).toBe("kaboom");
    expect((envelope.error as unknown as { stack: string }).stack).toContain("Error");
    expect(envelope.context).toMatchObject({ route: "/api/customers/:id", requestId: "req-9" });
  });

  it("8. a non-Error thrown value is still reported rather than dropped", async () => {
    const envelope = buildEnvelope("a bare string was thrown") as unknown as {
      error: { name: string; message: string };
    };
    expect(envelope.error.name).toBe("NonError");
    expect(envelope.error.message).toContain("a bare string");
  });

  it("9. a long stack is truncated rather than shipped whole", async () => {
    const error = new Error("deep");
    error.stack = "x".repeat(50_000);
    const envelope = buildEnvelope(error) as unknown as { error: { stack: string } };
    expect(envelope.error.stack.length).toBeLessThanOrEqual(8_000);
  });
});

/* ══ C — it can never make things worse ═══════════════════════════════════ */

describe("C · a tracker outage is not an application fault", () => {
  it("10. THE RULE: a rejected fetch does not throw", async () => {
    // This is called from the 500 handler. If it could throw, a collector
    // outage would turn every handled 500 into an unhandled rejection.
    process.env.ERROR_TRACKING_URL = "https://collector.example/ingest";
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));

    await expect(captureException(new Error("original"))).resolves.toBe("webhook");
  });

  it("11. a non-2xx from the collector does not throw either", async () => {
    process.env.ERROR_TRACKING_URL = "https://collector.example/ingest";
    captureFetch({ ok: false, status: 429 });
    await expect(captureException(new Error("original"))).resolves.toBe("webhook");
  });

  it("12. the collector URL and token never appear in a thrown value", async () => {
    // The same scrubbing rule `services/email.ts` applies to the Resend key:
    // a transport error's message can carry the URL it was dialling.
    process.env.ERROR_TRACKING_URL = "https://collector.example/secret-path";
    process.env.ERROR_TRACKING_TOKEN = "tok_should_not_leak";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("connect to https://collector.example/secret-path failed"))),
    );

    // Resolves rather than rejecting, so there is nothing carrying the URL for
    // a caller to accidentally log.
    await expect(captureException(new Error("x"))).resolves.toBe("webhook");
  });
});
