import { Router, type RequestHandler } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { banks, customers, importBatches, importRows } from "../db/schema/index.js";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/errors.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { peppered } from "../lib/password.js";
import { env } from "../config/env.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess } from "../services/access.js";
import { recordAudit } from "../services/audit.js";
import { nextResourceCode } from "./scoped-resource.js";

export const importsRouter = Router();
importsRouter.use(requireAuth);

/**
 * Built lazily. Reading env() at module scope evaluates it at import time,
 * before the process has necessarily loaded its configuration — which made this
 * module's import order load-bearing. It is now resolved on first request.
 */
let uploadMiddleware: ReturnType<typeof multer> | null = null;

function upload() {
  uploadMiddleware ??= multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ok = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ].includes(file.mimetype);
    if (!ok) {
      cb(new Error("Only .xlsx, .xls and .csv files are accepted"));
      return;
    }
    cb(null, true);
  },
  });
  return uploadMiddleware;
}

const singleFile: RequestHandler = (req, res, next) => upload().single("file")(req, res, next);

/** Column definitions drive both the template and the validator, so a template
 *  download can never drift out of sync with what the importer accepts. */
const CUSTOMER_COLUMNS = [
  { header: "Bank Code", key: "bankCode", width: 14, required: true },
  { header: "Bank Reference ID", key: "bankReferenceId", width: 22, required: true },
  { header: "Customer Name", key: "name", width: 26, required: true },
  { header: "Mobile", key: "mobile", width: 14, required: true },
  { header: "Email", key: "email", width: 26, required: false },
  { header: "PAN", key: "pan", width: 14, required: false },
  { header: "Aadhaar", key: "aadhaar", width: 18, required: false },
  { header: "Monthly Income", key: "monthlyIncome", width: 16, required: false },
  { header: "City", key: "city", width: 16, required: false },
  { header: "State", key: "state", width: 16, required: false },
  { header: "Pincode", key: "pincode", width: 12, required: false },
  { header: "Occupation", key: "occupation", width: 18, required: false },
  { header: "CIBIL", key: "cibil", width: 10, required: false },
] as const;

const rowSchema = z.object({
  bankCode: z.string().trim().min(1, "Bank Code is required"),
  bankReferenceId: z.string().trim().min(1, "Bank Reference ID is required").max(64),
  name: z.string().trim().min(2, "Customer Name must be at least 2 characters").max(160),
  mobile: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => /^\d{10}$/.test(v), "Mobile must be 10 digits"),
  email: z.string().trim().email("Email is not valid").max(255).optional().or(z.literal("")),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN format is invalid")
    .optional()
    .or(z.literal("")),
  aadhaar: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || /^\d{12}$/.test(v), "Aadhaar must be 12 digits")
    .optional(),
  monthlyIncome: z.coerce.number().min(0).max(1_000_000_000).optional(),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(120).optional().or(z.literal("")),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Pincode must be 6 digits")
    .optional()
    .or(z.literal("")),
  occupation: z.string().trim().max(120).optional().or(z.literal("")),
  cibil: z.coerce.number().int().min(300).max(900).optional(),
});

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text).trim();
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};

/** GET /api/imports/template/customers */
importsRouter.get(
  "/template/customers",
  requirePermission(PERMISSIONS.customers.import),
  async (_req, res, next) => {
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Customers");
      sheet.columns = CUSTOMER_COLUMNS.map((c) => ({
        header: c.required ? `${c.header} *` : c.header,
        key: c.key,
        width: c.width,
      }));
      sheet.getRow(1).font = { bold: true };
      sheet.addRow({
        bankCode: "BNK-01",
        bankReferenceId: "REF001",
        name: "Example Customer",
        mobile: "9876543210",
        email: "customer@example.com",
        pan: "ABCPK1234K",
        monthlyIncome: 45000,
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500001",
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", 'attachment; filename="customer-import-template.xlsx"');
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/imports/customers — upload, validate, stage. Nothing is written to
 * the customers table here; rows land in import_rows with a status and errors.
 */
/* ── SEC-008 / Task 13.7: what an uploaded workbook may be ───────────────── */

/**
 * The maximum number of DATA rows a single import may contain.
 *
 * SEC-008's second half is *"an unbounded row loop"*: `for (rowNumber = 2;
 * rowNumber <= sheet.rowCount; ...)` trusted a number the uploader controls.
 * `sheet.rowCount` on a crafted workbook can be in the millions while the file
 * is a few hundred kilobytes, and every iteration allocates, validates and
 * pushes a staged row. The process runs out of memory long before the loop
 * ends, and the ceiling that used to exist — `MAX_UPLOAD_MB` on the compressed
 * bytes — bounds none of it.
 *
 * 5,000 is well above any realistic customer batch and far below what hurts.
 */
const MAX_IMPORT_ROWS = 5_000;

/**
 * The decompressed-size ceiling. **This is the zip-bomb guard.**
 *
 * `MAX_UPLOAD_MB` limits the bytes that arrive. An `.xlsx` is a ZIP archive, so
 * a 2 MB upload can inflate to gigabytes — `workbook.xlsx.load()` does that
 * inflation in memory, before a single line of this application's code runs.
 * The limit that matters is therefore on the *inflated* size, and it has to be
 * checked while unpacking rather than after.
 *
 * 20x the upload limit is generous for real spreadsheet content (XML compresses
 * roughly 10:1) and stops the pathological case dead.
 */
const maxInflatedBytes = (): number => env().MAX_UPLOAD_MB * 1024 * 1024 * 20;

/**
 * The first bytes of each format we accept.
 *
 * SEC-008 asks for *"extension + magic-byte validation"*, and multer's
 * `fileFilter` checks only `file.mimetype` — a header the client sends, which
 * is to say a claim, not a fact. `document.routes.ts` already validates KYC
 * uploads this way (Task 9.4); this brings the importer to the same standard.
 *
 *   .xlsx  PK  — a ZIP archive
 *   .xls   D0 CF 11 E0  — an OLE2 compound document
 *   .csv   no signature exists; it is validated by being decodable text below
 */
function looksLikeWorkbook(buf: Buffer): "xlsx" | "xls" | "csv" | null {
  if (buf.length >= 4) {
    if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) {
      return "xlsx";
    }
    if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "xls";
  }
  /*
   * CSV has no magic number, so the test is that the leading bytes decode as
   * text without a NUL. That rejects a renamed binary — which is the attack —
   * without pretending to a certainty CSV cannot offer.
   */
  const head = buf.subarray(0, 512);
  if (head.length > 0 && !head.includes(0)) return "csv";
  return null;
}

/**
 * Rejects an archive that inflates past the ceiling — SEC-008.
 *
 * Reads the ZIP central directory's uncompressed-size fields rather than
 * inflating anything, so the decision costs no memory. A non-ZIP buffer (`.xls`
 * or `.csv`) has no archive to inspect and passes through: neither format
 * compresses, so `MAX_UPLOAD_MB` already bounds them.
 */
function assertInflatedSizeWithinLimit(buf: Buffer): void {
  if (!(buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b)) return;

  const ceiling = maxInflatedBytes();
  let total = 0;

  // Local file headers: signature 0x04034b50, uncompressed size at offset 22.
  for (let i = 0; i + 30 <= buf.length; i += 1) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    total += buf.readUInt32LE(i + 22);
    if (total > ceiling) {
      throw unprocessable(
        `That workbook expands to more than ${Math.round(ceiling / (1024 * 1024))} MB and was not opened.`,
        [{ path: "file", message: "The file is compressed far beyond its apparent size." }],
      );
    }
    i += 29;
  }
}

importsRouter.post(
  "/customers",
  requirePermission(PERMISSIONS.customers.import),
  singleFile,
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const file = req.file;
      if (!file) throw badRequest("No file uploaded");

      /*
       * VALIDATE BEFORE PARSING — SEC-008, Task 13.7.
       *
       * Everything below this point trusts the workbook; everything above it
       * must not. The order matters: the magic-byte check and the inflation
       * ceiling both run BEFORE `xlsx.load()`, because that call is what does
       * the decompressing and is therefore the thing being protected.
       */
      const kind = looksLikeWorkbook(file.buffer);
      if (!kind) {
        const message =
          "That file's contents do not look like a spreadsheet, so it was not opened.";
        throw unprocessable(message, [{ path: "file", message }]);
      }
      assertInflatedSizeWithinLimit(file.buffer);

      const db = getDb();
      const workbook = new ExcelJS.Workbook();

      /*
       * 4xx, NOT 500 — SEC-008's last clause.
       *
       * A malformed or hostile workbook made `xlsx.load()` throw, and an
       * unrecognised throw reaches the error handler as a **500 with an
       * error-level stack trace**. So a caller could drive error-level logging
       * by uploading junk, and a user who picked the wrong file was told the
       * server had crashed. A file this service cannot read is the caller's
       * problem to fix, and 422 says so.
       */
      try {
        await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
      } catch {
        const message = "That workbook could not be read. Re-save it as .xlsx and try again.";
        throw unprocessable(message, [{ path: "file", message }]);
      }

      const sheet = workbook.worksheets[0];
      if (!sheet) throw badRequest("The workbook contains no sheets");

      /*
       * The row cap — SEC-008's "unbounded row loop".
       *
       * `sheet.rowCount` is uploader-controlled and can be in the millions on a
       * file of a few hundred kilobytes. Refusing up front is better than
       * truncating: a silently half-imported customer file is worse than a
       * rejected one, and D-004 forbids reporting a success that did not happen.
       */
      if (sheet.rowCount - 1 > MAX_IMPORT_ROWS) {
        const message = `That file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows. Split it and import the parts.`;
        throw unprocessable(message, [{ path: "file", message }]);
      }

      const headerRow = sheet.getRow(1);
      const headerMap = new Map<number, string>();
      headerRow.eachCell((c, colNumber) => {
        const label = cell(c.value).replace(/\s*\*$/, "");
        const column = CUSTOMER_COLUMNS.find(
          (def) => def.header.toLowerCase() === label.toLowerCase(),
        );
        if (column) headerMap.set(colNumber, column.key);
      });

      const missing = CUSTOMER_COLUMNS.filter(
        (c) => c.required && ![...headerMap.values()].includes(c.key),
      );
      if (missing.length) {
        throw badRequest(
          `The file is missing required columns: ${missing.map((m) => m.header).join(", ")}`,
        );
      }

      // Bank codes the caller may actually write to. An executive importing a
      // file that references someone else's bank gets those rows rejected —
      // not silently reassigned, and not imported.
      const bankRows = await db
        .select({ id: banks.id, code: banks.code })
        .from(banks)
        .where(isNull(banks.deletedAt));
      const bankByCode = new Map(bankRows.map((b) => [b.code.toUpperCase(), b]));

      const existingRefs = new Set(
        (
          await db
            .select({ bankId: customers.bankId, ref: customers.bankReferenceId })
            .from(customers)
            .where(isNull(customers.deletedAt))
        ).map((r) => `${r.bankId}:${r.ref.toUpperCase()}`),
      );

      const seenInFile = new Set<string>();
      const staged: {
        rowNumber: number;
        raw: Record<string, string>;
        normalised: Record<string, unknown> | null;
        status: string;
        errors: { field: string; message: string }[] | null;
      }[] = [];

      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const raw: Record<string, string> = {};
        headerMap.forEach((key, colNumber) => {
          raw[key] = cell(row.getCell(colNumber).value);
        });
        if (Object.values(raw).every((v) => v === "")) continue;

        const errors: { field: string; message: string }[] = [];
        const parsed = rowSchema.safeParse(raw);

        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            errors.push({ field: String(issue.path[0] ?? "row"), message: issue.message });
          }
          staged.push({ rowNumber, raw, normalised: null, status: "invalid", errors });
          continue;
        }

        const bank = bankByCode.get(parsed.data.bankCode.toUpperCase());
        if (!bank) {
          errors.push({ field: "bankCode", message: `Unknown bank code ${parsed.data.bankCode}` });
        } else {
          try {
            assertBankAccess(ctx, bank.id);
          } catch {
            errors.push({
              field: "bankCode",
              message: `You are not assigned to bank ${parsed.data.bankCode}`,
            });
          }
        }

        const refKey = bank
          ? `${bank.id}:${parsed.data.bankReferenceId.toUpperCase()}`
          : `?:${parsed.data.bankReferenceId.toUpperCase()}`;

        let status = errors.length ? "invalid" : "valid";
        if (!errors.length && existingRefs.has(refKey)) {
          status = "duplicate";
          errors.push({
            field: "bankReferenceId",
            message: "This Bank Reference ID already exists for that bank",
          });
        } else if (!errors.length && seenInFile.has(refKey)) {
          status = "duplicate";
          errors.push({
            field: "bankReferenceId",
            message: "This Bank Reference ID appears more than once in the file",
          });
        } else if (status === "valid") {
          seenInFile.add(refKey);
        }

        staged.push({
          rowNumber,
          raw,
          normalised: bank ? { ...parsed.data, bankId: bank.id } : null,
          status,
          errors: errors.length ? errors : null,
        });
      }

      if (staged.length === 0) throw badRequest("The file contains no data rows");

      const counts = {
        total: staged.length,
        valid: staged.filter((r) => r.status === "valid").length,
        invalid: staged.filter((r) => r.status === "invalid").length,
        duplicate: staged.filter((r) => r.status === "duplicate").length,
      };

      const batch = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(importBatches)
          .values({
            importType: "customers",
            fileName: file.originalname,
            fileSize: file.size,
            status: "previewed",
            totalRows: counts.total,
            validRows: counts.valid,
            invalidRows: counts.invalid,
            duplicateRows: counts.duplicate,
            createdBy: ctx.userId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          })
          .returning();

        await tx.insert(importRows).values(
          staged.map((r) => ({
            batchId: created!.id,
            rowNumber: r.rowNumber,
            raw: r.raw as never,
            normalised: r.normalised as never,
            status: r.status,
            errors: r.errors as never,
          })),
        );
        return created!;
      });

      res.status(201).json({
        data: {
          batchId: batch.id,
          fileName: batch.fileName,
          ...counts,
          preview: staged.slice(0, 50),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/imports/:batchId — full preview for the confirm screen. */
importsRouter.get("/:batchId", requirePermission(PERMISSIONS.customers.import), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const batchId = req.params.batchId as string;
    const db = getDb();

    const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
    if (!batch) throw notFound("Import batch not found");
    // A batch belongs to whoever uploaded it.
    if (batch.createdBy !== ctx.userId) throw forbidden("This import belongs to another user");

    const rows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, batchId))
      .orderBy(importRows.rowNumber);

    res.json({ data: { batch, rows } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/imports/:batchId/confirm — inserts ONLY rows staged as valid.
 * Runs in one transaction: either the whole confirmed set lands, or none of it.
 */
importsRouter.post(
  "/:batchId/confirm",
  requirePermission(PERMISSIONS.customers.import, PERMISSIONS.customers.create),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const batchId = req.params.batchId as string;
      const db = getDb();

      const [batch] = await db
        .select()
        .from(importBatches)
        .where(eq(importBatches.id, batchId))
        .limit(1);
      if (!batch) throw notFound("Import batch not found");
      if (batch.createdBy !== ctx.userId) throw forbidden("This import belongs to another user");
      if (batch.status === "imported") throw conflict("This batch has already been imported");
      if (batch.expiresAt < new Date()) throw conflict("This batch has expired. Re-upload the file.");

      const valid = await db
        .select()
        .from(importRows)
        .where(and(eq(importRows.batchId, batchId), eq(importRows.status, "valid")))
        .orderBy(importRows.rowNumber);

      if (valid.length === 0) throw badRequest("There are no valid rows to import");

      /*
       * CUSTOMER CODES COME FROM THE SAME SEQUENCE AS THE ROUTE — Task 4.9, D-050.
       *
       * This block used to run its own `count(*)` over `customers` and mint
       * `CUS-${10000 + n}` from it, entirely independently of
       * `nextCustomerCode` in `customers.routes.ts`. Two generators over one
       * partial unique index collide with EACH OTHER with no delete and no race
       * required: a create between the count and the inserts, or simply an
       * importer run after any permanent delete, hands out a code already
       * issued. Fixing the route alone would have left that collision in place,
       * which is why D-050 treats the three sites as one defect.
       *
       * `tx` is passed, not the base handle: reading through the base handle
       * from inside a transaction deadlocks on a single-connection driver
       * (D-032). Codes are drawn one per row rather than as a reserved block —
       * `nextval` is atomic and not rolled back, so an aborted import burns the
       * numbers it drew. A gap is harmless; a reuse is not.
       */
      const imported = await db.transaction(async (tx) => {
        let inserted = 0;

        for (const row of valid) {
          const data = row.normalised as Record<string, unknown>;
          const bankId = String(data.bankId);
          // Re-checked at confirm time: bank access could have been revoked
          // between upload and confirmation.
          assertBankAccess(ctx, bankId);

          const aadhaar = data.aadhaar ? String(data.aadhaar) : "";
          const [created] = await tx
            .insert(customers)
            .values({
              code: await nextResourceCode("CUS", tx),
              bankId,
              bankReferenceId: String(data.bankReferenceId),
              name: String(data.name),
              mobile: String(data.mobile),
              email: data.email ? String(data.email) : null,
              pan: data.pan ? String(data.pan) : null,
              aadhaarHash: aadhaar ? peppered(aadhaar, env().AADHAAR_PEPPER) : null,
              aadhaarLast4: aadhaar ? aadhaar.slice(-4) : null,
              monthlyIncome: String(data.monthlyIncome ?? 0),
              city: data.city ? String(data.city) : null,
              state: data.state ? String(data.state) : null,
              pincode: data.pincode ? String(data.pincode) : null,
              occupation: data.occupation ? String(data.occupation) : null,
              cibil: data.cibil ? Number(data.cibil) : null,
              kyc: "Pending",
              status: "Active",
              createdBy: ctx.userId,
              updatedBy: ctx.userId,
            })
            .returning({ id: customers.id });

          await tx
            .update(importRows)
            .set({ status: "imported", createdRecordId: created!.id })
            .where(eq(importRows.id, row.id));
          inserted += 1;
        }

        await tx
          .update(importBatches)
          .set({
            status: "imported",
            importedRows: inserted,
            confirmedAt: new Date(),
            confirmedBy: ctx.userId,
          })
          .where(eq(importBatches.id, batchId));

        await recordAudit(tx as never, ctx, req, {
          action: "imported",
          recordType: "customer",
          recordId: batchId,
          summary: `Imported ${inserted} customer(s) from ${batch.fileName}`,
          metadata: {
            batchId,
            totalRows: batch.totalRows,
            skipped: batch.totalRows - inserted,
          },
        });

        return inserted;
      });

      res.json({
        data: {
          batchId,
          imported,
          skipped: batch.totalRows - imported,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
