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
const PEER_REFRESH_WAIT_MS = 250;
const PEER_REFRESH_JITTER_MS = 250;

export type SessionEvent =
    | { type: 'logout'; at: number; id: string }
    | { type: 'logout-confirmed'; id: string }
    | { type: 'logout-failed'; id: string }
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
/** In-memory copy of the pending-logout id, used if storage is unavailable. */
let pendingFallbackId: string | null = null;
let storageBroken = false;
/** Logout this tab currently cares about; events for other ids are stale. */
let currentLogoutId: string | null = null;

export const currentGeneration = (): number => generation;

const newLogoutId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Id of the logout whose server revocation is not confirmed yet, if any.
 * localStorage is the cross-tab source of truth; the in-memory copy is used
 * only when storage is unusable (blocked, private mode), so a marker cleared
 * by another tab is never resurrected from a stale local copy.
 */
export function pendingLogoutId(): string | null {
    if (storageBroken) return pendingFallbackId;
    try {
        return localStorage.getItem(PENDING_KEY);
    } catch {
        storageBroken = true;
        return pendingFallbackId;
    }
}

export const hasPendingLogout = (): boolean => pendingLogoutId() !== null;

function setPendingLogout(id: string): void {
    pendingFallbackId = id;
    try {
        localStorage.setItem(PENDING_KEY, id);
    } catch {
        storageBroken = true;
    }
}

function clearPendingLogout(): void {
    pendingFallbackId = null;
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
    // A newer session supersedes any logout still waiting to be revoked: the
    // queued revocation sees the marker gone and never touches the new cookie.
    currentLogoutId = null;
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
export const announceLogoutFailed = (id: string): void =>
    post({ type: 'logout-failed', id });

function parseEvent(data: unknown): SessionEvent | null {
    if (typeof data !== 'object' || data === null) return null;
    const { type, at, id } = data as {
        type?: unknown;
        at?: unknown;
        id?: unknown;
    };
    switch (type) {
        case 'logout':
            return typeof at === 'number' && typeof id === 'string'
                ? { type, at, id }
                : null;
        case 'logout-confirmed':
        case 'logout-failed':
            return typeof id === 'string' ? { type, id } : null;
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
    // After a reload, adopt the persisted unconfirmed logout so that its
    // retry/confirmation events are not discarded as stale.
    currentLogoutId = pendingLogoutId();
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
                currentLogoutId = event.id;
                removeToken();
                handlers.onRemoteLogout();
                break;
            case 'logout-confirmed':
                if (event.id === currentLogoutId) handlers.onLogoutConfirmed();
                break;
            case 'logout-failed':
                if (event.id === currentLogoutId) handlers.onLogoutFailed();
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

/**
 * Local logout: invalidate in-memory state first, then tell the other tabs.
 * Returns the id identifying this logout's pending revocation.
 */
export function beginLocalLogout(): string {
    const id = newLogoutId();
    generation += 1;
    signedOut = true;
    currentLogoutId = id;
    removeToken();
    setPendingLogout(id);
    post({ type: 'logout', at: Date.now(), id });
    return id;
}

/** Whether `id` is still the logout awaiting revocation (not superseded). */
export const isLogoutPending = (id: string): boolean =>
    pendingLogoutId() === id;

/**
 * Revocation `id` confirmed by the server. Clears the marker only if it still
 * belongs to `id`, so a late confirmation never erases a newer logout's marker.
 */
export function confirmLogout(id: string): boolean {
    if (!isLogoutPending(id)) return false;
    clearPendingLogout();
    post({ type: 'logout-confirmed', id });
    return true;
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

// --- Cross-tab lock ----------------------------------------------------------

export class SessionLockTimeoutError extends Error {
    constructor() {
        super('Session lock unavailable');
        this.name = 'SessionLockTimeoutError';
    }
}

/**
 * What to do when the lock cannot be obtained in time (a holder is stuck):
 * - `recoverable`: the operation has its own recovery strategy (refresh keeps
 *   a controlled retry), so it may proceed unlocked.
 * - `exclusive`: the operation replaces or clears the shared cookie (login,
 *   verify, logout, reset-password). It is NEVER run unlocked: it fails with
 *   `SessionLockTimeoutError` and the caller reports a controlled failure
 *   (login form error / logout stays unconfirmed with a retry).
 */
export type LockPolicy = 'recoverable' | 'exclusive';

const LEASE_KEY = 'magnotes:session-lease';
let lockTimings = {
    /** Max wait for the lock before the policy applies. */
    waitMs: 20_000,
    /** Lease lifetime without Web Locks; auto-expires, never permanent. */
    leaseMs: 30_000,
    /** Pause between writing a lease claim and confirming ownership. */
    settleMs: 25,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readLease(): { owner: string; until: number } | null {
    try {
        const raw = localStorage.getItem(LEASE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { owner?: unknown; until?: unknown };
        return typeof parsed.owner === 'string' &&
            typeof parsed.until === 'number'
            ? { owner: parsed.owner, until: parsed.until }
            : null;
    } catch {
        return null;
    }
}

/**
 * Fallback mutex for browsers without Web Locks: a time-limited lease in
 * localStorage (claim, settle, confirm). It carries no secret. Without usable
 * storage either, operations are only ordered by their own claims in this tab
 * (cross-tab exclusion is then impossible; documented limitation).
 * Returns a release function, or null if the wait expired.
 */
async function acquireLease(): Promise<(() => void) | null> {
    const owner = newLogoutId();
    const deadline = Date.now() + lockTimings.waitMs;
    for (;;) {
        const current = readLease();
        if (!current || current.until <= Date.now()) {
            try {
                localStorage.setItem(
                    LEASE_KEY,
                    JSON.stringify({
                        owner,
                        until: Date.now() + lockTimings.leaseMs,
                    })
                );
            } catch {
                return () => undefined; // storage unusable: nothing to coordinate on
            }
            await sleep(lockTimings.settleMs);
            if (readLease()?.owner === owner) {
                return () => {
                    if (readLease()?.owner === owner) {
                        try {
                            localStorage.removeItem(LEASE_KEY);
                        } catch {
                            // lease simply expires
                        }
                    }
                };
            }
        }
        if (Date.now() >= deadline) return null;
        await sleep(
            lockTimings.settleMs + Math.random() * lockTimings.settleMs
        );
    }
}

/**
 * Run `task` while holding the cross-tab lock (Web Locks when available, else
 * the localStorage lease). See `LockPolicy` for the timeout behaviour.
 */
export async function withSessionLock<T>(
    task: () => Promise<T>,
    policy: LockPolicy
): Promise<T> {
    const unavailable = (): Promise<T> =>
        policy === 'recoverable'
            ? task()
            : Promise.reject(new SessionLockTimeoutError());

    const locks =
        typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks?.request) {
        const release = await acquireLease();
        if (!release) return unavailable();
        try {
            return await task();
        } finally {
            release();
        }
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), lockTimings.waitMs);
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
            return unavailable();
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/** Test hook: shorten the lock timings. */
export function __setLockTimingsForTests(
    timings: Partial<typeof lockTimings>
): void {
    lockTimings = { ...lockTimings, ...timings };
}

/** Test hook: reset module state between tests. */
export function __resetSessionCoordinatorForTests(): void {
    channel?.close();
    channel = null;
    refreshedWaiters.clear();
    generation = 0;
    signedOut = false;
    sessionStartedAt = 0;
    pendingFallbackId = null;
    storageBroken = false;
    currentLogoutId = null;
    lockTimings = { waitMs: 20_000, leaseMs: 30_000, settleMs: 25 };
}
