---
name: oms-field-row-height-asymmetry
description: A PinControl in an OrbitField hint slot makes that field's label row 24px (36px on touch) instead of 17px — so paired cells in an OrbitFieldRow lose horizontal alignment whenever only one of them shows a pin.
metadata:
  type: project
---

`.oms-field-row` (`apps/web/src/components/orbit/OrbitModalShell.tsx`) is
`display:flex; align-items:baseline` with no height. A label-only row is **17.25px**
(11.5px × line-height 1.5). Drop a `PinControl` into the `hint` slot and baseline alignment against
the button's synthesised baseline (its first flex item is a 12px `<Pin>` svg) grows the row to
**24px** on pointer devices and **36px** under `@media (hover: none)`.

`.oms-field` is a flex column, so that extra height pushes the *control* down. In a two-column
`OrbitFieldRow` the two cells therefore only line up when **both** show a pin.

Known asymmetric cases in `NewTransactionSheet.tsx` (Income + Expense `Date | Account` row):
- `/s/me` — `FieldPin available={!pinState.isPersonal}` renders null, but `DateField`'s
  `useDatePin` control always renders. Permanent 19px misalignment on iPad.
- Any space, before an account is picked — `FieldPin` returns null while `currentValue` is empty,
  then pops in and shoves the Account select down 7px (pointer) / 19px (touch) on selection.

**Why:** the pin controls were added field-by-field, and `.oms-field-row` never reserved height.
**How to apply:** whenever a hint-slot control is added to one cell of an `OrbitFieldRow`, reserve
the row height for the pair rather than for the whole app —
`.of-row > .oms-field > .oms-field-row { align-items: center; min-height: 24px }` plus a
`@media (hover: none)` bump to 36px. Putting `min-height` on bare `.oms-field-row` would add ~19px
to every field in every Orbit form on touch.
