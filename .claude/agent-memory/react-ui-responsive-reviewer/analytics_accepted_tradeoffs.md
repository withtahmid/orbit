---
name: Analytics UI accepted tradeoffs
description: Validated UI/a11y tradeoffs in apps/web analytics views — do NOT re-flag these as new findings in future review passes
type: feedback
---

Several UI/a11y choices in the analytics views (`apps/web/src/pages/space/analytics/*`, `components/shared/charts/*`) have been reviewed across multiple rounds and are deliberate. Do not re-report them as fresh issues.

**Why:** repeated flagging of already-decided tradeoffs wastes review cycles and reads as noise on a "green-flag" pass.

**How to apply:** treat these as settled unless the user says otherwise:
- **MultiSeriesLineChart legend = click-to-isolate, NOT hover-glow.** User explicitly preferred click/tap isolation (works on touch). Isolated line stroke opacity 1, others dimmed to 0.12 (intentionally very faint so the isolated line pops); the *legend chip* dims to opacity-60. These numbers are chosen, not bugs.
- **Dense-legend/trigger touch targets ~32px (`min-h-8`, trigger `sm:h-7`).** Below the 44px mobile ideal but accepted for dense chart legends and desktop filter chips. Mobile trigger is `h-9` (36px).
- **`CategoryMultiSelect` search input lives inside a Radix `DropdownMenuContent`** (a menu, not a combobox). Its `onKeyDown` stops propagation for all non-Escape keys so typed characters reach the input instead of triggering Radix typeahead. Consequence: once the search input is focused, arrow keys don't move the roving highlight into the checkbox list, so selecting a filtered row is effectively mouse/touch-only. This is a known architectural limitation of search-in-DropdownMenu, not a new regression.
- **Auto-focus of that search input uses `requestAnimationFrame` inside `onOpenChange`** because the installed Radix `DropdownMenuContent` has no public `onOpenAutoFocus`. This is the intended fix (fires after Radix's own FocusScope layout effect; no visible flicker in practice; re-fires correctly on every open).

**Shared component:** `CategoryMultiSelect` is the single hierarchy-aware multi-select used in 3 places — `AnalyticsFilterBar`, CategoriesView "Spending trend" card, and EnvelopesView's two trend-card pickers (flat list, `parent_id: null`, `footerHint={null}`). Trend-card header layout convention is `flex-row flex-wrap items-start justify-between gap-3 gap-y-1` (title/description column on the left, picker on the right, wraps below on mobile).
