/** @jest-environment jsdom */

// MGN-DATA-01D-01-REV3A — reproductions of the CTO addendum findings at the
// useAutosave engine level (AUD-02, AUD-03, AUD-07, AUD-08). Each test states
// the INVARIANT that must hold. A failing test is a CONFIRMED, still-open
// defect (no application code is changed by this mission). Controls that must
// pass are labelled "control".

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

type Doc = {
    content: string;
    title: string;
    color: string;
    etag: string;
};
type Update = Partial<Omit<Doc, 'etag'>> & { etag?: string };

const conflict = () =>
    Object.assign(new Error('conflict'), { response: { status: 412 } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => {
    for (let i = 0; i < 300; i++) await Promise.resolve();
};

class Server {
    doc: Doc = { content: 'c0', title: 't0', color: 'k0', etag: 'V1' };
    n = 1;
    calls: Array<{
        base?: string;
        fields: Record<string, unknown>;
        outcome: string;
    }> = [];
    failNext = 0;
    private holds: Array<{ phase: 'before'; release: () => void }> = [];
    private gate: Promise<void> | null = null;
    /** Hold the next request before it reaches the server. */
    holdNext() {
        let release!: () => void;
        this.gate = new Promise<void>((r) => (release = r));
        const done = () => {
            this.gate = null;
            release();
        };
        this.holds.push({ phase: 'before', release: done });
        return done;
    }
    external(patch: Partial<Doc>): string {
        Object.assign(this.doc, patch, { etag: `V${++this.n}` });
        return this.doc.etag;
    }
    update = async (_id: string, payload: Update): Promise<Doc> => {
        const gate = this.gate;
        if (gate) {
            this.gate = null;
            await gate;
        }
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
        this.calls.push({ base, fields, outcome: 'ok' });
        return { ...this.doc };
    };
}

const mount = (server: Server) =>
    renderHook(() =>
        useAutosave<Update, Doc>(
            (id, updates) => server.update(id, updates),
            20,
            jest.fn()
        )
    );
type View = ReturnType<typeof mount>['result'];

const quiet = () =>
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

describe('AUD-02 — a failed write is never promoted onto a newer base', () => {
    beforeEach(quiet);
    afterEach(() => jest.restoreAllMocks());

    it('text that failed on V1 is never applied silently under V2 (another client changed that text)', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 1;
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'A (typed on V1)',
                etag: 'V1',
            });
            await sleep(80);
            await settle();
        });
        // Another client rewrites that very text; this client reloads V2.
        const v2 = server.external({ content: 'B (theirs)' });
        // Independent edit of the title, based on the reloaded V2.
        await act(async () => {
            result.current.scheduleSave('c', {
                title: 'T',
                etag: v2,
            });
            await sleep(80);
            await settle();
        });
        expect(server.doc.content).toBe('B (theirs)');
    });

    it('fields of incompatible bases are never sent together under the newer base', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 1;
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'A (typed on V1)',
                etag: 'V1',
            });
            await sleep(80);
            await settle();
        });
        const v2 = server.external({ title: 'their title' });
        await act(async () => {
            result.current.scheduleSave('c', {
                color: 'red',
                etag: v2,
            });
            await sleep(80);
            await settle();
        });
        const mixed = server.calls.filter(
            (c) => 'content' in c.fields && c.base === v2
        );
        expect(mixed).toHaveLength(0);
    });

    it('control: online retry of a failed write keeps its own base', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 1;
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'A',
                etag: 'V1',
            });
            await sleep(80);
            await settle();
        });
        server.external({ content: 'B' });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await sleep(60);
            await settle();
        });
        expect(server.doc.content).toBe('B'); // refused with 409, not applied
        expect(server.calls.at(-1)?.outcome).toBe('409');
    });
});

describe('AUD-03 — the last intention on a field wins across autosave and direct writes', () => {
    beforeEach(quiet);
    afterEach(() => jest.restoreAllMocks());

    const direct = (r: View, updates: Update) =>
        act(async () => {
            await r.current.writeDirect('c', updates);
        });

    it('old value in the debounce, newer direct write acknowledged, debounce expires', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => {
            result.current.scheduleSave('c', {
                content: 'old',
                etag: 'V1',
            });
        });
        await direct(result, { content: 'new', etag: 'V1' });
        await act(async () => {
            await sleep(100);
            await settle();
        });
        expect(server.doc.content).toBe('new');
    });

    it('failed autosave, then a newer direct write of the same field, then back online', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.failNext = 1;
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'old',
                etag: 'V1',
            });
            await sleep(80);
            await settle();
        });
        await direct(result, { content: 'new', etag: 'V1' });
        expect(server.doc.content).toBe('new');
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await sleep(80);
            await settle();
        });
        expect(server.doc.content).toBe('new');
    });

    it('several mixed writes on one field: the chronologically last one wins', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => {
            result.current.scheduleSave('c', {
                content: 'A',
                etag: 'V1',
            });
        });
        await direct(result, { content: 'B', etag: 'V1' });
        act(() => {
            result.current.scheduleSave('c', {
                content: 'C',
                etag: 'V1',
            });
        });
        await direct(result, { content: 'D', etag: 'V1' });
        await act(async () => {
            await sleep(100);
            await settle();
        });
        expect(server.doc.content).toBe('D');
    });

    it('control: a direct write followed by a LATER autosave of the same field lets the autosave win', async () => {
        const server = new Server();
        const { result } = mount(server);
        await direct(result, { content: 'direct', etag: 'V1' });
        act(() => {
            result.current.scheduleSave('c', {
                content: 'typed later',
                etag: 'V1',
            });
        });
        await act(async () => {
            await sleep(100);
            await settle();
        });
        expect(server.doc.content).toBe('typed later');
    });
});

describe('AUD-07 — holdCard really stops every write of the card', () => {
    beforeEach(quiet);
    afterEach(() => jest.restoreAllMocks());

    it('a direct write issued while the card is held waits for the outcome', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.holdCard('c'));
        let settled = false;
        await act(async () => {
            void result.current
                .writeDirect('c', { color: 'red', etag: 'V1' })
                .catch(() => undefined) // LOT-B3: dropped with its card (stale)
                .finally(() => (settled = true));
            await settle();
        });
        expect(server.calls).toHaveLength(0);
        expect(settled).toBe(false);
        // The deletion succeeds: nothing may ever reach the server.
        await act(async () => {
            result.current.discardCard('c');
            await settle();
        });
        expect(server.calls).toHaveLength(0);
    });

    it('an autosave already queued behind an in-flight write is not sent while the card is held', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.holdNext(); // first write stays on the wire
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'first',
                etag: 'V1',
            });
            await sleep(50);
            result.current.scheduleSave('c', {
                title: 'second',
                etag: 'V1',
            });
            await sleep(50); // second is now queued in inFlight behind the first
            result.current.holdCard('c'); // deletion starts
            open(); // the first write lands
            await sleep(60);
            await settle();
        });
        // Only the write that was already on the wire may have been sent.
        expect(server.calls.filter((c) => 'title' in c.fields)).toHaveLength(0);
    });

    it('control: a deletion that fails resumes the held writes, nothing typed is lost', async () => {
        const server = new Server();
        const { result } = mount(server);
        await act(async () => {
            result.current.holdCard('c');
            result.current.scheduleSave('c', {
                content: 'typed during delete',
                etag: 'V1',
            });
            await sleep(60);
        });
        expect(server.calls).toHaveLength(0);
        await act(async () => {
            result.current.releaseCard('c');
            await sleep(60);
            await settle();
        });
        expect(server.doc.content).toBe('typed during delete');
    });
});

describe('AUD-08 — save status while a direct write is the only activity', () => {
    beforeEach(quiet);
    afterEach(() => jest.restoreAllMocks());

    it('reports "saving" while a direct write is in flight', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.holdNext();
        let write: Promise<unknown> = Promise.resolve();
        await act(async () => {
            write = result.current.writeDirect('c', {
                color: 'red',
                etag: 'V1',
            });
            await settle();
        });
        expect(result.current.saveState.status).toBe('saving');
        await act(async () => {
            open();
            await write;
            await settle();
        });
        expect(result.current.saveState.status).toBe('saved');
    });
});
