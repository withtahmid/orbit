/* EnvelopeSpendChart — a fork of the analytics `CumulativeRaceChart`, owned by
 * the envelope detail page so it can diverge freely without touching the
 * shared analytics chart. Same interactive cumulative-race (this period vs.
 * last vs. typical + projection, hover tooltip, per-curve dots), plus:
 *   - `color`  — themes the "this period" series to the envelope's own colour.
 *   - `budget` — draws the on-budget PACE line (budget/D → budget, the even
 *                daily allowance) + the budget ceiling, and adds a "pace" row
 *                to the hover tooltip.
 *   - taller canvas for a more detailed read.
 *
 * Kept as a copy on purpose (per product direction): the envelope detail chart
 * will accrue envelope-specific customisation the space-wide Trends view must
 * not inherit.
 */

import {
    useRef,
    useState,
    type CSSProperties,
    type MouseEventHandler,
    type TouchEvent as ReactTouchEvent,
} from "react";
import { addDays, addMonths } from "@/lib/dates";
import { formatInAppTz } from "@/lib/formatDate";

/** Compact Y-axis tick: whole numbers below 1K (so a 500-budget envelope
 *  reads "300"/"400" instead of a confusing "0.3K"), K above. */
function fmtYTick(v: number): string {
    if (v >= 1000) {
        const k = v / 1000;
        return `${k >= 10 ? Math.round(k) : k.toFixed(1)}K`;
    }
    return String(Math.round(v));
}

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

export function EnvelopeSpendChart({
    cur,
    prv,
    avg,
    today,
    daysInMonth,
    projection,
    bucketUnit,
    periodStart,
    color,
    budget,
    showToday = true,
    archived = false,
    ariaLabel,
    emptyLabel = "No spend recorded in this period yet.",
}: {
    cur: number[];
    prv: number[];
    avg: number[] | null;
    today: number;
    daysInMonth: number;
    projection: number;
    bucketUnit: "day" | "week" | "month";
    periodStart: Date;
    /** Envelope's own colour — themes the current-period line/area/markers. */
    color: string;
    /** On-budget pace target; when set, draws the pace guide + ceiling and a
     *  tooltip "pace" row. Null/absent (rolling) hides all budget chrome. */
    budget?: number | null;
    /** Suppress the "Today" marker/label (e.g. viewing a completed past
     *  month, where labeling month-end "Today" would mislead). */
    showToday?: boolean;
    /** Archived (frozen) envelopes never paint an alarm color anywhere on
     *  this page — the over-pace escalation mutes to neutral gray here too,
     *  matching the chart-foot's existing expenseC/warnC muting. */
    archived?: boolean;
    /** Spoken summary for the chart's role="img". */
    ariaLabel?: string;
    /** Message shown when there's nothing to plot (no spend, budget, or
     *  history) — the page passes a next-step hint for new envelopes. */
    emptyLabel?: string;
}) {
    const bucketDate = (i: number): Date => {
        if (bucketUnit === "month") return addMonths(periodStart, i);
        if (bucketUnit === "week") return addDays(periodStart, i * 7);
        return addDays(periodStart, i);
    };

    const axisDateFormat = bucketUnit === "month" ? "MMM" : "MMM d";
    const tooltipDateFormat = bucketUnit === "month" ? "MMMM yyyy" : "MMM d, yyyy";

    const w = 800;
    const h = 520;
    const p = 34;
    const hasBudget = budget != null && budget > 0;
    const avgEndpoint = avg ? (avg[avg.length - 1] ?? 0) : 0;
    const rawMax = Math.max(
        prv[prv.length - 1] ?? 0,
        cur[today - 1] ?? 0,
        projection,
        avgEndpoint,
        hasBudget ? budget : 0
    );
    const noData = !Number.isFinite(rawMax) || rawMax <= 0 || cur.length === 0;
    const max = (rawMax > 0 ? rawMax : 1) * 1.1;
    const denom = Math.max(1, daysInMonth - 1);
    const sx = (i: number) => p + (i / denom) * (w - p * 2);
    /* The prior period has its own day count — January is 31 days even when
       this chart is showing February — so it gets its own x-scale and both
       curves race on fraction-of-period-elapsed. On a shared scale the dashed
       line either overflowed the plot on the right or plateaued for the last
       few days. */
    const prvDenom = Math.max(1, prv.length - 1);
    const sxPrev = (i: number) => p + (i / prvDenom) * (w - p * 2);
    /** Prior-series index at the same fraction through its period as `i` is
     *  through the current one — keeps hover dots on the drawn line. */
    const prvIdxAt = (i: number) =>
        Math.max(0, Math.min(prv.length - 1, Math.round((i / denom) * prvDenom)));
    const sy = (v: number) => h - p - (v / max) * (h - p * 2);
    const todayX = sx(today - 1);
    const todayY = sy(cur[today - 1] ?? 0);

    const prvPath = prv
        .map((v, i) => `${i ? "L" : "M"}${sxPrev(i).toFixed(1)} ${sy(v).toFixed(1)}`)
        .join(" ");
    const curSlice = cur.slice(0, today);
    const curPath = curSlice
        .map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`)
        .join(" ");
    const projPath = `M${todayX} ${todayY} L${sx(daysInMonth - 1)} ${sy(projection)}`;

    /* Daily-volume bar strip beneath the cumulative curve — same idea as
     * the event detail page's `SpendTimelineChart`: per-day amounts (here
     * derived by diffing the cumulative `cur` series, since that's all
     * this chart is handed). Shares the SAME `sy()`/`max` scale as the
     * cumulative line — an earlier version rode its own capped scale so
     * a full-height bar only reached ~28% up, which looked wrong: a
     * bar's top didn't correspond to the dollar value the Y-axis labels
     * actually show. Only drawn for days that have actually happened
     * (`< today`), matching `curSlice`. */
    const dailyCur = cur.map((v, i) => Math.max(0, v - (i > 0 ? (cur[i - 1] ?? 0) : 0)));
    const barBaseline = sy(0);
    const daySpacing = (w - p * 2) / denom;
    const barWidth = Math.max(2, Math.min(14, daySpacing * 0.6));
    const avgPath =
        avg && avgEndpoint > 0
            ? avg.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ")
            : null;
    const curArea = `${curPath} L ${todayX} ${h - p} L ${p} ${h - p} Z`;
    const paceAt = (i: number) => (hasBudget ? (budget * (i + 1)) / daysInMonth : 0);
    // Today's actual spend sitting above the on-budget pace line — the
    // chart escalates this at a glance (bracket + larger pulsing dot),
    // not just the small footnote below it. Severity is two-tiered so the
    // color doesn't collide with the separate, more serious "already over
    // the WHOLE month's budget" state: --warn (amber) for merely ahead of
    // pace but still within budget, --expense (red) once spend has passed
    // the budget itself. Archived (frozen) envelopes mute to neutral gray,
    // matching every other alarm color on this page.
    const isOverPace = hasBudget && showToday && (cur[today - 1] ?? 0) > paceAt(today - 1);
    const isOverBudget = hasBudget && (cur[today - 1] ?? 0) > budget;
    const alertColor = archived ? "var(--fg-3)" : isOverBudget ? "var(--expense)" : "var(--warn)";
    const paceNowY = sy(paceAt(today - 1));

    const dayTicks =
        daysInMonth <= 7
            ? Array.from({ length: daysInMonth }, (_, i) => i + 1)
            : daysInMonth <= 31
              ? [1, 7, 14, 21, daysInMonth]
              : [
                    1,
                    Math.round(daysInMonth * 0.25),
                    Math.round(daysInMonth * 0.5),
                    Math.round(daysInMonth * 0.75),
                    daysInMonth,
                ];

    const xPct = (svgX: number) => (svgX / w) * 100;
    const projY = sy(projection);
    const lastY = sy(prv[prv.length - 1] ?? 0);
    // Endpoint/hover markers are HTML overlays, not SVG <circle>s: the chart
    // uses preserveAspectRatio="none", which would squash circles into
    // ellipses on wide cards. The container is exactly `h` px tall and the
    // viewBox is `h` tall, so svg-y maps 1:1 to `top` px; x maps by width %.
    const dotStyle = (
        svgX: number,
        svgY: number,
        dia: number,
        bg: string,
        ring = true,
        opacity = 1
    ): CSSProperties => ({
        position: "absolute",
        left: `${xPct(svgX)}%`,
        top: svgY,
        width: dia,
        height: dia,
        transform: "translate(-50%, -50%)",
        borderRadius: "9999px",
        background: bg,
        opacity,
        boxShadow: ring ? "0 0 0 1.5px var(--bg)" : undefined,
        pointerEvents: "none",
    });

    const gradId = "envSpendGrad";
    const containerRef = useRef<HTMLDivElement>(null);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const setIdxFromClientX = (clientX: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const xWithin = clientX - rect.left;
        const svgX = (xWithin / rect.width) * w;
        const raw = ((svgX - p) / (w - p * 2)) * denom;
        const idx = Math.max(0, Math.min(daysInMonth - 1, Math.round(raw)));
        setHoverIdx(idx);
    };
    const handleMove: MouseEventHandler<HTMLDivElement> = (e) => setIdxFromClientX(e.clientX);
    const handleTouch = (e: ReactTouchEvent<HTMLDivElement>) => {
        const t = e.touches[0];
        if (t) setIdxFromClientX(t.clientX);
    };
    const bucketLabelSingular =
        bucketUnit === "month" ? "Month" : bucketUnit === "week" ? "Week" : "Day";

    if (noData) {
        return (
            <div
                className="flex w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/10"
                style={{ height: h }}
            >
                <span className="px-4 text-center text-sm text-muted-foreground">{emptyLabel}</span>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div
                ref={containerRef}
                className="relative w-full"
                // pan-y lets the browser keep vertical page scroll while our
                // touch handlers still receive horizontal moves for the
                // tooltip scrub — `touch-none` here trapped page scroll.
                style={{ height: h, touchAction: "pan-y" }}
                onMouseMove={handleMove}
                onMouseLeave={() => setHoverIdx(null)}
                onTouchStart={handleTouch}
                onTouchMove={handleTouch}
                onTouchEnd={() => setHoverIdx(null)}
            >
                <svg
                    viewBox={`0 0 ${w} ${h}`}
                    width="100%"
                    height="100%"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={ariaLabel ?? "Cumulative spend chart"}
                >
                    <defs>
                        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </linearGradient>
                    </defs>

                    {/* Y gridlines */}
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

                    {/* Today marker */}
                    {showToday ? (
                        <line
                            x1={todayX}
                            x2={todayX}
                            y1={p}
                            y2={h - p}
                            stroke={color}
                            strokeOpacity={0.4}
                            strokeDasharray="3 4"
                        />
                    ) : null}

                    {/* Typical average */}
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

                    {/* Last period */}
                    <path
                        d={prvPath}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        opacity={0.7}
                        vectorEffect="non-scaling-stroke"
                    />

                    {/* Current period */}
                    <path d={curArea} fill={`url(#${gradId})`} />
                    {/* Daily-volume bars — themed to the envelope's own
                        color (not a generic expense red) so the strip
                        reads as part of the same series as the cumulative
                        line above it, not a separate metric. Sit on top of
                        the translucent area fill but under the cumulative
                        stroke, so the running-total line always stays the
                        clearest read even where a tall bar and the curve
                        overlap. */}
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
                                    fill={color}
                                    fillOpacity={0.32}
                                />
                            ) : null
                        )}
                    {/* Budget ceiling + on-budget pace guide — drawn after
                        the bars (not before, as originally) so a tall
                        early-day bar can no longer visually cover the
                        pace guide's low left end; the guide/ceiling stay
                        readable at every x, and still sit under the
                        current-period stroke below. */}
                    {hasBudget ? (
                        <>
                            <line
                                x1={p}
                                x2={w - p}
                                y1={sy(budget)}
                                y2={sy(budget)}
                                stroke={archived ? "var(--fg-3)" : "var(--expense, #ef4444)"}
                                strokeOpacity={0.5}
                                strokeDasharray="1 4"
                                vectorEffect="non-scaling-stroke"
                            />
                            {/* Draw the guide through the SAME paceAt() points
                             *  the hover dot + tooltip use, so the labeled
                             *  number always rides exactly on the line
                             *  (paceAt(0)=budget/D at day 1 → budget at month
                             *  end), rather than starting at 0. */}
                            <path
                                d={`M${sx(0)} ${sy(paceAt(0))} L${sx(daysInMonth - 1)} ${sy(paceAt(daysInMonth - 1))}`}
                                fill="none"
                                stroke="var(--foreground)"
                                strokeWidth={1.5}
                                strokeOpacity={0.55}
                                strokeDasharray="6 5"
                                vectorEffect="non-scaling-stroke"
                            />
                        </>
                    ) : null}
                    <path
                        d={curPath}
                        fill="none"
                        stroke={color}
                        strokeWidth={2.25}
                        vectorEffect="non-scaling-stroke"
                    />

                    {/* Projection */}
                    <path
                        d={projPath}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                        strokeDasharray="2 3"
                        opacity={0.7}
                        vectorEffect="non-scaling-stroke"
                    />

                    {/* Over-pace alert bracket — a measured gap between
                        today's actual point and the pace line at the same
                        x, so overspending reads as a shape, not just a
                        colored dot. */}
                    {isOverPace ? (
                        <line
                            x1={todayX}
                            x2={todayX}
                            y1={todayY}
                            y2={paceNowY}
                            stroke={alertColor}
                            strokeWidth={2}
                            strokeDasharray="3 3"
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="none"
                        />
                    ) : null}

                    {/* Hover guide line (dots are HTML overlays below) */}
                    {hoverIdx !== null ? (
                        <line
                            x1={sx(hoverIdx)}
                            x2={sx(hoverIdx)}
                            y1={p}
                            y2={h - p}
                            stroke="var(--fg-3)"
                            strokeOpacity={0.55}
                            strokeWidth={1}
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="none"
                        />
                    ) : null}
                </svg>

                {/* Endpoint + hover dots as HTML overlays (SVG circles distort
                    to ellipses under preserveAspectRatio="none"). */}
                {showToday ? (
                    <>
                        {isOverPace ? (
                            // Two nested elements on purpose: `animate-ping`
                            // animates `transform: scale(...)` via keyframes,
                            // which — being a running CSS animation — wins
                            // over an inline `transform` on the SAME element
                            // for as long as it's running. Centering this
                            // span on the dot needs `translate(-50%, -50%)`,
                            // so putting both on one element made the ping
                            // lose its centering mid-pulse and grow from the
                            // box's un-translated corner instead — reading as
                            // drifting right/down instead of growing evenly.
                            // The outer span holds the (stable, never
                            // animated) centering transform; the inner span
                            // just fills it and is the only element that
                            // animates, so its `scale()` has nothing to
                            // fight over.
                            <span
                                aria-hidden="true"
                                style={{
                                    position: "absolute",
                                    left: `${xPct(todayX)}%`,
                                    top: todayY,
                                    width: 18,
                                    height: 18,
                                    transform: "translate(-50%, -50%)",
                                    pointerEvents: "none",
                                }}
                            >
                                <span
                                    className="animate-ping motion-reduce:animate-none"
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        borderRadius: "9999px",
                                        background: alertColor,
                                        opacity: 0.45,
                                    }}
                                />
                            </span>
                        ) : null}
                        <span
                            style={dotStyle(
                                todayX,
                                todayY,
                                isOverPace ? 10 : 8,
                                isOverPace ? alertColor : color,
                                false
                            )}
                        />
                    </>
                ) : null}
                <span style={dotStyle(sx(daysInMonth - 1), projY, 6, color, false, 0.5)} />
                <span
                    style={dotStyle(
                        sx(daysInMonth - 1),
                        lastY,
                        6,
                        "var(--muted-foreground)",
                        false
                    )}
                />
                {hoverIdx !== null ? (
                    <>
                        {hasBudget ? (
                            <span
                                style={dotStyle(
                                    sx(hoverIdx),
                                    sy(paceAt(hoverIdx)),
                                    6,
                                    "var(--foreground)"
                                )}
                            />
                        ) : null}
                        {hoverIdx < today ? (
                            <span
                                style={dotStyle(sx(hoverIdx), sy(cur[hoverIdx] ?? 0), 7, color)}
                            />
                        ) : null}
                        <span
                            style={dotStyle(
                                sxPrev(prvIdxAt(hoverIdx)),
                                sy(prv[prvIdxAt(hoverIdx)] ?? 0),
                                6,
                                "var(--muted-foreground)"
                            )}
                        />
                        {avgPath ? (
                            <span
                                style={dotStyle(
                                    sx(hoverIdx),
                                    sy(avg?.[hoverIdx] ?? 0),
                                    6,
                                    "var(--income)"
                                )}
                            />
                        ) : null}
                    </>
                ) : null}

                {/* Y-axis labels */}
                {[0, 1, 2, 3, 4].map((i) => {
                    const yPx = p + (i * (h - p * 2)) / 4;
                    const value = ((4 - i) * max) / 4;
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
                            {fmtYTick(value)}
                        </span>
                    );
                })}

                {showToday ? (
                    <span
                        className="absolute text-[10.5px] font-medium"
                        style={{
                            left: `${xPct(todayX + 6)}%`,
                            top: p + 4,
                            color: isOverPace ? alertColor : color,
                            whiteSpace: "nowrap",
                        }}
                    >
                        {isOverPace
                            ? isOverBudget
                                ? "Today · over budget"
                                : "Today · over pace"
                            : "Today"}
                    </span>
                ) : null}

                {/* Hover tooltip */}
                {hoverIdx !== null ? (
                    <div
                        className="pointer-events-none absolute z-10 min-w-[150px] rounded-md border border-border bg-card px-3 py-2 text-[11px] shadow-lg"
                        style={{
                            left: `${xPct(sx(hoverIdx))}%`,
                            top: 8,
                            maxWidth: "min(200px, calc(100% - 16px))",
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
                            {daysInMonth <= 31 ? (
                                <span>
                                    {bucketLabelSingular} {hoverIdx + 1} of {daysInMonth}
                                </span>
                            ) : null}
                        </div>
                        <TooltipRow
                            label="This (so far)"
                            value={hoverIdx < today ? (cur[hoverIdx] ?? 0) : null}
                            color={color}
                        />
                        <TooltipRow
                            label={`Spent this ${bucketLabelSingular.toLowerCase()}`}
                            value={hoverIdx < today ? (dailyCur[hoverIdx] ?? 0) : null}
                            color={color}
                        />
                        {hasBudget ? (
                            <TooltipRow
                                label="On-budget pace"
                                value={paceAt(hoverIdx)}
                                color="var(--foreground)"
                            />
                        ) : null}
                        <TooltipRow
                            label="Last"
                            value={prv[prvIdxAt(hoverIdx)] ?? 0}
                            color="var(--muted-foreground)"
                        />
                        {avgPath ? (
                            <TooltipRow
                                label="Typical"
                                value={avg?.[hoverIdx] ?? 0}
                                color="var(--income)"
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>

            {/* Date axis — each label absolutely positioned at its true x
                (matching sx()), not evenly distributed, so the tick sits under
                its actual point even when the tick days aren't evenly spaced. */}
            <div className="relative mt-1 h-4 text-[10.5px] text-muted-foreground">
                {dayTicks.map((d) => (
                    <span
                        key={d}
                        className="absolute -translate-x-1/2 whitespace-nowrap"
                        style={{ left: `${xPct(sx(d - 1))}%` }}
                    >
                        {formatInAppTz(bucketDate(d - 1), axisDateFormat)}
                    </span>
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
                {value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
        </div>
    );
}

export default EnvelopeSpendChart;
