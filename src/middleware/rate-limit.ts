import type { NextFunction, Request, RequestHandler, Response } from "express";
import { tooManyRequests } from "../lib/errors.js";

/**
 * REQUEST LIMITING AND ARGON2 CONCURRENCY — SEC-005, Task 13.1.
 *
 * ── HISTORY ─────────────────────────────────────────────────────────────────
 *
 * This file was created by Task 3.6 as a deliberately narrow, local limiter for
 * the three public credential endpoints, because SEC-005's real answer belonged
 * to Phase 13. **Task 13.1 is that answer**, and it extends this file rather
 * than replacing it: the bucket mechanism was always sound, what was missing
 * was reach.
 *
 * Added by 13.1:
 *   - `keyFor`, so a limiter can count per **account** as well as per address.
 *     SEC-005 asks for "IP + account", and the two catch different attacks.
 *   - `withHashSlot`, the **argon2 concurrency cap** — the half of the finding
 *     a request limiter cannot solve. See its own note below.
 *   - Application to `POST /api/auth/login`, the route the finding names first,
 *     and a global limiter in `app.ts` covering every endpoint.
 *
 * ── WHAT IT STILL IS NOT, AND THIS MATTERS ──────────────────────────────────
 *
 *   - **Per process.** Two Railway instances keep separate counters, so the
 *     effective limit multiplies by the instance count. Correct for a
 *     single-container deployment; a distributed limiter needs shared state
 *     (Redis), which is a dependency decision (D-006) and an infrastructure one.
 *   - **In memory.** A restart forgets every counter.
 *   - **Fixed window**, not sliding: an allowance can be spent at the end of one
 *     window and again at the start of the next, so the true short-term burst
 *     ceiling is 2x `max`.
 *
 * Those three are **recorded, not hidden**. SEC-005 closes because the
 * unthrottled surface and the unbounded argon2 cost are both gone; the residual
 * distributed-limiter gap is stated in the finding and in DECISIONS.md D-085.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

/** Module-level so the window survives across requests, not across processes. */
const buckets = new Map<string, Bucket>();

/**
 * Never let the map grow without bound: a hostile caller rotating source
 * addresses would otherwise be a memory-exhaustion primitive of its own.
 */
const MAX_TRACKED = 10_000;

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
  /** Distinguishes one limiter's counters from another's. */
  name: string;
  /**
   * What to count per — defaults to the source address.
   *
   * Task 13.1 needs a second axis. SEC-005 asks for **"IP + account"** limiting,
   * and the two answer different attacks: per-IP stops one host hammering the
   * whole login surface, per-account stops a *distributed* attempt at ONE
   * inbox, which per-IP cannot see at all. Returning `null` opts a request out
   * of that limiter entirely — the account limiter uses it when the body
   * carries no usable identifier, because bucketing every malformed request
   * under one key would let junk exhaust a real user's allowance.
   */
  keyFor?: (req: Request) => string | null;
}

const keyOf = (req: Request, name: string): string => `${name}:${req.ip ?? "unknown"}`;

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();

    const custom = options.keyFor?.(req);
    // `null` means "this limiter has nothing to count for this request".
    if (options.keyFor && custom === null) {
      next();
      return;
    }
    const key = custom ? `${options.name}:${custom}` : keyOf(req, options.name);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= MAX_TRACKED) prune(now);
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      /*
       * The same refusal an over-limit login already produces, and deliberately
       * uninformative: it says nothing about whether the address exists, which
       * would otherwise turn the limiter itself into the enumeration oracle the
       * endpoint is built to avoid.
       */
      next(tooManyRequests("Too many requests. Try again shortly."));
      return;
    }

    next();
  };
}

/** Clears every counter. For tests, so one case cannot throttle the next. */
export function resetRateLimits(): void {
  buckets.clear();
}

/* ── the argon2 concurrency cap ──────────────────────────────────────────── */

/**
 * SEC-005's SECOND half, and the one a request limiter cannot solve.
 *
 * The finding is *"no HTTP rate limiting anywhere; **argon2id pile-up denial of
 * service**"*. Those are two problems. A fixed-window limiter caps how many
 * requests **arrive**; it does nothing about how many argon2 verifications run
 * **at once**, and argon2id is deliberately memory-hard — the configuration in
 * `lib/password.ts` costs ~19 MB per hash. A few dozen concurrent logins is
 * hundreds of megabytes of live allocation on a Railway container, and the
 * process dies of memory exhaustion long before any per-IP counter notices,
 * because a distributed attempt spreads across addresses.
 *
 * So the two limits compose: the limiter bounds arrival rate per source, and
 * this bounds *simultaneous cost* regardless of source.
 *
 * ── QUEUE, DO NOT REJECT ────────────────────────────────────────────────────
 *
 * Requests over the cap **wait** rather than being refused. A legitimate user
 * arriving during a burst gets a slower login, not a failure — and crucially,
 * queueing cannot be used as an oracle: it is blind to whether the address
 * exists, so it does not reopen SEC-004.
 *
 * The queue is bounded. An unbounded one is just a slower way to run out of
 * memory, so past `MAX_QUEUE` the request is refused with the same
 * uninformative 429 the limiter uses.
 */
const MAX_CONCURRENT_HASHES = 4;
const MAX_QUEUE = 100;

let active = 0;
const waiting: Array<() => void> = [];

/** For tests, so one case cannot leave the semaphore held. */
export function resetHashConcurrency(): void {
  active = 0;
  waiting.length = 0;
}

/** Current depth, exposed so a test can assert the cap actually holds. */
export const hashConcurrency = (): { active: number; queued: number } => ({
  active,
  queued: waiting.length,
});

/**
 * Runs `fn` with at most `MAX_CONCURRENT_HASHES` others in flight.
 *
 * The release is in a `finally`, so a rejected verification frees its slot —
 * a failed login is the common case here and must not leak capacity.
 */
export async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_HASHES) {
    if (waiting.length >= MAX_QUEUE) {
      throw tooManyRequests("Too many requests. Try again shortly.");
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}
