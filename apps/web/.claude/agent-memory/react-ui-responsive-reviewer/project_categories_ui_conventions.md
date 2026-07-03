---
name: categories-ui-conventions
description: /categories master-detail workbench (CategoriesPage.tsx) — CSS multicol masonry, slide-over stacking, OrbitField-label trap, dirty-discard, tree a11y; 4 rounds of fixes, near-clean
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

**Reusable trap — OrbitField renders as `<label>` wrapping children** (OrbitModalShell) unless `interactiveHint`; a label around a button group forwards label-text clicks to the first button (Priority → resets to "None"). Both Priority + Style fields correctly pass `interactiveHint`.

**Dirty-discard:** Inspector `dirty` shows a save bar; scrim click / Escape / selecting another node are all routed through `guardDirty` → ConfirmDialog (no longer silent).
