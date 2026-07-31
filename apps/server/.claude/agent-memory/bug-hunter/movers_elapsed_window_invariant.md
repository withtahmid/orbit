---
name: movers-elapsed-window-invariant
description: trendsCategoryMovers window invariants — the prevEnd overlap/double-count is FIXED (verified 3yr x 4 granularities, zero overlap); what remains is that the truncated prior window makes "New"/"Stopped"/"prevShort → periodShort" read as category-level claims.
metadata:
  type: project
---

`apps/server/src/procedures/analytics/trendsCategoryMovers.mts` (+ `personal/`
twin) split one scan into two windows inside a single `SUM(CASE …)`:
- `cur` = `dt >= periodStart`, `prv` = `dt < prevEnd`
- row set is `dt >= prevStart AND dt < periodEnd`

## `prevEnd <= periodStart` — FIXED (2026-08, round 4). Don't re-flag.
Clamped in THREE places: `TrendsView.moversWindow` does
`min(prevPeriod.start + elapsedMs, period.start)`, and both procs do
`new Date(Math.min((input.prevEnd ?? input.periodStart).getTime(), input.periodStart.getTime()))`.
Re-verified by simulation against the real `dates.ts`: 3 years × every day ×
{week, month, quarter, year} → **0 ordering violations, 0 days of overlap**
(incl. Mar 29/30/31, May 31, Jul 31, Oct 31, Dec 31, Jun 30, Sep 30).

## What the clamp did NOT fix: the `[prevEnd, periodStart)` gap
The gap belongs to neither bucket and is LARGE early in a period:
month day 1 → 30 days of gap; **quarter day 32 → 59 days of gap** (viewing Q3 on
2026-08-01, `prv` covers only Apr 1 – May 2 of a 91-day Q2).
Verified on the dev Neon DB (`pp's Family`, 2026-08-01):
- **month**: the ENTIRE top-6 is window artefacts — `Tour & Travel` 1850 → 0
  labelled **"Stopped"** (real July total 20,741) and four `0 → 0 · "—"` phantom
  rows (Groceries, Eating Out, Health & Beauty, Purchase — all with real July
  spend).
- **quarter**: `Entertainment` 0 → 2350 labelled **"New"** at rank 5 (real Q2
  spend 621); likewise `Formalities - Gift & Treat` (Q2 7,181), `Hangouts` (840),
  `Mobile & Communication` (1,187).

`moverChangeLabel`'s "New"/"Stopped" and the header's `prevShort → periodShort`
are category-level claims, but the number behind them is a truncated window that
nothing on the card names. The fix is labelling/copy (name the elapsed window),
not the window itself.

## Rollup — verified FIXED, don't re-flag
`roots`/`roots_all` seeds from `id = ANY(categoryIds)` when a filter is active,
unscoped by space (0 cross-space `parent_id` edges). Totals conserved vs raw
`expense_category_id` grouping (0 filters, two siblings, parent + own child,
childless leaf). The `roots` comment says "shallowest bucket wins";
`array_length(path,1)` is 1 for every SEED row, so what wins is the **nearest
selected ancestor**. Sound and double-count-free; only the comment is wrong. The
`personal/` twin hardcodes `parent_id IS NULL` — correct, personal has no
category filter. 115 categories in the dev DB, so the unscoped recursion is cheap.

## `trendsYearOverYear` gained `mode` (2026-08)
Defaults to `"cash"` (old behavior). `BudgetDetailPage`'s `yoyQuery` omits it
while its sibling `dailyQuery` on the same page passes `"operational"`. Harmless
TODAY only because `envelopeFilterWhere` requires `envelop_id = ANY(...)` and
**zero transfer rows carry an `envelop_id` in either DB** — re-check that if
transfers ever become envelope-taggable.

**How to apply:** check `prevStart <= prevEnd <= periodStart <= periodEnd` (now
enforced), then ask what the `[prevEnd, periodStart)` gap does to every LABEL the
client derives from `previousTotal === 0` / `currentTotal === 0`.
See [[analytics-invariants]], [[previous-array-can-be-empty]].
