---
name: css-cascade-traps
description: Two measured cascade facts in apps/web — unlayered page CSS (ED_STYLES, orbit-design.css) beats EVERY Tailwind utility regardless of specificity, and DropdownMenuItem's [&_svg]:size-4 beats a child's size-3.5
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
