---
name: accounts-ui-conventions
description: AccountsPage ledger-over-bar summary + AccountDistributionBar patterns, breakpoints, divider/touch traps (rewritten round 5 — .ac-strip/facts GONE, now .ac-ledger)
metadata:
  type: project
---

`apps/web/src/pages/space/accounts/AccountsPage.tsx` renders inside `.orbit-design` with an inline `<style>{AC_STYLES}</style>` block (same CSS-in-string pattern as Analytics/Categories/Transactions/Budgets). Rewritten repeatedly on feat/accounts. GONE across successive rounds: `.ac-hero` grid, the 3-col legend, the round-3 donut (`AccountDistributionDonut`), the round-4 `.ac-strip`/`.ac-strip-facts`/`.ac-fact` facts group. Do not trust older memory describing a donut OR a facts group.

CURRENT summary (round 5) = `.od-card.vignette.ac-summary` (flex column, gap 20) with TWO stacked bands:
- `.ac-ledger` — `display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:18px 28px; z-index:1`. Two children only: `.ac-networth` (LEFT hero — `.ac-networth-val` clamp(30px,3.4vw,40px), overflow-wrap:anywhere so billions shrink not blow up; `.ac-networth-sub` swaps "assets + locked − liabilities" vs "assets − liabilities" by lockedCount) and `.ac-tstats` (RIGHT — flex, flex-wrap, justify-content:flex-end, gap 14px 0). `.ac-tstats` holds `TypeStat` tiles: Assets, [Locked only if lockedCount>0], Liabilities. Liabilities is `signed` (shows +/−), gets emptyNote "no debt" when none.
- `.ac-sum-bar` — `border-top` + `padding-top:20; z-index:1`, houses `AccountDistributionBar`.
- Both `.ac-ledger` and `.ac-sum-bar` carry `position:relative; z-index:1` so they clear the `.vignette` pseudo. VERIFIED good.

DIVIDERS: `.ac-tstat` uses `border-left:1px var(--line-soft)` + `padding:0 22px`; `:first-child` strips border+left-pad, `:last-child` strips right-pad. `@media max-width:1024px` removes border-left + padding entirely (dividers exist ONLY >1024). Dangling-divider risk is now effectively UNREACHABLE: at >1024 the 2-3 tiles always fit one row inside `.ac-tstats` (3 tiles ~420px vs ~930px+ interior even with 232px sidebar subtracted at 1280), and if `.ac-tstats` wraps below the hero as a block its DOM `:first-child` has no border anyway. Internal tile wrap would need `.ac-tstats` <~280px while viewport >1024 — impossible. Much cleaner than the round-4 facts-strip which genuinely dangled 620-1024.

BREAKPOINTS: `max-width:1024` -> `.ac-tstats{gap:14px 24px}`, `.ac-tstat{border-left:none;padding:0}`. `max-width:720` -> `.ac-ledger{align-items:stretch;justify-content:flex-start}`, `.ac-tstats{justify-content:flex-start}`, `.ac-tstat` left-align. `max-width:620` -> summary padding 18/gap16, `.ac-tstats{gap:12px 20px;width:100%}`. `max-width:720/640` -> topbar/scroll pad shrink, card grid `.ac-grid` 1-col at 640 (else auto-fill minmax(230px,1fr)).

DISTRIBUTION BAR (AccountDistributionBar.tsx): round-5 = SINGLE-TAP nav on both segments and chips. Segments (`.ac-dist-seg`, spans, height 26px via `.ac-dist-track`, min-width 3px) keep `onMouseEnter` hover-inspect (sets activeId -> swaps `.ac-dist-readout`, dims others to opacity 0.4) but `onClick` navigates directly (`cursor:pointer` when onSelect present). Chips (`.ac-dist-chip`, `<button>`, height 24px) single-tap navigate; keyboard path is chips (focus-visible 2px var(--brand) ring, onFocus/onBlur manage activeId). Segments NOT keyboard-focusable — chips duplicate every segment so that's fine. `role="img"`+full aria-label on track. Both targets <44px, accepted because account cards below are the real `<Link>` nav.

READOUT (`.ac-dist-readout`): `white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0`. Idle text = "{largest.name} leads · {pct} of {total} holdings" (the trailing "holdings" word added round 5). Sits in `.ac-dist-head` (flex space-between, gap 12, min-width:0) opposite the "Where it sits" eyebrow. Readout is the flexible/ellipsizing child (min-width:0 + longer content shrinks first), so the extra word does NOT push the eyebrow even at 375px. VERIFIED clean.

ROUND 5 VERDICT: SHIP, clean. The three tweaks (segment single-tap, "holdings" word, neutral var(--fg-3) color for Assets/Locked at zero) introduced no layout/a11y/z-index regressions. No dead CSS found (all `.ac-*` classes cross-check between JSX and AC_STYLES). Sub-44px bar/chip targets remain the only known-accepted latent note.

Light theme: `.orbit-design` is dark-only scoped tokens (no prefers-color-scheme/data-theme). App-wide convention across editorial pages; no dual-theme work needed.
