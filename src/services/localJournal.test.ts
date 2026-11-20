import {
    JournalQuotaError,
    JournalUnavailableError,
    LocalJournal,
    MemoryStore,
    OpRecord,
    keyOf,
    validateRecord,
} from './localJournal';

const A = 'user-a';
const B = 'user-b';
const make = () => {
    const store = new MemoryStore();
    return { store, journal: new LocalJournal(store, 'tab1') };
};
const op = (over: Partial<Parameters<LocalJournal['freeze']>[1]> = {}) => ({
    resource: 'c1',
    method: 'PATCH',
    mutationId: 'm1',
    base: 'E1',
    body: { content: 'hello' } as Record<string, unknown>,
    regime: 'd1' as const,
    ...over,
});

describe('D2-S1 local journal', () => {
    it('a draft is readable only after the transaction committed (no early "saved")', async () => {
        const { store, journal } = make();
        store.faults.holdCommit = true;
        let confirmed = false;
        const pending = journal
            .saveDraft(A, 'c1', 'E1', { content: 'typed' })
            .then((ok) => (confirmed = ok));
        await Promise.resolve();
        expect(confirmed).toBe(false);
        expect((await journal.read(A)).drafts).toHaveLength(0);
        store.releaseCommits();
        await pending;
        expect(confirmed).toBe(true);
        expect((await journal.read(A)).drafts[0].fields).toEqual({
            content: 'typed',
        });
    });

    it.each([
        ['quota', new JournalQuotaError(), 'quota'],
        ['unavailable', new JournalUnavailableError(), 'unavailable'],
    ])(
        'a failed transaction (%s) is reported, never confirmed',
        async (_n, error, status) => {
            const { store, journal } = make();
            store.faults.failNext = { count: 1, error };
            expect(
                await journal.saveDraft(A, 'c1', 'E1', { content: 'x' })
            ).toBe(false);
            expect(journal.getStatus()).toBe(status);
            // the storage recovers: the next confirmed write restores the status
            expect(
                await journal.saveDraft(A, 'c1', 'E1', { content: 'x' })
            ).toBe(true);
            expect(journal.getStatus()).toBe('ready');
        }
    );

    it('no storage at all: every write reports false, status unavailable', async () => {
        const journal = new LocalJournal(null);
        expect(await journal.saveDraft(A, 'c1', undefined, { a: 1 })).toBe(
            false
        );
        expect(journal.getStatus()).toBe('unavailable');
    });

    it('freeze stores the operation and removes only what it carries from the draft', async () => {
        const { journal } = make();
        await journal.saveDraft(A, 'c1', 'E1', { content: 'old', title: 'T' });
        // the operation carries content; the newer title stays a draft
        await journal.freeze(A, op(), { title: 'T' }, 'E1');
        const snap = await journal.read(A);
        expect(snap.ops).toHaveLength(1);
        expect(snap.ops[0]).toMatchObject({
            mutationId: 'm1',
            base: 'E1',
            body: { content: 'hello' },
            state: 'frozen',
        });
        expect(snap.drafts[0].fields).toEqual({ title: 'T' });
    });

    it('an old acknowledgement closes only its own operation, never a newer draft or op', async () => {
        const { journal } = make();
        await journal.freeze(A, op(), null, 'E1');
        await journal.freeze(
            A,
            op({ mutationId: 'm2', body: { content: 'n' } }),
            null,
            'E1'
        );
        await journal.saveDraft(A, 'c1', 'E1', { content: 'newest' });
        await journal.closeOp(A, 'c1', 'm1');
        const snap = await journal.read(A);
        expect(snap.ops.map((o) => o.mutationId)).toEqual(['m2']);
        expect(snap.drafts[0].fields).toEqual({ content: 'newest' });
    });

    it('thaw is atomic: the frozen operation becomes a draft again', async () => {
        const { journal } = make();
        await journal.freeze(A, op(), null, 'E1');
        const [frozen] = (await journal.read(A)).ops;
        await journal.thaw(A, frozen as OpRecord, { content: 'hello' });
        const snap = await journal.read(A);
        expect(snap.ops).toHaveLength(0);
        expect(snap.drafts[0]).toMatchObject({
            base: 'E1',
            fields: { content: 'hello' },
        });
    });

    it('a refusal is kept as a conflict with its content, and the op is removed with it', async () => {
        const { journal } = make();
        await journal.freeze(A, op(), null, 'E1');
        await journal.recordConflict(
            A,
            'c1',
            'E1',
            { content: 'hello' },
            'precondition-failed',
            'm1',
            [keyOf(A, 'c1', 'op', 'm1')]
        );
        const snap = await journal.read(A);
        expect(snap.ops).toHaveLength(0);
        expect(snap.conflicts[0]).toMatchObject({
            reason: 'precondition-failed',
            fields: { content: 'hello' },
        });
    });

    it('owners are strictly separated: B sees nothing of A, purge(A) keeps B', async () => {
        const { journal } = make();
        await journal.saveDraft(A, 'c1', 'E1', { content: 'secret-a' });
        await journal.saveDraft(B, 'c1', 'E9', { content: 'b' });
        expect((await journal.read(B)).drafts.map((d) => d.fields)).toEqual([
            { content: 'b' },
        ]);
        await journal.purge(A);
        expect((await journal.read(A)).drafts).toHaveLength(0);
        expect((await journal.read(B)).drafts).toHaveLength(1);
        await journal.purge();
        expect((await journal.read(B)).drafts).toHaveLength(0);
    });

    it('never trusts the storage: invalid, foreign, secret-bearing and future rows are counted and unused', async () => {
        const { store, journal } = make();
        await journal.saveDraft(A, 'c1', 'E1', { content: 'ok' });
        const prefix = `${A}\u0001c1\u0001draft\u0001`;
        const row = (extra: Record<string, unknown>) => ({
            kind: 'draft',
            schema: 1,
            owner: A,
            resource: 'c1',
            writer: 'x',
            at: 1,
            base: null,
            fields: { content: 'x' },
            order: 1,
            ...extra,
        });
        const put = (name: string, value: Record<string, unknown>) =>
            store.rows.set(prefix + name, { key: prefix + name, ...value });
        put('bad', { kind: 'draft' });
        put('foreign', row({ owner: B, fields: { content: 'planted' } }));
        put(
            'secret',
            row({ fields: { content: 'x', authorization: 'Bearer abc' } })
        );
        put('future', row({ schema: 99 }));
        const snap = await journal.read(A);
        expect(snap.drafts).toHaveLength(1);
        expect(snap.invalid).toBe(4);
        expect(validateRecord(null)).toBeNull();
    });

    it('two tabs never overwrite each other: drafts are keyed by writer', async () => {
        const store = new MemoryStore();
        const one = new LocalJournal(store, 'tabA');
        const two = new LocalJournal(store, 'tabB');
        await one.saveDraft(A, 'c1', 'E1', { content: 'from-one' });
        await two.saveDraft(A, 'c1', 'E1', { content: 'from-two' });
        const drafts = (await one.read(A)).drafts;
        expect(drafts.map((d) => d.fields.content).sort()).toEqual([
            'from-one',
            'from-two',
        ]);
    });

    it('a read failure degrades to an empty snapshot and an honest status', async () => {
        const { store, journal } = make();
        await journal.saveDraft(A, 'c1', 'E1', { content: 'x' });
        store.faults.failNext = {
            count: 1,
            error: new JournalUnavailableError(),
        };
        const snap = await journal.read(A);
        expect(snap.drafts).toHaveLength(0);
        expect(journal.getStatus()).toBe('unavailable');
    });
});
