---
name: multiseries-line-chart
description: MultiSeriesLineChart shared component — click-to-isolate legend is the sole line-identification affordance; legend max-height + isolated-dim caveats
metadata:
  type: project
---

`components/shared/charts/MultiSeriesLineChart.tsx` — shared multi-line chart used by EnvelopesView (This-month combined, Year-to-date) and CategoriesView (Spending trend). Recharts v3.

Key design facts (durable):
- Interaction is **click-to-isolate**: clicking a legend chip dims every other line to `strokeOpacity 0.12` and rescales Y to the isolated line's range. There is NO tooltip/hover legend — the clickable chip row is the ONLY way to identify which colored line is which envelope/category. So the legend's legibility and reachability are load-bearing, not decorative.
- Legend chips are `min-h-8` (32px) buttons, `flex-wrap` in a fixed-max-height scroll box. Real data routinely has 10+ series (every active monthly envelope / up to 13 flat-donut categories), so multi-row wrapping is the normal case, not an edge case.
- When a line is isolated, the OTHER (still-clickable) chips get `text-muted-foreground` + `opacity-40` — combined that drops 11px text well below readable contrast, yet those chips are how you switch to a different series.
- Secondary series (`secondary` prop) draws a dashed reference line (`__pace` / `__planned`) + over/under dot markers; caption at bottom is `text-[10px]`.

**Why:** flagged in round-3 heatmap-fix review. **How to apply:** when reviewing this component, check the legend max-height per breakpoint (it must not cap SMALLER on desktop than mobile), confirm dimmed-but-interactive chips stay readable, and treat "many series" (10+) as the default test case.
