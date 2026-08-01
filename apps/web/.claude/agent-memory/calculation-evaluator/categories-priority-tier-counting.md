---
name: categories-priority-tier-counting
description: CategoriesPage priority/tier counting invariants — proven equalities (priorityCounts sum, section.count, walkTier descendants) and the two chip semantics that intentionally differ between tree and priority mode
metadata:
  type: project
---

Audited the `fix/catrgories-priority` rewrite of `apps/web/src/pages/space/categories/CategoriesPage.tsx` (tree/priority view modes, tier bands, masonry cards). Verified by porting the logic and running 400 randomized acyclic trees; all of the following held with zero counterexamples.

**Proven-true invariants (do not re-litigate):**
- `effectivePriorities` (top-down walk from `roots`) == `n.priority ?? resolveInherited(n.parent_id, byId)` for every node reachable from `roots`. The children-links walk and the parent_id walk are exact inverses because `buildTree` only links a child when `byId.has(parent_id)`.
- `sum(priorityCounts) === categories.length` unconditionally (all 5 buckets pre-zeroed; `?? "none"` catches both `null` and `undefined`).
- Unfiltered, `section.count === priorityCounts[tier]` for all 5 tiers **iff every category is reachable from roots**.
- `walkTier`'s `row.descendants = acc.length - before` (with `before` captured *after* the row push) is exactly the count of contiguous rows below it at greater depth in the same card — never siblings, never a later sibling's recursion. Depth ≥ 1 recursion can never create a new card, so `groups[groups.length-1]` stays the row's own card throughout.
- `byCardSize`'s `rows[0]` is always the card's depth-0 root and never undefined (tree mode gates on `acc.length > 0`; `visibleIds` is ancestor-closed so a visible descendant implies a visible root; priority mode pushes the row immediately after `groups.push`).

**The one structural gap: nodes unreachable from `roots`.** A `parent_id` cycle (or a subtree hanging off one) is excluded from `effectivePriorities`, so it counts as `"none"` in `priorityCounts` and in `matchIds`, but renders in no band and no card. Result with a 2-cycle: footer "No priority" chip says 2, the "No priority" band is omitted entirely, and filtering to `none` renders the "Nothing matches" empty state while the `role="status"` line simultaneously announces "2 matches · no priority". The in-code comment calling this "harmless" is optimistic. **Why it is only latent:** `expenseCategory.changeParent` blocks self-parent and rejects cycles under `FOR UPDATE` locks on both endpoints with a recursive up-walk (depth-capped at 100), so cycles require pre-existing corrupt data. `resolveInherited` also returns the node's *own* priority when `parent_id === id`, but that path is unreachable (self-parent nodes never render, so they can never be selected).

**Two chip semantics, same-looking chip.** Tree mode sets `descendants: countDescendants(n)` (whole-subtree, data-truth, independent of expansion/filter); priority mode sets rows-in-this-card. Same tooltip string "N nested categories". Food>{Groceries(luxury),Restaurants}, Groceries>Milk: tree mode shows Food chip=3, priority mode shows Food chip=1. Also in tree mode `hasChildRows: n.children.length > 0` contradicts its own doc comment ("children that are also rows in the same section") — searching "food" renders Food alone with chip=3 and `aria-expanded="true"` and zero child rows in the DOM.

**`matchCount` is strict matches only**, by design (`matchIds` vs ancestor-closed `visibleIds`). Priority mode renders exactly `matchCount` rows (ancestors are never lifted in, only flattened into `pathLabel`); tree mode renders matches + ancestor context rows, so the announced count is legitimately below the visible row count there.

**How to apply:** when reviewing this page again, spend effort on (a) anything that widens the unreachable-node gap, and (b) the chip/tooltip ambiguity — the arithmetic itself is settled. Related: [[categories-delete-gating-txcount]].
