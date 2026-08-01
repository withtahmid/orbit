---
name: velocity-prev-length-divisor
description: Prior-period per-day rates must divide by PREV_LENGTH (previousLength), never by the current period's `today` — BudgetDetailPage velocity still gets this wrong
metadata:
  type: project
---

`trends.dailyComparison` returns `previousLength` = the prior period's OWN bucket
count and `previousTotal` = its true total (the series is a dense
`generate_series`, and `history_start` is period-truncated, so `previousLength`
is the real day count, not "days with spend").

Rule: a "last period, per day" rate is `previousTotal / previousLength` (closed)
or `prev[min(today,previousLength)-1] / min(today,previousLength)` (live).
Dividing by the CURRENT period's `today` is wrong whenever `today >
previousLength` — i.e. every closed March/May/July/October/December (prev month
is shorter), plus the last days of a live month.

- `TrendsView.tsx` `prevDailyAvg` does this correctly.
- `BudgetDetailPage.tsx` `velocity` (`perDayLastMonth = prvAtToday / today /
  bucketDays`) does NOT — its loop runs to `max(periodLength, prv.length)` so
  `prvAtToday` saturates at the full prior total while the divisor stays `today`.

**Why:** the two pages claim in comments to share "the same math"; they diverged
when TrendsView was fixed.
**How to apply:** whenever either Velocity card is touched, check both, and note
that `bucketDays` is currently 1 for every granularity, so `/ bucketDays` never
masks the error.
