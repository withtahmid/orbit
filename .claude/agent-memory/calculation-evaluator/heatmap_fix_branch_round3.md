---
name: heatmap-fix-branch-round3
description: Round-3 calc audit of heatmap-fix branch — categoryMonthlyTrend SQL, Categories/Envelopes trend charts, MultiSeriesLineChart, operational-mode zero-day handling all verified clean
metadata:
  type: project
---

Round-3 aggressive calc audit of `heatmap-fix` branch found NO new calculation bugs (rounds 1-2 already fixed OverviewPage SpendingTrends mode-mixing, AccountsGlance abs-denominator, Donut legend sliceSum, EnvelopesView combined-pace gating, HeatmapView byWeekday zero-skip).

**Why:** User loops "run agents until perfection"; recording verified-clean areas so future rounds don't re-audit.

**How to apply:** These specific formulas are confirmed correct — spend re-audit effort elsewhere:

- `categoryMonthlyTrend.mts` (analytics + personal): month CTE `generate_series(date_trunc('month',start), date_trunc('month',end - '1 second'), '1 month')` correctly respects exclusive periodEnd; subtree rollup via recursive `tree.root = ec.id` matches categoryBreakdown; Asia/Dhaka has no DST so date_trunc month boundaries are stable. `::date` casts align with session-tz `date_trunc`.
- **Operational-mode zero-day injection** (spendingHeatmap both variants): `amount * ${xferFactor}` emits `total=0` rows for transfer-only days when mode=operational. SAFE because `computeQuantileEdges` filters `v>0` (spendHeatmapColor.ts:34) and every byDay consumer (byWeekday, medianActiveDay, heaviestWeeks, activeDays, earliestActiveKey) filters `v>0`. Color ramp not distorted.
- EnvelopesView YTD trend: `e.months[i]` (0-indexed, month=i+1) correctly indexes yearReport's 1-12 month cells; `inRange = i < currentMonth` includes current month; future months null (not false-zero). Cumulative monthTrend + pace line gated on `isLivePeriod` (fixed prior round).
- MultiSeriesLineChart: yDomain rescale-on-isolate (min/max both series, 10% pad, clamp>=0, flat fallback); over/under dot compares value vs reference at dotAt index. Sound.
- CategoriesView trend re-slice: flat→directTotal, tree→subtreeTotal, "(direct)"→directTotal, "Other"→sum of flatOverflowIds directTotal. All mirror their donut counterparts.

**Latent non-calc note:** `CategoryMultiSelect.tsx` `countDescendants`/`walk` recurse the category tree with NO cycle guard, unlike the server's `buildSelectedCategoriesCTE` (which guards because changeParent only forbids self-parent, so A→B→A data cycles are possible). A cycle would infinite-loop the dropdown. Not reachable from CategoriesView (passes parent_id:null rows) but is from AnalyticsFilterBar. Robustness/hang issue, not a wrong-number bug — hand to bug-hunter.
