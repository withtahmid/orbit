---
name: overview-page-editorial-rewrite
description: OverviewPage.tsx editorial-dark rewrite state as of 2026-07-16 — known product gaps, and the analytics-view deletions that surround it.
metadata:
  type: project
---

Space `OverviewPage.tsx` is now a single ~3.7k-line editorial-dark dashboard (`.orbit-design`), fully personal-space-aware (every card fetches an `analytics.*` / `personal.*` twin gated by `isPersonal`; parity verified good on 2026-07-16). Surrounding this rewrite the analytics **"Allocation map"** view was deleted (procedure `analytics.allocations` + `AllocationsView.tsx` + route), deemed redundant with `/budgets`.

Known product gaps in the rewrite (as of 2026-07-16, may be fixed later — verify before citing):
- Two section-head actions are dead `href="#"` anchors instead of `ROUTES` Links: NetWorthComposition "Open breakdown →" and TopMovers "View all →". No real destination exists for either (no net-worth breakdown page; categoryWoW has no detail view).
- "Spending by envelope" donut (built from `envelopeUtilization`) links its Details → the **Categories** analytics view (category-tree classification), a different dimension than envelopes. Should point at the `envelopes` view. Recurring "analytics categories = classification only" leak.
- "Allocation map" label now lives only on an overview donut showing *parked/remaining* cash (center = Spendables), a different concept from the deleted analytics view's *committed budget intent*.
- Month-progress counter uses `differenceInCalendarDays(endOfMonth, monthStart)` → shows "of 30" in a 31-day month (off by one).
- DailyHeatmap builds its grid frame from native browser-tz `Date` getters but keys day values via `formatInAppTz` — latent month-boundary mis-frame for non-Asia/Dhaka viewers.

**Why:** These are the un-reviewed parts of the `heatmap-fix` branch; recorded so the next session doesn't re-derive them from scratch.
**How to apply:** When reviewing/editing OverviewPage, check these first; affirm the strong personal parity rather than re-auditing it.

Related: [[free_pool_term_fragmentation]], [[analytics_categories_classification_only]], [[semantic_color_tokens_are_load_bearing]].
