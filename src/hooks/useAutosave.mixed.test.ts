/** @jest-environment jsdom */

// MGN-DATA-01D-01 — autosave writes and direct writes (move, resize, zIndex,
// board change, stack, undo...) of one card share one queue and one version
// lineage. The fake server applies the real optimistic-concurrency rule.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

type Update = {
    content?: string;
    x?: number;
    zIndex?: number;
    etag?: string;
};
type Saved = { etag: string };
type Call = { n: number; base?: string; fields: string; outcome: string };

const drain = async (rounds = 3000) => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};

class Server {
    version = 0;
    doc: Record<string, unknown> = {};
    calls: Call[] = [];
    gated = false;
    lose = new Set<number>();
    private count = 0;
    private waiting: Array<() => void> = [];
    get current() {
        return `v${this.version}`;
    }
    external(patch: Record<string, unknown>) {
        this.version++;
        Object.assign(this.doc, patch);
    }
    async step() {
        for (let i = 0; i < 3000 && this.waiting.length === 0; i++) {
            await Promise.resolve();
        }
        this.waiting.shift()?.();
        await drain(200);
    }
    open() {
        this.gated = false;
        this.waiting.splice(0).forEach((r) => r());
    }
    save = async (_id: string, payload: Update): Promise<Saved> => {
        const n = ++this.count;
        if (this.gated) await new Promise<void>((r) => this.waiting.push(r));
        const { etag: base, ...fields } = payload;
        const label = Object.keys(fields).sort().join('+');
        if (base !== this.current) {
            this.calls.push({ n, base, fields: label, outcome: '409' });
            throw Object.assign(new Error('conflict'), {
                response: { status: 412 },
            });
        }
        this.version++;
        Object.assign(this.doc, fields);
        if (this.lose.has(n)) {
            this.calls.push({ n, base, fields: label, outcome: 'lost' });
            throw new Error('Network Error');
        }
        this.calls.push({ n, base, fields: label, outcome: 'ok' });
        return { etag: this.current };
    };
}

const mount = (servers: Record<string, Server>, onError = jest.fn()) =>
    renderHook(() =>
        useAutosave<Update, Saved>(
            (id, payload) => servers[id].save(id, payload),
            500,
            onError
        )
    );
type Hook = ReturnType<typeof mount>['result'];

const type = async (r: Hook, id: string, content: string, base: string) => {
    await act(async () => {
        r.current.scheduleSave(id, { content, etag: base });
        await Promise.resolve();
    });
};
const typeAndFlush = async (r: Hook, id: string, c: string, base: string) => {
    await type(r, id, c, base);
    await act(async () => {
        jest.advanceTimersByTime(500);
        await Promise.resolve();
    });
};
const direct = (r: Hook, id: string, u: Update, base: string) =>
    r.current.writeDirect(id, { ...u, etag: base });
const conflicts = (s: Server) => s.calls.filter((c) => c.outcome === '409');

describe('useAutosave — MGN-DATA-01D-01 mixed write chains', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('1. text during the debounce, then a move: both persisted, no 409', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        await type(result, 'c', 'hello', 'v0'); // still in the debounce
        await act(async () => {
            await direct(result, 'c', { x: 50 }, 'v0');
        });
        await act(async () => {
            jest.advanceTimersByTime(500);
            await drain();
        });
        expect(conflicts(s)).toHaveLength(0);
        expect(s.doc).toEqual({ x: 50, content: 'hello' });
        expect(s.calls.map((c) => c.fields)).toEqual(['x', 'content']);
        expect(result.current.saveState.status).toBe('saved');
    });

    it('2. text in flight, then a move: the move waits and follows the acknowledged version', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        s.gated = true;
        await typeAndFlush(result, 'c', 'hello', 'v0');
        let moved: Promise<unknown> = Promise.resolve();
        await act(async () => {
            moved = direct(result, 'c', { x: 50 }, 'v0');
            await drain(50);
        });
        expect(s.calls).toHaveLength(0); // nothing overtook the text write
        await act(async () => {
            s.open();
            await moved;
            await drain();
        });
        expect(conflicts(s)).toHaveLength(0);
        expect(s.calls.map((c) => c.fields)).toEqual(['content', 'x']);
        expect(s.calls[1].base).toBe('v1');
        expect(s.doc).toEqual({ content: 'hello', x: 50 });
    });

    it('3. a move in flight, then typing from the stale card: the text follows it', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        s.gated = true;
        let moved: Promise<unknown> = Promise.resolve();
        await act(async () => {
            moved = direct(result, 'c', { x: 50 }, 'v0');
            await drain(50);
        });
        await typeAndFlush(result, 'c', 'typed', 'v0'); // card still shows v0
        await act(async () => {
            s.open();
            await moved;
            await drain();
        });
        expect(conflicts(s)).toHaveLength(0);
        expect(s.calls.map((c) => c.fields)).toEqual(['x', 'content']);
        expect(s.doc).toEqual({ x: 50, content: 'typed' });
    });

    it('4/5/6/7/8. many alternating text and distinct-field direct writes: all fields kept, no 409', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        s.gated = true;
        const pending: Array<Promise<unknown>> = [];
        for (let i = 1; i <= 20; i++) {
            await typeAndFlush(result, 'c', `t${i}`, 'v0');
            await act(async () => {
                pending.push(
                    direct(result, 'c', i % 2 ? { x: i } : { zIndex: i }, 'v0')
                );
                await Promise.resolve();
            });
        }
        await act(async () => {
            s.open();
            await Promise.all(pending);
            await drain(6000);
        });
        expect(conflicts(s)).toHaveLength(0);
        expect(s.doc).toEqual({ content: 't20', x: 19, zIndex: 20 });
        expect(s.calls.every((c) => c.outcome === 'ok')).toBe(true);
    });

    it('9. a direct write based on a stale snapshot (undo/redo) follows the chain', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        s.gated = true;
        await typeAndFlush(result, 'c', 'a', 'v0');
        let undone: Promise<unknown> = Promise.resolve();
        await act(async () => {
            undone = direct(result, 'c', { x: 1 }, 'v0');
            await Promise.resolve();
        });
        await act(async () => {
            s.open();
            await undone;
            await drain();
        });
        expect(conflicts(s)).toHaveLength(0);
        expect(s.doc).toEqual({ content: 'a', x: 1 });
    });

    it('10. a failed move rejects to its caller (rollback) and does not lose or block the pending text', async () => {
        const s = new Server();
        const onError = jest.fn();
        const { result } = mount({ c: s }, onError);
        await type(result, 'c', 'keep-me', 'v0');
        const real = s.save;
        s.save = jest
            .fn()
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockImplementation(real);
        let error: unknown;
        await act(async () => {
            await direct(result, 'c', { x: 9 }, 'v0').catch((e) => {
                error = e;
            });
        });
        expect((error as Error).message).toBe('Network Error');
        expect(onError).not.toHaveBeenCalled(); // the caller owns direct errors
        await act(async () => {
            jest.advanceTimersByTime(500);
            await drain();
        });
        expect(s.doc).toEqual({ content: 'keep-me' });
        expect(conflicts(s)).toHaveLength(0);
    });

    it('11. an external edit during a mixed chain is detected: nothing adopted, nothing overwritten', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        s.gated = true;
        await typeAndFlush(result, 'c', 'mine', 'v0');
        let moved: Promise<unknown> = Promise.resolve();
        await act(async () => {
            moved = direct(result, 'c', { x: 50 }, 'v0').catch((e) => e);
            await Promise.resolve();
        });
        await s.step(); // text acknowledged: v1
        s.external({ content: 'theirs' }); // v2, produced elsewhere
        await act(async () => {
            s.open();
            const error = (await moved) as { response?: { status?: number } };
            expect(error.response?.status).toBe(412);
            await drain();
        });
        expect(s.doc).toEqual({ content: 'theirs' });
        expect(s.calls.at(-1)).toMatchObject({ base: 'v1', outcome: '409' });
    });

    it('12. two cards are saved independently', async () => {
        const a = new Server();
        const b = new Server();
        const { result } = mount({ a, b });
        a.gated = true; // card a is stuck
        await typeAndFlush(result, 'a', 'stuck', 'v0');
        await act(async () => {
            await direct(result, 'b', { x: 5 }, 'v0');
        });
        await typeAndFlush(result, 'b', 'free', 'v0');
        await act(async () => {
            await drain();
        });
        expect(b.doc).toEqual({ x: 5, content: 'free' });
        expect(a.calls).toHaveLength(0);
        expect(conflicts(b)).toHaveLength(0);
    });

    it('13. deleting during a mixed chain: the queued direct write is refused locally and nothing is sent after', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        s.gated = true;
        await typeAndFlush(result, 'c', 'a', 'v0');
        let moved: Promise<unknown> = Promise.resolve();
        let rejection: unknown;
        await act(async () => {
            moved = direct(result, 'c', { x: 7 }, 'v0').catch((e) => {
                rejection = e;
            });
            await Promise.resolve();
        });
        act(() => result.current.discardCard('c'));
        await act(async () => {
            s.open();
            await moved;
            await drain();
        });
        expect((rejection as Error).message).toBe('Card was discarded');
        // Only the write that was already on the wire reached the server.
        expect(s.calls.map((c) => c.fields)).toEqual(['content']);
        expect(result.current.diagnostics('c')).toEqual({
            lineage: 0,
            awaiting: 0,
        });
    });

    it('14. the late answer of an old epoch does not feed the lineage nor affect the restored card', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        s.gated = true;
        let old: Promise<unknown> = Promise.resolve();
        await act(async () => {
            old = direct(result, 'c', { x: 1 }, 'v0').catch(() => undefined);
            await Promise.resolve();
        });
        act(() => result.current.discardCard('c'));
        await act(async () => {
            s.open();
            await old;
            await drain();
        });
        // The old write landed (v1) but is invisible: no lineage entry.
        expect(result.current.diagnostics('c').lineage).toBe(0);
        // Restored card: written from the snapshot version the server holds.
        await act(async () => {
            await direct(result, 'c', { x: 2 }, s.current);
        });
        expect(s.doc).toEqual({ x: 2 });
        expect(conflicts(s)).toHaveLength(0);
    });

    it('control (RED shape of the original defect): a direct write sent outside the shared queue makes the text conflict with our own write', async () => {
        const s = new Server();
        const { result } = mount({ c: s });
        s.gated = true;
        await typeAndFlush(result, 'c', 'hello', 'v0');
        // Bypass: the move goes straight to the server instead of writeDirect.
        s.open();
        await act(async () => {
            await s.save('c', { x: 50, etag: 'v0' }).catch(() => 0);
            await drain();
        });
        expect(conflicts(s).length).toBeGreaterThan(0);
        expect(s.doc).toEqual({ x: 50 }); // the text never landed
    });

    it('a lost response of a direct write is not an acknowledgement', async () => {
        const s = new Server();
        s.lose.add(1);
        const { result } = mount({ c: s });
        await act(async () => {
            await direct(result, 'c', { x: 1 }, 'v0').catch(() => undefined);
        });
        await typeAndFlush(result, 'c', 'later', 'v0');
        await act(async () => {
            await drain();
        });
        // Applied (v1) but never acknowledged: the text keeps its real base.
        expect(s.calls.at(-1)).toMatchObject({ base: 'v0', outcome: '409' });
        expect(s.doc).toEqual({ x: 1 });
    });
});
