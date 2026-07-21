import axios from 'axios';
import {
    getRefreshToken,
    getToken,
    isTokenExpired,
    removeToken,
    setTokens,
} from '../utils/tokenUtils';

const baseUrl = import.meta.env.VITE_API_URL || '';

export interface AuthSession {
    token: string;
    refreshToken: string;
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
        .post<AuthSession>(`${baseUrl}/api/auth/verify`, { email, code })
        .then((r) => r.data);

export const resendCode = (email: string) =>
    axios
        .post<{ message: string }>(`${baseUrl}/api/auth/resend`, { email })
        .then((r) => r.data);

export const login = (email: string, password: string) =>
    axios
        .post<AuthSession>(`${baseUrl}/api/auth/login`, { email, password })
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
    const refreshToken = getRefreshToken();
    removeToken();
    if (refreshToken) {
        // Fire-and-forget: revoke the refresh token server-side.
        axios
            .post(`${baseUrl}/api/auth/logout`, { refreshToken })
            .catch(() => undefined);
    }
};

let refreshPromise: Promise<string | null> | null = null;

/** Exchange the stored refresh token for a fresh access token (deduplicated). */
async function refreshSession(): Promise<string | null> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    if (!refreshPromise) {
        refreshPromise = axios
            .post<AuthSession>(`${baseUrl}/api/auth/refresh`, { refreshToken })
            .then((r) => {
                setTokens(r.data.token, r.data.refreshToken);
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
 * otherwise silently refresh it. Returns true when the user stays logged in.
 */
export async function bootstrapSession(): Promise<boolean> {
    const token = getToken();
    if (token && !isTokenExpired(token)) return true;
    return (await refreshSession()) !== null;
}

/**
 * Install a global 401 interceptor: on an expired access token, transparently
 * refresh once and replay the request, so paying users are never kicked out
 * mid-session. Auth endpoints are excluded to avoid loops.
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
