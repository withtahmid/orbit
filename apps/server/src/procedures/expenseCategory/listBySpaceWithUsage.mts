import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";

/**
 * Like `listBySpace` but attaches per-category usage stats (transaction
 * count, total spent, last-used timestamp) for a given period. Powers the
 * Categories page's inline stats and "Unused" indicator. Transfer-fee
 * rollup matches `analytics.categoryBreakdown` so numbers agree across
 * the two views.
 *
 * `periodStart` / `periodEnd` are optional; when omitted, stats are
 * computed over the full transaction history.
 */
export const listExpenseCategoriesBySpaceWithUsage = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            periodStart: z.coerce.date().optional(),
            periodEnd: z.coerce.date().optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                await resolveSpaceMembership({
                    trx: ctx.services.qb,
                    spaceId: input.spaceId,
                    userId: ctx.auth.user.id,
                    roles: ["owner", "editor", "viewer"] as unknown as SpaceMembers["role"][],
                });

                const start = input.periodStart ?? null;
                const end = input.periodEnd ?? null;

                const query = sql<{
                    id: string;
                    space_id: string;
                    parent_id: string | null;
                    name: string;
                    color: string;
                    icon: string;
                    priority: string | null;
                    created_at: Date;
                    updated_at: Date;
                    tx_count: number;
                    spent_total: string;
                    last_used: Date | null;
                }>`
                    WITH spending_rows AS (
                        SELECT expense_category_id AS id, amount, transaction_datetime
                        FROM transactions
                        WHERE space_id = ${input.spaceId}
                          AND type = 'expense'
                          AND expense_category_id IS NOT NULL
                          AND (${start}::timestamptz IS NULL
                               OR transaction_datetime >= ${start}::timestamptz)
                          AND (${end}::timestamptz IS NULL
                               OR transaction_datetime <  ${end}::timestamptz)
                    ),
                    usage AS (
                        SELECT id,
                               COUNT(*)::int AS tx_count,
                               SUM(amount)   AS total,
                               MAX(transaction_datetime) AS last_used
                        FROM spending_rows
                        GROUP BY id
                    )
                    SELECT
                        ec.id::text,
                        ec.space_id::text,
                        ec.parent_id::text,
                        ec.name,
                        ec.color,
                        ec.icon,
                        ec.priority,
                        ec.created_at,
                        ec.updated_at,
                        COALESCE(u.tx_count, 0)::int AS tx_count,
                        COALESCE(u.total, 0)::text AS spent_total,
                        u.last_used
                    FROM expense_categories ec
                    LEFT JOIN usage u ON u.id = ec.id
                    WHERE ec.space_id = ${input.spaceId}
                    ORDER BY ec.created_at ASC
                `;

                const res = await query.execute(ctx.services.qb);
                return res.rows.map((r) => ({
                    id: r.id,
                    space_id: r.space_id,
                    parent_id: r.parent_id,
                    name: r.name,
                    color: r.color,
                    icon: r.icon,
                    priority: r.priority as
                        | "essential"
                        | "important"
                        | "discretionary"
                        | "luxury"
                        | null,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    tx_count: Number(r.tx_count),
                    spent_total: Number(r.spent_total),
                    last_used: r.last_used,
                }));
            })()
        );

        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to fetch expense categories with usage",
            });
        }

        return result ?? [];
    });
