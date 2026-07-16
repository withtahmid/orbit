---
name: cash-vs-operational-expense-pairing
description: spaceSummary.periodExpense is ALWAYS cash (incl. transfer principal); operational views must pair with operationalExpense, never periodExpense.
metadata:
  type: project
---

`spaceSummary` / `personal.summary` expose two expense fields with fixed semantics (they do NOT follow any mode flag):
- `periodExpense` = `cashExpense` — includes cross-space outbound transfer principal.
- `operationalExpense` — true `type='expense'` debits only, transfer principal excluded.
- Same split for `periodNet` (cash) vs `operationalNet`.

Mode-driven series procs (`trendsDailyComparison`, `cashFlow`, `spendingHeatmap`) use `xferFactor = mode==='cash' ? 1 : 0`, so with `mode='operational'` their `current`/`previous`/expense arrays EXCLUDE transfers.

**Why:** Comparing a mode-driven (operational) projection/series against the fixed `periodExpense` (cash) mixes frames — the gap is exactly the month's cross-space transfer volume, so any month with transfers gets a wrong delta.

**How to apply:** When a component takes `mode` AND compares against a summary expense/net, pick the field to match the mode: `mode==='cash' ? periodExpense : operationalExpense` (and `periodNet` vs `operationalNet`). Best: derive the last-period baseline from the SAME dailyComparison `previous` array (sum) so chart and stat tiles never drift. Overview default mode is `operational` (`useMetricMode()` default), so `periodExpense` is the WRONG pairing there by default. Seen in OverviewPage `SpendingTrends` (projectedTotal/paceDelta vs `lastMonthExpense=periodExpense`).
