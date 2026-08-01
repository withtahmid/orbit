---
name: movers-shape-partition
description: trendsCategoryMovers tree-vs-flat shapes provably partition the same transaction set; DISTINCT ON picks the NEAREST selected ancestor, not the shallowest
metadata:
  type: project
---

`trendsCategoryMovers` (+ personal twin) takes `shape: "tree" | "flat"`. Both shapes
are a **total function** over the same filtered transaction set, so their sums are
identical — verified numerically on space `019da6f8-cea6-750d-946e-ab3fc72c3d9b`
(Jun/Jul 2026) for 0, 1, and 2+ selected categories including parent+child and
parent+grandchild overlaps, and per-envelope.

Why it holds:
- `roots` is `DISTINCT ON (id)` so the `LEFT JOIN roots` can never fan a
  transaction out into two buckets.
- `COALESCE(r.root_id, t.expense_category_id)` guarantees a bucket even for
  orphans/cycles (neither is reachable from a `parent_id IS NULL` seed).
- `selected_categories` ⊆ `roots_all` coverage (both recurse down from the same
  seeds; `roots_all` is *less* restricted — it is not space-scoped), so a
  transaction that survives `categoryFilterWhere` always finds a root row.

**`ORDER BY id, array_length(path,1)` picks the NEAREST (deepest) selected
ancestor, not the shallowest** — `path` starts at the seed, so a shorter path
means a closer seed. The in-code comment says "Shallowest bucket wins", which is
backwards as prose; the anti-double-count property is unaffected. Selecting
`Groceries` + `Groceries > Drinks` yields two rows that sum to the full Groceries
subtree.

Flat mode leaves `roots_all`/`roots` unreferenced inside `WITH RECURSIVE`.
Confirmed on Neon PG18: legal, not executed, same totals.

**How to apply:** don't re-audit the partition property on future edits to this
proc unless the `DISTINCT ON`, the `COALESCE`, or the seed/filter asymmetry
changes. Do re-check any consumer that derives a boolean or denominator from the
*truncated* top-N slice — that is where tree/flat legitimately diverge.
