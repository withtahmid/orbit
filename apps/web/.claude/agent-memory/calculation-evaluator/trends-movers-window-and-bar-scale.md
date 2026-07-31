---
name: trends-movers-window-and-bar-scale
description: Biggest-movers arithmetic — the round-6 whole-prior-vs-to-date window (structurally gap/overlap-free), the provable deltaPct domain, the shared MoversList module, and the hasPrevious derivation asymmetry between its two call sites.
metadata:
  type: project
---

`trendsCategoryMovers.mts` (+ `personal/` twin) and the shared
`apps/web/src/features/analytics/MoversList.tsx`.

**Window shape — SETTLED in round 6.** The proc takes optional `prevStart` /
`prevEnd`; `prevEnd` defaults to `periodStart` and is clamped
`min(prevEnd, periodStart)`. `spending` spans `[prevStart, periodEnd)`,
`cur = SUM(dt >= periodStart)`, `prv = SUM(dt < prevEnd)`.

- **Both callers pass `prevStart` and omit `prevEnd`**, so `prevEnd === periodStart`
  and the two predicates are **exact complements of the same bound**. The windows
  partition the fetched range with no overlap and no gap, at every granularity, on
  every day — structural, not data-dependent. The round-5 elapsed-truncation
  overrun (double-count) and its mirror gap are both unreachable while no caller
  passes `prevEnd`.
- `prevStart` must be passed because the proc's fallback subtracts the *current*
  period's own length, which misses calendar boundaries (July − 31d = May 31).
  TrendsView passes `prevPeriod.start`; `periodBounds`/`addPeriods` make
  `prevPeriod.end === period.start` exactly at week/month/quarter/year.
  BudgetDetailPage passes `addMonths(periodStart, -1)`, correct at every
  `monthOffset` including year boundaries (`startOfMonth` first ⇒ no day overflow).
- **Measured on the prod clone (`019da6f8…`, round 6):** Aug-2026 view of
  Tour & Travel = **20,741 → 0**, identical to the 20,741 July's own view reports.
  The old truncated window gave **1,850 → 0** on the same screen *and* padded the
  list with six `0 → 0` rows.
- **The `cur===0 && prv===0` server-side filter is provably inert for both current
  callers.** `transactions_amount_check` gives `amount > 0`, a row only exists if it
  has ≥1 txn in `[prevStart, periodEnd)`, and the two arms cover that range exactly,
  so `cur + prv > 0` always. It only fires if some future caller passes a `prevEnd`
  strictly inside the window, where dropping the gap-only rows is the intent.

**`hasPrevious` is derived differently at the two call sites — not equivalent.**
`TrendsView` uses `dailyComparison.previousLength > 0` (does the prior period
contain any spend at all, mode- and filter-aware). `BudgetDetailPage` uses
`moversData.some(m => m.previousTotal > 0)` over **at most 5 returned rows**.
They diverge in both directions:
- top-5 all `prv === 0` while a lower-ranked row has `prv > 0` ⇒ BudgetDetail
  flips to the no-prior branch: bar quantity switches from `|deltaPct|` share to
  `currentTotal/cap`, the axis stops diverging, the `prev → cur` and `% change`
  columns disappear, and the footnote changes. A real comparison is silently
  rendered as a magnitude ranking.
- `previousLength > 0` with every mover row at `prv === 0` (prior spend all
  uncategorized, or outside the movers' expense-only filter) ⇒ TrendsView keeps
  the diverging axis and draws six identical maxed, clipped "New" bars.
**Neither is reachable on the local seed or the prod clone** (checked every
(envelope, month) pair on both; zero instances, and the clone has no uncategorized
spend at all). Latent.

**`deltaPct` domain is provable.** `transactions_amount_check CHECK (amount > 0)`, so
`cur >= 0` and `prv >= 0` always ⇒ `deltaPct ∈ [−1, ∞)`. Therefore:
- a fall can never exceed −100% (so `|deltaPct| > 1` marks *rises only*, and the "square end =
  clipped" mark is correctly unreachable for falls);
- `prv > 0 → deltaPct` and `deltaAmount` always share a sign (no arrow/percent contradiction);
- ~~`moverChangeLabel`'s `|deltaPct| >= 10` switch fires at `cur/prv >= 11` (+1000%, not
  +900%), so "×10" is never rendered.~~ **FIXED (round 5):** thresholds now on
  `ratio = currentTotal / previousTotal` — `>= 1000 → "×1,000+"`, `>= 10 → ×N`, so ×10 is
  reachable at exactly +900%. Residual cosmetic: `maximumFractionDigits: 0` makes
  ratio ∈ [999.5, 1000) print "×1,000" indistinguishably from the "×1,000+" bucket.
- `prv === 0 && cur > 0` returns the sentinel `deltaPct = 1`, which is **not** a measured
  share. `1 > 1` is false, so "New" draws a full half-bar with a *rounded* (= not-clipped)
  end — identical to a real +100% doubling — and doesn't trip the `clipped` footnote.
  Off-scale predicates should read `prv === 0 ? cur > 0 : Math.abs(deltaPct) > 1`.
  **FIXED (round 5):** that exact predicate is now in both `overCap` and `clipped`, so a
  "New" row gets the square clipped end and trips the footnote. `prv === 0 && cur === 0`
  → deltaPct 0 → no bar, `overCap` false, label "—". Correct.

**The bar is share-normalised, the list is amount-ranked.** `halfFill = |deltaPct|·50`
against `left/right: 50%` is geometrically exact: −100% fills the left half, +100% the right,
+50% half of a half. But bar length no longer tracks the server's `|deltaAmount|` sort, so
**the bars do not descend**. Measured (Clothing 719→35.3M, Restaurants 1420→411, Home Maint
2468→3101, Kids 1456→889, Food 1396→997, Transport 951→563): half-track fills
100 / 71.1 / 25.7 / 38.9 / 28.6 / 40.8 — rank 3 draws shorter than ranks 4 and 6.
Worse degenerate case: on day 1 of any period every prior-spending category is exactly
−100% ("Stopped"), so all six bars max out identically across a 136× spread of amounts.
(The doc block was corrected in round 6 — it now says row ORDER encodes absolute
change and bar LENGTH encodes relative change, which is what the code does.)
Round 6 replaced the `Math.max(1.5, halfFill)` percentage floor with `width: halfFill%`
+ `minWidth: magnitude > 0 ? '3px' : undefined`. Still monotone (never inverts two rows);
the gate `magnitude > 0` is still equivalent to `halfFill > 0`. `share = Math.min(100, |deltaPct|*100)`,
`halfFill = share/2` — 100% fills exactly one half-track, geometrically exact.
`formatCompact` in this module is byte-identical to the one it replaced in TrendsView.

See [[trends-period-array-length-invariant]], [[trends-yoy-complete-months-window]].
