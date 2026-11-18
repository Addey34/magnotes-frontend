/** @jest-environment jsdom */

// MGN-DATA-01C-REV2 — version lineage under long chains. The fake server uses
// the real optimistic-concurrency rule (409 unless etag is the
// card's current version) and can fail, lose a response, or be edited
// "externally" at chosen points.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

type Update = { content?: string; etag?: string };
type Saved = { etag: string };
type Call = {
    n: number;
    base?: string;
    content?: string;
    outcome: 'ok' | '409' | 'network' | 'lost';
};

const drain = async (rounds = 4000) => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};

class Server {
    version = 0;
    content = '';
    calls: Call[] = [];
    failCalls = new Set<number>(); // rejected before reaching the "database"
    loseCalls = new Set<number>(); // applied, then the response is lost
    private count = 0;
    private waiting: Array<() => void> = [];
    gated = false;
    /** The card does not exist on the server (deleted, not yet restored). */
    deleted = false;

    get current() {
        return `v${this.version}`;
    }
    external(content: string) {
        this.version++;
        this.content = content;
    }
    /** Release the next gated call (waits until one is actually pending). */
    async step() {
        for (let i = 0; i < 4000 && this.waiting.length === 0; i++) {
            await Promise.resolve();
        }
        this.waiting.shift()?.();
        await drain(200);
    }
    async stepMany(count: number) {
        for (let i = 0; i < count; i++) await this.step();
    }
    openGate() {
        this.gated = false;
        this.waiting.splice(0).forEach((release) => release());
    }
    save = async (_id: string, payload: Update): Promise<Saved> => {
        const n = ++this.count;
        if (this.gated) await new Promise<void>((r) => this.waiting.push(r));
        const base = payload.etag;
        if (this.deleted) {
            this.calls.push({
                n,
                base,
                content: payload.content,
                outcome: 'network',
            });
            throw Object.assign(new Error('not found'), {
                response: { status: 404 },
            });
        }
        if (this.failCalls.has(n)) {
            this.calls.push({
                n,
                base,
                content: payload.content,
                outcome: 'network',
            });
            throw new Error('Network Error');
        }
        if (base !== this.current) {
            this.calls.push({
                n,
                base,
                content: payload.content,
                outcome: '409',
            });
            throw Object.assign(new Error('conflict'), {
                response: { status: 412 },
            });
        }
        this.version++;
        if (payload.content !== undefined) this.content = payload.content;
        if (this.loseCalls.has(n)) {
            this.calls.push({
                n,
                base,
                content: payload.content,
                outcome: 'lost',
            });
            throw new Error('Network Error');
        }
        this.calls.push({ n, base, content: payload.content, outcome: 'ok' });
        return { etag: this.current };
    };
}

const mountMany = (
    servers: Record<string, Server>,
    onSaved = jest.fn(),
    onError = jest.fn()
) =>
    renderHook(() =>
        useAutosave<Update, Saved>(
            (id, payload) => servers[id].save(id, payload),
            500,
            onError,
            onSaved
        )
    );
type Hook = ReturnType<typeof mountMany>['result'];

const schedule = async (
    result: Hook,
    id: string,
    text: string,
    base: string
) => {
    await act(async () => {
        result.current.scheduleSave(id, {
            content: text,
            etag: base,
        });
        jest.advanceTimersByTime(500);
        await Promise.resolve();
    });
};
const conflicts = (server: Server) =>
    server.calls.filter((c) => c.outcome === '409');

describe('useAutosave — MGN-DATA-01C-REV2 version lineage', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    // ---- 1. long chains, every write based on the version the card showed
    it.each([16, 17, 20, 64, 100])(
        '1. %i writes queued behind one stuck request: no false conflict, exact final content',
        async (count) => {
            const server = new Server();
            const { result } = mountMany({ c: server });
            server.gated = true;
            for (let i = 1; i <= count; i++)
                await schedule(result, 'c', `t${i}`, 'v0');
            await act(async () => {
                server.openGate();
                await drain(count * 80);
            });
            expect(conflicts(server)).toHaveLength(0);
            expect(server.content).toBe(`t${count}`);
            expect(server.calls.filter((c) => c.outcome === 'ok')).toHaveLength(
                count
            );
            expect(result.current.saveState.status).toBe('saved');
        }
    );

    // ---- 2. a write that still depends on an old version while the chain advances
    it('2. a late write still based on an old version resolves through the whole chain', async () => {
        const server = new Server();
        const { result } = mountMany({ c: server });
        server.gated = true;
        for (let i = 1; i <= 6; i++) await schedule(result, 'c', `t${i}`, 'v0');
        await server.stepMany(3); // v1, v2, v3 acknowledged; t4..t6 still wait
        // A write is scheduled from a view of the card that is two acks behind.
        await schedule(result, 'c', 'late', 'v1');
        await act(async () => {
            server.openGate();
            await drain(2000);
        });
        expect(conflicts(server)).toHaveLength(0);
        expect(server.content).toBe('late');
    });

    // ---- 3. failure in the middle of a long chain
    it('3. a failed write in the middle of a chain neither breaks the chain nor leaks stale text', async () => {
        const server = new Server();
        server.failCalls.add(10);
        const { result } = mountMany({ c: server });
        server.gated = true;
        for (let i = 1; i <= 30; i++)
            await schedule(result, 'c', `t${i}`, 'v0');
        await act(async () => {
            server.openGate();
            await drain(3000);
        });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await drain(500);
        });
        expect(conflicts(server)).toHaveLength(0);
        expect(
            server.calls.filter((c) => c.outcome === 'network')
        ).toHaveLength(1);
        expect(server.content).toBe('t30');
        // The failed text was superseded by newer text: it must never come back.
        const last = server.calls.filter((c) => c.outcome === 'ok').at(-1)!;
        expect(last.content).toBe('t30');
    });

    it('3b. a lost response is not an acknowledgement: later writes keep the last REAL base', async () => {
        const server = new Server();
        server.loseCalls.add(5);
        const { result } = mountMany({ c: server });
        server.gated = true;
        for (let i = 1; i <= 8; i++) await schedule(result, 'c', `t${i}`, 'v0');
        await act(async () => {
            server.openGate();
            await drain(2000);
        });
        // Call 5 was applied (server at v5) but never acknowledged: calls 6..8
        // are still based on v4 and are refused rather than guessed forward.
        const afterLoss = server.calls.filter((c) => c.n > 5);
        expect(afterLoss.length).toBeGreaterThan(0);
        expect(
            afterLoss.every((c) => c.outcome === '409' && c.base === 'v4')
        ).toBe(true);
        expect(server.content).toBe('t5');
    });

    // ---- 4. external modification in the middle of the chain
    it('4. an external edit in the middle of a chain stops it: nothing is adopted or overwritten', async () => {
        const server = new Server();
        const { result } = mountMany({ c: server });
        server.gated = true;
        for (let i = 1; i <= 30; i++)
            await schedule(result, 'c', `t${i}`, 'v0');
        await server.stepMany(10); // v10 acknowledged by us
        server.external('theirs'); // v11, produced elsewhere
        await act(async () => {
            server.openGate();
            await drain(3000);
        });
        const after = server.calls.filter((c) => c.n > 10);
        expect(after).toHaveLength(20);
        expect(after.every((c) => c.outcome === '409')).toBe(true);
        // They were based on OUR last acknowledged version, never on the
        // external one.
        expect(after.every((c) => c.base === 'v10')).toBe(true);
        expect(server.content).toBe('theirs');
    });

    // ---- 5. independent chains on several cards
    it('5. several cards keep fully independent chains', async () => {
        const servers = { a: new Server(), b: new Server(), c: new Server() };
        const { result } = mountMany(servers);
        Object.values(servers).forEach((s) => (s.gated = true));
        for (let i = 1; i <= 25; i++) {
            for (const id of ['a', 'b', 'c'])
                await schedule(result, id, `${id}${i}`, 'v0');
        }
        servers.b.external('theirs-b'); // only card b is edited elsewhere
        await act(async () => {
            Object.values(servers).forEach((s) => s.openGate());
            await drain(8000);
        });
        expect(conflicts(servers.a)).toHaveLength(0);
        expect(conflicts(servers.c)).toHaveLength(0);
        expect(servers.a.content).toBe('a25');
        expect(servers.c.content).toBe('c25');
        expect(servers.b.content).toBe('theirs-b');
        expect(conflicts(servers.b).length).toBeGreaterThan(0);
    });

    // ---- 6 & 7. deletion and restoration during a chain, late answer of an old epoch
    it('6/7. deleting mid-chain drops the old life; a restored card starts clean and the late answer is ignored', async () => {
        const server = new Server();
        const onSaved = jest.fn();
        const onError = jest.fn();
        const { result } = mountMany({ c: server }, onSaved, onError);
        server.gated = true;
        for (let i = 1; i <= 12; i++)
            await schedule(result, 'c', `old${i}`, 'v0');
        await server.stepMany(5); // v5 acknowledged; call 6 is now on the wire
        const acknowledgedBefore = onSaved.mock.calls.length;

        act(() => result.current.discardCard('c'));
        server.deleted = true; // the deletion reached the server
        expect(result.current.diagnostics('c')).toEqual({
            lineage: 0,
            awaiting: 0,
        });
        await server.step(); // the old in-flight write meets a deleted card (404)
        expect(onError).not.toHaveBeenCalled(); // late failure of an old epoch is silent
        expect(onSaved.mock.calls.length).toBe(acknowledgedBefore);
        expect(result.current.diagnostics('c')).toEqual({
            lineage: 0,
            awaiting: 0,
        });

        // Undo: the card is restored under the same id with the snapshot version.
        server.deleted = false;
        await schedule(result, 'c', 'new-life', server.current);
        await act(async () => {
            server.openGate();
            await drain(3000);
        });
        expect(onSaved.mock.calls.length - acknowledgedBefore).toBe(1);
        // No old-life write reached the server after the restoration.
        expect(
            server.calls.filter(
                (c) =>
                    c.outcome === 'ok' &&
                    c.content?.startsWith('old') &&
                    c.n > 6
            )
        ).toHaveLength(0);
        expect(server.content).toBe('new-life');
        expect(conflicts(server)).toHaveLength(0);
        expect(result.current.saveState.status).toBe('saved');
    });

    // ---- 8. references are released once everything has settled
    it('8. after a 100-write chain settles, the bookkeeping is released (no growth)', async () => {
        const server = new Server();
        const { result } = mountMany({ c: server });
        server.gated = true;
        for (let i = 1; i <= 100; i++)
            await schedule(result, 'c', `t${i}`, 'v0');
        await act(async () => {
            server.openGate();
            await drain(9000);
        });
        const size = result.current.diagnostics('c');
        expect(size.awaiting).toBe(0);
        expect(size.lineage).toBeLessThanOrEqual(2);
        act(() => result.current.discardCard('c'));
        expect(result.current.diagnostics('c')).toEqual({
            lineage: 0,
            awaiting: 0,
        });
    });

    it('8b. 500 sequential saves, each settled before the next, never grow the lineage', async () => {
        const server = new Server();
        const { result } = mountMany({ c: server });
        let base = 'v0';
        for (let i = 1; i <= 500; i++) {
            await schedule(result, 'c', `t${i}`, base);
            await act(async () => {
                await drain(60);
            });
            base = server.current;
            expect(result.current.diagnostics('c').lineage).toBeLessThanOrEqual(
                2
            );
        }
        expect(conflicts(server)).toHaveLength(0);
        expect(server.content).toBe('t500');
    });
});
