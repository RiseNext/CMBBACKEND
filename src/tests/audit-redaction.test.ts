import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { desc, eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import * as schema from "../db/schema/index.js";
import { diff } from "../services/audit.js";

/**
 * SEC-017 — CUSTOMER PII IN `audit_logs.changes`. Task 13.8.
 *
 * `audit_logs` is **trigger-immutable** (`0001_governance_guards.sql` rejects
 * UPDATE and DELETE at the database) and has **no retention job**. A value that
 * lands there is permanent, uncorrectable and unerasable — which is why the
 * DPDP Act's erasure right is unanswerable for anything written into it.
 *
 * `REDACTED_FIELDS` held eight entries, all secrets, and missed **every piece
 * of ordinary customer PII**. One `PATCH /api/customers/:id` correcting a typo
 * wrote the customer's PAN, mobile, date of birth, address, account number and
 * IFSC into that table — twice each, as `{ from, to }`.
 *
 * The two assertions that matter are opposites and both are needed:
 *   · the VALUE must not be there (group A), and
 *   · the KEY must still be (group B) — otherwise the trail answers "nothing
 *     happened", which during a fraud investigation is worse than useless.
 */

const PASSWORD = "TestPassword123!";

let ctx: TestContext;
let bank: { id: string; code: string };
let token: string;

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);
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
async function makeCustomer() {
  seq += 1;
  const res = await request(ctx.app)
    .post("/api/customers")
    .set(auth())
    .send({
      bankId: bank.id,
      bankReferenceId: `REF-S17-${seq}`,
      name: `Audit Customer ${seq}`,
      mobile: `98470${String(10000 + seq)}`,
      monthlyIncome: 40000,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

async function latestChangesFor(recordId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.recordId, recordId))
    .orderBy(desc(schema.auditLogs.occurredAt))
    .limit(1);
  return (row?.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
}

/* ══ A — the VALUE never reaches the table ════════════════════════════════ */

describe("A · PII values do not reach an immutable, unpurgeable table", () => {
  it("1. THE FINDING: a routine PATCH no longer writes PAN, mobile, DOB, address, account or IFSC", async () => {
    const id = await makeCustomer();

    const pii = {
      pan: "ABCPK9999K",
      mobile: "9812345678",
      email: "very.identifiable@example.com",
      dob: "1988-03-14",
      address: "12 Banjara Hills, Hyderabad",
      accountNo: "50100123456789",
      ifsc: "HDFC0001234",
      fatherName: "Ramesh Kumar",
    };

    const res = await request(ctx.app)
      .patch(`/api/customers/${id}`)
      .set(auth())
      .send(pii);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // The sweep, not a field check: a field check passes while the value sits
    // one level down.
    const serialised = JSON.stringify(await latestChangesFor(id));
    for (const [field, value] of Object.entries(pii)) {
      expect(serialised, `${field} leaked into audit_logs.changes`).not.toContain(String(value));
    }
  });

  it("2. it is redacted in the DATABASE, not merely in the response", async () => {
    const id = await makeCustomer();
    await request(ctx.app).patch(`/api/customers/${id}`).set(auth()).send({ pan: "ZZZPZ1111Z" });

    const [row] = await ctx.db
      .select({ changes: schema.auditLogs.changes })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.recordId, id))
      .orderBy(desc(schema.auditLogs.occurredAt))
      .limit(1);

    expect(JSON.stringify(row!.changes)).not.toContain("ZZZPZ1111Z");
  });
});

/* ══ B — the KEY survives, so the trail still answers its question ════════ */

describe("B · the fact of the change is preserved", () => {
  it("3. a redacted field is still LISTED, with placeholders", async () => {
    const id = await makeCustomer();
    await request(ctx.app)
      .patch(`/api/customers/${id}`)
      .set(auth())
      .send({ accountNo: "50100999888777" });

    const changes = await latestChangesFor(id);
    // "Who changed the bank account, and when" must remain answerable.
    expect(Object.keys(changes)).toContain("accountNo");
    expect(changes.accountNo).toEqual({ from: "[redacted]", to: "[redacted]" });
  });

  it("4. a non-PII field keeps its real before and after", async () => {
    const id = await makeCustomer();
    await request(ctx.app).patch(`/api/customers/${id}`).set(auth()).send({ city: "Vijayawada" });

    const changes = await latestChangesFor(id);
    expect(changes.city?.to).toBe("Vijayawada");
  });

  it("5. an UNCHANGED redacted field is not listed — comparison uses the real values", async () => {
    /*
     * If the placeholders were compared instead of the values, every redacted
     * field would look identical on every write and vanish from the trail
     * entirely. Comparing the real values is what keeps case 3 true.
     */
    const before = { pan: "AAAPA1111A", city: "Hyderabad" };
    const after = { pan: "AAAPA1111A", city: "Vijayawada" };

    const changes = diff(before, after);
    expect(Object.keys(changes)).toEqual(["city"]);
  });

  it("6. a CHANGED redacted field is listed even though both sides render the same", () => {
    const changes = diff({ pan: "AAAPA1111A" }, { pan: "BBBPB2222B" });
    expect(changes.pan).toEqual({ from: "[redacted]", to: "[redacted]" });
  });
});

/* ══ C — the field list itself ════════════════════════════════════════════ */

describe("C · the redaction list covers what the finding names", () => {
  it("7. every field SEC-017 lists is redacted", () => {
    // The finding's own enumeration: pan, mobile, email, dob, accountNo, ifsc,
    // address, aadhaarLast4.
    const fields = ["pan", "mobile", "email", "dob", "accountNo", "ifsc", "address"];
    for (const f of fields) {
      const changes = diff({ [f]: "sensitive-value-here" }, { [f]: "different-value" });
      expect(JSON.stringify(changes), `${f} is not redacted`).not.toContain("sensitive-value-here");
    }
  });

  it("8. `aadhaarLast4` is deliberately NOT redacted, and that is a decision", () => {
    /*
     * Four digits carry no reconstruction risk, and they are how an operator
     * recognises which record the entry is about. Redacting them would cost
     * legibility for no privacy gain. SEC-017 lists it; Task 13.8 declines it
     * with a reason rather than silently.
     */
    const changes = diff({ aadhaarLast4: "1234" }, { aadhaarLast4: "5678" });
    expect(changes.aadhaarLast4).toEqual({ from: "1234", to: "5678" });
  });

  it("9. `name` is not redacted — it is the label the trail is ABOUT", () => {
    const changes = diff({ name: "Priya Raman" }, { name: "Priya R Raman" });
    expect(changes.name?.to).toBe("Priya R Raman");
  });

  it("10. secrets are still redacted, and now snake_case variants too", () => {
    for (const f of ["password", "passwordHash", "password_hash", "aadhaarHash", "aadhaar_hash", "tokenHash", "token_hash"]) {
      const changes = diff({ [f]: "a-real-secret-value" }, { [f]: "another-secret" });
      expect(JSON.stringify(changes), `${f} leaked`).not.toContain("a-real-secret-value");
    }
  });
});
