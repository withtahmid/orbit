---
name: trends-movers-shape
description: trendsCategoryMovers lost drill-in mode and gained a `shape: "tree"|"flat"` input; the SQL is verified correct (totals reconcile, no double count, unreferenced recursive CTE is planned-but-never-executed) — the residual risk is all client-side.
metadata:
  type: project
---

`apps/server/src/procedures/analytics/trendsCategoryMovers.mts` (+ its
`personal/` twin) no longer infers a "drill-in" mode from `categoryIds.length === 1`.
One input `shape: "tree" | "flat"` (default `"tree"`) switches two `sql``
fragments — `rootsJoin` and `categoryExpr` — inside one query.

**Verified against the live Neon DB (2026-08-01) — do not re-derive:**
- Tree and flat totals reconcile exactly with a raw baseline over the same
  window (65941.08 / 52558.01 on space `pp's Family`, Jul-2026 vs Jun-2026;
  16 tree rows vs 74 flat rows, identical sums).
- Selecting a parent **and** a descendant together does not double count: the
  `roots` CTE's `DISTINCT ON (id) ... ORDER BY id, array_length(path,1)` makes
  seeds (path length 1) always win, so the descendant buckets to itself and the
  parent carries the rest. Groceries 8560 + Coca Cola 1550 = 10110 = the
  subtree baseline.
- **An unreferenced (even recursive) CTE is valid and never executed** on this
  Postgres. Proven with `WITH RECURSIVE boom AS (SELECT 1/0 ... UNION ALL ...)
  SELECT 'ok'` — returns `ok`, no division error. `EXPLAIN` still *prints* the
  `CTE roots_all` node but emits no `CTE Scan`, and the purely non-recursive
  `roots` CTE is pruned outright. So flat mode's dead `roots_all`/`roots` costs
  nothing.

**Where the risk actually is (client):**
`MoversList`'s `hasPrevious` is still derived per-page, not returned by the
procedure — so the new Tree/Flat control can flip the whole card's rendering
mode on `BudgetDetailPage`, whose `moversHasPrevious` is
`moversData.some(m => m.previousTotal > 0)` over the **limit-sliced** rows.
See [[movers-list-shared]] for the full split.

**How to apply:** treat the SQL as settled; audit new callers for (a) whether
they thread `shape` into the query key, and (b) whether any derived flag reads
off `items` *after* `slice(0, limit)`.
