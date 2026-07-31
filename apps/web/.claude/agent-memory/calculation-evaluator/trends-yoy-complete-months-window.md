---
name: trends-yoy-complete-months-window
description: trendsYearOverYear only nulls months AFTER the current one, so deriving the "complete months" window from findIndex(null) silently includes the in-progress month every December.
metadata:
  type: project
---

`procedures/analytics/trendsYearOverYear.mts` fills `thisYear[m] = null` for
`m = curMonth .. 11` where `curMonth = EXTRACT(MONTH)` (**1-based**). So the current,
in-progress month at index `curMonth − 1` is **not** null — it carries partial data — and
in **December there are no nulls at all**.

Consequence for any client deriving the comparison window from the null sentinel
(`findIndex(v == null)`): `−1` is ambiguous between "past year, 12 complete months" and
"current year, December in progress". Measured with flat 3000/month both years:

- 1 Aug 2026 → window 7 (Jan–Jul) → **0.0%** ✓
- 1 Jan 2026 → window 0 → `null` → em-dash ✓
- 15 Dec 2026 → window **12**, labelled "(Jan–Dec)" → **−4.3%** ✗ (should be 0.0%)
- past year → 12 v 12 → 0.0% ✓

**Why:** the null array is a *drawing* hint (where to clip the line), not a
completeness hint; only the clock knows how many months have closed.

**STATUS: fixed and re-verified.** `yoyWindowMonths = yoyIsCurrentYear ? getAppTzMonth(now) : 12`
is in place, `yoyHeaviestGrowth` scans the same `i < yoyWindowMonths` bound, `yoyTotalDelta` is
nullable behind `yoyWindowMonths > 0 && yoyLastTotal > 0`, and the label is gated on
`yoyMonths.length === 12` with a "(no complete months yet)" January branch. Re-checked Jan →
window 0 / em-dash, Aug → 7 (Jan–Jul), Dec → 11 (Jan–Nov), past year → 12. The window can never
include a month the server nulled (nulls start at index `curMonth`, window ends at `curMonth − 1`),
and heaviest-growth can never name a month absent from the total beside it.

**How to apply:** derive the window from the clock, matching the `yoyFutureFromIdx`
idiom already in `TrendsView.tsx`:
`const yoyWindowMonths = yoyIsCurrentYear ? getAppTzMonth(now) : 12;`
(0-based month = count of complete months: Aug→7, Dec→11, Jan→0.) This also removes the
`yoyData === null` loading artefact where `window = 12` renders "(Jan–)" from an empty
`months` array. Keep every YoY footer stat on the same window — `yoyHeaviestGrowth`
scanning `i < 12` while the total scans `i < window` is the same bug one metric over.

See [[trends-period-array-length-invariant]].
