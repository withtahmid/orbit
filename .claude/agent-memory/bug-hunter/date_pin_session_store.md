---
name: date-pin-session-store
description: useDatePin is now localStorage + a sliding 3h idle window refreshed by touchDatePin() in mutation onSuccess; defaultEntryDateTime projects (time-of-day when kept + elapsed) clamped at 23:59:59 and emits a SECONDS-bearing datetime-local string.
metadata:
  type: project
---

`apps/web/src/features/transactions/useDatePin.ts` keeps one calendar day
(`YYYY-MM-DD`, APP_TZ) for transaction entry. Rewritten 2026-08-21 — the older
"sessionStorage + fixed 12h TTL + raw wall clock" description is obsolete.

Current shape:
- `localStorage` key `orbit:date-pin`, record `{ day, pinnedAt, touchedAt }`.
- **Sliding 3h idle window** (`IDLE_MS = 3h`) measured from `touchedAt`; `touchDatePin()` is
  called from the `onSuccess` of all four `NewTransactionSheet` mutations
  (income/expense/transfer/adjust). It reads-then-writes, so a pin the user
  cleared mid-flight cannot be resurrected. `EditTransactionSheet` does not
  touch it.
- `defaultEntryDateTime()` returns `${day}T${HH}:${mm}:${ss}` — **with
  seconds** — where the time is (APP_TZ time-of-day at `pinnedAt`) + (real
  seconds elapsed), clamped at 23:59:59. `fromInputDateTime` already accepts
  optional seconds; `toInputDateTime` does not emit them, so any edit through
  `TransactionDatePicker` silently drops the seconds back to `:00`.

Verified-correct, do not re-litigate:
- Timezone clean throughout (`toInputDateTime` / `fromInputDate` / `toInputDate`,
  no native getters). Seconds are offset-invariant so `now.getSeconds()` in the
  no-pin path is fine.
- `isRealDay` round-trips `fromInputDate`→`toInputDate`, so `2026-13-45` and
  `2025-02-29` are rejected rather than overflowing.
- `readDatePin` is the `useSyncExternalStore` snapshot and calls `purge()`
  without `emit()` — deliberate, returns a primitive, no render loop.

Known soft edges:
- Expiry emits nothing, so a screen left idle keeps showing "Keeping" until
  something else re-renders.
- Once the projection clamps at 23:59:59 every remaining entry in the sitting
  gets an identical stamp, and `transaction_datetime` ties are broken by a
  random uuid — the ordering guarantee the seconds exist for disappears.
- Keeping *today* and then moving the form's date elsewhere leaves no visible
  way to stop: the banner hides (kept day == today) and the `PinControl` reads
  "Keep" for the other day.
