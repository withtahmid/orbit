---
name: transfer-fee-parent-lockstep
description: On a transfer edit, the linked fee row's source_account_id / transaction_datetime / event_id follow the parent; why this is balance-safe under migration 018's trigger.
metadata:
  type: project
---

`apps/server/src/procedures/transaction/update.mts` ends a transfer edit
with a second UPDATE that copies `source_account_id`,
`transaction_datetime` and `event_id` from the parent transfer onto its
linked fee row (the `type='expense'` row found via `parent_transfer_id`),
guarded by `isTransfer && linkedFee && !clearFee`.

**Why it can't double-apply balances:** migration 018's
`__sync_account_balance_from_transactions` is an AFTER ... FOR EACH ROW
trigger that on UPDATE applies `OLD` with direction −1 and `NEW` with +1.
Statements run sequentially inside the tRPC transaction, so the second
UPDATE's `OLD` is the row as the first UPDATE left it. When only
datetime/event change, `OLD` and `NEW` have the same amount and accounts,
so the ±pair cancels to exactly 0. When the account changes, it is a clean
reverse-then-apply.

**Why it can't hit a wrong row:** `clearFee` implies the delete branch
already ran (`!clearFee` guard), and the insert branch only runs when
`linkedFee` is null, so a freshly inserted fee — already seeded from
`merged` — is never touched again.

**Rollup consequence (intended):** envelope/plan balances are on-read
since migration 026, and `filteredTotals` sums `type='expense'`, so moving
the fee's datetime re-buckets it into the parent's window/period/event.
That is the point of the change — previously a re-dated transfer stranded
its fee in the old month.

**The rule:** STRUCTURAL columns follow the parent; `description` and
`location` do not, because the fee row is directly editable
(`isFeeExpense` in `EditTransactionSheet`) and re-copying would clobber
user prose.
