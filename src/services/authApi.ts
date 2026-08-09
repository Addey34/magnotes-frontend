import axios from 'axios';
import {
    getToken,
    isTokenExpired,
    removeToken,
    setTokens,
} from '../utils/tokenUtils';

const baseUrl = import.meta.env.VITE_API_URL || '';
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

export const logout = () => {
    removeToken();
    // Fire-and-forget: revoke the HttpOnly refresh cookie server-side.
    axios
        .post(`${baseUrl}/api/auth/logout`, undefined, withCredentials)
        .catch(() => undefined);
};

let refreshPromise: Promise<string | null> | null = null;

/** Exchange the HttpOnly refresh cookie for a fresh access token. */
async function refreshSession(): Promise<string | null> {
    if (!refreshPromise) {
        refreshPromise = axios
            .post<AuthSession>(
                `${baseUrl}/api/auth/refresh`,
                undefined,
                withCredentials
            )
            .then((r) => {
                setTokens(r.data.token);
                return r.data.token;
            })
            .catch(() => {
                removeToken();
                return null;
            })
            .finally(() => {
                refreshPromise = null;
            });
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
    return (await refreshSession()) !== null;
}

/**
 * Install a global 401 interceptor: on an expired access token, transparently
 * refresh once and replay the request, so users are not kicked out mid-session.
 */
export function setupAuthInterceptor(onSessionLost: () => void) {
    axios.interceptors.response.use(
        (response) => response,
        async (error) => {
            const original = error.config;
            const isAuthCall = original?.url?.includes('/api/auth/');
            if (
                error.response?.status === 401 &&
                original &&
                !original._retry &&
                !isAuthCall
            ) {
                original._retry = true;
                const newToken = await refreshSession();
                if (newToken) {
                    original.headers = original.headers || {};
                    original.headers.Authorization = `Bearer ${newToken}`;
                    return axios(original);
                }
                onSessionLost();
            }
            return Promise.reject(error);
        }
    );
}
