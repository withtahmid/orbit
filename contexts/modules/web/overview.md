# Overview (web)

> Space dashboard at `/s/:spaceId` — a multi-card editorial view of position, flow, allocation, and events that swaps to a cross-space personal variant under `/s/me`.

## Route(s)
- Path: `ROUTES.spaceOverview(id)` / `ROUTES.space(id)` — both resolve to `/s/:spaceId` (index route, see `apps/web/src/router/routes.ts:11-12`).
- Lazy-imported in `apps/web/src/router/index.tsx:25` and mounted as the index child of `SpaceLayout` (`apps/web/src/router/index.tsx:150`).
- Guards: `ProtectedRoute` -> `CurrentSpaceProvider` -> `SpaceLayout`. The page detects the virtual personal space via `space.isPersonal` (set by `CurrentSpaceProvider` when `spaceId === "me"`).

## Files
- Main page: `apps/web/src/pages/space/OverviewPage.tsx` (~3700 lines — defines every card inline plus the `OV_STYLES` block at `:2854`, the `TodayBand` (`:1912`), `PersonalSpaceBand` (`:1152`), an over-allocation banner, and derived chart components: `NetWorthComposition`, `DailyHeatmap`, `TopMovers`, `SpendingTrends`, `AccountsGlance`, `CashFlow`, `BalanceTrend`, `DonutCard`).
- Pulls `CumulativeRaceChart` from the analytics view at `apps/web/src/pages/space/analytics/views/TrendsView.tsx:614` to render the trends mini-chart.
- Reuses `MetricToggle` / `useMetricMode` from `apps/web/src/components/shared/MetricMode.tsx` for the cash-vs-operational toggle (URL-persisted via `?metric=`), and the quantile color helpers (`computeQuantileEdges` / `bucketize` / `ramp`) from `apps/web/src/lib/spendHeatmapColor.ts` for the `DailyHeatmap` card — same palette AND scale as the analytics Spending-calendar view, fed by a trailing-12-month heatmap window (`heatmapEdgesStart`, `:48`).

## tRPC procedures consumed
All real-space procs and their personal twins are toggled with `{ enabled: !isPersonal }` / `{ enabled: isPersonal }`:
- `analytics.spaceSummary` + `personal.summary` — period totals for this and last month (`OverviewPage.tsx:57-75`).
- `analytics.cashFlow` + `personal.cashFlow` — weekly cash-flow buckets (`:77-92`).
- `analytics.balanceHistory` + `personal.balanceHistory` — 30-day balance trend (`:93-101`).
- `analytics.envelopeUtilization` + `personal.envelopeUtilization` — month-period envelopes for top-categories and the allocation donut (`:116-124`).
- `analytics.priorityBreakdown` — priority donut, real-space only (`:126-131`).
- `personal.spaceBreakdown` — per-space net worth band, personal only (`:133-137`).
- `analytics.accountDistribution` + `personal.accountDistribution` — net-worth composition + accounts at a glance (`:140-149`).
- `analytics.spendingHeatmap` + `personal.spendingHeatmap` — flow calendar (`:153-161`).
- `analytics.todaySummary` + `personal.todaySummary` — top "Today band" (`:175-183`).
- `analytics.categoryWoW` + `personal.categoryWoW` — week-over-week category movers (`:185-197`).
- `analytics.trends.dailyComparison` + `personal.trends.dailyComparison` — spending trends cumulative race (`:201-216`).
- `analytics.netWorthHistory` + `personal.netWorthHistory` — 12-month net-worth sparkline (`:218-232`).

Removed since earlier revisions (the cards were cut in the orbit-4 redesign): `event.listBySpace` (upcoming events), `analytics.incomeBreakdown` (income sources), `analytics.recurring` (bills/subscriptions), `analytics.topMerchants` — none of these are queried by the Overview anymore.

## State & mutations
- Local state: `[now]` frozen at mount, `mode` from `useMetricMode()` (cash vs operational), derived month/period boundaries via `addMonths`, `startOfMonth`, `endOfMonth` (`@/lib/dates`).
- No mutations — the Overview is purely read-only. The "New transaction" CTA in the topbar links into Transactions (`OverviewPage.tsx:421-429`) and is hidden when `isPersonal`. When `summary.unallocated > 0` a "Budget <month>" CTA linking to `ROUTES.spaceBudgetMonth` takes the primary slot and New-transaction demotes to ghost (`:377-429`).
- No `PermissionGate` usage here; gating happens implicitly because the personal sentinel sets `myRole: "viewer"` (see `CurrentSpaceProvider.tsx:54`) and the page also explicitly hides the New-transaction CTA on personal.

## Conventions & gotchas
- The page wraps everything in `.orbit-design ov-root` (`OverviewPage.tsx:347`) and inlines its CSS in the giant `OV_STYLES` template literal at the bottom — do not look for a Tailwind class story.
- "Cash" mode = bank balance view including transfers; "Operational" = true income/expense. Default is operational and the choice persists in `?metric=` via `useMetricMode`. Some tiles always use operational regardless of toggle.
- Personal-twin dispatch is the dominant pattern: every query has a `Space` variant and a `Personal` variant, both declared at the top with `{ enabled }` flags, then `const x = isPersonal ? personal : space` to pick one.
- The over-allocation banner renders (real-space only) when `summary.data.isOverAllocated` is true — a server-computed, epsilon-guarded flag on `analytics.spaceSummary` (`OverviewPage.tsx:297,449`), NOT a client-side `unallocated < 0` check; it prompts the user to deallocate or record income. There is no borrow or reckoning banner.

## Cross-references
- Server: `apps/server/src/routers/analytics.mts` and `apps/server/src/routers/personal.mts` (every `analytics.X` has a personal twin; see project CLAUDE.md §"Router tree").
- Web: shares `CumulativeRaceChart` with `analytics/views/TrendsView.tsx`; donut data flows from the same `envelopeUtilization` proc used by `budgets/BudgetsPage.tsx`.
