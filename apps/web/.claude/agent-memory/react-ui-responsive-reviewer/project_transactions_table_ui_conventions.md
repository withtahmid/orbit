---
name: transactions-table-ui-conventions
description: TransactionsPage.tsx table layout, optimistic-row rendering, balance-cell fallback asymmetry, and pending styling conventions
metadata:
  type: project
---

TransactionsPage.tsx (`apps/web/src/pages/space/transactions/`) renders two parallel row lists switched by CSS at 900px: `.tx-rows-desktop` (CSS grid `.tx-row-grid`) and `.tx-rows-mobile` (`.tx-mrow` flex buttons). All styles are in an inline `<style>` block in the same file (~line 1640+).

**Balance column is ALWAYS on.** `tx-show-balance` class is applied unconditionally to the card (line ~642); `tx-table-no-event` is added only in personal `/s/me` view. Grid column templates live at lines ~1849-1866.

**Balance-cell empty-state asymmetry (trap):** `rowBalanceEntries(t)` returns `[]` when `account_balances_after` is null/`{}`. Desktop (`.tx-cell-balance`, ~line 927) renders a `var(--fg-4)` "—" fallback. Mobile (`.tx-mrow-balance`, ~line 1059) renders NOTHING (no fallback) — just omits the second line under the amount. Both are grid/flex-safe (no misalignment) but the two surfaces disagree on empty presentation.

**Optimistic rows:** `useOptimisticTransactionCache.ts` synthesizes rows with `__pending: true` and `account_balances_after: {}`. `isPendingRow(t)` gates styling. Pending desktop row = `.tx-row-pending` (opacity 0.55, pointer-events:none, aria-busy/aria-disabled), type slot shows `.tx-pending-spinner` (role=status, has prefers-reduced-motion off-switch). Pending mobile = `.tx-mrow-pending` on a `disabled` `<button>`. `.tx-type-slot` has min-height:22px so spinner↔badge swap doesn't shift height.

**Pending→confirmed happens via React key change** (tempId→realId in `confirmPendingRow`), which REMOUNTS the row. No enter animation on `.tx-row`/`.tx-mrow` and no opacity transition, so the remount snaps (no flash, no flicker) but also no fade. Confirmed row keeps `account_balances_after: {}` until the follow-up invalidate refetch lands — so a just-confirmed row shows empty balance ("—" desktop / blank mobile) until (or forever, if the refetch silently fails — the exact failure mode confirmPendingRow exists to survive). Most conspicuous in statement mode (single-account), where every other row shows a running balance.

**Desktop rows** are `<div onClick>` + `tabIndex={pending?-1:0}` + `onKeyDown` guarded by `e.target !== e.currentTarget` and `e.repeat` (so inner links keep native Enter/Space; hold-Space doesn't refire). Round 3 REMOVED the earlier `role="button"` (correct: the row contains account `<Link>`s, and interactive descendants inside role=button is invalid ARIA). Note: the row still `onClick`s WITHOUT the target guard, so mouse-clicking inner account links bubbles to the row → navigates AND opens the sheet (pre-existing). Mobile rows are native `<button disabled={pending}>` containing NO links (just text/spans) — button nesting is valid there.

**Layout shell / scroll container:** `SpaceLayout.tsx` — no element sets `overflow:auto/scroll`, so the **document/window** is the scroll container. `.sl-aside` (232px, sticky top:0 h:100vh) is the left column, hidden `<768px`. `.sl-mobile-header` is sticky top:0 z-index:5, ~53px tall (52px box + 1px border), shown only `<768px`. `.tx-topbar` is NOT sticky.

**Sticky day headers (`.tx-day-header`, ~L2032) — round-3 final state:** `position:sticky; z-index:2; bg --bg-elev-1; box-shadow:0 1px 0 line-soft` within each `.tx-day-block`. Enabled by `.tx-table-card` `overflow:hidden`→`overflow:clip` (~L1890, hidden line first as Safari<16 fallback) — clip keeps radius-clipping but is NOT a scroll container, so sticky resolves to the window. Three-tier top offset: default `top:0` (used only at 768-900px card list, no header above); `max-width:767px` → `top:calc(var(--sl-mobile-header-h,53px) - 1px)` = 52px, tucking 1px behind the mobile header; `min-width:901px` → `top:34px`, tucking ~1.5px behind the now-STICKY column head. z-stack: mobile-header 5 > tx-table-head 3 > tx-day-header 2 > rows.

**Column head is now sticky (round 3):** `.tx-table-head` got `position:sticky; top:0; z-index:3` (was static). Only rendered ≥901px (hidden at max-width:900px). Head height ≈35.5px (24px pad + 10.5px label line-height:1 + 1px border) — the source of the day-header's 34px offset. bg `--bg-elev-2` opaque. `.tx-th` got `white-space:nowrap; line-height:1` so "Balance after" can't wrap (kept head height deterministic).

**`--sl-mobile-header-h` coupling (FRAGILE):** SpaceLayout.tsx `:root` defines `--sl-mobile-header-h:53px` = mobile header's rendered height (20px pad + 32px menu btn + 1px border), consumed by the <768px day-header offset. Header height is content-driven with NO fixed height, and `.sl-mobile-name` has no nowrap/truncate — a long space name wraps → header grows past 53px → day label partly hidden behind the taller header on phones. Fix: `.sl-mobile-name { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }`.

Radix dropdowns/popovers portal to body → escape both the clip and z-index:2.

**Balance cell "fence" (`.tx-cell-balance`, ~L2133) — round-3 fixed both earlier traps:** now `align-self:stretch` + `justify-content:center` + `border-left` + `padding-left:12px` + `margin-top/bottom:-13px` (NEGATIVE vertical margins, replacing the earlier margin-left:12px). The -13px extends the cell through the row's own 13px padding so the border meets row separators as ONE continuous rule (trap 1 fixed). The matching header divider `.tx-th-balance` (~L1954, `align-self:stretch; margin:-12px 0; border-left; padding-left:12px; display:flex; justify-content:flex-end`) now starts the fence at the head — the -12px punches through the head's 12px padding to meet its bottom border, so head+body fence is one continuous vertical line (same 9th grid track, both padding-left:12px + border, no right padding → right edges of "Balance after" label and the numbers align). Track widened to 124px (was 120) leaving ~107px for the figure (trap 2 eased). Balance figure is statement-mode-aware: `isStatementMode ? neutral/13/500 (desktop), 12/500 (mobile) : muted/12/400 (desktop), 11/400 (mobile)`. Amount is 13/500 (desktop, unchanged) / 14/500 (mobile). In desktop STATEMENT mode Amount(13) == Balance(13) size — hierarchy is color-only (semantic vs neutral) + the fence; intentional per code comment ("full prominence, matching AccountDetailPage").

**MoneyDisplay (`components/shared/MoneyDisplay.tsx`):** negative amounts FORCE `--expense` (red) and ignore `variant` (L30-31) — so negative running balances render red, not muted.

**Theme is dark-only:** `index.css` `:root, .dark` share tokens (no light override). `--muted-foreground: hsl(180 10% 64%)` on the dark card passes AA even at 12px — don't flag muted-on-dark as a contrast failure here.

**Focus ring:** `.tx-row:focus-visible / .tx-mrow:focus-visible` use `outline-offset:-2px` (inset) so the ring survives the card's clipped rounded corners on first/last rows. `.tx-mrow` also got `touch-action:manipulation`, `-webkit-tap-highlight-color:transparent`, and `:active:not(:disabled)` press feedback (120ms) — can briefly flash on iOS touch-scroll.
