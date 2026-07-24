# auth module (server)

> Handles signup (request → verify → complete), login, password reset, and the authenticated user lookup helpers. All endpoints live under the tRPC `auth.*` namespace.

## Router
- File: `apps/server/src/routers/auth.mts:14`
- Composes procedures:
  - `auth.signup.initiate` — request OTP for a new email.
  - `auth.signup.resendCode` — re-send OTP for an in-flight signup.
  - `auth.signup.verify` — verify the OTP, upgrade token.
  - `auth.signup.complete` — set name + password, issue JWT.
  - `auth.login` — email/password → JWT.
  - `auth.resetPassword.initiate` — send password-reset OTP.
  - `auth.resetPassword.resendCode` — re-send password-reset OTP.
  - `auth.resetPassword.verify` — verify reset OTP, upgrade token.
  - `auth.resetPassword.complete` — set new password.
  - `auth.findUserByEmail` — lookup a user by email (authorized).
  - `auth.me` — return the logged-in user's profile row.

## Procedures
- **`initiateSignup`** (`procedures/auth/signup/initiate.mts:11`) — Auth: public. Input: `{ email }` (lower-cased). Output: `{ token, message }`. Rejects with `CONFLICT` if a real `users` row already exists; otherwise deletes any prior `tmp_users` row for that email (and its OTP codes), re-inserts, generates a 6-digit OTP via `generateOTP`, persists it in `email_verification_codes` with `purpose='signup'`, mails the code via `VerificationCodeEmail`, and returns a short-lived (`15 min`) JWT with `purpose='signup'`.
- **`resendSignupCode`** (`procedures/auth/signup/resendCode.mts:11`) — Auth: public, requires `purpose='signup'` tmp JWT. Input: `{ token }`. Enforces `CONFIG.AUTH.RESEND_COOLDOWN_SECONDS` cooldown against the most recent code's `created_at` (returns `TOO_MANY_REQUESTS`). Deletes prior signup codes, inserts a fresh one, re-mails. Does not re-issue the JWT.
- **`verifyCode`** (`procedures/auth/signup/verifyCode.mts:7`) — Auth: public, requires `purpose='signup'` tmp JWT. Input: `{ code (6 chars), token }`. Compares against the latest unexpired code for the tmp user, deletes it on success, sets `tmp_users.is_email_verified = true`, and returns a new tmp JWT with `purpose='signup-verified'` (`30 min` TTL).
- **`completeSignup`** (`procedures/auth/signup/complete.mts:11`) — Auth: public, requires `purpose='signup-verified'` tmp JWT. Input: `{ token, firstName, lastName, password, confirmPassword }` with `password === confirmPassword` refinement and 8-char minimum. Inserts a `users` row reusing the `tmp_users.id` (so the user inherits the tmp UUID), deletes the `tmp_users` row, returns a real auth JWT via `signJWT({ userId, tokenVersion: 1 })`.
- **`loginProcedure`** (`procedures/auth/login.mts:7`) — Auth: public. Input: `{ email, password }`. Validates via `bcrypt.compare` against `users.password_hash`; on success returns `{ token, user: { id, email, firstName, lastName, avatar_file_id } }`. Generic `BAD_REQUEST "Invalid email or password."` for both missing-user and wrong-password to avoid enumeration.
- **`initiatePasswordReset`** (`procedures/auth/resetPassword/initiate.mts:11`) — Auth: public. Input: `{ email }`. If the email doesn't exist, returns `{ token: null, message: ... }` with the generic "if an account exists" message (no enumeration). Otherwise deletes prior `password_reset` codes for the user, inserts a fresh OTP, sends the email, and issues a 15-minute tmp JWT with `purpose='password-reset'`.
- **`resendPasswordResetCode`** (`procedures/auth/resetPassword/resendCode.mts:11`) — Auth: public, requires `purpose='password-reset'` tmp JWT. Same cooldown logic as `resendSignupCode`. Reads the user's email inside the transaction, replaces the code, re-mails.
- **`verifyPasswordResetCode`** (`procedures/auth/resetPassword/verifyCode.mts:8`) — Auth: public, requires `purpose='password-reset'` tmp JWT. Input: `{ code, token }`. On match deletes the consumed code and returns a new tmp JWT with `purpose='password-reset-verified'` (`30 min` TTL).
- **`completePasswordReset`** (`procedures/auth/resetPassword/complete.mts:9`) — Auth: public, requires `purpose='password-reset-verified'` tmp JWT. Input: `{ password, confirmPassword, token }`. Hashes with `bcrypt` (`SALT_ROUNDS=12`) and updates `users.password_hash`. Does NOT issue an auth JWT — user must log in afresh.
- **`findUserByEmail`** (`procedures/auth/users/findByEmail.mts:4`) — Auth: authorized. Input: `{ email }`. Returns `{ id, email, first_name, last_name, avatar_file_id } | null`. Used by space invite flow.
- **`meProcedure`** (`procedures/auth/me.mts:5`) — Auth: authorized. Re-reads the `users` row keyed by `ctx.auth.user.id` and returns the profile. Throws `NOT_FOUND` if the row no longer exists.

## Database tables
- **`users`** (`migrations/0001_create_users_table.mts`). `id uuid PK (uuidv7())`, `email varchar(255) UNIQUE NOT NULL`, `password_hash varchar(255) NOT NULL`, `first_name`, `last_name`, `created_at`. `avatar_url` was dropped in `029_add_attachment_tables.mts` and replaced by `avatar_file_id uuid REFERENCES files(id) ON DELETE SET NULL`.
- **`tmp_users`** (`migrations/0002_create_tmp_users.mts`). `id uuid PK`, `email varchar(255) UNIQUE`, `is_email_verified boolean default false`, `created_at`. Holds an in-flight signup until `completeSignup` promotes the row to `users` (same UUID).
- **`email_verification_codes`** (`migrations/0003_create_email_verification_codes.mts`). `id`, `user_id uuid → users.id ON DELETE CASCADE`, `tmp_user_id uuid → tmp_users.id ON DELETE CASCADE`, `code varchar(6)`, `expires_at`, `created_at`, `purpose` enum `('signup','password_reset','change_email')`. Check constraint enforces exactly one of `user_id` / `tmp_user_id` is set, and `signup` requires `tmp_user_id` while `password_reset`/`change_email` require `user_id`. Indexed on both FKs.

## Conventions & gotchas
- The signup flow uses **tmp JWTs** (`signTmpJWT` in `procedures/auth/signup/helper.mts:10`) keyed by `purpose`: `signup` → `signup-verified`. Each step strictly checks `tmpUser.purpose` before proceeding — passing a `signup` token to `completeSignup` returns `UNAUTHORIZED`. Real auth tokens are issued by `loginProcedure`, `completeSignup`, and `user.changePassword` via `signJWT({ userId, tokenVersion })` (`trpc/auth.mts`). Reset flow uses `password-reset` → `password-reset-verified` but `completePasswordReset` does NOT issue an auth token.
- OTPs are 6 digits via `crypto.randomInt` zero-padded (`procedures/auth/utils/generateOTP.mts`). Expiry is `CONFIG.AUTH.OTP_EXPIRY_MINUTES = 10` (`config/config.mts`); resend cooldown is `60s`. Codes are looked up by `expires_at > NOW()` and `created_at DESC` — only the latest code is valid.
- Passwords are hashed with `bcrypt` and `SALT_ROUNDS = 12` (`config/config.mts:3`). Min length is 8 chars; `complete*` procedures enforce `password === confirmPassword` via `.refine`.
- `completeSignup` reuses the `tmp_users.id` as the new `users.id` (`procedures/auth/signup/complete.mts:55`) — any FK that points to the tmp row would survive promotion, but at present nothing else references `tmp_users`. The tmp row is deleted in the same transaction.
- `fetchUserFromJWT` (`trpc/auth.mts`) DOES hit the DB on every request: it re-selects the user and rejects the token if the row is missing, tombstoned (`deleted_at` set), or the JWT's `tokenVersion` claim doesn't match `users.token_version` (migration `040`; pre-040 tokens default to version 1). Auth JWTs are signed via `signJWT({ userId, tokenVersion })` with **no expiry** — sessions last until `token_version` is bumped (password change, account deletion) or the client discards the token.
- `initiatePasswordReset` and `meProcedure` differ on the missing-user case: reset returns a benign success-looking response; `me` throws `NOT_FOUND`. Don't try to "harden" reset without checking the enumeration trade-off first.

## Cross-references
- `apps/server/src/trpc/auth.mts` — `signJWT` / `authorizeJWT` for the real auth token; tmp JWT helpers live in `procedures/auth/signup/helper.mts`.
- `apps/server/src/trpc/middlewares/authorized.mts` — gate used by `me` and `findUserByEmail`.
- `apps/server/src/services/mail/templates/VerificationCodeEmail.tsx` — the OTP email used by both signup and password reset.
- `contexts/modules/server/user.md` — covers `users.avatar_file_id` mutation; profile edits beyond avatar are not yet implemented.
