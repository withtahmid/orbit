# MobX stores

> Three domain stores (auth, signup, forgot-password) composed into a `RootStore` singleton, exposed through React context via `useStore()`.

## Components

- `apps/web/src/stores/AuthStore.ts` — token + user persistence, `isAuthenticated` derivation, rehydration on construct.
- `apps/web/src/stores/SignupStore.ts` — 3-step signup flow state + resend cooldown timer.
- `apps/web/src/stores/ForgotPasswordStore.ts` — same shape as `SignupStore` but for password reset.
- `apps/web/src/stores/RootStore.ts` — composes the three; exports `rootStore` singleton.
- `apps/web/src/stores/useStore.ts` — `StoreContext = createContext<RootStore>(rootStore)`, `StoreProvider = StoreContext.Provider`, `useStore()` hook.
- Wired in `apps/web/src/App.tsx:52` as `<StoreProvider value={rootStore}>` inside the `QueryClientProvider`.

There is no separate `providers/StoreProvider.tsx` — the provider lives in `stores/useStore.ts`.

## Flow

### Construction order (`RootStore.ts:11-24`)

```ts
constructor() {
    this.authStore = new AuthStore();          // rehydrates from localStorage synchronously
    this.signupStore = new SignupStore();      // restores `signup_token` if present
    this.forgotPasswordStore = new ForgotPasswordStore(); // restores `password_reset_token`
}
export const rootStore = new RootStore();
```

The singleton is constructed at module-load time, so `rootStore` is ready before React mounts.

### AuthStore (`AuthStore.ts`)

State: `token: string | null`, `user: AuthUser | null`, `isLoading: boolean` (default `true`).
`AuthUser = { id, email, name, avatarFileId? }`.

Methods:

- `rehydrate()` (private, called from constructor) — reads `localStorage["auth_token"]` and `localStorage["auth_user"]`. Sets `isLoading=false` either way (`AuthStore.ts:36-52`).
- `setAuth(token, user)` (`AuthStore.ts:55`) — writes both `auth_token` and `auth_user` JSON.
- `setAvatarFileId(fileId)` (`AuthStore.ts:63`) — patches `user.avatarFileId` and rewrites `auth_user`.
- `clearAuth()` (`AuthStore.ts:70`) — wipes both keys + in-memory state.

Computed `isAuthenticated` is `token !== null && user !== null` (`AuthStore.ts:29`). Guards in `router/guards/*.tsx` wait on `isLoading` before reading this so the first paint doesn't flash a redirect.

### SignupStore (`SignupStore.ts`)

State: `step: 1|2|3`, `email: string`, `signupToken: string | null`, `resendCooldown: number`, `cooldownInterval` (private setInterval handle).

Methods:

- Constructor restores `localStorage["signup_token"]` so refreshing mid-signup keeps the JWT.
- `setStep` / `setEmail` are plain setters.
- `setSignupToken(token)` mirrors to localStorage (set or remove).
- `startResendCooldown(seconds = 60)` (`SignupStore.ts:48`) starts a 1-Hz `setInterval` decrementing `resendCooldown`, clearing itself at 0. Always clears any existing interval first.
- `reset()` (`SignupStore.ts:70`) wipes step/email/token, removes the localStorage key, clears the interval. Called from `DetailsStep.onSuccess` after a successful `auth.signup.complete`.

### ForgotPasswordStore (`ForgotPasswordStore.ts`)

Structurally identical to `SignupStore`. The only differences:

- localStorage key is `password_reset_token` (vs `signup_token`).
- Token field is named `resetToken` (vs `signupToken`).
- `reset()` is called from `NewPasswordStep.onSuccess`.

### useStore (`useStore.ts`)

```ts
const StoreContext = createContext<RootStore>(rootStore);
export const StoreProvider = StoreContext.Provider;
export function useStore(): RootStore { return useContext(StoreContext); }
```

Default value is the singleton so consumers outside `<StoreProvider>` still get a working store (useful for tests / Storybook).

## Conventions & gotchas

- **MobX requires `observer()` wrapping** at every consumer. Pages and guards do `observer(function X() { … })`; if you forget, they won't re-render when `authStore.user` changes.
- **`AuthStore.isLoading` matters**: guards (`ProtectedRoute`, `GuestOnlyRoute`) return `<FullPageSpinner/>` while `isLoading === true`. If you ever change rehydration to be async (e.g. validate token against the server), the existing guard contract still holds.
- **`SignupStore`/`ForgotPasswordStore` tokens live in localStorage**, not in `AuthStore`. The tRPC client (`trpc.ts:9-22`) reads all three keys in priority order: `auth_token` → `signup_token` → `password_reset_token`. Leaving a stale signup token will hijack subsequent authed requests — always call `reset()` on completion.
- **`setInterval` cleanup**: the cooldown interval is cleared in `reset()` and also self-cancels at 0. Component unmounts do NOT clean it up — the store outlives the page. If you change the cooldown UX, make sure `reset()` still runs in the unmount path of the flow root component.
- **Singleton, not factory**: `rootStore` is exported as a value. Don't `new RootStore()` from inside a test without also re-providing it via `<StoreProvider value={...}>` — the `useStore()` default points to the exported singleton.
- **No `RootStore.root` back-reference yet**: the file comments mention "Stores can reference each other via `this.root`" but the implementation doesn't wire it. Cross-store calls go through the imported singleton (e.g. `DetailsStep` reads `useStore().authStore` and `useStore().signupStore` in the same component).

## Cross-references

- `./auth-flow.md` — how the three stores are read and written by the auth procedures.
- `./trpc-setup.md` — how the localStorage tokens become `Authorization` headers.
- `./routing.md` — `ProtectedRoute` / `GuestOnlyRoute` consume `authStore.isAuthenticated` + `isLoading`.
