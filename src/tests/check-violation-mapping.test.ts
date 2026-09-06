import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { errorHandler } from "../middleware/error-handler.js";

/**
 * 23514 — CHECK-VIOLATION MAPPING. Task 13.13 / audit U-10.
 *
 * Migration `0014` takes the repository from 4 CHECK constraints to 13. Before
 * this branch existed, every one of them answered a data-integrity refusal with
 * **500 and an error-level stack trace** — a constraint added to make bad data
 * impossible would instead have become an availability event and a log
 * amplifier.
 *
 * The distinction under test is the one that makes the mapping safe:
 *
 *   `*_status_check` / `*_stage_check`   the value came from the caller  → 422
 *   any other CHECK                      internal integrity failure      → 500
 *
 * The second half is not hypothetical. `factory-transaction.test.ts` breaks the
 * audit insert by adding a CHECK to `audit_logs`, and a 4xx there would tell
 * the client their input was bad when the server's own audit table is broken.
 *
 * NO DATABASE. The handler is a pure function of the error it is given, and
 * these cases hand it the exact `DrizzleQueryError`-wrapped shape `pg` produces
 * — which is also what pins `rootCause`'s unwrapping.
 */

/** What the driver actually throws, wrapped as Drizzle wraps it. */
function pgError(code: string, constraint?: string): Error {
  const inner = Object.assign(new Error("check constraint violated"), { code, constraint });
  return Object.assign(new Error("Failed query"), { cause: inner });
}

function run(error: unknown) {
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json } as unknown as Response;
  const req = { requestId: "req-1" } as unknown as Request;

  errorHandler(error, req, res, vi.fn());

  return {
    status: (res.status as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number,
    body: json.mock.calls[0]?.[0] as { error: { code: string; message: string; details?: unknown } },
  };
}

describe("a status-vocabulary CHECK violation is a 422, not a 500", () => {
  it("1. `verifications_status_check` maps to 422 validation_failed", () => {
    const r = run(pgError("23514", "verifications_status_check"));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("validation_failed");
  });

  it("2. every constraint migration 0014 adds maps to 422", () => {
    for (const c of [
      "users_status_check",
      "banks_status_check",
      "customers_status_check",
      "documents_status_check",
      "funding_sources_status_check",
      "service_providers_status_check",
      "settlements_status_check",
      "transactions_status_check",
      "verifications_status_check",
    ]) {
      expect(run(pgError("23514", c)).status, c).toBe(422);
    }
  });

  it("3. the pre-existing constraints from 0007-0009 map too", () => {
    for (const c of [
      "loans_status_check",
      "bank_orders_status_check",
      "bank_orders_stage_check",
      "disbursements_status_check",
    ]) {
      expect(run(pgError("23514", c)).status, c).toBe(422);
    }
  });

  it("4. the response names the field but NEVER the constraint — SEC-020", () => {
    const r = run(pgError("23514", "settlements_status_check"));
    const serialised = JSON.stringify(r.body);

    expect(serialised).toContain("status");
    // `pg.constraint` is a raw internal identifier. Returning it is the defect
    // SEC-020 records against the 23505 branch; this branch must not repeat it.
    expect(serialised).not.toContain("settlements_status_check");
  });
});

describe("any OTHER check violation stays a 500 — it is not the caller's fault", () => {
  it("5. a CHECK on `audit_logs` is an internal failure, not bad input", () => {
    // This is precisely what factory-transaction.test.ts induces to prove the
    // PATCH/APPROVE transaction rolls back.
    const r = run(pgError("23514", "f1_audit_break"));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("internal_error");
  });

  it("6. a check violation with NO constraint name stays a 500", () => {
    // An anonymous CHECK cannot be attributed to a caller-supplied field, so
    // guessing that it was bad input would be a lie in the safe direction.
    const r = run(pgError("23514", undefined));
    expect(r.status).toBe(500);
  });

  it("7. a name that merely CONTAINS the words does not qualify — the suffix does", () => {
    const r = run(pgError("23514", "status_check_audit_immutability"));
    expect(r.status).toBe(500);
  });
});

describe("the branch did not disturb the codes around it", () => {
  it("8. 23505 is still a 409 conflict", () => {
    const r = run(pgError("23505", "users_email_unique"));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("conflict");
  });

  it("9. 23503 is still a 409 conflict", () => {
    const r = run(pgError("23503", "some_fk"));
    expect(r.status).toBe(409);
  });

  it("10. an ordinary error is still a 500 with no detail leaked", () => {
    const r = run(new Error("boom"));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("boom");
  });
});
