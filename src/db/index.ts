import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let database: Database | null = null;

/**
 * Neon terminates idle connections aggressively and Railway containers are
 * small, so the pool is kept deliberately narrow. Point DATABASE_URL at Neon's
 * *pooled* endpoint; migrations use DIRECT_DATABASE_URL.
 */
export function getPool(): Pool {
  if (!pool) {
    const config = env();
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.NODE_ENV === "production" ? 10 : 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
      ssl: config.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: true },
    });
  }
  return pool;
}

export function getDb(): Database {
  if (!database) database = drizzle(getPool(), { schema, casing: "snake_case" });
  return database;
}

/** Tests inject a PGlite-backed drizzle instance through this. */
export function setDb(instance: Database | null): void {
  database = instance;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  database = null;
}

export { schema };
