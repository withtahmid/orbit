---
name: overview-computed-kpis
description: OverviewPage.tsx KPI math traps found round 3 — AccountsGlance percent blow-up, SpendingTrends missing loading/error guard (30x projection)
metadata:
  type: project
---

OverviewPage.tsx (`apps/web/src/pages/space/OverviewPage.tsx`) round-3 findings:

- **AccountsGlance 7-day delta% blow-up.** `delta = (last-first)/Math.max(1, Math.abs(series[0]))*100`. The `Math.max(1,…)` only prevents divide-by-zero; it does NOT bound the magnitude when the 7-days-ago balance is 0 or sub-1. A recently-funded account (balance 0 seven days ago) shows `+500000.0%`. The code comment claims it handles "blow up the percentage" but only fixed sign, not magnitude.
- **SpendingTrends has no loading/error guard.** It always renders. With `TODAY = trendsData?.today ?? 1` and `DAYS_IN_MONTH ?? 30`, `projectedTotal = max(monthSoFar, (monthSoFar/TODAY)*DAYS_IN_MONTH)` = `monthExpense*30` whenever `summary` (which supplies `monthExpense`) resolves before/without `trends.dailyComparison`. Transient flash on load; permanent if the trends query errors.
- **Liability sign asymmetry.** Both `accountDistribution` and `balanceHistory` return RAW `account_balances.balance` (negative for liabilities). AccountsGlance headline negates it (`liability ? -a.balance`) but the delta% is computed on the raw series — so for a liability the displayed number and the % move in opposite directions.

Verified CLEAN this round (do not re-flag): `monthProgress` total/elapsed (endOfMonth is exclusive next-month-start, diff = real day count, tz-offset cancels in differenceInCalendarDays); no cash/operational mixing in Position tiles or MoM deltas; heatmap grid geometry app-tz-safe; empty-state guards on BalanceTrend/CashFlow/AreaChart.
