---
name: previous-array-can-be-empty
description: trendsDailyComparison's `previous` is now sized by previousLength, which is 0 whenever the filtered scope's first spend falls in the viewed period — consumers that only null-check (not length-check) draw phantom "Last period" marks.
metadata:
  type: project
---

`apps/server/src/procedures/analytics/trendsDailyComparison.mts` sizes `previous`
by the PRIOR period's own bucket count (`previousLength`) instead of
`periodLength`. `previousLength === 0` whenever
`history_start === cur_start`, i.e. `data_start.earliest` (filtered by
`envelopeIds` / `categoryIds` / `accountIds` and restricted to spend-producing
rows) lands in the viewed period. Verified on the dev Neon DB: envelope
`Buffer` (family space) has its first expense in 2026-06, so viewing June
returns `prev_bucket_count = 0`, `period_length = 30`.

Before this change every client's `prv` array was at least `periodLength` long
(zero-filled), so `prv.length === 0` was unreachable. It is now reachable, and
consumers that guard on `prv !== null` rather than `prv.length > 0` misdraw:

- `CumulativeRaceChart` (TrendsView.tsx) — guards on `prv` truthiness only.
  `[]` is truthy: endpoint dot at `sy(0)`, hover dot pinned at
  `(sxPrev(0), sy(0))` = bottom-left, tooltip row prints `0` instead of `—`.
  `TrendsView` passes `hasPrevious ? cumulative.prv : null` so it is safe;
  **`OverviewPage`'s SpendingTrends passes `prv={cumulative.prv}` unconditionally
  and is NOT safe.**
- `EnvelopeSpendChart` (budget-gauge) — has **no `prv: null` mode at all**
  (`prv: number[]`). `prvDenom = max(1, prv.length - 1) = 1` and
  `prvIdxAt() = max(0, min(-1, …)) = 0`, so the "Last" dot pins to the
  bottom-left corner and the tooltip reads `Last 0`. `BudgetDetailPage`'s
  `spendLegend` also pushes "Last period" unconditionally (the `avg` legend row
  IS guarded on `avg[len-1] > 0`; `prv` is not).
- `BudgetsPage`'s `paceData.prv` / `.avg` are computed but never consumed —
  inert.

**How to apply:** any new consumer of `dailyComparison.previous` must treat
`length === 0` as "no prior period on record" and pass `null` / hide the series,
not just `?? []`. Same rule for `average`, which the server now gates at
`averagePeriods >= 2` (so `average === null` with real history is normal).
See [[trends-period-stepper-traps]].
