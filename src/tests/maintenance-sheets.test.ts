import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  customerPayload,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import * as schema from "../db/schema/index.js";

/**
 * MANAGER MAINTENANCE — the four tracking formats. Task MM-1, D-095.
 *
 * What this suite is actually for: management supplied four spreadsheets, and
 * the claim being tested is that the CRM can produce them FROM THE RECORDS IT
 * ALREADY HAS, without a second copy of the business in spreadsheet shape.
 *
 * So the assertions are mostly about PROVENANCE, not formatting:
 *
 *   · every value on a sheet traces back to the authoritative row it came from;
 *   · a value the CRM does not have comes back NULL and is never invented —
 *     the manager's own sheets have blank cells and so must ours (D-004);
 *   · `Fund Credited to Customer` appears only for money that actually landed;
 *   · `Payment Status` is maintenance data and cannot move money;
 *   · bank scoping holds across a four-table join, which is the one place this
 *     feature could plausibly leak.
 */

let ctx: TestContext;

/** Bank A — the tenant everything below belongs to unless stated otherwise. */
let bankA: { id: string; code: string };
/** Bank B — exists only so the isolation cases have somewhere to leak TO. */
let bankB: { id: string; code: string };

let adminToken: string;
let managerToken: string;
/** Holds `disbursements.view` but no `maintenance.*` — the 403 case. */
let executiveToken: string;
/** Scoped to Bank B alone. */
let bankBToken: string;

let regionId: string;
let areaId: string;
let branchId: string;

let customerAId: string;
let loanAId: string;
let creditedDisbursementId: string;
let inTransitDisbursementId: string;
let verificationId: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.accessToken as string;
}

/**
 * Walks a Submitted loan to Approved through the ratified state machine:
 * `Submitted -> Under Review -> Approved`. There is no direct edge, and the
 * approve route requires the sanctioned amount on the `-> Approved` hop.
 */
async function approveLoan(loanId: string, amountApproved: number): Promise<void> {
  const review = await request(ctx.app)
    .post(`/api/loans/${loanId}/approve`)
    .set(auth(adminToken))
    .send({ status: "Under Review" });
  expect(review.status, JSON.stringify(review.body)).toBe(200);

  const approved = await request(ctx.app)
    .post(`/api/loans/${loanId}/approve`)
    .set(auth(adminToken))
    .send({ status: "Approved", amountApproved });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
}

beforeAll(async () => {
  ctx = await createTestContext();

  bankA = await createBank(ctx.db, "Maintenance Bank A");
  bankB = await createBank(ctx.db, "Maintenance Bank B");

  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  adminToken = await login(admin.email, admin.password);

  const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bankA.id] });
  managerToken = await login(manager.email, manager.password);

  const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bankA.id] });
  executiveToken = await login(executive.email, executive.password);

  const bankBUser = await createUser(ctx.db, { roleKey: "manager", bankIds: [bankB.id] });
  bankBToken = await login(bankBUser.email, bankBUser.password);

  /* ── The geography the sheets group by ───────────────────────────────────── */

  const region = await request(ctx.app)
    .post("/api/maintenance/regions")
    .set(auth(adminToken))
    .send({ name: "Telangana" });
  expect(region.status).toBe(201);
  regionId = region.body.data.id;

  const area = await request(ctx.app)
    .post("/api/maintenance/areas")
    .set(auth(adminToken))
    .send({ regionId, name: "HYDERABAD" });
  expect(area.status).toBe(201);
  areaId = area.body.data.id;

  const branch = await request(ctx.app)
    .post("/api/maintenance/branches")
    .set(auth(adminToken))
    .send({ areaId, bankId: bankA.id, name: "OMKAR NAGAR" });
  expect(branch.status).toBe(201);
  branchId = branch.body.data.id;

  /* ── A real customer, loan, verification and two disbursements ───────────── */

  const customer = await request(ctx.app)
    .post("/api/customers")
    .set(auth(adminToken))
    .send(
      customerPayload(bankA.id, "MAINT-1", {
        name: "Yata Mahesh",
        mobile: "9000000001",
        occupation: "Business",
      }),
    );
  expect(customer.status).toBe(201);
  customerAId = customer.body.data.id;

  const loan = await request(ctx.app).post("/api/loans").set(auth(adminToken)).send({
    customerId: customerAId,
    bankId: bankA.id,
    loanType: "Business Loan",
    amountRequested: 300000,
    status: "Submitted",
  });
  expect(loan.status).toBe(201);
  loanAId = loan.body.data.id;

  // The loan must be Approved before a disbursement may be recorded against it,
  // and the ratified machine has no `Submitted -> Approved` edge — it goes
  // through Under Review. The setup walks the real graph rather than bypassing
  // it, because a maintenance sheet built on an impossible loan proves nothing.
  await approveLoan(loanAId, 300000);

  const verification = await request(ctx.app)
    .post(`/api/loans/${loanAId}/verification`)
    .set(auth(adminToken))
    .send({ required: false });
  expect(verification.status).toBe(201);
  verificationId = verification.body.data.id;

  const credited = await request(ctx.app)
    .post("/api/disbursements")
    .set(auth(adminToken))
    .send({
      loanId: loanAId,
      customerId: customerAId,
      bankId: bankA.id,
      amount: 300000,
      utr: "UTRMAINT0001",
      mode: "NEFT",
    });
  expect(credited.status).toBe(201);
  creditedDisbursementId = credited.body.data.id;

  // Only the approve route can reach `Credited`, and only with a UTR.
  const markCredited = await request(ctx.app)
    .post(`/api/disbursements/${creditedDisbursementId}/approve`)
    .set(auth(adminToken))
    .send({ status: "Credited" });
  expect(markCredited.status).toBe(200);

  const inTransit = await request(ctx.app)
    .post("/api/disbursements")
    .set(auth(adminToken))
    .send({
      loanId: loanAId,
      customerId: customerAId,
      bankId: bankA.id,
      amount: 125000,
      utr: "UTRMAINT0002",
      mode: "IMPS",
    });
  expect(inTransit.status).toBe(201);
  inTransitDisbursementId = inTransit.body.data.id;

  // The file's branch and its externally-issued BT lead id.
  const annotated = await request(ctx.app)
    .patch(`/api/maintenance/loan/${loanAId}`)
    .set(auth(adminToken))
    .send({ branchId, btLeadId: "BTOMKA250626053704" });
  expect(annotated.status).toBe(200);
}, 90_000);

afterAll(async () => {
  await destroyTestContext(ctx);
});

/* ══ A — the sheets are built from records that already existed ═════════════ */

describe("A · every sheet reads the authoritative row", () => {
  it("1. FVR resolves customer, loan and verification together", async () => {
    const res = await request(ctx.app).get("/api/maintenance/fvr").set(auth(managerToken));
    expect(res.status).toBe(200);

    const row = res.body.data.find((r: { id: string }) => r.id === verificationId);
    expect(row, "the verification created in setup is missing from the FVR sheet").toBeTruthy();

    // Customer Name — from `customers.name`, not re-keyed onto a tracking table.
    expect(row.customerName).toBe("Yata Mahesh");
    // Customer Profile — from `customers.occupation`.
    expect(row.customerProfile).toBe("Business");
    // Loan Amount — the sanctioned figure, because this loan was approved for it.
    expect(Number(row.loanAmount)).toBe(300000);
  });

  it("2. Transfer resolves customer, mobile, amount and UTR from the real rows", async () => {
    const res = await request(ctx.app).get("/api/maintenance/transfer").set(auth(managerToken));
    expect(res.status).toBe(200);

    const row = res.body.data.find((r: { id: string }) => r.id === creditedDisbursementId);
    expect(row).toBeTruthy();
    expect(row.customerName).toBe("Yata Mahesh");
    expect(row.customerMobile).toBe("9000000001");
    expect(Number(row.transferAmount)).toBe(300000);
    expect(row.utr).toBe("UTRMAINT0001");
  });

  it("3. Region, Area and Branch resolve through the loan's branch, not a copied string", async () => {
    const res = await request(ctx.app).get("/api/maintenance/transfer").set(auth(managerToken));
    const row = res.body.data.find((r: { id: string }) => r.id === creditedDisbursementId);

    expect(row.regionName).toBe("Telangana");
    expect(row.areaName).toBe("HYDERABAD");
    expect(row.branchName).toBe("OMKAR NAGAR");
  });

  it("4. BT Lead ID is the externally-issued value, stored verbatim", async () => {
    const res = await request(ctx.app).get("/api/maintenance/transfer").set(auth(managerToken));
    const row = res.body.data.find((r: { id: string }) => r.id === creditedDisbursementId);
    expect(row.btLeadId).toBe("BTOMKA250626053704");
  });

  it("5. Loan Disbursed YES/NO is derived from the loan's own status", async () => {
    const res = await request(ctx.app).get("/api/maintenance/transfer").set(auth(managerToken));
    const row = res.body.data.find((r: { id: string }) => r.id === creditedDisbursementId);
    // The sheet prints YES/NO; the API returns the status it is derived FROM, so
    // the derivation stays visible rather than being baked into a string.
    expect(row.loanStatus).toBe("Disbursed");
  });

  it("6. the totals row is computed over the whole filtered set, not the page", async () => {
    const res = await request(ctx.app)
      .get("/api/maintenance/apts")
      .query({ pageSize: 1 })
      .set(auth(managerToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // Two disbursements exist: 300000 + 125000. The total must describe both.
    expect(Number(res.body.summary.transferAmountTotal)).toBe(425000);
    expect(res.body.summary.count).toBe(2);
  });
});

/* ══ B — Fund Credited to Customer means money that actually landed ═════════ */

describe("B · the credit timestamp is never claimed for money that did not arrive", () => {
  it("7. a Credited disbursement carries its credit timestamp", async () => {
    const res = await request(ctx.app).get("/api/maintenance/apts").set(auth(managerToken));
    const row = res.body.data.find((r: { id: string }) => r.id === creditedDisbursementId);

    expect(row.disbursementStatus).toBe("Credited");
    expect(row.fundCreditedAt, "a credited row must report when it was credited").toBeTruthy();
    expect(Number.isNaN(Date.parse(row.fundCreditedAt))).toBe(false);
  });

  it("8. THE POINT: an In Transit disbursement reports NO credit time", async () => {
    const res = await request(ctx.app).get("/api/maintenance/apts").set(auth(managerToken));
    const row = res.body.data.find((r: { id: string }) => r.id === inTransitDisbursementId);

    expect(row.disbursementStatus).toBe("In Transit");
    // Blank, not a fabricated date and not the row's created_at. The money has
    // not reached the customer, so the sheet must not say it has (D-004).
    expect(row.fundCreditedAt).toBeNull();
  });

  it("9. …and a Failed disbursement does not either, though approved_at IS stamped", async () => {
    // This is the case the guard exists for: `approved_at` is written on the
    // `-> Failed` transition too, so an unguarded column would print a credit
    // time for money that bounced.
    const failed = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(adminToken))
      .send({
        loanId: loanAId,
        customerId: customerAId,
        bankId: bankA.id,
        amount: 1000,
        mode: "NEFT",
      });
    expect(failed.status).toBe(201);

    const marked = await request(ctx.app)
      .post(`/api/disbursements/${failed.body.data.id}/approve`)
      .set(auth(adminToken))
      .send({ status: "Failed" });
    expect(marked.status).toBe(200);

    // The underlying column really was stamped …
    const [row] = await ctx.db
      .select({ approvedAt: schema.disbursements.approvedAt })
      .from(schema.disbursements)
      .where(eq(schema.disbursements.id, failed.body.data.id));
    expect(row!.approvedAt).toBeTruthy();

    // … and the sheet still reports no credit.
    const sheet = await request(ctx.app).get("/api/maintenance/apts").set(auth(managerToken));
    const failedRow = sheet.body.data.find((r: { id: string }) => r.id === failed.body.data.id);
    expect(failedRow.disbursementStatus).toBe("Failed");
    expect(failedRow.fundCreditedAt).toBeNull();
  });
});

/* ══ C — Payment Status is maintenance data and moves no money ══════════════ */

describe("C · the manager receipt flag is walled off from the money path", () => {
  it("10. it starts NULL — nothing is assumed on the manager's behalf", async () => {
    const res = await request(ctx.app).get("/api/maintenance/payment").set(auth(managerToken));
    const row = res.body.data.find((r: { id: string }) => r.id === creditedDisbursementId);
    expect(row.paymentStatus).toBeNull();
  });

  it("11. a manager can record it", async () => {
    const res = await request(ctx.app)
      .patch(`/api/maintenance/payment/${creditedDisbursementId}`)
      .set(auth(managerToken))
      .send({ paymentStatus: "Not Received" });

    expect(res.status).toBe(200);
    expect(res.body.data.paymentStatus).toBe("Not Received");
  });

  it("12. THE INVARIANT: recording it changes NO financial field", async () => {
    const [before] = await ctx.db
      .select()
      .from(schema.disbursements)
      .where(eq(schema.disbursements.id, creditedDisbursementId));

    const res = await request(ctx.app)
      .patch(`/api/maintenance/payment/${creditedDisbursementId}`)
      .set(auth(managerToken))
      .send({ paymentStatus: "Received" });
    expect(res.status).toBe(200);

    const [after] = await ctx.db
      .select()
      .from(schema.disbursements)
      .where(eq(schema.disbursements.id, creditedDisbursementId));

    // The whole money surface is byte-for-byte unchanged.
    expect(after!.status).toBe(before!.status);
    expect(after!.amount).toBe(before!.amount);
    expect(after!.utr).toBe(before!.utr);
    expect(after!.approvedBy).toEqual(before!.approvedBy);
    expect(after!.approvedAt).toEqual(before!.approvedAt);
    expect(after!.disbursedOn).toEqual(before!.disbursedOn);
    // …and the maintenance column is the one thing that moved.
    expect(after!.paymentStatus).toBe("Received");
  });

  it("13. the route refuses a value outside the vocabulary", async () => {
    const res = await request(ctx.app)
      .patch(`/api/maintenance/payment/${creditedDisbursementId}`)
      .set(auth(managerToken))
      .send({ paymentStatus: "Settled" });

    expect(res.status).toBe(422);
  });

  it("14. the maintenance route cannot reach the disbursement's own status", async () => {
    const res = await request(ctx.app)
      .patch(`/api/maintenance/payment/${inTransitDisbursementId}`)
      .set(auth(managerToken))
      .send({ status: "Credited", paymentStatus: "Received" });

    // `patchSchema` strips what it does not declare, so the unknown key is
    // simply not written — the disbursement stays In Transit.
    expect(res.status).toBe(200);
    const [row] = await ctx.db
      .select({ status: schema.disbursements.status })
      .from(schema.disbursements)
      .where(eq(schema.disbursements.id, inTransitDisbursementId));
    expect(row!.status).toBe("In Transit");
  });
});

/* ══ D — the FVR checklist ═════════════════════════════════════════════════ */

describe("D · the FVR checklist records findings and never invents them", () => {
  it("15. every new particular starts blank", async () => {
    const res = await request(ctx.app).get("/api/maintenance/fvr").set(auth(managerToken));
    const row = res.body.data.find((r: { id: string }) => r.id === verificationId);

    for (const field of [
      "takeoverFromLender",
      "fvrDoneByName",
      "fvrDoneByDesignation",
      "houseConfirmation",
      "annualIncome",
      "cholaRelationship",
      "cholaOutstandingDetails",
      "newKycCustomer",
      "zensifyRmSignature",
      "sharvikaRmSignature",
      "cholaSign",
    ]) {
      expect(row[field], `${field} should start NULL, not defaulted`).toBeNull();
    }
  });

  it("16. …and can be filled in", async () => {
    const res = await request(ctx.app)
      .patch(`/api/maintenance/fvr/${verificationId}`)
      .set(auth(managerToken))
      .send({
        takeoverFromLender: "HDFC Bank",
        fvrDoneByName: "Ravichandar",
        fvrDoneByDesignation: "Relationship Manager",
        houseConfirmation: "Owned",
        annualIncome: 840000,
        cholaRelationship: "Yes",
        cholaOutstandingDetails: "Outstanding 1,20,000 on an existing vehicle loan",
        newKycCustomer: "No",
        remarks: "Residence and business both verified on site",
      });

    expect(res.status).toBe(200);

    const sheet = await request(ctx.app).get("/api/maintenance/fvr").set(auth(managerToken));
    const row = sheet.body.data.find((r: { id: string }) => r.id === verificationId);

    expect(row.takeoverFromLender).toBe("HDFC Bank");
    expect(row.fvrDoneByName).toBe("Ravichandar");
    expect(row.fvrDoneByDesignation).toBe("Relationship Manager");
    expect(row.houseConfirmation).toBe("Owned");
    expect(Number(row.annualIncome)).toBe(840000);
    expect(row.cholaRelationship).toBe("Yes");
    expect(row.newKycCustomer).toBe("No");
    // "Remarks (if Any)" is the existing `verifications.notes` column, renamed
    // for display only — no second remarks column was created.
    expect(row.remarks).toBe("Residence and business both verified on site");
  });

  it("17. annual income is NOT derived from the customer's monthly income", async () => {
    // The customer was created with monthlyIncome 50000. A derived annual figure
    // would be 600000; the recorded finding is 840000 and must win, because a
    // verification records what was observed, not what was multiplied.
    const sheet = await request(ctx.app).get("/api/maintenance/fvr").set(auth(managerToken));
    const row = sheet.body.data.find((r: { id: string }) => r.id === verificationId);
    expect(Number(row.annualIncome)).toBe(840000);
    expect(Number(row.annualIncome)).not.toBe(50000 * 12);
  });

  it("18. an out-of-vocabulary house confirmation is refused", async () => {
    const res = await request(ctx.app)
      .patch(`/api/maintenance/fvr/${verificationId}`)
      .set(auth(managerToken))
      .send({ houseConfirmation: "Leased" });
    expect(res.status).toBe(422);
  });

  it("19. a signature line is free text and grants nothing", async () => {
    const res = await request(ctx.app)
      .patch(`/api/maintenance/fvr/${verificationId}`)
      .set(auth(managerToken))
      .send({ zensifyRmSignature: "A. Kumar" });
    expect(res.status).toBe(200);
    expect(res.body.data.zensifyRmSignature).toBe("A. Kumar");

    // It is not an approval: the verification's own workflow columns are
    // untouched by writing a signature line.
    const [row] = await ctx.db
      .select({
        status: schema.verifications.status,
        approvedBy: schema.verifications.approvedBy,
      })
      .from(schema.verifications)
      .where(eq(schema.verifications.id, verificationId));
    expect(row!.approvedBy).toBeNull();
  });
});

/* ══ E — authorization and tenant isolation ════════════════════════════════ */

describe("E · every sheet is gated and scoped in the backend", () => {
  const SHEETS = ["fvr", "transfer", "apts", "payment"] as const;

  it("20. an unauthenticated caller gets 401 on every sheet", async () => {
    for (const sheet of SHEETS) {
      const res = await request(ctx.app).get(`/api/maintenance/${sheet}`);
      expect(res.status, `${sheet} should refuse an anonymous caller`).toBe(401);
    }
  });

  it("21. a role without `maintenance.view` gets 403 on every sheet — never 404", async () => {
    for (const sheet of SHEETS) {
      const res = await request(ctx.app)
        .get(`/api/maintenance/${sheet}`)
        .set(auth(executiveToken));
      expect(res.status, `${sheet} should refuse an Executive`).toBe(403);
    }
  });

  it("22. a role without `maintenance.edit` cannot write maintenance fields", async () => {
    const res = await request(ctx.app)
      .patch(`/api/maintenance/payment/${creditedDisbursementId}`)
      .set(auth(executiveToken))
      .send({ paymentStatus: "Received" });
    expect(res.status).toBe(403);
  });

  it("23. a Manager cannot create master data — that is `manage_locations`", async () => {
    const res = await request(ctx.app)
      .post("/api/maintenance/regions")
      .set(auth(managerToken))
      .send({ name: "Andhra Pradesh" });
    expect(res.status).toBe(403);
  });

  it("24. THE LEAK TEST: a Bank B user sees none of Bank A's rows", async () => {
    for (const sheet of SHEETS) {
      const res = await request(ctx.app)
        .get(`/api/maintenance/${sheet}`)
        .set(auth(bankBToken));
      expect(res.status).toBe(200);
      expect(res.body.data, `${sheet} leaked rows across banks`).toHaveLength(0);
      expect(res.body.meta.scoped).toBe(true);
    }
  });

  it("25. …and cannot widen the scope with a bankId filter", async () => {
    const res = await request(ctx.app)
      .get("/api/maintenance/transfer")
      .query({ bankId: bankA.id })
      .set(auth(bankBToken));
    expect(res.status).toBe(403);
  });

  it("26. …nor annotate a record it cannot see", async () => {
    const res = await request(ctx.app)
      .patch(`/api/maintenance/payment/${creditedDisbursementId}`)
      .set(auth(bankBToken))
      .send({ paymentStatus: "Received" });
    expect(res.status).toBe(403);
  });

  it("27. an unscoped Super Admin sees the rows and is reported as unscoped", async () => {
    const res = await request(ctx.app).get("/api/maintenance/transfer").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.meta.scoped).toBe(false);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("28. a malformed id is 422, not a 500 with a stack trace", async () => {
    const res = await request(ctx.app)
      .patch("/api/maintenance/payment/not-a-uuid")
      .set(auth(managerToken))
      .send({ paymentStatus: "Received" });
    expect(res.status).toBe(422);
  });
});

/* ══ F — honest blanks ═════════════════════════════════════════════════════ */

describe("F · what the CRM does not know, it leaves blank", () => {
  it("29. a loan with no branch reports no Region, Area or Branch", async () => {
    const customer = await request(ctx.app)
      .post("/api/customers")
      .set(auth(adminToken))
      .send(customerPayload(bankA.id, "MAINT-2", { name: "Unplaced Customer" }));
    const loan = await request(ctx.app).post("/api/loans").set(auth(adminToken)).send({
      customerId: customer.body.data.id,
      bankId: bankA.id,
      loanType: "Personal Loan",
      amountRequested: 50000,
      status: "Submitted",
    });
    await approveLoan(loan.body.data.id, 50000);
    const disbursement = await request(ctx.app)
      .post("/api/disbursements")
      .set(auth(adminToken))
      .send({
        loanId: loan.body.data.id,
        customerId: customer.body.data.id,
        bankId: bankA.id,
        amount: 50000,
        mode: "NEFT",
      });

    const res = await request(ctx.app).get("/api/maintenance/transfer").set(auth(managerToken));
    const row = res.body.data.find((r: { id: string }) => r.id === disbursement.body.data.id);

    expect(row.regionName).toBeNull();
    expect(row.areaName).toBeNull();
    expect(row.branchName).toBeNull();
    // …and an unassigned file reports no manager rather than guessing one.
    expect(row.managerName).toBeNull();
    // …and no BT lead id was invented for it.
    expect(row.btLeadId).toBeNull();
  });
});
