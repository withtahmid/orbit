---
name: trends-rate-vs-total-identity
description: The exact algebraic identity linking the Trends KPI "Pace vs last period" tile (a totals ratio) to the Velocity chip (a rate ratio), why they disagree on 10 of 12 months, and why clamping the numerator does not fix it.
metadata:
  type: project
---

**STATUS: STILL OPEN as of round 6** — `paceDelta` (line ~463) and `burnDelta`
(line ~479) are unchanged. Recommended one-liner:
`const paceDelta = isLive ? burnDelta : (prevBaseline > 0 ? (monthSoFar / prevBaseline - 1) * 100 : null);`
That fixes the case where the tile's own label is a rate word ("Pace vs last month");
the closed-period tile reads "Vs Feb" and a totals comparison is the right fact there,
so the residual closed-period gap is a labelling question, not a wrong number.

`TrendsView.tsx`: `paceDelta` (KPI tile) and `burnDelta` (Velocity chip) are two
"this period vs last period" percentages rendered on the same screen. They are
linked by an **exact identity**, verified to 6 dp on six real seed periods:

```
(1 + burnDelta) = (1 + paceDelta) × (W_prev / W_cur)
```

where `W_cur` = buckets the numerator spans (`TODAY` live, `periodLength` closed)
and `W_prev` = buckets the denominator spans (`min(TODAY, PREV_LENGTH)` live,
`PREV_LENGTH` closed).

**They agree iff `W_prev === W_cur`.** For month granularity that is only
Jul→Aug and Dec→Jan — so the two numbers **disagree on 10 of 12 months**, not
just on the month-end days I originally recorded. Measured on the local seed
(space `019f9407…`, cash mode, unfiltered):

| view | L_cur/L_prev | paceDelta | burnDelta | gap |
|---|---|---|---|---|
| Feb 2026 closed | 28/31 | +20.53% | +33.44% | **12.91pp** |
| Apr 2026 closed | 30/31 | +30.47% | +34.81% | 4.35pp |
| Jun 2026 closed | 30/31 | +10.29% | +13.97% | 3.68pp |
| Jan 2026 closed | 31/31 | −11.28% | −11.28% | 0.00pp |
| Mar 2026 live d30 | 30/28 | −29.68% | −34.37% | 4.69pp |

**The "clamp the numerator" fix does NOT close the gap.** March live on the 30th:
`cur[27]/prv[27] − 1 = −31.28%`, still 3.09pp from the chip's −34.37%, because
`burnDelta`'s numerator keeps dividing by `TODAY`. Only making the live tile the
**rate ratio** (`paceDelta := burnDelta` when `isLive`) removes the contradiction
by construction. Clamping also silently drops the 2 elapsed days the adjacent
"Spent so far · Day 30 of 31" tile is showing.

**Why a rate is the only option:** when `PREV_LENGTH < TODAY` the two windows
*cannot* be made equal — February has no day 30 — so no totals comparison over a
common window exists. That is the argument for the rate, and "pace" is a rate word.

**Diverged twin:** `BudgetDetailPage.tsx`'s `velocity` useMemo still computes
`perDayLastMonth = prvAtToday / today` (not `/ min(today, prv.length)`) and
`acceleration` as a totals ratio, while its comment claims "Same math as the
space-level Velocity card in TrendsView.tsx". Viewing March there divides
February's whole total by 30 → understates last month's rate by 6.7%.

See [[trends-period-array-length-invariant]], [[trends-velocity-typical-window]].
