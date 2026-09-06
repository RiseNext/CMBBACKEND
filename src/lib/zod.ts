import { z } from "zod";

/**
 * PARTIAL-UPDATE SCHEMAS — BUG-036
 *
 * `schema.partial()` alone is **not** safe for a PATCH body.
 *
 * In zod 4 a `.default(...)` survives `.partial()`: the field becomes
 * `ZodOptional<ZodDefault<…>>`, and because a successfully applied default is
 * not an "absent" result, the optional wrapper passes it straight through. So
 * `userInput.partial().parse({ name: "x" })` returns
 * `{ name: "x", status: "Active", target: 0, achieved: 0 }` — three values the
 * caller never sent. Every handler in this codebase then writes them, either
 * through an `input.x !== undefined` guard that the injected value defeats or,
 * in `createScopedResource`, by spreading the parsed object wholesale.
 *
 * Measured consequences before this helper existed: a name-only PATCH zeroed an
 * employee's `target`/`achieved` and **reactivated a revoked account**; a bank
 * pause wiped `commissionRate` and `productsOffered`; a customer edit reverted
 * `kyc` from Verified to Pending; and a remarks-only PATCH on an approved loan
 * zeroed every money column and reset its status to Draft.
 *
 * The defaults themselves are correct and must stay — POST relies on them. Only
 * the partial-update path needs them gone, which is exactly what this does.
 */

/** `ZodDefault<Inner>` collapses to `Inner`; everything else is left alone. */
type WithoutDefault<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;

type WithoutDefaults<T extends z.ZodRawShape> = {
  [K in keyof T]: WithoutDefault<T[K]>;
};

/**
 * Builds the PATCH counterpart of a create schema: every field optional, and
 * **no field able to invent a value the caller did not send**.
 *
 * Uses only zod's public surface — `.shape`, the exported `z.ZodDefault` class
 * and its documented `.unwrap()`. Nothing here reaches into `_def`/`_zod`, so a
 * zod upgrade cannot silently change the result.
 *
 * Everything except the default is preserved, because the inner schema is
 * reused by reference rather than rebuilt: `min`/`max`, enums, uuid and email
 * checks, coercion, and field-level `.transform()`/`.refine()` all still run on
 * a value the caller *does* send. Only the "what if it is missing" answer
 * changes — from "substitute the default" to "leave it out".
 *
 * The result is still a `ZodObject`, so callers can keep chaining `.omit()`.
 */
export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ]),
  ) as WithoutDefaults<T>;

  return z.object(shape).partial();
}

/**
 * Marks a field as **not accepted on this route** — BUG-020.
 *
 * A create schema is the single source of truth for a resource's fields, but a
 * few of those fields belong to a different endpoint once the record exists.
 * `PATCH /api/users/:id` is the case this exists for: `bankIds` and `teamId`
 * are many-to-many relationships owned by `PUT /api/users/:id/banks` and
 * `PUT /api/teams/:id/members`, and the PATCH handler used to parse both and
 * then silently drop them — a 200 that changed nothing.
 *
 * Combine with `patchSchema`:
 *
 * ```ts
 * patchSchema(userInput).extend({
 *   bankIds: notOnThisRoute("Bank access is managed through PUT /api/users/:id/banks"),
 * })
 * ```
 *
 * Behaviour, verified against zod 4.4.3:
 *   - the key **absent** parses cleanly and stays absent, so an ordinary PATCH
 *     is completely unaffected;
 *   - the key **present** raises a `ZodError` whose `path` is the field name and
 *     whose message is the pointer below, which `middleware/error-handler.ts`
 *     already turns into `422 validation_failed` — no error-handler change, so
 *     D-021 is respected;
 *   - **unknown** keys are still stripped rather than rejected, so this changes
 *     nothing for any field other than the ones it is applied to.
 *
 * `z.never()` rather than `.strict()` on purpose: `.strict()` would reject every
 * unrecognised key across the route and report `path: ""`, naming the offending
 * field only inside the message.
 */
export const notOnThisRoute = (message: string) => z.never({ error: message }).optional();
