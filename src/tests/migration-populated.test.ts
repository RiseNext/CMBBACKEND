import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * POPULATED-DATABASE MIGRATION VERIFICATION — Phase 6–10, migrations 0008–0011
 * DECISIONS.md D-050, D-057 · PRODUCTION_ROADMAP.md "FINAL DATABASE PLAN"
 *
 * **Why this file exists.** `harness.ts` migrates a FRESH, EMPTY PGlite database
 * before every suite. That proves a migration's SYNTAX and can never prove its
 * DATA compatibility — an empty table satisfies every constraint ever written.
 * Phase 5 established that the difference is not theoretical: a plain
 * validating `ADD CONSTRAINT` for `loans_status_check` would have aborted on a
 * real off-vocabulary row, and only `NOT VALID` + a separate `VALIDATE` made it
 * deployable.
 *
 * Each block below builds a database, applies every migration up to but NOT
 * including the one under test, populates it with representative **and
 * deliberately offending** rows, and then applies the migration statement by
 * statement — asserting the exact failure mode an operator would meet.
 *
 * These databases are created and closed inside the tests. Nothing here touches
 * the project database, and no file in `drizzle/` is written.
 */

const DRIZZLE = path.resolve(process.cwd(), "drizzle");

const files = () =>
  readdirSync(DRIZZLE)
    .filter((f) => f.endsWith(".sql"))
    .sort();

const statementsOf = (tag: string): string[] =>
  readFileSync(path.join(DRIZZLE, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

/** Applies every migration whose filename sorts BEFORE `tag`. */
async function applyPriorTo(db: PGlite, tag: string): Promise<string[]> {
  const priors = files().filter((f) => f < `${tag}.sql`);
  for (const f of priors) {
    for (const stmt of readFileSync(path.join(DRIZZLE, f), "utf8").split(
      "--> statement-breakpoint",
    )) {
      const s = stmt.trim();
      if (s) await db.exec(s);
    }
  }
  return priors;
}

const BANK = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "22222222-2222-2222-2222-222222222222";
const LOAN = "33333333-3333-3333-3333-333333333333";

/** The minimum FK spine every operational table below hangs from. */
async function seedSpine(db: PGlite): Promise<void> {
  await db.exec(`
    insert into banks (id, code, name, short_name)
      values ('${BANK}', 'BNK-1', 'Test Bank', 'TB');
    insert into customers (id, code, bank_id, bank_reference_id, name, mobile)
      values ('${CUSTOMER}', 'CUS-10001', '${BANK}', 'REF-1', 'Test Customer', '9876543210');
    insert into loans (id, code, customer_id, bank_id, loan_type, status)
      values ('${LOAN}', 'LN-1001', '${CUSTOMER}', '${BANK}', 'Personal Loan', 'Approved');
  `);
}

let open: PGlite | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

async function freshDb(tag: string): Promise<PGlite> {
  const db = new PGlite();
  open = db;
  await db.waitReady;
  await applyPriorTo(db, tag);
  await seedSpine(db);
  return db;
}

/* ══ 0008 — bank-order vocabularies ═══════════════════════════════════════ */

describe("migration 0008 · bank-order stage and status vocabularies", () => {
  const TAG = "0008_bank_order_vocabularies";
  const STAGES = ["Login", "Credit Check", "Field Verification", "Sanction", "Disbursal Queue"];
  const STATUSES = ["In Progress", "On Hold", "Cleared", "Returned"];

  async function populate(db: PGlite, extra: Array<[string, string]> = []) {
    let n = 0;
    for (const stage of STAGES) {
      await db.query(
        `insert into bank_orders (id, code, loan_id, bank_id, customer_id, stage, status)
         values (gen_random_uuid(), $1, '${LOAN}', '${BANK}', '${CUSTOMER}', $2, 'In Progress')`,
        [`BO-${2400 + n++}`, stage],
      );
    }
    for (const status of STATUSES) {
      await db.query(
        `insert into bank_orders (id, code, loan_id, bank_id, customer_id, stage, status)
         values (gen_random_uuid(), $1, '${LOAN}', '${BANK}', '${CUSTOMER}', 'Login', $2)`,
        [`BO-${2400 + n++}`, status],
      );
    }
    for (const [stage, status] of extra) {
      await db.query(
        `insert into bank_orders (id, code, loan_id, bank_id, customer_id, stage, status)
         values (gen_random_uuid(), $1, '${LOAN}', '${BANK}', '${CUSTOMER}', $2, $3)`,
        [`BO-${2400 + n++}`, stage, status],
      );
    }
  }

  it("applies cleanly to a populated, entirely legal table", async () => {
    const db = await freshDb(TAG);
    await populate(db);

    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from bank_orders`,
    );
    expect(rows[0]!.n).toBe(STAGES.length + STATUSES.length);
  });

  it("NOT VALID succeeds on a dirty table; VALIDATE is what rejects the offender", async () => {
    const db = await freshDb(TAG);
    // An off-vocabulary stage AND an off-vocabulary status, including one on a
    // SOFT-DELETED row — VALIDATE reads those too, which is why the pre-flight
    // query deliberately has no `deleted_at is null` filter.
    await populate(db, [["Underwriting", "In Progress"]]);
    await db.query(
      `insert into bank_orders (id, code, loan_id, bank_id, customer_id, stage, status, deleted_at)
       values (gen_random_uuid(), 'BO-9999', '${LOAN}', '${BANK}', '${CUSTOMER}', 'Login', 'Escalated', now())`,
    );

    const [addStage, validateStage] = statementsOf(TAG);

    // 1. NOT VALID must SUCCEED even though offenders exist. That is its whole
    //    purpose and the reason a plain ADD CONSTRAINT is not used.
    await expect(db.exec(addStage!)).resolves.toBeDefined();

    // 2. VALIDATE must FAIL, with the check-violation SQLSTATE.
    await expect(db.exec(validateStage!)).rejects.toMatchObject({ code: "23514" });

    // 3. The header's pre-flight query must find exactly the two offenders,
    //    including the soft-deleted one.
    const { rows: offenders } = await db.query<{ code: string }>(`
      select code from bank_orders
      where stage not in ('Login','Credit Check','Field Verification','Sanction','Disbursal Queue')
         or status not in ('In Progress','On Hold','Cleared','Returned')
      order by code`);
    expect(offenders.map((r) => r.code)).toEqual(["BO-2409", "BO-9999"]);

    // 4. Once corrected, VALIDATE succeeds and the rest of the file applies.
    await db.exec(`update bank_orders set stage = 'Login' where stage = 'Underwriting'`);
    await db.exec(`update bank_orders set status = 'In Progress' where status = 'Escalated'`);
    await expect(db.exec(validateStage!)).resolves.toBeDefined();
    for (const stmt of statementsOf(TAG).slice(2)) await db.exec(stmt);
  });

  it("rejects off-vocabulary writes afterwards and still accepts every legal value", async () => {
    const db = await freshDb(TAG);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    await expect(
      db.query(
        `insert into bank_orders (id, code, loan_id, bank_id, customer_id, stage, status)
         values (gen_random_uuid(), 'BO-8888', '${LOAN}', '${BANK}', '${CUSTOMER}', 'Underwriting', 'In Progress')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // The trailing-space class D-010 opens with.
    await expect(
      db.query(
        `insert into bank_orders (id, code, loan_id, bank_id, customer_id, stage, status)
         values (gen_random_uuid(), 'BO-8887', '${LOAN}', '${BANK}', '${CUSTOMER}', 'Login', 'Cleared ')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    let n = 0;
    for (const stage of STAGES) {
      for (const status of STATUSES) {
        await db.query(
          `insert into bank_orders (id, code, loan_id, bank_id, customer_id, stage, status)
           values (gen_random_uuid(), $1, '${LOAN}', '${BANK}', '${CUSTOMER}', $2, $3)`,
          [`BO-${7000 + n++}`, stage, status],
        );
      }
    }
    expect(n).toBe(STAGES.length * STATUSES.length);
  });
});

/* ══ 0009 — disbursement status vocabulary ════════════════════════════════ */

describe("migration 0009 · disbursement status vocabulary", () => {
  const TAG = "0009_disbursement_status_check";
  const LEGAL = ["Credited", "In Transit", "Failed"];

  async function populate(db: PGlite, extra: string[] = []) {
    let n = 0;
    for (const status of [...LEGAL, ...extra]) {
      await db.query(
        `insert into disbursements (id, code, loan_id, bank_id, customer_id, amount, mode, status)
         values (gen_random_uuid(), $1, '${LOAN}', '${BANK}', '${CUSTOMER}', '50000', 'NEFT', $2)`,
        [`DSB-${5000 + n++}`, status],
      );
    }
  }

  it("applies cleanly to a populated, entirely legal table", async () => {
    const db = await freshDb(TAG);
    await populate(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from disbursements`);
    expect(rows[0]!.n).toBe(LEGAL.length);
  });

  it("NOT VALID survives the exact row the unconstrained approve route could write", async () => {
    const db = await freshDb(TAG);
    // D-010's opening example, and SEC-016's abuse scenario, verbatim: a
    // trailing space. `status <> btrim(status)` is invisible to every
    // reconciliation query that filters on 'Credited'.
    await populate(db, ["Credited "]);

    const [add, validate] = statementsOf(TAG);

    await expect(db.exec(add!)).resolves.toBeDefined();
    await expect(db.exec(validate!)).rejects.toMatchObject({ code: "23514" });

    const { rows: offenders } = await db.query<{ code: string; status: string }>(
      `select code, status from disbursements
       where status not in ('Credited', 'In Transit', 'Failed')`,
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.status).toBe("Credited ");

    // The documented repair: trim, never widen and never delete — a
    // disbursement row records that money moved.
    await db.exec(
      `update disbursements set status = btrim(status)
       where btrim(status) in ('Credited','In Transit','Failed') and status <> btrim(status)`,
    );
    await expect(db.exec(validate!)).resolves.toBeDefined();

    const { rows: after } = await db.query<{ n: number }>(
      `select count(*)::int as n from disbursements`,
    );
    expect(after[0]!.n).toBe(LEGAL.length + 1); // repaired, not removed
  });

  it("rejects the trailing-space write afterwards and accepts every legal value", async () => {
    const db = await freshDb(TAG);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    await expect(
      db.query(
        `insert into disbursements (id, code, loan_id, bank_id, customer_id, amount, mode, status)
         values (gen_random_uuid(), 'DSB-8888', '${LOAN}', '${BANK}', '${CUSTOMER}', '1', 'NEFT', 'Credited ')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    let n = 0;
    for (const status of LEGAL) {
      await db.query(
        `insert into disbursements (id, code, loan_id, bank_id, customer_id, amount, mode, status)
         values (gen_random_uuid(), $1, '${LOAN}', '${BANK}', '${CUSTOMER}', '1', 'NEFT', $2)`,
        [`DSB-${7000 + n++}`, status],
      );
    }
    expect(n).toBe(LEGAL.length);
  });

  it("leaves the partial UTR unique index alone — many NULL UTRs stay legal (D-067)", async () => {
    const db = await freshDb(TAG);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    // A disbursement is recorded when the transfer is initiated; the UTR
    // arrives afterwards. Several may be in flight at once.
    for (const code of ["DSB-9001", "DSB-9002", "DSB-9003"]) {
      await db.query(
        `insert into disbursements (id, code, loan_id, bank_id, customer_id, amount, mode, status, utr)
         values (gen_random_uuid(), $1, '${LOAN}', '${BANK}', '${CUSTOMER}', '1', 'NEFT', 'In Transit', null)`,
        [code],
      );
    }
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from disbursements where utr is null`,
    );
    expect(rows[0]!.n).toBe(3);

    // A duplicate REAL utr is still refused.
    await db.query(
      `insert into disbursements (id, code, loan_id, bank_id, customer_id, amount, mode, status, utr)
       values (gen_random_uuid(), 'DSB-9004', '${LOAN}', '${BANK}', '${CUSTOMER}', '1', 'NEFT', 'Credited', 'UTR12345')`,
    );
    await expect(
      db.query(
        `insert into disbursements (id, code, loan_id, bank_id, customer_id, amount, mode, status, utr)
         values (gen_random_uuid(), 'DSB-9005', '${LOAN}', '${BANK}', '${CUSTOMER}', '1', 'NEFT', 'Credited', 'utr12345')`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

/* ══ 0010 — chain idempotency ═════════════════════════════════════════════ */

describe("migration 0010 · settlement → transaction → ledger idempotency", () => {
  const TAG = "0010_chain_idempotency";
  const SETTLEMENT = "44444444-4444-4444-4444-444444444444";

  async function seedSettlement(db: PGlite) {
    await db.query(
      `insert into settlements (id, code, bank_id, period, gross_commission, tds, net_payable, status)
       values ('${SETTLEMENT}', 'STL-3001', '${BANK}', '2026-09', '10000', '1000', '9000', 'Pending')`,
    );
  }

  const insertTxn = (db: PGlite, code: string, settlementId: string | null, deleted = false) =>
    db.query(
      `insert into transactions (id, code, bank_id, amount, txn_type, status, settlement_id, deleted_at)
       values (gen_random_uuid(), $1, '${BANK}', '9000', 'Commission', 'Success', $2, ${deleted ? "now()" : "null"})
       returning id`,
      [code, settlementId],
    );

  it("applies cleanly and permits many rows with a NULL settlement_id", async () => {
    const db = await freshDb(TAG);
    await seedSettlement(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    // The overwhelming majority of transactions carry no settlement. An
    // unconditional unique index would have permitted exactly one of these.
    for (const code of ["TXN-77001", "TXN-77002", "TXN-77003"]) {
      await insertTxn(db, code, null);
    }
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from transactions where settlement_id is null`,
    );
    expect(rows[0]!.n).toBe(3);
  });

  it("REJECTS a second live transaction for the same settlement with 23505", async () => {
    const db = await freshDb(TAG);
    await seedSettlement(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    await insertTxn(db, "TXN-77010", SETTLEMENT);
    // This is the double-approve race. F1 makes each attempt atomic; only the
    // index stops the second one from doubling the commission in the books.
    await expect(insertTxn(db, "TXN-77011", SETTLEMENT)).rejects.toMatchObject({ code: "23505" });
  });

  it("allows a re-post once the previous chain is soft-deleted", async () => {
    const db = await freshDb(TAG);
    await seedSettlement(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    await insertTxn(db, "TXN-77020", SETTLEMENT, true); // voided
    // `deleted_at is null` in the predicate exists for exactly this: a voided
    // chain must not permanently block a legitimate re-post.
    await expect(insertTxn(db, "TXN-77021", SETTLEMENT)).resolves.toBeDefined();
  });

  it("enforces one ledger entry per transaction, and permits many with none", async () => {
    const db = await freshDb(TAG);
    await seedSettlement(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    const { rows } = await insertTxn(db, "TXN-77030", SETTLEMENT);
    const txnId = (rows[0] as { id: string }).id;

    const insertLedger = (code: string, transactionId: string | null) =>
      db.query(
        `insert into ledger_entries (id, code, bank_id, particulars, category, transaction_id, debit, credit, balance)
         values (gen_random_uuid(), $1, '${BANK}', 'Commission received', 'Commission', $2, '0', '9000', '0')`,
        [code, transactionId],
      );

    await insertLedger("LG-9001", txnId);
    await expect(insertLedger("LG-9002", txnId)).rejects.toMatchObject({ code: "23505" });

    // Hand-written entries carry no transaction and are unaffected.
    await insertLedger("LG-9003", null);
    await insertLedger("LG-9004", null);
    const { rows: free } = await db.query<{ n: number }>(
      `select count(*)::int as n from ledger_entries where transaction_id is null`,
    );
    expect(free[0]!.n).toBe(2);
  });

  it("the pre-flight duplicate queries return nothing on a clean database", async () => {
    const db = await freshDb(TAG);
    await seedSettlement(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    const dupTxn = await db.query(
      `select settlement_id from transactions
       where settlement_id is not null and deleted_at is null
       group by settlement_id having count(*) > 1`,
    );
    const dupLedger = await db.query(
      `select transaction_id from ledger_entries
       where transaction_id is not null and deleted_at is null
       group by transaction_id having count(*) > 1`,
    );
    expect(dupTxn.rows).toHaveLength(0);
    expect(dupLedger.rows).toHaveLength(0);
  });
});

/* ══ 0011 — notification event model ══════════════════════════════════════ */

describe("migration 0011 · notification event identity and required recipient", () => {
  const TAG = "0011_notification_event_model";
  const ROLE = "55555555-5555-5555-5555-555555555555";
  const USER_A = "66666666-6666-6666-6666-666666666666";
  const USER_B = "77777777-7777-7777-7777-777777777777";

  async function seedUsers(db: PGlite) {
    await db.query(
      `insert into roles (id, key, name, level) values ('${ROLE}', 'tester', 'Tester', 50)`,
    );
    for (const [id, code] of [
      [USER_A, "EMP-9001"],
      [USER_B, "EMP-9002"],
    ]) {
      await db.query(
        `insert into users (id, employee_code, name, email, password_hash, role_id, status)
         values ($1, $2, 'Fixture', $3, 'x', '${ROLE}', 'Active')`,
        [id, code, `${code}@risenext.test`],
      );
    }
  }

  const insertNotification = (
    db: PGlite,
    userId: string | null,
    eventKey: string | null,
    eventType = "loan.approved",
  ) =>
    db.query(
      `insert into notifications (id, user_id, title, message, event_type, event_key)
       values (gen_random_uuid(), $1, 'T', 'M', $2, $3)`,
      [userId, eventType, eventKey],
    );

  it("applies to a table that already holds legal rows", async () => {
    const db = await freshDb(TAG);
    await seedUsers(db);
    // Pre-existing rows, all with a recipient — the shape the columns allowed
    // before this migration.
    for (let i = 0; i < 3; i += 1) {
      await db.query(
        `insert into notifications (id, user_id, title, message)
         values (gen_random_uuid(), '${USER_A}', 'Old', 'Message')`,
      );
    }

    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    // `event_type` was added WITH a default and the default then dropped, so
    // pre-existing rows are backfilled rather than rejected.
    const { rows } = await db.query<{ n: number; event_type: string }>(
      `select count(*)::int as n, min(event_type) as event_type from notifications`,
    );
    expect(rows[0]!.n).toBe(3);
    expect(rows[0]!.event_type).toBe("legacy");

    // ...and the default is gone, so a new insert must supply it.
    await expect(
      db.query(
        `insert into notifications (id, user_id, title, message)
         values (gen_random_uuid(), '${USER_A}', 'New', 'Message')`,
      ),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("ABORTS rather than deleting when a null-recipient row exists", async () => {
    const db = await freshDb(TAG);
    await seedUsers(db);
    await db.query(
      `insert into notifications (id, user_id, title, message)
       values (gen_random_uuid(), null, 'Orphan', 'Invisible to everyone')`,
    );

    const [setNotNull] = statementsOf(TAG);
    // The migration deletes nothing. It fails loudly and leaves the row for an
    // operator to review and record — a silent DELETE in a migration is exactly
    // the destructive transformation the project rules forbid.
    await expect(db.exec(setNotNull!)).rejects.toMatchObject({ code: "23502" });

    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from notifications`);
    expect(rows[0]!.n).toBe(1); // still there, untouched
  });

  it("rejects a duplicate event_key for the SAME user with 23505", async () => {
    const db = await freshDb(TAG);
    await seedUsers(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    const key = "loan.approved:loan:33333333-3333-3333-3333-333333333333:";
    await insertNotification(db, USER_A, key);
    // The retry case. Transaction atomicity cannot catch this — a retry is a
    // second transaction and commits happily without the index.
    await expect(insertNotification(db, USER_A, key)).rejects.toMatchObject({ code: "23505" });
  });

  it("accepts the SAME event_key for a DIFFERENT user — fan-out is one row each", async () => {
    const db = await freshDb(TAG);
    await seedUsers(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    const key = "settlement.paid:settlement:44444444-4444-4444-4444-444444444444:";
    await insertNotification(db, USER_A, key, "settlement.paid");
    // Keyed on (user_id, event_key), not event_key alone: each recipient is
    // deduplicated independently.
    await expect(insertNotification(db, USER_B, key, "settlement.paid")).resolves.toBeDefined();
  });

  it("permits many rows with a null event_key", async () => {
    const db = await freshDb(TAG);
    await seedUsers(db);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    for (let i = 0; i < 3; i += 1) await insertNotification(db, USER_A, null, "manual");
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from notifications where event_key is null`,
    );
    expect(rows[0]!.n).toBe(3);
  });
});

/* ══ 0013 — one live bank order per loan ══════════════════════════════════ */

describe("migration 0013 · one live bank order per loan", () => {
  const TAG = "0013_bank_order_per_loan";

  const insertOrder = (db: PGlite, code: string, deleted = false) =>
    db.query(
      `insert into bank_orders (id, code, loan_id, bank_id, customer_id, stage, status, deleted_at)
       values (gen_random_uuid(), $1, '${LOAN}', '${BANK}', '${CUSTOMER}', 'Login', 'In Progress', ${deleted ? "now()" : "null"})`,
      [code],
    );

  it("applies cleanly when every loan has at most one order", async () => {
    const db = await freshDb(TAG);
    await insertOrder(db, "BO-2401");
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from bank_orders`);
    expect(rows[0]!.n).toBe(1);
  });

  it("FAILS OUTRIGHT on a pre-existing duplicate — an index has no NOT VALID", async () => {
    const db = await freshDb(TAG);
    await insertOrder(db, "BO-2401");
    await insertOrder(db, "BO-2402");

    // This is why the header's pre-flight is two queries rather than a
    // footnote: unlike a CHECK, `CREATE UNIQUE INDEX` cannot be deferred.
    await expect(db.exec(statementsOf(TAG)[0]!)).rejects.toMatchObject({ code: "23505" });

    // The pre-flight query finds exactly the offending loan.
    const { rows: dupes } = await db.query<{ loan_id: string; count: number }>(
      `select loan_id, count(*)::int as count from bank_orders
       where deleted_at is null group by loan_id having count(*) > 1`,
    );
    expect(dupes).toHaveLength(1);

    /*
     * The documented repair is a SOFT delete, not a hard one: the two rows may
     * carry different stages, officers and remarks, and the file trail is worth
     * keeping. Soft-deleting excludes it from the partial predicate.
     */
    await db.exec(`update bank_orders set deleted_at = now() where code = 'BO-2402'`);
    await expect(db.exec(statementsOf(TAG)[0]!)).resolves.toBeDefined();
  });

  it("rejects a second live order afterwards, and permits one after a soft delete", async () => {
    const db = await freshDb(TAG);
    for (const stmt of statementsOf(TAG)) await db.exec(stmt);

    await insertOrder(db, "BO-2401");
    await expect(insertOrder(db, "BO-2402")).rejects.toMatchObject({ code: "23505" });

    // The recycle bin must not permanently freeze a file.
    await db.exec(`update bank_orders set deleted_at = now() where code = 'BO-2401'`);
    await expect(insertOrder(db, "BO-2403")).resolves.toBeDefined();
  });
});

/* ══ 0014 — the status-vocabulary sweep ═══════════════════════════════════ */

describe("migration 0014 · the status-vocabulary sweep (Task 13.13)", () => {
  const TAG = "0014_status_check_sweep";

  /** Every column this migration constrains, with a legal and an illegal value. */
  const COLUMNS = [
    { table: "banks", legal: "Paused", illegal: "Inactive" },
    { table: "customers", legal: "Follow Up", illegal: "follow up" },
    { table: "documents", legal: "Rejected", illegal: "Verified " },
    { table: "funding_sources", legal: "Inactive", illegal: "Paused" },
    { table: "service_providers", legal: "Inactive", illegal: "Archived" },
    { table: "settlements", legal: "Disputed", illegal: "Settled" },
    { table: "transactions", legal: "Failed", illegal: "Succeeded" },
    { table: "verifications", legal: "In Progress", illegal: "in progress" },
    { table: "users", legal: "Inactive", illegal: "Suspended" },
  ] as const;

  /** The seed does not run here, so `users` needs a role to point at. */
  async function seedRole(db: PGlite) {
    await db.exec(
      "insert into roles (key, name, level, is_system) values ('t_role', 'T', 50, false);",
    );
  }

  /** One row for the named table, carrying the given status. */
  async function seedOne(db: PGlite, table: string, status: string, n: string) {
    const sql: Record<string, string> = {
      banks: `insert into banks (code, name, short_name, status) values ('BK-${n}', 'B${n}', 'B${n}', '${status}')`,
      customers: `insert into customers (code, bank_id, bank_reference_id, name, mobile, status) values ('CU-${n}', '${BANK}', 'R-${n}', 'C${n}', '9${n.padStart(9, "0")}', '${status}')`,
      documents: `insert into documents (bank_id, doc_type, file_name, status) values ('${BANK}', 'PAN', 'f${n}.pdf', '${status}')`,
      funding_sources: `insert into funding_sources (name, source_type, status) values ('FS-${n}', 'own_funds', '${status}')`,
      service_providers: `insert into service_providers (name, provider_type, status) values ('SP-${n}', 'Field Verification', '${status}')`,
      settlements: `insert into settlements (code, bank_id, period, status) values ('ST-${n}', '${BANK}', 'P-${n}', '${status}')`,
      transactions: `insert into transactions (code, bank_id, txn_type, amount, status) values ('TX-${n}', '${BANK}', 'Commission', 100, '${status}')`,
      verifications: `insert into verifications (loan_id, bank_id, status) values ('${LOAN}', '${BANK}', '${status}')`,
      users: `insert into users (employee_code, name, email, password_hash, role_id, status) select 'EMP-${n}', 'U${n}', 'u${n}@t.test', 'x', id, '${status}' from roles limit 1`,
    };
    const stmt = sql[table];
    if (!stmt) throw new Error(`unhandled table ${table}`);
    return db.exec(`${stmt};`);
  }

  const CHECK_COUNT =
    "select count(*)::int n from pg_constraint where contype = 'c' and conname like '%_status_check'";

  it("adds nine status constraints, taking the repository from 4 to 13", async () => {
    const db = await freshDb(TAG);
    const before = await db.query<{ n: number }>(CHECK_COUNT);
    for (const s of statementsOf(TAG)) await db.exec(s);
    const after = await db.query<{ n: number }>(CHECK_COUNT);

    // 0007 loans, 0008 bank_orders (status), 0009 disbursements = 3 named
    // `_status_check` before this; +9 here. (0008's `_stage_check` is counted
    // separately and is why the repository total is 13, not 12.)
    expect(after.rows[0]!.n - before.rows[0]!.n).toBe(9);
    expect(after.rows[0]!.n).toBe(12);
  });

  it("applies cleanly to a populated, entirely legal database", async () => {
    const db = await freshDb(TAG);
    await seedRole(db);
    let i = 0;
    for (const c of COLUMNS) await seedOne(db, c.table, c.legal, String(++i));

    for (const s of statementsOf(TAG)) await db.exec(s);

    // Every seeded row survived. A migration must never rewrite data.
    const rows = await db.query<{ n: number }>("select count(*)::int n from settlements");
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("NOT VALID succeeds on a dirty table; the separate VALIDATE is what rejects it", async () => {
    /*
     * `verifications` is SEC-016's last column and the one that could genuinely
     * hold an off-vocabulary value in production: it HAS an approve route, and
     * `approveBody` fell back to `z.string().min(1)` for it until this sweep.
     * A trailing space is the exact shape D-010 opens with.
     */
    const db = await freshDb(TAG);
    await db.exec(
      `insert into verifications (loan_id, bank_id, status) values ('${LOAN}', '${BANK}', 'Verified ');`,
    );

    const add = statementsOf(TAG).find(
      (s) => s.includes("verifications_status_check") && s.includes("NOT VALID"),
    )!;
    const validate = statementsOf(TAG).find(
      (s) => s.includes("VALIDATE CONSTRAINT") && s.includes("verifications_status_check"),
    )!;
    expect(add).toBeTruthy();
    expect(validate).toBeTruthy();

    // The catalogue write succeeds even with an offender present. That is the
    // entire reason the two statements are separate: a one-shot ADD CONSTRAINT
    // would abort here and take the deployment with it.
    await db.exec(add);
    await expect(db.exec(validate)).rejects.toThrow();
  });

  it("an offender that is SOFT-DELETED still fails VALIDATE — a CHECK has no WHERE", async () => {
    const db = await freshDb(TAG);
    await db.exec(
      `insert into settlements (code, bank_id, period, status, deleted_at) values ('ST-X', '${BANK}', 'P-X', 'Settled', now());`,
    );

    const add = statementsOf(TAG).find(
      (s) => s.includes("settlements_status_check") && s.includes("NOT VALID"),
    )!;
    const validate = statementsOf(TAG).find(
      (s) => s.includes("VALIDATE CONSTRAINT") && s.includes("settlements_status_check"),
    )!;

    await db.exec(add);
    // This is why every pre-flight query in this repository omits the
    // `deleted_at` filter, and why the header says so explicitly.
    await expect(db.exec(validate)).rejects.toThrow();
  });

  it("afterwards every legal value is accepted and every illegal one rejected", async () => {
    const db = await freshDb(TAG);
    await seedRole(db);
    for (const s of statementsOf(TAG)) await db.exec(s);

    let i = 100;
    for (const c of COLUMNS) {
      await expect(
        seedOne(db, c.table, c.legal, String(++i)),
        `${c.table} must still accept ${c.legal}`,
      ).resolves.toBeDefined();

      await expect(
        seedOne(db, c.table, c.illegal, String(++i)),
        `${c.table} must reject ${c.illegal}`,
      ).rejects.toThrow();
    }
  });

  it("the pre-flight offender query returns nothing on a clean database", async () => {
    const db = await freshDb(TAG);
    await seedRole(db);
    let i = 200;
    for (const c of COLUMNS) await seedOne(db, c.table, c.legal, String(++i));

    const res = await db.query<{ n: number }>(`
      select count(*)::int n from (
        select 1 from users where status not in ('Active','Inactive')
        union all select 1 from banks where status not in ('Active','Paused')
        union all select 1 from customers where status not in ('Active','Follow Up','Closed')
        union all select 1 from documents where status not in ('Verified','Pending','Rejected')
        union all select 1 from funding_sources where status not in ('Active','Inactive')
        union all select 1 from service_providers where status not in ('Active','Inactive')
        union all select 1 from settlements where status not in ('Paid','Pending','Disputed')
        union all select 1 from transactions where status not in ('Success','Pending','Failed')
        union all select 1 from verifications where status not in ('Pending','Requested','In Progress','Verified','Rejected','Failed','Expired')
      ) offenders`);

    expect(res.rows[0]!.n).toBe(0);
  });
});

/* ══ 0015 — every ledger entry belongs to a bank ══════════════════════════ */

describe("migration 0015 · ledger_entries.bank_id becomes NOT NULL (OPEN-7 / D-084)", () => {
  const TAG = "0015_ledger_bank_required";

  const entry = (n: string, bank: string | null) =>
    `insert into ledger_entries (code, bank_id, particulars, category, debit, credit) values ('LG-${n}', ${bank ? `'${bank}'` : "null"}, 'E${n}', 'Commission', 0, 100);`;

  /*
   * Matches the SQL, NOT the comment header.
   *
   * This migration's header is part of statement 1 and it *describes* the four
   * steps in prose — so a naive `includes("VALIDATE CONSTRAINT")` matched the
   * header and returned the ADD CONSTRAINT statement instead. Stripping block
   * comments before matching is what makes the needle mean what it says.
   */
  const sqlOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const stmt = (needle: string) => {
    const found = statementsOf(TAG).find((s) => sqlOf(s).includes(needle));
    if (!found) throw new Error(`no statement matching ${needle}`);
    return found;
  };

  it("applies cleanly when every entry already carries a bank", async () => {
    const db = await freshDb(TAG);
    await db.exec(entry("1", BANK));
    await db.exec(entry("2", BANK));

    for (const s of statementsOf(TAG)) await db.exec(s);

    const rows = await db.query<{ n: number }>("select count(*)::int n from ledger_entries");
    expect(rows.rows[0]!.n).toBe(2); // nothing was rewritten or dropped
  });

  it("the pre-flight query returns nothing on a clean database", async () => {
    const db = await freshDb(TAG);
    await db.exec(entry("1", BANK));

    const res = await db.query<{ n: number }>(
      "select count(*)::int n from ledger_entries where bank_id is null",
    );
    expect(res.rows[0]!.n).toBe(0);
  });

  it("THE GUARD: step 1 stops any NEW null immediately, before the scan", async () => {
    /*
     * This is why the CHECK is added NOT VALID first rather than going straight
     * to SET NOT NULL. From this statement onward no new offender can be
     * written, even though existing rows have not been verified yet — so a
     * deployment that pauses between steps is still protected.
     */
    const db = await freshDb(TAG);
    await db.exec(stmt("ADD CONSTRAINT \"ledger_entries_bank_id_not_null\""));

    await expect(db.exec(entry("X", null))).rejects.toThrow();
    await expect(db.exec(entry("Y", BANK))).resolves.toBeDefined();
  });

  it("THE OFFENDER PATH: NOT VALID succeeds on dirty data; VALIDATE is what refuses it", async () => {
    const db = await freshDb(TAG);
    await db.exec(entry("NULL1", null)); // the exact row OPEN-7 describes

    // The catalogue write succeeds even with an offender present. That is the
    // whole reason the steps are separate: a bare SET NOT NULL would abort the
    // deployment here with no partial protection left behind.
    await expect(db.exec(stmt("ADD CONSTRAINT \"ledger_entries_bank_id_not_null\""))).resolves.toBeDefined();
    await expect(db.exec(stmt("VALIDATE CONSTRAINT"))).rejects.toThrow();
  });

  it("a SOFT-DELETED offender still blocks it — SET NOT NULL has no WHERE", async () => {
    const db = await freshDb(TAG);
    await db.exec(
      "insert into ledger_entries (code, bank_id, particulars, category, debit, credit, deleted_at) values ('LG-D', null, 'gone', 'Commission', 0, 100, now());",
    );

    await db.exec(stmt("ADD CONSTRAINT \"ledger_entries_bank_id_not_null\""));
    // This is why the pre-flight in the header omits the `deleted_at` filter.
    await expect(db.exec(stmt("VALIDATE CONSTRAINT"))).rejects.toThrow();
  });

  it("the migration is RETRYABLE once the data is fixed", async () => {
    const db = await freshDb(TAG);
    await db.exec(entry("NULL1", null));

    await db.exec(stmt("ADD CONSTRAINT \"ledger_entries_bank_id_not_null\""));
    await expect(db.exec(stmt("VALIDATE CONSTRAINT"))).rejects.toThrow();

    // The business supplies the missing bank; the operator applies it as an
    // explicit reviewed change. The migration then completes from where it
    // stopped — no rollback, no re-run of step 1.
    await db.exec(`update ledger_entries set bank_id = '${BANK}' where bank_id is null;`);
    await expect(db.exec(stmt("VALIDATE CONSTRAINT"))).resolves.toBeDefined();
    await expect(db.exec(stmt("SET NOT NULL"))).resolves.toBeDefined();
  });

  it("afterwards a bank-less entry is impossible and the helper CHECK is gone", async () => {
    const db = await freshDb(TAG);
    for (const s of statementsOf(TAG)) await db.exec(s);

    await expect(db.exec(entry("Z", null))).rejects.toThrow();
    await expect(db.exec(entry("W", BANK))).resolves.toBeDefined();

    // Step 4 drops the scaffolding: the column's own NOT NULL now carries it.
    const left = await db.query<{ n: number }>(
      "select count(*)::int n from pg_constraint where conname = 'ledger_entries_bank_id_not_null'",
    );
    expect(left.rows[0]!.n).toBe(0);
  });

  it("the FK moves SET NULL -> RESTRICT, so a bank owning entries cannot be deleted", async () => {
    const db = await freshDb(TAG);

    const before = await db.query<{ d: string }>(
      "select confdeltype d from pg_constraint where conname = 'ledger_entries_bank_id_banks_id_fk'",
    );
    expect(before.rows[0]!.d).toBe("n"); // SET NULL — incompatible with NOT NULL

    for (const s of statementsOf(TAG)) await db.exec(s);

    const after = await db.query<{ d: string }>(
      "select confdeltype d from pg_constraint where conname = 'ledger_entries_bank_id_banks_id_fk'",
    );
    expect(after.rows[0]!.d).toBe("r"); // RESTRICT

    // And it bites: deleting the bank is refused rather than nulling the column
    // out from under the constraint. Immutable financial records (D-069).
    await db.exec(entry("K", BANK));
    await expect(db.exec(`delete from banks where id = '${BANK}';`)).rejects.toThrow();
  });
});
