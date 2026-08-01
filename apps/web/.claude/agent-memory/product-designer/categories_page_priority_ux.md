---
name: categories-page-priority-ux
description: CategoriesPage Tree⇄Priority band view review (2026-08-01) — what shipped, why the band counts mislead, the drag-in-priority-mode hazard, and the view-state persistence call.
metadata:
  type: project
---

`apps/web/src/pages/space/categories/CategoriesPage.tsx` (branch
`fix/catrgories-priority`, reviewed 2026-08-01). The four tier buttons in the
inspector and create panel were **dead — no `onClick`** — so no user had ever set
a tier from this page; only "None" worked. Replaced with a shared radio-based
`PrioritySelect`. Also added: letter badges (E/I/D/L, solid = set here, dashed =
inherited), a footer legend that doubles as a tier filter with counts, and a
**Tree ⇄ Priority toggle** where priority mode stacks a full-width band per tier.

**Design judgments from that review (hold these unless the owner reverses them):**

1. **Band view is the right shape but measures the wrong thing.** It counts
   *categories* per tier; the downstream question (`PriorityView`) is *money*
   must-vs-want. `listBySpaceWithUsage` already returns `tx_count` per category,
   so band headers and legend chips should read "N categories · M transactions"
   — turns a taxonomy inventory into a coverage audit with no server change.
   Rejected alternative: replacing the tree with a sortable flat table. The tree
   is where inheritance is legible, and inheritance is the model's core.
2. **Drag in priority mode is a hazard.** `draggable={isOwner}` is not gated by
   view mode, so dragging a row onto a row in another band **re-parents** it
   while looking like "move it to that tier". Recommendation: in priority mode
   make band headers the drop target (= set tier, the missing bulk affordance)
   and disable row-to-row drops.
3. **Cascade is unpreviewed.** `childInherits` reads the *saved* `node.priority`,
   so `ChildrenSection` badges don't move when you change the picker. Wanted: draft-
   following badges + a count in the field hint ("N of M subcategories will
   follow this"). Explicitly **do not** add a confirm dialog — priority is
   reversible and rewrites no history.
4. **Persistence: use URL params, not localStorage.** The sibling category
   surface (analytics `CategoriesView` Tree⇄Flat) already keeps view mode in a
   URL flag; `?view=priority&tier=none` is also shareable, which matters in
   shared spaces where the owner does the tagging. URL is inherently per-space,
   which settles the per-space-vs-global question. Current code uses a global
   `orbit.categories.viewMode` localStorage key and does not persist the filter.
5. **Tree-mode filtering shows uncounted context rows.** `visibleIds` = matches +
   ancestors, so filtering to "No priority" renders tiered ancestors (with
   badges) alongside the 7 the live region counts. Mute non-`matchIds` rows
   rather than restructure.
6. Mobile footer rule hides the `dashed = inherited` key but keeps "Drag rows to
   re-nest" — backwards, since HTML5 DnD doesn't fire on touch at all.
7. Priority mode reuses the descendants count-chip for *within-band* children but
   keeps the tooltip "N nested categories", which misstates the tree.
8. Bands are `role="none"` with `aria-hidden` headers inside `role="tree"`, so the
   tier grouping doesn't exist for screen readers; `role="group"` +
   `aria-label` on the band is the fix.

Related: [[priority-tiers-two-palettes]], [[project-category-lifecycle-gaps]].
