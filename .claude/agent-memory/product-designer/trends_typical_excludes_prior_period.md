---
name: trends-typical-excludes-prior-period
description: The Trends "Typical" curve excludes the immediately-prior period AND counts the user's first partial period as a whole one; the 2026-08-01 sample-count disclosure made that second distortion falsifiable rather than merely vague.
metadata:
  type: project
---

Two structural facts about the `average` series in
`apps/server/src/procedures/analytics/trendsDailyComparison.mts` (+ personal
twin), both still true after the 2026-08-01 round-1 fixes:

1. **The prior period is excluded.** `classified` assigns `kind='prev'` to
   buckets `>= prev_start` and `kind='avg'` only to buckets earlier than that.
   So "typical month" while viewing July means Feb–May, not Mar–Jun.
2. **The first, partial period counts as a whole one.** `all_buckets` is a
   `generate_series` from `date_trunc(granularity, MIN(txn))`, so a space whose
   first transaction is Mar 25 contributes a "March" with 24 zero buckets, and
   `avg_periods` (`COUNT(DISTINCT date_trunc(granularity, bucket_ts))` below
   `prev_start`) *counts* it.

**Sample size is now disclosed, and the curve is gated at `AVG_PERIODS >= 2`**
— the curve, the "Vs typical" KPI and the Velocity typical row appear and vanish
together. The gate is the right call; a one-sample norm is worse than no norm.
But disclosure made (2) *worse*: "avg of 4 earlier months" is a countable claim
the user can falsify against their own start date, where vague copy could not be.
Minimal fix: an `avg_start` CTE = `date_trunc(g, MIN(txn))` bumped one period
when `MIN(txn)` isn't exactly the period start, bounding both `kind='avg'` and
`avg_periods`. `nav_start` must NOT be bumped — history genuinely does start in
March, and the `beforeHistory` copy speaks about history, not about the average.

**The count is still not one string.** Three phrasings survive, agreeing on the
number but not on the boundary: endpoint label `Typical month · avg of 4 earlier
months`, Velocity sub `Avg across 4 earlier months`, chart sub-copy `averaged
across the 4 months before June`. Only the third states the exclusion; the first
two read as "the 4 months immediately before July". A fourth vocabulary ("your
usual month") lives in the Vs-typical KPI sub — should be "typical" everywhere.

Design view: a *count* in a KPI-strip label is analyst-speak, and it makes the
label unstable (it decrements on every ◀ press). Disclose once, in the chart
sub-copy; label the stat plainly "Typical month" with the definition in `title`.
Also: `AVG_PERIODS` derives from the *filtered* `data_start`, so applying a
category filter can silently drop the page from 5 KPIs to 4.

Related: [[trends_view_period_history_shipped]],
[[trends_prev_period_bucket_truncation]].
