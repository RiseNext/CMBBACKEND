import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { deflateRawSync } from "node:zlib";
import {
  createBank,
  createTestContext,
  createUser,
  destroyTestContext,
  type TestContext,
} from "./harness.js";

/**
 * SEC-008 — EXCEL IMPORT HARDENING. Task 13.7.
 *
 * Four defects in one finding:
 *
 *   1. **Zip bomb.** `MAX_UPLOAD_MB` bounds the bytes that ARRIVE. An `.xlsx`
 *      is a ZIP archive, so a 2 MB upload can inflate to gigabytes — and
 *      `workbook.xlsx.load()` does that inflation in memory before a line of
 *      this application's code runs.
 *   2. **Unbounded row loop.** `for (r = 2; r <= sheet.rowCount; r++)` trusted a
 *      number the uploader controls, and every iteration allocates.
 *   3. **No magic-byte validation.** multer's `fileFilter` checked
 *      `file.mimetype`, which is a header the client sends — a claim, not a
 *      fact. `payload.exe` renamed to `.xlsx` reached the parser.
 *   4. **500 instead of 4xx.** A malformed workbook threw out of
 *      `xlsx.load()`, was unrecognised by the error handler, and produced a
 *      500 with an error-level stack trace — so junk uploads drove log
 *      amplification, and a user who picked the wrong file was told the server
 *      had crashed.
 *
 * Every case here is over real HTTP against the real route.
 */

const PASSWORD = "TestPassword123!";

let ctx: TestContext;
let token: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await createBank(ctx.db);
  const admin = await createUser(ctx.db, { roleKey: "super_admin" });
  const res = await request(ctx.app)
    .post("/api/auth/login")
    .send({ email: admin.email, password: PASSWORD });
  token = res.body.accessToken as string;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

const post = (buf: Buffer, filename = "customers.xlsx") =>
  request(ctx.app)
    .post("/api/imports/customers")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", buf, {
      filename,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

/** A genuine, minimal workbook with the required headers. */
async function realWorkbook(dataRows = 1): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Customers");
  ws.addRow(["Bank Code", "Bank Reference ID", "Name", "Mobile"]);
  for (let i = 0; i < dataRows; i += 1) {
    ws.addRow(["BNK-01", `REF-${i}`, `Customer ${i}`, `98${String(400000000 + i)}`]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * A ZIP whose local file header CLAIMS a huge uncompressed size.
 *
 * That is what the guard reads, and it is the honest shape of the attack: a
 * real bomb is a small archive that inflates enormously, and the header is
 * where the archive announces it.
 */
function zipBomb(claimedUncompressed: number): Buffer {
  const name = Buffer.from("bomb.xml");
  const payload = deflateRawSync(Buffer.alloc(1024, 0x41));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(0, 14); // crc, unchecked by the guard
  header.writeUInt32LE(payload.length, 18); // compressed size
  header.writeUInt32LE(claimedUncompressed, 22); // <- what the guard reads
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name, payload]);
}

/* ══ A — magic bytes ══════════════════════════════════════════════════════ */

describe("A · the file's CONTENTS are validated, not its declared MIME type", () => {
  it("1. THE FINDING: an executable renamed .xlsx is refused", async () => {
    // MZ — a Windows PE. multer's fileFilter sees the .xlsx content-type this
    // request sets and waves it through; the magic-byte check does not.
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(2048, 0)]);
    const res = await post(exe);

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/do not look like a spreadsheet/i);
  });

  it("2. a real .xlsx is still accepted — the check is not a wall", async () => {
    const res = await post(await realWorkbook());
    expect(res.status, JSON.stringify(res.body)).not.toBe(422);
  });

  it("3. an empty file is refused rather than parsed", async () => {
    const res = await post(Buffer.alloc(0));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

/* ══ B — the decompression ceiling ════════════════════════════════════════ */

describe("B · a zip bomb is refused before anything is inflated", () => {
  it("4. THE FINDING: an archive claiming a huge expansion is refused", async () => {
    // MAX_UPLOAD_MB is 10 in test, so the ceiling is 200 MB. Claim 900 MB.
    const res = await post(zipBomb(900 * 1024 * 1024));

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/expands to more than/i);
  });

  it("5. it is refused with a 4xx, NOT a 500 — no stack trace, no log amplification", async () => {
    const res = await post(zipBomb(900 * 1024 * 1024));
    expect(res.status).toBeLessThan(500);
  });

  it("6. an ordinary workbook is under the ceiling and passes", async () => {
    const res = await post(await realWorkbook(50));
    expect(res.status, JSON.stringify(res.body)).not.toBe(422);
  });
});

/* ══ C — the row cap ══════════════════════════════════════════════════════ */

describe("C · the row loop is bounded", () => {
  it("7. THE FINDING: a workbook past the row cap is refused up front", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Customers");
    ws.addRow(["Bank Code", "Bank Reference ID", "Name", "Mobile"]);
    // 5,001 data rows — one past MAX_IMPORT_ROWS.
    for (let i = 0; i < 5_001; i += 1) {
      ws.addRow(["BNK-01", `R${i}`, `C${i}`, `98${String(400000000 + i)}`]);
    }
    const res = await post(Buffer.from(await wb.xlsx.writeBuffer()));

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/more than/i);
  });

  it("8. it REFUSES rather than truncating — a half-imported file is worse", async () => {
    /*
     * D-004: reporting a success that did not happen is the forbidden shape.
     * Silently importing the first 5,000 of 5,001 customers and reporting
     * success is exactly that.
     */
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Customers");
    ws.addRow(["Bank Code", "Bank Reference ID", "Name", "Mobile"]);
    for (let i = 0; i < 5_001; i += 1) {
      ws.addRow(["BNK-01", `T${i}`, `C${i}`, `98${String(500000000 + i)}`]);
    }
    const res = await post(Buffer.from(await wb.xlsx.writeBuffer()));

    expect(res.body.data).toBeUndefined();
    expect(res.status).toBe(422);
  });

  it("9. a batch comfortably under the cap still imports", async () => {
    const res = await post(await realWorkbook(20));
    expect(res.status, JSON.stringify(res.body)).not.toBe(422);
  });
});

/* ══ D — malformed input is a 4xx ═════════════════════════════════════════ */

describe("D · a workbook this service cannot read is the caller's problem, not a crash", () => {
  it("10. THE FINDING: a corrupt ZIP answers 422, not 500", async () => {
    // Valid ZIP magic, garbage after it — `xlsx.load()` throws.
    const corrupt = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("this is not a workbook at all, not even slightly"),
    ]);
    const res = await post(corrupt);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status, "a malformed upload must never be a 500").toBeLessThan(500);
  });

  it("11. the refusal names the file, so the user knows what to fix", async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("still not a workbook"),
    ]);
    const res = await post(corrupt);
    expect(JSON.stringify(res.body)).toMatch(/file|workbook|spreadsheet/i);
  });

  it("12. no internal detail leaks in the refusal", async () => {
    const res = await post(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("x")]));
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/exceljs|node_modules|at Object|\.ts:\d+/i);
  });
});
