import "dotenv/config";
import { z } from "zod";

/**
 * `user@example.com`, or `Display Name <user@example.com>`.
 *
 * Deliberately looser than `z.email()`. The display-name form is what a real
 * `EMAIL_FROM` usually looks like — `Rise Next <no-reply@risenext.in>` — and
 * rejecting it would be a **false positive that stops a correct production
 * deployment from booting**. The `NODE_ENV` note above is the standard this
 * file holds itself to: refuse to guess, but never refuse something valid.
 */
const EMAIL_ADDRESS = /^(?:[^<>]*<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

/** Exported so the email service validates recipients by the same rule (D-024). */
export const isEmailAddress = (value: string): boolean => EMAIL_ADDRESS.test(value.trim());

const emailAddress = (key: string) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => EMAIL_ADDRESS.test(value), {
      error: `${key} must be an email address, either "user@example.com" or "Display Name <user@example.com>"`,
    });

const schema = z.object({
  /**
   * Required, deliberately — SEC-028.
   *
   * This used to be `.default("development")`, and the default was the defect.
   * `NODE_ENV` alone decides the refresh cookie's `Secure` and `SameSite`
   * flags (`lib/tokens.ts:75-82`), and **nothing in this repository sets it**:
   * there is no Dockerfile, no `railway.*`, no `Procfile`, no CI, and
   * `npm start` is a bare `node dist/server.js`. So a genuine production
   * deployment that simply never set the variable booted as `development` and
   * issued the refresh cookie **without `Secure` and with `SameSite=Lax`** —
   * transmissible over plain HTTP, and, across the Vercel↔Railway site
   * boundary, never sent at all, so every reload silently signed the user out.
   *
   * Requiring the declaration is the whole fix. It infers nothing from other
   * variables, so it cannot produce a false positive; it simply refuses to
   * guess. A typo was already rejected by the enum — only *absence* was silent.
   */
  NODE_ENV: z.enum(["development", "test", "production"], {
    error:
      "NODE_ENV must be set explicitly to development, test or production. " +
      "It is not defaulted: it alone decides the refresh cookie's Secure and " +
      "SameSite flags, so guessing it wrong ships insecure sessions.",
  }),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_DATABASE_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_DOMAIN: z.string().optional(),

  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),

  BOOTSTRAP_SUPERADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_SUPERADMIN_PASSWORD: z.string().optional(),

  RECYCLE_BIN_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),
  /*
   * REQUIRED IN EVERY ENVIRONMENT — SEC-007, Task 13.4.
   *
   * It used to default to a value published in this repository, guarded only by
   * a production-only check. That guard was real but narrow: it fired on
   * `NODE_ENV === "production"` and nothing else, so a **staging** or
   * **UAT** deployment — the environments that get loaded with real customer
   * data for acceptance testing, and that nobody thinks of as production —
   * peppered live Aadhaar numbers with a public constant.
   *
   * There is no default now. The variable is declared or the process does not
   * start, in every environment, which is the same standard `NODE_ENV` was held
   * to by SEC-028 and for the same reason: refuse to guess rather than guess
   * quietly. 32 characters minimum, raised from 16 — this is an HMAC key over a
   * 10^12 keyspace, and a short one is the whole control.
   */
  AADHAAR_PEPPER: z
    .string()
    .min(32, "AADHAAR_PEPPER must be at least 32 characters — it is the HMAC key protecting every stored Aadhaar number")
    .refine((v) => v !== "dev-only-pepper-change-me!!", {
      error: "AADHAAR_PEPPER is set to the placeholder published in this repository. Generate one with: openssl rand -base64 48",
    }),

  /*
   * Email — Task 3.2.
   *
   * All four are **optional here and required in production**, enforced in the
   * production block below rather than by the schema. That split is deliberate
   * and matches `AADHAAR_PEPPER`: a developer with no mail credentials must
   * still be able to boot and create an employee, while a production deploy
   * that forgot them must not start believing it can send invitations.
   *
   * `EMAIL_PROVIDER` is an allowlist of one. **D-033** selected Resend, and a
   * key that accepts only what is actually implemented is what makes a typo a
   * boot failure instead of a silent no-op. Widen the enum when a second
   * provider genuinely exists — not before.
   *
   * No default, and no value of any kind, for `EMAIL_API_KEY`. It is a secret;
   * a placeholder default would be the `AADHAAR_PEPPER` mistake again.
   */
  EMAIL_PROVIDER: z.enum(["resend"]).optional(),
  EMAIL_API_KEY: z.string().trim().min(1).optional(),
  EMAIL_FROM: emailAddress("EMAIL_FROM").optional(),
  EMAIL_REPLY_TO: emailAddress("EMAIL_REPLY_TO").optional(),

  /*
   * Object storage for KYC documents — Task 9.2, DECISIONS.md D-071, D-072.
   *
   * Same shape as email above, and for the same reasons: optional in the
   * schema, **required in the production block**, and `STORAGE_PROVIDER` is an
   * allowlist of one. D-071 selected **AWS S3, region `ap-south-1`** — the only
   * provider compatible with the documented Vercel/Railway/Neon deployment that
   * has an India region, which OPEN-2 records as a legal constraint rather than
   * a preference. Widen the enum when a second adapter genuinely exists.
   *
   * A developer with no bucket must still be able to boot and exercise the
   * document flow, so `services/storage.ts` falls back to a local filesystem
   * adapter behind the same interface. A production deploy that forgot the
   * configuration must NOT start believing it can store a KYC document — a
   * filesystem adapter on an ephemeral Railway container would accept an upload
   * and lose it, which is D-004's forbidden shape at its most expensive.
   *
   * No default and no value of any kind for the two credentials.
   *
   * ── MAX_DOCUMENT_MB is deliberately NOT `MAX_UPLOAD_MB` ──────────────────
   *
   * SEC-008 frames `MAX_UPLOAD_MB` explicitly as the Excel importer's
   * **zip-bomb decompression budget**. Raising the limit to fit a scanned
   * multi-page bank statement would raise the importer's inflation ceiling as a
   * side effect. Two limits, two risk profiles, two keys.
   */
  STORAGE_PROVIDER: z.enum(["s3"]).optional(),
  STORAGE_BUCKET: z.string().trim().min(1).optional(),
  STORAGE_REGION: z.string().trim().min(1).optional(),
  STORAGE_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
  /** Set only for S3-compatible providers that are not AWS. */
  STORAGE_ENDPOINT: z.string().trim().min(1).optional(),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
  MAX_DOCUMENT_MB: z.coerce.number().int().positive().default(15),

  /*
   * THE ONE WAY TO BOOT PRODUCTION WITHOUT A BUCKET — and it is deliberately
   * awkward to reach.
   *
   * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
   *
   * The storage block above refuses to boot in production without all five
   * `STORAGE_*` keys, and that rule is right: a filesystem adapter on an
   * ephemeral container accepts a KYC upload, reports success, and loses the
   * file on the next restart, with the database row left pointing at nothing.
   * That is D-004's forbidden shape — a control claiming an outcome it never
   * achieved — and it is the most expensive instance of it in this codebase.
   *
   * But the rule also makes NODE_ENV=production and "no S3 yet" mutually
   * exclusive, and there is a real, temporary deployment state in between:
   * the API is live on Railway against Neon, sending real mail, exercising
   * every non-document workflow, while object storage is still being
   * procured. The alternative to this key is deploying as
   * NODE_ENV=development, which silently strips `Secure` and flips the refresh
   * cookie to `SameSite=Lax` (SEC-028, `lib/tokens.ts`) — a security
   * regression across the whole session layer to work around a storage gap.
   * Trading a documented, narrow, loudly-announced storage limitation for a
   * silent auth one is the wrong trade.
   *
   * ── WHY IT IS SAFE TO HAVE ──────────────────────────────────────────────
   *
   * It cannot be reached by accident. It has no default, so absence keeps the
   * original refusal exactly as it was; the enum means a typo — `TRUE`, `1`,
   * `yes` — is a boot failure rather than a value quietly read as false; and
   * `"false"` is accepted only so that setting it explicitly OFF is
   * expressible. Nothing infers it from another variable.
   *
   * It also does not go quiet once set: `server.ts` logs a `warn` on every
   * boot naming the consequence, so this state is visible in the deployment
   * log for as long as it lasts rather than being a one-time decision nobody
   * can see afterwards.
   *
   * ⚠️ Documents uploaded while this is enabled are NOT durable. This is a
   *    bridge to the S3 configuration, not a substitute for it.
   */
  STORAGE_ALLOW_EPHEMERAL: z.enum(["true", "false"]).optional(),
});

/** The email settings that must all be present before mail can be delivered. */
const EMAIL_KEYS = ["EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO"] as const;

/** The storage settings that must all be present before an object can be stored. */
const STORAGE_KEYS = [
  "STORAGE_PROVIDER",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
] as const;

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Fail fast on boot. A backend that starts with a missing JWT secret is worse
 * than one that refuses to start.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    /*
     * The known-bad-value check moved INTO the schema (Task 13.4), so it now
     * fires in development and test too. Nothing is left to assert here.
     */
    if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
      throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ");
    }
    /*
     * Email is optional everywhere else and required here. Outside production
     * the console transport covers its absence; in production that fallback
     * would mean invitations and password-reset mail silently going nowhere,
     * which is a control reporting a success it never achieved (D-004).
     *
     * Only key NAMES are named. The values are secret and one of them is an
     * API key, so nothing here interpolates a value into the message.
     */
    const missing = EMAIL_KEYS.filter((key) => !parsed.data[key]);
    if (missing.length > 0) {
      throw new Error(
        `Email configuration is required in production. Missing: ${missing.join(", ")}. ` +
          "Without it no invitation or password-reset mail can be delivered, and the " +
          "console transport that covers development would discard it silently.",
      );
    }
    /*
     * Storage — Task 9.2, D-072. Same rule and the same reason as email, with
     * a sharper failure mode: the development fallback is a LOCAL FILESYSTEM
     * adapter, and a Railway container's filesystem is ephemeral. A production
     * deploy missing this configuration would accept a KYC upload, report
     * success, and lose the file on the next restart — with the database row
     * left pointing at nothing.
     *
     * Key NAMES only. Two of these are credentials.
     */
    const missingStorage = STORAGE_KEYS.filter((key) => !parsed.data[key]);
    if (missingStorage.length > 0 && parsed.data.STORAGE_ALLOW_EPHEMERAL !== "true") {
      throw new Error(
        `Object storage configuration is required in production. Missing: ${missingStorage.join(", ")}. ` +
          "Without it document uploads would fall back to the local filesystem adapter, " +
          "which on an ephemeral container accepts a KYC file and then loses it. " +
          "To deploy deliberately without durable storage while S3 is still being set up, " +
          "set STORAGE_ALLOW_EPHEMERAL=true — uploaded documents will NOT survive a restart.",
      );
    }
  }
  return parsed.data;
}

/**
 * Which transport the (not yet written) email service should use.
 *
 * Task 3.2 is configuration, not delivery: this resolves the mode and nothing
 * more. `services/email.ts` — roadmap **3.3** — is what will read it and
 * actually send. Production cannot reach `"console"`, because `loadEnv` refuses
 * to boot without the full configuration.
 */
export type EmailTransport = "resend" | "console";

export function emailTransport(config: Env = env()): EmailTransport {
  return EMAIL_KEYS.every((key) => config[key]) ? (config.EMAIL_PROVIDER as EmailTransport) : "console";
}

/** The email settings that are absent — key names only, never values. */
export function missingEmailConfig(config: Env = env()): string[] {
  return EMAIL_KEYS.filter((key) => !config[key]);
}

/**
 * Which storage adapter `services/storage.ts` should build — Task 9.2/9.3.
 *
 * `"local"` is a development and test convenience, never a production state:
 * `loadEnv` refuses to boot in production without the full configuration, so
 * this cannot return `"local"` there.
 */
export type StorageAdapterKind = "s3" | "local";

export function storageAdapterKind(config: Env = env()): StorageAdapterKind {
  return STORAGE_KEYS.every((key) => config[key]) ? (config.STORAGE_PROVIDER as "s3") : "local";
}

/** The storage settings that are absent — key names only, never values. */
export function missingStorageConfig(config: Env = env()): string[] {
  return STORAGE_KEYS.filter((key) => !config[key]);
}

/**
 * True when production is running on the local filesystem adapter because
 * `STORAGE_ALLOW_EPHEMERAL` was set — the state `loadEnv` would otherwise have
 * refused to start in.
 *
 * Exists so the condition is named in one place and asserted by a test, rather
 * than re-derived at the call site. `server.ts` logs it on every boot: a
 * deliberate temporary limitation that nobody can see afterwards decays into an
 * undocumented permanent one, and documents silently lost on restart is the
 * expensive way to discover that happened.
 */
export function storageIsEphemeralInProduction(config: Env = env()): boolean {
  return (
    config.NODE_ENV === "production" &&
    config.STORAGE_ALLOW_EPHEMERAL === "true" &&
    storageAdapterKind(config) === "local"
  );
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export const corsOrigins = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
