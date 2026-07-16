---
name: heatmap-spending-calendar
description: HeatmapView "Spending calendar" analytics page — Donut controlled-hover coupling, SlabLegend a11y, granularity toggle drift, reference-line ambiguity.
metadata:
  type: project
---

`apps/web/src/pages/space/analytics/views/HeatmapView.tsx` — the Spending Calendar analytics view. Recurring review touchpoints:

- **Donut controlled hover:** `Donut.tsx` gained additive `activeId`/`onActiveIdChange` props. `isControlled = activeId !== undefined` (so passing `null` still counts as controlled). No other `<Donut>` consumer passes them (BudgetDetailPage, EnvelopesView, OverviewPage, eventCharts all uncontrolled) — verify this stays true before touching Donut. HeatmapView drives the "Days by intensity" donut + its custom `SlabLegend` from one parent `hoveredSlab` state; round-trip is a single render, no flicker.
- **`SlabLegend` (local component):** rows are `<button>` with `onMouseEnter` only — no `onFocus`/`onBlur`/`onClick`. Keyboard-focusable dead ends (highlight is mouse-hover-only). `aria-pressed` correctly omitted (transient hover, not a toggle). Fix = add onFocus/onBlur parity.
- **Granularity toggle** (`BAR_GRANULARITY_OPTIONS`, Day/Week/Month) drifted smaller than the canonical `GranularityToggle` in `TrendsView.tsx` (h-8/h-7/text-[11.5px]/px-2.5 vs h-9/h-8/text-[12.5px]/px-3). Both use role=tablist/tab without tabpanel — established app pattern, don't re-flag. tablist `aria-label` was hardcoded "Spend-by-week" while granularity varies.
- **Reference lines:** `<ReferenceLine>` block (4 dashed lines at 25/50/75/100% of `chartMax`) is LIVE JSX in the bar chart, NOT removed. Gridline/CartesianGrid re-attempts are explicitly OFF-LIMITS per user instruction. The 7 Y-axis ticks (`tickCount={7}`) are deliberately unsynced with these 4 lines. If asked to "clean up gridlines," reconcile intent first — don't reintroduce CartesianGrid.
- **Sizing:** "Days by intensity" card gets a wider grid track (`lg:grid-cols-[1fr_1fr_1.35fr]`); ring capped `max-w-[220px]`, legend `max-w-[190px]`, centered via justify-center. Empty margin at 2xl is intentional/acceptable.
