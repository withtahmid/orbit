---
name: orbitfield-label-click-forwarding
description: OrbitField renders a <label> by default, so any field owning a button/radio silently forwards row clicks to it; noWrapperLabel opts out. Known-unfixed sites listed.
metadata:
  type: project
---

`OrbitField` (`apps/web/src/components/orbit/OrbitModalShell.tsx`) renders its
wrapper as a `<label>` unless `noWrapperLabel` is passed (renamed from
`interactiveHint` on 2026-08-01). A `<label>` forwards a click anywhere inside
it — label text, hint text, dead space in the row — to its **first labelable
descendant** (`button`, `input`, `select`, `textarea`). So any field whose
content is a button or a radio group turns the whole row into a hit target for
that one control.

**Why this matters:** it is a *silent state mutation*, not a visual glitch. The
reported instance was `FileUploadField` — clicking the "Receipts" row opened the
OS file picker. The same shape exists wherever the first descendant is a
side-effecting button.

**How to apply:** when reviewing any new or changed `OrbitField` call site, ask
what its first labelable descendant is. `OrbitSelect` and `CategoryTreeSelect`
both render Radix triggers (`<button>`), `OrbitRadioRow` renders one
`<input type="radio">` per option (and nests a `<label>` per option inside the
outer one — invalid HTML), colour/icon pickers are buttons. Only the plain
single-`OrbitInput`/`OrbitTextarea` case should omit the flag.

**All state-mutating sites fixed as of 2026-08-01** — `CreateAccountDialog`
"Account type" + "Style", `NewTransactionSheet` "Reason", every
`FileUploadField` "Receipts" field, and every `CategoryTreeSelect` field now
pass `noWrapperLabel`. 31 of 54 `OrbitField` call sites carry it; the remaining
23 wrap a plain `OrbitInput`/`OrbitTextarea` (where click-to-focus is wanted) or
a single select/date picker where the forwarded click merely opens the picker —
benign-to-desirable, deliberately left as `<label>`.

Related: [[optimistic-tx-ondone-decoupling]] (same working tree / review round).
