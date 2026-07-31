---
name: period-selection-two-idioms
description: Orbit has TWO period-selection idioms — ragged PeriodChip ranges vs aligned whole-period steppers — plus FIVE existing stepper instances in three visual variants; picking the wrong idiom for a view breaks its math or its shareability.
metadata:
  type: project
---

Orbit's period selection is deliberately two idioms, not one:

1. **Ragged range → `PeriodChip` + `usePeriod`** (`?period=`/`?from=`/`?to=`).
   Payload is a `DateRangePicker`. Presets include `last-30-days`,
   `last-3-months`, `all-time`, `custom`. Adopted by 6 of 8 analytics views
   (CashFlow, Categories, Envelopes, BalanceHistory, Priority, Anomalies), always
   in the `AnalyticsDetailLayout` `actions` slot. Correct for views whose math is
   a plain aggregate over a window.
2. **Aligned whole period → prev/next stepper.** Correct for views whose math
   needs *comparable, equal-length* periods.

**Why:** views that compute period-relative statistics — "typical" (avg of
same-position buckets across prior periods), projection-to-period-end, "day N of
M", "pace vs last" — are mathematically undefined over a ragged range. Offering
PeriodChip there produces plausible-looking nonsense. Conversely, offering a
stepper on a view that already has PeriodChip creates two competing period
controls in one toolbar.

**The stepper already exists five times, in three visual variants** — so a new
one is not a new dialect, but the family is inconsistent:

| Where | Shape | Period state | Bounds |
|---|---|---|---|
| `BudgetMonthPage` | labelled chevron `<Link>`s in top-bar + "Today" | path param `/budgets/month/:month` | none |
| `YearReportPage` | labelled chevron `<Link>`s in top-bar | path param `/year/:year` | hardcoded 2000–2100 |
| `BudgetsPage` (`.env-month-nav`) | bare arrow / label / arrow, orbit-design CSS | `useState` monthOffset | forward only |
| `BudgetDetailPage` (`.ed-month-nav`) | same, monthly cadence only | `useState` monthOffset | forward only |
| `TrendsView` (`TrendsPeriodBar`) | arrow / label+state / arrow, Tailwind + shadcn `Button` | `?p=YYYY-MM-DD` | forward at live, back at `historyStart` |

`TrendsPeriodBar` is the **reference implementation** — the only one that is
shareable, data-bounded, and states live-vs-complete. The other two in-page
steppers keep their period in React state (unshareable) and can walk backwards
forever. Extraction was deliberately deferred: the Budgets pair lives in the
`orbit-design` CSS system, never appears on screen beside the Tailwind analytics
shell, and unifying them drags in a state→URL migration.

**How to apply:** before adding period selection to a view, ask whether any
number on the page divides by period length or compares same-position buckets. If
yes → aligned stepper, and the URL key must be an **absolute anchor date**
(`?p=2026-07-01`), never a relative preset (`period=last-month` means a different
month next week, so shared links rot) and never a from/to range (which drags in
the exclusive-`to` foot-gun). If no → `PeriodChip`, per the standing reuse
preference. When the stepper family is next touched, port `TrendsPeriodBar`
outward rather than inventing a sixth variant.

Views intentionally outside both idioms: `HeatmapView` (fixed trailing-12-month
calendar — it *is* the time axis).

Related: [[trends_view_period_history_shipped]], [[free_pool_term_fragmentation]].
