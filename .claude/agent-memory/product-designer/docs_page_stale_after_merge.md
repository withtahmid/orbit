---
name: docs-page-stale-after-merge
description: DocsPage copy is the load-bearing stale surface after simplify-budgeting (2026-06-23). Analytics inventory, Allocations screen desc, and "legacy drift" note all pre-merge.
metadata:
  type: project
---

**2026-07-16 (heatmap-fix branch):** This branch DELETED the `allocations` analytics view (AnalyticsPage entry, router route, `AllocationsView.tsx`, and server `analytics.allocations`). No dangling refs remain in `apps/web/src` code, but `DocsPage.tsx` `Analytics()` (`:823-865`) is now stale in a new way: header says "Nine dedicated analytics views", the bulleted list still includes "Allocations — where each envelope's budget is committed" (`:844-846`) for the deleted view, and the ScreenshotPlaceholder says "10 sub-view cards" (`:864`). Ground truth is now EIGHT views (cash-flow, trends, categories, envelopes, balance, heatmap, anomalies, priority). Fix: recount to 8, drop the Allocations bullet, correct the placeholder. (The separate `Allocations()` budgeting-concept section `:759+` is still valid — that documents envelope allocation, not the analytics view.)

**2026-06-23 (simplify-budgeting branch, post-fix-batch):** The four targeted fixes converged cleanly — AllocationsView "Drift" KPI (no "legacy", sub "Assets − envelopes"), UnbudgetedBanner breakdown (Income 90d + Silent overspend absorbed, both real `unbudgetedTrend` fields), BudgetDetailPage stale-id not-found state, NewTransactionSheet overspend copy ("Save as-is..."). No live `borrow/reckon/strict/matrix/2D` refs remain in apps/web/src. Remaining staleness is confined to `apps/web/src/pages/DocsPage.tsx`:
- Analytics section (`:886-905`) says "Ten ... views" + lists Year-report/Matrix grid — Matrix deleted; recount + prune.
- Allocations section (`:841-848`) describes "Budget this month" as a 3-column last-actual/last-budget/this-budget grid — verify against current `BudgetMonthPage`.
- Drift/Overspend section (`:874-876`) keeps a "legacy per-account drift is retired" note — accurate but reads as residue; consider deleting or moving to FAQ.
- Terminology: "Drift" is overloaded — AllocationsView (assets − allocations), BudgetsPage card flag (consumed > allocated), DocsPage (retired per-account). Future terminology pass, not fix-now.

---

**Historical (plan->envelope-target rename, 2026-05-20):** Tracks remaining stale surfaces after the plan->envelope-target merge (see [[plan-envelope-merge-decision]], [[budgets-page-merge-goals-envelopes]]).

**Resolved as of 2026-05-20:**
- DocsPage (Concepts tile, Envelopes section, Goal envelopes callout, symmetric-progress rule)
- README.md (envelope-budgeting bullet, seed count blurb)
- CLAUDE.md (router list)
- AnalyticsPage, AllocationsView, AccountsView, LandingPage, AuthShell, SpaceSelectorPage, SpaceSettingsPage, BudgetMonthPage, CommandPalette
- contexts/modules/server/allocation.md (deleted)

**Still stale (ship blockers, in priority order):**
1. `contexts/project-specification.md` — §3.4 still defines `plans`/`plan_allocations` schema (`:188-196`); §5.2 still describes "Plan balance" (`:404-408`); §10 is still titled "Plans" with rules contradicting the merged model (`:858-859` says plans can't be spent from directly). README + CLAUDE.md both point developers at this spec as "source of truth." Other refs: `:35, 39, 332, 338-339, 359, 418, 433, 446, 491, 526, 554, 560, 570, 678, 715, 758, 1061, 1082`.
2. `contexts/modules/INDEX.md` — `:21, 23, 26, 43` still list `plan`/`allocation`/`plans` modules.
3. `contexts/modules/server/plan.md` and `contexts/modules/web/plans.md` — full module docs for code that no longer exists; delete.
4. `contexts/modules/server/analytics.md:3,17,57-59` — documents the deleted `planProgress` procedure.
5. `contexts/modules/web/overview.md:3,22`, `contexts/modules/web/analytics.md:22`, `contexts/modules/server/personal.md:40,50`, `contexts/modules/server/envelop.md:55`, `contexts/modules/shared/db-layer.md:3,31,33`, `contexts/modules/shared/routing.md:49,52` — scattered plan refs.
6. `contexts/engineering-specification.md:185, 279, 317, 338` — "17 envelopes, 6 plans", "Envelopes / Plans / Categories", "Cross-space envelope/plan math".

**Polish:**
- `apps/server/src/procedures/analytics/CLAUDE.md:35` — "The plan is to retire them" reads as generic-verb but is in a doc surface; reword to "the goal is".
- Migration 046 destructiveness (down throws) is undocumented in README/CLAUDE.md. The migration's own JSDoc is honest, but a one-liner near `pnpm migrate` would help a developer running against a non-empty plans table.
- Goal-progress bar has no UI tooltip explaining the symmetric rule; only the DocsPage callout documents it.

**Why:** The product code is clean; the architecture/spec documentation tree is the load-bearing stale surface that shapes contributor mental models. Without it, the rename is half-done.

**How to apply:** Treat this as the remaining punch-down for `rename-plan-goal`. Specs first (project + engineering), then `contexts/modules/`, then README/CLAUDE.md polish. Once cleared, this memory can be deleted.
