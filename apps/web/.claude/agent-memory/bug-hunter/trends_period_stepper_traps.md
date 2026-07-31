---
name: trends-period-stepper-traps
description: TrendsView + trends procs traps — prevEnd overlap and the movers rollup are FIXED; live issues are VelocityBars' Typical bar on a whole-period basis (contradicts the "Vs typical" KPI), the truncated-window "New"/"Stopped" labels, setAnchor's string dedupe, and week-granularity chip inertness.
metadata:
  type: project
---

`apps/server/src/procedures/analytics/{trendsDailyComparison,trendsCategoryMovers,trendsYearOverYear}.mts`
(+ `personal/` twins) and `apps/web/src/pages/space/analytics/views/TrendsView.tsx`.

## FIXED — do not re-flag
- **Movers rollup** (`roots`/`roots_all` seeded from `id = ANY(categoryIds)`,
  unscoped by space). Totals conserved; only the "shallowest bucket wins" comment
  is wrong (it's the *nearest selected ancestor*).
- **`prevEnd` overlap / double-count.** Clamped client-side AND in both procs.
  Verified 3 years × every day × 4 granularities: 0 overlap. See
  [[movers-elapsed-window-invariant]].
- **"New" drawn as a measured +100%** — `overCap`/`clipped` now special-case
  `previousTotal === 0`.
- **`!hasPrevious` diverging axis** — header now prints `0 … moverAmount(cap)`
  where `cap` is the trimmed spend cap.
- **Movers header/row misalignment** — the whole table moved `sm:` → `lg:`
  (widths 6.75/4.75/3.5rem). Fixed sum ≈ 520px vs 678px card interior at a
  1024px viewport ⇒ ~158px bar column. No dead `sm:` classes remain in
  `MoversList` (though its comments still say "from sm").
- **`−0%` / unreachable `×10`** — `moverChangeLabel` now thresholds on
  `ratio = cur/prv`; no gap between "+900%" and "×10".
- **`avg_pool_start`, `'skip'`, `previous`-own-length invariant** — still
  verified-good, don't "fix".

## LIVE — VelocityBars' Typical bar uses a different basis from the KPI
`curDailyAvg` and `prevDailyAvg` are **elapsed-windowed** (`/TODAY`,
`/min(TODAY, PREV_LENGTH)`), but `typicalDailyAvg = typicalFull / DAYS_IN_MONTH`
is **whole-period**. The KPI strip's "Vs typical" uses `monthSoFar / typicalSoFar`
(elapsed). They disagree and can point OPPOSITE ways. Verified on the local seed
DB (space `019f9407…`, July 2026, pool = 16 months): day 29 → KPI **−1.8%**
("below your typical pace") while `curDailyAvg / typicalDailyAvg` is **+1.1%
above**; day 2 → KPI +52.5% vs bars +398.5% (7.6× apart). Agrees exactly only for
a closed period. `typicalSoFar` is already computed one line above — the fix is to
use it when `isLive`.

## LIVE — truncated prior window vs category-level labels
See [[movers-elapsed-window-invariant]]. Day 1 of a month makes the whole top-6
window artefacts ("Stopped" on the month's top spender + four `0 → 0 · —` rows);
quarter granularity mislabels real prior-quarter categories as "New".

## LIVE — smaller ones
- `MoversList` bar `title` still reads "Far beyond the other categories — bar
  clipped" in the `hasPrevious` branch, where `overCap` actually means "grew by
  more than 100%".
- `fill` is computed unconditionally though only the `!hasPrevious` branch uses it
  (`cap` is 1 otherwise) — dead, harmless.
- `yoyHeaviestGrowth` seeds `bestPct = -Infinity`, so an all-declining year
  reports a decline under the label "Heaviest growth".
- `setAnchor`'s duplicate-history guard compares the raw `?p` **string**, so
  quarter/week granularity still pushes duplicate entries. Deliberately not fixed.
- `yoySelectedRange` is `null` for week AND year granularity ⇒ `showBand` and the
  chip-centring effect are both inert at week granularity.
- `EndpointStat` "Difference" passes a red swatch colour when `value` is `null`
  (`monthSoFar - 0 > 0`), so an em-dash gets a red dash beside it.
- `VelocityBars`' chip keeps its red/green tint while `loading` skeletons the
  number — the tint is the held claim.
- `VelocityBars`' label span is `truncate` with **no `title`** (unlike
  `EndpointStat`); closed-period labels like "December 2025" can clip in the
  4.5rem column. Row `key` is `r.label`; verified no duplicate-key case exists
  across all four granularities.
- `VelocityBars`' outline ("Typical") row: `h-2` + `border-[1.5px]` +
  `box-sizing: border-box` means width `0` or `minWidth: 3px` renders as a
  **solid 3px blob** of `--income`, not an outline — and a genuine `value === 0`
  leaves that stub while the two solid rows render nothing. Reachable with the
  seed DB's 35.3M July outlier (typical/max ≈ 0.03%).
- `delta === 0` in the chip picks `TrendingDown` + `--income` (flat reads as
  "improving").
- `var(--muted)` IS a real colour at `:root` (`hsl(180 8% 13%)`) and TrendsView is
  **outside** `.orbit-design`, so the chip background is fine. Don't re-flag.
  (`--fg`/`--fg-3`/`--warn` are `.orbit-design`-scoped, but BudgetDetailPage's
  root IS `.orbit-design`, so its `var(--fg)` usages resolve too.)
- `VelocityRow` is fully removed; `MoneyDisplay` is genuinely unused in
  TrendsView. `tsc -b` and `eslint` clean (warnings only).
- `KpiStrip`'s `sm:col-span-2` odd-count branch and its `items.length <= 6` lg
  branch are STILL dead — re-counted 2026-08-01: all 8 `KpiItem[]` callers pass
  exactly 4.

## Array-length invariant (still current, now sharper)
`previous` is sized by `previousLength`, which **can be 0** — see
[[previous-array-can-be-empty]]. `average` is now gated server-side at
`averagePeriods >= 2`.

**How to apply:** when auditing this proc or its consumers ask "is `previous` the
same length as `current` here (and can it be empty)?", "is this rate
elapsed-windowed or whole-period, and does its neighbour agree?", and remember
this client has NO tRPC transformer — server `Date` arrives as an ISO string while
the inferred type says `Date` (see [[apptz_format_trap]]).
