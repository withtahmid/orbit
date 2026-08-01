---
name: categories-tree-traps
description: Category tree (CategoriesPage + expenseCategory procedures) — cycle-safety gaps, derived-dirty phantom, and the view-mode/filter/keyboard invariants that keep breaking.
metadata:
  type: project
---

The /categories page (`apps/web/src/pages/space/categories/CategoriesPage.tsx`) builds a client-side tree from a flat list and reparents via `expenseCategory.changeParent`.

Recurring traps to check on any change here (as of the 2026-07 round-3 review, all previously-flagged items are FIXED — verify they stay fixed):

- **Server cycle guard now IS concurrency-safe (round-3).** `changeParent.mts` locks both endpoints with `SELECT id FROM expense_categories WHERE id IN (categoryId,parentId) ORDER BY id FOR UPDATE` before the depth-capped `WITH RECURSIVE` cycle walk. Reciprocal concurrent moves (A→B + B→A) now serialize; the loser's cycle check sees the committed parent change and rejects. Deadlock-free even if PG doesn't honor ORDER BY for lock order, because both queries are structurally identical over the same row set (pairs sharing ≤1 row can't cycle). `buildTree` still silently ORPHANS a persisted cycle if one ever exists — keep that in mind.
- **Tree helpers HAVE visited-guards** — `subtreeIds`, `countDescendants`, `ancestorIds`, `resolveInherited` (extracted from the old inline `inheritedPriority`) and the filter's ancestor walk all carry seen-Sets. **The three render walkers do NOT** (`effectivePriorities`' `walk`, `sections`' tree-mode `walk`, `walkTier`). That is safe *only* because a `parent_id` cycle is unreachable from `roots` (every cycle member's parent is in the cycle, so none is a root and none is a non-cycle node's child). Any change that starts a walk from something other than `roots` needs a guard. The file's "All tree walkers carry visited-guards" comment (~line 129) is now inaccurate.
- **Derived-dirty phantom — fixed by dedicated parentId sync effect** (unchanged from round-2, still correct).
- **Inspector `save()` invalidates in `finally`** (round-3) — partial-failure divergence fixed. Server `update.mts` accepts `priority: null` (`.nullable().optional()`), so clearing a tier round-trips; don't "fix" `fieldPatch.priority = null`.
- **Dirty-nav guard (round-3, verified correct).** `inspectorDirty` + `pendingAction`; gate is `inspectorDirty && selected && !creating`; keyed remount is safe.
- **`tx_count` vs delete FK mismatch (round-3, LOW, by design)** — advisory UX only, FK protects integrity.
- **delete-vs-changeParent race — CLOSED (round-4).**
- **Card sort key must be expansion- and filter-independent (round-5, `fix/catrgories-priority`).** `byCardSize` sorts masonry cards by *visible* `rows.length`, and the tree-mode row set depends on `expanded` + the active filter — so expanding one node or typing a character re-sorts every card and the masonry jumps under the cursor. Any card ordering must key off something stable (e.g. `countDescendants(root)`), never the rendered row count.
- **`filterActive` vs `chevronLocked` are NOT interchangeable (round-5).** `chevronLocked = filterActive || viewMode === "priority"` is what actually decides "rows are force-open, expansion state is inert". `handleTreeKeyDown`'s ArrowLeft/ArrowRight still branch on `filterActive`, so in priority mode they toggle invisible `expanded` state instead of navigating. Whenever a new "computed visible set" mode is added, every `!query` / `!filterActive` guard has to be re-audited against `chevronLocked`.
- **Row-level "has children" must mean "has *rendered* child rows" (round-5).** `VisibleRow.hasChildRows` exists for this, but tree mode still sets it to `n.children.length > 0` (unfiltered), and `handleTreeKeyDown` reads `n.children.length` directly. Result: `aria-expanded="true"` on rows with zero rendered children, and arrow keys that disagree with the chevron. Same class of bug as the `descendants` chip counting unfiltered descendants.
- **Priority mode fragments the hierarchy, so anything that jumps to `parent_id` can land on a non-rendered node** (parent lives in another tier band, or is filtered out by `matchIds`). `selectedIsRendered` then drops `aria-activedescendant` and `rows.findIndex` returns -1, so the next ArrowDown teleports to row 0.
- **`walkTier`'s group-push invariant is sound — verified, don't "fix" it.** `groups[groups.length-1]` can never be empty at depth>0: depth only increases via the post-member-push recursion, and the non-member branch preserves depth. New groups are only pushed at depth 0, so the `acc` reference captured before recursing stays valid and `row.descendants = acc.length - before` is exact. A node is a member of exactly one tier band (`effectivePriorities.get(id) ?? "none"` is single-valued), so no duplicate React keys or duplicate `ct-item-${id}` DOM ids.
- **Footer/legend counts are computed over ALL categories** (`priorityCounts`), while band counts are post-filter — the two disagree whenever a text search is active.

**Why:** these are the load-bearing correctness surfaces found across the 2026-07 category-enhancement rewrite and its round-2/3/4/5 fixes.
**How to apply:** re-audit these helpers, the `save()` partial-failure path, the changeParent concurrency window, and the `filterActive`/`chevronLocked`/`hasChildRows` triple whenever the tree, view modes, drag-drop, or inspector logic changes.
