---
name: spendingheatmap-operational-zero-rows
description: spendingHeatmap operational mode emits total=0 day rows (transfer branch × 0); per-entry counters that don't filter v>0 get diluted
metadata:
  type: project
---

`analytics/spendingHeatmap.mts` + `personal/spendingHeatmap.mts` implement the
`operational` mode by keeping the transfer-principal UNION-ALL branch and
multiplying its amount by `xferFactor = 0` (instead of dropping the branch).
Consequence: a day whose only in-scope activity is a cross-space transfer
produces a real result row with `total = 0`.

**Why it matters:** In `HeatmapView.tsx` most consumers filter `v > 0`
(`computeQuantileEdges`, `medianActiveDay`, `earliestActiveKey`, `activeDays`,
cell `bucketize`) so the 0-rows are harmless there. But any consumer that
increments a per-entry counter over `byDay` **without** a `v > 0` guard is
diluted by these phantom 0-days. Confirmed victim: the "By weekday" card
(`byWeekday`: `counts[dow]++` for every entry, then `sum/count`) — its averages
and the derived "% above weekly average" caption read too low for any user who
makes cross-space transfers (universal on `/s/me`). This is a REGRESSION from
the pre-mode heatmap (which always counted transfers, so `byDay` had no 0-rows).

**How to apply:** Whenever operational-mode heatmap data feeds an average/count,
verify the denominator filters `v > 0`. Same trap will bite any future
per-weekday / per-bucket averaging over `spendingHeatmap` output.
