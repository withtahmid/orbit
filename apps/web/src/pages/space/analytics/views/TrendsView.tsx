import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { KpiStrip, type KpiItem } from "@/components/shared/KpiStrip";
import { MetricToggle, useMetricMode } from "@/components/shared/MetricMode";
import { AnalyticsDetailLayout } from "./_AnalyticsLayout";
import { AnalyticsFilterBar } from "../components/AnalyticsFilterBar";
import { useAnalyticsFilters } from "../components/useAnalyticsFilters";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import {
    addDays,
    addMonths,
    startOfIsoWeek,
    startOfMonth,
    startOfQuarter,
    startOfYear,
} from "@/lib/dates";
import { formatInAppTz } from "@/lib/formatDate";

type Granularity = "week" | "month" | "quarter" | "year";

const GRANULARITY_OPTIONS: ReadonlyArray<{
    id: Granularity;
    label: string;
    /** Singular noun for "vs last X" copy. */
    noun: string;
}> = [
    { id: "week", label: "Week", noun: "week" },
    { id: "month", label: "Month", noun: "month" },
    { id: "quarter", label: "Quarter", noun: "quarter" },
    { id: "year", label: "Year", noun: "year" },
];

/** Window bounds for the selected granularity, aligned with Postgres
 *  `date_trunc(granularity, ...)` semantics so frontend-derived periods
 *  (movers card) match the backend's bucket boundaries. */
function periodBoundsFor(
    g: Granularity,
    now: Date = new Date()
): {
    start: Date;
    end: Date;
} {
    if (g === "week") {
        const start = startOfIsoWeek(now);
        return { start, end: addDays(start, 7) };
    }
    if (g === "month") {
        const start = startOfMonth(now);
        return { start, end: addMonths(start, 1) };
    }
    if (g === "quarter") {
        const start = startOfQuarter(now);
        return { start, end: addMonths(start, 3) };
    }
    const start = startOfYear(now);
    return { start, end: addMonths(start, 12) };
}

/* ============================================================
   VIEW
   ============================================================ */

export default function TrendsView() {
    const { space } = useCurrentSpace();
    const isPersonal = space.isPersonal;

    const [params, setParams] = useSearchParams();
    const granularity = ((): Granularity => {
        const q = params.get("g");
        return q === "week" || q === "quarter" || q === "year" ? q : "month";
    })();
    const setGranularity = (g: Granularity) => {
        setParams(
            (p) => {
                const next = new URLSearchParams(p);
                if (g === "month") next.delete("g");
                else next.set("g", g);
                return next;
            },
            { replace: true }
        );
    };
    const noun = GRANULARITY_OPTIONS.find((o) => o.id === granularity)!.noun;

    /* Filter state lives in URL search params via the shared hook, so
       links stay shareable and the same bar drives the other analytics
       views. */
    const {
        envelopeIds,
        accountIds,
        categoryIds,
        envelopeIdsArg,
        accountIdsArg,
        categoryIdsArg,
        setFilterIds,
        clearAllFilters,
        hasAnyFilter,
    } = useAnalyticsFilters();

    const now = useMemo(() => new Date(), []);
    const period = useMemo(() => periodBoundsFor(granularity, now), [granularity, now]);

    /* Spending Trends defaults to `operational` — the user looking at
       a "trends" page wants true spending velocity, not a chart that
       spikes the day they shifted savings between two of their own
       accounts. They can still toggle to `cash` to see the bank view. */
    const { mode } = useMetricMode("operational");

    const dailySpaceQ = trpc.analytics.trends.dailyComparison.useQuery(
        {
            spaceId: space.id,
            anchor: now,
            granularity,
            mode,
            envelopeIds: envelopeIdsArg,
            accountIds: accountIdsArg,
            categoryIds: categoryIdsArg,
        },
        { enabled: !isPersonal }
    );
    const dailyPersonalQ = trpc.personal.trends.dailyComparison.useQuery(
        { anchor: now, granularity, mode, accountIds: accountIdsArg },
        { enabled: isPersonal }
    );
    const dailyData = (isPersonal ? dailyPersonalQ.data : dailySpaceQ.data) ?? null;
    const dailyLoading = isPersonal ? dailyPersonalQ.isLoading : dailySpaceQ.isLoading;

    /* YoY card always compares calendar years — independent of the
       selected granularity. Pin to the current year as Dhaka knows it,
       not browser-local; near year-end the two can disagree by one. */
    const yoyYear = Number(formatInAppTz(now, "yyyy"));
    const yoySpaceQ = trpc.analytics.trends.yearOverYear.useQuery(
        {
            spaceId: space.id,
            year: yoyYear,
            envelopeIds: envelopeIdsArg,
            accountIds: accountIdsArg,
            categoryIds: categoryIdsArg,
        },
        { enabled: !isPersonal }
    );
    const yoyPersonalQ = trpc.personal.trends.yearOverYear.useQuery(
        { year: yoyYear, accountIds: accountIdsArg },
        { enabled: isPersonal }
    );
    const yoyData = (isPersonal ? yoyPersonalQ.data : yoySpaceQ.data) ?? null;

    const moversSpaceQ = trpc.analytics.trends.categoryMovers.useQuery(
        {
            spaceId: space.id,
            periodStart: period.start,
            periodEnd: period.end,
            limit: 6,
            envelopeIds: envelopeIdsArg,
            accountIds: accountIdsArg,
            categoryIds: categoryIdsArg,
        },
        { enabled: !isPersonal }
    );
    const moversPersonalQ = trpc.personal.trends.categoryMovers.useQuery(
        {
            periodStart: period.start,
            periodEnd: period.end,
            limit: 6,
            accountIds: accountIdsArg,
        },
        { enabled: isPersonal }
    );
    const moversResponse = (isPersonal ? moversPersonalQ.data : moversSpaceQ.data) ?? null;
    const moversData = moversResponse?.items ?? [];
    const moversMode: "standard" | "drill" = moversResponse?.mode ?? "standard";
    const moversDrillRootId = moversResponse?.drillRootCategoryId ?? null;

    const TODAY = dailyData?.today ?? 1;
    const DAYS_IN_MONTH = dailyData?.periodLength ?? 30;
    const CUR_DAILY = dailyData?.current ?? [];
    const PRV_DAILY = dailyData?.previous ?? [];
    const AVG_DAILY = dailyData?.average ?? null;
    const BUCKET_DAYS = dailyData?.bucketDays ?? 1;
    const BUCKET_UNIT = dailyData?.bucketUnit ?? "day";

    const cumulative = useMemo(() => {
        const cur: number[] = [];
        const prv: number[] = [];
        const avg: number[] | null = AVG_DAILY ? [] : null;
        let curAcc = 0;
        let prvAcc = 0;
        let avgAcc = 0;
        const len = Math.max(DAYS_IN_MONTH, PRV_DAILY.length);
        for (let i = 0; i < len; i++) {
            curAcc += CUR_DAILY[i] ?? 0;
            prvAcc += PRV_DAILY[i] ?? 0;
            cur.push(curAcc);
            prv.push(prvAcc);
            if (avg && AVG_DAILY) {
                avgAcc += AVG_DAILY[i] ?? 0;
                avg.push(avgAcc);
            }
        }
        return { cur, prv, avg };
    }, [CUR_DAILY, PRV_DAILY, AVG_DAILY, DAYS_IN_MONTH]);

    const monthSoFar = cumulative.cur[TODAY - 1] ?? 0;
    const lastMonthSoFar = cumulative.prv[TODAY - 1] ?? 0;
    const lastMonthFull = cumulative.prv[Math.max(0, cumulative.prv.length - 1)] ?? 0;
    const dailyAvg = TODAY > 0 ? monthSoFar / TODAY : 0;
    const projected = dailyAvg * DAYS_IN_MONTH;
    /* `null` when there's no prior-period spend to compare against — the
       UI then shows a neutral em-dash instead of a misleading "0% behind". */
    const paceDelta = lastMonthSoFar > 0 ? (monthSoFar / lastMonthSoFar - 1) * 100 : null;

    /* Typical = avg cumulative shape across all prior periods. The
       same-position cumulative tells us where typical spending stood
       at *this* bucket-in-period; full-period typical is the endpoint. */
    const typicalSoFar = cumulative.avg ? (cumulative.avg[TODAY - 1] ?? 0) : 0;
    const typicalFull = cumulative.avg ? (cumulative.avg[cumulative.avg.length - 1] ?? 0) : 0;
    const typicalDailyAvg = DAYS_IN_MONTH > 0 ? typicalFull / (DAYS_IN_MONTH * BUCKET_DAYS) : 0;
    const paceVsTypical =
        cumulative.avg && typicalSoFar > 0 ? (monthSoFar / typicalSoFar - 1) * 100 : null;

    /* Bucket-unit-aware label so KPIs read sensibly across granularities
       ("Day 5 of 7" for week, "Week 3 of 13" for quarter, etc.). */
    const bucketLabel = BUCKET_UNIT === "week" ? "Week" : BUCKET_UNIT === "month" ? "Month" : "Day";

    const kpiItems: KpiItem[] = [
        {
            label: "Spent so far",
            value: monthSoFar,
            money: true,
            sub: `${bucketLabel} ${TODAY} of ${DAYS_IN_MONTH}`,
        },
        {
            label: `Daily burn`,
            value: dailyAvg / BUCKET_DAYS,
            money: true,
            sub: `Avg per day this ${noun}`,
        },
        {
            label: `Pace vs last ${noun}`,
            value: paceDelta ?? 0,
            valueFormat: "percent",
            /* No prior-period spend → neutral, no tone color and no
               "ahead/behind" copy that misreads as good/bad. */
            tone: paceDelta == null ? "muted" : paceDelta > 0 ? "expense" : "income",
            sub:
                paceDelta == null
                    ? `No spend last ${noun} to compare`
                    : paceDelta > 0
                      ? "ahead — spending faster"
                      : "behind — spending slower",
        },
        /* "Vs typical" is the headline value relative to the
           same-bucket cumulative averaged across every prior period.
           Hidden when the user has no historical periods to average. */
        ...(paceVsTypical !== null
            ? [
                  {
                      label: "Vs typical",
                      value: paceVsTypical,
                      valueFormat: "percent" as const,
                      tone: (paceVsTypical > 0 ? "expense" : "income") as "expense" | "income",
                      sub: paceVsTypical > 0 ? "above your usual pace" : "below your usual pace",
                  },
              ]
            : []),
        {
            label: `Projected ${noun}`,
            value: projected,
            money: true,
            sub: `vs ${formatMoneyShort(lastMonthFull)} last ${noun}`,
        },
    ];

    const yoyMonths = yoyData?.months ?? [];
    /* Replace nulls (future months) with 0 for the bar chart so the
       layout stays — the trailing-12-month total ignores nulls. */
    const yoyThisYear = (yoyData?.thisYear ?? []).map((v) => v ?? 0);
    const yoyLastYear = (yoyData?.lastYear ?? []).map((v) => v ?? 0);

    /* Compare same-window-of-year on both sides so the headline delta
       isn't asymmetric YTD-vs-FY. Server returns `null` for the first
       not-yet-happened month of `thisYear`, so `findIndex(v == null)`
       gives us the cutoff. Mid-May with flat YoY spend should read
       ~0%, not ~-58%. */
    const yoyFutureStartIdx = (yoyData?.thisYear ?? []).findIndex((v) => v == null);
    const yoyWindowMonths = yoyFutureStartIdx === -1 ? 12 : yoyFutureStartIdx;
    const yoyThisTotal = (yoyData?.thisYear ?? [])
        .slice(0, yoyWindowMonths)
        .reduce<number>((s, v) => s + (v ?? 0), 0);
    const yoyLastTotal = (yoyData?.lastYear ?? [])
        .slice(0, yoyWindowMonths)
        .reduce<number>((s, v) => s + (v ?? 0), 0);
    const yoyTotalDelta = yoyLastTotal > 0 ? (yoyThisTotal / yoyLastTotal - 1) * 100 : 0;
    const yoyHeaviestGrowth = useMemo(() => {
        if (!yoyData) return null;
        let bestIdx = -1;
        let bestPct = -Infinity;
        for (let i = 0; i < 12; i++) {
            const cur = yoyData.thisYear[i];
            const prv = yoyData.lastYear[i];
            if (cur == null || prv == null || prv === 0) continue;
            const p = (cur / prv - 1) * 100;
            if (p > bestPct) {
                bestPct = p;
                bestIdx = i;
            }
        }
        if (bestIdx < 0) return null;
        return { month: yoyData.months[bestIdx], pct: bestPct };
    }, [yoyData]);

    return (
        <AnalyticsDetailLayout
            title="Spending trends"
            description={
                mode === "cash"
                    ? "Cash outflow over time — includes cross-space transfer principal as spending. Switch to Operational for the true expense-only view."
                    : "True expense over time — transfer principal excluded; only real expenses and transfer fees count as spending."
            }
            actions={
                <div className="flex flex-wrap items-center gap-2">
                    <MetricToggle />
                    <GranularityToggle value={granularity} onChange={setGranularity} />
                </div>
            }
        >
            <AnalyticsFilterBar
                spaceId={space.id}
                isPersonal={isPersonal}
                envelopeIds={envelopeIds}
                accountIds={accountIds}
                categoryIds={categoryIds}
                onChange={setFilterIds}
                onClearAll={clearAllFilters}
                hasAnyFilter={hasAnyFilter}
            />
            <KpiStrip items={kpiItems} isLoading={dailyLoading} />

            <Card>
                <CardHeader>
                    <CardTitle>
                        Cumulative spend race · this {noun} vs last {noun}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        {bucketLabel} {TODAY} of {DAYS_IN_MONTH} · projection extends through {noun}
                        -end based on current pace. The flat line is the typical pace from the last
                        3 {noun}s.
                    </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {dailyLoading ? (
                        <Skeleton className="h-[478px] w-full" />
                    ) : (
                        <CumulativeRaceChart
                            cur={cumulative.cur}
                            prv={cumulative.prv}
                            avg={cumulative.avg}
                            today={TODAY}
                            daysInMonth={DAYS_IN_MONTH}
                            projection={projected}
                            bucketUnit={BUCKET_UNIT}
                            periodStart={period.start}
                        />
                    )}
                    {/* Endpoint strip — replaces the inline right-edge
                        labels that used to overlap. Each row is a single
                        line's identity + its terminal value. Reads
                        top-to-bottom in the same visual order as the
                        chart's lines stack at period end. */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border/40 pt-3 text-[11.5px] sm:grid-cols-4">
                        <EndpointStat
                            color="var(--warning)"
                            kind="solid"
                            label={`This ${noun} (so far)`}
                            value={monthSoFar}
                        />
                        <EndpointStat
                            color="var(--muted-foreground)"
                            kind="dashed"
                            label={`Last ${noun}`}
                            value={lastMonthFull}
                        />
                        <EndpointStat
                            color="var(--warning)"
                            kind="dotted"
                            label="Projection"
                            value={projected}
                        />
                        {cumulative.avg ? (
                            <EndpointStat
                                color="var(--income)"
                                kind="solid"
                                label={`Typical (avg of all prior ${noun}s)`}
                                value={cumulative.avg[cumulative.avg.length - 1] ?? 0}
                            />
                        ) : null}
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <Card>
                    <CardHeader>
                        <CardTitle>
                            Year-over-year · {yoyYear} vs {yoyYear - 1}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                            {yoyYear} (solid) vs {yoyYear - 1} (faded). Shaded gap shows growth or
                            shrinkage.
                        </p>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <YoYBars
                            labels={yoyMonths}
                            thisYear={yoyThisYear}
                            lastYear={yoyLastYear}
                            yearThis={yoyYear}
                            yearLast={yoyYear - 1}
                        />
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
                            <span>
                                <span
                                    className={cn(
                                        "font-semibold",
                                        yoyTotalDelta >= 0
                                            ? "text-[color:var(--expense)]"
                                            : "text-[color:var(--income)]"
                                    )}
                                >
                                    {yoyTotalDelta >= 0 ? "+" : ""}
                                    {yoyTotalDelta.toFixed(0)}%
                                </span>{" "}
                                · this year vs last year (so far)
                            </span>
                            {yoyHeaviestGrowth ? (
                                <span className="ml-auto">
                                    Heaviest growth:{" "}
                                    <span className="font-semibold text-[color:var(--expense)]">
                                        {yoyHeaviestGrowth.month} (
                                        {yoyHeaviestGrowth.pct >= 0 ? "+" : ""}
                                        {yoyHeaviestGrowth.pct.toFixed(0)}%)
                                    </span>
                                </span>
                            ) : null}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Velocity</CardTitle>
                        <p className="text-xs text-muted-foreground">How fast money is leaving.</p>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2.5">
                        <VelocityRow
                            label={`Per day this ${noun}`}
                            value={dailyAvg / BUCKET_DAYS}
                            sub={`Across ${TODAY} ${bucketLabel.toLowerCase()}${TODAY === 1 ? "" : "s"} so far`}
                        />
                        <VelocityRow
                            label={`Per day last ${noun}`}
                            value={TODAY > 0 ? lastMonthSoFar / TODAY / BUCKET_DAYS : 0}
                            sub={`Same window, prior ${noun}`}
                            muted
                        />
                        {cumulative.avg ? (
                            <VelocityRow
                                label={`Per day typical`}
                                value={typicalDailyAvg}
                                sub={`Avg across all prior ${noun}s`}
                                muted
                            />
                        ) : null}
                        <VelocityRow
                            label="Acceleration"
                            value={paceDelta ?? 0}
                            sub={
                                paceDelta == null
                                    ? `No spend last ${noun} to compare`
                                    : `% change vs last ${noun}'s daily burn`
                            }
                            tone={paceDelta != null && paceDelta >= 0 ? "expense" : undefined}
                            unit="%"
                            decimals={1}
                            muted={paceDelta == null}
                        />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                        <CardTitle>
                            {moversMode === "drill" ? (
                                <DrillRootTitle
                                    spaceId={space.id}
                                    rootId={moversDrillRootId}
                                    noun={noun}
                                />
                            ) : (
                                <>
                                    Biggest movers · this {noun} vs last {noun}
                                </>
                            )}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                            {moversMode === "drill"
                                ? `Sub-categories with the largest change vs the prior ${noun}.`
                                : `Categories with the largest change vs the prior ${noun}.`}
                        </p>
                    </div>
                </CardHeader>
                <CardContent>
                    {moversData.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            {hasAnyFilter
                                ? "No movement matching the current filters."
                                : `No category movement vs last ${noun}.`}
                        </p>
                    ) : (
                        <div className="grid gap-2.5 sm:grid-cols-2">
                            {moversData.map((m) => {
                                const up = m.deltaAmount >= 0;
                                return (
                                    <div
                                        key={m.categoryId}
                                        className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 p-3.5"
                                    >
                                        <EntityAvatar size="md" color={m.color} icon={m.icon} />
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="truncate text-[13px] font-medium">
                                                {m.name}
                                            </span>
                                            <span className="truncate text-[11px] text-muted-foreground">
                                                {m.previousTotal === 0
                                                    ? "First time this period"
                                                    : m.currentTotal === 0
                                                      ? "No spend this period"
                                                      : `${(m.deltaPct * 100).toFixed(0)}% vs last period`}
                                            </span>
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                                            <span
                                                className={cn(
                                                    "inline-flex items-center gap-0.5 text-[11.5px] font-medium tabular-nums",
                                                    up
                                                        ? "text-[color:var(--expense)]"
                                                        : "text-[color:var(--income)]"
                                                )}
                                            >
                                                {up ? (
                                                    <ArrowUp className="size-3" />
                                                ) : (
                                                    <ArrowDown className="size-3" />
                                                )}
                                                {up ? "+" : "−"}
                                                {Math.abs(m.deltaAmount).toLocaleString("en-US", {
                                                    maximumFractionDigits: 0,
                                                })}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground tabular-nums">
                                                {m.previousTotal.toFixed(0)} →{" "}
                                                {m.currentTotal.toFixed(0)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </AnalyticsDetailLayout>
    );
}

/* ============================================================
   CHARTS — hand-rolled SVG (no recharts) to match the design's
   editorial-dark aesthetic exactly: dotted grid, shaded area
   under the cumulative line, "Today" marker, and inline labels
   on the projection / last-month endpoints.
   ============================================================ */

/** Path for a bar with rounded TOP corners only — a plain `<rect rx>`
 *  rounds all four, including the bottom edge sitting on the baseline,
 *  which doesn't match the top-only rounding the event detail page's
 *  (Recharts) bar strip uses. Matching that convention here. */
function topRoundedBarPath(
    x: number,
    yTop: number,
    width: number,
    height: number,
    r: number
): string {
    if (width <= 0 || height <= 0) return "";
    const rr = Math.min(r, width / 2, height);
    return `M${x} ${yTop + height} L${x} ${yTop + rr} Q${x} ${yTop} ${x + rr} ${yTop} L${x + width - rr} ${yTop} Q${x + width} ${yTop} ${x + width} ${yTop + rr} L${x + width} ${yTop + height} Z`;
}

/**
 * Cumulative spend chart — current period vs prior + typical-shape
 * average + projection, with hover tooltip and per-curve dots. Exported
 * so the Overview page can embed the same chart for its month-view
 * Spending Trends card without duplicating the SVG plumbing.
 */
export function CumulativeRaceChart({
    cur,
    prv,
    avg,
    today,
    daysInMonth,
    projection,
    bucketUnit,
    periodStart,
}: {
    cur: number[];
    prv: number[];
    /** Cumulative-typical-shape array — `avg[i]` is the mean of all
     *  prior periods' spend up through bucket position `i` (cumulated
     *  by the caller). `null` when no prior data exists, in which
     *  case the average curve is hidden. */
    avg: number[] | null;
    today: number;
    daysInMonth: number;
    projection: number;
    /** Drives the hover tooltip's bucket label ("Day 5", "Month 11"). */
    bucketUnit: "day" | "week" | "month";
    /** Start of the current period in absolute time. Required for the
     *  date column on the tooltip and the X-axis ticks. Together with
     *  `bucketUnit` it fully resolves each bucket index → wall-clock
     *  date in APP_TIMEZONE. */
    periodStart: Date;
}) {
    /** Real-world date of bucket position `i` (0-based) given the
     *  current period's start and the bucket unit. Used for both the
     *  axis labels and the tooltip's date column. */
    const bucketDate = (i: number): Date => {
        if (bucketUnit === "month") return addMonths(periodStart, i);
        if (bucketUnit === "week") return addDays(periodStart, i * 7);
        return addDays(periodStart, i);
    };

    /** Compact axis-tick format — strips redundant pieces depending on
     *  how zoomed-in the chart is. */
    const axisDateFormat =
        bucketUnit === "month"
            ? "MMM"
            : daysInMonth <= 7
              ? "EEE"
              : daysInMonth <= 31
                ? "MMM d"
                : "MMM d";

    /** Tooltip date format — slightly longer than the axis so the
     *  user gets the year too when looking at month / year views. */
    const tooltipDateFormat =
        bucketUnit === "month" ? "MMMM yyyy" : daysInMonth <= 7 ? "EEE, MMM d" : "MMM d, yyyy";
    const w = 800;
    const h = 460;
    const p = 32;
    const avgEndpoint = avg ? (avg[avg.length - 1] ?? 0) : 0;
    /* Guard against the all-zero / empty-data case. Without this floor,
       `v / max` produces NaN coordinates and the chart silently renders
       blank — exactly the "no data" symptom reported. We surface an
       explicit empty-state below instead. */
    const rawMax = Math.max(prv[prv.length - 1] ?? 0, cur[today - 1] ?? 0, projection, avgEndpoint);
    const noData = !Number.isFinite(rawMax) || rawMax <= 0 || cur.length === 0;
    const max = (rawMax > 0 ? rawMax : 1) * 1.1;
    const sx = (i: number) => p + (i / (daysInMonth - 1)) * (w - p * 2);
    const sy = (v: number) => h - p - (v / max) * (h - p * 2);
    const todayX = sx(today - 1);
    const todayY = sy(cur[today - 1]);

    const prvPath = prv
        .map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`)
        .join(" ");
    const curSlice = cur.slice(0, today);
    const curPath = curSlice
        .map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`)
        .join(" ");
    const projPath = `M${todayX} ${todayY} L${sx(daysInMonth - 1)} ${sy(projection)}`;

    /* Daily-volume bar strip beneath the cumulative curve — same idea as
     * the event detail page's timeline chart and the envelope detail
     * page's pace chart: per-bucket amounts (derived by diffing the
     * cumulative `cur` series, since that's all this chart is handed).
     * Shares the SAME `sy()`/`max` scale as the cumulative line — an
     * earlier version rode its own capped scale so a full-height bar
     * only reached ~28% up, which looked wrong: a bar's top didn't
     * correspond to the dollar value the Y-axis labels actually show.
     * Themed to the same `var(--warning)` as the rest of "this period",
     * not a separate hue. */
    const dailyCur = cur.map((v, i) => Math.max(0, v - (i > 0 ? (cur[i - 1] ?? 0) : 0)));
    const barBaseline = sy(0);
    const daySpacing = (w - p * 2) / (daysInMonth - 1);
    const barWidth = Math.max(2, Math.min(14, daySpacing * 0.6));

    /* Average path follows the same per-bucket cumulative shape as
       cur/prev — a curved line that captures the typical spending
       rhythm across all prior periods, not a flat run-rate. */
    const avgPath =
        avg && avgEndpoint > 0
            ? avg.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ")
            : null;
    const curArea = `${curPath} L ${todayX} ${h - p} L ${p} ${h - p} Z`;

    /** Day-axis ticks — sparse so the labels don't crowd. Adapts to
     *  bucket count so a 7-day week shows every day, a 30-day month
     *  shows weekly, and a 91-day quarter / 12-month year shows ~5
     *  evenly-spaced ticks. */
    const dayTicks =
        daysInMonth <= 7
            ? Array.from({ length: daysInMonth }, (_, i) => i + 1)
            : daysInMonth <= 13
              ? [
                    1,
                    Math.ceil(daysInMonth / 4),
                    Math.ceil(daysInMonth / 2),
                    Math.ceil((3 * daysInMonth) / 4),
                    daysInMonth,
                ]
              : daysInMonth <= 31
                ? [1, 7, 14, 21, daysInMonth]
                : [
                      1,
                      Math.round(daysInMonth * 0.25),
                      Math.round(daysInMonth * 0.5),
                      Math.round(daysInMonth * 0.75),
                      daysInMonth,
                  ];

    /* SVG → container percent helpers. Y is fixed-height so we use px
       directly; X stretches with the container so we use percentage. */
    const xPct = (svgX: number) => (svgX / w) * 100;
    const projY = sy(projection);
    const lastY = sy(prv[prv.length - 1] ?? 0);

    /* Hover state — drives the vertical guide line, the per-curve dots,
       and the tooltip card. Cleared on mouse-leave. */
    const containerRef = useRef<HTMLDivElement>(null);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const handleMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const xWithin = e.clientX - rect.left;
        const svgX = (xWithin / rect.width) * w;
        const raw = ((svgX - p) / (w - p * 2)) * (daysInMonth - 1);
        const idx = Math.max(0, Math.min(daysInMonth - 1, Math.round(raw)));
        setHoverIdx(idx);
    };
    const bucketLabelSingular =
        bucketUnit === "month" ? "Month" : bucketUnit === "week" ? "Week" : "Day";

    if (noData) {
        return (
            <div
                className="flex w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/10"
                style={{ height: h }}
            >
                <span className="text-sm text-muted-foreground">
                    No spend recorded in this window yet.
                </span>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div
                ref={containerRef}
                className="relative w-full"
                style={{ height: h }}
                onMouseMove={handleMove}
                onMouseLeave={() => setHoverIdx(null)}
            >
                <svg
                    viewBox={`0 0 ${w} ${h}`}
                    width="100%"
                    height="100%"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="Cumulative spend chart"
                >
                    <defs>
                        <linearGradient id="trendGrad" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="var(--warning)" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="var(--warning)" stopOpacity="0" />
                        </linearGradient>
                    </defs>

                    {/* Y gridlines (no text — that's HTML-overlaid) */}
                    {[0, 1, 2, 3, 4].map((i) => {
                        const y = p + (i * (h - p * 2)) / 4;
                        return (
                            <line
                                key={i}
                                x1={p}
                                x2={w - p}
                                y1={y}
                                y2={y}
                                stroke="var(--border)"
                                strokeDasharray="2 4"
                            />
                        );
                    })}

                    {/* Today marker line */}
                    <line
                        x1={todayX}
                        x2={todayX}
                        y1={p}
                        y2={h - p}
                        stroke="var(--warning)"
                        strokeOpacity={0.4}
                        strokeDasharray="3 4"
                    />

                    {/* Average pace line — drawn first so it sits behind
                        the actual data lines. Solid emerald, mid-opacity
                        so it reads as a quiet baseline rather than
                        a competing series. */}
                    {avgPath ? (
                        <path
                            d={avgPath}
                            fill="none"
                            stroke="var(--income)"
                            strokeWidth={1.25}
                            opacity={0.55}
                            vectorEffect="non-scaling-stroke"
                        />
                    ) : null}

                    {/* Last period line (dashed muted) */}
                    <path
                        d={prvPath}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        opacity={0.7}
                        vectorEffect="non-scaling-stroke"
                    />
                    {/* Current month area + line */}
                    <path d={curArea} fill="url(#trendGrad)" />
                    {/* Daily-volume bars — same warning color as the
                        cumulative line, on top of the translucent area
                        fill but under the line's own stroke so the
                        running total always stays the clearest read. */}
                    {dailyCur
                        .slice(0, today)
                        .map((v, i) =>
                            v > 0 ? (
                                <path
                                    key={i}
                                    d={topRoundedBarPath(
                                        sx(i) - barWidth / 2,
                                        sy(v),
                                        barWidth,
                                        barBaseline - sy(v),
                                        1.5
                                    )}
                                    fill="var(--warning)"
                                    fillOpacity={0.32}
                                />
                            ) : null
                        )}
                    <path
                        d={curPath}
                        fill="none"
                        stroke="var(--warning)"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                    />
                    {/* Projection line */}
                    <path
                        d={projPath}
                        fill="none"
                        stroke="var(--warning)"
                        strokeWidth={1.5}
                        strokeDasharray="2 3"
                        opacity={0.7}
                        vectorEffect="non-scaling-stroke"
                    />

                    {/* Endpoint markers */}
                    <circle cx={todayX} cy={todayY} r={4} fill="var(--warning)" />
                    <circle
                        cx={sx(daysInMonth - 1)}
                        cy={projY}
                        r={3}
                        fill="var(--warning)"
                        opacity={0.5}
                    />
                    <circle
                        cx={sx(daysInMonth - 1)}
                        cy={lastY}
                        r={3}
                        fill="var(--muted-foreground)"
                    />

                    {/* Hover guide line + per-curve dots. Rendered last
                        so they sit on top of the lines. */}
                    {hoverIdx !== null ? (
                        <g pointerEvents="none">
                            <line
                                x1={sx(hoverIdx)}
                                x2={sx(hoverIdx)}
                                y1={p}
                                y2={h - p}
                                stroke="var(--fg-3)"
                                strokeOpacity={0.55}
                                strokeWidth={1}
                                vectorEffect="non-scaling-stroke"
                            />
                            {hoverIdx < today ? (
                                <circle
                                    cx={sx(hoverIdx)}
                                    cy={sy(cur[hoverIdx] ?? 0)}
                                    r={3.5}
                                    fill="var(--warning)"
                                    stroke="var(--bg)"
                                    strokeWidth={1.5}
                                />
                            ) : null}
                            <circle
                                cx={sx(hoverIdx)}
                                cy={sy(prv[hoverIdx] ?? 0)}
                                r={3}
                                fill="var(--muted-foreground)"
                                stroke="var(--bg)"
                                strokeWidth={1.5}
                            />
                            {avg ? (
                                <circle
                                    cx={sx(hoverIdx)}
                                    cy={sy(avg[hoverIdx] ?? 0)}
                                    r={3}
                                    fill="var(--income)"
                                    stroke="var(--bg)"
                                    strokeWidth={1.5}
                                />
                            ) : null}
                        </g>
                    ) : null}
                </svg>

                {/* HTML text overlays — positioned in container coords so
                    fonts stay native at any container width. X uses % to
                    track the stretching SVG; Y uses px since the container
                    height is fixed. */}
                {[0, 1, 2, 3, 4].map((i) => {
                    const yPx = p + (i * (h - p * 2)) / 4;
                    const value = ((4 - i) * max) / 4 / 1000;
                    return (
                        <span
                            key={`yt-${i}`}
                            className="absolute text-[10px] tabular-nums text-muted-foreground"
                            style={{
                                left: `${xPct(p - 6)}%`,
                                top: yPx,
                                transform: "translate(-100%, -50%)",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {value.toFixed(1)}K
                        </span>
                    );
                })}

                <span
                    className="absolute text-[10.5px] font-medium"
                    style={{
                        left: `${xPct(todayX + 6)}%`,
                        top: p + 4,
                        color: "var(--warning)",
                        whiteSpace: "nowrap",
                    }}
                >
                    Today
                </span>

                {/* Right-end value labels deliberately removed — they
                    crowded each other when projection / last / avg
                    landed at similar Y. The endpoint dots above remain
                    as visual anchors; the values are surfaced in the
                    stat strip rendered below the chart by the parent. */}

                {/* Hover tooltip — flips to the left of the cursor on the
                    right half of the chart so it never clips off the
                    edge. Pointer-events are off so the cursor keeps
                    interacting with the chart underneath. */}
                {hoverIdx !== null ? (
                    <div
                        className="pointer-events-none absolute z-10 min-w-[140px] rounded-md border border-border bg-card px-3 py-2 text-[11px] shadow-lg"
                        style={{
                            left: `${xPct(sx(hoverIdx))}%`,
                            top: 8,
                            transform:
                                hoverIdx > daysInMonth / 2
                                    ? "translateX(calc(-100% - 12px))"
                                    : "translateX(12px)",
                        }}
                    >
                        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            <span className="text-foreground">
                                {formatInAppTz(bucketDate(hoverIdx), tooltipDateFormat)}
                            </span>
                            {/* For quarter / year the "Day 145 of 365"
                                counter competes with the date without
                                adding context — the wall date already
                                says where the user is. Keep it for
                                week / month where the position is the
                                useful frame. */}
                            {daysInMonth <= 31 ? (
                                <span>
                                    {bucketLabelSingular} {hoverIdx + 1} of {daysInMonth}
                                </span>
                            ) : null}
                        </div>
                        <TooltipRow
                            label={`This (so far)`}
                            value={hoverIdx < today ? (cur[hoverIdx] ?? 0) : null}
                            color="var(--warning)"
                        />
                        <TooltipRow
                            label={`Spent this ${bucketLabelSingular.toLowerCase()}`}
                            value={hoverIdx < today ? (dailyCur[hoverIdx] ?? 0) : null}
                            color="var(--warning)"
                        />
                        <TooltipRow
                            label="Last"
                            value={prv[hoverIdx] ?? 0}
                            color="var(--muted-foreground)"
                        />
                        {avg ? (
                            <TooltipRow
                                label="Typical"
                                value={avg[hoverIdx] ?? 0}
                                color="var(--income)"
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>
            {/* Date axis — bucket-position ticks resolved to wall-clock
                dates in APP_TIMEZONE so the user can see *when*, not
                just *how far in*. Format compresses as the period
                widens (weekday name for week view, year-aware on quarter
                / year).

                Horizontal padding mirrors the SVG's inset
                (`p=32` of `w=800` ≈ 4%) so the first tick anchors at
                the curve's actual origin and the last doesn't overflow
                the card on mobile. */}
            <div className="mt-1 flex justify-between px-[4%] text-[10.5px] text-muted-foreground">
                {dayTicks.map((d) => (
                    <span key={d}>{formatInAppTz(bucketDate(d - 1), axisDateFormat)}</span>
                ))}
            </div>
        </div>
    );
}

function TooltipRow({
    label,
    value,
    color,
}: {
    label: string;
    /** `null` ⇒ row renders an em-dash (e.g. hovering future days of
     *  the current period before they've happened). */
    value: number | null;
    color: string;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-foreground/85">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
            </span>
            <span className="tabular-nums font-medium">
                {value === null
                    ? "—"
                    : value.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                      })}
            </span>
        </div>
    );
}

/** Segmented control for the granularity selector. URL-persisted via
 *  `?g=` so links are shareable and reload-stable. */
function GranularityToggle({
    value,
    onChange,
}: {
    value: Granularity;
    onChange: (g: Granularity) => void;
}) {
    return (
        <div
            role="tablist"
            aria-label="Trends granularity"
            className="inline-flex h-9 items-center rounded-md border border-border bg-card p-0.5 text-[12.5px]"
        >
            {GRANULARITY_OPTIONS.map((opt) => {
                const active = opt.id === value;
                return (
                    <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(opt.id)}
                        className={cn(
                            "h-8 rounded px-3 transition-colors",
                            active
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

function YoYBars({
    labels,
    thisYear,
    lastYear,
    yearThis,
    yearLast,
}: {
    labels: string[];
    thisYear: number[];
    lastYear: number[];
    /** Year labels for the tooltip header (e.g., 2026 / 2025). */
    yearThis: number;
    yearLast: number;
}) {
    const w = 600;
    const h = 220;
    const p = 28;
    const rawMax = Math.max(0, ...thisYear, ...lastYear);
    const noData = labels.length === 0 || rawMax <= 0;
    const max = rawMax > 0 ? rawMax : 1;
    const cw = labels.length > 0 ? (w - p * 2) / labels.length : 0;
    const bw = (cw - 6) / 2;
    const sy = (v: number) => h - p - (v / max) * (h - p * 2);

    const xPct = (svgX: number) => (svgX / w) * 100;

    const containerRef = useRef<HTMLDivElement>(null);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const handleMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || labels.length === 0) return;
        const xWithin = e.clientX - rect.left;
        const svgX = (xWithin / rect.width) * w;
        const raw = (svgX - p) / cw;
        const idx = Math.max(0, Math.min(labels.length - 1, Math.floor(raw)));
        setHoverIdx(idx);
    };

    if (noData) {
        return (
            <div
                className="flex w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/10"
                style={{ height: h }}
            >
                <span className="text-sm text-muted-foreground">
                    No yearly comparison data yet.
                </span>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="relative w-full"
            style={{ height: h }}
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverIdx(null)}
        >
            <svg
                viewBox={`0 0 ${w} ${h}`}
                width="100%"
                height="100%"
                preserveAspectRatio="none"
                role="img"
                aria-label="Year-over-year monthly spend"
            >
                {[0, 1, 2, 3].map((i) => (
                    <line
                        key={i}
                        x1={p}
                        x2={w - p}
                        y1={p + (i * (h - p * 2)) / 3}
                        y2={p + (i * (h - p * 2)) / 3}
                        stroke="var(--border)"
                        strokeDasharray="2 4"
                    />
                ))}
                {labels.map((l, i) => {
                    const cx = p + i * cw + 3;
                    const yt = sy(thisYear[i]);
                    const yl = sy(lastYear[i]);
                    const isHover = hoverIdx === i;
                    return (
                        <g key={l}>
                            <rect
                                x={cx}
                                y={yl}
                                width={bw}
                                height={h - p - yl}
                                fill="var(--muted-foreground)"
                                opacity={isHover ? 0.55 : 0.35}
                                rx={2}
                            />
                            <rect
                                x={cx + bw + 2}
                                y={yt}
                                width={bw}
                                height={h - p - yt}
                                fill="var(--warning)"
                                opacity={isHover ? 1 : 0.9}
                                rx={2}
                            />
                        </g>
                    );
                })}
            </svg>

            {/* Y-axis tick labels — same positions as the gridlines.
                HTML overlay so fonts don't stretch with the SVG. */}
            {[0, 1, 2, 3].map((i) => {
                const yPx = p + (i * (h - p * 2)) / 3;
                const value = ((3 - i) * max) / 3;
                return (
                    <span
                        key={`yt-${i}`}
                        className="absolute text-[10px] tabular-nums text-muted-foreground"
                        style={{
                            left: `${xPct(p - 4)}%`,
                            top: yPx,
                            transform: "translate(-100%, -50%)",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {formatCompact(value)}
                    </span>
                );
            })}

            {/* Month labels — HTML overlay so fonts stay native. */}
            {labels.map((l, i) => {
                const cx = p + i * cw + 3 + bw + 1;
                return (
                    <span
                        key={l}
                        className="absolute text-[10.5px] text-muted-foreground"
                        style={{
                            left: `${xPct(cx)}%`,
                            top: h - p + 4,
                            transform: "translateX(-50%)",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {l}
                    </span>
                );
            })}

            {/* Hover tooltip — flips to the side that doesn't clip. */}
            {hoverIdx !== null ? (
                <div
                    className="pointer-events-none absolute z-10 min-w-[160px] rounded-md border border-border bg-card px-3 py-2 text-[11px] shadow-lg"
                    style={{
                        left: `${xPct(p + hoverIdx * cw + cw / 2)}%`,
                        top: 8,
                        transform:
                            hoverIdx > labels.length / 2
                                ? "translateX(calc(-100% - 12px))"
                                : "translateX(12px)",
                    }}
                >
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {labels[hoverIdx]}
                    </div>
                    <YoyTooltipRow
                        label={String(yearThis)}
                        value={thisYear[hoverIdx] ?? 0}
                        color="var(--warning)"
                    />
                    <YoyTooltipRow
                        label={String(yearLast)}
                        value={lastYear[hoverIdx] ?? 0}
                        color="var(--muted-foreground)"
                    />
                    <YoyDeltaRow
                        thisVal={thisYear[hoverIdx] ?? 0}
                        lastVal={lastYear[hoverIdx] ?? 0}
                    />
                </div>
            ) : null}
        </div>
    );
}

function YoyTooltipRow({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-foreground/85">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
            </span>
            <span className="tabular-nums font-medium">
                {value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
        </div>
    );
}

function YoyDeltaRow({ thisVal, lastVal }: { thisVal: number; lastVal: number }) {
    if (lastVal === 0) return null;
    const delta = thisVal - lastVal;
    const pct = (delta / lastVal) * 100;
    const tone =
        delta > 0 ? "var(--expense)" : delta < 0 ? "var(--income)" : "var(--muted-foreground)";
    return (
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border/40 pt-1 text-[10.5px]">
            <span className="text-muted-foreground">Δ vs prior</span>
            <span className="tabular-nums font-medium" style={{ color: tone }}>
                {delta >= 0 ? "+" : "−"}
                {Math.abs(delta).toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                })}
                {" · "}
                {pct >= 0 ? "+" : ""}
                {pct.toFixed(0)}%
            </span>
        </div>
    );
}

/** Compact number formatter for axis ticks: 4.5K / 1.2M etc. */
function formatCompact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toFixed(0);
}

/* ============================================================
   SMALL PIECES
   ============================================================ */

/** Endpoint stat card — one row per chart line with its terminal value.
 *  Replaces the right-edge inline labels that used to overlap when
 *  projection / last / avg landed at similar Y. Top row mirrors the
 *  legend swatch; bottom row is the value in tabular nums. */
function EndpointStat({
    color,
    kind,
    label,
    value,
}: {
    color: string;
    kind: "solid" | "dashed" | "dotted";
    label: string;
    value: number;
}) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <span
                    className="inline-block h-px w-3.5"
                    style={{
                        borderTopWidth: kind === "solid" ? 2 : 1.5,
                        borderTopStyle:
                            kind === "solid" ? "solid" : kind === "dashed" ? "dashed" : "dotted",
                        borderTopColor: color,
                    }}
                />
                <span className="truncate">{label}</span>
            </span>
            <span className="text-[15px] font-semibold tabular-nums" style={{ color }}>
                {value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
        </div>
    );
}

function VelocityRow({
    label,
    value,
    sub,
    muted = false,
    tone,
    unit,
    decimals = 2,
}: {
    label: string;
    value: number;
    sub: string;
    muted?: boolean;
    tone?: "expense";
    unit?: string;
    decimals?: number;
}) {
    return (
        <div className="flex flex-col gap-1 rounded-md bg-muted/30 px-3.5 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {label}
            </span>
            {unit ? (
                <span
                    className={cn(
                        "text-xl font-bold tabular-nums",
                        tone === "expense" && "text-[color:var(--expense)]",
                        muted && "text-muted-foreground"
                    )}
                >
                    {value.toFixed(decimals)}
                    <span className="ml-0.5 text-base font-medium text-muted-foreground">
                        {unit}
                    </span>
                </span>
            ) : (
                <MoneyDisplay
                    amount={value}
                    variant={muted ? "muted" : "neutral"}
                    className="text-xl font-bold tabular-nums"
                />
            )}
            <span className="text-[10.5px] text-muted-foreground">{sub}</span>
        </div>
    );
}

function formatMoneyShort(n: number): string {
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Drill-mode card title — fetches the selected category's name so the
 *  movers card can read "Biggest movers within Groceries · this month
 *  vs last month" instead of a generic header. Falls back to the
 *  standard (non-drill) title while the name resolves so a deep-link
 *  with a cold cache doesn't flash an ellipsis. The query shares its
 *  cache key with `CategoryMultiSelect` so a user who opened the
 *  filter bar pays no extra round-trip. */
function DrillRootTitle({
    spaceId,
    rootId,
    noun,
}: {
    spaceId: string;
    rootId: string | null;
    noun: string;
}) {
    const q = trpc.expenseCategory.listBySpace.useQuery({ spaceId }, { enabled: !!rootId });
    const name = q.data?.find((c) => c.id === rootId)?.name;
    if (!name) {
        return (
            <>
                Biggest movers · this {noun} vs last {noun}
            </>
        );
    }
    return (
        <>
            Biggest movers within{" "}
            <span className="inline-block max-w-[55vw] truncate align-bottom sm:max-w-none">
                {name}
            </span>{" "}
            · this {noun} vs last {noun}
        </>
    );
}
