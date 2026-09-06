import argon2 from "argon2";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Argon2id at the OWASP 2024 low-memory baseline, which fits inside a small
 * Railway container without blowing the memory limit under concurrent logins.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { ...OPTIONS });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The keyed digest stored in `customers.aadhaar_hash` — SEC-007, Task 13.4.
 *
 * ── WHY HMAC AND NOT `sha256(pepper + ":" + value)` ─────────────────────────
 *
 * It was the concatenated form, and the finding is right to call it out. An
 * Aadhaar number is **12 digits** — a keyspace of 10^12, which a GPU walks in
 * minutes. The pepper is the only thing standing between a leaked hash column
 * and every customer's Aadhaar number, so how the pepper is mixed in is the
 * whole control:
 *
 *   - `sha256(pepper + ":" + value)` is vulnerable to **length extension**.
 *     SHA-256 is a Merkle-Damgård construction, so an attacker who learns one
 *     digest can compute the digest of `pepper:value‖suffix` **without knowing
 *     the pepper**. It also has no domain separation — a pepper ending in a
 *     digit and a value beginning with one can collide with a different pair.
 *   - HMAC-SHA256 is specifically constructed to resist both, and it is what
 *     "use HMAC or a slow KDF" in the roadmap row asks for.
 *
 * A slow KDF (argon2/scrypt) would be stronger still and was **not** chosen: it
 * is applied on the customer *write* path, which the Excel importer drives in
 * bulk, and a memory-hard function there recreates the pile-up SEC-005 is about
 * one route over. HMAC removes the structural weaknesses at no cost. The
 * residual — a leaked hash column *and* a leaked pepper together yield the
 * numbers — is inherent to storing a digest of a 12-digit space at all, and is
 * why the pepper belongs in a managed secret store (roadmap 15.10).
 *
 * ⚠️ **CHANGING THIS IS EQUIVALENT TO ROTATING THE PEPPER.** Digests written by
 * the old construction cannot be recomputed — the raw numbers are never stored.
 * It is done now, before first deployment, precisely because no real Aadhaar
 * exists yet. `aadhaar_hash` has no unique index and is read by no query, so
 * nothing in the product breaks; but after go-live this function is frozen for
 * the life of the database, exactly like `AADHAAR_PEPPER` itself.
 */
export function peppered(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Alphabets for generated credentials. `0/O` and `1/l/I` are left out because a
 * temporary password is read off a screen and typed by hand, and a misread
 * character is indistinguishable from a wrong password at the login form.
 */
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const TEMP_ALPHABET = LOWER + UPPER + DIGIT;
const TEMP_LENGTH = 14;

/** Uniform index into `alphabet`, rejection-sampled so no character is favoured. */
function pick(alphabet: string): string {
  const limit = 256 - (256 % alphabet.length);
  for (;;) {
    const byte = randomBytes(1)[0] as number;
    if (byte < limit) return alphabet[byte % alphabet.length] as string;
  }
}

/**
 * A temporary password that is guaranteed to satisfy `passwordProblems`, so the
 * credential an admin hands over can never be one the policy would later
 * reject. Generated fresh per call, hashed immediately, and returned to the
 * caller exactly once — nothing stores the plaintext.
 */
export function generateTemporaryPassword(): string {
  // Seed one of each required class first, then fill, then shuffle, so the
  // guarantee does not depend on luck.
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT)];
  while (chars.length < TEMP_LENGTH) chars.push(pick(TEMP_ALPHABET));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const limit = 256 - (256 % (i + 1));
    let byte = randomBytes(1)[0] as number;
    while (byte >= limit) byte = randomBytes(1)[0] as number;
    const j = byte % (i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }

  return chars.join("");
}

const PASSWORD_MIN = 12;

export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < PASSWORD_MIN) problems.push(`must be at least ${PASSWORD_MIN} characters`);
  if (!/[a-z]/.test(plain)) problems.push("must contain a lowercase letter");
  if (!/[A-Z]/.test(plain)) problems.push("must contain an uppercase letter");
  if (!/[0-9]/.test(plain)) problems.push("must contain a digit");
  return problems;
}
