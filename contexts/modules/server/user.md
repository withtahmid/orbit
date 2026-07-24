# user module (server)

> Authenticated user account management: avatar, profile name, email, password change, and soft account deletion.

## Router
- File: `apps/server/src/routers/user.mts:8`
- Composes procedures:
  - `user.updateAvatar` — set or clear the current user's `avatar_file_id`.
  - `user.updateProfile` — change first/last name.
  - `user.changeEmail` — change email, gated by current password.
  - `user.changePassword` — change password, gated by current password; rotates `token_version`.
  - `user.deleteAccount` — soft-delete (tombstone) the caller's account.

## Procedures
- **`updateAvatar`** (`procedures/user/updateAvatar.mts:6`) — Auth: authorized. Input: `{ fileId: uuid | null }`. Output: `{ avatar_file_id }`. If `fileId` is non-null, validates that the file row exists, was uploaded by the current user (`uploaded_by = ctx.auth.user.id`), has `purpose = 'avatar'`, and `status = 'confirmed'` — throws `NOT_FOUND` / `BAD_REQUEST` otherwise. Then writes `users.avatar_file_id = fileId` (or `null` to clear).
- **`updateProfile`** (`procedures/user/updateProfile.mts`) — Auth: authorized. Input: `{ firstName, lastName }` (trimmed, 1-100 chars each). Plain UPDATE of `users.first_name`/`last_name`; returns the updated pair.
- **`changeEmail`** (`procedures/user/changeEmail.mts`) — Auth: authorized. Input: `{ email (lower-cased), currentPassword }`. Verifies the current password via `bcrypt.compare` under a `FOR UPDATE` row lock; same-email is a no-op; a Postgres unique violation (`23505`) maps to `CONFLICT "That email is already in use"`. No email re-verification step (unlike signup).
- **`changePassword`** (`procedures/user/changePassword.mts`) — Auth: authorized. Input: `{ currentPassword, newPassword ≥8, confirmPassword }` with equality refinement; the new password must differ from the current one. Bumps `users.token_version`, which kills every outstanding JWT (see `fetchUserFromJWT`), and returns `{ token }` — a fresh JWT so the caller's own session survives.
- **`deleteAccount`** (`procedures/user/deleteAccount.mts`) — Auth: authorized. Input: `{ currentPassword }`. **Soft delete**: hard-deleting is impossible because `created_by`-style FKs are `ON DELETE RESTRICT` (migration `027`). Refuses if the caller is the **sole owner of any space** (lists all blockers in one message). Otherwise tombstones the row — anonymizes email to `deleted+<id>@orbit.local` and name to "Deleted User", randomizes the password hash, sets `deleted_at`, bumps `token_version` (invalidating all JWTs), and deletes the caller's `space_members` rows. The `users.id` row survives so historical authorship FKs stay valid.

## Database tables
This module reads/writes only `users.avatar_file_id`; the file row itself is owned by the `file` module.

- **`users`** (`migrations/0001_create_users_table.mts`, modified by `029` and `040`). Relevant columns:
  - `id uuid PK`
  - `email varchar(255) UNIQUE`, `password_hash`, `first_name`, `last_name`, `created_at`
  - `avatar_file_id uuid REFERENCES files(id) ON DELETE SET NULL` — added in migration 029; the original `avatar_url` column was dropped in the same migration.
  - `deleted_at timestamptz NULL` and `token_version integer NOT NULL DEFAULT 1` — added in `040_user_soft_delete_and_token_version.mts` (partial index on `deleted_at IS NOT NULL`).

## Conventions & gotchas
- Two password paths exist: the in-app `user.changePassword` (requires the current password) and the public `auth.resetPassword.*` flow (requires email verification instead). Both end up rotating credentials; only `changePassword` bumps `token_version` and hands back a fresh JWT.
- `token_version` is the session-kill switch: `fetchUserFromJWT` (`trpc/auth.mts`) rejects any JWT whose claimed version doesn't match the row, and also rejects tombstoned users (`deleted_at` set). `changePassword` and `deleteAccount` both bump it.
- The avatar file must already have been uploaded and confirmed via `file.createUploadUrl` + `file.confirm` before `updateAvatar` accepts it. The confirm step also produces the `-sm` thumbnail variant (`procedures/file/confirm.mts:62`), so the avatar is only safely renderable after that.
- The procedure does **not** delete or unlink the previous avatar file; that file row stays in `files` (orphaned from `users.avatar_file_id`'s perspective). A cleanup sweep is the assumed garbage-collection mechanism.
- The DB FK uses `ON DELETE SET NULL` — deleting the `files` row will null out `avatar_file_id` automatically. Deleting the `users` row is never done — `deleteAccount` tombstones instead, because other tables' `created_by` FKs are `ON DELETE RESTRICT` (see `027_fk_on_delete_restrict_for_created_by.mts`).
- Avatar validation casts to `unknown as string` because the codegen-generated `purpose`/`status` types are `ArrayType<...>` unions (`db/kysely/types.mts:141`) — see the same pattern in `file/confirm.mts`. Don't try to "fix" those casts without regenerating types and confirming the pattern across the module.

## Cross-references
- `contexts/modules/server/file.md` — owns the `files` table, presigned upload URL, and the avatar `-sm` variant generation that `updateAvatar` depends on.
- `contexts/modules/server/auth.md` — owns `users` row creation (`completeSignup`), email lookup (`findUserByEmail`), and password reset.
- `apps/server/src/trpc/middlewares/authorized.mts` — the auth gate this module's only procedure runs behind.
