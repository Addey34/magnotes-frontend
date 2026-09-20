import axios from 'axios';

export type RefreshAccessToken = () => Promise<string | null>;

/**
 * Install the global protected-request recovery hook. Kept free of Vite env
 * access so its lifecycle and retry contract stay unit-testable.
 */
export function installAuthInterceptor(
    refreshAccessToken: RefreshAccessToken,
    onSessionLost: () => void
): () => void {
    const interceptorId = axios.interceptors.response.use(
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
                const newToken = await refreshAccessToken();
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

    return () => axios.interceptors.response.eject(interceptorId);
}
