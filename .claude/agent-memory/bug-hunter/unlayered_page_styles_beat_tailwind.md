---
name: unlayered-page-styles-beat-tailwind
description: BudgetDetailPage's ED_STYLES (and any in-component <style> block) is UNLAYERED CSS and therefore beats every Tailwind v4 utility regardless of specificity — descendant selectors like `.foo > div` silently override shared components dropped into that subtree.
metadata:
  type: project
---

`apps/web/src/pages/space/budgets/BudgetDetailPage.tsx` renders
`<style>{ED_STYLES}</style>` (around line 940; the template literal lives at the
bottom of the file). Same pattern exists on other `.orbit-design` pages.

**The trap:** Tailwind v4 (`@import "tailwindcss"` in `src/index.css`) emits every
utility inside `@layer utilities` — verified in the built CSS: `.inline-flex`,
`.flex`, `.hidden` etc. all sit inside `@layer utilities{...}`. A plain `<style>`
element is **unlayered**, and in the CSS cascade unlayered normal declarations
outrank *any* layered declaration no matter the specificity. So a rule like

```css
.ed-row3-head.ed-head-split > div { display: flex; flex-direction: column; ... }
```

overrides `className="inline-flex items-center ..."` on **every** direct `div`
child — including shared components (`ViewModeToggle`, chips, toggles) that the
page author never intended to restyle.

**How to apply:** Any new `> div` / `> *` / element-typed descendant selector added
to `ED_STYLES` (or a sibling in-page `<style>`) is a landmine. Check what else is
a direct child of that container — especially imported shared components, whose
root element is usually a bare `div`. Fix by giving the intended child its own
class (`> .ed-head-main`) rather than matching on element type. Do not reach for
`!important` on the component; the container selector is the bug.

Related: [[movers-list-shared]].
