import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { authorizedProcedure } from "../../trpc/middlewares/authorized.mjs";
import { safeAwait } from "../../utils/safeAwait.mjs";
import { intersectAccountIds } from "../analytics/utils/trendsFilters.mjs";
import { resolveMemberSpaceIds, resolveOwnedAccountIds } from "./shared.mjs";

const granularitySchema = z.enum(["week", "month", "quarter", "year"]);
type Granularity = z.infer<typeof granularitySchema>;

/* See space-scoped procedure for why every granularity (including
 * year) uses day buckets. */
const GRANULARITY_CONFIG: Record<
    Granularity,
    {
        periodInterval: string;
        bucketInterval: string;
        bucketUnit: "day" | "week" | "month";
        bucketDays: number;
    }
> = {
    week: { periodInterval: "1 week", bucketInterval: "1 day", bucketUnit: "day", bucketDays: 1 },
    month: { periodInterval: "1 month", bucketInterval: "1 day", bucketUnit: "day", bucketDays: 1 },
    quarter: {
        periodInterval: "3 months",
        bucketInterval: "1 day",
        bucketUnit: "day",
        bucketDays: 1,
    },
    year: { periodInterval: "1 year", bucketInterval: "1 day", bucketUnit: "day", bucketDays: 1 },
};

/**
 * Personal twin of `analytics.trendsDailyComparison`. Same shape; scoped
 * to expenses out of the caller's owned accounts across every space they
 * are a member of. See the space-scoped procedure for the full
 * commentary on bounds-in-SQL and the per-position `average` field.
 */
export const personalTrendsDailyComparison = authorizedProcedure
    .input(
        z.object({
            anchor: z.coerce.date().optional(),
            granularity: granularitySchema.default("month"),
            /** See space-scoped procedure. `cash` (default) counts
             *  cross-space outbound transfer principal as outflow;
             *  `operational` excludes it. Internal owned-to-owned
             *  transfers are always excluded regardless of mode. */
            mode: z.enum(["cash", "operational"]).default("cash"),
            /* Personal trends only supports account filtering: envelope
               and category filtering doesn't make sense across spaces
               (they are space-scoped and rolling them up cross-space
               would be misleading). The web UI hides the other two
               filter buttons on `/s/me`. */
            accountIds: z.array(z.string().uuid()).max(200).optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const [error, result] = await safeAwait(
            (async () => {
                const ownedAll = await resolveOwnedAccountIds(ctx.services.qb, ctx.auth.user.id);
                const owned = intersectAccountIds(ownedAll, input.accountIds);
                const memberSpaces = await resolveMemberSpaceIds(ctx.services.qb, ctx.auth.user.id);

                const cfg = GRANULARITY_CONFIG[input.granularity];
                const anchor = input.anchor ?? new Date();
                const xferFactor = input.mode === "cash" ? 1 : 0;

                const empty = {
                    granularity: input.granularity,
                    bucketUnit: cfg.bucketUnit,
                    bucketDays: cfg.bucketDays,
                    periodLength: 1,
                    today: 1,
                    current: [0],
                    /* Empty, matching previousLength — every other path holds
                       `previous.length === previousLength`. */
                    previous: [] as number[],
                    previousLength: 0,
                    previousTotal: 0,
                    average: null as number[] | null,
                    averagePeriods: 0,
                    historyStart: null as Date | null,
                };
                if (owned.length === 0 || memberSpaces.length === 0) return empty;

                const rows = await sql<{
                    kind: "cur" | "prev" | "avg";
                    idx: number;
                    expense: string;
                    today_bucket: number;
                    period_length: number;
                    history_start: Date | null;
                    avg_periods: number;
                }>`
                    WITH params AS (
                        SELECT ${anchor}::timestamptz AS anchor_ts
                    ),
                    bounds AS (
                        SELECT
                            date_trunc(${input.granularity}, anchor_ts) AS cur_start,
                            date_trunc(${input.granularity}, anchor_ts)
                                + ${sql.raw(`'${cfg.periodInterval}'::interval`)} AS cur_end,
                            date_trunc(${input.granularity}, anchor_ts)
                                - ${sql.raw(`'${cfg.periodInterval}'::interval`)} AS prev_start,
                            /* See space-scoped twin: the anchor selects which
                               period, the real clock decides how much of it
                               has elapsed, saturating at the final bucket
                               so completed periods come back whole. */
                            LEAST(
                                NOW(),
                                date_trunc(${input.granularity}, anchor_ts)
                                    + ${sql.raw(`'${cfg.periodInterval}'::interval`)}
                                    - ${sql.raw(`'${cfg.bucketInterval}'::interval`)}
                            ) AS now_ts
                        FROM params
                    ),
                    /* Navigable edge of history — see space-scoped twin.
                       Scoped to every account the user owns (not the
                       the accountIds filter) and to spend-producing rows, so
                       the stepper's reach is stable across filter and
                       metric-mode changes. */
                    nav_start AS (
                        SELECT date_trunc(
                            ${input.granularity},
                            MIN(t.transaction_datetime)
                        ) AS ts
                        FROM transactions t
                        WHERE t.space_id = ANY(${memberSpaces})
                          AND t.source_account_id = ANY(${ownedAll})
                          AND (
                              t.type = 'expense'
                              OR (
                                  t.type = 'transfer'
                                  AND t.destination_account_id <> ALL(${ownedAll})
                              )
                          )
                    ),
                    /* Earliest in-scope row that can contribute non-zero spend
                       in the active mode — see space-scoped twin for why the
                       type restriction matters. */
                    data_start AS (
                        SELECT
                            date_trunc(
                                ${input.granularity},
                                MIN(t.transaction_datetime)
                            ) AS earliest,
                            date_trunc(
                                ${cfg.bucketUnit},
                                MIN(t.transaction_datetime)
                            ) AS earliest_bucket
                        FROM transactions t
                        WHERE t.space_id = ANY(${memberSpaces})
                          AND t.source_account_id = ANY(${owned})
                          AND (
                              t.type = 'expense'
                              OR (
                                  ${xferFactor} = 1
                                  AND t.type = 'transfer'
                                  AND t.destination_account_id <> ALL(${owned})
                              )
                          )
                    ),
                    /* First period the average may draw on — skips a partial
                       first period. See space-scoped twin. */
                    avg_pool_start AS (
                        SELECT CASE
                            WHEN earliest IS NULL THEN NULL
                            WHEN earliest_bucket = earliest THEN earliest
                            ELSE earliest + ${sql.raw(`'${cfg.periodInterval}'::interval`)}
                        END AS ts
                        FROM data_start
                    ),
                    /* Clamped to cur_start so navigating to a period that
                       predates all data can't leave generate_series with
                       start > stop (zero buckets, period_length 0). */
                    history_start AS (
                        SELECT LEAST(
                            COALESCE(
                                (SELECT earliest FROM data_start),
                                (SELECT cur_start FROM bounds)
                            ),
                            (SELECT cur_start FROM bounds)
                        ) AS ts
                    ),
                    all_buckets AS (
                        SELECT generate_series(
                            (SELECT ts FROM history_start),
                            (SELECT cur_end FROM bounds)
                                - ${sql.raw(`'${cfg.bucketInterval}'::interval`)},
                            ${sql.raw(`'${cfg.bucketInterval}'::interval`)}
                        ) AS bucket_ts
                    ),
                    spend AS (
                        SELECT
                            date_trunc(${cfg.bucketUnit}, t.transaction_datetime) AS bucket_ts,
                            SUM(
                                CASE
                                    WHEN t.type = 'expense'
                                        AND t.source_account_id = ANY(${owned}) THEN t.amount
                                    WHEN t.type = 'transfer'
                                        AND t.source_account_id = ANY(${owned})
                                        AND t.destination_account_id <> ALL(${owned}) THEN t.amount * ${xferFactor}
                                    ELSE 0
                                END
                            ) AS expense
                        FROM transactions t
                        WHERE t.space_id = ANY(${memberSpaces})
                          AND t.transaction_datetime < (SELECT cur_end FROM bounds)
                          AND (
                              t.source_account_id = ANY(${owned})
                              OR t.destination_account_id = ANY(${owned})
                          )
                        GROUP BY 1
                    ),
                    classified AS (
                        SELECT
                            ab.bucket_ts,
                            COALESCE(s.expense, 0) AS expense,
                            CASE
                                WHEN ab.bucket_ts >= (SELECT cur_start FROM bounds) THEN 'cur'
                                WHEN ab.bucket_ts >= (SELECT prev_start FROM bounds) THEN 'prev'
                                WHEN ab.bucket_ts >= (SELECT ts FROM avg_pool_start) THEN 'avg'
                                ELSE 'skip'
                            END AS kind,
                            ROW_NUMBER() OVER (
                                PARTITION BY date_trunc(${input.granularity}, ab.bucket_ts)
                                ORDER BY ab.bucket_ts
                            )::int AS idx
                        FROM all_buckets ab
                        LEFT JOIN spend s ON s.bucket_ts = ab.bucket_ts
                    ),
                    meta AS (
                        SELECT
                            (SELECT COUNT(*)::int FROM all_buckets
                                WHERE bucket_ts >= (SELECT cur_start FROM bounds)
                                  AND bucket_ts <= (SELECT now_ts FROM bounds)
                            ) AS today_bucket,
                            (SELECT COUNT(*)::int FROM all_buckets
                                WHERE bucket_ts >= (SELECT cur_start FROM bounds)
                            ) AS period_length,
                            (SELECT ts FROM nav_start) AS history_start,
                            (SELECT COUNT(DISTINCT date_trunc(${input.granularity}, bucket_ts))::int
                                FROM all_buckets
                                WHERE bucket_ts < (SELECT prev_start FROM bounds)
                                  AND bucket_ts >= (SELECT ts FROM avg_pool_start)
                            ) AS avg_periods
                    )
                    SELECT
                        c.kind::text AS kind,
                        c.idx,
                        c.expense::text,
                        m.today_bucket,
                        m.period_length,
                        m.history_start,
                        m.avg_periods
                    FROM classified c
                    CROSS JOIN meta m
                    WHERE c.kind IN ('cur', 'prev')
                    UNION ALL
                    SELECT
                        'avg'::text AS kind,
                        c.idx,
                        AVG(c.expense)::text AS expense,
                        m.today_bucket,
                        m.period_length,
                        m.history_start,
                        m.avg_periods
                    FROM classified c
                    CROSS JOIN meta m
                    WHERE c.kind = 'avg'
                    GROUP BY c.idx, m.today_bucket, m.period_length, m.history_start, m.avg_periods
                    ORDER BY 1, 2
                `.execute(ctx.services.qb);

                const first = rows.rows[0];
                const periodLength = first?.period_length ?? 1;
                /* Clamped into [1, periodLength] — see space-scoped twin. */
                const todayBucket = Math.min(periodLength, Math.max(1, first?.today_bucket ?? 1));
                const avgPeriods = first?.avg_periods ?? 0;

                /* The prior period may be longer than the current one — size
                   it by its own bucket count and total it independently.
                   See space-scoped twin. */
                let previousLength = 0;
                let previousTotal = 0;
                for (const r of rows.rows) {
                    if (r.kind !== "prev") continue;
                    if (r.idx > previousLength) previousLength = r.idx;
                    previousTotal += Number(r.expense);
                }

                const current = new Array<number>(periodLength).fill(0);
                const previous = new Array<number>(previousLength).fill(0);
                const average = new Array<number>(periodLength).fill(0);
                let hasAverage = false;
                for (const r of rows.rows) {
                    const i = r.idx - 1;
                    if (r.kind === "prev") {
                        if (i >= 0 && i < previousLength) previous[i] = Number(r.expense);
                        continue;
                    }
                    if (i < 0 || i >= periodLength) continue;
                    if (r.kind === "cur") current[i] = Number(r.expense);
                    else if (r.kind === "avg") {
                        average[i] = Number(r.expense);
                        hasAverage = true;
                    }
                }

                return {
                    granularity: input.granularity,
                    bucketUnit: cfg.bucketUnit,
                    bucketDays: cfg.bucketDays,
                    periodLength,
                    today: todayBucket,
                    current,
                    previous,
                    previousLength,
                    previousTotal,
                    /* Gated at ≥2 periods server-side — see space-scoped twin. */
                    average: hasAverage && avgPeriods >= 2 ? average : null,
                    averagePeriods: avgPeriods,
                    historyStart: first?.history_start ?? null,
                };
            })()
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute personal trends daily comparison",
            });
        }
        return result;
    });
