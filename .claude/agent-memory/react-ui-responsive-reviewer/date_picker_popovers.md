---
name: date-picker-popovers
description: The three Orbit date-picker popovers (transaction/range/target-date) — footer conventions, scroll-cap pattern, live-commit + auto-close behavior.
metadata:
  type: project
---

Orbit has three sibling date-picker popovers, each self-styled via an inline `<style>` block, all wrapped in `.orbit-design` tokens:

- **TransactionDatePicker** (`apps/web/src/features/transactions/TransactionDatePicker.tsx`) — datetime, `.tdp-*`, used in New/EditTransactionSheet.
- **DateRangePicker** (`apps/web/src/components/shared/DateRangePicker.tsx`) — range, `.op-date-*`, embedded via **PeriodChip** (`components/shared/PeriodChip.tsx`) on transactions + all analytics views.
- **EnvelopeTargetDatePicker** (`apps/web/src/pages/space/budgets/EnvelopeTargetDatePicker.tsx`) — date-only, `.etp-*`, in CreateOrEditEnvelopeDialog (only when cadence="none").

**Shared structural pattern (all three):** popover-inner is a flex column with a pinned header, a middle scroll region (`.tdp-pop-scroll` / `.op-date-body` / `.etp-pop-scroll`, `flex:1; overflow-y:auto`), and a pinned footer. Height cap is `max-height: min(calc(100dvh - 32px), var(--radix-popover-content-available-height, 600px))`. Header/footer are normal-flow flex siblings of the scroll region (NOT position:sticky/absolute overlays) — so their transparent backgrounds are fine; scrolled content is clipped within the scroll region and never bleeds behind them. No z-index/backdrop risk.

**Commit/close behavior (post fix/date-picker branch):** every edit commits live via `onChange` — no Apply button. Footer is a single **Done** that only dismisses.
- TDP: Done is now compact secondary (right-aligned via `.tdp-foot justify-content:flex-end`; `.tdp-btn` transparent bg, `var(--line)` border, `var(--fg-2)` text, `height:34px; padding:0 16px`, no `flex:1`, font 13px). `.tdp-btn-primary` was deleted — nothing references it. Picking a day keeps the popover open (time still to choose); focus stays on the selected day. Verified 375+1440: reads as a calm dismiss, no longer competes with the form's green "Save transaction".
- DRP: auto-closes (`onApply`) on preset click or second-day-of-range; Done (compact, right-aligned via `justify-content:space-between` against the summary span) only shows when `onCancel` is passed (PeriodChip does pass it).
- ETP: a day click commits AND auto-closes (MonthGrid `onDayClick={onDone}`, line ~188/367) — keyboard arrow-nav is exempt so it doesn't close on arrows. Footer is space-between: ghost **Clear** left (only when a value is set) + compact secondary **Done** right (round-3: `.etp-btn-primary` green DELETED, Done now plain `.etp-btn` transparent/muted — verified 375+1440, matches TDP); focus returns to trigger on close.

**DRP mid-gesture stale-range trap (round-3, OPEN):** after ONE calendar click of a fresh range, `picking` flips to "to" and `from` updates to the new day but `to` stays the STALE leftover (e.g. old Last-30 end). Header/footer text was fixed to read "Pick an end date" / "`<start>` → Select end date", BUT `cellState` (line 92) still paints a full is-start→is-in→is-end range from new `from` to stale `to`, AND the To DateInput (line 299) still shows the stale date. So 4 surfaces disagree: calendar+To-input show `Jun10→Jul16` range, footer says end-not-chosen, Done commits `Jun10→Jun10`. Fix: gate on `picking==="to"` — in cellState use `tT = picking==="to" ? fT : to.getTime()` (collapses to single start, hover-preview branch still previews), and blank the To input while pending. The header/footer-only fix is the exact stale-range anti-pattern the change targeted, left in 2 of 4 surfaces.

**Verified good** at 375/1440/320px: footers always in-viewport, scroll regions engage when content exceeds the cap, tab order intact (focus trapped in popover, no empty stops).

**Done-button styling status:** TDP + ETP Done buttons are now the calm compact secondary (transparent bg, `var(--line)` border, muted text) — both fixed & verified. DRP's Done still uses `op-date-btn-primary` (green); on desktop it's a filter popover with no stacked CTA so acceptable, but on **mobile (375)** DRP's Done renders FULL-WIDTH GREEN while the page's green "New transaction" CTA sits just above the popover — pre-existing, previously deemed acceptable, not re-flagged. If a future round tightens DRP, that's the spot.
