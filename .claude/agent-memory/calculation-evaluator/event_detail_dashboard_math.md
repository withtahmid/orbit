---
name: event-detail-dashboard-math
description: Event detail dashboard (feat/enevt/details) calc invariants — day-span partition, timeline conservation, pace formula, category-tree conservation
metadata:
  type: project
---

Event detail dashboard lives in `apps/web/src/pages/space/events/` (eventUtils.ts,
eventCharts.tsx, EventDetailPage.tsx) + server procs `analytics/eventDailySpend.mts`,
`eventTopLocations.mts`, `eventTotals.mts`. Audited on feat/enevt/details — all CLEAN.

Verified math contracts (re-check these if the files change):

- **Day-span partition**: `elapsedDays` is INCLUSIVE (start..today counts today),
  `daysLeft` (HeroBand) is EXCLUSIVE of today (`round(end-now)`). They partition
  cleanly: elapsed + daysLeft == totalDays on every in-window day. Not a bug — by design.
- **Timeline conservation**: final `cumExpense` == Σ all eventDailySpend expense rows.
  The widen-to-transaction-dates + fold-to-edge + 2000-day `enumerateDays` cap all fold
  stray rows onto `days[0]`/`days[last]` (both in the enumerated set), so nothing is
  dropped even when the EVENT window itself exceeds 2000 days.
- **Pace formula**: `frac = clamp((offset+1)/eventSpan, 0, 1)`, `pace = estimate*frac`.
  eventSpan spans the EVENT window (not widened render window). Day 1 → estimate/eventSpan
  (one day's share), event end day → exactly estimate, flat before start / after end.
- **buildCategoryTree conservation**: Σ roots.total == Σ breakdown rows (strict forest via
  single parent_id FK; orphan spend → synthetic root so nothing is dropped; root filter
  only removes total==0 subtrees). childSlices sum == parent.total whenever the node is
  drillable (synthetic "· direct" slice added iff direct>0 AND ≥1 positive child).
- **"Spent" consistency**: client uses `eventTotals.expenseTotal` (SUM CASE type='expense'
  by event_id); timeline sums `eventDailySpend` expense (same filter). Identical by
  construction. NOTE: the two procs' tx_count differ on purpose — eventTotals counts ALL
  types, eventDailySpend counts only expense+income.
- **Division safety**: RadialBudgetGauge pct guards estimate>0 (and only renders when
  estimatedAmount>0); WhereCard bar width guards maxLoc>0.
