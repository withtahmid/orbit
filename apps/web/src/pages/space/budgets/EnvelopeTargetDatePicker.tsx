import {
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
} from "react";
import {
    Calendar as CalendarIcon,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    addDays,
    addMonths,
    addMonthsClamped,
    fromInputDate,
    getAppTzDate,
    getAppTzDay,
    getAppTzMonth,
    getAppTzYear,
    makeAppTzDate,
    shiftForFormat,
    startOfDay,
    startOfMonth,
    toInputDate,
} from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Date-only picker for goal target dates on rolling envelopes. Mirrors the
 * visual idiom of `features/transactions/TransactionDatePicker` (popover +
 * APP_TZ-aware month grid) but drops the time row, AM/PM, and Now/Yesterday
 * presets — none of which make sense for a future goal date.
 *
 * Every day pick commits to `onChange` immediately and closes the popover
 * — unlike the transaction date/time picker, a single click here fully
 * specifies the value (no time-of-day to also choose), so there's no
 * reason to keep the popover open after it. Arrow-key navigation is
 * exempt (see MonthGrid's `onDayClick`) so keyboard users can browse
 * without the popover closing on the first arrow press. Stays on
 * `YYYY-MM-DD` strings at the boundary so the envelope form's existing
 * parse path (`makeAppTzDate(y, m-1, d)` in BudgetsPage submit) is
 * unchanged. Empty string means "no target date".
 */
export function EnvelopeTargetDatePicker({
    value,
    onChange,
}: {
    value: string;
    onChange: (next: string) => void;
}) {
    const [open, setOpen] = useState(false);

    /* Parse the committed value for the trigger label. If empty/invalid,
       the trigger shows the placeholder so users know nothing is set. */
    const committed = useMemo(() => (value ? fromInputDate(value) : null), [value]);
    const label = useMemo(
        () => (committed ? renderTargetLabel(committed) : "No target date"),
        [committed]
    );
    const hasValue = !!committed;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn("etp-trigger", !hasValue && "is-empty")}
                    aria-label={hasValue ? `Target date: ${label}` : "Pick a target date"}
                >
                    <span className="etp-trigger-lead" aria-hidden>
                        <CalendarIcon className="size-3.5" />
                    </span>
                    <span className="etp-trigger-label">{label}</span>
                    <ChevronDown className="size-3 etp-trigger-chev" aria-hidden />
                    <style>{ETP_TRIGGER_STYLES}</style>
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                avoidCollisions
                className="orbit-design etp-pop"
            >
                <style>{ETP_POPOVER_STYLES}</style>
                {open && (
                    <EnvelopeTargetDatePickerInner
                        value={value}
                        onChange={onChange}
                        onDone={() => setOpen(false)}
                        onClear={() => {
                            onChange("");
                            setOpen(false);
                        }}
                    />
                )}
            </PopoverContent>
        </Popover>
    );
}

function EnvelopeTargetDatePickerInner({
    value,
    onChange,
    onDone,
    onClear,
}: {
    value: string;
    onChange: (next: string) => void;
    onDone: () => void;
    onClear: () => void;
}) {
    /* Seed draft from the committed value once. If empty, default to today
       so the calendar has a focused cell from the start. Every subsequent
       pick commits immediately via `commitDraft` — no separate Apply step
       to miss. */
    const [draft, setDraft] = useState<Date>(() => {
        const parsed = value ? fromInputDate(value) : null;
        return parsed && Number.isFinite(parsed.getTime()) ? parsed : startOfDay(new Date());
    });
    const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(draft));

    const today = useMemo(() => startOfDay(new Date()), []);
    const draftDay = useMemo(() => startOfDay(draft), [draft]);

    const commitDraft = (next: Date) => {
        setDraft(next);
        onChange(toInputDate(next));
    };

    const pickDate = (d: Date) => {
        const next = makeAppTzDate(getAppTzYear(d), getAppTzMonth(d), getAppTzDate(d));
        commitDraft(next);
        /* Keep the calendar showing the new selection when arrow-key nav
           crosses month boundaries. */
        if (
            getAppTzYear(d) !== getAppTzYear(viewMonth) ||
            getAppTzMonth(d) !== getAppTzMonth(viewMonth)
        ) {
            setViewMonth(startOfMonth(d));
        }
    };

    return (
        <div className="etp-pop-inner">
            <div className="etp-head">
                <span className="etp-head-eyebrow">Target date</span>
                <span className="etp-head-value">{renderFullLabel(draft)}</span>
            </div>

            <div className="etp-pop-scroll">
                <div className="etp-cal">
                    <div className="etp-cal-head">
                        <button
                            type="button"
                            className="etp-cal-arrow"
                            onClick={() => setViewMonth(addMonths(viewMonth, -1))}
                            aria-label="Previous month"
                        >
                            <ChevronLeft className="size-3.5" />
                        </button>
                        <span className="etp-cal-title">
                            {shiftForFormat(viewMonth).toLocaleString(undefined, {
                                month: "long",
                                year: "numeric",
                            })}
                        </span>
                        <button
                            type="button"
                            className="etp-cal-arrow"
                            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                            aria-label="Next month"
                        >
                            <ChevronRight className="size-3.5" />
                        </button>
                    </div>
                    <MonthGrid
                        month={viewMonth}
                        today={today}
                        selected={draftDay}
                        onPick={pickDate}
                        onDayClick={onDone}
                    />
                </div>
            </div>

            <div className="etp-foot">
                {/* Only show Clear when the form has a committed value —
                   pre-clearing an unset field has no effect and would
                   look like a no-op button. */}
                {value ? (
                    <button
                        type="button"
                        className="etp-btn etp-btn-ghost"
                        onClick={onClear}
                        aria-label="Clear target date"
                    >
                        <X className="size-3.5" />
                        Clear
                    </button>
                ) : (
                    <span aria-hidden />
                )}
                <div className="etp-foot-actions">
                    <button type="button" className="etp-btn" onClick={onDone}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

const WEEKDAYS: Array<{ short: string; full: string }> = [
    { short: "S", full: "Sunday" },
    { short: "M", full: "Monday" },
    { short: "T", full: "Tuesday" },
    { short: "W", full: "Wednesday" },
    { short: "T", full: "Thursday" },
    { short: "F", full: "Friday" },
    { short: "S", full: "Saturday" },
];

function MonthGrid({
    month,
    today,
    selected,
    onPick,
    onDayClick,
}: {
    month: Date;
    today: Date;
    selected: Date;
    onPick: (d: Date) => void;
    /** Fires only on a deliberate click/activation of a day cell — not
     *  on arrow-key navigation, which just moves the roving selection
     *  and must not close the popover mid-browse. This is the one
     *  calendar in the app where a single day fully specifies the value
     *  (no time-of-day to also pick), so a click reads as "I'm done". */
    onDayClick?: () => void;
}) {
    /* APP_TZ-aware grid build — native `new Date(y, m, d)` uses the
       browser's local tz which silently shifts the grid by a day for
       users outside Asia/Dhaka. */
    const year = getAppTzYear(month);
    const m = getAppTzMonth(month);
    const firstOfMonth = makeAppTzDate(year, m, 1);
    const firstWeekday = getAppTzDay(firstOfMonth);
    const daysInMonth = getAppTzDate(makeAppTzDate(year, m + 1, 0));
    const cells: Array<{ d: Date; outOfMonth: boolean }> = [];
    for (let i = firstWeekday; i > 0; i--) {
        cells.push({ d: makeAppTzDate(year, m, 1 - i), outOfMonth: true });
    }
    for (let i = 1; i <= daysInMonth; i++) {
        cells.push({ d: makeAppTzDate(year, m, i), outOfMonth: false });
    }
    const targetCells = cells.length <= 35 ? 35 : 42;
    while (cells.length < targetCells) {
        const last = cells[cells.length - 1].d;
        cells.push({ d: addDays(last, 1), outOfMonth: true });
    }
    const selectedDay = selected.getTime();
    const todayDay = today.getTime();

    /* Roving tabindex — only the selected day is in tab order, arrow keys
       move the selection. */
    const gridRef = useRef<HTMLDivElement>(null);
    const [navTick, setNavTick] = useState(0);
    useLayoutEffect(() => {
        if (navTick === 0) return;
        const el = gridRef.current?.querySelector<HTMLButtonElement>(
            "[data-etp-selected='true']"
        );
        el?.focus();
    }, [navTick, selectedDay]);

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        let delta = 0;
        switch (e.key) {
            case "ArrowLeft":
                delta = -1;
                break;
            case "ArrowRight":
                delta = 1;
                break;
            case "ArrowUp":
                delta = -7;
                break;
            case "ArrowDown":
                delta = 7;
                break;
            case "Home":
                delta = -getAppTzDay(selected);
                break;
            case "End":
                delta = 6 - getAppTzDay(selected);
                break;
            case "PageUp":
                {
                    e.preventDefault();
                    onPick(addMonthsClamped(selected, -1));
                    setNavTick((n) => n + 1);
                }
                return;
            case "PageDown":
                {
                    e.preventDefault();
                    onPick(addMonthsClamped(selected, 1));
                    setNavTick((n) => n + 1);
                }
                return;
            default:
                return;
        }
        e.preventDefault();
        onPick(addDays(selected, delta));
        setNavTick((n) => n + 1);
    };

    return (
        <div className="etp-grid" ref={gridRef}>
            <div className="etp-weekdays" aria-hidden>
                {WEEKDAYS.map((w, i) => (
                    <abbr key={i} className="etp-weekday" title={w.full}>
                        {w.short}
                    </abbr>
                ))}
            </div>
            <div className="etp-days" role="grid" aria-label="Calendar" onKeyDown={handleKeyDown}>
                {cells.map((c, i) => {
                    const t = c.d.getTime();
                    const isSelected = t === selectedDay;
                    const isToday = t === todayDay;
                    return (
                        <button
                            key={i}
                            type="button"
                            role="gridcell"
                            tabIndex={isSelected ? 0 : -1}
                            data-etp-selected={isSelected ? "true" : undefined}
                            aria-selected={isSelected}
                            aria-label={shiftForFormat(c.d).toLocaleDateString(undefined, {
                                weekday: "long",
                                month: "long",
                                day: "numeric",
                                year: "numeric",
                            })}
                            className={cn(
                                "etp-day",
                                c.outOfMonth && "is-out",
                                isSelected && "is-selected",
                                isToday && "is-today"
                            )}
                            onClick={() => {
                                onPick(c.d);
                                onDayClick?.();
                            }}
                        >
                            {getAppTzDate(c.d)}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/* ─── label helpers ─── */

function renderTargetLabel(d: Date): string {
    /* shiftForFormat → APP_TZ wall-clock fed through toLocaleDateString.
       Without this the displayed day could disagree with the stored date
       for users outside Asia/Dhaka near the day boundary. */
    return shiftForFormat(d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function renderFullLabel(d: Date): string {
    return shiftForFormat(d).toLocaleDateString(undefined, {
        weekday: "short",
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

/* ─── styles ─── */

const ETP_TRIGGER_STYLES = `
.etp-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    width: 100%;
    padding: 0 10px;
    border-radius: 10px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    color: var(--fg);
    font-size: 13px;
    font-weight: 400;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease;
    text-align: left;
}
.etp-trigger:hover { border-color: var(--line-strong); }
.etp-trigger[data-state="open"] {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}
.etp-trigger.is-empty .etp-trigger-label { color: var(--fg-3); }
.etp-trigger-lead {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--ent-5) 18%, transparent);
    border: 1px solid color-mix(in oklab, var(--ent-5) 30%, transparent);
    color: var(--ent-5);
    flex-shrink: 0;
}
.etp-trigger-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.etp-trigger-chev { color: var(--fg-3); flex-shrink: 0; }
`;

/* The popover content needs no border/padding from the radix default —
   the inner panel paints itself. Radix portals the PopoverContent, so the
   <style> tag lives next to PopoverContent (not next to the trigger). */
const ETP_POPOVER_STYLES = `
.etp-pop {
    background: transparent !important;
    border: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    width: min(320px, calc(100vw - 28px));
    /* Radix only flips which side the popover opens on, it never shrinks
       the panel — cap to whichever is smaller of the viewport or the
       space Radix actually measured as available, or the footer can
       render below the fold with no way to reach it. */
    max-height: min(
        calc(100dvh - 32px),
        var(--radix-popover-content-available-height, 600px)
    );
}
.etp-pop-inner {
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 24px 60px -16px rgb(0 0 0 / 0.5);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: inherit;
    color: var(--fg);
    max-height: min(
        calc(100dvh - 32px),
        var(--radix-popover-content-available-height, 600px)
    );
    overflow: hidden;
}
.etp-pop-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.etp-head { display: flex; flex-direction: column; gap: 2px; }
.etp-head-eyebrow {
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 500;
}
.etp-head-value {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
}

.etp-cal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    margin-bottom: 4px;
}
.etp-cal-arrow {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    display: grid;
    place-items: center;
}
.etp-cal-arrow:hover { background: var(--bg-elev-2); color: var(--fg); }
.etp-cal-title { font-size: 13px; font-weight: 500; color: var(--fg); }
.etp-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 2px;
}
.etp-weekday {
    height: 22px;
    display: grid;
    place-items: center;
    font-size: 10px;
    color: var(--fg-3);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
.etp-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
}
.etp-day {
    height: 32px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--fg-2);
    font-family: inherit;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
    position: relative;
}
.etp-day:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--brand);
}
/* Bump cells to 40px on phones so days clear the 44px tap-target floor
   when combined with weekday-header padding. */
@media (max-width: 640px) {
    .etp-day { height: 40px; font-size: 13.5px; }
    .etp-weekday { height: 24px; }
}
.etp-day:hover:not(.is-selected):not(.is-out) {
    background: var(--bg-elev-2);
    color: var(--fg);
}
.etp-day.is-out { color: var(--fg-4); cursor: pointer; opacity: 0.45; }
.etp-day.is-today { color: var(--brand); font-weight: 600; }
.etp-day.is-selected {
    background: var(--brand);
    color: var(--brand-fg, var(--bg));
    font-weight: 600;
}
.etp-day.is-selected.is-today { color: var(--brand-fg, var(--bg)); }

.etp-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
}
.etp-foot-actions { display: inline-flex; gap: 6px; }
.etp-btn {
    height: 30px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--fg-2);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.etp-btn:hover { color: var(--fg); border-color: var(--line-strong); }
.etp-btn-ghost { border-color: transparent; color: var(--fg-3); padding: 0 8px; }
.etp-btn-ghost:hover { color: var(--fg); border-color: var(--line); }
`;
