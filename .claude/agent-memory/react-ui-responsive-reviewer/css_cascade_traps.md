---
name: css-cascade-traps
description: Four measured cascade facts in apps/web — unlayered page CSS beats EVERY Tailwind utility, DropdownMenuItem's [&_svg]:size-4 beats a child's size-3.5, a container query never styles its own container, and `.orbit-design` paints an opaque background on whatever carries it
metadata:
  type: project
---

Verified by compiling Tailwind v4 through its Node `compile()` API from `apps/web`
(`@import "tailwindcss"` emits `@layer theme, base, components, utilities;` and puts every
utility in `@layer utilities`).

**1. Unlayered page CSS outranks all Tailwind utilities.**
`BudgetDetailPage`'s `<style>{ED_STYLES}</style>`, `EnvelopeDetail`-style inline `<style>` blocks,
and `src/styles/orbit-design.css` are all **unlayered**. Unlayered rules beat anything in
`@layer utilities` no matter how low their specificity. So a page-level rule like
`.ed-row3-head.ed-head-split > div { display: flex; flex-direction: column }` silently defeats
`inline-flex`/`flex-row` on a shadcn/Tailwind component dropped into that container.
**How to apply:** any time a Tailwind-styled shared component is placed inside `.orbit-design`
page CSS, check for descendant/child selectors (`> div`, `> span`, `p`, `h2`) in that page's
`*_STYLES` string that would match it. Prefer a dedicated class over `> div`.

**2. `DropdownMenuItem` forces every descendant svg to 16px.**
`src/components/ui/dropdown-menu.tsx:88` carries `"[&_svg]:size-4 [&_svg]:shrink-0"`, which
compiles to `.\[\&_svg\]\:size-4 { & svg { … } }` — specificity (0,1,1) — beating a child's
`.size-3.5` (0,1,0). `DropdownMenuCheckboxItem` / `RadioItem` do **not** carry that rule.
**How to apply:** anything moved from `DropdownMenuCheckboxItem` to `DropdownMenuItem` silently
grows its icons 14px → 16px (including `EntityAvatar size="sm"`, whose inner icon is `size-3.5`).
Neutralise with `[&_svg]:size-3.5` on the item's own className (twMerge collapses the pair).

**3. A container query never applies to its own container.**
Per CSS Containment L3 the query container is the nearest *ancestor* container, so
`@container`/`container-type` on element X plus a query-conditional rule targeting X is
dead CSS (self-styling would be circular). Two live instances:
`Donut.tsx:157-158` puts `@container` and `@md:grid-cols-[…]` on the **same** div — and
nothing else in `apps/web` establishes a container — so the donut's two-column
chart+legend layout never applies at any width. `IconPicker` had the same bug and **fixed
it the right way**: `container-type: size` moved to a `.op-icon-shell` wrapper with
`.op-icon-picker` as its child, so the tiers can now shrink the panel's own gap/padding.
See [[icon-picker-panel-budget]]. `IconPicker.tsx:1214` is the only `container-type` in
`apps/web`.
**How to apply:** when a query-conditional rule must change the container's own
padding/gap/grid, move `container-type` to a wrapper and make the styled element its child.

**4. `.orbit-design` paints `background: var(--bg)` on whatever element carries it.**
`src/styles/orbit-design.css:79-88` — the class is not just a token bag; it also sets
`background`, `color`, `font-family/size`, `line-height`, `letter-spacing`,
`box-sizing: border-box`. Two live consequences: every `PopoverContent` that adds
`orbit-design` alongside `bg-transparent` is in fact **opaque `--bg`** (unlayered beats the
utility, per #1); and adding `orbit-design` to a bare, unrounded wrapper (e.g.
`.op-icon-shell`) paints an opaque square that covers the parent's `rounded-md` corners.
**How to apply:** a wrapper added only to scope the tokens needs `background: transparent`
(or the panel's own radius) unless you want the `--bg` fill.
