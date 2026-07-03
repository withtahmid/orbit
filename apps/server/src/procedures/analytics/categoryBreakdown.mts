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

export const categoryBreakdown = authorizedProcedure
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

                /* Filter fragments — empty when the corresponding filter
                   isn't active so the unfiltered query reads cleanly.
                   The `t.` alias on `spending_rows.transactions` is what
                   lets the envelope/category fragments splice in. */
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
                    direct_total: string;
                    subtree_total: string;
                }>`
                    WITH RECURSIVE ${catCTE}
                    tree AS (
                        SELECT id, parent_id, id AS root
                        FROM expense_categories
                        WHERE space_id = ${input.spaceId}
                        UNION ALL
                        SELECT ec.id, ec.parent_id, t.root
                        FROM expense_categories ec
                        JOIN tree t ON ec.parent_id = t.id
                    ),
                    scope_accounts AS (
                        SELECT account_id
                        FROM space_accounts
                        WHERE space_id = ${input.spaceId}
                        ${acctScope}
                    ),
                    spending_rows AS (
                        SELECT t.expense_category_id AS id, t.amount
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
                        SELECT id, SUM(amount) AS total
                        FROM spending_rows
                        GROUP BY id
                    )
                    SELECT
                        ec.id::text,
                        ec.parent_id::text,
                        ec.name,
                        ec.color,
                        ec.icon,
                        COALESCE(s.total, 0)::text AS direct_total,
                        COALESCE((
                            SELECT SUM(ss.total)
                            FROM spends ss
                            JOIN tree t ON t.id = ss.id
                            WHERE t.root = ec.id
                        ), 0)::text AS subtree_total
                    FROM expense_categories ec
                    LEFT JOIN spends s ON s.id = ec.id
                    WHERE ec.space_id = ${input.spaceId}
                    ORDER BY ec.created_at ASC
                `;
                const res = await query.execute(trx);
                return res.rows.map((r) => ({
                    id: r.id,
                    parentId: r.parent_id,
                    name: r.name,
                    color: r.color,
                    icon: r.icon,
                    directTotal: Number(r.direct_total),
                    subtreeTotal: Number(r.subtree_total),
                }));
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute category breakdown",
            });
        }
        return result;
    });
