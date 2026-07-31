import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { intersectAccountIds } from "../analytics/utils/trendsFilters.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

export const personalTrendsCategoryMovers = authorizedProcedure
    .input(
        z.object({
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
            /* Explicit comparison-window start (ends at `periodStart`).
               See space-scoped twin for why equal-duration subtraction
               misses calendar boundaries. */
            prevStart: z.coerce.date().optional(),
            limit: z.number().int().min(1).max(50).default(10),
            /* Personal trends only supports account filtering — see
               daily-comparison twin for the rationale. */
            accountIds: z.array(z.string().uuid()).max(200).optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                const ownedAll = await resolveOwnedAccountIds(ctx.services.qb, ctx.auth.user.id);
                const owned = intersectAccountIds(ownedAll, input.accountIds);
                const memberSpaces = await resolveMemberSpaceIds(ctx.services.qb, ctx.auth.user.id);
                /* Response shape matches the space-scoped twin so the
                   frontend renders both via a single code path. Personal
                   can never enter drill-in mode (no category filter),
                   so `mode` is always "standard". */
                if (owned.length === 0 || memberSpaces.length === 0) {
                    return {
                        mode: "standard" as const,
                        drillRootCategoryId: null as string | null,
                        items: [],
                    };
                }

                const durationMs = input.periodEnd.getTime() - input.periodStart.getTime();
                const prevStart =
                    input.prevStart ?? new Date(input.periodStart.getTime() - durationMs);

                const rows = await sql<{
                    id: string;
                    name: string;
                    color: string;
                    icon: string;
                    cur: string;
                    prv: string;
                }>`
                    WITH RECURSIVE roots_all AS (
                        /* Every category mapped to its top-level ancestor so a
                           parent's movement includes what's tagged beneath it
                           — see space-scoped twin. Unscoped by space for the
                           same reason it is there: in-scope rows can carry a
                           category from any space the user belongs to, and
                           parent_id never crosses spaces. */
                        SELECT id, id AS root_id, ARRAY[id]::uuid[] AS path
                        FROM expense_categories
                        WHERE parent_id IS NULL
                        UNION ALL
                        SELECT ec.id, r.root_id, r.path || ec.id
                        FROM expense_categories ec
                        JOIN roots_all r ON ec.parent_id = r.id
                        WHERE NOT (ec.id = ANY(r.path))
                    ),
                    roots AS (
                        SELECT DISTINCT ON (id) id, root_id
                        FROM roots_all
                        ORDER BY id, array_length(path, 1)
                    ),
                    spending AS (
                        SELECT
                            COALESCE(r.root_id, t.expense_category_id) AS category_id,
                            t.amount,
                            t.transaction_datetime AS dt
                        FROM transactions t
                        LEFT JOIN roots r ON r.id = t.expense_category_id
                        WHERE t.type = 'expense'
                          AND t.space_id = ANY(${memberSpaces})
                          AND t.source_account_id = ANY(${owned})
                          AND t.expense_category_id IS NOT NULL
                          AND t.transaction_datetime >= ${prevStart}
                          AND t.transaction_datetime < ${input.periodEnd}
                    )
                    SELECT
                        ec.id::text AS id,
                        ec.name,
                        ec.color,
                        ec.icon,
                        COALESCE(SUM(CASE WHEN s.dt >= ${input.periodStart} THEN s.amount ELSE 0 END), 0)::text AS cur,
                        COALESCE(SUM(CASE WHEN s.dt < ${input.periodStart} THEN s.amount ELSE 0 END), 0)::text AS prv
                    FROM spending s
                    JOIN expense_categories ec ON ec.id = s.category_id
                    GROUP BY ec.id, ec.name, ec.color, ec.icon
                `.execute(ctx.services.qb);

                const items = rows.rows.map((r) => {
                    const cur = Number(r.cur);
                    const prv = Number(r.prv);
                    const deltaAmount = cur - prv;
                    const deltaPct = prv === 0 ? (cur > 0 ? 1 : 0) : (cur - prv) / prv;
                    return {
                        categoryId: r.id,
                        name: r.name,
                        color: r.color,
                        icon: r.icon,
                        currentTotal: cur,
                        previousTotal: prv,
                        deltaAmount,
                        deltaPct,
                    };
                });
                items.sort((a, b) => Math.abs(b.deltaAmount) - Math.abs(a.deltaAmount));
                return {
                    mode: "standard" as const,
                    drillRootCategoryId: null as string | null,
                    items: items.slice(0, input.limit),
                };
            })()
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute personal trends category movers",
            });
        }
        return result;
    });
