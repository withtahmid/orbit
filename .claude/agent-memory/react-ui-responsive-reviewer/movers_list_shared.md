---
name: movers-list-shared
description: MoversList is one shared component rendered by BOTH TrendsView and BudgetDetailPage — measured proof the two hosts are metrically identical, plus the sub-lg name-column collapse trap
metadata:
  type: project
---

`apps/web/src/features/analytics/MoversList.tsx` is the single "Biggest movers" list, rendered by
`pages/space/analytics/views/TrendsView.tsx` (inside a shadcn `Card`/`CardContent p-6`) **and**
`pages/space/budgets/BudgetDetailPage.tsx` (inside `section.od-card.ed-movers`, `padding:20px 22px`).
The envelope page's bespoke `EnvelopeMovers` was deleted; do not reintroduce a second implementation.

**Why:** each bespoke `.ed-mover` row was its own grid container with an `auto` column, so every row's
diverging bar had a different centre. One component is the only thing that keeps the two pages equal.

**How to apply — measured facts (headless Chromium, Geist, see [[tooling-measurement-harness]]):**
- **Both hosts are inside `.orbit-design`** (`SpaceLayout.tsx:85` root is `orbit-design sl-shell`), so
  the "safe inside orbit-design" comment is true but understated — the analytics page was always in
  scope too. `.orbit-design` shadows only `--income`/`--expense`; `--warning` (rgb 246,174,49),
  `--muted-foreground` (rgb 154,172,172), `--border`, `--ring`, `--foreground` all cascade from
  `:root`. Verified identical computed values on both pages.
- **Metrics are identical, not merely similar.** At 1440: `moversH` 314.13 both, `rowH` 43 both,
  `noteH` 45.13 both, font 13px/19.5px/-0.07em Geist both, header↔row mirroring deltas
  (cat/bar/barW/ax0/v1R/v2R/v3R) all **0.00** at 1024/1280/1440 on both pages.
- **Envelope card interior is 4px WIDER than the analytics card at every width** (682 vs 678 @1024,
  1098 vs 1094 @1440, 301 vs 293 @375). `.ed-movers` 22px padding + 1px border beats
  `CardContent p-6` 24px + 1px. So the narrower-host overflow worry is backwards; nothing overflows.
- Envelope card surface is rgb(13,16,15) (`--bg-elev-1`) vs analytics rgb(21,25,25) (`--card`) —
  the envelope one is *darker*, so muted text contrast is slightly better there (8.08:1 vs 7.49:1).

**The trap that `w-0` on the name span introduced (round 5's 🔴3 fix):**
`w-0 min-w-0 flex-1` kills the min-content contribution (fixing page overflow) but the values group
beside it is `shrink-0` at ~205px natural, so below `lg` the name gets only the leftover:
**20.8px @360, 35.8px @375** on the analytics page (28.8 / 43.8 on the envelope page) against
"Groceries" needing 57.61px. Worse, the leftover is *per-row* (each row's numbers are a different
length), so name widths in one list measured `[20.8, 28.4, 26.8, 97.5, 67.1]` — no column at all.
Below ~345px interior the values group wraps and the name snaps back to full width, so there is a
hard cliff between 320 (name 198px) and 360 (name 20.8px).
Verified fix: add `basis-full lg:basis-auto` to the values `<div>` so it takes its own line below
`lg`. Measured after: uniform name widths (253 @375, 382 @768, 637 @1023), `documentElement`
scrollWidth == clientWidth at 320–1440 for typical/long/no-prior data, and **≥1024 is byte-identical**
(nameW 192, barW 158/414/574). Cost: `moversH` 408 → 554 at 375.
