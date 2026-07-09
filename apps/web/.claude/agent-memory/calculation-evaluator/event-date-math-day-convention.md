---
name: event-date-math-day-convention
description: Two incompatible "day" conventions collide in event analytics — ms-rounded timestamp span vs APP_TZ calendar-day buckets.
metadata:
  type: project
---

Event analytics on the detail page mixes two notions of "a day" that don't line up, causing off-by-one day counts and a pace line that misses its endpoint.

**The two conventions:**
- **Timestamp span (ms-rounded):** `EventDetailPage.tsx` HeroBand/StatTiles compute `totalDays = max(1, round((end-start)/DAY_MS) + 1)` and `elapsed` the same way, from the absolute `start_time`/`end_time`. `SpendTimelineChart` pace uses `(dayMs - startMs)/(endMs - startMs)` against those same raw timestamps.
- **APP_TZ calendar-day buckets:** `eventDailySpend.mts` groups by `date_trunc('day', transaction_datetime)` in Asia/Dhaka; the client parses each 'YYYY-MM-DD' via `parseAppDay` → local **midnight**. This is what the timeline bars and DOW strip actually plot.

**Why they diverge:** events are created with a `datetime-local` picker, so `start_time`/`end_time` carry arbitrary times of day (not normalized midnights). `round(diff)+1` only equals the calendar-day span when start and end share a time-of-day; otherwise it over/undercounts (e.g. start Jul1 10:00, end Jul3 22:00 → round(2.5)+1 = 4, but only 3 calendar days / 3 bars). And pace floors data points to midnight while the denominator runs to real `end_time`, so the pace line ends below `estimate`.

**Why:** the design goal is that Avg/day denominator, the "N-day event" label, and the pace line all agree with the calendar-day timeline the user sees.

**How to apply:** when auditing/fixing event day math, use ONE APP_TZ calendar-day convention everywhere — floor both endpoints to Dhaka midnight (via `@/lib/dates` getAppTz*/makeAppTzDate per CLAUDE.md) before differencing, matching the `eventDailySpend` buckets. Watch for this same pattern in any new event or period analytics.

**Also noted (not a bug):** `eventTotals.tx_count` counts ALL linked tx types (LEFT JOIN, no type filter) incl. transfer/adjustment, while `eventDailySpend.tx_count` counts only expense+income. Money sums agree (both use identical expense/income CASE sums); only the COUNTs diverge. See [[analytics-category-breakdown-invariants]].
