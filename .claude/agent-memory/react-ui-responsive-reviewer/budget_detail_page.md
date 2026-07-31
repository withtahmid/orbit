---
name: budget-detail-page
description: BudgetDetailPage.tsx (envelope detail) redesign — full-width ED_STYLES layout, hero (glass+body+facts), EnvelopeSpendChart preserveAspectRatio=none pitfalls, sticky donut, shadcn-vs-orbit token mixing, recurring a11y gaps.
metadata:
  type: project
---

`apps/web/src/pages/space/budgets/BudgetDetailPage.tsx` is `.orbit-design`-scoped with an inline `ED_STYLES` string at the bottom. Full-width (`.ed-scroll` max-width removed → `width:100%`, padding 22/32).

**Layout:** `.ed-hero` (od-card, flex wrap, gap 28) = glass (`flex:0 0 auto`) + `.ed-hero-body` (`flex 1 1 240`, nums + status) + `.ed-hero-facts` (`flex 1 1 300`, grid 2col, left border/divider; at ≤900px border removed + `flex-basis:100%`). Month stepper `.ed-month-nav` in `.ed-topbar-actions` (monthly cadence only). Chart card holds EnvelopeSpendChart (h=440) or EnvelopePaceChart. "Where it went" `.ed-cat-wrap` (flex, wrap) = `.ed-cat-chart` (`flex 0 0 260; position:sticky; top:16`) + `.ed-cat-legend` (grid 2col, 1col ≤640).

**Token mixing is INTENTIONAL and RESOLVES:** shadcn tokens (`--foreground`, `--card`, `--muted-foreground`, `--border`, `--warning`) are defined on `:root,.dark` in `index.css` — they resolve fine inside `.orbit-design` (which only *adds* `--bg/--fg/--brand/...`). EnvelopeSpendChart uses shadcn tokens + Tailwind (`text-muted-foreground`, `bg-card`, `border-border`); EnvelopePaceChart uses orbit tokens (`--fg-3`, `--line-soft`, `--expense`). Both work. BUT surface mismatch: SpendChart tooltip `bg-card` = hsl(180 10% 9%) while orbit `.od-card` = `--bg-elev-1` oklch 17% — tooltip is slightly DARKER than the card it floats over (minor, acceptable).

**EnvelopeSpendChart pitfalls (`preserveAspectRatio="none"`, viewBox 800×440, width/height 100%):**
- All STROKES use `vectorEffect="non-scaling-stroke"` so line weights DON'T distort when stretched wide — good. EXCEPTION: `<path d={curArea}>` (gradient fill) has none, but it's a fill so distortion is invisible. Endpoint `<circle>` markers r=3–4 DO distort into horizontal ellipses on very wide cards (circles aren't stroked-only; radius scales with the squashed aspect). Cosmetic.
- X-axis labels are absolutely-positioned siblings (NOT in SVG): `left: xPct(sx(d-1))%` + `-translate-x-1/2`. First tick at day1 → `sx(0)=p=34` → xPct=4.25%, last at day N → `sx(N-1)=w-p=766` → 95.75%. With translateX(-50%) the labels stay ~inside; edge labels can clip a few px on very narrow cards but generally fine.
- Y-axis labels positioned with `top: yPx` (RAW SVG px, NOT scaled to container height) while chart height IS 440 fixed → aligns correctly only because h is fixed at 440. If height ever made responsive, Y labels would desync.

**Recurring A11y gaps (verify each review):**
- NO global `:focus-visible` ring in orbit-design.css. `.ed-crumb` links + `.ed-mo-arrow` rely on browser default outline (orbit-design.css L176 sets `outline:none` on od-input only, not links). Card `:focus-visible` ring exists on BudgetsPage `.env-card` but detail page has no card links. Month arrows HAVE `aria-label`. Charts are `role="img"` + aria-label (SpendChart label is static "Cumulative spend chart" — not data-bound; PaceChart label IS data-bound).
- Donut is color-only; adjacent `.ed-cat-legend` (dot+name+value+%) is the text fallback — good.
- Glass slosh gated by JS `usePrefersReducedMotion` (no CSS bypass) — good.

**Touch targets:** `.ed-mo-arrow` = 34×34px default, bumped to **44×44 at ≤640px** (L1099) — good on mobile, sub-44 on desktop (acceptable, mouse). `.od-btn` = 36px (verified orbit-design.css L132), never bumped — the topbar action row (Allocate/Deallocate/Top up/Move/Edit) stays 36px on mobile. `.od-btn` has NO `:focus-visible`; relies on browser default outline (`outline:none` is scoped to `.od-input` only) — acceptable.

**EnvelopePaceChart (goal cadence, NEW):** hand-rolled SVG, viewBox 880×`height`(260), `width="100%"` (NO height attr, NO preserveAspectRatio → default `xMidYMid meet`, uniform scaling — no distortion, unlike SpendChart). All axis labels are `<text>` INSIDE the SVG (scale with chart) — no absolute-position desync. `role="img"` + data-bound aria-label. `overflow:visible` so TODAY/cap labels near edges aren't clipped. On very narrow cards the 880-wide viewBox scales down → 10px fonts shrink below legibility (~6-7px at 360px). Legend lives in `.ed-sect-head` (`.ed-legend`, solid/dash/dot swatches) — non-color cue present for goal chart.

**Orphaned CSS:** `.ed-tx-row` and `ed-kpis` now REMOVED (verified grep — zero refs). No orphans remain.

**Color-only cue gap — RESOLVED (2026-07-01):** Both charts now render `.ed-legend` in `.ed-sect-head` via `chart?.legend` (page builds `spendLegend`/goal legend arrays). Swatches: `.ed-sw` base = 14×3px solid bar; `.ed-sw-dash`/`.ed-sw-dot` set height:0 + border-top styled by `--c` CSS var (passed inline). `ed-sw-solid` class has NO rule (intentional — base .ed-sw is the solid bar; solid swatches get inline `background`). Legend renders correctly for both kinds.

**HTML overlay dots — VERIFIED SOUND (2026-07-01):** SpendChart replaced SVG `<circle>` endpoint/hover markers with absolutely-positioned `<span>`s (`dotStyle`: `left: xPct(svgX)%`, `top: svgY` raw px, translate(-50%,-50%)). Math is EXACT at all widths: container is `height:h`(440) and SVG `height="100%"` → viewBox-y maps 1:1 to top px; x maps by width %. `.ed-chart-wrap` has no padding so container width == SVG rendered width — no offset. Dots land on the lines at every breakpoint. Circle-squash issue gone.

**touch-none scroll trap — FIXED (2026-07-01):** SpendChart container now uses inline `style={{ touchAction: "pan-y" }}` (was Tailwind `touch-none`). Vertical page scroll works over the 440px chart; horizontal touch moves still reach `onTouchMove`/`handleTouch` for the tooltip scrub. Correct fix — verified in EnvelopeSpendChart.tsx L207.

**Goal-reached ✓ badge (EnvelopeGlass, 2026-07-01):** Gold `<circle>`+check `<path>` drawn AFTER the clip `<g>` (so fully visible, not clipped) when `variant==="save" && glassStatus()==="complete"` (status.ts: complete = save & current>=total). Card coords cx60/cy44/r14 in viewBox 120×220; pot cx24/cy20/r8 in 48×64. Both well within viewBox (no overflow). Legible at hero h=168 (0.76 scale → r≈10.7px) and grid card h=132 (0.6 scale → r≈8.4px). Distinguishes 100% from 96% (both would otherwise show a full glass).

**Narrow-width Y-label clip:** SpendChart Y-labels at `left: xPct(p-6)=3.5%` with `translate(-100%,-50%)` sit LEFT of 3.5% of container width. Below ~360px card the label's left edge goes slightly negative and clips at the card's left padding. Minor; only the largest tick ("1.2K") at very narrow widths.

**Contrast fix #6 EFFECTIVE:** `.ed-fact-sub`/`.ed-cat-pct` moved `--fg-4`(L48%)→`--fg-3`(L62%) on `--bg-elev-1`(L17%) card ≈5.5:1 — passes AA for the 10.5–11.5px text.

**`EnvelopeMonthlyBars` click layer (measured with the headless-Chromium harness, see [[tooling-measurement-harness]]):** 12 absolutely-positioned full-height `<button>`s, `left/width` in `xPct` %, `height: h - p + 16` = 208px.
- The chart lives in `.ed-row3` which **stacks below 1280px and goes 3-across at ≥1281**, so column hit width is *non-monotonic*: 375→**22.73px**, 768→32.17, 1024→51.52, **1280→70.86, 1440→28.70**, 1920→46.84. The widest desktop viewport has a narrower target than a 1024px one. Never quote a single "desktop" number for this chart.
- The month-label `<span>`s and y-tick `<span>`s are rendered **after** the buttons and have `pointer-events: auto` — the labels sit at `top: h-p+4` (196px), 15.75px tall, so their top **12px overlaps the button** and `elementFromPoint` returns the label, not the button, at every width. Tapping the month name (the only visible affordance) does nothing.
- Mouse/touch events DO bubble from both buttons and labels to the container's `onMouseMove`/`onTouchStart`, so the hover tooltip survives — verified by dispatch. And effective `touch-action` is the intersection with ancestors, so the container's `pan-y` still governs a drag started on a button; page scroll works.
- The selected-column tint `color-mix(in oklab, var(--fg) 7%, transparent)` is painted by the **button**, i.e. ON TOP of the bars. Measured repaint of the selected column's data marks: this-year green rgb(32,179,86)→**rgb(46,183,96)**, prior-year grey rgb(53,57,56)→**rgb(66,69,69)**. On a chart whose two series are distinguished by colour alone that is a real encoding leak. Band-vs-card contrast is 1.15:1 — plainly visible, so the tint level is fine; only its paint order is wrong.
- Focus ring: `--ring` #14eba3, 2px box-shadow, `overflow: visible` on every ancestor up to `main` — not clipped.
- Unlike the Trends page's `YoYBars`, this chart has **no `sm:hidden` chip-row touch fallback** for the 22.73px columns.
