---
name: personal-space-url-guards
description: Which space-local management pages guard the virtual /s/me space by redirecting to overview, and which don't (an inconsistency)
metadata:
  type: project
---

Space-local management concepts (Budgets, Categories, Events, Settings) are hidden from the `/s/me` nav (SpaceLayout uses `PERSONAL_NAV` vs `FULL_NAV`), but their URLs are still typeable. Only some pages defensively redirect when `space.isPersonal`:

- Guarded (redirect to `ROUTES.space(space.id)` overview): `SpaceSettingsPage.tsx`, `categories/CategoriesPage.tsx`.
- NOT guarded (no `space.isPersonal` redirect): `events/EventsPage.tsx`, `budgets/BudgetsPage.tsx`. Typing `/s/me/events` or `/s/me/budgets` renders the page against the virtual space rather than redirecting.

Contrast: Accounts and all analytics views legitimately support personal space via personal-twin queries (`accountsUserQuery`, `enabled: isPersonal`), so they do NOT redirect — that is correct, not a gap.

**Why:** Categories/Events/Budgets are single-space-scoped resources (e.g. `expense_categories.space_id`); the virtual space is a cross-space aggregation with no single space to own them, so a redirect is the coherent behavior.

**How to apply:** When auditing personal-space parity, treat the redirect as the correct pattern for single-space management pages. Events and Budgets lacking it is a pre-existing minor inconsistency worth closing (add the same `if (space.isPersonal) return <Navigate .../>` guard). Do not flag the redirect on Categories/Settings as a defect — flag the two that are missing it.
