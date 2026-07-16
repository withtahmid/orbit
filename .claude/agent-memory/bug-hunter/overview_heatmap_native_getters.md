---
name: overview-heatmap-native-getters
description: OverviewPage DailyHeatmap buckets days with native new Date().getMonth()/getDate() (browser-local), unlike HeatmapView which uses formatInAppTz — tz-fragile
metadata:
  type: project
---

UPDATE 2026-07-16 (heatmap-fix branch): the DATA-BUCKETING half is now FIXED —
`byDay` keys off `formatInAppTz(r.day, "yyyy-MM-dd")` and filters on
`monthKey = formatInAppTz(now, "yyyy-MM")`. BUT the GRID GEOMETRY is still
native/browser-local: `year=now.getFullYear()`, `month=now.getMonth()`,
`daysInMonth=new Date(year,month+1,0).getDate()`, `firstWeekday=new Date(year,month,1).getDay()`,
`today=now.getDate()`, and the Peak-day label `MONTH_ABBR[month]` (deliberately, per
an in-code comment claiming it "matches" the native grid). So the two halves now
DISAGREE with each other: data is app-tz, layout is browser-tz. For a non-Dhaka
viewer near a month boundary the header (`formatInAppTz(now,"MMMM yyyy")`, app-tz)
and app-tz `byDay` can point at month M+1 while the grid renders month M with the
wrong number of cells / wrong `today` marker / wrong peak label — day cells then
show another month's data or blanks. Correct fix: derive year/month/today/
daysInMonth/firstWeekday from `getAppTz*` helpers too.

The analytics `HeatmapView.tsx` was the tz-safe reference — keys by
`formatInAppTz(r.day, "yyyy-MM-dd")`.

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
