---
name: amount-card-draft-emit-contract
description: useCalcField owns the draft-vs-emitted split behind OrbitAmountCard / OrbitCalcInput / the adjustment balance input; emittedRef only survives because every reset is a remount, and insert()/backspace() trust selectionStart on a possibly-never-focused input.
metadata:
  type: project
---

`apps/web/src/lib/useCalcField.ts` is the headless calculator. Three consumers:
`OrbitAmountCard` and `OrbitCalcInput` (both in
`apps/web/src/components/orbit/OrbitForm.tsx`), and `AdjustmentForm`'s bespoke
balance input in `NewTransactionSheet.tsx`, which calls the hook directly with
`{ allowNegative: true }`.

Contract:
- `draft` (local state) = what the user typed, expression and all.
- `value` / `onChange` = `String(evaluateExpression(draft).value)` — `""` when
  incomplete, invalid, or (without `allowNegative`) non-positive. Every
  `Number(amount)` guard in the forms sees only this, and `Number("")` is `0`,
  so each call site's own `> 0` / `delta == null` guard is what actually blocks
  the save. Those guards exist and were verified; the toast text is generic
  ("Enter an amount") even when the real problem is a half-typed expression.
- `emittedRef` holds the last string pushed up. The resync effect clobbers
  `draft` **only** when `value !== emittedRef.current`.

**Why emittedRef:** without it, `"12.50"` round-trips as `"12.5"` and yanks the
caret. Consequence: a parent that resets `value` to the same string the field
last emitted will NOT clear the visible draft.

**How to apply:**
- Safe today only because every reset is a *remount* — `NewTransactionSheet`
  bumps `formKey` on "Save & add another", Radix `TabsContent` unmounts inactive
  tabs, `EditTransactionSheet` keys `EditForm` on `transaction.id`. The moment
  anyone adds an in-place `setAmount("")` or hydrates from a query after mount,
  re-check that effect first.
- `insert()` / `backspace()` read `el.selectionStart` with `?? draft.length`,
  but a never-focused text input returns `0`, not `null`. Any consumer that
  mounts the field with a pre-filled value and no `autoFocus` (the transfer fee,
  which remounts with the previous `feeAmount` each time the fee toggle is
  flipped back on) inserts the operator at position 0. Guard with
  `document.activeElement === el` if this is touched.
- Blur repair (`onBlur` → `completeExpression`) fires on the Save gesture
  because the footer buttons steal focus; Enter-to-submit does not blur, so the
  repair is skipped there. Anything that depends on the repair having run must
  not assume it.
- `roundTo2` applies to plain numbers too, so `"10.555"` submits `10.56`.

See [[calc-normalize-silent-wrong-number]] for the parser-side hazards.
