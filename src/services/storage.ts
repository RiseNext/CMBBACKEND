import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, storageAdapterKind, type Env } from "../config/env.js";
import { internal } from "../lib/errors.js";

/**
 * OBJECT STORAGE — Task 9.3, DECISIONS.md D-071, D-072
 *
 * "Implement real file storage. Today there is none." Before this file, `grep`
 * across `backend/src` found no `fs`, no `res.sendFile`, no object-store client
 * of any kind; `documents.storage_key` was a column nothing ever wrote, so every
 * row was a dangling pointer (BUG-004, SEC-024).
 *
 * ── PROVIDER-AGNOSTIC BY REQUIREMENT, NOT BY TASTE ──────────────────────────
 *
 * Row 9.3 asks for "put/get/delete/signed-URL behind a provider-agnostic
 * interface", and OPEN-2 — the choice of provider — is a **legal** question
 * about data residency for Indian KYC documents that engineering cannot settle.
 * D-071 records AWS S3 `ap-south-1` as the engineering default pending owner
 * ratification. The interface is what makes that ratification cheap: every
 * consumer (9.4, 9.5, 9.7, 9.8, 9.11) talks to `StorageAdapter`, so changing
 * provider is a config change, not a rewrite.
 *
 * ── WHY THE S3 ADAPTER IS HAND-SIGNED ───────────────────────────────────────
 *
 * `@aws-sdk/client-s3` is **not a dependency of this repository** and the
 * operating rules for this block forbid adding one. Rather than stub the
 * adapter out or quietly install a package, the S3 requests are signed here
 * with AWS Signature Version 4 using `node:crypto`, which is already available.
 * SigV4 is a stable, fully documented algorithm and the four operations this
 * interface needs are the simplest ones in it.
 *
 * ⚠️ **Honest limitation.** The signing implementation below is unit-tested for
 * algorithmic correctness (`src/tests/storage-service.test.ts` checks the
 * canonical request, the string-to-sign and the derived key against worked
 * examples), but it has **never been exercised against a live S3 bucket in this
 * environment** — there is no network access and no credentials here. Treat the
 * first real deployment as the integration test, and see the close-out report.
 *
 * ── DEV AND TEST USE THE LOCAL ADAPTER ──────────────────────────────────────
 *
 * `storageAdapterKind()` returns `"local"` whenever the storage configuration is
 * incomplete, which in production is impossible — `loadEnv` refuses to boot
 * without it (D-072). So the suite runs against a real adapter with real bytes
 * on disk, and production can never silently fall back to a container-local
 * filesystem that loses KYC documents on restart.
 */

/** What every consumer is allowed to know about storage. */
export interface StorageAdapter {
  readonly kind: "s3" | "local";
  /** Stores bytes and returns nothing — the key is chosen by the caller. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Idempotent: deleting an absent object is a success, not an error. */
  delete(key: string): Promise<void>;
  /**
   * A short-lived URL, or `null` when the adapter cannot mint one and the
   * caller must stream the bytes itself.
   */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}

/**
 * The object key for a document — Task 9.4.
 *
 * **Server-generated, always.** `storage_key` is accepted from the client today
 * and written by nothing, which is SEC-024: an attacker-controlled, path-shaped
 * string accumulating in the database against the day something dereferences
 * it. 9.4 removes it from the create schema and calls this instead.
 *
 * The shape encodes the scope the object belongs to, so a stray key is
 * recognisable and a bucket listing is navigable. The trailing `uuid` makes
 * re-uploading the same filename a new object rather than an overwrite.
 */
export function buildStorageKey(input: {
  bankId: string;
  customerId: string | null;
  documentId: string;
  fileName: string;
}): string {
  const ext = path.extname(input.fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const customer = input.customerId ?? "unassigned";
  return `${input.bankId}/${customer}/${input.documentId}/${randomUUID()}${ext}`;
}

/**
 * Refuses a key that could escape its prefix.
 *
 * Applied on the READ path as well as the write path, because SEC-024's whole
 * point is that rows written before 9.4 carry keys the server never chose.
 * Server-generated keys always pass; a legacy `../../etc/passwd` does not.
 */
export function assertSafeKey(key: string): void {
  const bad =
    !key ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("\0") ||
    !/^[A-Za-z0-9._/-]+$/.test(key);
  if (bad) throw internal("Refusing to dereference an unsafe storage key");
}

/* ── local filesystem adapter ────────────────────────────────────────────── */

function localRoot(): string {
  return path.resolve(process.cwd(), ".storage");
}

class LocalAdapter implements StorageAdapter {
  readonly kind = "local" as const;

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(localRoot(), key);
    // Belt and braces: even with `assertSafeKey`, never write outside the root.
    if (!full.startsWith(localRoot())) throw internal("Refusing to write outside the storage root");
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    // `force` makes this idempotent — 9.8 deletes the object before the row and
    // must be safe to retry.
    await rm(this.resolve(key), { force: true });
  }

  async signedUrl(): Promise<string | null> {
    // No URL can be minted for a path on this container's disk. Returning null
    // is the contract's way of saying "stream it yourself", which is what 9.5
    // does. Inventing a URL here would be a control claiming a capability it
    // does not have.
    return null;
  }
}

/* ── AWS Signature Version 4 ─────────────────────────────────────────────── */

const sha256Hex = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** `20260906T101530Z` and `20260906`, the two forms SigV4 needs. */
export function sigv4Timestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** S3 requires each path segment encoded, with `/` left intact. */
export function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

export function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), service), "aws4_request");
}

/**
 * The three strings SigV4 is built from. Exported so the suite can assert them
 * without a network call — the signature is only ever as correct as these.
 */
export function sigv4Parts(input: {
  method: string;
  host: string;
  keyPath: string;
  query: string;
  payloadHash: string;
  amzDate: string;
  dateStamp: string;
  region: string;
  signedHeaders: string;
  canonicalHeaders: string;
}): { canonicalRequest: string; stringToSign: string; credentialScope: string } {
  const canonicalRequest = [
    input.method,
    `/${input.keyPath}`,
    input.query,
    input.canonicalHeaders,
    input.signedHeaders,
    input.payloadHash,
  ].join("\n");

  const credentialScope = `${input.dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  return { canonicalRequest, stringToSign, credentialScope };
}

class S3Adapter implements StorageAdapter {
  readonly kind = "s3" as const;

  constructor(private readonly config: Env) {}

  private host(): string {
    if (this.config.STORAGE_ENDPOINT) {
      return this.config.STORAGE_ENDPOINT.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }
    return `${this.config.STORAGE_BUCKET}.s3.${this.config.STORAGE_REGION}.amazonaws.com`;
  }

  private async send(
    method: "PUT" | "GET" | "DELETE",
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    assertSafeKey(key);
    const host = this.host();
    const keyPath = encodeKeyPath(key);
    const { amzDate, dateStamp } = sigv4Timestamps(new Date());
    const payloadHash = sha256Hex(body ?? "");

    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;
    // Encryption at rest is not optional for KYC documents.
    if (method === "PUT") headers["x-amz-server-side-encryption"] = "AES256";

    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = `${sortedKeys.map((h) => `${h}:${headers[h]}`).join("\n")}\n`;
    const signedHeaders = sortedKeys.join(";");

    const { stringToSign, credentialScope } = sigv4Parts({
      method,
      host,
      keyPath,
      query: "",
      payloadHash,
      amzDate,
      dateStamp,
      region: this.config.STORAGE_REGION!,
      signedHeaders,
      canonicalHeaders,
    });

    const signature = hmac(
      signingKey(this.config.STORAGE_SECRET_ACCESS_KEY!, dateStamp, this.config.STORAGE_REGION!, "s3"),
      stringToSign,
    ).toString("hex");

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.config.STORAGE_ACCESS_KEY_ID}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(`https://${host}/${keyPath}`, {
      method,
      headers: { ...headers, authorization },
      body: body ?? undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.send("PUT", key, body, contentType);
    // The status is reported; the body is not. An S3 error body can echo the
    // key and other request detail, and this runs on the KYC path.
    if (!res.ok) throw internal(`Object storage rejected the upload (${res.status})`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.send("GET", key);
    if (!res.ok) throw internal(`Object storage could not return the document (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.send("DELETE", key);
    // 204 on success, 404 when already gone — both are "the object is not
    // there", which is what 9.8 needs to be able to retry safely.
    if (!res.ok && res.status !== 404) {
      throw internal(`Object storage could not delete the document (${res.status})`);
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    assertSafeKey(key);
    const host = this.host();
    const keyPath = encodeKeyPath(key);
    const { amzDate, dateStamp } = sigv4Timestamps(new Date());
    const credentialScope = `${dateStamp}/${this.config.STORAGE_REGION}/s3/aws4_request`;

    const query = [
      `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
      `X-Amz-Credential=${encodeURIComponent(`${this.config.STORAGE_ACCESS_KEY_ID}/${credentialScope}`)}`,
      `X-Amz-Date=${amzDate}`,
      `X-Amz-Expires=${expiresInSeconds}`,
      `X-Amz-SignedHeaders=host`,
    ].join("&");

    const { stringToSign } = sigv4Parts({
      method: "GET",
      host,
      keyPath,
      query,
      payloadHash: "UNSIGNED-PAYLOAD",
      amzDate,
      dateStamp,
      region: this.config.STORAGE_REGION!,
      signedHeaders: "host",
      canonicalHeaders: `host:${host}\n`,
    });

    const signature = hmac(
      signingKey(this.config.STORAGE_SECRET_ACCESS_KEY!, dateStamp, this.config.STORAGE_REGION!, "s3"),
      stringToSign,
    ).toString("hex");

    return `https://${host}/${keyPath}?${query}&X-Amz-Signature=${signature}`;
  }
}

/* ── selection ───────────────────────────────────────────────────────────── */

let cached: StorageAdapter | null = null;

export function storage(config: Env = env()): StorageAdapter {
  if (cached) return cached;
  cached = storageAdapterKind(config) === "s3" ? new S3Adapter(config) : new LocalAdapter();
  return cached;
}

/** Test seam — the suite swaps adapters between cases. */
export function resetStorageCache(): void {
  cached = null;
}
