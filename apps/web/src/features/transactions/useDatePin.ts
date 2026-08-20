import { useCallback, useSyncExternalStore } from "react";
import { fromInputDate, toInputDate, toInputDateTime, toInputDateTimeSeconds } from "@/lib/dates";

/**
 * The "keep this date" store for transaction entry.
 *
 * The friction this removes: entering a day's worth of transactions after
 * midnight (or two days late) means re-picking the same past date on every
 * single form. This keeps the *calendar day* so each new form — and each
 * "Save & add another" cycle — seeds itself with that day instead of today.
 *
 * Deliberately weaker than the server-side Account/Envelope/Event pins in
 * `usePins`, and deliberately not called a "pin" in the UI: those are
 * *defaults* ("which account do I usually pay from?"), two of them are
 * team-wide, and they are meant to outlive the session. A kept date is a
 * *mode* ("which day am I entering for right now?") that is wrong to carry
 * forward. Hence:
 *
 *   - Browser-local storage, never Postgres. No sync to another device, no
 *     visibility to other members of the space.
 *   - A **sliding 3h idle window**, refreshed by `touchDatePin()` on every
 *     successful save. A fixed TTL from the moment of keeping got the
 *     canonical case wrong: keep "yesterday" at 00:30, sleep, and a 12h timer
 *     is still live at 10:00 next morning — silently back-dating the day's
 *     first coffee. An idle window expires with the sitting, which is the
 *     thing actually being modelled.
 *   - Day only, never the time of day (see `defaultEntryDateTime`).
 *
 * `localStorage` rather than `sessionStorage`: tab-scoping sounds like the
 * right lever for "don't let it live too long", but the idle window already
 * enforces that, and session scope silently drops the kept day on a page
 * refresh, a PWA cold start, or an iOS tab eviction — mid-sitting, looking
 * identical to "nothing is kept", which is exactly when a wrong date gets
 * saved unnoticed.
 *
 * Global rather than per-space, on purpose: the sitting can span spaces.
 */

const STORAGE_KEY = "orbit:date-pin";
/**
 * Sliding idle window, refreshed on every save.
 *
 * 3h, not 6h: the canonical failure is keep "yesterday" at 00:30, stop at
 * 01:30, sleep, reopen at 07:00 — 5.5h idle, which a 6h window would wave
 * through and back-date the morning's first coffee by two days. A sitting is
 * minutes to an hour; 3h still survives "dinner, then back to it" and expires
 * across almost any sleep. Over-expiring costs two taps; under-expiring puts a
 * wrong date in the ledger.
 */
const IDLE_MS = 3 * 60 * 60 * 1000;
const SECONDS_IN_DAY = 24 * 60 * 60;

type StoredPin = {
    /** `YYYY-MM-DD` in APP_TZ. */
    day: string;
    /** When the day was first kept — the baseline for the time projection. */
    pinnedAt: number;
    /** Last activity. The idle window is measured from here. */
    touchedAt: number;
};

/** The `YYYY-MM-DD` half of a `datetime-local`-shaped form value. */
export function dayOfInputDateTime(value: string): string {
    return value.slice(0, 10);
}

/** Today's `YYYY-MM-DD` in APP_TZ. */
export function todayDayKey(): string {
    return toInputDateTime(new Date()).slice(0, 10);
}

const listeners = new Set<() => void>();

function emit() {
    for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

/**
 * Drop the stored record WITHOUT notifying subscribers. `readDatePin` runs as
 * a `useSyncExternalStore` snapshot — i.e. during render — so it must never
 * emit; doing so would schedule a state update from inside another component's
 * render pass. Discarding a stale record needs no notification anyway: the
 * same read already returns null to the caller that triggered it.
 */
function purge() {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* no-op */
    }
}

/**
 * A day string that is well-formed AND a real calendar date. The regex alone
 * would accept `2026-13-45`, which `Date.UTC` silently overflows to
 * 2027-02-14 — so a corrupt or hand-edited storage value would move every
 * subsequent entry to a date nobody chose. Round-tripping catches it.
 */
function isRealDay(day: unknown): day is string {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const parsed = fromInputDate(day);
    return parsed !== null && toInputDate(parsed) === day;
}

/** Read + validate the stored record, dropping it when stale or malformed. */
function readPinRecord(): StoredPin | null {
    if (typeof window === "undefined") return null;
    let raw: string | null = null;
    try {
        raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
        /* Private-mode / storage-disabled browsers — treat as "nothing kept". */
        return null;
    }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<StoredPin>;
        if (
            !isRealDay(parsed?.day) ||
            typeof parsed.pinnedAt !== "number" ||
            !Number.isFinite(parsed.pinnedAt) ||
            typeof parsed.touchedAt !== "number" ||
            !Number.isFinite(parsed.touchedAt)
        ) {
            purge();
            return null;
        }
        if (Date.now() - parsed.touchedAt > IDLE_MS) {
            purge();
            return null;
        }
        return { day: parsed.day, pinnedAt: parsed.pinnedAt, touchedAt: parsed.touchedAt };
    } catch {
        purge();
        return null;
    }
}

/**
 * The kept `YYYY-MM-DD`, or null. Safe to call during render — returns a
 * primitive, so it is a stable `useSyncExternalStore` snapshot.
 */
export function readDatePin(): string | null {
    return readPinRecord()?.day ?? null;
}

function persist(record: StoredPin) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
        /* Storage unavailable — the kept day just does not stick. The next
           read returns null, so the control falls back to "Keep" rather than
           claiming a state that is not there. */
    }
}

export function writeDatePin(day: string) {
    /* Guard by construction: an unparseable day would persist, emit, then be
       purged by `isRealDay` on the very next read — leaving the chip on "Keep"
       so the button looks broken rather than reporting anything. */
    if (!isRealDay(day)) return;
    const now = Date.now();
    persist({ day, pinnedAt: now, touchedAt: now });
    emit();
}

/**
 * Slide the idle window forward. Call after a successful save: it is the only
 * evidence that the sitting is still going. Deliberately does NOT emit — the
 * snapshot value (the day) is unchanged, so there is nothing to re-render.
 */
export function touchDatePin() {
    const record = readPinRecord();
    if (!record) return;
    persist({ ...record, touchedAt: Date.now() });
}

export function clearDatePin() {
    purge();
    emit();
}

/**
 * The value a freshly-mounted transaction form should start with: the kept day
 * at a monotonically increasing time of day, or plain "now" when nothing is
 * kept. Returns a `datetime-local`-shaped APP_TZ wall-clock string, with
 * seconds appended.
 *
 * The time is (time of day when the day was kept) + (real seconds elapsed
 * since), clamped at 23:59:59 — NOT the raw wall clock. Those are the same
 * number right up until the clock crosses midnight, and that is the whole
 * point: with a frozen day and a live clock, an entry typed at 00:10 would be
 * stamped ~23h *before* one typed at 23:50 on the same kept day, walking the
 * batch backwards through the ledger and scrambling the running-balance
 * column. Clamping instead of wrapping keeps the batch ordered.
 *
 * Seconds are carried (rather than zeroed) so a rapid batch gets distinct
 * timestamps: `transaction_datetime` ties are broken by a random uuid, so
 * identical stamps render a batch in arbitrary order.
 *
 * Known limit: past the clamp every row stamps `23:59:59`, so the uuid
 * tie-break returns for the tail of a sitting that keeps *today* and runs
 * through midnight. Accepted rather than fixed — wrapping would invert the
 * order outright, and a per-entry counter would mean writing to storage from
 * a render-phase read.
 */
export function defaultEntryDateTime(): string {
    const now = new Date();
    const record = readPinRecord();
    if (!record) return toInputDateTimeSeconds(now);

    const basis = toInputDateTime(new Date(record.pinnedAt));
    const basisSeconds =
        Number(basis.slice(11, 13)) * 3600 +
        Number(basis.slice(14, 16)) * 60 +
        Math.floor((record.pinnedAt % 60000) / 1000);
    const elapsed = Math.max(0, Math.floor((Date.now() - record.pinnedAt) / 1000));
    const total = Math.min(basisSeconds + elapsed, SECONDS_IN_DAY - 1);

    return `${record.day}T${pad2(Math.floor(total / 3600))}:${pad2(
        Math.floor((total % 3600) / 60)
    )}:${pad2(total % 60)}`;
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/**
 * `useSyncExternalStore` rather than local state so every mounted form (and
 * the control inside it) reflects a change immediately — including across the
 * tab switch between Income / Expense / Transfer / Adjustment.
 */
export function useDatePin() {
    const keptDay = useSyncExternalStore(subscribe, readDatePin, () => null);

    const keepDay = useCallback((day: string) => writeDatePin(day), []);
    const stopKeeping = useCallback(() => clearDatePin(), []);

    return { keptDay, keepDay, stopKeeping };
}
