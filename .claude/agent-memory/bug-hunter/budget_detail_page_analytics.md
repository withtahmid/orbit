---
name: budget-detail-page-analytics
description: BudgetDetailPage.tsx analytics-row status — rounds 1-5 issues now FIXED (round-6 verified); live round-6 issues = unconditional movers subtitle contradicting MoversList's !hasPrevious branch, and VelocityViz's whole-period "Typical" contradicting the page's own elapsed-window typical narrative.
metadata:
  type: project
---

`apps/web/src/pages/space/budgets/BudgetDetailPage.tsx` — the "Monthly spend"
column (`EnvelopeMonthlyBars`) analytics row.

## Round-1 issues — FIXED and re-verified (2026-07-02)
- Footnote now branches on `isMonthlyCadence`: bullet mode shows "Spent X of Y
  allocated this year", rolling shows "this year vs last (so far)". No longer
  mismatched.
- `hasData = (monthly?.hasData ?? false) || hasAllocData` — allocations now keep
  the chart from hiding behind the empty state.
- `yoyQuery` gets `year: getAppTzYear(viewingDate)`; `allocQuery` gets
  `year: monthly?.year` (which echoes that input). Threads correctly; the
  cross-year transient is gated by `allocQuery.isLoading` (query-key change =
  fresh isLoading), so no wrong-year flash. monthOffset year-scope resolved.

## Round-2 issues — FIXED and re-verified (2026-07-02, round 3)

- **Archived over-pace alarm regression — FIXED.** `EnvelopeSpendChart` now takes
  `archived?: boolean` (default false); `alertColor` = `--fg-3` when archived,
  else two-tier (`--expense` if `isOverBudget = cur[today-1] > budget`, else
  `--warn`). All escalation paths (bracket L363, ping L403, dot L414, label L499)
  use `alertColor`. Page threads `archived` into `race` at BudgetDetailPage:635.
  Same two-tier severity mirrored in the hero "Pace today" KPI tile (`factColor`
  gained a `warn` case). Verified consistent.
  - NOTE (Low, pre-existing): the budget CEILING line (EnvelopeSpendChart:287) is
    still hardcoded `var(--expense, #ef4444)` and is NOT muted for archived. It's a
    static reference marker, not a state alarm, so arguably fine — but it's the one
    red thing left un-muted on an archived monthly envelope with a budget.

- **Footnote YTD-vs-full-year asymmetry — FIXED.** `monthly` useMemo now exposes
  `windowMonths` (= index of first null in raw `thisYear`, i.e. elapsed months, or
  12 for a completed past year). Footnote slices `allocatedArr` to `windowMonths`
  before summing (`ytdAllocated`) so it compares like-window against `ytdSpent`.
  `monthly.windowMonths` is guaranteed present because the footnote only renders
  under the `!monthly || !hasData ? empty : ...` gate — the `?? 12` fallback is
  defensive dead code. Verified.

- **Personal-space UUID (pre-existing, not this diff).** `/s/me/budgets/:envelopeId`
  renders BudgetDetailPage with `space.id === "me"`; every analytics query
  (`envelopeUtilization`, `envelopeRecentAverages`, `yearOverYear`, and now
  `envelopeMonthlyAllocations`) sends `spaceId:"me"` which fails server
  `z.string().uuid()`. BudgetsPage has the same pattern, so the whole budgets
  feature is presumably just not surfaced under `/s/me`. The NEW procedure has no
  `personal.*` twin, but neither does the page work in personal mode at all — so
  it's not a fresh regression. Verify whether personal nav ever links here.

## Round-5 (2026-08-01) — `EnvelopeMonthlyBars` became clickable
`onSelectMonth` / `selectedMonthIdx` / `navUntilIdx`; full-height absolute
`<button>` per navigable column, driving the page's own `monthOffset`.

- **The offset math is CORRECT.** `(monthlyBarsYear − getAppTzYear(now)) * 12 +
  (monthIdx − getAppTzMonth(now))` round-trips exactly. Verified against the real
  `dates.ts` for 9 view-offsets × every navigable month, incl. across a year
  boundary → 0 failures. `Math.min(0, offset)` is **unreachable** (dead
  defensive code): if `monthlyBarsYear === nowYear` then `navUntilIdx` caps
  `monthIdx <= nowMonth`, else `offset <= −1`.
- **`monthly.year` vs `monthlyBarsYear` cannot disagree**: `yoyQuery` has NO
  `placeholderData`, so a query-key year change makes `data` undefined and the
  chart is replaced by a `Skeleton`. Don't flag the label/nav year mismatch.
- **LIVE: `onSelectMonth` is passed for ROLLING envelopes too** (`if (!isGoal)`),
  but the header month stepper is deliberately gated on
  `envelope.cadence === "monthly"` ("a stepper there would disagree with
  itself"). So on a rolling envelope the chart is an invisible month nav: the
  donut sub still says "By category **this month**", the pace chart subtitle
  "**This month** only — the totals above are your all-time rolling pool",
  `VelocityViz`'s hard-coded "This month"/"Last month" rows, and the hero's
  "avg per day this month" / "this month" all keep the deictic copy while the
  data has moved. No month label is rendered anywhere for rolling.
- **LIVE: the month-label `<span>`s have no `pointer-events-none`** (unlike
  `YoYBars` in TrendsView, where the omission was fixed with an explicit
  load-bearing comment). Labels sit at `top: h − p + 4 = 196` and the buttons
  span `0 … h − p + 16 = 208`, both `position:absolute` with `z-index:auto`, and
  the labels come LATER in DOM order → they are the topmost hit target. Clicking
  the month abbreviation does nothing. (Y-tick labels are at `xPct(p − 4)`,
  left of button 0, so they don't overlap.)
- **LIVE: the buttons are not `hidden … sm:block`** (YoYBars' buttons are).
  Touch events bubble from the button, so a mobile tap fires `onTouchStart`
  (tooltip), `onTouchEnd` (clears it) AND `onClick` (navigates) — the touch
  tooltip becomes unreachable for every past month and every tap navigates.
  `touchAction: "pan-y"` on the container still applies (touch-action is
  resolved up the ancestor chain), so that part is fine.
- No `navFromIdx` equivalent, so months before the envelope's first data are
  navigable.
- Click targets DO align in `bulletMode` (`cx = p + i*cw + 5`, `bw = cw − 10`,
  button = the full column).
- Cosmetic divergence: `YoYBars` draws its selection band inside the SVG *behind*
  the bars; this one puts the tint on the button, i.e. a 7% wash *over* them.
- Pre-existing, still live: `velocity`'s loop (line ~164) still uses
  `Math.max(daily.periodLength, prv.length)` and divides `prvAtToday` by `today`
  rather than `min(today, previousLength)` — the exact bug TrendsView fixed.
  `race.prv` can now be `[]`; see [[previous-array-can-be-empty]].

## Round-6 (2026-08-01) — round-5 chart items FIXED, movers section added
- FIXED: `pointer-events-none` added to both the month-label and y-tick spans;
  `onSelectMonth`/`selectedMonthIdx` now gated on `isMonthlyCadence`. Don't
  re-flag either. Buttons are still not `sm:`-gated (mobile tap navigates).
- Hover tooltip is driven by `onMouseMove` on the CONTAINER div, so the overlay
  buttons do NOT swallow it (events bubble). Don't flag that.
- `height: h - p + 16` on the nav buttons is safe: the container has a fixed
  `height: h` px and the SVG is `preserveAspectRatio="none"`, so y is 1:1 px.
- LIVE: `VelocityViz`'s `perDayTypical = avgAcc / (periodLength * bucketDays)`
  (whole-period rate) while the same page's "…above/below your typical pace by
  now" narrative uses `avg[today-1]` (elapsed). TrendsView deliberately moved
  its twin to `typicalSoFar / (TODAY * BUCKET_DAYS)`; this page did not follow.
- LIVE: the movers section's `ed-row3-sub` ("… vs all of MMM yyyy") is
  unconditional while `MoversList` silently switches to its ranking branch —
  see [[movers-list-shared]].

**How to apply:** when reviewing this section, check footnote text + empty-state
gate branch on `bulletMode`/cadence the same way the chart body does, check any
NEW alarm visual added to child charts is mutable for archived envelopes, and
check that any new affordance that moves `monthOffset` is gated on the same
`cadence === "monthly"` condition the header stepper is.
