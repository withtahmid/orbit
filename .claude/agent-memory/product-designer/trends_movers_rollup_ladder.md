---
name: trends-movers-rollup-ladder
description: Trends movers rolls spend up a three-rung ladder (top-level areas → selected categories → direct children when exactly one is selected); the semantics are right but the card's sub-copy only describes rung 1.
metadata:
  type: project
---

**The ladder (both `trendsCategoryMovers` twins, 2026-08-01):**

| Filter state | Roll-up seed | Rows are |
| --- | --- | --- |
| 0 categories | `parent_id IS NULL` | top-level areas, each including its whole subtree |
| 2+ categories | `id = ANY(selected)` | the selected categories, each including its subtree |
| exactly 1 category | drill query, seed = direct children of it | the selected category's direct children |

**Why the ladder is coherent:** it always answers "which bucket at the
granularity I'm currently looking at moved most", and it never labels a row
with a category whose amount it doesn't fully carry. Rolling *past* a selected
category would print "Food 577" when Food's real subtree is 997 (only Produce
and Meat & Fish were selected) — the reason `rollupSeed` stops at the
selection. Matches `categoryBreakdown`'s subtree convention, so the two
surfaces' numbers now reconcile for the same window; before the roll-up, a
parent row *excluded* its children and the totals disagreed with the
Spending-by-category tree. The owner caught the old behaviour by eye.

**Standing copy gap:** the card sub-copy says "Top-level categories with the
largest change vs {prev}, including everything tagged beneath them." That is
true only at rung 1. With 2+ selected the rows are the *selected* categories,
which can sit at any depth. Copy must key off the filter state, not just
`mode === "drill"`.

**Deliberate non-obvious choice:** `roots_all` is **not** scoped to the space.
Spending is scoped by `space_accounts`, never by `transactions.space_id` (that
column is a categorization tag — cash-flow rule §12), so an in-scope row can
carry another space's category. Scoping the recursion made those rows fall
back to their raw leaf, mixing un-rolled foreign leaves with rolled-up local
roots. `parent_id` never crosses spaces, so unscoped is still correct. Don't
"tighten" this.

Related: [[trends_movers_bar_normalised]], [[category_ancestry_display_canon]],
[[analytics_categories_classification_only]].
