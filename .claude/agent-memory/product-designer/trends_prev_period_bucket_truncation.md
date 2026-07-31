---
name: trends-prev-period-bucket-truncation
description: RESOLVED — trendsDailyComparison now returns previousLength/previousTotal over the prior period's own buckets; but the fix created a new closed-period defect where Velocity's "Change vs {prev}" is a totals ratio labelled as a daily-burn ratio.
metadata:
  type: project
---

**Resolved 2026-08-01** on `fix/analytics/trends`. `trendsDailyComparison.mts`
(+ personal twin) now return `previousLength` (max `idx` among `kind='prev'`
rows, i.e. the prior period's own bucket count) and `previousTotal` (summed over
those rows only). `average` stays sized to the CURRENT period *deliberately* —
so `sum(average)` means "a typical period of *this* length" and a 28-day
February isn't judged against a 31-day yardstick. The chart's dashed curve got
its own x-scale (`sxPrev`), so the two curves race on fraction-of-period-elapsed.

**The fix introduced a downstream defect — look for this shape whenever a
period-relative percentage is reused across a live/closed branch.**
`prevBaseline = isLive ? lastMonthSoFar : lastMonthFull` makes `paceDelta` a
*totals* ratio on a closed period. In live mode a totals ratio and a daily-rate
ratio are identical (both sides divide by the same `TODAY`); on a closed period
they diverge by the two periods' length ratio. The Velocity card prints
`paceDelta` under `Change vs June` / sub `% change vs June's daily burn`
immediately beneath two per-day rows each computed over its own period's length
— so July 1,700/day vs June 1,650/day (+3%) gets captioned "+6.5%".

Rule: the Velocity card is the *rates* card; every row in it must be derived
from the rates above it, and the totals-vs-totals percentage belongs only in the
KPI strip.

Related: [[trends_view_period_history_shipped]],
[[trends_typical_excludes_prior_period]].
