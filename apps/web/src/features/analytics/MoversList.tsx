import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo } from "react";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { cn } from "@/lib/utils";

/*
 * The "biggest movers" list, shared by the Spending Trends page and the
 * envelope detail page.
 *
 * It lives here rather than being reimplemented per page on purpose. The
 * envelope page originally had its own `.orbit-design` version and it drifted
 * from this one immediately — each of its rows was a separate grid container
 * with an `auto` column, so every row's diverging bar had a different centre.
 * One component is the only way "looks the same on both pages" stays true.
 *
 * Safe to render inside `.orbit-design`: that scope only overrides `--income`
 * and `--expense`, so every other token used here still resolves to the app
 * defaults.
 */

/** Compact number formatter for axis ticks: 4.5K / 1.2M etc. */
export function formatCompact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toFixed(0);
}

export type Mover = {
    categoryId: string;
    name: string;
    color: string;
    icon: string;
    currentTotal: number;
    previousTotal: number;
    deltaAmount: number;
    deltaPct: number;
};

/** Change as a readable label. Past ~10× a percentage stops being holdable —
 *  the real data has a category that went 719 → 35M, i.e. "+4,908,600%" — so
 *  it becomes a multiplier. Appearing from nothing and going to nothing are the
 *  two cases where a percentage is undefined; both are better named than
 *  approximated (the server reports `deltaPct = 1` for the first, which would
 *  otherwise print a meaningless "+100%"). */
function moverChangeLabel(m: Mover, isLive: boolean): string {
    /* "New" and "Stopped" are claims about the category, and a live period only
       compares the elapsed slice of each. On the 1st that slice is one day, so a
       category with a full month of prior spend would read "Stopped". Reserve
       the verdicts for completed periods and state the plain fact otherwise. */
    if (m.previousTotal === 0) return m.currentTotal === 0 ? "—" : isLive ? "from 0" : "New";
    if (m.currentTotal === 0) return isLive ? "to 0" : "Stopped";
    /* Threshold on the RATIO, not on deltaPct: `deltaPct >= 10` means 11×, so
       the label used to jump from "+999%" straight to "×11" and ×10 was
       unreachable. Bounded above because ×49,088 is no more holdable than
       +4,908,700% — past 999× the amounts one column left are the useful read. */
    const ratio = m.currentTotal / m.previousTotal;
    if (ratio >= 1000) return "×1,000+";
    if (ratio >= 10) return `×${ratio.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    /* Exactly flat is 0%, not −0%; and a real-but-tiny move mustn't render as
       "0%" beside an arrow and a signed amount. */
    if (m.deltaPct === 0) return "0%";
    const pct = Math.abs(m.deltaPct * 100);
    if (pct < 0.5) return m.deltaPct > 0 ? "<+1%" : "<−1%";
    return `${m.deltaPct > 0 ? "+" : "−"}${pct.toFixed(0)}%`;
}

/** Exact while it fits its column, compact beyond — a 7-digit amount would
 *  otherwise push the bar column off the row. */
function moverAmount(v: number): string {
    return v >= 100_000
        ? formatCompact(v)
        : v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Biggest movers — a ranked list, laid out as one.
 *
 * The earlier version was a 2-up grid of bordered cards, each with its own
 * bar(s) scaled to itself. Two things made that unreadable. Cards in two
 * columns at differing heights put rows 3 and 4 on opposite sides of the
 * page, so the ranking — the entire point of the section — couldn't be
 * scanned; and per-card scaling meant bar length carried no meaning between
 * rows, so six bars said nothing collectively.
 *
 * This is a single column of hairline-separated rows sharing ONE horizontal
 * axis, so bar length is comparable and the list visibly descends. Rows sit
 * directly on the card surface rather than in nested tinted boxes (card →
 * box → track was three stacked greys).
 *
 * Two channels, deliberately: row ORDER encodes absolute change (the list is
 * sorted by it, so position is the magnitude ranking) and bar LENGTH encodes
 * the relative change. Direction is carried by position about the axis, hue,
 * an arrow and a sign — never by colour alone.
 */
export function MoversList({
    items,
    hasPrevious,
    isLive,
    periodShort,
    prevShort,
    tickCur,
    tickPrev,
}: {
    items: Mover[];
    /** A running period is only part-way through while the prior one is whole,
     *  which changes what the change labels can honestly claim: nothing has
     *  "Stopped" when the month simply hasn't happened yet. */
    isLive: boolean;
    /** No prior period on record ⇒ this is a plain magnitude ranking of the
     *  viewed period, not a comparison. */
    hasPrevious: boolean;
    periodShort: string;
    prevShort: string;
    /** Column-header forms — narrow, uppercased, no year ("JUL → AUG"). Fall
     *  back to the prose labels when a host doesn't supply them. */
    tickCur?: string;
    tickPrev?: string;
}) {
    /* The bar plots a NORMALISED quantity — each change as a share of that
       category's own prior spend — not a currency amount.

       That choice is what finally makes one axis work. Plotting absolute change
       put five orders of magnitude on one linear scale (719 beside 35,294,543),
       which no amount of trimming rescued: it needed a data-derived cap, an
       off-scale leader, and a footnote explaining both. A share is bounded by
       construction — a fall can't exceed 100% of what was there — so every bar
       stays legible however lopsided the data, and it happens to BE the
       within-category reading a bar of absolute change could never show.

       The absolute amounts keep the job text is good at: 35.3M and 399 read
       just as easily beside each other in the CHANGE column, which is where the
       cross-category comparison lives.

       `cap` is only needed for the no-prior-period branch, where there is no
       share to normalise against and the bar falls back to plotting spend. */
    const { cap, clipped } = useMemo(() => {
        if (hasPrevious) {
            /* A rise has no ceiling, so the axis tops out at "doubled" and
               anything past it is marked off-scale. */
            /* `deltaPct === 1` is the server's sentinel for "appeared from
               nothing", where a share is undefined — not a measured +100%. It
               must read as off-scale or a 0→35M row is drawn identically to one
               that exactly doubled. */
            return {
                cap: 1,
                clipped: items.some((m) =>
                    m.previousTotal === 0 ? m.currentTotal > 0 : Math.abs(m.deltaPct) > 1
                ),
            };
        }
        const totals = items.map((m) => m.currentTotal).sort((x, y) => y - x);
        const top = totals[0] ?? 0;
        const second = totals[1] ?? 0;
        const useSecond = second > 0 && top > second * 4;
        return { cap: useSecond ? second : top, clipped: useSecond };
    }, [items, hasPrevious]);

    return (
        <div className="flex flex-col">
            {/* Column headers, carrying the axis. A diverging bar is only
                readable once zero is marked and the ends are named — without
                it the reader has to infer both the centre and which side means
                what. Hidden below sm, where the bar sits on its own line per
                row and no single header could align with it; the note under the
                list carries the same facts in prose there.
                Column widths mirror the rows exactly (size-7 avatar, basis-48
                label, flex-1 bar, then the three value columns), so the ticks
                sit over the geometry they describe. */}
            <div
                aria-hidden="true"
                className="hidden items-center gap-x-3 border-b border-border/30 pb-2 text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground lg:flex"
            >
                <span className="size-7 shrink-0" />
                <span className="basis-48 shrink-0">Category</span>
                {/* `overflow-hidden` is load-bearing: `min-w-0` caps a flex
                    item's shrink floor but not its min-content CONTRIBUTION, so
                    these labels were sizing the whole card. */}
                <span className="relative min-w-0 flex-1 overflow-hidden">
                    {hasPrevious ? (
                        <>
                            <span className="flex justify-between">
                                <span className="whitespace-nowrap">−100%</span>
                                <span className="whitespace-nowrap">+100%</span>
                            </span>
                            {/* Absolutely centred, so it lands exactly on the
                                axis line drawn inside every bar below. */}
                            <span className="absolute left-1/2 top-0 -translate-x-1/2 text-foreground/60">
                                0
                            </span>
                        </>
                    ) : (
                        /* No prior period ⇒ the bars are a left-to-right
                           magnitude scale, so a diverging axis would be a lie. */
                        <span className="flex justify-between">
                            <span className="whitespace-nowrap">0</span>
                            <span className="whitespace-nowrap tabular-nums">
                                {moverAmount(cap)}
                            </span>
                        </span>
                    )}
                </span>
                {/* Same 3-track grid as the rows below, so the arrow is a shared
                    vertical anchor. Right-aligning the whole string instead put
                    every row's arrow at a different x. */}
                {hasPrevious ? (
                    <span className="grid w-[6.75rem] grid-cols-[1fr_auto_1fr] items-baseline gap-x-1">
                        <span className="truncate text-right">{tickPrev ?? prevShort}</span>
                        <span className="opacity-50">→</span>
                        <span className="truncate text-left">{tickCur ?? periodShort}</span>
                    </span>
                ) : null}
                {/* The caret says what the rows are ordered by — without it the
                    reader infers the sort from the numbers and wonders why the
                    bars don't descend with it. */}
                <span className="w-[4.75rem] text-right">
                    {hasPrevious ? "Change ↓" : "Spent ↓"}
                </span>
                {hasPrevious ? <span className="w-[3.5rem] text-right">% change</span> : null}
            </div>
            <ul className="divide-y divide-border/30">
                {items.map((m) => {
                    const magnitude = Math.abs(hasPrevious ? m.deltaAmount : m.currentTotal);
                    const up = m.deltaAmount > 0;
                    const flat = m.deltaAmount === 0;
                    /* Without a prior period there is no direction to report,
                       so the bars take the page's "this period" amber rather
                       than an expense/income hue that would imply a change. */
                    const hue = !hasPrevious
                        ? /* Neutral, not `--warning`: this branch means "nothing
                             to compare against", and amber is a severity level
                             on the envelope detail page's pace gauge. */
                          "var(--muted-foreground)"
                        : flat
                          ? "var(--muted-foreground)"
                          : up
                            ? "var(--expense)"
                            : "var(--income)";
                    /* Share of the category's own prior spend, 0–100. Bounded
                       for a fall; a rise past 100% (more than doubled) clamps
                       and is marked off-scale. Half the track is one side of
                       the axis, so 100% fills exactly one half. */
                    const share = Math.min(100, Math.abs(m.deltaPct) * 100);
                    const halfFill = share / 2;
                    const overCap = hasPrevious
                        ? m.previousTotal === 0
                            ? m.currentTotal > 0
                            : Math.abs(m.deltaPct) > 1
                        : cap > 0 && magnitude > cap;
                    /* No-prior-period branch only: spend against the trimmed cap. */
                    const fill = cap > 0 ? Math.min(100, (magnitude / cap) * 100) : 0;

                    return (
                        <li
                            key={m.categoryId}
                            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-1 last:pb-1"
                        >
                            <EntityAvatar size="sm" color={m.color} icon={m.icon} />

                            {/* Label. Single line now: the before/after used to
                                sit under it as a caption, which inverted the
                                hierarchy (raw amounts read as metadata, derived
                                ones as the headline) and left a two-line stack
                                at each end with the one-line bar floating in
                                the gap between them. Fixed width from sm so
                                every bar starts at the same x. */}
                            <span className="w-0 min-w-0 flex-1 truncate text-[13px] font-medium lg:flex-none lg:basis-48">
                                {m.name}
                            </span>

                            {/* Bar. Own line on mobile; from sm it takes the
                                leftover width so a wide card lengthens the
                                axis instead of opening a gap. */}
                            <div className="order-last basis-full lg:order-none lg:min-w-0 lg:flex-1 lg:basis-auto">
                                <div
                                    className="relative h-2 w-full overflow-hidden rounded-[2px] bg-foreground/[0.06]"
                                    /* Decorative: every number it encodes is
                                       already printed as text in this row, so
                                       labelling it made screen readers read
                                       each row twice. */
                                    aria-hidden
                                    title={
                                        overCap
                                            ? "Far beyond the other categories — bar clipped"
                                            : undefined
                                    }
                                >
                                    {hasPrevious ? (
                                        <>
                                            <div
                                                className={cn(
                                                    "absolute inset-y-0",
                                                    /* Rounded on the outer end only, so
                                                       the bar hangs off the axis. A
                                                       clipped bar keeps a square outer
                                                       end against the flat track edge —
                                                       the "continues beyond" mark. */
                                                    !overCap &&
                                                        (up ? "rounded-r-full" : "rounded-l-full")
                                                )}
                                                /* `minWidth` in px, not a % floor:
                                                   1.5% of a flex-1 track is
                                                   0.97px at 768px, which is
                                                   indistinguishable from the
                                                   zero-change case. */
                                                style={{
                                                    width: `${halfFill}%`,
                                                    minWidth: magnitude > 0 ? "3px" : undefined,
                                                    backgroundColor: hue,
                                                    ...(up ? { left: "50%" } : { right: "50%" }),
                                                }}
                                            />
                                            {/* Zero axis, drawn AFTER the fill. A
                                                rise starts at left:50%, so painted
                                                first the axis disappeared beneath
                                                it — a diverging bar with no
                                                visible centre. Aligned in every
                                                row, so stacked they read as one
                                                vertical line. */}
                                            <span
                                                className="absolute inset-y-0 left-1/2 z-10 w-px -translate-x-1/2 bg-foreground/40"
                                                aria-hidden="true"
                                            />
                                        </>
                                    ) : (
                                        /* No prior period ⇒ a plain magnitude
                                           ranking; there is no zero to diverge
                                           from, so it runs left-to-right. */
                                        <div
                                            className={cn(
                                                "h-full",
                                                overCap ? "rounded-l-[2px]" : "rounded-full"
                                            )}
                                            style={{
                                                width: `${Math.max(magnitude > 0 ? 3 : 0, fill)}%`,
                                                backgroundColor: hue,
                                            }}
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Values, right of the bar in the canonical
                                labelled-bar order — and all on one baseline, in
                                fixed-width right-aligned columns so they scan
                                as columns down the list. Left to right is now
                                the sentence itself: what it was, what it is,
                                how much it moved, by what share. */}
                            <div className="flex basis-full shrink-0 items-baseline justify-end gap-x-3 tabular-nums lg:basis-auto">
                                {hasPrevious ? (
                                    <span className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-1 text-[11.5px] text-muted-foreground lg:w-[6.75rem]">
                                        <span className="text-right">
                                            {moverAmount(m.previousTotal)}
                                        </span>
                                        <span className="opacity-50">→</span>
                                        <span className="text-left text-foreground/80">
                                            {moverAmount(m.currentTotal)}
                                        </span>
                                    </span>
                                ) : null}
                                <span
                                    className="inline-flex items-center justify-end gap-0.5 text-[13px] font-semibold lg:w-[4.75rem]"
                                    style={{ color: hue }}
                                >
                                    {!hasPrevious || flat ? null : up ? (
                                        <ArrowUp className="size-3 shrink-0" />
                                    ) : (
                                        <ArrowDown className="size-3 shrink-0" />
                                    )}
                                    {hasPrevious ? (flat ? "" : up ? "+" : "−") : ""}
                                    {moverAmount(
                                        hasPrevious ? Math.abs(m.deltaAmount) : m.currentTotal
                                    )}
                                </span>
                                {hasPrevious ? (
                                    /* The exact value of what the bar draws — no
                                       second tint behind it, which would be the
                                       same number encoded twice. */
                                    <span
                                        className="text-right text-[12.5px] font-semibold lg:w-[3.5rem]"
                                        style={{ color: hue, opacity: 0.85 }}
                                    >
                                        {moverChangeLabel(m, isLive)}
                                    </span>
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ul>
            {/* The axis, stated. Bar length is only quantitative if the reader
                can put a number on it — naming what a full half-track is worth
                turns the bars from decoration into a scale, and the direction
                key means left/right isn't something you have to infer. */}
            <p className="mt-3 border-t border-border/30 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
                {hasPrevious ? (
                    <>
                        Rows are ordered by how much the amount moved. Bar length is each change as
                        a share of that category&rsquo;s own {prevShort}, so every category is on
                        the same footing whatever it spends — the centre line is no change, left is
                        less, right is more.
                    </>
                ) : (
                    <>
                        One shared scale — a full bar is{" "}
                        <span className="tabular-nums text-foreground/70">{moverAmount(cap)}</span>.
                    </>
                )}
                {clipped
                    ? hasPrevious
                        ? " Bars at the very edge grew by more than 100%."
                        : " The top category is far beyond the rest, so its bar stops at the edge rather than flattening the others."
                    : ""}
            </p>
        </div>
    );
}
