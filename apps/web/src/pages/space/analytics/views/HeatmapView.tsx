import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";
import { KpiStrip, type KpiItem } from "@/components/shared/KpiStrip";
import { AnalyticsDetailLayout } from "./_AnalyticsLayout";
import { AnalyticsFilterBar } from "../components/AnalyticsFilterBar";
import { useAnalyticsFilters } from "../components/useAnalyticsFilters";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import {
    addMonths,
    getAppTzDate,
    getAppTzMonth,
    getAppTzYear,
    startOfDay,
    startOfMonth,
} from "@/lib/dates";
import { formatInAppTz } from "@/lib/formatDate";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import {
    AMBER,
    computeQuantileEdges,
    bucketize,
    ramp,
    formatCompact,
} from "@/lib/spendHeatmapColor";

const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Spending calendar — twelve-month grid where every day is a real calendar
 * cell with intensity, dot markers for cadence-detected recurring charges,
 * a per-day sparkline, and a relative-month progress bar. The year's peak
 * day gets a neutral halo ring so the eye lands on it regardless of what
 * color the cell itself happens to be. Active days link straight through
 * to the filtered transaction list — a heatmap you can't interrogate is
 * just decoration.
 *
 * Layout mirrors the design canvas: 4-column × 3-row grid of month tiles.
 * Daily totals come from `spendingHeatmap`; recurring-charge dots come
 * from `recurring.list` filtered to monthly cadence.
 */
export default function HeatmapView() {
    const { space } = useCurrentSpace();
    const f = useAnalyticsFilters();

    /**
     * Window: most-recent 12 months ending at the start of the next month.
     * That gives 12 full months + the partial current one is handled by
     * the data simply being absent for future days.
     */
    const periodEnd = useMemo(
        () => addMonths(startOfMonth(new Date()), 1),
        []
    );
    const periodStart = useMemo(
        () => addMonths(periodEnd, -12),
        [periodEnd]
    );
    /** `periodStart` is a true absolute instant (app-tz midnight). The
     *  `heaviestWeeks` start dates below are native `new Date(y, m, d)`
     *  values that *represent* an app-tz calendar date but are stored at
     *  browser-local midnight — comparing or reading them against a raw
     *  instant with native getters silently drifts by a day for any
     *  browser timezone that isn't Asia/Dhaka. Re-expressing `periodStart`
     *  in that same "native Date standing in for an app-tz calendar date"
     *  frame keeps the comparison and the later `ymd(...)` field reads
     *  self-consistent regardless of the viewer's timezone. */
    const periodStartLocal = useMemo(
        () =>
            new Date(
                getAppTzYear(periodStart),
                getAppTzMonth(periodStart),
                getAppTzDate(periodStart)
            ),
        [periodStart]
    );
    /** Same local-frame conversion for the window's other edge — the most
     *  recent week in `heaviestWeeks` can run past `periodEnd` just as the
     *  earliest can run before `periodStart`; both drill-down boundaries
     *  need clamping in the same timezone frame as `w.start`/`end`. */
    const periodEndLocal = useMemo(
        () =>
            new Date(
                getAppTzYear(periodEnd),
                getAppTzMonth(periodEnd),
                getAppTzDate(periodEnd)
            ),
        [periodEnd]
    );

    const qSpace = trpc.analytics.spendingHeatmap.useQuery(
        {
            spaceId: space.id,
            periodStart,
            periodEnd,
            envelopeIds: f.envelopeIdsArg,
            accountIds: f.accountIdsArg,
            categoryIds: f.categoryIdsArg,
        },
        { enabled: !space.isPersonal }
    );
    const qPersonal = trpc.personal.spendingHeatmap.useQuery(
        { periodStart, periodEnd, accountIds: f.accountIdsArg },
        { enabled: space.isPersonal }
    );
    const q = space.isPersonal ? qPersonal : qSpace;

    /* Recurring-bill dots — derived from the cadence detector. Filters:
       - kind: 'bill' only — subscriptions (Netflix, Spotify, etc.) are
         excluded since they cluster as background noise rather than
         loud signals worth highlighting on a yearly calendar.
       - cadence: 'monthly' only — weekly/biweekly drift across days,
         yearly only fires once.
       - Top-5 by avgAmount — caps visual density so the dots stay
         signal, not noise, even for users with many recurring bills. */
    const TOP_N_BILLS = 5;
    const recurringSpaceQ = trpc.analytics.recurring.useQuery(
        { spaceId: space.id, kind: "bill" },
        { enabled: !space.isPersonal }
    );
    const recurringPersonalQ = trpc.personal.recurring.useQuery(
        { kind: "bill" },
        { enabled: space.isPersonal }
    );
    const recurringData =
        (space.isPersonal
            ? recurringPersonalQ.data
            : recurringSpaceQ.data) ?? [];
    const recurringByDay = useMemo(() => {
        const m = new Map<number, { color: string; label: string; amount: number }>();
        /* The recurring detector runs over the whole space/owned set, so
           its dots would contradict the filtered cells (e.g. a bill paid
           from an account that's been filtered out). Hide them while any
           filter is active and restore on clear. */
        if (f.hasAnyFilter) return m;
        const monthlyBills = recurringData
            .filter((r) => r.cadence === "monthly")
            .sort((a, b) => b.avgAmount - a.avgAmount)
            .slice(0, TOP_N_BILLS);
        for (const r of monthlyBills) {
            const dt = r.nextExpectedDate
                ? new Date(r.nextExpectedDate)
                : new Date(r.lastSeen);
            /* Day-of-month read in app timezone (BST), not browser-local.
               `new Date(...)` is an absolute UTC instant; `getDate()`
               would resolve in the user's browser tz and could land the
               dot one day off the actual calendar tile (which is keyed
               by `formatInAppTz`-derived ymd strings). */
            const day = Number(formatInAppTz(dt, "d"));
            const existing = m.get(day);
            /* If two bills land on the same day (e.g. rent + insurance
               on the 1st), keep the larger one — it's the louder
               signal. The other is still in the data, just not dotted. */
            if (existing && existing.amount >= r.avgAmount) continue;
            m.set(day, {
                color: "var(--expense)",
                label: r.merchant,
                amount: r.avgAmount,
            });
        }
        return m;
    }, [recurringData, f.hasAnyFilter]);
    const hasBills = recurringByDay.size > 0;

    /** Indexed lookup: `YYYY-MM-DD` → spend total. */
    const byDay = useMemo(() => {
        const m = new Map<string, number>();
        for (const r of q.data ?? []) {
            m.set(formatInAppTz(r.day, "yyyy-MM-dd"), r.total);
        }
        return m;
    }, [q.data]);

    /** Quantile edges (20/40/60/80th percentile of active days) driving cell
     *  intensity. Computed from this space's own twelve months so the ramp
     *  self-scales to whatever currency/amount range the user actually
     *  spends in, instead of fixed dollar-scale breakpoints. */
    const edges = useMemo(
        () => computeQuantileEdges(Array.from(byDay.values())),
        [byDay]
    );

    /** Median (typical) active day — a plain, absolute reference point to
     *  sit next to the average, since the calendar's own intensity scale
     *  is relative and can't answer "what does a normal day cost me?" on
     *  its own. */
    const medianActiveDay = useMemo(() => {
        const nz = Array.from(byDay.values())
            .filter((v) => v > 0)
            .sort((a, b) => a - b);
        if (nz.length === 0) return 0;
        const mid = Math.floor(nz.length / 2);
        return nz.length % 2 === 1 ? nz[mid] : (nz[mid - 1] + nz[mid]) / 2;
    }, [byDay]);

    /** Earliest day with any recorded spend in this window — used to tell
     *  "no data yet because history doesn't reach back that far" apart
     *  from "genuinely zero spend that month" on the collapsed tiles. Keys
     *  are `yyyy-MM-dd` strings, which sort lexicographically the same as
     *  chronologically, so plain string comparison is enough. */
    const earliestActiveKey = useMemo(() => {
        let min: string | null = null;
        byDay.forEach((v, key) => {
            if (v > 0 && (min === null || key < min)) min = key;
        });
        return min;
    }, [byDay]);

    /** The 12 (year, month) pairs we render, oldest → newest.
     *  Year/month are read in app timezone — `addMonths(periodStart, i)`
     *  returns a BST-aligned moment, but its UTC fields are 6 hours
     *  before BST midnight and `dt.getFullYear()` would land in the
     *  prior month for any user east of UTC at the moment of January. */
    const months = useMemo(() => {
        const list: Array<{ y: number; m: number }> = [];
        for (let i = 0; i < 12; i++) {
            const dt = addMonths(periodStart, i);
            const y = Number(formatInAppTz(dt, "yyyy"));
            const m = Number(formatInAppTz(dt, "M")) - 1; // 1-12 → 0-11
            list.push({ y, m });
        }
        return list;
    }, [periodStart]);

    /** Per-month totals + grand stats used in the header KPIs. */
    const stats = useMemo((): {
        monthTotals: Array<{ y: number; m: number; total: number }>;
        yearTotal: number;
        activeDays: number;
        peak: number;
        peakDate: Date | null;
        maxMonth: number;
    } => {
        let yearTotal = 0;
        let activeDays = 0;
        let peak = 0;
        let peakDate: Date | null = null;
        const monthTotals = months.map(({ y, m }) => {
            let total = 0;
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            for (let d = 1; d <= daysInMonth; d++) {
                const key = ymd(y, m, d);
                const v = byDay.get(key) ?? 0;
                total += v;
                if (v > 0) {
                    activeDays++;
                    if (v > peak) {
                        peak = v;
                        peakDate = new Date(y, m, d);
                    }
                }
            }
            yearTotal += total;
            return { y, m, total };
        });
        const maxMonth = Math.max(1, ...monthTotals.map((x) => x.total));
        return {
            monthTotals,
            yearTotal,
            activeDays,
            peak,
            peakDate,
            maxMonth,
        };
    }, [months, byDay]);

    /** Histogram of average daily spend by weekday — drives the by-weekday card. */
    const byWeekday = useMemo(() => {
        const sums = [0, 0, 0, 0, 0, 0, 0];
        const counts = [0, 0, 0, 0, 0, 0, 0];
        byDay.forEach((v, key) => {
            const [yStr, mStr, dStr] = key.split("-");
            const dow = new Date(
                Number(yStr),
                Number(mStr) - 1,
                Number(dStr)
            ).getDay();
            sums[dow] += v;
            counts[dow]++;
        });
        return sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
    }, [byDay]);

    /** Index of the actual heaviest weekday — drives which bar gets the
     *  accent highlight. This used to be hardcoded to Friday, which
     *  silently disagreed with the (correctly computed) caption underneath
     *  whenever Friday wasn't really the heaviest day. */
    const heaviestWeekdayIdx = useMemo(() => {
        let bestIdx = -1;
        let best = 0;
        byWeekday.forEach((v, i) => {
            if (v > best) {
                best = v;
                bestIdx = i;
            }
        });
        return bestIdx;
    }, [byWeekday]);

    /** Find the top 5 calendar weeks (Sun-Sat) by total spend. */
    const heaviestWeeks = useMemo(() => {
        const buckets = new Map<string, { start: Date; total: number }>();
        byDay.forEach((v, key) => {
            const [yStr, mStr, dStr] = key.split("-");
            const dt = new Date(
                Number(yStr),
                Number(mStr) - 1,
                Number(dStr)
            );
            const sunday = new Date(dt);
            sunday.setDate(dt.getDate() - dt.getDay());
            const bucketKey = ymd(
                sunday.getFullYear(),
                sunday.getMonth(),
                sunday.getDate()
            );
            const existing = buckets.get(bucketKey);
            if (existing) existing.total += v;
            else buckets.set(bucketKey, { start: sunday, total: v });
        });
        return Array.from(buckets.values())
            .filter((b) => b.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);
    }, [byDay]);

    const isLoading = q.isLoading;
    /* `stats.peakDate` is built with the native `new Date(y, m, d)` (see
     * the `stats` useMemo above) — a browser-local calendar date, not an
     * absolute instant. Formatting it with `formatInAppTz` would
     * re-project it through Asia/Dhaka and could drift the displayed day
     * by one for any browser timezone east of +6 (the ring on the day
     * cell, which reads the same Date via native getters, would then
     * silently disagree with this label). Read the same native fields
     * back out instead of round-tripping through an app-tz formatter. */
    const peakDate = stats.peakDate;
    const peakDateLabel = peakDate
        ? `${MONTH_NAMES[peakDate.getMonth()]} ${peakDate.getDate()}`
        : "—";

    /** Only count days that have actually elapsed. `periodEnd` is always
     *  the start of *next* month (a fixed 12-month window), so counting
     *  all the way to it would treat days later this month that haven't
     *  happened yet as "no spending" — inflating that stat every month,
     *  worst mid-month. */
    const elapsedEnd = useMemo(() => {
        const now = new Date();
        return now < periodEnd ? now : periodEnd;
    }, [periodEnd]);
    /** Inclusive count of elapsed calendar days (the window's first day
     *  through today, today included) — the same day-slot convention
     *  `stats.activeDays` counts over (it iterates whole calendar days,
     *  not a raw duration). A plain `(elapsedEnd - periodStart) / day-ms`
     *  duration drifts by one depending on time-of-day (rounding flips
     *  right at local noon) and can undercount relative to `activeDays`,
     *  so anchor both ends at local midnight before differencing. */
    const totalDaysInWindow = Math.max(
        0,
        Math.round(
            (startOfDay(elapsedEnd).getTime() - periodStart.getTime()) /
                (1000 * 60 * 60 * 24)
        ) + 1
    );

    /** Carries the active Envelope/Account/Category filters into a
     *  Transactions deep link, using the same `env`/`acc`/`cat` URL keys
     *  `useAnalyticsFilters` reads — a filtered day cell should drill into
     *  the same filtered slice of transactions, not the whole space. */
    const txHref = (fromKey: string, toKey: string): string => {
        const params = new URLSearchParams();
        for (const id of f.envelopeIds) params.append("env", id);
        for (const id of f.accountIds) params.append("acc", id);
        for (const id of f.categoryIds) params.append("cat", id);
        params.set("period", "custom");
        params.set("from", fromKey);
        params.set("to", toKey);
        return `${ROUTES.spaceTransactions(space.id)}?${params.toString()}`;
    };

    const kpiItems: KpiItem[] = [
        {
            label: "Year total",
            value: stats.yearTotal,
            money: true,
            tone: "expense",
        },
        {
            label: "Active days",
            value: stats.activeDays,
            valueFormat: "integer",
            sub:
                totalDaysInWindow > 0
                    ? `of ${totalDaysInWindow} · ${Math.min(
                          100,
                          (stats.activeDays / totalDaysInWindow) * 100
                      ).toFixed(0)}% had any expense`
                    : "—",
        },
        {
            label: "Peak day",
            value: stats.peak,
            money: true,
            tone: "expense",
            sub: stats.peakDate ? peakDateLabel : "No spending yet",
        },
        {
            label: "Avg per active day",
            value:
                stats.activeDays > 0 ? stats.yearTotal / stats.activeDays : 0,
            money: true,
            sub:
                stats.activeDays > 0
                    ? `Typical day ~${formatCompact(medianActiveDay)}`
                    : undefined,
        },
    ];

    return (
        <AnalyticsDetailLayout
            title="Spending calendar"
            description="Every day of the last twelve months, shaded by how it compares to your own spending — not a fixed amount. Small dots mark detected recurring monthly charges; the ringed cell is the year's peak day. Click any day to see what happened."
        >
            <AnalyticsFilterBar
                spaceId={space.id}
                isPersonal={space.isPersonal}
                envelopeIds={f.envelopeIds}
                accountIds={f.accountIds}
                categoryIds={f.categoryIds}
                onChange={f.setFilterIds}
                onClearAll={f.clearAllFilters}
                hasAnyFilter={f.hasAnyFilter}
            />

            <KpiStrip items={kpiItems} isLoading={isLoading} />

            <Card>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <CardTitle>Twelve months at a glance</CardTitle>
                        <p className="text-xs text-muted-foreground">
                            Each tile is one month · intensity = how heavy that day
                            was for you (percentile, not a fixed amount) · ring =
                            year peak. Click a day to open its transactions.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        {hasBills ? (
                            <Legend
                                dot
                                color="var(--expense)"
                                label={`Top ${recurringByDay.size} recurring bill${recurringByDay.size === 1 ? "" : "s"}`}
                            />
                        ) : null}
                        <Legend color={AMBER.b5} label="Peak" ring />
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <Skeleton className="h-[640px] w-full" />
                    ) : (
                        <div className="grid items-start gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                            {months.map(({ y, m }, i) => {
                                const monthTotal =
                                    stats.monthTotals[i]?.total ?? 0;
                                const rel =
                                    stats.maxMonth > 0
                                        ? monthTotal / stats.maxMonth
                                        : 0;
                                return (
                                    <MonthTile
                                        key={`${y}-${m}`}
                                        year={y}
                                        month={m}
                                        byDay={byDay}
                                        edges={edges}
                                        monthTotal={monthTotal}
                                        relativeFraction={rel}
                                        peakDate={stats.peakDate}
                                        recurringByDay={recurringByDay}
                                        earliestActiveKey={earliestActiveKey}
                                        txHref={txHref}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {!isLoading && (
                        <div className="mt-4 flex flex-col gap-2 border-t border-border/40 pt-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-[11px] text-muted-foreground">
                                {stats.activeDays > 0 ? (
                                    <>
                                        <span className="text-foreground/85">
                                            {/* Defensive floor: a future-dated
                                                transaction (the date picker
                                                allows "Tomorrow") counts toward
                                                activeDays but not toward this
                                                elapsed-day window, which could
                                                otherwise show a negative count. */}
                                            {Math.max(
                                                0,
                                                totalDaysInWindow - stats.activeDays
                                            )}{" "}
                                            days
                                        </span>{" "}
                                        with no spending
                                    </>
                                ) : (
                                    "No spending recorded yet"
                                )}
                            </span>
                            {stats.activeDays > 0 && (
                                <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                    <span>No spend</span>
                                    {[0, 1, 2, 3, 4, 5].map((b) => {
                                        const r = ramp(b);
                                        return (
                                            <span
                                                key={b}
                                                className="inline-block size-4 rounded"
                                                style={{
                                                    background: r.bg,
                                                    border: `1px solid ${
                                                        r.border === "transparent"
                                                            ? "transparent"
                                                            : r.border
                                                    }`,
                                                }}
                                            />
                                        );
                                    })}
                                    <span>
                                        Heavy day ({formatCompact(edges[3])}+)
                                    </span>
                                </span>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid gap-3.5 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>By weekday</CardTitle>
                        <p className="text-xs text-muted-foreground">
                            Average daily spend, all months.
                        </p>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <Skeleton className="h-44 w-full" />
                        ) : (
                            <div className="flex flex-col gap-2.5">
                                {WEEKDAY_FULL.map((d, i) => {
                                    const max = Math.max(...byWeekday, 1);
                                    const v = byWeekday[i];
                                    const isHeaviest = i === heaviestWeekdayIdx;
                                    return (
                                        <div
                                            key={d}
                                            className="grid items-center gap-3"
                                            style={{
                                                gridTemplateColumns:
                                                    "44px minmax(0, 1fr) 80px",
                                            }}
                                        >
                                            <span className="text-[12px] text-muted-foreground">
                                                {d}
                                            </span>
                                            <span className="relative block h-1.5 overflow-hidden rounded-full bg-muted/40">
                                                <span
                                                    className="absolute inset-y-0 left-0 rounded-full"
                                                    style={{
                                                        width: `${
                                                            (v / max) * 100
                                                        }%`,
                                                        backgroundColor: isHeaviest
                                                            ? AMBER.b5
                                                            : "var(--primary)",
                                                    }}
                                                />
                                            </span>
                                            <MoneyDisplay
                                                amount={v}
                                                variant="neutral"
                                                className="text-right text-[12.5px] font-semibold"
                                            />
                                        </div>
                                    );
                                })}
                                {byWeekday.length > 0 && (
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                        {findHeaviestWeekdayLabel(byWeekday, heaviestWeekdayIdx)}
                                    </p>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Heaviest weeks</CardTitle>
                        <p className="text-xs text-muted-foreground">
                            Top {heaviestWeeks.length || 5} spending weeks of the
                            year. Click a week to see its transactions.
                        </p>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <Skeleton className="h-44 w-full" />
                        ) : heaviestWeeks.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No weeks with spending yet.
                            </p>
                        ) : (
                            <div className="flex flex-col gap-2.5">
                                {heaviestWeeks.map((w, i) => {
                                    const max = heaviestWeeks[0]?.total ?? 1;
                                    const end = new Date(w.start);
                                    end.setDate(w.start.getDate() + 6);
                                    /* The Sun-start week for the earliest
                                       weeks in the window can begin up to 6
                                       days before `periodStart` (the week's
                                       total is already summed only from
                                       in-window days, via `byDay`) — clamp
                                       the drill-down link's start to the
                                       window boundary too, or it would pull
                                       in out-of-window transactions the
                                       displayed total never counted. */
                                    const clampedStart =
                                        w.start < periodStartLocal
                                            ? periodStartLocal
                                            : w.start;
                                    const fromKey = ymd(
                                        clampedStart.getFullYear(),
                                        clampedStart.getMonth(),
                                        clampedStart.getDate()
                                    );
                                    /* usePeriod's `to` is an EXCLUSIVE
                                       boundary (confirmed by
                                       DateRangePicker's `endOfDayExclusive`
                                       helper — the real picker always sends
                                       "the day after the last included
                                       day"). Saturday + 1 day, not Saturday
                                       itself, or the week's own last day
                                       gets silently dropped from the
                                       filtered results. */
                                    const rawExclusiveEnd = new Date(w.start);
                                    rawExclusiveEnd.setDate(
                                        w.start.getDate() + 7
                                    );
                                    /* Mirrors the `clampedStart` clamp above:
                                       the most recent week can run past
                                       `periodEnd`, which would otherwise let
                                       the link pull in transactions newer
                                       than the analyzed window. */
                                    const exclusiveEnd =
                                        rawExclusiveEnd > periodEndLocal
                                            ? periodEndLocal
                                            : rawExclusiveEnd;
                                    const toKey = ymd(
                                        exclusiveEnd.getFullYear(),
                                        exclusiveEnd.getMonth(),
                                        exclusiveEnd.getDate()
                                    );
                                    return (
                                        <Link
                                            key={i}
                                            to={txHref(fromKey, toKey)}
                                            className="grid items-center gap-3 rounded-md px-1.5 -mx-1.5 py-0.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                                            style={{
                                                gridTemplateColumns:
                                                    "minmax(110px, auto) minmax(0, 1fr) 90px",
                                            }}
                                        >
                                            <span className="text-[12.5px] text-foreground/85">
                                                {/* `w.start`/`end` are native-constructed
                                                    calendar dates (see the `heaviestWeeks`
                                                    useMemo), not absolute instants — same
                                                    tz-drift hazard as `peakDateLabel` above,
                                                    fixed the same way. */}
                                                {MONTH_NAMES[w.start.getMonth()]}{" "}
                                                {w.start.getDate()}–{end.getDate()}
                                            </span>
                                            <span className="relative block h-1.5 overflow-hidden rounded-full bg-muted/40">
                                                <span
                                                    className="absolute inset-y-0 left-0 rounded-full"
                                                    style={{
                                                        width: `${
                                                            (w.total / max) * 100
                                                        }%`,
                                                        backgroundColor: AMBER.b5,
                                                    }}
                                                />
                                            </span>
                                            <MoneyDisplay
                                                amount={w.total}
                                                variant="neutral"
                                                className="text-right text-[12.5px] font-semibold"
                                            />
                                        </Link>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AnalyticsDetailLayout>
    );
}

/* ============================================================
   MONTH TILE
   ============================================================ */

function MonthTile({
    year,
    month,
    byDay,
    edges,
    monthTotal,
    relativeFraction,
    peakDate,
    recurringByDay,
    earliestActiveKey,
    txHref,
}: {
    year: number;
    month: number;
    byDay: Map<string, number>;
    edges: number[];
    monthTotal: number;
    relativeFraction: number;
    peakDate: Date | null;
    recurringByDay: Map<
        number,
        { color: string; label: string; amount: number }
    >;
    earliestActiveKey: string | null;
    txHref: (fromKey: string, toKey: string) => string;
}) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startCol = new Date(year, month, 1).getDay();

    /** Build a 6×7 calendar grid (some weeks at the end may be empty). */
    const weeks: Array<Array<number | null>> = [];
    let dayIdx = 1;
    let week: Array<number | null> = new Array(7).fill(null);
    for (let c = 0; c < startCol; c++) week[c] = null;
    for (let c = startCol; c < 7; c++) {
        if (dayIdx <= daysInMonth) week[c] = dayIdx++;
    }
    weeks.push(week);
    while (dayIdx <= daysInMonth) {
        week = new Array(7).fill(null);
        for (let c = 0; c < 7 && dayIdx <= daysInMonth; c++) {
            week[c] = dayIdx++;
        }
        weeks.push(week);
    }

    const dailyValues: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
        dailyValues.push(byDay.get(ymd(year, month, d)) ?? 0);
    }
    const maxDaily = Math.max(1, ...dailyValues);

    const isPeakDay = (d: number): boolean => {
        if (!peakDate) return false;
        return (
            peakDate.getFullYear() === year &&
            peakDate.getMonth() === month &&
            peakDate.getDate() === d
        );
    };

    /* Months with zero activity collapse to a slim placeholder instead of
       a full 6-row grid of empty cells — a 12-tile wall where 8 tiles are
       all-empty reads as broken/boring rather than "the whole year". */
    if (monthTotal <= 0) {
        const lastDayKey = ymd(year, month, daysInMonth);
        /* Distinguish "this month is before any spending we've observed"
           (likely: the space/account didn't exist yet) from "genuinely
           zero spend that month" — asserting "no spending" for the former
           would overclaim knowledge we don't have. */
        const predatesHistory =
            earliestActiveKey !== null && lastDayKey < earliestActiveKey;
        return (
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/30 bg-card/40 px-3 py-6">
                <span className="inline-flex items-baseline gap-1.5">
                    <span className="text-[13px] font-medium tracking-wide text-muted-foreground/70">
                        {MONTH_NAMES[month]}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                        {year}
                    </span>
                </span>
                <span className="text-[10.5px] text-muted-foreground/50">
                    {predatesHistory ? "No data yet" : "No spending"}
                </span>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 rounded-xl border border-border/40 bg-card p-3 shadow-sm">
            {/* Header */}
            <div className="flex items-baseline justify-between">
                <span className="inline-flex items-baseline gap-1.5">
                    <span className="text-[13px] font-medium tracking-wide">
                        {MONTH_NAMES[month]}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                        {year}
                    </span>
                </span>
                <MoneyDisplay
                    amount={monthTotal}
                    variant="neutral"
                    className="text-[11.5px] font-semibold"
                />
            </div>

            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-[2px] text-center text-[8.5px] tracking-wider text-muted-foreground">
                {WEEKDAY_LETTERS.map((w, i) => (
                    <span
                        key={i}
                        className={cn(
                            "h-3 leading-3",
                            (i === 0 || i === 6) && "text-muted-foreground/70"
                        )}
                    >
                        {w}
                    </span>
                ))}
            </div>

            {/* Day grid */}
            <div className="flex flex-col gap-[2px]">
                {weeks.map((wk, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-[2px]">
                        {wk.map((d, di) => {
                            if (d === null) {
                                return <span key={di} className="aspect-square" />;
                            }
                            const key = ymd(year, month, d);
                            /* usePeriod's `to` is an EXCLUSIVE boundary
                               (see the `endOfDayExclusive` note on the
                               "Heaviest weeks" links below) — a single-day
                               link needs `to` = the *next* day, or the day
                               being clicked resolves to a zero-width range
                               and shows "0 transactions". `new Date`
                               normalizes the day+1 rollover across month
                               boundaries automatically. */
                            const nextDay = new Date(year, month, d + 1);
                            const nextDayKey = ymd(
                                nextDay.getFullYear(),
                                nextDay.getMonth(),
                                nextDay.getDate()
                            );
                            const v = byDay.get(key) ?? 0;
                            const b = bucketize(v, edges);
                            const r = ramp(b);
                            const recurring = recurringByDay.get(d);
                            const peak = isPeakDay(d);
                            const baseTitle = `${MONTH_NAMES[month]} ${d} · ${formatMoney(v)}`;
                            const title = recurring
                                ? `${baseTitle} · ${recurring.label} (${formatMoney(recurring.amount)}/mo)`
                                : v > 0
                                  ? `${baseTitle} · click to view transactions`
                                  : baseTitle;
                            const cellStyle = {
                                background: r.bg,
                                border: `1px solid ${peak ? "var(--bg)" : r.border}`,
                                boxShadow: peak
                                    ? "0 0 0 1.5px var(--fg)"
                                    : undefined,
                                color: r.fg,
                            };
                            const cellClassName = cn(
                                "relative grid aspect-square place-items-center rounded text-[8.5px] font-medium tabular-nums",
                                v > 0 &&
                                    "cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1"
                            );
                            const dot = recurring && (
                                <span
                                    className="absolute left-1/2 -translate-x-1/2 size-[3px] rounded-full"
                                    style={{
                                        bottom: "1.5px",
                                        background: recurring.color,
                                    }}
                                />
                            );
                            return v > 0 ? (
                                <Link
                                    key={di}
                                    to={txHref(key, nextDayKey)}
                                    title={title}
                                    className={cellClassName}
                                    style={cellStyle}
                                >
                                    {d}
                                    {dot}
                                </Link>
                            ) : (
                                <span
                                    key={di}
                                    title={title}
                                    className={cellClassName}
                                    style={cellStyle}
                                >
                                    {d}
                                    {dot}
                                </span>
                            );
                        })}
                    </div>
                ))}
            </div>

            {/* Per-day sparkline */}
            <div className="flex items-end gap-px h-3.5 border-t border-border/40 pt-1">
                {dailyValues.map((v, i) => (
                    <span
                        key={i}
                        className="flex-1 rounded-[1px]"
                        style={{
                            height: `${
                                v === 0 ? 8 : Math.max(8, (v / maxDaily) * 100)
                            }%`,
                            background:
                                v === 0
                                    ? "var(--bg-elev-2)"
                                    : `color-mix(in oklab, ${AMBER.b5} ${
                                          20 + (v / maxDaily) * 70
                                      }%, var(--bg-elev-2))`,
                            opacity: v === 0 ? 0.4 : 1,
                        }}
                    />
                ))}
            </div>

            {/* Relative-to-peak month bar */}
            <div className="flex items-center gap-1.5">
                <span className="relative block h-[3px] flex-1 overflow-hidden rounded-full bg-muted/60">
                    <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                            width: `${Math.round(relativeFraction * 100)}%`,
                            backgroundColor: AMBER.b5,
                        }}
                    />
                </span>
                <span className="text-[9.5px] tabular-nums text-muted-foreground">
                    {Math.round(relativeFraction * 100)}%
                </span>
            </div>
        </div>
    );
}

/* ============================================================
   SMALL PIECES
   ============================================================ */

function Legend({
    color,
    label,
    dot = false,
    ring = false,
}: {
    color: string;
    label: string;
    dot?: boolean;
    ring?: boolean;
}) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span
                className={cn("inline-block", dot ? "size-1.5 rounded-full" : "size-2.5 rounded-sm")}
                style={{
                    background: color,
                    ...(ring
                        ? {
                              boxShadow: "0 0 0 1px var(--fg)",
                          }
                        : null),
                }}
            />
            {label}
        </span>
    );
}

/** Takes the already-computed `heaviestWeekdayIdx` rather than
 *  re-deriving its own argmax — a second independent computation of the
 *  same fact is a second place for it to drift from the bar highlight. */
function findHeaviestWeekdayLabel(byWeekday: number[], bestIdx: number): string {
    if (bestIdx < 0 || byWeekday[bestIdx] <= 0) return "No spending recorded yet.";
    const best = byWeekday[bestIdx];
    const avg = byWeekday.reduce((s, v) => s + v, 0) / byWeekday.length;
    const pctAbove = avg > 0 ? ((best - avg) / avg) * 100 : 0;
    return `${WEEKDAY_FULL[bestIdx]} is your heaviest spending day — ${pctAbove.toFixed(
        0
    )}% above your weekly average.`;
}

function ymd(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
