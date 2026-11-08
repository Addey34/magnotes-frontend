import type * as AuthApi from './authApi';
import type * as CoordinatorModule from './sessionCoordinator';

jest.mock('./apiBase', () => ({ baseUrl: '' }));

type Coordinator = typeof CoordinatorModule;

// --- shared "browser": one cookie jar, one lock manager, one storage --------

const LATENCY_MS = 15;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeServer {
    jar: { cookie: string | null };
    valid: Set<string>;
    refreshCalls: number;
    rejected: number;
    logoutCalls: number;
    loginCalls: number;
    logoutGate: Promise<void> | null;
    loginGate: Promise<void> | null;
    revokedCookies: string[];
    failLogout: boolean;
    counter: number;
    sentMessages: unknown[];
}

let server: FakeServer;
const store = new Map<string, string>();

function installLocks(enabled: boolean) {
    const queue: Array<() => void> = [];
    let held = false;
    const locks = {
        request: async (
            _name: string,
            opts: { signal?: AbortSignal },
            cb: () => Promise<unknown>
        ) => {
            if (held) {
                // Queued requests honour the AbortSignal like real Web Locks.
                await new Promise<void>((resolve, reject) => {
                    const wake = () => resolve();
                    queue.push(wake);
                    opts.signal?.addEventListener('abort', () => {
                        const i = queue.indexOf(wake);
                        if (i >= 0) queue.splice(i, 1);
                        reject(
                            Object.assign(new Error('aborted'), {
                                name: 'AbortError',
                            })
                        );
                    });
                });
            }
            held = true;
            try {
                return await cb();
            } finally {
                held = false;
                queue.shift()?.();
            }
        },
    };
    Object.defineProperty(globalThis, 'navigator', {
        value: enabled ? { locks } : {},
        configurable: true,
    });
}

function fakeAxiosError(status?: number) {
    return Object.assign(new Error(status ? `HTTP ${status}` : 'Network'), {
        isAxiosError: true,
        response: status ? { status } : undefined,
    });
}

async function fakePost(url: string) {
    if (url.endsWith('/api/auth/refresh')) {
        server.refreshCalls += 1;
        const sent = server.jar.cookie; // the browser attaches it at send time
        await sleep(LATENCY_MS);
        if (sent && server.valid.delete(sent)) {
            const next = `refresh-${++server.counter}`;
            server.valid.add(next);
            await sleep(LATENCY_MS);
            server.jar.cookie = next; // Set-Cookie applied on arrival
            return { data: { token: `access-${server.counter}` } };
        }
        await sleep(LATENCY_MS);
        server.rejected += 1; // late 401: the server sends no Set-Cookie
        throw fakeAxiosError(401);
    }
    if (url.endsWith('/api/auth/login')) {
        server.loginCalls += 1;
        if (server.loginGate) await server.loginGate; // delayed delivery
        await sleep(LATENCY_MS);
        const next = `refresh-${++server.counter}`;
        server.valid.add(next);
        server.jar.cookie = next;
        return { data: { token: `access-${server.counter}` } };
    }
    if (url.endsWith('/api/auth/logout')) {
        server.logoutCalls += 1;
        const sent = server.jar.cookie; // attached when the request is sent
        if (server.logoutGate) await server.logoutGate; // delayed delivery
        await sleep(LATENCY_MS);
        if (server.failLogout) throw fakeAxiosError();
        if (sent) {
            server.valid.delete(sent);
            server.revokedCookies.push(sent);
        }
        server.jar.cookie = null;
        return { data: { message: 'ok' } };
    }
    throw new Error(`unexpected ${url}`);
}

interface Tab {
    api: typeof AuthApi;
    coord: Coordinator;
    token: () => string | null;
    events: string[];
    dispose: () => void;
}

function createTab(): Tab {
    let api!: typeof AuthApi;
    let coord!: Coordinator;
    let getToken!: () => string | null;
    jest.isolateModules(() => {
        const axios = jest.requireActual<{
            default: typeof import('axios').default;
        }>('axios').default;
        jest.spyOn(axios, 'post').mockImplementation(fakePost as never);
        api = jest.requireActual('./authApi');
        coord = jest.requireActual('./sessionCoordinator');
        getToken = jest.requireActual<typeof import('../utils/tokenUtils')>(
            '../utils/tokenUtils'
        ).getToken;
    });
    const events: string[] = [];
    const dispose = coord.startSessionCoordination({
        onRemoteLogout: () => events.push('remote-logout'),
        onLogoutConfirmed: () => events.push('confirmed'),
        onLogoutFailed: () => events.push('failed'),
    });
    return { api, coord, token: getToken, events, dispose };
}

const tabs: Tab[] = [];
const open = () => {
    const tab = createTab();
    tabs.push(tab);
    return tab;
};

beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        },
        configurable: true,
    });
    server = {
        jar: { cookie: 'refresh-0' },
        valid: new Set(['refresh-0']),
        refreshCalls: 0,
        rejected: 0,
        logoutCalls: 0,
        loginCalls: 0,
        logoutGate: null,
        loginGate: null,
        revokedCookies: [],
        failLogout: false,
        counter: 0,
        sentMessages: [],
    };
    installLocks(true);
    const original = BroadcastChannel.prototype.postMessage;
    jest.spyOn(BroadcastChannel.prototype, 'postMessage').mockImplementation(
        function (this: BroadcastChannel, message: unknown) {
            server.sentMessages.push(message);
            return original.call(this, message);
        }
    );
});

afterEach(() => {
    tabs.splice(0).forEach((t) => {
        t.dispose();
        t.coord.__resetSessionCoordinatorForTests();
    });
    jest.restoreAllMocks();
});

const settle = () => sleep(60);

describe('multi-tab session coordination', () => {
    it('two tabs refreshing simultaneously both stay signed in, without any 401', async () => {
        const a = open();
        const b = open();
        const [okA, okB] = await Promise.all([
            a.api.bootstrapSession(),
            b.api.bootstrapSession(),
        ]);
        expect([okA, okB]).toEqual([true, true]);
        expect(server.refreshCalls).toBe(2);
        expect(server.rejected).toBe(0);
        expect(server.valid.size).toBe(1);
        expect(a.token()).not.toBeNull();
        expect(b.token()).not.toBeNull();
    });

    it('never makes a consumed refresh token reusable (replay) and does not loop', async () => {
        const a = open();
        await a.api.bootstrapSession();
        const rotated = server.jar.cookie;
        server.jar.cookie = 'refresh-0'; // an old tab replays the old cookie
        const b = open();
        expect(await b.api.bootstrapSession()).toBe(false);
        expect(server.refreshCalls).toBe(3); // 1 + (attempt + one retry)
        expect(server.valid).toEqual(new Set([rotated]));
        expect(b.token()).toBeNull();
    });

    it('propagates a logout to the other tabs and blocks later silent refresh', async () => {
        const a = open();
        const b = open();
        await Promise.all([a.api.bootstrapSession(), b.api.bootstrapSession()]);

        await expect(a.api.logout()).resolves.toBe('confirmed');
        await settle();

        expect(b.events).toContain('remote-logout');
        expect(b.events).toContain('confirmed');
        expect(b.token()).toBeNull();
        expect(a.token()).toBeNull();
        expect(server.valid.size).toBe(0);
        const calls = server.refreshCalls;
        expect(await b.api.bootstrapSession()).toBe(false);
        expect(server.refreshCalls).toBe(calls); // no request at all
    });

    it('discards a refresh response arriving after logout and still revokes the rotated token', async () => {
        const a = open();
        const refreshing = a.api.bootstrapSession();
        await sleep(5); // refresh request is in flight, lock held
        const loggingOut = a.api.logout();

        expect(await refreshing).toBe(false);
        expect(a.token()).toBeNull();
        await expect(loggingOut).resolves.toBe('confirmed');
        expect(server.valid.size).toBe(0);
        expect(server.jar.cookie).toBeNull();
    });

    it('reports an unconfirmed logout on network failure, blocks silent login, and can retry', async () => {
        const a = open();
        const b = open();
        await a.api.bootstrapSession();
        server.failLogout = true;

        await expect(a.api.logout()).resolves.toBe('unconfirmed');
        await settle();
        expect(a.coord.hasPendingLogout()).toBe(true);
        expect(b.events).toContain('failed');
        expect(b.events).not.toContain('confirmed');
        expect(server.valid.size).toBe(1); // not revoked: never claimed so
        expect(server.jar.cookie).not.toBeNull();

        const calls = server.refreshCalls;
        expect(await b.api.bootstrapSession()).toBe(false);
        expect(server.refreshCalls).toBe(calls);

        server.failLogout = false;
        await expect(a.api.retryLogout()).resolves.toBe('confirmed');
        await settle();
        expect(a.coord.hasPendingLogout()).toBe(false);
        expect(b.events).toContain('confirmed');
        expect(server.valid.size).toBe(0);
    });

    it('after a reload, an unconfirmed logout still prevents silent re-authentication', async () => {
        const a = open();
        await a.api.bootstrapSession();
        server.failLogout = true;
        await a.api.logout();
        a.dispose();
        a.coord.__resetSessionCoordinatorForTests();

        const reloaded = open(); // fresh module registry == page reload
        const calls = server.refreshCalls;
        expect(reloaded.coord.hasPendingLogout()).toBe(true);
        expect(await reloaded.api.bootstrapSession()).toBe(false);
        expect(server.refreshCalls).toBe(calls);
    });

    it('after a confirmed logout, a reload finds no session', async () => {
        const a = open();
        await a.api.bootstrapSession();
        await a.api.logout();
        a.dispose();

        const reloaded = open();
        expect(reloaded.coord.hasPendingLogout()).toBe(false);
        expect(await reloaded.api.bootstrapSession()).toBe(false);
        expect(server.valid.size).toBe(0);
    });

    it('ignores a logout event older than the current session', async () => {
        const a = open();
        a.coord.startSession('access-new');
        const stale = new BroadcastChannel('magnotes-session');
        stale.postMessage({
            type: 'logout',
            at: Date.now() - 60_000,
            id: 'old',
        });
        await settle();
        stale.close();
        expect(a.events).not.toContain('remote-logout');
        expect(a.token()).toBe('access-new');
    });

    it('registers a single channel listener even if started twice', async () => {
        const a = open();
        const second = a.coord.startSessionCoordination({
            onRemoteLogout: () => a.events.push('remote-logout-2'),
            onLogoutConfirmed: () => undefined,
            onLogoutFailed: () => undefined,
        });
        const sender = new BroadcastChannel('magnotes-session');
        sender.postMessage({ type: 'logout', at: Date.now(), id: 'x1' });
        await settle();
        sender.close();
        second();
        expect(a.events).toEqual(['remote-logout-2']);
    });

    it('never puts tokens in localStorage, sessionStorage or BroadcastChannel messages', async () => {
        const a = open();
        const b = open();
        await Promise.all([a.api.bootstrapSession(), b.api.bootstrapSession()]);
        server.failLogout = true;
        await a.api.logout();
        server.failLogout = false;
        await a.api.retryLogout();
        await settle();

        const everything = JSON.stringify([
            server.sentMessages,
            [...store.entries()],
        ]);
        expect(everything).not.toMatch(/access-|refresh-/);
        expect(server.sentMessages.length).toBeGreaterThan(0);
        expect(typeof sessionStorage).toBe('undefined');
    });

    describe('logout / login races', () => {
        const gate = () => {
            let release!: () => void;
            server.logoutGate = new Promise<void>((r) => (release = r));
            return () => {
                server.logoutGate = null;
                release();
            };
        };

        it('late logout response (A) cannot revoke or clear the cookie of a login made in B', async () => {
            const a = open();
            const b = open();
            await a.api.bootstrapSession(); // cookie refresh-1
            const release = gate();

            const loggingOut = a.api.logout(); // request sent, response held
            await sleep(40);
            expect(server.logoutCalls).toBe(1);

            const loggingIn = b.api.login('qa@example.test', 'pw'); // queued
            await sleep(40);
            expect(server.loginCalls).toBe(0); // blocked behind the logout

            release();
            await expect(loggingOut).resolves.toBe('confirmed');
            await loggingIn;

            expect(server.revokedCookies).toEqual(['refresh-1']);
            expect(server.valid.has(server.jar.cookie!)).toBe(true);
            expect(b.token()).not.toBeNull();
            expect(b.coord.hasPendingLogout()).toBe(false);
            expect(a.coord.hasPendingLogout()).toBe(false);
            expect(await b.api.bootstrapSession()).toBe(true);
        });

        it('a logout still waiting for the lock is skipped when a login (B) got the lock first', async () => {
            const a = open();
            const b = open();
            const c = open();
            await a.api.bootstrapSession();
            const holder = c.api.bootstrapSession(); // holds the lock
            await sleep(5);

            const loggingIn = b.api.login('qa@example.test', 'pw'); // queued first
            const loggingOut = a.api.logout(); // queued second

            await expect(loggingOut).resolves.toBe('superseded');
            await Promise.all([loggingIn, holder]);

            expect(server.logoutCalls).toBe(0); // no request at all
            expect(server.revokedCookies).toEqual([]);
            expect(server.valid.has(server.jar.cookie!)).toBe(true);
            expect(b.token()).not.toBeNull();
            expect(a.coord.hasPendingLogout()).toBe(false);
            expect(b.coord.hasPendingLogout()).toBe(false);
        });

        it('logout in A then new login in B: B keeps a working session, A stays signed out', async () => {
            const a = open();
            const b = open();
            await Promise.all([
                a.api.bootstrapSession(),
                b.api.bootstrapSession(),
            ]);
            await expect(a.api.logout()).resolves.toBe('confirmed');
            await settle();
            expect(b.events).toContain('remote-logout');

            await b.api.login('qa@example.test', 'pw');
            await settle();
            expect(b.token()).not.toBeNull();
            expect(a.token()).toBeNull();
            expect(await b.api.bootstrapSession()).toBe(true);
            // A stays blocked: it logged out and nobody re-enabled it.
            const calls = server.refreshCalls;
            expect(await a.api.bootstrapSession()).toBe(false);
            expect(server.refreshCalls).toBe(calls);
        });

        it('an old confirmation never clears the marker of a more recent logout', async () => {
            const a = open();
            const id1 = a.coord.beginLocalLogout();
            const id2 = a.coord.beginLocalLogout();
            expect(a.coord.confirmLogout(id1)).toBe(false);
            expect(a.coord.pendingLogoutId()).toBe(id2);
            expect(a.coord.hasPendingLogout()).toBe(true);
            expect(a.coord.confirmLogout(id2)).toBe(true);
            expect(a.coord.hasPendingLogout()).toBe(false);
        });

        it('ignores confirmation / failure events that belong to another logout', async () => {
            const a = open();
            const b = open();
            await a.api.bootstrapSession();
            server.failLogout = true;
            await a.api.logout();
            await settle();
            expect(b.events.filter((e) => e === 'failed')).toHaveLength(1);

            const sender = new BroadcastChannel('magnotes-session');
            sender.postMessage({
                type: 'logout-confirmed',
                id: 'someone-else',
            });
            sender.postMessage({ type: 'logout-failed', id: 'someone-else' });
            await settle();
            sender.close();
            expect(b.events).not.toContain('confirmed');
            expect(b.events.filter((e) => e === 'failed')).toHaveLength(1);
        });

        it('a late bootstrap refresh response cannot restore a session replaced by a login', async () => {
            const a = open();
            const booting = a.api.bootstrapSession(); // refresh in flight
            await sleep(5);
            a.coord.startSession('access-new'); // user logs in meanwhile
            expect(await booting).toBe(false);
            expect(a.token()).toBe('access-new');
        });

        it('a refresh started before a login is not shared with the new session', async () => {
            const a = open();
            const first = a.api.bootstrapSession();
            await sleep(5);
            a.coord.startSession('access-new');
            const second = a.api.bootstrapSession(); // new generation
            expect(await first).toBe(false);
            expect(await second).toBe(true);
            expect(a.token()).toMatch(/^access-\d+$/);
            expect(a.token()).not.toBe('access-new');
        });

        it('a late bootstrap response after logout does not restore the session', async () => {
            const a = open();
            const booting = a.api.bootstrapSession();
            await sleep(5);
            const loggingOut = a.api.logout();
            expect(await booting).toBe(false);
            expect(a.token()).toBeNull();
            await expect(loggingOut).resolves.toBe('confirmed');
        });
    });

    describe('lock timeout policy and browsers without Web Locks', () => {
        const tight = (waitMs: number, ...list: Tab[]) =>
            list.forEach((t) =>
                t.coord.__setLockTimingsForTests({
                    waitMs,
                    leaseMs: 400,
                    settleMs: 5,
                })
            );
        const holdLogin = () => {
            let release!: () => void;
            server.loginGate = new Promise<void>((r) => (release = r));
            return () => {
                server.loginGate = null;
                release();
            };
        };
        const holdLogout = () => {
            let release!: () => void;
            server.logoutGate = new Promise<void>((r) => (release = r));
            return () => {
                server.logoutGate = null;
                release();
            };
        };

        describe.each([
            ['Web Locks', true],
            ['localStorage lease (no Web Locks)', false],
        ])('%s', (_label, withLocks) => {
            beforeEach(() => installLocks(withLocks));

            it('a logout whose wait expires is NOT sent unlocked and cannot clear the new cookie', async () => {
                const a = open();
                const b = open();
                tight(120, a, b);
                const release = holdLogin(); // login A holds the lock > wait

                const loggingIn = a.api.login('qa@example.test', 'pw');
                await sleep(30);
                const result = await b.api.logout(); // waits, then expires

                expect(result).toBe('unconfirmed');
                expect(server.logoutCalls).toBe(0); // never sent
                expect(b.coord.hasPendingLogout()).toBe(true); // honest state

                release();
                await loggingIn;
                // The cookie installed by A is intact and still valid.
                expect(server.revokedCookies).toEqual([]);
                expect(server.valid.has(server.jar.cookie!)).toBe(true);
                expect(a.token()).not.toBeNull();
                // A's session superseded B's logout: a retry sends nothing.
                await expect(b.api.retryLogout()).resolves.toBe('superseded');
                expect(server.logoutCalls).toBe(0);
            });

            it('a login whose wait expires fails in a controlled way, without any request', async () => {
                const a = open();
                const b = open();
                tight(120, a, b);
                await a.api.bootstrapSession();
                const release = holdLogout(); // a long logout holds the lock

                const loggingOut = a.api.logout();
                await sleep(30);
                await expect(
                    b.api.login('qa@example.test', 'pw')
                ).rejects.toBeInstanceOf(b.coord.SessionLockTimeoutError);
                expect(server.loginCalls).toBe(0);
                expect(b.token()).toBeNull();

                release();
                await expect(loggingOut).resolves.toBe('confirmed');
            });

            it('a refresh (recoverable) may proceed unlocked after the wait, with its own retry', async () => {
                const a = open();
                const c = open();
                tight(120, a, c);
                const release = holdLogin();
                const loggingIn = a.api.login('qa@example.test', 'pw');
                await sleep(30);

                // refresh uses the pre-existing valid cookie, unlocked.
                expect(await c.api.bootstrapSession()).toBe(true);
                expect(server.refreshCalls).toBeGreaterThanOrEqual(1);
                release();
                await loggingIn;
            });

            it('a late logout response then a login in the other tab stay ordered', async () => {
                const a = open();
                const b = open();
                tight(2000, a, b);
                await a.api.bootstrapSession();
                const release = holdLogout();

                const loggingOut = a.api.logout();
                await sleep(40);
                const loggingIn = b.api.login('qa@example.test', 'pw');
                await sleep(80);
                expect(server.loginCalls).toBe(0); // waits for the logout

                release();
                await expect(loggingOut).resolves.toBe('confirmed');
                await loggingIn;
                expect(server.revokedCookies).toEqual(['refresh-1']);
                expect(server.valid.has(server.jar.cookie!)).toBe(true);
                expect(b.token()).not.toBeNull();
            });
        });

        describe('without Web Locks', () => {
            beforeEach(() => installLocks(false));

            it('serialises two simultaneous refreshes through the lease (no 401)', async () => {
                const a = open();
                const b = open();
                tight(2000, a, b);
                const [okA, okB] = await Promise.all([
                    a.api.bootstrapSession(),
                    b.api.bootstrapSession(),
                ]);
                expect([okA, okB]).toEqual([true, true]);
                expect(server.rejected).toBe(0);
                expect(server.valid.size).toBe(1);
            });

            it('a crashed holder cannot block forever: its lease expires', async () => {
                const a = open();
                tight(2000, a);
                store.set(
                    'magnotes:session-lease',
                    JSON.stringify({
                        owner: 'crashed',
                        until: Date.now() + 150,
                    })
                );
                await a.api.login('qa@example.test', 'pw');
                expect(server.loginCalls).toBe(1);
                expect(a.token()).not.toBeNull();
                // The lease is released afterwards.
                expect(store.get('magnotes:session-lease')).toBeUndefined();
            });

            it('with a live foreign lease, a refresh falls back to its controlled retry', async () => {
                const a = open();
                const b = open();
                tight(80, a, b);
                store.set(
                    'magnotes:session-lease',
                    JSON.stringify({
                        owner: 'foreign',
                        until: Date.now() + 60_000,
                    })
                );
                const [okA, okB] = await Promise.all([
                    a.api.bootstrapSession(),
                    b.api.bootstrapSession(),
                ]);
                expect([okA, okB]).toEqual([true, true]);
                expect(server.rejected).toBe(1); // raced loser, absorbed by one retry
                expect(server.jar.cookie).not.toBeNull();
            });

            it('with a live foreign lease, login and logout fail in a controlled way', async () => {
                const a = open();
                tight(80, a);
                store.set(
                    'magnotes:session-lease',
                    JSON.stringify({
                        owner: 'foreign',
                        until: Date.now() + 60_000,
                    })
                );
                await expect(
                    a.api.login('qa@example.test', 'pw')
                ).rejects.toBeInstanceOf(a.coord.SessionLockTimeoutError);
                await expect(a.api.logout()).resolves.toBe('unconfirmed');
                expect(server.loginCalls).toBe(0);
                expect(server.logoutCalls).toBe(0);
            });
        });
    });

    describe('localStorage lease hardening (no Web Locks)', () => {
        beforeEach(() => installLocks(false));

        it('unusable storage: exclusive operations fail in a controlled way, recoverable ones go on', async () => {
            const c = open();
            c.coord.__setLockTimingsForTests({
                waitMs: 80,
                leaseMs: 400,
                settleMs: 5,
            });
            // Writes fail (quota / blocked storage); nothing to coordinate on.
            Object.defineProperty(globalThis, 'localStorage', {
                value: {
                    getItem: () => null,
                    setItem: () => {
                        throw new Error('QuotaExceededError');
                    },
                    removeItem: () => undefined,
                },
                configurable: true,
            });

            await expect(
                c.api.login('qa@example.test', 'pw')
            ).rejects.toBeInstanceOf(c.coord.SessionLockTimeoutError);
            expect(server.loginCalls).toBe(0);

            // Refresh is recoverable: still allowed, with its own retry.
            expect(await c.api.bootstrapSession()).toBe(true);

            await expect(c.api.logout()).resolves.toBe('unconfirmed');
            expect(server.logoutCalls).toBe(0);
        });

        it('renews the lease while a long request is active: no second holder', async () => {
            const a = open();
            const b = open();
            const timings = { waitMs: 150, leaseMs: 60, settleMs: 5 };
            a.coord.__setLockTimingsForTests(timings);
            b.coord.__setLockTimingsForTests(timings);
            let release!: () => void;
            server.loginGate = new Promise<void>((r) => (release = r));

            const loggingIn = a.api.login('qa@example.test', 'pw');
            await sleep(30);
            // The login stays active for 3x the lease lifetime.
            await expect(
                b.api.login('qa@example.test', 'pw')
            ).rejects.toBeInstanceOf(b.coord.SessionLockTimeoutError);
            expect(server.loginCalls).toBe(1); // only A's request exists

            server.loginGate = null;
            release();
            await loggingIn;
            expect(a.token()).not.toBeNull();
        });

        it('a lease lost during the task aborts it instead of keeping two holders', async () => {
            const a = open();
            a.coord.__setLockTimingsForTests({
                waitMs: 200,
                leaseMs: 60,
                settleMs: 5,
            });
            let aborted = false;
            const running = a.coord.withSessionLock(
                (signal) =>
                    new Promise<never>((_resolve, reject) => {
                        signal.addEventListener('abort', () => {
                            aborted = true;
                            reject(new Error('request aborted'));
                        });
                    }),
                'exclusive'
            );
            await sleep(30);
            // Another context takes the lease over (e.g. expiry while throttled).
            store.set(
                'magnotes:session-lease',
                JSON.stringify({ owner: 'other', until: Date.now() + 60_000 })
            );

            await expect(running).rejects.toBeInstanceOf(
                a.coord.SessionLockTimeoutError
            );
            expect(aborted).toBe(true);
            // The foreign lease is left untouched by our release.
            expect(JSON.parse(store.get('magnotes:session-lease')!).owner).toBe(
                'other'
            );
        });
    });
});
