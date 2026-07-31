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

const granularitySchema = z.enum(["week", "month", "quarter", "year"]);
type Granularity = z.infer<typeof granularitySchema>;

/**
 * Per-granularity bucket layout. The cumulative race chart needs a
 * tractable bucket count regardless of period length.
 *
 * Every granularity uses *day* buckets. Year previously bucketed by
 * month (12 points) but that hid intra-month rhythm — a single
 * March-spike bucket told you nothing about whether the spike was on
 * payday week vs taxes week. Weekly buckets were considered but
 * Postgres' `date_trunc('week', …)` aligns to ISO Mondays, which
 * leaves early-Jan / late-Dec days bucketed into the previous year
 * (the same boundary issue that kept quarter on day buckets).
 * Day buckets sidestep both: 365 same-shaped points, no boundary
 * fuzz, average-shape still works (position N = day-of-year, with a
 * 1-day leap-year offset for Dec 31 that's invisible at this scale).
 */
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
 * Granularity-aware comparison data for the Trends view's primary chart.
 *
 * Returns three same-length arrays per bucket:
 *   - `current`: spend in the active period
 *   - `previous`: spend in the immediately-preceding period
 *   - `average`: per-bucket mean across *every* prior period the user
 *     has data for (excluding the current period). Aggregated
 *     positionally — `average[i]` is the average spend at the i-th
 *     bucket across all prior periods. The frontend cumulates this to
 *     draw a typical-shape reference behind the solid/dashed lines: it
 *     captures rhythm (rent on day 1, weekend bumps) that a flat
 *     run-rate would smooth away.
 *
 * Bounds are computed by Postgres via `date_trunc(granularity, ...)`,
 * which respects the session timezone (Asia/Dhaka). Computing the same
 * boundaries in JS via `Date.UTC(...)` was the source of the off-by-one
 * "no spend" reports east of UTC.
 */
export const trendsDailyComparison = authorizedProcedure
    .input(
        z.object({
            spaceId: z.string().uuid(),
            anchor: z.coerce.date().optional(),
            granularity: granularitySchema.default("month"),
            /**
             * `cash` (default) — outflows include cross-space outbound
             * transfer principal (matches `cashFlow` mode='cash' and
             * the bank-balance view).
             * `operational` — only true type='expense' debits +
             * transfer fees. Transfer principal excluded.
             *
             * Note: this proc has no income column — it's an outflow /
             * spending series. The mode controls whether the spend
             * total counts cross-space outbound transfers as
             * "spending."
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
                    roles: ["owner", "editor", "viewer"] as unknown as SpaceMembers["role"][],
                });

                const cfg = GRANULARITY_CONFIG[input.granularity];
                const anchor = input.anchor ?? new Date();
                /* Multiplier for the cross-space transfer-principal
                   branch — derived from the Zod enum, no injection
                   surface. Same pattern as cashFlow.mts. */
                const xferFactor = input.mode === "cash" ? 1 : 0;

                /* Filter fragments. Empty when the corresponding filter
                   is not active so the query reads cleanly in the
                   unfiltered (default) case. */
                const catCTE = selectedCategoriesCTEClause(input.categoryIds, [input.spaceId]);
                const catWhere = categoryFilterWhere(input.categoryIds);
                const envWhere = envelopeFilterWhere(input.envelopeIds);
                const acctScope = scopeAccountsFilter(input.accountIds);

                /* The query produces three logical streams in one shot:
                   - kind='cur'  : one row per bucket of the active period
                   - kind='prev' : one row per bucket of the prior period
                   - kind='avg'  : one row per bucket position (1..N),
                                   each carrying the AVG across every
                                   historical period at that position
                   Indices are within-period (1..periodLength), so the JS
                   layer can route each row into the right slot of three
                   parallel arrays without any date arithmetic. */
                const rows = await sql<{
                    kind: "cur" | "prev" | "avg";
                    idx: number;
                    expense: string;
                    today_bucket: number;
                    period_length: number;
                    history_start: Date | null;
                    avg_periods: number;
                }>`
                    WITH RECURSIVE ${catCTE}
                    params AS (
                        SELECT ${anchor}::timestamptz AS anchor_ts
                    ),
                    bounds AS (
                        SELECT
                            date_trunc(${input.granularity}, anchor_ts) AS cur_start,
                            date_trunc(${input.granularity}, anchor_ts)
                                + ${sql.raw(`'${cfg.periodInterval}'::interval`)} AS cur_end,
                            date_trunc(${input.granularity}, anchor_ts)
                                - ${sql.raw(`'${cfg.periodInterval}'::interval`)} AS prev_start,
                            /* "How far into the period are we" is pinned to
                               the real clock, NOT to the anchor: the anchor
                               selects *which* period, never how much of it
                               has elapsed. For the current period this is
                               NOW() (identical to the old behavior); for a
                               completed period it saturates at the final
                               bucket so the whole period comes back. That
                               keeps the frontend from having to pass an
                               end-of-period timestamp — passing the 1st of
                               a past month used to silently yield a
                               one-day chart. */
                            LEAST(
                                NOW(),
                                date_trunc(${input.granularity}, anchor_ts)
                                    + ${sql.raw(`'${cfg.periodInterval}'::interval`)}
                                    - ${sql.raw(`'${cfg.bucketInterval}'::interval`)}
                            ) AS now_ts
                        FROM params
                    ),
                    scope_accounts AS (
                        SELECT account_id
                        FROM space_accounts
                        WHERE space_id = ${input.spaceId}
                        ${acctScope}
                    ),
                    all_space_accounts AS (
                        SELECT account_id
                        FROM space_accounts
                        WHERE space_id = ${input.spaceId}
                    ),
                    /* Earliest period that could ever show non-zero spend
                       for this space — the navigable edge of history.
                       Deliberately ignores the user's envelope / category /
                       account filters and the metric mode: the period
                       stepper's reach shouldn't shrink when a filter is
                       toggled, and the empty-state copy speaks about the
                       space's history rather than the filter's. Restricted
                       to spend-producing rows so an opening-balance
                       deposit doesn't advertise months of guaranteed
                       zeros. */
                    nav_start AS (
                        SELECT date_trunc(
                            ${input.granularity},
                            MIN(t.transaction_datetime)
                        ) AS ts
                        FROM transactions t
                        WHERE t.source_account_id IN (SELECT account_id FROM all_space_accounts)
                          AND (
                              t.type = 'expense'
                              OR (
                                  t.type = 'transfer'
                                  AND t.destination_account_id NOT IN (
                                      SELECT account_id FROM all_space_accounts
                                  )
                              )
                          )
                    ),
                    /* Earliest in-scope row that can contribute non-zero spend
                       to this series, with both its period start and its
                       bucket start. Caps generate_series so we don't spin up
                       buckets back to year zero, and anchors the average
                       pool. Restricted to spend-producing rows in the active
                       mode: an opening-balance deposit two years before the
                       first purchase would otherwise pull in two years of
                       structurally-zero buckets and drag "typical" to the
                       floor. NULL when nothing qualifies. */
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
                        WHERE t.source_account_id IN (SELECT account_id FROM scope_accounts)
                          AND (
                              t.type = 'expense'
                              OR (
                                  ${xferFactor} = 1
                                  AND t.type = 'transfer'
                                  AND t.destination_account_id NOT IN (
                                      SELECT account_id FROM scope_accounts
                                  )
                              )
                          )
                          ${envWhere}
                          ${catWhere}
                    ),
                    /* First period the typical-shape average may draw on.
                       The user's very first period is usually PARTIAL — a
                       first transaction on Mar 25 leaves March with 24
                       structurally-zero days — and averaging it in as a whole
                       month drags every early bucket toward zero, so normal
                       spending reads as "+33% above typical". Skip it unless
                       the first row lands in the period's opening bucket, in
                       which case the period really is whole.

                       Only the AVERAGE is bounded by this. The prior-period
                       comparison still reaches the partial first period: it
                       is drawn and labelled by name, so a short month is
                       visible rather than misleading. */
                    avg_pool_start AS (
                        SELECT CASE
                            WHEN earliest IS NULL THEN NULL
                            WHEN earliest_bucket = earliest THEN earliest
                            ELSE earliest + ${sql.raw(`'${cfg.periodInterval}'::interval`)}
                        END AS ts
                        FROM data_start
                    ),
                    /* Never later than cur_start: when the user navigates to
                       a period that predates all their data, an
                       unclamped history_start would leave generate_series
                       with start > stop, producing zero buckets and a
                       period_length of 0. */
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
                                        AND t.source_account_id IN (SELECT account_id FROM scope_accounts) THEN t.amount
                                    WHEN t.type = 'transfer'
                                        AND t.source_account_id IN (SELECT account_id FROM scope_accounts)
                                        AND t.destination_account_id NOT IN (SELECT account_id FROM scope_accounts) THEN t.amount * ${xferFactor}
                                    ELSE 0
                                END
                            ) AS expense
                        FROM transactions t
                        WHERE t.transaction_datetime < (SELECT cur_end FROM bounds)
                          AND (
                              t.source_account_id IN (SELECT account_id FROM scope_accounts)
                              OR t.destination_account_id IN (SELECT account_id FROM scope_accounts)
                          )
                          ${envWhere}
                          ${catWhere}
                        GROUP BY 1
                    ),
                    classified AS (
                        SELECT
                            ab.bucket_ts,
                            COALESCE(s.expense, 0) AS expense,
                            CASE
                                WHEN ab.bucket_ts >= (SELECT cur_start FROM bounds) THEN 'cur'
                                WHEN ab.bucket_ts >= (SELECT prev_start FROM bounds) THEN 'prev'
                                /* 'skip' buckets exist so the prior period can
                                   still be reached, but are excluded from the
                                   average — see avg_pool_start. */
                                WHEN ab.bucket_ts >= (SELECT ts FROM avg_pool_start) THEN 'avg'
                                ELSE 'skip'
                            END AS kind,
                            /* Bucket position within its own period.
                               Partitioning by date_trunc(granularity, …)
                               groups buckets that belong to the same
                               calendar period, so day-15-of-Aug,
                               day-15-of-Sep, etc. all land at idx=15. */
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
                            /* Unfiltered navigable edge of history (NULL if
                               the space has never recorded spend). Lets the
                               stepper disable its back arrow at the true
                               edge instead of walking into empty periods
                               forever. */
                            (SELECT ts FROM nav_start) AS history_start,
                            /* How many whole prior periods feed the average.
                               Surfaced so the UI can say "averaged across
                               4 earlier months" instead of claiming a norm
                               built from a single period. */
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
                    /* Per-position average across every prior period
                       the user has data for. */
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
                `.execute(trx);

                const first = rows.rows[0];
                const periodLength = first?.period_length ?? 1;
                /* Clamp into [1, periodLength]. `now_ts` saturates at the
                   period's last bucket so a *completed* period yields
                   exactly periodLength, but a period entirely in the
                   future (reachable only by a hand-edited URL — the
                   stepper disables forward navigation) counts zero
                   elapsed buckets, and a 0 here would make every
                   downstream `today - 1` index negative. */
                const todayBucket = Math.min(periodLength, Math.max(1, first?.today_bucket ?? 1));
                const avgPeriods = first?.avg_periods ?? 0;

                /* The prior period can be LONGER than the current one
                   (Jan→Feb, Q4→Q1, leap year→next). Sizing `previous` by
                   the *current* period's length silently discarded those
                   tail buckets — viewing February compared Feb against
                   Jan 1–28, hiding ~10% of January. Size it by its own
                   bucket count and total it independently so any
                   "full prior period" claim is honest. */
                let previousLength = 0;
                let previousTotal = 0;
                for (const r of rows.rows) {
                    if (r.kind !== "prev") continue;
                    if (r.idx > previousLength) previousLength = r.idx;
                    previousTotal += Number(r.expense);
                }

                const current = new Array<number>(periodLength).fill(0);
                const previous = new Array<number>(previousLength).fill(0);
                /* `average` stays sized to the CURRENT period so that
                   `sum(average)` is "a typical period of this length" —
                   the like-for-like basis the vs-typical comparison
                   needs. Extending it to the longest historical period
                   would make a 28-day February read as overspending
                   against a 31-day yardstick. */
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
                    /* Bucket count and true total of the PRIOR period, which
                       may differ in length from the current one. Use
                       `previousTotal` for any full-period claim;
                       `previous[today-1]` remains the same-elapsed-window
                       figure that the in-progress pace comparison wants. */
                    previousLength,
                    previousTotal,
                    /* `null` when the user has no historical data
                       beyond the previous period — the frontend hides
                       the average line in that case. */
                    /* Gated at ≥2 contributing periods here rather than in one
                       view: a single period is not a norm, and every consumer
                       (Overview, envelope detail, budgets) draws this as a
                       "typical" baseline. Gating server-side keeps them from
                       disagreeing about whether the line exists. */
                    average: hasAverage && avgPeriods >= 2 ? average : null,
                    /* How many whole prior periods `average` is built from. */
                    averagePeriods: avgPeriods,
                    /* Start of the earliest period in which this space could
                       show spend, ignoring filters (`null` ⇒ never any).
                       Bounds the period stepper's back arrow. */
                    historyStart: first?.history_start ?? null,
                };
            })
        );
        if (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "Failed to compute trends daily comparison",
            });
        }
        return result;
    });
