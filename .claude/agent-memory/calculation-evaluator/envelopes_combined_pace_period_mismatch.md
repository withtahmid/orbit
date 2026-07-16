---
name: envelopes-combined-pace-period-mismatch
description: EnvelopesView "This month combined" pace line uses period-scoped allocated while spend series is hardcoded current-month; wrong when period picker != this-month
metadata:
  type: project
---

EnvelopesView.tsx ("This month, all envelopes combined" chart) has a period-scope
mismatch in the on-budget pace reference line.

**The mismatch:** the solid cumulative-spend lines come from
`trends.dailyComparison({granularity:"month"})`, which is anchored to `new Date()` —
ALWAYS the current calendar month, ignoring the page's period picker. But the pace
line numerator is `e.allocated` from `envelopeUtilization`, which IS scoped to the
selected `period`. `monthTrend` useMemo does NOT depend on `isLivePeriod`, so the
pace line is computed regardless of the picker.

- period = "this-month" (default): allocated = current month → pace correct.
- period = "last-month": pace uses last month's allocation vs current-month spend.
- period = "this-year": `envelopeUtilization` SUMS monthly allocation rows across the
  window (per analytics/CLAUDE.md "multi-month windows sum the per-month rows"), so
  allocated ≈ N months × monthly. Pace line ramps to N× the real monthly budget over
  ~31 days → every envelope reads massively "under pace"; inverts on-pace/over-pace.

**Why it's easy to miss:** the row-level `pace`/`projectedOver` IS correctly gated on
`isLivePeriod` (computeRow gets `null` when not live). Only the combined chart's
`__pace` series skipped the gate.

**Fix pattern:** guard the pace value with `isLivePeriod` (null it out otherwise, keep
the current-month spend lines), matching how `pace` is already gated. Add `isLivePeriod`
to the `monthTrend` useMemo deps.

**How to apply:** whenever a chart mixes a hardcoded-now series (dailyComparison
granularity:"month" always uses now) with a period-scoped value (envelopeUtilization
allocated/consumed), the two only agree when the picker is on "this-month". Verify the
period-scoped input is gated to the live month. Related: [[spacesummary_window]].
