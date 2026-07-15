import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    addMonths,
    endOfDay,
    endOfMonth,
    startOfDay,
    startOfMonth,
    startOfYear,
} from "@/lib/dates";

/**
 * Editorial-dark date range picker — the design's "Date range · standalone".
 *
 * Layout: presets sidebar on the left, two side-by-side month calendars on
 * the right with selection-range highlighting, From/To inputs at the top,
 * a single Done button at the bottom.
 *
 * Stateless: receives `start` / `end` and emits `onChange(start, end)` on
 * every edit (picking one day, typing a From/To value). `onApply` fires
 * automatically — not from a button — at the moments a selection reads as
 * complete: clicking a preset, or picking the second day of a range. The
 * parent uses that as the cue to close the popover, so users who "just
 * select a date and do things" never have to notice or press an Apply
 * button. `onCancel` backs the one footer button ("Done"), which only
 * closes — everything is already committed via onChange/onApply. It's
 * required (not optional) because it's the component's only built-in
 * close affordance: without it the footer has nothing to render and a
 * caller wiring only `onChange` would ship a popover with no visible way
 * to dismiss it.
 *
 * A lone first click of a fresh range (`picking === "to"`, no second click
 * yet) never reaches onChange/onApply on its own — see onPickDay — but it
 * DOES update the highlighted day and the "Select end date" footer/header
 * text, so Done treats that visible-but-uncommitted pick as a single-day
 * range rather than silently discarding something the UI just showed as
 * selected.
 */
export function DateRangePicker({
    start,
    end,
    onChange,
    onApply,
    onCancel,
    className,
}: {
    start: Date;
    end: Date;
    onChange: (start: Date, end: Date) => void;
    /** Optional auto-commit-and-close hook — fires on preset click or on
     *  completing a 2-day range. Omit to require the user to close via
     *  `onCancel` explicitly even after a complete selection. */
    onApply?: (start: Date, end: Date) => void;
    onCancel: () => void;
    className?: string;
}) {
    /* "to" is the inclusive last day; usePeriod stores `end` as exclusive
       (start of next day) for half-open [start, end) semantics. Convert
       once at the boundary. */
    const inclusiveEnd = useMemo(
        () => new Date(end.getTime() - 1),
        [end]
    );

    /* Local picker state. Outside changes (preset clicks) sync via effect. */
    const [from, setFrom] = useState(() => startOfDay(start));
    const [to, setTo] = useState(() => startOfDay(inclusiveEnd));
    const [hover, setHover] = useState<Date | null>(null);
    const [picking, setPicking] = useState<"from" | "to">("from");
    const [leftMonth, setLeftMonth] = useState(() =>
        startOfMonth(new Date(from))
    );

    /* When a preset commits, sync local state from props. */
    useEffect(() => {
        const s = startOfDay(start);
        const e = startOfDay(new Date(end.getTime() - 1));
        if (s.getTime() !== from.getTime()) setFrom(s);
        if (e.getTime() !== to.getTime()) setTo(e);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [start.getTime(), end.getTime()]);

    const rightMonth = addMonths(leftMonth, 1);
    const today = startOfDay(new Date());

    const dayCount =
        Math.round(
            (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000
        ) + 1;

    const cellState = (d: Date): "out" | "in" | "start" | "end" | "single" => {
        const t = d.getTime();
        const fT = from.getTime();
        /* While awaiting the second click, `to` is still whatever was
           left over from before this gesture started (see onPickDay) —
           painting the full stale span would show a confirmed-looking
           range that Done doesn't actually commit (it only commits
           `from` as a single day; see the Done handler below).
           Collapsing to just the start day here keeps the highlight,
           the "Pick an end date" header, and what Done actually does
           all telling the same story. The hover branch further down
           still previews the tentative end on mouseover. */
        const tT = picking === "to" ? fT : to.getTime();
        const lo = Math.min(fT, tT);
        const hi = Math.max(fT, tT);
        if (lo === hi && t === lo) return "single";
        if (t === lo) return "start";
        if (t === hi) return "end";
        if (t > lo && t < hi) return "in";
        if (
            picking === "to" &&
            hover &&
            t > Math.min(from.getTime(), hover.getTime()) &&
            t < Math.max(from.getTime(), hover.getTime())
        )
            return "in";
        return "out";
    };

    const onPickDay = (d: Date) => {
        if (picking === "from") {
            /* First click of a fresh range only starts the selection —
               it pairs the new start with whatever `to` happened to be
               left over, which isn't a range the user asked for. Update
               local state (drives the calendar highlight) without
               notifying the parent; only a complete range (the second
               click, below) or a preset commits externally. Otherwise
               clicking once and walking away silently overwrote whatever
               filter was active before the popover opened. */
            setFrom(d);
            if (d > to) setTo(d);
            setPicking("to");
        } else {
            const next = d < from ? from : d;
            const newFrom = d < from ? d : from;
            setFrom(newFrom);
            setTo(next);
            setPicking("from");
            onChange(newFrom, endOfDayExclusive(next));
            /* Picking the second day completes a range — that's the
               natural "I'm done" signal, so commit and let the parent
               close the popover instead of waiting on an Apply click the
               user has no reason to expect at this point. Trade-off:
               there's no longer a way to correct a bad pick within the
               same session (the old flow let you keep clicking freely
               before Apply) — reopening the picker is the recovery path. */
            onApply?.(newFrom, endOfDayExclusive(next));
        }
    };

    const presets: Array<{
        id: string;
        label: string;
        compute: () => { s: Date; e: Date };
    }> = [
        {
            id: "today",
            label: "Today",
            compute: () => ({ s: startOfDay(today), e: startOfDay(today) }),
        },
        {
            id: "yesterday",
            label: "Yesterday",
            compute: () => ({
                s: startOfDay(addDays(today, -1)),
                e: startOfDay(addDays(today, -1)),
            }),
        },
        {
            id: "last-7",
            label: "Last 7 days",
            compute: () => ({ s: startOfDay(addDays(today, -6)), e: today }),
        },
        {
            id: "last-14",
            label: "Last 14 days",
            compute: () => ({ s: startOfDay(addDays(today, -13)), e: today }),
        },
        {
            id: "last-30",
            label: "Last 30 days",
            compute: () => ({ s: startOfDay(addDays(today, -29)), e: today }),
        },
        {
            id: "last-60",
            label: "Last 60 days",
            compute: () => ({ s: startOfDay(addDays(today, -59)), e: today }),
        },
        {
            id: "last-90",
            label: "Last 90 days",
            compute: () => ({ s: startOfDay(addDays(today, -89)), e: today }),
        },
        {
            id: "this-month",
            label: "This month",
            compute: () => ({ s: startOfMonth(today), e: today }),
        },
        {
            id: "last-month",
            label: "Last month",
            compute: () => {
                const start = startOfMonth(addMonths(today, -1));
                const end = startOfDay(
                    new Date(endOfMonth(start).getTime())
                );
                return { s: start, e: end };
            },
        },
        {
            id: "last-3-months",
            label: "Last 3 months",
            compute: () => ({
                s: startOfMonth(addMonths(today, -2)),
                e: today,
            }),
        },
        {
            id: "last-6-months",
            label: "Last 6 months",
            compute: () => ({
                s: startOfMonth(addMonths(today, -5)),
                e: today,
            }),
        },
        {
            id: "last-12-months",
            label: "Last 12 months",
            compute: () => ({
                s: startOfMonth(addMonths(today, -11)),
                e: today,
            }),
        },
        {
            id: "this-quarter",
            label: "This quarter",
            compute: () => {
                const m = today.getMonth();
                const qStart = new Date(today.getFullYear(), m - (m % 3), 1);
                return { s: qStart, e: today };
            },
        },
        {
            id: "ytd",
            label: "Year to date",
            compute: () => ({ s: startOfYear(today), e: today }),
        },
        {
            id: "last-year",
            label: "Last year",
            compute: () => {
                const start = new Date(today.getFullYear() - 1, 0, 1);
                const end = new Date(today.getFullYear() - 1, 11, 31);
                return { s: start, e: end };
            },
        },
        {
            id: "all",
            label: "All time",
            compute: () => ({
                s: new Date(2000, 0, 1),
                e: today,
            }),
        },
    ];

    const matchPreset = useMemo(() => {
        for (const p of presets) {
            const { s, e } = p.compute();
            if (
                startOfDay(s).getTime() === startOfDay(from).getTime() &&
                startOfDay(e).getTime() === startOfDay(to).getTime()
            ) {
                return p.id;
            }
        }
        return null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from.getTime(), to.getTime()]);

    return (
        <div className={cn("orbit-design op-date-picker", className)}>
            <style>{DATE_PICKER_STYLES}</style>

            <div className="op-date-head">
                <span className="op-date-head-label">Date range</span>
                <div className="op-date-inputs">
                    <DateInput
                        label="From"
                        value={from}
                        onCommit={(d) => {
                            setFrom(d);
                            if (d > to) setTo(d);
                            /* A typed field is a complete edit of a real
                               range (unlike a lone calendar click, which
                               leaves `to` as a stale leftover) — clear
                               "awaiting second click" so Done's pending-
                               pick commit (below) doesn't later collapse
                               this range back down to a single day. */
                            setPicking("from");
                            onChange(d, endOfDayExclusive(d > to ? d : to));
                        }}
                    />
                    <span className="op-date-swap">
                        <ArrowLeftRight className="size-3" />
                    </span>
                    <DateInput
                        label="To"
                        value={to}
                        /* Same stale-leftover problem as the calendar
                           highlight above: while awaiting the second
                           click, `to` isn't a real bound yet, so showing
                           it here would contradict the "Select end date"
                           header/footer right below. */
                        pending={picking === "to"}
                        onCommit={(d) => {
                            const next = d < from ? from : d;
                            const newFrom = d < from ? d : from;
                            setFrom(newFrom);
                            setTo(next);
                            /* Same reasoning as the From input above. */
                            setPicking("from");
                            onChange(newFrom, endOfDayExclusive(next));
                        }}
                    />
                </div>
            </div>

            <div className="op-date-body">
                <ul className="op-date-presets" role="listbox">
                    {presets.map((p) => (
                        <li key={p.id}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={matchPreset === p.id}
                                className={cn(
                                    "op-date-preset",
                                    matchPreset === p.id && "is-active"
                                )}
                                onClick={() => {
                                    const { s, e } = p.compute();
                                    setFrom(s);
                                    setTo(e);
                                    setPicking("from");
                                    setLeftMonth(startOfMonth(s));
                                    onChange(s, endOfDayExclusive(e));
                                    /* A preset click is a single, complete
                                       action — commit and close instead of
                                       leaving an Apply click behind. */
                                    onApply?.(s, endOfDayExclusive(e));
                                }}
                            >
                                {p.label}
                            </button>
                        </li>
                    ))}
                </ul>

                <div className="op-date-cal">
                    <div className="op-date-cal-head">
                        <button
                            type="button"
                            className="op-date-cal-arrow"
                            onClick={() => setLeftMonth(addMonths(leftMonth, -1))}
                            aria-label="Previous month"
                        >
                            <ChevronLeft className="size-3.5" />
                        </button>
                        <span className="op-date-cal-range">
                            {picking === "to"
                                ? "Pick an end date"
                                : dayCount > 0
                                  ? `${dayCount} day${dayCount === 1 ? "" : "s"} selected`
                                  : "Pick a range"}
                        </span>
                        <button
                            type="button"
                            className="op-date-cal-arrow"
                            onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
                            aria-label="Next month"
                        >
                            <ChevronRight className="size-3.5" />
                        </button>
                    </div>
                    <div className="op-date-cal-grid">
                        <Month
                            month={leftMonth}
                            cellState={cellState}
                            onPick={onPickDay}
                            onHover={setHover}
                        />
                        <Month
                            month={rightMonth}
                            cellState={cellState}
                            onPick={onPickDay}
                            onHover={setHover}
                        />
                    </div>
                </div>
            </div>

            <div className="op-date-foot">
                <span className="op-date-foot-summary">
                    {picking === "to"
                        ? `${fmt(from, "MMM d")} → Select end date`
                        : `${fmt(from, "MMM d")} → ${fmt(to, "MMM d, yyyy")}`}
                </span>
                <div className="op-date-foot-actions">
                    <button
                        type="button"
                        className="op-date-btn op-date-btn-primary"
                        onClick={() => {
                            /* A lone first click (picking flips to "to"
                               and stays there until a second click)
                               highlights as "selected" and now reads as
                               "Select end date" above — closing without
                               committing it would silently throw away a
                               date the UI just told the user it took. Read
                               it as "just that one day" instead, the same
                               way a text-input edit or a same-day double-
                               click already would. */
                            if (picking === "to") {
                                onApply?.(from, endOfDayExclusive(from));
                            }
                            onCancel();
                        }}
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

function Month({
    month,
    cellState,
    onPick,
    onHover,
}: {
    month: Date;
    cellState: (d: Date) => "out" | "in" | "start" | "end" | "single";
    onPick: (d: Date) => void;
    onHover: (d: Date | null) => void;
}) {
    const year = month.getFullYear();
    const m = month.getMonth();
    const today = startOfDay(new Date());

    /* Build 6 rows × 7 columns = 42 cells, leading from previous-month
       fillers and trailing from next-month fillers so weekday columns line
       up. */
    const firstWeekday = new Date(year, m, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const cells: Array<{ d: Date; outOfMonth: boolean }> = [];
    /* Previous-month filler */
    for (let i = firstWeekday; i > 0; i--) {
        cells.push({ d: new Date(year, m, 1 - i), outOfMonth: true });
    }
    /* Current month */
    for (let i = 1; i <= daysInMonth; i++) {
        cells.push({ d: new Date(year, m, i), outOfMonth: false });
    }
    /* Trailing — pad to 42 (6 rows). */
    while (cells.length < 42) {
        const last = cells[cells.length - 1].d;
        cells.push({ d: addDays(last, 1), outOfMonth: true });
    }

    return (
        <div className="op-date-month">
            <div className="op-date-month-head">{fmt(month, "MMMM yyyy")}</div>
            <div className="op-date-weekdays">
                {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
                    <span key={i} className="op-date-weekday">
                        {w}
                    </span>
                ))}
            </div>
            <div className="op-date-days">
                {cells.map((c, i) => {
                    const state = cellState(c.d);
                    const isToday = c.d.getTime() === today.getTime();
                    return (
                        <button
                            key={i}
                            type="button"
                            className={cn(
                                "op-date-day",
                                c.outOfMonth && "is-out",
                                state !== "out" && `is-${state}`,
                                isToday && "is-today"
                            )}
                            onMouseEnter={() => onHover(c.d)}
                            onMouseLeave={() => onHover(null)}
                            onClick={() => onPick(c.d)}
                            disabled={c.outOfMonth}
                        >
                            {c.d.getDate()}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function DateInput({
    label,
    value,
    onCommit,
    pending,
}: {
    label: string;
    value: Date;
    onCommit: (d: Date) => void;
    /** True when `value` is a stale leftover rather than a real bound —
     *  the "To" field while a range is awaiting its second click. Shows
     *  a placeholder instead of the misleading date; typing still commits
     *  normally. */
    pending?: boolean;
}) {
    const [text, setText] = useState(() =>
        pending ? "" : fmt(value, "MMM d, yyyy")
    );
    /* Re-sync display text when the real value changes, or when a
       gesture starts/stops being pending — but NOT on every keystroke,
       since neither dep changes while the user is actively typing. */
    useEffect(() => {
        setText(pending ? "" : fmt(value, "MMM d, yyyy"));
    }, [value, pending]);
    return (
        <label className="op-date-input-wrap">
            <span className="op-date-input-label">{label}</span>
            <input
                type="text"
                value={text}
                placeholder={pending ? "Select end date" : undefined}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => {
                    /* Radix auto-focuses this field when the popover
                       opens (it's the first focusable child), so clicking
                       a calendar day fires a blur here before the click's
                       own handler runs. Without this guard that blur
                       would still call onCommit/onChange with the field's
                       unchanged text — enough to flip a named preset into
                       an explicit "custom" URL range, whose prop-sync
                       effect then wins a race against the click and
                       silently reverts the day the user just picked. Any
                       other stray, non-editing blur is covered too. */
                    const canonical = pending ? "" : fmt(value, "MMM d, yyyy");
                    if (text === canonical) return;
                    const parsed = new Date(text);
                    if (Number.isNaN(parsed.getTime())) {
                        setText(canonical);
                    } else {
                        onCommit(startOfDay(parsed));
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="op-date-input"
                spellCheck={false}
            />
        </label>
    );
}

/* ─── helpers ─── */

function addDays(d: Date, n: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
}

/** End of day → start of NEXT day (matches usePeriod's exclusive-end rule). */
function endOfDayExclusive(d: Date): Date {
    const eod = endOfDay(d);
    return new Date(eod.getTime() + 1);
}

const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const MONTH_SHORT = [
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

function fmt(d: Date, pattern: string): string {
    return pattern
        .replace("yyyy", String(d.getFullYear()))
        .replace("MMMM", MONTH_NAMES[d.getMonth()])
        .replace("MMM", MONTH_SHORT[d.getMonth()])
        .replace("d", String(d.getDate()));
}

const DATE_PICKER_STYLES = `
.op-date-picker {
    width: 100%;
    max-width: 640px;
    border-radius: 14px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    /* Radix only flips which side the popover opens on — it never shrinks
       the panel to fit, so without a real cap this can render taller than
       the trigger has room for and push the whole page into a confusing
       scroll instead of scrolling internally. --radix-popover-content-
       available-height is Radix's own measurement of the space actually
       available on the chosen side; falling back to the viewport-relative
       calc covers non-Radix embeddings. */
    max-height: min(
        calc(100dvh - 32px),
        var(--radix-popover-content-available-height, 600px)
    );
}

.op-date-head {
    padding: 14px 16px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
}
.op-date-head-label {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
}
.op-date-inputs {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
}
.op-date-input-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.op-date-input-label {
    font-size: 10px;
    color: var(--fg-4);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding-left: 2px;
}
.op-date-input {
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line);
    color: var(--fg);
    font-size: 12.5px;
    font-family: inherit;
    outline: none;
    transition: border-color 120ms ease;
}
.op-date-input:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}
.op-date-swap {
    display: grid;
    place-items: center;
    color: var(--fg-4);
    flex-shrink: 0;
    margin-top: 18px;
}

.op-date-body {
    display: flex;
    min-height: 0;
    flex: 1;
    /* Scrolls internally, independent of .op-date-picker's own max-height
       cap above — keeps the From/To head and Done footer pinned in view
       instead of the whole page taking over the scroll. */
    overflow-y: auto;
}
@media (max-width: 720px) {
    .op-date-body { flex-direction: column; }
}

.op-date-presets {
    list-style: none;
    margin: 0;
    padding: 8px;
    border-right: 1px solid var(--line-soft);
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 130px;
    flex-shrink: 0;
    /* Scroll inside the sidebar when the preset list outgrows the
       calendar height (which it does once we surface more recent-day
       options). Keeps the popover a fixed size on every screen. */
    max-height: 360px;
    overflow-y: auto;
}
@media (max-width: 720px) {
    .op-date-presets {
        flex-direction: row;
        flex-wrap: wrap;
        width: 100%;
        border-right: 0;
        border-bottom: 1px solid var(--line-soft);
        /* On mobile the presets wrap into rows above the calendar; cap
           the height so they don't push the calendar off-screen. */
        max-height: 140px;
    }
}
.op-date-preset {
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    color: var(--fg-3);
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
}
.op-date-preset:hover { background: var(--bg-elev-2); color: var(--fg); }
.op-date-preset.is-active {
    background: var(--bg-elev-3);
    color: var(--fg);
    font-weight: 500;
}

.op-date-cal {
    flex: 1;
    min-width: 0;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.op-date-cal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.op-date-cal-arrow {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 0;
    color: var(--fg-3);
    cursor: pointer;
}
.op-date-cal-arrow:hover { background: var(--bg-elev-2); color: var(--fg); }
.op-date-cal-range {
    font-size: 11.5px;
    color: var(--fg-3);
}

.op-date-cal-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
}
@media (max-width: 560px) {
    .op-date-cal-grid { grid-template-columns: 1fr; }
}
.op-date-month {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.op-date-month-head {
    text-align: center;
    font-size: 12.5px;
    color: var(--fg);
    font-weight: 500;
    padding-bottom: 4px;
}
.op-date-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
}
.op-date-weekday {
    text-align: center;
    font-size: 9.5px;
    color: var(--fg-4);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 4px 0;
}
.op-date-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
}
.op-date-day {
    aspect-ratio: 1;
    min-height: 30px;
    border-radius: 7px;
    background: transparent;
    border: 0;
    color: var(--fg-2);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    font-family: inherit;
    transition: background 80ms ease, color 80ms ease;
}
.op-date-day:hover:not(:disabled) {
    background: var(--bg-elev-2);
    color: var(--fg);
}
.op-date-day.is-out {
    color: var(--fg-4);
    opacity: 0.4;
    cursor: default;
}
.op-date-day.is-today {
    box-shadow: 0 0 0 1px var(--line-strong) inset;
}
.op-date-day.is-in {
    background: var(--brand-soft);
    color: var(--fg);
    border-radius: 0;
}
.op-date-day.is-start,
.op-date-day.is-end,
.op-date-day.is-single {
    background: var(--brand);
    color: var(--brand-fg);
    font-weight: 500;
}
.op-date-day.is-start {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
}
.op-date-day.is-end {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
}
.op-date-day.is-single {
    border-radius: 7px;
}

.op-date-foot {
    padding: 10px 14px;
    border-top: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}
.op-date-foot-summary {
    font-size: 11.5px;
    color: var(--fg-4);
    font-variant-numeric: tabular-nums;
}
.op-date-foot-actions {
    display: flex;
    gap: 8px;
}
.op-date-btn {
    height: 30px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease, border-color 140ms ease;
}
.op-date-btn:hover:not(.op-date-btn-primary) { background: var(--bg-elev-2); border-color: var(--line-strong); }
.op-date-btn-primary {
    background: var(--brand);
    color: var(--brand-fg);
    border-color: oklch(78% 0.14 165);
}
.op-date-btn-primary:hover { filter: brightness(1.05); }

/* ============================================================
   Mobile (≤720px) — narrow phones use a horizontal scrolling
   preset row above the calendar instead of the broken wrap-row
   layout (.op-date-preset's width:100% defeated flex-wrap).
   ============================================================ */
@media (max-width: 720px) {
    .op-date-presets {
        flex-wrap: nowrap;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        gap: 4px;
        padding: 8px 10px;
        max-height: none;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
    }
    /* Override the desktop full-width rule so each preset becomes a
       horizontally-scrollable chip. */
    .op-date-preset {
        width: auto;
        flex: 0 0 auto;
        white-space: nowrap;
        padding: 7px 12px;
        border: 1px solid var(--line-soft);
        border-radius: 999px;
    }
    .op-date-preset.is-active {
        background: var(--brand-soft);
        color: var(--brand);
        border-color: color-mix(in oklab, var(--brand) 35%, transparent);
    }
}

/* ============================================================
   Phone (≤480px) — tighter calendar, larger touch targets,
   stacked header inputs with the swap arrow becoming an
   inline divider rather than its own column.
   ============================================================ */
@media (max-width: 480px) {
    .op-date-head {
        padding: 12px 14px;
        gap: 8px;
    }
    .op-date-head-label { width: 100%; }
    .op-date-inputs { gap: 6px; }
    .op-date-input { height: 38px; font-size: 13.5px; }
    .op-date-swap {
        margin-top: 18px;
        width: 24px;
        height: 24px;
    }
    .op-date-cal { padding: 10px 12px; gap: 10px; }
    .op-date-cal-grid { gap: 14px; }
    .op-date-month-head { font-size: 13px; }
    /* Larger day cells for tap accuracy. min-height: 38 + aspect 1
       gives roughly 38×38 cells which is just under Apple's 44 guideline
       but works at 320–360 viewports without horizontal overflow. */
    .op-date-day {
        min-height: 38px;
        font-size: 13px;
        border-radius: 6px;
    }
    .op-date-weekday { font-size: 10px; padding: 3px 0; }
    /* Footer wraps + actions stretch to full row on tiny phones for
       proper tap targets. */
    .op-date-foot {
        padding: 12px 14px;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
    }
    .op-date-foot-summary { text-align: center; }
    .op-date-foot-actions { width: 100%; }
    .op-date-foot-actions .op-date-btn { flex: 1; height: 38px; }
}
`;
