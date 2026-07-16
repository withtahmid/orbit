---
name: daily-volume-bar-strip-pattern
description: Four spend charts share a "daily-volume bar strip under a cumulative curve" pattern; their bar-width strategies diverge and eventCharts can overlap.
metadata:
  type: project
---

Four charts now render a translucent per-day "daily spend" volume bar strip beneath a cumulative curve, all themed to the series' own `color` at ~0.32 fillOpacity (not a separate expense-red hue):
- `components/budget-gauge/EnvelopeSpendChart.tsx` (hand-rolled SVG)
- `pages/space/analytics/views/TrendsView.tsx` `CumulativeRaceChart` (hand-rolled SVG)
- `pages/space/events/eventCharts.tsx` `SpendTimelineChart` (Recharts `<Bar>`)
- legend-only entry in `pages/space/budgets/BudgetDetailPage.tsx`

**Why:** design unification — bars read as the same series as the cumulative line, broken into daily amounts.

**As of the heatmap-fix branch (2026-07):** all three bar strips now share the SAME y-axis/scale as their cumulative line (previously rode a separate compressed scale capped so a full bar reached only ~28% of plot height, which didn't match the visible Y-axis labels). Bars are therefore now honestly proportional to the dollar amount on the visible axis — and consequently much SHORTER (a single day is usually a small % of the whole-period cumulative total). Both hand-rolled charts added a `topRoundedBarPath(x,yTop,w,h,r)` helper (rounds top corners only; guards `w<=0||h<=0` → "" and clamps `rr=Math.min(r,w/2,h)`, so it degrades gracefully at tiny heights — no inverted/negative geometry). r is fixed 1.5 viewBox units.

**No minimum bar-HEIGHT floor exists** (there never was — the old compressed scale forced visibility). Since viewBox charts use `preserveAspectRatio="none"` + CSS `height:h`, viewBox y-units map 1:1 to px vertically, so bar height in units == px. Bucket count is BOUNDED for the two hand-rolled charts (week≤7 / month≤31 / quarter≈13 wk / year=12 mo buckets — `daysInMonth`=periodLength), so `barWidth` stays 14px in the common month view; a quiet day can still render ~1-3px tall (a thin line, not obviously a bar), but the cumulative line carries the read. The event chart's bucket count is UNBOUNDED (one per event day) so long (90+ day) events give ~1-3px tall AND ~3-7px wide near-invisible bars — inherent honest-scale tradeoff, low severity.

**Bar-width strategy (still DIVERGES, still the fragile spot):**
- Two hand-rolled SVG charts: `barWidth = Math.max(2, Math.min(14, daySpacing*0.6))` — always ≤60% of slot, never overlap.
- eventCharts now uses `barSizeProps = series.length <= 24 ? { barSize: 14 } : { maxBarSize: 14 }` — fixed 14 for short events, shrink-to-fit for >24 days. This resolves the earlier hard-`barSize` overlap on long events.
- Legend: BudgetDetailPage `.ed-sw` and eventCharts `LegendKey` both now tint the "Daily spend" swatch via `color-mix(in oklab, <color> 32%, transparent)` to mirror the 0.32 bar opacity (no longer a solid swatch identical to "Cumulative spend").

**Chart heights bumped this round** (with matching skeletons): Event 264→340px (skeleton `EventDetailPage` 390, real footprint ≈340+4gap+~22 legend≈366 → ~24px over-alloc, minor shrink on load, pre-existing buffer pattern). Envelope `h` 440→520 (skeleton `BudgetDetailPage` 580 ≈ 520 svg + 20 axis-row + ~40 foot → good match). Trends `h` 380→460 (skeleton `TrendsView` `h-[460px]` + `OverviewPage` embed `height={460}`; real footprint ≈460 svg + 4 mt-1 + ~14 axis-label row ≈478 → skeleton ~18px short, minor grow on load). EndpointStat grid in TrendsView sits OUTSIDE the loading conditional (always rendered).

These charts use `preserveAspectRatio="none"`; `<rect>`/`<path>` bars are safe under it — only SVG `<circle>` markers distort, which is why the hand-rolled charts overlay dots as HTML.
