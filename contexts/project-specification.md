# Orbit — Product & Technical Specification

> This document is the source of truth for Orbit's current behavior. It is
> meant to be loaded by Claude (or any reviewer) before making code changes
> or running reviews. If a fact in this spec contradicts the code, **the
> code wins** — but flag the drift so the spec gets updated.

**Last rewritten:** 2026-06-23, after the budgeting simplification
(migrations 046–048) landed on top of 030–040. The earlier additions
of envelope borrowing across months (032), a three-value carry policy
(035), per-user reckoning acknowledgments (036), and per-space budget
mode (`flexible | strict`, 037) were all **subsequently removed** by
migration 048 — see below. The features that remain from that batch:
transfer fees (030), category priority tiers (031), envelope archival
(033), generic idempotency-key cache (034), event lifecycle +
estimated amounts (038), token-credentialed space invites (039), and
soft-delete + JWT token-version invalidation on `users` (040).

Two later changes reshaped budgeting:
- **Goals folded into envelopes; plans removed** (migrations 046/047).
  The separate `plans` / `plan_allocations` tables, the `plan` router,
  and the web Plans pages are gone. A "goal" is now just a
  `cadence='none'` envelope with optional `target_amount` / `target_date`
  columns, gated by a CHECK that targets only ride on rolling envelopes.
- **Budgeting simplified** (migration 048). The allocation ledger
  collapses to exactly one absolute row per (envelope, period);
  per-account allocation, carry-over, borrowing-from-next-month, strict
  budget mode, and the reckoning system are all dropped. Overspend is
  now **shown** in analytics, never blocked or nagged; the primary
  remedy is a transfer between envelopes.

Two structural changes from the 041–045 batch that the earlier rewrite
under-documented:
- **The envelope rides on the transaction, not the category**
  (migrations 041/050). `transactions.envelop_id` is the source of
  truth for which envelope an expense belongs to, frozen at insert
  time. Categories are pure labels — the transitional
  `default_envelop_id` prefill hint was dropped in migration 050;
  reorganizing categories never rewrites spending history.
- **Transfer fees are their own expense rows** (migration 042). The
  inline `fee_amount` / `fee_expense_category_id` columns are gone; a
  fee is a paired `type='expense'` transaction with
  `parent_transfer_id` pointing at the transfer. See §11.6.

Also from that batch: transaction-entry **pins** (migrations 043/044,
§11.8) and the allocation `period_start` tz-drift repair (049).

Also: full self-service account surface (`profile`, `security` pages
with change-email / change-password / delete-account), the public
invite-acceptance route at `/invite/:token`, the year-report page, and
three analytics views (`trends`, `anomalies`, `priority`). Orbit is
deployed to production at [orbit.withtahmid.com](https://orbit.withtahmid.com).

**Last synced:** 2026-07-24. Since the previous sync: the Overview page
was rebuilt as an editorial, eyebrow-sectioned dashboard (§13.5); the
event detail page became a full dashboard (hero, stat tiles, spend
timeline, category donut, top locations — backed by new
`analytics.eventDailySpend` / `eventTopLocations`); the Spending
calendar (heatmap) view was rebuilt around data-derived quantile
buckets and a `mode: 'cash' | 'operational'` toggle;
`analytics.categoryMonthlyTrend` + `envelopeMonthlyAllocations` were
added; the `allocations` analytics view and `analytics.allocations` /
`unbudgetedTrend` procedures were removed; and a family of APP_TZ date
bugs was fixed (allocation-row matching now casts
`::timestamptz::date`, the transaction date picker uses APP_TZ-aware
getters — §14.2).

---

## 1. Product overview

Orbit is a collaborative personal-finance app for small groups (families,
couples, roommates, shared projects). It combines three orthogonal models
into a single coherent ledger:

- **Ledger accounting** — accounts hold real money, transactions move it.
- **Envelope budgeting** — named buckets (Groceries, Rent…) hold a
  logical allocation of that money; every expense is stamped with an
  envelope at entry time (`transactions.envelop_id`). Categories are
  independent labels for *what* the money bought; the envelope says
  *which budget* it came from.
- **Goal-based saving** — a rolling (`cadence='none'`) envelope can carry
  an optional `target_amount` / `target_date`, turning it into a goal
  bucket for long-horizon targets (House down-payment, Vacation). Goals
  are not a separate entity — they're an envelope feature.

Collaboration happens inside a **Space**. A space has members with roles
(owner / editor / viewer) and its own set of envelopes, categories,
and transactions. **Accounts are a horizontal resource** — they exist
globally and can be shared into multiple spaces.

Design priorities, in order: **correctness → clarity → performance**. Many
numbers are computed on-read rather than stored, so transaction/allocation
edits propagate without manual reconciliation.

---

## 2. Monorepo & stack

Turborepo + pnpm workspace. Two apps:

- [`apps/server`](../apps/server) — Node.js + Express + **tRPC v11**
  backend. ESM-only (`.mts` source → `.mjs` via `tsc`). Postgres 18 via
  `pg.Pool` + **Kysely** query builder. Types auto-generated by
  `kysely-codegen` into [`apps/server/src/db/kysely/types.mts`](../apps/server/src/db/kysely/types.mts).
  Migrations in [`apps/server/src/db/kysely/migrations/`](../apps/server/src/db/kysely/migrations/)
  applied manually via `pnpm --filter backend migrate`. Also: **Cloudflare
  R2** for object storage (avatars, attachments, exported reports) via
  `@aws-sdk/client-s3` with presigned URLs; **`sharp`** for avatar resize;
  **React 19 server-side JSX** rendering for transactional email templates
  through `ReactDOMServer.renderToStaticMarkup`.

- [`apps/web`](../apps/web) — Vite + React 19 + React Router v7 +
  TanStack Query + `@trpc/react-query`. MobX for global auth state. Tailwind
  v4 with a custom premium emerald/teal dark theme in
  [`apps/web/src/index.css`](../apps/web/src/index.css). Path alias
  `@/*` → `apps/web/src/*`. End-to-end types come from a cross-app import
  in [`apps/web/src/trpc.ts`](../apps/web/src/trpc.ts) — server types flow
  directly to the client.

Packages under `packages/` (`eslint-config`, `typescript-config`, `ui`) are
lightweight stubs; product code lives in `apps/`.

Runs under `docker-compose` (Postgres, MailDev on 1025/1080, Metabase on
3001, the `orbit` service running `pnpm dev`). In production, it runs as
a single container behind a reverse proxy at
[orbit.withtahmid.com](https://orbit.withtahmid.com); mail goes through
the configured SMTP provider; files go to a Cloudflare R2 bucket.

### Build/dev loop (server)

`tsc --watch` emits to `dist/`, nodemon restarts on change. Source is
`.mts`; output is `.mjs`. **Imports between source files use the `.mjs`
extension** even though the file is `.mts` — TypeScript resolves, the ESM
runtime needs `.mjs`. Don't change this.

### Dev commands

```bash
pnpm dev                          # turbo: server + web
pnpm check-types                  # type-check both apps
pnpm format                       # prettier

# server only
pnpm --filter backend migrate
pnpm --filter backend generate-types

# web only (from apps/web/)
pnpm dev                          # vite on :5173
```

---

## 3. Domain model

This is the canonical list. Kysely types regenerate from the DB, so
always trust migrations + `generate-types` over ad-hoc type edits.

### 3.1 Users, auth, spaces

- **`users`** — `id`, `email (unique)`, `password_hash`, `first_name`,
  `last_name`, `avatar_file_id` (nullable FK → `files.id`, SET NULL),
  `created_at`, plus (migration 040) `deleted_at timestamptz NULL` and
  `token_version integer NOT NULL DEFAULT 1`. Avatar moved from
  `avatar_url` to a `files`-backed reference in migration 029; clients
  resolve a display URL via `file.getDownloadUrl`. **Hard delete is
  impossible** for any user who has ever created shared data
  (`spaces.created_by`, `transactions.created_by`, allocation
  `created_by` all have `ON DELETE RESTRICT` per migration 027), so
  `user.deleteAccount` tombstones the row instead: anonymizes
  identifying fields (`deleted+<id>@orbit.local`, "Deleted User", null
  avatar, password `"!"`), sets `deleted_at`, bumps `token_version`,
  and drops every `space_members` row. `fetchUserFromJWT` rejects any
  session for a row with `deleted_at IS NOT NULL`. `token_version` is
  also bumped by `user.changePassword` so stolen JWTs stop working
  immediately after a password change. JWTs minted before migration 040
  have no `tokenVersion` claim; the auth layer treats a missing claim
  as `1`, matching the default, so no force-logout was needed.
- **`tmp_users`** — pre-verification signup shell. `is_email_verified` flag.
- **`email_verification_codes`** — 6-digit codes for signup / password-reset /
  change-email.
- **`spaces`** — `id`, `name`, timestamps, `created_by`, `updated_by`.
  (Migration 037 once added a `budget_mode` column for strict-mode
  budgeting; migration 048 dropped it — overspend is shown, never
  blocked.)
- **`space_members`** — composite PK `(space_id, user_id)` + `role` (owner /
  editor / viewer). Cascade delete on both sides.
- **`space_invites`** (migration 039) — `id`, `space_id` (FK CASCADE),
  `email varchar(255)`, `role` (enum), `token varchar(64) UNIQUE`,
  `invited_by` (FK CASCADE), `expires_at`, `accepted_at`,
  `accepted_by_user_id` (FK SET NULL), `revoked_at`, `created_at`.
  Partial-unique index `(space_id, lower(email))` over still-pending
  rows so re-inviting an address rotates the existing token rather than
  stacking. See §6.6.

### 3.2 Accounts (horizontal resource)

- **`accounts`** — `id`, `name`, `account_type` ∈ `'asset' | 'liability' |
  'locked'`, `color` (hex, default `#10b981`), `icon` (lucide name, default
  `'wallet'`), `updated_at`. **No `space_id`** — accounts exist globally
  and are shared into spaces via `space_accounts`.
- **`space_accounts`** — composite PK `(account_id, space_id)`. Shared-at
  `created_at`. **Many-to-many** between accounts and spaces.
- **`user_accounts`** — composite PK `(account_id, user_id)`, `role` ∈
  `'owner' | 'viewer'`. Who can see and edit the account itself
  (independent of space membership).
- **`account_balances`** — one row per account. `balance numeric(20,2)`,
  maintained by a DB trigger on `transactions` (INSERT/UPDATE/DELETE).
  Source of truth for the cash balance.

### 3.3 Envelopes (periodic budgets + goals)

- **`envelops`** — `id`, `space_id`, `name`, `color`, `icon`, `description`,
  `cadence` ∈ `'none' | 'monthly'` (CHECK-constrained), `target_amount
  numeric(20,2) NULL` and `target_date date NULL` (migration 046 — the
  optional goal target), `archived boolean NOT NULL DEFAULT false`
  (migration 033), timestamps. Space-scoped. Partial index
  `idx_envelops_active (space_id) WHERE archived = false` keeps the hot
  list-query path fast. CHECK `envelops_target_only_on_rolling_check`
  (migration 047): a target may be set only when `cadence = 'none'` —
  i.e. only a rolling envelope can be a goal. (Migration 048 dropped the
  old `carry_over` boolean and `carry_policy` enum entirely — monthly
  envelopes **reset** each period, there is no carry-over.)
- **`envelop_allocations`** — **exactly one row per (envelope, period)**.
  `amount numeric(20,2)` is the **absolute allocated total** for that
  period (not a signed delta). `period_start date` is NULL for
  rolling/goal envelopes (`cadence='none'` → one lifetime row) and the
  APP_TZ (Asia/Dhaka) month-start for monthly envelopes (one row per
  calendar month). Unique index `envelop_allocations_envelop_period_uq
  (envelop_id, period_start) NULLS NOT DISTINCT` enforces the one-row
  rule (the NULL period of a rolling envelope is also unique). Allocate /
  deallocate is an accumulating UPSERT under a row lock; transfer is two
  upserts. Migration 048 dropped the previous `account_id`, `kind`,
  `effective_at`, and `borrowed_link_id` columns — **allocations are now
  space-wide**, with no per-account earmarking and no timestamped history.

**No `envelop_balances` table.** Retired in migration `026`. All envelope
metrics are computed on-read (see §5).

**Priority tiers live on categories, not envelopes** — see §3.5. A single
envelope can legitimately span tiers (most groceries are essential, a
premium leaf category might be luxury), so tagging at the category level
with inheritance from ancestors gives the right granularity.

### 3.4 Plans (removed)

The separate `plans` and `plan_allocations` tables were **dropped in
migration 046**. Goal-based saving is now an envelope feature: a
`cadence='none'` envelope with optional `target_amount` / `target_date`
(see §3.3). There is no `plan` router, no `plan_balances`, and no Plans
pages in the web app.

### 3.5 Categories

- **`expense_categories`** — `id`, `space_id`, `parent_id` (self-FK,
  nullable, RESTRICT on delete), `name`, `color`, `icon`,
  `priority text NULL` ∈ `'essential' | 'important' |
  'discretionary' | 'luxury'` (CHECK-constrained; migration 031),
  timestamps.

**Categories are pure labels — no envelope column.** Migration 041
moved the envelope onto the transaction (`transactions.envelop_id`,
frozen at insert time) and demoted the category's `envelop_id` to a
`default_envelop_id` entry-form prefill hint; migration 050 dropped
that hint entirely (pins — §11.8 — and per-form defaults prefill
better). Reorganizing the category tree therefore never rewrites
spending history.

**Priority inheritance.** A category with `priority = NULL` inherits
from the nearest ancestor that has a non-NULL value. A root with NULL
priority bubbles up as "unclassified" in analytics. This lets you tag
"Groceries" as essential once and only override the specific leaves
that differ (e.g. a `Premium Imports > Imported Cheese` leaf tagged
luxury even though its ancestor is essential). `priorityBreakdown`
(§12) resolves the effective tier via a recursive CTE walking
`parent_id`.

There is no `changeEnvelop` procedure anymore (nothing to change —
categories don't carry envelopes). The surviving surface is `create`,
`update`, `delete`, `changeParent`, `listBySpace`, and
`listBySpaceWithUsage` (list annotated with transaction usage counts
for the Categories page).

### 3.6 Transactions

- **`transactions`** — `id`, `space_id`, `created_by`, `type` ∈ `'income' |
  'expense' | 'transfer' | 'adjustment'`, `amount > 0`, `source_account_id`,
  `destination_account_id`, `description`, `location`, `expense_category_id`,
  `envelop_id` (migration 041 — REQUIRED for expenses, RESTRICT; the
  envelope the money came from, frozen at insert time), `event_id`,
  `transaction_datetime` (when it happened), `created_at` (when it was
  recorded), and `parent_transfer_id` (migration 042, CASCADE — set on
  the fee expense row that a transfer spawned; see §11.6).

CHECK constraints (enforced in the DB):

| type | source | destination | category | envelope |
| --- | --- | --- | --- | --- |
| income | NULL | set | ignored | — |
| expense | set | NULL | REQUIRED | REQUIRED (`transactions_envelop_check`) |
| transfer | set | set, ≠ source | ignored | — |
| adjustment | exactly one of source/destination | | ignored | — |

There are no inline fee columns — a transfer's fee is its own
`type='expense'` row linked back via `parent_transfer_id` (§11.6).

### 3.7 Events (grouping)

- **`events`** — `id`, `space_id`, `name`, `start_time`, `end_time`
  (CHECK `end_time > start_time`), `color`, `icon`, `description`,
  `created_at`, plus (migration 038) `status text NOT NULL DEFAULT
  'active'` CHECK in `('active', 'closed')`, `estimated_amount
  numeric(14, 2) NULL` CHECK `IS NULL OR >= 0`, `closed_at timestamptz
  NULL`. Closed events drop out of the transaction-entry picker but
  remain in analytics, lists, and historical filters. Partial index
  `idx_events_space_status_active (space_id, start_time DESC) WHERE
  status = 'active'` for the picker hot path. Transactions can
  reference an event via `transactions.event_id` (ON DELETE SET NULL).

### 3.8 Files & attachments (object storage)

Added in migrations `028` and `029`. Everything upload-related is
backed by **Cloudflare R2** via S3-compatible presigned URLs.

- **`files`** — `id`, `r2_key (text, unique)`, `mime_type`, `size_bytes`,
  `original_name`, `purpose` ∈
  `'avatar' | 'transaction_receipt' | 'event_attachment' | 'exported_report'`,
  `status` ∈ `'pending' | 'confirmed'` (default `pending`),
  `uploaded_by` (FK → users, ON DELETE SET NULL), `created_at`,
  `confirmed_at` (set by `file.confirm`). Enums live under
  `__type_file_purpose` and `__type_file_status`. Indexed on `uploaded_by`.
- **`transaction_attachments`** — composite PK `(transaction_id, file_id)`,
  `created_at`. Cascade delete from either side.
- **`event_attachments`** — composite PK `(event_id, file_id)`,
  `created_at`. Cascade delete from either side.
- **`exported_reports`** — `id`, `file_id` (cascade), `user_id` (cascade),
  `kind varchar(64)`, `params_json jsonb`, `generated_at`. Records a
  generated report tied to its R2-backed file.

Per-purpose upload limits and allowed MIME types live in
[`procedures/file/shared.mts`](../apps/server/src/procedures/file/shared.mts):

| purpose | max size | allowed MIME |
| --- | --- | --- |
| `avatar` | 5 MB | `image/*` (re-encoded to webp) |
| `transaction_receipt` | 10 MB | `image/*` |
| `event_attachment` | 10 MB | `image/*` |
| `exported_report` | 50 MB | `application/pdf` |

### 3.9 Reckoning acknowledgments (removed)

The `reckoning_acknowledgments` table (migration 036) was **dropped in
migration 048** along with the rest of the reckoning system. Past-month
overspend is no longer something a user must resolve or acknowledge —
overspend is simply shown in analytics.

### 3.10 Idempotency keys

- **`idempotency_keys`** (migration 034) — `key uuid PRIMARY KEY`,
  `user_id` (FK CASCADE), `operation text`, `response jsonb`,
  `created_at`, `expires_at` (default `NOW() + INTERVAL '7 days'`).
  Generic operation-level idempotency cache. Compound write paths
  (e.g. transfer) opt in via the `withIdempotency` helper instead of
  carrying per-table idempotency columns. PK on `key` makes
  claim-or-fail atomic; a second concurrent request with the same key
  either reads the cached response or fails with CONFLICT if the first
  is still in flight. Indexed on `expires_at` for a periodic cleanup
  job.

---

## 4. Migrations overview

Migrations are append-only; each has an `up` and `down`. Apply with
`pnpm --filter backend migrate`.

| # | Purpose |
| --- | --- |
| 0001 | users |
| 0002 | tmp_users |
| 0003 | email_verification_codes |
| 0004 | spaces |
| 0005 | space_members |
| 0006 | accounts (type enum) |
| 0007 | space_accounts |
| 0008 | user_accounts |
| 0009 | account_balances |
| 0010 | envelops |
| 0011 | events |
| 0012 | expense_categories |
| 0013 | transactions (with check constraints) |
| 0014 | envelop_allocations |
| 0015 | envelop_balances *(retired by 026)* |
| 0016 | plans |
| 0017 | plan_allocations |
| 018 | `__trigger_sync_account_balance_from_transactions` — maintains `account_balances` |
| 019 | envelope balance triggers *(retired by 026)* |
| 020 | indexes |
| 021 | plan_balances + trigger *(retired by 026)* |
| 022 | `color`, `icon` on envelopes/plans/accounts/categories/events + descriptions; back-fills deterministic distinct colors by `hashtext(id)` |
| 023 | plan `description`, `target_amount`, `target_date` |
| 024 | envelope `cadence` check-constrained, `carry_over` |
| 025 | allocation `account_id` + envelope allocation `period_start` + indexes |
| 026 | **retires** `envelop_balances` and `plan_balances` + all their triggers in favor of on-read computation. `down()` restores them lossless. |
| 027 | tightens `ON DELETE` to `RESTRICT` on `created_by` / `updated_by` FKs across ledger tables so users who created transactions/spaces/allocations can't be silently deleted. |
| 028 | `files` table + `__type_file_purpose` / `__type_file_status` enums + `files_uploaded_by_idx`. Foundation for R2-backed object storage. |
| 029 | swaps `users.avatar_url` for `users.avatar_file_id` (FK → `files`, SET NULL); adds `transaction_attachments`, `event_attachments`, `exported_reports`. |
| 030 | transfer fees: `transactions.fee_amount` + `fee_expense_category_id`, CHECK gating to `type='transfer'`, balance-sync trigger updated so a fee debits source by `amount + fee_amount`. **Replaced by 042** (fees became their own expense rows). See §11.6. |
| 031 | `expense_categories.priority` CHECK in `('essential','important','discretionary','luxury')`. NULL inherits from the nearest non-NULL ancestor via recursive CTE in `priorityBreakdown`. |
| 032 | `envelop_allocations.borrowed_link_id uuid` — groups the two rows of a "borrow from next month" pair (+amount in current period, −amount in next period of the same envelope). Partial index on non-NULL values. **Reversed by 048** (borrowing removed). |
| 033 | `envelops.archived boolean DEFAULT false` + partial index `idx_envelops_active`. Soft-retire envelopes — they disappear from default lists / can't accept new categories / transactions, but historical data stays intact for past-period analytics. |
| 034 | `idempotency_keys` table — generic operation-level idempotency cache (see §3.10). |
| 035 | `envelops.carry_policy` replaces the boolean `carry_over` with a three-value enum `('reset', 'positive_only', 'both')`. **Reversed by 048** — both columns dropped, carry-over removed (monthly envelopes reset). |
| 036 | `reckoning_acknowledgments` table — per-user past-month overspend acknowledgments. **Reversed by 048** (reckoning system removed). |
| 037 | `spaces.budget_mode` CHECK in `('flexible', 'strict')`. **Reversed by 048** — strict mode removed; overspend is shown, never blocked. |
| 038 | `events.status` (`active`/`closed`), `estimated_amount`, `closed_at`. Closed events drop out of the picker but stay in history. Partial index over active events. |
| 039 | `space_invites` table — token-credentialed invitations with rotating partial-unique index on pending rows. See §6.6. |
| 040 | `users.deleted_at` + `users.token_version`. Soft-delete tombstone + per-user JWT-invalidation. See §3.1 + §6.7. |
| 041 | **Decouples envelope from category.** Adds `transactions.envelop_id` (RESTRICT) + CHECK `transactions_envelop_check` (expenses must carry an envelope), backfills from the category's envelope, renames `expense_categories.envelop_id` → `default_envelop_id` (a prefill hint, later dropped by 050). See §3.5, §3.6. |
| 042 | **Fees as expense transactions.** Adds `transactions.parent_transfer_id` (CASCADE), backfills every fee-bearing transfer into a paired `type='expense'` row, drops `fee_amount` / `fee_expense_category_id`, and swaps the balance trigger for a fee-blind version. See §11.6. |
| 043 | `transaction_entry_pins` — per-entity pinned defaults for the transaction entry form (Account pins per-user-per-space; Envelope/Event pins space-wide). See §11.8. |
| 044 | pin `set_by` FK → SET NULL so deleting a user doesn't strand space pins. |
| 045 | `envelop_allocations.kind` + `effective_at` — typed-ledger experiment. **Reversed by 048** (both columns dropped). |
| 046 | **Drops `plans` + `plan_allocations`** (goals fold into envelopes) and **adds `envelops.target_amount` + `envelops.target_date`**. `down` intentionally throws — the plans subtree isn't reconstituted. See §3.3, §3.4. |
| 047 | CHECK `envelops_target_only_on_rolling_check` — a target may be set only when `cadence = 'none'`. Makes a stale target on a monthly envelope unrepresentable. |
| 048 | **Simplify budgeting.** Collapses `envelop_allocations` to one absolute row per (envelope, period) — unique `(envelop_id, period_start) NULLS NOT DISTINCT`; drops `account_id` / `kind` / `effective_at` / `borrowed_link_id` (allocations now space-wide, no history); drops `envelops.carry_over` + `carry_policy` (no carry-over); drops `spaces.budget_mode` (no strict mode); drops `reckoning_acknowledgments`. Reverses 032/035/036/037. `down` is structural only — lost data is not recoverable. |
| 049 | **Repairs tz-drifted `period_start` rows.** Rows written while a pooled session ran in GMT landed on the previous month's last day; this folds/shifts them back onto the month's 1st. Data-only, idempotent, `down` is a no-op. The going-forward fix is in `db/index.mts` (session tz via libpq startup `options` — Neon's pooler drops a post-connect `SET TIME ZONE`). |
| 050 | **Drops `expense_categories.default_envelop_id`.** Categories become pure labels; envelope prefill now comes from pins / per-form defaults. Completes what 041 started. |

**Account balance** is still maintained by the trigger from migration
018 (rewritten fee-blind in 042 — fee rows debit through the ordinary
expense path). Envelope balances are computed on-read only.

---

## 5. Computed balances (on-read)

### 5.1 Envelope period balance

[`resolveEnvelopePeriodBalance`](../apps/server/src/procedures/envelop/utils/resolveEnvelopePeriodBalance.mts)
computes `{allocated, consumed, remaining}` for an envelope within a
period. Given the envelope's cadence:

- `cadence = 'none'` → single lifetime window `[epoch, +∞)`; the one
  allocation row has `period_start IS NULL`.
- `cadence = 'monthly'` → window is the current calendar month in APP_TZ
  (`DATE_TRUNC('month', NOW())`, Asia/Dhaka); the period's one allocation
  row has `period_start` = that month-start.

`allocated` is read directly from the **single** allocation row for the
period (one row per envelope per period — see §3.3), so it's the absolute
allocated total, not a sum of deltas. `consumed` is the sum of
`transactions` with `type = 'expense'` whose `envelop_id` is this
envelope and whose `transaction_datetime` falls in the window. Transfer
fees need no special handling — a fee is its own expense row stamped
with its own envelope (§11.6). `remaining = allocated − consumed`.

The monthly allocation-row match casts `::timestamptz::date` (not a
bare `::date`): pg serializes a JS `Date` param as text, and text→date
truncates with **no** tz conversion, so an APP_TZ month-start instant
would land on the previous month's last day and silently read
`allocated = 0`. Going via `timestamptz` honors the session zone.

There is **no carry-over and no `carriedIn`**: monthly envelopes reset
each period; rolling envelopes are a single open window. When `consumed >
allocated`, `remaining` goes negative — this overspend is shown in the
UI and analytics, never blocked. The remedy is a transfer of allocation
from another envelope (§7 / §8).

### 5.2 Space-level unallocated cash

[`resolveSpaceUnallocated`](../apps/server/src/procedures/allocation/utils/resolveSpaceUnallocated.mts)
returns a **signed** value: negative means the space is over-allocated.

```
spendable   = SUM(asset.balance) − SUM(liability.balance)   [locked excluded]
held        = Σ GREATEST(0, allocated − consumed)  over current-period envelopes
unallocated = spendable − held
```

**Locked accounts are excluded from the spendable pool** because money
there (FDs, DPS) can't be drawn on. They still count toward net worth.

The per-envelope held is clamped to ≥ 0 (`GREATEST(0, allocated −
consumed)`) so that overspending in one envelope doesn't inflate another
envelope's available pool.

### 5.3 Space summary

[`analytics.spaceSummary`](../apps/server/src/procedures/analytics/spaceSummary.mts)
returns `totalBalance` (net worth, all account types),
`spendableBalance` (assets − liabilities, no locked), `lockedBalance`,
envelope aggregates, period income/expense/net, and
`unallocated` (signed) + `isOverAllocated` flag.

---

## 6. Space membership, accounts, and sharing

### 6.1 Space roles

- **owner** — full control including space delete, member add/remove,
  role change. Can do everything the other roles can.
- **editor** — create/edit transactions, allocate, unallocate, transfer,
  create events. Cannot delete the space, cannot change members, cannot
  create envelopes/categories (those are owner-only).
- **viewer** — read-only. Cannot mutate anything.

Checked via
[`resolveSpaceMembership`](../apps/server/src/procedures/space/utils/resolveSpaceMembership.mts)
in every procedure that touches space data.

### 6.2 Account ownership (independent of space)

`user_accounts` controls who can see/edit the account itself. Roles are
`owner` and `viewer`. Resolved via
[`resolveAccountPermission`](../apps/server/src/procedures/account/utils/resolveAccountPermission.mts).

Account creation inserts exactly one `user_accounts` row (creator as
owner) and one `space_accounts` row (current space).

**Account member management** (added post-MVP) is a first-class feature
— not a side effect of space membership:

| Procedure | Who can call | What it does |
| --- | --- | --- |
| [`account.addMember`](../apps/server/src/procedures/account/addMember.mts) | account-owner | inserts/upserts rows in `user_accounts` for a list of user ids + role |
| [`account.removeMember`](../apps/server/src/procedures/account/removeMember.mts) | account-owner | deletes `user_accounts` rows; refuses to leave the account without at least one owner |
| [`account.listUsers`](../apps/server/src/procedures/account/listUsers.mts) | any account member | returns members with name, email, avatar file id, role |

These are exposed in the **Members tab** of the account detail page,
which sits alongside Allocations / Transactions / Shared-with / Settings
on `/s/:spaceId/accounts/:accountId`.

### 6.3 Cross-space account sharing

An account can live in many spaces via multiple `space_accounts` rows.

| Procedure | Who can call | What it does |
| --- | --- | --- |
| [`account.shareWithSpace`](../apps/server/src/procedures/account/shareWithSpace.mts) | account-owner AND target-space editor+ | adds a `space_accounts` row |
| [`account.unshareFromSpace`](../apps/server/src/procedures/account/unshareFromSpace.mts) | account-owner OR target-space owner | deletes the row, with guards |
| [`account.listSpaces`](../apps/server/src/procedures/account/listSpaces.mts) | account-owner or viewer | spaces this account is in + caller's role in each |
| [`account.listShareableForSpace`](../apps/server/src/procedures/account/listShareableForSpace.mts) | target-space editor+ | accounts caller owns that aren't in this space |
| [`account.listByUser`](../apps/server/src/procedures/account/listByUser.mts) | any | every account the caller can access, across every space, with spaces list |

**Unshare guards** (enforced in the procedure):
- must leave the account in ≥ 1 space (delete the account entirely if
  you want to remove it from everywhere);
- refuses if the space still has transactions tagged to the account —
  user must remove those first. (Envelope allocations are now space-wide
  and no longer carry an `account_id`, so they don't guard unshare; see
  §3.3 / §7.)

### 6.4 UI surface

- **Space account list** (`/s/:spaceId/accounts`) — buttons to
  create new OR add existing.
  [`AddExistingAccountDialog`](../apps/web/src/features/accounts/AddExistingAccountDialog.tsx).
- **Account detail `Shared with` tab** — list of spaces with role/shared-since,
  "Unshare" per space, "Share to another space" dialog.
- **Global `/accounts`** (top-level, outside any space) —
  [`MyAccountsPage`](../apps/web/src/pages/app/MyAccountsPage.tsx).
  Grouped by asset/liability/locked. Each card shows space chips that link
  into each space's detail view. Reachable from the user-avatar dropdown
  in both [`AppShellLayout`](../apps/web/src/layouts/AppShellLayout.tsx)
  and [`SpaceLayout`](../apps/web/src/layouts/SpaceLayout.tsx).

### 6.5 "My money" — the virtual personal space

Orbit treats the user's personal financial picture as a **virtual
space**, not a standalone page. It lives at `/s/me` (the literal
string `"me"` is a sentinel spaceId — not a valid UUID, so there's no
collision with real spaces), flows through the same `/s/:spaceId`
routing tree as real spaces, and reuses the same `SpaceLayout` shell,
sidebar, overview, transactions page, analytics views, and account
list. Every place a real space appears — space switcher, space
selector page — the virtual one shows up alongside, usually first.

This reframing was deliberate: any user who's in 3-4 spaces (Roommates,
Office, Family, …) would otherwise have no unified picture of their own
money. Giving them a synthesized "space of spaces" means zero new UI
paradigm — just a new anchor for the queries.

**Anchor**: accounts the caller owns
(`user_accounts.role = 'owner'`). The virtual space contains transactions
from every space the caller is currently a member of that touch one
of those accounts. Categories and envelopes from those real spaces fold
in too, restricted to the caller's owned-account partition.

**Personal cash-flow semantics** (same rules as the per-space analytics,
adapted to a multi-space union):

| Transaction | Counts as |
|---|---|
| `income` → owned account | personal inflow |
| `expense` from owned account | personal outflow |
| `transfer` owned → non-owned (e.g. funding a household pot) | personal outflow |
| `transfer` non-owned → owned | personal inflow |
| `transfer` owned → owned (internal rebalance) | **excluded** — net zero |
| `adjustment` on an owned account | personal inflow or outflow per direction |

**UI dispatch**: the virtual space is detected via
[`isPersonalSpaceId(spaceId)`](../apps/web/src/lib/personalSpace.ts)
inside
[`CurrentSpaceProvider`](../apps/web/src/providers/CurrentSpaceProvider.tsx),
which synthesizes a `CurrentSpace` with `id: "me"`, `name: "My money"`,
`myRole: "viewer"` (forces read-only through existing `PermissionGate`
checks), and `isPersonal: true`. Downstream pages — overview, accounts,
transactions, and every analytics view — check `space.isPersonal` and
dispatch to the `personal.*` trpc procedures instead of their
`analytics.*` / `transaction.*` / `account.*` counterparts. The paired-
query pattern uses react-query's `enabled` flag so only one variant
fires per render.

**Nav items hidden in the virtual space**: Envelopes, Categories,
Events, Settings.
[`SpaceLayout`](../apps/web/src/layouts/SpaceLayout.tsx) filters its
sidebar to Overview / Accounts / Transactions / Analytics only, because
those are mutation-oriented entities (`/s/me/envelopes/new` wouldn't
know which real space to create in). Their *analytics* — envelope
utilization, category breakdown — still fold in via the analytics views.

**Server procedures**: under
[`apps/server/src/procedures/personal/`](../apps/server/src/procedures/personal/),
composed by [`routers/personal.mts`](../apps/server/src/routers/personal.mts).
Every analytics procedure has a personal counterpart:

| analytics.* | personal.* |
|---|---|
| `spaceSummary` | `summary` (full shape — balances, envelope aggregates, unallocated, period income/expense) |
| `cashFlow` | `cashFlow` |
| `topCategories` | `topCategories` (each row tagged `space_id`/`space_name`) |
| `categoryBreakdown` | `categoryBreakdown` (flat rows across spaces, tagged with space) |
| `envelopeUtilization` | `envelopeUtilization` ("my slice" — owned-account expenses, tagged with space) |
| `balanceHistory` | `balanceHistory` |
| `spendingHeatmap` | `spendingHeatmap` (same `cash`/`operational` mode — §12) |
| `accountDistribution` | `accountDistribution` |
| `todaySummary` | `todaySummary` |
| `categoryMonthlyTrend` | `categoryMonthlyTrend` |
| `transaction.filteredTotals` | `transactionFilteredTotals` |
| — | `spaceBreakdown` (per-space split of the caller's owned-account net worth; powers the "Across N spaces" band on the My-money overview) |
| `transaction.listBySpace` | `transactions` (snake-case shape parity, full filter parity with `transaction.list`: type, category, envelope, event, account, user, amount range, search, date range, cursor — plus `is_internal_transfer` / `direction` / space annotations) |
| `expenseCategory.listBySpace` | `listCategories` |
| — | `ownedAccounts` (used by the virtual `AccountsPage`) |

Helpers in
[`shared.mts`](../apps/server/src/procedures/personal/shared.mts):
`resolveOwnedAccountIds` and `resolveMemberSpaceIds`. The membership
set is re-resolved per request (defensive: a user removed from a space
must not see its transactions even if they still own an account that
was shared in historically).

**Legacy `/me`** route redirects to `/s/me` for old links. Old MePage
component is retired — OverviewPage now renders the full personal
dashboard when `space.isPersonal`.

**Explicitly out of scope**: per-user splits of a single shared-space
transaction (Splitwise-style "my share of the household rent"). That
requires schema additions (`transaction_splits` or similar) and is
tracked in §17.

### 6.6 Space invites

Space membership is gained either by an owner directly adding a known
user (`space.addMembers` — used in the legacy member-picker) or via
the **token-credentialed invite flow** (migration 039, used by every
new addition in production).

| Procedure | Who can call | What it does |
|---|---|---|
| [`space.sendInvite`](../apps/server/src/procedures/space/sendInvite.mts) | owner+ | inserts a `space_invites` row with a 64-char token, 72-hour expiry, lowercased email; re-inviting the same email **rotates** the existing token (revokes the old row, inserts a new one) so duplicates don't accumulate; emails the invitee via `SpaceInviteEmail` |
| [`space.listInvites`](../apps/server/src/procedures/space/listInvites.mts) | owner+ | returns still-pending invites for the space settings UI |
| [`space.revokeInvite`](../apps/server/src/procedures/space/revokeInvite.mts) | owner+ | sets `revoked_at`; the invitee's stored link becomes a "cancelled by admin" terminal page |
| [`space.inviteInfo`](../apps/server/src/procedures/space/inviteInfo.mts) | **public** | minimal pre-auth lookup so `/invite/:token` can render space name + inviter name + role + expiry before the user has signed in. Returns the *invited email* but **never** the inviter's email or member count |
| [`space.acceptInvite`](../apps/server/src/procedures/space/acceptInvite.mts) | authenticated | claims the token: `SELECT … FOR UPDATE` on the invite row, refuses if expired / revoked / already accepted, then upserts a `space_members` row for the caller with the invite's role. Existing-member rows are **role-upgraded only** (a viewer accepting an owner-invite becomes owner; an owner accepting a viewer-invite stays owner) |
| [`space.leave`](../apps/server/src/procedures/space/leave.mts) | any member | self-removes from the space; refuses if the caller is the sole owner; also revokes any pending invites still outstanding to the caller's email in this space (case-insensitive) so a leaver can't be silently re-added via a stale link |
| [`space.removeMember`](../apps/server/src/procedures/space/removeMember.mts) | owner+ | removes other members; symmetric with `leave` — also revokes any pending invites to the removed users' emails so they can't rejoin via a stale link |

**Email is not pinned.** Anyone holding the token can accept with any
Orbit account. This is deliberate: a person may have multiple addresses
and an inviter shouldn't have to guess which one their friend uses for
Orbit. The `AcceptInvitePage` surfaces the invited address alongside
the signed-in user's address and warns on mismatch so a logged-in user
doesn't accidentally join under the wrong identity.

**UI surface:**

- `/invite/:token` — public [`AcceptInvitePage`](../apps/web/src/pages/AcceptInvitePage.tsx).
  Renders summary via `inviteInfo`, branches on `status`
  (`pending`/`accepted`/`expired`/`revoked`), and either accepts
  directly (authed) or bounces to `/login?from=…` /
  `/signup?from=…` (guest). The signup flow threads `from=` through
  `DetailsStep` so a freshly-created account lands back on the invite
  page instead of root.
- Space settings → **Members** tab — `InviteMember` form (email + role
  picker → `sendInvite`) and `PendingInvitesCard` (lists pending
  invites with revoke).

### 6.7 User self-service (profile + security)

User-managed personal-account surface lives under
[`/settings`](../apps/web/src/pages/app/) with two pages:

- [`ProfilePage`](../apps/web/src/pages/app/ProfilePage.tsx) — avatar
  upload via the §11.4 three-step file flow, name + email edit. Email
  change is currently a single-step swap that requires the caller's
  password; **email-verification of the new address is not yet
  implemented** (see §17).
- [`SecurityPage`](../apps/web/src/pages/app/SecurityPage.tsx) — password
  change, active-session indicator, and the delete-account confirm
  dialog.

| Procedure | What it does |
|---|---|
| [`user.updateProfile`](../apps/server/src/procedures/user/updateProfile.mts) | first/last name edit |
| [`user.updateAvatar`](../apps/server/src/procedures/user/updateAvatar.mts) | swap `avatar_file_id` to a confirmed file id |
| [`user.changeEmail`](../apps/server/src/procedures/user/changeEmail.mts) | swap `email` after re-authenticating with the current password |
| [`user.changePassword`](../apps/server/src/procedures/user/changePassword.mts) | re-hash + bump `token_version`; returns a freshly-signed JWT so the caller's current tab stays logged in while every other session is invalidated |
| [`user.deleteAccount`](../apps/server/src/procedures/user/deleteAccount.mts) | the tombstone flow described in §3.1 — anonymizes the row, bumps `token_version`, drops every `space_members` row, revokes pending invites the user issued. Refuses if the caller is the **sole owner** of any space (lists all blocker names in a single error message); transfer or delete those spaces first. **Does not currently delete `user_accounts` ownership** of accounts the user solely owns — those rows remain referencing the tombstone, an accepted gap tracked in §17 |

**JWT token-version claim.** Every JWT minted by
[`auth.mts`](../apps/server/src/trpc/auth.mts) embeds the user's
current `token_version`. `fetchUserFromJWT` rejects sessions whose
embedded version doesn't match the row (`changePassword` + `deleteAccount`
both bump it). JWTs minted before migration 040 land carry no
`tokenVersion` claim; the auth layer treats a missing claim as `1`,
matching the default — no force-logout on rollout.

**Open-redirect defense.** Both `LoginPage` and `GuestOnlyRoute` honor
`?from=…` only when the value starts with `/`, doesn't start with `//`,
and doesn't contain `\`. `DetailsStep` (signup) applies the same guard
so the invite return-path threading can't be hijacked.

---

## 7. Allocations — one absolute row per (envelope, period)

Allocations earmark spendable cash to an envelope for a period. There is
**one axis** — which envelope — and the money is **space-wide** (no
per-account earmarking; that was dropped in migration 048).

### 7.1 Allocation row

```
envelop_allocations: (id, envelop_id, amount, period_start NULL, created_by, created_at)
```

`amount` is the **absolute allocated total** for the period, and there is
**exactly one row** per `(envelop_id, period_start)` (unique index, NULLS
NOT DISTINCT — see §3.3). Monthly envelopes get one row per calendar
month (`period_start` = APP_TZ month-start); rolling/goal envelopes get a
single lifetime row (`period_start IS NULL`). Rows are **upserted in
place**, never appended — there is no per-change history.

### 7.2 Allocate / deallocate
([`envelop.allocationCreate`](../apps/server/src/procedures/envelop/createAllocation.mts))

The procedure takes a **signed delta** (`amount`: positive allocates,
negative deallocates) plus an optional `periodStart` (so the
month-budget editor can write past/future months) and applies it as an
**accumulating UPSERT** under a `FOR UPDATE` lock on the envelope row:

- **Positive delta** (allocating): **no guard.** Over-allocation is
  intent — allocating more than the space's spendable cash surfaces as
  the soft "over-allocated" banner (§5.2's signed `unallocated` goes
  negative), never as an error.
- **Negative delta** (deallocating): the only guard is that the
  period's `allocated` can't go below zero. Pulling the budget below
  what's already spent is a legal edit of a planning number — an
  overspent envelope holds no cash anyway (`held = GREATEST(0,
  allocated − consumed)` is already 0), so the unallocated pool stays
  correct.

The UPSERT keys on `(envelop_id, period_start)`; the stored
`period_start` is written as an explicit APP_TZ month-start date string
so it can't drift with the session timezone (see migration 049). A
repeated idempotency key reads the cached response instead of applying
the delta twice.

### 7.3 Consumption rule (for expense transactions)

When an `expense` stamped with `envelop_id = E` lands in period `P`, it
adds to `E`'s `consumed` for `P`. If
`consumed > allocated`, the envelope's `remaining` for that period goes
**negative** — overspend. This is a shown state, never blocked (§5.1).

---

## 8. Overspend & rebalancing

**Overspend** is `allocated − consumed < 0` for an `(envelope, period)`.
It is **surfaced as a UI state, never blocked or nagged** — Orbit shows it
in analytics and on envelope cards and lets the user decide.

- "N% over budget" badges and a "needs attention" strip on the
  [`BudgetsPage`](../apps/web/src/pages/space/budgets/BudgetsPage.tsx).
- The [`OverviewPage`](../apps/web/src/pages/space/OverviewPage.tsx)
  surfaces overspent envelopes in its Targets → Envelope utilization
  section, and an over-*allocation* banner when the space's signed
  unallocated goes negative.
- The [`BudgetDetailPage`](../apps/web/src/pages/space/budgets/BudgetDetailPage.tsx)
  shows the period's allocated / consumed / remaining with a "Transfer"
  action.

**The primary remedy is a transfer between envelopes** — pull allocation
from a healthy envelope into the overspent one via
[`allocation.transfer`](../apps/server/src/procedures/allocation/transfer.mts).
The transfer is re-expressed as **two upserts** against the
one-row-per-(envelope, period) model — it deallocates from the source
envelope's current period and allocates to the destination envelope's
current period, both inside one transaction with the source-has-enough
guard and a lock on both rows. Same-envelope and into-archived-envelope
transfers are rejected. (Cross-account and envelope↔plan transfers no
longer exist — there's no account axis and plans are gone.)

---

## 9. Period model for envelopes (cadence)

The user's biggest pain was that long-running monthly envelopes like
"Groceries" accumulated years of allocations into a meaningless lifetime
number. The fix was explicit periods.

### 9.1 Cadence values

- `'none'` (default for pre-existing envelopes) — single open window
  `[epoch, +∞)`. Identical to the old lifetime model. Also the cadence a
  goal envelope must use (target columns ride only on `'none'`; §3.3).
- `'monthly'` — window resets on the 1st of each calendar month in APP_TZ
  (Asia/Dhaka).

New cadences (weekly, yearly) can be added by widening the
`envelops_cadence_check` constraint and the `Cadence` union in
[`periodWindow.mts`](../apps/server/src/procedures/envelop/utils/periodWindow.mts).
The query layer is already parameterized.

### 9.2 No scheduled reset

**Nothing runs at the start of the month.** Rollover is emergent: the SQL
`DATE_TRUNC('month', NOW())` shifts the window as real time advances.
Editing a transaction's date across months, deleting allocations, etc.
all propagate automatically because metrics are derived from
`transaction_datetime` and `period_start`, not from a materialized
snapshot. This is why the `envelop_balances` table was retired.

### 9.3 No carry-over

Monthly envelopes **reset** each period: each calendar month is an
independent budget, and a previous month's surplus or overspend does
**not** propagate. The earlier three-value `carry_policy` (migration 035)
and the legacy `carry_over` boolean were both dropped in migration 048,
and there is no `carriedIn` in the balance shape (§5.1). A surplus you
want to keep using is moved with `allocation.transfer` (§8); an overspend
is simply shown.

---

## 10. Goals (rolling envelopes with a target)

Goal-based saving is **not a separate entity** — it's a `cadence='none'`
envelope carrying optional target columns (migrations 046/047; the
standalone `plans` table was dropped). Characteristics:

- A goal must be a **rolling** envelope (`cadence='none'`); the CHECK
  `envelops_target_only_on_rolling_check` forbids a target on a monthly
  envelope.
- `target_amount` optional — enables a "% complete" progress read against
  the envelope's lifetime `allocated`.
- `target_date` optional — UI shows "N days left" / "N days overdue."
- Like any envelope, a goal can't be spent from directly: spend lands via
  an expense stamped with the envelope's `envelop_id`.

---

## 11. Transactions

### 11.1 Types & shapes

See §3.6 for the CHECK-constrained shapes. Each has its own create
procedure:

- [`transaction.income`](../apps/server/src/procedures/transaction/income.mts)
- [`transaction.expense`](../apps/server/src/procedures/transaction/expense.mts)
  — requires `expense_category_id` **and** `envelopId` (the envelope is
  chosen at entry time — prefilled from pins §11.8 but editable — and
  frozen on the row), validates source account isn't locked and the
  envelope is active.
- [`transaction.transfer`](../apps/server/src/procedures/transaction/transfer.mts)
  — requires both accounts in the same space, source not locked, source
  has enough balance. Optional fee triple (`feeAmount`,
  `feeExpenseCategoryId`, `feeEnvelopId` — all three or none) spawns a
  paired fee expense row (§11.6).
- [`transaction.adjust`](../apps/server/src/procedures/transaction/adjust.mts)
  — takes a target `newBalance` and writes an `adjustment` row with
  the delta.

### 11.2 Balance propagation

The trigger
[`__trigger_sync_account_balance_from_transactions`](../apps/server/src/db/kysely/migrations/018_create_update_account_balance_trigger.mts)
handles INSERT/UPDATE/DELETE on transactions and maintains
`account_balances`. This is the one remaining materialized balance; it's
kept because transactions can be numerous and recomputing on-read would
be wasteful. Edits reverse the OLD effect and apply the NEW effect.

### 11.3 Permission model

- **Delete**: the transaction's creator, OR a space editor+. Not
  viewers. See [`transaction.delete`](../apps/server/src/procedures/transaction/delete.mts).
- **Source/destination account permissions**: enforced by
  [`resolveTransactionPermission`](../apps/server/src/procedures/transaction/utils/resolveTransactionPermission.mts).
  Locked accounts can never be the source of an expense or transfer, but
  they can receive income.

### 11.4 Attachments

A transaction can carry image attachments (receipts). Upload is a
three-step flow backed by R2 presigned PUT:

1. `file.createUploadUrl({purpose: "transaction_receipt", mimeType, sizeBytes, originalName})`
   — creates a `files` row in `status = 'pending'`, returns
   `{fileId, uploadUrl, expiresAt}` (10-min TTL).
2. Client `PUT`s the bytes directly to R2.
3. `file.confirm({fileId})` — flips `status → 'confirmed'`, sets
   `confirmed_at`.

Then [`file.attach`](../apps/server/src/procedures/file/attach.mts) links
one or more confirmed files to a transaction or event (inserting rows into
`transaction_attachments` / `event_attachments`). Listing and removal are
via [`file.listForTransaction`](../apps/server/src/procedures/file/listForTransaction.mts),
[`file.listForEvent`](../apps/server/src/procedures/file/listForEvent.mts),
and [`file.removeFromTransaction`](../apps/server/src/procedures/file/removeFromTransaction.mts).
Downloads are signed GETs: [`file.getDownloadUrl`](../apps/server/src/procedures/file/getDownloadUrl.mts)
(15-min TTL) gates access by purpose:

- `avatar` — any authenticated user.
- `transaction_receipt` — caller must be a member of the transaction's space.
- `event_attachment` — caller must be a member of the event's space.
- `exported_report` — file owner only.

Avatars are re-encoded via `sharp` in `file.confirm` (256px main + 64px
thumbnail variants). Other purposes store the original bytes untouched.

### 11.5 Filtering ([`transaction.list`](../apps/server/src/procedures/transaction/list.mts))

Supports: space, user, type, envelope (matched directly on
`transactions.envelop_id`; singular `envelopId` accepts the `"__none"`
sentinel for no-envelope rows, and a multi-select `envelopIds` array
takes precedence), category (`expenseCategoryId` / multi-select
`expenseCategoryIds`, with `includeDescendants` flag, default true),
event, account (either side), search (ILIKE on description + location),
amount min/max, date range, cursor-paginated (limit 1–200, default 50).
Returns `{items, nextCursor}`.

[`transaction.filteredTotals`](../apps/server/src/procedures/transaction/filteredTotals.mts)
takes the same filter shape and returns aggregate income/expense/count
totals for the current filter set (the summary strip above the
transactions table). `personal.transactionFilteredTotals` is its
cross-space twin.

### 11.6 Transfer fees

Real-world transfers cost money: wire fees, ATM withdrawal fees, FX
margins, card processor cuts. Orbit records a fee as a **paired
first-class expense transaction** spawned by the transfer — the user
still enters it in one form, but the ledger holds two rows.

History: migration 030 first modeled fees as inline `fee_amount` /
`fee_expense_category_id` columns on the transfer row; migration 042
**replaced** that with the paired-row model because the inline columns
re-introduced the category→envelope coupling eliminated by 041 and
forced `UNION ALL` fee branches into every spend analytics query.

**Schema** (migration 042):

- Transfers are **amount-only** — no fee columns.
- The fee is its own `type='expense'` row with its own
  `expense_category_id`, `envelop_id`, `source_account_id` (same as the
  transfer's source), datetime, and `parent_transfer_id uuid REFERENCES
  transactions(id) ON DELETE CASCADE` pointing back at the transfer —
  deleting the transfer deletes its fee row.

**Balance semantics** — the balance-sync trigger is **fee-blind**: the
fee expense row debits the source through the ordinary expense path,
so a transfer with a fee still debits the source `amount + fee` in
total and credits the destination the plain `amount`. The fee is money
leaving Orbit's books entirely (bank / ATM / processor).

**Analytics** — no special-casing needed. A fee is an ordinary expense
row, so `topCategories` / `categoryBreakdown` see it under its own
category, `envelopeUtilization` counts it against its own envelope,
and `cashFlow` / `spendingHeatmap` / `spaceSummary` count it as period
expense scoped by its own `source_account_id` / `space_id`. Same for
every `personal.*` twin: the fee counts as personal outflow exactly
when its source account is caller-owned (including owned → owned
internal transfers — the bank still took the fee).

**Write path** —
[`transaction.transfer`](../apps/server/src/procedures/transaction/transfer.mts)
accepts an optional fee triple (`feeAmount`, `feeExpenseCategoryId`,
`feeEnvelopId` — all three or none) and inserts the transfer plus the
fee expense row (`description: "Fee — <desc>"`) in one DB transaction.

**UI** — the Transfer form ([`NewTransactionSheet`](../apps/web/src/features/transactions/NewTransactionSheet.tsx))
exposes an optional "There's a fee on this transfer" toggle that reveals
the amount + category + envelope inputs and a live preview: "Source
debited −1005 / Destination credited +1000 / Fee (lost to provider)
5.00". In the edit form ([`EditTransactionSheet`](../apps/web/src/features/transactions/EditTransactionSheet.tsx))
a fee row edits as a mostly-ordinary expense — its source account is
locked to the parent transfer's source and a banner points at the
parent for amount/source changes. Details view
([`TransactionDetailsSheet`](../apps/web/src/features/transactions/TransactionDetailsSheet.tsx))
recognizes `parent_transfer_id` and shows the fee alongside its parent.

**Source-dropdown rule** — the transaction form's "from" dropdowns
(expense source, transfer source, adjustment account) only list
accounts the caller owns (`user_accounts.role = 'owner'`); you can
only move your own money out. Destination dropdowns list every
account in the space — income and transfers can land in shared pots
or other members' accounts.
[`resolveTransactionPermission`](../apps/server/src/procedures/transaction/utils/resolveTransactionPermission.mts)
mirrors this on the server: destination needs only space-member access.

### 11.7 No transaction-time budget gate

Orbit never blocks a transaction on the budget. Migration 048 removed
both the **borrow-from-next-month** mechanism (which wrote paired
`+/−` allocation rows across months) and **strict budget mode**
(`spaces.budget_mode`, which gated `transaction.expense` /
`transaction.transfer` / `transaction.adjust` on unresolved past-month
overspends). Transactions always record; an overspend is simply shown in
analytics (§5.1, §8) and resolved, if the user chooses, with a transfer
between envelopes.

### 11.8 Transaction-entry pins

Pins (migrations 043/044, the `pin.*` router — `set` / `clear` /
`listBySpace`) are per-space defaults for the transaction entry form:
pin an Account, an Envelope, and/or an Event and the form pre-selects
them. **Account pins are per-user-per-space** (my wallet isn't your
default); **Envelope and Event pins are space-wide** (set by any
editor+, visible to all members). With categories decoupled from
envelopes (§3.5), pins are the primary envelope-prefill mechanism.
Full behavior spec lives in
[`contexts/modules/server/pin.md`](./modules/server/pin.md).

---

## 12. Analytics procedures

All under [`apps/server/src/procedures/analytics/`](../apps/server/src/procedures/analytics/)
and registered in [`routers/analytics.mts`](../apps/server/src/routers/analytics.mts).

**Overview / cash-flow / balances**

| Procedure | What it returns |
| --- | --- |
| `spaceSummary` | top-line net worth / spendable / locked / envelope agg / signed unallocated / month income+expense+net |
| `todaySummary` | "today vs typical" snapshot for the Overview hero strip |
| `cashFlow` | income vs expense bucketed by day/week/month |
| `balanceHistory` | bucketed running total-balance over time |
| `accountBalanceHistory` | same shape, narrowed to one account |
| `netWorthHistory` | net worth (asset − liability) running total |
| `cumulativeSpend` | running expense total in the period for the burn-down chart |
| `spendingHeatmap` | daily expense totals for calendar heatmaps. `mode` ∈ `cash` / `operational` — `cash` (default) counts cross-space outbound transfer principal as spend (agrees with `cashFlow`); `operational` counts only true expenses (moving money to your own savings isn't spending — the Spending calendar view requests this) |
| `incomeBreakdown` | sources of income for the period |

**Category / priority / merchants**

| Procedure | What it returns |
| --- | --- |
| `categoryBreakdown` | per-category direct + subtree totals via recursive CTE |
| `categoryMonthlyTrend` | monthly time series behind `categoryBreakdown` — one row per category per calendar month in range, zero-filled, same filter shape, so the Categories view's trend chart always agrees with its donut |
| `topCategories` | top N categories by spend in the window |
| `topCategoriesByBucket` | top categories per time bucket (used by the period comparison chart) |
| `topMerchants` | top expense locations/descriptions, derived from `location` and the first-line of `description` |
| `categoryWoW` | week-over-week per-category deltas |
| `priorityBreakdown` | expense per priority tier (essential / important / discretionary / luxury / unclassified) for the window. Tier lives on the category (§3.5); descendants inherit from the nearest non-NULL ancestor via a recursive CTE. Transfer principal excluded; a transfer fee is its own expense row (§11.6) so it lands under its own category's tier |

**Envelopes / accounts**

| Procedure | What it returns |
| --- | --- |
| `envelopeUtilization` | per-envelope `allocated` / `consumed` / `remaining` for the period (space-wide; no per-account partitions) + goal-target progress for rolling envelopes that carry a target |
| `envelopeRecentAverages` | trailing-N-period averages used by the envelope card "typical month" line |
| `envelopeMonthlyAllocations` | calendar-year allocated-per-month history for one monthly envelope — pairs with per-month spend on the envelope detail page's "Monthly spend" chart (rolling/goal envelopes have no monthly rows) |
| `accountDistribution` | per-account balance with color/icon (powers the Overview; the Accounts page derives its own distribution bar from the account list) |

(The former `allocations` and `unbudgetedTrend` procedures — and the
web AllocationsView they powered — were removed along with the
allocation-map analytics view.)

**Events**

| Procedure | What it returns |
| --- | --- |
| `eventTotals` | per-event expense + income totals + tx count |
| `eventCategoryBreakdown` | per-event spend broken down by category |
| `eventDailySpend` | per-day expense/income totals for one event (APP_TZ calendar days, active days only) — powers the event detail page's spend timeline + day-of-week strip |
| `eventTopLocations` | top expense locations for one event, ranked by total — the "Where it went" section of the event detail page |

**Trends / anomalies / yearly**

| Procedure | What it returns |
| --- | --- |
| `trendsDailyComparison` | this-month vs typical day-of-month overlay |
| `trendsCategoryMovers` | categories whose spend swung most vs trailing average |
| `trendsYearOverYear` | YoY total comparison |
| `anomaliesOutliers` | transactions ≥ N stddev above their category's recent mean |
| `anomaliesRecurring` | inferred recurring expenses (rent, subs) + whether this month's instance has landed |
| `anomaliesShapeStats` | distribution shape metrics for the anomaly view |
| `anomaliesStreaks` | consecutive-day spend streaks per category |
| `anomaliesPatternBreaks` | category-pattern breaks (sudden surge, sudden silence) |
| `recurring` | confirmed recurring schedule rows powering the upcoming-bills card |
| `yearReport` | annual roll-up for `/s/:spaceId/year/:year` — month×category matrix + income/expense/net + top categories of the year |

All accept `spaceId` and validate membership before running.

**Money-flow analytics are account-scoped; category-like analytics are
`space_id`-scoped.** This is the central rule.

| Procedure | Scope | Rationale |
|---|---|---|
| `spaceSummary` (balances + `periodIncome` / `periodExpense` / `periodNet`) | account | balances derive from `account_balances`, which the trigger updates purely by account |
| `cashFlow` | account | income vs. expense must agree with balance movement |
| `balanceHistory` | account | current balance is account-derived; deltas must match or the chart contradicts today |
| `spendingHeatmap` | account | a day's cell should match that day's cash-flow expense bar |
| `categoryBreakdown`, `topCategories` | `space_id` | expense categories are space-local; the category tree only contains rows stamped with this space |
| `envelopeUtilization` | `space_id` | envelopes are space entities |
| `eventTotals` | `space_id` | events are space entities |
| `priorityBreakdown` | account | mirrors `cashFlow`: outflow is per-account, classified via the category's `priority` (inherited from the nearest non-NULL ancestor) |

**Why account-scoped for money-flow.** The balance trigger updates
`account_balances` based on `source_account_id` / `destination_account_id`
regardless of which `space_id` a row was stamped with. Historically the
analytics queries filtered by `space_id` instead, which produced two
pathologies: (1) a cross-space contribution (e.g. transfer from a
personal account into a family-shared pot) silently raised the family's
balance without ever surfacing as income, and (2) `balanceHistory`'s
delta stream diverged from its `current_balance` when a row touched a
scope account but was stamped with a neighboring space. Under the
account-flow rule, both problems disappear: every query derives its
population from `space_accounts` via a scope CTE, and `space_id`
becomes purely a categorization tag for the category/envelope graph.

**The combination table** (for any row, from Space X's viewpoint,
where `scope = space_accounts` for X):

| src ∈ scope | dst ∈ scope | Transfer → X income | Transfer → X expense |
|---|---|---|---|
| yes | yes | 0 | 0 |
| yes | no  | 0 | `amount` |
| no  | yes | `amount` | 0 |
| no  | no  | 0 | 0 |

A transfer's fee needs no column in this table anymore: it is its own
`type='expense'` row (§11.6), so it counts as X's expense exactly when
its source account ∈ scope — which reproduces the old inline-fee
semantics through the ordinary expense path.

- `income` counts only if destination ∈ scope.
- `expense` counts only if source ∈ scope.
- `adjustment` mirrors balanceHistory: `+amount` when destination ∈
  scope, `−amount` when source ∈ scope.

**Write-time integrity.** To keep `space_id` a meaningful categorization
tag (even though it no longer scopes money-flow), every transaction
creation / update path runs
[`resolveTransactionSpaceIntegrity`](../apps/server/src/procedures/transaction/utils/resolveTransactionSpaceIntegrity.mts):
the chosen `spaceId` must be one of the spaces that source or
destination is shared into. This allows the common "contribute from
outside into a space pot" flow (one leg is in the recording space,
the other isn't) while rejecting orphaned rows where neither leg
relates to the stamped space.

These rules make the period net reported by `spaceSummary` / `cashFlow`
always match the balance-delta reported by `balanceHistory`, and
parallel the personal semantics in §6.5.

**Cross-space counterparts** live under
[`apps/server/src/procedures/personal/`](../apps/server/src/procedures/personal/)
and are composed by [`routers/personal.mts`](../apps/server/src/routers/personal.mts).
Every analytics procedure has a personal twin (same output shape, same
SQL pattern, different anchor) so the pages and analytics views swap
data sources via a single `space.isPersonal` branch:
`summary`, `todaySummary`, `cashFlow`, `topCategories`,
`categoryBreakdown`, `categoryMonthlyTrend`, `envelopeUtilization`,
`balanceHistory`, `spendingHeatmap` (same `cash`/`operational` mode),
`accountDistribution`, `spaceBreakdown` (how the caller's owned-account
net worth splits across their spaces — the "Across N spaces" band on
the My-money overview), plus `transactions` +
`transactionFilteredTotals` (full filter parity with
`transaction.list` / `transaction.filteredTotals`), `listCategories`,
`ownedAccounts`, and the `trends.*` / `anomalies.*` / overview-card
twins. See §6.5 for the semantics.

---

## 13. Web UI structure

Routes are declared in [`router/index.tsx`](../apps/web/src/router/index.tsx)
and the ROUTES constant is in [`router/routes.ts`](../apps/web/src/router/routes.ts).

### 13.1 Route tree

- `/login`, `/signup`, `/forgot-password` — guest-only
- `/docs` — **public** product guide ([`DocsPage`](../apps/web/src/pages/DocsPage.tsx)),
  reachable without login. Linked from the auth layout and the user-avatar
  menu.
- `/invite/:token` — **public** [`AcceptInvitePage`](../apps/web/src/pages/AcceptInvitePage.tsx)
  so the page can render space metadata pre-auth via `space.inviteInfo`.
  Guest users are bounced to `/login?from=…` or `/signup?from=…`; both
  flows thread the `from=` param back to the accept page on success.
  See §6.6.
- `/` — `RootRedirect` sends to `/spaces` or `/login`
- `/spaces` — space picker
- `/settings/profile`, `/settings/security` — user self-service (see
  §6.7); avatar upload on profile uses the three-step file flow from
  §11.4
- `/accounts` — **global My Accounts** (cross-space)
- `/me` — legacy alias, redirects to `/s/me`
- `/s/:spaceId` — space overview (handles both real spaces and the
  virtual `"me"` sentinel; see §6.5 for the virtual-space dispatch).
  Pages that depend on real space data (`settings`, `budgets/month/:month`,
  `year/:year`) redirect to the overview when `space.isPersonal`.
  - `/accounts`, `/accounts/:accountId` — space accounts (detail has
    **Allocations / Transactions / Shared with / Members / Settings** tabs)
  - `/transactions`, `/budgets`, `/budgets/:envelopeId`, `/categories`,
    `/events`, `/events/:eventId`, `/settings`. (Envelopes are surfaced
    under the "Budgets" label; there are no separate Plans pages — goals
    are rolling envelopes, §10.)
  - `/budgets/month/:month` — month-allocation editor
    ([`BudgetMonthPage`](../apps/web/src/pages/space/budgets/BudgetMonthPage.tsx))
    for setting a month's envelope budgets in one screen
  - `/year/:year` — annual roll-up
    ([`YearReportPage`](../apps/web/src/pages/space/year/YearReportPage.tsx))
    powered by `analytics.yearReport`
  - `/analytics` — index of analytics sub-views
  - `/analytics/:view` where `view` ∈ `cash-flow | trends |
    categories | envelopes | balance | heatmap | anomalies | priority`
    (the former `allocations` view was removed; account distribution
    lives on the Accounts page and the Overview)
  - `/events/:eventId` is a full dashboard page: hero band, stat
    tiles, budget gauge against `estimated_amount`, cumulative spend
    timeline + daily bars (`analytics.eventDailySpend`), drillable
    category donut, top locations (`analytics.eventTopLocations`),
    filterable transaction list, attachments — components in
    [`eventCharts.tsx`](../apps/web/src/pages/space/events/eventCharts.tsx)
    / [`eventUtils.ts`](../apps/web/src/pages/space/events/eventUtils.ts)

Guards in [`router/guards/`](../apps/web/src/router/guards/):
`ProtectedRoute`, `GuestOnlyRoute`, `PublicRoute`. Both `LoginPage`
and `GuestOnlyRoute` apply an open-redirect guard on `?from=`: only
values starting with `/` and not containing `//` or `\` are honored
(see §6.7).

The `ROUTES` constant in [`router/routes.ts`](../apps/web/src/router/routes.ts)
also exports `spaceBudgetMonth(id, month)`, `spaceYearReport(id, year)`,
and `inviteAccept(token)`. **Never hardcode paths in components** — use
`ROUTES.*`.

### 13.2 Component catalog (shared building blocks)

All under [`apps/web/src/components/`](../apps/web/src/components/).

- [`MoneyDisplay`](../apps/web/src/components/shared/MoneyDisplay.tsx) —
  always shows `−` on negatives. `signed` flag prefixes `+` for positives.
  Variants `income / expense / transfer / neutral / muted`.
- [`EntityAvatar`](../apps/web/src/components/shared/EntityAvatar.tsx) —
  tinted color chip with an icon. Used everywhere an envelope/account/
  category/event appears.
- [`ColorPicker`](../apps/web/src/components/shared/ColorPicker.tsx) +
  [`IconPicker`](../apps/web/src/components/shared/IconPicker.tsx) +
  [`EntityStyleFields`](../apps/web/src/components/shared/EntityStyleFields.tsx) —
  picker pair + live-preview wrapper. 14-color curated palette, ~45-icon
  lucide subset.
- [`PeriodSelector`](../apps/web/src/components/shared/PeriodSelector.tsx)
  \+ [`usePeriod` hook](../apps/web/src/hooks/usePeriod.ts) —
  URL-persisted `?period=this-month|last-month|…|custom`. Default
  `this-month` is never written to URL (keeps links clean).
- [`CategoryTreeSelect`](../apps/web/src/components/shared/CategoryTreeSelect.tsx) —
  hierarchical category picker with search + collapse.
- [`Donut`](../apps/web/src/components/shared/charts/Donut.tsx) — modern
  donut with center label + total, hover enlarges slice, side legend
  optional. **`activeIndex` is passed only when hovering**; passing `-1`
  breaks recharts rendering on some versions. No white stroke between
  segments.
- [`DrillableDonut`](../apps/web/src/components/shared/charts/DrillableDonut.tsx) —
  donut with click-to-drill into a slice's children (category subtrees);
  used by the Categories analytics view and the Overview donuts.
- [`MultiSeriesLineChart`](../apps/web/src/components/shared/charts/MultiSeriesLineChart.tsx) —
  shared multi-line time-series chart (one line per selected category /
  envelope), used by the Trends, Categories, Envelopes, and Heatmap
  analytics views.
- [`DateRangePicker`](../apps/web/src/components/shared/DateRangePicker.tsx) +
  `PeriodChip` + [`AnalyticsFilterBar`](../apps/web/src/pages/space/analytics/components/AnalyticsFilterBar.tsx)
  \+ [`CategoryMultiSelect`](../apps/web/src/pages/space/analytics/components/CategoryMultiSelect.tsx) —
  the shared filter surface for analytics views; prefer these over
  bespoke filter UIs.
- [`spendHeatmapColor`](../apps/web/src/lib/spendHeatmapColor.ts) — the
  shared daily-spend heatmap color system: a single-hue amber ramp with
  **data-derived quantile buckets** (20/40/60/80th percentiles of the
  user's own active days, IQR-fenced so one huge day doesn't stretch
  the scale). Used by the Overview calendar and the Spending calendar
  view; never hardcode absolute amount thresholds.
- [`ConfirmDialog`](../apps/web/src/components/shared/ConfirmDialog.tsx),
  [`PermissionGate`](../apps/web/src/components/shared/PermissionGate.tsx),
  [`EmptyState`](../apps/web/src/components/shared/EmptyState.tsx),
  [`PageHeader`](../apps/web/src/components/shared/PageHeader.tsx),
  [`RoleBadge`](../apps/web/src/components/shared/RoleBadge.tsx),
  [`TransactionTypeBadge`](../apps/web/src/components/shared/TransactionTypeBadge.tsx),
  [`AccountTypeBadge`](../apps/web/src/components/shared/AccountTypeBadge.tsx),
  etc.
- [`UserAvatar`](../apps/web/src/components/shared/UserAvatar.tsx) —
  renders a user's avatar from `avatar_file_id` via the signed-URL hook
  [`useSignedUrl`](../apps/web/src/hooks/useSignedUrl.ts); falls back to
  initials on a tinted chip.
- [`useFileUpload`](../apps/web/src/hooks/useFileUpload.ts) — orchestrates
  the `createUploadUrl → PUT → confirm` flow for any purpose. All
  upload-capable surfaces (avatar, transaction receipts, event
  attachments) funnel through this hook.

### 13.3 Entity visual system

Envelopes, accounts, categories, and events all carry `color` and
`icon` (see §3). The `EntityAvatar`, donut slices, progress bars, flow-bar
segments all pull directly from these fields — the same entity reads the
same color everywhere. Defaults are deterministic by `hashtext(id)` so a
newly-created entity without an explicit color/icon still looks distinct.

### 13.4 Theme

Palette in [`index.css`](../apps/web/src/index.css):
- `--primary: hsl(160 84% 50%)` (emerald).
- `--brand-gradient-to: hsl(175 70% 45%)` (teal) — the CTA-gradient
  partner. **Never** use `--accent` here — that's reserved for the shadcn
  hover-surface role (a dim `hsl(180 8% 15%)`).
- `--income / --expense / --transfer / --warning` semantic tokens.

Dark-only. Light mode isn't wired; `color-scheme: dark` on `<html>`.

Global CSS also restores `cursor: pointer` on buttons / role-based
interactive elements (Tailwind v4 removed this) and kills focus outlines
inside `.recharts-wrapper` / `.recharts-surface` (fixes the white border
on chart click).

Toasts live at `bottom-right` (from `sonner`) — out of the way of page
header buttons.

### 13.5 Overview page story

The [`OverviewPage`](../apps/web/src/pages/space/OverviewPage.tsx) was
rebuilt (2026-07) as a single self-styled editorial dashboard —
`od-card` panels grouped under eyebrow labels — that always shows the
**current month**. Top-down:

1. Header — unallocated chip (links to Budgets), "All analytics" and
   "New transaction" actions
2. Today band — "today vs typical" strip (`analytics.todaySummary`)
3. "Across your spaces" band (personal `/s/me` only —
   `personal.spaceBreakdown`)
4. Over-allocated banner (conditional)
5. **Position** — stat tiles (net worth, spendable, month income /
   expense / net) with deltas
6. Balance trend (area chart, last 30 days) + Net worth composition
7. **Composition** — three donuts: Where money sits (accounts),
   Spending by envelope, By priority
8. **Flow** — cash flow bars with metric toggle, month-progress strip,
   Daily spend heatmap (current-month calendar on the shared amber
   quantile ramp — §13.2), Top movers
9. **Targets** — Envelope utilization + Goals progress
10. Spending trends + Accounts at a glance

Every section has an "Open view →" link into the corresponding
analytics sub-view or feature page.

### 13.6 Common bug source: `new Date()` as query input

tRPC + React Query hashes inputs via JSON serialize. `new Date()` →
ISO string with ms precision → different every render → query refetches
infinitely → stuck on `isLoading: true`.

**Pattern:** freeze `now` on mount.

```tsx
const [now] = useState(() => new Date());
```

Or use already-month-truncated derivatives (`startOfMonth(now)` etc.)
which stringify identically across renders within the same month.

---

## 14. Conventions

### 14.1 Server

- One procedure per file under `procedures/<resource>/<action>.mts`; the
  feature router just re-exports.
- Mutations: `ctx.services.qb.transaction().execute(trx => …)` wrapped in
  `safeAwait`. Re-throw `TRPCError` as-is; wrap other errors as
  `INTERNAL_SERVER_ERROR` with the original message.
- Reads can skip the transaction wrapper and use `ctx.services.qb` directly.
- Input validation: zod. Inputs use `camelCase`; DB columns are
  `snake_case`.
- Dates over the wire serialize to ISO strings. Zod `z.date()` / `z.coerce.date()`.
- Enum cast pattern: `"expense" as unknown as Transactions["type"]` —
  required because `kysely-codegen` types enums as `ArrayType<...>`. Do not
  fight this. A cleanup is deferred pending a generator fix.

### 14.2 Client

- Path alias `@/*` → `apps/web/src/*` (Vite config + tsconfig).
- `Link to={ROUTES.spaceEnvelopeDetail(…)}` — never hardcode paths.
- tRPC queries: pass minimal, stable inputs. Dates should be frozen or
  month-truncated (§13.6).
- Date handling at UI edges: always `new Date(str)` before `date-fns`,
  because tRPC HTTP serializes `Date → string` even though the type
  claims `Date`. Seen in budgets, events, transactions.
- **APP_TZ-aware wall-clock math**: when reading or constructing
  wall-clock fields from an absolute `Date`, use
  `getAppTzYear/Month/Date/Day/Hours/Minutes`, `makeAppTzDate`, and
  `addMonthsClamped` from [`@/lib/dates`](../apps/web/src/lib/dates.ts)
  — native `Date.getHours()` / `setFullYear()` run in the **browser's**
  zone and silently drift the value for any user outside Asia/Dhaka.
  [`TransactionDatePicker`](../apps/web/src/features/transactions/TransactionDatePicker.tsx)
  is the reference implementation; the `fromInputDateTime` /
  `toInputDateTime` round-trip stays the boundary with the form's
  `datetime-local` string.
- Route persistence: filter/period state is URL-synced via `useSearchParams`
  so deep-linking and back-button work.

### 14.3 Prettier / commit style

- `.prettierrc`: 4-space indent, double quotes, semicolons, 100-char
  print width, `trailingComma: "es5"`. Run `pnpm format` before large
  commits.
- Commit messages start with `FEAT: / FIX: / REFACTOR:` etc.

---

## 15. Invariants (for code review)

These should never break. If your change might violate one, think hard or
don't do it.

**Accounting**
1. Money exists only in accounts. Envelopes are labels, not money.
2. `account_balances.balance` = Σ deltas from transactions where this
   account is source/destination. The trigger enforces this; handwritten
   balance updates are forbidden.
3. There is exactly one `envelop_allocations` row per `(envelop_id,
   period_start)` and its `amount` is that period's absolute allocated
   total (no materialized balance column to drift from).

**Periods**
4. A monthly envelope's allocation row is keyed by `period_start`
   (APP_TZ month-start); a rolling/goal envelope has a single
   `period_start IS NULL` row. Periods don't carry over — each monthly
   period is independent.
5. Cadence = 'none' envelopes use the single NULL-period lifetime row.
6. `resolveEnvelopePeriodBalance` is the only way to compute envelope
   remaining. Don't re-implement on the client.

**Allocations & overspend**
7. An expense is stamped with its envelope at write time
   (`transactions.envelop_id`, NOT NULL for expenses) and adds to that
   envelope's `consumed` for the transaction's period. It never writes
   an allocation row. Allocations are space-wide (no `account_id`).
   Categories carry **no** envelope — reorganizing the category tree
   must never change any envelope's consumption.
8. Allocate/deallocate and transfer mutate the single period row via an
   accumulating UPSERT under a row lock — never append.
9. Overspend (`allocated < consumed`) is legal state, not an error, and
   is never blocked. Envelope consumption equals the sum of expense
   rows stamped with the envelope (transfer fees are themselves expense
   rows — §11.6).

**Permissions**
10. Space isolation: every procedure that reads/writes space data calls
    `resolveSpaceMembership`. Cross-space queries require the caller to
    be in the source space.
11. Account permissions independent of space: `resolveAccountPermission`
    governs who can edit the account row itself.
12. Unsharing an account from a space must leave ≥ 1 space and must find
    no dependent transactions/allocations in that space.

**Cascade**
13. `ON DELETE RESTRICT` on:
    - `expense_categories.parent_id` (can't delete parent with children)
    - `transactions.envelop_id` (can't delete an envelope that has
      transactions — categories no longer reference envelopes at all)
    - `envelop_allocations.created_by`
    (Note: `envelop_allocations.account_id` no longer exists — migration
    048 dropped per-account allocation — so allocations no longer guard
    account deletion.)
14. `ON DELETE CASCADE` on space_members, space_accounts (when account
    unshared from space), envelops (when space deleted), and
    `transactions.parent_transfer_id` (deleting a transfer deletes its
    fee expense row).

**UI**
15. `MoneyDisplay` is the only component that renders currency. Never
    raw-print a `Number` as money.
16. Routes constructed via `ROUTES.*` helpers. No hardcoded paths.
17. Dates from tRPC responses are rehydrated (`new Date(resp.field)`)
    before passing to `date-fns`.

**Auth & lifecycle**
18. Every JWT-minting path (`auth.login`, `auth.signup.complete`,
    `auth.resetPassword.complete`, `user.changePassword`) embeds the
    user's current `token_version`. `fetchUserFromJWT` rejects any
    token whose claim doesn't match the row.
19. `user.deleteAccount` does **not** hard-delete; it tombstones. The
    `users.id` row stays so historical authorship FKs remain valid. The
    tombstone path also revokes pending invites the user issued, drops
    every `space_members` row, and bumps `token_version` to invalidate
    every outstanding session.
20. `space.removeMember` and `space.leave` both revoke pending invites
    addressed to the (case-insensitively-matched) email of the removed
    user, so a kicked or self-removed user can't re-enter the space via
    a stale invite link.
21. `space.acceptInvite` upserts membership with a **role-upgrade-only**
    rule — an existing member's role can be raised by accepting a
    higher-role invite but never demoted.
22. `?from=` redirect params in `LoginPage`, `GuestOnlyRoute`, and
    `DetailsStep` are validated to start with `/`, not start with `//`,
    and not contain `\` before being honored.

**Budgeting**
23. No transaction is ever blocked on the budget. There is no strict
    mode, no reckoning, no borrow-from-next-month, and no carry-over
    (all removed in migration 048). Overspend is shown, never gated; the
    remedy is a transfer between envelopes.

---

## 16. Review & testing checklist

When reviewing a PR, run this mental scan:

### 16.1 Red flags

- New `new Date()` at the top of a React component that flows into a
  tRPC input → likely infinite refetch bug (§13.6). Use `useState(() =>
  new Date())` or month-truncated dates.
- Currency rendered with `toFixed(2)` or template literals. Must use
  `MoneyDisplay`.
- A new procedure that doesn't call `resolveSpaceMembership` or
  `resolveAccountPermission` — probably missing an authorization check.
- Materialized balance tables creeping back in. Envelope balance
  computation should stay on-read.
- Hardcoded colors in components. Use entity `color` fields or
  semantic CSS vars (`--income`, `--expense`, etc).
- Hardcoded route strings. Use `ROUTES.*`.
- `stroke="white"` or focus-outline artifacts in charts — bypass the
  global recharts rule.

### 16.2 Must-test scenarios for any allocation/transaction change

1. Monthly envelope: allocate $500, record a $100 expense stamped with
   the envelope, verify `(E, Jan)` remaining = $400. Roll to Feb (manually change
   system date or use test fixture), verify Jan preserved and Feb is a
   fresh, empty period (no carry-over).
2. No carry-over: underspend Jan by $200, verify Feb starts at the new
   month's allocation only — Jan's surplus does **not** appear in Feb.
3. Overspend: allocate $500 to envelope E, spend $700 against it, verify
   E's period remaining = `−200` and the overview Overspend alerts shows
   the row. The transaction still records (never blocked).
4. Rebalance: with E at `−200` and a healthy envelope F at `+300`,
   transfer $200 from F to E via the transfer dialog (one upsert each).
   Verify E's overspend clears and F drops by $200.
5. Allocate exceeding unallocated → **allowed** (over-allocation is
   intent), but the space's signed unallocated goes negative and the
   over-allocated banner appears on the Overview.
6. Edit expense's `transaction_datetime` across months: previous month's
   consumption reverses, new month's consumption applies.
7. Delete envelope that has transactions → should fail with a clear
   message (`transactions.envelop_id` RESTRICT).
8. Deallocate more than the period's `allocated` → blocked (the budget
   can't go below zero). Deallocating below what's already **spent** is
   allowed — it's a planning-number edit and frees no cash.
9. Goal envelope: create a `cadence='none'` envelope with a
   `target_amount`; verify a target on a `monthly` envelope is rejected
   by `envelops_target_only_on_rolling_check`.
10. Share an account, then try sharing again → blocked with CONFLICT.

### 16.3 Smoke test on the web

- Login, space picker, space overview loads without errors
- Overview: balance trend, the Composition donuts (Where money sits /
  Spending by envelope / By priority), and the daily heatmap all
  render (not stuck on skeleton)
- Click a slice — no white border artifact
- Open envelope detail, see this period's allocated / consumed / remaining
- Click overspend row → redirects to envelope detail
- Transfer between envelopes → dialog works, overspend clears
- "My accounts" global page loads with correct space chips
- New transaction sheet: all 4 tabs (income/expense/transfer/adjustment)
  work; event picker appears if events exist; category picker is
  hierarchical
- Toast notifications appear bottom-right, not covering header buttons

### 16.4 Type-check gate

Both apps must pass `tsc --noEmit`:

```bash
(cd apps/server && npx tsc --noEmit --tsBuildInfoFile /tmp/server.tsbuildinfo)
(cd apps/web    && npx tsc --noEmit)
```

No `any` on new code unless there's a well-commented reason (e.g. to
work around Kysely's `ArrayType` enum codegen quirk).

---

## 17. Known limitations / deferred

Listed here so reviewers don't file phantom bugs against them and
implementers don't accidentally ship fixes without context.

- **Multi-currency** — all amounts are `numeric(·, 2)` with no currency
  field. Every account is implicitly the space's default currency. The
  `wrap` branch prepared the UI by stripping the hard-coded `$` glyph
  from inputs and labels, but a migration adding `currency char(3)` on
  accounts and locale-aware formatting at `MoneyDisplay` is still
  pending.
- **Weekly / yearly cadence** — schema is ready (just a CHECK widen), but
  the period-math helper only understands `'none' | 'monthly'`. Adding
  weekly requires extending `resolvePeriodWindow`.
- **Envelope balance table retired** — do **not** reintroduce
  `envelop_balances` (or any plan-balance table). If read performance
  becomes an issue, memoize in React Query or add a view, not a
  materialized trigger-fed table.
- **Kysely enum codegen quirk** — `ArrayType<...>` on enum columns forces
  `as unknown as T["col"]` casts. Replacing the codegen or hand-editing
  the types would remove ~40 casts; not yet done.
- **Soft delete is users-only** — migration 040 added `users.deleted_at`
  + token-version invalidation, but every other resource (spaces,
  envelopes, accounts, transactions, allocations) is still hard delete.
  Envelopes have an `archived` boolean (migration 033) as a middle
  ground but it's not the same as a tombstone.
- **`user.deleteAccount` leaves `user_accounts` ownership behind** — the
  procedure tombstones the user row and drops `space_members`, but
  rows in `user_accounts` where the tombstoned user is the sole owner
  remain. The account is then unmanageable (no live owner). Either
  pre-flight by requiring the user to add a co-owner / unshare /
  delete the account before delete, or auto-promote a viewer. Tracked
  for a follow-up.
- **Email-change verification** — `user.changeEmail` swaps the address
  after current-password re-auth, but does not send a verification code
  to the new address. Signup and password-reset both verify via the
  existing `email_verification_codes` table; the email-change flow
  should adopt the same pattern.
- **No audit log** — `created_by` on transactions + allocations is the
  only trail. A proper audit table is a known future feature.
- **Light mode** — the palette has a `:root, .dark` combined block; a
  separate `:root` with light values is not wired. `color-scheme: dark`
  is hardcoded.
- **Timezone** — app-wide IANA zone set via `APP_TIMEZONE` env
  (default `Asia/Dhaka`, UTC+06:00, no DST). The server `SET TIME ZONE`
  on every Postgres connection so `DATE_TRUNC('month', NOW())` resolves
  in that zone; the client renders dates via `formatInAppTz` from
  [`lib/formatDate.ts`](../apps/web/src/lib/formatDate.ts). Per-space
  timezone override is not yet implemented.
- **Testing** — no automated test suite yet. Trigger correctness is
  critical and should get integration tests first.
- **Splitwise-style per-user splits** — a single shared-space
  transaction has no per-member split. Tracked here for visibility;
  requires a `transaction_splits` table or equivalent.

---

## 18. File map (where to look)

```
apps/server/src/
├── db/kysely/
│   ├── migrations/         # all schema history (0001–050)
│   ├── migrator.mts        # applies migrations on pnpm migrate
│   └── types.mts           # kysely-codegen output — don't hand-edit
├── procedures/
│   ├── account/            # create, update, delete, list*, share/unshare,
│   │                       # addMember/removeMember/listUsers (account ACL)
│   ├── allocation/
│   │   ├── transfer.mts    # two-upsert transfer between two envelopes
│   │   └── utils/resolveSpaceUnallocated.mts
│   ├── analytics/          # all read-only read models (see §12)
│   ├── auth/               # signup, login, password reset
│   ├── envelop/            # create|update|delete|archive|listBySpace,
│   │                       # createAllocation (accumulating upsert),
│   │                       # listAllocationsBySpace,
│   │                       # utils/{periodWindow, resolveEnvelopePeriodBalance,
│   │                       # resolveEnvelopActive}
│   ├── event/              # create, update, delete, listBySpace, close/reopen
│   ├── expenseCategory/    # create, update, delete, changeParent,
│   │                       # listBySpace, listBySpaceWithUsage
│   ├── file/               # createUploadUrl, confirm, delete, getDownloadUrl,
│   │                       # attach, listForTransaction, listForEvent,
│   │                       # removeFromTransaction, shared.mts (limits)
│   ├── personal/           # cross-space twins of analytics + transaction procedures
│   │                       # (see §6.5 and §12)
│   ├── pin/                # transaction-entry default pins (Account/Envelope/Event)
│   ├── space/              # create, update, delete, list, memberList,
│   │                       # addMembers, removeMember, changeMemberRole, leave,
│   │                       # sendInvite, listInvites, revokeInvite,
│   │                       # inviteInfo (public), acceptInvite (§6.6),
│   │                       # utils/resolveSpaceMembership
│   ├── transaction/        # income, expense, transfer, adjust, update,
│   │                       # delete, list, filteredTotals
│   └── user/               # updateAvatar, updateProfile, changeEmail,
│                           # changePassword, deleteAccount (§6.7)
├── routers/                # one file per feature, composes procedures
│                           # (auth, space, account, event, envelop,
│                           # expenseCategory, transaction, allocation,
│                           # analytics, file, user, personal, pin, health)
├── services/
│   ├── mail/
│   │   ├── mailer.mts      # nodemailer transport
│   │   └── templates/      # React 19 JSX email templates rendered via
│   │                       # ReactDOMServer.renderToStaticMarkup
│   │                       # (signup verify, password reset, change-email,
│   │                       #  SpaceInviteEmail)
│   └── r2/client.mts       # @aws-sdk/client-s3 client + presigned URL helpers
├── trpc/                   # context, middlewares (public, authorized), auth.mts
│                           # (token-version-aware JWT verify)
├── bootstrap.mts           # Express + tRPC mount
└── index.mts               # entry

apps/web/src/
├── App.tsx, main.tsx
├── trpc.ts                 # cross-app type import
├── router/
│   ├── index.tsx, routes.ts, guards/  # ProtectedRoute, GuestOnlyRoute, PublicRoute
├── layouts/                # Root, Auth, AppShell, SpaceLayout
├── pages/
│   ├── AcceptInvitePage.tsx  # public /invite/:token
│   ├── DocsPage.tsx           # public /docs
│   ├── auth/               # login, signup steps, forgot-password steps
│   ├── app/                # space selector, profile, security, MyAccounts
│   └── space/              # overview, accounts, transactions, budgets,
│                           # budgets/month/:month, year/:year,
│                           # categories, events, analytics, settings
├── features/               # composed multi-component flows (accounts, allocations, transactions, spaces, invites)
├── components/
│   ├── ui/                 # shadcn primitives
│   └── shared/             # Orbit-specific shared pieces
│                           # (MoneyDisplay, EntityAvatar, UserAvatar,
│                           # PeriodSelector, DateRangePicker, PeriodChip,
│                           # charts/{Donut, DrillableDonut, MultiSeriesLineChart},
│                           # RoleBadge, ConfirmDialog, ...)
├── hooks/                  # usePeriod, useCurrentSpace, useFileUpload,
│                           # useSignedUrl, ...
├── lib/                    # dates (incl. APP_TZ getters), money, entityStyle,
│                           # entityIcons, formatDate (formatInAppTz),
│                           # spendHeatmapColor, personalSpace, utils, permissions
├── stores/                 # MobX (Auth, Signup, ForgotPassword)
└── index.css               # theme + preflight overrides
```

---

## 19. Quick reference — "where does X live?"

- **I want to compute this envelope's remaining** →
  `resolveEnvelopePeriodBalance({trx, envelopId, at?})`.
- **I want to know if a space is over-allocated** →
  `resolveSpaceUnallocated({spaceId})` (signed; negative = over).
- **I want to show money** → `<MoneyDisplay amount={…} variant=… />`.
- **I want to pick a period** → `<PeriodSelector />` + `usePeriod()`.
- **I want a color for a new entity in the UI when the server hasn't given
  one yet** → `colorForId(id)`.
- **I want to route to …** → `ROUTES.*(...)` helpers.
- **I want to add a procedure** — put it in
  `procedures/<resource>/<action>.mts`, wire into `routers/<resource>.mts`.
  Re-run `pnpm --filter backend generate-types` after any schema change.

---

*End of spec. When in doubt, read the code path from the entry point down.*
