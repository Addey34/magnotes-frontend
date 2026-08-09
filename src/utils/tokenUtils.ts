import { jwtDecode } from 'jwt-decode';

const LEGACY_ACCESS_KEY = 'token';
const LEGACY_REFRESH_KEY = 'refreshToken';

// Access tokens live only in memory. The refresh token is an HttpOnly cookie
// owned by the API and is intentionally never readable from JavaScript.
let accessToken: string | null = null;

export const isTokenExpired = (token: string): boolean => {
    try {
        const decoded: { exp?: number } = jwtDecode(token);
        const currentTime = Date.now() / 1000;
        return !decoded.exp || decoded.exp < currentTime;
    } catch (e) {
        console.error('Token invalid or expired:', e);
        return true;
    }
};

export const getToken = (): string | null => accessToken;

export const setTokens = (token: string): void => {
    accessToken = token;
    // Remove credentials written by versions before the HttpOnly-cookie
    // migration. They are no longer used and must not remain in storage.
    localStorage.removeItem(LEGACY_ACCESS_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
};

export const removeToken = (): void => {
    accessToken = null;
    localStorage.removeItem(LEGACY_ACCESS_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
};
