import { makeAutoObservable, runInAction } from "mobx";
import { clearDatePin } from "@/features/transactions/useDatePin";

const TOKEN_KEY = "auth_token";

export interface AuthUser {
    id: string;
    email: string;
    name: string;
    avatarFileId?: string;
}

/**
 * AuthStore
 *
 * Single source of truth for authentication state.
 * Persists the token in localStorage so it survives page refreshes.
 */
export class AuthStore {
    token: string | null = null;
    user: AuthUser | null = null;
    isLoading = true; // true while rehydrating from storage
    // True for the span of a mutation that rotates the token server-side
    // (e.g. changePassword bumps token_version). Requests already in
    // flight on the old token will 401 during this window even though
    // the session is fine — the global error handler should ignore them.
    isRotatingToken = false;

    constructor() {
        makeAutoObservable(this);
        this.rehydrate();
    }

    // ── Computed ────────────────────────────────────────
    get isAuthenticated() {
        return this.token !== null && this.user !== null;
    }

    // ── Actions ─────────────────────────────────────────

    /** Called once on startup to restore a persisted session. */
    private rehydrate() {
        const storedToken = localStorage.getItem(TOKEN_KEY);
        if (storedToken) {
            // In a real app you'd validate/refresh the token here.
            runInAction(() => {
                this.token = storedToken;
                // Restore user from storage or re-fetch from API.
                const raw = localStorage.getItem("auth_user");
                this.user = raw ? (JSON.parse(raw) as AuthUser) : null;
                this.isLoading = false;
            });
        } else {
            runInAction(() => {
                this.isLoading = false;
            });
        }
    }

    /** Call this after a successful login API response. */
    setAuth(token: string, user: AuthUser) {
        this.token = token;
        this.user = user;
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem("auth_user", JSON.stringify(user));
    }

    /**
     * Replace just the token (e.g. after a password change rotates the
     * server-side token version and invalidates the current JWT).
     */
    setToken(token: string) {
        this.token = token;
        localStorage.setItem(TOKEN_KEY, token);
    }

    setRotatingToken(value: boolean) {
        this.isRotatingToken = value;
    }

    /** Patch the current user's avatar file id in place. */
    setAvatarFileId(fileId: string | null) {
        if (!this.user) return;
        this.user = { ...this.user, avatarFileId: fileId ?? undefined };
        localStorage.setItem("auth_user", JSON.stringify(this.user));
    }

    /** Call this on logout. */
    clearAuth() {
        this.token = null;
        this.user = null;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem("auth_user");
        /* The kept entry date is per-person, not per-browser: on a shared
           machine the next user's first entry would otherwise be back-dated to
           whatever day the previous one was backfilling. */
        clearDatePin();
    }
}
