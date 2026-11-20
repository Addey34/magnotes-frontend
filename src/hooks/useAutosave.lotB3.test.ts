/** @jest-environment jsdom */

// MGN-DATA-01-LOT-B3 — lifecycle gate, suspension barrier, provenance and
// causal compatibility of the write coordinator.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';
import { isStaleLifecycle } from '../services/concurrencyOutcome';

type Update = Record<string, unknown> & { etag?: string };
type Saved = { etag: string; content?: unknown } & Record<string, unknown>;

const conflict = () =>
    Object.assign(new Error('precondition failed'), {
        response: { status: 412, data: { code: 'PRECONDITION_FAILED' } },
    });
const lost = () => new Error('Network Error');

class Server {
    counter = 0;
    doc: Record<string, unknown> = {};
    etag = 'E1';
    calls: Array<{ id: string; base?: string; fields: Update; out: string }> =
        [];
    gates: Array<() => boolean> = [];
    private holds: Array<{
        match: (u: Update) => boolean;
        mode: 'before' | 'after-lost' | 'before-lost';
        open: () => void;
        gate: Promise<void>;
        used: boolean;
    }> = [];
    /** Hold the next request matching `match` (not applied until opened). */
    hold(
        match: (u: Update) => boolean = () => true,
        mode: 'before' | 'after-lost' | 'before-lost' = 'before'
    ) {
        let open!: () => void;
        const gate = new Promise<void>((r) => (open = r));
        this.holds.push({ match, mode, open, gate, used: false });
        return open;
    }
    external(patch: Record<string, unknown>) {
        Object.assign(this.doc, patch);
        this.etag = `X${++this.counter}`;
        return this.etag;
    }
    save = async (id: string, payload: Update): Promise<Saved> => {
        const { etag: base, ...fields } = payload;
        const rule = this.holds.find((h) => !h.used && h.match(payload));
        if (rule) rule.used = true;
        if (rule && rule.mode !== 'after-lost') await rule.gate;
        if (rule?.mode === 'before-lost') {
            this.calls.push({ id, base, fields, out: 'lost-before' });
            throw lost();
        }
        if (base !== this.etag) {
            this.calls.push({ id, base, fields, out: '412' });
            throw conflict();
        }
        Object.assign(this.doc, fields);
        this.etag = `S${++this.counter}`;
        this.calls.push({ id, base, fields, out: 'ok' });
        if (rule?.mode === 'after-lost') {
            await rule.gate;
            throw lost();
        }
        return { etag: this.etag, ...fields };
    };
}

const flush = async (rounds = 400) => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mount = (
    server: Server,
    extra: {
        onError?: jest.Mock;
        onSaved?: jest.Mock;
        owner?: () => string | null;
        requireVersion?: boolean;
    } = {}
) =>
    renderHook(() =>
        useAutosave<Update, Saved>(
            (id, payload) => server.save(id, payload),
            20,
            extra.onError,
            extra.onSaved,
            {
                requireVersion: () => extra.requireVersion ?? true,
                ...(extra.owner ? { owner: extra.owner } : {}),
            }
        )
    );

describe('LOT-B3 — AUD-07: suspension is checked when the request really leaves', () => {
    beforeEach(() =>
        jest.spyOn(console, 'error').mockImplementation(() => undefined)
    );
    afterEach(() => jest.restoreAllMocks());

    it('a direct write issued while the card is held is not sent and stays suspended (recoverable) until release', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.holdCard('c'));
        let done = false;
        await act(async () => {
            void result.current
                .writeDirect('c', { x: 5, etag: 'E1' })
                .then(() => (done = true));
            await flush();
        });
        expect(server.calls).toHaveLength(0);
        expect(done).toBe(false);
        expect(
            result.current
                .recoverable('c')
                .some((i) => i.state === 'suspended' && i.fields.x === 5)
        ).toBe(true);
        await act(async () => {
            result.current.releaseCard('c');
            await flush();
        });
        expect(server.calls.map((c) => c.out)).toEqual(['ok']);
        expect(done).toBe(true);
        expect(
            result.current.recoverable('c').filter((i) => i.state !== 'pending')
        ).toHaveLength(0);
    });

    it('a direct write held then discarded never leaves and rejects as a stale lifecycle', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.holdCard('c'));
        let error: unknown;
        await act(async () => {
            void result.current
                .writeDirect('c', { x: 5, etag: 'E1' })
                .catch((e) => (error = e));
            await flush();
            result.current.discardCard('c');
            await flush();
        });
        expect(server.calls).toHaveLength(0);
        expect(isStaleLifecycle(error)).toBe(true);
    });

    it('an autosave chained behind an in-flight write goes back to the intentions (recoverable) when the card is held, and leaves on release', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold((u) => 'content' in u);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'first', etag: 'E1' });
            await sleep(60);
            result.current.scheduleSave('c', { title: 'second', etag: 'E1' });
            await sleep(60);
            result.current.holdCard('c');
            open();
            await flush();
            await sleep(40);
        });
        expect(server.calls.map((c) => Object.keys(c.fields))).toEqual([
            ['content'],
        ]);
        expect(
            result.current
                .recoverable('c')
                .some((i) => i.fields.title === 'second')
        ).toBe(true);
        await act(async () => {
            result.current.releaseCard('c');
            await sleep(80);
            await flush();
        });
        expect(server.doc.title).toBe('second');
    });

    it('an autosave group whose turn comes while the card is held is not sent, even with several groups in the same operation', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold((u) => 'content' in u);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a', etag: 'E1' });
            await sleep(60);
            result.current.scheduleSave('c', { color: 'red', etag: 'E1' });
            result.current.scheduleSave('c', { title: 't', etag: 'E1' });
            await sleep(10);
            result.current.holdCard('c');
            open();
            await flush();
            await sleep(60);
        });
        expect(server.calls).toHaveLength(1);
        await act(async () => {
            result.current.discardCard('c');
            await flush();
        });
        expect(server.calls).toHaveLength(1);
    });
});

describe('LOT-B3 — wire / settle states used by the deletion', () => {
    beforeEach(() =>
        jest.spyOn(console, 'error').mockImplementation(() => undefined)
    );
    afterEach(() => jest.restoreAllMocks());

    it('settle waits only for requests that really left, never for suspended intentions (no deadlock)', async () => {
        const server = new Server();
        const { result } = mount(server);
        let outcome: unknown;
        await act(async () => {
            result.current.holdCard('c');
            void result.current
                .writeDirect('c', { x: 1, etag: 'E1' })
                .catch(() => undefined);
            outcome = await result.current.settle('c', 200);
        });
        expect(outcome).toBe('settled');
        expect(server.calls).toHaveLength(0);
    });

    it('settle reports "uncertain" when a request is still on the wire at expiry', async () => {
        const server = new Server();
        const { result } = mount(server);
        server.hold(() => true);
        let outcome: unknown;
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a', etag: 'E1' });
            await sleep(60);
            result.current.holdCard('c');
            outcome = await result.current.settle('c', 80);
        });
        expect(outcome).toBe('uncertain');
    });

    it('settle reports "settled" once the on-wire write is acknowledged and rebase follows it', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold(() => true);
        let outcome: unknown;
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a', etag: 'E1' });
            await sleep(60);
            result.current.holdCard('c');
            setTimeout(open, 30);
            outcome = await result.current.settle('c', 500);
        });
        expect(outcome).toBe('settled');
        expect(result.current.rebase('c', 'E1')).toBe(server.etag);
    });

    it('a write whose answer was lost keeps the card "uncertain" until an acknowledged write resolves it', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold(() => true, 'after-lost');
        let outcome: unknown;
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a', etag: 'E1' });
            await sleep(60);
            open();
            await flush();
            await sleep(30);
            outcome = await result.current.settle('c', 50);
        });
        expect(outcome).toBe('uncertain');
        // the failed intention is kept and retried on its own base: the server
        // already applied it, so the retry is refused (412) and the answer to
        // that refusal settles the uncertainty.
        await act(async () => {
            await result.current.flushPending();
            await flush();
        });
        outcome = await result.current.settle('c', 50);
        expect(outcome).toBe('settled');
    });
});

describe('LOT-B3 — provenance of local content (B2-AUD-01)', () => {
    beforeEach(() =>
        jest.spyOn(console, 'error').mockImplementation(() => undefined)
    );
    afterEach(() => jest.restoreAllMocks());

    it('typing on top of an unreconciled local text never carries the newly observed token: B is not overwritten', async () => {
        const server = new Server();
        server.doc.content = 'seed';
        const { result } = mount(server);
        // A is typed on E1 and its write fails (lost): the intention stays.
        const open = server.hold(() => true, 'before-lost');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'A', etag: 'E1' });
            await sleep(60);
            open();
            await flush();
            await sleep(30);
        });
        // Another device saves B, the board is read again: E2 is adopted but
        // the field still shows A (unsent intention).
        const e2 = server.external({ content: 'B' });
        // The user continues typing on A: the card now shows the E2 token.
        await act(async () => {
            result.current.scheduleSave('c', { content: 'A+', etag: e2 });
            await sleep(80);
            await flush();
        });
        expect(server.doc.content).toBe('B'); // never overwritten silently
        const kept = result.current.recoverable('c');
        expect(kept.some((i) => i.fields.content === 'A+')).toBe(true);
        // provenance never blanked: no intention that carries A+ rests on E2
        expect(
            kept.filter((i) => i.fields.content === 'A+' && i.base === e2)
        ).toHaveLength(0);
    });

    it('control: a field that has no unreconciled content uses the observed token normally', async () => {
        const server = new Server();
        const { result } = mount(server);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'one', etag: 'E1' });
            await sleep(80);
            await flush();
        });
        await act(async () => {
            result.current.scheduleSave('c', { content: 'two', etag: 'S1' });
            await sleep(80);
            await flush();
        });
        expect(server.doc.content).toBe('two');
        expect(server.calls.every((c) => c.out === 'ok')).toBe(true);
    });

    it('control: continuing to type while the first write is in flight stays on the same causal line', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold(() => true);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a', etag: 'E1' });
            await sleep(60);
            result.current.scheduleSave('c', { content: 'ab', etag: 'E1' });
            open();
            await sleep(100);
            await flush();
        });
        expect(server.doc.content).toBe('ab');
        expect(server.calls.every((c) => c.out === 'ok')).toBe(true);
    });
});

describe('LOT-B3 — causal compatibility needs a demonstrated base (B2-AUD-04)', () => {
    beforeEach(() =>
        jest.spyOn(console, 'error').mockImplementation(() => undefined)
    );
    afterEach(() => jest.restoreAllMocks());

    it('an authenticated acknowledgement never purges a value that has no base (card without a token)', async () => {
        const server = new Server();
        const { result } = mount(server);
        // typed while the card had no token: queued without a base
        act(() => {
            result.current.scheduleSave('c', { content: 'A' });
        });
        // a direct write on the same field is acknowledged on a real base
        await act(async () => {
            await result.current.writeDirect('c', {
                content: 'B',
                etag: 'E1',
            });
            await flush();
        });
        const kept = result.current.recoverable('c');
        expect(
            kept.some((i) => i.fields.content === 'A' && i.base === undefined)
        ).toBe(true);
    });

    it('demo mode (no token anywhere) keeps the historical behaviour: the older value is obsolete once the newer is acknowledged', async () => {
        const server = new Server();
        server.etag = 'unused';
        const save = jest.fn(async () => ({ etag: undefined }) as never);
        const { result } = renderHook(() =>
            useAutosave<Update, Saved>(save, 20, undefined, undefined, {
                requireVersion: () => false,
            })
        );
        act(() => {
            result.current.scheduleSave('c', { content: 'A' });
        });
        await act(async () => {
            await result.current.writeDirect('c', { content: 'B' });
            await flush();
        });
        expect(
            result.current
                .recoverable('c')
                .filter((i) => i.state === 'displaced')
        ).toHaveLength(0);
    });
});

describe('LOT-B3 — account / session context', () => {
    beforeEach(() =>
        jest.spyOn(console, 'error').mockImplementation(() => undefined)
    );
    afterEach(() => jest.restoreAllMocks());

    it('nothing is sent once the owner changed or the session ended, and the late answers of the previous context are ignored', async () => {
        const server = new Server();
        let owner: string | null = 'user-1';
        const onSaved = jest.fn();
        const onError = jest.fn();
        const { result } = mount(server, {
            owner: () => owner,
            onSaved,
            onError,
        });
        const open = server.hold(() => true);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a', etag: 'E1' });
            await sleep(60);
            result.current.scheduleSave('c', { title: 'b', etag: 'E1' });
            owner = null; // session revoked / signed out
            open();
            await sleep(100);
            await flush();
        });
        expect(onSaved).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        // the queued second write never left
        expect(server.calls.filter((c) => 'title' in c.fields)).toHaveLength(0);
        // and a new context starts from nothing
        expect(result.current.recoverable('c')).toHaveLength(0);
    });

    it('a different account never inherits intentions, lineage or notifications', async () => {
        const server = new Server();
        let owner: string | null = 'user-1';
        const onError = jest.fn();
        const { result } = mount(server, { owner: () => owner, onError });
        server.hold(() => true, 'before-lost');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a', etag: 'E1' });
            await sleep(60);
        });
        owner = 'user-2';
        await act(async () => {
            result.current.scheduleSave('c', { content: 'b', etag: 'E1' });
            await sleep(80);
            await flush();
        });
        expect(server.calls).toHaveLength(0);
        expect(result.current.recoverable('c')).toHaveLength(0);
    });

    it('unmounting stops every timer and ignores what is still on the wire', async () => {
        const server = new Server();
        const onSaved = jest.fn();
        const onError = jest.fn();
        const { result, unmount } = mount(server, { onSaved, onError });
        const open = server.hold(() => true);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a', etag: 'E1' });
            await sleep(60);
        });
        unmount();
        await act(async () => {
            open();
            await sleep(40);
            await flush();
        });
        expect(onSaved).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });
});
