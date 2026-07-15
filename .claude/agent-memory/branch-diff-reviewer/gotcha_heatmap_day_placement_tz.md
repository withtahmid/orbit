---
name: gotcha-heatmap-day-placement-tz
description: Overview DailyHeatmap places days via browser-local getters; Spending calendar (HeatmapView) uses app-tz — they diverge off Asia/Dhaka
metadata:
  type: project
---

Two daily-spend heatmap call sites share `@/lib/spendHeatmapColor.ts` but place
days on different tz bases:

- `apps/web/src/pages/space/analytics/views/HeatmapView.tsx` keys days by
  `formatInAppTz(r.day, "yyyy-MM-dd")` (Asia/Dhaka) — matches server day buckets.
- `apps/web/src/pages/space/OverviewPage.tsx` `DailyHeatmap` scopes to the
  current month with browser-local `new Date(r.day).getMonth() === now.getMonth()`
  and `.getDate()`.

`spendingHeatmap` server proc returns `r.day` as an absolute day-boundary instant
(`date_trunc('day', transaction_datetime)` in the PG session tz), so browser-local
getters drift for any user whose browser tz != Asia/Dhaka (UTC+6).

**Why it matters for review:** when the Overview heatmap query was widened from
one month to a trailing 12 months (edges-scale fix), the browser-local
`getMonth()` guard became the *sole* current-month scoping filter over a full
year of rows. For browsers west of +6, an adjacent-month/prior-year day instant
(e.g. Aug 1 app-tz-midnight → Jul 31 local) can leak into the current-month grid
and pollute `totalMonth`/`peakDay`. Primary user is in Dhaka so it doesn't
manifest locally.

**How to apply:** on any change to these two heatmaps, check they place days on
the same tz basis (prefer `formatInAppTz` + year+month compare in DailyHeatmap),
and re-flag the browser-local scoping if still present.
