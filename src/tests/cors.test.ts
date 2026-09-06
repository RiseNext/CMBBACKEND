import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express, NextFunction, Request, Response } from "express";
import { createApp } from "../app.js";
import { resetEnvCache } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { errorHandler } from "../middleware/error-handler.js";

/**
 * CORS ORIGIN REJECTION — BUG-022 / SEC-018
 *
 * The defect: the origin callback rejected with a bare `Error`. `cors@2` hands
 * that straight to `next()`, and `middleware/error-handler.ts` does not
 * recognise it — so a refused origin produced **HTTP 500**, a body of
 * `internal_error`, and an **error-level log carrying a full stack trace with
 * absolute filesystem paths**. A configuration mistake looked like a crash, and
 * any unauthenticated caller could drive error-level logging at will.
 *
 * Because `cors@2` forwards the rejection *before* its own preflight branch,
 * the same defect made a disallowed **OPTIONS preflight** return 500 too — a
 * detail the roadmap did not record and which these tests now pin down.
 *
 * NO DATABASE. `createApp()` opens no connection — `db/index.ts` builds its
 * pool lazily on first query — and CORS is refused long before any route, so
 * this file needs neither PGlite nor the seed. That is deliberate: it keeps the
 * suite fast and it means a passing test cannot be explained by fixture setup.
 *
 * The allow-list comes from `CORS_ORIGIN`, set to `http://localhost:3000` by
 * `tests/setup.ts`.
 */

const ALLOWED = "http://localhost:3000";
const DENIED = "https://evil.example";

let app: Express;

beforeAll(() => {
  resetEnvCache();
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("A — a disallowed origin is refused, not crashed", () => {
  it("answers 403, never 500", async () => {
    const res = await request(app).get("/api/health").set("Origin", DENIED);

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(500);
  });

  it("uses the standard error shape with a distinct code", async () => {
    const res = await request(app).get("/api/health").set("Origin", DENIED);

    expect(res.body).toEqual({
      error: { code: "cors_origin_denied", message: "Origin is not permitted" },
    });
  });

  it("leaks no stack trace, no filesystem path and not the origin itself", async () => {
    const res = await request(app).get("/api/health").set("Origin", DENIED);
    const raw = res.text ?? JSON.stringify(res.body);

    expect(raw).not.toMatch(/\bat\s+\S+\s+\(/); // stack frame
    expect(raw).not.toMatch(/[A-Za-z]:\\|\/home\/|node_modules/); // paths
    expect(raw).not.toContain("evil.example"); // attacker-controlled input
  });

  it("sends no CORS headers with the refusal", async () => {
    const res = await request(app).get("/api/health").set("Origin", DENIED);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("B — the route never runs", () => {
  it("returns the refusal instead of the handler's payload", async () => {
    // `/api/health` answers `{status:"ok",uptime,timestamp}`. Getting the error
    // shape instead is positive evidence the handler was never entered, rather
    // than an inference from the status code.
    const res = await request(app).get("/api/health").set("Origin", DENIED);

    expect(res.body).not.toHaveProperty("status", "ok");
    expect(res.body).not.toHaveProperty("uptime");
    expect(res.body.error.code).toBe("cors_origin_denied");
  });

  it("refuses before routing — an unknown path is 403, not 404", async () => {
    // `notFoundHandler` is mounted after every router. A 404 here would prove
    // the request had traversed the whole stack; 403 proves CORS ran first.
    const res = await request(app).get("/api/definitely-not-a-route").set("Origin", DENIED);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("cors_origin_denied");
  });

  it("refuses POST /api/auth/login before authentication, issuing no cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", DENIED)
      .send({ email: "super.admin@risenext.com", password: "whatever" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("cors_origin_denied");
    // No session may be established, and no auth error may be reported either
    // — reaching the handler at all would be the failure.
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body.error.code).not.toBe("unauthorized");
    // Reaching the route without a database would surface as a 5xx; 403 alone
    // already rules that out.
    expect(res.status).not.toBeGreaterThanOrEqual(500);
  });
});

describe("C — allowed traffic is untouched", () => {
  it("serves an allowed origin and echoes it back", async () => {
    const res = await request(app).get("/api/health").set("Origin", ALLOWED);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("still allows credentials for an allowed origin", async () => {
    // `credentials: true` plus a correct allow-list is what makes the
    // httpOnly refresh cookie work across the Vercel/Railway split. Breaking
    // this would break every authenticated request in the product.
    const res = await request(app)
      .get("/api/health")
      .set("Origin", ALLOWED)
      .set("Cookie", "someCookie=1");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["vary"]).toContain("Origin");
  });

  it("leaves a request with no Origin header alone", async () => {
    // curl, server-to-server callers and Railway's health probe send none.
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("D — preflight", () => {
  it("answers an allowed preflight with 204 and the CORS headers", async () => {
    const res = await request(app)
      .options("/api/health")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("answers a disallowed preflight with 403, not 500", async () => {
    // `cors@2` forwards the rejection before it reaches its own preflight
    // branch, so this was 500 as well — undocumented until Task 1.6.
    const res = await request(app)
      .options("/api/health")
      .set("Origin", DENIED)
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(500);
    expect(res.body.error?.code ?? "").toBe("cors_origin_denied");
  });
});

describe("E — logging", () => {
  it("logs the rejection at warn, with the origin, and not at error", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await request(app).get("/api/health").set("Origin", DENIED);

    expect(warn).toHaveBeenCalledTimes(1);
    // The origin belongs in the log — where operators need it — and nowhere else.
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ origin: DENIED });
    // SEC-018 was unauthenticated error-level log amplification.
    expect(error).not.toHaveBeenCalled();
  });

  it("logs nothing at all for an allowed origin", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await request(app).get("/api/health").set("Origin", ALLOWED);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("F — generic error handling is unchanged", () => {
  /** Minimal Express doubles; the handler only needs status/json and requestId. */
  function invokeErrorHandler(error: unknown) {
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }), json } as unknown as Response;
    const req = { requestId: "req-1" } as unknown as Request;
    errorHandler(error, req, res, (() => undefined) as NextFunction);
    return { status: res.status as unknown as ReturnType<typeof vi.fn>, json };
  }

  it("still answers 500 for an unrecognised error", async () => {
    // Task 1.6 must not turn unknown failures into 4xx. The fix works by making
    // the CORS rejection recognisable, not by softening this default.
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const { status, json } = invokeErrorHandler(new Error("boom"));

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: { code: "internal_error", message: "Unexpected server error" },
    });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("still logs nothing for a sub-500 AppError, including the CORS one", async () => {
    // The handler logs only `status >= 500`. Task 1.6 deliberately left that
    // alone — the warn comes from the rejection site, so no other 4xx in the
    // API changed its logging behaviour.
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const { status } = invokeErrorHandler(
      new AppError(403, "cors_origin_denied", "Origin is not permitted"),
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
