---
name: trends-velocity-typical-window
description: VelocityBars' "Typical" row is a FULL-period daily rate sitting beside two ELAPSED-window rates, so eyeballing the bars contradicts the "Vs typical" KPI tile — 81 sign inversions and gaps to 70pp on real seed data.
metadata:
  type: project
---

`VelocityBars` in `TrendsView.tsx` draws three rows on one shared scale and the
reader is meant to compare their lengths. Two of the three are **elapsed-window**
rates; the third is not:

- `curDailyAvg   = monthSoFar / (TODAY × BUCKET_DAYS)`            ← elapsed
- `prevDailyAvg  = lastMonthSoFar / (min(TODAY, PREV_LENGTH) × BUCKET_DAYS)` ← elapsed
- `typicalDailyAvg = typicalFull / (DAYS_IN_MONTH × BUCKET_DAYS)` ← **whole period**

All three are genuinely "spend per day" (dividing `Σaverage` by the current
period's length exactly cancels the length-normalisation artefact recorded in
[[trends-period-array-length-invariant]] trap 1 — flat 100/day pools give exactly
100 on both bases). The defect is the **window**, not the unit.

`paceVsTypical` (the "Vs typical" KPI tile, one card above) uses
`monthSoFar / typicalSoFar`, i.e. the elapsed basis. So the bars and the tile
answer the same question differently. Measured on the local seed:

- Jun 2026 live d20: bars imply **+41.5%**, tile says **+21.6%**
- Feb 2026 live d15: bars imply **+37.4%**, tile says **+9.5%**
- **81 sign inversions** at day ≥ 10 across the seed's live-day grid, e.g.
  Jul 2025 d10: bars **+48.5%** vs tile **−1.2%** — opposite directions.
- Worst day ≥ 10 gap: Jul 2026 d10, **70.6pp**.

Cause: real spending is front-loaded (rent on day 1), which is exactly the rhythm
the `average` series exists to capture, so `typicalSoFar/TODAY` is systematically
higher than `typicalFull/L` early in a period.

**STATUS: FIXED in round 6 and re-verified.** The code is now
`typicalDailyAvg = typicalSeries && TODAY > 0 ? typicalSoFar / (TODAY * BUCKET_DAYS) : 0`.
The agreement is an *identity*, not a coincidence: the bars imply
`curDailyAvg/typicalDailyAvg − 1 = (monthSoFar/(TODAY·B))/(typicalSoFar/(TODAY·B)) − 1
= monthSoFar/typicalSoFar − 1 = paceVsTypical`, for every TODAY>0 and every B.
Re-measured on the seed by replaying the daily-comparison SQL with a pinned clock
(cash mode, as originally measured): Jun 2026 d20 → typical rate **421.23**, bars
**+21.55%** = KPI **+21.55%** (old formula 361.92 → +41.47%); Feb 2026 d15 →
**468.72**, bars **+9.53%** = KPI **+9.53%** (old 373.63 → +37.41%). Closed periods
are **bit-identical** old-vs-new because `todayBucket` saturates at `periodLength`
and the client truncates `average` to `periodLength`, so `typicalSoFar === typicalFull`
(Feb closed 315.178409… both ways, Jun closed 309.410005… both ways).

**Original fix note:** `typicalSeries ? typicalSoFar / (TODAY × BUCKET_DAYS) : null`.
On live periods it reproduces the KPI tile to the last decimal (Jun d20 → 421.23,
512.00/421.23 − 1 = +21.55% = tile; Feb d15 → 468.72 → +9.53% = tile). On closed
periods `TODAY === periodLength` so the two bases coincide and nothing changes
(Feb closed 373.63 both ways, Jun closed 361.92 both ways).

Secondary effect: the mis-framed value also feeds the shared `max`, so it can
steal the 100%-width slot. Prod clone, Aug 2026 d1: bars 0 / 2080 / **2194**
where the like-for-like typical day-1 rate is **1378** — the Typical bar is the
longest bar and 59% too long.

**Not a rank hazard:** `max = Math.max(1, …)` and `minWidth: 3px` are both
monotone, so no smaller value ever draws a longer bar. With all three rates below
1 unit/day no bar reaches 100%, which is cosmetic only.

**Chip vs bar labels:** `burnDelta` is exact but the bar labels are
`maximumFractionDigits: 0`, so they can collide. Real instance: local seed, Apr
2026 live d15 — both bars display **406** (406.27 vs 405.60) while the chip reads
**+0.2%**. Bounded by ≈0.5/rate; harmless at Orbit's magnitudes. The chip has no
×N fallback like `moverChangeLabel`, so it can print "+7162.6%" (prod clone, May
2026 d20, prior period is the partial first month at 25.25/day).

See [[trends-rate-vs-total-identity]].
