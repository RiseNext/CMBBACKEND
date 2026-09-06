import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import { setDb, type Database } from "../db/index.js";
import * as schema from "../db/schema/index.js";
import { resetEnvCache } from "../config/env.js";
import { hashPassword } from "../lib/password.js";
import { seed } from "../db/seed.js";
import { createApp } from "../app.js";
import { resetHashConcurrency, resetRateLimits } from "../middleware/rate-limit.js";

/**
 * The suite runs the SAME migration files that ship to Neon, against a real
 * Postgres 18 engine compiled to WASM. If a constraint, index or trigger is
 * wrong, it fails here rather than in production.
 */
const TEST_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PORT: "8080",
  DATABASE_URL: "postgres://localhost:5432/test",
  JWT_ACCESS_SECRET: "test-access-secret-that-is-definitely-long-enough",
  JWT_REFRESH_SECRET: "test-refresh-secret-that-is-definitely-long-enough",
  CORS_ORIGIN: "http://localhost:3000",
  FRONTEND_URL: "http://localhost:3000",
  /*
   * 48 characters. Task 13.4 raised the minimum from 16 to 32 — this is an HMAC
   * key over a 10^12 keyspace, and a short one is the whole control. The old
   * 28-character fixture is what `Object.assign(process.env, TEST_ENV)` below
   * was silently putting back over `setup.ts`'s value.
   */
  AADHAAR_PEPPER: "test-pepper-value-that-is-long-enough-for-hmac!!",
  RECYCLE_BIN_RETENTION_DAYS: "30",
};

export interface TestContext {
  db: Database;
  app: Express;
  client: PGlite;
}

export async function createTestContext(): Promise<TestContext> {
  Object.assign(process.env, TEST_ENV);
  resetEnvCache();

  const client = new PGlite();
  const db = drizzle(client, { schema, casing: "snake_case" }) as unknown as Database;

  await migrate(db as never, { migrationsFolder: "./drizzle" });
  setDb(db);
  await seed(db);

  /*
   * Task 13.1 — every context starts with empty counters.
   *
   * The limiters are module-level and survive across suites in one worker, so
   * without this a file that signs in repeatedly would throttle the file that
   * runs after it and the failure would look like a product defect. This is
   * per-test isolation, not a weakened limit: `auth-rate-limit.test.ts`
   * deliberately does NOT reset mid-case, which is how the limiter is proven.
   */
  resetRateLimits();
  resetHashConcurrency();

  return { db, app: createApp(), client };
}

export async function destroyTestContext(ctx: TestContext | undefined): Promise<void> {
  setDb(null);
  if (ctx?.client) await ctx.client.close();
}

export async function roleByKey(db: Database, key: string) {
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.key, key)).limit(1);
  if (!role) throw new Error(`Role ${key} not found — seed did not run`);
  return role;
}

let userCounter = 0;

export interface CreatedUser {
  id: string;
  email: string;
  password: string;
}

export async function createUser(
  db: Database,
  options: { roleKey: string; email?: string; bankIds?: string[]; status?: string },
): Promise<CreatedUser> {
  const role = await roleByKey(db, options.roleKey);
  userCounter += 1;
  const email = options.email ?? `user${userCounter}@risenext.test`;
  const password = "TestPassword123!";

  const [user] = await db
    .insert(schema.users)
    .values({
      employeeCode: `EMP-${String(1000 + userCounter)}`,
      name: `Test User ${userCounter}`,
      email,
      passwordHash: await hashPassword(password),
      roleId: role.id,
      status: options.status ?? "Active",
    })
    .returning();

  if (options.bankIds?.length) {
    await db
      .insert(schema.userBankAccess)
      .values(options.bankIds.map((bankId) => ({ userId: user!.id, bankId })));
  }

  return { id: user!.id, email, password };
}

let bankCounter = 0;

export async function createBank(db: Database, name?: string): Promise<{ id: string; code: string }> {
  bankCounter += 1;
  const code = `BNK-${String(bankCounter).padStart(2, "0")}`;
  const [bank] = await db
    .insert(schema.banks)
    .values({
      code,
      name: name ?? `Test Bank ${bankCounter}`,
      shortName: `TB${bankCounter}`,
      status: "Active",
    })
    .returning();
  return { id: bank!.id, code };
}

export function customerPayload(bankId: string, bankReferenceId: string, overrides = {}) {
  return {
    bankId,
    bankReferenceId,
    name: "Test Customer",
    mobile: "9876543210",
    monthlyIncome: 50000,
    kyc: "Pending",
    status: "Active",
    ...overrides,
  };
}
