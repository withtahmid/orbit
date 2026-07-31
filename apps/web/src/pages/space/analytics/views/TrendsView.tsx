import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
    addPeriods,
    fromInputDate,
    getAppTzMonth,
    getAppTzYear,
    isSamePeriod,
    makeAppTzDate,
    periodBounds,
    startOfPeriod,
    toInputDate,
    type PeriodGranularity,
} from "@/lib/dates";
import { formatInAppTz } from "@/lib/formatDate";
import { MoversList, formatCompact } from "@/features/analytics/MoversList";

type Granularity = PeriodGranularity;

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

/**
 * Headline name for a whole period — "Week of Jul 7, 2026", "July 2026",
 * "Q3 2026", "2026". Deliberately absolute: once the user can navigate
 * history, "this month" is no longer a safe way to say which month.
 */
function formatPeriodLabel(g: Granularity, start: Date): string {
    if (g === "year") return formatInAppTz(start, "yyyy");
    if (g === "quarter")
        return `Q${Math.floor(getAppTzMonth(start) / 3) + 1} ${formatInAppTz(start, "yyyy")}`;
    if (g === "month") return formatInAppTz(start, "MMMM yyyy");
    return `Week of ${formatInAppTz(start, "MMM d, yyyy")}`;
}

/** Inclusive day span under the headline — "Jul 1 – Jul 31". */
function formatPeriodRange(g: Granularity, start: Date): string {
    const lastDay = addDays(addPeriods(g, start, 1), -1);
    return `${formatInAppTz(start, "MMM d")} – ${formatInAppTz(lastDay, "MMM d")}`;
}

/**
 * Compact name for inline copy — "Vs June", "Avg per day in Q3 2026".
 * `refYear` is the year of the period being viewed: the year is appended
 * only when it differs, so a January view reads "vs December 2025"
 * instead of an ambiguous bare "December".
 */
function formatPeriodShort(g: Granularity, start: Date, refYear: number): string {
    const year = getAppTzYear(start);
    const sameYear = year === refYear;
    const q = Math.floor(getAppTzMonth(start) / 3) + 1;
    if (g === "year") return String(year);
    if (g === "quarter") return sameYear ? `Q${q}` : `Q${q} ${year}`;
    if (g === "month")
        return sameYear ? formatInAppTz(start, "MMMM") : formatInAppTz(start, "MMMM yyyy");
    /* The end date compresses to a bare day only when it shares the month —
       otherwise the week of Jul 27–Aug 2 rendered as "Jul 27–2". */
    const lastDay = addDays(addPeriods("week", start, 1), -1);
    const end =
        getAppTzMonth(lastDay) === getAppTzMonth(start)
            ? formatInAppTz(lastDay, "d")
            : formatInAppTz(lastDay, "MMM d");
    return `${formatInAppTz(start, "MMM d")}–${end}`;
}

/**
 * Column-header form of a period: three-char month, no year. Used only by the
 * movers table, whose columns are narrow and whose header is uppercased —
 * "JUL → AUG" carries the same information as "JULY → AUGUST" in half the
 * width. Prose elsewhere on the page keeps the full name.
 */
function formatPeriodTick(g: Granularity, start: Date): string {
    if (g === "year") return formatInAppTz(start, "yyyy");
    if (g === "quarter") return `Q${Math.floor(getAppTzMonth(start) / 3) + 1}`;
    if (g === "month") return formatInAppTz(start, "MMM");
    const lastDay = addDays(addPeriods("week", start, 1), -1);
    return `${formatInAppTz(start, "MMM d")}–${formatInAppTz(lastDay, "d")}`;
}

/** Wall-clock date of bucket position `i` (0-based) within a period. */
function bucketDateAt(bucketUnit: "day" | "week" | "month", periodStart: Date, i: number): Date {
    if (bucketUnit === "month") return addMonths(periodStart, i);
    if (bucketUnit === "week") return addDays(periodStart, i * 7);
    return addDays(periodStart, i);
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
    const noun = GRANULARITY_OPTIONS.find((o) => o.id === granularity)!.noun;

    /* Frozen at mount: an anchor that changed identity every render would
       change the query key every render. */
    const now = useMemo(() => new Date(), []);

    /* `?p=YYYY-MM-DD` — an absolute anchor *date*, not a period slug.
       One param shape serves all four granularities, and flipping `?g=`
       re-resolves the same anchor into the new unit (July 2026 → Q3 2026)
       with nothing to re-parse and no way for `?p` and `?g` to disagree.
       Absent ⇒ the live period, so the default URL stays clean and a link
       shared without `?p` keeps meaning "now" rather than freezing on the
       month it was copied in. */
    const anchorParam = params.get("p");
    const anchor = useMemo(() => {
        const parsed = anchorParam ? fromInputDate(anchorParam) : null;
        if (!parsed || !Number.isFinite(parsed.getTime())) return now;
        /* `fromInputDate` only shape-checks, so `Date.UTC` silently rolls
           over out-of-range fields — `?p=2026-02-30` would render March.
           Round-tripping catches every such value. */
        if (toInputDate(parsed) !== anchorParam) return now;
        /* A future anchor is only reachable by hand-editing the URL — the
           stepper disables forward travel. Clamp instead of rendering it:
           `previous` and `average` are defined relative to the anchor, so
           an empty future period would come back as a confident-looking
           chart reading "100% below typical". */
        return parsed.getTime() > now.getTime() ? now : parsed;
    }, [anchorParam, now]);

    const period = useMemo(() => periodBounds(granularity, anchor), [granularity, anchor]);
    const prevPeriod = useMemo(
        () => periodBounds(granularity, addPeriods(granularity, period.start, -1)),
        [granularity, period.start]
    );

    /* The one switch every label, every KPI and every chart mark keys off.
       `live` = a period still in progress, which has a pace and a
       projection; `closed` = a completed period, which has facts. Mixing
       the two vocabularies is what makes a historical view read as if it
       were today's. */
    const isLive = isSamePeriod(granularity, anchor, now);

    /* Movers compares the WHOLE prior period against this one so far.
       Truncating the prior period to the elapsed span looked more rigorous and
       was worse on both counts. It left a gap — the query fetched
       [prevStart, periodEnd) while the two arms counted only the ends of it —
       so on the 1st a category with a full month of
       prior spend showed 1,850 (that month's first day alone) and read
       "Stopped". And it made two views disagree about the same month: July's own
       view said 20,741, August's view said 1,850.

       Whole-vs-to-date is what the numbers actually are. "You spent 20,741 on
       Tour & Travel last month and nothing yet this month" is true, useful, and
       consistent with every other view of July. Early in a period most rows
       will read as falls — that IS the situation, and the copy says so rather
       than hiding it behind a manufactured equal-span comparison. */

    const anchorYear = getAppTzYear(period.start);
    const periodLabel = formatPeriodLabel(granularity, period.start);
    const prevLabel = formatPeriodLabel(granularity, prevPeriod.start);
    const periodShort = formatPeriodShort(granularity, period.start, anchorYear);
    const prevShort = formatPeriodShort(granularity, prevPeriod.start, anchorYear);

    /** Write the anchor. Collapses to "no param" whenever the target is
     *  the live period so the URL never pins today's month.
     *
     *  `push` by default — moving between periods *is* navigation, so the
     *  browser Back button should undo one step. (Filters and the
     *  granularity toggle replace, since those are settings.) */
    const setAnchor = (next: Date | null, { replace = false } = {}) => {
        const target =
            next === null || isSamePeriod(granularity, next, now) ? null : toInputDate(next);
        /* No-op when the target period is already open — clicking the
           selected year-over-year bar would otherwise push a duplicate
           history entry, and Back would appear frozen. */
        if (target === (params.get("p") ?? null)) return;
        setParams(
            (p) => {
                const q = new URLSearchParams(p);
                if (target === null) q.delete("p");
                else q.set("p", target);
                return q;
            },
            /* The chart the user just clicked is halfway down the page;
               resetting scroll to the top would throw away their place. */
            { replace, preventScrollReset: true }
        );
    };
    /* Steps off `period.start`, never off the raw anchor: stepping back a
       month from Jul 31 would overflow to Jul 1 and appear to do nothing. */
    const stepPeriod = (delta: number) => setAnchor(addPeriods(granularity, period.start, delta));

    const setGranularity = (g: Granularity) => {
        setParams(
            (p) => {
                const next = new URLSearchParams(p);
                if (g === "month") next.delete("g");
                else next.set("g", g);
                /* Re-resolve the anchor into the new unit: widening from
                   "last week" to Year can land on the live period, and
                   leaving `?p` set there would label today's year
                   "Complete". */
                const held = next.get("p");
                const parsed = held ? fromInputDate(held) : null;
                if (parsed && isSamePeriod(g, parsed, now)) next.delete("p");
                return next;
            },
            { replace: true, preventScrollReset: true }
        );
    };

    /** Jump to the month a year-over-year bar represents. Keeps the active
     *  granularity and anchors on the *period containing* that month — from
     *  a quarter view, clicking March opens Q1 rather than silently
     *  demoting the toggle at the top of the page to Month.
     *
     *  Year granularity is the exception: every month resolves to the year
     *  already open, so keeping the granularity would make all twelve bars
     *  (and twelve mobile chips) inert under copy promising they work. From a
     *  year view "show me March" can only mean the month, and the switch is
     *  legible — the toggle moves and the headline changes with it. */
    const openMonth = (year: number, monthIdx: number) => {
        const start = makeAppTzDate(year, monthIdx, 1);
        if (granularity !== "year") {
            setAnchor(start);
            return;
        }
        setParams(
            (p) => {
                const q = new URLSearchParams(p);
                q.delete("g");
                if (isSamePeriod("month", start, now)) q.delete("p");
                else q.set("p", toInputDate(start));
                return q;
            },
            { preventScrollReset: true }
        );
    };

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

    /* Spending Trends defaults to `operational` — the user looking at
       a "trends" page wants true spending velocity, not a chart that
       spikes the day they shifted savings between two of their own
       accounts. They can still toggle to `cash` to see the bank view. */
    const { mode } = useMetricMode("operational");

    /* Hold the previous period's response while the next one loads. The
       skeleton is right for a cold page but wrong for stepping: without
       this, every ◀ press empties `current`, which trips the chart's
       no-data branch and flashes an empty-state card between periods. */
    const keepPrevious = { placeholderData: <T,>(prev: T | undefined) => prev };
    /* Same, but drops held data when the *granularity* changes — a 31-point
       month series drawn against a 7-day week's axis is not a stale frame,
       it's a wrong one. Period steps keep their held data; unit switches
       fall back to the skeleton. */
    const keepSameGranularity = {
        placeholderData: <T extends { granularity: Granularity }>(prev: T | undefined) =>
            prev?.granularity === granularity ? prev : undefined,
    };

    const dailySpaceQ = trpc.analytics.trends.dailyComparison.useQuery(
        {
            spaceId: space.id,
            /* The period start, not the raw anchor — `?p=2026-07-05` and
               `?p=2026-07-20` are the same query, and the server
               date_truncs it anyway. Elapsed-ness comes from the server's
               own clock, so this only selects *which* period. */
            anchor: period.start,
            granularity,
            mode,
            envelopeIds: envelopeIdsArg,
            accountIds: accountIdsArg,
            categoryIds: categoryIdsArg,
        },
        { enabled: !isPersonal, ...keepSameGranularity }
    );
    const dailyPersonalQ = trpc.personal.trends.dailyComparison.useQuery(
        { anchor: period.start, granularity, mode, accountIds: accountIdsArg },
        { enabled: isPersonal, ...keepSameGranularity }
    );
    const dailyData = (isPersonal ? dailyPersonalQ.data : dailySpaceQ.data) ?? null;
    const dailyLoading = isPersonal ? dailyPersonalQ.isLoading : dailySpaceQ.isLoading;
    /* Held data from the *previous* period is on screen. Every period-named
       number must be skeletoned while this is true, not merely dimmed: the
       labels have already flipped to the new period, so stepping
       live-August → July would otherwise print one day of August under
       "Total spent · All 31 days of July". The chart's curves are safe to
       hold — they make no period-named numeric claim. */
    const dailyStale = isPersonal
        ? dailyPersonalQ.isPlaceholderData
        : dailySpaceQ.isPlaceholderData;

    /* YoY compares calendar years, so it follows the anchor at *year*
       resolution: viewing July 2025 retitles the card to 2025 vs 2024.
       Every card on the page moves together — a page with some cards on
       July and others pinned to today is the classic mixed-timeframe
       dashboard bug. */
    const yoyYear = anchorYear;
    const yoySpaceQ = trpc.analytics.trends.yearOverYear.useQuery(
        {
            spaceId: space.id,
            year: yoyYear,
            /* Must match the daily series' mode — these bars are
               click-through navigation, so a July bar of cash-mode spend
               that opens an operational-mode total reads as a bug. */
            mode,
            envelopeIds: envelopeIdsArg,
            accountIds: accountIdsArg,
            categoryIds: categoryIdsArg,
        },
        { enabled: !isPersonal, ...keepPrevious }
    );
    const yoyPersonalQ = trpc.personal.trends.yearOverYear.useQuery(
        { year: yoyYear, mode, accountIds: accountIdsArg },
        { enabled: isPersonal, ...keepPrevious }
    );
    const yoyData = (isPersonal ? yoyPersonalQ.data : yoySpaceQ.data) ?? null;

    const moversSpaceQ = trpc.analytics.trends.categoryMovers.useQuery(
        {
            spaceId: space.id,
            periodStart: period.start,
            periodEnd: period.end,
            /* Calendar-aligned, not period-length-subtracted: July minus
               31 days is May 31, which would make "last month" mean
               May 31 → Jul 1. */
            prevStart: prevPeriod.start,
            limit: 6,
            envelopeIds: envelopeIdsArg,
            accountIds: accountIdsArg,
            categoryIds: categoryIdsArg,
        },
        { enabled: !isPersonal, ...keepPrevious }
    );
    const moversPersonalQ = trpc.personal.trends.categoryMovers.useQuery(
        {
            periodStart: period.start,
            periodEnd: period.end,
            prevStart: prevPeriod.start,
            limit: 6,
            accountIds: accountIdsArg,
        },
        { enabled: isPersonal, ...keepPrevious }
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
    /* The prior period's OWN bucket count and total. It can be longer than
       the current period (Jan→Feb, Q4→Q1, leap→next), so its total is not
       `prv[TODAY-1]` and its per-day rate is not `total / TODAY`. */
    const PREV_LENGTH = dailyData?.previousLength ?? 0;
    const hasPrevious = PREV_LENGTH > 0;
    /* How many whole prior periods the "typical" curve averages. Below 2 a
       single period would be drawn as an authoritative norm. */
    const AVG_PERIODS = dailyData?.averagePeriods ?? 0;

    /* Period-start of the earliest period this space could show spend in —
       bounds the stepper's back arrow so it stops at the true edge of
       history instead of walking into empty periods forever. Deliberately
       filter-independent on the server, so the reachable range doesn't
       shift as filters are toggled. This client runs tRPC without a
       transformer, so the wire value is an ISO string even though the
       inferred type says `Date`. */
    const historyStartRaw = dailyData?.historyStart ?? null;
    const earliestPeriodStart = useMemo(() => {
        if (!historyStartRaw) return null;
        const d = new Date(historyStartRaw as unknown as string);
        return Number.isFinite(d.getTime()) ? startOfPeriod(granularity, d) : null;
    }, [historyStartRaw, granularity]);
    /* Enabled while the first response is in flight — `null` there means
       "not known yet", not "no history", and a back arrow that starts
       disabled and enables a beat later reads as broken. */
    const canGoBack =
        dailyData === null
            ? true
            : earliestPeriodStart !== null &&
              period.start.getTime() > earliestPeriodStart.getTime();
    /* The selected period ends before any data exists — every card would
       be a truthful but useless wall of zeros. */
    const beforeHistory =
        earliestPeriodStart !== null && period.start.getTime() < earliestPeriodStart.getTime();

    /* Each series is cumulated over its OWN length. `cur` and `avg` span
       the current period; `prv` spans the prior one, which can be longer
       (January has 31 days, February 28). Running all three to a shared
       `max(…)` length would pad `cur`/`avg` with repeats of their final
       value past the plot's right edge, and pad `prv` with a flat
       plateau. */
    const cumulative = useMemo(() => {
        const cur: number[] = [];
        const prv: number[] = [];
        const avg: number[] | null = AVG_DAILY ? [] : null;
        let curAcc = 0;
        let prvAcc = 0;
        let avgAcc = 0;
        for (let i = 0; i < DAYS_IN_MONTH; i++) {
            curAcc += CUR_DAILY[i] ?? 0;
            cur.push(curAcc);
            if (avg && AVG_DAILY) {
                avgAcc += AVG_DAILY[i] ?? 0;
                avg.push(avgAcc);
            }
        }
        for (let i = 0; i < PRV_DAILY.length; i++) {
            prvAcc += PRV_DAILY[i] ?? 0;
            prv.push(prvAcc);
        }
        return { cur, prv, avg };
    }, [CUR_DAILY, PRV_DAILY, AVG_DAILY, DAYS_IN_MONTH]);

    const monthSoFar = cumulative.cur[TODAY - 1] ?? 0;
    /* Prior period truncated to the same elapsed window — the right
       comparison while a period is still running. Clamped to the prior
       period's own length: on March 30th, February has no day 30, and its
       cumulative total by then is simply all of it. */
    const lastMonthSoFar =
        cumulative.prv.length > 0
            ? (cumulative.prv[Math.min(TODAY, cumulative.prv.length) - 1] ?? 0)
            : 0;
    /* Prior period in full, straight from the server so it can't be
       clipped by a shorter current period. */
    const lastMonthFull = dailyData?.previousTotal ?? 0;
    const dailyAvg = TODAY > 0 ? monthSoFar / TODAY : 0;
    const projected = dailyAvg * DAYS_IN_MONTH;
    /* Per-day rate of the prior period, over its own length. Divides by the
       buckets the prior period actually covers, never by more: on March 30th,
       February's total spans 28 days, not 30. `null` when there is no prior
       period at all. */
    const prevDailyAvg = !hasPrevious
        ? null
        : isLive
          ? lastMonthSoFar / Math.max(1, Math.min(TODAY, PREV_LENGTH)) / BUCKET_DAYS
          : lastMonthFull / PREV_LENGTH / BUCKET_DAYS;
    const curDailyAvg = dailyAvg / BUCKET_DAYS;
    /* Rate-vs-rate, which is what the Velocity card is about. `paceDelta` is
       a totals ratio, and once the two periods can differ in length the two
       stop agreeing — a flat 1,000/day January into a flat 1,000/day February
       is 0% by rate but −9.7% by total. Printing the totals figure directly
       under two per-day rows made the card's arithmetic not close. */
    const burnDelta =
        prevDailyAvg !== null && prevDailyAvg > 0 ? (curDailyAvg / prevDailyAvg - 1) * 100 : null;
    /* "Pace" is a rate word, so on a live period the KPI IS the rate — the
       same number the Velocity card prints, and the only reading its own
       sub-copy ("spending faster") supports. A totals ratio diverges from it
       whenever the two elapsed windows differ in length: on March 30th the
       current window is 30 buckets and February's is 28, so a perfectly flat
       spender reads 0% by rate and +7% by total. A finished period has no
       pace at all — it's a whole-vs-whole total, and the label says
       "Vs June". `null` when there's nothing to compare against, which the
       UI renders as a neutral em-dash rather than a misleading "0% behind". */
    const paceDelta = isLive
        ? burnDelta
        : lastMonthFull > 0
          ? (monthSoFar / lastMonthFull - 1) * 100
          : null;

    /* Typical = avg cumulative shape across all prior periods, but only
       once there are at least two to average: a single period drawn as a
       baseline is a norm the data can't support. Everything typical-related
       hangs off this, so the curve, the KPI and the velocity row appear and
       disappear together. */
    const typicalSeries = AVG_PERIODS >= 2 ? cumulative.avg : null;
    /* The same-position cumulative tells us where typical spending stood at
       *this* bucket-in-period; full-period typical is the endpoint. Note
       the server sizes `average` to the CURRENT period's length, so
       `typicalFull` is "a typical period of this many buckets" — the
       like-for-like basis a 28-day February needs. */
    const typicalSoFar = typicalSeries ? (typicalSeries[TODAY - 1] ?? 0) : 0;
    const typicalFull = typicalSeries ? (typicalSeries[typicalSeries.length - 1] ?? 0) : 0;
    /* Elapsed window, matching the other two rates AND the "Vs typical" KPI.
       A whole-period rate here made the Velocity bars and that KPI give
       opposite verdicts in the first week of every month — rent on day 1 puts
       `typicalSoFar/TODAY` far above `typicalFull/L`, so the card read "3.4×
       normal" while the KPI read ~0%. No-op on a closed period, where the
       server pins TODAY to periodLength. */
    const typicalDailyAvg = typicalSeries && TODAY > 0 ? typicalSoFar / (TODAY * BUCKET_DAYS) : 0;
    const paceVsTypical =
        typicalSeries && typicalSoFar > 0 ? (monthSoFar / typicalSoFar - 1) * 100 : null;
    /* One name for the typical curve everywhere it appears. The old copy
       claimed "all prior months" in two places and "the last 3 months" in a
       third, while the SQL averages every period strictly before the previous
       one — three phrasings, two of them false.

       The sample count stays OUT of the name: it changes on every ◀ press, so
       a label that should be a fixed identity would become a moving number,
       and at 10.5px in a quarter-width cell it truncated away the very digit
       it existed to show. The chart's sub-copy carries the quantified
       version. */
    const typicalLabel = `Typical ${noun}`;

    /* Bucket-unit-aware label so KPIs read sensibly across granularities
       ("Day 5 of 7" for week, "Week 3 of 13" for quarter, etc.). */
    const bucketLabel = BUCKET_UNIT === "week" ? "Week" : BUCKET_UNIT === "month" ? "Month" : "Day";

    /* Heaviest single bucket of the selected period. Fills the KPI slot a
       completed period vacates: at period end `projected` collapses to
       exactly `monthSoFar`, so keeping "Projected" there would restate
       "Total spent" one cell over. A distribution fact doesn't. */
    const biggestBucket = useMemo(() => {
        let bestIdx = -1;
        let best = 0;
        for (let i = 0; i < Math.min(TODAY, CUR_DAILY.length); i++) {
            const v = CUR_DAILY[i] ?? 0;
            if (v > best) {
                best = v;
                bestIdx = i;
            }
        }
        if (bestIdx < 0) return null;
        return { amount: best, date: bucketDateAt(BUCKET_UNIT, period.start, bestIdx) };
    }, [CUR_DAILY, TODAY, BUCKET_UNIT, period.start]);

    const bucketNoun = bucketLabel.toLowerCase();

    /* Split into two fixed lines — see the chart card's header. */
    const chartProgressCopy = isLive
        ? `${bucketLabel} ${TODAY} of ${DAYS_IN_MONTH} · the dotted line projects to ${noun}-end at the current pace.`
        : `Complete ${noun} · all ${DAYS_IN_MONTH} ${bucketNoun}s.`;
    const chartTypicalCopy = typicalSeries
        ? `The green line is a typical ${noun}, averaged across the ${AVG_PERIODS} ${noun}s before ${prevShort}.`
        : `Not enough history before ${prevShort} to draw a typical ${noun} yet.`;

    /* Four tiles, always — one per question: how much, versus last time,
       versus normal, and (live) where it's heading / (closed) when the
       spike was. "Daily burn" used to sit here too, but it is the same
       number as the Velocity card's first row, and a 5th tile wrapped to a
       second row as a lone quarter-width cell whose appearance/disappearance
       moved everything below the strip. Absent comparisons render as an
       em-dash rather than dropping a tile, so the strip's height is fixed. */
    const kpiItems: KpiItem[] = [
        {
            label: isLive ? "Spent so far" : "Total spent",
            value: monthSoFar,
            money: true,
            sub: isLive
                ? `${bucketLabel} ${TODAY} of ${DAYS_IN_MONTH}`
                : `All ${DAYS_IN_MONTH} ${bucketNoun}s`,
        },
        {
            /* "Pace" is a partial-period word — a finished period has a
               final comparison, not a pace. */
            label: isLive ? `Pace vs last ${noun}` : `Vs ${prevShort}`,
            value: paceDelta === null ? "—" : paceDelta,
            valueFormat: "percent",
            /* No prior-period spend → neutral, no tone color and no
               "ahead/behind" copy that misreads as good/bad. */
            tone: paceDelta == null ? "muted" : paceDelta > 0 ? "expense" : "income",
            sub:
                paceDelta == null
                    ? /* `PREV_LENGTH === 0` means "no rows before this period
                         *matching the filters*", so it can't be reported as
                         the prior period not existing while a filter is on. */
                      hasPrevious || hasAnyFilter
                        ? `No spend in ${prevShort} to compare`
                        : `Before your first record`
                    : isLive
                      ? paceDelta > 0
                          ? "ahead — spending faster"
                          : "behind — spending slower"
                      : paceDelta > 0
                        ? `more than ${prevShort}`
                        : `less than ${prevShort}`,
        },
        {
            label: "Vs typical",
            value: paceVsTypical === null ? "—" : paceVsTypical,
            valueFormat: "percent",
            tone: paceVsTypical === null ? "muted" : paceVsTypical > 0 ? "expense" : "income",
            sub:
                paceVsTypical === null
                    ? `Too little history yet`
                    : isLive
                      ? paceVsTypical > 0
                          ? "above your typical pace"
                          : "below your typical pace"
                      : paceVsTypical > 0
                        ? `above your typical ${noun}`
                        : `below your typical ${noun}`,
        },
        isLive
            ? {
                  label: `Projected ${noun}`,
                  value: projected,
                  money: true,
                  sub: `${prevShort}: ${formatMoneyShort(lastMonthFull)}`,
              }
            : {
                  label: `Biggest ${bucketNoun}`,
                  value: biggestBucket?.amount ?? 0,
                  money: true,
                  tone: biggestBucket ? undefined : ("muted" as const),
                  /* Year included when it isn't the current one — a 2024
                     view otherwise reads "Thu, Mar 12" with no year. */
                  sub: biggestBucket
                      ? formatInAppTz(
                            biggestBucket.date,
                            anchorYear === getAppTzYear(now) ? "EEE, MMM d" : "EEE, MMM d yyyy"
                        )
                      : `No spend in ${periodShort}`,
              },
    ];

    const yoyMonths = yoyData?.months ?? [];
    /* Replace nulls (future months) with 0 for the bar chart so the
       layout stays — the trailing-12-month total ignores nulls. */
    const yoyThisYear = (yoyData?.thisYear ?? []).map((v) => v ?? 0);
    const yoyLastYear = (yoyData?.lastYear ?? []).map((v) => v ?? 0);
    /* A finished year has no "so far" about it — and its own future
       months don't exist, so no bar should be clickable past them. */
    const yoyIsCurrentYear = yoyYear === getAppTzYear(now);
    const yoyFutureFromIdx = yoyIsCurrentYear ? getAppTzMonth(now) + 1 : 12;
    /* This card is the one place a *year* identity is displayed, and the
       stepper flips `yoyYear` a beat before the query lands — so the title
       would read "2025 vs 2024" over 2026's bars. Compare identities rather
       than watching a loading flag. */
    const yoyStale = yoyData !== null && yoyData.year !== yoyYear;

    /* Compare same-window-of-year on both sides so the headline delta
       isn't asymmetric YTD-vs-FY. Mid-May with flat YoY spend should read
       ~0%, not ~-58%.

       COMPLETE months only. The current month is itself still in progress —
       including it pitted a 1-day August against a full August, reading −12%
       on 1 Aug with flat spend in both years.

       Read off the clock rather than off the server's `null` sentinel: the
       sentinel is a *drawing* hint (nulls start at the current month), and in
       December there is no null at all, so a sentinel-derived cutoff silently
       fell back to all 12 and compared Jan 1–Dec 5 against a full year while
       labelling it "Jan–Dec". A 0-based month index IS the count of complete
       months: Jan → 0, Aug → 7, Dec → 11. */
    const yoyWindowMonths = yoyIsCurrentYear ? getAppTzMonth(now) : 12;
    const yoyThisTotal = (yoyData?.thisYear ?? [])
        .slice(0, yoyWindowMonths)
        .reduce<number>((s, v) => s + (v ?? 0), 0);
    const yoyLastTotal = (yoyData?.lastYear ?? [])
        .slice(0, yoyWindowMonths)
        .reduce<number>((s, v) => s + (v ?? 0), 0);
    /* `null` ⇒ nothing to compare against (the first year of history, or
       January before any month has closed). Rendering 0% there would read
       as "no change" rather than "no comparison". */
    const yoyTotalDelta =
        yoyWindowMonths > 0 && yoyLastTotal > 0 ? (yoyThisTotal / yoyLastTotal - 1) * 100 : null;
    const yoyHeaviestGrowth = useMemo(() => {
        if (!yoyData) return null;
        let bestIdx = -1;
        let bestPct = -Infinity;
        /* Complete months only, matching the total beside it — otherwise a
           1-day current month could win "heaviest growth" while being
           excluded from the percentage it sits next to. */
        for (let i = 0; i < yoyWindowMonths; i++) {
            const cur = yoyData.thisYear[i];
            const prv = yoyData.lastYear[i];
            if (cur == null || prv == null || prv === 0) continue;
            const p = (cur / prv - 1) * 100;
            if (p > bestPct) {
                bestPct = p;
                bestIdx = i;
            }
        }
        /* A max over signed changes still returns something when every month
           fell — the least-bad decline, captioned "Heaviest growth" and
           painted in expense red. There is no growth to name in that year, so
           the line is omitted rather than inverted. */
        if (bestIdx < 0 || bestPct <= 0) return null;
        return { month: yoyData.months[bestIdx], pct: bestPct };
    }, [yoyData, yoyWindowMonths]);
    /* Months before the space's first spend are equally un-navigable —
       clicking one lands on the `beforeHistory` card.

       Tested against the period that would ACTUALLY open, not against the
       month itself: on week granularity, opening "Apr" anchors on Apr 1 and
       `startOfIsoWeek` can resolve to the week of Mar 30, which may predate
       history even though April does not. */
    const yoyPastUntilIdx = useMemo(() => {
        if (!earliestPeriodStart) return 0;
        const edge = earliestPeriodStart.getTime();
        for (let m = 0; m < 12; m++) {
            const opens = startOfPeriod(granularity, makeAppTzDate(yoyYear, m, 1));
            if (opens.getTime() >= edge) return m;
        }
        return 12;
    }, [earliestPeriodStart, yoyYear, granularity]);
    /* Which bar is the period being viewed. On quarter granularity the whole
       span highlights, since clicking any of its months re-opens it. Year is
       deliberately `null` — a band over all twelve marks nothing, and
       `openMonth` switches to Month there so no column is "already open". */
    const yoySelectedRange = useMemo((): [number, number] | null => {
        if (getAppTzYear(period.start) !== yoyYear) return null;
        const first = getAppTzMonth(period.start);
        if (granularity === "month") return [first, first];
        if (granularity === "quarter") return [first, first + 2];
        return null;
    }, [granularity, period.start, yoyYear]);
    const moversStale = isPersonal
        ? moversPersonalQ.isPlaceholderData
        : moversSpaceQ.isPlaceholderData;

    /* Centre the selected month chip — opening December from the stepper
       otherwise left the row parked on Jan–Jun, reading as though nothing
       were selected.

       Sets `scrollLeft` directly rather than calling `scrollIntoView`, which
       walks EVERY scrollable ancestor including the document: on a phone this
       row sits below the fold, so each ◀ press dragged the whole page down to
       it — undoing the `preventScrollReset` this same change added. */
    const chipRowRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const row = chipRowRef.current;
        const chip = row?.querySelector<HTMLElement>('[aria-current="true"]');
        if (!row || !chip) return;
        row.scrollLeft = chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2;
        /* `yoyMonths.length` is in the deps because the chips don't exist until
           the year-over-year query lands, and neither other dep changes then. */
    }, [yoySelectedRange, yoyYear, yoyMonths.length]);

    return (
        <AnalyticsDetailLayout
            title="Spending trends"
            description={
                mode === "cash"
                    ? "Cash outflow over time — includes cross-space transfer principal as spending. Switch to Operational for the true expense-only view."
                    : "True expense over time — transfer principal excluded; only real expenses and transfer fees count as spending."
            }
            actions={<MetricToggle />}
        >
            <TrendsPeriodBar
                granularity={granularity}
                onGranularityChange={setGranularity}
                label={periodLabel}
                /* Always rendered, even at year granularity where "Jan 1 –
                   Dec 31" adds little: conditionally dropping the line changed
                   the bar's height, so switching from a year view to a month
                   (which a year-over-year bar click does) shifted the whole
                   page down. */
                rangeLabel={formatPeriodRange(granularity, period.start)}
                isLive={isLive}
                canGoBack={canGoBack}
                prevLabel={prevLabel}
                nextLabel={formatPeriodLabel(granularity, addPeriods(granularity, period.start, 1))}
                onStep={stepPeriod}
                onJumpToNow={() => setAnchor(null)}
            />
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

            {beforeHistory ? (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                        <p className="text-sm font-medium">Nothing recorded in {periodLabel}</p>
                        <p className="max-w-sm text-xs text-muted-foreground">
                            {/* Period label, not a formatted date: the wire
                                value is `date_trunc(granularity, …)`, so
                                printing it as "MMMM d" would invent a
                                day — claiming "starts July 1" when the
                                first transaction was July 23. */}
                            Your spending history starts in{" "}
                            {formatPeriodLabel(granularity, earliestPeriodStart!)}, so there's
                            nothing to chart before then.
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAnchor(earliestPeriodStart)}
                        >
                            Go to {formatPeriodLabel(granularity, earliestPeriodStart!)}
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {/* Values are skeletoned rather than dimmed while held
                        data is on screen — the labels have already moved to
                        the new period, and a dimmed wrong number is still a
                        wrong number. */}
                    <KpiStrip items={kpiItems} isLoading={dailyLoading || dailyStale} />

                    <Card>
                        <CardHeader>
                            <CardTitle>
                                {/* At year granularity the YoY card directly
                                    below owns the year-vs-year comparison, so
                                    naming it here says it twice. */}
                                Cumulative spend · {periodLabel}
                                {granularity === "year" || !hasPrevious ? "" : ` vs ${prevShort}`}
                            </CardTitle>
                            {/* Two single-line spans rather than one wrapping
                                paragraph: the live and closed sentences differ
                                enough in length that one flipped between 1 and
                                2 rendered lines, moving every card below by a
                                line box on each period step. */}
                            <div className="flex flex-col text-xs text-muted-foreground">
                                <span className="truncate" title={chartProgressCopy}>
                                    {chartProgressCopy}
                                </span>
                                <span className="truncate" title={chartTypicalCopy}>
                                    {chartTypicalCopy}
                                </span>
                            </div>
                        </CardHeader>
                        <CardContent
                            className={cn(
                                "flex flex-col gap-4 transition-opacity duration-150",
                                dailyStale && "opacity-80"
                            )}
                        >
                            {dailyLoading ? (
                                <Skeleton className="h-[478px] w-full" />
                            ) : (
                                <CumulativeRaceChart
                                    cur={cumulative.cur}
                                    prv={hasPrevious ? cumulative.prv : null}
                                    prvLength={PREV_LENGTH}
                                    avg={typicalSeries}
                                    today={TODAY}
                                    daysInMonth={DAYS_IN_MONTH}
                                    /* `null` on a completed period: nothing
                                       is left to forecast, and the curve
                                       already reaches the right edge —
                                       which was the projection's only job. */
                                    projection={isLive ? projected : null}
                                    bucketUnit={BUCKET_UNIT}
                                    periodStart={period.start}
                                    curLabel={isLive ? "This (so far)" : periodShort}
                                    prvLabel={isLive ? "Last" : prevShort}
                                    emptyLabel={
                                        hasAnyFilter
                                            ? `No spend matching these filters in ${periodLabel}.`
                                            : isLive
                                              ? "No spend recorded in this window yet."
                                              : `No spend recorded in ${periodLabel}.`
                                    }
                                />
                            )}
                            {/* Endpoint strip — replaces the inline right-edge
                        labels that used to overlap. Each row is a single
                        line's identity + its terminal value. Reads
                        top-to-bottom in the same visual order as the
                        chart's lines stack at period end. */}
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border/40 pt-3 text-[11.5px] lg:grid-cols-4">
                                <EndpointStat
                                    loading={dailyStale}
                                    color="var(--warning)"
                                    kind="solid"
                                    label={isLive ? `This ${noun} (so far)` : periodShort}
                                    value={monthSoFar}
                                />
                                <EndpointStat
                                    loading={dailyStale}
                                    color="var(--muted-foreground)"
                                    kind="dashed"
                                    label={isLive ? `Last ${noun}` : prevShort}
                                    /* `null` ⇒ em-dash. The prior period
                                       having no record at all is not the
                                       same claim as it having spent zero,
                                       and the earliest period of every
                                       space is one ◀ press away. */
                                    value={hasPrevious ? lastMonthFull : null}
                                />
                                {isLive ? (
                                    <EndpointStat
                                        loading={dailyStale}
                                        color="var(--warning)"
                                        kind="dotted"
                                        label="Projection"
                                        value={projected}
                                    />
                                ) : (
                                    /* The slot the projection vacates answers the
                               question the two finished curves pose. */
                                    <EndpointStat
                                        loading={dailyStale}
                                        color={
                                            monthSoFar - lastMonthFull > 0
                                                ? "var(--expense)"
                                                : "var(--income)"
                                        }
                                        kind="solid"
                                        label="Difference"
                                        value={hasPrevious ? monthSoFar - lastMonthFull : null}
                                        signed
                                    />
                                )}
                                {/* Always rendered so the strip keeps four
                                    columns — dropping it reflowed the row. */}
                                <EndpointStat
                                    loading={dailyStale}
                                    color="var(--income)"
                                    kind="solid"
                                    label={typicalLabel}
                                    value={typicalSeries ? typicalFull : null}
                                />
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
                                    {yoyYear} (solid) vs {yoyYear - 1} (faded). Click any month to
                                    open it.
                                </p>
                            </CardHeader>
                            <CardContent
                                className={cn(
                                    "flex flex-col gap-3 transition-opacity duration-150",
                                    yoyStale && "opacity-80"
                                )}
                            >
                                <YoYBars
                                    labels={yoyMonths}
                                    thisYear={yoyThisYear}
                                    lastYear={yoyLastYear}
                                    yearThis={yoyYear}
                                    yearLast={yoyYear - 1}
                                    selectedRange={yoySelectedRange}
                                    navFromIdx={yoyPastUntilIdx}
                                    navUntilIdx={yoyFutureFromIdx}
                                    onSelectMonth={(idx) => openMonth(yoyYear, idx)}
                                />
                                {/* Touch path for the same navigation. The
                                    in-chart column overlays are only ~22px
                                    wide at 375px with no spacing between
                                    them, which is a mis-tap guarantee; these
                                    are real 36px-high targets. */}
                                {yoyMonths.length > 0 && yoyFutureFromIdx > yoyPastUntilIdx ? (
                                    <div className="sm:hidden">
                                        {/* Captioned so a row of twelve month
                                            buttons under a bar chart reads as
                                            navigation rather than as a filter
                                            duplicating the axis above it. */}
                                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                            Open a month
                                        </p>
                                        {/* `-m-1 p-1` rather than `-mx-1 px-1`:
                                            `overflow-x-auto` also clips
                                            vertically, and without the top
                                            inset the focus ring was cut off. */}
                                        <div
                                            ref={chipRowRef}
                                            className="-m-1 flex gap-1.5 overflow-x-auto p-1"
                                            role="group"
                                            aria-label={`Open a month of ${yoyYear}`}
                                        >
                                            {yoyMonths.map((l, i) => {
                                                const navigable =
                                                    i >= yoyPastUntilIdx && i < yoyFutureFromIdx;
                                                const selected =
                                                    yoySelectedRange !== null &&
                                                    i >= yoySelectedRange[0] &&
                                                    i <= yoySelectedRange[1];
                                                if (!navigable) return null;
                                                return (
                                                    <Button
                                                        key={l}
                                                        variant="outline"
                                                        size="sm"
                                                        className={cn(
                                                            "h-9 shrink-0 px-3 text-[12.5px]",
                                                            /* Matches the amber
                                                               the in-chart
                                                               marker and the
                                                               filter chips use
                                                               for "active". */
                                                            selected &&
                                                                "border-warning/50 bg-warning/10 text-foreground"
                                                        )}
                                                        aria-label={`Open ${l} ${yoyYear}`}
                                                        aria-current={selected ? "true" : undefined}
                                                        onClick={() => openMonth(yoyYear, i)}
                                                    >
                                                        {l}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null}
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
                                    <span>
                                        {yoyTotalDelta === null ? (
                                            <span className="font-semibold">—</span>
                                        ) : (
                                            <span
                                                className={cn(
                                                    "font-semibold",
                                                    yoyTotalDelta > 0
                                                        ? "text-[color:var(--expense)]"
                                                        : "text-[color:var(--income)]"
                                                )}
                                            >
                                                {yoyTotalDelta > 0 ? "+" : ""}
                                                {yoyTotalDelta.toFixed(0)}%
                                            </span>
                                        )}{" "}
                                        · {yoyYear} vs {yoyYear - 1}
                                        {/* Names the window instead of a vague
                                            "(so far)": the totals cover
                                            complete months only, so the
                                            in-progress month is excluded from
                                            both sides. Gated on a loaded
                                            12-month array — an empty one made
                                            this read "(Jan–undefined)". */}
                                        {yoyIsCurrentYear && yoyMonths.length === 12
                                            ? yoyWindowMonths > 0
                                                ? ` (Jan–${yoyMonths[yoyWindowMonths - 1]})`
                                                : " (no complete months yet)"
                                            : ""}
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
                                <p className="text-xs text-muted-foreground">
                                    {isLive
                                        ? "Spend per day — how fast money is leaving."
                                        : "Spend per day — how fast money left."}
                                </p>
                            </CardHeader>
                            <CardContent
                                className={cn(
                                    "flex flex-1 flex-col gap-2.5 transition-opacity duration-150",
                                    dailyStale && "opacity-80"
                                )}
                            >
                                {/* Three comparison bars on a shared scale plus
                                    one acceleration chip, the pattern the
                                    envelope detail page uses. It replaced four
                                    stacked label/number/sub boxes that cost
                                    ~264px to say what ~130px says better: three
                                    rates are a comparison, and a comparison
                                    wants bars, not three separately-boxed
                                    numbers the reader has to diff by eye.
                                    Hues match the chart above — amber for the
                                    viewed period, muted for the prior one,
                                    green dashed for typical — so the card reads
                                    as a legend for that chart. */}
                                <VelocityBars
                                    loading={dailyStale}
                                    rows={[
                                        {
                                            label: isLive ? `This ${noun}` : periodShort,
                                            value: curDailyAvg,
                                            color: "var(--warning)",
                                            kind: "solid",
                                        },
                                        {
                                            label: isLive ? `Last ${noun}` : prevShort,
                                            /* Over the prior period's OWN length —
                                               January is 31 days even when
                                               you're looking at February. */
                                            value: prevDailyAvg,
                                            color: "var(--muted-foreground)",
                                            kind: "solid",
                                        },
                                        {
                                            label: "Typical",
                                            value: typicalSeries ? typicalDailyAvg : null,
                                            color: "var(--income)",
                                            kind: "outline",
                                        },
                                    ]}
                                    delta={burnDelta}
                                    deltaSub={
                                        burnDelta === null
                                            ? !hasPrevious
                                                ? `No earlier ${noun} to compare`
                                                : `No spend in ${prevShort} to compare`
                                            : `vs ${prevShort} per day`
                                    }
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
                                            periodShort={periodShort}
                                            prevShort={prevShort}
                                            isLive={isLive}
                                        />
                                    ) : hasPrevious ? (
                                        <>
                                            Biggest movers ·{" "}
                                            {isLive ? `${periodShort} so far` : periodShort} vs{" "}
                                            {prevShort}
                                        </>
                                    ) : (
                                        /* Nothing to have moved from — this is
                                           a ranking, not a comparison. */
                                        <>Top categories · {periodShort}</>
                                    )}
                                </CardTitle>
                                <p className="text-xs text-muted-foreground">
                                    {/* Three states, keyed off the filter rather
                                        than off `mode`: with 2+ categories
                                        selected the rows are the SELECTED
                                        categories at whatever depth the user
                                        picked, so calling them top-level is
                                        false. */}
                                    {moversMode === "drill"
                                        ? `Sub-categories with the largest change vs ${prevShort}.`
                                        : !hasPrevious
                                          ? `Where the money went in ${periodShort}.`
                                          : categoryIds.length >= 2
                                            ? `The categories you've selected, with the largest change vs ${prevShort} — each including everything tagged beneath it.`
                                            : `Top-level categories with the largest change vs ${prevShort}, including everything tagged beneath them.`}
                                    {/* A running period compares equal elapsed
                                        slices, so on the 1st it is one day
                                        against one day — the card has to say so
                                        rather than implying two whole months. */}
                                    {isLive && hasPrevious
                                        ? ` ${periodShort} is only part-way through, so most categories will read as falls until it catches up with all of ${prevShort}.`
                                        : ""}
                                </p>
                            </div>
                        </CardHeader>
                        <CardContent
                            className={cn(
                                "transition-opacity duration-150",
                                moversStale && "opacity-80"
                            )}
                        >
                            {moversData.length === 0 ? (
                                <p className="py-8 text-center text-sm text-muted-foreground">
                                    {hasAnyFilter
                                        ? `No movement matching the current filters in ${periodShort}.`
                                        : !hasPrevious
                                          ? `Nothing spent in ${periodShort} yet.`
                                          : `No category movement between ${periodShort} and ${prevShort}.`}
                                </p>
                            ) : (
                                <MoversList
                                    items={moversData}
                                    hasPrevious={hasPrevious}
                                    isLive={isLive}
                                    tickCur={formatPeriodTick(granularity, period.start)}
                                    tickPrev={formatPeriodTick(granularity, prevPeriod.start)}
                                    periodShort={periodShort}
                                    prevShort={prevShort}
                                />
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </AnalyticsDetailLayout>
    );
}

/* ============================================================
   PERIOD NAVIGATION
   ============================================================ */

/**
 * Period stepper + granularity selector. Deliberately *not* a
 * `PeriodChip` / date-range picker: every number on this page is a
 * period-progress metric. A ragged range makes `periodLength` arbitrary
 * (so "Day 12 of 31" means nothing), leaves `previous` a shifted window
 * with a different day count, gives `average` no bucket positions to
 * average over, and makes the movers' comparison window straddle two
 * calendar months. Aligned whole periods keep all of it defined; the
 * other analytics views, which merely aggregate over a window, are the
 * ones `PeriodChip` is right for.
 */
function TrendsPeriodBar({
    granularity,
    onGranularityChange,
    label,
    rangeLabel,
    isLive,
    canGoBack,
    prevLabel,
    nextLabel,
    onStep,
    onJumpToNow,
}: {
    granularity: Granularity;
    onGranularityChange: (g: Granularity) => void;
    label: string;
    /** `null` when the headline already states the span (week, year). */
    rangeLabel: string;
    isLive: boolean;
    canGoBack: boolean;
    /** Names the *target* of each arrow, not its direction — a screen
     *  reader user hears where they're going. */
    prevLabel: string;
    nextLabel: string;
    onStep: (delta: number) => void;
    onJumpToNow: () => void;
}) {
    return (
        <div
            className={cn(
                /* `sm:flex-wrap` is load-bearing: the label column is fixed
                   width (so the ▶ arrow doesn't slide as the label changes),
                   which leaves nothing to absorb a squeeze. The sidebar lands
                   at the same 768px breakpoint where the main column's padding
                   grows, so content width DROPS there — without wrapping, the
                   row overflowed and scrolled the whole page from 768–915px. */
                "-mt-1 flex flex-col gap-2 rounded-xl border px-2.5 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-3",
                /* Calm but unmistakable: the tint plus the "Complete"
                   suffix plus the absence of every deictic word ("this",
                   "so far", "Today") is the signal. A banner would cost a
                   row on every step and read as a warning. */
                isLive ? "border-border bg-card" : "border-warning/40 bg-warning/10"
            )}
        >
            <div role="group" aria-label="Period" className="flex items-center gap-0.5 sm:gap-1">
                {/* Both arrows stay enabled and use `aria-disabled`. A
                    `disabled` button loses focus the moment it disables
                    under its own click (stepping to the edge of history
                    dumps a keyboard user back to <body>), and
                    `buttonVariants` sets `disabled:pointer-events-none`,
                    which makes the explanatory `title` unreachable. */}
                <Button
                    variant="ghost"
                    size="icon"
                    /* `cursor-not-allowed` + neutralised hover because these
                       aren't `disabled` (see above) — the base stylesheet's
                       `button:not(:disabled){cursor:pointer}` and the ghost
                       variant's hover fill would otherwise advertise a click
                       that does nothing. */
                    className={cn(
                        "size-9 shrink-0 sm:size-8",
                        !canGoBack &&
                            "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-current"
                    )}
                    aria-disabled={!canGoBack}
                    aria-label={canGoBack ? `Go to ${prevLabel}` : "No earlier data"}
                    title={canGoBack ? `Go to ${prevLabel}` : "No earlier data"}
                    onClick={() => canGoBack && onStep(-1)}
                >
                    <ChevronLeft className="size-4" />
                </Button>
                {/* Fixed width at ≥sm so the ▶ arrow doesn't slide sideways as
                    the label length changes — otherwise stepping repeatedly
                    means chasing the button. 232px fits the longest string,
                    "Week of Sep 29, 2025 · Complete"; at 190px it truncated
                    the year off every desktop screen.

                    aria-live sits here rather than on the group so a step
                    announces the period once, atomically — on the group it
                    also re-announced both arrows' target labels. */}
                <div
                    aria-live="polite"
                    aria-atomic="true"
                    className="min-w-0 flex-1 px-1 text-center sm:w-[232px] sm:flex-none sm:px-1.5 sm:text-left"
                >
                    <p className="truncate text-[14.5px] font-semibold leading-tight">
                        {label}
                        <span
                            className={cn(
                                "ml-1.5 text-[11px] font-medium",
                                isLive ? "text-muted-foreground" : "text-[color:var(--warning)]"
                            )}
                        >
                            {/* "In progress", not "Now" — "Now" is the jump
                                button's label, and one word shouldn't mean
                                two things across the bar's two states. */}
                            · {isLive ? "In progress" : "Complete"}
                        </span>
                    </p>
                    <p className="truncate text-[10.5px] text-muted-foreground">{rangeLabel}</p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "size-9 shrink-0 sm:size-8",
                        isLive &&
                            "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-current"
                    )}
                    /* Forward travel stops at the live period. Not merely
                       "no data": `previous` and `average` are anchored
                       relative, so a future period returns an all-zero
                       current series against a real prior one and reads
                       as "100% below typical". */
                    aria-disabled={isLive}
                    aria-label={
                        isLive ? `${label} is the current ${granularity}` : `Go to ${nextLabel}`
                    }
                    title={isLive ? `${label} is the current ${granularity}` : `Go to ${nextLabel}`}
                    onClick={() => !isLive && onStep(1)}
                >
                    <ChevronRight className="size-4" />
                </Button>
            </div>
            <div className="flex items-center gap-2">
                <GranularityToggle value={granularity} onChange={onGranularityChange} />
                {/* Always rendered, so the row's width doesn't change
                    between live and historical — which is what made it wrap
                    to a third line at 360px. */}
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        "h-9 shrink-0 gap-1.5 text-[12.5px]",
                        isLive &&
                            "cursor-not-allowed opacity-50 hover:bg-background hover:text-foreground"
                    )}
                    aria-disabled={isLive}
                    aria-label={
                        isLive ? "Already on the current period" : "Jump to the current period"
                    }
                    onClick={() => !isLive && onJumpToNow()}
                >
                    <Undo2 className="size-3.5" /> Now
                </Button>
            </div>
        </div>
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
    prvLength,
    avg,
    today,
    daysInMonth,
    projection,
    bucketUnit,
    periodStart,
    curLabel = "This (so far)",
    prvLabel = "Last",
    emptyLabel = "No spend recorded in this window yet.",
}: {
    cur: number[];
    /** Cumulative prior-period series, or `null` when there is no prior
     *  period on record — a flat line along the baseline would claim it
     *  spent nothing, which is a different statement. */
    prv: number[] | null;
    /**
     * The prior period's own bucket count. It can differ from
     * `daysInMonth` (January has 31 days, February 28), so the dashed
     * curve gets its own x-scale and both curves race on "fraction of the
     * period elapsed". Sharing the current period's scale would either
     * overflow the plot on the right or flat-line for the last few
     * buckets. Defaults to `prv.length` for callers with equal-length
     * periods.
     */
    prvLength?: number;
    /** Cumulative-typical-shape array — `avg[i]` is the mean of all
     *  prior periods' spend up through bucket position `i` (cumulated
     *  by the caller). `null` when no prior data exists, in which
     *  case the average curve is hidden. */
    avg: number[] | null;
    today: number;
    daysInMonth: number;
    /**
     * `null` ⇒ the period is complete: no projection segment, no
     * projection endpoint, and no "Today" marker. A finished period has
     * a real final total sitting at the right edge, which is all the
     * projection was ever standing in for, and there is no "today"
     * inside a month that already ended.
     */
    projection: number | null;
    /** Drives the hover tooltip's bucket label ("Day 5", "Month 11"). */
    bucketUnit: "day" | "week" | "month";
    /** Start of the current period in absolute time. Required for the
     *  date column on the tooltip and the X-axis ticks. Together with
     *  `bucketUnit` it fully resolves each bucket index → wall-clock
     *  date in APP_TIMEZONE. */
    periodStart: Date;
    /** Tooltip row labels for the two data curves. Default to the
     *  in-progress wording; a completed period passes concrete period
     *  names ("July" / "June") instead. */
    curLabel?: string;
    prvLabel?: string;
    /** Copy for the no-data card — the caller knows which period is
     *  empty, and "in this window yet" is wrong for a closed one. */
    emptyLabel?: string;
}) {
    /** Real-world date of bucket position `i` (0-based) given the
     *  current period's start and the bucket unit. Used for both the
     *  axis labels and the tooltip's date column. */
    const bucketDate = (i: number): Date => bucketDateAt(bucketUnit, periodStart, i);
    /* A completed period: the caller withheld a projection. */
    const isComplete = projection === null;

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
    /* The prior series' own bucket count — see the `prvLength` prop. */
    const prvLen = Math.max(1, prvLength ?? prv?.length ?? 0);
    const prvEndpoint = prv ? (prv[Math.min(prvLen, prv.length) - 1] ?? 0) : 0;
    const rawMax = Math.max(
        prvEndpoint,
        cur[today - 1] ?? 0,
        /* Excluded on a completed period — leaving it in would reserve
           headroom for a line that isn't drawn, flattening the curve. */
        projection ?? 0,
        avgEndpoint
    );
    const noData = !Number.isFinite(rawMax) || rawMax <= 0 || cur.length === 0;
    const max = (rawMax > 0 ? rawMax : 1) * 1.1;
    const sx = (i: number) => p + (i / Math.max(1, daysInMonth - 1)) * (w - p * 2);
    /* Prior-period x-scale, normalised to its own length so the two curves
       race on fraction-of-period-elapsed and both land on the right edge.
       Feb-vs-Jan on a shared scale either overflowed the plot or plateaued
       for the last three buckets. */
    const sxPrev = (i: number) => p + (i / Math.max(1, prvLen - 1)) * (w - p * 2);
    const sy = (v: number) => h - p - (v / max) * (h - p * 2);
    const todayX = sx(today - 1);
    const todayY = sy(cur[today - 1] ?? 0);

    const prvPath = prv
        ? prv
              .slice(0, prvLen)
              .map((v, i) => `${i ? "L" : "M"}${sxPrev(i).toFixed(1)} ${sy(v).toFixed(1)}`)
              .join(" ")
        : null;
    const curSlice = cur.slice(0, today);
    const curPath = curSlice
        .map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`)
        .join(" ");
    const projPath =
        projection === null
            ? null
            : `M${todayX} ${todayY} L${sx(daysInMonth - 1)} ${sy(projection)}`;

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
    const projY = projection === null ? null : sy(projection);
    const lastY = sy(prvEndpoint);

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
    /* The prior curve is drawn on its own x-scale, so a hover at bucket `i`
       of the current period reads the prior series at the same *fraction*
       through its period — keeping the hover dot on the visible line. */
    const prvIdxAt = (i: number) =>
        Math.max(
            0,
            Math.min(prvLen - 1, Math.round((i / Math.max(1, daysInMonth - 1)) * (prvLen - 1)))
        );
    const bucketLabelSingular =
        bucketUnit === "month" ? "Month" : bucketUnit === "week" ? "Week" : "Day";

    if (noData) {
        return (
            <div
                className="flex w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/10"
                /* +18 for the date-axis row the real chart renders below its
                   SVG — without it, stepping into an empty period shrank this
                   card and moved everything below. */
                style={{ height: h + 18 }}
            >
                <span className="text-sm text-muted-foreground">{emptyLabel}</span>
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

                    {/* Today marker line — omitted on a completed period.
                        There is no "today" inside a month that already
                        ended, and it would sit on the right plot edge
                        marking nothing. No substitute end-of-period rule
                        either: the axis and the edge already say that. */}
                    {isComplete ? null : (
                        <line
                            x1={todayX}
                            x2={todayX}
                            y1={p}
                            y2={h - p}
                            stroke="var(--warning)"
                            strokeOpacity={0.4}
                            strokeDasharray="3 4"
                        />
                    )}

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

                    {/* Last period line (dashed muted) — absent entirely when
                        there is no prior period on record. */}
                    {prvPath ? (
                        <path
                            d={prvPath}
                            fill="none"
                            stroke="var(--muted-foreground)"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            opacity={0.7}
                            vectorEffect="non-scaling-stroke"
                        />
                    ) : null}
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
                    {projPath ? (
                        <path
                            d={projPath}
                            fill="none"
                            stroke="var(--warning)"
                            strokeWidth={1.5}
                            strokeDasharray="2 3"
                            opacity={0.7}
                            vectorEffect="non-scaling-stroke"
                        />
                    ) : null}

                    {/* Endpoint markers. Ringed in the page background so
                        they stay readable when they collide — on a
                        completed period the current and prior curves both
                        end at the same x, and similar totals put the two
                        dots on top of each other. */}
                    <circle
                        cx={todayX}
                        cy={todayY}
                        r={4}
                        fill="var(--warning)"
                        stroke="var(--bg)"
                        strokeWidth={1.5}
                    />
                    {projY === null ? null : (
                        <circle
                            cx={sx(daysInMonth - 1)}
                            cy={projY}
                            r={3}
                            fill="var(--warning)"
                            opacity={0.5}
                        />
                    )}
                    {prv ? (
                        <circle
                            cx={sx(daysInMonth - 1)}
                            cy={lastY}
                            r={3}
                            fill="var(--muted-foreground)"
                            stroke="var(--bg)"
                            strokeWidth={1.5}
                        />
                    ) : null}

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
                            {prv ? (
                                <circle
                                    cx={sxPrev(prvIdxAt(hoverIdx))}
                                    cy={sy(prv[prvIdxAt(hoverIdx)] ?? 0)}
                                    r={3}
                                    fill="var(--muted-foreground)"
                                    stroke="var(--bg)"
                                    strokeWidth={1.5}
                                />
                            ) : null}
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

                {isComplete ? null : (
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
                )}

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
                            label={curLabel}
                            value={hoverIdx < today ? (cur[hoverIdx] ?? 0) : null}
                            color="var(--warning)"
                        />
                        <TooltipRow
                            label={`Spent ${isComplete ? "that" : "this"} ${bucketLabelSingular.toLowerCase()}`}
                            value={hoverIdx < today ? (dailyCur[hoverIdx] ?? 0) : null}
                            color="var(--warning)"
                        />
                        <TooltipRow
                            label={prvLabel}
                            value={prv ? (prv[prvIdxAt(hoverIdx)] ?? 0) : null}
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
            /* Tighter at mobile widths: at 12.5px with px-3 the four labels
               plus the neighbouring "Now" button overflow a 360px row. */
            className="inline-flex h-9 items-center rounded-md border border-border bg-card p-0.5 text-[12px] sm:text-[12.5px]"
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
                            "h-8 rounded px-2 transition-colors sm:px-3",
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

/**
 * Year-over-year monthly bars, doubling as the page's history navigator:
 * each column is a button that opens that month in the period stepper.
 * Making these bars the jump target — rather than adding a separate
 * 12-month nav rail under the main chart — keeps the same twelve numbers
 * from being drawn twice on one page.
 */
function YoYBars({
    labels,
    thisYear,
    lastYear,
    yearThis,
    yearLast,
    selectedRange = null,
    navFromIdx = 0,
    navUntilIdx = 12,
    onSelectMonth,
}: {
    labels: string[];
    thisYear: number[];
    lastYear: number[];
    /** Year labels for the tooltip header (e.g., 2026 / 2025). */
    yearThis: number;
    yearLast: number;
    /** Inclusive `[first, last]` month span the stepper is currently on,
     *  highlighted. A quarter view highlights three columns, a year view
     *  all twelve. `null` when the viewed period isn't inside `yearThis`. */
    selectedRange?: [number, number] | null;
    /** Navigable window `[navFromIdx, navUntilIdx)` — months outside it are
     *  before the space's first spend or haven't happened yet. */
    navFromIdx?: number;
    navUntilIdx?: number;
    onSelectMonth?: (monthIdx: number) => void;
}) {
    const w = 600;
    const h = 220;
    const p = 28;
    const rawMax = Math.max(0, ...thisYear, ...lastYear);
    const noData = labels.length === 0 || rawMax <= 0;
    const max = rawMax > 0 ? rawMax : 1;
    const cw = labels.length > 0 ? (w - p * 2) / labels.length : 0;
    /* Column layout, symmetric about the column centre:
         [GROUP_GAP/2][bar][BAR_GAP][bar][GROUP_GAP/2]
       so adjacent months are separated by a full GROUP_GAP while the two
       bars of one month stay visually paired. The old layout inset the pair
       3 left / 1 right, which pushed it off-centre — the month label and the
       selection band (both column-aligned) then looked misaligned with the
       bars they belonged to. */
    const GROUP_GAP = 9;
    const BAR_GAP = 2;
    const bw = Math.max(1, (cw - GROUP_GAP - BAR_GAP) / 2);
    /** Left edge of month `i`'s bar pair. */
    const groupX = (i: number) => p + i * cw + GROUP_GAP / 2;
    const sy = (v: number) => h - p - (v / max) * (h - p * 2);

    const bandFrom = selectedRange ? Math.max(0, selectedRange[0]) : 0;
    const bandTo = selectedRange ? Math.min(labels.length - 1, selectedRange[1]) : 0;
    /* A band covering every column marks nothing — and it would suppress the
       hover affordance on all twelve, which is exactly when all twelve are
       clickable (year granularity). */
    const showBand = selectedRange !== null && !(bandFrom === 0 && bandTo === labels.length - 1);

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
                {/* Selected-period marker. Deliberately NOT an amber wash:
                    each column holds a muted prior-year bar on the left and
                    an amber current-year bar on the right, so an amber fill
                    vanished against the amber bar and only showed over the
                    grey one — reading as a shadow hanging off the column's
                    left side. A neutral band can't collide with either
                    series, and the amber baseline rule underneath it (plus
                    the bolded month label) carries the "you are here"
                    emphasis symmetrically. */}
                {showBand ? (
                    <>
                        <rect
                            x={p + bandFrom * cw + 1}
                            y={p - 6}
                            width={(bandTo - bandFrom + 1) * cw - 2}
                            height={h - p * 2 + 12}
                            fill="var(--fg-3)"
                            opacity={0.1}
                            rx={3}
                        />
                        <rect
                            x={p + bandFrom * cw + 1}
                            y={h - p}
                            width={(bandTo - bandFrom + 1) * cw - 2}
                            height={2}
                            fill="var(--warning)"
                            rx={1}
                        />
                    </>
                ) : null}
                {/* Hover band — the only pre-click affordance that the
                    columns are interactive; the current-year bar's
                    0.9→1 opacity shift is imperceptible on its own. */}
                {hoverIdx !== null &&
                hoverIdx >= navFromIdx &&
                hoverIdx < navUntilIdx &&
                !(showBand && hoverIdx >= bandFrom && hoverIdx <= bandTo) ? (
                    <rect
                        x={p + hoverIdx * cw + 1}
                        y={p - 6}
                        width={cw - 2}
                        height={h - p * 2 + 12}
                        fill="var(--fg-3)"
                        opacity={0.06}
                        rx={3}
                    />
                ) : null}
                {labels.map((l, i) => {
                    const cx = groupX(i);
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
                                x={cx + bw + BAR_GAP}
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

            {/* Navigation hit areas — full-height HTML buttons, one per
                navigable column, rather than click handlers on the SVG
                rects: a bar can be zero-height, and real buttons come with
                keyboard focus and accessible names for free.

                Un-navigable months render NO button rather than a
                `disabled` one: browsers don't dispatch mouse events to
                disabled controls, so those columns swallowed the
                container's `onMouseMove` *and* its `onMouseLeave`, freezing
                the tooltip on the last hovered month while the cursor sat
                over a column with real prior-year data to read. */}
            {onSelectMonth
                ? labels.map((l, i) => {
                      if (i < navFromIdx || i >= navUntilIdx) return null;
                      const selected =
                          selectedRange !== null && i >= selectedRange[0] && i <= selectedRange[1];
                      return (
                          <button
                              key={`nav-${l}`}
                              type="button"
                              aria-label={`Open ${l} ${yearThis} — ${(thisYear[i] ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} spent`}
                              aria-current={selected ? "true" : undefined}
                              title={`Open ${l} ${yearThis}`}
                              onClick={() => onSelectMonth(i)}
                              className="absolute top-0 hidden cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
                              style={{
                                  left: `${xPct(p + i * cw)}%`,
                                  width: `${xPct(cw)}%`,
                                  height: h - p + 16,
                                  background: "transparent",
                              }}
                          />
                      );
                  })
                : null}

            {/* Y-axis tick labels — same positions as the gridlines.
                HTML overlay so fonts don't stretch with the SVG. */}
            {[0, 1, 2, 3].map((i) => {
                const yPx = p + (i * (h - p * 2)) / 3;
                const value = ((3 - i) * max) / 3;
                return (
                    <span
                        key={`yt-${i}`}
                        className="pointer-events-none absolute text-[10px] tabular-nums text-muted-foreground"
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

            {/* Month labels — HTML overlay so fonts stay native.
                `pointer-events-none` is load-bearing: these paint after the
                nav buttons with no z-index, so without it the label text is
                the topmost hit target and clicking "Jul" — the most natural
                place to aim — does nothing. */}
            {labels.map((l, i) => {
                /* Centre on the column, not on the bar pair: the pair is
                   inset 3 left / 1 right, so centring on it nudged every
                   label right of its own column and made the selection
                   marker look misaligned. */
                const cx = p + i * cw + cw / 2;
                const selected = showBand && i >= bandFrom && i <= bandTo;
                return (
                    <span
                        key={l}
                        className={cn(
                            "pointer-events-none absolute text-[10.5px]",
                            selected ? "font-semibold text-foreground" : "text-muted-foreground"
                        )}
                        style={{
                            left: `${xPct(cx)}%`,
                            top: h - p + 6,
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
    signed = false,
    loading = false,
}: {
    color: string;
    kind: "solid" | "dashed" | "dotted";
    label: string;
    /** `null` ⇒ em-dash. "No prior period on record" is a different claim
     *  from "the prior period spent zero". */
    value: number | null;
    /** Render an explicit +/− — for the difference stat, where the sign
     *  is the point rather than incidental. */
    signed?: boolean;
    /** Held data from the previous period is still mounted. The LABEL has
     *  already flipped to the new period, so the value must not be shown —
     *  dimming it leaves a wrong number under a right label. The skeleton
     *  matches the value's line box so nothing moves. */
    loading?: boolean;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            {/* `flex` + `min-w-0` on the truncating span, not `inline-flex`
                alone: `whitespace-nowrap` makes the label's min-content the
                full text width, so without `min-w-0` automatic minimum
                sizing keeps it from shrinking and `overflow:hidden` never
                engages — the text spills into the neighbouring stat. */}
            <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <span
                    className="inline-block h-px w-3.5 shrink-0"
                    style={{
                        borderTopWidth: kind === "solid" ? 2 : 1.5,
                        borderTopStyle:
                            kind === "solid" ? "solid" : kind === "dashed" ? "dashed" : "dotted",
                        borderTopColor: color,
                    }}
                />
                <span className="min-w-0 truncate" title={label}>
                    {label}
                </span>
            </span>
            {loading ? (
                <Skeleton className="h-[22px] w-16" />
            ) : (
                <span
                    className="text-[15px] font-semibold tabular-nums"
                    style={{ color: value === null ? "var(--muted-foreground)" : color }}
                >
                    {value === null
                        ? "—"
                        : `${signed ? (value >= 0 ? "+" : "−") : ""}${(signed
                              ? Math.abs(value)
                              : value
                          ).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                </span>
            )}
        </div>
    );
}

/**
 * Velocity as three comparison bars on one shared scale, plus a single
 * acceleration chip — the pattern the envelope detail page uses
 * (`BudgetDetailPage`'s `ed-velocity-viz`).
 *
 * It replaces four stacked label/value/sub boxes. Those cost roughly twice the
 * vertical space to say less: three per-day rates are a *comparison*, and a
 * comparison is what a bar does at a glance and what three separately-boxed
 * numbers make you do by eye. Bar hues match the cumulative chart's series, so
 * this card doubles as that chart's legend.
 *
 * Rows always render — `null` becomes an em-dash with an empty track — because
 * dropping the typical row when history is thin changed this card's height,
 * and it shares a grid row with the year-over-year card.
 */
function VelocityBars({
    rows,
    delta,
    deltaSub,
    loading = false,
}: {
    rows: {
        label: string;
        /** `null` ⇒ nothing to show: em-dash, empty track. */
        value: number | null;
        color: string;
        /** `outline` marks a reference series (typical), matching the dashed
         *  treatment the cumulative chart gives the same data. */
        kind: "solid" | "outline";
    }[];
    /** Rate-vs-rate change, `null` when there's nothing to compare. */
    delta: number | null;
    deltaSub: string;
    loading?: boolean;
}) {
    /* Shared across the three rows so their lengths are comparable — that
       comparison is the entire point of the card. */
    const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
    const rising = delta != null && delta > 0;

    return (
        /* Fills the card so the bars spread and the chip sits at the bottom —
           this card is stretched to the year-over-year card's height, and
           without this the difference showed as a void under the content. */
        <div className="flex flex-1 flex-col justify-between gap-4">
            <div className="flex flex-col justify-center gap-3">
                {rows.map((r) => (
                    <div
                        key={r.label}
                        className="grid grid-cols-[minmax(0,5.5rem)_1fr_auto] items-center gap-2"
                    >
                        <span
                            className="truncate text-[11px] text-muted-foreground"
                            title={r.label}
                        >
                            {r.label}
                        </span>
                        <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.07]">
                            {loading || r.value === null ? null : (
                                <div
                                    className={cn(
                                        "h-full rounded-full",
                                        r.kind === "outline" && "border-[1.5px] border-dashed"
                                    )}
                                    style={{
                                        /* px floor, not a % one: a percentage
                                           minimum vanishes in a flexible track. */
                                        width: `${(r.value / max) * 100}%`,
                                        minWidth: r.value > 0 ? "3px" : undefined,
                                        ...(r.kind === "outline"
                                            ? { borderColor: r.color }
                                            : { backgroundColor: r.color }),
                                    }}
                                />
                            )}
                        </div>
                        {loading ? (
                            <Skeleton className="h-4 w-14" />
                        ) : (
                            <span className="text-[12px] font-medium tabular-nums">
                                {r.value === null ? (
                                    <span className="text-muted-foreground">—</span>
                                ) : (
                                    r.value.toLocaleString("en-US", { maximumFractionDigits: 0 })
                                )}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            <div
                className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg px-3 py-2.5"
                style={{
                    background:
                        delta === null
                            ? "var(--muted)"
                            : rising
                              ? "color-mix(in oklab, var(--expense) 12%, transparent)"
                              : "color-mix(in oklab, var(--income) 12%, transparent)",
                }}
            >
                {loading ? (
                    <Skeleton className="h-5 w-24" />
                ) : delta === null ? (
                    <span className="text-[11px] text-muted-foreground">{deltaSub}</span>
                ) : (
                    <>
                        {rising ? (
                            <TrendingUp
                                className="size-4 shrink-0"
                                style={{ color: "var(--expense)" }}
                            />
                        ) : (
                            <TrendingDown
                                className="size-4 shrink-0"
                                style={{ color: "var(--income)" }}
                            />
                        )}
                        <span
                            className="text-[17px] font-semibold tabular-nums"
                            style={{ color: rising ? "var(--expense)" : "var(--income)" }}
                        >
                            {delta > 0 ? "+" : ""}
                            {delta.toFixed(1)}%
                        </span>
                        <span className="text-[11px] text-muted-foreground">{deltaSub}</span>
                    </>
                )}
            </div>
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
    periodShort,
    prevShort,
    isLive,
}: {
    spaceId: string;
    rootId: string | null;
    periodShort: string;
    prevShort: string;
    isLive: boolean;
}) {
    const q = trpc.expenseCategory.listBySpace.useQuery({ spaceId }, { enabled: !!rootId });
    const name = q.data?.find((c) => c.id === rootId)?.name;
    /* Matches the non-drill title's hedge: a running period's number is a
       partial one, and dropping "so far" here made the same card claim a
       whole-month comparison the moment a category filter was applied. */
    const cur = isLive ? `${periodShort} so far` : periodShort;
    if (!name) {
        return (
            <>
                Biggest movers · {cur} vs {prevShort}
            </>
        );
    }
    return (
        <>
            Biggest movers within{" "}
            <span className="inline-block max-w-[55vw] truncate align-bottom sm:max-w-none">
                {name}
            </span>{" "}
            · {cur} vs {prevShort}
        </>
    );
}
