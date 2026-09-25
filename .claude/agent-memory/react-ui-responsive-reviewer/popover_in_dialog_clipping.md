---
name: popover-in-dialog-clipping
description: Which Orbit dialog hosts clip a `portal={false}` Radix Popover, how availableHeight is measured, and why Radix never sizes a popover to the dialog (verified against node_modules).
metadata:
  type: project
---

A `portal={false}` Radix Popover (ColorPicker / IconPicker / date pickers) is sized and
placed **against the viewport only** — never against the dialog it sits in.

**Why:** verified in `node_modules`:
- `@radix-ui/react-popper` passes `collisionBoundary: []` → `@floating-ui/dom`'s
  `getClippingRect` takes the `[].concat(boundary)` branch, so the clipping ancestor
  list is `['viewport']`. The dialog's box is not a collision boundary.
- `--radix-popper-available-height` is set by the `size()` middleware on the
  `[data-radix-popper-content-wrapper]` div; `PopoverContentImpl` re-exports it as
  `--radix-popover-content-available-height` as an **inline style on the content div** —
  so any direct child of `PopoverContent` can read it, and it measures viewport space.
- `size()` receives `detectOverflowOptions`, so **`collisionPadding` DOES shrink
  `availableHeight`** (`react-popper/dist/index.mjs:85-125`). With `collisionPadding={8}`
  and the default `sideOffset={4}`, availableHeight ≈ max(spaceAbove, spaceBelow) − 12.
  `flip()` runs before `size()`, so the value matches the final placement.
- `shift()` runs with `mainAxis: true, crossAxis: false` — only horizontal shifting.
- `getOffsetParent` returns null for a `position: fixed` element, then falls through to
  `getContainingBlock()` → the transformed `DialogContent`, so placement stays correct.

**How to apply:** whether the panel is visibly cut off depends on the host:
- `DialogContent` always has `translate-x-[-50%] translate-y-[-50%]` → it is the
  containing block for the fixed popover. If it *also* clips, the popover is clipped.
- `orbit-shell-host` sets `overflow: visible !important` on DialogContent and moves the
  scroll to `.oms-body` (no transform) → **no clipping**. Safe host.
- `pages/space/events/CreateOrEditEventDialog.tsx` was the broken case; it now uses
  `<DialogContent className="overflow-visible …">` + an inner scrolling wrapper.
  `cn` is twMerge and `conflictingClassGroups.overflow = ["overflow-x","overflow-y"]`,
  so `overflow-visible` really does drop the base `overflow-y-auto` (verified by running
  twMerge 3.5.0). Two side effects of that pattern: the absolute `dialog-close` X stops
  scrolling with the content (it is DialogContent's child, not the wrapper's), and the
  wrapper's own `max-h` must leave room for DialogContent's padding **and its 1px border**
  or it spills a couple of px past the bottom hairline.
- `.ct-inspector` (CategoriesPage slide-over) is `transform: none` when open and only
  `overflow: hidden` → not a containing block → **does not clip**.
- Page-level hosts under `.sl-main` (no overflow, no transform) → no clipping.

Also: Radix `FocusScope` autofocuses the first tabbable element on popover open
**regardless of `trapped`** (the mount effect is not gated on it), so whatever is first
in the popover's DOM gets focus — see [[icon-picker-panel-budget]].
Tabbing *out* of a non-modal popover closes it and correctly leaves focus where the user
tabbed to (`hasInteractedOutsideRef` suppresses the trigger refocus); closing by selecting
inside returns focus to the trigger.
