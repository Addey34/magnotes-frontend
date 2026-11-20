/** @jest-environment jsdom */

// MGN-DATA-01-LOT-C — coordinator level reproductions:
//   B3-AUD-03  failures are guarded by the owner exactly like successes
//   B3-AUD-04  unknown provenance is not the same thing as "no intention"
//   AUD-08     the save status is derived from the real states of the queues
// Each test states the invariant; a red test on the B3 code is a confirmed
// defect (see preuves/RED-C-on-B3-code.txt).

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
    /** The demo board has no tokens: every write is accepted. */
    demo = false;
    calls: Array<{ id: string; base?: string; fields: Update; out: string }> =
        [];
    private holds: Array<{
        match: (u: Update) => boolean;
        mode: 'before' | 'after-lost' | 'before-lost' | 'before-412';
        open: () => void;
        gate: Promise<void>;
        used: boolean;
    }> = [];
    hold(
        match: (u: Update) => boolean = () => true,
        mode: 'before' | 'after-lost' | 'before-lost' | 'before-412' = 'before'
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
        if (rule?.mode === 'before-412') {
            this.calls.push({ id, base, fields, out: '412' });
            throw conflict();
        }
        if (!this.demo && base !== this.etag) {
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
        return this.demo
            ? ({ ...fields } as Saved)
            : { etag: this.etag, ...fields };
    };
}

const flush = async (rounds = 400) => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let owner: string | null = 'A';

const mount = (
    server: Server,
    extra: {
        onError?: jest.Mock;
        onSaved?: jest.Mock;
        requireVersion?: boolean;
        withOwner?: boolean;
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
                ...(extra.withOwner === false ? {} : { owner: () => owner }),
            }
        )
    );

beforeEach(() => {
    owner = 'A';
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('LOT-C B3-AUD-03 — a failure is guarded by the owner like a success', () => {
    it('autosave: a late failure after the owner changed keeps nothing, tells nobody', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(server, { onError });
        const open = server.hold(() => true, 'before-lost');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'A text', etag: 'E1' });
            await sleep(60);
        });
        owner = 'B'; // no other action detects it
        await act(async () => {
            open();
            await sleep(30);
            await flush();
        });
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.recoverable('c')).toEqual([]);
        expect(result.current.saveState.status).not.toBe('error');
    });

    it('autosave: a late 412 after the owner changed keeps nothing, tells nobody', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(server, { onError });
        const open = server.hold(() => true, 'before-412');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'A text', etag: 'E1' });
            await sleep(60);
        });
        owner = 'B';
        await act(async () => {
            open();
            await sleep(30);
            await flush();
        });
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.recoverable('c')).toEqual([]);
    });

    it('direct write: a late failure after the owner changed is a stale outcome, nothing is reinstated', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold((u) => 'x' in u, 'before-lost');
        let rejection: unknown;
        await act(async () => {
            // an older value of the same field waits in the debounce
            result.current.scheduleSave('c', { x: 1, etag: 'E1' });
            void result.current
                .writeDirect('c', { x: 5, etag: 'E1' })
                .catch((error) => (rejection = error));
            await sleep(40);
        });
        owner = 'B';
        await act(async () => {
            open();
            await sleep(40);
            await flush();
        });
        expect(isStaleLifecycle(rejection)).toBe(true);
        expect(result.current.recoverable('c')).toEqual([]);
    });

    it('multi-group operation: the second group never leaves once the first one failed under another owner', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(server, { onError });
        // two groups on two different bases (E1 then E2) leave in one flush
        const open = server.hold((u) => 'content' in u, 'before-lost');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'one', etag: 'E1' });
            result.current.scheduleSave('c', { title: 'two', etag: 'E2' });
            await sleep(60);
        });
        owner = 'B';
        await act(async () => {
            open();
            await sleep(40);
            await flush();
        });
        // only the first request (already on the wire) left
        expect(
            server.calls.filter((c) => c.fields.title !== undefined)
        ).toEqual([]);
        expect(onError).not.toHaveBeenCalled();
    });

    it('control: a late success after the owner changed is ignored (already guarded in B3)', async () => {
        const server = new Server();
        const onSaved = jest.fn();
        const onError = jest.fn();
        const { result } = mount(server, { onSaved, onError });
        const open = server.hold(() => true, 'before');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'A text', etag: 'E1' });
            await sleep(60);
        });
        owner = 'B';
        await act(async () => {
            open();
            await sleep(30);
            await flush();
        });
        expect(onSaved).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('control: same owner, a failure is kept exactly as before', async () => {
        const server = new Server();
        const onError = jest.fn();
        const { result } = mount(server, { onError });
        const open = server.hold(() => true, 'before-lost');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'mine', etag: 'E1' });
            await sleep(60);
            open();
            await sleep(30);
            await flush();
        });
        expect(onError).toHaveBeenCalled();
        expect(
            result.current
                .recoverable('c')
                .some((i) => i.fields.content === 'mine')
        ).toBe(true);
    });
});

describe('LOT-C B3-AUD-04 — unknown provenance is not "no intention"', () => {
    it('content kept without a base is never promoted to a token adopted later', async () => {
        const server = new Server();
        const { result } = mount(server);
        // typed while the card had no token (restoring): refused locally, kept
        await act(async () => {
            result.current.scheduleSave('c', { content: 'typed before' });
            await sleep(60);
        });
        expect(server.calls).toHaveLength(0);
        // someone else changed the card; the board adopts the server's version
        server.external({ content: 'theirs' });
        act(() => result.current.reloaded('c'));
        // the user keeps typing ON the unreconciled content
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'typed before + more',
                etag: server.etag,
            });
            await sleep(80);
        });
        expect(server.calls).toHaveLength(0); // never sent on the adopted token
        expect(server.doc.content).toBe('theirs'); // nothing overwritten
        expect(
            result.current
                .recoverable('c')
                .some(
                    (i) =>
                        i.fields.content === 'typed before + more' &&
                        i.base === undefined
                )
        ).toBe(true);
    });

    it('a baseless value still waiting in the debounce is not promoted either', async () => {
        const server = new Server();
        const { result } = mount(server);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'no base' });
            result.current.scheduleSave('c', {
                content: 'no base + more',
                etag: 'E1',
            });
            await sleep(80);
        });
        expect(server.calls.filter((c) => c.out === 'ok')).toHaveLength(0);
        expect(server.doc.content).toBeUndefined();
        expect(
            result.current
                .recoverable('c')
                .some((i) => i.fields.content === 'no base + more')
        ).toBe(true);
    });

    it('control: a field with no earlier intention leaves on the token the card shows', async () => {
        const server = new Server();
        const { result } = mount(server);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'fresh', etag: 'E1' });
            await sleep(80);
        });
        expect(server.calls).toEqual([
            { id: 'c', base: 'E1', fields: { content: 'fresh' }, out: 'ok' },
        ]);
    });

    it('control: an unrelated field is not blocked by baseless content on another field', async () => {
        const server = new Server();
        const { result } = mount(server);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'no base' });
            await sleep(60);
        });
        await act(async () => {
            result.current.scheduleSave('c', { title: 'new', etag: 'E1' });
            await sleep(80);
        });
        expect(server.doc.title).toBe('new');
    });

    it('control: demo board (no tokens at all) keeps saving typed text', async () => {
        const server = new Server();
        server.demo = true;
        const { result } = mount(server, { requireVersion: false });
        await act(async () => {
            result.current.scheduleSave('c', { content: 'one' });
            await sleep(60);
            result.current.scheduleSave('c', { content: 'one two' });
            await sleep(80);
        });
        expect(server.doc.content).toBe('one two');
    });

    it('control: a card with a failed intention on a known base is retried on that base', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold(() => true, 'before-lost');
        await act(async () => {
            result.current.scheduleSave('c', { content: 'one', etag: 'E1' });
            await sleep(60);
            open();
            await sleep(30);
            await flush();
        });
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'one two',
                etag: 'E1',
            });
            await sleep(80);
        });
        expect(server.doc.content).toBe('one two');
    });
});

describe('LOT-C AUD-08 — the status follows the real states of the coordinator', () => {
    it('a direct write queued behind a held card is not "saved"', async () => {
        const server = new Server();
        const { result } = mount(server);
        act(() => result.current.holdCard('c'));
        await act(async () => {
            void result.current
                .writeDirect('c', { x: 5, etag: 'E1' })
                .catch(() => undefined);
            await flush();
        });
        expect(result.current.saveState.status).toBe('saving');
        await act(async () => {
            result.current.discardCard('c');
            await flush();
        });
        expect(result.current.saveState.status).toBe('saved');
    });

    it('a direct write queued behind another write is "saving" from the first instant', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold(() => true, 'before');
        let first: Promise<unknown> = Promise.resolve();
        let second: Promise<unknown> = Promise.resolve();
        await act(async () => {
            first = result.current.writeDirect('c', { x: 1, etag: 'E1' });
            second = result.current.writeDirect('c', { y: 2, etag: 'E1' });
            await flush();
        });
        expect(result.current.saveState.status).toBe('saving');
        await act(async () => {
            open();
            await first;
            await second;
            await flush();
        });
        expect(result.current.saveState.status).toBe('saved');
    });

    it('a write whose answer was lost is not "saved": the outcome is uncertain', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold(() => true, 'after-lost');
        let rejection: unknown;
        await act(async () => {
            void result.current
                .writeDirect('c', { x: 1, etag: 'E1' })
                .catch((error) => (rejection = error));
            await flush();
            open();
            await flush();
        });
        expect(rejection).toBeDefined();
        expect(result.current.saveState.status).toBe('error');
    });

    it('control: after a read of the card was adopted the uncertainty is gone', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold(() => true, 'after-lost');
        await act(async () => {
            void result.current
                .writeDirect('c', { x: 1, etag: 'E1' })
                .catch(() => undefined);
            await flush();
            open();
            await flush();
        });
        act(() => result.current.reloaded('c'));
        await act(async () => {
            result.current.scheduleSave('c', { y: 3, etag: server.etag });
            await sleep(60);
        });
        expect(result.current.saveState.status).toBe('saved');
    });

    it('the success of one card does not hide the failure of another', async () => {
        const server = new Server();
        const { result } = mount(server);
        const open = server.hold((u) => u.content === 'doomed', 'before-412');
        await act(async () => {
            result.current.scheduleSave('b', { content: 'doomed', etag: 'E1' });
            await sleep(60);
            open();
            await sleep(30);
            await flush();
        });
        expect(result.current.saveState).toEqual({
            status: 'error',
            postItId: 'b',
        });
        await act(async () => {
            result.current.scheduleSave('a', { content: 'fine', etag: 'E1' });
            await sleep(80);
        });
        expect(result.current.saveState.status).toBe('error');
        expect(result.current.saveState.postItId).toBe('b');
    });

    it('a deletion discards the card: its intentions no longer count', async () => {
        const server = new Server();
        const { result } = mount(server);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'typed', etag: 'E1' });
            result.current.holdCard('c');
            await flush();
        });
        expect(result.current.saveState.status).toBe('saving');
        await act(async () => {
            result.current.discardCard('c');
            await flush();
        });
        expect(result.current.saveState.status).toBe('saved');
    });
});
