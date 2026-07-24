# event module (server)

> Per-space event CRUD with active/closed lifecycle, optional budget estimate, and file attachments. Transactions can be tagged with an `event_id`; deletion unlinks tagged transactions rather than cascading.

## Router

- File: `apps/server/src/routers/event.mts:9`
- Procedures:
    - `listBySpace` — list every event in a space, newest start first.
    - `getById` — single-row fetch by event id (NOT_FOUND on miss).
    - `create` — insert event + attach uploaded files atomically.
    - `update` — partial update; refuses empty patches and keeps `end_time > start_time` even when only one bound is supplied.
    - `delete` — hard-delete; reports the count of transactions whose `event_id` was nulled.
    - `setStatus` — flip between `active` and `closed`; sets/clears `closed_at`.

## Procedures

- **`listEventsBySpace`** (`procedures/event/listBySpace.mts:8`) — `authorizedProcedure`. Input `{ spaceId }`. Requires owner/editor/viewer membership (`listBySpace.mts:21`). Returns all columns of `events` (`id, space_id, name, start_time, end_time, color, icon, description, estimated_amount, status, closed_at, created_at`) ordered `start_time DESC` (`listBySpace.mts:41`). Returns `[]` on error fallback (`listBySpace.mts:56`).

- **`getEventById`** (`procedures/event/getById.mts:11`) — `authorizedProcedure`. Input `{ eventId }`. Loads the row first, then verifies the caller is a member of `event.space_id` with any role (`getById.mts:46`). Throws `NOT_FOUND` if missing.

- **`createEvent`** (`procedures/event/create.mts:11`) — `authorizedProcedure`, mutation, wrapped in a Kysely transaction (`create.mts:32`). Input fields: `spaceId`, `name` (1-255), `startTime`, `endTime` (Zod refines `endTime > startTime` at `create.mts:25`), optional `color` (HEX `^#[0-9a-fA-F]{6}$`), `icon` (1-48 chars), `description` (≤2000), `estimatedAmount` (non-negative, ≤1e10, nullish), `attachmentFileIds` (≤10 UUIDs). Membership gate: owner OR editor only (`create.mts:33`). Inserts into `events`, then calls `attachFilesToEvent` (`create.mts:68`) to bind any pre-uploaded files. Returns the new row.

- **`updateEvent`** (`procedures/event/update.mts:11`) — `authorizedProcedure`, mutation, transaction-wrapped. All fields optional but at least one must be present (Zod refine, `update.mts:25`). `description` and `estimatedAmount` accept `null` to clear. Loads current row, enforces owner/editor membership, re-checks `endTime > startTime` against merged values (`update.mts:62`), then updates; finally calls `attachFilesToEvent` with `addAttachmentFileIds` (additive — no detach path here).

- **`deleteEvent`** (`procedures/event/delete.mts:8`) — `authorizedProcedure`. Input `{ eventId }`. Output declared via `.output(...)` (`delete.mts:14`) as `{ message, unlinkedTransactionCount }`. Counts linked transactions before delete (`delete.mts:47`) so the client toast can read "N transactions unlinked"; the FK `transactions.event_id` is `ON DELETE SET NULL` (per migration 0013 line 25-27), so transactions survive. Requires owner/editor.

- **`setEventStatus`** (`procedures/event/setStatus.mts:9`) — `authorizedProcedure`. Input `{ eventId, status: "active" | "closed" }`. Idempotent: if `current.status === input.status`, returns the row without writes (`setStatus.mts:42`) — prevents redundant "Close" clicks from rewriting `closed_at` to `NOW()`. On transition to `closed`, sets `closed_at = NOW()` (`setStatus.mts:67`); on transition to `active`, sets `closed_at = NULL`.

## Database tables

### `events` (migrations `0011`, `022`, `038`)

Created by `0011_create_events_table.mts:5` with:

- `id uuid PK default uuidv7()`
- `space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE cascade` (`0011:7`)
- `name varchar(255) NOT NULL`
- `start_time timestamptz NOT NULL`, `end_time timestamptz NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT NOW()`
- CHECK `events_time_check`: `end_time > start_time` (`0011:14`)

Migration `022_add_colors_and_icons.mts` adds `color`, `icon` (defaulted), and `description text NULL`.

Migration `038_event_lifecycle_and_estimate.mts:17` adds:

- `status text NOT NULL DEFAULT 'active'` (`038:19`)
- `estimated_amount numeric(14, 2) NULL` (`038:20`)
- `closed_at timestamptz NULL` (`038:21`)
- CHECK `events_status_check`: `status IN ('active', 'closed')` (`038:26`)
- CHECK `events_estimated_amount_check`: `estimated_amount IS NULL OR estimated_amount >= 0` (`038:32`)
- Partial index `idx_events_space_status_active` on `(space_id, start_time DESC) WHERE status = 'active'` (`038:40`) — keeps the transaction-entry picker fast as old closed events accumulate.

### `event_attachments` (migration `029_add_attachment_tables.mts:31`)

Many-to-many between events and files. Composite PK `(event_id, file_id)` (`029:39`); both FKs `ON DELETE cascade`. Secondary index on `file_id` for reverse lookup (`029:43`).

Generated types: `Events` at `db/kysely/types.mts:98`, `EventAttachments` at `db/kysely/types.mts:92`.

## Conventions & gotchas

- The `events.status` field is text + CHECK, not a Postgres enum. Migration `038` notes this is deliberate so adding `'archived'` later is a one-line constraint update (`038:14`).
- The partial index only covers `status = 'active'`. The transaction-entry picker is the hot read path; admin lists that include closed events do a full scan (acceptable, low cadence).
- Status is per-event-only; closed events still appear in analytics, lists, and historical transaction filters (per the comment block at `038:6`). Don't filter them out unconditionally on the server.
- Delete is a hard delete. There is no soft-delete; if you need "history without the row" use `setStatus: closed` instead.
- `updateEvent` only adds attachments; it does not remove them. A separate detach path (not in this module) is needed if you ever build "remove receipt" UI.
- `resolveEventBelongsToSpace` (`procedures/event/utils/resolveEventBelongsToSpace.mts:5`) is used by the transaction module to verify the `eventId` foreign-key target lives in the right space — keep it side-effect-free. It also takes an opt-in `requireActive?: boolean` flag that rejects non-`active` events; the four creation paths set this, `update.mts` does not (so legacy rows with now-closed events stay editable).
- Closed events are deliberately preserved in `space_pin` rows — pin lookups (`procedures/pin/listBySpace.mts:74`) JOIN-filter `events.status = 'active'` so the client reads "no pin" when the event closes, but the row itself is kept for the audit history. See the pin module doc.

## Cross-references

- `analytics.eventTotals` (`procedures/analytics/eventTotals.mts:9`) — per-event spend/income aggregates, returns `estimated_amount`, `status`, `closed_at` alongside totals. Documented in the analytics module.
- `analytics.eventCategoryBreakdown` (`procedures/analytics/eventCategoryBreakdown.mts`) — per-leaf-category sums for a single event. Documented in the analytics module.
- `analytics.eventDailySpend` (`procedures/analytics/eventDailySpend.mts:20`) — per-APP_TZ-day expense/income totals for one event; powers the spend-timeline and day-of-week strip on the event detail page. Documented in the analytics module.
- `analytics.eventTopLocations` (`procedures/analytics/eventTopLocations.mts:13`) — top spending locations for one event (case-insensitive grouping on trimmed `location`); powers the "Where it went" section. Documented in the analytics module.
- Transaction create/update procedures call `resolveEventBelongsToSpace` and write `transactions.event_id` (`procedures/transaction/expense.mts:68`, `transfer.mts:77`, `income.mts:50`). See the transaction module doc.
- File attachment plumbing: `procedures/file/attach.mts` exposes `attachFilesToEvent` (used at `create.mts:68` and `update.mts:100`).
