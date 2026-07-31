---
name: velocity-card-rates-card-rule
description: The Velocity card is the RATES card — every row and its delta chip must be measured over the same window; two instances of this rule being broken (the closed-period totals ratio, and the full-period Typical row against elapsed-window peers).
metadata:
  type: project
---

**Rule: the Velocity card is the *rates* card.** Every row in it must be a
per-day rate measured over the **same window** as the rows beside it, and the
delta chip must be the ratio of two of those rows. A totals-vs-totals
percentage belongs only in the KPI strip.

Broken twice so far, both found in review, both invisible until the numbers
were placed side by side:

1. **Closed-period totals ratio** (round 3, fixed). `prevBaseline = isLive ?
   lastMonthSoFar : lastMonthFull` made the chip a totals ratio; on a closed
   period a totals ratio and a rate ratio diverge by the two periods' length
   ratio. Fixed by introducing `burnDelta` (curDailyAvg / prevDailyAvg).
2. **Full-period `Typical` row against elapsed-window peers** (round 5).
   `typicalDailyAvg = typicalFull / periodLength` is a *whole-period* rate,
   while `This`/`Last` are elapsed-window rates (`… / TODAY`). Under normal
   front-loaded spending (rent on day 1) the two elapsed rows are inflated and
   the Typical row is not, so the card reads "3× your typical rate" in the
   first week of **every** month — while the "Vs typical" KPI, which correctly
   compares same-position cumulatives, reads ~0%. Same page, opposite verdicts.
   Fix: `typicalSoFar / (TODAY * BUCKET_DAYS)`; identical to the old
   expression on a closed period, since the server pins `today = periodLength`
   there.

**Why the rule got sharper in round 5:** the card was rebuilt as three bars on
one *shared scale*. Three separately-boxed numbers let a window mismatch hide;
three bars on one axis publish it as a length ratio. Any redesign that puts
numbers on a shared scale must re-check that they are the same *kind* of
number, not merely the same unit.

**Note the near-duplicate that is acceptable:** on a live period with
`PREV_LENGTH >= TODAY`, `burnDelta` and the KPI strip's `paceDelta` are
arithmetically identical, so the page prints one percentage twice under two
captions. They diverge exactly when it matters (closed periods, unequal
lengths). The residual fix is the KPI's *sub*, which describes a totals number
in rate language ("ahead — spending faster"), not the chip.

`BudgetDetailPage`'s `velocity` memo — the visual this card copied — still has
**both** original defects (`perDayLastMonth` divides the prior total by `today`
rather than by the prior period's own length; `acceleration` is a totals
ratio). Parity debt, pre-existing.

Related: [[trends_prev_period_bucket_truncation]],
[[trends_view_period_history_shipped]].
