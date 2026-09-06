import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Migrations run against Neon's DIRECT (non-pooled) endpoint. Running DDL
 * through the pooler can fail or deadlock on session-scoped locks.
 */
async function main(): Promise<void> {
  const config = env();
  const url = config.DIRECT_DATABASE_URL ?? config.DATABASE_URL;
  const pool = new Pool({
    connectionString: url,
    max: 1,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: true },
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    logger.info("Migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  logger.error({ err: error }, "Migration failed");
  process.exit(1);
});
