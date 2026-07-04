import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

/**
 * Personal (cross-space) envelope utilization. Lists every envelope that
 * lives in a space the caller is a member of. Allocations are space-wide
 * (no per-account dimension), so `allocated` is the envelope's full
 * allocation; `consumed` is scoped to the caller's owned-account spend —
 * "my slice" of each envelope I participate in.
 *
 *   - Monthly envelopes reset each period; rolling/goal envelopes are a
 *     single lifetime pool. No carry-over. Mirrors analytics.envelopeUtilization.
 */
export const personalEnvelopeUtilization = authorizedProcedure
    .input(
        z.object({
            periodStart: z.coerce.date().optional(),
            periodEnd: z.coerce.date().optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                const owned = await resolveOwnedAccountIds(
                    ctx.services.qb,
                    ctx.auth.user.id
                );
                const memberSpaces = await resolveMemberSpaceIds(
                    ctx.services.qb,
                    ctx.auth.user.id
                );
                if (memberSpaces.length === 0) return [];

                const EPOCH = new Date("1970-01-01");
                const periodStart = input.periodStart ?? EPOCH;
                const periodEnd = input.periodEnd ?? new Date("9999-12-31");

                // A user with zero owned accounts has no personal slice
                // of any envelope's spend.
                if (owned.length === 0) return [];
                const ownedParam = owned;

                const totalsQuery = sql<{
                    envelop_id: string;
                    space_id: string;
                    space_name: string;
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
                        e.space_id::text AS space_id,
                        s.name AS space_name,
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
                        COALESCE((
                            SELECT SUM(a.amount)
                            FROM envelop_allocations a
                            WHERE a.envelop_id = e.id
                        ), 0)::text AS lifetime_funded,
                        -- Allocated for the window (space-wide). Monthly:
                        -- per-month rows in the window. Rolling/goal: the
                        -- single NULL-period lifetime pool row.
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
                        -- Consumed: owned-account spend only (the caller's
                        -- slice). Lifetime for rolling, period-scoped for monthly.
                        COALESCE((
                            SELECT SUM(t.amount)
                            FROM transactions t
                            WHERE t.envelop_id = e.id
                              AND t.type = 'expense'
                              AND t.source_account_id = ANY(${ownedParam})
                              AND (
                                  e.cadence = 'none'
                                  OR (
                                      t.transaction_datetime >= ${periodStart}
                                      AND t.transaction_datetime < ${periodEnd}
                                  )
                              )
                        ), 0)::text AS consumed,
                        -- Lifetime overrun on rolling envelopes (owned-account
                        -- spend vs full allocation). Zero for monthly.
                        CASE WHEN e.cadence = 'none' THEN
                            GREATEST(
                                0,
                                COALESCE((
                                    SELECT SUM(t.amount)
                                    FROM transactions t
                                    WHERE t.envelop_id = e.id
                                      AND t.type = 'expense'
                                      AND t.source_account_id = ANY(${ownedParam})
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
                    JOIN spaces s ON s.id = e.space_id
                    WHERE e.space_id = ANY(${memberSpaces})
                    ORDER BY s.name ASC, e.created_at ASC
                `;
                const totals = (await totalsQuery.execute(ctx.services.qb)).rows;

                return totals.map((t) => {
                    const allocated = Number(t.allocated);
                    const consumed = Number(t.consumed);
                    const remaining = allocated - consumed;
                    const targetAmount =
                        t.target_amount != null ? Number(t.target_amount) : null;
                    const lifetimeFunded = Number(t.lifetime_funded);
                    const pctSaved =
                        targetAmount != null && targetAmount > 0
                            ? Math.max(
                                  0,
                                  Math.min(100, (lifetimeFunded / targetAmount) * 100)
                              )
                            : null;
                    return {
                        envelopId: t.envelop_id,
                        spaceId: t.space_id,
                        spaceName: t.space_name,
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
                        pctComplete: pctSaved,
                        firstAllocatedAt: t.first_allocated_at,
                        lastAllocatedAt: t.last_allocated_at,
                        allocated,
                        consumed,
                        remaining,
                        lifetimeOverrun: Number(t.lifetime_overrun),
                        isDrift: remaining < 0,
                    };
                });
            })()
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute personal envelope utilization",
            });
        }
        return result;
    });
