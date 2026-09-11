import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { corsOrigins, env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { authRouter } from "./modules/auth.routes.js";
import { banksRouter } from "./modules/banks.routes.js";
import { customersRouter } from "./modules/customers.routes.js";
import { healthRouter } from "./modules/health.routes.js";
import {
  auditRouter,
  notificationsRouter,
  recycleBinRouter,
  rolesRouter,
  teamsRouter,
  usersRouter,
} from "./modules/admin.routes.js";
import { importsRouter } from "./modules/imports.routes.js";
import { maintenanceRouter } from "./modules/maintenance.routes.js";
import { settingsRouter } from "./modules/settings.routes.js";
import { documentsUploadRouter, kycPackRouter } from "./modules/documents.routes.js";
import {
  bankOrdersRouter,
  dashboardRouter,
  disbursementsRouter,
  documentsRouter,
  fundingSourcesRouter,
  ledgerRouter,
  reportsRouter,
  loansRouter,
  serviceProvidersRouter,
  settlementsRouter,
  transactionsRouter,
  verificationsRouter,
} from "./modules/operations.routes.js";

export function createApp(): Express {
  const config = env();
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: false, // API only; the frontend sets its own CSP.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  const allowed = corsOrigins(config.CORS_ORIGIN);
  app.use(
    cors({
      /**
       * `credentials: true` forbids a wildcard origin, so the allow-list is
       * checked explicitly. Set CORS_ORIGIN to the Vercel URL in production.
       *
       * A refused origin is rejected HERE, before any route runs, and that is
       * load-bearing rather than incidental. The refresh cookie is
       * `SameSite=None` in production (`lib/tokens.ts:82`), so a browser will
       * attach it to a cross-site request. The documented alternative,
       * `callback(null, false)`, only omits the CORS response headers and lets
       * the request continue into the handler — a hostile page could then
       * rotate a victim's refresh token and merely be unable to read the
       * reply. **Do not change this to `false`.**
       *
       * The rejection must be an `AppError`. A bare `Error` is unrecognised by
       * `middleware/error-handler.ts`, which then answers 500 and logs a full
       * stack trace at error level — BUG-022 / SEC-018. `cors@2` hands
       * whatever we pass straight to `next()` *before* its own preflight
       * branch runs, so this one callback governs OPTIONS as well as ordinary
       * requests.
       */
      origin(origin, callback) {
        if (!origin || allowed.includes(origin)) return callback(null, true);

        // Logged here, not in the error handler: that handler cannot see the
        // origin, and giving it a 4xx branch would change logging for every
        // 401, 403 and 404 in the API. `warn` because a refused origin is a
        // configuration or probing event, not a server fault.
        logger.warn({ origin }, "Blocked request from a non-allow-listed origin");

        // The origin is attacker-controlled and is deliberately not reflected
        // back in the response body.
        return callback(new AppError(403, "cors_origin_denied", "Origin is not permitted"));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.use((req, _res, next) => {
    req.requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());

  if (config.NODE_ENV !== "test") {
    app.use(pinoHttp({ logger, genReqId: (req) => (req as { requestId?: string }).requestId ?? randomUUID() }));
  }

  /*
   * THE GLOBAL LIMITER — SEC-005, Task 13.1.
   *
   * SEC-005 asks for "a global limiter" alongside the auth-specific ones. This
   * is the backstop: every route the application will ever add is covered from
   * the moment it is mounted, rather than depending on someone remembering.
   *
   * Deliberately generous. It is not the control that stops credential
   * stuffing — `loginIpLimit` and `loginAccountLimit` are — it is the one that
   * stops a single source saturating the process. 300 requests per minute is
   * roughly five per second sustained, well above what the heaviest screen
   * does (the dashboard fires ~8 requests on load) and far below what a script
   * can generate.
   *
   * ── MOUNTED AFTER `/api/health` ON PURPOSE ─────────────────────────────────
   *
   * Railway polls the liveness probe continuously from a small set of internal
   * addresses. Counting those against a per-IP budget would eventually throttle
   * the platform's own health check and cause a restart loop — the limiter
   * taking the service down being a considerably worse outcome than the one it
   * prevents. `/api/health` touches no database and does no work, so leaving it
   * uncounted costs nothing.
   *
   * `trust proxy` is set above, so `req.ip` is the real client address behind
   * Railway's proxy rather than the proxy's own.
   */
  app.use("/api", healthRouter);

  app.use("/api", rateLimit({ name: "global", windowMs: 60 * 1000, max: 300 }));
  app.use("/api/auth", authRouter);
  app.use("/api/banks", banksRouter);
  // Task 9.11 — mounted before the factory router so `/:id/kyc-pack` is not
  // swallowed by its `GET /:id`, the same ordering reason as the document
  // content route below.
  app.use("/api/customers", kycPackRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/teams", teamsRouter);
  app.use("/api/loans", loansRouter);
  app.use("/api/verifications", verificationsRouter);
  app.use("/api/bank-orders", bankOrdersRouter);
  app.use("/api/disbursements", disbursementsRouter);
  app.use("/api/settlements", settlementsRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/ledger", ledgerRouter);
  /*
   * Mounted BEFORE the factory router — Tasks 9.4 / 9.5.
   *
   * Express matches in registration order, and the factory emits `GET /:id`.
   * Registered the other way round, `GET /api/documents/:id/content` would be
   * swallowed by `/:id` and answered with the metadata row — which is exactly
   * the forged-success defect the demo layer has (`lib/demo/api.ts` discards
   * the third path segment) and which 9.6 fixes there.
   */
  app.use("/api/documents", documentsUploadRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/funding-sources", fundingSourcesRouter);
  app.use("/api/service-providers", serviceProvidersRouter);
  app.use("/api/recycle-bin", recycleBinRouter);
  app.use("/api/audit-logs", auditRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api/dashboard", dashboardRouter);
  // Task 11.3 — SQL-aggregated reporting, replacing a client-side computation
  // over a page capped at 500 loans.
  app.use("/api/reports", reportsRouter);
  /*
   * Task MM-1, D-095 — the four manager tracking formats, as read projections
   * over records that already exist. Its own prefix, so there is no `/:id`
   * ordering hazard with any factory router, and it is mounted AFTER the global
   * limiter like every other feature route.
   */
  app.use("/api/maintenance", maintenanceRouter);
  // Task 12.6 — `app_settings` had no route at all and was dead in the schema.
  app.use("/api/settings", settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
