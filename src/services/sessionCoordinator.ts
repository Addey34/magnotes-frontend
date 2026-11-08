import { removeToken, setTokens } from '../utils/tokenUtils';

/**
 * Cross-tab session coordination.
 *
 * Security model (unchanged): access tokens live only in memory, refresh tokens
 * only in an HttpOnly cookie. Nothing in this module ever reads, stores or
 * broadcasts a token. The BroadcastChannel carries *coordination events only*
 * (`logout`, `logout-confirmed`, `logout-failed`, `refreshed`); the only
 * thing persisted is a non-secret "logout not confirmed yet" marker.
 *
 * Tabs share one cookie jar, so refreshes are serialised across tabs with the
 * Web Locks API (each tab still needs its own in-memory access token, hence
 * each tab refreshes, one at a time, always with the freshest cookie).
 */

const CHANNEL_NAME = 'magnotes-session';
const LOCK_NAME = 'magnotes-session-lock';
const PENDING_KEY = 'magnotes:logout-pending';
/** Longer than the HTTP timeout of the operation holding the lock. */
export const LOCK_WAIT_MS = 20_000;
const PEER_REFRESH_WAIT_MS = 250;
const PEER_REFRESH_JITTER_MS = 250;

export type SessionEvent =
    | { type: 'logout'; at: number }
    | { type: 'logout-confirmed' }
    | { type: 'logout-failed' }
    | { type: 'refreshed' };

export interface CoordinationHandlers {
    /** Another tab logged out: leave the authenticated UI immediately. */
    onRemoteLogout: () => void;
    /** Revocation finished (any tab): the server confirmed it. */
    onLogoutConfirmed: () => void;
    /** Revocation failed in the tab that started the logout. */
    onLogoutFailed: () => void;
}

// --- local session state ----------------------------------------------------

/** Bumped on every login/logout; stale async results compare against it. */
let generation = 0;
/** True after a logout (local or remote) until a new login. */
let signedOut = false;
/** When the current session started; older logout events are ignored. */
let sessionStartedAt = 0;
let pendingFallback = false;

export const currentGeneration = (): number => generation;

export function hasPendingLogout(): boolean {
    try {
        return localStorage.getItem(PENDING_KEY) !== null || pendingFallback;
    } catch {
        return pendingFallback;
    }
}

function setPendingLogout(): void {
    pendingFallback = true;
    try {
        localStorage.setItem(PENDING_KEY, String(Date.now()));
    } catch {
        // Storage unavailable: the in-memory flag still protects this tab.
    }
}

function clearPendingLogout(): void {
    pendingFallback = false;
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch {
        // ignore
    }
}

/** A silent refresh is forbidden while signed out or logout is unconfirmed. */
export const refreshAllowed = (): boolean => !signedOut && !hasPendingLogout();

/** Start an authenticated session (login/verify). */
export function startSession(token: string): void {
    generation += 1;
    signedOut = false;
    sessionStartedAt = Date.now();
    clearPendingLogout();
    setTokens(token);
}

/** Adopt a token obtained by a refresh, if nothing changed meanwhile. */
export function adoptRefreshedToken(token: string, gen: number): boolean {
    if (gen !== generation || !refreshAllowed()) return false;
    setTokens(token);
    if (sessionStartedAt === 0) sessionStartedAt = Date.now();
    return true;
}

// --- BroadcastChannel -------------------------------------------------------

let channel: BroadcastChannel | null = null;
const refreshedWaiters = new Set<() => void>();

function post(event: SessionEvent): void {
    try {
        channel?.postMessage(event);
    } catch {
        // A closed channel must never break the session flow.
    }
}

export const announceRefreshed = (): void => post({ type: 'refreshed' });
export const announceLogoutConfirmed = (): void =>
    post({ type: 'logout-confirmed' });
export const announceLogoutFailed = (): void => post({ type: 'logout-failed' });

function parseEvent(data: unknown): SessionEvent | null {
    if (typeof data !== 'object' || data === null) return null;
    const { type, at } = data as { type?: unknown; at?: unknown };
    switch (type) {
        case 'logout':
            return typeof at === 'number' ? { type, at } : null;
        case 'logout-confirmed':
        case 'logout-failed':
        case 'refreshed':
            return { type };
        default:
            return null;
    }
}

/**
 * Open the (single) channel for this tab. The returned disposer closes it;
 * calling this twice (React StrictMode) replaces the previous channel instead
 * of stacking listeners.
 */
export function startSessionCoordination(
    handlers: CoordinationHandlers
): () => void {
    channel?.close();
    if (typeof BroadcastChannel === 'undefined') {
        channel = null;
        return () => undefined;
    }
    const own = new BroadcastChannel(CHANNEL_NAME);
    channel = own;
    own.onmessage = (message: MessageEvent) => {
        const event = parseEvent(message.data);
        if (!event) return;
        switch (event.type) {
            case 'logout':
                // An old event must not end a session started after it.
                if (event.at < sessionStartedAt) return;
                generation += 1;
                signedOut = true;
                removeToken();
                handlers.onRemoteLogout();
                break;
            case 'logout-confirmed':
                handlers.onLogoutConfirmed();
                break;
            case 'logout-failed':
                handlers.onLogoutFailed();
                break;
            case 'refreshed':
                refreshedWaiters.forEach((wake) => wake());
                break;
        }
    };
    return () => {
        own.onmessage = null;
        own.close();
        if (channel === own) channel = null;
        refreshedWaiters.clear();
    };
}

/** Local logout: invalidate in-memory state first, then tell the other tabs. */
export function beginLocalLogout(): void {
    generation += 1;
    signedOut = true;
    removeToken();
    setPendingLogout();
    post({ type: 'logout', at: Date.now() });
}

/** Revocation confirmed by the server. */
export function confirmLogout(): void {
    clearPendingLogout();
    announceLogoutConfirmed();
}

/** Resolve on a peer's `refreshed` event, or after a short jittered delay. */
export function waitForPeerRefresh(): Promise<void> {
    return new Promise((resolve) => {
        const wake = () => {
            clearTimeout(timer);
            refreshedWaiters.delete(wake);
            resolve();
        };
        const timer = setTimeout(
            wake,
            PEER_REFRESH_WAIT_MS + Math.random() * PEER_REFRESH_JITTER_MS
        );
        refreshedWaiters.add(wake);
    });
}

// --- Web Locks ---------------------------------------------------------------

/**
 * Run `task` while holding the cross-tab lock. Without Web Locks, or if the
 * lock cannot be obtained in time (stuck holder), the task runs unlocked: the
 * caller's single controlled retry then absorbs the race.
 */
export async function withSessionLock<T>(task: () => Promise<T>): Promise<T> {
    const locks =
        typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks?.request) return task();

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), LOCK_WAIT_MS);
    let acquired = false;
    try {
        return await locks.request(
            LOCK_NAME,
            { signal: abort.signal },
            async () => {
                acquired = true;
                clearTimeout(timer);
                return task();
            }
        );
    } catch (error) {
        if (!acquired && (error as Error)?.name === 'AbortError') {
            return task();
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/** Test hook: reset module state between tests. */
export function __resetSessionCoordinatorForTests(): void {
    channel?.close();
    channel = null;
    refreshedWaiters.clear();
    generation = 0;
    signedOut = false;
    sessionStartedAt = 0;
    pendingFallback = false;
}
