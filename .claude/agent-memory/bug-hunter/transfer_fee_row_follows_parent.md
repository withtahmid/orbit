---
name: transfer-fee-row-follows-parent
description: transaction/update.mts syncs a transfer's linked fee row (source_account_id, transaction_datetime, event_id) to the parent on EVERY transfer edit; description/location deliberately do not follow.
metadata:
  type: project
---

`apps/server/src/procedures/transaction/update.mts` ends with a block that,
for `isTransfer && linkedFee && !clearFee`, copies `source_account_id`,
`transaction_datetime` and `event_id` from the merged parent onto the linked
`type='expense'` fee row (`parent_transfer_id` = the transfer). It runs on
**every** transfer edit, not only when the fee fields are touched.

**Why:** without it, moving a transfer to another account/date/event stranded
the fee debiting the old account in the old month — one logical operation split
across two accounts, and (because a fee is an expense row) skewed
envelope/event/category rollups with no visible cause.

**How to apply when reviewing this area:**
- The rule is *structural columns follow the parent; user-authored prose does
  not*. `description`/`location` are intentionally NOT re-copied (the fee row is
  directly editable via `isFeeExpense` in `EditTransactionSheet`, so re-copying
  would clobber typed text). Don't "complete" the list.
- Consequence to remember: a user who edits a fee row's own date or event will
  see it silently reverted by the next parent-transfer edit. Accepted tradeoff,
  but the `OrbitInfoPill` copy on that form ("everything else is editable")
  overstates it.
- Permission safety rests on transfer-source validation being a superset of
  expense-source validation in `resolveTransactionPermission` (both:
  `resolveAccountPermission(owner)` + `rejectIfLocked`). If either branch ever
  diverges, this block becomes a privilege hole.
- Balance correctness rests on the delta-based trigger from migration 018/042
  (`OLD, -1` then `NEW, +1` on UPDATE), so moving the fee's
  `source_account_id` correctly moves the debit, and a no-op UPDATE nets zero.
- Ordering matters: `linkedFee` is read BEFORE the parent's own UPDATE, and the
  clear/update/insert branches run before this sync. The `!clearFee` guard is
  what stops it writing to a row the delete branch just removed.

Related: [[optimistic-tx-ondone-decoupling]] (same working tree).
