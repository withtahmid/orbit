---
name: quantile-bucket-count-tautology
description: Counting days/items per quantile-defined intensity bucket is near-tautological; chart dollars-per-bucket instead
metadata:
  type: feedback
---

Do not build a chart that COUNTS items per quantile-defined intensity bucket (e.g. "Days by intensity" donut on the Spending Calendar / HeatmapView). It is a near-tautology.

**Why:** The heatmap intensity buckets 1-5 are the 20/40/60/80th percentile edges of active days (`computeQuantileEdges` in `apps/web/src/lib/spendHeatmapColor.ts`). By construction each tier holds ~20% of active days, so a count-per-bucket ring renders ~5 equal slices for every user/space/window (bucket 5 only slightly fatter because IQR-trimmed outliers land there). The "shape" such a chart claims to reveal is exactly what quantile binning erases. Dropping the "No spend" slice ("Ignore no-spend" default ON) leaves only the tautological tiers; keeping it just restates the "% of days had any expense" KPI.

**How to apply:** When a distribution-summary chart sits on top of quantile-bucketed data, chart the SUMMED VALUE (dollars) per bucket, not the COUNT of items. Spend-per-band is heavily unequal (heavy-tailed) and genuinely informative — answers "many small days vs. a few big ones." Reuse the same bands/labels/legend; the "ignore no-spend" toggle becomes unnecessary since no-spend contributes $0. More broadly: any "N by intensity/tier" count viz over quantile bins is suspect — check whether the bins are equal-frequency by definition before trusting the shape.

Related: [[semantic_color_tokens_are_load_bearing]], [[relative_dynamic_thresholds]] (thresholds are quantile-derived by design — that's correct for the calendar cells, but it's what makes the count-donut degenerate).
