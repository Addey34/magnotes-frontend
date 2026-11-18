// MGN-DATA-01 / OPS-S0 — owner and context of the durable records.
//   C  an outcome acts on the owner and the context CAPTURED when the DELETE
//      row was written, and never closes an ambiguous row because its identity
//      is absent from the registry of a NEW session;
//   D  a take-over checks `record.owner === owner` before anything, and its
//      destination is guarded: what was typed meanwhile is never replaced.

import { LocalJournal, MemoryStore, keyOf } from './localJournal';
import { createJournalPort } from './journalBridge';
import {
    identityOf,
    markAmbiguous,
    resetMutationProtocol,
    setCapability,
} from './mutationProtocol';
import { PostIt } from '../types/boardTypes';

let mockGen = 1;
let mockUser: string | null = 'user-a';
jest.mock('../utils/tokenUtils', () => ({
    getToken: () => 'tok',
    getTokenUserId: () => mockUser,
}));
jest.mock('./sessionCoordinator', () => ({
    currentGeneration: () => mockGen,
}));

const card = {
    _id: 'c',
    tabId: 't',
    title: 'T',
    content: 'precious',
    etag: 'E1',
} as PostIt;

// A BroadcastChannel opened by a port would keep Jest alive with --runInBand
// (as CI runs it); these tests do not need the cross-tab purge channel.
const realBroadcastChannel = globalThis.BroadcastChannel;
beforeAll(() => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});
afterAll(() => {
    globalThis.BroadcastChannel = realBroadcastChannel;
});

beforeEach(() => {
    mockGen = 1;
    mockUser = 'user-a';
    resetMutationProtocol();
    setCapability('d1');
});

const portOf = (store = new MemoryStore(), writer = 'tab1') => {
    const journal = new LocalJournal(store, writer);
    const owner = { now: 'user-a' as string | null };
    const port = createJournalPort(journal, () => owner.now);
    return { store, journal, port, owner };
};

describe('OPS-S0-01 — deletion.outcome and a context that changed', () => {
    it('the same account in a NEW session: the identity is absent there, the ambiguous row is NOT closed', async () => {
        const { journal, port } = portOf();
        await port.deletion.begin(card, 'E1');
        markAmbiguous(
            identityOf('DELETE', 'c', 'E1', null, {
                userId: 'user-a',
                generation: 1,
            })
        );
        mockGen = 2; // sign-out / sign-in: another session
        resetMutationProtocol(); // its registry knows nothing of the old request
        await port.deletion.outcome('c', 'E1', 'error');
        const [op] = (await journal.read('user-a')).ops;
        expect(op).toMatchObject({
            method: 'DELETE',
            state: 'ambiguous',
            base: 'E1',
            body: { card: { content: 'precious' } },
        });
    });

    it('another account is signed in when the outcome comes: the row of the FIRST owner stays and is marked, the other namespace is untouched', async () => {
        const { journal, port, owner } = portOf();
        await port.deletion.begin(card, 'E1');
        const [before] = (await journal.read('user-a')).ops;
        owner.now = 'user-b';
        mockUser = 'user-b';
        resetMutationProtocol();
        await port.deletion.outcome('c', 'E1', 'error');
        const [after] = (await journal.read('user-a')).ops;
        expect(after.mutationId).toBe(before.mutationId);
        expect(after.state).toBe('ambiguous');
        expect((await journal.read('user-b')).ops).toHaveLength(0);
    });

    it('an answer WITH proof closes the row on its captured owner even when the context moved on', async () => {
        const { journal, port, owner } = portOf();
        await port.deletion.begin(card, 'E1');
        owner.now = 'user-b';
        mockUser = 'user-b';
        await port.deletion.outcome('c', 'E1', 'ok');
        expect((await journal.read('user-a')).ops).toHaveLength(0);
    });

    it('a request that never left is closed by abort() on its captured owner', async () => {
        const { journal, port, owner } = portOf();
        await port.deletion.begin(card, 'E1');
        owner.now = 'user-b';
        await port.deletion.abort('c', 'E1');
        expect((await journal.read('user-a')).ops).toHaveLength(0);
    });

    it('the identity frozen in the row is the one a DELETE of this context carries', async () => {
        const { journal, port } = portOf();
        await port.deletion.begin(card, 'E1');
        const [op] = (await journal.read('user-a')).ops;
        expect(op.mutationId).toBe(
            identityOf('DELETE', 'c', 'E1', null, {
                userId: 'user-a',
                generation: 1,
            })!.id
        );
    });
});

describe('OPS-S0-02 — the owner of a record is checked before a take-over', () => {
    const seed = async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', 'E1', { content: 'A secret' });
        const [draft] = (await dead.read('user-a')).drafts;
        return { store, draft };
    };

    it('LocalJournal.take refuses a record of another account: nothing is read, moved or written', async () => {
        const { store, draft } = await seed();
        const before = JSON.stringify([...store.rows.entries()]);
        const journal = new LocalJournal(store, 'live-page');
        expect(await journal.take('user-b', draft)).toBe(false);
        expect(await journal.take('user-b', draft, { as: 'draft' })).toBe(
            false
        );
        expect(JSON.stringify([...store.rows.entries()])).toBe(before);
    });

    it('a late action on an item of A under the account B changes nothing (port.take)', async () => {
        const { store, draft } = await seed();
        const { port, owner } = portOf(store, 'live-page');
        owner.now = 'user-b';
        const before = JSON.stringify([...store.rows.entries()]);
        expect(await port.take(draft)).toBe(false);
        expect(await port.take(draft, { as: 'draft', base: 'E2' })).toBe(false);
        expect(JSON.stringify([...store.rows.entries()])).toBe(before);
    });

    it('a record whose key is outside the owner namespace is refused even when its owner field claims the caller', async () => {
        const { store, draft } = await seed();
        const journal = new LocalJournal(store, 'live-page');
        const forged = { ...draft, owner: 'user-b' };
        expect(await journal.take('user-b', forged)).toBe(false);
    });

    it('control: the owner takes its own record', async () => {
        const { store, draft } = await seed();
        const journal = new LocalJournal(store, 'live-page');
        const taken = await journal.take('user-a', draft);
        expect(taken && taken.kind).toBe('draft');
    });
});

describe('OPS-S0-02 — the destination of a take-over is guarded', () => {
    class Interfering extends MemoryStore {
        hook?: () => void;
        async transact(ops: Parameters<MemoryStore['transact']>[0]) {
            if (this.hook && ops.some((o) => o.type === 'expect')) {
                const run = this.hook;
                this.hook = undefined;
                run();
            }
            return super.transact(ops);
        }
    }

    it('a draft this page wrote on the destination while the take-over was being prepared is merged, never replaced by an older snapshot', async () => {
        const store = new Interfering();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', 'E1', {
            content: 'old',
            title: 'kept title',
        });
        const [source] = (await dead.read('user-a')).drafts;
        const live = new LocalJournal(store, 'live-page');
        // the page's memory: what it holds right now for that base
        let mirror: Record<string, unknown> = { content: 'snapshot' };
        const destKey = keyOf('user-a', 'c', 'draft', 'live-page|E1');
        store.hook = () => {
            // typed meanwhile: persisted on the destination AND in the memory
            mirror = { content: 'typed while taking' };
            store.rows.set(destKey, {
                key: destKey,
                kind: 'draft',
                schema: 1,
                owner: 'user-a',
                resource: 'c',
                writer: 'live-page',
                at: Date.now() + 5,
                base: 'E1',
                fields: { content: 'typed while taking' },
                order: 999,
            });
        };
        const taken = await live.take('user-a', source, {
            own: () => mirror,
        });
        expect(taken).toMatchObject({ kind: 'draft' });
        const rows = (await live.read('user-a')).drafts;
        expect(rows).toHaveLength(1); // the source moved: one row of this page
        expect(rows[0].fields).toEqual({
            content: 'typed while taking',
            title: 'kept title',
        });
    });

    it('through the port: typing during the take-over survives in the row AND in the memory mirror', async () => {
        const store = new Interfering();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', 'E1', { content: 'old' });
        const [source] = (await dead.read('user-a')).drafts;
        const { port, journal } = portOf(store, 'live-page');
        store.hook = () => {
            void port.draft('c', { etag: 'E1', content: 'typed meanwhile' });
        };
        const taken = await port.take(source);
        expect(taken).toMatchObject({ kind: 'draft' });
        // a later keystroke on ANOTHER field must not bring the old text back
        await port.draft('c', { etag: 'E1', title: 'next' });
        const rows = (await journal.read('user-a')).drafts;
        expect(rows).toHaveLength(1);
        expect(rows[0].fields).toMatchObject({
            content: 'typed meanwhile',
            title: 'next',
        });
    });

    it('two successors: exactly one wins, the loser writes nothing', async () => {
        const store = new MemoryStore();
        const dead = new LocalJournal(store, 'dead-page');
        await dead.saveDraft('user-a', 'c', 'E1', { content: 'x' });
        const [source] = (await dead.read('user-a')).drafts;
        const b = new LocalJournal(store, 'b-page');
        const c = new LocalJournal(store, 'c-page');
        const results = await Promise.all([
            b.take('user-a', source),
            c.take('user-a', source),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await dead.read('user-a')).drafts).toHaveLength(1);
    });
});
