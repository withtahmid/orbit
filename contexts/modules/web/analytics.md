# Analytics (web)

> An index of analytics views — a grid of tiles at `/analytics` that link into per-view pages. Each detail view is its own page with its own period selector and personal-twin queries.

## Route(s)
- Index: `ROUTES.spaceAnalytics(id)` -> `/s/:spaceId/analytics` (`apps/web/src/router/routes.ts:26`).
- Per-view detail: `ROUTES.spaceAnalyticsDetail(id, view)` -> `/s/:spaceId/analytics/:view` (`apps/web/src/router/routes.ts:27`). Note the router uses one explicit child route per view name, so the dynamic `:view` slug is informational — only the eight enumerated paths actually resolve.
- Lazy-imported and mounted under `SpaceLayout` in `apps/web/src/router/index.tsx`.
- Guards: `ProtectedRoute` -> `CurrentSpaceProvider` -> `SpaceLayout`. All detail views are personal-aware (each query has a personal twin guarded with `{ enabled: isPersonal }`) except `PriorityView`, which just calls the real-space proc — Analytics is in the personal nav, so that view WILL break on `/s/me`.

## Files
- Index: `apps/web/src/pages/space/analytics/AnalyticsPage.tsx` — a static `ENTRIES` array (`:32-95`) renders 8 tiles. No tRPC calls of its own. Each tile is a `<Link>` to `ROUTES.spaceAnalyticsDetail`.
- Shared shell: `apps/web/src/pages/space/analytics/views/_AnalyticsLayout.tsx` — `AnalyticsDetailLayout` provides a back link to `ROUTES.spaceAnalytics(space.id)`, the page header, and a content slot. Every view that uses it wraps its body in this shell.
- Shared filter components (`apps/web/src/pages/space/analytics/components/`):
  - `AnalyticsFilterBar.tsx` + `useAnalyticsFilters.ts` — Envelope / Account / Category multi-select dropdowns whose state lives in URL params (`env`, `acc`, `cat`). Collapses to just Accounts on `/s/me` (envelopes/categories are space-scoped) unless the host opts in via `personalCategories`. Hosts can hide dimensions (`dimensions`), append page-local chips (`trailingChips`), and override the accounts footnote. Also consumed by `TransactionsPage` — see `web/transactions.md`.
  - `CategoryMultiSelect.tsx` — the hierarchical category picker extracted out of the filter bar; reused standalone by `EnvelopesView` and `CategoriesView` to narrow their trend charts.

## Detail views (each under `apps/web/src/pages/space/analytics/views/`)
- `CashFlowView.tsx` — monthly/weekly income vs expense buckets with a top-categories-by-bucket detail panel. Procs: `analytics.cashFlow` + `personal.cashFlow` (`:42-63`), `analytics.topCategoriesByBucket` + `personal.topCategoriesByBucket` (`:65-79`).
- `CategoriesView.tsx` (~1080 lines) — category spend with prev-period delta, a `DrillableDonut` that navigates the category tree (`:778`), a flat top-N mode (`ViewModeToggle`), and a monthly multi-line trend chart (`MultiSeriesLineChart`, `:968`) narrowed via `CategoryMultiSelect` (`:930`). Procs: `analytics.categoryBreakdown` + `personal.categoryBreakdown` (current `:131,141` + prev `:153,163`), `analytics.categoryMonthlyTrend` + `personal.categoryMonthlyTrend` (`:453,463`). Uses `AnalyticsFilterBar` (`:649`).
- `EnvelopesView.tsx` (~860 lines) — envelope utilization for the chosen period plus live-month context. Procs: `analytics.envelopeUtilization` + `personal.envelopeUtilization` (`:63-71`), a `trpc.useQueries` fan-out of `analytics.trends.dailyComparison` — one per active monthly envelope, `envelopeIds: [id]` each — feeding a per-envelope cumulative-spend `MultiSeriesLineChart` with per-envelope pace reference lines (`:90-141`), and `analytics.yearReport` + `personal.yearReport` for a year-to-date strip (`:154-158`). `CategoryMultiSelect` narrows which envelopes' lines render (`:370,424`); `EnvelopeGlass` renders a "bottle grid". Pace/projection only applies when `preset === "this-month"` (`isLivePeriod`).
- `BalanceHistoryView.tsx` — bucketed balance line, optionally narrowed to an account. Procs: `analytics.balanceHistory` + `personal.balanceHistory`, `analytics.spaceSummary` + `personal.summary`, `account.listBySpace` + `personal.ownedAccounts` for the picker.
- `HeatmapView.tsx` (~1440 lines) — twelve-month spending calendar with data-derived color buckets, plus a spend-by-day/week/month bar chart (`barGranularity` toggle, `:92`), a weekday breakdown, top-5 "heaviest weeks" rows that deep-link into Transactions, and an intensity-slab donut whose external legend hover syncs with the ring (`Donut` `activeId`/`onActiveIdChange`). Procs: `analytics.spendingHeatmap` + `personal.spendingHeatmap` (`:134-152`), `analytics.recurring` + `personal.recurring` (`:161-165`). Filterable via `AnalyticsFilterBar` (`:548`) and metric-mode aware (`useMetricMode("operational")`). Color math lives in `apps/web/src/lib/spendHeatmapColor.ts` (`computeQuantileEdges` / `bucketize` / `ramp` — quantile edges, outlier-trimmed, never hardcoded amounts), shared with the Overview's calendar card.
- `TrendsView.tsx` (~1490 lines) — daily comparison + year-over-year + category movers; also exports the `CumulativeRaceChart` used by the Overview (`:614`). Procs: `analytics.trends.dailyComparison` + `personal.trends.dailyComparison` (`:116-128`), `analytics.trends.yearOverYear` + `personal.trends.yearOverYear` (`:139-149`), `analytics.trends.categoryMovers` + `personal.trends.categoryMovers` (`:155-167`). Uses `AnalyticsFilterBar` (`:334`).
- `AnomaliesView.tsx` — outliers, recurring changes, pattern breaks, streaks, shape stats. Procs: `analytics.anomalies.{outliers, recurring, patternBreaks, streaks, shapeStats}` + matching `personal.anomalies.*` (`:20-87`).
- `PriorityView.tsx` — essential / important / discretionary / luxury split. Procs: `analytics.priorityBreakdown` (`:33`). Real-space only.

Notes on removed views:
- The former `AccountsView.tsx` (account distribution) was removed — account distribution now lives in the Accounts page summary as a horizontal stacked bar (`pages/space/accounts/AccountsPage.tsx` + `AccountDistributionBar.tsx`). The `analytics.accountDistribution` + `personal.accountDistribution` procs still exist and power the Overview page.
- `AllocationsView.tsx` ("Allocation map") was deleted along with its route, tile, and the `analytics.allocations` server proc.

## State & mutations
- Index page: zero state, zero tRPC calls.
- Each detail view manages its own period state via `usePeriod()` or local `useState`; each view's URL params (e.g. `?from=` / `?to=`) are independent. Views using `AnalyticsFilterBar` additionally persist `env` / `acc` / `cat` multi-value params via `useAnalyticsFilters()`.
- The cash / operational metric toggle (`useMetricMode()` from `@/components/shared/MetricMode`) is used by `CashFlowView`, `TrendsView`, and `HeatmapView` to drive a `mode` query input.
- No analytics view writes any data — there are no mutations or `invalidate()` calls in `views/`.
- No `PermissionGate` usage — every view is read-only.

## Conventions & gotchas
- The index `ENTRIES` array is the source of truth for which tiles render; the `soon` flag on an entry adds a "Soon" pill but doesn't change the link target. Currently no entry has `soon: true`.
- The dynamic `:view` slug in `ROUTES.spaceAnalyticsDetail` is convention only — the actual router declares 8 explicit child routes (`apps/web/src/router/index.tsx:186-220`). Adding a new view requires both a new tile in `ENTRIES` AND a new route entry.
- `PriorityView` lacks a personal twin (there is no `personal.priorityBreakdown`). It renders in `/s/me` because Analytics is in the personal nav, but it will fail since the proc rejects the synthetic `id: "me"` space id.
- `CumulativeRaceChart` is defined in `TrendsView.tsx:614` and re-imported by `OverviewPage.tsx:21` — keep its export stable.
- HeatmapView drill-down links hand-build `?period=custom&from=&to=` URLs — remember `to` is EXCLUSIVE (the code comments call this out twice); a link built without the +1-day adjustment silently returns 0 results.
- The detail shell (`_AnalyticsLayout`) uses shadcn-style `Button` + `PageHeader` rather than orbit-design CSS, so analytics detail pages look more "default shadcn" than the rest of the app.

## Cross-references
- Server: every analytics view consumes procedures from `apps/server/src/routers/analytics.mts` and (for views with personal-aware twins) `apps/server/src/routers/personal.mts`.
- Web: `OverviewPage.tsx` imports `CumulativeRaceChart` from `TrendsView.tsx` and the quantile color helpers from `lib/spendHeatmapColor.ts`; `AnalyticsFilterBar` + `useAnalyticsFilters` are shared with `TransactionsPage` (see `web/transactions.md`); many of the same procs (spaceSummary, balanceHistory, envelopeUtilization, accountDistribution, yearReport) are also called by the Overview, Budgets, BudgetMonth, and Year Report pages.
