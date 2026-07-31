import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { intersectAccountIds } from "../analytics/utils/trendsFilters.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

const MONTH_LABELS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

export const personalTrendsYearOverYear = authorizedProcedure
    .input(
        z.object({
            year: z.number().int().min(1970).max(9999).optional(),
            /* Must match the daily-comparison mode — see space-scoped twin. */
            mode: z.enum(["cash", "operational"]).default("cash"),
            /* Personal trends only supports account filtering — see
               daily-comparison twin for the rationale. */
            accountIds: z.array(z.string().uuid()).max(200).optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                /* Year/month split is done in SQL via EXTRACT against
                   the session timezone — see space-scoped twin for
                   full TZ commentary. */
                const [ownedAll, memberSpaces] = await Promise.all([
                    resolveOwnedAccountIds(ctx.services.qb, ctx.auth.user.id),
                    resolveMemberSpaceIds(ctx.services.qb, ctx.auth.user.id),
                ]);
                const owned = intersectAccountIds(ownedAll, input.accountIds);
                /* Derived from the Zod enum — no injection surface. */
                const xferFactor = input.mode === "cash" ? 1 : 0;

                const now = new Date();
                const yearRow = await sql<{
                    yr: number;
                    cur_yr: number;
                    cur_month: number;
                }>`
                    SELECT
                        COALESCE(${input.year ?? null}::int,
                            EXTRACT(YEAR FROM ${now}::timestamptz)::int
                        ) AS yr,
                        EXTRACT(YEAR FROM ${now}::timestamptz)::int AS cur_yr,
                        EXTRACT(MONTH FROM ${now}::timestamptz)::int AS cur_month
                `.execute(ctx.services.qb);
                const year = yearRow.rows[0]?.yr ?? now.getFullYear();
                const curYear = yearRow.rows[0]?.cur_yr ?? year;
                const curMonth = yearRow.rows[0]?.cur_month ?? 12;

                const thisYear: (number | null)[] = new Array(12).fill(0);
                const lastYear: (number | null)[] = new Array(12).fill(0);
                if (year === curYear) {
                    for (let m = curMonth; m < 12; m++) {
                        thisYear[m] = null;
                    }
                }

                if (owned.length === 0 || memberSpaces.length === 0) {
                    return { year, months: MONTH_LABELS, thisYear, lastYear };
                }

                const rows = await sql<{
                    year: number;
                    month_idx: number;
                    expense: string;
                }>`
                    WITH bounds AS (
                        SELECT
                            (${year} - 1)::text || '-01-01' AS y0,
                            (${year} + 1)::text || '-01-01' AS y1
                    )
                    SELECT
                        EXTRACT(YEAR FROM date_trunc('month', t.transaction_datetime))::int AS year,
                        (EXTRACT(MONTH FROM date_trunc('month', t.transaction_datetime))::int - 1) AS month_idx,
                        SUM(
                            CASE
                                WHEN t.type = 'expense'
                                    AND t.source_account_id = ANY(${owned}) THEN t.amount
                                WHEN t.type = 'transfer'
                                    AND t.source_account_id = ANY(${owned})
                                    AND t.destination_account_id <> ALL(${owned}) THEN t.amount * ${xferFactor}
                                ELSE 0
                            END
                        )::text AS expense
                    FROM transactions t
                    WHERE t.space_id = ANY(${memberSpaces})
                      AND t.transaction_datetime >= (SELECT y0::timestamptz FROM bounds)
                      AND t.transaction_datetime < (SELECT y1::timestamptz FROM bounds)
                      AND (
                          t.source_account_id = ANY(${owned})
                          OR t.destination_account_id = ANY(${owned})
                      )
                    GROUP BY 1, 2
                `.execute(ctx.services.qb);

                for (const r of rows.rows) {
                    if (r.year === year) thisYear[r.month_idx] = Number(r.expense);
                    else if (r.year === year - 1) lastYear[r.month_idx] = Number(r.expense);
                }

                return { year, months: MONTH_LABELS, thisYear, lastYear };
            })()
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute personal trends year over year",
            });
        }
        return result;
    });
