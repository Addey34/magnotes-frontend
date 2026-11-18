/** @jest-environment jsdom */

// MGN-DATA-01-LOT-A — provenance and order of intentions (AUD-02, AUD-03,
// AUD-06) at the useAutosave engine level. Each test checks the FINAL value,
// the bases and payloads actually sent, and the contents kept unsynchronised.

import { act, renderHook } from '@testing-library/react';
import { MissingVersionError, useAutosave } from './useAutosave';

type Doc = {
    content: string;
    title: string;
    x: number;
    etag: string;
};
type Update = Partial<Omit<Doc, 'etag'>> & { etag?: string };

const conflict = () =>
    Object.assign(new Error('conflict'), { response: { status: 412 } });
const settle = async () => {
    for (let i = 0; i < 300; i++) await Promise.resolve();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Server {
    docs: Record<string, Doc> = {};
    n = 1;
    calls: Array<{
        id: string;
        base?: string;
        fields: Record<string, unknown>;
        outcome: string;
    }> = [];
    failNext = 0;
    constructor(ids: string[] = ['c']) {
        ids.forEach(
            (id) =>
                (this.docs[id] = {
                    content: 'c0',
                    title: 't0',
                    x: 0,
                    etag: 'V1',
                })
        );
    }
    external(id: string, patch: Partial<Doc>): string {
        Object.assign(this.docs[id], patch, { etag: `V${++this.n}` });
        return this.docs[id].etag;
    }
    update = async (id: string, payload: Update): Promise<Doc> => {
        const { etag: base, ...fields } = payload;
        if (this.failNext > 0) {
            this.failNext--;
            this.calls.push({ id, base, fields, outcome: 'network' });
            throw new Error('Network Error');
        }
        if (base !== undefined && base !== this.docs[id].etag) {
            this.calls.push({ id, base, fields, outcome: '409' });
            throw conflict();
        }
        Object.assign(this.docs[id], fields, { etag: `V${++this.n}` });
        this.calls.push({ id, base, fields, outcome: 'ok' });
        return { ...this.docs[id] };
    };
}

const mount = (
    server: Server,
    options: { requireVersion?: () => boolean } = {},
    onError = jest.fn()
) =>
    renderHook(() =>
        useAutosave<Update, Doc>(
            (id, updates) => server.update(id, updates),
            20,
            onError,
            undefined,
            options
        )
    );

const flushAll = async (view: ReturnType<typeof mount>['result']) => {
    await act(async () => {
        await sleep(40);
        await view.current.flushPending();
        await settle();
    });
};

// Let the debounce elapse and the write fail, WITHOUT retrying it.
const debounced = async () => {
    await act(async () => {
        await sleep(40);
        await settle();
    });
};

// Intentions kept in memory in a given state (REV1 representation).
const kept = (
    view: ReturnType<typeof mount>['result'],
    id: string,
    state: string
) => view.current.recoverable(id).filter((i) => i.state === state);

beforeEach(() =>
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
);
afterEach(() => jest.restoreAllMocks());

describe('LOT-A / AUD-02 — provenance of versions', () => {
    it('1. distinct fields authored on two incompatible bases are never merged into one request', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 1;
        act(() =>
            result.current.scheduleSave('c', {
                content: 'mine',
                etag: 'V1',
            })
        );
        await debounced();
        const v2 = server.external('c', { x: 50 });
        act(() =>
            result.current.scheduleSave('c', {
                title: 'new',
                etag: v2,
            })
        );
        await flushAll(result);
        // The V2-based request carries only the title; the old text is never
        // injected under V2 (it is retried on its own base, V1, and refused).
        const underV2 = server.calls.filter((c) => c.base === v2);
        expect(underV2.length).toBeGreaterThan(0);
        underV2.forEach((c) => expect(c.fields).not.toHaveProperty('content'));
        expect(server.docs.c.content).toBe('c0');
        expect(server.docs.c.title).toBe('new');
        expect(JSON.stringify(result.current.recoverable('c'))).toContain(
            'mine'
        );
    });

    it('2. an external change to the same field after a network failure: the old text stays recoverable, never overwrites', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 1;
        act(() =>
            result.current.scheduleSave('c', {
                content: 'mine',
                etag: 'V1',
            })
        );
        await debounced();
        server.external('c', { content: 'theirs' });
        await act(async () => {
            await result.current.flushPending();
            await settle();
        });
        expect(server.docs.c.content).toBe('theirs');
        expect(server.calls.some((c) => c.outcome === '409')).toBe(true);
        expect(kept(result, 'c', 'conflicted')[0].fields).toMatchObject({
            content: 'mine',
        });
    });

    it('3. an acknowledged local write stays compatible with a waiting modification (same lineage)', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() =>
            result.current.scheduleSave('c', {
                content: 'a',
                etag: 'V1',
            })
        );
        await act(async () => {
            await sleep(40);
            await settle();
        });
        act(() =>
            result.current.scheduleSave('c', {
                title: 'b',
                etag: 'V1', // the stale closure still holds V1
            })
        );
        await flushAll(result);
        expect(server.calls.map((c) => c.outcome)).toEqual(['ok', 'ok']);
        expect(server.calls[1].base).toBe('V2'); // advanced by OUR ack
        expect(server.docs.c).toMatchObject({ content: 'a', title: 'b' });
    });
});

describe('LOT-A / AUD-03 — order of intentions', () => {
    it('4. an old autosave then a recent direct write of the same field: only the recent value is sent', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() =>
            result.current.scheduleSave('c', {
                x: 1,
                etag: 'V1',
            })
        );
        await act(async () => {
            await result.current.writeDirect('c', {
                x: 2,
                etag: 'V1',
            });
        });
        await flushAll(result);
        expect(server.calls.map((c) => c.fields)).toEqual([{ x: 2 }]);
        expect(server.docs.c.x).toBe(2);
    });

    it('5. an old failed autosave then a recent acknowledged direct write: the old value is never replayed', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 1;
        act(() =>
            result.current.scheduleSave('c', {
                x: 1,
                etag: 'V1',
            })
        );
        await debounced();
        await act(async () => {
            await result.current.writeDirect('c', {
                x: 2,
                etag: 'V1',
            });
        });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await sleep(40);
            await settle();
        });
        await flushAll(result);
        expect(server.docs.c.x).toBe(2);
        expect(
            server.calls.filter((c) => c.outcome === 'ok').map((c) => c.fields)
        ).toEqual([{ x: 2 }]);
    });

    it('6. the recent direct write fails: the older value is not lost (reinstated, retried)', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() =>
            result.current.scheduleSave('c', {
                x: 1,
                etag: 'V1',
            })
        );
        server.failNext = 1;
        await act(async () => {
            await expect(
                result.current.writeDirect('c', {
                    x: 2,
                    etag: 'V1',
                })
            ).rejects.toThrow('Network Error');
        });
        await flushAll(result);
        // The board rolled back to the older value, which the user intended
        // last before the failed move: it reaches the server, the failed one
        // never does.
        expect(server.docs.c.x).toBe(1);
        expect(
            server.calls.filter((c) => c.outcome === 'ok').map((c) => c.fields)
        ).toEqual([{ x: 1 }]);
    });

    it('7. an old direct write then a new autosave of the same field: the autosave wins, in order', async () => {
        const server = new Server();
        const { result } = mount(server);
        await act(async () => {
            await result.current.writeDirect('c', {
                x: 2,
                etag: 'V1',
            });
        });
        act(() =>
            result.current.scheduleSave('c', {
                x: 3,
                etag: 'V1', // stale closure
            })
        );
        await flushAll(result);
        expect(server.docs.c.x).toBe(3);
        expect(server.calls.map((c) => c.base)).toEqual(['V1', 'V2']);
    });
});

describe('LOT-A / AUD-06 — no write without a known version', () => {
    it('8. autosave and direct write without a version are refused locally; the content is kept', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(
            server,
            { requireVersion: () => true },
            onError
        );
        act(() => result.current.scheduleSave('c', { content: 'kept' }));
        await flushAll(result);
        await act(async () => {
            await expect(
                result.current.writeDirect('c', { x: 9 })
            ).rejects.toBeInstanceOf(MissingVersionError);
        });
        expect(server.calls).toEqual([]); // nothing sent, nothing fabricated
        expect(server.docs.c.content).toBe('c0');
        expect(kept(result, 'c', 'blocked')[0].fields).toMatchObject({
            content: 'kept',
        });
        expect(onError.mock.calls[0][0]).toBeInstanceOf(MissingVersionError);
        expect(result.current.saveState.status).toBe('error');
    });

    it('9. demo mode (requireVersion off) writes without a version', async () => {
        const server = new Server();
        const { result } = mount(server, { requireVersion: () => false });
        act(() => result.current.scheduleSave('c', { content: 'demo' }));
        await flushAll(result);
        expect(server.calls.map((c) => [c.base, c.outcome])).toEqual([
            [undefined, 'ok'],
        ]);
        expect(kept(result, 'c', 'blocked')).toEqual([]);
    });
});

describe('LOT-A — isolation between cards', () => {
    it('10. a failed or refused card never affects another card with its own writes', async () => {
        const server = new Server(['a', 'b']);
        const { result } = mount(server, { requireVersion: () => true });
        server.failNext = 1;
        act(() => {
            result.current.scheduleSave('a', {
                content: 'A1',
                etag: 'V1',
            });
            result.current.scheduleSave('b', { content: 'no version' });
        });
        await flushAll(result);
        act(() =>
            result.current.scheduleSave('a', {
                title: 'A2',
                etag: 'V1',
            })
        );
        await flushAll(result);
        expect(server.docs.b.content).toBe('c0');
        expect(kept(result, 'b', 'blocked')[0].fields).toMatchObject({
            content: 'no version',
        });
        expect(kept(result, 'a', 'blocked')).toEqual([]);
        expect(server.docs.a.title).toBe('A2');
        expect(server.calls.filter((c) => c.id === 'b')).toEqual([]);
    });
});
