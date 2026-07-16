import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { intersectAccountIds } from "../analytics/utils/trendsFilters.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

/**
 * Monthly time series behind `personalCategoryBreakdown` — same shape and
 * caveats (categories are space-scoped, so rows carry `spaceId`/`spaceName`
 * rather than being merged into one cross-space tree), bucketed by
 * calendar month over `[periodStart, periodEnd)`.
 */
export const personalCategoryMonthlyTrend = authorizedProcedure
    .input(
        z.object({
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
            accountIds: z.array(z.string().uuid()).max(200).optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                const owned = await resolveOwnedAccountIds(ctx.services.qb, ctx.auth.user.id);
                const memberSpaces = await resolveMemberSpaceIds(ctx.services.qb, ctx.auth.user.id);
                if (memberSpaces.length === 0) return [];

                const scopedAccounts = intersectAccountIds(owned, input.accountIds);

                const query = sql<{
                    id: string;
                    parent_id: string | null;
                    name: string;
                    color: string;
                    icon: string;
                    space_id: string;
                    space_name: string;
                    month: string;
                    direct_total: string;
                    subtree_total: string;
                }>`
                    WITH RECURSIVE tree AS (
                        -- \`path\` guards against a parent_id cycle (the DB has
                        -- no cycle constraint and \`changeParent\` only forbids
                        -- self-parenting) — without it a cyclic A→B→A chain
                        -- would spin this recursion until statement_timeout.
                        SELECT id, parent_id, id AS root, space_id, ARRAY[id]::uuid[] AS path
                        FROM expense_categories
                        WHERE space_id = ANY(${memberSpaces})
                        UNION ALL
                        SELECT ec.id, ec.parent_id, t.root, ec.space_id, t.path || ec.id
                        FROM expense_categories ec
                        JOIN tree t ON ec.parent_id = t.id
                        WHERE ec.space_id = ANY(${memberSpaces})
                          AND NOT (ec.id = ANY(t.path))
                    ),
                    months AS (
                        SELECT generate_series(
                            date_trunc('month', ${input.periodStart}::timestamptz),
                            date_trunc('month', ${input.periodEnd}::timestamptz - interval '1 second'),
                            interval '1 month'
                        )::date AS month
                    ),
                    spending_rows AS (
                        SELECT
                            expense_category_id AS id,
                            date_trunc('month', transaction_datetime)::date AS month,
                            amount
                        FROM transactions
                        WHERE space_id = ANY(${memberSpaces})
                          AND type = 'expense'
                          AND expense_category_id IS NOT NULL
                          AND source_account_id = ANY(${scopedAccounts})
                          AND transaction_datetime >= ${input.periodStart}
                          AND transaction_datetime < ${input.periodEnd}
                    ),
                    spends AS (
                        SELECT id, month, SUM(amount) AS total
                        FROM spending_rows
                        GROUP BY id, month
                    )
                    SELECT
                        ec.id::text,
                        ec.parent_id::text,
                        ec.name,
                        ec.color,
                        ec.icon,
                        ec.space_id::text,
                        s.name AS space_name,
                        mo.month::text,
                        COALESCE(sp.total, 0)::text AS direct_total,
                        COALESCE((
                            SELECT SUM(ss.total)
                            FROM spends ss
                            JOIN tree t ON t.id = ss.id
                            WHERE t.root = ec.id AND ss.month = mo.month
                        ), 0)::text AS subtree_total
                    FROM expense_categories ec
                    JOIN spaces s ON s.id = ec.space_id
                    CROSS JOIN months mo
                    LEFT JOIN spends sp ON sp.id = ec.id AND sp.month = mo.month
                    WHERE ec.space_id = ANY(${memberSpaces})
                    ORDER BY s.name ASC, ec.created_at ASC, mo.month ASC
                `;
                const res = await query.execute(ctx.services.qb);
                return res.rows.map((r) => ({
                    id: r.id,
                    parentId: r.parent_id,
                    name: r.name,
                    color: r.color,
                    icon: r.icon,
                    spaceId: r.space_id,
                    spaceName: r.space_name,
                    month: r.month,
                    directTotal: Number(r.direct_total),
                    subtreeTotal: Number(r.subtree_total),
                }));
            })()
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute personal category monthly trend",
            });
        }
        return result;
    });
