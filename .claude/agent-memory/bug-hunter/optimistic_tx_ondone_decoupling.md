---
name: optimistic-tx-ondone-decoupling
description: NewTransactionSheet optimistic UI fires onDone()/idem.rotate() synchronously after mutate.mutate(), so ANY server rejection discards the user's form input
metadata:
  type: project
---

The optimistic-transaction-creation change (branch `transaction-optimistic-update`) moved `onDone()` + `idem.rotate()` out of each mutation's `onSuccess` and into the submit handler, firing them synchronously right after `mutate.mutate(...)`.

**Consequence class to watch:** Because `onDone()` now fires unconditionally (before the request resolves), any server-side rejection (Zod `.positive()` on amount, permission, 500, network) no longer keeps the form open with the user's data. On "Save & add another" the formKey bump wipes the entry; on plain Save the sheet closes. The only feedback is a delayed `toast.error` from `onError`. None of the 4 forms validate `amount > 0` client-side (they only guard account/category/envelope/fee), so an empty amount (`Number("")===0`) always round-trips and always fails `.positive()` — losing the entry.

**Why:** The decoupling was intentional (non-blocking rapid entry against cold-start free-tier DB). The lost-input-on-failure is the accepted-but-under-appreciated tradeoff. If revisiting: add a client `amount > 0` guard before `mutate.mutate()` in all 4 forms, or gate `onDone()`/formKey-wipe on the optimistic row NOT being immediately rejectable.

**How to apply:** When reviewing further changes here, treat "does a failed save preserve user input?" as a first-class question. The old invariant (failure keeps form intact) no longer holds.

Related: `computeDelta`/`applyDelta` in `useOptimisticTransactionCache.ts` will propagate a `NaN` amount into `filteredTotals` cache (inTotal/net/avgPerDay) that `reverseDelta` cannot undo (NaN-NaN=NaN) — persists until the next successful invalidate. Empty-amount(0) case is benign; only non-numeric NaN poisons totals. **Correction:** `OrbitAmountCard` renders `<input type="number">`, and browsers coerce that input's `.value` to either a valid numeric string or `""` — non-numeric text can't reach `amount` state, so this NaN path was never reachable in practice.

**Resolved (same session, live edit by the human author):** all four forms now guard `!(Number(amount) > 0)` (or the equivalent `delta === 0` check for Adjustment) before calling `mutate.mutate()`, and every `onError` now shows `toast.error(..., { duration: Infinity })` with the amount in the message — so a rejected/empty-amount submit no longer silently loses input, and the failure signal persists until dismissed. The core lesson (treat "does onDone fire before the request resolves" as a first-class review question) still holds for future changes to this pattern.

**Extended to the UPDATE path (later change, `EditTransactionSheet.tsx`).** `EditForm.submit` now also calls `onDone()` synchronously after `mutate.mutate(...)`, so the same lost-input class applies to edits — and edits are worse, because the user has to re-derive the values instead of retyping a fresh entry. Concrete routinely-reachable rejection: for a **transfer**, `destItems` is `accountsQuery.data` filtered ONLY by `id !== sourceAccountId` — no ownership/viewer filter — but `resolveTransactionPermission` requires the destination to be owned by the caller OR held as `viewer` in `user_accounts` sharing a space with the source. In a shared space, picking a co-member's account is a FORBIDDEN the client never pre-validates. (NewTransactionSheet's transfer form has the identical unfiltered `destItems`, so the picker/server mismatch itself is pre-existing and symmetric.)

**Final state (2026-08-01), all earlier round-2 concerns resolved.** The edit
path has its own in-flight marker `__saving` (`SAVING_FLAG`) distinct from the
create path's `__pending`, and deliberately patches **no totals at all** (an
edit can move a row across the nine-dimension `filteredTotals` filter, so
`next - previous` would be wrong, not early).

Corrections to what this memory previously claimed — all now fixed, do not
re-report:
- `TransactionDetailsSheet` takes `canEdit` (ownership) **and** a separate
  `isSaving` that gates ONLY the Edit hand-off. Delete + attachments stay live,
  precisely because `__saving` has no timeout.
- `TransactionsPage` holds `selectedTxId` (not a row object) and re-derives the
  row from `items` each render, so the details sheet tracks live cache state.
- The optimistic edit DOES blank `account_balances_after` — gated on the amount
  actually *differing* (`variables.amount !== Number(transaction.amount)`), or
  either account being sent. **Rule still worth enforcing on new code: never
  leave a server-derived running balance beside a client-edited amount.**

**Still-true invariants for future review rounds here:**
- `onMutate` must not throw AFTER it has patched the cache — a throw there
  rejects the mutation before the request is sent, so `onError` gets
  `ctx === undefined` and the `__saving` flag is never rolled back. Today
  `patchSavingRow` is the last statement, and the `fromInputDateTime` NaN
  backstop in `submit` keeps `new Date(...).toISOString()` from throwing.
- Hook-level `onSuccess`/`onError`/`onSettled` DO still fire after the sheet
  unmounts (react-query's `Mutation` holds its own options snapshot), which is
  what makes close-on-submit safe. Don't "fix" this by re-adding a mounted
  guard.
- `applyDelta`/`reverseDelta` take `(delta, spaceId)` and match only
  `transaction.filteredTotals` variants whose cached input's `spaceId` matches;
  they never touch `personal.transactionFilteredTotals` (different IN/OUT
  formula). A path-only totals broadcast is a real bug class here because
  `useInvalidateAnalytics` only invalidates one spaceId.
