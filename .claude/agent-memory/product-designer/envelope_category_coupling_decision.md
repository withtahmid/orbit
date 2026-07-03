---
name: envelope-category-coupling-decision
description: Product judgment on Orbit's envelope↔category coupling — strict N:1 conflicts with spec's stated orthogonality; recommended path is soft-decouple via transactions.envelop_id.
metadata:
  type: project
---

The envelope↔category coupling in Orbit is a known design tension as of 2026-05-12 (branch `rethink-budgeting`). The schema enforces `expense_categories.envelop_id NOT NULL REFERENCES envelops` with a "subtree invariant" (all descendants share parent's envelope), but the spec at §1 describes envelopes (funding/cadence) and categories (taxonomy/priority) as orthogonal — Monarch-lane, not YNAB-lane. Implementation is YNAB-lane wearing two hats.

**Why:** The coupling exists so the legacy trigger (migration 019, retired in 026) and on-read balance resolution can compute `tx → envelope` via the join. It buys join simplicity at the cost of: (1) categories pinned to one envelope, (2) subtree reorganization traps, (3) no "uncategorized" expense flow, (4) historic balances don't follow `changeEnvelop` rewrites, (5) `expenseCategory.delete` is unguarded and 500s on FK violation.

**RESOLVED 2026-07-03 (branch `feat/category-enhanchment`):** The team went *past* Option A — full decouple. Migration `050_drop_category_default_envelope.mts` drops `expense_categories.envelop_id` entirely. Categories are now pure labels; the envelope is stored on `transactions.envelop_id` and chosen per-transaction (an envelope *pin* provides quick-entry prefill, not the category). `changeEnvelop.mts`, `resolveCategoryEnvelopActive`, `resolveEnvelopIdFromExpenseCategory` are all deleted; `create.mts` no longer takes `envelopId`. Server side is clean.

**Stale-docs debt from this decouple (flag on sight, not yet updated as of 2026-07-03):** `contexts/project-specification.md` (rollup wording at ~710/796/866/901/1030/1299/1388/1404; migration table missing 050), `contexts/modules/server/expenseCategory.md` + `envelop.md` (describe "pinned to one envelope", subtree invariant, changeEnvelop — all gone), `contexts/modules/web/categories.md` ("re-pin"), `contexts/modules/web/transactions.md:33` (old chip states "category default/overridden" — now "pinned/selected"), `contexts/modules/INDEX.md`. Also stale code comments: `OrbitForm.tsx:~1018`, `NewTransactionSheet.tsx:~407` ("overridden"), and `CategoryTreeSelect.tsx` `disabledIds`/`disabledHint` prop added for archived-envelope categories is now dead (no caller).

**How to apply:** Coupling is settled — do NOT reopen it or propose re-coupling. Recurring anomaly pattern: a big model change lands in code+primary docs but leaves the spec/module-docs teaching the old mental model. When reviewing category/envelope work, always scan DocsPage + contexts for rollup language.

Related: [[events-domain-shape]].
