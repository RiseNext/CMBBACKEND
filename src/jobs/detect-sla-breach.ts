import { and, asc, isNull, notInArray, sql } from "drizzle-orm";
import { bankOrders } from "../db/schema/index.js";
import { emit, loanAudience } from "../services/notifications.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./types.js";

/**
 * SLA BREACH DETECTION — Task 15.9, and the row D-077 deferred here.
 *
 * `bank_orders.sla` has had a column and its own index since the first
 * migration, and **no query in the system reads it**. An order can sit past its
 * committed turnaround indefinitely and nothing anywhere says so — not the
 * Kanban board, not the dashboard, not a notification. The one thing an SLA
 * column is for is the one thing that never happened.
 *
 * ── THE RECIPIENT RULE, WHICH IS WHAT D-077 ACTUALLY DEFERRED ───────────────
 *
 * D-077 recorded that the notification fan-out was resolvable from existing
 * columns for every event *except* this one, whose audience was genuinely
 * undefined, and sent the question here. The answer:
 *
 *   **the people already accountable for the file** — the loan's
 *   `assigned_user_id` and its `created_by`, which is exactly `loanAudience`,
 *   the same rule every other loan-shaped event uses.
 *
 * Deliberately **not** a broadcast to managers or an escalation ladder. Neither
 * appears in any requirement, both need an org model this system does not have
 * (`team_members` is consulted by no authorization or routing decision), and an
 * SLA alert that goes to forty people is an SLA alert that everyone mutes. If
 * the client wants escalation, that is a decision with a recipient rule
 * attached, and it should arrive as one rather than be guessed at here.
 *
 * ── IDEMPOTENCE IS THE DATABASE'S JOB, NOT A FLAG COLUMN ────────────────────
 *
 * This job runs hourly and a breach persists until somebody clears the order,
 * so the naive version re-notifies every hour forever. The obvious fix is a
 * `sla_notified_at` column — a schema change, and one that then needs resetting
 * whenever the SLA is edited.
 *
 * Migration `0011` already solved this. `notifications` carries a partial
 * unique index on `(user_id, event_key)`, and `emit` inserts with
 * `onConflictDoNothing`. The event key here has **no discriminator**, so it is
 * constant for a given order: the first run notifies, and every subsequent run
 * inserts nothing. No column, no flag, no reset logic, and the guarantee is the
 * index's rather than the application's (D-027).
 *
 * The consequence is stated rather than hidden: **a given person is told once
 * per bank order, ever.** Extending the SLA and breaching it again produces no
 * second notification. That is the right default for an alert whose failure
 * mode is being ignored, and changing it means choosing a discriminator — the
 * breach date, say — which is a product decision, not an oversight.
 */

/** Statuses at which an order is finished and can no longer breach. */
const TERMINAL_STATUSES = ["Cleared", "Returned"];

export const detectSlaBreach: Job = {
  name: "detect-sla-breach",
  description:
    "Notifies the people accountable for a bank order whose SLA has elapsed while the order is still live.",
  defaultLimit: 500,

  async run({ db, limit, dryRun }) {
    const breached = await db
      .select({
        id: bankOrders.id,
        code: bankOrders.code,
        loanId: bankOrders.loanId,
        bankId: bankOrders.bankId,
        stage: bankOrders.stage,
        createdBy: bankOrders.createdBy,
      })
      .from(bankOrders)
      .where(
        and(
          isNull(bankOrders.deletedAt),
          sql`${bankOrders.sla} is not null`,
          sql`${bankOrders.sla} < now()`,
          notInArray(bankOrders.status, TERMINAL_STATUSES),
        ),
      )
      .orderBy(asc(bankOrders.sla))
      .limit(limit);

    if (dryRun) {
      return { processed: 0, failed: 0, details: { breached: breached.length, dryRun: "true" } };
    }

    let processed = 0;
    let failed = 0;
    let notified = 0;

    for (const order of breached) {
      try {
        const recipients = [...(await loanAudience(db, order.loanId)), order.createdBy];
        // Nobody to tell is not a failure. An order whose loan has no assignee
        // and no surviving creator is a data state, not an error.
        if (recipients.filter(Boolean).length === 0) {
          processed += 1;
          continue;
        }

        await db.transaction(async (tx) => {
          await emit(tx, null, {
            event: "bank_order.sla_breached",
            recipients,
            title: `SLA elapsed on ${order.code}`,
            message: `${order.code} is still at ${order.stage} and has passed its committed turnaround.`,
            severity: "warning",
            recordType: "bank_order",
            recordId: order.id,
            linkHref: `/bank-orders?focus=${order.id}`,
          });
        });

        notified += recipients.filter(Boolean).length;
        processed += 1;
      } catch (error) {
        failed += 1;
        logger.error(
          { err: error, bankOrderId: order.id },
          "Failed to raise an SLA-breach notification; the next run will retry",
        );
      }
    }

    return {
      processed,
      failed,
      // `notified` counts recipients ATTEMPTED, not rows written — the unique
      // index suppresses repeats, and reporting suppressed inserts as delivered
      // notifications would be a count that lies (D-004).
      details: { breached: breached.length, recipientsAttempted: notified },
    };
  },
};

export const SLA_TERMINAL_STATUSES = TERMINAL_STATUSES;
