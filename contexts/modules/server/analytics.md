# analytics module (server)

> The per-space analytics surface: read-only procedures that power Overview, Envelopes, Events, Trends, Anomalies, and the Year report. Every procedure is `authorizedProcedure`, requires owner/editor/viewer membership of the target space, and reads from `transactions` (transfer fees are their own `type='expense'` rows since migration `042` — no special folding needed).

## Router

- File: `apps/server/src/routers/analytics.mts:37`. Top-level keys plus two sub-routers (`trends`, `anomalies`).

Procedure groupings (in router order):

| Group | Procedures |
| --- | --- |
| Summary cards | `spaceSummary`, `todaySummary` |
| Cash flow | `cashFlow`, `cumulativeSpend` |
| Categories | `topCategories`, `topCategoriesByBucket`, `categoryBreakdown`, `categoryMonthlyTrend`, `categoryWoW`, `priorityBreakdown`, `topMerchants`, `incomeBreakdown` |
| Envelopes | `envelopeUtilization`, `envelopeMonthlyAllocations`, `envelopeRecentAverages` |
| Events | `eventTotals`, `eventCategoryBreakdown`, `eventDailySpend`, `eventTopLocations` |
| Accounts | `accountDistribution`, `accountBalanceHistory`, `balanceHistory`, `netWorthHistory` |
| Heatmaps & reports | `spendingHeatmap`, `yearReport` |
| Recurring detection | `recurring` |
| `trends` sub-router | `dailyComparison`, `yearOverYear`, `categoryMovers` |
| `anomalies` sub-router | `outliers`, `recurring`, `patternBreaks`, `streaks`, `shapeStats` |

## Procedures

All are `.query`, all share the same membership/`safeAwait` boilerplate. Inputs default to `{ spaceId, periodStart, periodEnd }` unless noted.

### Summary cards

- **`spaceSummary`** (`procedures/analytics/spaceSummary.mts:9`) — Wide overview: `totalBalance`, `spendableBalance`, `lockedBalance` (liabilities subtracted, locked accounts excluded from spendable), envelope `allocated/consumed/remaining` for the current cadence period, `unallocated = spendable - Σ GREATEST(0, allocated − consumed)` (the "held" cash each envelope ties up, clamped so overspend never inflates free cash), plus dual `period*` (cash) and `operational*` (excludes transfer principal) income/expense. The dual classification is the canonical reference; see "Domain math" below.
- **`todaySummary`** (`procedures/analytics/todaySummary.mts:19`) — IN/OUT/count for a single day; day boundaries computed by Postgres `date_trunc('day', ...)` so they honor the session timezone (`todaySummary.mts:38-43`).

### Cash flow

- **`cashFlow`** (`procedures/analytics/cashFlow.mts:9`) — Bucketed income/expense/net series. Input includes `bucket: "day"|"week"|"month"` and `mode: "cash"|"operational"`. Implementation builds a `buckets` CTE via `generate_series` and a `deltas` CTE; the `xferFactor = mode==='cash' ? 1 : 0` (`cashFlow.mts:69`) gates the transfer-principal CASE branches. Transfer fees are standalone expense rows (migration `042`) and count as outflow via the ordinary expense branch. Result is left-joined onto buckets so empty buckets render as zero.
- **`cumulativeSpend`** (`procedures/analytics/cumulativeSpend.mts:20`) — Day-level cumulative spending over the current and (matching duration) previous window, optional `project: boolean` extrapolation. Input: `{ periodStart, periodEnd, includePrevious=true, project=false }`.

### Categories

- **`topCategories`** (`procedures/analytics/topCategories.mts:24`) — Top-N leaf categories by expense spend over a window (`limit` 1-50, default 5). Uses **`source_account_id IN scope_accounts`** rather than `transactions.space_id` so totals match `cashFlow` (see comment `topCategories.mts:15-23`). Transfer fees arrive as their own expense rows, so no separate fee branch exists.
- **`topCategoriesByBucket`** (`procedures/analytics/topCategoriesByBucket.mts`) — Per-bucket per-category time series for stacked bars. Account-scoped via the same `scope_accounts` CTE.
- **`categoryBreakdown`** (`procedures/analytics/categoryBreakdown.mts:16`) — Recursive subtree expenditure per category. `WITH RECURSIVE tree AS ...` climbs the parent-id tree with a `path` array cycle guard (the DB has no cycle constraint; a corrupt A→B→A chain would otherwise spin until statement timeout). Returns one row per category (the FULL tree, zero-filled) with both `directTotal` and `subtreeTotal`. Accepts the shared Trends filter set (`envelopeIds`/`accountIds`/`categoryIds` via `trendsFilterInputShape`), and scopes spend by `scope_accounts` (`source_account_id IN ...`) in addition to `transactions.space_id`.
- **`categoryMonthlyTrend`** (`procedures/analytics/categoryMonthlyTrend.mts:26`) — Monthly time series behind `categoryBreakdown`: same input shape (spaceId + period + trends filters), same full-tree-every-time contract, but one row per category per calendar month in `[periodStart, periodEnd)` (months materialized via `generate_series`, zero-filled). Each row carries `{ id, parentId, name, color, icon, month: 'YYYY-MM-DD', directTotal, subtreeTotal }` so the Categories page's trend chart can slice with the same `focus`/`rootRows` client logic as the donut and always agree with it.
- **`categoryWoW`** (`procedures/analytics/categoryWoW.mts:18`) — Week-over-week category deltas anchored at `input.anchor ?? new Date()`. Limit defaults 6.
- **`priorityBreakdown`** (`procedures/analytics/priorityBreakdown.mts`) — Spending grouped by category `priority` (`essential`/`important`/`discretionary`/`luxury` — see migration `031_add_category_priority.mts`).
- **`topMerchants`** (`procedures/analytics/topMerchants.mts:19`) — Top-N by normalized description, with current vs previous-window totals so the UI shows trend arrows.
- **`incomeBreakdown`** (`procedures/analytics/incomeBreakdown.mts:21`) — Per-source split of income deposits (and crediting adjustments) in the window.

### Envelopes

- **`envelopeUtilization`** (`procedures/analytics/envelopeUtilization.mts:20`) — One row per envelope (no per-account `breakdown[]` — allocations are space-wide). Cadence-aware: `monthly` envelopes sum the per-month allocation rows whose `period_start` lands in the requested window (one row per month) and count window-scoped spend; rolling/goal envelopes (`cadence='none'`) report the single NULL-period lifetime pool row and lifetime spend, window-independent. `remaining = allocated − consumed`, no carry-over. Also surfaces goal fields (`lifetimeFunded`, `pctSaved`/`targetAmount`/`targetDate`) and a `lifetimeOverrun` (rolling only).
- **`envelopeMonthlyAllocations`** (`procedures/analytics/envelopeMonthlyAllocations.mts`) — Calendar-year monthly allocation history for ONE monthly-cadence envelope. Input `{ spaceId, envelopeId, year? }`. Pairs with `trends.yearOverYear`'s per-month spend on the envelope detail page. Rolling/goal envelopes have no monthly allocation concept, so it only has data for `cadence='monthly'`.
- **`envelopeRecentAverages`** (`procedures/analytics/envelopeRecentAverages.mts`) — Trailing-N-period averages per envelope; powers "you usually spend ~$X" hints.

### Events

- **`eventTotals`** (`procedures/analytics/eventTotals.mts:9`) — Per-event income/expense totals and `txCount`. Input `{ spaceId, eventId? }` — passing `eventId` narrows to a single event so the detail page reuses the same procedure. Returns each event's `status`, `closed_at`, and `estimated_amount` alongside totals (`eventTotals.mts:46-49`) so the UI can render "Closed Mar 14" subtitles and budget bars without a second fetch.
- **`eventCategoryBreakdown`** (`procedures/analytics/eventCategoryBreakdown.mts`) — Leaf-category expense spend within a single event. Input `{ eventId }`; resolves space via the event row, then membership-gates.
- **`eventDailySpend`** (`procedures/analytics/eventDailySpend.mts:20`) — Per-day expense/income totals + `txCount` for a single event, grouped by the APP_TZ calendar day of `transaction_datetime` (returned as a `'YYYY-MM-DD'` string the client parses as a wall-clock date). Input `{ eventId }`; resolves space via the event row. Rows are only emitted for days with activity — the client fills the visual window from the event's start/end range. Powers the spend-timeline and day-of-week strip on the event detail page.
- **`eventTopLocations`** (`procedures/analytics/eventTopLocations.mts:13`) — Top spending locations for a single event, ranked by expense total. Input `{ eventId, limit: 1..20 = 8 }`. Groups case-insensitively on `lower(btrim(location))`; blank/null locations are excluded. Returns `{ location, total, txCount }`. Powers the "Where it went" section on the event detail page.

### Accounts

- **`accountDistribution`** (`procedures/analytics/accountDistribution.mts`) — Balance per account in the space; pie/treemap input.
- **`accountBalanceHistory`** (`procedures/analytics/accountBalanceHistory.mts`) — Time-bucketed balance trace for a single account.
- **`balanceHistory`** (`procedures/analytics/balanceHistory.mts:9`) — Multi-account history. `accountIds: string[]?` filter, empty array = all space accounts (`balanceHistory.mts:14-16`).
- **`netWorthHistory`** (`procedures/analytics/netWorthHistory.mts:22`) — Sum of balances treating liability accounts as negative; bucketed.

### Heatmaps & reports

- **`spendingHeatmap`** (`procedures/analytics/spendingHeatmap.mts:16`) — Per-day spend totals over `[periodStart, periodEnd)` for the calendar heatmap. Input adds `mode: "cash"|"operational" = "cash"` plus the shared Trends filter set. Always counts expenses whose source is in scope; in `cash` mode a cross-space outbound transfer (source in, dest out) also counts as principal spend — mirroring `cashFlow`/`spaceSummary` so a day's heatmap cell and the cash-flow expense bar agree. In `operational` mode the transfer branch is multiplied to 0 (`xferFactor`) — moving money to your own savings isn't spending. (The Spending calendar page passes `operational` explicitly; the schema default exists to match `cashFlow`.) A category or envelope filter naturally drops the transfer branch (transfer principal rows carry no `expense_category_id`/`envelop_id`).
- **`yearReport`** (`procedures/analytics/yearReport.mts:22`) — Per-envelope per-month planned vs spent for a calendar year (monthly-cadence envelopes only). Input `{ spaceId, year: int 2000..2100 }`. Builds yearStart / yearEnd in UTC; allocation `period_start` comparisons cast via `::timestamptz::date` (see Conventions).

### Recurring

- **`recurring`** (`procedures/analytics/recurring.mts:28`) — Heuristic recurring-charge detector for the BillsCard / SubscriptionsGrid. Groups expense transactions by `(source_account_id, LOWER(TRIM(description)))` over `lookbackDays` (default 120), requires ≥3 hits with consistent inter-arrival intervals, then classifies cadence (`weekly/biweekly/monthly/yearly`) and kind (`bill` vs `subscription`) using helpers in `procedures/analytics/utils/recurringDetect.mts`. The shared helper module is also imported by `anomalies.recurring` and `anomalies.patternBreaks` so the four surfaces stay consistent.

### `trends` sub-router

- **`trendsDailyComparison`** (`procedures/analytics/trendsDailyComparison.mts`) — Current period vs prior period daily spend. Granularity enum (week/month/year), `anchor: Date?` defaults to today, dual `cash`/`operational` mode (`trendsDailyComparison.mts:6-12`).
- **`trendsYearOverYear`** (`procedures/analytics/trendsYearOverYear.mts`) — Monthly buckets for a year vs the previous year. `year?` defaults to current calendar year.
- **`trendsCategoryMovers`** (`procedures/analytics/trendsCategoryMovers.mts`) — Categories whose period-over-period delta is largest. `limit: int 1..50, default 10`.

### `anomalies` sub-router

- **`anomaliesOutliers`** (`procedures/analytics/anomaliesOutliers.mts:20`) — Per-category z-score outliers within a window. `sigma: 1..5, default 2`. Categories with fewer than 3 hits in the window are skipped to keep `STDDEV_SAMP` stable (`anomaliesOutliers.mts:79-82`).
- **`anomaliesRecurring`** (`procedures/analytics/anomaliesRecurring.mts`) — Recurring charges that have moved by ≥`minDeltaPct` or ≥`minDeltaAmount`, or appear to have cancelled (no hit within `cancelGraceDays` past the expected next date).
- **`anomaliesPatternBreaks`** (`procedures/analytics/anomaliesPatternBreaks.mts`) — Recurring charges whose next expected hit hasn't arrived within `lookaheadDays + graceDays`.
- **`anomaliesStreaks`** (`procedures/analytics/anomaliesStreaks.mts`) — Run-of-day streaks of zero-spend and high-spend.
- **`anomaliesShapeStats`** (`procedures/analytics/anomaliesShapeStats.mts`) — Distribution shape statistics (skew, kurtosis-style measures) per category.

## Domain math / invariants

### Cash vs operational

`spaceSummary`, `cashFlow`, `trendsDailyComparison`, `spendingHeatmap` all expose a `mode: "cash" | "operational"` switch implemented as a `0/1 factor` multiplier on the transfer-principal CASE branches. The classification rules (`spaceSummary.mts:180-200`):

- **cash** — what your bank ledger shows. Cross-space transfer principal counts directionally (an inbound transfer from a non-scope account is `income`; outbound to a non-scope account is `expense`). Internal transfers (both legs in scope) net to zero. Adjustments count.
- **operational** — true income vs true expense. Transfer principal **excluded both directions**. Only `type='income'`, `type='expense'`, `type='adjustment'` (fees are expense rows, so they always count as outflow).

The `operationalIncome`/`operationalExpense` fields exist because moving money between your own checking and savings looks like "expense" under cash semantics — misleading on "Income / Expense" cards.

### Transfer fees are standalone expense rows

Since migration `042_fees_as_expense_transactions.mts`, a transfer fee is its own `type='expense'` transaction (with its own `expense_category_id`, `envelop_id`, and a `parent_transfer_id` back-link to the originating transfer). The old `fee_amount`/`fee_expense_category_id` columns are gone, and so are the `UNION ALL` fee branches that every spend-by-category query used to carry — fees are counted by the ordinary expense aggregation everywhere. Transfers themselves are amount-only.

### Scope rule

Per the long-standing migration / comment trail (`topCategories.mts:17-23`, `cashFlow.mts:50-67`), the canonical "what counts as this space" predicate is account-scoped:

```sql
WITH scope_accounts AS (
    SELECT account_id FROM space_accounts WHERE space_id = $1
)
... WHERE source_account_id IN (SELECT account_id FROM scope_accounts)
       OR destination_account_id IN (SELECT account_id FROM scope_accounts)
```

`transactions.space_id` is a categorization tag (see `transaction` module doc). The former drift (procedures filtering by `space_id` alone) has been cleaned up — `categoryBreakdown`, `incomeBreakdown`, and `topCategoriesByBucket` all use the `scope_accounts` CTE now.

### Envelope period semantics

Monthly envelopes **reset** every period — there is no carry-over. The window's `remaining = allocated − consumed`; an overspent envelope shows `remaining < 0` (drift) but never inflates space `unallocated`, which clamps each envelope's held to `GREATEST(0, allocated − consumed)`. Rolling/goal envelopes (`cadence='none'`) are a single lifetime pool. Allocations are space-wide (one row per envelope+period); envelope `consumed` matches `transactions.envelop_id` directly. Implemented identically across `envelopeUtilization`, `spaceSummary`, and the personal twin `summary.mts`.

## Conventions & gotchas

- Every procedure starts with `resolveSpaceMembership` against owner/editor/viewer. Don't add a new analytics procedure that bypasses this — there is no read-only data here that's safe to leak across space boundaries.
- Almost all procedures wrap the SQL block in `ctx.services.qb.transaction().execute(...)`, even though they're queries. The transaction gives them a consistent snapshot when multiple sub-queries are involved.
- The `cash` vs `operational` switch is implemented as a multiplier on the SQL, not by emitting different queries. The two CASE branches are always there; the mode only changes whether the transfer-principal slot is `amount` or `amount * 0`. This means logging the SQL doesn't tell you which mode ran — check the input.
- Day/week/month bucketing always uses Postgres `date_trunc(<bucket>, t::timestamptz)` to respect the session timezone (e.g. Asia/Dhaka in dev). Computing window bounds in JS via `Date.UTC` will slice UTC days, which is wrong for non-UTC sessions. See `todaySummary.mts:38-43` for the standing note.
- **Casting a JS `Date` param against a `date` column must go `::timestamptz::date`, never bare `::date`.** pg serializes the param as text, and PG's text→date cast truncates the literal's date part with NO tz conversion — an APP_TZ month-start instant (July 1 00:00 +06 = …-06-30T18:00Z) lands on June 30 and misses the allocation row entirely. Going via `timestamptz` makes the date cast honor the session zone. Applied across `envelopeUtilization`, `spaceSummary`, `yearReport`, `resolveEnvelopePeriodBalance`, and the personal twins. `spaceSummary`/`personalSummary` additionally keep raw-instant `p_start_ts`/`p_end_ts` twins of the date-typed bounds for the `transaction_datetime` filters, so consumed totals can never disagree with `envelopeUtilization`.
- Several procedures use `generate_series` to materialize empty buckets so charts have a zero-filled axis. Removing the `LEFT JOIN deltas` against the bucket series will cause gaps to disappear from the chart.
- `recurring`, `anomalies.recurring`, `anomalies.patternBreaks`, and the BillsCard share a single classifier in `procedures/analytics/utils/recurringDetect.mts`. If you change "what counts as a subscription" logic, every dependent procedure shifts.

## Cross-references

- `personal/*` (`routers/personal.mts:43`) — nearly every analytics procedure here has a cross-space personal twin (`eventDailySpend`/`eventTopLocations` are per-space-only, since events are); see the personal module doc for the owned-account scope and internal-transfer rule.
- `transaction.list` / `transaction.filteredTotals` (transaction module) duplicate the in/out classification; they are intentionally compatible with `analytics.cashFlow`.
