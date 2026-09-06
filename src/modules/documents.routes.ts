import { Router, type NextFunction, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { createHash } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { CUSTOMER_COLUMNS } from "./customers.routes.js";
import { customers, documents, loans, requiredDocumentTypes } from "../db/schema/index.js";
import { badRequest, notFound, unprocessable } from "../lib/errors.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertBankAccess, bankScope } from "../services/access.js";
import { recordAudit } from "../services/audit.js";
import { buildStorageKey, assertSafeKey, storage } from "../services/storage.js";
import { env } from "../config/env.js";

/**
 * REAL DOCUMENT STORAGE — Tasks 9.4 and 9.5
 * DECISIONS.md D-021, D-071, D-072, D-073 · SECURITY_AUDIT.md SEC-008, SEC-024
 *
 * Two routes the factory cannot generate, because neither is CRUD over JSON:
 *
 *   POST /api/documents/upload      multipart in, a row with a REAL storage_key out
 *   GET  /api/documents/:id/content authorization-checked bytes, or a signed URL
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 *
 * `documents/page.tsx` posted `{fileName, fileSize, mimeType}` and dropped the
 * `File` on the floor (BUG-004). The register recorded that a file *was named*,
 * never that it exists. `documents.storage_key` was a column nothing wrote.
 *
 * ── WHY NOT REUSE THE IMPORTER'S MULTER SETUP ───────────────────────────────
 *
 * The roadmap calls the Excel importer "the working reference for multipart
 * handling". It is the reference for the *shape* and NOT for two of its
 * details:
 *
 *   1. It uses `memoryStorage()`. SEC-008 records that as a problem for
 *      spreadsheets; for KYC documents it is the same problem with a larger
 *      file. This route caps size hard and streams to the object store rather
 *      than holding the buffer any longer than the hash needs.
 *   2. Its `fileFilter` rejects with a bare `Error`, which `error-handler.ts`
 *      cannot classify — so a wrong file type is a **500** (BUG-021). Row 9.4's
 *      own required test says "oversize/wrong-type rejected with 4xx, not 500".
 *      Copying it would have failed this row's own acceptance criteria.
 *
 * So multer errors are mapped to `AppError` **at the multer boundary** here,
 * never inside `error-handler.ts` — D-021 settled that a malformed input "is
 * rejected in the handler, not mapped in the error handler".
 */

export const documentsUploadRouter = Router();
documentsUploadRouter.use(requireAuth);

/** Extension allowlist. Deliberately short — this is KYC, not a file share. */
const ALLOWED = new Map<string, { mime: string; magic: readonly (readonly number[])[] }>([
  ["pdf", { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] }],
  ["jpg", { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] }],
  ["jpeg", { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] }],
  ["png", { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] }],
]);

let cachedUpload: ReturnType<typeof multer> | null = null;

function uploader() {
  cachedUpload ??= multer({
    storage: multer.memoryStorage(),
    // `MAX_DOCUMENT_MB`, never `MAX_UPLOAD_MB` — D-072. The latter is SEC-008's
    // zip-bomb decompression budget for the importer and must not be dragged
    // upward to fit a scanned bank statement.
    limits: { fileSize: env().MAX_DOCUMENT_MB * 1024 * 1024, files: 1 },
    fileFilter(_req, file, cb) {
      const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED.has(ext)) {
        // A MulterError, not a bare Error — see the mapper below. This is the
        // BUG-021 fix.
        cb(new MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
        return;
      }
      cb(null, true);
    },
  });
  return cachedUpload;
}

/** Test seam — the suite reloads config between cases. */
export function resetUploadCache(): void {
  cachedUpload = null;
}

/**
 * The multer boundary. Every failure leaves here as a 4xx `AppError` carrying
 * `details[].path`, so `lib/field-errors.ts` can land it on the file input
 * (D-031) — and never as an unclassifiable throw that becomes a 500.
 */
function receiveFile(req: Request, res: Response, next: NextFunction): void {
  uploader().single("file")(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? `That file is larger than the ${env().MAX_DOCUMENT_MB} MB limit.`
          : error.code === "LIMIT_UNEXPECTED_FILE"
            ? `Only ${[...ALLOWED.keys()].join(", ")} files are accepted.`
            : "That upload could not be read.";
      next(unprocessable(message, [{ path: "file", message }]));
      return;
    }
    next(badRequest("That upload could not be read."));
  });
}

/** Client-declared MIME is recorded and never trusted — the bytes decide. */
function magicBytesMatch(ext: string, body: Buffer): boolean {
  const spec = ALLOWED.get(ext);
  if (!spec) return false;
  return spec.magic.some((sig) => sig.every((byte, i) => body[i] === byte));
}

const uploadBody = z.object({
  bankId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  loanId: z.string().uuid().optional().nullable(),
  docType: z.string().trim().min(2).max(80),
});

documentsUploadRouter.post(
  "/upload",
  requirePermission(PERMISSIONS.documents.upload),
  receiveFile,
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        const message = "Choose a file to upload.";
        throw unprocessable(message, [{ path: "file", message }]);
      }

      const parsed = uploadBody.parse(req.body);
      assertBankAccess(ctx, parsed.bankId);

      const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
      if (!magicBytesMatch(ext, file.buffer)) {
        // The whole point of 9.4's "magic bytes (not client-declared MIME)":
        // renaming `payload.exe` to `payload.pdf` gets this far and no further.
        const message =
          "That file's contents do not match its extension, so it was not stored.";
        throw unprocessable(message, [{ path: "file", message }]);
      }

      const db = getDb();

      // Cross-record integrity, the same rule the factory routers apply.
      if (parsed.customerId) {
        const [customer] = await db
          .select({ bankId: customers.bankId })
          .from(customers)
          .where(and(eq(customers.id, parsed.customerId), isNull(customers.deletedAt)))
          .limit(1);
        if (!customer) throw notFound("Customer not found");
        if (customer.bankId !== parsed.bankId) {
          throw badRequest("The customer belongs to a different bank");
        }
      }
      if (parsed.loanId) {
        const [loan] = await db
          .select({ bankId: loans.bankId })
          .from(loans)
          .where(and(eq(loans.id, parsed.loanId), isNull(loans.deletedAt)))
          .limit(1);
        if (!loan) throw notFound("Loan not found");
        if (loan.bankId !== parsed.bankId) {
          throw badRequest("The loan belongs to a different bank");
        }
      }

      // SERVER-computed. SEC-024: a client-asserted checksum is worth nothing.
      // `documents` carries no `code` column — unlike the seven sequenced
      // resources, it is identified by its id and filename.
      const checksum = createHash("sha256").update(file.buffer).digest("hex");

      /*
       * Row first, then object, then the key back onto the row — all inside one
       * transaction (F1's boundary applies to the factory; this route opens its
       * own for the same reason).
       *
       * The row is inserted first because `buildStorageKey` needs the document
       * id, and a key that embeds the id is what makes an orphaned object
       * traceable back to a record. If the object store write throws, the whole
       * transaction unwinds and no row survives pointing at nothing.
       */
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(documents)
          .values({
            bankId: parsed.bankId,
            customerId: parsed.customerId ?? null,
            loanId: parsed.loanId ?? null,
            docType: parsed.docType,
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: ALLOWED.get(ext)!.mime,
            checksum,
            status: "Pending",
            uploadedBy: ctx.userId,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          } as never)
          .returning();

        const key = buildStorageKey({
          bankId: parsed.bankId,
          customerId: parsed.customerId ?? null,
          documentId: (row as { id: string }).id,
          fileName: file.originalname,
        });

        await storage().put(key, file.buffer, ALLOWED.get(ext)!.mime);

        const [withKey] = await tx
          .update(documents)
          .set({ storageKey: key })
          .where(eq(documents.id, (row as { id: string }).id))
          .returning();

        await recordAudit(tx as never, ctx, req, {
          action: "uploaded",
          recordType: "document",
          recordId: (row as { id: string }).id,
          bankId: parsed.bankId,
          summary: `Uploaded ${parsed.docType} ${file.originalname}`,
          // Metadata about the file, never the file. The bytes are KYC data and
          // an audit row is append-only and unpurgeable (SEC-017).
          metadata: {
            fileName: file.originalname,
            fileSize: String(file.size),
            checksum,
            docType: parsed.docType,
          },
        });

        return withKey;
      });

      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/documents/:id/content — Task 9.5.
 *
 * **Never a public bucket URL.** Either a short-lived signed URL that the
 * adapter mints, or bytes streamed through this process. Both paths are
 * authorization-checked first; the URL's expiry is not the access control, the
 * check above it is.
 */
documentsUploadRouter.get(
  "/:id/content",
  requirePermission(PERMISSIONS.documents.view),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const db = getDb();

      const scope = bankScope(ctx, documents.bankId);
      const [row] = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, id),
            isNull(documents.deletedAt),
            ...(scope ? [scope] : []),
          ),
        )
        .limit(1);

      // A cross-bank document is "not found", not "forbidden" — the same
      // no-leak posture the factory's scoped reads take.
      if (!row) throw notFound("document not found");
      if (!row.storageKey) throw notFound("This document has no stored file");

      /*
       * SEC-024's second half. 9.4 stops NEW poisoned keys; it can do nothing
       * about rows written before it, when `storage_key` was client-supplied
       * free text. Every dereference is validated, every time.
       */
      assertSafeKey(row.storageKey);

      const adapter = storage();
      const signed = await adapter.signedUrl(row.storageKey, env().STORAGE_SIGNED_URL_TTL_SECONDS);

      await recordAudit(db, ctx, req, {
        action: "viewed",
        recordType: "document",
        recordId: id,
        bankId: row.bankId,
        summary: `Retrieved document ${row.fileName}`,
      });

      if (signed) {
        res.json({ data: { url: signed, expiresIn: env().STORAGE_SIGNED_URL_TTL_SECONDS } });
        return;
      }

      const body = await adapter.get(row.storageKey);
      /*
       * `attachment` and `nosniff` are not decoration. Phase 9 creates a
       * stored-content surface that did not exist in this system before, and
       * SEC-011 (no CSP anywhere) is Phase 13's to fix — so these two headers
       * are the only thing standing between a user-uploaded file and the
       * browser deciding to render it in this origin.
       */
      res.setHeader("Content-Type", row.mimeType ?? "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(body);
    } catch (error) {
      next(error);
    }
  },
);

/*
 * The purge-side object deletion lives in `services/recycle-bin.ts` as
 * `purgeObject` (Task 9.8, D-075) — a purge is a service concern, and routing
 * it through this module would invert the dependency.
 */

/* ══ THE KYC PACK — Task 9.11, D-076 ═════════════════════════════════════ */

/**
 * `GET /api/customers/:id/kyc-pack`
 *
 * Phase 9's third DoD box reads *"A KYC pack can be assembled and produced from
 * the system"*. That phrase occurs **exactly once in this repository** — in
 * that DoD line — with no PRD requirement, no business-flow definition and no
 * data model behind it, and no task owned it until Wave 0.
 *
 * D-076 records engineering's minimum honest reading, and this is it:
 *
 *   required types      — from `required_document_types`, the table D-057 said
 *                         did not exist
 *   completeness        — required vs present-and-Verified, naming the gap
 *   manifest            — the Verified documents, each retrievable via 9.5
 *
 * **Deliberately not a PDF and not a ZIP.** D-055 refused to build a
 * document-generation backend in Phase 4 and nothing has authorised one since;
 * an archive would need a new production dependency, which D-006 gates. What
 * "produced" means beyond this is an owner decision, and if the answer is a
 * bound document then the honest close-out is to reword the DoD box rather than
 * to mark it met by something that is not one.
 *
 * An empty requirements table reports "no requirements configured" — NOT
 * "complete". A completeness check that passes because nobody configured
 * anything is the kind of false assurance this whole phase exists to remove.
 */
export const kycPackRouter = Router({ mergeParams: true });
kycPackRouter.use(requireAuth);

kycPackRouter.get(
  "/:id/kyc-pack",
  requirePermission(PERMISSIONS.documents.view),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const customerId = req.params.id as string;
      const db = getDb();

      const scope = bankScope(ctx, customers.bankId);
      /*
       * Projected — SEC-007, Task 13.4.
       *
       * The KYC pack is the one place outside `customers.routes.ts` that reads
       * a whole customer row, and a bare `.select()` returns `aadhaar_hash`
       * with it. Reusing the same constant means the omission is defined once;
       * a column added to the table cannot silently reappear in two responses.
       */
      const [customer] = await db
        .select(CUSTOMER_COLUMNS)
        .from(customers)
        .where(
          and(
            eq(customers.id, customerId),
            isNull(customers.deletedAt),
            ...(scope ? [scope] : []),
          ),
        )
        .limit(1);
      if (!customer) throw notFound("customer not found");

      /*
       * A NULL `bank_id` requirement applies everywhere; a row naming this
       * customer's bank overrides it. Read with an explicit predicate rather
       * than through `bankScope` — here NULL means "all banks", the opposite of
       * what `bankScope`'s `inArray` would do with it.
       */
      const required = await db
        .select()
        .from(requiredDocumentTypes)
        .where(
          and(
            isNull(requiredDocumentTypes.deletedAt),
            or(
              isNull(requiredDocumentTypes.bankId),
              eq(requiredDocumentTypes.bankId, customer.bankId),
            ),
          ),
        );

      // A bank-specific row wins over the global default for the same type.
      const byType = new Map<string, (typeof required)[number]>();
      for (const row of required) {
        const existing = byType.get(row.docType);
        if (!existing || (!existing.bankId && row.bankId)) byType.set(row.docType, row);
      }
      const requirements = [...byType.values()].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.docType.localeCompare(b.docType),
      );

      const held = await db
        .select()
        .from(documents)
        .where(and(eq(documents.customerId, customerId), isNull(documents.deletedAt)));

      const verified = held.filter((d) => d.status === "Verified" && d.storageKey);

      const completeness = requirements.map((requirement) => {
        const match = verified.find((d) => d.docType === requirement.docType);
        return {
          docType: requirement.docType,
          mandatory: requirement.mandatory,
          satisfied: Boolean(match),
          documentId: match?.id ?? null,
        };
      });

      const missing = completeness.filter((row) => row.mandatory && !row.satisfied);

      res.json({
        data: {
          customer: { id: customer.id, code: customer.code, name: customer.name },
          // `false` when nothing is configured — see the note above. An
          // unconfigured system does not get to call itself complete.
          complete: requirements.length > 0 && missing.length === 0,
          requirementsConfigured: requirements.length,
          missing: missing.map((row) => row.docType),
          completeness,
          /*
           * The manifest. Metadata only — the bytes are fetched one document at
           * a time through 9.5's authorization-checked route, so this response
           * can be handled and logged without carrying KYC content.
           */
          manifest: verified
            .map((d) => ({
              documentId: d.id,
              docType: d.docType,
              fileName: d.fileName,
              fileSize: d.fileSize,
              checksum: d.checksum,
              uploadedAt: d.createdAt,
              uploadedBy: d.uploadedBy,
              verifiedBy: d.verifiedBy,
              contentPath: `/api/documents/${d.id}/content`,
            }))
            .sort((a, b) => a.docType.localeCompare(b.docType)),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
