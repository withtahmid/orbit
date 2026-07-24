# space module (server)

> Spaces are the multi-tenant container for budgets, accounts, envelopes, and transactions. This module owns space CRUD, membership/role management, and the email-invite flow. All operations are role-gated via `resolveSpaceMembership` (except the token-credentialed invite endpoints).

## Router
- File: `apps/server/src/routers/space.mts:17`
- Composes procedures:
  - `space.create` — create a space and seed the caller as `owner`.
  - `space.update` — rename a space.
  - `space.memberList` — list members (any role).
  - `space.list` — list spaces the caller belongs to.
  - `space.addMembers` — add one or more users with roles.
  - `space.removeMember` — remove members; protects the last owner.
  - `space.changeMemberRole` — change a member's role; protects the last owner.
  - `space.delete` — owner-only space deletion.
  - `space.sendInvite` / `space.listInvites` / `space.revokeInvite` / `space.acceptInvite` / `space.inviteInfo` — email-invite flow (migration `039`).
  - `space.leave` — self-remove from a space; protects the last owner.

## Procedures
- **`createSpace`** (`procedures/space/create.mts:7`) — Auth: authorized. Input: `{ name: string (1-100) }`. Output: `{ id, name }`. In one transaction, inserts a `spaces` row (with `created_by`/`updated_by` set to the caller) and inserts the caller into `space_members` with `role='owner'`.
- **`updateSpace`** (`procedures/space/update.mts:8`) — Auth: `owner` or `editor`. Input: `{ spaceId, name? }`. Output: `{ id, name }`. Sets `updated_by = ctx.auth.user.id`. Empty input still issues an UPDATE (no early-out).
- **`spaceMemberList`** (`procedures/space/memberList.mts:8`) — Auth: any space role. Input: `{ spaceId }`. Returns `[{ id, email, first_name, last_name, avatar_file_id, role }]` for every member by joining `space_members` to `users`.
- **`listSpaces`** (`procedures/space/list.mts:6`) — Auth: authorized. No input. Returns spaces the caller is a member of, projected to `{ id, name, myRole }`. Uses `z.enum(...).parse(...)` to cast Kysely's codegen `ArrayType` union to the literal at the boundary.
- **`addMembersToSpace`** (`procedures/space/addMembers.mts:8`) — Auth: owner or editor. Input: `{ spaceId, members: [{ userId, role }] }` (≥1 member). Output: `{ spaceId, addedCount }`. **Only owners may add `owner`-role members** — an editor trying to add an owner throws `FORBIDDEN`. Insert uses `ON CONFLICT (space_id, user_id) DO NOTHING` so re-adds are idempotent; `addedCount` reflects only new rows.
- **`removeMemberFromSpace`** (`procedures/space/removeMember.mts:8`) — Auth: owner-only. Input: `{ spaceId, userIds: uuid[] }`. Counts current owners and owners-in-the-removal-set; throws `BAD_REQUEST "Space must have at least one owner"` if removing them would empty the owner pool. Then deletes the membership rows in one query.
- **`changeMemberRoleInSpace`** (`procedures/space/changeMemberRole.mts:8`) — Auth: owner-only. Input: `{ spaceId, userId, role }`. Looks up the target's current role; if downgrading the last owner, throws `BAD_REQUEST`. Throws `NOT_FOUND` if the target isn't a member of the space.
- **`deleteSpace`** (`procedures/space/delete.mts:8`) — Auth: owner-only. Input: `{ spaceId }`. Deletes the `spaces` row; the rest of the space's data (members, accounts, envelopes, transactions, etc.) is cleared by `ON DELETE CASCADE` chains rooted at `spaces.id`.
- **`sendInvite`** (`procedures/space/sendInvite.mts`) — Auth: owner or editor; **only owners may invite as `owner`** (`FORBIDDEN` otherwise, mirroring `addMembers`). Input: `{ spaceId, email (lower-cased), role }`. Refuses self-invite and inviting an existing member. Generates a 64-hex-char token (`crypto.randomBytes(32)`), TTL 72h, inserts a `space_invites` row, and emails an accept link (`${WEB_URL}/invite/${token}`). Output: `{ id, email, role, expiresAt }` — the token is NOT returned to the caller, only mailed.
- **`listInvites`** (`procedures/space/listInvites.mts`) — Auth: owner or editor. Returns only **pending** invites (not accepted, not revoked, not expired) with inviter name, newest first.
- **`revokeInvite`** (`procedures/space/revokeInvite.mts`) — Auth: owner or editor; only owners may revoke an owner-grade invite. Sets `revoked_at`. Idempotent: revoking a missing/accepted/already-revoked invite is a silent no-op (doesn't leak existence).
- **`acceptInvite`** (`procedures/space/acceptInvite.mts`) — Auth: authorized (any logged-in user holding the token). Input: `{ token }`. Locks the invite `FOR UPDATE` (two concurrent accepts can't both pass the pending check); rejects revoked/accepted/expired. Inserts the membership, or if the caller is already a member, **upgrades** their role when the invite confers a higher rank (never auto-downgrades). Marks `accepted_at`/`accepted_by_user_id`. The invite is NOT bound to the invited email — whoever presents the token joins.
- **`inviteInfo`** (`procedures/space/inviteInfo.mts`) — **`publicProcedure`**: token-credentialed lookup so the accept page can render space name + role before sign-in. Returns minimal data (`email`, `role`, `spaceName`, `inviterName`, `expiresAt`).
- **`leaveSpace`** (`procedures/space/leave.mts`) — Auth: authorized; the caller removes their own membership. Refuses if they're the sole owner (same guard as `removeMember`). Also revokes any pending invites outstanding to the caller's email in that space, so a stale invite link can't silently re-add them.

## Database tables
- **`spaces`** (`migrations/0004_create_spaces_table.mts`). Columns: `id uuid PK`, `name varchar(255) NOT NULL`, `created_at`, `updated_at`, `created_by uuid → users.id` (NOT NULL), `updated_by uuid → users.id` (NOT NULL). After migration `027_fk_on_delete_restrict_for_created_by.mts` the `created_by`/`updated_by` FKs use `ON DELETE RESTRICT` so a user can't be deleted while they own creator history. (The `budget_mode` column added by `037` was DROPPED in `048_simplify_budgeting.mts` — strict budget mode is gone.)
- **`space_members`** (`migrations/0005_create_space_members_table.mts`). Composite PK `(space_id, user_id)`. Columns: `space_id uuid → spaces.id ON DELETE CASCADE`, `user_id uuid → users.id ON DELETE CASCADE`, `role` enum `__type_space_user_role ('owner','editor','viewer')`, `created_at`. No separate id column.
- **`space_invites`** (`migrations/039_create_space_invites.mts`). `id uuid PK uuidv7`, `space_id` FK CASCADE, `email varchar(255)`, `role __type_space_user_role`, `token varchar(64) UNIQUE`, `invited_by → users.id`, `expires_at`, `accepted_at`/`accepted_by_user_id`, `revoked_at`, `created_at`. A partial-unique index on `(space_id, email)` over still-pending rows keeps one live invite per address per space.

## Conventions & gotchas
- **Role checks go through `procedures/space/utils/resolveSpaceMembership.mts`** — it validates that the space exists (throws `NOT_FOUND`) AND that the caller has one of `roles` (throws `FORBIDDEN`). Always pass the active `trx` so the check participates in the surrounding transaction. The exported `ALL_ROLES` constant (`resolveSpaceMembership.mts:12`) is shorthand for `["owner","editor","viewer"]` read-only checks.
- The role enum reaches user code via `SpaceMembers["role"]` from the kysely codegen. Because that type is `ArrayType<...>` (codegen quirk), call sites use the pattern `["owner"] as unknown as SpaceMembers["role"][]`. Don't remove those casts without regenerating types and proving they aren't needed.
- **Last-owner invariant** is enforced in `removeMember`, `changeMemberRole`, `leave`, and `user.deleteAccount` (see the user module doc). Adding a new owner is not symmetric — an editor cannot promote anyone via `addMembers` (`procedures/space/addMembers.mts:41`) or invite an owner via `sendInvite`.
- Mutations that change multiple rows (`create`, `addMembers`, `removeMember`, `changeMemberRole`, `delete`) wrap in `qb.transaction().execute(...)`. `update` does not — it's a single UPDATE.
- Cascading deletes from `spaces.id` reach `space_members`, `space_accounts`, `envelops` → `expense_categories` / `envelop_allocations`, `events`, `transactions`, etc. `deleteSpace` does not need to manually clean these up.

## Cross-references
- `apps/server/src/procedures/space/utils/resolveSpaceMembership.mts` — the role gate used by every member-aware procedure across the codebase (account, envelop, event, transaction, file, analytics).
- `contexts/modules/server/auth.md` — `findUserByEmail` is the typical front-end lookup before calling `addMembers`.
