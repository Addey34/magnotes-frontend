/** @jest-environment jsdom */

// MGN-DATA-01C-REV1 — counter-audit of the autosave invariants. The fake
// server applies the SAME optimistic-concurrency rule as the real one: a write
// whose etag is not the card's current version is refused (409);
// an accepted write moves the card to a new version.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

type Update = { content?: string; title?: string; etag?: string };
type Saved = { etag: string; content?: string };

const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

class FakeServer {
    version = 0;
    content = '';
    calls: Array<{ base?: string; content?: string; outcome: string }> = [];
    private gate: Promise<void> | null = null;
    private openGate: (() => void) | null = null;
    /** The next write blocks until release(). */
    hold() {
        this.gate = new Promise<void>((resolve) => (this.openGate = resolve));
    }
    release() {
        this.openGate?.();
        this.gate = null;
    }
    /** Another browser/device edits the card. */
    external(content: string) {
        this.version++;
        this.content = content;
    }
    get current() {
        return `v${this.version}`;
    }
    save = async (_id: string, payload: Update): Promise<Saved> => {
        const gate = this.gate;
        this.gate = null; // only the first call after hold() blocks
        if (gate) await gate;
        if (payload.etag !== this.current) {
            this.calls.push({
                base: payload.etag,
                content: payload.content,
                outcome: '409',
            });
            throw Object.assign(new Error('conflict'), {
                response: { status: 412 },
            });
        }
        this.version++;
        if (payload.content !== undefined) this.content = payload.content;
        this.calls.push({
            base: payload.etag,
            content: payload.content,
            outcome: 'ok',
        });
        return { etag: this.current, content: this.content };
    };
}

const mount = (server: FakeServer, onSaved = jest.fn(), onError = jest.fn()) =>
    renderHook(() =>
        useAutosave<Update, Saved>(server.save, 500, onError, onSaved)
    );

const type = async (
    result: { current: ReturnType<typeof useAutosave<Update, Saved>> },
    text: string,
    base: string
) => {
    await act(async () => {
        result.current.scheduleSave('c', {
            content: text,
            etag: base,
        });
        jest.advanceTimersByTime(500);
        await settle();
    });
};

describe('useAutosave — MGN-DATA-01C-REV1 invariants', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    // ---- 1 & 2: long chains and lineage expiry --------------------------
    const queuedBehindAStuckRequest = async (count: number) => {
        const server = new FakeServer();
        const { result } = mount(server);
        server.hold();
        // The card keeps showing v0 for the whole time the first request is
        // stuck, so every queued write is based on v0.
        for (let i = 1; i <= count; i++) await type(result, `t${i}`, 'v0');
        await act(async () => {
            server.release();
            await settle();
        });
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await settle();
        });
        return server;
    };

    it('1a. 17 writes queued behind one stuck request are all accepted (control)', async () => {
        const server = await queuedBehindAStuckRequest(17);
        expect(server.calls.filter((c) => c.outcome === '409')).toHaveLength(0);
        expect(server.content).toBe('t17');
    });

    it('1b/2. 20 writes queued behind one stuck request: none is refused by our own earlier writes', async () => {
        const server = await queuedBehindAStuckRequest(20);
        // Self-inflicted conflicts once the lineage is capped.
        expect(server.calls.filter((c) => c.outcome === '409').length).toBe(0);
        expect(server.content).toBe('t20');
    });

    // ---- 3: external modification between two local writes -------------
    it('3. an external edit between two local writes is refused, never adopted or overwritten', async () => {
        const server = new FakeServer();
        const onError = jest.fn();
        const { result } = mount(server, jest.fn(), onError);
        await type(result, 'mine-1', 'v0'); // ok -> v1
        server.external('theirs'); // -> v2 (another device)
        await type(result, 'mine-2', 'v1'); // based on what we acknowledged
        expect(server.content).toBe('theirs');
        expect(onError).toHaveBeenCalledTimes(1);
        expect(server.calls.at(-1)).toMatchObject({
            base: 'v1',
            outcome: '409',
        });
    });

    it('3b. an external edit while a write is queued behind another one is still refused', async () => {
        const server = new FakeServer();
        const { result } = mount(server);
        server.hold();
        await type(result, 'a', 'v0');
        await type(result, 'ab', 'v0'); // queued behind a
        server.external('theirs'); // v1 on the server before a even lands
        await act(async () => {
            server.release();
            await settle();
        });
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await settle();
        });
        expect(server.content).toBe('theirs');
        expect(server.calls.every((c) => c.outcome === '409')).toBe(true);
    });

    // ---- 4: typing again after a 409 ------------------------------------
    it('4. typing again after a conflict never bypasses it and never replays the refused text on its own', async () => {
        const server = new FakeServer();
        const { result } = mount(server);
        server.external('theirs'); // v1: our base v0 is stale
        await type(result, 'mine', 'v0'); // 409
        expect(result.current.saveState.status).toBe('error');
        const callsAfterConflict = server.calls.length;

        // The user types again; the card (not reloaded) still shows v0.
        await type(result, 'mine-more', 'v0');
        expect(
            server.calls.slice(callsAfterConflict).map((c) => c.outcome)
        ).toEqual(['409']);
        expect(server.content).toBe('theirs');

        // Back online / page hidden: nothing is resent by itself.
        const before = server.calls.length;
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            window.dispatchEvent(new Event('pagehide'));
            await settle();
        });
        expect(server.calls.length).toBe(before);
    });

    it('4b. after a conflict, a write based on a fresh version carries only the new field', async () => {
        const server = new FakeServer();
        const { result } = mount(server);
        server.external('theirs');
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'refused',
                etag: 'v0',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        await act(async () => {
            result.current.scheduleSave('c', {
                title: 'T',
                etag: server.current,
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        const last = server.calls.at(-1)!;
        expect(last.outcome).toBe('ok');
        // The conflicted text is not smuggled in.
        expect(last.content).toBeUndefined();
        expect(server.content).toBe('theirs');
    });

    // ---- 5: a lost response is never an acknowledgement ------------------
    it('5. a lost response is not an acknowledgement: the next write keeps its original base', async () => {
        const server = new FakeServer();
        const { result } = mount(server);
        // Write A reaches the server, but the browser never gets the answer.
        const lossy = jest.fn(async (id: string, payload: Update) => {
            await server.save(id, payload);
            throw new Error('Network Error');
        });
        const { result: lossyResult } = renderHook(() =>
            useAutosave<Update, Saved>(lossy, 500)
        );
        await act(async () => {
            lossyResult.current.scheduleSave('c', {
                content: 'a',
                etag: 'v0',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        expect(server.version).toBe(1); // really applied
        await act(async () => {
            lossyResult.current.scheduleSave('c', {
                content: 'ab',
                etag: 'v0',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        // B was sent with v0 (not advanced to v1 on a guess) and was refused.
        expect(lossy.mock.calls[1][1].etag).toBe('v0');
        expect(server.calls.at(-1)).toMatchObject({
            base: 'v0',
            outcome: '409',
        });
        void result;
    });

    // ---- 7: failed deletion, writes resume -------------------------------
    it('7. edits made while a deletion is pending are merged and sent once it failed', async () => {
        const server = new FakeServer();
        const { result } = mount(server);
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'before',
                etag: 'v0',
            });
            result.current.holdCard('c');
            jest.advanceTimersByTime(1000);
            result.current.scheduleSave('c', {
                title: 'during',
                etag: 'v0',
            });
            jest.advanceTimersByTime(1000);
            await settle();
        });
        expect(server.calls).toHaveLength(0);
        await act(async () => {
            result.current.releaseCard('c');
            await settle();
        });
        expect(server.calls).toHaveLength(1);
        expect(server.calls[0]).toMatchObject({
            content: 'before',
            outcome: 'ok',
        });
    });

    // ---- 8: same id restored after deletion ------------------------------
    it('8. a card restored under the same id writes normally and ignores the late answer of its previous life', async () => {
        const server = new FakeServer();
        const onSaved = jest.fn();
        const { result } = mount(server, onSaved);
        server.hold();
        await type(result, 'old-life', 'v0'); // in flight, blocked
        act(() => result.current.discardCard('c')); // deleted
        // Undo: the card is back with its snapshot version, the user types.
        await type(result, 'new-life', 'v0');
        await act(async () => {
            server.release();
            await settle();
        });
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await settle();
        });
        // LOT-B3: the restored card has a queue of its own, so its write is
        // not delayed by the old request that stays on the wire: it lands
        // first. The old life's request lands later and is refused by the
        // server (previous generation); its answer is never mistaken for an
        // echo of the new life.
        expect(onSaved).not.toHaveBeenCalledWith(
            'c',
            expect.objectContaining({ content: 'old-life' }),
            expect.anything()
        );
        expect(server.calls.map((c) => c.content)).toEqual([
            'new-life',
            'old-life',
        ]);
        expect(server.calls.map((c) => c.outcome)).toEqual(['ok', '409']);
    });

    // ---- 9: a late answer from another session never touches this one ----
    it('9. the late answer of an unmounted session does not alter a new session', async () => {
        const server = new FakeServer();
        const first = mount(server);
        server.hold();
        await type(first.result, 'session-a', 'v0');
        first.unmount(); // logout
        const onSavedB = jest.fn();
        const second = mount(new FakeServer(), onSavedB);
        await act(async () => {
            server.release();
            await settle();
        });
        expect(onSavedB).not.toHaveBeenCalled();
        expect(second.result.current.saveState.status).toBe('idle');
    });
});
