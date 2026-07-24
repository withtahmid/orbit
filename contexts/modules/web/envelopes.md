# Envelopes (web)

> Per-period envelope/budget grid (space-wide allocation buckets) with overspend detection, and a chart-heavy per-envelope detail page (pace chart, run-rate, monthly history, category breakdown). Overspend is shown, never blocked; transfer-between-envelopes is the recovery path.

## Route(s)
- List: `ROUTES.spaceBudgets(id)` -> `/s/:spaceId/budgets` (`apps/web/src/router/routes.ts:16`).
- Detail: `ROUTES.spaceBudgetDetail(id, envId)` -> `/s/:spaceId/budgets/:envelopeId` (`apps/web/src/router/routes.ts:17`).
- Month allocator: `ROUTES.spaceBudgetMonth(id, month)` -> `/s/:spaceId/budgets/month/:month` (`apps/web/src/router/routes.ts:18`).
- Lazy-imported in `apps/web/src/router/index.tsx:30-32`, mounted at `apps/web/src/router/index.tsx:164-173` under `SpaceLayout`.
- Guards: `ProtectedRoute` -> `CurrentSpaceProvider` -> `SpaceLayout`. Real-space only: neither page checks `isPersonal`, so the SpaceLayout sidebar hides the Budgets tab in personal mode (`apps/web/src/layouts/SpaceLayout.tsx:74-77`).

## Files
- `apps/web/src/pages/space/budgets/BudgetsPage.tsx` (~2460 lines) — list. Contains the page itself plus inlined dialogs/modals: create/edit envelope, delete confirm, archive toggle, and the page CSS. Also renders a current-month distribution bar (see State below).
- `apps/web/src/pages/space/budgets/BudgetDetailPage.tsx` (~2170 lines) — detail. Same orbit-design CSS scope; hero numbers, `EnvelopeGlass` fill visual, an `EnvelopeSpendChart` cumulative pace/race chart, a `VelocityViz` run-rate section, `EnvelopeMonthlyBars` (12-month allocation/spend history), a category breakdown, allocate/move/top-up dialogs (`:933-988`), archive/unarchive toggle.
- `apps/web/src/pages/space/budgets/BudgetMonthPage.tsx` (~1360 lines) — per-month allocator (allocate across envelopes for a chosen month). Procs: `analytics.envelopeUtilization` (current + prev month), `analytics.spaceSummary`, `analytics.envelopeRecentAverages`; writes via `envelop.allocationCreate` (`:56-98`).
- `apps/web/src/pages/space/budgets/EnvelopeTargetDatePicker.tsx` (~608 lines) — standalone calendar popover for goal target dates. Commits to `onChange` on every day pick and auto-closes (no Apply button; arrow-key browsing is exempt from the auto-close). Stays on `YYYY-MM-DD` strings at the boundary.
- Charts consumed from `apps/web/src/components/budget-gauge/`: `EnvelopeGlass`, `EnvelopeSpendChart` (cumulative line + on-pace reference + a daily-volume bar strip sharing the same Y scale).
- Feature dialogs consumed (all under `apps/web/src/features/allocations/`):
  - `EnvelopeAllocateDialog.tsx` — allocate from an account (accumulating upsert via `envelop.allocationCreate`).
  - `EnvelopeMoveDialog.tsx` — move between envelopes via `allocation.transfer`.
  - `EnvelopeTopUpDialog.tsx` — top up an overspent envelope by pulling from another envelope via `allocation.transfer` (transfer-only; no borrow path).

## tRPC procedures consumed
List page (`BudgetsPage.tsx`):
- `analytics.envelopeUtilization` — main data source: per-envelope `{ allocated, consumed, remaining, archived, cadence, color, ... }` for the active period (`:186`). `remaining = allocated − consumed`.
- `analytics.spaceSummary` — period summary + `spendableBalance` / `unallocated` / `isOverAllocated` for the banner and distribution bar (`:192`).
- `analytics.trends.dailyComparison` — this-month daily series for pace ("trending over") signals (`:249`).
- `analytics.envelopeRecentAverages` — recent-months average spend per envelope (`:298`).
- Mutations: `envelop.create`, `envelop.update`, `envelop.delete`, `envelop.archive` (`:1475,1484,1710,1750`).

Detail page (`BudgetDetailPage.tsx`):
- `analytics.envelopeUtilization` for the current period (`:101`).
- `analytics.trends.dailyComparison` — daily spend series for the pace chart (`:113`).
- `analytics.envelopeRecentAverages` (`:128`) and `analytics.trends.yearOverYear` (`:175`) — run-rate/velocity context.
- `analytics.envelopeMonthlyAllocations` — 12-month allocation/spend bars (`:215`).
- `analytics.categoryBreakdown` narrowed to the envelope (`:223`).
- `envelop.archive` — archive/unarchive via `UnarchiveButton` (`:1898`). (The detail page no longer lists raw transactions — no `transaction.listBySpace` call.)

## State & mutations
- List: local state `monthOffset` (period navigator, `:174`), `query` (search), `sort` (`cadence` / `urgency` / `remaining` / `spent` / `name` / `deadline` / `progress`, `SortMode` at `:71`), `showArchived` (`:206`). `viewingDate` derives via `addMonthsClamped(now, monthOffset)`; `periodStart` / `periodEnd` via `startOfMonth` / `endOfMonth`.
- Distribution bar (current month only, `:632`): each envelope's clamped-at-zero **remaining** ("held" cash, not the original allocation) as a colored segment against a "cash you have" tick from `spaceSummary.spendableBalance`. Sums over ALL envelopes including archived (their allocation rows still tie up cash), and uses the same sub-cent epsilon (`held > funded + 0.005`) as the server's `isOverAllocated` guard, so the bar's hatch and the banner's verdict never contradict each other.
- Common invalidation pattern across allocation mutations: invalidate `envelop.allocationListBySpace`, `analytics.envelopeUtilization`, and `analytics.spaceSummary` (e.g. `EnvelopeAllocateDialog.tsx:76-78`, `EnvelopeTopUpDialog.tsx:118-126`).
- Top-up flow:
  - `EnvelopeTopUpDialog` pulls planned funds from another active envelope with positive remaining via `allocation.transfer` — no money leaves any account. This is the primary overspend remedy.
- Permission gating:
  - Create/edit envelope: `PermissionGate roles={["owner"]}` (BudgetsPage).
  - Allocate / move / top-up dialogs: `PermissionGate roles={["owner","editor"]}` (BudgetDetailPage).
  - Archive / delete: `PermissionGate roles={["owner"]}` (BudgetsPage / BudgetDetailPage).

## Conventions & gotchas
- An envelope row's spendable amount this period is just `allocated`; `remaining = allocated − consumed`. There is **no carry-over and no borrowing** — monthly envelopes reset each period, rolling/goal (`cadence='none'`) envelopes accumulate as a lifetime pool. Overspend (`remaining < 0`) is **shown** in the UI, never blocked or nagged; the recovery path is transfer-between-envelopes (`allocation.transfer`).
- Allocations are **space-wide**: one absolute row per (envelope, period) — one per month for monthly envelopes, one lifetime row (`period_start` NULL) for rolling/goal. Allocate/deallocate is an accumulating upsert; the `amount` is the absolute allocated total, not a delta.
- Goals are `cadence='none'` envelopes with an optional `target_amount` / `target_date` (set via `EnvelopeTargetDatePicker`).
- `archived` envelopes are filtered out of the main list by default and totals — they have no current activity because the server blocks new transactions/allocations on them.
- The period navigator only moves whole months; queries always pass `startOfMonth` / `endOfMonth` of the offset date — don't pass arbitrary ranges. Live-month-only affordances (pace, distribution bar, allocate CTAs) are gated on `monthOffset === 0`.
- `cadence` is `"monthly"` or `"none"` — the default `cadence` sort groups `none` (rolling/goal) envelopes separately from monthly ones.

## Cross-references
- Server: `apps/server/src/procedures/envelop/*` plus `analytics.envelopeUtilization`, `analytics.envelopeRecentAverages`, `analytics.envelopeMonthlyAllocations` (the old `unbudgetedTrend` proc no longer exists).
- Web: `pages/space/budgets/BudgetMonthPage.tsx` writes via `envelop.allocationCreate`; the allocate/move/top-up dialogs under `features/allocations/*` are shared between the budgets list and detail pages.
