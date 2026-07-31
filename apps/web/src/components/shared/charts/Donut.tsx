import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip as RTooltip } from "recharts";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { colorForId } from "@/lib/entityStyle";

export interface DonutDatum {
    id: string;
    name: string;
    value: number;
    /** Hex color. Falls back to a deterministic hash of `id`. */
    color?: string;
    /** Optional subtitle shown in the tooltip. */
    hint?: string;
}

interface Props {
    data: DonutDatum[];
    /** Label shown centered inside the donut when nothing is hovered. */
    centerLabel?: string;
    /** Value shown under the center label (falls back to sum of values). */
    centerValue?: number;
    /** Height of the chart area in pixels. */
    height?: number;
    /** Inner:outer ring ratio — 0.62 is a modern thick donut. */
    ringRatio?: number;
    /** Hide the side legend (e.g., on very small cards). */
    hideLegend?: boolean;
    /** Hide the floating hover tooltip — use when the center label already
     *  swaps to the hovered slice's name/value/percent, making a second
     *  floating tooltip with the same info redundant. */
    hideTooltip?: boolean;
    /** Format a numeric value for display. */
    format?: (n: number) => string;
    className?: string;
    /** Called with datum when user clicks a slice or legend row. */
    onSelect?: (d: DonutDatum) => void;
    emptyLabel?: string;
    /** Externally-controlled active (hovered) slice id. Pass this (with
     *  `onActiveIdChange`) to drive the donut's highlight from an external
     *  legend rendered elsewhere (e.g. via `hideLegend`) — hovering that
     *  external row can then activate the matching slice here, and vice
     *  versa. Omit for the default uncontrolled behavior (own hover state,
     *  own built-in legend). */
    activeId?: string | null;
    /** Fired whenever the hovered slice changes — whether the hover came
     *  from the pie itself or (when not hidden) this component's own
     *  legend row. Lets an external legend mirror the donut's hover state
     *  even when it isn't the one controlling `activeId`. */
    onActiveIdChange?: (id: string | null) => void;
}

/**
 * Modern donut chart.
 *   - No white stroke between segments (hollow look gone).
 *   - Center shows a label + total by default; hovering a slice replaces
 *     the center with that slice's name + value.
 *   - Hovered slice grows a few pixels for affordance.
 *   - Side legend with colored dot + name + value + percent. Scrollable
 *     when there are many segments.
 *   - Tooltip with name, value, percent, optional hint.
 */
export function Donut({
    data,
    centerLabel,
    centerValue,
    height = 280,
    ringRatio = 0.62,
    hideLegend = false,
    hideTooltip = false,
    format = formatMoney,
    className,
    onSelect,
    emptyLabel = "No data",
    activeId,
    onActiveIdChange,
}: Props) {
    const normalized = useMemo(
        () =>
            data
                .filter((d) => Number.isFinite(d.value) && d.value > 0)
                .map((d) => ({
                    ...d,
                    color: d.color ?? colorForId(d.id),
                })),
        [data]
    );
    /** Actual sum of the visualized slices — the only correct denominator
     *  for "% of total" math. `centerValue` is a caller-supplied headline
     *  number (e.g. "Spendables") that's allowed to legitimately differ
     *  from the slice sum (that's the whole point of the prop), so it
     *  must never be used to compute a percentage — doing so silently
     *  produces nonsense like a legend reading "106%" and "30%" for two
     *  slices of the same pie. */
    const sliceSum = useMemo(() => normalized.reduce((acc, d) => acc + d.value, 0), [normalized]);
    /** What the center label shows when nothing is hovered — this one
     *  legitimately falls back to `centerValue`. */
    const total = centerValue ?? sliceSum;
    // Text summary for screen readers / touch users — the chart is
    // otherwise silent when both the legend and the hover tooltip are
    // hidden (the wedge identity would only ever be visible to a mouse
    // user hovering, since it just swaps the center label).
    const summaryLabel = useMemo(() => {
        const parts = normalized.map((d) => `${d.name} ${format(d.value)}`).join(", ");
        return `${centerLabel ?? "Total"} ${format(total)}${parts ? `. Breakdown: ${parts}` : ""}`;
    }, [normalized, format, centerLabel, total]);

    const [internalActiveIndex, setInternalActiveIndex] = useState<number | null>(null);
    // Controlled (`activeId` passed) vs uncontrolled: an external legend
    // (rendered via `hideLegend` elsewhere) can drive the highlight by id;
    // otherwise the donut tracks its own hover state as before.
    const isControlled = activeId !== undefined;
    const activeIndex = isControlled
        ? (() => {
              const i = normalized.findIndex((d) => d.id === activeId);
              return i >= 0 ? i : null;
          })()
        : internalActiveIndex;
    const activeDatum = activeIndex !== null ? normalized[activeIndex] : null;
    const setActive = (i: number | null) => {
        if (!isControlled) setInternalActiveIndex(i);
        onActiveIdChange?.(i !== null ? (normalized[i]?.id ?? null) : null);
    };

    if (normalized.length === 0) {
        return (
            <div
                className={cn(
                    "flex items-center justify-center text-sm text-muted-foreground",
                    className
                )}
                style={{ height }}
            >
                {emptyLabel}
            </div>
        );
    }

    // recharts' activeIndex triggers activeShape for that index. Some
    // versions hide the non-active slice when an activeIndex is set, so only
    // wire activeIndex/activeShape when the user is actively hovering —
    // otherwise pass nothing and let recharts render plain sectors.
    const pieActiveProps =
        activeIndex !== null
            ? {
                  activeIndex,
                  activeShape: renderActiveShape,
              }
            : {};

    return (
        <div
            className={cn(
                // Layout is driven by the card's *own* width (container
                // queries) rather than the viewport, so this works both
                // in 3-up overview cards and wide detail views.
                "@container grid gap-4",
                !hideLegend && "@md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]",
                className
            )}
        >
            <div
                className="relative mx-auto w-full min-w-0 max-w-[18rem] @md:mx-0"
                style={{ height }}
                onMouseLeave={() => setActive(null)}
                role="img"
                aria-label={summaryLabel}
            >
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={normalized}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={`${Math.round(ringRatio * 100)}%`}
                            outerRadius="92%"
                            paddingAngle={1.5}
                            cornerRadius={6}
                            stroke="none"
                            strokeWidth={0}
                            {...pieActiveProps}
                            onMouseEnter={(_, i) => setActive(i)}
                            onClick={(_, i) => onSelect?.(normalized[i])}
                            isAnimationActive={true}
                            animationDuration={400}
                        >
                            {normalized.map((d) => (
                                <Cell key={d.id} fill={d.color} stroke="none" />
                            ))}
                        </Pie>
                        {!hideTooltip && (
                            <RTooltip
                                cursor={false}
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const item = payload[0].payload as DonutDatum;
                                    const pct = sliceSum > 0 ? (item.value / sliceSum) * 100 : 0;
                                    return (
                                        <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-lg">
                                            <div className="flex items-center gap-2 font-medium">
                                                <span
                                                    className="inline-block size-2.5 rounded-sm"
                                                    style={{ backgroundColor: item.color }}
                                                />
                                                {item.name}
                                            </div>
                                            <div className="mt-1 tabular-nums">
                                                {format(item.value)}
                                                <span className="ml-2 text-muted-foreground">
                                                    {pct.toFixed(1)}%
                                                </span>
                                            </div>
                                            {item.hint && (
                                                <div className="mt-0.5 text-[10px] text-muted-foreground">
                                                    {item.hint}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }}
                            />
                        )}
                    </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {activeDatum ? activeDatum.name : (centerLabel ?? "Total")}
                    </p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums sm:text-2xl">
                        {format(activeDatum ? activeDatum.value : total)}
                    </p>
                    {activeDatum && sliceSum > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                            {((activeDatum.value / sliceSum) * 100).toFixed(1)}% of total
                        </p>
                    )}
                </div>
            </div>

            {!hideLegend && (
                <ul className="flex max-h-[280px] flex-col gap-1 overflow-y-auto pr-1 text-sm">
                    {normalized.map((d, i) => {
                        const pct = sliceSum > 0 ? (d.value / sliceSum) * 100 : 0;
                        const isActive = activeIndex === i;
                        return (
                            <li key={d.id}>
                                <button
                                    type="button"
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => onSelect?.(d)}
                                    className={cn(
                                        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                                        isActive && "bg-accent/50"
                                    )}
                                >
                                    <span
                                        className="mt-[5px] inline-block size-2.5 shrink-0 rounded-sm"
                                        style={{ backgroundColor: d.color }}
                                    />
                                    <span className="line-clamp-2 min-w-0 flex-1 break-words font-medium leading-snug">
                                        {d.name}
                                    </span>
                                    <span className="flex shrink-0 flex-col items-end leading-tight">
                                        <span className="tabular-nums">{format(d.value)}</span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {pct.toFixed(0)}%
                                        </span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

/**
 * Recharts active-shape renderer — renders a slightly enlarged slice under
 * the cursor, same color, no stroke. Bypasses recharts' default white outline
 * that was making the chart look "bordered."
 */
/* Recharts types `activeShape` as a loose renderer and doesn't export a
   props type for it, so declare the geometry this renderer actually reads.
   Everything is optional because recharts fills the slice geometry in at
   render time. */
type ActiveShapeProps = {
    cx?: number;
    cy?: number;
    innerRadius?: number;
    outerRadius?: number;
    startAngle?: number;
    endAngle?: number;
    fill?: string;
    cornerRadius?: number;
};

function renderActiveShape(props: ActiveShapeProps) {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, cornerRadius } = props;
    return (
        <Sector
            cx={cx}
            cy={cy}
            innerRadius={innerRadius}
            outerRadius={(outerRadius ?? 0) + 6}
            startAngle={startAngle}
            endAngle={endAngle}
            fill={fill}
            cornerRadius={cornerRadius}
            stroke="none"
        />
    );
}
