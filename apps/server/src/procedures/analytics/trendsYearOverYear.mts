import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { ALL_ROLES, resolveSpaceMembership } from "../space/utils/resolveSpaceMembership.mjs";
import {
    categoryFilterWhere,
    envelopeFilterWhere,
    scopeAccountsFilter,
    selectedCategoriesCTEClause,
    trendsFilterInputShape,
} from "./utils/trendsFilters.mjs";

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

/**
 * Trailing 12 months of monthly expense totals for `year` and `year-1`.
 * Months that haven't happened yet in `year` come back as null so the UI
 * can clip the line; otherwise the chart would dive to zero in the
 * future months.
 */
export const trendsYearOverYear = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            year: z.number().int().min(1970).max(9999).optional(),
            /**
             * Must match `trendsDailyComparison`'s mode or the two charts on
             * the Trends page disagree — the year-over-year bars are
             * click-through navigation, so a July bar showing cash-mode
             * spend that opens an operational-mode total reads as a bug.
             * See that proc for the mode semantics.
             */
            mode: z.enum(["cash", "operational"]).default("cash"),
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
                    roles: ALL_ROLES,
                });

                const now = new Date();
                /* Derived from the Zod enum, so no injection surface —
                   same pattern as cashFlow.mts / trendsDailyComparison. */
                const xferFactor = input.mode === "cash" ? 1 : 0;

                const catCTE = selectedCategoriesCTEClause(input.categoryIds, [input.spaceId]);
                const catWhere = categoryFilterWhere(input.categoryIds);
                const envWhere = envelopeFilterWhere(input.envelopeIds);
                const acctScope = scopeAccountsFilter(input.accountIds);

                /* Year/month split is done in SQL via EXTRACT against
                   the session timezone (Asia/Dhaka) so January doesn't
                   roll back to December of the prior year when read
                   through JS UTC fields. The bounds CTE also resolves
                   `year` against now's session-tz year, mirroring the
                   server's wall-clock view of "this year". */
                const rows = await sql<{
                    year: number;
                    month_idx: number;
                    expense: string;
                }>`
                    WITH RECURSIVE ${catCTE}
                    params AS (
                        SELECT
                            COALESCE(${input.year ?? null}::int,
                                EXTRACT(YEAR FROM ${now}::timestamptz)::int
                            ) AS yr
                    ),
                    bounds AS (
                        SELECT
                            (yr - 1)::text || '-01-01' AS y0,
                            (yr + 1)::text || '-01-01' AS y1,
                            yr
                        FROM params
                    ),
                    scope_accounts AS (
                        SELECT account_id
                        FROM space_accounts
                        WHERE space_id = ${input.spaceId}
                        ${acctScope}
                    )
                    SELECT
                        EXTRACT(YEAR FROM date_trunc('month', t.transaction_datetime))::int AS year,
                        (EXTRACT(MONTH FROM date_trunc('month', t.transaction_datetime))::int - 1) AS month_idx,
                        SUM(
                            CASE
                                WHEN t.type = 'expense'
                                    AND t.source_account_id IN (SELECT account_id FROM scope_accounts) THEN t.amount
                                WHEN t.type = 'transfer'
                                    AND t.source_account_id IN (SELECT account_id FROM scope_accounts)
                                    AND t.destination_account_id NOT IN (SELECT account_id FROM scope_accounts) THEN t.amount * ${xferFactor}
                                ELSE 0
                            END
                        )::text AS expense
                    FROM transactions t
                    WHERE t.transaction_datetime >= (SELECT y0::timestamptz FROM bounds)
                      AND t.transaction_datetime < (SELECT y1::timestamptz FROM bounds)
                      AND (
                          t.source_account_id IN (SELECT account_id FROM scope_accounts)
                          OR t.destination_account_id IN (SELECT account_id FROM scope_accounts)
                      )
                      ${envWhere}
                      ${catWhere}
                    GROUP BY 1, 2
                `.execute(trx);

                /* Resolve the active year via the session timezone too,
                   so the "current year" check that hides future months
                   matches the server's wall-clock view. */
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
                `.execute(trx);
                const year = yearRow.rows[0]?.yr ?? now.getFullYear();
                const curYear = yearRow.rows[0]?.cur_yr ?? year;
                const curMonth = yearRow.rows[0]?.cur_month ?? 12;

                const thisYear: (number | null)[] = new Array(12).fill(0);
                const lastYear: (number | null)[] = new Array(12).fill(0);

                /* Future months in `year` (when year === curYear) come
                   back null so the chart can clip the line. */
                if (year === curYear) {
                    for (let m = curMonth; m < 12; m++) {
                        thisYear[m] = null;
                    }
                }

                for (const r of rows.rows) {
                    if (r.year === year) thisYear[r.month_idx] = Number(r.expense);
                    else if (r.year === year - 1) lastYear[r.month_idx] = Number(r.expense);
                }

                return {
                    year,
                    months: MONTH_LABELS,
                    thisYear,
                    lastYear,
                };
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute trends year over year",
            });
        }
        return result;
    });
