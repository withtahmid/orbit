import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import type { SpaceMembers } from "../../db/kysely/types.mjs";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";
import {
    categoryFilterWhere,
    envelopeFilterWhere,
    scopeAccountsFilter,
    selectedCategoriesCTEClause,
    trendsFilterInputShape,
} from "./utils/trendsFilters.mjs";

/**
 * Monthly time series behind `categoryBreakdown` — same filter shape, same
 * full-tree-every-time contract (one row per category per calendar month
 * in range, zero-filled), so the Categories analytics page's trend chart
 * can slice it with the exact same `focus`/`rootRows`/`childrenByParent`
 * client logic it already uses for the donut, and always agree with it.
 *
 * Bucketing is calendar months over `[periodStart, periodEnd)` — the same
 * exclusive-end convention every other period-scoped procedure uses.
 */
export const categoryMonthlyTrend = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
            ...trendsFilterInputShape,
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

                const catCTE = selectedCategoriesCTEClause(input.categoryIds, [input.spaceId]);
                const catWhere = categoryFilterWhere(input.categoryIds);
                const envWhere = envelopeFilterWhere(input.envelopeIds);
                const acctScope = scopeAccountsFilter(input.accountIds);

                const query = sql<{
                    id: string;
                    parent_id: string | null;
                    name: string;
                    color: string;
                    icon: string;
                    month: string;
                    direct_total: string;
                    subtree_total: string;
                }>`
                    WITH RECURSIVE ${catCTE}
                    tree AS (
                        -- \`path\` guards against a parent_id cycle (the DB has
                        -- no cycle constraint and \`changeParent\` only forbids
                        -- self-parenting) — without it a cyclic A→B→A chain
                        -- would spin this recursion until statement_timeout.
                        SELECT id, parent_id, id AS root, ARRAY[id]::uuid[] AS path
                        FROM expense_categories
                        WHERE space_id = ${input.spaceId}
                        UNION ALL
                        SELECT ec.id, ec.parent_id, t.root, t.path || ec.id
                        FROM expense_categories ec
                        JOIN tree t ON ec.parent_id = t.id
                        WHERE NOT (ec.id = ANY(t.path))
                    ),
                    scope_accounts AS (
                        SELECT account_id
                        FROM space_accounts
                        WHERE space_id = ${input.spaceId}
                        ${acctScope}
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
                            t.expense_category_id AS id,
                            date_trunc('month', t.transaction_datetime)::date AS month,
                            t.amount
                        FROM transactions t
                        WHERE t.space_id = ${input.spaceId}
                          AND t.type = 'expense'
                          AND t.expense_category_id IS NOT NULL
                          AND t.transaction_datetime >= ${input.periodStart}
                          AND t.transaction_datetime < ${input.periodEnd}
                          AND t.source_account_id IN (SELECT account_id FROM scope_accounts)
                          ${envWhere}
                          ${catWhere}
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
                        mo.month::text,
                        COALESCE(s.total, 0)::text AS direct_total,
                        COALESCE((
                            SELECT SUM(ss.total)
                            FROM spends ss
                            JOIN tree t ON t.id = ss.id
                            WHERE t.root = ec.id AND ss.month = mo.month
                        ), 0)::text AS subtree_total
                    FROM expense_categories ec
                    CROSS JOIN months mo
                    LEFT JOIN spends s ON s.id = ec.id AND s.month = mo.month
                    WHERE ec.space_id = ${input.spaceId}
                    ORDER BY ec.created_at ASC, mo.month ASC
                `;
                const res = await query.execute(trx);
                return res.rows.map((r) => ({
                    id: r.id,
                    parentId: r.parent_id,
                    name: r.name,
                    color: r.color,
                    icon: r.icon,
                    month: r.month,
                    directTotal: Number(r.direct_total),
                    subtreeTotal: Number(r.subtree_total),
                }));
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute category monthly trend",
            });
        }
        return result;
    });
