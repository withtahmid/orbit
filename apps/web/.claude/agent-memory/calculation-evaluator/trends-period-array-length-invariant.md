---
name: trends-period-array-length-invariant
description: trendsDailyComparison's prior-period arrays — the length-asymmetry bug, how it was fixed (previousLength/previousTotal), and the residual length-normalisation traps that survive the fix.
metadata:
  type: project
---

`procedures/analytics/trendsDailyComparison.mts` (+ `personal/` twin) returns `current`,
`previous`, `average` as parallel bucket arrays. **`previous` is sized to its own bucket
count (`previousLength`) and totalled independently (`previousTotal`); `average` is
deliberately sized to the CURRENT period's length.** `current` and `average` share one
x-scale; `previous` gets its own (`sxPrev`, normalised to fraction-of-period-elapsed).

**Verified invariants** (measured in PG, `git log` for the fixing commit):

- `previousLength` is **0 or the full prior-period bucket count, never partial** — because
  `data_start.earliest = date_trunc(g, MIN(txn))` lands on a period start, so
  `history_start` is either `prev_start` or `cur_start`. Confirmed: Nov view with data
  starting Oct 1 → `prev_min_idx = 1`, `previous_length = 31`.
- Prior period can be LONGER: Feb view → 28/31; Q1 view → 90/92 (Q1 90, Q2 91, Q3 92,
  Q4 92). Longer-prev months: Feb, Apr, Jun, Sep, Nov.
- `sum(previous[]) === previousTotal` **bit-for-bit** — server sums `prev` rows in
  `ORDER BY kind, idx` (kind sorts 'avg'<'cur'<'prev', so prev rows are last+contiguous in
  idx order) and the client cumulates 0..n-1. Same sequence, same doubles, no tRPC
  transformer. So a chart endpoint drawn from the cumulated array equals the printed
  `previousTotal` exactly.
- `avg_periods = COUNT(DISTINCT date_trunc(g, bucket_ts))` over
  `[avg_pool_start, prev_start)` counts exactly the **complete** periods in the pool, and
  excludes both the current and the previous period. Complete-ness is structural, not
  incidental: `all_buckets` is a dense `generate_series` and both bounds are period starts
  (`date_trunc`'d or `+ periodInterval`), so the window is always a whole number of fully
  covered periods, at every granularity.

**Residual traps that survive the length fix:**

1. **`Σ average[i]` is length-normalised, not a mean period total.** `average[i]` is an AVG
   over only those pool periods that *have* a bucket at `i`, and the array stops at
   `periodLength`. Measured: 4 prior months at flat 100/day → Feb view `Σ = 2800` vs true
   mean-of-totals `3050` (−8.2%); 31-day view `Σ = 3100` (+1.6%). Correct as the
   like-for-like basis for a vs-typical *ratio*; wrong to print under "avg of N months".
2. ~~The partial first period pollutes the avg pool.~~ **FIXED and re-measured in PG.**
   `avg_pool_start = (earliest_bucket = earliest) ? earliest : earliest + periodInterval`,
   with a `'skip'` kind below it and `avg_periods` bounded in lockstep. Synthetic replay of
   the original measurement (first txn Mar 25, flat 100/day, live August day 15):
   before → `avg_periods 4`, `typicalSoFar 1125`, **+33.33% "above typical"**;
   after → `avg_periods 3` (Apr,May,Jun), `typicalSoFar 1500`, **0.00%**. `typicalFull` 3100
   = 31 × 100, correct.
   **Re-verified on the prod clone (round 5).** `pp's Family` (space `019da6f8…`), first
   expense 2026-04-20 22:30, so `earliest`=Apr 1 ≠ `earliest_bucket`=Apr 20 → pool starts
   May 1. `avg_periods`: Jul view 2→**1**, Aug 2026 3→**2**, Sep 2026 4→**3**. The `>= 2`
   gate then nulls `average` for the Jul view only, so the typical line disappears there —
   correct behaviour, not a regression. Excluding April is unambiguously right: April has
   spend on 9 of 30 days, all after the 20th. Including it would put the Aug day-15
   typical baseline at 19,257 instead of 28,886 — a completely normal spender would read
   **+50% above typical**. Full-month `typicalFull` would be 60,394 vs 68,017 (**−11.2%**).
   `earliest_bucket = earliest` is the exact "first row lands in the period's opening bucket"
   test **only because `bucketUnit` is `'day'` for all four granularities**. Change any
   `GRANULARITY_CONFIG.bucketUnit` and it silently breaks in both directions: `'week'` under
   month granularity never matches (so every first period is skipped), `'month'` under year
   granularity always matches (so a Jan-15 start counts January as whole).
3. ~~Never divide a prior-period figure by the current period's count.~~ **FIXED.**
   `prevDailyAvg` now divides by `max(1, min(TODAY, PREV_LENGTH))`, the same clamp
   `lastMonthSoFar`'s index uses, so numerator and denominator span one window. Verified:
   closed-Feb-vs-flat-Jan, closed-Feb-vs-lumpy-Jan and live-Mar-30-vs-Feb all close to
   exactly 0% with flat spending, and the Velocity card's three rows are arithmetically
   consistent.
4. **A total-ratio delta is not a rate-ratio delta.** Scope is WIDER than recorded below —
   see [[trends-rate-vs-total-identity]] for the exact identity and the measured
   closed-period gaps (Feb view is 12.91pp apart, and 10 of 12 months disagree, not just
   the month-end days). Fixed *inside* the Velocity card
   (`burnDelta` is rate-vs-rate) but **still live in the KPI strip**: the `Pace vs last {noun}`
   tile is `monthSoFar / prevBaseline − 1`, whose numerator spans `TODAY` buckets while
   `lastMonthSoFar`'s clamp gives the denominator `min(TODAY, PREV_LENGTH)`. Measured on real
   data, live March 2026 on the 30th (Mar 7,752 / Feb 10,319): tile reads **−24.9%** while
   Velocity's Acceleration reads **−29.9%** — two "March vs February" numbers on one screen,
   5 points apart. Only bites when `TODAY > PREV_LENGTH` (the same handful of month-end days
   as the movers overrun). Either use the rate for the live tile too, or clamp the numerator
   to `cumulative.cur[min(TODAY, PREV_LENGTH) − 1]`.

5. **`Σaverage` is a length-normalised typical period, not a mean of period totals** (trap 1),
   and `chartTypicalCopy` says "a typical {noun}, averaged across the N {noun}s before X".
   Real-data magnitude for a 31-day August over a 17-month pool: `typicalFull` 9,727.18 vs
   mean-of-monthly-totals 9,563.98 = **+1.7%**. Small and directionally correct as a ratio
   basis; the gap is negative and larger (~−8%) for a short-month view.

See [[trends-yoy-complete-months-window]], [[analytics-category-breakdown-invariants]],
[[event-date-math-day-convention]].
