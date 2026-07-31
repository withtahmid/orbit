---
name: category-ancestry-display-canon
description: ROOT (not immediate parent) is the canonical ancestor to surface next to a leaf category, because analytics defaults to root-level slices; and the three category pickers have three divergent search behaviours.
metadata:
  type: project
---

**Canon: when a surface shows a sub-category, the ancestor worth showing is the ROOT, not the immediate parent.**

**Why:** `analytics.categoryBreakdown` returns `directTotal` + `subtreeTotal` per node with a recursive `root` column, and `CategoriesView` with no drill focus renders **one slice per top-level category using `subtreeTotal`**. So the root is the only category label a reader can tie back to the headline analytics numbers. "Rice" appears in no chart; "Groceries" is a donut slice. Validated 2026-07-31 while reviewing the root-category line added to the transactions table.

**How to apply:**
- Surfacing the root next to a leaf is a real win, not decoration — but put it where mobile can see it too. The desktop table got it; `TransactionDetailsSheet` still renders `<Row label="Category">{name}</Row>` with the leaf only, and that sheet is the shared read surface for both breakpoints.
- Don't lean on a root **color dot** as the signal: new categories default to a single shared `DEFAULT_COLOR`, so a root dot is frequently the same color as the leaf avatar 20px to its left, and there is no root-color legend anywhere. Prefer the visible word "in <Root>" (the sr-only "in " already exists in the transactions table — make it visible and delete the divergence).
- For depth > 2 the root skips the middle level. Accepted: analytics' entry point is the root, so root beats full path for a one-line cell.

**Known inconsistency — three category pickers, three search behaviours.** Recurring anomaly area; check all three whenever one changes:
| Surface | Search result set | Match signal |
| --- | --- | --- |
| `components/shared/CategoryTreeSelect.tsx` (assignment picker: txn forms + CategoriesPage parent field) | matches + ancestors + **whole descendant subtree**; chevron suppressed | `font-medium` on whole name |
| `pages/space/analytics/components/CategoryMultiSelect.tsx` (filter bar) | **flat** name filter, no ancestors — but keeps `depth * 0.75rem` indent, so children render indented under no parent | none |
| `pages/space/categories/CategoriesPage.tsx` tree | matches + **ancestors only**, force-expanded, chevron visible-but-inert | `<mark>` substring `Highlight` + live-region match count |

The semantics genuinely differ (multi-select parent = includes subtree; tree-select parent = literally that parent), so the *result sets* may legitimately diverge. The **match signal and indent handling should not** — `CategoriesPage`'s `Highlight` + match count is the strongest of the three and is the one to standardize on. Related: [[analytics_categories_classification_only]].
