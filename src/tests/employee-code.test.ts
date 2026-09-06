import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  roleByKey,
  type TestContext,
} from "./harness.js";
import { recycleBinEntries, users } from "../db/schema/index.js";

/**
 * EMPLOYEE CODE GENERATION — Task 2.11
 *
 * Before this task `employeeCode` was **required** on `POST /api/users` and the
 * only thing that produced one was `suggestEmployeeCode()` in the browser,
 * scanning the at-most-200 rows the employees page had loaded. Two
 * administrators with the dialog open got the same suggestion, and past 200
 * employees the suggestion came from an arbitrary subset.
 *
 * The server now assigns a code when the request omits one, from the **maximum
 * suffix ever issued** rather than a row count.
 *
 * Group B is the point of the task. A count-based generator — the shape BUG-011
 * describes for the seven factory record types — passes every other test in this
 * file and fails group B, because permanently deleting an employee lowers the
 * count and the next code repeats one already used. Task 2.9 made that reachable
 * from the product by putting employees in the recycle bin.
 */

let ctx: TestContext;
let superToken: string;
let bank: { id: string; code: string };
let executiveRoleId: string;
let n = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) =>
  request(ctx.app).post("/api/auth/login").send({ email, password });

/** Creates an employee through the real route. Omits the code unless given one. */
async function create(explicitCode?: string) {
  n += 1;
  const body: Record<string, unknown> = {
    name: `Code Target ${n}`,
    email: `code.target.${n}@risenext.com`,
    roleId: executiveRoleId,
    bankIds: [bank.id],
  };
  if (explicitCode !== undefined) body.employeeCode = explicitCode;

  return request(ctx.app).post("/api/users").set(bearer(superToken)).send(body);
}

const codeOf = async (id: string): Promise<string> => {
  const [row] = await ctx.db
    .select({ code: users.employeeCode })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row!.code;
};

const rowExists = async (id: string): Promise<boolean> => {
  const [row] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return Boolean(row);
};

const del = (id: string) => request(ctx.app).delete(`/api/users/${id}`).set(bearer(superToken));

async function purge(userId: string) {
  const [entry] = await ctx.db
    .select()
    .from(recycleBinEntries)
    .where(eq(recycleBinEntries.recordId, userId));
  return request(ctx.app)
    .post(`/api/recycle-bin/${entry!.id}/permanent-delete`)
    .set(bearer(superToken))
    .send({ confirm: true });
}

/** Every employee code currently held by a live row. */
async function liveCodes(): Promise<string[]> {
  const rows = await ctx.db
    .select({ code: users.employeeCode })
    .from(users)
    .where(sql`${users.deletedAt} is null`);
  return rows.map((r) => r.code);
}

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Code Test Bank");
  executiveRoleId = (await roleByKey(ctx.db, "executive")).id;

  const superAdmin = await createUser(ctx.db, { roleKey: "super_admin" });
  const res = await login(superAdmin.email, superAdmin.password);
  superToken = res.body.accessToken as string;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ------------------------------------------------------------------ group A */

describe("A — the documented format, generated server-side", () => {
  it("1. assigns a code when the request omits one", async () => {
    const res = await create();

    expect(res.status).toBe(201);
    expect(await codeOf(res.body.data.id)).toMatch(/^EMP-\d{4,}$/);
  });

  it("2. follows the seeded format — EMP- plus four zero-padded digits", async () => {
    // The seed writes `EMP-0001` (`seed.ts:111`) and `DATA_MODEL.md:347` gives
    // the same example. The generator continues that series, it does not start
    // a second one.
    const res = await create();
    const code = await codeOf(res.body.data.id);

    expect(code.startsWith("EMP-")).toBe(true);
    expect(code.slice(4)).toMatch(/^\d{4,}$/);
    expect(Number(code.slice(4))).toBeGreaterThan(1);
  });

  it("3. gives consecutive creations different, increasing codes", async () => {
    const first = await create();
    const second = await create();

    const a = Number((await codeOf(first.body.data.id)).slice(4));
    const b = Number((await codeOf(second.body.data.id)).slice(4));

    expect(b).toBeGreaterThan(a);
  });

  it("4. never issues a code a live employee already holds", async () => {
    await create();
    await create();
    const codes = await liveCodes();

    expect(new Set(codes).size).toBe(codes.length);
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — a permanent delete must not free the code for reuse", () => {
  /**
   * THE REGRESSION TEST FOR TASK 2.11.
   *
   * A `count(*)` generator returns the same code at step 6 that it issued at
   * step 1, because the purge lowered the count. This test is the tripwire.
   */
  it("5. full lifecycle: create → confirm → delete → purge → create again", async () => {
    // 1-2. create with a generated code, and confirm it
    const first = await create();
    expect(first.status).toBe(201);
    const firstId = first.body.data.id as string;
    const firstCode = await codeOf(firstId);
    expect(firstCode).toMatch(/^EMP-\d{4,}$/);

    // 3. delete
    expect((await del(firstId)).status).toBe(204);

    // 4. purge the recycle-bin record
    expect((await purge(firstId)).status).toBe(200);

    // 5. the row is genuinely gone, not merely hidden
    expect(await rowExists(firstId)).toBe(false);

    // 6-7. the next generated code must not be the purged one
    const second = await create();
    expect(second.status).toBe(201);
    const secondCode = await codeOf(second.body.data.id);

    expect(secondCode).not.toBe(firstCode);
    expect(Number(secondCode.slice(4))).toBeGreaterThan(Number(firstCode.slice(4)));
  });

  it("6. keeps advancing across several purges", async () => {
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await create();
      const id = res.body.data.id as string;
      seen.push(await codeOf(id));
      await del(id);
      await purge(id);
    }

    expect(new Set(seen).size).toBe(3);
    const numbers = seen.map((c) => Number(c.slice(4)));
    expect(numbers[1]).toBeGreaterThan(numbers[0]!);
    expect(numbers[2]).toBeGreaterThan(numbers[1]!);
  });

  it("7. a soft delete alone does not free the code either", async () => {
    const first = await create();
    const firstCode = await codeOf(first.body.data.id);
    await del(first.body.data.id);
    // Deleted but NOT purged — the row is still there, holding its number.

    const second = await create();
    expect(await codeOf(second.body.data.id)).not.toBe(firstCode);
  });

  it("8. restoring a deleted employee cannot duplicate a live code", async () => {
    const first = await create();
    const firstId = first.body.data.id as string;
    const firstCode = await codeOf(firstId);

    await del(firstId);
    const second = await create();
    expect(await codeOf(second.body.data.id)).not.toBe(firstCode);

    const [entry] = await ctx.db
      .select()
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, firstId));
    expect(
      (await request(ctx.app).post(`/api/recycle-bin/${entry!.id}/restore`).set(bearer(superToken)))
        .status,
    ).toBe(200);

    // Both are live again and still distinct.
    const codes = await liveCodes();
    expect(new Set(codes).size).toBe(codes.length);
    expect(await codeOf(firstId)).toBe(firstCode);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — explicit codes still work, and generation steps around them", () => {
  it("9. honours an explicitly supplied code", async () => {
    const res = await create("CONTRACT-77");

    expect(res.status).toBe(201);
    expect(await codeOf(res.body.data.id)).toBe("CONTRACT-77");
  });

  it("10. still refuses a duplicate explicit code with the existing 409", async () => {
    await create("DUPLICATE-1");
    const second = await create("DUPLICATE-1");

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("conflict");
    expect(second.body.error.message).toBe("A user with this employee code already exists");
  });

  it("11. generates above an explicit EMP- code, never colliding with it", async () => {
    // A hand-typed high number moves the series; the next generated code clears
    // it rather than walking into it.
    await create("EMP-8000");
    const res = await create();

    const code = await codeOf(res.body.data.id);
    expect(Number(code.slice(4))).toBeGreaterThan(8000);
    expect(code).not.toBe("EMP-8000");
  });

  it("12. ignores non-conforming codes when choosing the next number", async () => {
    // `CONTRACT-77` above must not be read as suffix 77 and drag the series back.
    const before = await create();
    const beforeNumber = Number((await codeOf(before.body.data.id)).slice(4));
    await create("TEMP-9");
    const after = await create();

    expect(Number((await codeOf(after.body.data.id)).slice(4))).toBeGreaterThan(beforeNumber);
  });

  it("13. still validates an explicit code against the schema", async () => {
    const res = await create("x");

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — uniqueness is still the database's job", () => {
  it("14. the partial unique index still rejects a duplicate live code", async () => {
    const first = await create();
    const code = await codeOf(first.body.data.id);

    // Asserted at the database, not through the route, so the constraint itself
    // is what refuses.
    await expect(
      ctx.db.insert(users).values({
        employeeCode: code,
        name: "Collider",
        email: `collider.${Date.now()}@risenext.com`,
        passwordHash: "x",
        roleId: executiveRoleId,
      }),
    ).rejects.toThrow();
  });

  it("15. two callers that read the same maximum cannot both keep the code", async () => {
    /*
     * The generator is check-then-insert, so concurrent callers CAN compute the
     * same code. The unique index is the final guard — the established model at
     * every write site in this codebase (BUG-037), and the one the task brief
     * says to preserve rather than replace with locking.
     *
     * The interleaving is modelled deterministically rather than raced: PGlite
     * is a single in-process connection, so `Promise.all` over four requests
     * that each open a transaction does not reproduce real concurrency here — it
     * serialises or deadlocks. No other suite in this repository issues
     * concurrent requests for the same reason.
     *
     * So: take the code the generator would hand two simultaneous callers, then
     * let both try to keep it. One must be refused. What must never happen is
     * two live rows sharing a code.
     */
    const first = await create();
    expect(first.status).toBe(201);
    const contested = await codeOf(first.body.data.id);

    // The second caller read the same maximum and is now trying to use it.
    const second = await create(contested);

    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe("A user with this employee code already exists");

    const codes = await liveCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });
});
