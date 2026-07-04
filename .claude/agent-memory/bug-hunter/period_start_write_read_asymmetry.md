---
name: period-start-write-read-asymmetry
description: period_start WRITE stores explicit 'YYYY-MM-01' APP_TZ string; READ paths now cast ${param}::timestamptz::date — correct ONLY if session tz = APP_TZ (dependency unchanged, now more load-bearing).
metadata:
  type: project
---

WRITE side (migration 049): `envelop_allocations.period_start` stores an explicit `'YYYY-MM-01'` APP_TZ date string (`appTzMonthStartString` in `periodWindow.mts`), used by `createAllocation.mts` and `allocation/transfer.mts`. Drift-proof (verbatim regardless of session tz).

READ side — as of branch `fix/budgets` (2026-07-04), all JS-Date-param date comparisons were changed from bare `${param}::date` to `${param}::timestamptz::date` in 7 files: `analytics/spaceSummary.mts`, `personal/summary.mts`, `analytics/envelopeUtilization.mts`, `personal/envelopeUtilization.mts`, `analytics/yearReport.mts`, `personal/yearReport.mts`, `envelop/utils/resolveEnvelopePeriodBalance.mts`.

**Why bare `::date` was wrong:** pg serializes a JS Date param as a TEXT literal (`"2026-06-30 18:00:00+00"`). `text→date` truncates the literal's date substring with NO tz conversion → always `2026-06-30`, mismatching the stored `2026-07-01`. So monthly `allocated` silently read 0 (matched no row). This broke the deallocate guard in `createAllocation.mts` and the transfer available-budget guard in `allocation/transfer.mts` (both read `bal.allocated`, which was always 0 → you could never deallocate/transfer out of a monthly envelope). Those two mutation guards are FIXED by this change.

**The dependency did NOT go away — it moved and got MORE load-bearing:** `${param}::timestamptz::date` parses the text to an absolute instant (`2026-06-30T18:00Z`), then casts to date IN THE SESSION TZ. Under APP_TZ (Asia/Dhaka +06) → `2026-07-01` (correct). Under GMT → `2026-06-30` (wrong again). So the whole thing STILL hinges on the `db/index.mts` `options: -c timezone=Asia/Dhaka` startup param surviving the Neon pooler (see [[neon-pooler-drops-session-set]]). Bare `::date` was tz-INDEPENDENT-but-wrong; the new cast is tz-DEPENDENT-and-right-only-if-APP_TZ. The belt-and-suspenders alternative (send a date STRING, not a Date instant) was still not taken on the read side.

**yearReport is a no-op:** `yearStart = new Date(Date.UTC(year,0,1))` is UTC midnight, so `::timestamptz::date` (+06 → 06:00 same day) yields the same `Jan 1` as bare `::date`. The change there is harmless/cosmetic, not a fix.

**resolveSpaceUnallocated.mts** uses `DATE_TRUNC('month', NOW())::date` (SQL-side, server clock) — a different mechanism, ALSO session-tz-dependent, and NOT touched by this diff. It is only consumed by transfer/allocation guards, not the Budgets banner.
