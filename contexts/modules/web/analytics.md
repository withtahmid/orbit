# Analytics (web)

> An index of analytics views — a grid of tiles at `/analytics` that link into per-view pages. Each detail view is its own page with its own period selector and personal-twin queries.

## Route(s)
- Index: `ROUTES.spaceAnalytics(id)` -> `/s/:spaceId/analytics` (`apps/web/src/router/routes.ts:26`).
- Per-view detail: `ROUTES.spaceAnalyticsDetail(id, view)` -> `/s/:spaceId/analytics/:view` (`apps/web/src/router/routes.ts:27`). Note the router uses one explicit child route per view name, so the dynamic `:view` slug is informational — only the nine enumerated paths actually resolve.
- Lazy-imported and mounted under `SpaceLayout` in `apps/web/src/router/index.tsx`.
- Guards: `ProtectedRoute` -> `CurrentSpaceProvider` -> `SpaceLayout`. All detail views are personal-aware (each query has a personal twin guarded with `{ enabled: isPersonal }`); the views that don't have a personal twin (allocations, priority) just call the real-space proc and rely on the SpaceLayout sidebar hiding analytics in personal mode — except `analytics` itself is in the personal nav, so those two views WILL break on `/s/me`.

## Files
- Index: `apps/web/src/pages/space/analytics/AnalyticsPage.tsx` — a static `ENTRIES` array (`:34-113`) renders 10 tiles. No tRPC calls of its own. Each tile is a `<Link>` to `ROUTES.spaceAnalyticsDetail`.
- Shared shell: `apps/web/src/pages/space/analytics/views/_AnalyticsLayout.tsx` — `AnalyticsDetailLayout` provides a back link to `ROUTES.spaceAnalytics(space.id)`, the page header, and a content slot. Every view that uses it wraps its body in this shell.

## Detail views (each under `apps/web/src/pages/space/analytics/views/`)
- `CashFlowView.tsx` — monthly/weekly income vs expense buckets with a top-categories-by-bucket detail panel. Procs: `analytics.cashFlow` + `personal.cashFlow` (`:42-63`), `analytics.topCategoriesByBucket` + `personal.topCategoriesByBucket` (`:65-79`).
- `CategoriesView.tsx` — top-level category spend with prev-period delta, drill-down by envelope. Procs: `analytics.categoryBreakdown` + `personal.categoryBreakdown` (current + prev) (`:80-117`), `envelop.listBySpace` + `personal.envelopeUtilization` for envelope tagging (`:125-131`).
- `EnvelopesView.tsx` — envelope utilization for the chosen period. Procs: `analytics.envelopeUtilization` + `personal.envelopeUtilization` (`:37-50`).
- `BalanceHistoryView.tsx` — bucketed balance line, optionally narrowed to an account. Procs: `analytics.balanceHistory` + `personal.balanceHistory` (`:147-167`), `analytics.spaceSummary` + `personal.summary` (`:172-184`), `account.listBySpace` + `personal.ownedAccounts` for the picker (`:107-113`).
- `HeatmapView.tsx` — twelve-month spending calendar plus recurring markers. Procs: `analytics.spendingHeatmap` + `personal.spendingHeatmap` (`:48-63`), `analytics.recurring` + `personal.recurring` (`:71-79`).
- `AllocationsView.tsx` — money-partitioning view (accounts -> envelopes); space-wide budget intent, one figure per envelope. Procs: `analytics.allocations` (`:62`). Real-space only — no personal twin.
- `TrendsView.tsx` — daily comparison + year-over-year + category movers; also exports the `CumulativeRaceChart` used by the Overview. Procs: `analytics.trends.dailyComparison` + `personal.trends.dailyComparison` (`:96-107`), `analytics.trends.yearOverYear` + `personal.trends.yearOverYear` (`:113-121`), `analytics.trends.categoryMovers` + `personal.trends.categoryMovers` (`:123-137`).
- `AnomaliesView.tsx` — outliers, recurring changes, pattern breaks, streaks, shape stats. Procs: `analytics.anomalies.{outliers, recurring, patternBreaks, streaks, shapeStats}` + matching `personal.anomalies.*` (`:20-87`).
- `PriorityView.tsx` — essential / important / discretionary / luxury split. Procs: `analytics.priorityBreakdown` (`:33`). Real-space only.

Note: the former `AccountsView.tsx` (account distribution) was removed — account distribution now lives in the Accounts page summary as a horizontal stacked bar (`pages/space/accounts/AccountsPage.tsx` + `AccountDistributionBar.tsx`, built from `account.listBySpace`/`account.listByUser`). The `analytics.accountDistribution` + `personal.accountDistribution` procs still exist and power the Overview page.

## State & mutations
- Index page: zero state, zero tRPC calls.
- Each detail view manages its own period state via `usePeriod()` or local `useState`; each view's URL params (e.g. `?from=` / `?to=`) are independent.
- The cash / operational metric toggle (`useMetricMode()` from `@/components/shared/MetricMode`) is used by `CashFlowView` and `TrendsView` to drive a `mode` query input.
- No analytics view writes any data — there are no mutations or `invalidate()` calls in `views/`.
- No `PermissionGate` usage — every view is read-only.

## Conventions & gotchas
- The index `ENTRIES` array is the source of truth for which tiles render; the `soon` flag on an entry adds a "Soon" pill but doesn't change the link target. Currently no entry has `soon: true`.
- The dynamic `:view` slug in `ROUTES.spaceAnalyticsDetail` is convention only — the actual router declares 10 explicit child routes (`apps/web/src/router/index.tsx`). Adding a new view requires both a new tile in `ENTRIES` AND a new route entry.
- `AllocationsView` and `PriorityView` lack personal twins (the real-space proc has no `personal.X` equivalent). They render in `/s/me` because Analytics is in the personal nav, but they will fail since the proc rejects the synthetic `id: "me"` space id.
- `CumulativeRaceChart` is defined in `TrendsView.tsx:576` and re-imported by `OverviewPage.tsx:12` — keep its export stable.
- The detail shell (`_AnalyticsLayout`) uses shadcn-style `Button` + `PageHeader` rather than orbit-design CSS, so analytics detail pages look more "default shadcn" than the rest of the app.

## Cross-references
- Server: every analytics view consumes procedures from `apps/server/src/routers/analytics.mts` and (for views with personal-aware twins) `apps/server/src/routers/personal.mts`.
- Web: `OverviewPage.tsx` imports `CumulativeRaceChart` from `TrendsView.tsx`; many of the same procs (spaceSummary, balanceHistory, envelopeUtilization, accountDistribution) are also called by the Overview, Envelopes, PlanMonth, and Year Report pages.
