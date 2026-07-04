---
name: budget-tz-and-ledger-traps
description: Two recurring bug classes in the simplified budgeting model — browser-local period math, and stale delta-ledger assumptions over the new absolute-amount rows.
metadata:
  type: project
---

Two recurring bug classes seen across the budgeting code (server + web). See also [[apptz_format_trap]].

**1. Browser-local period boundaries instead of APP_TZ.** Multiple call sites compute the
month window with `new Date(y, m, 1)`, `new Date(Date.UTC(y, m, 1))`, or native
`getFullYear()/getMonth()/getDate()` on an APP_TZ-derived Date. APP_TZ is Asia/Dhaka (UTC+6),
so near a month boundary the UTC/browser month differs from the Dhaka month the server uses
(`date_trunc('month', NOW())` in the Dhaka session). Symptom: allocation writes land in the
wrong month while the on-screen figures describe a different month; status cards query the
wrong window.
**Why:** server period math + PG session are Dhaka; any client-side month construction must
use `@/lib/dates` (`startOfMonth`, `endOfMonth`, `addMonths`, `makeAppTzDate`,
`getAppTzYear/Month/Date`).
**How to apply:** whenever you see a `Date` built or read with native getters for a *period
boundary* (not just display), flag it. Display also needs `formatInAppTz`, not `toLocaleString`.

**2. Stale delta-ledger semantics over the new absolute-amount rows.** Post-048,
`envelop_allocations` holds ONE row per (envelope, period) whose `amount` is the ABSOLUTE
accumulated total; allocate/deallocate is an accumulating UPSERT that does NOT change
`created_at`. Any query that sums `amount` filtered by a `created_at` window (e.g.
`unbudgetedTrend.allocationsNet`) is now wrong — it treats absolute totals as if they were
per-change deltas. The old append-only ledger made this correct; the collapse broke it.
**Why:** the metric assumed each row was a delta event; rows are now mutable running totals.
**How to apply:** be suspicious of any `SUM(envelop_allocations.amount) ... WHERE created_at`
or per-window allocation-change math; there is no per-change delta in the collapsed model.

**3. spaceSummary held window (RESOLVED on branch budget-bug-fix-2, 2026-07).** For a long
time `spaceSummary` (and `resolveSpaceUnallocated`) hardcoded the monthly-envelope held/consumed
window to `DATE_TRUNC('month', NOW())`, ignoring the procedure's `input.periodStart/End`. Symptom:
allocating to a non-current month never moved Unbudgeted; BudgetMonthPage mixed current-month
`unallocated` with a viewed-month `heldDelta`. Fix honors `input.periodStart/End` for
`cadence='monthly'` (rolling/goal still lifetime 1970..9999). `resolveSpaceUnallocated` was left
pinned to current month but currently has NO live callers — the "same held number" invariant in
analytics/CLAUDE.md has no runtime consumer, so the divergence is harmless.
**How to apply:** if a future caller starts calling `resolveSpaceUnallocated` for a non-current
window, or re-couples it to spaceSummary, the pinned-NOW helper will disagree — re-check then.

**4. `${jsDate}::date` (bare) truncates in the WRONG tz — always go via `::timestamptz`.** A JS
`Date` bound param is serialized by node-postgres to a TEXT literal carrying the process-local
wall-clock + offset (Docker = UTC, so an APP_TZ month-start `2026-07-01 00:00+06` becomes
`2026-06-30 18:00:00+00`). PG's text→date cast (`$1::date`) takes only the DATE portion of that
text with NO tz conversion → lands on 2026-06-30, silently widening a window by a day OR (for the
allocation `period_start = X` equality) matching zero rows so `allocated` reads 0. The fix
(branch fix/budgets, 2026-07) is `${d}::timestamptz::date`: text→timestamptz honors the offset →
correct instant, then timestamptz→date converts in the session zone (Asia/Dhaka, pinned in
db/index.mts) → intended wall-clock date. NOTE: this corrects note #3's earlier claim that a bare
`::date` was "tz-safe in the Dhaka session" — that is true for `column::date` / `date_trunc(...)::date`
(the value is already timestamptz) but FALSE for a bound-param `::date` (the param is untyped text).
For timestamptz `transaction_datetime` comparisons the branch instead adds raw `_ts` instant twins
(`${d}::timestamptz`, sentinels `TIMESTAMPTZ '1970-01-01 00:00:00+00'`/`'9999-12-31 00:00:00+00'`)
so the window isn't rounded to APP_TZ midnights.
**How to apply:** any `${someJsDate}::date` in a `sql` template is a bug — require `::timestamptz::date`.
The only safe bare `::date` casts are on columns or `date_trunc()`/`NOW()` results. `cadence` CHECK is
only `('none','monthly')`, so a two-arm CASE (no ELSE) covers every row — no NULL-bound risk.
