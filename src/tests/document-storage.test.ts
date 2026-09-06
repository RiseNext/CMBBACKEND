import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";
import { auditLogs, customers, documents, recycleBinEntries } from "../db/schema/index.js";
import { storage } from "../services/storage.js";

/**
 * REAL DOCUMENT STORAGE — Tasks 9.4, 9.5, 9.7, 9.8
 * DECISIONS.md D-021, D-073, D-074, D-075 · SECURITY_AUDIT.md SEC-024, SEC-008
 *
 * "For a KYC-driven lending business this is disqualifying on its own." Before
 * Phase 9 the browser posted `{fileName, fileSize, mimeType}` and dropped the
 * bytes (BUG-004); `documents.storage_key` was a column nothing wrote.
 *
 *   Group A — 9.4: the upload actually stores bytes, and refuses what it should.
 *   Group B — 9.4: SEC-024 — keys and checksums are server-generated.
 *   Group C — 9.5: authorized content delivery and safe headers.
 *   Group D — 9.7: `documents.verify`, and an uploader who cannot self-verify.
 *   Group E — 9.8: a purge removes the object, including through the cascade.
 */

let ctx: TestContext;
let bank: { id: string; code: string };
let otherBank: { id: string; code: string };
let customerId: string;
let superToken: string;
let executiveToken: string;
let managerToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app).post("/api/auth/login").send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

/** A real PDF: the magic bytes plus a little binary that is not valid text. */
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0x00, 0xff, 0x10, 0x80, 0x0a])]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

function upload(
  token = superToken,
  opts: { body?: Buffer; name?: string; fields?: Record<string, string> } = {},
) {
  const req = request(ctx.app)
    .post("/api/documents/upload")
    .set(auth(token))
    .field("bankId", opts.fields?.bankId ?? bank.id)
    .field("docType", opts.fields?.docType ?? "PAN Card");
  if (opts.fields?.customerId !== "") {
    req.field("customerId", opts.fields?.customerId ?? customerId);
  }
  return req.attach("file", opts.body ?? PDF, opts.name ?? "pan.pdf");
}

const rowById = async (id: string) =>
  (await ctx.db.select().from(documents).where(eq(documents.id, id)).limit(1))[0]!;

beforeAll(async () => {
  ctx = await createTestContext();
  bank = await createBank(ctx.db);
  otherBank = await createBank(ctx.db);

  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  superToken = await login(admin.email, admin.password);
  const executive = await createUser(ctx.db, { roleKey: "executive", bankIds: [bank.id] });
  executiveToken = await login(executive.email, executive.password);
  const manager = await createUser(ctx.db, { roleKey: "manager", bankIds: [bank.id] });
  managerToken = await login(manager.email, manager.password);

  const [customer] = await ctx.db
    .insert(customers)
    .values({
      code: "CUS-DOC-1",
      bankId: bank.id,
      bankReferenceId: "DOC-REF-1",
      name: "Document Fixture",
      mobile: "9876522222",
    })
    .returning();
  customerId = customer!.id;
});

afterAll(async () => {
  await destroyTestContext(ctx);
  await rm(path.resolve(process.cwd(), ".storage"), { recursive: true, force: true });
});

/* ── A — 9.4: the bytes are actually stored ─────────────────────────────── */

describe("A — upload stores the file, and refuses what it should", () => {
  it("1. THE HEADLINE — a real file round-trips, and the row carries a storage_key", async () => {
    const res = await upload();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.storageKey).toBeTruthy();
    expect(res.body.data.uploadedBy).toBeTruthy();
    expect(res.body.data.status).toBe("Pending");

    // The bytes are in the store, byte for byte — BUG-004 is what this closes.
    const stored = await storage().get(res.body.data.storageKey);
    expect(stored.equals(PDF)).toBe(true);
  });

  it("2. an oversize file is 422, NOT 500 — the BUG-021 trap", async () => {
    // The importer's `fileFilter` rejects with a bare Error the error handler
    // cannot classify, producing a 500. Row 9.4's own test line demands 4xx.
    const huge = Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024)]);
    const res = await upload(superToken, { body: huge });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.details?.[0]?.path).toBe("file");
  });

  it("3. a disallowed extension is 422, not 500", async () => {
    const res = await upload(superToken, { body: PDF, name: "payload.exe" });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("4. MAGIC BYTES — renaming an executable to .pdf does not get it stored", async () => {
    // Client-declared MIME and the extension both say PDF. The bytes do not.
    const notAPdf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // "MZ" — a PE header
    const res = await upload(superToken, { body: notAPdf, name: "invoice.pdf" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.message).toContain("do not match its extension");
  });

  it("5. a PNG is accepted on its own magic bytes", async () => {
    const res = await upload(superToken, { body: PNG, name: "aadhaar.png" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.mimeType).toBe("image/png");
  });

  it("6. a cross-bank customer is refused", async () => {
    const res = await upload(superToken, { fields: { bankId: otherBank.id, customerId } });
    expect(res.status).toBe(400);
  });

  it("7. Executive may upload; the permission is unchanged by 9.7", async () => {
    const res = await upload(executiveToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

/* ── B — 9.4 / SEC-024: server-generated keys and checksums ─────────────── */

describe("B — the client no longer supplies a storage key or a checksum", () => {
  it("8. the checksum is computed from the bytes that arrived", async () => {
    const res = await upload();
    expect(res.body.data.checksum).toBe(createHash("sha256").update(PDF).digest("hex"));
  });

  it("9. a client-supplied storageKey and checksum are IGNORED by the JSON route", async () => {
    // SEC-024: both were accepted here and written by nothing, accumulating an
    // attacker-controlled path-shaped string against the day something
    // dereferenced it. They are gone from the create schema.
    const res = await request(ctx.app)
      .post("/api/documents")
      .set(auth(superToken))
      .send({
        bankId: bank.id,
        customerId,
        docType: "PAN Card",
        fileName: "x.pdf",
        storageKey: "../../etc/passwd",
        checksum: "deadbeef",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.storageKey).toBeNull();
    expect(res.body.data.checksum).toBeNull();
  });

  it("10. the generated key is scoped to bank and customer", async () => {
    const res = await upload();
    expect(res.body.data.storageKey.startsWith(`${bank.id}/${customerId}/`)).toBe(true);
  });
});

/* ── C — 9.5: authorized content delivery ───────────────────────────────── */

describe("C — content is authorization-checked and never a public URL", () => {
  it("11. the owner gets the exact bytes back with safe headers", async () => {
    const created = await upload();
    const res = await request(ctx.app)
      .get(`/api/documents/${created.body.data.id}/content`)
      .set(auth(superToken));

    expect(res.status, res.text?.slice(0, 200)).toBe(200);
    expect(Buffer.from(res.body).equals(PDF)).toBe(true);
    // Phase 9 creates a stored-content surface that did not exist before, and
    // SEC-011 (no CSP anywhere) is Phase 13's. These two headers are what stops
    // a user-uploaded file being rendered in this origin.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("12. an unauthenticated request gets nothing", async () => {
    const created = await upload();
    const res = await request(ctx.app).get(`/api/documents/${created.body.data.id}/content`);
    expect(res.status).toBe(401);
  });

  it("13. a document with no stored file is a 404, not an empty 200", async () => {
    const jsonOnly = await request(ctx.app)
      .post("/api/documents")
      .set(auth(superToken))
      .send({ bankId: bank.id, customerId, docType: "PAN Card", fileName: "nothing.pdf" });

    const res = await request(ctx.app)
      .get(`/api/documents/${jsonOnly.body.data.id}/content`)
      .set(auth(superToken));
    expect(res.status).toBe(404);
  });

  it("14. SEC-024 — a legacy traversal key is refused at the dereference point", async () => {
    const created = await upload();
    // A row written before 9.4, when the column was client-supplied free text.
    await ctx.db
      .update(documents)
      .set({ storageKey: "../../etc/passwd" })
      .where(eq(documents.id, created.body.data.id));

    const res = await request(ctx.app)
      .get(`/api/documents/${created.body.data.id}/content`)
      .set(auth(superToken));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.text ?? "").not.toContain("root:");
  });

  it("15. retrieval is audited", async () => {
    const created = await upload();
    await request(ctx.app)
      .get(`/api/documents/${created.body.data.id}/content`)
      .set(auth(superToken));

    // Downloading a KYC document is an access event, not a read of nothing —
    // it leaves a trail naming who retrieved it.
    const audits = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.recordId, created.body.data.id));
    expect(audits.some((row) => row.action === "viewed")).toBe(true);
  });
});

/* ── D — 9.7: documents.verify ──────────────────────────────────────────── */

describe("D — verification is a separate permission, and uploaders lack it", () => {
  it("16. THE FIX — an Executive who uploaded CANNOT verify their own document", async () => {
    const created = await upload(executiveToken);
    expect(created.status).toBe(201);

    // Before 9.7, `permissions.edit` mapped to `documents.upload`, so this was
    // a 200 and every uploader could self-verify a KYC document.
    const res = await request(ctx.app)
      .patch(`/api/documents/${created.body.data.id}`)
      .set(auth(executiveToken))
      .send({ status: "Verified" });

    expect(res.status).toBe(403);
    expect((await rowById(created.body.data.id)).status).toBe("Pending");
  });

  it("17. Manager does not inherit it either — the grant is enumerated, not flattened", async () => {
    const created = await upload();
    const res = await request(ctx.app)
      .patch(`/api/documents/${created.body.data.id}`)
      .set(auth(managerToken))
      .send({ status: "Verified" });
    expect(res.status).toBe(403);
  });

  it("18. Super Admin can verify, and `verified_by` is stamped", async () => {
    const created = await upload(executiveToken);
    const res = await request(ctx.app)
      .patch(`/api/documents/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Verified" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await rowById(created.body.data.id);
    expect(row.status).toBe("Verified");
    expect(row.verifiedBy).toBeTruthy();
    // Four-eyes, achieved structurally by the grant set rather than a runtime
    // guard that a one-person DSA could never satisfy (D-074).
    expect(row.verifiedBy).not.toBe(row.uploadedBy);
  });

  it("19. a document with no stored file cannot be Verified", async () => {
    const jsonOnly = await request(ctx.app)
      .post("/api/documents")
      .set(auth(superToken))
      .send({ bankId: bank.id, customerId, docType: "PAN Card", fileName: "ghost.pdf" });

    const res = await request(ctx.app)
      .patch(`/api/documents/${jsonOnly.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Verified" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.message).toContain("no stored file");
  });

  it("20. Verified and Rejected are terminal", async () => {
    const created = await upload();
    await request(ctx.app)
      .patch(`/api/documents/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Rejected" });

    const res = await request(ctx.app)
      .patch(`/api/documents/${created.body.data.id}`)
      .set(auth(superToken))
      .send({ status: "Verified" });
    expect(res.status).toBe(422);
  });

  it("21. CREATE cannot mint a document already Verified", async () => {
    const res = await request(ctx.app)
      .post("/api/documents")
      .set(auth(superToken))
      .send({
        bankId: bank.id,
        customerId,
        docType: "PAN Card",
        fileName: "x.pdf",
        status: "Verified",
      });
    expect(res.status).toBe(422);
  });
});

/* ── E — 9.8: the purge removes the object ──────────────────────────────── */

describe("E — purging a record does not orphan its KYC file", () => {
  it("22. purging a DOCUMENT deletes its object first", async () => {
    const created = await upload();
    const key = created.body.data.storageKey as string;
    expect((await storage().get(key)).length).toBeGreaterThan(0);

    await request(ctx.app)
      .delete(`/api/documents/${created.body.data.id}`)
      .set(auth(superToken))
      .expect(204);

    const [entry] = await ctx.db
      .select()
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, created.body.data.id))
      .limit(1);
    expect(entry).toBeTruthy();

    const purged = await request(ctx.app)
      .post(`/api/recycle-bin/${entry!.id}/permanent-delete`)
      .set(auth(superToken))
      .send({ confirm: true });
    expect([200, 204]).toContain(purged.status);

    // The object is gone, not merely the row.
    await expect(storage().get(key)).rejects.toThrow();
  });

  it("23. THE CASCADE PATH — purging a CUSTOMER removes its documents' objects", async () => {
    const [victim] = await ctx.db
      .insert(customers)
      .values({
        code: "CUS-DOC-PURGE",
        bankId: bank.id,
        bankReferenceId: "DOC-REF-PURGE",
        name: "Cascade Fixture",
        mobile: "9876533333",
      })
      .returning();

    const created = await upload(superToken, { fields: { customerId: victim!.id } });
    const key = created.body.data.storageKey as string;
    expect((await storage().get(key)).length).toBeGreaterThan(0);

    await request(ctx.app)
      .delete(`/api/customers/${victim!.id}`)
      .set(auth(superToken))
      .expect(204);

    const [entry] = await ctx.db
      .select()
      .from(recycleBinEntries)
      .where(eq(recycleBinEntries.recordId, victim!.id))
      .limit(1);

    const purged = await request(ctx.app)
      .post(`/api/recycle-bin/${entry!.id}/permanent-delete`)
      .set(auth(superToken))
      .send({ confirm: true });
    expect([200, 204]).toContain(purged.status);

    /*
     * `documents.customer_id` is `onDelete: "cascade"`, so the row above was
     * destroyed by the database without passing through `softDelete`. Without
     * 9.8's explicit enumeration the object would have orphaned silently and
     * permanently — a KYC file outliving its own erasure.
     */
    await expect(storage().get(key)).rejects.toThrow();
  });
});
