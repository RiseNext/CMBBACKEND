import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { asc, eq, isNull, sql } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  customerPayload,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { customers, recycleBinEntries } from "../db/schema/index.js";
import { nextResourceCode } from "../modules/scoped-resource.js";

/**
 * HUMAN-READABLE CODE GENERATION — BUG-011, Task 4.9, DECISIONS.md D-050
 *
 * Seven series (CUS, LN, BO, DSB, STL, TXN, LG) were minted by
 * `codeStart + count(*) + 1` at THREE independent call sites. They now come from
 * seven Postgres sequences created and seeded by
 * `drizzle/0006_code_sequences.sql`, through the single `nextResourceCode`
 * helper in `scoped-resource.ts`.
 *
 * The three defects, each with a test below:
 *
 *   1. **Reuse after a permanent delete** (group C). A count goes DOWN when a
 *      row is purged, so the next create was handed a number already issued.
 *   2. **Concurrent allocation** (group E). Two callers read the same count.
 *   3. **Two generators over one index** (group D). The route counted
 *      `customers` and so did the Excel importer, independently. Fixing either
 *      alone leaves them colliding with each other — no delete and no race
 *      required. This is the single most important property in the file.
 *
 * ⚠️ **What was NOT a defect: the absent `deleted_at` filter.** Group B pins the
 * opposite of what the roadmap row originally asked for. A soft-deleted row's
 * code must STAY reserved: `customers_code_unique` is partial
 * (`WHERE deleted_at is null`), so re-issuing it would be accepted by the index
 * and would make restoring that row from the recycle bin permanently impossible
 * (PRD R3.1 AC3). If anyone ever "fixes" the generator by filtering soft-deleted
 * rows out, B fails.
 *
 * Group A pins the first value of every series, because the migration's job is
 * to CONTINUE the existing numbering, not to start a second one (D-032's
 * precedent). It runs first and is order-dependent by construction: it can only
 * be asserted on a database where nothing has been created yet.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let superToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

let ref = 0;
const nextRef = () => `SEQ-${(ref += 1)}`;

/** POST /api/customers through the real route. Returns the issued code. */
async function createCustomer(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await request(ctx.app)
    .post("/api/customers")
    .set(auth(superToken))
    .send(customerPayload(bank.id, nextRef(), overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.code as string;
}

const suffix = (code: string): number => Number(code.replace(/^[A-Z]+-/, ""));

/** Every customer code in the table, soft-deleted rows included. */
async function allCustomerCodes(): Promise<string[]> {
  const rows = await ctx.db
    .select({ code: customers.code })
    .from(customers)
    .orderBy(asc(customers.code));
  return rows.map((r) => r.code);
}

/** A minimal customer workbook the importer's header matcher accepts. */
async function customerWorkbook(
  rows: { bankReferenceId: string; name: string; mobile: string }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Customers");
  sheet.columns = [
    { header: "Bank Code *", key: "bankCode", width: 14 },
    { header: "Bank Reference ID *", key: "bankReferenceId", width: 22 },
    { header: "Customer Name *", key: "name", width: 26 },
    { header: "Mobile *", key: "mobile", width: 14 },
  ];
  for (const row of rows) sheet.addRow({ bankCode: bank.code, ...row });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Upload + confirm, returning the codes the importer minted, in row order. */
async function importCustomers(references: string[]): Promise<string[]> {
  const buffer = await customerWorkbook(
    references.map((bankReferenceId, i) => ({
      bankReferenceId,
      name: `Imported Customer ${i + 1}`,
      mobile: "9876500000",
    })),
  );

  const upload = await request(ctx.app)
    .post("/api/imports/customers")
    .set(auth(superToken))
    .attach("file", buffer, {
      filename: "customers.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  expect(upload.status, JSON.stringify(upload.body)).toBe(201);
  expect(upload.body.data.valid).toBe(references.length);

  const confirm = await request(ctx.app)
    .post(`/api/imports/${upload.body.data.batchId}/confirm`)
    .set(auth(superToken))
    .send({});
  expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
  expect(confirm.body.data.imported).toBe(references.length);

  const codes: string[] = [];
  for (const reference of references) {
    const [row] = await ctx.db
      .select({ code: customers.code })
      .from(customers)
      .where(eq(customers.bankReferenceId, reference))
      .limit(1);
    expect(row, reference).toBeDefined();
    codes.push(row!.code);
  }
  return codes;
}

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db, "Code Sequence Bank");
  const sa = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(sa.email, sa.password);
}, 90_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ------------------------------------------------------------------ group A */

describe("A — the existing series continues; nothing starts over", () => {
  it("1. every series still issues the same first code it always did", async () => {
    // One create per series, on a database where none exists yet. The values
    // are exactly what `codeStart + count(*) + 1` produced on an empty table:
    // the sequences are seeded with codeStart, and setval(n, true) makes the
    // next nextval n + 1. If a start ever drifts, this is what catches it.
    const customerRes = await request(ctx.app)
      .post("/api/customers")
      .set(auth(superToken))
      .send(customerPayload(bank.id, nextRef()));
    expect(customerRes.status, JSON.stringify(customerRes.body)).toBe(201);
    expect(customerRes.body.data.code).toBe("CUS-10001");
    const customerId = customerRes.body.data.id as string;

    const loan = await request(ctx.app)
      .post("/api/loans")
      .set(auth(superToken))
      .send({ customerId, bankId: bank.id, loanType: "Personal Loan", amountRequested: 100000 });
    expect(loan.status, JSON.stringify(loan.body)).toBe(201);
    expect(loan.body.data.code).toBe("LN-1001");
    const loanId = loan.body.data.id as string;

    const bankOrder = await request(ctx.app)
      .post("/api/bank-orders")
      .set(auth(superToken))
      .send({ loanId, bankId: bank.id, customerId });
    expect(bankOrder.status, JSON.stringify(bankOrder.body)).toBe(201);
    expect(bankOrder.body.data.code).toBe("BO-2401");

    /*
     * FIXTURE ONLY — added by Task 5.2 / 5.7 (D-057, D-060).
     *
     * A disbursement may now only be recorded against an **Approved** loan, and
     * the loan above is `Draft`. Walking it there mints no code in any series,
     * so every code assertion in this file is untouched by these three lines —
     * but without them the disbursement is a 422 and `DSB-5001` is never issued.
     */
    for (const status of ["Submitted", "Under Review", "Approved"]) {
      const step = await request(ctx.app)
        .post(`/api/loans/${loanId}/approve`)
        .set(auth(superToken))
        .send({ status, ...(status === "Approved" ? { amountApproved: 50000 } : {}) });
      expect(step.status, JSON.stringify(step.body)).toBe(200);
    }

    const disbursement = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(superToken))
      .send({ loanId, customerId, bankId: bank.id, amount: 100000, utr: "SEQUTR0001" });
    expect(disbursement.status, JSON.stringify(disbursement.body)).toBe(201);
    expect(disbursement.body.data.code).toBe("DSB-5001");

    const settlement = await request(ctx.app)
      .post("/api/settlements")
      .set(auth(superToken))
      .send({
        bankId: bank.id,
        period: "May 2026",
        grossCommission: 1000,
        tds: 100,
        netPayable: 900,
      });
    expect(settlement.status, JSON.stringify(settlement.body)).toBe(201);
    expect(settlement.body.data.code).toBe("STL-3301");

    const txn = await request(ctx.app)
      .post("/api/transactions")
      .set(auth(superToken))
      .send({ customerId, bankId: bank.id, loanId, amount: 100000, txnType: "Disbursement" });
    expect(txn.status, JSON.stringify(txn.body)).toBe(201);
    expect(txn.body.data.code).toBe("TXN-77001");

    const ledger = await request(ctx.app)
      .post("/api/ledger")
      .set(auth(superToken))
      .send({ bankId: bank.id, particulars: "Commission booked", category: "Commission" });
    expect(ledger.status, JSON.stringify(ledger.body)).toBe(201);
    expect(ledger.body.data.code).toBe("LG-9001");
  });

  it("2. the six factory series keep their format and advance by one", async () => {
    const second = await request(ctx.app)
      .post("/api/settlements")
      .set(auth(superToken))
      .send({ bankId: bank.id, period: "June 2026", grossCommission: 0, tds: 0, netPayable: 0 });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    // Format unchanged: prefix, hyphen, unpadded digits. No new zero padding.
    expect(second.body.data.code).toMatch(/^STL-\d+$/);
    expect(second.body.data.code).toBe("STL-3302");

    const ledger = await request(ctx.app)
      .post("/api/ledger")
      .set(auth(superToken))
      .send({ bankId: bank.id, particulars: "Payout raised", category: "Payout" });
    expect(ledger.body.data.code).toBe("LG-9002");
  });
});

/* ------------------------------------------------------------------ group B */

describe("B — a SOFT-deleted customer keeps its code reserved", () => {
  it("3. create -> soft delete -> create does not reuse the old code", async () => {
    const doomedCode = await createCustomer();
    const [row] = await ctx.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.code, doomedCode))
      .limit(1);

    const deleted = await request(ctx.app)
      .delete(`/api/customers/${row!.id}`)
      .set(auth(superToken));
    expect(deleted.status).toBe(204);

    const nextCode = await createCustomer();
    expect(nextCode).not.toBe(doomedCode);
    expect(suffix(nextCode)).toBeGreaterThan(suffix(doomedCode));
  });

  it("4. and the soft-deleted row can still be restored, which is the point", async () => {
    const code = await createCustomer();
    const [row] = await ctx.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.code, code))
      .limit(1);
    const id = row!.id;

    await request(ctx.app).delete(`/api/customers/${id}`).set(auth(superToken));
    // Someone else creates in the meantime — the classic reuse window.
    await createCustomer();

    const [entry] = await ctx.db
      .select({ id: recycleBinEntries.id })
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, id))
      .limit(1);

    const restored = await request(ctx.app)
      .post(`/api/recycle-bin/${entry!.id}/restore`)
      .set(auth(superToken))
      .send({});
    // If the generator ever filters `deleted_at IS NULL`, the code above was
    // re-issued and this restore resurrects a duplicate. It must not.
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);

    const live = await ctx.db
      .select({ code: customers.code })
      .from(customers)
      .where(isNull(customers.deletedAt));
    expect(new Set(live.map((r) => r.code)).size).toBe(live.length);

    const [back] = await ctx.db
      .select({ code: customers.code })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    expect(back!.code).toBe(code);
  });
});

/* ------------------------------------------------------------------ group C */

describe("C — a PERMANENTLY deleted customer's code is never handed out again", () => {
  it("5. create -> soft delete -> purge -> create collides with nothing", async () => {
    const purgedCode = await createCustomer();
    const [row] = await ctx.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.code, purgedCode))
      .limit(1);
    const id = row!.id;

    expect((await request(ctx.app).delete(`/api/customers/${id}`).set(auth(superToken))).status)
      .toBe(204);

    const [entry] = await ctx.db
      .select({ id: recycleBinEntries.id })
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, id))
      .limit(1);

    const purged = await request(ctx.app)
      .post(`/api/recycle-bin/${entry!.id}/permanent-delete`)
      .set(auth(superToken))
      .send({ confirm: true });
    expect(purged.status, JSON.stringify(purged.body)).toBe(200);

    // The row is gone from `customers` entirely — this is the case a count(*)
    // generator got deterministically wrong.
    const gone = await ctx.db.select().from(customers).where(eq(customers.id, id));
    expect(gone).toHaveLength(0);

    // Three creates, none of which may be the purged number, and each above it.
    for (let i = 0; i < 3; i += 1) {
      const code = await createCustomer();
      expect(code).not.toBe(purgedCode);
      expect(suffix(code)).toBeGreaterThan(suffix(purgedCode));
    }

    const codes = await allCustomerCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });
});

/* ------------------------------------------------------------------ group D */

describe("D — the route and the Excel importer share ONE series", () => {
  it("6. route-created and importer-created codes never overlap", async () => {
    const before = await createCustomer();

    const imported = await importCustomers([nextRef(), nextRef(), nextRef()]);
    const after = await createCustomer();

    // Distinct, and strictly increasing across the boundary in both directions.
    const all = [before, ...imported, after];
    expect(new Set(all).size).toBe(all.length);
    for (let i = 1; i < all.length; i += 1) {
      expect(suffix(all[i]!), `${all[i - 1]} -> ${all[i]}`).toBeGreaterThan(suffix(all[i - 1]!));
    }

    // Every code in the table is still unique, importer rows included. Before
    // this task the importer counted `customers` itself and would happily mint
    // a code the route had already issued.
    const codes = await allCustomerCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("7. two consecutive imports do not restart the numbering", async () => {
    const first = await importCustomers([nextRef(), nextRef()]);
    const second = await importCustomers([nextRef()]);
    expect(suffix(second[0]!)).toBeGreaterThan(suffix(first[1]!));
  });
});

/* ------------------------------------------------------------------ group E */

describe("E — concurrent allocation", () => {
  it("8. N simultaneous creates get N distinct codes and no conflict", async () => {
    // PGlite is a single in-process connection, so `Promise.all` interleaves
    // rather than truly racing (D-032 recorded the same limitation). This is the
    // strongest end-to-end assertion the harness supports; test 9 models the
    // interleaving deterministically, which is where the real proof is.
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(ctx.app)
          .post("/api/customers")
          .set(auth(superToken))
          .send(customerPayload(bank.id, nextRef())),
      ),
    );

    for (const res of results) expect(res.status, JSON.stringify(res.body)).toBe(201);
    const codes = results.map((r) => r.body.data.code as string);
    expect(new Set(codes).size).toBe(8);
  });

  it("9. two callers that both allocate before either inserts get different codes", async () => {
    // This is the defect stated exactly. Under `codeStart + count(*) + 1` both
    // calls read the same count and return the SAME string, because neither has
    // inserted yet. `nextval` is atomic, so they cannot.
    const first = await nextResourceCode("CUS");
    const second = await nextResourceCode("CUS");
    expect(first).not.toBe(second);
    expect(suffix(second)).toBe(suffix(first) + 1);

    // A burnt number is a gap, not a reuse. The next real create skips past
    // both, and that is the intended, documented trade.
    const created = await createCustomer();
    expect(suffix(created)).toBeGreaterThan(suffix(second));
  });

  it("10. an unknown prefix fails loudly instead of falling back to a count", async () => {
    await expect(nextResourceCode("NOPE")).rejects.toThrow(/no code sequence/i);
  });
});

/* ------------------------------------------------------------------ group F */

describe("F — the sequence initialises from the highest code EVER issued", () => {
  /**
   * The migration's `setval` runs once, against whatever data already exists.
   * The harness always migrates an empty database, so the only honest way to
   * test the initialisation is to seed the three sources it reads and re-run
   * **the shipped statement itself**, lifted out of the migration file rather
   * than retyped here — a copy would pass while the real file was wrong.
   */
  function customerSetvalStatement(): string {
    const file = readFileSync("./drizzle/0006_code_sequences.sql", "utf8");
    const statement = file
      .split("--> statement-breakpoint")
      .map((chunk) => chunk.trim())
      .find((chunk) => chunk.startsWith("SELECT setval('customer_code_seq'"));
    expect(statement, "the customer setval statement moved or was renamed").toBeDefined();
    return statement!;
  }

  it("11. it reads live rows, soft-deleted rows AND purged bin snapshots", async () => {
    const before = await allCustomerCodes();
    expect(before.length).toBeGreaterThan(0);

    // (1) a live row, well above anything issued so far
    await ctx.db.insert(customers).values({
      code: "CUS-20000",
      bankId: bank.id,
      bankReferenceId: nextRef(),
      name: "High Live Customer",
      mobile: "9876500001",
    });

    // (2) a SOFT-DELETED row. Its code must still count — that absence of a
    // `deleted_at` filter is the load-bearing part of D-050.
    await ctx.db.insert(customers).values({
      code: "CUS-30000",
      bankId: bank.id,
      bankReferenceId: nextRef(),
      name: "High Deleted Customer",
      mobile: "9876500002",
      deletedAt: new Date(),
    });

    // (3) a PURGED record: the row is gone from `customers`, and only the
    // retained recycle-bin snapshot remembers the number.
    await ctx.db.insert(recycleBinEntries).values({
      recordType: "customer",
      recordId: "33333333-3333-4333-8333-333333333333",
      bankId: bank.id,
      label: "High Purged Customer",
      snapshot: { code: "CUS-40000", name: "High Purged Customer" } as never,
      purgeAfter: new Date(Date.now() + 86_400_000),
      purgedAt: new Date(),
    });

    await ctx.db.execute(sql.raw(customerSetvalStatement()));

    // The highest of the three wins, and the next code is one past it.
    expect(await createCustomer()).toBe("CUS-40001");

    // ...and nothing renumbered. Every code that existed still exists, verbatim.
    const after = await allCustomerCodes();
    for (const code of before) expect(after).toContain(code);
    expect(new Set(after).size).toBe(after.length);
  });

  it("12. re-running it never moves the sequence BACKWARDS", async () => {
    // GREATEST(codeStart, …) plus setval-to-the-max means a second run is a
    // no-op, even after the rows it read have been deleted.
    const beforeRerun = await createCustomer();
    await ctx.db.execute(sql.raw(customerSetvalStatement()));
    const afterRerun = await createCustomer();
    expect(suffix(afterRerun)).toBeGreaterThan(suffix(beforeRerun));

    const codes = await allCustomerCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("13. a non-conforming code contributes nothing and cannot be collided with", async () => {
    await ctx.db.insert(customers).values({
      code: "LEGACY-CONTRACT-77",
      bankId: bank.id,
      bankReferenceId: nextRef(),
      name: "Legacy Coded Customer",
      mobile: "9876500003",
    });

    await ctx.db.execute(sql.raw(customerSetvalStatement()));
    const code = await createCustomer();
    expect(code).toMatch(/^CUS-\d+$/);

    const codes = await allCustomerCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });
});
