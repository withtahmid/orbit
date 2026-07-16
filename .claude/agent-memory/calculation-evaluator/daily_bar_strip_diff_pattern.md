---
name: daily-bar-strip-diff-pattern
description: The three "daily-spend bar strip" charts derive per-day amounts by diffing a cumulative array; guards provably inert. Round 5 removed the ~28% cap — bars now share the cumulative sy()/max scale. Clean.
metadata:
  type: project
---

Three near-identical daily-volume bar strips recover per-bucket amounts from a
cumulative series via `dailyCur[i] = Math.max(0, cur[i] - cur[i-1])`:
- `components/budget-gauge/EnvelopeSpendChart.tsx`
- `pages/space/analytics/views/TrendsView.tsx` (`CumulativeRaceChart`)
- (event version `pages/space/events/eventCharts.tsx` gets real per-day data, no diff)

**Why the diff is exact / the guards never bind:**
- Both `cur` arrays are cumulated from `analytics.trends.dailyComparison.current`.
  That proc SUMs only `type='expense'`/`type='transfer'` `t.amount`, and both are
  validated `z.number().positive()` (transaction/expense.mts, transfer.mts). So
  each daily bucket >= 0 ⇒ `cur` is monotonic non-decreasing ⇒ `cur[i]-cur[i-1]`
  is already >= 0. The `Math.max(0, …)` floor is defensive, never fires, so no
  refund/negative-day under-count is possible in this data model.
- ROUND 5 SCALING REFACTOR (verified clean): the separate ~28%-capped scale
  (`barVolMax = maxDailyCur*3.6`, `barY`) was DELETED. All three now scale bars
  with the SAME cumulative-line function. Hand-rolled charts (Envelope, Trends):
  bar top = `sy(v)`, baseline = `sy(0)`; `sy(v)=h-p-(v/max)*(h-p*2)`,
  `max=(rawMax>0?rawMax:1)*1.1` (>=1.1, never 0, so `sy(0)=h-p` exactly, no 0/0).
  These two charts had NO bar strip at merge-base b6158ca9 — the strip is NEW on
  this branch, born using `sy()` (never had a `barY`). Event chart: `<Bar>` moved
  from a hidden `yAxisId="vol"` (own domain) to the shared `yAxisId="cum"`.
- No-overflow proof (hand-rolled): rendered bars are `dailyCur.slice(0,today)`,
  and `rawMax` includes `cur[today-1]`. Since `cur` is monotone non-decreasing,
  every `dailyCur[i] <= cur[today-1] <= rawMax < max`, so `sy(dailyCur[i]) >= p`
  — bars can never cross the plot top. Load-bearing ONLY if `cur` becomes
  non-monotonic (refunds); today the diff is already >= 0.
- Event chart stacked `<Bar>` (expense+income, stackId="vol") on shared cum axis
  does NOT clip: Recharts 3.x auto-domain includes stacked-bar tops, so the axis
  expands to fit a lone huge day (worst case: cumulative line compresses that
  day — honest, not a bug). `cumExpense`/`cumIncome` accumulate their own series
  only; per-day `expense`/`income` fields are raw from `byDay`, untouched by the
  refactor.
- `Math.max(0, ...dailyCur.slice(0, today))` is safe at `today===0` (spread of []
  leaves the seed 0, no NaN); bars also render off `slice(0, today)`, so future
  cumulative values can't inflate scale.
- Tooltip "This (so far)" and "Daily spend" rows share identical gating
  `hoverIdx < today ? … : null` in both components — can never disagree.

**How to apply:** If a future writer adds refunds as negative-amount expense
rows, or feeds these charts a non-monotonic series, the `Math.max(0)` floor
becomes load-bearing and would silently under-count. Re-audit then.

**Copy-paste drift (latent only):** EnvelopeSpendChart guards
`denom = Math.max(1, daysInMonth-1)`; CumulativeRaceChart uses raw
`daysInMonth-1` for both `sx` and `daySpacing`. Divide-by-zero only if
daysInMonth===1, impossible for week(7)/month(28+)/quarter/year(365).
