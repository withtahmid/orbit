import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { intersectAccountIds } from "../analytics/utils/trendsFilters.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

/**
 * Daily spend totals across every space the caller is a member of,
 * restricted to accounts they personally own — the dataset for the
 * personal view's calendar heatmap.
 *
 * `mode` mirrors `personal/cashFlow.mts`'s own `cash`/`operational` split:
 * `cash` (default) counts expenses plus owned-outbound cross-space
 * transfer principal (a transfer to a space you don't own reduced your
 * personal cash); `operational` counts only true `type='expense'` debits.
 */
export const personalSpendingHeatmap = authorizedProcedure
    .input(
        z.object({
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
            /* Only the account filter is meaningful on `/s/me`. */
            accountIds: z.array(z.string().uuid()).max(200).optional(),
            mode: z.enum(["cash", "operational"]).default("cash"),
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
                /* Narrow to the user-picked accounts. An empty
                   intersection means the filter excludes every owned
                   account → nothing to show. */
                const scopedAccounts = intersectAccountIds(
                    owned,
                    input.accountIds
                );
                if (scopedAccounts.length === 0 || memberSpaces.length === 0)
                    return [];

                /* Transfer-principal branch is always emitted; its
                   contribution is multiplied by a 0/1 factor derived from
                   the Zod-validated `mode` enum — same convention as
                   `personal/cashFlow.mts`'s expense-side transfer branch. */
                const xferFactor = input.mode === "cash" ? 1 : 0;

                const query = sql<{ day: Date; total: string }>`
                    SELECT day, SUM(amount)::text AS total FROM (
                        SELECT date_trunc('day', transaction_datetime) AS day, amount
                        FROM transactions
                        WHERE space_id = ANY(${memberSpaces})
                          AND type = 'expense'
                          AND source_account_id = ANY(${scopedAccounts})
                          AND transaction_datetime >= ${input.periodStart}
                          AND transaction_datetime < ${input.periodEnd}
                        UNION ALL
                        SELECT date_trunc('day', transaction_datetime) AS day, amount * ${xferFactor} AS amount
                        FROM transactions
                        WHERE space_id = ANY(${memberSpaces})
                          AND type = 'transfer'
                          AND source_account_id = ANY(${scopedAccounts})
                          AND destination_account_id <> ALL(${owned})
                          AND transaction_datetime >= ${input.periodStart}
                          AND transaction_datetime < ${input.periodEnd}
                    ) entries
                    GROUP BY day
                    ORDER BY day ASC
                `;
                const res = await query.execute(ctx.services.qb);
                return res.rows.map((r) => ({
                    day: new Date(r.day),
                    total: Number(r.total),
                }));
            })()
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute personal spending heatmap",
            });
        }
        return result;
    });
