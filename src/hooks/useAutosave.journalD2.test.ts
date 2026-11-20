/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D2 / S1 — the coordinator mirrors its intentions into the
// durable journal (synthetic store, faults injected). The IndexedDB adapter is
// proven in a real browser (Playwright); here the LOGIC is proven.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';
import { LocalJournal, MemoryStore } from '../services/localJournal';
import { createJournalPort } from '../services/journalBridge';
import { resetMutationProtocol } from '../services/mutationProtocol';

type Update = Record<string, unknown> & { etag?: string };
type Saved = { etag: string } & Record<string, unknown>;

const OWNER = 'user-a';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Server {
    etag = 'E1';
    n = 0;
    sent: Array<{ payload: Update; at: number }> = [];
    mode: 'ok' | 'lose' | 'refuse' | 'offline' | 'hold' = 'ok';
    release?: () => void;
    save = async (_id: string, payload: Update): Promise<Saved> => {
        this.sent.push({ payload, at: Date.now() });
        if (this.mode === 'hold') {
            await new Promise<void>((resolve) => (this.release = resolve));
            this.mode = 'ok';
        }
        if (this.mode === 'lose') throw new Error('Network Error');
        if (this.mode === 'offline') throw new Error('Network Error');
        const { etag: base, ...fields } = payload;
        if (this.mode === 'refuse' || base !== this.etag) {
            throw Object.assign(new Error('412'), {
                response: {
                    status: 412,
                    data: { code: 'PRECONDITION_FAILED' },
                },
            });
        }
        this.etag = `S${++this.n}`;
        return { etag: this.etag, ...fields };
    };
}

const setup = (owner: string | null = OWNER) => {
    const store = new MemoryStore();
    const journal = new LocalJournal(store, 'tab1');
    const port = createJournalPort(journal, () => owner);
    const server = new Server();
    const hook = renderHook(() =>
        useAutosave<Update, Saved>(
            (id, payload) => server.save(id, payload),
            30,
            jest.fn(),
            jest.fn(),
            { requireVersion: () => true, journal: port }
        )
    );
    return { store, journal, port, server, ...hook };
};

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    resetMutationProtocol();
});
afterEach(() => jest.restoreAllMocks());

describe('D2-S1 — the journal mirrors the coordinator', () => {
    it('records the draft BEFORE the debounce elapses (no pagehide needed)', async () => {
        const { result, journal } = setup();
        await act(async () => {
            result.current.scheduleSave('c', { content: 'typed', etag: 'E1' });
            await sleep(5); // far below the 30 ms debounce
        });
        const snap = await journal.read(OWNER);
        expect(snap.drafts[0]).toMatchObject({
            base: 'E1',
            fields: { content: 'typed' },
        });
    });

    it('freezes the exact operation durably BEFORE its first emission', async () => {
        const { result, journal, server, store } = setup();
        store.faults.holdCommit = true; // the storage has not committed yet
        await act(async () => {
            result.current.scheduleSave('c', { content: 'typed', etag: 'E1' });
            await sleep(80);
        });
        expect(server.sent).toHaveLength(0); // nothing left before the commit
        await act(async () => {
            store.releaseCommits();
            await sleep(30);
        });
        expect(server.sent).toHaveLength(1);
        const snap = await journal.read(OWNER);
        // acknowledged by now: the op was closed, the draft is gone
        expect(snap.ops).toHaveLength(0);
        expect(snap.drafts).toHaveLength(0);
    });

    it('a lost answer keeps the operation, marked ambiguous, with its exact body and base', async () => {
        const { result, journal, server } = setup();
        server.mode = 'lose';
        await act(async () => {
            result.current.scheduleSave('c', { content: 'typed', etag: 'E1' });
            await sleep(120);
        });
        const snap = await journal.read(OWNER);
        expect(snap.ops).toHaveLength(1);
        expect(snap.ops[0]).toMatchObject({
            state: 'ambiguous',
            base: 'E1',
            body: { content: 'typed' },
            method: 'PATCH',
        });
        expect(typeof snap.ops[0].mutationId).toBe('string');
    });

    it('a refusal keeps the content as a conflict and removes only its operation', async () => {
        const { result, journal, server } = setup();
        server.mode = 'refuse';
        await act(async () => {
            result.current.scheduleSave('c', { content: 'mine', etag: 'E1' });
            await sleep(120);
        });
        const snap = await journal.read(OWNER);
        expect(snap.ops).toHaveLength(0);
        expect(snap.conflicts[0]).toMatchObject({
            reason: 'precondition-failed',
            fields: { content: 'mine' },
            base: 'E1',
        });
    });

    it('a certain failure that is not final puts the content back to a draft (nothing lost)', async () => {
        const { result, journal, server } = setup();
        // a coded 503 "not applied" is certain and retryable
        server.save = async () => {
            throw Object.assign(new Error('503'), {
                response: {
                    status: 503,
                    data: { code: 'CONCURRENCY_UNAVAILABLE' },
                    headers: { 'x-mutation-applied': 'false' },
                },
            });
        };
        await act(async () => {
            result.current.scheduleSave('c', { content: 'keep', etag: 'E1' });
            await sleep(100);
        });
        const snap = await journal.read(OWNER);
        expect(snap.ops).toHaveLength(0);
        expect(snap.drafts[0].fields).toEqual({ content: 'keep' });
    });

    it('typing during an operation in flight never changes its frozen body; its late acknowledgement leaves the newer draft', async () => {
        const { result, journal, server } = setup();
        server.mode = 'hold';
        await act(async () => {
            result.current.scheduleSave('c', { content: 'first', etag: 'E1' });
            await sleep(80);
        });
        const [frozen] = (await journal.read(OWNER)).ops;
        expect(frozen.body).toEqual({ content: 'first' });
        await act(async () => {
            result.current.scheduleSave('c', { content: 'second', etag: 'E1' });
            await sleep(5);
        });
        // the in-flight operation is untouched, the new typing is a draft
        let snap = await journal.read(OWNER);
        expect(snap.ops[0].body).toEqual({ content: 'first' });
        expect(snap.drafts[0].fields).toEqual({ content: 'second' });
        await act(async () => {
            server.release?.();
            await sleep(60);
        });
        snap = await journal.read(OWNER);
        // the old operation is closed; the newer content is still durable
        // (draft, or its own operation / conflict), never lost
        expect(snap.ops.map((o) => o.mutationId)).not.toContain(
            frozen.mutationId
        );
        const everything = JSON.stringify([
            snap.drafts,
            snap.ops,
            snap.conflicts,
        ]);
        const sentSecond = server.sent.some(
            (s) => s.payload.content === 'second'
        );
        expect(sentSecond || everything.includes('second')).toBe(true);
    });

    it('after an unmount, a fresh journal over the same storage still has the typed content (U6, durable)', async () => {
        const { result, journal, unmount, store, server } = setup();
        server.mode = 'offline';
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'only-copy',
                etag: 'E1',
            });
            await sleep(100);
        });
        unmount();
        const reopened = new LocalJournal(store, 'tab2');
        const snap = await reopened.read(OWNER);
        const text = JSON.stringify([snap.drafts, snap.ops, snap.conflicts]);
        expect(text).toContain('only-copy');
        expect(journal.getStatus()).toBe('ready');
    });
});

describe('D2-S1 — storage failures and status honesty', () => {
    it('a storage that fails: the network write still goes, the status says the local copy does not exist', async () => {
        const { result, store, server } = setup();
        const { JournalUnavailableError } = jest.requireActual(
            '../services/localJournal'
        );
        store.faults.failNext = {
            count: 50,
            error: new JournalUnavailableError(),
        };
        await act(async () => {
            result.current.scheduleSave('c', { content: 'x', etag: 'E1' });
            await sleep(120);
        });
        expect(server.sent).toHaveLength(1);
        expect(result.current.localSave.status).toBe('unavailable');
    });

    it('"saved on this device" only after a confirmed commit', async () => {
        const { result, store } = setup();
        store.faults.holdCommit = true;
        await act(async () => {
            result.current.scheduleSave('c', { content: 'x', etag: 'E1' });
            await sleep(5);
        });
        expect(result.current.localSave.status).toBe('saving');
        await act(async () => {
            store.releaseCommits();
            await sleep(120);
        });
        expect(result.current.localSave.status).toBe('saved');
    });

    it('no owner (signed out, demo): nothing is recorded', async () => {
        const { result, journal, store } = setup(null);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'x', etag: 'E1' });
            await sleep(100);
        });
        expect(store.rows.size).toBe(0);
        expect((await journal.read(OWNER)).drafts).toHaveLength(0);
    });
});
