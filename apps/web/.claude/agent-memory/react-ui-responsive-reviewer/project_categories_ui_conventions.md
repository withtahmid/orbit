---
name: categories-ui-conventions
description: /categories master-detail workbench (CategoriesPage.tsx) — CSS multicol masonry, priority bands + view-mode toggle, slide-over stacking, OrbitField-label trap, toolbar width budget; 5 rounds
metadata:
  type: project
---

`src/pages/space/categories/CategoriesPage.tsx` is a self-contained master–detail workbench: left tree pane (`role=tree`, keyboard nav, drag-drop reparent) + right inspector/create panel. All CSS lives in the `CT_STYLES` template string at the bottom (ends ~line 2532).

**Overlay breakpoint is 1079px** — kept in sync between the JS `matchMedia("(max-width:1079px)")` and CSS `@media (max-width:1079px)`. At ≥1080 the inspector is an inline 400px flex column (always occupies its 400px even when empty, so selecting never reflows the tree). At ≤1079 it becomes a fixed slide-over (`z-40` panel / `z-39` scrim — deliberately BELOW Radix z-50 so Create's ConfirmDialog stacks above). Scrim (`z-39`, fixed, root stacking context) paints above `.sl-mobile-header` (`z-index:5`) so it fully covers the mobile header.

**Layout = CSS multicol masonry:** `.ct-groups { columns: 3 260px }`, `.ct-group` cards `break-inside: avoid`, one card per top-level root. Column count by width (tree = viewport − 462 when inline): ~1 col ≤640, 2 cols at 1280, 3 cols at 1440/1920 (capped at 3). 1080↔1079 boundary jumps tree from full-width (3 col) to 618px (2 col) — acceptable deliberate reflow. Inherent tradeoffs: cards jump columns on expand/collapse (balance recomputes); a single huge root group (500 rows) can't break → lopsided columns but scrolls fine. **Keyboard Arrow order follows DFS, not visual column order** — on 2-3 col layouts ArrowDown can jump selection to another column (only bites wide/mouse screens; narrow is single-col). Not virtualized.

**Rounds 1-4 FIXED & verified clean this pass:** slide-over stacking below Radix; dialog semantics + Escape + scrim; `aria-activedescendant`+`id=ct-item-<id>`; overflow-x hidden; touch targets in `@media (hover:none)` now bump chevron/row-btn/tool-btn/insp-close to 40px, savebar/danger/child-row/pri-choice sized, grip hidden, rows 44px; safe-area insets present (`.ct-insp-head padding-top: max(16px, env(safe-area-inset-top))`, `.ct-savebar padding-bottom: max(10px, env(...bottom))`); inert applied JS-side to `.sl-aside`/`.sl-mobile-header` (document-level reach) + JSX inert on topbar/tree-pane; all major animations reduced-motion guarded (slide transform, scrim opacity, savebar rise, skeleton pulse); no meaningful text on `--fg-4` (only decorative icons/grip/arrows). Skeleton mirrors multicol footprint.

**Remaining minor open items (last pass):**
- **iOS zoom gap:** `.ct-search-input { font-size:16px }` is gated ONLY to `@media (max-width:640px)`. Touch devices wider than 640 (landscape phones, tablets 641-1194px) fall through to 13px → iOS Safari zoom-on-focus. Fix: also set 16px inside the `@media (hover:none)` block.
- No focus **wrap** in the overlay dialog (background IS inert, so focus can't reach page content, but Tab from last control escapes to browser chrome instead of cycling). Acceptable; add wrap for strict WCAG.
- `.ct-insp-crumb` breadcrumbs don't truncate — a very long ancestor name in the 296px overlay can wrap awkwardly / a long word overflow.
- `.ct-root height: calc(100dvh - 53px)` hardcodes the mobile-header height (currently correct: 10px pad ×2 + 32px content + 1px border); drifts if header padding changes.
- No print stylesheet: fixed `100dvh` + `overflow:hidden` clips to one viewport when printed (not a print target).

**Reusable trap — OrbitField renders as `<label>` wrapping children** (`OrbitModalShell.tsx` ~line 193: `const Tag = noWrapperLabel ? "div" : "label"`). The opt-out prop is **`noWrapperLabel`** (earlier notes called it `interactiveHint` — that name is gone). Without it, clicking the field's label text activates the first control inside, which for the Priority radio list means silently selecting "None". Both Priority + Style fields pass it.

**Toolbar width budget (`.ct-tree-toolbar`, the tightest place on the page).** Every child except `.ct-search` is `flex-shrink: 0`, so the search input is the only thing that gives — it never overflows, it just starves. At 375px, content width = 375 − 24 (`.ct-body` padding ≤640) − 2 (card border) − 24 (toolbar padding) = **325px**. Fixed costs: `.ct-mode` icon-only = 76px (2×34 + 2 gap + 4 pad + 2 border), each `.ct-tool-btn` = 34px / **40px under `@media (hover:none)`**, gaps 8px. Tree mode (mode toggle + 2 bulk buttons) leaves the search **145px → 101px of input, 61px once the 32px clear button appears**. Any new toolbar control must be paid for out of that 101px.

**`@media (hover: none)` vs `@media (max-width: 640px)` — the recurring gate bug.** Touch sizing bumps in this file live in `hover:none` (correct: catches iPads and landscape phones); but `.ct-search { height: 40px }` and `.ct-mode { height: 40px }` are *also* declared under `max-width: 640px`. Anything sized only in the 640px block is 34px on a touch device wider than 640 → sub-44px targets plus a visible height mismatch against its 40px neighbours in the same flex row. Same class of bug as the old `.ct-search-input` iOS-zoom miss.

**Multicol per band is sound — do not "fix" it.** `columns: 3 260px` derives its used column count from available width only, never from content, so every `.ct-band`'s `.ct-groups` gets identical column geometry and cards line up band-to-band. A 1-card band renders as one normal-width card at the left with dead space to its right; that is standard masonry appearance, not a defect. Forcing `columns: 1` for short bands would stretch the lone card to full width and strand `.ct-row-actions` ~800px from the name (the exact thing the 260px minimum exists to prevent).

**`.ct-row-name` truncation budget is ~112px** at a 1440px viewport / 309px column (row content 285px − chevron 22 − avatar 28 (`EntityAvatar size="sm"` is `size-7`, i.e. **28px, not 20**) − count chip 24 − badge 17 − actions 40 − 5 gaps). It is a single `white-space: nowrap; text-overflow: ellipsis` run, so any *prefix* added inside it (breadcrumb, tag) is spent before the category name and the name is what disappears.

**Dirty-discard:** Inspector `dirty` shows a save bar; scrim click / Escape / selecting another node are all routed through `guardDirty` → ConfirmDialog (no longer silent).
