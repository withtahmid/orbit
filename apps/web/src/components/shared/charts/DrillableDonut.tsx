import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from "recharts";
import { cn } from "@/lib/utils";

export interface DrillableDonutSlice {
    id: string;
    /** Display name for the slice — surfaces in the legend chip + tooltip. */
    name: string;
    value: number;
    /** Hex color for this slice. */
    color: string;
    /** True if clicking the slice should drill into it (renders a halo + chevron). */
    drillable?: boolean;
}

interface Props {
    slices: DrillableDonutSlice[];
    /** Eyebrow text inside the donut (e.g. "Total"). */
    centerLabel?: string;
    /** Pre-formatted value displayed inside the donut. */
    centerValue?: string;
    /** Outer diameter of the donut, in pixels. */
    size?: number;
    /** Click handler for slices and legend chips. */
    onSelect?: (slice: DrillableDonutSlice) => void;
    emptyLabel?: string;
    className?: string;
}

/** Same ring proportions as the shared `Donut` (`@/components/shared/charts/Donut`)
 *  so every donut in the app reads as one system: thin ring, rounded segment
 *  ends, a visible gap between slices. */
const RING_RATIO = 0.62;

/**
 * Editorial-dark donut chart, recharts-based (same `Pie`/`Cell`/`Sector`
 * primitives as the shared `Donut` and the event category donut) — same
 * geometry, same rounded/padded look, so this one no longer stands out as
 * a separate, thicker, sharp-edged implementation. Drillable slices get a
 * thin outer halo ring (a second `Pie` layer sharing the same angular
 * partitioning as the main ring, so it always lines up) that brightens on
 * hover, signalling "click to descend." Pairs with a chip-style legend
 * below the chart that surfaces a `>` chevron for drillable items.
 */
export function DrillableDonut({
    slices,
    centerLabel = "Total",
    centerValue,
    size = 240,
    onSelect,
    emptyLabel = "No data",
    className,
}: Props) {
    const [hoverId, setHoverId] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    if (slices.length === 0) {
        return (
            <div
                className={cn(
                    "flex items-center justify-center text-sm text-muted-foreground",
                    className
                )}
                style={{ height: size }}
            >
                {emptyLabel}
            </div>
        );
    }

    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    const hovered = hoverId ? slices.find((s) => s.id === hoverId) : null;
    // Screen readers and touch users otherwise get nothing until they
    // find and tap a slice — mirrors the shared `Donut`'s per-slice
    // summary so both donuts are equally accessible.
    const summaryLabel = `${centerLabel} ${centerValue ?? formatShort(total)}. Breakdown: ${slices
        .map((s) => `${s.name} ${formatShort(s.value)}`)
        .join(", ")}`;

    const pieActiveProps =
        activeIndex !== null ? { activeIndex, activeShape: renderActiveShape } : {};

    const handleEnter = (id: string, i: number) => {
        setHoverId(id);
        setActiveIndex(i);
    };
    const handleLeave = () => {
        setHoverId(null);
        setActiveIndex(null);
    };

    return (
        <div className={cn("flex flex-col items-center gap-4", className)}>
            <div
                className="relative"
                style={{ width: size, height: size }}
                onMouseLeave={handleLeave}
                role="img"
                aria-label={summaryLabel}
            >
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={slices}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={`${Math.round(RING_RATIO * 100)}%`}
                            outerRadius="88%"
                            paddingAngle={1.5}
                            cornerRadius={6}
                            stroke="none"
                            {...pieActiveProps}
                            onMouseEnter={(_, i) => handleEnter(slices[i].id, i)}
                            onClick={(_, i) => onSelect?.(slices[i])}
                            isAnimationActive={true}
                            animationDuration={400}
                        >
                            {slices.map((s) => (
                                <Cell
                                    key={s.id}
                                    fill={s.color}
                                    stroke="none"
                                    style={{
                                        cursor: s.drillable || onSelect ? "pointer" : "default",
                                    }}
                                />
                            ))}
                        </Pie>
                        {/* Drillable halo — a thin hint ring just outside the
                            main ring (mirrors the original hand-rolled
                            version's 1.5px stroke, not a thick second band —
                            a wide filled arc reads as a duplicate donut when
                            several adjacent slices are all drillable).
                            Shares the exact same `data`/`paddingAngle` as the
                            main ring so its slices' angles always line up;
                            only drillable cells get a visible fill. */}
                        <Pie
                            data={slices}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="90%"
                            outerRadius="91.5%"
                            paddingAngle={1.5}
                            stroke="none"
                            isAnimationActive={false}
                        >
                            {slices.map((s) => (
                                <Cell
                                    key={s.id}
                                    fill={s.drillable ? s.color : "transparent"}
                                    fillOpacity={s.drillable ? (hoverId === s.id ? 0.75 : 0.3) : 0}
                                    stroke="none"
                                />
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {hovered ? hovered.name : centerLabel}
                    </p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums sm:text-2xl">
                        {hovered ? formatShort(hovered.value) : (centerValue ?? formatShort(total))}
                    </p>
                </div>
            </div>

            {/* Chip legend — wraps under the donut, drillable chips show a > arrow */}
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5">
                {slices.map((s) => {
                    const drillable = !!s.drillable;
                    return (
                        <button
                            key={s.id}
                            type="button"
                            onMouseEnter={() =>
                                handleEnter(
                                    s.id,
                                    slices.findIndex((x) => x.id === s.id)
                                )
                            }
                            onMouseLeave={handleLeave}
                            onClick={() => onSelect?.(s)}
                            aria-label={
                                drillable
                                    ? `Drill into ${s.name}, ${formatShort(s.value)}`
                                    : onSelect
                                      ? `View ${s.name} transactions, ${formatShort(s.value)}`
                                      : `${s.name}, ${formatShort(s.value)}`
                            }
                            className={cn(
                                "inline-flex items-center gap-1.5 text-[11px] transition-colors",
                                drillable || onSelect
                                    ? "text-muted-foreground hover:text-foreground"
                                    : "text-muted-foreground cursor-default"
                            )}
                        >
                            <span
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: s.color }}
                            />
                            <span>{s.name}</span>
                            {drillable && (
                                <ChevronRight className="size-3 text-muted-foreground/60" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

interface ActiveShapeProps {
    cx?: number;
    cy?: number;
    innerRadius?: number;
    outerRadius?: number;
    startAngle?: number;
    endAngle?: number;
    fill?: string;
    cornerRadius?: number;
}

/**
 * Recharts active-shape renderer — renders a slightly enlarged slice under
 * the cursor, same color, no stroke. Matches the shared `Donut`'s hover
 * treatment (`@/components/shared/charts/Donut`).
 */
function renderActiveShape(props: ActiveShapeProps) {
    const {
        cx,
        cy,
        innerRadius,
        outerRadius = 0,
        startAngle,
        endAngle,
        fill,
        cornerRadius,
    } = props;
    return (
        <Sector
            cx={cx}
            cy={cy}
            innerRadius={innerRadius}
            outerRadius={outerRadius + 6}
            startAngle={startAngle}
            endAngle={endAngle}
            fill={fill}
            cornerRadius={cornerRadius}
            stroke="none"
        />
    );
}

function formatShort(n: number): string {
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
