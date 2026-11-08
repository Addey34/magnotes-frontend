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
            _opts: unknown,
            cb: () => Promise<unknown>
        ) => {
            if (held) await new Promise<void>((r) => queue.push(r));
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
    if (url.endsWith('/api/auth/logout')) {
        server.logoutCalls += 1;
        const sent = server.jar.cookie;
        await sleep(LATENCY_MS);
        if (server.failLogout) throw fakeAxiosError();
        if (sent) server.valid.delete(sent);
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

    it('without Web Locks, a late 401 is absorbed by one controlled retry on the rotated cookie', async () => {
        installLocks(false);
        const a = open();
        const b = open();
        const [okA, okB] = await Promise.all([
            a.api.bootstrapSession(),
            b.api.bootstrapSession(),
        ]);
        expect([okA, okB]).toEqual([true, true]);
        expect(server.rejected).toBe(1); // exactly the raced loser
        expect(server.refreshCalls).toBe(3); // 2 + one retry, no loop
        expect(server.jar.cookie).not.toBeNull(); // cookie never deleted
        expect(server.valid.size).toBe(1);
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
        stale.postMessage({ type: 'logout', at: Date.now() - 60_000 });
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
        sender.postMessage({ type: 'logout', at: Date.now() });
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
});
