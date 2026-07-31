---
name: orbitfield-label-click-forwarding
description: OrbitField renders a <label> by default; every non-interactive pixel of the field forwards clicks to its first labelable descendant — the recurring stray-click bug class in Orbit's forms.
metadata:
  type: project
---

`OrbitField` (`apps/web/src/components/orbit/OrbitModalShell.tsx`) renders `<label class="oms-field">`
unless `noWrapperLabel` is passed. A `<label>` forwards a click on any *non-interactive*
descendant (or on the label text / hint / gaps) to its **first labelable descendant in tree
order** — `button`, `input`, `select`, `textarea`. So any OrbitField whose content is a button
turns the whole field row into a hit target for that one button.

**Why:** this produced a shipped bug where clicking anywhere in the Receipts row opened the OS
file picker (`FileUploadField`'s "Add file" button). Same mechanism silently mutates data when
the content is a button grid or a radio row, and closes a picker when the content is a
`portal={false}` Radix popover — because the *popover content itself* renders inside the label,
so its padding/indent/empty-state areas forward to the trigger and toggle it shut.
Non-portaled pickers: `CategoryTreeSelect`, `ColorPicker`, `IconPicker`, `EntityStyleFields`.
(Portaled controls — the three date pickers — escape the label and are safe.)

**How to apply:** when reviewing any new/edited `OrbitField`, classify the content.
Plain `OrbitInput`/`OrbitTextarea` → keep the `<label>` (click-to-focus is the point, and it is
the *only* thing naming that input — there is no `for`/`id` wiring). Anything else — button grid,
`OrbitRadioRow` (also nested-`<label>` invalid HTML), colour/icon picker, non-portaled popover
trigger, or a field with a second control in the `hint` slot (`FieldPin`/`PinControl`) — needs
`noWrapperLabel` **plus** an explicit `role="group"`/`aria-label` on the content wrapper, since
dropping the label also drops the group's accessible name. `CategoriesPage`'s Priority field is
the reference implementation. `.oms-field` is a class selector with `display:flex`, so
`<div>` and `<label>` render identically — the swap is visually free.
