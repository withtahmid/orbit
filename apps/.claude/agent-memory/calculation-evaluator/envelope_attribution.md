---
name: envelope-attribution
description: How expense→envelope attribution works in analytics after the category↔envelope decoupling (migration 041), and why tier/category totals are envelope-independent.
metadata:
  type: project
---

Envelope attribution for expenses is the transaction's own `t.envelop_id`
(frozen at insert), NOT the category's envelope. Migration 041 added the
CHECK `(type != 'expense' OR envelop_id IS NOT NULL)`, so **every expense row
has a non-null envelop_id**. `expense_categories.default_envelop_id` was later
dropped; it only auto-fills the entry form now.

**Why it matters for audits:**
- In `analytics/priorityBreakdown.mts`, tier totals depend only on the
  category→priority recursive-ancestry CTE (join on `expense_category_id`),
  never on envelope. Envelope is a pure sub-partition inside each tier.
  Because every expense has a non-null envelop_id and the envelope LEFT JOIN
  (`env.id = e.envelop_id`) is on a PK (no row multiplication, no deleted_at
  filter), **per-tier envelope sub-totals sum exactly to the tier total**.
- Uncategorized expense (`expense_category_id` NULL, allowed) → priority
  resolves NULL → JS maps to the "unclassified" tier, and its envelope is
  still attributed (envelop_id is always present).
- `categoryBreakdown` (space + personal/) ignore envelopes entirely:
  `direct_total` = own expenses, `subtree_total` = sum over the descendant
  tree. Output shape: id, parentId, name, color, icon, directTotal,
  subtreeTotal (+ spaceId/spaceName in personal). No envelope field.

**Seed self-consistency:** `seed.mts` derives each expense's `envelop_id` from
`envelopByCategoryId` (config `CATEGORIES[].envelope`), and non-expense rows
(income/transfer/adjustment) carry envelop_id NULL. So seeded priority-envelope
breakdowns are internally consistent.

**How to apply:** When auditing analytics that partition expenses by envelope,
confirm the envelope comes from `t.envelop_id` (not any category column) and
that money conservation holds at the *tier/category* level independent of the
envelope sub-split.
