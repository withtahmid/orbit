---
name: daterangepicker-conventions
description: DateRangePicker (shared) + PeriodChip gotchas — swallowed-first-click bug RESOLVED (round 6, 2026-07-16): fix #1 (autofocus suppression) removed, fix #2 (onBlur text-unchanged guard) alone ships. Both critical-bug fix and keyboard a11y verified clean, review loop closed
metadata:
  type: project
---

`src/components/shared/DateRangePicker.tsx` is a stateless dual-month range
picker wired into `src/components/shared/PeriodChip.tsx` (URL-backed via
`usePeriod`). Verified behavior as of branch `fix/date-picker` (2026-07-16):

- The "pending/collapse" fix works CORRECTLY when the picker opens from an
  already-`custom` range: one calendar click highlights only the clicked day,
  the To input shows a "Select end date" placeholder, hovering previews a
  tentative range, completing/typing applies the full range (no collapse-to-
  single-day regression).

**Gotcha — first click swallowed from a named-preset entry:** Radix
`PopoverContent` autofocuses the first focusable child, which is the "From"
`<input>`. `DateInput.onBlur` unconditionally re-commits its current text via
`onCommit` → parent `onChange` → `setCustom(...)`. So the FIRST calendar-day
click blurs the From input and commits the *stale preset start*, rewriting the
URL to `?period=custom&from=<old-start>...`; the sync `useEffect` then clobbers
the just-clicked `from`. Net: opening from "Last 30 days"/"This month"/etc. and
clicking one day loses that day (highlight + range start snap back to the preset
start). Reproduced identically at 375px and 1440px.

**Why:** blur fires on mousedown before the day's click; the From input holding
focus + auto-committing on blur is the trigger. Fix direction: suppress the
autofocus (`onOpenAutoFocus={e=>e.preventDefault()}` on PopoverContent) and/or
make `DateInput.onBlur` only commit when the text actually changed from `value`.

**How to apply:** when reviewing this picker, always test the named-preset entry
path, not just an already-custom URL — the happy path hides this bug.

**ROUND 5 (2026-07-16) — swallowed-click bug FIXED, but fix #1 broke keyboard a11y.**
Two fixes were applied: (1) `PeriodChip` `onOpenAutoFocus={e=>e.preventDefault()}`,
(2) `DateInput.onBlur` early-returns when text === canonical formatted value.
Verified end-to-end (headless Chrome via CDP, real mouse/kbd events, both 1440x900
and 375x812): swallowed-click regression is gone from the named-preset entry path.

- **Keyboard regression from fix #1:** with autofocus suppressed, opening the
  popover by keyboard leaves focus on the TRIGGER. The content is portaled to
  `<body>`, so the first Tab moves to the next page element and trips Radix's
  non-modal focus-out dismissal → popover closes. The calendar/inputs/presets are
  UNREACHABLE by keyboard (WCAG 2.1.1 Level A fail). Intra-popover Tab works only
  once focus is placed inside via mouse (From→To→presets). Escape (no prior Tab)
  correctly closes + restores focus to trigger.
- **Proven better fix:** fix #2 (the onBlur guard) ALONE resolves the swallowed
  click. I temporarily removed the `onOpenAutoFocus` line, kept the onBlur guard,
  and re-tested: June-5 click held (no snap-back) AND keyboard-open landed focus
  inside (From input). So drop fix #1; if calendar-first focus is desired, prevent
  default THEN imperatively focus a safe in-popover target (content root / active
  preset) — never leave focus on the trigger with autofocus suppressed.
- Note: clicking an in-picker preset button writes a CUSTOM url range (chip shows
  dates, not the preset name) — pre-existing `setCustom` behavior, not a fix bug.

**ROUND 6 (2026-07-16) — CLOSED. Fix #1 removed; fix #2 alone ships.** `PeriodChip`
`PopoverContent` no longer passes `onOpenAutoFocus` (back to Radix default
autofocus-on-open); `DateInput.onBlur` text-unchanged guard (`if (text === canonical)
return;`) remains. Re-verified end-to-end (Playwright/Chromium, real mouse+kbd,
authed against Neon on a real space, both 1440x900 and 375x812 — identical results):
  1. Named-preset → one calendar click HOLDS: From input flips Jun 17→Jun 5, To goes
     empty (pending), day paints `is-single`, popover stays open, URL unchanged (first
     click never commits). No snap-back.
  2. Keyboard: focus trigger → Enter opens → focus lands INSIDE popover (From input);
     Tab walks From→presets, popover stays open (Radix default autofocus fixed the a11y
     regression fix #1 caused).
  3. Two-click range from preset entry: closes, chip reads "Jun 5 → Jun 20", URL
     `?period=custom&from=2026-06-05&to=2026-06-21` (correct start; `to` exclusive +1).
  4. Escape closes popover and restores focus to trigger.
Reported empty findings list — review loop is closed on this branch.
