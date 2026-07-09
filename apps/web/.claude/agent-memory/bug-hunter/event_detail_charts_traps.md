---
name: event-detail-charts-traps
description: Event Detail timeline chart (eventCharts.tsx SpendTimelineChart) folding/cap invariants and the eventTotals-vs-cumulative data-source split.
metadata:
  type: project
---

Event Detail redesign lives in `apps/web/src/pages/space/events/` — `eventCharts.tsx` (SpendTimelineChart, CategoryDonutChart, DayOfWeekStrip, RadialBudgetGauge) + `EventDetailPage.tsx` + `eventUtils.ts`.

Timeline invariants worth re-checking on any edit:
- `enumerateDays` (eventUtils.ts) hard-caps at **2000 days** (~5.5 yr). SpendTimelineChart folds out-of-window txns onto the clamped edge day, but the day-loop only iterates the enumerated (capped) days. For an event window >2000 days, any spend folded to `endDay` or dated after the 2000th day is **silently dropped from the cumulative** — burn-up curve plateaus early. Low severity (pathological span) but real.
- The hero "Spent" comes from `analytics.eventTotals` (to match the list card), while the timeline cumulative sums `analytics.eventDailySpend`. These are **two different procedures** — if they ever diverge in what they count, the final cumulative won't equal the hero number. Not a bug today, but the gap is by design so don't "fix" one to the other blindly.
- volMax = `maxDaily>0 ? maxDaily*3.6 : 1` (never 0); daily Bars only render when `maxDaily>0`; hidden `vol` YAxis has an explicit `domain={[0,volMax]}`. Every series (Area/Lines/Bars) pins an explicit `yAxisId` ("cum" or "vol") — verify no new series drops to a default axis.
- Tooltip reads `payload[0].payload` (the shared row datum) so it works regardless of which series is first; all fields (expense/cumExpense/pace/income/txCount) live on every row.

Drillable donut (`CategoryDonutChart`) — FIXED as of feat/enevt/details:
- Drill state is now `pathIds: string[]` (ids, not CatNode refs); `path` is a useMemo that walks fresh `roots` each render and `break`s if an id vanishes. This is the correct fix for the old stale-subtree freeze. `EventDetailPage.categories` is memoized on `[categoriesQuery.data]` and `breakdown` is `breakdownQuery.data` — both TanStack-stable refs, so CategoryCard's `roots` useMemo and the donut's `slices` memo stay identity-stable across unrelated refetches and the `[slices]` clear-effect no longer wipes hover/pin. Verified round-2: no remaining unstable-identity path.
- `buildCategoryTree` now has a `seen` Set cycle-guard in `compute` (returns early if seen) plus an attach-unvisited loop that pushes any unseen node as a synthetic root. Self-parent (X.parentId===X) and 2-cycle (A↔B) are handled correctly — no infinite recursion, money conserved.
- KNOWN LOW DEFECT (defensive-only, DB prevents it): a **tail node into a cycle** double-counts. Shape: 2-cycle A↔B plus D with D.parentId=A. If `nodes.values()` iteration (= `cats` insertion order) reaches D before A, the attach loop pushes D as a synthetic root, then compute(A) later still traverses D as A's child (D.parentId=A) and folds D.total into A.total → D's spend counted twice in the roots sum / donut center total. Root cause: the attach loop pushes ANY unseen node as a root unconditionally, even one with a valid parent that just hasn't been computed yet. Only over-counts on malformed cyclic data; self-parent and 2-cycle alone are unaffected.

**Why:** These were the focus of a round-3 bug hunt after the timeline was rewritten from two stacked charts into one ComposedChart; round-4 added the drillable donut.
**How to apply:** When touching the timeline math or the cap, re-verify money conservation vs the folded series, and don't assume cumulative == hero Spent. When touching donut drill state, prefer id-based paths over CatNode-ref paths so refetches reconcile.
