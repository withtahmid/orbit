---
name: heatmap-ui-conventions
description: Shared spend-heatmap color system (spendHeatmapColor.ts) used by both HeatmapView and OverviewPage's DailyHeatmap — palette, bucketing, cross-page consistency notes
metadata:
  type: project
---

Two daily-spend calendars now share ONE color module: `src/lib/spendHeatmapColor.ts`
(`AMBER` palette + `computeQuantileEdges` + `bucketize` + `ramp` + `formatCompact`).
Consumers: `pages/space/analytics/views/HeatmapView.tsx` (the full 12-month "Spending
calendar" at `/s/:spaceId/analytics/heatmap`) and the `DailyHeatmap` widget in
`pages/space/OverviewPage.tsx`.

**Why:** the two calendars were drifting apart; unifying the color/bucketing math keeps
them one system. Recording the durable facts so future audits skip recomputation.

**How to apply:**
- **`AMBER` ramp is authored oklch stops** (fixed hue 82, rising L+C: b1 32% → b5 85%),
  NOT color-mix — deliberately, to avoid the old "muddy brown" hue-mixing bug. Text color
  switches at the b2→b3 boundary: buckets 1-2 use `fgLight` (var(--fg)), buckets 3-5 use
  `fgDark` (oklch 16%). Module comment claims every fg/bg pairing was hand-verified ≥4.5:1.
  Trust it unless you recompute oklch→sRGB; don't eyeball-fail it.
- **Buckets are relative (percentile), not absolute.** `computeQuantileEdges` uses
  20/40/60/80th percentile of active days with IQR-outlier trimming. So identical amber
  brightness means DIFFERENT dollar amounts on the two pages (each self-scales to its own
  window: Overview = current month, HeatmapView = 12 months). This is intended.
- **HeatmapView has a 6-swatch legend** explaining the ramp; **OverviewPage does NOT** — its
  sub-caption is just "intensity = how heavy that day was for you". Acceptable because every
  Overview cell prints its amount as visible text, so color is supplementary (not a
  color-only-signal a11y failure).
- **Interactivity differs by design:** HeatmapView day cells are `<Link>` (focus-visible
  ring, drill to filtered transactions) with `title` tooltips; OverviewPage cells are plain
  non-interactive `<div>`s with no `title`. Fine — Overview is a summary widget offering one
  "Open calendar" `<Link>` (→ `ROUTES.spaceAnalyticsDetail(spaceId, "heatmap")`).
- **Peak-day halo differs:** HeatmapView = border(var(--bg)) + `0 0 0 1.5px var(--fg)`;
  Overview = `0 0 0 1px var(--bg), 0 0 0 2.5px var(--fg)`. Both dual-tone, cosmetically
  slightly different despite Overview's "same halo" comment.
- **Overview `.ov-heatmap-cell` keeps its CSS `var(--line-soft)` border** on colored cells
  (inline style only sets bg/boxShadow), while HeatmapView sets border transparent. Minor
  divergence; the bigger Overview cells arguably benefit from the outline.
- **PRE-EXISTING tz hazard on Overview** (`OverviewPage.tsx` ~L2461): peak-day footer label
  uses `formatInAppTz(new Date(year, month, peakDay), "MMM d")` — reprojects a browser-local
  Date through Asia/Dhaka, so the printed label can be one day off the (browser-local) ringed
  grid cell for non-Dhaka users. HeatmapView deliberately avoids this by reading native
  fields back out. Not touched by the refactor.
- Overview responsive: 7-col grid, cells min-height 56px→40px(≤640px)→34px(≤380px); at 375px
  cells ~47px wide, `formatCompact` labels ("1.4K") fit with no overflow. Holds up.
