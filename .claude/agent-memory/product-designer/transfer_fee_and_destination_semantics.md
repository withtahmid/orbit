---
name: transfer-fee-and-destination-semantics
description: Two non-obvious transfer rules — a fee row's structural columns (account/date/event) follow its parent transfer, and transfer destinations require a user_accounts row while income destinations do not.
metadata:
  type: project
---

**Rule 1 — a transfer fee is a dependent row, not an independent expense.** `transaction/update.mts` re-syncs a surviving fee's `source_account_id`, `transaction_datetime` and `event_id` from the parent on **every** transfer edit (not only when fee fields are touched), while deliberately leaving `description` and `location` alone. Stated rule: *structural columns follow the parent; user-authored free text does not.*

**Why:** a fee is charged by the transfer's source account at the transfer's moment. Before the sync, moving a transfer to another account/date left the fee debiting the old account in the old month — one logical operation split across two accounts, silently skewing envelope/event/category rollups.

**How to apply:** the corollary is that the fee's own edit form must not offer date or event as editable — anything the sync owns is editable-but-not-durable, and offering it is a silent clobber of user input on a ledger row. Any copy on the fee form must enumerate *all* parent-owned fields, not just the account. When adding a column to the sync block, check `EditTransactionSheet`'s `isFeeExpense` branch in the same change.

**Rule 2 — "can receive income" ≠ "can receive a transfer".** `resolveTransactionPermission` accepts an income destination on **space membership alone**, but a transfer destination needs a `user_accounts` row (owner, or viewer in a space shared with the source). So in a household space a co-member's account is a legal income target and an illegal transfer target.

**Why:** unclear whether intentional; it long predates the client-side destination filtering added 2026-07-31.

**How to apply:** the client mirrors this by filtering transfer destination pickers on `myRole != null`. Since the accounts are visible everywhere else in the space, the omission needs stating in the UI — and when no destination qualifies, the picker is empty with no explanation. Treat "is this asymmetry intended?" as an open product question worth resolving rather than mirroring further. Related: [[permission_aware_empty_states]].
