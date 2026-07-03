---
name: project-category-lifecycle-gaps
description: expense_categories have no archive and used ones can't be deleted (FK RESTRICT); merge/reassign is the missing affordance
metadata:
  type: project
---

Categories (`expense_categories`) have a structural lifecycle gap the /categories redesign inherits.

Facts (verified 2026-07-03 against migrations + types.mts):
- No `archived` / `deleted_at` column on `expense_categories` (envelopes DO have archival). types.mts:111-122.
- A **used** category cannot be deleted: `transactions.expense_category_id` FK has no onDelete (Postgres default NO ACTION), `fee_expense_category_id` is `ON DELETE RESTRICT` (spec §883), and `transactions_expense_category_check` forces expense rows to have a category (so SET NULL is illegal too). `delete.mts` does a plain deleteFrom with no reassignment.
- `parent_id` FK is `ON DELETE RESTRICT` (migration 0012) — so deleting a category with children also fails at the DB.
- Net effect: an obsolete-but-used category is stuck in every picker forever.

**Why:** In an app whose thesis is clean categorization, having no retire path is a real product gap, not a nice-to-have.
**How to apply:** When reviewing /categories or planning category work, the highest-value feature is a **merge/reassign** procedure (`expenseCategory.merge`, transactional, owner-only) that repoints transaction + fee category refs then deletes the source. It simultaneously unblocks delete. Second: an "archived" flag / "Never used" pruning surface. Do NOT propose cascade-delete of children or transactions — Orbit never silently drops financial records.

Related delete-affordance defect: the redesigned inspector enables Delete when `tx_count > 0` and promises "transactions keep the label", but the FK makes that delete throw. Delete must be gated on `tx_count > 0` too (only `hasKids` was gated). See [[project_simplify_budgeting]] for the broader "concepts that leak into UI" pattern.
