import { Router } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { logger } from "../lib/logger.js";

export const healthRouter = Router();

/** Liveness. Never touches the database — Railway uses this for restarts. */
healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

/**
 * Readiness. Verifies the Neon connection actually answers.
 *
 * ── THE DRIVER ERROR IS LOGGED, NEVER RETURNED — SEC-015, Task 13.10 ────────
 *
 * This route is **unauthenticated** — it has to be, because Railway's health
 * check cannot present a credential. It used to return `(error as Error).message`
 * verbatim, and a `pg` connection failure carries the host, the port, the
 * database name and the role: `getaddrinfo ENOTFOUND ep-xxx.ap-south-1.aws.neon.tech`,
 * or `password authentication failed for user "crm_app"`. That is an
 * unauthenticated map of the data tier, served on demand.
 *
 * The operator still needs the detail, so it goes to the log at `error` level
 * where the platform's alerting can see it. The response says only that the
 * database is not answering — which is the entire question a readiness probe
 * asks. This mirrors the no-leak policy `middleware/error-handler.ts` already
 * applies to every 500.
 */
healthRouter.get("/health/ready", async (req, res) => {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    res.json({
      status: "ok",
      database: { connected: true, latencyMs: Date.now() - started },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error, requestId: req.requestId }, "Readiness probe: database unreachable");
    res.status(503).json({
      status: "degraded",
      database: { connected: false },
      timestamp: new Date().toISOString(),
    });
  }
});
