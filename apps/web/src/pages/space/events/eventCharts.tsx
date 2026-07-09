import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
    Area,
    Bar,
    CartesianGrid,
    Cell,
    ComposedChart,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Sector,
    Tooltip as RTooltip,
    XAxis,
    YAxis,
} from "recharts";
import { ChevronRight } from "lucide-react";
import { format as dfFormat } from "date-fns";
import { Money } from "./eventUI";
import {
    appDayStr,
    daySpanInclusive,
    enumerateDays,
    parseAppDay,
    type CatNode,
    type DailyRow,
} from "./eventUtils";

/* ------------------------------------------------------------------ *
 *  Shared helpers
 * ------------------------------------------------------------------ */

/* Respect the OS reduced-motion setting for chart draw-in animations. */
function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const m = window.matchMedia("(prefers-reduced-motion: reduce)");
        const on = () => setReduced(m.matches);
        on();
        m.addEventListener?.("change", on);
        return () => m.removeEventListener?.("change", on);
    }, []);
    return reduced;
}

function fmt(n: number): string {
    return Math.abs(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}
function fmtCompact(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return `${Math.round(n)}`;
}

/* ------------------------------------------------------------------ *
 *  Spend timeline — cumulative burn-up area + pace line, with a slim
 *  daily-volume bar strip beneath sharing the same day order.
 * ------------------------------------------------------------------ */

export function SpendTimelineChart({
    data,
    estimate,
    startTime,
    endTime,
    color,
}: {
    data: DailyRow[];
    estimate: number | null;
    startTime: Date;
    endTime: Date;
    color: string;
}) {
    const gid = useId().replace(/:/g, "");
    const hasEstimate = estimate !== null && estimate > 0;

    /* Build a CONTINUOUS per-calendar-day series across the event window
       (zero-filling days with no activity) so the x-axis represents real
       time — gaps read as flat cumulative segments and the pace line is a
       genuine straight line reaching the estimate on the final day. The
       window is widened to cover any transactions dated outside the event
       range. All day math is in APP_TZ 'YYYY-MM-DD' space (never ms
       rounding), matching the Avg/day denominator elsewhere. */
    const { series, maxDaily } = useMemo(() => {
        const startDay = appDayStr(startTime);
        const rawEndDay = appDayStr(endTime);
        // Guard an inverted window (end before start).
        const endDay = rawEndDay < startDay ? startDay : rawEndDay;
        /* Render window = the event window WIDENED to cover the actual
           transaction dates, so every event transaction shows on its real day
           and the chart matches the transactions feed (an event legitimately
           has transactions dated a little before/after its nominal window).
           Outlier guard: if a stray/mis-dated row would stretch the span past
           the ~5.5yr enumerate cap, fall back to the event window so the chart
           can't go blank; such overflow rows then fold onto the edge day. */
        let winStart = startDay;
        let winEnd = endDay;
        for (const r of data) {
            if (r.date < winStart) winStart = r.date;
            if (r.date > winEnd) winEnd = r.date;
        }
        if (daySpanInclusive(winStart, winEnd) > 2000) {
            winStart = startDay;
            winEnd = endDay;
        }
        const days = enumerateDays(winStart, winEnd);
        const lastDay = days[days.length - 1];
        /* Pace slope spans the EVENT window (not the widened render window):
           frac = dayNumber / eventDays, so it reaches the estimate exactly on
           the event's end day and holds flat before start / after end. */
        const eventSpan = daySpanInclusive(startDay, endDay);
        const byDay = new Map<string, { expense: number; income: number; txCount: number }>();
        for (const r of data) {
            const d = r.date < winStart ? winStart : r.date > lastDay ? lastDay : r.date;
            const cur = byDay.get(d) ?? { expense: 0, income: 0, txCount: 0 };
            cur.expense += r.expense;
            cur.income += r.income;
            cur.txCount += r.txCount;
            byDay.set(d, cur);
        }
        const startMs = parseAppDay(startDay).getTime();
        let cumExpense = 0;
        let cumIncome = 0;
        let maxD = 0;
        const rows = days.map((date) => {
            const r = byDay.get(date);
            const expense = r?.expense ?? 0;
            const income = r?.income ?? 0;
            cumExpense += expense;
            cumIncome += income;
            /* Track the max STACKED height (expense + income) so the volume
               strip's scaling keeps the tallest bar at ~28% even on days that
               have both flows. */
            maxD = Math.max(maxD, expense + income);
            const offset = Math.round((parseAppDay(date).getTime() - startMs) / 86_400_000);
            /* Pace = budget you should have spent BY THE END of this day =
               estimate × dayNumber/eventDays. cumExpense is also an end-of-day
               running total, so day 1 shows one day's share (not 0) and the
               event's final day lands exactly on the estimate. */
            const frac = Math.min(Math.max((offset + 1) / eventSpan, 0), 1);
            return {
                date,
                expense,
                income,
                txCount: r?.txCount ?? 0,
                cumExpense,
                cumIncome,
                pace: hasEstimate ? (estimate as number) * frac : undefined,
            };
        });
        return { series: rows, maxDaily: maxD };
    }, [data, startTime, endTime, hasEstimate, estimate]);

    const anyIncome = useMemo(() => data.some((r) => r.income > 0), [data]);
    const reduced = usePrefersReducedMotion();

    if (data.length === 0 || series.length === 0) return null;

    const tickFmt = (v: string) => dfFormat(parseAppDay(v), "MMM d");
    /* Daily bars ride a hidden right axis scaled so a full-height bar reaches
       ~28% up — a "volume" strip under the cumulative curve that stays
       perfectly x-aligned because it is the SAME chart / x-scale. */
    const volMax = maxDaily > 0 ? maxDaily * 3.6 : 1;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ width: "100%", height: 264 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={series}
                        margin={{ top: 8, right: 10, bottom: 0, left: -8 }}
                    >
                        <defs>
                            <linearGradient id={`${gid}-cum`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid
                            vertical={false}
                            stroke="var(--line-soft)"
                            strokeDasharray="2 4"
                        />
                        <XAxis
                            dataKey="date"
                            tickFormatter={tickFmt}
                            tick={{ fill: "var(--fg-3)", fontSize: 10.5 }}
                            axisLine={{ stroke: "var(--line-soft)" }}
                            tickLine={false}
                            minTickGap={28}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            yAxisId="cum"
                            tickFormatter={fmtCompact}
                            tick={{ fill: "var(--fg-3)", fontSize: 10.5 }}
                            axisLine={false}
                            tickLine={false}
                            width={44}
                        />
                        {/* Hidden right axis for the daily-volume bars — shares
                            the single x-scale, so bars align exactly under the
                            cumulative curve. */}
                        <YAxis yAxisId="vol" orientation="right" hide domain={[0, volMax]} />
                        <RTooltip
                            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
                            content={<TimelineTooltip anyIncome={anyIncome} hasEstimate={hasEstimate} />}
                        />
                        {/* Area first (bottom of the z-order) so its translucent
                            fill sits behind the volume bars rather than dimming
                            their tops; the cumulative lines draw last, on top. */}
                        <Area
                            yAxisId="cum"
                            type="monotone"
                            dataKey="cumExpense"
                            stroke={color}
                            strokeWidth={2}
                            fill={`url(#${gid}-cum)`}
                            isAnimationActive={!reduced}
                            animationDuration={500}
                        />
                        {maxDaily > 0 && (
                            <Bar
                                yAxisId="vol"
                                stackId="vol"
                                dataKey="expense"
                                fill="var(--expense)"
                                fillOpacity={0.5}
                                radius={[2, 2, 0, 0]}
                                maxBarSize={14}
                                isAnimationActive={false}
                            />
                        )}
                        {maxDaily > 0 && anyIncome && (
                            <Bar
                                yAxisId="vol"
                                stackId="vol"
                                dataKey="income"
                                fill="var(--income)"
                                fillOpacity={0.5}
                                radius={[2, 2, 0, 0]}
                                maxBarSize={14}
                                isAnimationActive={false}
                            />
                        )}
                        {anyIncome && (
                            <Line
                                yAxisId="cum"
                                type="monotone"
                                dataKey="cumIncome"
                                stroke="var(--income)"
                                strokeWidth={1.6}
                                dot={false}
                                isAnimationActive={false}
                            />
                        )}
                        {hasEstimate && (
                            <Line
                                yAxisId="cum"
                                type="linear"
                                dataKey="pace"
                                stroke="var(--fg-3)"
                                strokeWidth={1.4}
                                strokeDasharray="4 4"
                                dot={false}
                                isAnimationActive={false}
                            />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div className="ev-chart-legend">
                <LegendKey swatch={color} label="Cumulative spend" />
                {hasEstimate && <LegendKey swatch="var(--fg-3)" dashed label="Pace to estimate" />}
                {anyIncome && <LegendKey swatch="var(--income)" label="Income" />}
                <LegendKey swatch="var(--expense)" label="Daily spend" />
            </div>
        </div>
    );
}

function LegendKey({
    swatch,
    label,
    dashed,
}: {
    swatch: string;
    label: string;
    dashed?: boolean;
}) {
    return (
        <span className="ev-chart-legend-key">
            <span
                aria-hidden
                style={{
                    width: 14,
                    height: dashed ? 0 : 8,
                    borderRadius: 3,
                    background: dashed ? "transparent" : swatch,
                    borderTop: dashed ? `2px dashed ${swatch}` : undefined,
                }}
            />
            {label}
        </span>
    );
}

function TimelineTooltip({
    active,
    payload,
    anyIncome,
    hasEstimate,
}: {
    active?: boolean;
    payload?: Array<{ payload: DailyRow & { cumExpense: number; cumIncome: number; pace?: number } }>;
    anyIncome: boolean;
    hasEstimate: boolean;
}) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="ev-tt">
            <div className="ev-tt-title">{dfFormat(parseAppDay(d.date), "EEE, MMM d")}</div>
            <div className="ev-tt-row">
                <span>Spent that day</span>
                <Money
                    amount={d.expense}
                    size={12}
                    variant={d.expense ? "expense" : "muted"}
                    weight={500}
                />
            </div>
            <div className="ev-tt-row">
                <span>Cumulative</span>
                <Money amount={d.cumExpense} size={12} variant="expense" weight={500} />
            </div>
            {hasEstimate && d.pace !== undefined && (
                <div className="ev-tt-row">
                    <span>Pace target</span>
                    <Money amount={d.pace} size={12} variant="muted" />
                </div>
            )}
            {anyIncome && d.income > 0 && (
                <div className="ev-tt-row">
                    <span>Income that day</span>
                    <Money amount={d.income} size={12} variant="income" />
                </div>
            )}
            <div className="ev-tt-row ev-tt-muted">
                <span>Transactions</span>
                <span className="tabular">{d.txCount}</span>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 *  Drillable category composition donut.
 *    Root ring = top-level categories (subtree totals). Clicking a slice
 *    or legend row that has sub-categories drills into its children; a
 *    breadcrumb walks back up. A category with direct spend AND children
 *    surfaces a synthetic "· direct" slice so the ring always sums to the
 *    parent total. Non-drillable slices toggle a pin (center readout).
 * ------------------------------------------------------------------ */

type DonutSlice = {
    id: string;
    name: string;
    color: string;
    total: number;
    txCount: number;
    node: CatNode | null;
    drillable: boolean;
};

function toSlice(n: CatNode): DonutSlice {
    return {
        id: n.id,
        name: n.name,
        color: n.color,
        total: n.total,
        txCount: n.txTotal,
        node: n,
        drillable: n.children.some((c) => c.total > 0),
    };
}

function childSlices(node: CatNode): DonutSlice[] {
    const slices = node.children.filter((c) => c.total > 0).map(toSlice);
    if (node.direct > 0 && slices.length > 0) {
        slices.push({
            id: `${node.id}__direct`,
            name: `${node.name} · direct`,
            color: node.color,
            total: node.direct,
            txCount: node.directTx,
            node: null,
            drillable: false,
        });
    }
    return slices.sort((a, b) => b.total - a.total);
}

export function CategoryDonutChart({ roots }: { roots: CatNode[] }) {
    const reduced = usePrefersReducedMotion();
    /* Drill path stored as ids (not node refs): resolved against the CURRENT
       roots each render so a background refetch that rebuilds the tree can't
       strand the view on stale node objects. Truncates if an id vanishes. */
    const [pathIds, setPathIds] = useState<string[]>([]);
    /* Hover is transient (mouse/keyboard preview); pinned persists on click so
       a leaf's readout survives the pointer leaving (and works on touch). The
       shown slice = hover ?? pinned. */
    const [hover, setHover] = useState<number | null>(null);
    const [pinned, setPinned] = useState<number | null>(null);
    const legendRef = useRef<HTMLUListElement>(null);
    const refocusRef = useRef(false);

    const path = useMemo<CatNode[]>(() => {
        const out: CatNode[] = [];
        let level = roots;
        for (const id of pathIds) {
            const found = level.find((n) => n.id === id);
            if (!found) break;
            out.push(found);
            level = found.children;
        }
        return out;
    }, [roots, pathIds]);
    const current = path.length > 0 ? path[path.length - 1] : null;

    const slices = useMemo<DonutSlice[]>(
        () => (current ? childSlices(current) : roots.map(toSlice)),
        [roots, current]
    );
    /* Clear hover + pin whenever the slice set changes (drill or refetch) so
       neither points at a moved/removed slice. */
    useEffect(() => {
        setHover(null);
        setPinned(null);
    }, [slices]);
    /* After a level change, restore keyboard focus into the (new) legend —
       the clicked row/slice just unmounted, which would otherwise drop focus
       to <body>. */
    useEffect(() => {
        if (!refocusRef.current) return;
        refocusRef.current = false;
        legendRef.current?.querySelector("button")?.focus();
    }, [pathIds]);

    const total = useMemo(() => slices.reduce((s, x) => s + x.total, 0), [slices]);

    if (roots.length === 0) return null;

    const shown = hover !== null ? hover : pinned;
    const shownIdx = shown !== null && shown < slices.length ? shown : null;
    const activeSlice = shownIdx !== null ? slices[shownIdx] : null;

    const drillInto = (s: DonutSlice) => {
        if (s.drillable && s.node) {
            refocusRef.current = true;
            setPathIds((p) => [...p, (s.node as CatNode).id]);
        }
    };
    const goTo = (depth: number) => {
        refocusRef.current = true;
        setPathIds((p) => p.slice(0, depth));
    };
    /* A slice click drills when it can, otherwise toggles the pin. */
    const onSliceClick = (i: number) => {
        const s = slices[i];
        if (s.drillable) drillInto(s);
        else setPinned((p) => (p === i ? null : i));
    };

    return (
        <div className="ev-donut-block">
            <nav className="ev-donut-crumbs" aria-label="Category drill path">
                <button
                    type="button"
                    className="ev-crumb"
                    onClick={() => goTo(0)}
                    disabled={path.length === 0}
                >
                    All categories
                </button>
                {path.map((n, i) => (
                    <span key={n.id} className="ev-crumb-seg">
                        <ChevronRight className="size-3 ev-crumb-chev" aria-hidden />
                        <button
                            type="button"
                            className="ev-crumb"
                            onClick={() => goTo(i + 1)}
                            disabled={i === path.length - 1}
                        >
                            {n.name}
                        </button>
                    </span>
                ))}
            </nav>

            <div className="ev-donut-wrap">
                <div
                    className="ev-donut-chart"
                    onMouseLeave={() => setHover(null)}
                    role="img"
                    aria-label={`Spending by category${
                        current ? ` under ${current.name}` : ""
                    }. Total ${fmt(total)}.`}
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={slices}
                                dataKey="total"
                                nameKey="name"
                                innerRadius="64%"
                                outerRadius="92%"
                                paddingAngle={1.5}
                                cornerRadius={5}
                                stroke="none"
                                {...(shownIdx !== null
                                    ? { activeIndex: shownIdx, activeShape: renderActiveSlice }
                                    : {})}
                                onMouseEnter={(_, i) => setHover(i)}
                                onClick={(_, i) => onSliceClick(i)}
                                isAnimationActive={!reduced}
                                animationDuration={420}
                            >
                                {slices.map((s) => (
                                    <Cell
                                        key={s.id}
                                        fill={s.color}
                                        stroke="none"
                                        style={{ cursor: s.drillable ? "pointer" : "default" }}
                                    />
                                ))}
                            </Pie>
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="ev-donut-center">
                        <span className="eyebrow">
                            {activeSlice ? activeSlice.name : current ? current.name : "Total"}
                        </span>
                        <span className="ev-donut-center-val">
                            <Money
                                amount={activeSlice ? activeSlice.total : total}
                                size={22}
                                weight={500}
                            />
                        </span>
                        {activeSlice && total > 0 && (
                            <span className="ev-donut-center-pct">
                                {((activeSlice.total / total) * 100).toFixed(1)}% ·{" "}
                                {activeSlice.txCount} {activeSlice.txCount === 1 ? "tx" : "txs"}
                            </span>
                        )}
                    </div>
                </div>

                <ul className="ev-donut-legend" ref={legendRef}>
                    {slices.map((s, i) => {
                        const pct = total > 0 ? (s.total / total) * 100 : 0;
                        return (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    /* Drillable rows navigate (not toggle), so aria-pressed
                                       only applies to the pin-toggle leaf rows. */
                                    aria-pressed={s.drillable ? undefined : pinned === i}
                                    className={`ev-donut-legend-row${
                                        shownIdx === i ? " is-active" : ""
                                    }${s.drillable ? " is-drillable" : ""}`}
                                    onMouseEnter={() => setHover(i)}
                                    onFocus={() => setHover(i)}
                                    onClick={() => onSliceClick(i)}
                                    aria-label={
                                        s.drillable
                                            ? `${s.name}, drill into sub-categories`
                                            : s.name
                                    }
                                >
                                    <span
                                        className="ev-dot"
                                        style={{ background: s.color }}
                                        aria-hidden
                                    />
                                    <span className="ev-donut-legend-name">{s.name}</span>
                                    <span className="ev-donut-legend-vals">
                                        <Money amount={s.total} size={12.5} weight={500} />
                                        <span className="ev-donut-legend-pct">
                                            {pct.toFixed(0)}%
                                        </span>
                                    </span>
                                    {/* Reserve the trailing chevron slot on every row so the
                                        value column right-aligns whether or not a row drills. */}
                                    {s.drillable ? (
                                        <ChevronRight
                                            className="size-3 ev-crumb-chev"
                                            aria-hidden
                                        />
                                    ) : (
                                        <span
                                            aria-hidden
                                            style={{ width: 12, flexShrink: 0 }}
                                        />
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}

type ActiveSliceProps = {
    cx?: number;
    cy?: number;
    innerRadius?: number;
    outerRadius?: number;
    startAngle?: number;
    endAngle?: number;
    fill?: string;
    cornerRadius?: number;
};

function renderActiveSlice(props: ActiveSliceProps) {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, cornerRadius } = props;
    return (
        <Sector
            cx={cx}
            cy={cy}
            innerRadius={innerRadius}
            outerRadius={(outerRadius ?? 0) + 5}
            startAngle={startAngle}
            endAngle={endAngle}
            fill={fill}
            cornerRadius={cornerRadius}
            stroke="none"
        />
    );
}

/* ------------------------------------------------------------------ *
 *  Radial budget gauge — 270° arc, spent vs estimate, tier-colored.
 * ------------------------------------------------------------------ */

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function RadialBudgetGauge({
    spent,
    estimate,
    size = 200,
}: {
    spent: number;
    estimate: number;
    size?: number;
}) {
    const pct = estimate > 0 ? (spent / estimate) * 100 : 0;
    const clamped = Math.min(Math.max(pct, 0), 100);
    const over = pct > 100;
    const color = over ? "var(--expense)" : pct >= 80 ? "var(--gold)" : "var(--brand)";
    const remaining = estimate - spent;

    const cx = 100;
    const cy = 100;
    const r = 82;
    const [sx, sy] = polar(cx, cy, r, 135);
    const [ex, ey] = polar(cx, cy, r, 405);
    const arc = `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`;

    return (
        <div className="ev-gauge" style={{ width: size }}>
            <svg viewBox="0 0 200 200" width={size} height={size} role="img"
                 aria-label={`${pct.toFixed(0)}% of estimate used`}>
                <path
                    d={arc}
                    fill="none"
                    stroke="var(--line)"
                    strokeWidth={13}
                    strokeLinecap="round"
                    pathLength={100}
                />
                {clamped > 0 && (
                    <path
                        d={arc}
                        fill="none"
                        stroke={color}
                        strokeWidth={13}
                        strokeLinecap="round"
                        pathLength={100}
                        strokeDasharray={`${clamped} 100`}
                        style={{ transition: "stroke-dasharray 600ms cubic-bezier(.22,1,.36,1)" }}
                    />
                )}
            </svg>
            <div className="ev-gauge-center">
                <span className="ev-gauge-pct" style={{ color }}>
                    {pct.toFixed(0)}
                    <span className="ev-gauge-pct-sign">%</span>
                </span>
                <span className="eyebrow">used</span>
                <span className="ev-gauge-sub">
                    {over ? (
                        <>
                            <Money amount={spent - estimate} size={12.5} variant="expense" weight={500} /> over
                        </>
                    ) : (
                        <>
                            <Money amount={remaining} size={12.5} weight={500} /> left
                        </>
                    )}
                </span>
            </div>
        </div>
    );
}

