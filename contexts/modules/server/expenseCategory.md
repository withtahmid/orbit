# expenseCategory module (server)

> Per-space hierarchical spending categories. Categories are **pure labels** — the old category→envelope link was removed by migrations `041` (envelope routing moved to `transactions.envelop_id`) and `050` (the leftover `default_envelop_id` prefill hint dropped). They carry an inheritable priority tier.

## Router
- File: `apps/server/src/routers/expenseCategory.mts`
- Composes procedures (`apps/server/src/routers/expenseCategory.mts:9`):
  - `create` / `update` / `delete` — category CRUD.
  - `changeParent` — re-parent within the same space.
  - `listBySpace` — flat list, no stats.
  - `listBySpaceWithUsage` — same list plus `tx_count`, `spent_total`, `last_used` over an optional period window.

## Procedures
- **`createExpenseCategory`** (`procedures/expenseCategory/create.mts:11`) — Auth: space `owner`. Input: `{ spaceId, name, parentId?: uuid|null, color?, icon?, priority?: "essential"|"important"|"discretionary"|"luxury", idempotencyKey? }`. No envelope field — categories don't reference envelopes anymore. Validates the parent (if given) belongs to the same space. Wrapped in `withIdempotency`.
- **`updateExpenseCategory`** (`procedures/expenseCategory/update.mts:10`) — Auth: space `owner`. Partial update of `name`, `color`, `icon`, `priority` (priority accepts `null` to clear). Cannot change `parent_id` here — use `changeParent`.
- **`deleteExpenseCategory`** (`procedures/expenseCategory/delete.mts:8`) — Auth: space `owner`. Deletes one category row. Locks the row `FOR UPDATE` (serializing with `changeParent`'s endpoint locks) and pre-checks two friendly guards before the FKs would fire: refuses if the category has children ("Move or delete them first") and refuses if any `transactions.expense_category_id` still references it ("Rename or re-nest it instead").
- **`changeExpenseCategoryParent`** (`procedures/expenseCategory/changeParent.mts:9`) — Auth: space `owner`. Input: `{ categoryId, parentId: uuid|null }`. Refuses self-parenting; validates target parent is in the same space; locks both endpoints `FOR UPDATE` in deterministic order (so reciprocal concurrent moves serialize) and re-verifies both rows under the lock; then **rejects descendants** via a depth-capped recursive `chain` walk up from the proposed parent — nothing in the DB stops `parent_id` cycles, so this is the only cycle defense on the write path.
- **`listExpenseCategoriesBySpace`** (`procedures/expenseCategory/listBySpace.mts:8`) — Auth: any space role. Flat `SELECT` ordered by `created_at ASC`. Returns all rows; client builds the tree from `parent_id`.
- **`listExpenseCategoriesBySpaceWithUsage`** (`procedures/expenseCategory/listBySpaceWithUsage.mts:19`) — Auth: any space role. Input: `{ spaceId, periodStart?, periodEnd? }` (omitted bounds = full history). One SQL pass joining categories LEFT JOIN a `usage` CTE over `type='expense'` rows (transfer fees are themselves expense rows since migration `042`, so they're included naturally). Returns `{ ..., tx_count, spent_total, last_used }`.

## Database tables
- **`expense_categories`** (`migrations/0012_create_expense_categories_table.mts`). Columns: `id uuid PK uuidv7`, `space_id uuid` FK CASCADE, `parent_id uuid` FK `ON DELETE RESTRICT` (self-reference), `name varchar(255)`, `created_at`, `updated_at`. Extended/altered by:
  - `022_add_colors_and_icons.mts:30` — `color varchar(7)` default `#10b981`, `icon varchar(48)` default `folder`.
  - `031_add_category_priority.mts:18` — `priority text` nullable, CHECK constraint enforces `priority IN ('essential','important','discretionary','luxury')`.
  - `041_decouple_envelope_from_category.mts` — renamed `envelop_id` → `default_envelop_id` (entry-form prefill hint only); envelope routing moved to `transactions.envelop_id`.
  - `050_drop_category_default_envelope.mts` — DROPPED `default_envelop_id`. Categories no longer reference envelopes at all.
  - Indexes from `020_create_indexes.mts:41-54`: `idx_expense_categories_space`, `idx_expense_categories_parent` (the envelope index went with the column).

## Domain math / invariants
- **Categories do NOT drive envelope attribution.** Since migration `041`, envelope consumption reads `transactions.envelop_id` directly (`procedures/envelop/utils/resolveEnvelopePeriodBalance.mts`); the category on a transaction is a reporting label only. Changing a transaction's category never moves envelope spend.
- **Tree integrity is application-enforced.** The DB has no cycle constraint on `parent_id`; `changeParent`'s descendant check (plus endpoint locking) is the write-path defense, and the analytics recursive CTEs carry a `path`-array cycle guard as a read-path belt-and-braces (see `analytics.md`).
- **Priority inheritance.** `priority` is nullable on the row; the documented model (`migrations/031_add_category_priority.mts:6-15`) is that children with NULL priority inherit from the nearest non-null ancestor. The DB does not enforce this — consumers (analytics) walk the tree.

## Conventions & gotchas
- `parent_id` is RESTRICT, so deleting a non-leaf category fails; `delete` pre-checks and returns a friendly `BAD_REQUEST` instead of a raw FK 500. Same for categories still referenced by transactions.
- Transactions reference categories via `expense_category_id` (required on every expense row, including the standalone fee rows created for transfer fees since migration `042`).
- `priority` CHECK is defined inline on the column (`migrations/031_add_category_priority.mts:22`), not as a named enum type — values are raw strings. The TS type in `db/kysely/types.mts` is `string | null`; procedures cast it to the literal union manually.

## Cross-references
- `contexts/modules/server/envelop.md` — envelopes now attach to transactions directly; nothing in this module touches them.
- `contexts/modules/server/transaction.md` — expense creation requires both `expense_category_id` and `envelopId` as independent inputs.
- `apps/server/src/procedures/analytics/*` — primary consumer of the category tree + priority for breakdown reports (`categoryBreakdown`, `categoryMonthlyTrend`, `priorityBreakdown`).
