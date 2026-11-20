/** @jest-environment jsdom */

// MGN-DATA-01-LOT-A-REV1 — consolidation of the intentions and their
// provenance at the useAutosave engine level. Every test checks the FINAL
// server value, the payloads and bases actually sent, and what stays
// recoverable in memory.

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
    doc: Doc = { content: 'old', title: 't0', x: 0, etag: 'V1' };
    n = 1;
    calls: Array<{
        base?: string;
        fields: Record<string, unknown>;
        outcome: string;
    }> = [];
    failNext = 0; // fails BEFORE the server applies anything
    loseNext = 0; // applied, but the response is lost
    external(patch: Partial<Doc>): string {
        Object.assign(this.doc, patch, { etag: `V${++this.n}` });
        return this.doc.etag;
    }
    update = async (_id: string, payload: Update): Promise<Doc> => {
        const { etag: base, ...fields } = payload;
        if (this.failNext > 0) {
            this.failNext--;
            this.calls.push({ base, fields, outcome: 'network' });
            throw new Error('Network Error');
        }
        if (base !== undefined && base !== this.doc.etag) {
            this.calls.push({ base, fields, outcome: '409' });
            throw conflict();
        }
        Object.assign(this.doc, fields, { etag: `V${++this.n}` });
        if (this.loseNext > 0) {
            this.loseNext--;
            this.calls.push({ base, fields, outcome: 'applied-lost' });
            throw new Error('Network Error');
        }
        this.calls.push({ base, fields, outcome: 'ok' });
        return { ...this.doc };
    };
    okFields = () =>
        this.calls.filter((c) => c.outcome === 'ok').map((c) => c.fields);
    sent = (key: string, value: unknown) =>
        this.calls.some((c) => c.fields[key] === value);
    applied = (key: string, value: unknown) =>
        this.calls.some(
            (c) =>
                c.fields[key] === value &&
                (c.outcome === 'ok' || c.outcome === 'applied-lost')
        );
}

const mount = (
    server: Server,
    opts: {
        onSaved?: (id: string, result: Doc, staleKeys: string[]) => void;
        onError?: jest.Mock;
        requireVersion?: () => boolean;
    } = {}
) =>
    renderHook(() =>
        useAutosave<Update, Doc>(
            (id, updates) => server.update(id, updates),
            20,
            opts.onError ?? jest.fn(),
            opts.onSaved,
            { requireVersion: opts.requireVersion }
        )
    );
type View = ReturnType<typeof mount>['result'];

const flush = async (view: View) => {
    await act(async () => {
        await sleep(40);
        await view.current.flushPending();
        await settle();
    });
};
const debounced = async () => {
    await act(async () => {
        await sleep(40);
        await settle();
    });
};
const intents = (view: View, state?: string, id = 'c') =>
    view.current
        .recoverable(id)
        .filter((intent) => !state || intent.state === state);
const direct = (view: View, x: number, base = 'V1') =>
    view.current.writeDirect('c', { x, etag: base }).then(
        () => 'ok',
        () => 'failed'
    );

beforeEach(() =>
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
);
afterEach(() => jest.restoreAllMocks());

describe('LA-AUD-01 — successive direct writes and the values they displace', () => {
    it('first direct acknowledged, second failed: the older value is obsolete, never sent', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.scheduleSave('c', { x: 1, etag: 'V1' }));
        let outcomes: string[] = [];
        await act(async () => {
            const a = direct(result, 2);
            server.failNext = 0;
            const b = direct(result, 3);
            // the second one fails: arm the failure once the first is applied
            await a;
            server.failNext = 1;
            outcomes = [await a, await b];
            await settle();
        });
        expect(outcomes).toEqual(['ok', 'failed']);
        await flush(result);
        expect(server.doc.x).toBe(2); // what the board rolled back to
        expect(server.sent('x', 1)).toBe(false); // obsolete once x=2 was acknowledged
        // LOT-C (AUD-08): the failed write ended without an HTTP answer, so
        // the server may have applied it: the status is no longer "saved"
        // (it was before LOT-C). Nothing else of this test changed.
        expect(result.current.saveState.status).toBe('error');
    });

    it('first direct failed, second acknowledged: the older value is obsolete, never sent', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.scheduleSave('c', { x: 1, etag: 'V1' }));
        server.failNext = 1;
        await act(async () => {
            await Promise.all([direct(result, 2), direct(result, 3)]);
            await settle();
        });
        await flush(result);
        expect(server.doc.x).toBe(3);
        expect(server.sent('x', 1)).toBe(false);
        expect(result.current.saveState.status).toBe('saved');
    });

    it('two failures, then a new autosave of the same field: the autosave wins', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.scheduleSave('c', { x: 1, etag: 'V1' }));
        server.failNext = 2;
        await act(async () => {
            await Promise.all([direct(result, 2), direct(result, 3)]);
            await settle();
        });
        act(() => result.current.scheduleSave('c', { x: 4, etag: 'V1' }));
        await flush(result);
        expect(server.doc.x).toBe(4);
        expect(server.applied('x', 2)).toBe(false);
        expect(server.applied('x', 3)).toBe(false);
        expect(result.current.saveState.status).toBe('saved');
    });

    it('three successive direct writes, all failing: the oldest recoverable value survives and is retried', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.scheduleSave('c', { x: 1, etag: 'V1' }));
        server.failNext = 3;
        await act(async () => {
            await Promise.all([
                direct(result, 2),
                direct(result, 3),
                direct(result, 4),
            ]);
            await settle();
        });
        expect(JSON.stringify(intents(result))).toContain('"x":1');
        expect(result.current.saveState.status).not.toBe('saved');
        await flush(result);
        expect(server.doc.x).toBe(1);
        expect(result.current.saveState.status).toBe('saved');
    });

    it('three successive direct writes, the last acknowledged: only the last value is on the server', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.scheduleSave('c', { x: 1, etag: 'V1' }));
        server.failNext = 2;
        await act(async () => {
            await Promise.all([
                direct(result, 2),
                direct(result, 3),
                direct(result, 4),
            ]);
            await settle();
        });
        await flush(result);
        expect(server.doc.x).toBe(4);
        expect(server.sent('x', 1)).toBe(false);
        expect(intents(result)).toEqual([]);
    });

    it('response lost for the first direct, then the second fails: the older value is kept, refused on its stale base, never overwrites', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.scheduleSave('c', { x: 1, etag: 'V1' }));
        server.loseNext = 1; // x=2 is APPLIED, its answer is lost
        await act(async () => {
            const a = direct(result, 2);
            const b = (async () => {
                await a;
                server.failNext = 1; // x=3 fails before reaching the server
                return direct(result, 3);
            })();
            await Promise.all([a, b]);
            await settle();
        });
        await flush(result);
        // A lost response is never an acknowledgement: x=1 is not obsolete, it
        // is retried on ITS OWN base (V1), which the applied write made stale.
        expect(server.doc.x).toBe(2);
        expect(server.calls.some((c) => c.outcome === '409')).toBe(true);
        const refused = intents(result, 'conflicted');
        expect(refused).toHaveLength(1);
        expect(refused[0]).toMatchObject({ fields: { x: 1 }, base: 'V1' });
        expect(result.current.saveState.status).toBe('error');
    });

    it('independent fields are unaffected: the title is sent, only the displaced x is restored', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() =>
            result.current.scheduleSave('c', {
                x: 1,
                title: 'kept',
                etag: 'V1',
            })
        );
        server.failNext = 1;
        await act(async () => {
            await direct(result, 2);
            await settle();
        });
        await flush(result);
        expect(server.doc.title).toBe('kept');
        expect(server.doc.x).toBe(1);
    });
});

describe('LA-AUD-02 — an echo never rewinds an intention extracted but not yet acknowledged', () => {
    it('several groups, one intermediate group refused: every echo protects the others', async () => {
        const server = new Server();
        const stale: string[][] = [];
        const { result } = mount(server, {
            onSaved: (_id, _doc, keys) => stale.push(keys),
        });
        act(() => {
            result.current.scheduleSave('c', {
                title: 'new title',
                etag: 'V1',
            });
            result.current.scheduleSave('c', {
                content: 'my text',
                etag: 'V0', // stale: refused
            });
            result.current.scheduleSave('c', {
                x: 5,
                etag: 'V1',
            });
        });
        await flush(result);
        // Group 1 and group 3 go through (group 3 follows OUR acknowledgement
        // V1 -> V2), group 2 is refused and stays recoverable.
        expect(server.calls.map((c) => c.outcome)).toEqual(['ok', '409', 'ok']);
        expect(stale[0]).toEqual(expect.arrayContaining(['content', 'x']));
        expect(stale[1]).toEqual(expect.arrayContaining(['content']));
        expect(intents(result, 'conflicted')[0]).toMatchObject({
            fields: { content: 'my text' },
            base: 'V0',
        });
    });

    it('a group queued behind an operation in flight is protected too', async () => {
        const server = new Server();
        const stale: string[][] = [];
        const { result } = mount(server, {
            onSaved: (_id, _doc, keys) => stale.push(keys),
        });
        act(() =>
            result.current.scheduleSave('c', {
                title: 'first',
                etag: 'V1',
            })
        );
        await act(async () => {
            const p = result.current.flushPending(); // title goes in flight
            result.current.scheduleSave('c', {
                content: 'typed meanwhile',
                etag: 'V1',
            });
            await p;
            await sleep(40);
            await result.current.flushPending();
            await settle();
        });
        expect(stale[0]).toContain('content');
    });
});

describe('LA-AUD-03 — conflicts keep their identity, provenance and order', () => {
    it('two conflicts stay two intentions, each on its own base, never replayed', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.external({});
        act(() =>
            result.current.scheduleSave('c', {
                content: 'mine',
                etag: 'V1',
            })
        );
        await flush(result);
        server.external({});
        act(() =>
            result.current.scheduleSave('c', {
                title: 'mine title',
                etag: 'V2',
            })
        );
        await flush(result);
        const refused = intents(result, 'conflicted');
        expect(refused).toHaveLength(2);
        expect(refused[0]).toMatchObject({
            fields: { content: 'mine' },
            base: 'V1',
        });
        expect(refused[1]).toMatchObject({
            fields: { title: 'mine title' },
            base: 'V2',
        });
        expect(refused[0].id).not.toBe(refused[1].id);
        expect(refused[0].order).toBeLessThan(refused[1].order);
        // Never replayed on their own: online, flush, time passing.
        const callsBefore = server.calls.length;
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await sleep(60);
            await result.current.flushPending();
            await settle();
        });
        expect(server.calls.length).toBe(callsBefore);
        expect(server.doc.content).toBe('old');
        expect(intents(result, 'conflicted')).toHaveLength(2);
    });

    it('a newer conflict on the same field does not erase the older one', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.external({});
        act(() =>
            result.current.scheduleSave('c', {
                content: 'first try',
                etag: 'V1',
            })
        );
        await flush(result);
        act(() =>
            result.current.scheduleSave('c', {
                content: 'second try',
                etag: 'V1',
            })
        );
        await flush(result);
        const texts = intents(result, 'conflicted').map(
            (i) => i.fields.content
        );
        expect(texts).toEqual(['first try', 'second try']);
    });

    it('a failed (retriable) intention keeps its own base and is not merged under a newer one', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 1;
        act(() =>
            result.current.scheduleSave('c', {
                content: 'offline text',
                etag: 'V1',
            })
        );
        await debounced();
        const failed = intents(result, 'failed');
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({
            fields: { content: 'offline text' },
            base: 'V1',
        });
        expect(result.current.saveState.status).toBe('error');
    });
});

describe('REV1 — local refusal without a known version', () => {
    it('an empty version is "no version": direct write refused, autosave blocked, nothing sent', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(server, {
            requireVersion: () => true,
            onError,
        });
        // A pending value must survive the refusal of a direct write.
        act(() =>
            result.current.scheduleSave('c', {
                x: 1,
                etag: 'V1',
            })
        );
        await act(async () => {
            await expect(
                result.current.writeDirect('c', {
                    x: 9,
                    etag: '',
                })
            ).rejects.toBeInstanceOf(MissingVersionError);
        });
        expect(intents(result, 'pending')[0].fields).toEqual({ x: 1 });
        act(() =>
            result.current.scheduleSave('d', {
                content: 'no version',
                etag: '',
            })
        );
        await flush(result);
        expect(server.calls.map((c) => c.fields)).toEqual([{ x: 1 }]); // card c only
        const blocked = intents(result, 'blocked', 'd');
        expect(blocked).toHaveLength(1);
        expect(blocked[0].fields).toEqual({ content: 'no version' });
        expect(blocked[0].base).toBeUndefined();
        expect(
            onError.mock.calls.some(([e]) => e instanceof MissingVersionError)
        ).toBe(true);
    });

    it('two blocked contents stay two intentions', async () => {
        const server = new Server();
        const { result } = mount(server, { requireVersion: () => true });
        act(() => result.current.scheduleSave('c', { content: 'a' }));
        await flush(result);
        act(() => result.current.scheduleSave('c', { title: 'b' }));
        await flush(result);
        expect(intents(result, 'blocked').map((i) => i.fields)).toEqual([
            { content: 'a' },
            { title: 'b' },
        ]);
        expect(server.calls).toEqual([]);
        expect(result.current.saveState.status).toBe('error');
    });
});
