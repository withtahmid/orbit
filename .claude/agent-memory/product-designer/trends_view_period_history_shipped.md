---
name: trends-view-period-history-shipped
description: What shipped for Trends period-history on branch fix/analytics/trends (2026-08-01), the owner rejections that stuck, and the round-1/round-2 review verdicts — including the young-space incoherence that is the page's real remaining gap.
metadata:
  type: project
---

Supersedes the pre-implementation plan memory. Implemented on
`fix/analytics/trends`; reviewed round 1 and round 2 on 2026-08-01.

**Shipped:** `TrendsPeriodBar` in `TrendsView.tsx` — `[◀] July 2026 · In
progress [▶]` + granularity toggle + always-rendered "Now" button, full-width
**below** the PageHeader (the other six analytics views keep `PeriodChip` in the
header `actions` slot). URL is `?p=YYYY-MM-DD`, omitted when live. Server derives
`now_ts = LEAST(NOW(), cur_end − bucketInterval)` so the anchor selects only
*which* period; an unfiltered `nav_start` CTE bounds the back arrow (filters and
metric mode no longer move the navigable range); `trendsCategoryMovers` gained
optional calendar-aligned `prevStart`; both `trendsYearOverYear` procs gained
`mode` so the YoY bars respect the MetricToggle. Every card follows the anchor.

**Owner rejections that stuck (do not reopen):**
- "As it looked on day N" partial mode.
- A separate 12-month nav rail — the **YoY bars became the navigator**. A rail
  would draw the same twelve numbers twice on one page.
- "Projected" → "Actual" on closed periods; owner chose **"Biggest day"** for
  that slot. Correct: it's the only summary answer to *when* the money went.
- Extracting a shared `PeriodStepper` — accepted debt, see
  [[period_selection_two_idioms]].

**Settled verdicts:**
- `· In progress` / `· Complete` as the state pair; one warning-tinted bar is
  enough, since every card independently names its period.
- **`?p` pushes rather than replaces — correct, and settled.** The objection
  ("six ◀ presses make Back useless for leaving") doesn't hold, because
  `AnalyticsDetailLayout` renders an explicit "All analytics" back link as the
  page's first element, so exit never depends on history depth. Any URL-persisted
  view state that is shareable and reload-stable should be history-worthy.
- `openMonth` preserving `?g` and anchoring on the *containing* period is right
  for month/quarter but **wrong at year granularity**, where all twelve columns
  are inside the selection: the click re-anchors to the same year, so 12 bar
  buttons + 12 mobile chips do nothing while the copy promises "Click any month
  to open it" — and each dead click still pushes a history entry, because
  `setSearchParams` doesn't dedupe identical URLs. Year granularity should drill
  to Month on click.

**The real remaining gap: the young-space state.** At a space's earliest period
(`previousLength === 0`, `averagePeriods < 2`) the page names the non-existent
prior period ~7 times while asserting it doesn't exist, and prints three hard
zeros for it (the KPI "Vs June" 0.0%, Velocity's per-day row 0.00 and its change
row 0.0%) beside the endpoint strip's em-dashes. Note `KpiStrip`'s `percent`
branch silently ignores `tone: "muted"`, so that 0.0% renders at full strength.
`KpiItem.value` accepts a `ReactNode`, so an em-dash needs no component change.
The structural fix is to *drop* prior-period comparisons when there is no prior
period (KPI item, endpoint stats, whole Velocity card) rather than em-dash them,
and to retitle the "Year-over-year" card when the prior year is entirely absent.

**Not shipped, judged low-priority:** any link from `BudgetMonthPage` /
`BudgetsPage` into the Trends stepper.

Related: [[trends_prev_period_bucket_truncation]],
[[trends_typical_excludes_prior_period]], [[trends_yoy_mode_mismatch]],
[[period_selection_two_idioms]].
