# Routing

> React Router v7 browser router with two guards, four layouts, a typed `ROUTES` constant, and a sentinel `"me"` space id that routes through the same `/s/:spaceId` tree as real spaces.

## Components

- `apps/web/src/router/index.tsx` — the entire route tree, exported as `router` from `createBrowserRouter`. Wired into `App.tsx:27` via `<RouterProvider router={router} />`.
- `apps/web/src/router/routes.ts` — the `ROUTES` constant: static strings (`login`, `signup`, `forgotPassword`, `spaces`, `profile`, …) and parameterised builders (`space(id)`, `spaceTransactions(id)`, `spaceBudgetDetail(id, envId)`, etc.). Components must import from here instead of hardcoding paths.
- Guards (`apps/web/src/router/guards/`):
  - `GuestOnlyRoute.tsx` — for `/login`, `/signup`, `/forgot-password`. Redirects authenticated users away (honoring `?from=` if present, else `/`).
  - `ProtectedRoute.tsx` — for everything inside `/spaces`, `/s/:spaceId/*`, `/settings/*`, `/accounts`, `/me`. Redirects guests to `/login?from=<encoded current url>`.
  - **No `PublicRoute` guard exists** — public routes (`/`, `/docs`, `/invite/:token`, `*`) are simply un-wrapped.
- Layouts (`apps/web/src/layouts/`):
  - `RootLayout.tsx` — single `<Outlet/>` plus app-wide chrome: `TooltipProvider`, `ScrollRestoration`, `DemoBanner`, `Toaster`. Wraps every route.
  - `AuthLayout.tsx` — passthrough `<Outlet/>`; auth pages render their own full-viewport chrome (`AuthShell`).
  - `AppShellLayout.tsx` — top-bar + user dropdown for global settings/profile pages (no sidebar).
  - `SpaceLayout.tsx` — sidebar with nav, space switcher, user chip; powers everything under `/s/:spaceId`. Strips mutation tabs when `space.isPersonal` (`SpaceLayout.tsx:75-77`).
- Personal space sentinel:
  - `apps/web/src/lib/personalSpace.ts` — `PERSONAL_SPACE_ID = "me"`, `PERSONAL_SPACE_NAME = "My money"`, `isPersonalSpaceId(id)`. "me" is not a valid UUID so it can never collide with a real space id.
  - `apps/web/src/providers/CurrentSpaceProvider.tsx` — wraps every `/s/:spaceId/*` page; detects the sentinel and synthesises a virtual `CurrentSpace` with `isPersonal: true`, `myRole: "viewer"`, without a `space.list` round-trip (`CurrentSpaceProvider.tsx:37-58`).
- `apps/web/src/pages/RootRedirect.tsx` — handles `/`: guests see `<LandingPage/>`; authenticated users get sent to the last-visited space (`localStorage[LAST_SPACE_KEY]`), the first real space, or `/spaces` if they have none.

## Flow

### Route tree top-down (`router/index.tsx`)

```
RootLayout (errorElement: ErrorBoundaryPage)
├── /                  RootRedirect
├── /docs              DocsPage (no guard, no layout)
├── /invite/:token     AcceptInvitePage (public — renders space metadata pre-login, bounces guests to /login?from=… before the auth-only accept mutation)
├── GuestOnlyRoute → AuthLayout
│   ├── /login         LoginPage
│   ├── /signup        SignupPage   (lazy)
│   └── /forgot-password ForgotPasswordPage (lazy)
└── ProtectedRoute
    ├── /spaces        SpaceSelectorPage (NO AppShellLayout — renders its own chrome, see comment at index.tsx:102-105)
    ├── AppShellLayout
    │   ├── /settings           → redirect to /settings/profile
    │   ├── /settings/profile   ProfilePage
    │   ├── /settings/security  SecurityPage
    │   ├── /accounts           MyAccountsPage
    │   └── /me                 → redirect to /s/me (legacy URL preserved)
    └── /s/:spaceId    CurrentSpaceProvider
        └── SpaceLayout
            ├── (index)         SpaceOverviewPage
            ├── accounts, accounts/:accountId
            ├── transactions
            ├── budgets, budgets/:envelopeId, budgets/month/:month
            ├── year/:year
            ├── categories
            ├── events, events/:eventId
            ├── analytics + analytics/{cash-flow,categories,envelopes,balance,heatmap,trends,anomalies,priority}
            └── settings
* → NotFoundPage
```

### Guard behavior

- `ProtectedRoute` (`ProtectedRoute.tsx:7-22`) waits on `authStore.isLoading` (rehydration). When false and `!isAuthenticated`, redirects to `${redirectTo}?from=<encoded pathname+search>`.
- `GuestOnlyRoute` (`GuestOnlyRoute.tsx:6-20`) also waits on `isLoading`. When authenticated, redirects to `searchParams.get("from") ?? redirectTo` (default `/`). This is what turns the `?from=` round-trip into a usable post-login deep link.
- Both render `<FullPageSpinner/>` during rehydration.

### CurrentSpaceProvider (`/s/:spaceId`)

- Reads `:spaceId`. If `isPersonalSpaceId(spaceId)` → synthesise `{ id:"me", name:"My money", myRole:"viewer", isPersonal:true }` and skip the network. Otherwise fetch `trpc.space.list`, find the matching space, hydrate `myRole`.
- Persists `space.id` to `localStorage["orbit:last_space_id"]` (`LAST_SPACE_KEY`, exported from the provider). `RootRedirect` reads this on next visit.
- When a real space isn't found in the user's list, redirect to `/spaces`.

### Lazy loading

All space-scoped pages plus `SignupPage`, `ForgotPasswordPage`, `DocsPage`, `AcceptInvitePage` are `lazy()`-imported with a shared `withSuspense` wrapper that renders `<FullPageSpinner/>` (`router/index.tsx:64-66`). `LoginPage` is eager so the cold-start login is instant.

## Conventions & gotchas

- **Never hardcode paths.** Use `ROUTES.spaceTransactions(spaceId)`, not `` `/s/${spaceId}/transactions` ``.
- **`/me` is a redirect, not a page.** The virtual space lives at `/s/me`; the old `/me` URL is preserved by `<Navigate to="/s/me" replace />` (`index.tsx:131-134`).
- **`/spaces` sits outside `AppShellLayout`** intentionally (`index.tsx:102-107`): it renders its own full-viewport chrome (logo header + grid). Wrapping it in the shell would double-render the header.
- **`isPersonal` flips read-only:** `CurrentSpaceProvider` forces `myRole:"viewer"` so every existing `PermissionGate` in space-scoped pages hides mutation CTAs. The `SpaceLayout` nav is also trimmed to `Overview / Accounts / Transactions / Analytics`.
- **`?from=` is the only way to deep-link after login.** `ProtectedRoute` writes it; `GuestOnlyRoute` reads it. Login pages don't manipulate it explicitly.
- **`LAST_SPACE_KEY` lives in `CurrentSpaceProvider.tsx:33`**, not in `personalSpace.ts`. Importers reach into the provider module to share the key.

## Cross-references

- `./auth-flow.md` — what populates `authStore.isAuthenticated` that the guards consult.
- `./stores.md` — `AuthStore.isLoading` rehydration semantics that the guards depend on.
- `./trpc-setup.md` — `CurrentSpaceProvider` uses `trpc.space.list.useQuery`.
