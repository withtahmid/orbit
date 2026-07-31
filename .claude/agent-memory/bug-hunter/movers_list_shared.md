---
name: movers-list-shared
description: apps/web/src/features/analytics/MoversList.tsx is rendered by BOTH TrendsView and BudgetDetailPage, but each page derives the `hasPrevious` prop differently — one from dailyComparison, one from the limit-truncated rows — and only TrendsView gates its surrounding copy on it.
metadata:
  type: project
---

`apps/web/src/features/analytics/MoversList.tsx` — the "biggest movers" list,
shared by `pages/space/analytics/views/TrendsView.tsx` and
`pages/space/budgets/BudgetDetailPage.tsx`.

The component has **two mutually exclusive renderings** keyed off one boolean
prop, `hasPrevious`:
- `true` → diverging ±100% axis, `prev → cur` column, `Change ↓` + `% change`
  headers, share-of-prior footnote.
- `false` → left-to-right `0 … cap` magnitude scale, `Spent ↓` header, "One
  shared scale — a full bar is X" footnote, no comparison column at all.

**The trap:** the two pages compute `hasPrevious` from different sources.
- TrendsView: `dailyData.previousLength > 0` — comes from `trendsDailyComparison`,
  which applies `mode` (cash/operational) while `trendsCategoryMovers` does not.
- BudgetDetailPage: `moversData.some((m) => m.previousTotal > 0)` — derived from
  the **already-sliced** `limit: 5` rows, sorted by `|deltaAmount|`.

Neither is the movers query's own answer. The right fix is for
`trendsCategoryMovers` (+ its `personal.*` twin) to compute the flag over the
full row set *before* `items.slice(0, input.limit)` and return it, so both pages
read one field.

**Verified facts, don't re-derive:**
- `previousLength` from `trendsDailyComparison` IS a true bucket count, not the
  last non-empty bucket: `classified` LEFT JOINs `spend` onto a
  `generate_series` of `all_buckets`, so empty buckets emit rows. The
  `prevDailyAvg = lastMonthFull / PREV_LENGTH` divisor is correct.
- `all_buckets` starts at `LEAST(earliest data, cur_start)`, so when the prior
  period is the user's *first, partial* period, `idx` (a ROW_NUMBER over
  present buckets) left-shifts it — a Jul-15 first transaction plots at
  position 1 alongside Aug 1. Narrow (one period per account lifetime).
- `.orbit-design` (styles/orbit-design.css) overrides only `--income`,
  `--expense`, `--fg*`, `--line*`, `--warn` — NOT `--warning`,
  `--muted-foreground`, `--foreground`, `--border`, `--ring`. So MoversList is
  genuinely safe to render inside that scope. The app is dark-only (no
  `prefers-color-scheme` / `.light` in index.css), so `bg-foreground/*` on a
  forced-dark `.orbit-design` surface can't invert.
- Tailwind v4.2.2 emits `lg:flex-none` BEFORE `lg:basis-48`, so `basis-48` wins
  and the name column is a rigid 12rem despite the row's `w-0`. Not a bug.

**How to apply:** any new consumer of `MoversList` must (a) derive
`hasPrevious` from the movers response itself, and (b) gate its own surrounding
heading/subtitle on the same boolean — TrendsView does, BudgetDetailPage does
not. See [[budget-detail-page-analytics]].
