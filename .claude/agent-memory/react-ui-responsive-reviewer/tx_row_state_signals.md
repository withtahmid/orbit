---
name: tx-row-state-signals
description: Settled design of the /transactions row in-flight states (pending vs saving) — why opacity was rejected for saving rows, and the tint-vs-hover collision that remains by choice.
metadata:
  type: project
---

`/transactions` rows carry two distinct in-flight states. Treat the distinction as settled;
don't propose collapsing them.

- **`__pending`** (`.tx-row-pending` / `.tx-mrow-pending`) — an optimistic CREATE with no real
  transaction behind it. `opacity: 0.55`, `pointer-events: none`, `tabIndex -1`,
  `aria-busy` + `aria-disabled`, and the type badge is **replaced** by `.tx-pending-spinner`.
  Legitimate because the row is not yet a thing the user can act on.
- **`__saving`** (`.tx-row-saving` / `.tx-mrow-saving`) — a REAL row with an optimistic edit
  out. Stays fully interactive (badge, click target, keyboard focus) and only the Edit
  hand-off in `TransactionDetailsSheet` is gated. **Why:** the flag has no timeout, so a hung
  request would otherwise leave a real ledger row permanently unreadable/unmanageable.
  `aria-busy` is deliberately NOT set here — the values are exactly what the user wants read
  back; a `role="status"` spinner beside the badge carries the state instead.

**Opacity is banned as the saving signal.** Group opacity composites text as well as
background: at 0.72 every `--fg-3` line in the row (root category, time, author) fell to
~3.3:1 on an *enabled* row, and hover feedback flattened to ~1.04:1. The chosen marker is
`background: color-mix(in oklab, var(--brand) 7%, transparent)` (12% on hover) plus
`box-shadow: inset 2px 0 0 var(--brand)` — it touches no foreground colour.

**Known, accepted weakness:** `--bg-elev-1` is oklch 17% L and `--bg-elev-2` (the normal row
hover) is 20% L; 7% brand over 17% lands at ~20.9% L with only ~0.010 chroma. So the
saving tint at rest is visually near-identical to *any row under the cursor*. The 2px inset
brand bar (nothing else in the table has a left edge bar) and the spinner are what actually
distinguish it. Don't "fix" the tint by raising the percentage without re-checking `--fg-3`
contrast — raising it eats the same headroom opacity did.

Also: `.tx-row:focus-visible` is `outline: 2px solid var(--brand); outline-offset: -2px`,
i.e. the exact position and colour of the saving bar — a focused saving row's bar merges
into the ring. Cosmetic, known.

`.tx-saving-spinner` is applied as `className="tx-pending-spinner tx-saving-spinner"` so it
inherits the `prefers-reduced-motion` rule that targets `.tx-pending-spinner`. Keep both
classes on it.
