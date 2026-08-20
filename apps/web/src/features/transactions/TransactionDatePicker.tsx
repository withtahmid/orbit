import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    addDays,
    addMonths,
    addMonthsClamped,
    fromInputDateTime,
    getAppTzDate,
    getAppTzDay,
    getAppTzHours,
    getAppTzMinutes,
    getAppTzMonth,
    getAppTzSeconds,
    getAppTzYear,
    makeAppTzDate,
    shiftForFormat,
    startOfDay,
    startOfMonth,
    toInputDateTimeSeconds,
} from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Single-datetime picker for transaction entry. Wraps the form's
 * `datetime-local`-shaped string but presents a friendlier UX:
 *
 *   - Trigger reads as a *relative* label ("Now", "Today, 3:42 PM",
 *     "Yesterday, 8:15 PM", "Mar 5, 3:42 PM") so users don't have to
 *     read a raw ISO-shaped string to know what they picked.
 *   - Popover combines quick presets (Now, Yesterday) with a one-month
 *     calendar and a native time input — covers 95%+ of transaction
 *     date scenarios in two clicks or less.
 *
 * Every edit (calendar day, preset, time stepper) commits to the parent's
 * `onChange` immediately — there's no separate Apply step to miss, so
 * closing the popover any way (Done, outside click, Escape) keeps
 * whatever was last selected. Stays in datetime-local string format at
 * the boundary so the existing form `mutate({ datetime:
 * fromInputDateTime(value) })` plumbing is unchanged.
 */
export function TransactionDatePicker({
    value,
    onChange,
}: {
    value: string;
    onChange: (next: string) => void;
}) {
    const [open, setOpen] = useState(false);

    /* Parse the committed value (used for the trigger label and to seed
       draft state on open). If the parse fails (shouldn't happen with
       defaultDateTime), fall back to now. */
    const committedDate = useMemo(() => {
        const parsed = fromInputDateTime(value);
        return Number.isFinite(parsed.getTime()) ? parsed : new Date();
    }, [value]);

    const label = useMemo(() => renderRelativeLabel(committedDate), [committedDate]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button type="button" className="tdp-trigger">
                    <span className="tdp-trigger-lead" aria-hidden>
                        <CalendarIcon className="size-3.5" />
                    </span>
                    <span className="tdp-trigger-label">{label}</span>
                    <ChevronDown className="size-3 tdp-trigger-chev" aria-hidden />
                    <style>{TDP_STYLES}</style>
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                avoidCollisions
                className="orbit-design tdp-pop"
            >
                {open && (
                    <TransactionDatePickerInner
                        value={value}
                        onChange={onChange}
                        onDone={() => setOpen(false)}
                    />
                )}
            </PopoverContent>
        </Popover>
    );
}

function TransactionDatePickerInner({
    value,
    onChange,
    onDone,
}: {
    value: string;
    onChange: (next: string) => void;
    onDone: () => void;
}) {
    /* Seed draft state from the value once on mount. Every subsequent
       edit commits immediately via `commitDraft` — there's no separate
       Apply step, so nothing is lost if the user closes the popover by
       clicking outside or pressing Escape instead of pressing a button. */
    const [draft, setDraft] = useState(() => {
        const parsed = fromInputDateTime(value);
        return Number.isFinite(parsed.getTime()) ? parsed : new Date();
    });
    const [viewMonth, setViewMonth] = useState(() => startOfMonth(draft));

    /* Every edit goes through here: updates the local draft (so the
       calendar/time UI reflects it immediately) and pushes it up to the
       form in the same tick. Replaces the old draft-then-Apply flow. */
    /* Serialised WITH seconds. Transaction entry seeds each new row with
       second precision so a rapid batch keeps its order (list ties break on a
       random uuid); emitting minute-only here would silently drop that
       tie-break for any row whose date is touched — the same regression
       `toInputDateTimeSeconds` was added to close on the edit-sheet side. */
    const commitDraft = (next: Date) => {
        setDraft(next);
        onChange(toInputDateTimeSeconds(next));
    };

    const today = useMemo(() => startOfDay(new Date()), []);
    const draftDay = useMemo(() => startOfDay(draft), [draft]);

    /* APP_TZ-aware reads of the current draft's wall-clock fields.
       Using native Date.getHours() etc. would return the browser's local
       tz, which silently drifts the picker's display and committed value
       for any user outside Asia/Dhaka. */
    const draftHours24 = getAppTzHours(draft);
    const draftMinutes = getAppTzMinutes(draft);
    /* Carried through every rebuild below so changing the day or nudging the
       time doesn't reset the row's seconds to :00 and jump it to the front of
       its minute in the list. */
    const draftSeconds = getAppTzSeconds(draft);

    /* Preset compute helpers — each returns a fully-resolved Date that
       represents "now" or "yesterday from today at the draft's current
       time-of-day" so the user's intent is preserved. */
    const setNow = () => {
        const now = new Date();
        /* Keep the real seconds; drop only ms (tz-agnostic, safe in any
           browser). Zeroing them made "Now" the EARLIEST second of its minute,
           so a row committed at 10:00:20 stored 10:00:00 and sorted ahead of
           rows entered at :05 and :12 — the exact inversion `draftSeconds`
           threading exists to prevent, through the one path that skipped it.
           The Now chip is unaffected: `setNowBaseline` below receives this
           same Date object, so `isNowPreset`'s getTime() equality holds
           whether or not the seconds were stripped. */
        now.setMilliseconds(0);
        commitDraft(now);
        setViewMonth(startOfMonth(now));
        /* Re-snap the baseline so the chip re-activates and stays active
           until the user changes the draft again. */
        setNowBaseline(now);
    };
    const setYesterday = () => {
        /* Yesterday relative to NOW (not draft) so the preset is stable:
           clicking Yesterday from a 1990 date jumps to actual yesterday,
           not 1989. The draft's HH:mm is preserved so the user keeps the
           time-of-day they chose. */
        const yToday = startOfDay(addDays(new Date(), -1));
        const y = makeAppTzDate(
            getAppTzYear(yToday),
            getAppTzMonth(yToday),
            getAppTzDate(yToday),
            draftHours24,
            draftMinutes,
            draftSeconds
        );
        commitDraft(y);
        setViewMonth(startOfMonth(y));
    };
    /* `nowBaseline` is the most recent "now" snapshot — set on mount
       and re-set every time the user clicks the Now preset. The chip is
       active exactly when the draft still equals that baseline, which:
         - avoids wall-clock drift (a fresh `new Date()` per render
           would silently dim the chip ~60s after open even if the user
           hadn't touched anything),
         - re-activates immediately when the user clicks Now again,
         - reflects user intent rather than absolute time precision.
       Initialization edge: if the form was opened just before a minute
       boundary and the picker is opened just after it, `new Date()`
       lands one minute past the form's `defaultDateTime()` and the
       chip would dim on first open. We snap the baseline to `draft`
       when they're within 60s — covers that case while still letting
       the chip honestly dim when the user opened a form long ago. */
    const [nowBaseline, setNowBaseline] = useState(() => {
        const n = new Date();
        /* Milliseconds only, matching setNow — with seconds zeroed the 60s
           snap window silently varied in width by the seed's seconds. */
        n.setMilliseconds(0);
        return Math.abs(n.getTime() - draft.getTime()) <= 60_000 ? draft : n;
    });
    const isNowPreset = draft.getTime() === nowBaseline.getTime();
    const isYesterdayPreset = useMemo(() => {
        const y = startOfDay(addDays(new Date(), -1));
        return y.getTime() === draftDay.getTime();
    }, [draftDay]);

    const pickDate = (d: Date) => {
        /* Build the next moment from APP_TZ fields: the day comes from
           `d`, the time-of-day from the current draft. Avoids the native
           Date.setFullYear/setHours trap (browser-local). */
        const next = makeAppTzDate(
            getAppTzYear(d),
            getAppTzMonth(d),
            getAppTzDate(d),
            draftHours24,
            draftMinutes,
            draftSeconds
        );
        commitDraft(next);
        /* When arrow-key nav (or any selection) crosses into a different
           month, keep the calendar showing the new selection so the user
           never loses sight of the focused cell. */
        if (
            getAppTzYear(d) !== getAppTzYear(viewMonth) ||
            getAppTzMonth(d) !== getAppTzMonth(viewMonth)
        ) {
            setViewMonth(startOfMonth(d));
        }
    };
    const setHours24 = (h24: number) => {
        const safe = Math.max(0, Math.min(23, h24));
        const next = makeAppTzDate(
            getAppTzYear(draft),
            getAppTzMonth(draft),
            getAppTzDate(draft),
            safe,
            draftMinutes,
            draftSeconds
        );
        commitDraft(next);
    };
    const setMinutes = (m: number) => {
        const safe = Math.max(0, Math.min(59, m));
        const next = makeAppTzDate(
            getAppTzYear(draft),
            getAppTzMonth(draft),
            getAppTzDate(draft),
            draftHours24,
            safe,
            draftSeconds
        );
        commitDraft(next);
    };
    const togglePeriod = () => {
        setHours24(draftHours24 < 12 ? draftHours24 + 12 : draftHours24 - 12);
    };
    /* Advance the wall-clock minute by `delta * 5`, wrapping around 24h.
       Letting the carry walk into the hour is the natural mental model
       for stepper-style time pickers: "+5" from 14:58 should land on
       15:00, not regress to 14:00. The previous minute-only wrap had the
       clock visibly go backwards near the hour boundary. */
    const stepMinuteOfDay = (delta: number) => {
        const aligned = Math.round(draftMinutes / 5) * 5;
        const totalMin = (draftHours24 * 60 + aligned + delta * 5 + 24 * 60) % (24 * 60);
        const nextH = Math.floor(totalMin / 60);
        const nextM = totalMin % 60;
        const next = makeAppTzDate(
            getAppTzYear(draft),
            getAppTzMonth(draft),
            getAppTzDate(draft),
            nextH,
            nextM,
            draftSeconds
        );
        commitDraft(next);
    };

    return (
        <div className="tdp-pop-inner">
            <div className="tdp-head">
                <span className="tdp-head-eyebrow">Transaction date</span>
                <span className="tdp-head-value">{renderFullLabel(draft)}</span>
            </div>

            <div className="tdp-pop-scroll">
                <div className="tdp-presets">
                    <button
                        type="button"
                        className={cn("tdp-preset", isNowPreset && "is-active")}
                        onClick={setNow}
                    >
                        Now
                    </button>
                    <button
                        type="button"
                        className={cn("tdp-preset", isYesterdayPreset && "is-active")}
                        onClick={setYesterday}
                    >
                        Yesterday
                    </button>
                </div>

                <div className="tdp-cal">
                    <div className="tdp-cal-head">
                        <button
                            type="button"
                            className="tdp-cal-arrow"
                            onClick={() => setViewMonth(addMonths(viewMonth, -1))}
                            aria-label="Previous month"
                        >
                            <ChevronLeft className="size-3.5" />
                        </button>
                        <span className="tdp-cal-title">
                            {shiftForFormat(viewMonth).toLocaleString(undefined, {
                                month: "long",
                                year: "numeric",
                            })}
                        </span>
                        <button
                            type="button"
                            className="tdp-cal-arrow"
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
                    />
                </div>

                <TimeRow
                    hours24={draftHours24}
                    minutes={draftMinutes}
                    setHours24={setHours24}
                    setMinutes={setMinutes}
                    togglePeriod={togglePeriod}
                    stepMinuteOfDay={stepMinuteOfDay}
                />
            </div>

            <div className="tdp-foot">
                <button type="button" className="tdp-btn" onClick={onDone}>
                    Done
                </button>
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
}: {
    month: Date;
    today: Date;
    selected: Date;
    onPick: (d: Date) => void;
}) {
    /* Build the grid in APP_TZ space. The native `new Date(y, m, d)`
       constructor uses the browser's local tz; in a UTC or western
       browser, viewMonth.getMonth() can return the previous month and
       the whole grid renders offset by a day. */
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
    /* Pad to the next multiple of 7 (so the grid is rectangular) — but
       not all the way to 42 unless this month happens to need 6 rows.
       Cuts ~32px off the typical 5-row month, helping the panel fit in
       smaller viewports. */
    const targetCells = cells.length <= 35 ? 35 : 42;
    while (cells.length < targetCells) {
        const last = cells[cells.length - 1].d;
        cells.push({ d: addDays(last, 1), outOfMonth: true });
    }
    const selectedDay = selected.getTime();
    const todayDay = today.getTime();

    /* Roving tabindex pattern: only the selected day is tabbable. Arrow
       keys move the selection and we focus the new selected cell after
       commit so keyboard users don't have to Tab through 28+ buttons.
       The `navTick` state forces an effect to fire after each arrow-key
       commit; identity rather than value matters. */
    const gridRef = useRef<HTMLDivElement>(null);
    const [navTick, setNavTick] = useState(0);
    useLayoutEffect(() => {
        if (navTick === 0) return;
        const el = gridRef.current?.querySelector<HTMLButtonElement>("[data-tdp-selected='true']");
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
                /* APP_TZ day-of-week; native getDay() would be off by
                   one near the day boundary for users outside Dhaka. */
                delta = -getAppTzDay(selected);
                break;
            case "End":
                delta = 6 - getAppTzDay(selected);
                break;
            case "PageUp":
                /* Jump one month back, day-of-month clamped to that
                   month's last day. e.g. Mar 31 → Feb 28/29, not "Mar 3"
                   that JS overflow would land on. */
                {
                    e.preventDefault();
                    const target = addMonthsClamped(selected, -1);
                    onPick(target);
                    setNavTick((n) => n + 1);
                }
                return;
            case "PageDown":
                {
                    e.preventDefault();
                    const target = addMonthsClamped(selected, 1);
                    onPick(target);
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
        <div className="tdp-grid" ref={gridRef}>
            <div className="tdp-weekdays" aria-hidden>
                {WEEKDAYS.map((w, i) => (
                    /* abbr exposes the full day name to assistive tech via
                       the title attribute; the visible single letter
                       remains for compactness. */
                    <abbr key={i} className="tdp-weekday" title={w.full}>
                        {w.short}
                    </abbr>
                ))}
            </div>
            <div className="tdp-days" role="grid" aria-label="Calendar" onKeyDown={handleKeyDown}>
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
                            data-tdp-selected={isSelected ? "true" : undefined}
                            aria-selected={isSelected}
                            /* shiftForFormat → APP_TZ wall-clock fed
                               through toLocaleDateString. Without it
                               the SR announcement could disagree with
                               the visible date for non-Dhaka users. */
                            aria-label={shiftForFormat(c.d).toLocaleDateString(undefined, {
                                weekday: "long",
                                month: "long",
                                day: "numeric",
                                year: "numeric",
                            })}
                            className={cn(
                                "tdp-day",
                                c.outOfMonth && "is-out",
                                isSelected && "is-selected",
                                isToday && "is-today"
                            )}
                            onClick={() => onPick(c.d)}
                        >
                            {getAppTzDate(c.d)}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/* ─── time row ─── */

/**
 * Segmented HH : MM  AM/PM control. Three inline pills:
 *
 *   - Hour pill: 1–12 (12h), tab-accessible, ↑/↓ to nudge, type to set.
 *   - Minute pill: 0–59, same behaviors.
 *   - Period pill (AM/PM): click to flip, also keyboard-toggleable.
 *
 * Locale fixed to 12h here — the trigger label respects user locale via
 * `toLocaleString`, but inside the picker we want predictable pill
 * labels regardless of locale. (The OS time picker is harder to style
 * to match the editorial-dark aesthetic, hence the custom row.)
 */
function TimeRow({
    hours24,
    minutes,
    setHours24,
    setMinutes,
    togglePeriod,
    stepMinuteOfDay,
}: {
    hours24: number;
    minutes: number;
    setHours24: (h: number) => void;
    setMinutes: (m: number) => void;
    togglePeriod: () => void;
    /** Step the clock forward/back by N×5 minutes, carrying the hour
     *  when minutes wrap past 60. Provided by the parent so the carry
     *  uses APP_TZ-aware date construction. */
    stepMinuteOfDay: (delta: number) => void;
}) {
    const isPm = hours24 >= 12;
    const hours12 = ((hours24 + 11) % 12) + 1;

    const onHourCommit = (raw: string) => {
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n)) return;
        const clamped = Math.max(1, Math.min(12, n));
        /* Preserve AM/PM when typing — only the 1–12 component changes. */
        const next24 = isPm ? (clamped === 12 ? 12 : clamped + 12) : clamped === 12 ? 0 : clamped;
        setHours24(next24);
    };
    const onMinuteCommit = (raw: string) => {
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n)) return;
        setMinutes(Math.max(0, Math.min(59, n)));
    };

    const nudgeHour = (delta: number) => {
        const next = ((hours12 - 1 + delta + 12) % 12) + 1;
        onHourCommit(String(next));
    };

    return (
        <div className="tdp-time">
            <span className="tdp-time-label">Time</span>
            <div className="tdp-time-segments">
                <Stepper onMinus={() => nudgeHour(-1)} onPlus={() => nudgeHour(1)} label="hour">
                    <TimeSegment
                        value={hours12}
                        pad
                        onChange={onHourCommit}
                        onNudge={nudgeHour}
                        ariaLabel="Hour"
                    />
                </Stepper>
                <span className="tdp-time-colon">:</span>
                <Stepper
                    onMinus={() => stepMinuteOfDay(-1)}
                    onPlus={() => stepMinuteOfDay(1)}
                    label="minute (5-min step)"
                >
                    <TimeSegment
                        value={minutes}
                        pad
                        onChange={onMinuteCommit}
                        onNudge={(delta) => {
                            /* Keyboard arrow stays at 1-min precision —
                               only the visible +/- buttons step by 5. */
                            const next = (minutes + delta + 60) % 60;
                            onMinuteCommit(String(next));
                        }}
                        ariaLabel="Minute"
                    />
                </Stepper>
                <button
                    type="button"
                    className={cn("tdp-time-period", isPm && "is-pm")}
                    onClick={togglePeriod}
                    aria-label={`Period: ${isPm ? "PM" : "AM"}, click to toggle`}
                >
                    {isPm ? "PM" : "AM"}
                </button>
            </div>
        </div>
    );
}

function Stepper({
    onMinus,
    onPlus,
    label,
    children,
}: {
    onMinus: () => void;
    onPlus: () => void;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <span className="tdp-stepper">
            <button
                type="button"
                className="tdp-stepper-btn"
                onClick={(e) => {
                    e.preventDefault();
                    onMinus();
                }}
                aria-label={`Decrease ${label}`}
            >
                −
            </button>
            {children}
            <button
                type="button"
                className="tdp-stepper-btn"
                onClick={(e) => {
                    e.preventDefault();
                    onPlus();
                }}
                aria-label={`Increase ${label}`}
            >
                +
            </button>
        </span>
    );
}

function TimeSegment({
    value,
    pad,
    onChange,
    onNudge,
    ariaLabel,
}: {
    value: number;
    pad: boolean;
    onChange: (raw: string) => void;
    onNudge: (delta: number) => void;
    ariaLabel: string;
}) {
    const [draftText, setDraftText] = useState(() =>
        pad ? String(value).padStart(2, "0") : String(value)
    );
    /* When the parent changes the underlying number (arrow-key nudges,
       AM/PM toggle, preset clicks), pull the new value into the input.
       The dependency on `value` ensures the input always reflects the
       canonical state when the user isn't actively editing. */
    useEffect(() => {
        setDraftText(pad ? String(value).padStart(2, "0") : String(value));
    }, [value, pad]);

    return (
        <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className="tdp-time-segment"
            value={draftText}
            aria-label={ariaLabel}
            onChange={(e) => {
                const cleaned = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
                setDraftText(cleaned);
            }}
            onBlur={() => {
                if (draftText === "") {
                    setDraftText(pad ? String(value).padStart(2, "0") : String(value));
                    return;
                }
                onChange(draftText);
            }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    onNudge(1);
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    onNudge(-1);
                } else if (e.key === "Enter") {
                    (e.currentTarget as HTMLInputElement).blur();
                }
            }}
        />
    );
}

/* ─── label helpers ─── */

function renderRelativeLabel(d: Date): string {
    const now = new Date();
    if (Math.abs(now.getTime() - d.getTime()) < 60_000) return "Now";
    const today = startOfDay(now);
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    const dDay = startOfDay(d);
    /* shiftForFormat re-aliases the absolute moment so toLocaleString
       reads APP_TZ wall-clock through the user's browser tz. Without
       this, the time and the day bucket can disagree — a Dhaka-side
       transaction at 2:00 AM could read "Yesterday, 8:00 PM" for a UTC
       browser. */
    const dShifted = shiftForFormat(d);
    const nowShifted = shiftForFormat(now);
    const time = dShifted.toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });
    if (dDay.getTime() === today.getTime()) return `Today, ${time}`;
    if (dDay.getTime() === yesterday.getTime()) return `Yesterday, ${time}`;
    if (dDay.getTime() === tomorrow.getTime()) return `Tomorrow, ${time}`;
    const sameYear = dShifted.getFullYear() === nowShifted.getFullYear();
    const datePart = dShifted.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
    });
    return `${datePart}, ${time}`;
}

function renderFullLabel(d: Date): string {
    /* shiftForFormat → display reads APP_TZ wall-clock regardless of
       the user's browser tz, matching the rest of the form's semantics. */
    return shiftForFormat(d).toLocaleString(undefined, {
        weekday: "short",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

/* ─── styles ─── */

const TDP_STYLES = `
.tdp-trigger {
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
.tdp-trigger:hover { border-color: var(--line-strong); }
.tdp-trigger[data-state="open"] {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}
.tdp-trigger-lead {
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
.tdp-trigger-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.tdp-trigger-chev { color: var(--fg-3); flex-shrink: 0; }
`;

/* The popover content needs no border/padding from the radix default —
   the inner panel paints itself. Keep it portal-mounted so the sheet's
   stacking context doesn't clip it. */
export const TDP_POPOVER_STYLES = `
.tdp-pop {
    background: transparent !important;
    border: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    width: min(340px, calc(100vw - 28px));
    /* Cap height to whichever is smaller: the viewport, or the space
       Radix actually measured as available on the side it chose to open
       (--radix-popover-content-available-height). Radix's collision
       detection only flips sides — it never shrinks the panel — so when
       the trigger sits low in a form/sheet, the "available" space can be
       far less than the viewport-relative calc alone would allow, and
       without this the footer renders below the fold with no way to
       scroll to it. */
    max-height: min(
        calc(100dvh - 32px),
        var(--radix-popover-content-available-height, 600px)
    );
}
.tdp-pop-inner {
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
    /* Body scrolls inside .tdp-pop-scroll so the header and footer
       (Cancel / Apply) stay pinned at the edges. On short viewports
       (landscape phones), this is the only way to keep Apply reachable
       without having the user discover an inner scroll. */
    overflow: hidden;
}
.tdp-pop-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.tdp-foot { flex-shrink: 0; }
.tdp-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.tdp-head-eyebrow {
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 500;
}
.tdp-head-value {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
}

.tdp-presets {
    display: flex;
    gap: 6px;
}
.tdp-preset {
    flex: 1;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--fg-2);
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.tdp-preset:hover { color: var(--fg); border-color: var(--line-strong); }
.tdp-preset.is-active {
    background: color-mix(in oklab, var(--brand) 18%, transparent);
    border-color: color-mix(in oklab, var(--brand) 45%, transparent);
    color: var(--brand);
}

.tdp-cal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    margin-bottom: 4px;
}
.tdp-cal-arrow {
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
.tdp-cal-arrow:hover {
    background: var(--bg-elev-2);
    color: var(--fg);
}
.tdp-cal-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
}
.tdp-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 2px;
}
.tdp-weekday {
    height: 22px;
    display: grid;
    place-items: center;
    font-size: 10px;
    color: var(--fg-3);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
.tdp-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
}
.tdp-day {
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
    /* Roving-tabindex: focusable cell gets the brand ring like other
       fields. Without this, keyboard users had no visual cue where the
       active day is. */
}
.tdp-day:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--brand);
}
/* Touch targets — bump days to 40px and weekday labels to 24px on
   anything ≤640px so phone users get a comfortable tap zone. The
   popover height cap still applies, so this just shifts how the
   available height is distributed. */
@media (max-width: 640px) {
    .tdp-day { height: 40px; font-size: 13.5px; }
    .tdp-weekday { height: 24px; }
}
.tdp-day:hover:not(.is-selected):not(.is-out) {
    background: var(--bg-elev-2);
    color: var(--fg);
}
.tdp-day.is-out { color: var(--fg-4); cursor: pointer; opacity: 0.45; }
.tdp-day.is-today {
    color: var(--brand);
    font-weight: 600;
}
.tdp-day.is-selected {
    background: var(--brand);
    color: var(--brand-fg, var(--bg));
    font-weight: 600;
}
.tdp-day.is-selected.is-today { color: var(--brand-fg, var(--bg)); }

.tdp-time {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--bg-elev-2);
    border: 1px solid var(--line-soft);
}
/* At true-360px viewports the Time label + segments together exceed
   the inner width and the label gets squashed. Letting the row wrap
   so the label takes a full line above the segments keeps the layout
   readable without truncation. */
@media (max-width: 380px) {
    .tdp-time { flex-wrap: wrap; justify-content: flex-start; }
    .tdp-time-label { flex-basis: 100%; text-align: left; }
}
.tdp-time-label {
    font-size: 11px;
    color: var(--fg-3);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 500;
}
.tdp-time-segments {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
/* Stepper groups the [−] [input] [+] cluster into one rounded pill so
   it reads as a single control rather than three independent buttons.
   The inputs and buttons share the same height; the input has no
   side-borders inside the pill so the visual line stays continuous. */
.tdp-stepper {
    display: inline-flex;
    align-items: stretch;
    height: 30px;
    border-radius: 8px;
    background: var(--bg-elev-1);
    border: 1px solid var(--line);
    overflow: hidden;
    transition: border-color 140ms ease;
}
.tdp-stepper:hover { border-color: var(--line-strong); }
.tdp-stepper:focus-within {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--brand-soft);
}
.tdp-stepper-btn {
    width: 26px;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    font-family: inherit;
    font-size: 16px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
    /* No tap-highlight on iOS so the press feels native to the pill. */
    -webkit-tap-highlight-color: transparent;
}
.tdp-stepper-btn:hover { background: var(--bg-elev-2); color: var(--fg); }
.tdp-stepper-btn:active { background: var(--bg-elev-3, var(--bg-elev-2)); }
.tdp-time-segment {
    width: 36px;
    height: 100%;
    text-align: center;
    border: 0;
    border-left: 1px solid var(--line-soft);
    border-right: 1px solid var(--line-soft);
    background: transparent;
    color: var(--fg);
    font-family: inherit;
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 0;
}
.tdp-time-segment:focus { outline: none; }
.tdp-time-colon {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-3);
    line-height: 1;
    padding: 0 2px;
}
.tdp-time-period {
    height: 30px;
    min-width: 40px;
    padding: 0 10px;
    margin-left: 4px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg-elev-1);
    color: var(--fg-2);
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.tdp-time-period:hover { color: var(--fg); border-color: var(--line-strong); }
.tdp-time-period.is-pm {
    /* Filled brand variant for AA contrast — the previous 14% tint with
       brand-colored text on bg-elev-1 sat below 4.5:1. Using --brand-fg
       on a solid --brand background hits the design system's defined
       contrast pair. */
    background: var(--brand);
    border-color: var(--brand);
    color: var(--brand-fg, var(--bg));
}

.tdp-foot {
    display: flex;
    justify-content: flex-end;
    margin-top: 2px;
}
.tdp-btn {
    /* Compact, right-aligned, secondary-styled — matching
       EnvelopeTargetDatePicker's Done. It just closes (everything else
       already committed live), so it should read as a calm dismiss, not
       compete with the form's actual primary CTA ("Save transaction")
       sitting right next to this popover. DateRangePicker's own Done
       stays brand-filled: it opens from a standalone filter chip with no
       competing form CTA nearby, so there's nothing for it to compete
       with. */
    height: 34px;
    padding: 0 16px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--fg-2);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.tdp-btn:hover { color: var(--fg); border-color: var(--line-strong); }
`;

/* TDP_POPOVER_STYLES is exported at the const declaration above (around
   line 723). The parent sheet mounts it once at the top — Radix portals
   the PopoverContent outside the trigger's DOM subtree, so a
   trigger-local <style> wouldn't apply. */
