---
name: filter-row-and-viewmode-toggle
description: The two shared analytics primitives FilterCheckRow and ViewModeToggle — measured row/indent budgets, measured toggle widths and wrap thresholds, and the contrast numbers for the checked tint
metadata:
  type: project
---

`apps/web/src/pages/space/analytics/components/FilterCheckRow.tsx` and `ViewModeToggle.tsx`
(added on branch `demo`, 2026-08). Both are consumed from more than one page, so measure once.

**FilterCheckRow** — built on `DropdownMenuItem` (see [[css-cascade-traps]] for the svg-size
consequence). Layout: `paddingLeft = 0.5 + indent` rem, avatar 28, `gap-2` between every child,
optional `+N` badge, trailing `Check`, `pr-2`.
Measured name-column budget with a badge present:
- `CategoryMultiSelect` content `w-[min(18rem,…)]` → row 278px → **name = 165.5 − 12·depth px**.
  Name hits 0 at **depth 14**; below ~depth 6 it is already under 100px. Clamp with
  `Math.min(depth, 5)` if deep trees appear.
- `AnalyticsFilterBar` content `w-[min(16rem,…)]` → row 246px → name ≈ 170px, flat lists only.

Contrast (app is **dark-only**; `:root, .dark` in `index.css`, no light theme exists):
`bg-accent/40` over `--popover` = rgb(32,38,38) on rgb(18,22,22) = **1.19:1** — effectively
invisible; the tick is the real carrier. Focus (`focus:bg-accent`) vs a checked row = **1.38:1**,
vs an unchecked row = 1.63:1, i.e. the tint *weakens* the focus indicator. `--ring` on `--accent`
is 7.15:1, so `focus:ring-1 focus:ring-inset focus:ring-ring` is the cheap fix.
Radix `Menu.Item` puts `role: "menuitem"` **before** `...itemProps`, so the hand-passed
`role="menuitemcheckbox"` + `aria-checked` do take effect (verified in node_modules).

**ViewModeToggle** — Tree ⇄ Flat segmented control. Measured intrinsic widths (Geist 12px):
**≈141px below sm** (`px-3 py-2`), **≈133px from sm** (`sm:px-2.5 sm:py-1`); height ≈37px.
Wrap thresholds for its three hosts:
- `BudgetDetailPage` `.ed-row3-head.ed-head-split` (wrap:wrap): subtitle max-content ≈362px, so
  the toggle drops to its own line below a container of ~505px ⇒ **viewport ≈847px** (interior =
  `W − 342` once the 232px sidebar is up; `.ed-scroll` padding is 32px, `.ed-movers` 22px+1px).
- `TrendsView` movers `CardHeader` uses `flex flex-row items-start justify-between gap-3` with
  **no `flex-wrap`** — the only analytics CardHeader that omits it. Every other trend card uses
  `flex-row flex-wrap items-start justify-between gap-3 gap-y-1`.
- `CategoriesView` — the original host; extraction was verbatim.
No `role="group"`/`aria-label`, so SRs announce "Tree, pressed" with no owner.
