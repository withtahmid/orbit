# personal module (server)

> The cross-space "My money" view at `/s/me`. Mirrors the per-space analytics router procedure-for-procedure so the existing components can swap data source by name when the virtual-space sentinel (`spaceId === "me"`) is active.

## Router

- File: `apps/server/src/routers/personal.mts:43`. Top-level keys plus `trends` and `anomalies` sub-routers (mirrors `analytics`).

The router docstring (`personal.mts:35-42`) states the anchoring rule explicitly: every procedure is anchored on `user_accounts.role = 'owner'` (the caller's personally-owned accounts) unioned across every space they're currently a member of.

## Procedures

All `.query`, all `authorizedProcedure`. Roughly parallel to `analytics.*` but inputs lack `spaceId` (it's implicit: every member space) and the SQL is gated by `owned`-and-`memberSpaces` lookups.

### Shared helpers (`procedures/personal/shared.mts`)

- **`resolveOwnedAccountIds(qb, userId)`** (`shared.mts:10`) — `SELECT account_id FROM user_accounts WHERE user_id = $1 AND role = 'owner'`. Anchor for every personal view: ownership means the money in the account belongs to this user regardless of which spaces it's shared into.
- **`resolveMemberSpaceIds(qb, userId)`** (`shared.mts:29`) — `SELECT space_id FROM space_members WHERE user_id = $1`. Personal aggregations restrict `transactions.space_id = ANY(:memberSpaces)` so removed-from spaces don't bleed into the view even when the user still owns an account that was shared there.

### Summary cards

- **`personalSummary`** (`procedures/personal/summary.mts:33`) — Same shape as `analytics.spaceSummary` (`totalBalance`/`spendableBalance`/`lockedBalance` from owned accounts; envelope `allocated/consumed/remaining` with consumption restricted to owned accounts (allocations are space-wide); dual `period*`/`operational*` flow). Extras: `ownedAccountsCount`, `memberSpacesCount`. Early-return zeros when `owned.length === 0 || memberSpaces.length === 0` (`summary.mts:52`).
- **`personalTodaySummary`** (`procedures/personal/todaySummary.mts`) — Today's IN/OUT/count across owned accounts.

### Cash flow

- **`personalCashFlow`** (`procedures/personal/cashFlow.mts:14`) — Bucketed series. `mode` enum like analytics. Internal `owned → owned` transfers are always excluded as rebalancing regardless of mode (`cashFlow.mts:93-105`). Returns zero-filled buckets when the user has no owned accounts / no member spaces (`cashFlow.mts:54-68`).
- **`personalCumulativeSpend`** (`procedures/personal/cumulativeSpend.mts`) — Cumulative spend over current vs prior matching window.

### Categories

- **`personalTopCategories`** (`procedures/personal/topCategories.mts`)
- **`personalTopCategoriesByBucket`** (`procedures/personal/topCategoriesByBucket.mts`)
- **`personalCategoryBreakdown`** (`procedures/personal/categoryBreakdown.mts`) — Categories are space-scoped, so rows carry `spaceId`/`spaceName` rather than being merged into one cross-space tree. Recursive tree walk is cycle-guarded with a `path` array, same as the analytics twin.
- **`personalCategoryMonthlyTrend`** (`procedures/personal/categoryMonthlyTrend.mts:16`) — Monthly time series behind `personalCategoryBreakdown` (same shape/caveats, rows also carry `month: 'YYYY-MM-DD'`, `directTotal`, `subtreeTotal`), bucketed by calendar month over `[periodStart, periodEnd)`. Input: `{ periodStart, periodEnd, accountIds? }`.
- **`personalCategoryWoW`** (`procedures/personal/categoryWoW.mts`)
- **`personalIncomeBreakdown`** (`procedures/personal/incomeBreakdown.mts`)
- **`personalTopMerchants`** (`procedures/personal/topMerchants.mts`)
- **`personalListCategories`** (`procedures/personal/listCategories.mts`) — Returns every expense category across all the caller's member spaces, one flat list. No input; returns `[]` when `memberSpaces.length === 0`. Row shape is a superset of `expenseCategory.listBySpace` — adds `space_name` (inner-joined from `spaces`) alongside `space_id` so a consumer flattening categories from multiple spaces (e.g. the Transactions page's personal category filter) can disambiguate same-named categories from different spaces. `parent_id` relationships only make sense within one space, so tree-building consumers must group by `space_id` first.

### Envelopes

- **`personalEnvelopeUtilization`** (`procedures/personal/envelopeUtilization.mts`) — Personal-slice envelope utilization. Allocations are space-wide (the single per-envelope+period row, monthly window-scoped or the rolling lifetime pool); consumption restricted to `source_account_id = ANY(owned)`. No carry-over. Mirrors `analytics.envelopeUtilization`.
- **`personalEnvelopeRecentAverages`** (`procedures/personal/envelopeRecentAverages.mts`)

### Accounts

- **`personalAccountDistribution`** (`procedures/personal/accountDistribution.mts`) — Per-account balance for owned accounts, joined with `account_balances`.
- **`personalBalanceHistory`** (`procedures/personal/balanceHistory.mts`) — Multi-account history filtered to owned accounts. Optional `accountIds[]` further narrows.
- **`personalNetWorthHistory`** (`procedures/personal/netWorthHistory.mts`) — Sum of balances over owned accounts with liabilities flipped.
- **`personalOwnedAccounts`** (`procedures/personal/accounts.mts`) — Plain listing of the caller's owned accounts with current balance and account metadata. No input.

### Transactions

- **`personalTransactions`** (`procedures/personal/transactions.mts`) — Personal twin of `transaction.listBySpace`. Input drops `spaceId` (required there) into an optional filter and adds the same set of filters: `type`, `expenseCategoryId`/`expenseCategoryIds` (+ `includeDescendants`), `envelopId`/`envelopIds`, `eventId`, `accountId`/`accountIds`, `userId`, `search`, `amountMin`/`amountMax`, `dateFrom`/`dateTo`, plus cursor + limit — same plural-wins-over-singular precedence as `transaction.listBySpace` (see that module's doc). The WHERE clause restricts to `space_id = ANY(memberSpaces)` AND at least one leg in `owned`. Account filters are additionally intersected with `ownedSet`: a requested `accountId(s)` that isn't owned by the caller is dropped, and if every requested id gets dropped the query short-circuits to an empty page rather than silently ignoring the filter. Each returned item also carries `account_balances_after` (see `transaction.md`'s balance-after helper) computed via the same `computeBalanceAfter`/`computeRowAccountBalances` helpers, but scoped to owned accounts only — the leak boundary for this feed.
- **`personalTransactionFilteredTotals`** (`procedures/personal/transactionFilteredTotals.mts`) — Twin of `transaction.filteredTotals`, same plural/singular filter set as `personalTransactions` above (no cursor/limit/balance). Returns `{ inTotal, outTotal, net, count, avgPerDay, days }`. `inTotal` sums `type='income'` rows, `outTotal` sums `type='expense'` rows — transfer fees are their own expense rows since migration `042`, so they land in `outTotal` naturally.

### Spaces

- **`personalSpaceBreakdown`** (`procedures/personal/spaceBreakdown.mts:25`) — Per-space split of the caller's personal net worth. Each owned account contributes to exactly one bucket (`DISTINCT ON` the earliest `space_accounts.created_at` for accounts shared into multiple member spaces); accounts not shared into any member space fall into a `bucket_kind = 'personal'` residual. Liability balances are sign-flipped to reconcile with `personalSummary.totalBalance`.

### Heatmaps & report

- **`personalSpendingHeatmap`** (`procedures/personal/spendingHeatmap.mts`) — Daily spend totals across member spaces, restricted to owned accounts. Input `{ periodStart, periodEnd, accountIds?, mode: "cash"|"operational" = "cash" }`. `cash` counts expenses plus owned-outbound cross-space transfer principal (source owned, destination NOT owned — a transfer out of your own accounts reduced your personal cash); `operational` multiplies the transfer branch to 0 so only true `type='expense'` debits count. Mirrors `personalCashFlow`'s mode split.
- **`personalYearReport`** (`procedures/personal/yearReport.mts`)

### Recurring & anomalies

- **`personalRecurring`** (`procedures/personal/recurring.mts`) — Recurring detector over owned-account expense streams across all member spaces.
- **`personalAnomaliesOutliers`** (`procedures/personal/anomaliesOutliers.mts`)
- **`personalAnomaliesRecurring`** (`procedures/personal/anomaliesRecurring.mts`)
- **`personalAnomaliesPatternBreaks`** (`procedures/personal/anomaliesPatternBreaks.mts`)
- **`personalAnomaliesStreaks`** (`procedures/personal/anomaliesStreaks.mts`)
- **`personalAnomaliesShapeStats`** (`procedures/personal/anomaliesShapeStats.mts`)

### Trends

- **`personalTrendsDailyComparison`** (`procedures/personal/trendsDailyComparison.mts`)
- **`personalTrendsYearOverYear`** (`procedures/personal/trendsYearOverYear.mts`)
- **`personalTrendsCategoryMovers`** (`procedures/personal/trendsCategoryMovers.mts`)

## Domain math / invariants

### Scope predicate

The canonical predicate for "is this transaction in my personal scope" is:

```sql
WHERE space_id = ANY(:memberSpaces)
  AND (
      source_account_id = ANY(:owned)
      OR destination_account_id = ANY(:owned)
  )
```

(`cashFlow.mts:122-128`, `summary.mts:264-270`). The `space_id` clause prevents removed-from spaces from bleeding back in; the account clause restricts to legs the caller personally owns.

### Internal-transfer rule

A transfer where `source_account_id = ANY(owned) AND destination_account_id = ANY(owned)` is an **internal rebalance** and is excluded from personal cash flow entirely (`cashFlow.mts:93-105`, `summary.mts:212-230`). Only the fee on such transfers counts (as outflow), because the fee money actually leaves the user's hands. This applies regardless of `mode` — internal transfers are always excluded; the `mode` switch only affects cross-space transfer principal.

### Cash vs operational

Same dual semantics as `analytics.spaceSummary` / `analytics.cashFlow`:

- **cash**: cross-space transfer principal counts directionally (`owned ↔ non-owned`).
- **operational**: ALL transfer principal excluded; only `type='income'`, `type='expense'`, `type='adjustment'` (transfer fees are expense rows, so they always count as outflow).

See `summary.mts:212-224` for the inline reference.

### Envelope partitions

Envelope `allocated` is the single space-wide allocation row for the envelope's period — monthly window-scoped, rolling/goal the lifetime NULL-period pool (`summary.mts:136-206`). Consumption is restricted to `source_account_id = ANY(owned)`. Monthly envelopes reset each period (no carry-over); held is `GREATEST(0, allocated − consumed)`. Matches the analytics module.

### Liability handling

Mirrors analytics: `account_type = 'liability'` balances are sign-flipped in `total_balance`/`spendable_balance` sums (`summary.mts:79-90`). `account_type = 'locked'` is excluded from `spendable_balance` and accumulated in `locked_balance` separately.

## Conventions & gotchas

- Personal procedures do NOT go through `resolveSpaceMembership` — the caller's identity IS the auth surface. Make sure new procedures still gate by `owned` / `memberSpaces` lookups rather than directly trusting a client-supplied `spaceId`.
- Empty result early-return: when `owned.length === 0 || memberSpaces.length === 0`, several procedures (`personalSummary`, `personalCashFlow`) return zero-filled or empty shapes. New procedures should follow the same convention so the UI doesn't break on a fresh account.
- Where the SQL needs a non-empty array parameter (e.g. `ANY(:ownedParam::uuid[])`), the code injects a sentinel UUID `00000000-0000-0000-0000-000000000000` rather than letting the query receive an empty array (`yearReport.mts:38-40`, `envelopeRecentAverages.mts:35-37`). Postgres `ANY(empty array)` doesn't error but the alternative form sometimes does — keep the sentinel pattern.
- The internal-transfer exclusion uses `<>= ALL(:owned)` rather than `NOT = ANY(:owned)` because SQL's three-valued logic makes the latter behave wrong with nulls (`cashFlow.mts:96`). Don't simplify.
- `personalListCategories`, `personalOwnedAccounts`, `personalSpaceBreakdown`, `personalAccountDistribution` have NO input arg — they read everything from `ctx.auth.user.id`. Don't add params unless you mean it.
- `personalTransactions` filters can target a single `spaceId`. When the UI is in personal scope but wants "transactions in Space X" the same procedure serves — don't switch to `transaction.listBySpace` for that path because the personal procedure additionally applies the owned-account filter.

## Cross-references

- `analytics/*` — per-space twins of nearly every procedure here. Cash/operational and envelope period math are intentionally identical so the UI components are agnostic.
- `transaction.listBySpace` / `filteredTotals` — `personalTransactions` / `personalTransactionFilteredTotals` accept the same filter set (including the plural `accountIds`/`envelopIds`/`expenseCategoryIds` multi-select params); the only differences are the owned-account scope and that `spaceId` is optional rather than required.
- `shared.mts` exports `resolveOwnedAccountIds` and `resolveMemberSpaceIds`, the anchors for every personal view.
