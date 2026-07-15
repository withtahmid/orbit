---
name: overview-heatmap-native-getters
description: OverviewPage DailyHeatmap buckets days with native new Date().getMonth()/getDate() (browser-local), unlike HeatmapView which uses formatInAppTz — tz-fragile
metadata:
  type: project
---

`OverviewPage.tsx` `DailyHeatmap` builds its current-month `byDay` map with
browser-local native getters:
`const d = new Date(r.day); if (d.getMonth() === month) byDay.set(d.getDate(), r.total)`.
The analytics `HeatmapView.tsx` does the tz-safe thing instead — keys by
`formatInAppTz(r.day, "yyyy-MM-dd")` and matches on `formatInAppTz`-derived y/m.

**Why it matters:** server `spendingHeatmap` returns one row per day as a
midnight-Dhaka instant. For any browser west of +6, a month-boundary instant
shifts to the previous calendar day. As long as the query returned only the
current month this was just a day-1 drop; once the query window is widened
(the `feat/heatmap-enhanch` change widened it to 12 months so color-bucket
edges self-scale), `getMonth() === month` is no longer a unique current-month
filter and the window's earliest boundary day (~1 yr ago) leaks onto the last
cell of the current grid — inflating "This month" total and hijacking "Peak
day". Dhaka (+6) users don't see it; most other tzs do.

**How to apply:** Any time OverviewPage widget reads `spendingHeatmap`/other
day-grained analytics with `new Date(r.day).getMonth()/getDate()`, treat it as
a tz bug and compare against the `formatInAppTz` pattern in HeatmapView.tsx.
Edges/quantile math is amount-only and tz-independent — the hazard is always
the day ASSIGNMENT, not the color scale.
