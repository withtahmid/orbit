# Accounts (web)

> List of accounts in the space (grouped by owner) beneath a summary card — net-worth hero + composition stats + a full-width account-distribution bar — plus a per-account detail view with balance history, transactions, sharing, members, and settings.

## Route(s)
- List: `ROUTES.spaceAccounts(id)` -> `/s/:spaceId/accounts` (`apps/web/src/router/routes.ts:13`).
- Detail: `ROUTES.spaceAccountDetail(id, accId)` -> `/s/:spaceId/accounts/:accountId` (`apps/web/src/router/routes.ts:14`).
- Lazy-imported in `apps/web/src/router/index.tsx:26-27`, mounted at `apps/web/src/router/index.tsx:152-158` under `SpaceLayout`.
- Guards: `ProtectedRoute` -> `CurrentSpaceProvider` -> `SpaceLayout`. List page is personal-aware (dispatches to `account.listByUser` when `space.isPersonal`); detail page is NOT personal-aware — it always calls `account.listBySpace` with `space.id` (`AccountDetailPage.tsx:86`), so visiting `/s/me/accounts/:id` would not resolve. Personal users reach detail via `/accounts` (the `MyAccountsPage` app-shell route, not this module).

## Files
- `apps/web/src/pages/space/accounts/AccountsPage.tsx` — list. Renders within an `.orbit-design ac-root` wrapper (`AccountsPage.tsx:235`) using inline `AC_STYLES` (custom orbit-design CSS). Top of the page is a summary card (`.ac-summary`, `:284`): a ledger header (net-worth hero + Assets/Locked/Liabilities composition stats via the local `TypeStat`) over a full-width `AccountDistributionBar`. Cards below are grouped by owner (the owner header is suppressed in personal `/s/me`, since every account is yours).
- `apps/web/src/pages/space/accounts/AccountDistributionBar.tsx` — accounts-page-only horizontal stacked bar. Each positive-balance asset/locked account is a `flexGrow`-sized segment; hover/focus swaps a readout line to that account's name/value/%, and a single tap navigates (same as the chips below). Styles live in the parent's `AC_STYLES` (`.ac-dist-*`). This is the home of "account distribution" — the former `analytics/views/AccountsView.tsx` (donut) was deleted and its `analytics/accounts` route removed; the `analytics.accountDistribution` + `personal.accountDistribution` procs still exist and power `OverviewPage`.
- `apps/web/src/pages/space/accounts/AccountDetailPage.tsx` — detail. Uses shadcn-style `<Card>` / `<Tabs>` (`AccountDetailPage.tsx:38,42`) rather than orbit-design CSS — visually distinct from the list.
- Feature dialogs consumed: `apps/web/src/features/accounts/CreateAccountDialog.tsx`, `apps/web/src/features/accounts/AddExistingAccountDialog.tsx`.

## tRPC procedures consumed
List page (`AccountsPage.tsx`):
- `account.listBySpace` with `{ enabled: !isPersonal }` (`:79-82`).
- `account.listByUser` with `{ enabled: isPersonal }` (`:83-85`) — narrowed to owner accounts and decorated with the current user as the sole owner.
- `space.memberList` for the topbar member count (`:86-89`), real-space only.
- No dedicated distribution proc: the net-worth totals, `distSlices`, and `holdingsTotal` that drive the summary and `AccountDistributionBar` are all derived client-side from the same `accounts` array (`totals` `:130`, `distSlices` `:171`, `holdingsTotal` `:198`).

Detail page (`AccountDetailPage.tsx`):
- `account.listBySpace` to find `accountId` in the result (`:86`).
- `transaction.listBySpace` with `accountId` filter, `limit: 50` (`:89-92`). The Transactions tab table also has a Balance column reading `account_balances_after[account.id]` off each row — parity with the running-balance column on the main Transactions page (see `web/transactions.md`); falls back to "—" when the key is absent from the map.
- `account.listUsers` for the Members tab (`:94-97`).
- `analytics.balanceHistory` inside a sub-component for the History tab (`:724`).
- `account.listSpaces` + `account.shareWithSpace` + `account.unshareFromSpace` for sharing (`:485,615,487`).
- `account.update`, `account.delete`, `account.addMember`, `account.removeMember` (`:99,338,421,392`).
- `auth.findUserByEmail` for the invite-by-email flow (`:417`).

Feature dialogs:
- `CreateAccountDialog`: `account.create` (`CreateAccountDialog.tsx:74`).
- `AddExistingAccountDialog`: `account.listShareableForSpace` + `account.shareWithSpace` (`AddExistingAccountDialog.tsx:32,37`).

## State & mutations
- List page: no mutations of its own — it composes `CreateAccountDialog` and `AddExistingAccountDialog`. `totals` (`:130`) are **signed** sums (assets/locked/liabilities each accumulated with sign, no `Math.abs`), so `net = assets + locked − liabilities` and an overpaid liability (negative balance) correctly adds to net worth. Distribution: `distSlices` (`:171`) = positive-balance asset+locked accounts only (liabilities and overdrawn accounts excluded — a bar can't draw a negative segment), sorted desc, top 8 + an "Other" rollup; `holdingsTotal` (`:198`) is their sum and the single shared denominator for the bar %, the chip %, and each card's "% of holdings" foot. Because it excludes negatives, "holdings" (gross) can exceed net worth — intentional, and the copy says "holdings" not "net worth" to keep them distinct.
- Detail page mutations and invalidations:
  - `account.delete` -> invalidates `account.listBySpace` then navigates back to the list (`AccountDetailPage.tsx:100-105`).
  - `account.update` -> invalidates both `account.listBySpace` and `account.listByUser` (`:341-342`).
  - `account.addMember` / `account.removeMember` -> invalidate `account.listUsers` (`:395,424`).
  - `account.shareWithSpace` / `account.unshareFromSpace` -> invalidate `account.listSpaces` + both account lists (`:491-493,619-621`).
- Permission gating:
  - List: `PermissionGate roles={["owner","editor"]}` around add CTAs; `PermissionGate roles={["owner"]}` around create (`AccountsPage.tsx:254,262`).
  - Detail: `PermissionGate roles={["owner"]}` around delete and other destructive actions (`AccountDetailPage.tsx:156,263,275`).

## Conventions & gotchas
- The list dispatches to `account.listByUser` in personal mode and rewrites each row so `owners` becomes `[me]`; cross-space metadata is preserved in `_spaces` / `_otherSpacesCount` (`AccountsPage.tsx` `accounts` memo, ~`:93`).
- `hrefForAccount` (`:54`) is the single source of truth for where an account opens (card, bar segment, and chip all route through it): real space → account detail; personal → the account's first real space if it has one, else stays on `/accounts`.
- Distribution bar / summary caveats: segments and chips both **single-tap navigate** (hover-inspect is a desktop-only enhancement; touch users read name/% off the always-visible chips). The "Other" rollup segment/chip is a no-op (guarded by `OTHER_SLICE_ID`). Composition stats go neutral (`--fg-3`) at exactly zero; the Locked stat is hidden entirely when there are no locked accounts, and the net-worth formula subline drops "+ locked" to match.
- The detail page uses shadcn `Card`/`Tabs` and is the only place under `pages/space/accounts/` that does — do not "harmonize" it without checking the design intent.
- Detail page tabs: `transactions`, `history`, `shared`, `members`, `settings` (owner-only) — see `AccountDetailPage.tsx:150-159`.
- "Members" on an account is separate from space members — accounts have their own owner set; `account.listUsers` returns that, while `space.memberList` is what the list-page tile counts.
- Detail page is not personal-aware. Navigating from `/s/me/accounts` (which doesn't link there anyway) would 404 the account lookup.

## Cross-references
- Server: `apps/server/src/procedures/account/*` (one-per-file convention).
- Web: shares the create-account dialog with the app-shell `MyAccountsPage`; transactions tab depends on `pages/space/transactions/TransactionsPage.tsx`; balance history reuses `analytics.balanceHistory` consumed in `analytics/views/BalanceHistoryView.tsx` and `OverviewPage.tsx`.
- Account distribution moved here from analytics: `analytics/views/AccountsView.tsx` and the `analytics/accounts` route/tile were removed (see `web/analytics.md`); the analytics catalog is now nine views. The `analytics.accountDistribution` / `personal.accountDistribution` procs remain in use by `OverviewPage`.
