import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { intersectAccountIds } from "../analytics/utils/trendsFilters.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

/**
 * Flat category list across every space the caller is a member of, with
 * `directTotal` and `subtreeTotal` summed over expenses paid out of the
 * caller's owned accounts only. Each row carries `spaceId` / `spaceName`
 * so the consumer can group by space before building trees (categories
 * are space-scoped; a parent_id only makes sense within one space).
 */
export const personalCategoryBreakdown = authorizedProcedure
    .input(
        z.object({
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
            /* Only the account filter is meaningful on `/s/me` —
               envelopes/categories are space-scoped and hidden there. */
            accountIds: z.array(z.string().uuid()).max(200).optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                const owned = await resolveOwnedAccountIds(ctx.services.qb, ctx.auth.user.id);
                const memberSpaces = await resolveMemberSpaceIds(ctx.services.qb, ctx.auth.user.id);
                if (memberSpaces.length === 0) return [];

                /* Narrow to the user-picked accounts (intersected with
                   owned). When the intersection is empty, `= ANY('{}')`
                   yields zero spend — categories still return with zero
                   totals, which is the correct "nothing matched" view. */
                const scopedAccounts = intersectAccountIds(owned, input.accountIds);

                const query = sql<{
                    id: string;
                    parent_id: string | null;
                    name: string;
                    color: string;
                    icon: string;
                    space_id: string;
                    space_name: string;
                    direct_total: string;
                    subtree_total: string;
                }>`
                    WITH RECURSIVE tree AS (
                        SELECT id, parent_id, id AS root, space_id
                        FROM expense_categories
                        WHERE space_id = ANY(${memberSpaces})
                        UNION ALL
                        SELECT ec.id, ec.parent_id, t.root, ec.space_id
                        FROM expense_categories ec
                        JOIN tree t ON ec.parent_id = t.id
                        WHERE ec.space_id = ANY(${memberSpaces})
                    ),
                    spending_rows AS (
                        SELECT expense_category_id AS id, amount
                        FROM transactions
                        WHERE space_id = ANY(${memberSpaces})
                          AND type = 'expense'
                          AND expense_category_id IS NOT NULL
                          AND source_account_id = ANY(${scopedAccounts})
                          AND transaction_datetime >= ${input.periodStart}
                          AND transaction_datetime < ${input.periodEnd}
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
                        ec.space_id::text,
                        s.name AS space_name,
                        COALESCE(sp.total, 0)::text AS direct_total,
                        COALESCE((
                            SELECT SUM(ss.total)
                            FROM spends ss
                            JOIN tree t ON t.id = ss.id
                            WHERE t.root = ec.id
                        ), 0)::text AS subtree_total
                    FROM expense_categories ec
                    JOIN spaces s ON s.id = ec.space_id
                    LEFT JOIN spends sp ON sp.id = ec.id
                    WHERE ec.space_id = ANY(${memberSpaces})
                    ORDER BY s.name ASC, ec.created_at ASC
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
                    directTotal: Number(r.direct_total),
                    subtreeTotal: Number(r.subtree_total),
                }));
            })()
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute personal category breakdown",
            });
        }
        return result;
    });
