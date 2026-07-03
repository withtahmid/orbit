---
name: categories-delete-gating-txcount
description: CategoriesPage delete gating uses expense-only tx_count, but server delete guard counts transactions of ANY type — latent divergence
metadata:
  type: project
---

CategoriesPage delete gating (`node.tx_count > 0`, apps/web/src/pages/space/categories/CategoriesPage.tsx Inspector danger zone) derives from `expenseCategory.listBySpaceWithUsage`, whose `tx_count` counts only `transactions` WHERE `type = 'expense'` (listBySpaceWithUsage.mts spending_rows CTE). The server `expenseCategory.delete` guard (delete.mts) checks `transactions WHERE expense_category_id = id` with **no type filter**.

Divergence: a category referenced only by non-expense rows carrying `expense_category_id` (income/transfer) shows `tx_count = 0` client-side → UI says "Never used — safe to delete" and enables Delete → server rejects with BAD_REQUEST "Transactions reference this category...".

**Why:** two independent count semantics (expense-only vs all-types) over the same FK.
**How to apply:** This is a KNOWN-LATENT, graceful failure (toast error, no crash, no data loss). It is only reachable if transaction create/update ever lets a non-expense row keep a non-null `expense_category_id`. The 2026-07 categories refactor (groups/masonry, cycle guards, breadcrumb chains) did NOT change tx_count's source or make this newly reachable. Don't flag as a new bug in category-page diffs; the true fix belongs at the transaction-write layer or by adding `type='expense'` to the delete guard's referencing check. Related: [[analytics-category-breakdown-invariants]].
