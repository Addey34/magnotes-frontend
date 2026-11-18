/** @jest-environment jsdom */

// MGN-DATA-01 / D2-REV1 — services level:
//   D2R-AUD-02  lineage of draft fields is causal, never equality of content
//   D2R-AUD-03  exclusive take-over (compare-and-set); no age heuristic
//   D2R-AUD-04  no way around the replay guarantees; exact identity; context

import axios from 'axios';
import {
    JournalConflictError,
    LocalJournal,
    MemoryStore,
} from './localJournal';
import { createJournalPort } from './journalBridge';
import {
    collectRecoverable,
    replayRecoveredOperation,
} from './journalRecovery';
import {
    getCapability,
    identityOf,
    markAmbiguous,
    resetMutationProtocol,
    setCapability,
    setReplayPolicy,
} from './mutationProtocol';
import { deactivateDemo } from './demoMode';

jest.mock('axios');
jest.mock('./apiBase', () => ({ baseUrl: '' }));
const mockContext = { token: 'tok-1', userId: 'user-a', generation: 1 };
jest.mock('../utils/tokenUtils', () => ({
    getToken: () => mockContext.token,
    getTokenUserId: () => mockContext.userId,
}));
jest.mock('./sessionCoordinator', () => ({
    currentGeneration: () => mockContext.generation,
}));

const mocked = jest.mocked(axios);
const proof = { 'x-mutation-protocol': '1' };
const lost = () =>
    Object.assign(new Error('Network Error'), { isAxiosError: true });
const setLocks = (value: unknown) =>
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value,
    });

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    deactivateDemo();
    resetMutationProtocol();
    Object.assign(mockContext, {
        token: 'tok-1',
        userId: 'user-a',
        generation: 1,
    });
    setReplayPolicy({ delaysMs: [0], maxRetryAfterMs: 0 });
    setLocks({ query: async () => ({ held: [] }) }); // every other writer is dead
});
afterEach(() => jest.restoreAllMocks());

describe('D2R-AUD-03 — exclusive take-over', () => {
    it('two successors of a dead writer: exactly one wins, no duplicated intention', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead');
        await dead.saveDraft('user-a', 'c', 'B1', { content: 'typed' });
        const b = new LocalJournal(store, 'succ-b');
        const c = new LocalJournal(store, 'succ-c');
        const [record] = (await b.read('user-a')).drafts;
        const [won, lostRace] = await Promise.all([
            b.take('user-a', record),
            c.take('user-a', record),
        ]);
        const winners = [won, lostRace].filter(Boolean);
        expect(winners).toHaveLength(1);
        const left = (await b.read('user-a')).drafts;
        expect(left).toHaveLength(1);
        expect(left[0].writer).toBe(
            winners[0] && (winners[0] as never as { writer: string }).writer
        );
        expect(left[0].fields).toEqual({ content: 'typed' });
    });

    it('an interruption in the middle of the transfer loses nothing and the next successor takes it', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead');
        await dead.saveDraft('user-a', 'c', 'B1', { content: 'typed' });
        const b = new LocalJournal(store, 'succ-b');
        const c = new LocalJournal(store, 'succ-c');
        const [record] = (await b.read('user-a')).drafts;
        store.faults.failNext = {
            count: 1,
            error: new Error('transaction aborted'),
        };
        expect(await b.take('user-a', record)).toBe(false);
        // the old row is untouched, nothing was duplicated
        const after = (await c.read('user-a')).drafts;
        expect(after).toHaveLength(1);
        expect(after[0].writer).toBe('dead');
        const taken = await c.take('user-a', after[0]);
        expect(taken && taken.kind).toBe('draft');
        expect((await c.read('user-a')).drafts).toHaveLength(1);
    });

    it('never overwrites a row the new owner already wrote since (compare-and-set)', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead');
        await dead.saveDraft('user-a', 'c', 'B1', { content: 'old' });
        const b = new LocalJournal(store, 'succ-b');
        const stale = (await b.read('user-a')).drafts[0];
        // the "dead" page was not: it rewrote its row after our read
        await dead.saveDraft('user-a', 'c', 'B1', { content: 'newer' });
        expect(await b.take('user-a', stale)).toBe(false);
        const rows = (await b.read('user-a')).drafts;
        expect(rows).toHaveLength(1);
        expect(rows[0].fields).toEqual({ content: 'newer' });
    });

    it('an operation keeps its id, base, body and regime when taken', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead');
        await dead.freeze(
            'user-a',
            {
                resource: 'c',
                method: 'PATCH',
                mutationId: 'm-1',
                base: 'B1',
                body: { content: 'x' },
                regime: 'd1',
                state: 'ambiguous',
            },
            null,
            'B1'
        );
        const b = new LocalJournal(store, 'succ-b');
        const [op] = (await b.read('user-a')).ops;
        const taken = await b.take('user-a', op);
        expect(taken).toMatchObject({
            kind: 'op',
            mutationId: 'm-1',
            base: 'B1',
            body: { content: 'x' },
            regime: 'd1',
            state: 'ambiguous',
            writer: 'succ-b',
        });
    });

    it('without Web Locks the age of a row proves nothing: it is listed, never taken', async () => {
        setLocks(undefined);
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead');
        await dead.saveDraft('user-a', 'c', 'B1', { content: 'typed' });
        // an hour old
        const [row] = [...store.rows.values()] as Array<{ at: number }>;
        row.at -= 3_600_000;
        const found = await collectRecoverable(
            new LocalJournal(store, 'me'),
            'user-a'
        );
        expect(found.drafts).toHaveLength(0);
        expect(found.undetermined).toHaveLength(1);
    });

    it('a failing Web Locks query is "cannot tell", not "dead"', async () => {
        setLocks({
            query: async () => {
                throw new Error('boom');
            },
        });
        const store = new MemoryStore();
        await new LocalJournal(store, 'dead').saveDraft('user-a', 'c', 'B1', {
            content: 'typed',
        });
        const found = await collectRecoverable(
            new LocalJournal(store, 'me'),
            'user-a'
        );
        expect(found.drafts).toHaveLength(0);
        expect(found.undetermined).toHaveLength(1);
    });

    it('a JournalConflictError is a lost race, not a broken storage', async () => {
        const store = new MemoryStore();
        const j = new LocalJournal(store, 'me');
        await j.saveDraft('user-a', 'c', 'B1', { content: 'x' });
        const [row] = (await j.read('user-a')).drafts;
        await j.discard([row.key]);
        expect(await j.take('user-a', row)).toBe(false);
        expect(j.getStatus()).toBe('ready');
        expect(new JournalConflictError()).toBeInstanceOf(Error);
    });
});

describe('D2R-AUD-02 — lineage of draft fields is causal', () => {
    const portOf = () => {
        const store = new MemoryStore();
        const journal = new LocalJournal(store, 'tab1');
        const port = createJournalPort(journal, () => 'user-a');
        return { store, journal, port };
    };

    it('equal content on an UNRELATED base is independent typing: a freeze never retires it', async () => {
        const { journal, port } = portOf();
        await port.draft('c', { content: 'same', etag: 'B1' });
        await port.draft('c', { content: 'same', etag: 'B2' });
        await port.freeze('c', { content: 'same', etag: 'B2' });
        const rows = (await journal.read('user-a')).drafts;
        expect(rows.map((r) => r.base)).toEqual(['B1']);
        expect(rows[0].fields).toEqual({ content: 'same' });
    });

    it('a legitimate rebase after a CAUSAL acknowledgement retires the older row', async () => {
        setCapability('d1');
        const { journal, port } = portOf();
        // typed on B1, the first write is acknowledged and moves the card to B2
        await port.draft('c', { title: 't', etag: 'B1' });
        await port.freeze('c', { title: 't', etag: 'B1' });
        const op = identityOf(
            'PATCH',
            'c',
            'B1',
            { title: 't' },
            {
                userId: 'user-a',
                generation: 1,
            }
        );
        await port.acknowledged('c', { title: 't', etag: 'B1' }, op!.id, 'B2');
        // the content typed meanwhile was recorded on B1, sent later on B2
        await port.draft('c', { content: 'later', etag: 'B1' });
        await port.freeze('c', { content: 'later', etag: 'B2' });
        const rows = (await journal.read('user-a')).drafts;
        expect(rows).toHaveLength(0);
    });

    it('the lineage is known the very tick the answer is proven: the next write freezes without waiting for the local closure', async () => {
        setCapability('d1');
        const { journal, port } = portOf();
        await port.draft('c', { title: 't', etag: 'B1' });
        await port.freeze('c', { title: 't', etag: 'B1' });
        await port.draft('c', { content: 'typed', etag: 'B1' });
        const op = identityOf(
            'PATCH',
            'c',
            'B1',
            { title: 't' },
            { userId: 'user-a', generation: 1 }
        );
        // the acknowledgement is NOT awaited (the coordinator does not either)...
        const closing = port.acknowledged(
            'c',
            { title: 't', etag: 'B1' },
            op!.id,
            'B2'
        );
        // ...and the next write, rebased on that very answer, freezes at once
        await port.freeze('c', { content: 'typed', etag: 'B2' });
        await closing;
        const rows = (await journal.read('user-a')).drafts;
        expect(rows).toHaveLength(0); // no stale draft left to replay on B1
    });

    it('a new typing during the freeze stays a draft', async () => {
        const { journal, port } = portOf();
        await port.draft('c', { content: 'a', etag: 'B1' });
        const frozen = port.freeze('c', { content: 'a', etag: 'B1' });
        await port.draft('c', { content: 'b', etag: 'B1' });
        await frozen;
        const rows = (await journal.read('user-a')).drafts;
        expect(rows[0].fields).toEqual({ content: 'b' });
    });

    it('a replayed freeze never downgrades an ambiguous operation to frozen', async () => {
        setCapability('d1');
        const { journal, port } = portOf();
        const payload = { content: 'x', etag: 'B1' };
        await port.freeze('c', payload);
        await port.uncertain('c', payload);
        expect((await journal.read('user-a')).ops[0].state).toBe('ambiguous');
        await port.freeze('c', payload); // the same request goes again
        const ops = (await journal.read('user-a')).ops;
        expect(ops).toHaveLength(1);
        expect(ops[0].state).toBe('ambiguous');
    });

    it('the regime of a request that leaves under a proven D1 is frozen as d1', async () => {
        setCapability('d1');
        const { journal, port } = portOf();
        await port.freeze('c', { content: 'x', etag: 'B1' });
        expect((await journal.read('user-a')).ops[0].regime).toBe('d1');
    });

    it('abandoning a record makes the mirror forget it: it is not written back by the next typing', async () => {
        const { journal, port } = portOf();
        await port.draft('c', { content: 'old', etag: 'B1' });
        const [row] = (await journal.read('user-a')).drafts;
        port.release([row]);
        await journal.discard([row.key]);
        await port.draft('c', { title: 'new', etag: 'B1' });
        const rows = (await journal.read('user-a')).drafts;
        expect(rows[0].fields).toEqual({ title: 'new' });
    });
});

describe('D2R-AUD-04 — replay of a recovered operation', () => {
    const op = async (over: Record<string, unknown> = {}) => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead');
        await dead.freeze(
            'user-a',
            {
                resource: 'c',
                method: 'PATCH',
                mutationId: 'm-1',
                base: 'B1',
                body: { content: 'x' },
                regime: 'd1',
                state: 'ambiguous',
                ...over,
            } as never,
            null,
            'B1'
        );
        const me = new LocalJournal(store, 'me');
        const [row] = (await me.read('user-a')).ops;
        return { me, row };
    };
    const ok = (
        headers: Record<string, string>,
        data: unknown = { _id: 'c', etag: 'B2' }
    ) => ({ status: 200, data, headers }) as never;

    it('replays the very same request: same id, If-Match and exact body', async () => {
        setCapability('d1');
        mocked.patch.mockResolvedValue(ok(proof));
        const { me, row } = await op();
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'applied'
        );
        const [url, body, config] = mocked.patch.mock.calls[0] as unknown as [
            string,
            unknown,
            { headers: Record<string, string> },
        ];
        expect(url).toBe('/api/postits/c');
        expect(body).toEqual({ content: 'x' });
        expect(config.headers['X-Mutation-Id']).toBe('m-1');
        expect(config.headers['If-Match']).toBe('"B1"');
        expect((await me.read('user-a')).ops).toHaveLength(0);
    });

    it('a success WITHOUT the proof leaves the durable operation', async () => {
        setCapability('d1');
        mocked.patch.mockResolvedValue(ok({}));
        const { me, row } = await op();
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'uncertain'
        );
        expect((await me.read('user-a')).ops).toHaveLength(1);
    });

    it('there is no way around a missing capability: it is re-proven, else nothing is sent', async () => {
        setCapability('unknown');
        mocked.get.mockRejectedValue(lost()); // the probe cannot answer
        const { me, row } = await op();
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'not-replayable'
        );
        expect(mocked.patch).not.toHaveBeenCalled();
        expect((await me.read('user-a')).ops).toHaveLength(1);
    });

    it('a capability re-proven by the probe allows the replay', async () => {
        setCapability('unknown');
        mocked.get.mockResolvedValue({
            status: 200,
            data: { mutationProtocol: 1 },
            headers: proof,
        } as never);
        mocked.patch.mockResolvedValue(ok(proof));
        const { me, row } = await op();
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'applied'
        );
        expect(getCapability()).toBe('d1');
    });

    it('an operation of the historical regime is kept, never promoted to a D1 guarantee', async () => {
        setCapability('d1');
        const { me, row } = await op({ regime: 'historical' });
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'not-replayable'
        );
        expect(mocked.patch).not.toHaveBeenCalled();
    });

    it('never substitutes another identity of the same request', async () => {
        setCapability('d1');
        const { me, row } = await op();
        // the page already minted ANOTHER id for the very same request
        const other = identityOf(
            'PATCH',
            'c',
            'B1',
            { content: 'x' },
            { userId: 'user-a', generation: 1 }
        );
        markAmbiguous(other);
        expect(other!.id).not.toBe('m-1');
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'not-replayable'
        );
        expect(mocked.patch).not.toHaveBeenCalled();
    });

    it('an account change during the capability probe sends nothing', async () => {
        setCapability('unknown');
        mocked.get.mockImplementation(async () => {
            mockContext.userId = 'user-b';
            return {
                status: 200,
                data: { mutationProtocol: 1 },
                headers: proof,
            } as never;
        });
        const { me, row } = await op();
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'context'
        );
        expect(mocked.patch).not.toHaveBeenCalled();
        // the content of A stays recoverable under A
        expect((await me.read('user-a')).ops).toHaveLength(1);
    });

    it('an account change during a Retry-After wait stops the replay before it leaves', async () => {
        setCapability('d1');
        setReplayPolicy({ delaysMs: [0], maxRetryAfterMs: 0 });
        mocked.patch.mockImplementationOnce(async () => {
            mockContext.userId = 'user-b';
            throw lost();
        });
        const { me, row } = await op();
        const verdict = await replayRecoveredOperation(me, 'user-a', row);
        expect(['context', 'uncertain']).toContain(verdict);
        expect(mocked.patch).toHaveBeenCalledTimes(1); // nothing left under B
        expect((await me.read('user-a')).ops).toHaveLength(1);
    });

    it('a different account never replays the content of A', async () => {
        setCapability('d1');
        const { me, row } = await op();
        mockContext.userId = 'user-b';
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'context'
        );
        expect(mocked.patch).not.toHaveBeenCalled();
    });

    it('a refusal keeps the content as a conflict (no unconditional write, no rebase)', async () => {
        setCapability('d1');
        mocked.patch.mockRejectedValue(
            Object.assign(new Error('412'), {
                isAxiosError: true,
                response: { status: 412, data: {}, headers: proof },
            })
        );
        const { me, row } = await op();
        expect(await replayRecoveredOperation(me, 'user-a', row)).toBe(
            'refused'
        );
        const snap = await me.read('user-a');
        expect(snap.ops).toHaveLength(0);
        expect(snap.conflicts[0]).toMatchObject({
            reason: 'precondition-failed',
            fields: { content: 'x' },
        });
        expect(mocked.patch).toHaveBeenCalledTimes(1);
    });
});
