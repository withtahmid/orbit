---
name: trends-yoy-mode-mismatch
description: RESOLVED 2026-08-01 — both trendsYearOverYear procs took a `mode` input and an xferFactor, so the YoY bars now track the MetricToggle; kept as the canonical example of a click-through chart that must share its target's metric mode.
metadata:
  type: project
---

**Resolved** on `fix/analytics/trends`. `trendsYearOverYear.mts` and
`personal/trendsYearOverYear.mts` gained
`mode: z.enum(["cash","operational"]).default("cash")` plus an `xferFactor`
derived from it (same pattern as `trendsDailyComparison` / `cashFlow`), and
`TrendsView.tsx` passes the active `useMetricMode("operational")` value.
Defaulting to `cash` kept every other caller unchanged.

**Keep the principle:** any chart that is *click-through navigation* into
another surface must be computed under the same metric mode, filters and scope as
the surface it opens. The failure it produced was unmistakable — click the July
bar reading ≈68K (cash) and land on a July page whose headline says ≈52K
(operational). Apply the same check to the YoY bars' *filter* inputs whenever
either side's filter set changes.

Related: [[trends_view_period_history_shipped]].
