import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { settlements } from "../db/schema/index.js";

/**
 * THE SETTLEMENT ARITHMETIC INVARIANT — Task 8.6
 *
 * `net_payable = gross_commission - tds`, to a paisa.
 *
 * The check existed and was structurally unable to do its job on a PATCH. It
 * read `input.netPayable !== undefined` and took all three figures from the
 * payload, so it failed **open in one direction and closed in the other**:
 *
 *   - omit `netPayable` → skipped entirely, and a PATCH could leave a stored
 *     row whose three money columns no longer added up;
 *   - send only `netPayable` → compared against `?? 0` rather than the stored
 *     gross and tds, refusing a legitimate edit.
 *
 * One cause: the invariant is a property of the ROW and was being evaluated
 * against the REQUEST. `existing` was already threaded into `beforeWrite` for
 * exactly this.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let token: string;
let periodCounter = 0;

const auth = () => ({ Authorization: `Bearer ${token}` });
const nextPeriod = () => `PERIOD-${(periodCounter += 1)}`;

const create = (body: Record<string, unknown> = {}) =>
  request(ctx.app)
    .post("/api/settlements")
    .set(auth())
    .send({
      bankId: bank.id,
      period: nextPeriod(),
      grossCommission: 10000,
      tds: 1000,
      netPayable: 9000,
      ...body,
    });

const patch = (id: string, body: Record<string, unknown>) =>
  request(ctx.app).patch(`/api/settlements/${id}`).set(auth()).send(body);

const rowById = async (id: string) =>
  (await ctx.db.select().from(settlements).where(eq(settlements.id, id)).limit(1))[0]!;

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  const login = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: admin.email, password: admin.password });
  expect(login.status).toBe(200);
  token = login.body.accessToken;
});

afterAll(async () => destroyTestContext(ctx));

describe("A — create is unchanged", () => {
  it("1. accepts arithmetic that balances", async () => {
    const res = await create();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("2. refuses arithmetic that cannot be right, naming the field", async () => {
    const res = await create({ grossCommission: 10000, tds: 500, netPayable: 9000 });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("netPayable");
  });

  it("3. the message states the arithmetic rather than restating the rule", async () => {
    const res = await create({ grossCommission: 10000, tds: 500, netPayable: 9000 });
    expect(res.body.error.message).toContain("9500");
    expect(res.body.error.message).toContain("9000");
  });
});

describe("B — THE FIX: PATCH is checked against the merged row", () => {
  it("4. a PATCH that omits netPayable is NO LONGER skipped", async () => {
    const created = await create();
    const id = created.body.data.id;

    // Before 8.6 this was a 200 and left 999999 − 1000 ≠ 9000 in the table.
    const res = await patch(id, { grossCommission: 999999 });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.details?.[0]?.path).toBe("netPayable");
    expect(Number((await rowById(id)).grossCommission)).toBe(10000);
  });

  it("5. a PATCH that omits gross and tds is compared against the STORED values", async () => {
    const created = await create();
    const id = created.body.data.id;

    // Before 8.6 this compared 9000 against `0 − 0` and refused a legitimate
    // edit — the same defect failing the other way.
    const wrong = await patch(id, { netPayable: 1 });
    expect(wrong.status).toBe(422);

    const right = await patch(id, { netPayable: 9000 });
    expect(right.status, JSON.stringify(right.body)).toBe(200);
  });

  it("6. a coherent multi-field PATCH still succeeds", async () => {
    const created = await create();
    const res = await patch(created.body.data.id, {
      grossCommission: 20000,
      tds: 2000,
      netPayable: 18000,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Number(res.body.data.netPayable)).toBe(18000);
  });

  it("7. a PATCH touching no money field is not judged at all", async () => {
    const created = await create();
    const res = await patch(created.body.data.id, { invoiceNo: "INV-0001" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.invoiceNo).toBe("INV-0001");
  });

  it("8. the 0.01 tolerance still holds for rounding, and rejects beyond it", async () => {
    const created = await create();
    const id = created.body.data.id;

    const withinTolerance = await patch(id, {
      grossCommission: 10000,
      tds: 1000,
      netPayable: 9000.009,
    });
    expect(withinTolerance.status, JSON.stringify(withinTolerance.body)).toBe(200);

    const beyond = await patch(id, { grossCommission: 10000, tds: 1000, netPayable: 8999 });
    expect(beyond.status).toBe(422);
  });

  it("9. the refused PATCH left the row untouched — F1 made it atomic", async () => {
    const created = await create();
    const id = created.body.data.id;
    const before = await rowById(id);

    await patch(id, { grossCommission: 55555 });

    const after = await rowById(id);
    expect(Number(after.grossCommission)).toBe(Number(before.grossCommission));
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
