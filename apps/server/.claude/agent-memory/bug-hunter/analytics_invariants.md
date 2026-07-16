---
name: analytics-invariants
description: Load-bearing invariants in the analytics/personal procedures that, when violated, almost always signal a bug
metadata:
  type: project
---

Invariants worth checking whenever analytics/heatmap/category procedures change.

**Recursive category-tree CTEs need a `path` cycle guard.** `expense_categories.parent_id` has NO DB-side cycle constraint. Every `WITH RECURSIVE tree/selected_categories` over it must carry `ARRAY[id] AS path` + `WHERE NOT (ec.id = ANY(t.path))`, or a corrupt A→B→A chain spins to `statement_timeout`. In a proper forest the guard never fires, so it never changes result counts — safe defense-in-depth.
- **Why:** The authoritative cycle *prevention* lives in `expenseCategory/changeParent.mts` (depth-capped ancestor walk + `FOR UPDATE` lock on both endpoints, ordered by id → reciprocal concurrent moves serialize). That guard is genuinely sound (verified: adjacent moves in any would-be cycle share a locked endpoint, so the last committer sees the near-formed cycle). So the CTE guards are belt-and-suspenders, not closing a live hole.
- **How to apply:** If you see an unguarded `parent_id` recursion, flag it. If someone adds a *new* mutation surface that writes `parent_id` (anything besides create-with-no-children and `changeParent`), re-audit cycle safety there.

**`mode: cash|operational` uses an `xferFactor = mode==='cash' ? 1 : 0` multiplier** on the transfer-principal branch (shared convention: `cashFlow.mts`, `spendingHeatmap.mts` + personal twins). Transfer *fees* are first-class `type='expense'` rows (see `yearReport.mts`), so they're captured by the expense branch and correctly count in BOTH modes — never in the transfer branch.

**Operational-mode `spendingHeatmap` emits count-only zero-value rows** for days whose only activity was a cross-space transfer (`amount * 0`). Every consumer of the returned `byDay`/day list MUST guard `v > 0` (HeatmapView's `byWeekday`, `computeQuantileEdges`, month-tile totals all do). A new consumer that treats a returned day as "had spend" without the `v > 0` check would be wrong.
