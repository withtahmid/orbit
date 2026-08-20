# pin module (server)

> Transaction-entry defaults. A "pin" remembers the user's (or team's) usual selection for one of three fields — Account, Envelope, Event — so the new-transaction form pre-hydrates instead of starting empty. Hydrate-only: pins never auto-submit, they only pre-fill.

## Router

- File: `apps/server/src/routers/pin.mts:1`
- Procedures:
    - `listBySpace` — return the effective `{ account, envelop, event }` pin trio for the caller in one space.
    - `set` — pin one field to one entity (Zod discriminated union on `field`).
    - `clear` — unpin one field.

## Procedures

- **`listPinsBySpace`** (`procedures/pin/listBySpace.mts:20`) — `authorizedProcedure`. Input `{ spaceId }`. Membership gate: owner/editor/viewer (`listBySpace.mts:29`). Three independent queries against `user_space_pin` (account) and `space_pin` (envelope/event), each joined to the live entity and filtered:
    - Account: joined to `accounts` and `space_accounts` — only returns when the pinned account is still shared into the space.
    - Envelope: joined to `envelops` with `archived = false`; plus a defensive `envelops.space_id = input.spaceId` filter so a cross-space-id corruption can never leak.
    - Event: joined to `events` with `status = 'active'`; same defensive `space_id` filter.
      Any unreachable entity (archived, closed, unshared, deleted) returns `null` for that field — silent fallback to "no pin" without UI work. Returns `{ account, envelop, event }`, each `null` or `{ id, name, color, icon, ... }`.

- **`setPin`** (`procedures/pin/set.mts:20`) — `authorizedProcedure`, transaction-wrapped. Input is a Zod discriminated union on `field`:
    - `{ spaceId, field: "account", accountId }` — gate: any member (`set.mts:44`). Account must be in `space_accounts` for that space, else `BAD_REQUEST`. Upserts `user_space_pin` keyed on `(user_id, space_id, field)` via `onConflict([...]).doUpdateSet(...)` (`set.mts:79`).
    - `{ spaceId, field: "envelop", envelopId }` — gate: owner or editor (`set.mts:89`). Envelope must belong to the space and be `archived = false`. Upserts `space_pin` keyed on `(space_id, field)` (`set.mts:120`).
    - `{ spaceId, field: "event", eventId }` — same owner/editor gate. Event must belong to the space and be `status = 'active'`. Same `space_pin` upsert pattern with `envelop_id = NULL, event_id = X` (`set.mts:160`).
      Idempotent — re-pinning the same value is a touch of `updated_at`; re-pinning a different value replaces atomically via `ON CONFLICT DO UPDATE`. `set_by_user_id` is recorded for future attribution.

- **`clearPin`** (`procedures/pin/clear.mts:14`) — `authorizedProcedure`, transaction-wrapped. Input `{ spaceId, field }` where `field` is one of `"account" | "envelop" | "event"`. Scope inferred from `field`:
    - `field === "account"` → any-member gate (`clear.mts:25`), deletes from `user_space_pin` for `(user_id, space_id, "account")` (`clear.mts:37`).
    - `field === "envelop" | "event"` → owner/editor gate (`clear.mts:49`), deletes from `space_pin` for `(space_id, field)` (`clear.mts:57`).
      No-op when no row exists. Returns `{ ok: true }`.

## Database tables

Both tables introduced in migration `043_transaction_entry_pins.mts`. A shared Postgres enum `__type_transaction_entry_pin_field` (values: `account | envelop | event`, defined at `043:25-28`) types the `field` column on both tables.

### `user_space_pin` (`043:30-53`)

Per-user-per-space pins. The Account scope.

- Composite primary key: `(user_id, space_id, field)` (`043:50`).
- `user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade`.
- `space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE cascade`.
- `field __type_transaction_entry_pin_field NOT NULL`.
- `account_id uuid REFERENCES accounts(id) ON DELETE cascade` — nullable column, but the CHECK constraint `user_space_pin_field_account_only` (`043:51`) requires `field = 'account' AND account_id IS NOT NULL`, so in practice only Account pins land here.
- `created_at`, `updated_at` default `NOW()`.

### `space_pin` (`043:55-89`)

Space-wide pins shared across every member. The Envelope + Event scopes.

- Composite primary key: `(space_id, field)` (`043:79`).
- `space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE cascade`.
- `field __type_transaction_entry_pin_field NOT NULL`.
- `envelop_id uuid REFERENCES envelops(id) ON DELETE cascade` — nullable.
- `event_id uuid REFERENCES events(id) ON DELETE cascade` — nullable.
- `set_by_user_id uuid REFERENCES users(id) ON DELETE set null` — **nullable as of migration 044** (originally `NOT NULL` + `ON DELETE cascade` in 043; 044 relaxes both so a setter leaving the space doesn't drop the team pin).
- CHECK `space_pin_field_entity_match` (`043:81-87`): exactly one of `envelop_id` / `event_id` is non-null, matching the `field` value. Inserting an `event` pin with a non-null `envelop_id` (or vice versa) fails the check.
- `created_at`, `updated_at` default `NOW()`.

### Migration 044 — `set_by_user_id` SET NULL

`044_space_pin_set_by_set_null.mts` drops the `NOT NULL` and switches the FK from `ON DELETE cascade` to `ON DELETE set null`. Rationale: a team-wide envelope/event pin represents the team's default — losing it because the setter's account was deleted is a destructive misfeature. Now only the attribution is lost. The `down()` is defensive: tries owner → any member → any user to backfill before re-adding `NOT NULL`, and aborts loudly with a hard count check if any row is unrecoverable (`044:46-54`).

Generated types: `UserSpacePin` at `db/kysely/types.mts:285`, `SpacePin` at `db/kysely/types.mts:215`.

## Permissions

Matches the existing precedents (`procedures/event/create.mts:37` for owner-editor; `procedures/account/listBySpace.mts:31` for any-member). All gates resolve via `resolveSpaceMembership`.

| Action      | Account pin                                                                 | Envelope pin   | Event pin      |
| ----------- | --------------------------------------------------------------------------- | -------------- | -------------- |
| set         | any member                                                                  | owner / editor | owner / editor |
| clear       | any member                                                                  | owner / editor | owner / editor |
| listBySpace | any member (returns whatever exists; the per-field scope rules above apply) |

## Conventions & gotchas

- **The kept date is NOT one of these pins.** Transaction entry also remembers a calendar day, but that lives entirely client-side in `apps/web/src/features/transactions/useDatePin.ts` (`localStorage`, sliding 3h idle window) and deliberately never touches `user_space_pin` / `space_pin`. These three are durable _defaults_; a date is a _mode_ that expires with the entry sitting. The UI keeps them apart too — "Keep"/"Keeping" with a CalendarClock, not "Pin"/"Pinned". Don't add a fourth enum value for it.
- **Hydrate-only invariant.** The server never auto-applies pins to a transaction insert. The web form reads the pin trio on open, sets the field state, and the user reviews/submits. If you ever build a "quick-pin" API that does auto-submit, it should be a separate endpoint, not piggyback on pin storage.
- **Silent fallback when entities go away.** `listBySpace` filters archived envelopes / non-active events / unshared accounts at JOIN time — the pin row itself sticks around, but to the client the field reads as "no pin." Don't add a manual cleanup job; the FK `ON DELETE CASCADE` and the JOIN filter together cover deletion and "soft-archive" respectively.
- **Permission split between the two tables is load-bearing.** The shared enum + two-table split (rather than one table with nullable `user_id`) means the role gate in `set.mts` / `clear.mts` is uniformly `owner|editor` when the row lives in `space_pin` and `any-member` when it lives in `user_space_pin`. Don't merge the tables without redesigning the gate.
- **Personal space (`spaceId === "me"`)** is virtual — there is no real `spaces` row for it. The pin router will reject `"me"` outright via the membership check. The web layer skips pin queries entirely on `/s/me` (see `apps/web/src/features/transactions/usePins.ts:23`).
- **Editing a transaction does NOT touch pins.** `EditTransactionSheet` deliberately bypasses the pin hook — pins are a creation-time convenience, not an edit-time default. This matches the v3 product spec.

## Cross-references

- Web hook: `apps/web/src/features/transactions/usePins.ts` — `useQuery` on `pin.listBySpace`, plus optimistic-update mutations for `set` and `clear` that read entity details from the corresponding `account/envelop/event.listBySpace` caches.
- Web UI: `apps/web/src/features/transactions/PinControl.tsx` (pill button) and `FieldPin` adapter inside `NewTransactionSheet.tsx:922`. Envelope chip's "pinned" meta state lives at `NewTransactionSheet.tsx:1675-1703`. Pin hydration `useEffect` per sub-form (Income/Expense/Transfer/Adjustment).
- Related closed-event protection: `procedures/event/utils/resolveEventBelongsToSpace.mts` gained a `requireActive?` flag (see transaction + event module docs) so that create paths reject closed events even if the form's stale-event UI surfaces them.
