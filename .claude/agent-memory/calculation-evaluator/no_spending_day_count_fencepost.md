---
name: no-spending-day-count-fencepost
description: "Days with no spending" must be an inclusive calendar-day count, not a duration subtraction; HeatmapView drifts by time-of-day and can go negative.
metadata:
  type: project
---

"Days with no spending" = candidateDays − activeDays. `activeDays` is an INCLUSIVE calendar-day count (day-slots in `byDay` with v>0, spanning periodStart's day-1 through today inclusive). The candidate count must use the SAME convention or the two disagree.

**Bug pattern (HeatmapView.tsx):** `totalDaysInWindow = round((elapsedEnd - periodStart)/86400000)` is a DURATION in days, not a calendar-day count. Because `elapsedEnd = now` (arbitrary time of day) and `periodStart` is app-tz midnight, the fractional part is today's time-of-day, so `round()` yields D before app-tz noon and D+1 after — the stat silently changes by 1 through the day with no data change. The inclusive candidate set is D+1, so morning loads under-report by 1 and can render "-1 days with no spending" when a user has spend on every elapsed day (activeDays = D+1, totalDaysInWindow = 348 → 348−349 = −1). The `Math.max(0,...)` guard is on totalDaysInWindow, NOT on the subtraction, so the negative reaches the UI.

**Correct convention (OverviewPage DailyHeatmap does it right):** count candidate days explicitly and inclusively — `Array.from({length: today}, (_,i)=>i+1).filter(no spend).length`, or for the multi-month case `round((startOfDay(now) - periodStart)/86400000) + 1`. Deterministic, includes today (partially-elapsed day is a valid candidate, matches activeDays), always ≥ activeDays.

**Why:** Duration-vs-calendar-day-count is the classic fencepost. Any analytics "N days" stat paired with an inclusive day-slot count must itself be inclusive.
**How to apply:** When auditing "days elapsed"/"days with no X" stats, check the candidate count is an inclusive calendar-day count matching how the active/hit days are enumerated — not `(endInstant - startMidnight)/86400000` rounded.
