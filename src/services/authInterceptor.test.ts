import axios from 'axios';
import { installAuthInterceptor } from './authInterceptor';

describe('installAuthInterceptor', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns a disposer that ejects the installed response interceptor', () => {
        const useSpy = jest
            .spyOn(axios.interceptors.response, 'use')
            .mockReturnValue(17);
        const ejectSpy = jest
            .spyOn(axios.interceptors.response, 'eject')
            .mockImplementation(() => undefined);

        const dispose = installAuthInterceptor(
            jest.fn().mockResolvedValue(null),
            jest.fn()
        );

        expect(useSpy).toHaveBeenCalledTimes(1);
        dispose();
        expect(ejectSpy).toHaveBeenCalledWith(17);
    });

    it('keeps the session when the refresh outcome is unknown (network/server failure)', async () => {
        let handler: ((e: unknown) => Promise<unknown>) | undefined;
        jest.spyOn(axios.interceptors.response, 'use').mockImplementation(((
            _ok: unknown,
            fail: (e: unknown) => Promise<unknown>
        ) => {
            handler = fail;
            return 1;
        }) as never);
        const onSessionLost = jest.fn();
        installAuthInterceptor(
            jest.fn().mockRejectedValue(new Error('offline')),
            onSessionLost
        );
        const error = {
            response: { status: 401 },
            config: { url: '/api/boards', headers: {} },
        };
        await expect(handler!(error)).rejects.toBe(error);
        expect(onSessionLost).not.toHaveBeenCalled();
    });

    it('signs out when the refresh is definitively rejected, and never retries twice', async () => {
        let handler: ((e: unknown) => Promise<unknown>) | undefined;
        jest.spyOn(axios.interceptors.response, 'use').mockImplementation(((
            _ok: unknown,
            fail: (e: unknown) => Promise<unknown>
        ) => {
            handler = fail;
            return 1;
        }) as never);
        const onSessionLost = jest.fn();
        const refresh = jest.fn().mockResolvedValue(null);
        installAuthInterceptor(refresh, onSessionLost);
        const error = {
            response: { status: 401 },
            config: { url: '/api/boards', headers: {} },
        };
        await expect(handler!(error)).rejects.toBe(error);
        await expect(handler!(error)).rejects.toBe(error); // already _retry
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(onSessionLost).toHaveBeenCalledTimes(1);
    });

    describe('stale responses across a logout / new login', () => {
        type Pending = { resolve: (status: number) => void };
        let generation: number;
        let pending: Pending[];
        let adapterCalls: Array<{ auth?: unknown }>;
        const originalAdapter = axios.defaults.adapter;

        beforeEach(() => {
            generation = 1;
            pending = [];
            adapterCalls = [];
            // Every request waits until the test releases it: fully
            // deterministic, no timers.
            axios.defaults.adapter = (config) =>
                new Promise((resolve, reject) => {
                    adapterCalls.push({ auth: config.headers?.Authorization });
                    pending.push({
                        resolve: (status) =>
                            status === 200
                                ? resolve({
                                      data: {},
                                      status,
                                      statusText: 'OK',
                                      headers: {},
                                      config,
                                  })
                                : reject(
                                      new axios.AxiosError(
                                          'unauthorized',
                                          'ERR_BAD_REQUEST',
                                          config,
                                          null,
                                          {
                                              data: {},
                                              status,
                                              statusText: 'Unauthorized',
                                              headers: {},
                                              config,
                                          }
                                      )
                                  ),
                    });
                });
        });

        afterEach(() => {
            axios.defaults.adapter = originalAdapter;
        });

        const flush = () => new Promise((r) => setTimeout(r, 0));

        it('an old 401 does not sign out or refresh a newer session', async () => {
            const refresh = jest.fn().mockResolvedValue('token-b');
            const lost = jest.fn();
            const dispose = installAuthInterceptor(
                refresh,
                lost,
                () => generation
            );
            const settled = axios
                .get('/api/boards', {
                    headers: { Authorization: 'Bearer token-a' },
                })
                .catch((e) => e);
            await flush();

            generation = 2; // logout + login as another account
            pending[0].resolve(401);
            const error = await settled;

            expect(error.response.status).toBe(401);
            expect(refresh).not.toHaveBeenCalled();
            expect(lost).not.toHaveBeenCalled();
            expect(adapterCalls).toHaveLength(1); // never replayed
            dispose();
        });

        it('does not replay with another session token if the session changes during the refresh', async () => {
            let finishRefresh!: (token: string) => void;
            const refresh = jest.fn(
                () => new Promise<string>((r) => (finishRefresh = r))
            );
            const lost = jest.fn();
            const dispose = installAuthInterceptor(
                refresh,
                lost,
                () => generation
            );
            const settled = axios
                .get('/api/boards', {
                    headers: { Authorization: 'Bearer token-a' },
                })
                .catch((e) => e);
            await flush();
            pending[0].resolve(401);
            await flush();
            expect(refresh).toHaveBeenCalledTimes(1);

            generation = 2; // another account signs in while refreshing
            finishRefresh('token-of-account-b');
            const error = await settled;

            expect(error.response.status).toBe(401);
            expect(adapterCalls).toHaveLength(1);
            expect(lost).not.toHaveBeenCalled();
            dispose();
        });

        it('does not sign out a newer session when the stale refresh resolves null', async () => {
            let finishRefresh!: (token: string | null) => void;
            const refresh = jest.fn(
                () => new Promise<string | null>((r) => (finishRefresh = r))
            );
            const lost = jest.fn();
            const dispose = installAuthInterceptor(
                refresh,
                lost,
                () => generation
            );
            const settled = axios.get('/api/boards').catch((e) => e);
            await flush();
            pending[0].resolve(401);
            await flush();
            generation = 2;
            finishRefresh(null);
            await settled;
            expect(lost).not.toHaveBeenCalled();
            dispose();
        });

        it('still refreshes and replays once within the same session', async () => {
            const refresh = jest.fn().mockResolvedValue('token-fresh');
            const dispose = installAuthInterceptor(
                refresh,
                jest.fn(),
                () => generation
            );
            const request = axios.get('/api/boards', {
                headers: { Authorization: 'Bearer token-old' },
            });
            await flush();
            pending[0].resolve(401);
            await flush();
            pending[1].resolve(200);
            await expect(request).resolves.toMatchObject({ status: 200 });
            expect(adapterCalls[1].auth).toBe('Bearer token-fresh');
            expect(refresh).toHaveBeenCalledTimes(1);
            dispose();
        });
    });
});
