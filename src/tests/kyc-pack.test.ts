import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { customers, requiredDocumentTypes } from "../db/schema/index.js";

/**
 * THE KYC PACK — Task 9.11, DECISIONS.md D-076
 *
 * Phase 9's third DoD box reads *"A KYC pack can be assembled and produced from
 * the system"*. Until Wave 0 **no task owned it**, and the phrase occurs
 * exactly once in the whole repository — in that DoD line. There is no PRD
 * requirement, no business-flow definition and no data model behind it.
 *
 * D-076 records engineering's minimum honest reading: required types,
 * per-customer completeness, and a manifest of Verified documents. Not a PDF
 * (D-055) and not a ZIP (a new dependency, D-006).
 *
 * This also gives D-057's deferred loan guard — "all required documents
 * Verified" — the table it said did not exist.
 *
 * ⚠️ **Group C is the one that matters most.** A completeness check that
 * reports "complete" because nobody configured any requirements is worse than
 * no check at all: it is a false assurance on the exact question a partner bank
 * asks. It must report "nothing configured", and it must not call that done.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let customerId: string;
let superToken: string;
let executiveToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0x00, 0xff, 0x0a])]);

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

async function uploadAndVerify(docType: string, verify = true): Promise<string> {
  const created = await request(ctx.app)
    .post("/api/documents/upload")
    .set(auth(executiveToken))
    .field("bankId", bank.id)
    .field("customerId", customerId)
    .field("docType", docType)
    .attach("file", PDF, `${docType.replace(/\s+/g, "-")}.pdf`);
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  if (verify) {
    const res = await request(ctx.app)
      .patch(`/api/documents/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Verified" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return created.body.data.id as string;
}

const pack = (id = customerId, token = superToken) =>
  request(ctx.app).get(`/api/customers/${id}/kyc-pack`).set(auth(token));

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);

  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(admin.email, admin.password);
  const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
  executiveToken = await login(executive.email, executive.password);

  const [customer] = await ctx.db
    .insert(customers)
    .values({
      code: "CUS-KYC-1",
      bankId: bank.id,
      bankReferenceId: "KYC-REF-1",
      name: "KYC Fixture",
      mobile: "9876555555",
    })
    .returning();
  customerId = customer!.id;
});

afterAll(async () => {
  await destroyTestContext(ctx);
  await rm(path.resolve(process.cwd(), ".storage"), { recursive: true, force: true });
});

/* ── A — the requirement set exists and is readable ─────────────────────── */

describe("A — required document types", () => {
  it("1. the seed installs the five types the UI used to hardcode", async () => {
    const rows = await ctx.db
      .select()
      .from(requiredDocumentTypes)
      .where(isNull(requiredDocumentTypes.bankId));

    const types = rows.map((r) => r.docType).sort();
    expect(types).toEqual(["Aadhaar", "Bank Statement", "ITR", "PAN Card", "Salary Slip"]);
    // Three are mandatory; a listed type is not automatically a required one.
    expect(rows.filter((r) => r.mandatory)).toHaveLength(3);
  });

  it("2. the pack reports them for a customer with nothing uploaded", async () => {
    const res = await pack();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.requirementsConfigured).toBe(5);
    expect(res.body.data.complete).toBe(false);
    expect(res.body.data.missing.sort()).toEqual(["Aadhaar", "Bank Statement", "PAN Card"]);
    expect(res.body.data.manifest).toHaveLength(0);
  });
});

/* ── B — completeness tracks what is actually Verified ──────────────────── */

describe("B — completeness and the manifest", () => {
  it("3. an uploaded but UNVERIFIED document does not satisfy a requirement", async () => {
    await uploadAndVerify("PAN Card", false);

    const res = await pack();
    // The box is "assembled and produced", not "uploaded". A pending document
    // proves nothing to a partner bank.
    expect(res.body.data.missing).toContain("PAN Card");
    expect(res.body.data.manifest).toHaveLength(0);
  });

  it("4. verifying it satisfies the requirement and puts it in the manifest", async () => {
    await uploadAndVerify("PAN Card");

    const res = await pack();
    expect(res.body.data.missing).not.toContain("PAN Card");
    expect(res.body.data.manifest).toHaveLength(1);

    const entry = res.body.data.manifest[0];
    expect(entry.docType).toBe("PAN Card");
    expect(entry.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.verifiedBy).toBeTruthy();
    expect(entry.uploadedBy).toBeTruthy();
    // Four-eyes, visible in the pack itself (D-074).
    expect(entry.verifiedBy).not.toBe(entry.uploadedBy);
    // Each document is retrievable one at a time through 9.5's checked route —
    // the manifest carries metadata, never bytes.
    expect(entry.contentPath).toBe(`/api/documents/${entry.documentId}/content`);
  });

  it("5. `complete` flips only when every MANDATORY type is Verified", async () => {
    await uploadAndVerify("Aadhaar");
    let res = await pack();
    expect(res.body.data.complete).toBe(false);
    expect(res.body.data.missing).toEqual(["Bank Statement"]);

    await uploadAndVerify("Bank Statement");
    res = await pack();
    expect(res.body.data.complete).toBe(true);
    expect(res.body.data.missing).toEqual([]);
  });

  it("6. the optional types are reported but do not block completeness", async () => {
    const res = await pack();
    const optional = res.body.data.completeness.filter(
      (row: { mandatory: boolean }) => !row.mandatory,
    );
    expect(optional).toHaveLength(2);
    expect(optional.every((row: { satisfied: boolean }) => !row.satisfied)).toBe(true);
    expect(res.body.data.complete).toBe(true);
  });

  it("7. a manifest entry can actually be fetched", async () => {
    const res = await pack();
    const entry = res.body.data.manifest[0];
    const content = await request(ctx.app).get(entry.contentPath).set(auth(superToken));
    expect(content.status).toBe(200);
    expect(Buffer.from(content.body).equals(PDF)).toBe(true);
  });
});

/* ── C — honesty when nothing is configured ─────────────────────────────── */

describe("C — an unconfigured system does not call itself complete", () => {
  it("8. THE TRAP — zero requirements reports `complete: false`, not true", async () => {
    const [other] = await ctx.db
      .insert(customers)
      .values({
        code: "CUS-KYC-2",
        bankId: bank.id,
        bankReferenceId: "KYC-REF-2",
        name: "Unconfigured Fixture",
        mobile: "9876566666",
      })
      .returning();

    // Soft-delete every requirement, as an operator clearing the list would.
    await ctx.db
      .update(requiredDocumentTypes)
      .set({ deletedAt: new Date() })
      .where(isNull(requiredDocumentTypes.bankId));

    const res = await pack(other!.id);
    expect(res.status).toBe(200);
    expect(res.body.data.requirementsConfigured).toBe(0);
    /*
     * `missing` is empty, and a naive `missing.length === 0` would call this
     * complete — a false assurance on the exact question a partner bank asks.
     * The endpoint requires at least one configured requirement before it will
     * say so.
     */
    expect(res.body.data.missing).toEqual([]);
    expect(res.body.data.complete).toBe(false);

    // restore for the remaining cases
    await ctx.db
      .update(requiredDocumentTypes)
      .set({ deletedAt: null })
      .where(isNull(requiredDocumentTypes.bankId));
  });

  it("9. a bank-specific requirement overrides the global default", async () => {
    await ctx.db.insert(requiredDocumentTypes).values({
      bankId: bank.id,
      docType: "Salary Slip",
      mandatory: true,
      sortOrder: 40,
    });

    const res = await pack();
    const row = res.body.data.completeness.find(
      (r: { docType: string }) => r.docType === "Salary Slip",
    );
    // Globally optional, mandatory for this bank — partner banks differ, and
    // the override is why `bank_id` is nullable rather than absent.
    expect(row.mandatory).toBe(true);
    expect(res.body.data.complete).toBe(false);
    expect(res.body.data.missing).toContain("Salary Slip");

    await ctx.db
      .delete(requiredDocumentTypes)
      .where(
        and(
          eq(requiredDocumentTypes.bankId, bank.id),
          eq(requiredDocumentTypes.docType, "Salary Slip"),
        ),
      );
  });
});

/* ── D — authorization ──────────────────────────────────────────────────── */

describe("D — the pack is scoped like everything else", () => {
  it("10. a customer in another bank is not found, not forbidden", async () => {
    const other = await createBank(ctx.db);
    const [stranger] = await ctx.db
      .insert(customers)
      .values({
        code: "CUS-KYC-3",
        bankId: other.id,
        bankReferenceId: "KYC-REF-3",
        name: "Other Bank Customer",
        mobile: "9876577777",
      })
      .returning();

    // The Executive's access does not include that bank.
    const res = await pack(stranger!.id, executiveToken);
    expect(res.status).toBe(404);
  });

  it("11. an unauthenticated request gets nothing", async () => {
    const res = await request(ctx.app).get(`/api/customers/${customerId}/kyc-pack`);
    expect(res.status).toBe(401);
  });
});
