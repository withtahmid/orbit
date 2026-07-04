---
name: spaceSummary envelope window (::timestamptz::date fix on fix/budgets)
description: spaceSummary monthly held/consumed honors input.periodStart/End; allocation match uses ::timestamptz::date, consumed uses raw-instant p_start_ts/p_end_ts (matches envelopeUtilization for ANY window). strip REMAINING == banner envelopeRemaining.
metadata:
  type: project
---

`analytics.spaceSummary` takes `periodStart`/`periodEnd` (both `z.coerce.date()`). An earlier version hardcoded the monthly window to `DATE_TRUNC('month', NOW())`; it now threads `${input.periodStart}` / `${input.periodEnd}` into the `period` CTE (rolling/goal still 1970..9999), so allocating to the viewed month moves held/unallocated for that month.

**The `::timestamptz::date` fix (branch `fix/budgets`, 2026-07):** the monthly `p_start`/`p_end` casts were BARE `${input.periodStart}::date`. pg serializes a JS Date param as UTC text ("2026-06-30 18:00:00+00"); PG's text→date cast truncates the literal's date part with NO tz conversion → an APP_TZ month-start instant (July 1 00:00 +06 = …-06-30T18:00Z) lands on June 30, widening the window a day early (this is the "July window counted June 30's 1,230.00" bug). Fix = `${input.periodStart}::timestamptz::date`, which makes the date cast honor the session zone (Asia/Dhaka, pinned in db/index.mts) → yields the intended wall-clock date. Same fix applied to envelopeUtilization allocated filter, resolveEnvelopePeriodBalance (equality match — bare ::date matched NO row → allocated read 0), yearReport/personal twins.

**Consistency with envelopeUtilization (both fed the SAME periodStart/periodEnd from BudgetsPage/BudgetMonthPage via startOfMonth/endOfMonth):**
- ALLOCATED filter: both compare `a.period_start` (a DATE col, month-aligned) against the window cast `::timestamptz::date`. Identical. Correct.
- CONSUMED filter: NOW IDENTICAL IN FORM (robust fix landed on `fix/budgets`, verified round 2). `spaceSummary`/`personalSummary` added raw-instant twins `p_start_ts`/`p_end_ts` (monthly: `${input.periodStart}::timestamptz`/`${input.periodEnd}::timestamptz`; cadence='none': `TIMESTAMPTZ '1970-01-01 00:00:00+00'`..`'9999-12-31 00:00:00+00'`) used by the transaction subqueries, while the date-typed `p_start`/`p_end` (`::timestamptz::date`) are reserved for the allocation date-column match only. This mirrors `envelopeUtilization`'s raw binds `t.transaction_datetime >= ${periodStart} AND < ${periodEnd}` exactly, so consumed agrees for ANY window (midnight-aligned OR arbitrary-instant), not just month-aligned ones. Held/remaining match → strip REMAINING == spaceSummary.envelopeRemaining.
- The old LATENT tail-drop concern (date-promoted consumed dropping the last day on a non-midnight end) is RESOLVED by the raw-instant twins. spaceSummary's incomeExpenseRow (also raw timestamptz) is now internally consistent with the consumed subquery too.
- cadence='none' sentinels: envelopeUtilization consumed has NO date filter (true lifetime); spaceSummary bounds it to [1970-01-01T00:00Z, 9999-12-31T00:00Z). Equivalent for all real transactions — divergence only for absurd pre-1970 / post-9999 dates. Old bare `DATE '1970-01-01'` promoted to 1969-12-31T18:00Z under Dhaka; new TIMESTAMPTZ literal is 1970-01-01T00:00Z (6h later start, 6h later end) — both harmless.

**resolveSpaceUnallocated** stays pinned to `DATE_TRUNC('month', NOW())`. It has NO live callers (transfer guard path). The "same held" invariant in CLAUDE.md now has no runtime consumer; agreement holds only when viewed window IS current month. If a caller re-couples it, re-check.

`personal/summary` envelope window: got the SAME raw-instant-twin fix. Its held clamp uses `GREATEST(0, p_allocated - p_consumed_all)` (space-wide spend, any account) — matching spaceSummary — while `consumed` displayed uses `p_consumed_owned` (owned accounts only). Both consumed subqueries use `p_start_ts`/`p_end_ts`.

Related: [[migration-049-period-start-tz-fix]], [[apptz-month-helpers]], [[simplified-budgeting-model]].
