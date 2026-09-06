import { createApp } from "./app.js";
import {
  emailTransport,
  env,
  missingEmailConfig,
  missingStorageConfig,
  storageIsEphemeralInProduction,
} from "./config/env.js";
import { closeDb, getDb } from "./db/index.js";
import { logger } from "./lib/logger.js";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  const config = env();

  /*
   * Say out loud that mail will not be delivered. Production never reaches this
   * branch — `loadEnv` refuses to boot without the full email configuration —
   * so it is a development notice, and it names the missing keys so the reason
   * is obvious rather than something to go looking for.
   *
   * Key names only. `EMAIL_API_KEY`'s value is never logged.
   */
  if (emailTransport(config) === "console") {
    logger.warn(
      { missing: missingEmailConfig(config) },
      "Email is not configured — using the console transport. No mail will be delivered.",
    );
  }

  /*
   * Say out loud, on every single boot, that uploaded documents are not
   * durable. `loadEnv` would have refused to start in this state; it started
   * only because STORAGE_ALLOW_EPHEMERAL was set deliberately.
   *
   * `error` level rather than `warn`, and repeated per boot rather than logged
   * once at configuration time, because the failure this guards against is
   * silence: a temporary bridge that nobody can see is a permanent state
   * waiting to be discovered by a customer whose KYC document vanished. Key
   * names only — no credential is involved here, and the convention holds.
   */
  if (storageIsEphemeralInProduction(config)) {
    logger.error(
      { missing: missingStorageConfig(config), adapter: "local" },
      "PRODUCTION IS RUNNING WITHOUT DURABLE OBJECT STORAGE. " +
        "STORAGE_ALLOW_EPHEMERAL=true, so document uploads use the container's " +
        "local filesystem and WILL BE LOST on the next restart or redeploy. " +
        "Configure the STORAGE_* keys and remove STORAGE_ALLOW_EPHEMERAL.",
    );
  }

  try {
    await getDb().execute(sql`select 1`);
    logger.info("Database connection verified");
  } catch (error) {
    logger.error({ err: error }, "Cannot reach the database — refusing to start");
    process.exit(1);
  }

  const server = createApp().listen(config.PORT, () => {
    logger.info(`API listening on port ${config.PORT} (${config.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, draining connections`);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error({ err: error }, "Fatal startup error");
  process.exit(1);
});
