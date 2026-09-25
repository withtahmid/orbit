---
name: icon-picker-panel-budget
description: IconPicker's shell/panel split — the three height tiers and their exact pixel minimums (278 / 196 / 136), the crossover thresholds, and which roving-tabIndex is state-driven vs still imperative.
metadata:
  type: project
---

`IconPicker` renders `<div class="orbit-design op-icon-shell"><style/><div class="op-icon-picker">…`.
The **shell** owns `height: min(32rem, var(--radix-popover-content-available-height, 32rem))`
+ `container-type: size; container-name: iconpicker`. The **panel** owns `height: 100%`,
`border-radius: 12px`, `border: 1px solid var(--line)`, `background: var(--bg-elev-1)`,
`overflow: hidden`. The split exists because a container query cannot style its own
container (see [[css-cascade-traps]] #3), so the tiers can now shrink the panel's own
gap/padding.

`box-sizing: border-box` (Tailwind preflight + `.orbit-design`), so chrome = height − border − padding.
Flex children are head / search / tabs / strip / body; `<style>` is `display:none` and the
`role="status"` `<p>` is `position:absolute` (`sr-only`) — neither is a flex item or makes a gap.

**Browse-mode minimums (measured from the CSS, not estimated):**
- **Tier A** (container > 340px): `2+20` + head 30 + search 36 + tabs 36 + strip 26 + body 6rem
  + 4×8 gap = **278px**
- **Tier B** (`@container iconpicker (max-height: 340px)`; padding 8, gap 6, head 24, strip hidden):
  `2+16` + 24 + 36 + 36 + body 4rem + 3×6 = **196px**
- **Tier C** (`(max-height: 260px)`; B plus head hidden, `.op-icon-tab` 22 → tabs 30, body 2.5rem):
  `2+16` + 36 + 30 + 40 + 2×6 = **136px**
- Search mode drops tabs + strip: A 200 / B 154 / C 100.

No dead band: each threshold hands over to a tier whose minimum is far below it, and both
steps *grow* the grid (body 159→208 at 341→340, 129→164 at 261→260). Clipping starts below
**136px** of available height. With avail ≈ max(above, below) − 12 (see
[[popover-in-dialog-clipping]]) and a 38px trigger mid-viewport, that is viewport height
≈ **334px** — down from ~474px before the split. Tier C's 40px body still shows only a
sticky group head (~21px) plus a clipped 40px cell row, so it is a floor, not a usable grid.
The 36px search input is the biggest remaining fixed item at Tier C.

**Roving tabIndex.** The **strip** is state-driven and correct in all four states:
`stripFocusKey` (set by `onStripKeyDown`, reset to null by the `[tab, searching]` effect)
falls back to `currentSection` via `sections.some(...)`, so there is always exactly one
tab stop and a stale key can't survive a section list change. The **body grid** still
hands off imperatively (`cell.tabIndex = -1; next.tabIndex = 0` in `onBodyKeyDown`), which
can desync from React if a memoised grid re-renders — low risk in practice because
`LucideGrid`/`EmojiGrid` props only change on pick (which closes the popover).

Other standing facts:
- `--radix-popover-content-available-height` aliases an undefined `--radix-popper-available-height`
  on the first frame. Per css-variables-1 §3.2 the alias then computes to the guaranteed-invalid
  value, so `var(…, 32rem)` **does** use the fallback — no first-frame height explosion, and the
  popper wrapper is off-screen until positioned anyway.
- `container-type: size` on the shell is safe only because both popover hosts give
  `PopoverContent` a definite width (`w-[min(24rem,calc(100vw-1.5rem))]`, which twMerge
  swaps in for the base `w-72`). Mounting `IconPicker` as a **flex/grid item** with auto
  width would collapse the shell to 0 — size containment zeroes its intrinsic contribution.
- `contain: size layout style` makes the shell a stacking context and the containing block
  for abs/fixed descendants. Nothing inside needs to escape it (no `position: fixed` in the
  picker CSS; the sticky group heads scroll inside `.op-icon-body`).
- The strip always overflows on the Icons tab (15 × 30px + gaps = 478px vs ≤364px of panel
  width), so `has-more` is permanently on there.
- Tier C hides `.op-icon-head`, which also removes the **Revert** button — the only undo in
  the panel. Documented in `contexts/modules/web/icons.md` as "drops the header"; the Revert
  loss is not.
