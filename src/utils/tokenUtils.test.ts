/**
 * @jest-environment jsdom
 */
import { getToken, removeToken, setTokens } from './tokenUtils';

describe('in-memory access token storage', () => {
    beforeEach(() => {
        localStorage.clear();
        removeToken();
    });

    it('does not persist access or refresh tokens in localStorage', () => {
        localStorage.setItem('token', 'legacy-access');
        localStorage.setItem('refreshToken', 'legacy-refresh');

        setTokens('access-in-memory');

        expect(getToken()).toBe('access-in-memory');
        expect(localStorage.getItem('token')).toBeNull();
        expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('clears the in-memory access token on logout', () => {
        setTokens('access-in-memory');

        removeToken();

        expect(getToken()).toBeNull();
    });
});
