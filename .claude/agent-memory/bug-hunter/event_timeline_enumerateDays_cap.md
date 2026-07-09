---
name: event-timeline-enumeratedays-cap
description: enumerateDays 2000-day cap silently drops tail data + breaks pace line for very long or mis-dated event timelines
type: project
---

`eventUtils.ts::enumerateDays(start,end)` hard-caps at 2000 rows (guard<2000).
`eventCharts.tsx::SpendTimelineChart` builds its continuous series from
`enumerateDays(winStart, winEnd)` but computes the pace-line `span` separately
from `daySpanInclusive(startDay, endDay)`.

**Why it matters:** If the enumerated window exceeds 2000 days the two diverge:
- cumExpense/daily bars only accumulate data on enumerated days → tail spend past
  day 2000 silently vanishes from the chart.
- pace `frac = offset/(span-1)` uses the uncapped span, so on the last rendered
  day frac < 1 → the dashed pace line never reaches the estimate.

**How to apply:** Two realistic triggers — (1) an event spanning >5.5 years,
(2) a single mis-dated transaction (fat-fingered year) that pushes `winStart`
far into the past, so the 2000-day walk from winStart never reaches the real
event window and the whole timeline blanks to just the stray point. Low
likelihood but user-triggerable. Any future edit to the widening logic should
clamp winStart/winEnd to a sane bound or reconcile the cap with `span`.
