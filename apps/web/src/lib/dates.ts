/**
 * App-wide timezone. Mirrors the server's `ENV.APP_TIMEZONE`. The whole
 * UI (period windows, datetime inputs, formatted display) interprets
 * wall-clock times in this zone so users in any timezone see consistent
 * boundaries that match what the server computes.
 *
 * Dhaka is UTC+06:00 year-round (no DST), so we can implement this with
 * a fixed offset + cheap Date arithmetic rather than pulling in
 * date-fns-tz. If this ever changes to a zone with DST — or we add
 * per-space timezones — swap to `date-fns-tz` and keep the helper
 * signatures.
 */
export const APP_TIMEZONE = "Asia/Dhaka";

/** Minutes east of UTC for Asia/Dhaka. Positive = ahead of UTC. */
const APP_TZ_OFFSET_MIN = 6 * 60;

/**
 * Return a Date whose *UTC fields* (getUTCFullYear etc.) represent the
 * wall-clock in APP_TIMEZONE for the given absolute moment. Not a real
 * moment in time — use `unprojectFromAppTz` to get back a true Date.
 */
function projectToAppTz(absolute: Date): Date {
    return new Date(absolute.getTime() + APP_TZ_OFFSET_MIN * 60_000);
}

/**
 * Inverse: given a Date whose UTC fields represent APP_TIMEZONE
 * wall-clock, return the true absolute moment.
 */
function unprojectFromAppTz(projected: Date): Date {
    return new Date(projected.getTime() - APP_TZ_OFFSET_MIN * 60_000);
}

/**
 * Return a Date shifted so its *local-time fields* (getFullYear etc. on
 * the browser's tz) equal the APP_TIMEZONE wall-clock for the original
 * moment. Used when feeding values to `date-fns` `format()` so the
 * display matches APP_TIMEZONE regardless of the user's browser tz.
 */
export function shiftForFormat(absolute: Date): Date {
    const userOffsetMin = absolute.getTimezoneOffset(); // minutes to add to local to get UTC
    // We want localFields == APP_TZ wall-clock.
    //   localFields = absolute - userOffsetMin minutes
    //   appTz wall-clock = absolute + APP_TZ_OFFSET_MIN minutes (in UTC field space)
    // So we need to shift by (APP_TZ_OFFSET_MIN + userOffsetMin) minutes.
    return new Date(absolute.getTime() + (APP_TZ_OFFSET_MIN + userOffsetMin) * 60_000);
}

export function startOfMonth(date: Date = new Date()): Date {
    const p = projectToAppTz(date);
    const start = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), 1, 0, 0, 0, 0));
    return unprojectFromAppTz(start);
}

export function endOfMonth(date: Date = new Date()): Date {
    // Return the start of the next month (exclusive end), matching
    // existing call-site semantics.
    const p = projectToAppTz(date);
    const start = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    return unprojectFromAppTz(start);
}

export function addDays(date: Date, days: number): Date {
    const p = projectToAppTz(date);
    const shifted = new Date(
        Date.UTC(
            p.getUTCFullYear(),
            p.getUTCMonth(),
            p.getUTCDate() + days,
            p.getUTCHours(),
            p.getUTCMinutes(),
            p.getUTCSeconds(),
            p.getUTCMilliseconds()
        )
    );
    return unprojectFromAppTz(shifted);
}

export function addMonths(date: Date, months: number): Date {
    const p = projectToAppTz(date);
    const shifted = new Date(
        Date.UTC(
            p.getUTCFullYear(),
            p.getUTCMonth() + months,
            p.getUTCDate(),
            p.getUTCHours(),
            p.getUTCMinutes(),
            p.getUTCSeconds(),
            p.getUTCMilliseconds()
        )
    );
    return unprojectFromAppTz(shifted);
}

/**
 * Like `addMonths`, but clamps day-of-month to the last day of the target
 * month rather than letting JS overflow into the next month. e.g.
 * `addMonthsClamped(Jan 31, +1)` → Feb 28/29 (not Mar 3). Use this for
 * UI date pickers where users expect the "same day next month" mental
 * model; use plain `addMonths` for analytics windows where overflow is
 * fine (since the inputs are usually month-aligned).
 */
export function addMonthsClamped(date: Date, months: number): Date {
    const p = projectToAppTz(date);
    const y = p.getUTCFullYear();
    const m = p.getUTCMonth() + months;
    const day = p.getUTCDate();
    // Day 0 of next month = last day of target month.
    const lastDayOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const clampedDay = Math.min(day, lastDayOfTarget);
    const shifted = new Date(
        Date.UTC(
            y,
            m,
            clampedDay,
            p.getUTCHours(),
            p.getUTCMinutes(),
            p.getUTCSeconds(),
            p.getUTCMilliseconds()
        )
    );
    return unprojectFromAppTz(shifted);
}

/* ─── APP_TZ field accessors ──────────────────────────────────────────
 *
 * Use these instead of native `Date.getHours()` etc. when reading the
 * wall-clock of an absolute moment as APP_TIMEZONE expects it. Native
 * getters use the browser's local tz — invisible bug for users in
 * Dhaka, but for any user in a different tz the picker would display
 * (and commit) times that drift by their local offset. */

export function getAppTzYear(date: Date): number {
    return projectToAppTz(date).getUTCFullYear();
}
export function getAppTzMonth(date: Date): number {
    return projectToAppTz(date).getUTCMonth();
}
export function getAppTzDate(date: Date): number {
    return projectToAppTz(date).getUTCDate();
}
export function getAppTzDay(date: Date): number {
    return projectToAppTz(date).getUTCDay();
}
export function getAppTzHours(date: Date): number {
    return projectToAppTz(date).getUTCHours();
}
export function getAppTzMinutes(date: Date): number {
    return projectToAppTz(date).getUTCMinutes();
}

/**
 * Build an absolute Date from APP_TIMEZONE wall-clock fields. Mirror of
 * `new Date(y, m, d, h, mi)` but for APP_TZ — the native constructor
 * uses the browser's local tz and so is wrong for the picker.
 */
export function makeAppTzDate(
    year: number,
    month: number,
    day: number,
    hours = 0,
    minutes = 0,
    seconds = 0,
    ms = 0
): Date {
    return unprojectFromAppTz(new Date(Date.UTC(year, month, day, hours, minutes, seconds, ms)));
}

export function startOfDay(date: Date = new Date()): Date {
    const p = projectToAppTz(date);
    const start = new Date(
        Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), 0, 0, 0, 0)
    );
    return unprojectFromAppTz(start);
}

export function endOfDay(date: Date = new Date()): Date {
    const p = projectToAppTz(date);
    const end = new Date(
        Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), 23, 59, 59, 999)
    );
    return unprojectFromAppTz(end);
}

export function startOfWeek(date: Date = new Date()): Date {
    const sod = startOfDay(date);
    const p = projectToAppTz(sod);
    const day = p.getUTCDay(); // 0 = Sunday in APP_TZ wall-clock
    return addDays(sod, -day);
}

/**
 * Monday at 00:00 APP_TZ of the ISO week containing `date`. Matches the
 * server's `date_trunc('week', ...)` semantics (Postgres uses ISO
 * Monday-Sunday weeks). Use this instead of `startOfWeek` whenever a
 * window is sent to a procedure that boundary-truncates with
 * `date_trunc('week', ...)`.
 */
export function startOfIsoWeek(date: Date = new Date()): Date {
    const sod = startOfDay(date);
    const p = projectToAppTz(sod);
    const dow = p.getUTCDay(); // 0=Sun..6=Sat
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    return addDays(sod, -daysFromMonday);
}

/**
 * Start of the calendar quarter containing `date` (Jan 1 / Apr 1 / Jul 1
 * / Oct 1 at 00:00 APP_TZ). Matches Postgres `date_trunc('quarter', ...)`.
 */
export function startOfQuarter(date: Date = new Date()): Date {
    const p = projectToAppTz(date);
    const quarterMonth = Math.floor(p.getUTCMonth() / 3) * 3;
    const start = new Date(Date.UTC(p.getUTCFullYear(), quarterMonth, 1, 0, 0, 0, 0));
    return unprojectFromAppTz(start);
}

export function startOfYear(date: Date = new Date()): Date {
    const p = projectToAppTz(date);
    const start = new Date(Date.UTC(p.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    return unprojectFromAppTz(start);
}

export function endOfYear(date: Date = new Date()): Date {
    const p = projectToAppTz(date);
    const start = new Date(Date.UTC(p.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
    return unprojectFromAppTz(start);
}

/**
 * Format yyyy-MM-dd in APP_TIMEZONE, suitable for date-only inputs.
 * Reading the projected UTC fields gives the APP_TZ wall-clock date
 * regardless of the user's browser tz.
 */
export function toInputDate(d: Date | null | undefined): string {
    if (!d) return "";
    const p = projectToAppTz(d);
    const yyyy = p.getUTCFullYear();
    const mm = String(p.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(p.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format yyyy-MM-ddTHH:mm in APP_TIMEZONE for datetime-local inputs.
 * The HTML input is timezone-unaware, so we display the value as if the
 * user were in APP_TIMEZONE.
 */
export function toInputDateTime(d: Date | null | undefined): string {
    if (!d) return "";
    const p = projectToAppTz(d);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${p.getUTCFullYear()}-${pad(p.getUTCMonth() + 1)}-${pad(
        p.getUTCDate()
    )}T${pad(p.getUTCHours())}:${pad(p.getUTCMinutes())}`;
}

/**
 * Parse a datetime-local input value (`YYYY-MM-DDTHH:mm`) as an absolute
 * moment, interpreting the wall-clock as APP_TIMEZONE. Use this instead
 * of `new Date(inputValue)` — the built-in constructor would interpret
 * the string as the browser's local tz, so a user outside APP_TIMEZONE
 * would save a time that's off by their local offset from APP_TIMEZONE.
 */
export function fromInputDateTime(v: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
    if (!m) return new Date(NaN);
    // Build the APP_TZ wall-clock as a UTC-field Date, then unproject.
    const projected = new Date(
        Date.UTC(
            Number(m[1]),
            Number(m[2]) - 1,
            Number(m[3]),
            Number(m[4]),
            Number(m[5]),
            Number(m[6] ?? 0),
            0
        )
    );
    return unprojectFromAppTz(projected);
}

/**
 * Parse a date-only input value (`YYYY-MM-DD`) as the start of that day
 * in APP_TIMEZONE.
 */
export function fromInputDate(v: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return null;
    const projected = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0));
    return unprojectFromAppTz(projected);
}

/* ─── Calendar-aligned periods ────────────────────────────────────────
 *
 * A *period* is a whole calendar unit — an ISO week, a calendar month,
 * quarter, or year — never an arbitrary range. Analytics that compare
 * "this one vs the last one" or average across "every prior one" need
 * aligned, equal-shaped windows: a ragged range has no defined position
 * ("day 12 of what?"), no comparable predecessor, and no bucket
 * positions to average over. Use `resolvePeriod` / `PeriodChip` for
 * ragged windows and these helpers for aligned ones.
 *
 * All four boundaries match Postgres `date_trunc(unit, …)` under the
 * session timezone (Asia/Dhaka), so client-derived windows land on the
 * same instants the server buckets on. */

export type PeriodGranularity = "week" | "month" | "quarter" | "year";

/** Start of the calendar period of `granularity` containing `date`. */
export function startOfPeriod(granularity: PeriodGranularity, date: Date): Date {
    if (granularity === "week") return startOfIsoWeek(date);
    if (granularity === "month") return startOfMonth(date);
    if (granularity === "quarter") return startOfQuarter(date);
    return startOfYear(date);
}

/** `{ start, end }` of the period containing `date`; `end` is exclusive. */
export function periodBounds(
    granularity: PeriodGranularity,
    date: Date = new Date()
): { start: Date; end: Date } {
    const start = startOfPeriod(granularity, date);
    return { start, end: addPeriods(granularity, start, 1) };
}

/**
 * Shift `date` by `n` whole periods. Pass a period *start* (what
 * `startOfPeriod` returns) rather than an arbitrary mid-period date:
 * stepping from Jul 31 by −1 month would land on Jul 1 via JS day
 * overflow, silently repeating the period instead of moving off it.
 */
export function addPeriods(granularity: PeriodGranularity, date: Date, n: number): Date {
    if (granularity === "week") return addDays(date, n * 7);
    if (granularity === "month") return addMonths(date, n);
    if (granularity === "quarter") return addMonths(date, n * 3);
    return addMonths(date, n * 12);
}

/** True when `date` falls inside the period of `granularity` containing `ref`. */
export function isSamePeriod(granularity: PeriodGranularity, date: Date, ref: Date): boolean {
    return startOfPeriod(granularity, date).getTime() === startOfPeriod(granularity, ref).getTime();
}

export type PeriodPresetId =
    | "this-month"
    | "last-30-days"
    | "last-month"
    | "last-3-months"
    | "last-6-months"
    | "last-12-months"
    | "this-year"
    | "all-time"
    | "custom";

export interface PeriodRange {
    preset: PeriodPresetId;
    start: Date;
    end: Date;
}

/** Convert a preset id to a concrete {start, end} range (end is exclusive). */
export function resolvePeriod(
    preset: PeriodPresetId,
    customStart?: Date,
    customEnd?: Date
): PeriodRange {
    const now = new Date();
    // Non-custom presets produce nominal ranges that can extend past today
    // (e.g. "This month" runs to the 1st of next month). Clamp the end to
    // end-of-today so charts don't draw flat lines into the future and
    // queries don't generate empty future buckets. Only "custom" keeps the
    // user's chosen end — they opted in to a future range explicitly.
    const clampEnd = (end: Date): Date => {
        const todayEnd = endOfDay(now);
        return end.getTime() > todayEnd.getTime() ? todayEnd : end;
    };
    if (preset === "this-month") {
        const start = startOfMonth(now);
        return { preset, start, end: clampEnd(addMonths(start, 1)) };
    }
    if (preset === "last-30-days") {
        // Rolling 30-day window ending today (inclusive of today's
        // partial day). Matches the DateRangePicker's "Last 30 days"
        // convenience preset so the picker highlights it when open.
        return {
            preset,
            start: startOfDay(addDays(now, -29)),
            end: clampEnd(endOfDay(now)),
        };
    }
    if (preset === "last-month") {
        const end = startOfMonth(now);
        return { preset, start: addMonths(end, -1), end: clampEnd(end) };
    }
    if (preset === "last-3-months") {
        const end = addMonths(startOfMonth(now), 1);
        return { preset, start: addMonths(end, -3), end: clampEnd(end) };
    }
    if (preset === "last-6-months") {
        const end = addMonths(startOfMonth(now), 1);
        return { preset, start: addMonths(end, -6), end: clampEnd(end) };
    }
    if (preset === "last-12-months") {
        const end = addMonths(startOfMonth(now), 1);
        return { preset, start: addMonths(end, -12), end: clampEnd(end) };
    }
    if (preset === "this-year") {
        return { preset, start: startOfYear(now), end: clampEnd(endOfYear(now)) };
    }
    if (preset === "all-time") {
        return {
            preset,
            start: new Date("1970-01-01"),
            end: clampEnd(new Date("9999-12-31")),
        };
    }
    // custom
    const start = customStart ?? startOfMonth(now);
    const end = customEnd ?? addMonths(start, 1);
    return { preset, start, end };
}

export const PERIOD_LABELS: Record<PeriodPresetId, string> = {
    "this-month": "This month",
    "last-30-days": "Last 30 days",
    "last-month": "Last month",
    "last-3-months": "Last 3 months",
    "last-6-months": "Last 6 months",
    "last-12-months": "Last 12 months",
    "this-year": "This year",
    "all-time": "All time",
    custom: "Custom",
};
