---
name: overview-rebuild-round3
description: heatmap-fix branch Overview/Analytics rebuild — round-3 product findings (created_at unsorted lists, personal /budgets dead-links, trend-chart narrowing inconsistency)
metadata:
  type: project
---

Findings from the `heatmap-fix` branch round-3 review (2026-07-16). The branch removed the Allocations analytics view, rebuilt EnvelopesView, added a CategoriesView "Spending trend" card, and rebuilt OverviewPage (`orbit-design` editorial layout).

**Overview lists are created_at-ordered, not ranked.** `analytics.envelopeUtilization` returns rows in created_at order (confirmed by the in-file comment on `topEnvelopesDonut`, which sorts by spend to compensate). The OverviewPage "Envelope utilization" list (`.slice(0,5)`, no sort) and "Goals" list (`goals.slice(0,5)`, no sort) show the *oldest 5*, presented as headline rankings. The "Spending by envelope" donut right above correctly sorts by spend — same page, inconsistent ordering.
**Why:** a headline "top envelopes/goals" surface that's actually arbitrary misleads at a glance — violates Orbit's "analytics shouldn't silently mislead" value.
**How to apply:** when reviewing any Overview list fed by `envelopeUtilization`, check it sorts by a meaningful key (spend / pctSpent / pctSaved) before slicing.

**Personal `/s/me` Overview has dead-end /budgets links.** On personal, "Where money sits" (Details →) and "Goals" (View all →) link to `ROUTES.spaceBudgets("me")` = `/s/me/budgets`, which renders BudgetsPage querying `envelop.listBySpace({spaceId:"me"})`. The virtual space (PERSONAL_SPACE_ID === "me") owns no envelopes → empty/broken page. Note the team *did* gate the Unallocated stat tile, over-allocation banner, and Budget-Month button behind `!isPersonal`, but the "Where money sits" donut (shows an Unallocated slice) and Goals View-all slipped through on personal.
**Why:** recurring personal-space parity gap — allocation/budget affordances don't exist on the virtual space (see [[personal-space-unallocated-misframe]], [[analytics-categories-classification-only]]).
**How to apply:** any new `ROUTES.spaceBudgets(space.id)` / envelope-editing link needs an `isPersonal` guard or a personal-aware destination.

**Three new trend charts share MultiSeriesLineChart but not interaction model.** CategoriesView "Spending trend" got a `CategoryMultiSelect` (narrow to a subset) + own time-range picker, and is naturally bounded (mirrors the top-N donut). The two EnvelopesView charts ("This month combined", "Year-to-date") plot ALL active monthly envelopes with NO narrowing control and NO cap — and each draws 2 lines per envelope (spend + pace/allocated). With many envelopes they hit the exact ">6 series = noise" limit the component's own docstring warns about, escapable only by click-to-isolate-ONE.
**How to apply:** EnvelopesView trend charts should get the same multi-select narrowing (or a default top-N cap) the Categories trend has, for a consistent interaction model.
