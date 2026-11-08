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
    refreshAllowed,
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

export const verifyEmail = (email: string, code: string) =>
    axios
        .post<AuthSession>(
            `${baseUrl}/api/auth/verify`,
            { email, code },
            withCredentials
        )
        .then((r) => r.data);

export const resendCode = (email: string) =>
    axios
        .post<{ message: string }>(`${baseUrl}/api/auth/resend`, { email })
        .then((r) => r.data);

export const login = (email: string, password: string) =>
    axios
        .post<AuthSession>(
            `${baseUrl}/api/auth/login`,
            { email, password },
            withCredentials
        )
        .then((r) => r.data);

export const forgotPassword = (email: string) =>
    axios
        .post<{ message: string }>(`${baseUrl}/api/auth/forgot-password`, {
            email,
        })
        .then((r) => r.data);

export const resetPassword = (email: string, code: string, password: string) =>
    axios
        .post<{ message: string }>(`${baseUrl}/api/auth/reset-password`, {
            email,
            code,
            password,
        })
        .then((r) => r.data);

const REFRESH_TIMEOUT_MS = 15_000;
const LOGOUT_TIMEOUT_MS = 10_000;

export type LogoutResult = 'confirmed' | 'unconfirmed';

let revocation: Promise<LogoutResult> | null = null;

/**
 * Ask the server to revoke the refresh token held in the HttpOnly cookie.
 * Serialised with refreshes through the cross-tab lock so it always revokes
 * the most recently rotated token. Only a 2xx counts as confirmation.
 */
function revokeSession(): Promise<LogoutResult> {
    if (!revocation) {
        revocation = withSessionLock(() =>
            axios.post(`${baseUrl}/api/auth/logout`, undefined, {
                ...withCredentials,
                timeout: LOGOUT_TIMEOUT_MS,
            })
        )
            .then((): LogoutResult => {
                confirmLogout();
                return 'confirmed';
            })
            .catch((): LogoutResult => {
                announceLogoutFailed();
                return 'unconfirmed';
            })
            .finally(() => {
                revocation = null;
            });
    }
    return revocation;
}

/**
 * Log out. The local session ends and the other tabs are told immediately;
 * the returned promise reports whether the server confirmed the revocation.
 * While it is not confirmed, silent re-authentication stays disabled.
 */
export function logout(): Promise<LogoutResult> {
    beginLocalLogout();
    return revokeSession();
}

/** Retry an unconfirmed revocation (cookie is kept server-side on failure). */
export const retryLogout = (): Promise<LogoutResult> => revokeSession();

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

let refreshPromise: Promise<string | null> | null = null;

/**
 * Exchange the HttpOnly refresh cookie for a fresh access token.
 * Resolves `null` when the session is definitively gone; rejects when the
 * outcome is unknown (network/server failure) so callers keep their state.
 */
function refreshSession(): Promise<string | null> {
    if (!refreshAllowed()) return Promise.resolve(null);
    if (!refreshPromise) {
        const gen = currentGeneration();
        refreshPromise = withSessionLock(() => attemptRefresh(gen)).finally(
            () => {
                refreshPromise = null;
            }
        );
    }
    return refreshPromise;
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
    return installAuthInterceptor(refreshSession, onSessionLost);
}
