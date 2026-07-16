import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, ChevronRight, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { PeriodChip } from "@/components/shared/PeriodChip";
import { KpiStrip, type KpiItem } from "@/components/shared/KpiStrip";
import { Donut, type DonutDatum } from "@/components/shared/charts/Donut";
import { MultiSeriesLineChart } from "@/components/shared/charts/MultiSeriesLineChart";
import { CategoryMultiSelect, type CategoryRow } from "../components/CategoryMultiSelect";
import { EnvelopeGlass } from "@/components/budget-gauge/EnvelopeGlass";
import { AnalyticsDetailLayout } from "./_AnalyticsLayout";
import { trpc, type RouterOutput } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { usePeriod } from "@/hooks/usePeriod";
import { ROUTES } from "@/router/routes";
import { getAppTzMonth, getAppTzYear } from "@/lib/dates";
import { formatCompact } from "@/lib/spendHeatmapColor";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

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

// Inherits every field the server actually returns so the page never
// drifts from the procedure shape. The optional `spaceId` is only
// present on the personal-space variant of the query.
type Envelope = RouterOutput["analytics"]["envelopeUtilization"][number] & {
    spaceId?: string;
};

export default function EnvelopesView() {
    const { space } = useCurrentSpace();
    const { period, preset } = usePeriod("this-month");
    const [showArchived, setShowArchived] = useState(false);
    // Narrows which envelopes' lines show on the two trend charts below —
    // shared between both since they plot largely the same monthly-cadence
    // set. Empty selection means "show everything" (the pre-existing
    // behavior), matching the Categories trend's own multi-select.
    const [selectedEnvelopeIds, setSelectedEnvelopeIds] = useState<string[]>([]);

    // The pace/"trending over" signal and the year-to-date sparkline are
    // both about *right now*, decoupled from whatever historical period
    // the headline numbers are scoped to (mirrors BudgetsPage, which only
    // shows pace for the in-progress month) — mixing a past period's
    // allocated/consumed with a live run-rate would silently mislead.
    const isLivePeriod = preset === "this-month";

    const qSpace = trpc.analytics.envelopeUtilization.useQuery(
        { spaceId: space.id, periodStart: period.start, periodEnd: period.end },
        { enabled: !space.isPersonal }
    );
    const qPersonal = trpc.personal.envelopeUtilization.useQuery(
        { periodStart: period.start, periodEnd: period.end },
        { enabled: space.isPersonal }
    );
    const q = space.isPersonal ? qPersonal : qSpace;
    const envelopes = useMemo<Envelope[]>(() => (q.data ?? []) as Envelope[], [q.data]);

    const activeEnvelopes = useMemo(() => envelopes.filter((e) => !e.archived), [envelopes]);
    const archivedEnvelopes = useMemo(() => envelopes.filter((e) => e.archived), [envelopes]);

    // Every active monthly envelope, one line each on both trend charts.
    // Each carries its own `spaceId` (personal cross-space view) or falls
    // back to the current space — `analytics.trends.dailyComparison` is
    // always space-scoped, even from the personal page.
    const monthTrendEnvelopes = useMemo(
        () => activeEnvelopes.filter((e) => e.cadence === "monthly"),
        [activeEnvelopes]
    );

    // Per-envelope daily series for the current calendar month — fanned out
    // as one query per envelope (batched over the network by httpBatchLink)
    // since the shared analytics procedure only returns one aggregate
    // series per call, not a per-envelope breakdown.
    const monthDailyQueries = trpc.useQueries((t) =>
        monthTrendEnvelopes.map((e) =>
            t.analytics.trends.dailyComparison({
                spaceId: e.spaceId ?? space.id,
                granularity: "month",
                mode: "operational",
                envelopeIds: [e.envelopId],
            })
        )
    );
    const monthDailyLoading = monthDailyQueries.some((r) => r.isLoading);

    // This-month cumulative spend, one running-total line per envelope.
    // Days after "today" are left `null` (not 0) so each line simply stops
    // at today instead of falsely flat-lining for the rest of the month.
    const monthTrend = useMemo(() => {
        let today = 0;
        let periodLength = 0;
        const cumByEnvelope = new Map<string, number[]>();
        monthTrendEnvelopes.forEach((e, i) => {
            const d = monthDailyQueries[i]?.data;
            if (!d) return;
            today = Math.max(today, Math.min(d.today, d.periodLength));
            periodLength = Math.max(periodLength, d.periodLength);
            let acc = 0;
            cumByEnvelope.set(
                e.envelopId,
                d.current.map((v) => (acc += v))
            );
        });
        if (periodLength === 0) return { data: [], today: 0 };
        const data = Array.from({ length: periodLength }, (_, i) => {
            const row: Record<string, string | number | null> = { x: `Day ${i + 1}` };
            for (const e of monthTrendEnvelopes) {
                const series = cumByEnvelope.get(e.envelopId);
                row[e.envelopId] = series && i < today ? (series[i] ?? null) : null;
                // On-budget pace: the even daily allowance ramped up to the
                // envelope's cap by month-end — drawn across the whole
                // month (not stopped at today) as a reference line. Only
                // meaningful when `e.allocated` is itself this-month's
                // allocation, i.e. the period picker is on the live month —
                // otherwise (e.g. "this year") it sums multiple months'
                // allocations against a single month's spend line.
                row[`${e.envelopId}__pace`] =
                    isLivePeriod && e.allocated > 0 ? (e.allocated / periodLength) * (i + 1) : null;
            }
            return row;
        });
        return { data, today };
    }, [monthTrendEnvelopes, monthDailyQueries, isLivePeriod]);

    // Live run-rate context, shared by every row: how far into the month we
    // are, and for how many days total. Projected-end-of-month spend for a
    // given envelope is (consumed / today) * periodLength. Only applied to
    // rows when the headline numbers are also viewing the live month —
    // otherwise a past period's consumed/allocated would be projected
    // against today's run-rate, which doesn't mean anything.
    const pace = useMemo(() => {
        if (!isLivePeriod || monthTrend.today <= 0) return null;
        return { today: monthTrend.today, periodLength: monthTrend.data.length };
    }, [isLivePeriod, monthTrend]);

    const currentYear = useMemo(() => getAppTzYear(new Date()), []);
    const currentMonth = useMemo(() => getAppTzMonth(new Date()), []);
    const yearSpace = trpc.analytics.yearReport.useQuery(
        { spaceId: space.id, year: currentYear },
        { enabled: !space.isPersonal }
    );
    const yearPersonal = trpc.personal.yearReport.useQuery(
        { year: currentYear },
        { enabled: space.isPersonal }
    );
    const yearReport = space.isPersonal ? yearPersonal.data : yearSpace.data;

    const rows = useMemo(
        () => activeEnvelopes.map((e) => computeRow(e, pace)),
        [activeEnvelopes, pace]
    );

    const summary = useMemo(() => {
        let allocated = 0;
        let consumed = 0;
        let overCount = 0;
        let trendingCount = 0;
        let spendCount = 0;
        for (const r of rows) {
            // Goals track lifetime funding toward a target, not a monthly
            // budget — keep them out of the spend-focused KPI strip so a
            // well-funded goal doesn't inflate "N envelopes" or masquerade
            // as an over-budget envelope. They still appear in the bottle
            // grid and the donut below.
            if (r.envelope.targetAmount != null && r.envelope.targetAmount > 0) continue;
            spendCount++;
            allocated += r.allocated;
            consumed += r.consumed;
            if (r.isOver) overCount++;
            else if (r.projectedOver) trendingCount++;
        }
        const utilization = allocated > 0 ? Math.round((consumed / allocated) * 100) : 0;
        return { allocated, consumed, overCount, trendingCount, utilization, spendCount };
    }, [rows]);

    // The bottle grid and donut always read worst-first / biggest-first.
    const chartRows = useMemo(() => sortRows(rows), [rows]);
    // Donuts read as noise past ~5-6 slices — top 6 by spend, the rest
    // rolled into a single "Other" wedge rather than one sliver each.
    const DONUT_MAX = 6;
    const donutData = useMemo<DonutDatum[]>(() => {
        // Goals are excluded from the KPI strip's "Spent" total (see
        // `summary` above) — exclude them here too so the wedges always
        // sum to the same center value instead of silently over/under it.
        const spent = rows
            .filter(
                (r) =>
                    r.consumed > 0 &&
                    !(r.envelope.targetAmount != null && r.envelope.targetAmount > 0)
            )
            .sort((a, b) => b.consumed - a.consumed);
        const top = spent.slice(0, DONUT_MAX).map((r) => ({
            id: r.envelope.envelopId,
            name: r.envelope.name,
            value: r.consumed,
            color: r.envelope.color,
        }));
        const rest = spent.slice(DONUT_MAX);
        const restTotal = rest.reduce((sum, r) => sum + r.consumed, 0);
        if (restTotal > 0) {
            top.push({
                id: "__other__",
                name: `Other (${rest.length})`,
                value: restTotal,
                color: "var(--muted-foreground)",
            });
        }
        return top;
    }, [rows]);

    // Year-to-date trend: one line per active monthly-cadence envelope,
    // each month's spend — rolling/goal envelopes don't fit a per-month
    // series, so they're excluded rather than shown as a flat zero line.
    const yearTrendEnvelopes = useMemo(
        () => (yearReport?.envelopes ?? []).filter((e) => !e.archived),
        [yearReport]
    );
    // Full 12-month axis so the chart's shape/scale is stable all year —
    // months not yet reached are `null` (a stopped line), not a false
    // drop to zero. Each envelope gets two keys: itself (consumed) and a
    // `__planned` twin (allocated), so the chart can plot both per line.
    const yearTrendData = useMemo(() => {
        return Array.from({ length: 12 }, (_, i) => {
            const row: Record<string, string | number | null> = { x: MONTH_LABELS[i] };
            for (const e of yearTrendEnvelopes) {
                const inRange = i < currentMonth;
                row[e.envelopId] = inRange ? (e.months[i]?.spent ?? 0) : null;
                row[`${e.envelopId}__planned`] = inRange ? (e.months[i]?.planned ?? 0) : null;
            }
            return row;
        });
    }, [yearTrendEnvelopes, currentMonth]);

    // Picker options: every envelope either trend chart could plot, deduped
    // by id (the two charts pull from separate procedures — `envelopeUtilization`
    // for the month view, `yearReport` for YTD — so their sets can differ
    // slightly, e.g. a brand-new envelope has no year history yet). Flat
    // list (`parent_id: null` for all) — `CategoryMultiSelect`'s hierarchy
    // features simply don't engage for envelopes.
    const envelopePickerRows = useMemo<CategoryRow[]>(() => {
        const byId = new Map<string, CategoryRow>();
        for (const e of [...monthTrendEnvelopes, ...yearTrendEnvelopes]) {
            if (!byId.has(e.envelopId)) {
                byId.set(e.envelopId, {
                    id: e.envelopId,
                    name: e.name,
                    color: e.color,
                    icon: e.icon,
                    parent_id: null,
                });
            }
        }
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [monthTrendEnvelopes, yearTrendEnvelopes]);

    // Drop a selected envelope that's no longer selectable (e.g. archived,
    // or the space changed) instead of silently filtering everything down
    // to a stale, now-invisible id.
    useEffect(() => {
        if (selectedEnvelopeIds.length === 0) return;
        const validIds = new Set(envelopePickerRows.map((r) => r.id));
        const next = selectedEnvelopeIds.filter((id) => validIds.has(id));
        if (next.length !== selectedEnvelopeIds.length) setSelectedEnvelopeIds(next);
    }, [envelopePickerRows, selectedEnvelopeIds]);

    const visibleMonthTrendEnvelopes = useMemo(
        () =>
            selectedEnvelopeIds.length === 0
                ? monthTrendEnvelopes
                : monthTrendEnvelopes.filter((e) => selectedEnvelopeIds.includes(e.envelopId)),
        [monthTrendEnvelopes, selectedEnvelopeIds]
    );
    const visibleYearTrendEnvelopes = useMemo(
        () =>
            selectedEnvelopeIds.length === 0
                ? yearTrendEnvelopes
                : yearTrendEnvelopes.filter((e) => selectedEnvelopeIds.includes(e.envelopId)),
        [yearTrendEnvelopes, selectedEnvelopeIds]
    );

    const kpiItems: KpiItem[] = [
        {
            label: "Allocated",
            value: summary.allocated,
            money: true,
            sub: `Across ${summary.spendCount} envelope${summary.spendCount === 1 ? "" : "s"}`,
        },
        {
            label: "Spent",
            value: summary.consumed,
            money: true,
            tone: "expense",
            sub: `${summary.utilization}% utilization`,
        },
        {
            label: "Over budget",
            value: summary.overCount,
            valueFormat: "integer",
            tone: summary.overCount > 0 ? "expense" : "neutral",
            sub: `of ${summary.spendCount} envelopes`,
        },
        {
            label: "Trending over",
            value: isLivePeriod ? summary.trendingCount : "—",
            valueFormat: "integer",
            tone: isLivePeriod && summary.trendingCount > 0 ? "expense" : "neutral",
            sub: isLivePeriod ? "at this month's pace" : "only shown for this month",
        },
    ];

    return (
        <AnalyticsDetailLayout
            title="Envelope utilization"
            description="Every envelope in one place — spend vs budget, this month's pace, and the year-to-date trend."
            actions={<PeriodChip />}
        >
            <KpiStrip items={kpiItems} isLoading={q.isLoading} />

            <Card>
                <CardHeader className="gap-1">
                    <CardTitle>Every envelope</CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Worst-first. Click a bottle to drill into that envelope.
                    </p>
                </CardHeader>
                <CardContent>
                    {q.isLoading ? (
                        <Skeleton className="h-64 w-full" />
                    ) : chartRows.length === 0 ? (
                        <p className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                            No active envelopes.
                        </p>
                    ) : (
                        <div className="orbit-design">
                            <EnvelopeBottleGrid rows={chartRows} space={space} />
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="overflow-hidden">
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 gap-y-1">
                    <div className="flex flex-col gap-1">
                        <CardTitle>This month, all envelopes combined</CardTitle>
                        <p className="text-xs text-muted-foreground">
                            {isLivePeriod
                                ? "Cumulative spend so far this month vs. an even on-budget pace, one pair of lines per envelope — solid is spent, dashed is pace. Always this month — independent of the period picker above."
                                : 'Cumulative spend so far this month, one line per envelope. Always this month — independent of the period picker above. Switch the picker back to "This month" to see the on-budget pace reference line.'}{" "}
                            The envelope picker here is shared with the Year-to-date chart further
                            down.
                        </p>
                    </div>
                    {envelopePickerRows.length > 0 && (
                        <CategoryMultiSelect
                            selected={selectedEnvelopeIds}
                            categories={envelopePickerRows}
                            onChange={setSelectedEnvelopeIds}
                            label="Envelopes"
                            icon={Wallet}
                            menuLabel="Narrow envelopes"
                            searchPlaceholder="Search envelopes…"
                            footerHint={null}
                        />
                    )}
                </CardHeader>
                <CardContent className="h-[340px] px-2 sm:px-6">
                    {monthDailyLoading ? (
                        <Skeleton className="h-full w-full" />
                    ) : monthTrend.data.length === 0 ? (
                        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No monthly envelopes to chart yet.
                        </p>
                    ) : visibleMonthTrendEnvelopes.length === 0 ? (
                        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No envelopes selected — pick at least one above.
                        </p>
                    ) : (
                        <MultiSeriesLineChart
                            data={monthTrend.data}
                            series={visibleMonthTrendEnvelopes.map((e) => ({
                                id: e.envelopId,
                                name: e.name,
                                color: e.color,
                            }))}
                            secondary={{
                                suffix: "__pace",
                                label: "On-budget pace",
                                dotAt: monthTrend.today - 1,
                            }}
                            ariaLabel={`Cumulative spend this month across ${visibleMonthTrendEnvelopes.length} envelope${visibleMonthTrendEnvelopes.length === 1 ? "" : "s"}, updated through day ${monthTrend.today} — click an envelope in the legend below to isolate its lines`}
                        />
                    )}
                </CardContent>
            </Card>

            <Card className="overflow-hidden">
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 gap-y-1">
                    <div className="flex flex-col gap-1">
                        <CardTitle>Year-to-date trend</CardTitle>
                        <p className="text-xs text-muted-foreground">
                            Allocated vs consumed by month, one pair of lines per envelope — solid
                            is spent, dashed is allocated. Monthly-cadence envelopes only. Always
                            the current calendar year — independent of the period picker above. Same
                            envelope picker as the chart above.
                        </p>
                    </div>
                    {envelopePickerRows.length > 0 && (
                        <CategoryMultiSelect
                            selected={selectedEnvelopeIds}
                            categories={envelopePickerRows}
                            onChange={setSelectedEnvelopeIds}
                            label="Envelopes"
                            icon={Wallet}
                            menuLabel="Narrow envelopes"
                            searchPlaceholder="Search envelopes…"
                            footerHint={null}
                        />
                    )}
                </CardHeader>
                <CardContent className="h-[340px] px-2 sm:px-6">
                    {yearSpace.isLoading || yearPersonal.isLoading ? (
                        <Skeleton className="h-full w-full" />
                    ) : yearTrendEnvelopes.length === 0 ? (
                        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No monthly envelopes with activity this year.
                        </p>
                    ) : currentMonth === 0 ? (
                        // `currentMonth` is 0-based (getAppTzMonth) and only
                        // *completed* months are plotted (`i < currentMonth`)
                        // — in January that's none, which would otherwise
                        // render every line as a flat run of nulls with no
                        // explanation.
                        <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                            No completed months yet this year — check back once January closes.
                        </p>
                    ) : visibleYearTrendEnvelopes.length === 0 ? (
                        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No envelopes selected — pick at least one above.
                        </p>
                    ) : (
                        <MultiSeriesLineChart
                            data={yearTrendData}
                            series={visibleYearTrendEnvelopes.map((e) => ({
                                id: e.envelopId,
                                name: e.name,
                                color: e.color,
                            }))}
                            secondary={{ suffix: "__planned", label: "Allocated" }}
                            ariaLabel={`Allocated versus consumed by month, year-to-date, across ${visibleYearTrendEnvelopes.length} envelope${visibleYearTrendEnvelopes.length === 1 ? "" : "s"}, through ${MONTH_LABELS[currentMonth - 1]} — click an envelope in the legend below to isolate its lines`}
                        />
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="gap-1">
                    <CardTitle>Spend by envelope</CardTitle>
                    <p className="text-xs text-muted-foreground">
                        This period's spend, split across envelopes.
                    </p>
                </CardHeader>
                <CardContent>
                    {q.isLoading ? (
                        <Skeleton className="h-64 w-full" />
                    ) : (
                        <Donut
                            data={donutData}
                            centerLabel="Spent"
                            centerValue={summary.consumed}
                            height={260}
                            emptyLabel="Nothing spent yet this period."
                        />
                    )}
                </CardContent>
            </Card>

            {archivedEnvelopes.length > 0 && (
                <Card className="overflow-hidden p-0">
                    <button
                        type="button"
                        onClick={() => setShowArchived((v) => !v)}
                        aria-expanded={showArchived}
                        aria-controls="envelopes-archived-list"
                        className="flex w-full items-center gap-2 px-6 py-4 text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                        {showArchived ? (
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="size-3.5 text-muted-foreground" />
                        )}
                        <span className="text-[13px] font-medium">Archived</span>
                        <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10.5px] text-muted-foreground">
                            {archivedEnvelopes.length}
                        </span>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                            {showArchived ? "Hide" : "Show"}
                        </span>
                    </button>
                    {showArchived && (
                        <div
                            id="envelopes-archived-list"
                            className="flex flex-col border-t border-border/60 opacity-70 transition-opacity hover:opacity-100"
                        >
                            {archivedEnvelopes.map((e, i) => (
                                <EnvelopeRow
                                    key={e.envelopId}
                                    row={computeRow(e, null)}
                                    spaceIdForLink={
                                        space.isPersonal && e.spaceId ? e.spaceId : space.id
                                    }
                                    first={i === 0}
                                />
                            ))}
                        </div>
                    )}
                </Card>
            )}
        </AnalyticsDetailLayout>
    );
}

interface Row {
    envelope: Envelope;
    allocated: number;
    consumed: number;
    remaining: number;
    isOver: boolean;
    isUntouched: boolean;
    pctSpent: number;
    /** Projected end-of-period spend at today's run-rate. Null when pace
     *  context isn't available (non-monthly cadence, past period, no data). */
    projected: number | null;
    projectedOver: boolean;
}

function computeRow(envelope: Envelope, pace: { today: number; periodLength: number } | null): Row {
    const allocated = envelope.allocated;
    const consumed = envelope.consumed;
    const cap = allocated;
    const remaining = cap - consumed;
    const isOver = consumed > cap;
    const isUntouched = consumed === 0;
    const pctSpent = cap > 0 ? consumed / cap : consumed > 0 ? Infinity : 0;

    let projected: number | null = null;
    let projectedOver = false;
    if (pace && pace.today > 0 && envelope.cadence === "monthly" && cap > 0 && !isOver) {
        projected = (consumed / pace.today) * pace.periodLength;
        projectedOver = projected > cap;
    }

    return {
        envelope,
        allocated,
        consumed,
        remaining,
        isOver,
        isUntouched,
        pctSpent,
        projected,
        projectedOver,
    };
}

/** Over budget first, then trending-over, then by how close to the cap —
 *  the same ordering the "Needs attention" strip and "Urgency" sort share. */
function severityTier(r: Row): number {
    if (r.isOver) return 0;
    if (r.projectedOver) return 1;
    return 2;
}

/** Worst-first: already over budget, then trending over at the current
 *  pace, then by how close to the cap the rest are. */
function sortRows(rows: Row[]): Row[] {
    return [...rows].sort((a, b) => {
        const ta = severityTier(a);
        const tb = severityTier(b);
        if (ta !== tb) return ta - tb;
        const pa = Number.isFinite(a.pctSpent) ? a.pctSpent : 999;
        const pb = Number.isFinite(b.pctSpent) ? b.pctSpent : 999;
        return pb - pa;
    });
}

function EnvelopeRow({
    row,
    spaceIdForLink,
    first,
}: {
    row: Row;
    spaceIdForLink: string;
    first: boolean;
}) {
    const {
        envelope,
        allocated: cap,
        consumed,
        remaining,
        isOver,
        isUntouched,
        pctSpent,
        projected,
        projectedOver,
    } = row;
    const finitePct = Number.isFinite(pctSpent);

    return (
        <Link
            to={ROUTES.spaceBudgetDetail(spaceIdForLink, envelope.envelopId)}
            className={cn(
                "group grid items-center gap-4 px-6 py-4 transition-colors hover:bg-accent/30",
                "grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto_16px]",
                "sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_84px_92px_16px]",
                "lg:grid-cols-[minmax(0,200px)_minmax(0,1fr)_92px_84px_92px_16px]",
                !first && "border-t border-border/60"
            )}
        >
            {/* Identity column */}
            <div className="flex min-w-0 items-center gap-2.5">
                <EntityAvatar size="sm" color={envelope.color} icon={envelope.icon} />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-medium">{envelope.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                        {isOver && finitePct && (
                            <span className="rounded-sm border border-[color:var(--expense)]/30 bg-[color:var(--expense)]/10 px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wider text-[color:var(--expense)]">
                                over
                            </span>
                        )}
                        {!isOver && projectedOver && (
                            <span className="rounded-sm border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wider text-[color:var(--warning)]">
                                trending over
                            </span>
                        )}
                        {(envelope.lifetimeOverrun ?? 0) > 0 && (
                            <span
                                className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-sm border border-[color:var(--expense)]/30 bg-[color:var(--expense)]/10 px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wider text-[color:var(--expense)]"
                                title={`Across all time, ${envelope.name} has consumed ${formatMoney(envelope.lifetimeOverrun ?? 0)} more than it's been allocated.`}
                                aria-label={`Net overspent across all time by ${formatMoney(envelope.lifetimeOverrun ?? 0)}`}
                            >
                                net −{formatMoney(envelope.lifetimeOverrun ?? 0)} (lifetime)
                            </span>
                        )}
                        {isUntouched && !isOver && (
                            <span className="rounded-sm bg-secondary px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
                                untouched
                            </span>
                        )}
                        {envelope.cadence === "monthly" &&
                            !isOver &&
                            !isUntouched &&
                            !projectedOver && (
                                <span className="rounded-sm bg-secondary px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
                                    monthly
                                </span>
                            )}
                    </span>
                </div>
            </div>

            {/* Bullet bar: fill = % of cap consumed, tail = overage */}
            <BulletBar consumed={consumed} cap={cap} isOver={isOver} color={envelope.color} />

            {/* Pace at current run-rate — monthly cadence, live period only */}
            <span
                className={cn(
                    "hidden text-right text-[11px] tabular-nums lg:inline",
                    isOver
                        ? "text-muted-foreground"
                        : projectedOver
                          ? "text-[color:var(--warning)]"
                          : "text-muted-foreground"
                )}
            >
                {isOver ? "—" : projected != null ? (projectedOver ? "over pace" : "on pace") : "—"}
            </span>

            {/* Spent */}
            <MoneyDisplay
                amount={consumed}
                variant={isOver ? "expense" : "neutral"}
                className="hidden text-right sm:inline"
            />

            {/* Remaining (abs value when over, tone carries the sign) */}
            <MoneyDisplay
                amount={Math.abs(remaining)}
                variant={isOver ? "expense" : "neutral"}
                className="hidden text-right sm:inline"
            />

            {/* Mobile: condensed % spent */}
            <span className="flex items-center gap-2 sm:hidden">
                <span
                    className={cn(
                        "text-[11px] tabular-nums",
                        isOver ? "text-[color:var(--expense)]" : "text-muted-foreground"
                    )}
                >
                    {finitePct ? `${Math.round(pctSpent * 100)}%` : "—"}
                </span>
            </span>

            <ChevronRight className="hidden size-4 text-muted-foreground/50 sm:inline group-hover:text-foreground" />
            <ArrowRight className="size-3.5 text-muted-foreground/50 sm:hidden group-hover:text-foreground" />
        </Link>
    );
}

/**
 * Bullet-style progress bar: filled portion = consumed / cap, colored by
 * severity zone (envelope color while healthy, amber past 80%, red + an
 * overflow tail once over). Unlike a plain drain bar, the fill only ever
 * grows — it reads the same direction as "percent spent" everywhere else
 * on this page.
 */
function BulletBar({
    consumed,
    cap,
    isOver,
    color,
}: {
    consumed: number;
    cap: number;
    isOver: boolean;
    color: string;
}) {
    if (cap <= 0 && consumed === 0) {
        return <span className="block h-1.5 w-full rounded-full bg-muted/60" />;
    }
    const pct = cap > 0 ? Math.max(0, Math.min(1, consumed / cap)) : consumed > 0 ? 1 : 0;
    const nearCap = !isOver && cap > 0 && consumed / cap >= 0.8;
    const overByPct = isOver && cap > 0 ? Math.min(0.4, (consumed - cap) / cap) : 0;
    const fillColor = isOver ? "var(--expense)" : nearCap ? "var(--warning)" : color;
    return (
        <span className="relative block h-1.5 w-full overflow-visible">
            <span className="absolute inset-y-0 left-0 right-0 rounded-full bg-muted/60" />
            <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${pct * 100}%`, backgroundColor: fillColor }}
            />
            {overByPct > 0 && (
                <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                        left: "100%",
                        width: `${overByPct * 100}%`,
                        backgroundColor: "color-mix(in oklab, var(--expense) 60%, transparent)",
                    }}
                />
            )}
        </span>
    );
}

/**
 * Grid of envelope-glass "bottles" — the same liquid-fill gauge used on the
 * Budgets page, reused here so every envelope's fill level is comparable
 * at a glance in one place instead of one at a time on its own detail page.
 */
function EnvelopeBottleGrid({
    rows,
    space,
}: {
    rows: Row[];
    space: { id: string; isPersonal: boolean };
}) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {rows.map((r) => {
                const isGoal = r.envelope.targetAmount != null && r.envelope.targetAmount > 0;
                const current = isGoal ? (r.envelope.lifetimeFunded ?? 0) : r.consumed;
                const total = isGoal ? (r.envelope.targetAmount ?? 0) : r.allocated;
                const badge = r.isOver
                    ? { label: "Over", tone: "var(--expense)" }
                    : r.projectedOver
                      ? { label: "Trending", tone: "var(--warning)" }
                      : null;
                const caption = r.isOver
                    ? `${formatCompact(Math.abs(r.remaining))} over`
                    : isGoal
                      ? `${formatCompact(current)} of ${formatCompact(total)}`
                      : `${formatCompact(r.consumed)} of ${formatCompact(r.allocated)}`;
                const srSummary = `${r.envelope.name}: ${caption}${badge ? `, ${badge.label.toLowerCase()} budget` : ""}`;
                return (
                    <Link
                        key={r.envelope.envelopId}
                        to={ROUTES.spaceBudgetDetail(
                            space.isPersonal && r.envelope.spaceId ? r.envelope.spaceId : space.id,
                            r.envelope.envelopId
                        )}
                        aria-label={srSummary}
                        title={srSummary}
                        className="od-card group flex flex-col items-center gap-2 p-3 text-center transition-all hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-2,var(--shadow-1))]"
                    >
                        <span className="flex w-full items-center gap-1.5 text-[12px] font-medium">
                            <EntityAvatar
                                size="sm"
                                color={r.envelope.color}
                                icon={r.envelope.icon}
                            />
                            {/* Inline, not absolutely-positioned: badge
                                labels vary in width ("Over" vs "Trending"),
                                and a fixed reserve on the name span sized
                                for one label would let the other overlap
                                it. Flowing the badge as a row sibling
                                means the name's own `truncate` always
                                clips before the badge, regardless of
                                either one's width. */}
                            <span className="min-w-0 flex-1 truncate">{r.envelope.name}</span>
                            {badge && (
                                <span
                                    className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wider"
                                    style={{
                                        color: badge.tone,
                                        background: `color-mix(in oklab, ${badge.tone} 15%, transparent)`,
                                        border: `1px solid color-mix(in oklab, ${badge.tone} 35%, transparent)`,
                                    }}
                                >
                                    {badge.label}
                                </span>
                            )}
                        </span>
                        <EnvelopeGlass
                            variant={isGoal ? "save" : "spend"}
                            current={current}
                            total={total}
                            height={110}
                            color={r.envelope.color}
                        />
                        <span
                            className="text-[11px] tabular-nums"
                            style={{ color: badge?.tone ?? "var(--fg-3)" }}
                        >
                            {caption}
                        </span>
                    </Link>
                );
            })}
        </div>
    );
}
