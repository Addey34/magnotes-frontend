import axios from 'axios';
import { getToken, isTokenExpired, removeToken } from '../utils/tokenUtils';
import { baseUrl } from './apiBase';
import { installAuthInterceptor } from './authInterceptor';
import {
    adoptRefreshedToken,
    announceLogoutFailed,
    announceRefreshed,
    beginLocalLogout,
    confirmLogout,
    currentGeneration,
    isLogoutPending,
    pendingLogoutId,
    refreshAllowed,
    startSession,
    waitForPeerRefresh,
    withSessionLock,
} from './sessionCoordinator';

const withCredentials = { withCredentials: true };

export interface AuthSession {
    token: string;
    user: { email: string; displayName: string; emailVerified: boolean };
}

export const register = (email: string, password: string) =>
    axios
        .post<{ message: string; email: string }>(
            `${baseUrl}/api/auth/register`,
            { email, password }
        )
        .then((r) => r.data);

/**
 * Login/verify rewrite the shared refresh cookie, so they run under the same
 * cross-tab lock as refresh/logout, and the new session (which also supersedes
 * any pending logout) is established while the lock is still held. A queued
 * revocation can therefore never run with the new cookie.
 */
const authenticate = (path: string, body: object): Promise<AuthSession> =>
    withSessionLock(async (signal) => {
        const { data } = await axios.post<AuthSession>(
            `${baseUrl}${path}`,
            body,
            { ...withCredentials, signal, timeout: AUTH_TIMEOUT_MS }
        );
        startSession(data.token);
        return data;
    }, 'exclusive');

export const verifyEmail = (email: string, code: string) =>
    authenticate('/api/auth/verify', { email, code });

export const resendCode = (email: string) =>
    axios
        .post<{ message: string }>(`${baseUrl}/api/auth/resend`, { email })
        .then((r) => r.data);

export const login = (email: string, password: string) =>
    authenticate('/api/auth/login', { email, password });

export const forgotPassword = (email: string) =>
    axios
        .post<{ message: string }>(`${baseUrl}/api/auth/forgot-password`, {
            email,
        })
        .then((r) => r.data);

export const resetPassword = (email: string, code: string, password: string) =>
    withSessionLock(
        (signal) =>
            axios
                .post<{ message: string }>(
                    `${baseUrl}/api/auth/reset-password`,
                    { email, code, password },
                    { signal, timeout: AUTH_TIMEOUT_MS }
                )
                .then((r) => r.data),
        'exclusive'
    );

const REFRESH_TIMEOUT_MS = 15_000;
const LOGOUT_TIMEOUT_MS = 10_000;
// Every lock-holding request is bounded well below the lease lifetime.
const AUTH_TIMEOUT_MS = 15_000;

/**
 * `superseded`: a newer session replaced this logout before its revocation
 * ran, so no request was sent (the old cookie is already gone) and nothing is
 * claimed about the old server-side session.
 */
export type LogoutResult = 'confirmed' | 'unconfirmed' | 'superseded';

const revocations = new Map<string, Promise<LogoutResult>>();

/**
 * Ask the server to revoke the refresh token held in the HttpOnly cookie for
 * logout `id`. Runs under the cross-tab lock and re-checks, once the lock is
 * held, that this logout is still the pending one: a login that happened in
 * the meantime (any tab) has already swapped the cookie, and a stale request
 * must neither revoke nor clear the new session. Only a 2xx confirms.
 */
function revokeSession(id: string): Promise<LogoutResult> {
    const running = revocations.get(id);
    if (running) return running;
    const request = withSessionLock(async (signal): Promise<boolean> => {
        if (!isLogoutPending(id)) return false;
        await axios.post(`${baseUrl}/api/auth/logout`, undefined, {
            ...withCredentials,
            signal,
            timeout: LOGOUT_TIMEOUT_MS,
        });
        return true;
    }, 'exclusive')
        .then((sent): LogoutResult => {
            if (!sent) return 'superseded';
            return confirmLogout(id) ? 'confirmed' : 'superseded';
        })
        .catch((): LogoutResult => {
            if (isLogoutPending(id)) {
                announceLogoutFailed(id);
                return 'unconfirmed';
            }
            return 'superseded';
        })
        .finally(() => {
            revocations.delete(id);
        });
    revocations.set(id, request);
    return request;
}

/**
 * Log out. The local session ends and the other tabs are told immediately;
 * the returned promise reports whether the server confirmed the revocation.
 * While it is not confirmed, silent re-authentication stays disabled.
 */
export function logout(): Promise<LogoutResult> {
    return revokeSession(beginLocalLogout());
}

/** Retry the pending revocation (the cookie is kept server-side on failure). */
export function retryLogout(): Promise<LogoutResult> {
    const id = pendingLogoutId();
    return id ? revokeSession(id) : Promise.resolve('superseded');
}

type RefreshOutcome = { status: 'ok'; token: string } | { status: 'rejected' };

/** 401 = rejected credential; anything else (network, 5xx) rethrows. */
async function requestRefresh(): Promise<RefreshOutcome> {
    try {
        const r = await axios.post<AuthSession>(
            `${baseUrl}/api/auth/refresh`,
            undefined,
            { ...withCredentials, timeout: REFRESH_TIMEOUT_MS }
        );
        return { status: 'ok', token: r.data.token };
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            return { status: 'rejected' };
        }
        throw error;
    }
}

async function attemptRefresh(gen: number): Promise<string | null> {
    // A logout may have happened while this call waited for the lock.
    if (gen !== currentGeneration() || !refreshAllowed()) return null;

    let outcome = await requestRefresh();
    if (outcome.status === 'rejected') {
        // One controlled retry: a sibling tab may have just rotated the cookie
        // (only possible without Web Locks, or against an older tab).
        await waitForPeerRefresh();
        if (gen !== currentGeneration() || !refreshAllowed()) return null;
        outcome = await requestRefresh();
    }

    if (outcome.status === 'ok') {
        // Drop the response if a logout/login happened while in flight.
        if (!adoptRefreshedToken(outcome.token, gen)) return null;
        announceRefreshed();
        return outcome.token;
    }
    if (gen === currentGeneration()) removeToken();
    return null;
}

let refresh: { gen: number; promise: Promise<string | null> } | null = null;

/**
 * Exchange the HttpOnly refresh cookie for a fresh access token.
 * Resolves `null` when the session is definitively gone; rejects when the
 * outcome is unknown (network/server failure) so callers keep their state.
 * A refresh started under an older session generation is never shared with
 * (nor can it end) a newer session.
 */
function refreshSession(): Promise<string | null> {
    if (!refreshAllowed()) return Promise.resolve(null);
    const gen = currentGeneration();
    if (refresh?.gen === gen) return refresh.promise;
    const entry = {
        gen,
        promise: withSessionLock(
            () => attemptRefresh(gen),
            'recoverable'
        ).finally(() => {
            if (refresh === entry) refresh = null;
        }),
    };
    refresh = entry;
    return entry.promise;
}

/**
 * Ensure there is a usable session on app start: reuse a valid access token,
 * otherwise silently refresh it from the HttpOnly cookie.
 */
export async function bootstrapSession(): Promise<boolean> {
    const token = getToken();
    if (token && !isTokenExpired(token)) return true;
    try {
        return (await refreshSession()) !== null;
    } catch {
        // Unknown outcome (offline / server down): stay signed out for now.
        return false;
    }
}

/**
 * Install a global 401 interceptor: on an expired access token, transparently
 * refresh once and replay the request, so users are not kicked out mid-session.
 * The returned disposer must be called when the app effect is cleaned up.
 */
export function setupAuthInterceptor(onSessionLost: () => void): () => void {
    return installAuthInterceptor(
        refreshSession,
        onSessionLost,
        currentGeneration
    );
}
