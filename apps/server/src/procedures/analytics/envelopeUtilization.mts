import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

/**
 * Per-envelope utilization for the given period window. One row per envelope.
 *
 *   - Monthly envelopes **reset** every period: `allocated`/`consumed` are
 *     scoped to the requested window; `remaining = allocated − consumed`.
 *   - Rolling/goal envelopes (cadence='none') are a single lifetime pool:
 *     `allocated` is the lifetime pool amount and `consumed` is lifetime
 *     spend, regardless of the requested window.
 *
 * Allocations are one row per (envelope, month) for monthly and one
 * NULL-period row for rolling/goal, holding the absolute allocated amount.
 */
export const envelopeUtilization = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            periodStart: z.coerce.date().optional(),
            periodEnd: z.coerce.date().optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            ctx.services.qb.transaction().execute(async (trx) => {
                await resolveSpaceMembership({
                    trx,
                    spaceId: input.spaceId,
                    userId: ctx.auth.user.id,
                    roles: ["owner", "editor", "viewer"] as unknown as SpaceMembers["role"][],
                });

                const EPOCH = new Date("1970-01-01");
                const periodStart = input.periodStart ?? EPOCH;
                const periodEnd = input.periodEnd ?? new Date("9999-12-31");

                const totalsQuery = sql<{
                    envelop_id: string;
                    name: string;
                    color: string;
                    icon: string;
                    description: string | null;
                    cadence: string;
                    archived: boolean;
                    target_amount: string | null;
                    target_date: Date | null;
                    first_allocated_at: Date | null;
                    last_allocated_at: Date | null;
                    lifetime_funded: string;
                    allocated: string;
                    consumed: string;
                    lifetime_overrun: string;
                }>`
                    SELECT
                        e.id::text AS envelop_id,
                        e.name,
                        e.color,
                        e.icon,
                        e.description,
                        e.cadence,
                        e.archived,
                        e.target_amount,
                        e.target_date,
                        (
                            SELECT MIN(a.created_at)
                            FROM envelop_allocations a
                            WHERE a.envelop_id = e.id
                        ) AS first_allocated_at,
                        (
                            SELECT MAX(a.created_at)
                            FROM envelop_allocations a
                            WHERE a.envelop_id = e.id
                        ) AS last_allocated_at,
                        -- Net allocated across all time: the goal-progress
                        -- numerator. Real spending lives in transactions and
                        -- never touches this sum, so a completed goal stays
                        -- completed once the user starts spending toward it.
                        COALESCE((
                            SELECT SUM(a.amount)
                            FROM envelop_allocations a
                            WHERE a.envelop_id = e.id
                        ), 0)::text AS lifetime_funded,
                        -- Allocated for the window. Monthly: sum the per-month
                        -- rows whose period_start lands in the window (one row
                        -- per month). Rolling/goal: the single NULL-period
                        -- lifetime pool row, window-independent.
                        COALESCE((
                            SELECT SUM(a.amount)
                            FROM envelop_allocations a
                            WHERE a.envelop_id = e.id
                              AND (
                                  (e.cadence = 'none' AND a.period_start IS NULL)
                                  OR (
                                      e.cadence <> 'none'
                                      AND a.period_start >= ${periodStart}::timestamptz::date
                                      AND a.period_start < ${periodEnd}::timestamptz::date
                                  )
                              )
                        ), 0)::text AS allocated,
                        -- Consumed: lifetime for rolling, period-scoped for monthly.
                        COALESCE((
                            SELECT SUM(t.amount)
                            FROM transactions t
                            WHERE t.envelop_id = e.id
                              AND t.type = 'expense'
                              AND (
                                  e.cadence = 'none'
                                  OR (
                                      t.transaction_datetime >= ${periodStart}
                                      AND t.transaction_datetime < ${periodEnd}
                                  )
                              )
                        ), 0)::text AS consumed,
                        -- Lifetime overrun: how far a rolling envelope is in
                        -- the red across all time (zero for monthly, which
                        -- reset each period). Surfaced as a positive number
                        -- when lifetime consumed > lifetime allocated.
                        CASE WHEN e.cadence = 'none' THEN
                            GREATEST(
                                0,
                                COALESCE((
                                    SELECT SUM(t.amount)
                                    FROM transactions t
                                    WHERE t.envelop_id = e.id AND t.type = 'expense'
                                ), 0)
                                -
                                COALESCE((
                                    SELECT SUM(a.amount)
                                    FROM envelop_allocations a
                                    WHERE a.envelop_id = e.id
                                ), 0)
                            )
                        ELSE 0 END::text AS lifetime_overrun
                    FROM envelops e
                    WHERE e.space_id = ${input.spaceId}
                    ORDER BY e.created_at ASC
                `;
                const totals = (await totalsQuery.execute(trx)).rows;

                return totals.map((t) => {
                    const allocated = Number(t.allocated);
                    const consumed = Number(t.consumed);
                    const remaining = allocated - consumed;
                    const targetAmount =
                        t.target_amount != null ? Number(t.target_amount) : null;
                    const lifetimeFunded = Number(t.lifetime_funded);
                    // pctSaved is the goal-progress signal: cumulative
                    // positive allocations over target, clamped to 100.
                    const pctSaved =
                        targetAmount != null && targetAmount > 0
                            ? Math.max(
                                  0,
                                  Math.min(100, (lifetimeFunded / targetAmount) * 100)
                              )
                            : null;
                    return {
                        envelopId: t.envelop_id,
                        name: t.name,
                        color: t.color,
                        icon: t.icon,
                        description: t.description,
                        cadence: t.cadence as "none" | "monthly",
                        archived: t.archived,
                        targetAmount,
                        targetDate: t.target_date,
                        lifetimeFunded,
                        pctSaved,
                        // Legacy alias retained for any reader still on
                        // the old name; new callers should read pctSaved.
                        pctComplete: pctSaved,
                        firstAllocatedAt: t.first_allocated_at,
                        lastAllocatedAt: t.last_allocated_at,
                        allocated,
                        consumed,
                        remaining,
                        // Lifetime overrun on rolling envelopes (zero for
                        // monthly). When > 0, the envelope has consumed more
                        // than it's allocated across all time.
                        lifetimeOverrun: Number(t.lifetime_overrun),
                        isDrift: remaining < 0,
                    };
                });
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute envelope utilization",
            });
        }
        return result;
    });
