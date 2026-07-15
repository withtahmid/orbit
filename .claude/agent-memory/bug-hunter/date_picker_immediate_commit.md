---
name: date-picker-immediate-commit
description: DateRangePicker/TransactionDatePicker/EnvelopeTargetDatePicker now commit on every edit (no Apply button); contract + trap checklist
metadata:
  type: project
---

The three shared date pickers (`components/shared/DateRangePicker.tsx`, `features/transactions/TransactionDatePicker.tsx`, `pages/space/budgets/EnvelopeTargetDatePicker.tsx`) switched from draft-then-Apply to commit-on-every-edit (branch fix/date-picker).

**Why:** Removed the required "Apply" click (a mobile footer-clipping bug hid it); every interaction now fires `onChange` live, a single "Done" button just closes.

**How to apply when reviewing this family:**
- `commitDraft(next)` in the single-date pickers is SAFE re: stale reads — it passes `next` by value to `onChange(toInputDate(next))`, never reads `draft`. Don't flag it as a stale-closure bug.
- Inner pickers seed `draft` once via useState initializer and IGNORE later `value` prop changes — external resets while open won't reflect.
- DateRangePicker `onPickDay` fires `onChange` on the FIRST click too, committing an intermediate `[firstDay, oldTo]` range that drives all `usePeriod` consumers and persists if the user abandons mid-pick.
- DateRangePicker `onApply`/`onCancel` are OPTIONAL and back the ONLY remaining footer button — a caller passing just `onChange` gets a picker that can't close or auto-apply. Only PeriodChip wires all three today.
- Backwards range (end<start), same-day-twice, and preset-clicks are all handled correctly (min/max swap, picking reset). Not bugs.
- EnvelopeTargetDatePicker highlights `draft` (defaults to today) as selected even when `value===""` — empty field visually implies today; Done commits nothing (behavior change from old Apply=commit-today).
