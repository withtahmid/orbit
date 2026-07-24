# Events (web)

> Trip / project / occasion bucket pages — tag transactions to an event to roll up totals across categories. List has a segmented status filter (active / closed / all) and estimate progress bars; the detail page is a chart-heavy multi-section view (budget gauge, spend timeline, category donut, top locations, filterable transactions).

## Route(s)
- List: `ROUTES.spaceEvents(id)` -> `/s/:spaceId/events` (`apps/web/src/router/routes.ts:24`).
- Detail: `ROUTES.spaceEventDetail(id, eventId)` -> `/s/:spaceId/events/:eventId` (`apps/web/src/router/routes.ts:25`).
- Lazy-imported in `apps/web/src/router/index.tsx:37-38`, mounted at `apps/web/src/router/index.tsx:195-202` under `SpaceLayout`.
- Guards: `ProtectedRoute` -> `CurrentSpaceProvider` -> `SpaceLayout`. Real-space only — `SpaceLayout` hides the Events tab in personal mode (`apps/web/src/layouts/SpaceLayout.tsx:74-77`); inside the pages `space.id` is always a real UUID.

## Files
- `apps/web/src/pages/space/events/EventsPage.tsx` (~843 lines) — the list. Contains the page, the `StatusFilterSegmented` component (`:451`), and `YearPicker` (`:482`).
- `apps/web/src/pages/space/events/EventDetailPage.tsx` (~1355 lines) — the detail, rebuilt as a chart-heavy multi-section page. Top-down: `HeroBand` (`:207`), `StatTiles` (`:319`, card-less metrics band), `BudgetCard` (`:448`, wraps `RadialBudgetGauge`), `CategoryCard` (`:549`, category-tree donut), `TimelineCard` (`:508`, daily spend timeline), `WhereCard` (`:587`, top locations), `TransactionsCard` (`:647`, filterable infinite list), `AttachmentsCard` (`:883`). Reuses the same `ev-*` orbit-design CSS scope as the list.
- Local helpers:
  - `apps/web/src/pages/space/events/eventCharts.tsx` — the detail page's Recharts components: `SpendTimelineChart` (`:65`, cumulative burn vs pace + daily-volume bars), `CategoryDonutChart` (`:438`), `RadialBudgetGauge` (`:685`).
  - `apps/web/src/pages/space/events/eventUtils.ts` — chart-free helpers: app-tz day math (`parseAppDay`, `appDayStr`, `daySpanInclusive`, `enumerateDays`), row types (`DailyRow`, `BreakdownRow`, `LocationRow`), and `buildCategoryTree` (`:101`) which nests the flat breakdown for the donut.
  - `apps/web/src/pages/space/events/CreateOrEditEventDialog.tsx` — name, dates, color, icon, description, estimated amount; mutations `event.create` / `event.update`.
  - `apps/web/src/pages/space/events/DeleteEventDialog.tsx` — confirm + `event.delete`.
  - `apps/web/src/pages/space/events/EventStatusButton.tsx` — active <-> closed toggle via `event.setStatus`.
  - `apps/web/src/pages/space/events/eventUI.tsx` — shared `DesignIcon`, `EntityAvatar`, `EstimateProgressBar` (`:134`), `Metric`, `Money`, `Skeleton`.
  - `apps/web/src/pages/space/events/types.ts` — `EventTotal` hydrated type, `EventStatus`, `eventCalendarState(start, end, now)` returning `"Past" | "Recent" | "Active" | "Upcoming"` (orthogonal to lifecycle status).

## tRPC procedures consumed
List page (`EventsPage.tsx`):
- `analytics.eventTotals` — every event in the space with expense/income totals, tx count, lifecycle status (`:39`).

Detail page (`EventDetailPage.tsx`):
- `event.getById` — base event record (`:54`).
- `analytics.eventTotals` narrowed via `{ eventId }` — totals row shared with the list card (`:57`).
- `analytics.eventCategoryBreakdown` — per-category split (`:62`).
- `expenseCategory.listBySpace` — full category list so `buildCategoryTree` can nest the breakdown (`:68`).
- `analytics.eventDailySpend` — per-day spend rows for the hero sparkline and `SpendTimelineChart` (`:72`).
- `analytics.eventTopLocations` — the WhereCard (`:73`).
- `file.listForEvent` — attachments card (`:77`).
- `transaction.listBySpace` via `useInfiniteQuery` with `eventId` + card-local filters — Transactions card (`:669`).

Mutations (dialogs):
- `CreateOrEditEventDialog`: `event.create` (`:64`), `event.update` (`:72`). Invalidates `event.listBySpace`, `analytics.eventTotals`, `event.getById`.
- `DeleteEventDialog`: `event.delete` (`:28`). Invalidates `event.listBySpace`, `analytics.eventTotals`, `transaction.listBySpace`, `transaction.filteredTotals`.
- `EventStatusButton`: `event.setStatus` (`:26`). Invalidates `event.listBySpace`, `analytics.eventTotals`, `event.getById`.

## State & mutations
- List local state: `year` (default current year), `statusFilter` (`"all" | "active" | "closed"`). `yearEvents` filters by year overlap; `counts` per status; `visibleEvents` applies the status filter.
- `StatusFilterSegmented` (`:451`) is a three-position pill control showing the count badge per status.
- `YearPicker` (`:482`) shows prev/current/next year plus any year that has at least one event.
- Detail Transactions card state (all local to `TransactionsCard`): `type` (income/expense/…), `categoryId` (single-select over the breakdown's categories), and a search box debounced 300ms — the raw input is trimmed and capped at 255 chars BEFORE debouncing so a whitespace-only or over-long query never hits the server's zod `.min(1).max(255)`. Pagination is `useInfiniteQuery` (`getNextPageParam` reads `nextCursor`); `hasFilters`/`clearFilters` key off the immediate input so the Clear button doesn't lag the debounce.
- Permission gating: `PermissionGate roles={["owner","editor"]}` around create and row quick-actions on the list, and around the detail page header actions.

## Conventions & gotchas
- Two separate state machines: lifecycle (`status: "active" | "closed"`, controlled by users via `EventStatusButton`) and calendar position (`eventCalendarState` derived from start/end vs `now`). The hero shows both — don't confuse them.
- `estimatedAmount` is nullable; sections degrade individually — `RadialBudgetGauge` only renders with an estimate (`hasEstimate`, `EventDetailPage.tsx:449`), `SpendTimelineChart` drops its pace line, and the list's `EstimateProgressBar` (`eventUI.tsx:134`) owns the "set an estimate" empty-state.
- Event day math must go through `eventUtils.ts` (`parseAppDay` etc.) — the helpers exist precisely so chart bucketing doesn't drift a day for viewers outside Asia/Dhaka; don't reintroduce native `Date` getters on absolute instants.
- Deleting an event invalidates `transaction.listBySpace` because transactions formerly tagged to the event now show "untagged" — keep that invalidation when adding new write paths.

## Cross-references
- Server: `apps/server/src/procedures/event/*` (one-per-file), plus `analytics.eventTotals`, `analytics.eventCategoryBreakdown`, `analytics.eventDailySpend`, and `analytics.eventTopLocations`.
- Web: file attachments use `file.listForEvent` shared with the file-handling code; `transaction.listBySpace` consumption mirrors `pages/space/transactions/TransactionsPage.tsx` and the per-account view in `accounts/AccountDetailPage.tsx`; the budget-gauge `EnvelopeSpendChart` copies this page's top-rounded daily-bar convention.
