---
name: category-tree-walk-cycle-guards
description: parent_id cycles in expense_categories are UNREACHABLE from buildTree's roots, so visited-guards on category walks are dead code for hang-prevention — the real symptom is silently-missing rows
metadata:
  type: project
---

Every `parent_id` walker in the web app (`CategoryTreeSelect`'s search, `TransactionsPage`'s `categoryRootById`, `CategoriesPage`'s `ancestorIds`, `CategoryMultiSelect`'s `path`) carries a `seen` visited-guard with a comment about "corrupt data must degrade, not hang."

**Why those guards can never actually fire in the render path:** each category has exactly ONE `parent_id`, so a cycle is a closed loop with no edge entering it from outside. `buildTree` (`CategoryTreeSelect.tsx`) pushes a node into `roots` only when `!parent_id || !map.has(parent_id)` — every cycle member has a resolvable parent, so NONE of them land in `roots`, and `flatten`/`assignDepth` (both recursive, both unguarded) never reach them. `flatten` therefore cannot infinite-loop.

**How to apply:** The guards are harmless defense, but do not treat their presence as evidence the cycle case is handled. The actual observable symptom of a cycle is that the whole cycle branch **silently disappears** from any picker built on `buildTree` — and in `CategoryTreeSelect`'s search, a matched cycle member is added to `visible`/`matched` but filtered right back out by `flatten(tree, new Set()).filter(...)`, so `matched` and `rows` disagree with no user-visible signal. `categoryRootById` degrades differently: it reports the cycle *partner* as the row's "root", printing a wrong "in <Name>" label.

**Server side:** cycle creation is blocked on create/update, but there is no DB-level constraint (see [[category-parent-cycle-risk]]) — a bad migration or direct SQL can still introduce one.
