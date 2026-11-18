/** @jest-environment jsdom */

// REGRESSION (found by the real-browser campaign, D2-5): with an inline
// `owner` callback, a non-stable `refresh` made every render re-read the
// journal and replace the list, an endless loop that froze the page whenever
// the storage answered immediately.
//
// D2-REV1: provenance and exclusivity of the take-over
//   D2R-AUD-02  a draft of unknown base is never sent automatically
//   D2R-AUD-03  two successors: one intention; no age heuristic
//   D2R-AUD-05  a voluntary resume is verified, atomic and keeps the source

import { act, renderHook } from '@testing-library/react';
import { useJournalRecovery } from './useJournalRecovery';
import { LocalJournal, MemoryStore } from '../services/localJournal';
import { createJournalPort } from '../services/journalBridge';
import { resetMutationProtocol } from '../services/mutationProtocol';
import { readServerCard } from '../services/boardApi';
import { PostIt } from '../types/boardTypes';

jest.mock('../services/apiBase', () => ({ baseUrl: '' }));
jest.mock('../services/boardApi', () => ({
    ...jest.requireActual('../services/boardApi'),
    readServerCard: jest.fn(),
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const card = { _id: 'c', tabId: 't', title: 'T', etag: 'E1' } as PostIt;
const mockedRead = jest.mocked(readServerCard);
const setLocks = (value: unknown) =>
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value,
    });

beforeEach(() => {
    resetMutationProtocol();
    mockedRead.mockReset();
    // no other page is alive
    setLocks({ query: async () => ({ held: [] }) });
});

const stableCards = [card]; // like the board: the same list until a card changes
const setup = (
    store: MemoryStore,
    writer = 'live-page',
    tweak?: (port: ReturnType<typeof createJournalPort>) => void
) => {
    const journal = new LocalJournal(store, writer);
    const port = createJournalPort(journal, () => 'user-a');
    tweak?.(port);
    const scheduleSave = jest.fn();
    const hook = renderHook(() =>
        useJournalRecovery({
            // inline callbacks, new on every render, exactly like BoardApp
            owner: () => 'user-a',
            journal,
            port,
            cards: stableCards,
            scheduleSave: (id, updates) => scheduleSave(id, updates),
            reloadCard: async () => undefined,
            restoreDeleted: async () => undefined,
            flush: async () => undefined,
            exclusive: (_id, task) => task(),
            tick: 0,
        })
    );
    return { journal, port, scheduleSave, ...hook };
};

describe('useJournalRecovery', () => {
    it('does not re-read the journal on every render (no render storm)', async () => {
        const store = new MemoryStore();
        const reads = jest.spyOn(store, 'list');
        setup(store);
        await act(async () => {
            await sleep(300);
        });
        expect(reads.mock.calls.length).toBeLessThan(8);
    });

    it('takes over a draft of a page that is gone and hands it to the queue on the base it was written on', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', 'OLD-BASE', { content: 'typed' });
        const { scheduleSave, journal } = setup(store);
        await act(async () => {
            await sleep(400);
        });
        expect(scheduleSave).toHaveBeenCalledWith('c', {
            content: 'typed',
            etag: 'OLD-BASE', // authored base, never the card's newer token
        });
        const writers = (await journal.read('user-a')).drafts.map(
            (d) => d.writer
        );
        expect(writers).not.toContain('dead-page');
    });

    it('a draft whose base is unknown is NEVER rebased onto the card version: nothing is sent, it is handed to the user', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', undefined, { content: 'typed' });
        const { scheduleSave, result, journal } = setup(store);
        await act(async () => {
            await sleep(400);
        });
        expect(scheduleSave).not.toHaveBeenCalled();
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]).toMatchObject({
            kind: 'draft',
            unknownBase: true,
            fields: { content: 'typed' },
        });
        // still stored, untouched
        expect((await journal.read('user-a')).drafts).toHaveLength(1);
    });

    it('two successors of the same dead page: the intention is handed to the queue ONCE', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', 'OLD-BASE', { content: 'typed' });
        setLocks({
            query: async () => ({
                held: ['succ-b', 'succ-c'].map((w) => ({
                    name: `magnotes-journal-writer:${w}`,
                })),
            }),
        });
        const b = setup(store, 'succ-b');
        const c = setup(store, 'succ-c');
        await act(async () => {
            await sleep(500);
        });
        expect(
            b.scheduleSave.mock.calls.length + c.scheduleSave.mock.calls.length
        ).toBe(1);
    });

    it('a page that was alive for a long time and then closes is still taken over (the look-out does not give up)', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'slow-page');
        await dead.saveDraft('user-a', 'c', 'OLD-BASE', { content: 'typed' });
        let alive = true;
        let looks = 0;
        setLocks({
            query: async () => {
                looks += 1;
                return {
                    held: alive
                        ? [{ name: 'magnotes-journal-writer:slow-page' }]
                        : [],
                };
            },
        });
        const { scheduleSave } = setup(store);
        // longer than the quick phase (40 x 150 ms)
        await act(async () => {
            await sleep(9500);
        });
        expect(scheduleSave).not.toHaveBeenCalled();
        const looksBefore = looks;
        alive = false;
        await act(async () => {
            await sleep(2600);
        });
        expect(looks).toBeGreaterThan(looksBefore); // still looking
        expect(scheduleSave).toHaveBeenCalledWith('c', {
            content: 'typed',
            etag: 'OLD-BASE',
        });
    }, 30000);

    it('a successor that LOST a take-over keeps watching: it looks again and finishes the job', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', 'OLD-BASE', { content: 'typed' });
        let first = true;
        const c = setup(store, 'succ-c', (port) => {
            // another successor wins the compare-and-set between this
            // page's look and its take, then closes without finishing
            const realTake = port.take;
            port.take = async (record, options) => {
                if (first) {
                    first = false;
                    await new LocalJournal(store, 'succ-b').take(
                        'user-a',
                        record
                    );
                    return false;
                }
                return realTake(record, options);
            };
        });
        await act(async () => {
            await sleep(1500);
        });
        expect(c.scheduleSave).toHaveBeenCalledWith('c', {
            content: 'typed',
            etag: 'OLD-BASE',
        });
    }, 30000);

    it('without Web Locks nothing is taken automatically, however old the row is', async () => {
        setLocks(undefined);
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', 'OLD-BASE', { content: 'typed' });
        const [row] = [...store.rows.values()] as Array<{ at: number }>;
        row.at -= 3_600_000;
        const { scheduleSave, result } = setup(store);
        await act(async () => {
            await sleep(400);
        });
        expect(scheduleSave).not.toHaveBeenCalled();
        expect(result.current.items[0]).toMatchObject({
            undetermined: true,
            fields: { content: 'typed' },
        });
    });

    it('never takes the draft of another account', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-b', 'c', 'E1', { content: 'secret-of-b' });
        const { scheduleSave, result } = setup(store);
        await act(async () => {
            await sleep(300);
        });
        expect(scheduleSave).not.toHaveBeenCalled();
        expect(JSON.stringify(result.current.items)).not.toContain(
            'secret-of-b'
        );
    });

    it('lists a conflict with its content (to compare) and abandoning it is explicit', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.recordConflict(
            'user-a',
            'c',
            'OLD',
            { content: 'mine' },
            'precondition-failed',
            'm1'
        );
        const { result, journal } = setup(store);
        await act(async () => {
            await sleep(300);
        });
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]).toMatchObject({
            kind: 'conflict',
            reason: 'precondition-failed',
            fields: { content: 'mine' },
        });
        await act(async () => {
            await result.current.abandon(result.current.items[0]);
        });
        expect((await journal.read('user-a')).conflicts).toHaveLength(0);
    });

    describe('a voluntary resume (D2R-AUD-05)', () => {
        const withConflict = async () => {
            const store = new MemoryStore();
            const dead = new LocalJournal(store, 'dead-page');
            await dead.recordConflict(
                'user-a',
                'c',
                'OLD',
                { content: 'mine' },
                'precondition-failed',
                'm1'
            );
            const hook = setup(store);
            await act(async () => {
                await sleep(300);
            });
            return { store, ...hook };
        };

        it('goes out on a server version VERIFIED by a read, never on the screen copy', async () => {
            mockedRead.mockResolvedValue({
                state: 'found',
                card: { ...card, etag: 'SERVER-NOW' },
            });
            const { result, scheduleSave, journal } = await withConflict();
            await act(async () => {
                await result.current.resume(result.current.items[0]);
            });
            expect(scheduleSave).toHaveBeenCalledWith('c', {
                content: 'mine',
                etag: 'SERVER-NOW',
            });
            // the source was moved atomically: the content now lives as a draft
            const snap = await journal.read('user-a');
            expect(snap.conflicts).toHaveLength(0);
            expect(snap.drafts[0].fields).toEqual({ content: 'mine' });
            expect(snap.drafts[0].base).toBe('SERVER-NOW');
        });

        it('an unreadable server keeps everything and sends nothing', async () => {
            mockedRead.mockResolvedValue({ state: 'unavailable' });
            const { result, scheduleSave, journal } = await withConflict();
            await act(async () => {
                await result.current.resume(result.current.items[0]);
            });
            expect(scheduleSave).not.toHaveBeenCalled();
            expect((await journal.read('user-a')).conflicts).toHaveLength(1);
            expect(result.current.notes[result.current.items[0].key]).toBe(
                'verify-failed'
            );
        });

        it('a card absent from the server is not resumed onto anything', async () => {
            mockedRead.mockResolvedValue({ state: 'absent' });
            const { result, scheduleSave } = await withConflict();
            await act(async () => {
                await result.current.resume(result.current.items[0]);
            });
            expect(scheduleSave).not.toHaveBeenCalled();
        });

        it('a storage that fails during the transfer keeps the source and sends nothing', async () => {
            mockedRead.mockResolvedValue({
                state: 'found',
                card: { ...card, etag: 'SERVER-NOW' },
            });
            const { result, scheduleSave, journal, store } =
                await withConflict();
            store.faults.failNext = {
                count: 1,
                error: Object.assign(new Error('quota'), {
                    name: 'QuotaExceededError',
                }),
            };
            await act(async () => {
                await result.current.resume(result.current.items[0]);
            });
            expect(scheduleSave).not.toHaveBeenCalled();
            expect((await journal.read('user-a')).conflicts).toHaveLength(1);
        });
    });
});
