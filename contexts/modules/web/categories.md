# Categories (web)

> The category workbench — every expense category in a drag-to-re-nest tree pane with a side inspector for rename / restyle / priority / re-parent / delete and an inline create form. Categories are no longer pinned to envelopes (that relation was dropped in migration 050).

## Route(s)
- Path: `ROUTES.spaceCategories(id)` -> `/s/:spaceId/categories` (`apps/web/src/router/routes.ts:23`).
- Lazy-imported and mounted under `SpaceLayout` in `apps/web/src/router/index.tsx`.
- Guards: `ProtectedRoute` -> `CurrentSpaceProvider` -> `SpaceLayout`. Real-space only — `SpaceLayout` hides the Categories tab in personal mode, and the page itself hard-redirects `/s/me/categories` back to the space overview (`CategoriesPage.tsx:162`), so a typed URL can't land here.

## Files
- Main page: `apps/web/src/pages/space/categories/CategoriesPage.tsx` (~2430 lines). One big file containing the `CategoriesWorkbench` (left tree pane + right inspector/create panel), the drag-and-drop re-nesting logic, the create form, and the inline CSS. Wraps in `.orbit-design ct-root` (`:536`).

## tRPC procedures consumed
- `expenseCategory.listBySpaceWithUsage` — flat list with `{ parent_id, color, icon, priority, tx_count, last_used }` (`:171`). Called once with just `{ spaceId }` — there is no period selector and no prev-period trend delta on this page anymore.
- Mutations:
  - `expenseCategory.create` (`:1504`).
  - `expenseCategory.update` (`:1118`) — rename + color/icon + priority (inspector).
  - `expenseCategory.changeParent` (`:356` drag-and-drop, `:1119` inspector) — re-parent in the tree.
  - `expenseCategory.delete` (`:1120`).

## State & mutations
- Tree assembly: `buildTree` (`:73`) flattens the `parent_id` graph into roots + a `byId` map; orphaned `parent_id`s are treated as roots. `VisibleRow` carries `effectivePriority` / `priorityInherited` computed by walking up the ancestor chain (`:315-320`).
- Selection model: `selectedId` opens the inspector; `creating: { parentId, seq }` swaps the panel to the create form (`seq` remounts it so "+" always starts fresh). On narrow viewports (`max-width: 1079px`) the panel becomes an overlay.
- Dirty guard: unsaved inspector edits park navigation in `pendingAction` and require confirmation before unmounting (`guardDirty`, ~`:196`) — don't bypass it when adding new panel-switching affordances.
- Drag-and-drop: rows are `draggable={isOwner}`; dropping on a row (or the `__root__` drop zone) fires `changeParent`. Blocked while a `changeParent` is pending (`:375`).
- Every mutation runs `useInvalidateAnalytics()` (`@/lib/invalidate`) instead of hand-listing caches — category edits cascade through several analytics surfaces.
- Permission gating: plain `useIsOwner()` booleans (`:168`) gate the create button, drag affordance, and inspector edit controls — this page does not use `PermissionGate`.

## Conventions & gotchas
- **Categories are not pinned to envelopes anymore.** Migration 050 dropped the category→envelope default; there is no `expenseCategory.changeEnvelop` procedure and no envelope selector anywhere on this page. Expense forms pick the envelope directly.
- `priority` is optional per category; rendering uses *effective* priority via parent walk — the priority dot shows an `is-inherited` style when it came from an ancestor (`:973-977`).
- `listBySpaceWithUsage` returns usage as `tx_count` + `last_used` (all-time), not period spend — don't reintroduce period math against this proc without changing the server side.
- The inspector uses `OrbitField` from `@/components/orbit/OrbitModalShell` — keep new form fields on the same primitives so the visual language stays consistent inside this page.

## Cross-references
- Server: `apps/server/src/procedures/expenseCategory/*` (`changeParent`, `create`, `delete`, `listBySpace`, `listBySpaceWithUsage`, `update`).
- Web: expense entry (`features/transactions/NewTransactionSheet.tsx`) consumes the same category list; `lib/invalidate.ts` centralizes the cross-cutting cache-bust set used here.
