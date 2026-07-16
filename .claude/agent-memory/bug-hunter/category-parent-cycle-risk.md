---
name: category-parent-cycle-risk
description: expense_categories.parent_id has no DB-level or app-level cycle protection beyond self-parent; any new WITH RECURSIVE traversal can spin until statement_timeout
type: project
---

`expense_categories.parent_id` is a self-FK with ON DELETE RESTRICT but **no cycle prevention**.

- DB: migration `0012_create_expense_categories_table.mts` defines the FK only.
- App (UPDATED 2026-07-16): `procedures/expenseCategory/changeParent.mts` DOES now walk the ancestor chain (depth-capped recursive `chain` CTE) AND locks both endpoints `FOR UPDATE` in id order to serialize reciprocal A→B / B→A moves. So cycles are NOT creatable through the normal app path — a cycle can only exist via direct DB manipulation / pre-existing corruption.

**Why:** The server CTEs and readers defend against a *pre-existing corrupt* cycle, not one creatable in-app.

**Server hardening now COMPLETE (verified 2026-07-16, heatmap-fix branch):** both `trendsFilters.buildSelectedCategoriesCTE` AND the sibling `tree AS (... UNION ALL ...)` closures in `categoryBreakdown.mts`, `personal/categoryBreakdown.mts`, and the new `categoryMonthlyTrend.mts` / `personal/categoryMonthlyTrend.mts` now all carry a `path` array + `NOT (ec.id = ANY(path))` guard. The unguarded-`tree` asymmetry noted previously is FIXED.

**Remaining gap — CLIENT side:** `apps/web/src/pages/space/analytics/components/CategoryMultiSelect.tsx` builds its tree with `countDescendants(id)` + `walk(parentId, depth)` that recurse over `byParent` with **no** visited/path guard. A corrupt parent_id cycle in the category data would infinite-recurse → stack overflow, white-screening the filter dropdown + CategoriesView trend picker. Not reachable via normal flow (changeParent blocks creation), so Low severity — but it's the one category-tree walker in the codebase still missing the guard the rest applies defensively.

**How to apply:** New recursive CTE over `expense_categories` → confirm it carries the `path`/`NOT (... = ANY(path))` guard (the template now does). New client-side tree walk over category rows → add a visited-set guard to match.
