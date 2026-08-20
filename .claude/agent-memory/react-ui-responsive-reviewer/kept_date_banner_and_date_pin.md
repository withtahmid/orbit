---
name: kept-date-banner-and-date-pin
description: The kept-date ("Keep"/"Keeping") mode UI in NewTransactionSheet — banner geometry measured at 320px, the PinControl `keep` variant's colour clash, and the cascade trap that kills the back-dated warn edge on hover.
metadata:
  type: reference
---

`useDatePin` (`apps/web/src/features/transactions/useDatePin.ts`) is a localStorage store with a
sliding **3h** idle window; `PinControl` gained a `variant` prop (`pin` = server defaults,
`keep` = the browser-local kept date, `CalendarClock` + "Keep"/"Keeping"). `DateField` +
`KeptDateBanner` live in `NewTransactionSheet.tsx`; the banner is the first child of each
`.nt-form` (not of `.ods-body`), and takes `currentDay` so it can state both the open row's day
and the kept day when they diverge.

**`.nt-kept-banner` measured (Chromium, real Geist).** Body-width flex row, 9/10/9/12 padding,
12px/1.35 text, `--warn` on `--warn-soft` = **7.72:1** over elev-1. Text column at 320vp = 157px:
the two-part string wraps to **2 lines → 56px banner**; the year-bearing worst case
("This entry: Dec 31, 2025 · new entries return to Jan 2, 2026") is **3 lines → 68.6px**, still no
overflow because `.nt-kept-banner-text strong { white-space: nowrap }`. Plus `.nt-form`'s 14px gap
that is **~83px of a 528px visible body** on a 320×720 phone. Desktop: 1 line, 44px.

**Live region: use an absolutely-positioned `.of-sr-only` sibling, never a wrapper with
`:empty { display: none }`.** The wrapper was tried and reverted — a live region inside a
`display:none` subtree is not monitored, so un-hiding and filling it in the same frame is exactly
the failure the always-mounted wrapper was meant to prevent. `.of-sr-only` is `position:absolute`,
so it is not a flex item and costs zero `gap` (verified: card `y` unchanged).

**Cascade trap — `.nt-date-backdated .tdp-trigger` loses to `.tdp-trigger:hover`.** Both are
(0,2,0); `TDP_STYLES` is a `<style>` rendered *inside the trigger button*, i.e. later in document
order than `NT_STYLES` at the drawer top, so hover wins and the warn edge disappears under the
pointer. Confirmed with `CSS.forcePseudoState` → computed `border-color` reverts to `--line-strong`.
Any NT rule that must beat a TDP rule needs one extra selector, e.g.
`.nt-date-backdated .tdp-trigger:hover`.

**Colour clash to keep in mind:** `.nt-pin-btn.is-pinned` fills with `--brand` (emerald, 8.20:1)
for every variant, so "Keeping" reads green while the banner and the trigger edge for the same
state are amber. `--warn` text on a `warn 18%` fill over elev-1 is **6.77:1** and a `warn 65%`
border is **4.52:1** — a warn-toned pinned state is contrast-viable here (unlike the brand 14%
tint that originally forced the filled treatment). Note the label collapses to icon-only below
420px, so on a phone the chip is a bare 36px circle.

**`.of-row > .oms-field > .oms-field-row { align-items:center; min-height:24px }` (36px on touch)
is correctly gated to `@media (min-width: 520px)`** — verified: at 320 the Account cell's label row
is 17.25px (no dead space) while the Date cell's is 36px, and they stack; at ≥520 both are 24/36
and the two controls share a `y`.
