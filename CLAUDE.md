# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & Monorepo Layout

Turborepo + pnpm workspace (`pnpm-workspace.yaml`) with two apps:

- `apps/server` — Node.js + Express + **tRPC v11** backend. ESM-only (`.mts`/`.mjs`), compiled by `tsc` to `dist/`.
- `apps/web` — Vite + React 19 + React Router v7 frontend. Uses TanStack Query, `@trpc/react-query`, and MobX for global auth/signup state.

Shared packages live in `packages/` (`eslint-config`, `typescript-config`, `ui`) but are currently lightweight stubs — product code is in `apps/`.

The workspace is typically run via `docker-compose` (service `orbit` runs `pnpm dev`), which also brings up `db` (Postgres 18), `maildev` (SMTP on 1025, UI on 1080), and `metabase` (on 3001). The `.env.local` at the repo root is the env file docker-compose loads.

## Common Commands

Run from the repo root unless noted:

```bash
pnpm dev              # turbo run dev — starts server + web concurrently
pnpm build            # turbo run build
pnpm check-types      # turbo run check-types
pnpm lint             # turbo run lint
pnpm format           # prettier --write on ts/tsx/md

# Server-only (from apps/server/)
pnpm migrate          # tsx src/db/kysely/migrator.mts — runs Kysely migrations up
pnpm generate-types   # kysely-codegen → src/db/kysely/types.mts (run after schema changes)
pnpm seed             # tsx src/db/kysely/seed.mts — wipes + seeds local DB with ~800 demo txns
pnpm build:watch      # tsc --watch (dev uses this + nodemon)

# Web-only (from apps/web/)
pnpm dev              # vite --host on port 5173
pnpm build            # tsc -b && vite build
pnpm lint             # eslint .
pnpm generate-icons   # regenerates src/lib/icons/*.generated.json (emoji dataset + Lucide search tags); needs network
```

The server dev loop is: `tsc --watch` writes to `dist/`, nodemon (watching `./dist`) restarts Node. Source lives in `.mts`, output is `.mjs`.

## Server Architecture

**Entry point:** `apps/server/src/index.mts` — awaits `run_bootstrap()`, mounts tRPC at `/trpc` via `trpcExpress.createExpressMiddleware`, and in dev also exposes `trpc-playground` at `/trpc-playground`.

**Router tree:** `apps/server/src/routers/index.mts` composes feature routers (`auth`, `space`, `account`, `event`, `envelop`, `expenseCategory`, `transaction`, `allocation`, `analytics`, `file`, `user`, `personal`, `pin`, `health`). Each feature router in `routers/<name>.mts` imports procedures from `procedures/<name>/<action>.mts` — this one-procedure-per-file convention is the norm; follow it for new endpoints. The `personal.*` router powers the virtual "My money" space at `/s/me` — every analytics procedure has a cross-space personal twin; see project spec §6.5 and engineering spec §5.6. The `pin.*` router (migrations 043+044) stores transaction-entry defaults — Account is per-user-per-space, Envelope/Event are space-wide; see `contexts/modules/server/pin.md`.

**Context & auth:** `trpc/context.mts` builds the per-request context by (1) verifying the JWT from the `Authorization` header via `trpc/auth.mts` and (2) injecting a singleton `services` object (created once at module load). Context shape: `{ auth: { user }, services: { pgPool, qb, mailer } }`.

**Procedure middlewares** (`trpc/middlewares/`):
- `public.mts` — base procedure for unauthenticated endpoints.
- `authorized.mts` — chains `mutationLoggerMiddleware` + an auth guard that throws `UNAUTHORIZED` if `ctx.auth.user` is null; narrows `user` to `AuthenticatedUser` in downstream ctx. Use `authorizedProcedure` for anything that requires a logged-in user.

**Database:** Postgres via `pg.Pool` + **Kysely** query builder. `services.qb` is the typed `Kysely<DB>` instance; `DB` is code-generated into `src/db/kysely/types.mjs` — **never hand-edit that file**, regenerate it with `pnpm generate-types` after a migration changes the schema.

**Migrations:** `src/db/kysely/migrations/NNNN_name.mts` using Kysely's `FileMigrationProvider`. Template in `migration-template.mts`. The `migrator.mts` script applies them; `bootstrap.mts` currently leaves the auto-up-on-start call commented out, so migrations are applied manually via `pnpm migrate`.

**Transactions & errors:** Procedures that mutate multiple tables use `ctx.services.qb.transaction().execute(trx => ...)` wrapped in the `safeAwait` helper (`utils/safeAwait.mts`) which returns `[error, result]` tuples. Re-throw `TRPCError` as-is; wrap other errors as `INTERNAL_SERVER_ERROR`. See `procedures/account/create.mts` for the canonical pattern.

**ESM import rule:** Because the server is pure ESM compiled from `.mts`, **imports between source files must use the `.mjs` extension** (e.g., `import { router } from "../trpc/index.mjs"`), even though the file on disk is `.mts`. TypeScript resolves these correctly; the runtime needs the `.mjs`.

**Env:** `src/env.mts` uses `@withtahmid/safenv` to parse `process.env` with defaults. Always read config through the exported `ENV` object, not `process.env` directly.

## Web Architecture

**Entry:** `src/main.tsx` → `src/App.tsx` wires `trpc.Provider` + `QueryClientProvider` + `StoreProvider` + `RouterProvider` (in that order).

**End-to-end types:** `apps/web/src/trpc.ts` imports `AppRouter` directly from `../../server/src/routers/index.mjs` (cross-app relative import). Changes to server procedure inputs/outputs are immediately visible in the web app's types — no codegen step. `RouterInput` / `RouterOutput` helpers are exported from the same file.

**Auth token:** The tRPC client's `httpBatchLink` reads from `localStorage` on every request, trying `auth_token` → `signup_token` → `password_reset_token` (in that order). Signup and password-reset flows use short-lived tokens stored under their own keys during multi-step flows.

**Routing:** See `contexts/router-context.md` for the full patterns guide. Short version:
- All routes declared in `src/router/index.tsx` with three guards: `PublicRoute`, `GuestOnlyRoute` (redirects logged-in users away), `ProtectedRoute` (redirects guests to `/login?from=...`).
- Never hardcode paths in components — use the `ROUTES` constant from `src/router/routes.ts`.
- `@/*` path alias maps to `src/*` (configured in both `vite.config.ts` and `tsconfig`).

**State:** MobX stores under `src/stores/` (`AuthStore`, `SignupStore`, `ForgotPasswordStore`, `RootStore`). `AuthStore` persists the token to `localStorage` and rehydrates on startup; `ProtectedRoute` waits on `isLoading` to avoid a flash-of-redirect.

## Conventions

- **Prettier** (`.prettierrc`): 4-space indent, double quotes, semicolons, 100-char print width, `trailingComma: "es5"`. Run `pnpm format` before committing larger changes.
- **Commit style:** short imperative prefix like `FEAT:`, `FIX:`, etc. (see `git log`).
- **One procedure per file** under `procedures/<resource>/<action>.mts`; the feature router just re-exports them.
- **Don't commit `types.mts`** edits by hand — regenerate after migrations.
- **APP_TZ-aware date math (web):** `apps/web/src/lib/dates.ts` exports `getAppTzYear/Month/Date/Day/Hours/Minutes`, `makeAppTzDate`, and `addMonthsClamped` (alongside `addMonths`, `startOfDay`, etc.) — use these when reading or constructing wall-clock fields from an absolute `Date`. Native `Date.getHours()` / `setFullYear()` use the **browser's** local tz, which silently drifts the displayed and committed value for any user outside Asia/Dhaka. The transaction date picker (`features/transactions/TransactionDatePicker.tsx`) demonstrates the pattern; the `fromInputDateTime`/`toInputDateTime` round-trip stays the boundary with the form's `datetime-local` string shape.
- **Entity icons are a Lucide key _or_ an emoji string.** The persisted `icon` column holds either a curated key from `apps/web/src/lib/entityIcons.ts` or a raw emoji (`"🍕"`, skin tones included). Always render through `getIcon(name)` — never index `ENTITY_ICONS` directly — so both kinds work. Lucide keys are persisted: append, never rename/remove, and put each key in exactly one category. After adding icons run `pnpm generate-icons` (from `apps/web/`) — it rebuilds the search tags and asserts the registry invariants. `src/lib/icons/*.generated.json` are generated; don't hand-edit them. See `contexts/modules/web/icons.md`.
- **Event create paths reject closed events:** `resolveEventBelongsToSpace` takes an opt-in `requireActive?: boolean`. Pass `true` from any new create path that accepts an `eventId`; `update.mts` deliberately leaves it false so existing rows with now-closed events remain editable.
