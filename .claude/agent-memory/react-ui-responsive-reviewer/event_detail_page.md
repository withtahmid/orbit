---
name: event-detail-page
description: EventDetailPage.tsx redesign — full-bleed ev-root, inline ED_STYLES, two-tier hero + card-less KPI band (flex-with-vertical-rules stray-border trap), drillable donut + timeline in eventCharts.tsx.
metadata:
  type: project
---

`pages/space/events/EventDetailPage.tsx` (large inline `ED_STYLES` template) + `eventCharts.tsx` (recharts v3: SpendTimelineChart ComposedChart, drillable CategoryDonutChart, SVG RadialBudgetGauge). Dark-only orbit-design.

- **Full-bleed**: `.ev-root { margin: -1.5rem -1rem; }` (`-2rem` ≥768px) cancels `.sl-main` padding to reach the viewport edge; no inner max-width, so on ultrawide the metrics band / tx rows / where-it-went bars stretch very wide (hero desc caps at 68ch, donut legend at 820px). See [[spacelayout-bleed-pattern]].
- **KPI band stray-rule trap**: `.ev-kpis` is `display:flex; flex-wrap:wrap` with each `.ev-kpi` carrying `border-left` except `:first-child`. On wrap (7 KPIs need ~912px container; wraps roughly 721–1250px viewport) the first item of each wrapped row keeps a stray leading rule. `@media (max-width:720px)` switches to a 2-col grid with borders removed (clean). Robust fix = drop vertical rules, use gap separation everywhere (mirror the mobile grid).
- **Hero action targets**: Edit / EventStatusButton(variant="labeled") / Delete all render `od-btn od-btn-sm` = 30px height, below 44px, incl. the destructive Delete; the mobile media query bumps tx-chips/search but NOT these. See [[tap-target-sizes]].
- **Budget card**: `.ev-budget-card { align-items:center }` centers its section header too, so its title is centered while every sibling `.ev-detail-section` header is left-aligned (minor inconsistency). Gauge vertical-centers via `.ev-budget-body { flex:1; justify-content:center }`. Solo fallback `.ev-grid-budget--solo` = full-width when no categories.
- **Donut a11y**: SVG pie not keyboard-focusable; access is via legend `<button>`s + `role="img"` aria-label on wrapper + center readout (good, matches other analytics donuts). Drillable legend rows expose `aria-pressed` but actually navigate (drill) rather than toggle — semantically a nav, not a toggle.
- **Search input** has no accessible name — only a placeholder (`--fg-4`, low contrast); wrapping `<label>` has no caption text.
- Skeleton shimmer static here — see [[ov-shimmer-keyframe-scoping]].
