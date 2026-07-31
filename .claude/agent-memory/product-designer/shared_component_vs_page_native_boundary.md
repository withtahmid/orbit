---
name: shared-component-vs-page-native-boundary
description: The rule for when a visual may be reimplemented page-native in `.orbit-design` versus extracted into a shared component — chrome is page-native, anything carrying cross-row or cross-page invariants is a component. Derived from the movers-list reversal.
metadata:
  type: feedback
---

**Rule: page-native styling is right for chrome and wrong for a data
encoding.** A card, heading, sub, divider or padding may be reimplemented in
each page's own idiom (`.orbit-design` / `od-card` / `.display` on the budget
pages, shadcn `Card` on analytics). Anything whose correctness depends on an
invariant holding *across rows* or *across pages* — a shared axis, a shared
centre, a shared scale, clip semantics, label thresholds — must be one
component.

**Why:** I endorsed a page-native `.orbit-design` movers list in round 5. It
drifted before it shipped: each row became its own grid container with an
`auto` column, so every row's diverging bar had a different centre, destroying
the one property ("one shared axis") that made the encoding readable at all.
The owner's correction was *"Make it look like the one on 'Spending trends'
page exactly."* Invariants do not survive reimplementation; surface treatment
does.

**How to apply:** shared list + per-page chrome is the right boundary (see
`MoversList` in `apps/web/src/features/analytics/`). Two things to check
whenever that boundary is used:
- **Tokens.** `.orbit-design` redefines only a subset of tokens (notably
  `--income` / `--expense`); everything else falls through to the app theme.
  That is a *feature* — the same component picking up each scope's palette is
  why it's a component and not a hardcoded hex. But check for collisions: a
  token that is neutral on one page can be semantic on the other (e.g.
  `--warning` reads as "no comparison" in the movers list but as a severity
  level on the budget gauge's traffic light).
- **Mode contradiction.** When the shared component switches internal mode
  (comparison ⇄ plain ranking), the page-owned chrome must switch with it, or
  the heading promises a comparison the list isn't drawing.

No seam concern from Tailwind-utility markup inside an `.orbit-design` card:
`EnvelopeMonthlyBars`, `Skeleton` and the donut already do this on
`BudgetDetailPage`. That precedent is established; don't relitigate it.

Related: [[trends_movers_bar_normalised]], [[budget_detail_severity_and_donut_legend]],
[[semantic_color_tokens_are_load_bearing]].
