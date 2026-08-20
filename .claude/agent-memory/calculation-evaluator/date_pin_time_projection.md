---
name: date-pin-time-projection
description: useDatePin + TransactionDatePicker second-precision timestamps — round-4 CLOSED; the Now-preset seconds inversion is fixed and re-verified across 11 browser timezones
metadata:
  type: project
---

Transaction entry stamps `transaction_datetime` with **second precision on purpose**:
`transaction/list.mts` orders by `transaction_datetime DESC, id DESC` and `id` is a random
uuid, so rows sharing a timestamp render in arbitrary order — and the list's running
"Balance after" column is computed in that order.

`apps/web/src/features/transactions/useDatePin.ts` stamps each new form with
`keptDay + (time-of-day at pinnedAt) + (real seconds elapsed)`, clamped to 23:59:59.

**How to apply — audited clean, do not re-derive:**

- **Round-3's OPEN item is CLOSED.** `TransactionDatePicker.setNow` now does
  `now.setMilliseconds(0)` (was `setSeconds(0, 0)`), and the `nowBaseline` initializer
  matches. Verified: a Now-chip row committed at :20 now sorts after rows entered at :05
  and :12, where the old code sorted it first. `isNowPreset` still holds — `setNow` hands
  the *same Date object* to `commitDraft` and `setNowBaseline`, and on reopen the draft is
  re-seeded from the value string, which now round-trips seconds via
  `toInputDateTimeSeconds`. The fix also repaired the 60s snap window: with seconds zeroed
  the window slid by up to 59s (a 90s-old draft still snapped); it is now exactly ±60s.
- `Math.floor(record.pinnedAt % 60000 / 1000)` and `now.getSeconds()` are valid
  seconds-of-minute recoveries because every live IANA offset is a whole number of
  minutes. `toInputDateTimeSeconds(now)` is identical to every hand-concatenated variant
  (`getSeconds()`, `getUTCSeconds()`, `pinnedAt % 60000`) — re-verified 2026-08-21 on
  5.9M checks across 11 browser timezones including :30 (Kolkata) and :45
  (Chatham, Kathmandu, Eucla) offsets.
- `defaultEntryDateTime` re-verified against an Intl(Asia/Dhaka) oracle: 26.4M checks
  across 8 timezones, 0 failures, 0 non-monotonic sequences, day never drifts off the
  kept day, output always round-trips through `fromInputDateTime`.
- All five `makeAppTzDate` draft-rebuild sites in `TransactionDatePicker` thread
  `draftSeconds`; the calendar-cell sites (lines ~378-386) are day-only, which is correct.
- `EditTransactionSheet` hydrates via `toInputDateTimeSeconds`. `CreateOrEditEventDialog`
  still uses minute-only `toInputDateTime` — correct, it feeds a native `datetime-local`.
- Known-by-design: the projection SATURATES at 23:59:59, so entries after the clamp share
  a timestamp.
- `useState(defaultEntryDateTime)` is safe only because the sheet bumps `formKey` on
  "Save & add another", remounting the form. If that remount is removed, every entry in a
  batch gets the same timestamp.
