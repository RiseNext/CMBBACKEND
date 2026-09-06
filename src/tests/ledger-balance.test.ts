import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import * as schema from "../db/schema/index.js";

/**
 * THE RUNNING LEDGER BALANCE — Task 11.7.
 *
 * `ledger_entries.balance` was written as `0` by every path — including 8.8's
 * settlement chain, deliberately — and recomputed by none. The schema comment
 * on the column claimed the recomputation happened "inside the same
 * transaction"; **no such code existed.** So the "Closing balance" tile read a
 * permanent ₹0.00 while the voucher dialog said it updated immediately, and the
 * column was also **accepted from the client**, meaning a caller could assert
 * any closing balance they liked on the business's own book.
 *
 * ── WHY THERE IS NO LOCK, AND WHAT IS TESTED INSTEAD ────────────────────────
 *
 * D-027 forbids row locks. The obvious implementation — read the last balance,
 * add, write — is exactly the check-then-write race BUG-037 records at eleven
 * other sites, and two concurrent vouchers would lose one of the two.
 *
 * The balance is instead derived in SQL from the rows themselves,
 * `SUM(credit) - SUM(debit)`, inside the transaction that inserted the row. So
 * the correctness property is not "the increments were applied in order" but
 * **"the stored balance equals the sum of the book"** — which is checkable at
 * any moment and is what group C asserts after concurrent writes.
 */

const PASSWORD = "TestPassword123!";

let ctx: TestContext;
let bankA: { id: string; code: string };
let bankB: { id: string; code: string };
let token: string;

beforeAll(async () => {
  ctx = await createTestContext();
  bankA = await createBank(ctx.db);
  bankB = await createBank(ctx.db);
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  const res = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: admin.email, password: PASSWORD });
  token = res.body.accessToken as string;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

const auth = () => ({ Authorization: `Bearer ${token}` });

let seq = 0;
async function post(bankId: string, credit: number, debit = 0) {
  seq += 1;
  const res = await request(ctx.app)
    .post("/api/ledger")
    .set(auth())
    .send({
      bankId,
      particulars: `Voucher ${seq}`,
      category: "Commission",
      credit,
      debit,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; balance: string };
}

/** The book, computed independently of the code under test. */
async function bookOf(bankId: string): Promise<number> {
  const rows = await ctx.db
    .select({ credit: schema.ledgerEntries.credit, debit: schema.ledgerEntries.debit })
    .from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.bankId, bankId), isNull(schema.ledgerEntries.deletedAt)));
  return rows.reduce((t, r) => t + Number(r.credit) - Number(r.debit), 0);
}

/* ══ A — it is computed at all ════════════════════════════════════════════ */

describe("A · the balance is computed, not left at zero", () => {
  it("1. THE FINDING: the first voucher's balance is its own amount, not 0", async () => {
    const row = await post(bankA.id, 1000);
    expect(Number(row.balance)).toBe(1000);
  });

  it("2. it accumulates across vouchers", async () => {
    await post(bankA.id, 500);
    const third = await post(bankA.id, 250);
    expect(Number(third.balance)).toBe(1750); // 1000 + 500 + 250
  });

  it("3. a debit reduces it", async () => {
    const row = await post(bankA.id, 0, 750);
    expect(Number(row.balance)).toBe(1000); // 1750 - 750
  });

  it("4. the stored row carries it, not merely the response", async () => {
    const row = await post(bankA.id, 100);
    const [stored] = await ctx.db
      .select({ balance: schema.ledgerEntries.balance })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.id, row.id))
      .limit(1);
    expect(Number(stored!.balance)).toBe(Number(row.balance));
  });

  it("5. the response carries the COMPUTED value — D-026, the server row wins", async () => {
    const row = await post(bankA.id, 42);
    expect(Number(row.balance)).toBe(await bookOf(bankA.id));
  });
});

/* ══ B — per bank, and decimal-safe ═══════════════════════════════════════ */

describe("B · one book per bank", () => {
  it("6. a second bank starts its own book at its own first amount", async () => {
    const row = await post(bankB.id, 60);
    expect(Number(row.balance)).toBe(60);
  });

  it("7. the two books do not contaminate each other", async () => {
    const a = await bookOf(bankA.id);
    const b = await bookOf(bankB.id);
    expect(a).not.toBe(b);

    const next = await post(bankB.id, 40);
    expect(Number(next.balance)).toBe(100); // 60 + 40, untouched by bank A
    expect(await bookOf(bankA.id)).toBe(a);
  });

  it("8. paise survive — the aggregate is numeric, never a float (D-068)", async () => {
    const bank = await createBank(ctx.db);
    await post(bank.id, 0.1);
    await post(bank.id, 0.2);
    const third = await post(bank.id, 0.3);

    // 0.1 + 0.2 + 0.3 is 0.6000000000000001 in IEEE-754 doubles. Postgres
    // numeric gets it right, and `::text` is what keeps it right on the way out.
    expect(Number(third.balance)).toBeCloseTo(0.6, 10);
  });

  it("9. a soft-deleted voucher leaves the book", async () => {
    /*
     * Deleted directly, not through the API — and that is itself worth
     * recording: `ledgerRouter` configures **no `delete` permission**, so the
     * factory mounts no DELETE route at all. Financial records are immutable
     * and corrections are compensating entries (D-069, OPEN-4). The column
     * exists because every table carries the soft-delete quartet, and the
     * balance must agree with `bankScope` about what is in the book if a row is
     * ever retired by other means.
     */
    const bank = await createBank(ctx.db);
    const first = await post(bank.id, 1000);
    await post(bank.id, 500);

    const gone = await request(ctx.app).delete(`/api/ledger/${first.id}`).set(auth());
    expect(gone.status, "the ledger must expose no delete route (D-069)").toBe(404);

    await ctx.db
      .update(schema.ledgerEntries)
      .set({ deletedAt: new Date() })
      .where(eq(schema.ledgerEntries.id, first.id));

    // The next entry sees a book without the retired row.
    const after = await post(bank.id, 100);
    expect(Number(after.balance)).toBe(600);
  });
});

/* ══ C — the property that survives concurrency without a lock ════════════ */

describe("C · the stored balance equals the book, with no row lock (D-027)", () => {
  it("10. after concurrent posts, the latest balance equals SUM(credit) - SUM(debit)", async () => {
    const bank = await createBank(ctx.db);

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(ctx.app)
          .post("/api/ledger")
          .set(auth())
          .send({
            bankId: bank.id,
            particulars: `Concurrent ${i}`,
            category: "Commission",
            credit: 100,
            debit: 0,
          }),
      ),
    );

    const book = await bookOf(bank.id);
    expect(book).toBe(800);

    /*
     * A read-then-write implementation would lose updates here and the final
     * row would read less than the book. Deriving the sum in SQL means the
     * worst case is two rows carrying the same total, never a total that is
     * wrong — and the next voucher corrects the sequence anyway.
     */
    const settling = await post(bank.id, 0);
    expect(Number(settling.balance)).toBe(book);
  });

  it("11. no advisory or row lock was introduced", async () => {
    // D-027 is a standing constraint, so it is asserted rather than assumed.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/modules/operations.routes.ts", "utf8");
    expect(src).not.toMatch(/for\s+update/i);
    expect(src).not.toMatch(/pg_advisory/i);
  });
});

/* ══ D — the client cannot dictate it ═════════════════════════════════════ */

describe("D · `balance` is server-owned", () => {
  it("12. a client-supplied balance is ignored", async () => {
    const bank = await createBank(ctx.db);
    const res = await request(ctx.app)
      .post("/api/ledger")
      .set(auth())
      .send({
        bankId: bank.id,
        particulars: "Assertion attempt",
        category: "Commission",
        credit: 10,
        balance: 12_345_678,
      });

    expect(res.status).toBe(201);
    expect(Number(res.body.data.balance)).toBe(10);
  });
});
