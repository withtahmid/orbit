---
name: click-a-period-to-open-it
description: "Click a bar to open that period" is now a canonical Orbit gesture on two charts (Trends YoY, envelope Monthly spend); the scope difference is fine, but the affordance must be gated on the host page actually having a visible period control.
metadata:
  type: project
---

**The gesture is canonical and the differing scope is fine.** On `TrendsView`
clicking a year-over-year month sets the analytics anchor (`?p`); on
`BudgetDetailPage` clicking a Monthly-spend column sets that page's
`monthOffset`. Both mean "show me that period" — the scope differs only because
the page differs, which is what a user already expects. Do not add
distinguishing chrome for the scope.

**Two rules the gesture must obey:**

1. **Only offer it where the page has a visible period control to land in.**
   `BudgetDetailPage` deliberately withholds its month stepper for
   rolling/goal envelopes (their hero is a lifetime pool, so a stepper would
   disagree with itself) — but the chart wired `onSelectMonth`
   unconditionally, so a rolling envelope got a one-way trip: the whole page
   re-priced to a past month with no ◀/▶, no month label, and only a 7% column
   tint as evidence. Because `monthOffset` is React state, reload was the only
   exit. Gate the callback on the same condition the stepper is gated on.
2. **Say it in copy.** Transparent full-height buttons over an SVG are
   undiscoverable. `TrendsView`'s YoY sub-copy says "Click any month to open
   it"; reuse that exact sentence rather than relying on `cursor-pointer` or a
   native `title` (which fights the chart's own hover tooltip for the same
   column).

**Known limit, acceptable:** in the two-year comparison mode only the
`yearThis` bar is navigable, so the prior-year bars beside it are inert; the
`aria-label` ("Show {Mon} {yearThis}") is honest about it and the year can
still be crossed with the stepper.

Related: [[period_selection_two_idioms]], [[trends_view_period_history_shipped]].
