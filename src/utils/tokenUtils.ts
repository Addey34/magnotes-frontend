import { jwtDecode } from 'jwt-decode';

const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refreshToken';

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

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const getRefreshToken = (): string | null =>
    localStorage.getItem(REFRESH_KEY);

export const setTokens = (token: string, refreshToken: string): void => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(REFRESH_KEY, refreshToken);
};

export const removeToken = (): void => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
};
