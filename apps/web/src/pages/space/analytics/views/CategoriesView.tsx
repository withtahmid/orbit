import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    ArrowDownRight,
    ArrowUpRight,
    ChevronRight,
    CornerDownLeft,
    Folder,
    Home,
    ListTree,
    Minus,
    Rows3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/shared/MoneyDisplay";
import { PeriodChip } from "@/components/shared/PeriodChip";
import {
    DrillableDonut,
    type DrillableDonutSlice,
} from "@/components/shared/charts/DrillableDonut";
import { MultiSeriesLineChart } from "@/components/shared/charts/MultiSeriesLineChart";
import { CategoryMultiSelect } from "../components/CategoryMultiSelect";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { KpiStrip, type KpiItem } from "@/components/shared/KpiStrip";
import { AnalyticsDetailLayout } from "./_AnalyticsLayout";
import { AnalyticsFilterBar } from "../components/AnalyticsFilterBar";
import { useAnalyticsFilters } from "../components/useAnalyticsFilters";
import { trpc } from "@/trpc";
import { useCurrentSpace } from "@/hooks/useCurrentSpace";
import { usePeriod } from "@/hooks/usePeriod";
import { ROUTES } from "@/router/routes";
import { getAppTzMonth, getAppTzYear, resolvePeriod, PERIOD_LABELS } from "@/lib/dates";
import { formatInAppTz } from "@/lib/formatDate";
import { cn } from "@/lib/utils";

/** Presets offered for the "Spending trend" chart's own month range — a
 *  deliberately shorter list than the main period picker, since every
 *  option here already spans 3+ months (a trend needs several points). */
type TrendPresetId =
    | "last-3-months"
    | "last-6-months"
    | "last-12-months"
    | "this-year"
    | "all-time";
const TREND_PRESET_ORDER: TrendPresetId[] = [
    "last-3-months",
    "last-6-months",
    "last-12-months",
    "this-year",
    "all-time",
];

/**
 * Sentinel id used for the "<parent> (direct)" pseudo-slice in drilled
 * views — represents transactions tagged directly to a parent that also
 * has children. Anything with this prefix is not a real category and
 * should be routed to transactions for the parent id.
 */
const DIRECT_SLICE_PREFIX = "__direct__:";

/** Sentinel id for the flat-mode donut's aggregate "Other" slice that
 *  reconciles the visible top-N arcs with the grand total in the center.
 *  Non-navigable. */
const OTHER_SLICE_ID = "__other__";

/** How many categories the flat-mode donut renders before rolling the
 *  rest into the "Other" slice. */
const FLAT_DONUT_TOP_N = 12;

type Row = {
    id: string;
    parentId: string | null;
    name: string;
    color: string;
    icon: string;
    directTotal: number;
    subtreeTotal: number;
};

export default function CategoriesView() {
    const { space } = useCurrentSpace();
    const navigate = useNavigate();
    const { period } = usePeriod("this-month");
    const [params, setParams] = useSearchParams();

    /* Filter bar — Envelopes + Accounts only. The category dimension is
       deliberately hidden: drilling the tree (or flattening it) *is* the
       category navigation here, and that drill owns the `cat` param. */
    const f = useAnalyticsFilters({ categories: false });

    /* Flatten toggle: when on, show every direct-spend category at once
       (a flat ranked list) instead of one drill level. Drill focus is
       ignored while flat — the two are independent URL flags. */
    const flat = params.get("flat") === "1";
    const focusId = flat ? null : params.get("cat");
    const setFlat = (on: boolean) => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (on) {
                    next.set("flat", "1");
                    /* Drop the drill focus so a shared flat link never
                       carries a hidden `cat` that pops back on toggle-off. */
                    next.delete("cat");
                } else {
                    next.delete("flat");
                }
                return next;
            },
            { replace: true }
        );
    };

    // Previous period of equal length, used for MoM deltas. Floor at epoch
    // so "all-time" doesn't blow up the date range.
    const prevPeriod = useMemo(() => {
        const dur = Math.max(0, period.end.getTime() - period.start.getTime());
        const start = new Date(Math.max(0, period.start.getTime() - dur));
        return { start, end: period.start };
    }, [period.start, period.end]);

    const qSpace = trpc.analytics.categoryBreakdown.useQuery(
        {
            spaceId: space.id,
            periodStart: period.start,
            periodEnd: period.end,
            envelopeIds: f.envelopeIdsArg,
            accountIds: f.accountIdsArg,
        },
        { enabled: !space.isPersonal }
    );
    const qPersonal = trpc.personal.categoryBreakdown.useQuery(
        {
            periodStart: period.start,
            periodEnd: period.end,
            accountIds: f.accountIdsArg,
        },
        { enabled: space.isPersonal }
    );
    const q = space.isPersonal ? qPersonal : qSpace;

    // Previous period: only enabled once focus is set or once we have data,
    // since the deltas are a secondary signal.
    const prevSpaceQ = trpc.analytics.categoryBreakdown.useQuery(
        {
            spaceId: space.id,
            periodStart: prevPeriod.start,
            periodEnd: prevPeriod.end,
            envelopeIds: f.envelopeIdsArg,
            accountIds: f.accountIdsArg,
        },
        { enabled: !space.isPersonal }
    );
    const prevPersonalQ = trpc.personal.categoryBreakdown.useQuery(
        {
            periodStart: prevPeriod.start,
            periodEnd: prevPeriod.end,
            accountIds: f.accountIdsArg,
        },
        { enabled: space.isPersonal }
    );
    const prevQ = space.isPersonal ? prevPersonalQ : prevSpaceQ;

    const rows = useMemo(() => (q.data ?? []) as Row[], [q.data]);
    const prevRows = useMemo(() => (prevQ.data ?? []) as Row[], [prevQ.data]);
    const prevById = useMemo(() => {
        const m = new Map<string, Row>();
        for (const r of prevRows) m.set(r.id, r);
        return m;
    }, [prevRows]);

    const byId = useMemo(() => {
        const m = new Map<string, Row>();
        for (const r of rows) m.set(r.id, r);
        return m;
    }, [rows]);

    const childrenByParent = useMemo(() => {
        const m = new Map<string | null, Row[]>();
        for (const r of rows) {
            const arr = m.get(r.parentId) ?? [];
            arr.push(r);
            m.set(r.parentId, arr);
        }
        return m;
    }, [rows]);

    const focus = focusId ? (byId.get(focusId) ?? null) : null;

    // Breadcrumb chain — category ancestors only (no envelope level).
    const ancestors = useMemo<Row[]>(() => {
        const chain: Row[] = [];
        let cur: Row | undefined = focus ?? undefined;
        while (cur) {
            chain.unshift(cur);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return chain;
    }, [focus, byId]);

    // The rows the donut + ranked list show, by mode:
    //   1. Category focus → children of that category
    //   2. No focus       → root categories (one slice per top-level category)
    const rootRows = useMemo(() => rows.filter((r) => r.parentId === null), [rows]);
    const focusChildren = useMemo(
        () => (focus ? (childrenByParent.get(focus.id) ?? []) : []),
        [focus, childrenByParent]
    );

    const rootTotal = useMemo(() => rootRows.reduce((s, r) => s + r.subtreeTotal, 0), [rootRows]);
    const prevRootTotal = useMemo(
        () => prevRows.filter((r) => r.parentId === null).reduce((s, r) => s + r.subtreeTotal, 0),
        [prevRows]
    );

    // Donut slices. `drillable` flags slices that descend into another level
    // on click (category → sub-categories). Leaf categories and the
    // synthesized "(direct)" pseudo-slice navigate to filtered transactions
    // instead — they're not drillable here.
    const donutData: DrillableDonutSlice[] = useMemo(() => {
        const slices: DrillableDonutSlice[] = [];
        if (focus && focus.directTotal > 0) {
            slices.push({
                id: `${DIRECT_SLICE_PREFIX}${focus.id}`,
                name: `${focus.name} (direct)`,
                value: focus.directTotal,
                color: focus.color,
                drillable: false,
            });
        }
        const source = focus ? focusChildren : rootRows;
        for (const c of source) {
            if (c.subtreeTotal > 0) {
                slices.push({
                    id: c.id,
                    name: c.name,
                    value: c.subtreeTotal,
                    color: c.color,
                    drillable: (childrenByParent.get(c.id) ?? []).length > 0,
                });
            }
        }
        // Match `rankRows`' ordering — largest share first, so the donut
        // and the ranked list next to it always agree on order.
        return slices.sort((a, b) => b.value - a.value);
    }, [focus, focusChildren, rootRows, childrenByParent]);

    const centerValue = focus ? focus.subtreeTotal : rootTotal;
    const centerLabel = focus ? focus.name : "Total spent";

    const setFocus = (id: string | null) => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (id) next.set("cat", id);
                else next.delete("cat");
                return next;
            },
            { replace: false }
        );
    };

    const onSelect = (d: DrillableDonutSlice) => {
        if (d.id.startsWith(DIRECT_SLICE_PREFIX)) {
            const realId = d.id.slice(DIRECT_SLICE_PREFIX.length);
            navigate(`${ROUTES.spaceTransactions(space.id)}?cat=${realId}`);
            return;
        }
        const node = byId.get(d.id);
        if (!node) return;
        const hasChildren = (childrenByParent.get(node.id) ?? []).length > 0;
        if (hasChildren) {
            setFocus(node.id);
        } else {
            navigate(`${ROUTES.spaceTransactions(space.id)}?cat=${node.id}`);
        }
    };

    /**
     * Rows for the ranked-spend list, normalized to a uniform shape
     * regardless of which mode (root / category focus) we're in.
     */
    type RankRow = {
        id: string;
        name: string;
        color: string;
        icon: string;
        /** Muted context line under the name (flat mode: ancestor path). */
        subtitle?: string;
        value: number;
        prevValue: number;
        drillable: boolean;
        childCount?: number;
        onClick: () => void;
    };
    const rankRows: RankRow[] = useMemo(() => {
        const source: Row[] = focus ? focusChildren : rootRows;
        const list: RankRow[] = source
            .filter((c) => c.subtreeTotal > 0)
            .map((c) => {
                const children = childrenByParent.get(c.id) ?? [];
                const drillable = children.length > 0;
                return {
                    id: c.id,
                    name: c.name,
                    color: c.color,
                    icon: c.icon,
                    value: c.subtreeTotal,
                    prevValue: prevById.get(c.id)?.subtreeTotal ?? 0,
                    drillable,
                    childCount: children.length,
                    onClick: drillable
                        ? () => setFocus(c.id)
                        : () => navigate(`${ROUTES.spaceTransactions(space.id)}?cat=${c.id}`),
                };
            });
        if (focus && focus.directTotal > 0) {
            list.unshift({
                id: `${DIRECT_SLICE_PREFIX}${focus.id}`,
                name: `${focus.name} (direct)`,
                color: focus.color,
                icon: focus.icon,
                value: focus.directTotal,
                prevValue: prevById.get(focus.id)?.directTotal ?? 0,
                drillable: false,
                onClick: () => navigate(`${ROUTES.spaceTransactions(space.id)}?cat=${focus.id}`),
            });
        }
        return list.sort((a, b) => b.value - a.value);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus, focusChildren, rootRows, prevById, childrenByParent, space.id]);

    /**
     * Flat mode rows — one per category with direct spend, at any depth
     * (parents-with-direct AND leaves). Ranked desc; the sum equals the
     * grand total. The ancestor path rides in the `subtitle`
     * slot so the existing row markup can render it as-is.
     */
    const flatRankRows: RankRow[] = useMemo(() => {
        const pathOf = (id: string): string | undefined => {
            const parts: string[] = [];
            let cur = byId.get(id)?.parentId ?? null;
            while (cur) {
                const node = byId.get(cur);
                if (!node) break;
                parts.unshift(node.name);
                cur = node.parentId;
            }
            return parts.length > 0 ? parts.join(" › ") : undefined;
        };
        return rows
            .filter((r) => r.directTotal > 0)
            .map((r) => ({
                id: r.id,
                name: r.name,
                color: r.color,
                icon: r.icon,
                subtitle: pathOf(r.id),
                value: r.directTotal,
                prevValue: prevById.get(r.id)?.directTotal ?? 0,
                drillable: false,
                onClick: () => navigate(`${ROUTES.spaceTransactions(space.id)}?cat=${r.id}`),
            }))
            .sort((a, b) => b.value - a.value);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, byId, prevById, space.id]);

    // The long tail beyond the flat donut's top-N — lifted out of
    // `flatDonutData` so the trend chart can roll up the exact same set of
    // categories into its own "Other" line and the two never drift apart.
    const flatOverflowIds = useMemo(
        () => flatRankRows.slice(FLAT_DONUT_TOP_N).map((r) => r.id),
        [flatRankRows]
    );

    const flatDonutData: DrillableDonutSlice[] = useMemo(() => {
        const slices: DrillableDonutSlice[] = flatRankRows.slice(0, FLAT_DONUT_TOP_N).map((r) => ({
            id: r.id,
            name: r.name,
            value: r.value,
            color: r.color,
            drillable: false,
        }));
        /* Roll the long tail into one muted slice so the rendered arcs
           sum to the grand total printed in the donut center. */
        const rest = flatRankRows.slice(FLAT_DONUT_TOP_N);
        const otherValue = rest.reduce((s, r) => s + r.value, 0);
        if (rest.length > 0 && otherValue > 0) {
            slices.push({
                id: OTHER_SLICE_ID,
                name: `Other (${rest.length} categor${rest.length === 1 ? "y" : "ies"})`,
                value: otherValue,
                color: "var(--muted-foreground)",
                drillable: false,
            });
        }
        return slices;
    }, [flatRankRows]);

    // Mode-active selections used by the donut, KPI strip, and list.
    const activeRows = flat ? flatRankRows : rankRows;
    const activeDonut = flat ? flatDonutData : donutData;
    const onSelectActive = flat
        ? (d: DrillableDonutSlice) => {
              if (d.id === OTHER_SLICE_ID) return; // aggregate slice — no target
              navigate(`${ROUTES.spaceTransactions(space.id)}?cat=${d.id}`);
          }
        : onSelect;

    const isLeaf =
        focus !== null &&
        (childrenByParent.get(focus.id) ?? []).length === 0 &&
        focus.subtreeTotal === focus.directTotal;

    // The trend chart's own month range — independent of the page's main
    // `period` on purpose: the donut/KPIs answer "how much, in the period
    // I picked" while the trend answers "how has this moved over time,"
    // which usually wants a longer window than whatever the headline
    // numbers are scoped to. Categories shown and envelope/account filters
    // still come from the donut/filter bar above — only the time axis is
    // separate.
    const [trendPreset, setTrendPreset] = useState<TrendPresetId>("last-6-months");
    const trendPeriod = useMemo(() => resolvePeriod(trendPreset), [trendPreset]);

    // A trend needs at least two points to read as a trend — every preset
    // in TREND_PRESETS already spans 3+ months, so this is just a safety
    // floor, not something the picker can normally trigger.
    const monthsInRange = useMemo(() => {
        const endInclusive = new Date(
            Math.max(trendPeriod.start.getTime(), trendPeriod.end.getTime() - 1)
        );
        const startIdx =
            getAppTzYear(trendPeriod.start) * 12 + (getAppTzMonth(trendPeriod.start) - 1);
        const endIdx = getAppTzYear(endInclusive) * 12 + (getAppTzMonth(endInclusive) - 1);
        return Math.max(1, endIdx - startIdx + 1);
    }, [trendPeriod.start, trendPeriod.end]);
    const trendEnabled = !isLeaf && monthsInRange >= 2;

    // Same envelope/account filters as the donut (the category *set* still
    // agrees with it — see `trend` below), but the trend's own period.
    // Drilling never refetches (this returns the whole tree, same as
    // `categoryBreakdown`), so the trend re-slices client-side exactly
    // like the donut does below.
    const trendSpaceQ = trpc.analytics.categoryMonthlyTrend.useQuery(
        {
            spaceId: space.id,
            periodStart: trendPeriod.start,
            periodEnd: trendPeriod.end,
            envelopeIds: f.envelopeIdsArg,
            accountIds: f.accountIdsArg,
        },
        { enabled: !space.isPersonal && trendEnabled }
    );
    const trendPersonalQ = trpc.personal.categoryMonthlyTrend.useQuery(
        {
            periodStart: trendPeriod.start,
            periodEnd: trendPeriod.end,
            accountIds: f.accountIdsArg,
        },
        { enabled: space.isPersonal && trendEnabled }
    );
    const trendQ = space.isPersonal ? trendPersonalQ : trendSpaceQ;
    const trendRows = useMemo(() => trendQ.data ?? [], [trendQ.data]);

    // Which of the currently-shown donut slices to keep on the trend chart.
    // Local state, not a URL filter: it only narrows this one chart. Options
    // are exactly `activeDonut`'s real categories (not the whole category
    // tree) — the picker can only ever narrow down what's already on the
    // graph, never add something the donut isn't showing. The synthetic
    // "(direct)" / "Other" slices aren't offered (they're aggregates, not
    // a category of their own) but stay visible whenever nothing is picked.
    const [trendCategoryIds, setTrendCategoryIds] = useState<string[]>([]);
    const trendPickableSlices = useMemo(
        () =>
            activeDonut.filter(
                (s) => !s.id.startsWith(DIRECT_SLICE_PREFIX) && s.id !== OTHER_SLICE_ID
            ),
        [activeDonut]
    );
    const categoryPickerRows = useMemo(
        () =>
            trendPickableSlices.map((s) => ({
                id: s.id,
                name: s.name,
                color: s.color,
                icon: byId.get(s.id)?.icon ?? "circle",
                parent_id: null,
            })),
        [trendPickableSlices, byId]
    );
    // A prior pick can point at a category the donut no longer shows (drill
    // level changed, filters changed) — drop those so the chart doesn't
    // silently keep stale selections that aren't on-screen anymore.
    useEffect(() => {
        setTrendCategoryIds((cur) => {
            if (cur.length === 0) return cur;
            const validIds = new Set(trendPickableSlices.map((s) => s.id));
            const next = cur.filter((id) => validIds.has(id));
            return next.length === cur.length ? cur : next;
        });
    }, [trendPickableSlices]);

    const monthlyById = useMemo(() => {
        const m = new Map<string, Map<string, { directTotal: number; subtreeTotal: number }>>();
        for (const r of trendRows) {
            let inner = m.get(r.id);
            if (!inner) {
                inner = new Map();
                m.set(r.id, inner);
            }
            inner.set(r.month, { directTotal: r.directTotal, subtreeTotal: r.subtreeTotal });
        }
        return m;
    }, [trendRows]);

    /**
     * Trend chart data — one line per slice currently shown in the donut
     * (`activeDonut`), narrowed down to the picker's selection when one is
     * active. Never a different set than the donut: real category slices
     * read `subtreeTotal` in tree mode (matching `donutData`) or
     * `directTotal` in flat mode (matching `flatDonutData`); the synthetic
     * "(direct)" and "Other" slices are reconstructed the same way their
     * donut counterparts are, and only appear when nothing is picked.
     */
    const trend = useMemo(() => {
        if (!trendEnabled || activeDonut.length === 0) return null;
        const monthKeys = Array.from(new Set(trendRows.map((r) => r.month))).sort();
        if (monthKeys.length < 2) return null;

        const slices =
            trendCategoryIds.length > 0
                ? activeDonut.filter((s) => trendCategoryIds.includes(s.id))
                : activeDonut;
        if (slices.length === 0) return null;

        const data = monthKeys.map((month) => {
            const row: Record<string, string | number | null> = {
                x: formatInAppTz(new Date(month), "MMM yyyy"),
            };
            for (const slice of slices) {
                let value = 0;
                if (slice.id.startsWith(DIRECT_SLICE_PREFIX)) {
                    const realId = slice.id.slice(DIRECT_SLICE_PREFIX.length);
                    value = monthlyById.get(realId)?.get(month)?.directTotal ?? 0;
                } else if (slice.id === OTHER_SLICE_ID) {
                    value = flatOverflowIds.reduce(
                        (sum, id) => sum + (monthlyById.get(id)?.get(month)?.directTotal ?? 0),
                        0
                    );
                } else {
                    const m = monthlyById.get(slice.id)?.get(month);
                    value = m ? (flat ? m.directTotal : m.subtreeTotal) : 0;
                }
                row[slice.id] = value;
            }
            return row;
        });
        const series = slices.map((s) => ({ id: s.id, name: s.name, color: s.color }));
        return { data, series };
    }, [
        trendEnabled,
        activeDonut,
        trendCategoryIds,
        trendRows,
        monthlyById,
        flatOverflowIds,
        flat,
    ]);

    /**
     * KPI summary — re-derived per mode. Uses prev-period rows for MoM delta.
     */
    const kpi = useMemo(() => {
        const total = activeRows.reduce((acc, r) => acc + r.value, 0);
        const prevTotal = focus ? (prevById.get(focus.id)?.subtreeTotal ?? 0) : prevRootTotal;
        const top = activeRows[0];
        const largestPct = total > 0 && top ? (top.value / total) * 100 : 0;
        const momDelta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
        return {
            total,
            prevTotal,
            top,
            largestPct,
            momDelta,
            count: activeRows.length,
        };
    }, [activeRows, focus, prevById, prevRootTotal]);

    const kpiItems: KpiItem[] = [
        {
            label: focus ? `Total in ${focus.name}` : "Total spent",
            value: kpi.total,
            money: true,
            tone: "expense",
            sub: kpi.count > 0 ? `Across ${kpi.count} categories` : "No spend in period",
        },
        {
            label: "Largest share",
            value: kpi.largestPct,
            valueFormat: "percent",
            sub: kpi.top ? kpi.top.name : "—",
        },
        {
            label: "MoM delta",
            value: kpi.momDelta ?? 0,
            valueFormat: "percent",
            tone:
                kpi.momDelta === null
                    ? "muted"
                    : kpi.momDelta > 0
                      ? "expense"
                      : kpi.momDelta < 0
                        ? "income"
                        : "neutral",
            sub: kpi.momDelta === null ? "no prior period data" : "vs previous period",
        },
        {
            label: "Categories",
            value: kpi.count,
            valueFormat: "integer",
            sub: flat ? "spending categories" : focus ? "in this branch" : "top-level categories",
        },
    ];

    return (
        <AnalyticsDetailLayout
            title="Spending by category"
            description={
                flat
                    ? "Every category with direct spend, ranked. Click a row to see its transactions."
                    : "Click a slice or row to drill into sub-categories. The breadcrumb above the chart shows where you are."
            }
            actions={
                <div className="flex flex-wrap items-center gap-2">
                    <ViewModeToggle flat={flat} onChange={setFlat} />
                    <PeriodChip />
                </div>
            }
        >
            <AnalyticsFilterBar
                spaceId={space.id}
                isPersonal={space.isPersonal}
                envelopeIds={f.envelopeIds}
                accountIds={f.accountIds}
                categoryIds={[]}
                onChange={f.setFilterIds}
                onClearAll={f.clearAllFilters}
                hasAnyFilter={f.hasAnyFilter}
                dimensions={{ categories: false }}
            />

            {/* Breadcrumb in a thin pill row matching the design. Hidden in
                flat mode — there's no hierarchy to navigate there. */}
            {!flat && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5">
                    <Folder className="size-3.5 text-muted-foreground" />
                    <BreadcrumbItem
                        onClick={() => setFocus(null)}
                        isLast={ancestors.length === 0}
                        leading={<Home className="size-3" />}
                        label="All categories"
                    />
                    {ancestors.map((a, i) => {
                        const isLast = i === ancestors.length - 1;
                        return (
                            <span key={a.id} className="flex items-center gap-2">
                                <ChevronRight className="size-3 text-muted-foreground/50" />
                                <BreadcrumbItem
                                    onClick={() => setFocus(a.id)}
                                    isLast={isLast}
                                    leading={
                                        <span
                                            className="size-1.5 rounded-full"
                                            style={{ backgroundColor: a.color }}
                                        />
                                    }
                                    label={a.name}
                                />
                            </span>
                        );
                    })}
                    <span className="ml-auto flex items-center gap-3">
                        <span className="text-[11px] text-muted-foreground">
                            {!focus
                                ? `${kpi.count} categories`
                                : isLeaf
                                  ? "Leaf — no sub-categories"
                                  : `${rankRows.length} sub-categories`}
                        </span>
                        {ancestors.length > 0 && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    const parent = ancestors[ancestors.length - 2];
                                    if (!parent) {
                                        setFocus(null);
                                        return;
                                    }
                                    setFocus(parent.id);
                                }}
                                className="h-7 gap-1 px-2 text-[11px]"
                            >
                                <CornerDownLeft className="size-3" />
                                Up
                            </Button>
                        )}
                    </span>
                </div>
            )}

            {/* Flat mode has no hierarchy to navigate, but keep a thin
                orientation band so the page holds its layout rhythm. */}
            {flat && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5">
                    <Rows3 className="size-3.5 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">All categories</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                        {kpi.count} with direct spend
                    </span>
                </div>
            )}

            <KpiStrip items={kpiItems} isLoading={q.isLoading} />

            {isLeaf ? (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                        <EntityAvatar size="lg" color={focus!.color} icon={focus!.icon} />
                        <span className="text-base font-semibold">{focus!.name}</span>
                        <span className="max-w-md text-xs text-muted-foreground">
                            This is a leaf category. Drilling stops here — see matching transactions
                            below.
                        </span>
                        <div className="mt-1 flex flex-wrap justify-center gap-2">
                            <Button
                                size="sm"
                                onClick={() =>
                                    navigate(
                                        `${ROUTES.spaceTransactions(space.id)}?cat=${focus!.id}`
                                    )
                                }
                            >
                                View transactions
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <Card className="flex h-[480px] flex-col">
                        <CardHeader>
                            <CardTitle>Distribution</CardTitle>
                            <p className="text-xs text-muted-foreground">
                                {flat ? "Top categories by spend." : "Click a slice to drill in."}
                            </p>
                        </CardHeader>
                        <CardContent className="flex min-h-0 flex-1 items-center justify-center">
                            {q.isLoading ? (
                                <Skeleton className="h-[280px] w-full" />
                            ) : activeDonut.length === 0 ? (
                                <p className="text-center text-sm text-muted-foreground">
                                    {focus
                                        ? `No spending in ${focus.name} for this period.`
                                        : "No spending in this period."}
                                </p>
                            ) : (
                                <DrillableDonut
                                    slices={activeDonut}
                                    centerLabel={
                                        centerLabel === "Total spent" || !centerLabel
                                            ? "Total"
                                            : centerLabel
                                    }
                                    centerValue={centerValue.toLocaleString("en-US", {
                                        maximumFractionDigits: 0,
                                    })}
                                    onSelect={onSelectActive}
                                    size={240}
                                />
                            )}
                        </CardContent>
                    </Card>

                    <Card className="flex h-[480px] flex-col overflow-hidden p-0">
                        <div className="flex flex-col gap-0.5 px-6 pt-5 pb-3">
                            <CardTitle>Ranked spend</CardTitle>
                            <p className="text-xs text-muted-foreground">
                                {flat
                                    ? "Every category with direct spend · click a row for its transactions."
                                    : "Click a row to drill in · arrow indicates drillable."}
                            </p>
                        </div>
                        {q.isLoading ? (
                            <div className="flex min-h-0 flex-1 items-center px-6 pb-5">
                                <Skeleton className="h-64 w-full" />
                            </div>
                        ) : activeRows.length === 0 ? (
                            <p className="flex flex-1 items-center justify-center px-6 pb-5 text-sm text-muted-foreground">
                                Nothing spent in this period.
                            </p>
                        ) : (
                            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                                {activeRows.map((r, i) => {
                                    const max = activeRows[0]?.value ?? 1;
                                    const pct = max > 0 ? (r.value / max) * 100 : 0;
                                    const delta =
                                        r.prevValue > 0
                                            ? ((r.value - r.prevValue) / r.prevValue) * 100
                                            : r.value > 0
                                              ? null
                                              : 0;
                                    return (
                                        <button
                                            key={r.id}
                                            type="button"
                                            onClick={r.onClick}
                                            className={cn(
                                                "group grid items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/30",
                                                "grid-cols-[24px_minmax(0,1fr)_auto] sm:grid-cols-[24px_minmax(0,1fr)_minmax(80px,1fr)_104px_72px_16px]",
                                                i > 0 && "border-t border-border/60",
                                                !r.drillable && "opacity-90"
                                            )}
                                        >
                                            <span className="text-[11px] tabular-nums text-muted-foreground">
                                                #{i + 1}
                                            </span>
                                            <span className="flex min-w-0 items-center gap-2.5">
                                                <EntityAvatar
                                                    size="sm"
                                                    color={r.color}
                                                    icon={r.icon}
                                                />
                                                <span className="flex min-w-0 flex-col gap-0.5">
                                                    <span className="truncate text-[13px] font-medium">
                                                        {r.name}
                                                    </span>
                                                    {/* Meta line only when it has content — an
                                                        empty flex span still costs height and
                                                        makes sibling rows ragged. */}
                                                    {(r.subtitle ||
                                                        (r.drillable &&
                                                            r.childCount !== undefined)) && (
                                                        <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
                                                            {r.subtitle && (
                                                                <span className="truncate">
                                                                    {r.subtitle}
                                                                </span>
                                                            )}
                                                            {r.drillable &&
                                                                r.childCount !== undefined && (
                                                                    <span className="text-[color:var(--primary)]">
                                                                        · {r.childCount} sub
                                                                    </span>
                                                                )}
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                            {/* Inline bar */}
                                            <span className="hidden items-center sm:flex">
                                                <span className="relative block h-1 w-full max-w-40 overflow-hidden rounded-full bg-muted/60">
                                                    <span
                                                        className="absolute inset-y-0 left-0 rounded-full"
                                                        style={{
                                                            width: `${pct}%`,
                                                            backgroundColor: r.color,
                                                        }}
                                                    />
                                                </span>
                                            </span>
                                            {/* Money */}
                                            <span className="hidden text-right sm:inline">
                                                <MoneyDisplay amount={r.value} variant="neutral" />
                                            </span>
                                            {/* Delta */}
                                            <span className="hidden justify-end text-right sm:flex">
                                                <DeltaChip pct={delta} />
                                            </span>
                                            <span className="flex items-center justify-end gap-2 text-right sm:hidden">
                                                <MoneyDisplay
                                                    amount={r.value}
                                                    variant="neutral"
                                                    className="text-[13px]"
                                                />
                                            </span>
                                            <ChevronRight
                                                className={cn(
                                                    "hidden size-4 sm:inline",
                                                    r.drillable
                                                        ? "text-muted-foreground/50 group-hover:text-foreground"
                                                        : "invisible"
                                                )}
                                            />
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </div>
            )}

            {!isLeaf && (
                <Card className="overflow-hidden">
                    <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 gap-y-1">
                        <div className="flex flex-col gap-1">
                            <CardTitle>Spending trend</CardTitle>
                            <p className="text-xs text-muted-foreground">
                                {trendCategoryIds.length > 0
                                    ? `${trendCategoryIds.length} of ${trendPickableSlices.length} categories from the Distribution chart, by month.`
                                    : "One line per slice shown in the Distribution chart above, by month."}{" "}
                                Its own range — independent of the period picker above, but which
                                categories are available still follows it, so a category with no
                                spend in the period above won't have a line here even if it has
                                history in this chart's own range.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <CategoryMultiSelect
                                selected={trendCategoryIds}
                                categories={categoryPickerRows}
                                onChange={setTrendCategoryIds}
                            />
                            <Select
                                value={trendPreset}
                                onValueChange={(v) => setTrendPreset(v as TrendPresetId)}
                            >
                                <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
                                    <SelectValue>{PERIOD_LABELS[trendPreset]}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {TREND_PRESET_ORDER.map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {PERIOD_LABELS[p]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardHeader>
                    <CardContent className="h-[560px] px-2 sm:px-6">
                        {!trendEnabled ? (
                            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                                Pick a longer range above to see a trend over time.
                            </p>
                        ) : trendQ.isLoading ? (
                            <Skeleton className="h-full w-full" />
                        ) : !trend ? (
                            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                {trendCategoryIds.length > 0
                                    ? "No spending in the selected categories across this period."
                                    : focus
                                      ? `No spending in ${focus.name} across this period.`
                                      : "No spending in this period."}
                            </p>
                        ) : (
                            <MultiSeriesLineChart
                                data={trend.data}
                                series={trend.series}
                                ariaLabel={`Monthly spend trend for ${trend.series.length} categor${trend.series.length === 1 ? "y" : "ies"} — ${trendCategoryIds.length > 0 ? "narrowed down via the category selector" : "shown in the distribution chart"} — click a category in the legend below to isolate its line`}
                            />
                        )}
                    </CardContent>
                </Card>
            )}
        </AnalyticsDetailLayout>
    );
}

function BreadcrumbItem({
    label,
    leading,
    isLast,
    onClick,
}: {
    label: string;
    leading?: React.ReactNode;
    isLast: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={isLast}
            className={cn(
                "inline-flex items-center gap-1.5 text-sm",
                isLast
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground"
            )}
        >
            {leading}
            <span className="truncate">{label}</span>
        </button>
    );
}

/** Tree ⇄ Flat segmented toggle for the category view. Tree keeps the
 *  existing drill-down; Flat lists every direct-spend category at once. */
function ViewModeToggle({ flat, onChange }: { flat: boolean; onChange: (flat: boolean) => void }) {
    return (
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
            <button
                type="button"
                onClick={() => onChange(false)}
                aria-pressed={!flat}
                title="Drill into the category tree one level at a time"
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors sm:px-2.5 sm:py-1",
                    !flat
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                )}
            >
                <ListTree className="size-3.5" />
                Tree
            </button>
            <button
                type="button"
                onClick={() => onChange(true)}
                aria-pressed={flat}
                title="Show every category with direct spend at once"
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors sm:px-2.5 sm:py-1",
                    flat
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                )}
            >
                <Rows3 className="size-3.5" />
                Flat
            </button>
        </div>
    );
}

function DeltaChip({ pct }: { pct: number | null }) {
    if (pct === null) {
        return (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <Minus className="size-3" />
                new
            </span>
        );
    }
    if (Math.abs(pct) < 0.5) {
        return (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <Minus className="size-3" />
                0%
            </span>
        );
    }
    const up = pct > 0;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
                up ? "text-[color:var(--expense)]" : "text-[color:var(--income)]"
            )}
        >
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {up ? "+" : ""}
            {pct.toFixed(0)}%
        </span>
    );
}
