import { useMemo, useState } from "react";
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip as RTooltip,
    XAxis,
    YAxis,
} from "recharts";
import { formatCompact } from "@/lib/spendHeatmapColor";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

export interface LineSeriesItem {
    id: string;
    name: string;
    color: string;
}

interface DotRenderProps {
    cx?: number;
    cy?: number;
    index?: number;
    payload?: Record<string, string | number | null>;
}

/**
 * Per-point marker for the primary line when a `secondary` reference
 * series is present — over-reference points get a bigger, ringed red
 * dot; under-reference points get a small dot in the series' own color.
 * Size + ring (not just hue) carry the signal so it doesn't rely on
 * color alone.
 *
 * When `secondary.dotAt` is set, only that one index gets a dot — dense
 * data (e.g. ~30 daily points per line) would otherwise dot every single
 * point, which reads as clutter; sparse data (e.g. 12 months) is fine to
 * dot at every point.
 */
function renderOverUnderDot(
    props: DotRenderProps,
    item: LineSeriesItem,
    secondary: { suffix: string; label: string; dotAt?: number },
    active: boolean
) {
    const { cx, cy, payload, index } = props;
    const value = payload?.[item.id];
    const reference = payload?.[`${item.id}${secondary.suffix}`];
    if (
        typeof value !== "number" ||
        cx == null ||
        cy == null ||
        (secondary.dotAt != null && index !== secondary.dotAt)
    ) {
        return <g key={`${item.id}-dot-${index}`} />;
    }
    const isOver = typeof reference === "number" && reference > 0 && value > reference;
    return (
        <circle
            key={`${item.id}-dot-${index}`}
            cx={cx}
            cy={cy}
            r={isOver ? 4 : 2.25}
            fill={isOver ? "var(--expense)" : item.color}
            stroke={isOver ? "var(--card)" : "none"}
            strokeWidth={isOver ? 1.5 : 0}
            opacity={active ? 1 : 0.12}
        />
    );
}

/**
 * One line per series item (envelope, category, ...), all sharing an
 * x-axis and one legend — lets every item's trajectory be compared
 * directly instead of paging through them one at a time.
 *
 * With more than a handful of items, that many overlapping lines reads
 * as noise (line charts stop being readable past ~6 series) — rather
 * than hide any item by default, the legend is clickable: pick one to
 * isolate it (dim the rest) and click again to bring everyone back.
 * Works on tap, not just hover, so it isn't gesture/mouse-only.
 */
export function MultiSeriesLineChart({
    data,
    series,
    ariaLabel,
    secondary,
}: {
    data: Array<Record<string, string | number | null>>;
    series: LineSeriesItem[];
    ariaLabel: string;
    /** When set, each item gets a second dashed line reading from
     *  `${id}${suffix}` — e.g. allocated alongside consumed. */
    secondary?: { suffix: string; label: string; dotAt?: number };
}) {
    const TOOLTIP_MAX = 8;
    const [isolated, setIsolated] = useState<string | null>(null);
    const toggle = (id: string) => setIsolated((cur) => (cur === id ? null : id));

    // Isolating a line rescales the Y axis to just that line's range —
    // otherwise it stays squashed against a scale sized for every series,
    // hiding exactly the variation the user isolated it to see.
    const yDomain = useMemo(() => {
        if (!isolated) return undefined;
        let min = Infinity;
        let max = -Infinity;
        for (const row of data) {
            const v = row[isolated];
            if (typeof v === "number") {
                min = Math.min(min, v);
                max = Math.max(max, v);
            }
            if (secondary) {
                const sv = row[`${isolated}${secondary.suffix}`];
                if (typeof sv === "number") {
                    min = Math.min(min, sv);
                    max = Math.max(max, sv);
                }
            }
        }
        if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
        if (min === max) return [Math.max(0, min - 1), max + 1] as [number, number];
        const pad = (max - min) * 0.1;
        return [Math.max(0, min - pad), max + pad] as [number, number];
    }, [isolated, data, secondary]);

    return (
        <div className="flex h-full flex-col gap-2">
            <div className="min-h-0 flex-1" role="img" aria-label={ariaLabel}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid
                            vertical={false}
                            strokeDasharray="2 4"
                            stroke="var(--border)"
                        />
                        <XAxis
                            dataKey="x"
                            stroke="var(--muted-foreground)"
                            tickLine={false}
                            axisLine={false}
                            fontSize={11}
                        />
                        <YAxis
                            stroke="var(--muted-foreground)"
                            tickLine={false}
                            axisLine={false}
                            fontSize={11}
                            width={44}
                            domain={yDomain ?? ["auto", "auto"]}
                            allowDataOverflow={!!yDomain}
                            tickFormatter={(v) => formatCompact(v)}
                        />
                        <RTooltip
                            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "2 4" }}
                            content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null;
                                const byKey = new Map(payload.map((p) => [p.dataKey as string, p]));
                                const items = series
                                    .filter((it) => !isolated || isolated === it.id)
                                    .map((it) => {
                                        const primary = byKey.get(it.id);
                                        const secondaryPoint = secondary
                                            ? byKey.get(`${it.id}${secondary.suffix}`)
                                            : undefined;
                                        const primaryVal =
                                            typeof primary?.value === "number"
                                                ? primary.value
                                                : null;
                                        const secondaryVal =
                                            typeof secondaryPoint?.value === "number"
                                                ? secondaryPoint.value
                                                : null;
                                        return { item: it, primaryVal, secondaryVal };
                                    })
                                    .filter((r) => r.primaryVal != null || r.secondaryVal != null)
                                    .sort((a, b) => (b.primaryVal ?? 0) - (a.primaryVal ?? 0));
                                const shown = items.slice(0, TOOLTIP_MAX);
                                const overflow = items.length - shown.length;
                                return (
                                    <div className="max-w-[240px] rounded-md border border-border bg-popover p-2.5 text-xs shadow-lg">
                                        <p className="mb-1.5 font-medium">{label}</p>
                                        <div className="flex flex-col gap-2 tabular-nums">
                                            {shown.map(({ item, primaryVal, secondaryVal }) => (
                                                <div key={item.id}>
                                                    <span className="inline-flex min-w-0 items-center gap-1.5">
                                                        <span
                                                            className="size-1.5 shrink-0 rounded-full"
                                                            style={{ backgroundColor: item.color }}
                                                        />
                                                        <span className="truncate font-medium">
                                                            {item.name}
                                                        </span>
                                                    </span>
                                                    <div className="flex items-center justify-between gap-4 pl-3 text-muted-foreground">
                                                        <span>{secondary ? "Spent" : ""}</span>
                                                        <span>{formatMoney(primaryVal ?? 0)}</span>
                                                    </div>
                                                    {secondary && secondaryVal != null && (
                                                        <div className="flex items-center justify-between gap-4 pl-3 text-muted-foreground">
                                                            <span>{secondary.label}</span>
                                                            <span>{formatMoney(secondaryVal)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            {overflow > 0 && (
                                                <p className="text-[10.5px] text-muted-foreground">
                                                    +{overflow} more
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        {series.flatMap((it) => {
                            const active = !isolated || isolated === it.id;
                            const lines = [
                                <Line
                                    key={it.id}
                                    dataKey={it.id}
                                    name={it.name}
                                    stroke={it.color}
                                    strokeWidth={isolated === it.id ? 2.5 : 1.75}
                                    strokeOpacity={active ? 1 : 0.12}
                                    dot={
                                        secondary
                                            ? (dotProps: DotRenderProps) =>
                                                  renderOverUnderDot(
                                                      dotProps,
                                                      it,
                                                      secondary,
                                                      active
                                                  )
                                            : false
                                    }
                                    activeDot={{ r: 4 }}
                                    connectNulls={false}
                                    isAnimationActive
                                    animationDuration={300}
                                    animationEasing="ease-out"
                                />,
                            ];
                            if (secondary) {
                                lines.push(
                                    <Line
                                        key={`${it.id}${secondary.suffix}`}
                                        dataKey={`${it.id}${secondary.suffix}`}
                                        name={`${it.name} (${secondary.label})`}
                                        stroke={it.color}
                                        strokeWidth={isolated === it.id ? 1.75 : 1.25}
                                        strokeOpacity={active ? 0.55 : 0.08}
                                        strokeDasharray="4 3"
                                        dot={false}
                                        connectNulls={false}
                                        isAnimationActive
                                        animationDuration={300}
                                        animationEasing="ease-out"
                                    />
                                );
                            }
                            return lines;
                        })}
                    </LineChart>
                </ResponsiveContainer>
            </div>
            {secondary && (
                <p className="text-[10px] text-muted-foreground">
                    Solid = spent · Dashed = {secondary.label.toLowerCase()} · Red dot = over that
                    point
                </p>
            )}
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto sm:max-h-24">
                {series.map((it) => (
                    <button
                        key={it.id}
                        type="button"
                        onClick={() => toggle(it.id)}
                        aria-pressed={isolated === it.id}
                        className={cn(
                            "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] transition-colors",
                            isolated === it.id
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            isolated && isolated !== it.id && "opacity-60"
                        )}
                    >
                        <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: it.color }}
                        />
                        {it.name}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default MultiSeriesLineChart;
