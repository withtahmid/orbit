---
name: trends-movers-bar-normalised
description: The Trends "Biggest movers" bar went through four rejected designs before landing on a normalised (share-of-own-prior-spend) diverging bar; records why, the owner's two stated needs, and the dissonance that remains (sorted by absolute, drawn as relative).
metadata:
  type: project
---

**Decision (2026-08-01, round 4, `fix/analytics/trends`):** the movers bar plots
`min(100, |deltaPct| * 100)` — each category's change as a share of **its own**
prior spend — diverging about a centre axis, half-track = 100%. Absolute change
is text in the `Change` column. `MoversList` in `TrendsView.tsx`.

**Four designs the owner rejected, in order — do not re-propose:**
1. Diverging bar of *absolute* change scaled to `maxAbsDelta`. Killed by real
   data: one category went 719 → 35,294,543, flattening every other bar.
2. Two per-row before/after bars on a row-local scale. Owner: "ugly", and
   row-local scaling means bar length carries no cross-row meaning.
3. Diverging absolute change with an outlier-trimmed cap + clipped leader.
   Needed a data-derived cap, an off-scale mark and a footnote to explain both.
4. Range bar (grey head = unchanged base, coloured tail = the change) on a
   shared spend scale. Owner: "very hard to observe the color change on same
   bar, and also its hard to interprete."

**Why normalising won:** a share is bounded by construction, so one axis stays
legible however lopsided the data — no cap, no trimming, no quantiles. It is
the only encoding that survives a 5-orders-of-magnitude spread on one row set.

**The residual dissonance, accepted knowingly:** the list is *sorted* by
`|deltaAmount|` (server-side, both twins) but the bar draws *relative* change,
so bars do not descend under a heading that says "Biggest". Resolution taken:
keep the sort (absolute money is what a user acts on), keep the bar, and make
the table legible instead — bar in its own axis-labelled column, absolute
amounts in their own column, footnote naming what a full half-track is worth.
Do NOT "fix" it by sorting on `deltaPct`: that promotes 40 → 400 above
200,000 → 300,000 and makes the section useless.

**Known false equivalence in this encoding:** the server reports
`deltaPct = 1` when `previousTotal === 0`, so a brand-new category ("New")
draws an identical full-half solid bar to a category that exactly doubled.
Two different facts, one mark. Needs a distinct treatment (open/hatched outer
end, or treated as off-scale) rather than a solid rounded bar.

**Two needs the owner stated that the design must keep serving:** (a) the
absolute-scale bar was "usefull" — absolute magnitude must stay readable
somewhere; (b) they wanted a prev-vs-current *visual*. Final design serves (a)
as text and (b) only via the `was → now` text column. If a future round
reopens this, add a second visual for the absolute axis rather than replacing
the normalised one.

Related: [[trends_view_period_history_shipped]],
[[category_ancestry_display_canon]], [[trends_movers_rollup_ladder]].
