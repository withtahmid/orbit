# transaction module (server)

> Records every money movement (income / expense / transfer / adjustment). The DB enforces per-type column shapes via CHECK constraints, and a PL/pgSQL trigger keeps `account_balances` in sync on every INSERT / UPDATE / DELETE.

## Router

- File: `apps/server/src/routers/transaction.mts:11`
- Procedures:
    - `income` — credit one account, no source.
    - `expense` — debit one account against an expense category + envelope.
    - `transfer` — move money between two accounts; an optional fee becomes its own paired expense row.
    - `adjust` — reconcile an account to an absolute target balance; synthesizes an `adjustment` row.
    - `update` — partial edit of any existing row; gated by created-by OR owner/editor.
    - `delete` — hard delete; trigger reverses the balance effect.
    - `listBySpace` — paginated listing with rich filter set.
    - `filteredTotals` — IN/OUT/NET/COUNT/AVG-PER-DAY for the same filter set as `listBySpace`.

## Procedures

### Mutations

- **`createIncomeTransaction`** (`procedures/transaction/income.mts:12`) — `authorizedProcedure`, single transaction wrapped in `withIdempotency` (`income.mts:29`) keyed on `(userId, "transaction.income", idempotencyKey)`. Input: `{ spaceId, amount>0, datetime?, description?, location?, accountId, eventId?, attachmentFileIds[≤10]?, idempotencyKey? }`. Permission via `resolveTransactionPermission` (`income.mts:35`): the destination must either be owned by the caller OR shared into a space the caller is a member of (`utils/resolveTransactionPermission.mts:62-89`). `resolveTransactionSpaceIntegrity` (`income.mts:43`) requires `space_id` to share at least one account with the row. Optional `eventId` is validated via `resolveEventBelongsToSpace` with `requireActive: true` (`income.mts:55`) — a closed event id, e.g. from a stale event pin, is rejected at this layer.

- **`createExpenseTransaction`** (`procedures/transaction/expense.mts:14`) — `authorizedProcedure`, transaction-wrapped, idempotent. Input adds `sourceAccountId`, `expense_category_id` (UUID, required), `envelopId` (UUID, **required** — envelopes attach to the transaction directly since migration `041`, not via the category), `eventId?`. Calls in order: `resolveTransactionPermission` requires the caller to be `'owner'` of the source account and the source account must not be `account_type = 'locked'`; `resolveTransactionSpaceIntegrity`; `resolveExpenseCategoryBelongsToSpace`; `resolveEnvelopActive` (rejects spending against a missing/foreign/archived envelope). There is no balance pre-check — expenses can drive the source account negative; the web sheets surface an inline overspend hint mirroring the envelope-overspend warning.

- **`createTransferTransaction`** (`procedures/transaction/transfer.mts`) — `authorizedProcedure`, transaction-wrapped, idempotent. Input adds `sourceAccountId`, `destinationAccountId`, and an optional fee trio `{ feeAmount > 0, feeExpenseCategoryId, feeEnvelopId }` — all three or none (`transfer.mts:41-48`, `BAD_REQUEST` otherwise). The fee is persisted as its **own paired `type='expense'` row** with `parent_transfer_id` pointing back at the transfer (migration `042`); the transfer row itself is amount-only. `resolveTransactionPermission` (`utils/resolveTransactionPermission.mts`) requires: caller `'owner'` of source; source not `locked`; destination either `'owner'` by caller OR `'viewer'` by caller in a space that also shares the source. No balance pre-check — transfers can drive the source account negative, same as expenses.

- **`adjustAccountBalance`** (`procedures/transaction/adjust.mts:13`) — `authorizedProcedure`, transaction-wrapped, idempotent. Input: `{ spaceId, accountId, newBalance, datetime?, description?, location?, attachmentFileIds?, idempotencyKey? }`. Computes `delta = newBalance - current` in Postgres (`adjust.mts:64`) to preserve `numeric(20,2)` precision (no JS float round-trip). Throws `BAD_REQUEST` if `delta == 0` (`adjust.mts:91`). Direction of the adjustment row depends on sign: when `newBalance < current` the synthesized row has `source_account_id = accountId` (decrease); when `newBalance > current` it has `destination_account_id = accountId` (increase). The CHECK `transactions_adjustment_check` (migration `0013:42`) enforces exactly one of source/destination is set.

- **`updateTransaction`** (`procedures/transaction/update.mts`) — `authorizedProcedure`, transaction-wrapped. NOT idempotent. Input: all fields optional except `transactionId`; includes `envelopId?` and the fee trio `feeAmount`/`feeExpenseCategoryId`/`feeEnvelopId` (each `nullable().optional()`). Permission: the creator can always edit; otherwise the caller must be `owner`/`editor` of the space. Computes a `merged` value from `existing` + `input` so partial updates work. Fee fields move together — all set or all `null` (`null` deletes the fee); fees on a non-transfer are rejected (`update.mts:99-110`). Because the fee lives as a linked expense row (`parent_transfer_id`), transfer edits that touch fees insert/update/delete that child row (`update.mts:246-290`). Type cannot change (no input field for it). No balance pre-check on edit either — edits are recording reality, same as creates, and may drive the source account negative. The update is a plain UPDATE — the balance trigger fires `OLD direction=-1` then `NEW direction=+1` so balances stay correct (migration `018:90`).

- **`deleteTransaction`** (`procedures/transaction/delete.mts:8`) — `authorizedProcedure`, transaction-wrapped. Input `{ transactionId }`. Same creator-OR-owner/editor permission as update (`delete.mts:26`). Hard delete; the trigger reverses the balance effect via `direction=-1` (`migrations/018:96`). Returns `{ message: "Transaction deleted" }`.

### Queries

- **`listTransactionsBySpace`** (`procedures/transaction/list.mts:9`) — `authorizedProcedure`. Cursor-pagination by `transactions.id DESC` (uuidv7 → time-ordered). Joins `expense_categories` and `users` (for the creator card). Input filters (all nullish unless noted):
    - `spaceId` (required), `userId`, `type` (income/expense/transfer/adjustment), `envelopId` (matches `transactions.envelop_id` directly; also accepts the sentinel string `"__none"` meaning `envelop_id IS NULL` — a pickable "No envelope" filter), `expenseCategoryId` (+ `includeDescendants: boolean = true` resolves the category subtree with a `WITH RECURSIVE subtree` CTE; falls back to `[expenseCategoryId]` if the CTE returns nothing), `eventId`, `accountId` (matches either `source_account_id` OR `destination_account_id`), `search` (ILIKE on `description` OR `location`), `amountMin`/`amountMax`, `dateFrom`/`dateTo` (half-open `[from, to)`), `cursor` (id-based), `limit` (1-200, default 50). Fetches `limit + 1`, slices to compute `hasMore`, returns `{ items, nextCursor }`.
    - **Plural filters** — `accountIds`/`envelopIds`/`expenseCategoryIds` (`z.array(z.string().uuid())`) are multi-select siblings of `accountId`/`envelopId`/`expenseCategoryId`. When a plural array is non-empty it wins outright over its singular counterpart (`list.mts` builds `accountIdFilter`/`envelopIdFilter`/`categoryBaseIds` up front, each preferring the plural); the singular params exist only so old single-value callers (`AccountDetailPage`, event detail, deep-links) keep working unchanged. `expenseCategoryIds` + `includeDescendants` resolves descendants of *every* selected id via the same recursive CTE. This precedence is duplicated verbatim in `filteredTotals.mts` and the `personal.*` twins below — keep all four in sync.
    - **`account_balances_after`** (added to each returned item) — `Record<accountId, string>` mapping every account the row touched (one entry for income/expense/adjustment, two for a transfer) to that account's balance immediately after the row, computed by `utils/accountRunningBalance.mts`. When `accountIdFilter` resolves to exactly one account, `computeBalanceAfter` runs (single-account window, statement-mode semantics); otherwise `computeRowAccountBalances` runs over every account touched by the current page. Both scan the account's **full history across all spaces**, ignoring the active filters/pagination — the number is the account's true balance at that point (matches `account_balances.balance`), not a "delta of the visible rows" figure. See the module doc's Domain math section below.

- **`transactionFilteredTotals`** (`procedures/transaction/filteredTotals.mts`) — `authorizedProcedure`. Same filter shape as `listBySpace`, including the plural `accountIds`/`envelopIds`/`expenseCategoryIds` precedence above (no cursor/limit, no balance computation — totals only). Returns `{ inTotal, outTotal, net, count, avgPerDay, days }`. `inTotal` sums `type='income'` rows; `outTotal` sums `type='expense'` rows — transfer fees are standalone expense rows since migration `042`, so they land in `outTotal` without a special branch. `avgPerDay = outTotal / days`; `days = max(1, round((dateTo - dateFrom) / 1 day))` or `1` when no window provided.

### Balance-after helper (`procedures/transaction/utils/accountRunningBalance.mts`)

- **`computeBalanceAfter(qb, accountId, txIds)`** — single-account running balance. `SUM(signed effect) OVER (ORDER BY transaction_datetime ASC, id ASC ROWS UNBOUNDED PRECEDING..CURRENT ROW)` over the account's entire history, then filtered down to `txIds`. Returns `Map<txId, balance>`.
- **`computeRowAccountBalances(qb, txIds, accountIds)`** — multi-account version. Expands each transaction into its double-entry postings (income/expense/adjustment → one; transfer → two) via a `UNION ALL`, then `SUM(effect) OVER (PARTITION BY account_id ORDER BY dt ASC, tx_id ASC ...)`. Returns `Map<txId, Record<accountId, balance>>`. `accountIds` is both the scan bound AND, for `personal.transactions`, the **leak boundary** — the personal caller passes only its own owned accounts, so a transfer's non-owned leg never yields a balance for the other side.
- Both helpers order `(transaction_datetime, id)` ASC internally — the exact reverse of the list's `DESC` order on the same two keys — so the cumulative value at each row still lines up with that row's position in the (descending) rendered list.
- Signed effect matches the balance trigger (migration `018`, made fee-blind again at `042`): +amount to destination for income/transfer/adjustment, -amount from source for expense/transfer/adjustment. Transfer fees are separate `expense` rows and fall out naturally.

## Database tables

### `transactions` (migration `0013_create_transactions_table.mts`, altered by `030`, `041`, `042`)

Columns (`0013:11-27`):
- `id uuid PK default uuidv7()`
- `space_id uuid NOT NULL REFERENCES spaces(id)`
- `created_by uuid NOT NULL REFERENCES users(id)` (`027` later switched FK to `ON DELETE restrict`)
- `type __type_transaction_type NOT NULL` — Postgres enum: `income | expense | transfer | adjustment` (`0013:6`)
- `amount numeric(12, 2) NOT NULL`, CHECK `amount > 0` (`0013:28`)
- `source_account_id uuid REFERENCES accounts(id)`
- `destination_account_id uuid REFERENCES accounts(id)`
- `description text NULL`, `location varchar(255) NULL`
- `transaction_datetime timestamptz NOT NULL DEFAULT NOW()` (settable; used for analytics windowing)
- `created_at timestamptz NOT NULL DEFAULT NOW()`
- `expense_category_id uuid REFERENCES expense_categories(id)`
- `event_id uuid REFERENCES events(id) ON DELETE set null` (`0013:25`)
- `envelop_id uuid REFERENCES envelops(id) ON DELETE restrict` (added by `041_decouple_envelope_from_category.mts` — the source of truth for envelope attribution; CHECK requires it NOT NULL on `type='expense'` rows)
- `parent_transfer_id uuid REFERENCES transactions(id) ON DELETE cascade` (added by `042_fees_as_expense_transactions.mts` — links a fee expense row to its transfer; partial index where NOT NULL)

Fee history: migration `030_add_transfer_fees.mts` added inline `fee_amount`/`fee_expense_category_id` columns; migration `042` promoted every fee to its own `type='expense'` row (with `parent_transfer_id`) and **dropped both fee columns**. Transfers are amount-only now.

Per-type CHECK constraints (`0013:28-44`):
- `transactions_income_check`: income → destination set, source null.
- `transactions_expense_category_check`: expense → source + category set, destination null.
- `transactions_transfer_check`: transfer → both accounts set and distinct.
- `transactions_adjustment_check`: adjustment → exactly one of source/destination set (XOR via `<>`).
- Expense-envelope CHECK (`041:55`): `type != 'expense' OR envelop_id IS NOT NULL`.
- (The `030` fee-shape CHECK was dropped by `042` along with the fee columns.)

### Balance-sync trigger

Defined in migration `018_create_update_account_balance_trigger.mts`; the function body was made fee-aware by `030` and then replaced with a fee-blind version by `042` (fees are ordinary expense rows now).

- `__apply_transaction_balance_effect(tx transactions, direction integer)` (`018:5`, current body from `042`):
    - `income` → credit `destination_account_id` by `amount * direction`.
    - `expense` → debit `source_account_id` by `amount * direction`.
    - `transfer` → debit `source_account_id` and credit `destination_account_id` by `amount * direction`.
    - `adjustment` → debit/credit whichever leg is non-null.
- `__sync_account_balance_from_transactions()` (`018:79`):
    - INSERT → effect with `+1`.
    - UPDATE → effect with `-1` on OLD then `+1` on NEW (`018:90-91`).
    - DELETE → effect with `-1`.
- Trigger `__trigger_sync_account_balance_from_transactions` (`018:106`) runs `AFTER INSERT OR UPDATE OR DELETE` on `transactions`.

Generated type: `Transactions` at `db/kysely/types.mts:224`.

### Related tables

- `transaction_attachments` (migration `029:13`) — composite PK `(transaction_id, file_id)`; both FKs cascade. Populated by `attachFilesToTransaction` (`procedures/file/attach.mts`).
- `idempotency_keys` (migration `034_idempotency_keys.mts`) — backs the `withIdempotency` helper.

## Domain math / invariants

- A transaction's `space_id` is a **categorization tag**, not a scope boundary (`utils/resolveTransactionSpaceIntegrity.mts:5-15`). The integrity guard only requires that one of source/destination is shared into `space_id`; analytics still treat space scope via the `space_accounts` join, not `transactions.space_id`.
- Adjustments cannot be created at-rest by the user — the only path is `transaction.adjust`, which inserts a row whose direction is implied by the new-vs-current delta. Editing an `adjustment` row via `transaction.update` is technically allowed but the amount and direction are not auto-recomputed.
- There is no available-balance check anywhere in the mutation path. Orbit's job is to record reality, not to second-guess it — accounts may go negative through expenses, transfers, or edits. The web new/edit sheets render an inline overspend hint (see `SourceOverspendHint` in `apps/web/src/features/transactions/NewTransactionSheet.tsx`) so the user notices typos without being blocked.
- Fees count as expense everywhere downstream because they ARE expense rows (migration `042`): each fee is a `type='expense'` transaction with its own category/envelope and a `parent_transfer_id` back-link. Deleting the transfer cascades to its fee row via that FK. No analytics query carries a fee `UNION ALL` branch anymore.

## Conventions & gotchas

- All four creation paths are wrapped in `withIdempotency`. Pass an `idempotencyKey` UUID from the client when the user might retry; the response is cached keyed on `(user_id, operation, key)`.
- There is no budget gate on any creation path — overspend is recorded and surfaced in analytics, never blocked. (The old strict-mode `resolveStrictGate` was removed in `048_simplify_budgeting.mts`.)
- `updateTransaction` doesn't let you change `type`. If you need to convert (say expense → transfer), delete and re-create.
- The `type` column is a Postgres enum but the codegen represents it as `ArrayType<...>` — code throughout the module casts string literals via `"income" as unknown as Transactions["type"]`. Don't try to import the enum at runtime.
- `transaction.list` orders by `id DESC` (not `transaction_datetime`); because ids are uuidv7 they're insertion-time-ordered, but that's NOT the same as `transaction_datetime` (the user-supplied event time). Treat the list order as "newest entered first".
- `list.mts` and `filteredTotals.mts` duplicate the same WHERE clause, and both have a `personal.*` twin (`personal/transactions.mts`, `personal/transactionFilteredTotals.mts`) that duplicates it a third/fourth time. When adding a filter (or changing plural/singular precedence), update all four — the comment on `filteredTotals.mts:10` explicitly calls out that they must stay in sync.
- The balance trigger uses `direction integer`, so passing `direction=-1`/`+1` controls the sign. There is no soft-delete; trigger DELETE always reverses.

## Cross-references

- Transaction permission: `procedures/transaction/utils/resolveTransactionPermission.mts:8` — the income-into-shared-account and transfer-into-viewer-account rules live here.
- Analytics consumers: nearly every procedure in `analytics/` reads `transactions`; fees participate as ordinary expense rows (see analytics module doc).
- Event linkage: `event.delete` does NOT cascade — the `event_id` FK is `ON DELETE set null` (migration `0013:26-27`), so deleting an event leaves its transactions intact.
- Closed-event guard on **create paths only** — `expense.mts:68`, `income.mts:55`, `transfer.mts:78` pass `requireActive: true` to `resolveEventBelongsToSpace`. `update.mts` deliberately omits the flag so a row written when an event was active remains editable after the event closes.
- Pin coupling: the new-transaction form pre-hydrates fields from the `pin` router. The server doesn't read pins during transaction creation — pins are hydrate-only on the client. See the pin module doc.
