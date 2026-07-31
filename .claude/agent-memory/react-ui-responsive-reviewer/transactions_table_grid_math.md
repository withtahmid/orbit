---
name: transactions-table-grid-math
description: Solved arithmetic for the /transactions desktop table grid — fixed-track totals per breakpoint band, the 1280→1281 non-monotonic drop, the ~67.5px root-line threshold, and the 116px Type-slot budget.
metadata:
  type: project
---

`.tx-row-grid` in `apps/web/src/pages/space/transactions/TransactionsPage.tsx` uses `minmax(0, Nfr)`
tracks with no floor, so the fr columns (From/To, Category, Envelope) collapse hard on
laptop widths. The math needs four files (SpaceLayout `.sl-aside` 232px, `.sl-main` padding,
`.tx-root` negative margin, `.tx-scroll` padding, `.od-card` border, `.tx-row` padding) so
it is worth keeping the answer.

**Grid content width = viewport − 334px.** `.tx-row-grid` has **no `column-gap`** — cells abut
directly, so a track's width is the cell's full budget. The card is ALWAYS `tx-show-balance`
(hardcoded at the JSX), so the non-balance templates never apply to real rows.

**Two template bands** (both `tx-show-balance`; the `.tx-table-no-event` personal twin differs
only in the fr sum):

| band | template | fixed | fr sum |
|---|---|---|---|
| 901–1280px (media override hides Event + By) | `96 116 1.2fr 1fr 1fr 120 124 56` | **512** | 3.2 |
| ≥1281px (Event + By return) | `96 116 1.2fr 1fr 1fr .55fr 92 124 124 56` | **608** | 3.75 |
| ≥1281px personal (`.tx-table-no-event`) | same minus the `.55fr` | 608 | 3.2 |

| viewport | fr pool | 1fr | Category text (−28 for avatar+8px gap) |
|---|---|---|---|
| 901px  | 55  | **17px**  | overflows — the 20px avatar alone doesn't fit |
| 1024px | 178 | 55.6px | ~28px |
| 1151px | 305 | 95.3px | ~67.3px |
| 1152px | 306 | 95.6px | ~67.6px |
| 1280px | 434 | 135.6px | ~108px |
| 1281px | 339 | **90.4px** | ~62px |
| 1299px | 357 | 95.2px | ~67.2px |
| 1300px | 358 | 95.5px | ~67.5px |
| 1440px | 498 | 132.8px | ~105px |

**Standing traps:**
1. **901–1050px is already broken** (pre-existing, out of scope for reviews) — fr tracks land
   at 17–45px, the `flexShrink: 0` 20px `Avatar` overflows its grid item, and
   `.tx-table-card` is `overflow: clip` so it collides with the next column instead of
   scrolling. Any new content in Category/Envelope/From-To inherits this.
2. **The 1280→1281 boundary is non-monotonic** — widening the window makes the fr
   columns *narrower* (135.6 → 90.4px) because Event + By come back at 1281. Never
   validate a Category/Envelope change at 1280 only. `.tx-cat-root`'s hide query
   (`max-width:1151px, (min-width:1281px) and (max-width:1299px)`) encodes exactly this:
   **show iff Category text ≥ ~67.5px**. Viewport-keyed queries are safe here because the
   container width is a deterministic function of viewport (sidebar is a constant 232px at
   every width where the table renders — `.sl-aside` appears at ≥768px, table at ≥901px).
   The personal variant is slightly over-hidden at 1281–1299 (it has 78px there) — cosmetic.

**Type track budget = 116px in BOTH bands.** `.tx-badge` labels are all single words
("Income"/"Expense"/"Transfer"/"Adjustment"), so the badge's min-content == max-content and
it **cannot wrap** — no row-height jitter is possible from compressing it. Widest badge
"Adjustment" ≈ 95px (2 border + 18 padding + 12 icon + 5 gap + ~58px text @ 11px Geist 500).
`.tx-type-slot` adds `gap: 6px` and a 10px `.tx-saving-spinner` on saving rows →
**~111px in 116px, ~5px slack**. Overflow (bad font fallback, larger UA font) shows as the
spinner nudging into From/To's left edge, never as a wrap.

**Row height is pinned by the Date cell at 30px** (13px + 12px @ `line-height: 1.2`), or
38px when `.tx-cell-desc` renders. Any two-line cell must stay ≤30px total.
`.tx-cat-name`(13px) + `.tx-cat-root`(11px) @ `line-height: 1.25` = exactly 30px.

**Do NOT "guard" a two-line cell with `min-height: 30px` + `align-items: flex-start`.**
Three avatar columns sit side by side — Category (20px), Envelope (20px), By (24px) — and
`.tx-row-grid { align-items: center }` centres all three on one horizontal line.
`align-items: flex-start` on `.tx-cell-cat` lifts only that column's avatar to the name
line's centre (8px vs 15px) → a 7px stagger vs Envelope, plus 7px row-to-row jitter inside
the Category column (rows with a sub-category vs without). `min-height` alone is not inert
either: when the root line is hidden (≤1151px) the single flex line is only 20px and
`align-content` has no effect on a single-line flex container, so the line parks at
cross-start and the centred avatar lands at 10px, not 15px. Correct answer: no min-height,
no align override — let the grid centre a naturally-sized cell. A live code comment above
`.tx-event-chip` records this; don't re-suggest the fix.
