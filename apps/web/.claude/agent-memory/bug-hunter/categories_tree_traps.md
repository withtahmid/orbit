---
name: categories-tree-traps
description: Category tree (CategoriesPage + expenseCategory procedures) — cycle-safety gaps and derived-dirty phantom pattern.
metadata:
  type: project
---

The /categories page (`apps/web/src/pages/space/categories/CategoriesPage.tsx`) builds a client-side tree from a flat list and reparents via `expenseCategory.changeParent`.

Recurring traps to check on any change here (as of the 2026-07 round-3 review, all previously-flagged items are FIXED — verify they stay fixed):

- **Server cycle guard now IS concurrency-safe (round-3).** `changeParent.mts` locks both endpoints with `SELECT id FROM expense_categories WHERE id IN (categoryId,parentId) ORDER BY id FOR UPDATE` before the depth-capped `WITH RECURSIVE` cycle walk. Reciprocal concurrent moves (A→B + B→A) now serialize; the loser's cycle check sees the committed parent change and rejects. Deadlock-free even if PG doesn't honor ORDER BY for lock order, because both queries are structurally identical over the same row set (pairs sharing ≤1 row can't cycle). `buildTree` still silently ORPHANS a persisted cycle if one ever exists — keep that in mind.
- **Tree helpers HAVE visited-guards.** `subtreeIds`, `countDescendants`, `ancestorIds`, `inheritedPriority`, and `searchVisible`'s ancestor walk all carry seen-Sets — verified correct. `ancestorIds` also now requires `byId.has(parent)` so phantom parent_ids never emit a fake ancestor. Keep any new walk guarded.
- **Derived-dirty phantom — fixed by dedicated parentId sync effect** (unchanged from round-2, still correct).
- **Inspector `save()` now invalidates in `finally`** (round-3) — partial-failure divergence fixed.
- **Dirty-nav guard (round-3, verified correct).** Page holds `inspectorDirty` + `pendingAction`; `guardDirty` gate is `inspectorDirty && selected && !creating`. Inspector reports via `onDirtyChange` (setState, stable identity) with `[dirty]` effect + unmount cleanup `onDirtyChange(false)`. Keyed remount is safe: React runs old-cleanup(false) before new-setup, and a freshly-mounted Inspector is pristine, so the flag is never wrongly wiped. Create form intentionally discards freely (Escape/cancel skip the guard).
- **`tx_count` vs delete FK mismatch (round-3, LOW, still present by design).** `listBySpaceWithUsage.tx_count` counts only `type='expense'` rows, but `delete.mts`'s friendly guard AND the FK (`transactions.expense_category_id`, NO ACTION) cover ALL types. Migration 0013's CHECK only forces the column NOT NULL *for* expense rows — it does not forbid non-expense rows carrying one. So a category referenced solely by a non-expense row shows "Never used — safe to delete" (button enabled) yet the server rejects with the friendly BAD_REQUEST. No corruption (FK protects), only advisory UX. In normal data these agree.
- **delete-vs-changeParent race — CLOSED (round-4, feat/category-enhanchment).** `delete.mts` now takes `.forUpdate()` on the `current` SELECT (the row being deleted) at the START of its transaction. changeParent locks `WHERE id IN (categoryId,parentId) FOR UPDATE`, which always includes the deleted row when it's either endpoint of the move — so any move touching B serializes on B's row lock held by delete-B for its whole transaction. A move can no longer commit between delete's friendly guards and its DELETE, so the friendly BAD_REQUEST fires instead of an FK 500. The child/tx guard SELECTs still lack their own FOR UPDATE but don't need it — the `current` lock is the serialization point. No deadlock, integrity safe.

**Why:** these are the load-bearing correctness surfaces found across the 2026-07 category-enhancement rewrite and its round-2/round-3 fixes.
**How to apply:** re-audit these helpers, the `save()` partial-failure path, and the changeParent concurrency window whenever the tree, drag-drop, or inspector logic changes.
