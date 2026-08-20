---
name: amount-card-calculator-strip
description: The inline calculator UI (OrbitAmountCard / OrbitCalcInput / OrbitCalcKeys + useCalcField) — measured key-track widths for the 6-key strip on all three surfaces, the settled key-state colours, and the three geometry traps (481px drift pinch, margin-on-a-grid-item, un-clamped feedback line).
metadata:
  type: reference
---

Three call sites share `OrbitCalcKeys` (`apps/web/src/components/orbit/OrbitForm.tsx`), each on a
DIFFERENT surface — check this first on any change here:

| host | surface token | container width (≥768vp, w/ scrollbar) |
|---|---|---|
| `.of-amount-card` (hero amount, New + Edit tx) | `--bg-elev-2` | 428px |
| `.of-calc-wrap` in a `.of-row` cell (transfer fee) | `--bg-elev-1` (the `.ods-body`) | 227px |
| `.nt-drift-col` (adjustment "Actual balance") | `--bg-elev-2` | 207px |

**Measure with the scrollbar.** `apps/web/src/index.css` declares `::-webkit-scrollbar{width:10px}`,
which opts Chromium out of overlay scrollbars — so the scrolling `.ods-body` is **10px narrower**
than a naive calc. Headless Chrome defaults to overlay scrollbars; force it in the harness with
`.ods-body{overflow-y:scroll}` + that rule or every number is 10px too generous.

**Strip geometry, 6 keys (`+ − × ÷ ⌫ =`), `gap:6px`.** `(hover:none)` → `repeat(6,minmax(0,44px))`,
height 40, font 16. `(hover:hover)` → `minmax(0,34px)`, height 28, font 14. One row at every
breakpoint on both pointer classes; page overflow 0 everywhere.
Narrowest track anywhere = **24.03px, drift column @481vp** (`.nt-drift-grid` goes 2-col at 481
while `.of-row` waits until 520 — that 481–519 window is the pinch). 0.03px over WCAG 2.5.8's 24px
floor on Chromium; **below it in Firefox** (12px classic scrollbar → 23.88px). Fix = give
`.nt-drift-grid` a `@media (max-width: 519.98px){grid-template-columns:1fr}` so both grids share
the 520 breakpoint; worst case then becomes 26.4–27.0px.

**Trap: `margin-left` on a grid item does not come out of the track.** `.of-amount-key-eq{margin-left:4px}`
(the "gutter so a mis-tap on ⌫ doesn't eat a digit") does NOT narrow the key — `.of-amount-key`
is `width:100%` of its grid area — it shifts it, so the `=` key hangs **exactly 4px past the strip's
right edge** on every host whenever the tracks are shrinking (≤390vp hero, drift col ≥481).
Visible as the strip's right margin being 4px tighter than its left inside `.of-amount-card`.
Pay for the gutter out of the track budget instead: `.of-amount-keys{padding-right:4px}`
(costs 0.67px/track).

**Trap: the resolve "tape" can wrap and shove the strip under the finger.** After `=`/first-Enter
the readout switches from `= 1,540.00` to `from 1200+340…` (`tapeRef` in `useCalcField`). It has
`min-height:18px` but no `white-space`, so at **320vp a 6-term sum wraps to 2 lines and drops the
key strip 18px** (360vp: 7 terms; 390vp: 8 terms) — the exact "shift under the finger" the
always-mounted reserved height exists to prevent. Clamp both `.of-amount-result` and
`.nt-drift-foot` with `height:18px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.

**Key colours (measured via canvas raster of the oklch tokens; key fill is `--bg-elev-3` #1b211f on
all three hosts, so text ratios are host-independent).**
Base `--fg-2` **8.79**; backspace `--fg-3` **4.52**; `:hover` fill #383d3c (`bg-elev-3 84% + fg`);
`:active` fill #575c5b (68%) with `--fg`.
`=` enabled: `--brand` #2dc08e on the key = **7.04**, on its own hover fill #23372f = **5.45**.
`=` border `brand 45%` = **2.50 vs its own fill / 2.53 vs host** — under 1.4.11's 3:1; 55%→3.02,
**60%→3.38–3.59**, 65%→3.74–4.03.
`.is-idle`: `--fg-4` = **2.51** and `border-color:--line` = **1.03 vs its own fill**, i.e. the key
loses its outline entirely and reads as a hole in the strip (the other five keys carry
`--line-strong`, 1.34). Better idle: `color-mix(in oklab, var(--brand) 70%, var(--fg-4))` = **5.27**
plus `border-color: var(--line-strong)`.

**`.nt-pin-btn` warn tone (round-3, verified):** `--warn` text on `warn 18%` over elev-1 = **6.77**,
`warn 65%` border = **4.51** — both pass. But the *fill* is 1.39:1 vs elev-1 while the brand pinned
state is a solid pill at 8.23:1, so the higher-stakes (back-dated) state is the visually quieter
one. Solid warn would be `--bg` on `--warn` = 9.69 text / 9.37 fill.

**Newsreader (the 40px hero face) DOES cover `−` U+2212, `×` U+00D7, `÷` U+00F7.**

**Sheet width chain** (reuse for any drawer measurement): right Sheet is `w-[92%]` below 640px,
`sm:w-3/4 sm:max-w-[520px]` above. `.ods-body` padding 22px >640 / 16px ≤640 / 14px ≤380, minus the
10px scrollbar. `.of-row` is 1 column below 520px, `1fr 1fr` above (gap 12).
`.nt-drift` padding 18px (14 ≤480), `.nt-drift-grid` gap 14. `.nt-form` gap 16px (14px ≤640).
