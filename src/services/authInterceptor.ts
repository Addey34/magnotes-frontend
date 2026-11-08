import axios from 'axios';

export type RefreshAccessToken = () => Promise<string | null>;

/** Session generation a request was issued under (see sessionCoordinator). */
type SessionGeneration = () => number;

const GENERATION_KEY = '_sessionGeneration';

/**
 * Install the global protected-request recovery hook. Kept free of Vite env
 * access so its lifecycle and retry contract stay unit-testable.
 *
 * Every request is stamped with the session generation it was issued under.
 * A 401 for a request from an older generation (a logout and/or a new login
 * happened since) is stale: it must neither sign out the newer session nor be
 * replayed with another session's token, so it is simply rejected.
 */
export function installAuthInterceptor(
    refreshAccessToken: RefreshAccessToken,
    onSessionLost: () => void,
    getGeneration: SessionGeneration = () => 0
): () => void {
    const requestId = axios.interceptors.request.use((config) => {
        const stamped = config as unknown as Record<string, unknown>;
        if (stamped[GENERATION_KEY] === undefined) {
            stamped[GENERATION_KEY] = getGeneration();
        }
        return config;
    });

    const responseId = axios.interceptors.response.use(
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
                const issuedUnder = original[GENERATION_KEY];
                const isStale = () =>
                    issuedUnder !== undefined &&
                    issuedUnder !== getGeneration();
                if (isStale()) return Promise.reject(error);

                original._retry = true;
                let newToken: string | null;
                try {
                    newToken = await refreshAccessToken();
                } catch {
                    // Unknown outcome (offline / server error): keep the
                    // session state and surface the original failure.
                    return Promise.reject(error);
                }
                // The session may have changed while the refresh was pending.
                if (isStale()) return Promise.reject(error);
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

    return () => {
        axios.interceptors.request.eject(requestId);
        axios.interceptors.response.eject(responseId);
    };
}
