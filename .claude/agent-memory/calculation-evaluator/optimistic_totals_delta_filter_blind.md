---
name: optimistic-totals-delta-filter-blind
description: RESOLVED — optimistic filteredTotals deltas are now create-only and space-scoped; edits never patch totals. Records the settled contract so it isn't "re-optimised" back into a bug.
metadata:
  type: project
---

`apps/web/src/features/transactions/useOptimisticTransactionCache.ts`. The
filter-blind / personal-space-blind delta problems are RESOLVED, by
DELETION rather than by replicating server predicates client-side. The
settled contract (verified against `transaction/filteredTotals.mts` and
TanStack Query 5.81 `matchQuery`):

- **Creates patch totals; edits never do.** `computeUpdateDelta` is gone.
  A create only ADDS to the set, so `computeDelta` is at worst early by
  one refetch. An edit can move a row across a nine-dimension filter
  boundary, so `next - previous` would be *wrong*, not early. Edits move
  the tiles on the trailing `invalidate()` only.
- **`applyDelta(delta, spaceId)` is space-scoped** via a `predicate` on
  `queryKey[1].input.spaceId`. `matchQuery` ANDs `queryKey` (partial) with
  `predicate`, so same-space variants with *different* filters are still
  all patched — matching `utils.transaction.filteredTotals.invalidate({ spaceId })`,
  which is likewise a partial-input match. A path-only broadcast (the old
  behaviour) inflated OTHER spaces' cached tiles with no refetch coming.
- **Never patch `personal.transactionFilteredTotals`.** Its IN/OUT split
  counts transfers and adjustments scoped by account ownership (see
  [[filtered_totals_out]]), so a `computeDelta` result is wrong there for
  those types. `utils.personal.invalidate()` (whole namespace, in
  `lib/invalidate.ts`) resyncs it.
- **Zero-delta writes are value-preserving**, so the all-zero early-return
  guard is optional: server `net === inTotal - outTotal` and
  `avgPerDay === outTotal / days` with `days >= 1`, and `applyDelta`
  recomputes both from the same identities. Moot anyway — every call site
  passes `count: ±1`.
- Only `TransactionsPage.tsx` consumes `transaction.filteredTotals`, keyed
  `{ spaceId: space.id, ... }` and disabled in the personal space; the
  three create sites pass `variables.spaceId` from `useCurrentSpaceId()`,
  so key and delta always agree. The adjustment create path deliberately
  has no optimistic layer at all.

**How to apply:** if someone proposes re-adding an edit-path totals delta,
or "optimising" `applyDelta` back to a path-only broadcast, both are
regressions with worked counterexamples in the file's own comments.
