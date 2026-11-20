/** @jest-environment jsdom */

// MGN-DATA-01-LOT-C — board level reproductions: B3-AUD-01 (late DELETE),
// B3-AUD-02 (stale restore inside a composite operation), AUD-05 (zIndex in
// history entries), AUD-08 (multi-card partial results) and the coherence of
// the history with what was really acknowledged. The coordinator is the real
// one, wired exactly like BoardApp wires it; a red test on the B3 code is a
// confirmed defect (preuves/RED-C-on-B3-code.txt).

import { act, renderHook, waitFor } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import {
    createPostIt,
    deletePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../services/boardApi';
import { markSuperseded } from '../services/concurrencyOutcome';
import {
    CardLink,
    PostIt,
    PostItSaveUpdate,
    PostItStack,
} from '../types/boardTypes';
import { CardWriteControl, useAutosave } from './useAutosave';
import { usePostIts } from './usePostIts';

jest.mock('../services/boardApi', () => ({
    createPostIt: jest.fn(),
    deletePostIt: jest.fn(),
    duplicatePostIt: jest.fn(),
    fetchPostIts: jest.fn(),
    restorePostIt: jest.fn(),
    updatePostIt: jest.fn(),
}));

const card = (id: string, extra: Partial<PostIt> = {}): PostIt => ({
    _id: id,
    userId: 'u',
    tabId: 'tab-1',
    title: `title ${id}`,
    content: `text ${id}`,
    color: '#facc15',
    x: 12,
    y: 24,
    width: 220,
    height: 160,
    zIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    etag: 'E1',
    ...extra,
});

const http = (
    status: number,
    code?: string,
    headers: Record<string, string> = {}
) =>
    Object.assign(new Error(`http ${status}`), {
        response: { status, data: code ? { code } : {}, headers },
    });
const lost = () => new Error('Network Error');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settleAll = async () => {
    for (let i = 0; i < 400; i++) await Promise.resolve();
};

interface Rule {
    match: (fields: Record<string, unknown>) => boolean;
    phase: 'before' | 'after';
    then: 'ok' | 'fail';
    gate: Promise<void>;
    used: boolean;
}

class Server {
    docs: Record<string, PostIt> = {};
    n = 0;
    patches: Array<{
        id: string;
        base?: string;
        fields: Record<string, unknown>;
        out: string;
    }> = [];
    deletes: Array<{ id: string; etag?: string; out: string }> = [];
    rules: Rule[] = [];
    fetchGate: Promise<void> | null = null;
    restoreGate: Promise<void> | null = null;
    restoreSuperseded = false;
    deleteGate: Promise<void> | null = null;
    deleteMode: 'ok' | '412' | 'lost' = 'ok';
    restoreMode: 'ok' | 'lost' | '503' = 'ok';
    constructor(cards: PostIt[]) {
        cards.forEach((c) => (this.docs[c._id] = { ...c }));
    }
    hold(
        match: (fields: Record<string, unknown>) => boolean,
        phase: 'before' | 'after',
        then: 'ok' | 'fail' = 'ok'
    ) {
        let open!: () => void;
        const gate = new Promise<void>((r) => (open = r));
        this.rules.push({ match, phase, then, gate, used: false });
        return open;
    }
    gateFetch() {
        let open!: () => void;
        this.fetchGate = new Promise<void>((r) => (open = r));
        return open;
    }
    gateDelete(mode: 'ok' | '412' | 'lost' = 'ok') {
        let open!: () => void;
        this.deleteGate = new Promise<void>((r) => (open = r));
        this.deleteMode = mode;
        return open;
    }
    gateRestore() {
        let open!: () => void;
        this.restoreGate = new Promise<void>((r) => (open = r));
        return open;
    }
    external(id: string, patch: Partial<PostIt>) {
        Object.assign(this.docs[id], patch, { etag: `X${++this.n}` });
        return this.docs[id].etag as string;
    }
    update = async (id: string, payload: PostItSaveUpdate): Promise<PostIt> => {
        const { etag: base, ...fields } = payload;
        const rule = this.rules.find((r) => !r.used && r.match(fields));
        if (rule) rule.used = true;
        const rec = { id, base, fields, out: '' };
        if (rule?.phase === 'before') {
            await rule.gate;
            if (rule.then === 'fail') {
                rec.out = 'lost-before';
                this.patches.push(rec);
                throw lost();
            }
        }
        const doc = this.docs[id];
        if (!doc) {
            rec.out = '404';
            this.patches.push(rec);
            throw http(404);
        }
        if (base !== doc.etag) {
            rec.out = '412';
            this.patches.push(rec);
            throw http(412, 'PRECONDITION_FAILED');
        }
        Object.assign(doc, fields, { etag: `S${++this.n}` });
        rec.out = 'ok';
        this.patches.push(rec);
        const answer = { ...doc };
        if (rule?.phase === 'after') {
            await rule.gate;
            if (rule.then === 'fail') throw lost();
        }
        return answer;
    };
    remove = async (id: string, etag?: string) => {
        if (this.deleteGate) await this.deleteGate;
        if (this.deleteMode === '412') {
            this.deletes.push({ id, etag, out: '412' });
            throw http(412, 'PRECONDITION_FAILED');
        }
        if (this.deleteMode === 'lost') {
            this.deletes.push({ id, etag, out: 'lost' });
            throw lost();
        }
        const doc = this.docs[id];
        if (!doc) {
            this.deletes.push({ id, etag, out: '404' });
            throw http(404);
        }
        if (etag !== doc.etag) {
            this.deletes.push({ id, etag, out: '412' });
            throw http(412, 'PRECONDITION_FAILED');
        }
        delete this.docs[id];
        this.deletes.push({ id, etag, out: 'ok' });
    };
    restore = async (snapshot: PostIt) => {
        if (this.restoreGate) await this.restoreGate;
        if (this.restoreMode === 'lost') throw lost();
        if (this.restoreMode === '503')
            throw http(503, 'CONCURRENCY_UNAVAILABLE', {
                'x-mutation-applied': 'false',
            });
        this.docs[snapshot._id] = { ...snapshot, etag: `R${++this.n}` };
        const answer = { ...this.docs[snapshot._id] };
        return this.restoreSuperseded ? markSuperseded(answer) : answer;
    };
    list = async (tabId: string) => {
        const snapshot = Object.values(this.docs)
            .filter((d) => d.tabId === tabId)
            .map((d) => ({ ...d }));
        if (this.fetchGate) await this.fetchGate;
        return snapshot;
    };
}

let owner: string | null = 'user-1';

const harness = (server: Server, onMutationError: () => void) =>
    renderHook(
        ({ tab }: { tab: string }) => {
            const control = useRef<CardWriteControl | null>(null);
            const cardWrites = useMemo<CardWriteControl>(
                () => ({
                    hold: (id) => control.current?.hold(id),
                    release: (id) => control.current?.release(id),
                    discard: (id) => control.current?.discard(id),
                    write: (id, updates) =>
                        control.current!.write!(id, updates),
                    settle: (id, ms) => control.current!.settle!(id, ms),
                    rebase: (id, base) => control.current!.rebase!(id, base),
                    reloaded: (id) => control.current?.reloaded?.(id),
                    lifeOf: (id) => control.current!.lifeOf!(id),
                    unsentFields: (id) =>
                        control.current?.unsentFields?.(id) ?? [],
                }),
                []
            );
            const board = usePostIts(
                tab,
                jest.fn(),
                onMutationError,
                cardWrites
            );
            const boardRef = useRef(board);
            boardRef.current = board;
            const auto = useAutosave<PostItSaveUpdate, PostIt | undefined>(
                (id, updates) => updatePostIt(id, updates),
                20,
                jest.fn(),
                (id, saved, staleKeys) => {
                    if (!saved) return;
                    boardRef.current.patchPostItLocal(
                        id,
                        Object.fromEntries(
                            Object.entries(saved).filter(
                                ([key]) =>
                                    key === 'etag' ||
                                    key === 'updatedAt' ||
                                    !staleKeys.includes(key)
                            )
                        ) as Partial<PostIt>
                    );
                },
                {
                    requireVersion: () => true,
                    owner: () => owner,
                    onSuperseded: (id, _r, keys) =>
                        boardRef.current.reloadCard(id, keys),
                }
            );
            control.current = {
                hold: auto.holdCard,
                release: auto.releaseCard,
                discard: auto.discardCard,
                write: auto.writeDirect,
                settle: auto.settle,
                rebase: auto.rebase,
                reloaded: auto.reloaded,
                lifeOf: auto.lifeOf,
                unsentFields: (id) =>
                    auto.recoverable(id).flatMap((i) => Object.keys(i.fields)),
            };
            return { board, auto };
        },
        { initialProps: { tab: 'tab-1' } }
    );
type Harness = ReturnType<typeof harness>['result'];

const local = (h: Harness, id = 'c') =>
    h.current.board.postIts.find((p) => p._id === id);

const mount = async (cards: PostIt[] = [card('c')]) => {
    const server = new Server(cards);
    const onError = jest.fn();
    (fetchPostIts as jest.Mock).mockImplementation(server.list);
    (updatePostIt as jest.Mock).mockImplementation(server.update);
    (deletePostIt as jest.Mock).mockImplementation(server.remove);
    (restorePostIt as jest.Mock).mockImplementation(server.restore);
    owner = 'user-1';
    const view = harness(server, onError);
    await waitFor(() =>
        expect(view.result.current.board.postIts).toHaveLength(cards.length)
    );
    return { server, onError, ...view };
};
const run = (fn: () => Promise<unknown> | void) =>
    act(async () => {
        await fn();
        await settleAll();
    });
const noStack = jest.fn();

const stackRec = (id: string, x: number, y: number): PostItStack => ({
    _id: id,
    userId: 'u',
    tabId: 'tab-1',
    x,
    y,
    collapsed: false,
    createdAt: 'x',
    updatedAt: 'x',
});
const link = {
    _id: 'l1',
    userId: 'u',
    tabId: 'tab-1',
    sourceId: 'c',
    targetId: 'z',
    createdAt: 'x',
    updatedAt: 'x',
} as CardLink;
const linkEffects = () => ({
    snapshot: () => [link],
    dropLocal: jest.fn(),
    restoreLocal: jest.fn(),
    restore: jest.fn(async () => undefined),
});

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('LOT-C B3-AUD-01 — the answer of a DELETE is checked against the context it was sent in', () => {
    it('late success after the context was invalidated: no history entry, no notification', async () => {
        const { server, result, onError } = await mount([card('c')]);
        const open = server.gateDelete('ok');
        let removal: Promise<unknown> = Promise.resolve();
        await run(() => {
            removal = result.current.board.removePostIt('c');
        });
        await run(async () => {
            owner = 'user-2';
            result.current.auto.invalidateAll();
            open();
            await removal;
        });
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.board.canUndo).toBe(false);
    });

    it('late failure after the context was invalidated: no rollback of the card, no notification', async () => {
        const { server, result, onError } = await mount([card('c')]);
        const open = server.gateDelete('412');
        let removal: Promise<unknown> = Promise.resolve();
        await run(() => {
            removal = result.current.board.removePostIt('c');
        });
        await run(async () => {
            owner = 'user-2';
            result.current.auto.invalidateAll();
            open();
            await removal;
        });
        expect(onError).not.toHaveBeenCalled();
        expect(local(result)).toBeUndefined();
    });

    it('control: the same failure in the same context restores the card and tells the user', async () => {
        const { server, result, onError } = await mount([card('c')]);
        server.deleteMode = '412';
        await run(() => result.current.board.removePostIt('c'));
        expect(onError).toHaveBeenCalledTimes(1);
        expect(local(result)).toBeDefined();
    });

    it('control: a normal deletion is recorded and can be undone', async () => {
        const { server, result, onError } = await mount([card('c')]);
        await run(() => result.current.board.removePostIt('c'));
        expect(server.deletes.map((d) => d.out)).toEqual(['ok']);
        expect(result.current.board.canUndo).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });
});

describe('LOT-C B3-AUD-02 — a stale restore interrupts the chain it belongs to', () => {
    const deletedThenUndoing = async () => {
        const ctx = await mount([card('c')]);
        const links = linkEffects();
        await run(() => ctx.result.current.board.removePostIt('c', links));
        expect(ctx.server.docs.c).toBeUndefined();
        const open = ctx.server.gateRestore();
        let undoing: Promise<unknown> = Promise.resolve();
        await run(() => {
            undoing = ctx.result.current.board.undo();
        });
        return { ...ctx, links, open, undoing: () => undoing };
    };

    it('late success of a stale restore: links are not restored, the entry does not move', async () => {
        const { result, links, open, undoing } = await deletedThenUndoing();
        await run(async () => {
            owner = 'user-2';
            result.current.auto.invalidateAll();
            open();
            await undoing();
        });
        expect(links.restore).not.toHaveBeenCalled();
        expect(result.current.board.canRedo).toBe(false);
        expect(result.current.board.canUndo).toBe(true);
    });

    it('late failure of a stale restore: no compensation, no notification', async () => {
        const { server, result, onError, open, undoing } =
            await deletedThenUndoing();
        server.restoreMode = 'lost';
        const deletesBefore = server.deletes.length;
        await run(async () => {
            owner = 'user-2';
            result.current.auto.invalidateAll();
            open();
            await undoing();
        });
        expect(onError).not.toHaveBeenCalled();
        expect(server.deletes).toHaveLength(deletesBefore);
    });

    it('the links cannot be recreated after a successful restore: the card stays restored, the user is told, nothing is deleted again', async () => {
        const { server, result, onError } = await mount([card('c')]);
        const links = linkEffects();
        links.restore.mockRejectedValueOnce(new Error('Network Error'));
        await run(() => result.current.board.removePostIt('c', links));
        const deletes = server.deletes.length;
        await run(() => result.current.board.undo());
        expect(server.docs.c).toBeDefined();
        expect(server.deletes).toHaveLength(deletes);
        expect(local(result)).toBeDefined();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.board.canRedo).toBe(true);
    });

    it('control: a current restore restores the links and moves the entry', async () => {
        const { result, links, open, undoing } = await deletedThenUndoing();
        await run(async () => {
            open();
            await undoing();
        });
        expect(links.restore).toHaveBeenCalledTimes(1);
        expect(result.current.board.canRedo).toBe(true);
    });
});

describe('LOT-C AUD-05 — zIndex in history entries', () => {
    const unstacked = async () => {
        const ctx = await mount([
            card('c', { stackId: 's1', stackOrder: 1, x: 100, y: 100 }),
            card('d', { stackId: 's1', stackOrder: 2, x: 100, y: 100 }),
            card('e', { zIndex: 3 }),
        ]);
        const stacks = [stackRec('s1', 100, 100)];
        await run(() => ctx.result.current.board.unstackPostIt('d', stacks));
        return ctx;
    };
    const lastPatchOf = (server: Server, id: string) =>
        [...server.patches].reverse().find((p) => p.id === id);

    it('a zIndex raised after the action is neither overwritten nor sent by the undo', async () => {
        const { server, result } = await unstacked();
        await run(() => result.current.board.focusPostIt('e'));
        await run(() => result.current.board.focusPostIt('d'));
        const raised = server.docs.d.zIndex;
        await run(() => result.current.board.undo());
        expect(server.docs.d.stackId).toBe('s1'); // the undo itself worked
        expect(server.docs.d.zIndex).toBe(raised);
        expect(local(result, 'd')?.zIndex).toBe(raised);
        expect(lastPatchOf(server, 'd')?.fields).not.toHaveProperty('zIndex');
    });

    it('a zIndex still where the entry expects it is restored by the undo, then by the redo', async () => {
        const { server, result } = await unstacked();
        const after = server.docs.d.zIndex;
        expect(after).toBe(4);
        await run(() => result.current.board.undo());
        expect(server.docs.d.zIndex).toBe(1);
        expect(local(result, 'd')?.zIndex).toBe(1);
        await run(() => result.current.board.redo());
        expect(server.docs.d.zIndex).toBe(after);
        expect(local(result, 'd')?.zIndex).toBe(after);
    });

    it('redo after a focus in between does not rewind the zIndex either', async () => {
        const { server, result } = await unstacked();
        await run(() => result.current.board.undo());
        await run(() => result.current.board.focusPostIt('d'));
        const raised = server.docs.d.zIndex;
        await run(() => result.current.board.redo());
        expect(server.docs.d.stackId ?? null).toBeNull();
        expect(server.docs.d.zIndex).toBe(raised);
        expect(lastPatchOf(server, 'd')?.fields).not.toHaveProperty('zIndex');
    });

    it('another device changed the zIndex: the undo is refused by the version, nothing of theirs is overwritten', async () => {
        const { server, result, onError } = await unstacked();
        server.external('d', { zIndex: 9 });
        await run(() => result.current.board.undo());
        expect(server.docs.d.zIndex).toBe(9);
        expect(server.docs.d.stackId ?? null).toBeNull();
        expect(onError).toHaveBeenCalled();
    });

    it('control: the other legitimately reversible fields are still restored', async () => {
        const { server, result } = await unstacked();
        await run(() => result.current.board.focusPostIt('e'));
        await run(() => result.current.board.undo());
        expect(server.docs.d.stackId).toBe('s1');
        expect(server.docs.d.stackOrder).toBe(2);
        expect(server.docs.d.x).toBe(100);
    });
});

describe('LOT-C AUD-08 — multi-card operations keep one result per card', () => {
    // s1 = {a, b, c} is merged onto the pile s2 (target card t).
    const pile = async () => {
        const ctx = await mount([
            card('t', { stackId: 's2', stackOrder: 1, x: 500, y: 500 }),
            card('a', { stackId: 's1', stackOrder: 1, x: 100, y: 100 }),
            card('b', { stackId: 's1', stackOrder: 2, x: 100, y: 100 }),
            card('c', { stackId: 's1', stackOrder: 3, x: 100, y: 100 }),
        ]);
        const stacks = [stackRec('s1', 100, 100), stackRec('s2', 500, 500)];
        const merge = () =>
            ctx.result.current.board.mergeStackInto('s1', 't', stacks, noStack);
        return { ...ctx, merge };
    };
    const inS2 = (h: Harness, id: string) => local(h, id)?.stackId === 's2';
    const agrees = (server: Server, h: Harness, id: string) =>
        expect({
            stackId: local(h, id)?.stackId ?? null,
            x: local(h, id)?.x,
        }).toEqual({
            stackId: server.docs[id].stackId ?? null,
            x: server.docs[id].x,
        });

    it('a and c succeed, b is refused: a and c keep their recorded place, b is reconciled alone', async () => {
        const { server, result, onError, merge } = await pile();
        server.external('b', { content: 'theirs' });
        await run(merge);
        expect(server.docs.a.stackId).toBe('s2');
        expect(server.docs.c.stackId).toBe('s2');
        expect(server.docs.b.stackId).toBe('s1');
        expect(server.docs.b.content).toBe('theirs');
        ['a', 'b', 'c'].forEach((id) => agrees(server, result, id));
        expect(inS2(result, 'a') && inS2(result, 'c')).toBe(true);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('the first card is refused, the others succeed (inverse order)', async () => {
        const { server, result, merge } = await pile();
        server.external('a', { content: 'theirs' });
        await run(merge);
        expect(server.docs.a.stackId).toBe('s1');
        expect(server.docs.b.stackId).toBe('s2');
        expect(server.docs.c.stackId).toBe('s2');
        ['a', 'b', 'c'].forEach((id) => agrees(server, result, id));
    });

    it('three cards, the intermediate request is lost before being applied: board == server for each card', async () => {
        const { server, result, merge } = await pile();
        const open = server.hold((f) => f.stackOrder === 3, 'before', 'fail'); // b
        await run(async () => {
            const done = merge();
            await settleAll();
            open();
            await done;
        });
        expect(server.docs.a.stackId).toBe('s2');
        expect(server.docs.c.stackId).toBe('s2');
        ['a', 'b', 'c'].forEach((id) => agrees(server, result, id));
    });

    it('late success after the first refusal: the late card is not rolled back and ends in agreement', async () => {
        const { server, result, merge } = await pile();
        server.external('a', { content: 'theirs' }); // a refused at once
        const open = server.hold((f) => f.stackOrder === 3, 'before'); // b held
        let done: Promise<unknown> = Promise.resolve();
        await run(() => {
            done = merge();
        });
        // a was refused and rolled back alone; b is still waiting, still shown moved
        expect(local(result, 'a')?.stackId).toBe('s1');
        expect(inS2(result, 'b')).toBe(true);
        await run(async () => {
            open();
            await done;
        });
        expect(server.docs.b.stackId).toBe('s2');
        ['a', 'b', 'c'].forEach((id) => agrees(server, result, id));
        expect(inS2(result, 'b')).toBe(true);
    });

    it('a newer optimistic edit on a refused card survives its rollback', async () => {
        const { server, result, merge } = await pile();
        server.external('a', { content: 'theirs' });
        const open = server.hold((f) => f.stackOrder === 3, 'before'); // b held
        let done: Promise<unknown> = Promise.resolve();
        await run(() => {
            done = merge();
        });
        await run(() => result.current.board.patchPostItLocal('a', { x: 777 }));
        await run(async () => {
            open();
            await done;
        });
        expect(local(result, 'a')?.stackId).toBe('s1');
        expect(local(result, 'a')?.x).toBe(777);
    });

    it('stale outcome (context changed): nothing is rolled back, nothing is recorded, nobody is told', async () => {
        const { server, result, onError, merge } = await pile();
        const open = server.hold((f) => f.stackOrder === 3, 'before');
        let done: Promise<unknown> = Promise.resolve();
        await run(() => {
            done = merge();
        });
        await run(async () => {
            owner = 'user-2';
            result.current.auto.invalidateAll();
            open();
            await done;
        });
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.board.canUndo).toBe(false);
    });

    it('control: everything acknowledged is recorded as one entry that undoes all three', async () => {
        const { server, result, merge } = await pile();
        await run(merge);
        ['a', 'b', 'c'].forEach((id) =>
            expect(server.docs[id].stackId).toBe('s2')
        );
        await run(() => result.current.board.undo());
        ['a', 'b', 'c'].forEach((id) => {
            expect(server.docs[id].stackId).toBe('s1');
            agrees(server, result, id);
        });
    });

    it('history records only what was acknowledged: the undo of a partial move touches a and c only', async () => {
        const { server, result, merge } = await pile();
        server.external('b', { content: 'theirs' });
        await run(merge);
        const before = server.patches.length;
        await run(() => result.current.board.undo());
        const touched = server.patches
            .slice(before)
            .filter((p) => p.out === 'ok')
            .map((p) => p.id)
            .sort();
        expect(touched).toEqual(['a', 'c']);
        expect(server.docs.b.content).toBe('theirs');
        expect(server.docs.b.stackId).toBe('s1');
    });
});

describe('LOT-C F — history stays coherent when an undo / redo is partial', () => {
    const merged = async () => {
        const ctx = await mount([
            card('t', { stackId: 's2', stackOrder: 1, x: 500, y: 500 }),
            card('a', { stackId: 's1', stackOrder: 1, x: 100, y: 100 }),
            card('b', { stackId: 's1', stackOrder: 2, x: 100, y: 100 }),
            card('c', { stackId: 's1', stackOrder: 3, x: 100, y: 100 }),
        ]);
        const stacks = [stackRec('s1', 100, 100), stackRec('s2', 500, 500)];
        await run(() =>
            ctx.result.current.board.mergeStackInto('s1', 't', stacks, noStack)
        );
        return ctx;
    };

    it('undo: b changed elsewhere, a and c are undone, b stays merged, the rest can still be undone / redone', async () => {
        const { server, result, onError } = await merged();
        server.external('b', { content: 'theirs' });
        await run(() => result.current.board.undo());
        expect(server.docs.a.stackId).toBe('s1');
        expect(server.docs.c.stackId).toBe('s1');
        expect(server.docs.b.stackId).toBe('s2');
        expect(local(result, 'b')?.stackId).toBe('s2');
        expect(local(result, 'a')?.stackId).toBe('s1');
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.board.canUndo).toBe(true); // b is still to undo
        expect(result.current.board.canRedo).toBe(true); // a and c can be redone
        await run(() => result.current.board.redo());
        expect(server.docs.a.stackId).toBe('s2');
        expect(server.docs.c.stackId).toBe('s2');
        expect(server.docs.b.content).toBe('theirs');
    });

    it('undo refused for every card: nothing is applied and no compensating write is sent', async () => {
        const { server, result, onError } = await merged();
        ['a', 'b', 'c'].forEach((id) => server.external(id, { content: 'x' }));
        const before = server.patches.length;
        await run(() => result.current.board.undo());
        const attempts = server.patches.slice(before);
        expect(attempts).toHaveLength(3);
        expect(attempts.every((p) => p.out === '412')).toBe(true);
        ['a', 'b', 'c'].forEach((id) => {
            expect(server.docs[id].stackId).toBe('s2');
            expect(local(result, id)?.stackId).toBe('s2');
        });
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.board.canUndo).toBe(true);
        expect(result.current.board.canRedo).toBe(false);
    });

    it('a new action recorded while an undo is partial is not lost', async () => {
        const { server, result } = await merged();
        server.external('b', { content: 'theirs' });
        await run(() => result.current.board.undo());
        await run(() => result.current.board.focusPostIt('t'));
        expect(result.current.board.canUndo).toBe(true);
    });
});

describe('LOT-C F — compensations never overwrite or delete what they did not apply', () => {
    const created = async () => {
        const ctx = await mount([card('z')]);
        (createPostIt as jest.Mock).mockImplementation(async () => {
            const doc = card('n', { title: 'new', etag: 'N1' });
            ctx.server.docs.n = { ...doc };
            return { ...doc };
        });
        await run(() => ctx.result.current.board.addPostIt());
        return ctx;
    };

    it('undo of a creation refused by the server (card changed elsewhere): the card is NOT restored over theirs', async () => {
        const { server, result, onError } = await created();
        server.external('n', { content: 'theirs' });
        await run(() => result.current.board.undo());
        expect(restorePostIt).not.toHaveBeenCalled();
        expect(server.docs.n.content).toBe('theirs');
        expect(onError).toHaveBeenCalled();
        expect(local(result, 'n')).toBeDefined();
        expect(result.current.board.canUndo).toBe(true);
    });

    it('redo of a deletion refused by the server: the card is NOT restored over theirs', async () => {
        const { server, result, onError } = await mount([card('c')]);
        await run(() => result.current.board.removePostIt('c'));
        await run(() => result.current.board.undo()); // restored, new token
        const restoredRestores = (restorePostIt as jest.Mock).mock.calls.length;
        server.external('c', { content: 'theirs' });
        await run(() => result.current.board.redo());
        expect((restorePostIt as jest.Mock).mock.calls.length).toBe(
            restoredRestores
        );
        expect(server.docs.c.content).toBe('theirs');
        expect(onError).toHaveBeenCalled();
        expect(local(result)).toBeDefined();
        expect(result.current.board.canRedo).toBe(true);
    });

    it('undo of a deletion whose restore is certainly refused: no DELETE is sent, the card is not shown', async () => {
        const { server, result, onError } = await mount([card('c')]);
        await run(() => result.current.board.removePostIt('c'));
        server.restoreMode = '503';
        const deletes = server.deletes.length;
        await run(() => result.current.board.undo());
        expect(server.deletes).toHaveLength(deletes);
        expect(local(result)).toBeUndefined();
        expect(onError).toHaveBeenCalled();
        expect(result.current.board.canUndo).toBe(true);
    });

    it('undo of a deletion whose restore answer is lost: nothing destructive is sent, the card stays visible without a token', async () => {
        const { server, result, onError } = await mount([card('c')]);
        await run(() => result.current.board.removePostIt('c'));
        server.restoreMode = 'lost';
        const deletes = server.deletes.length;
        await run(() => result.current.board.undo());
        expect(server.deletes).toHaveLength(deletes);
        expect(local(result)).toBeDefined();
        expect(local(result)?.etag).toBeUndefined();
        expect(onError).toHaveBeenCalled();
        // a second attempt does not duplicate the card on the board
        server.restoreMode = 'ok';
        await run(() => result.current.board.undo());
        expect(
            result.current.board.postIts.filter((p) => p._id === 'c')
        ).toHaveLength(1);
    });

    it('dissolve refused after a deletion: no compensating write, the deletion stays applied and undoable', async () => {
        const { server, result, onError } = await mount([
            card('c', { stackId: 's1', stackOrder: 1, x: 100, y: 100 }),
            card('d', { stackId: 's1', stackOrder: 2, x: 100, y: 100 }),
        ]);
        server.external('c', { content: 'theirs' }); // the dissolve of c is refused
        await run(() => result.current.board.removePostIt('d'));
        expect(server.docs.d).toBeUndefined();
        expect(server.patches.filter((p) => p.id === 'c')).toHaveLength(1);
        expect(server.docs.c.content).toBe('theirs');
        expect(local(result, 'c')?.stackId).toBe('s1');
        expect(onError).toHaveBeenCalled();
        // undoing restores d and does not pretend to un-dissolve c
        await run(() => result.current.board.undo());
        expect(server.docs.d).toBeDefined();
        expect(server.patches.filter((p) => p.id === 'c')).toHaveLength(1);
    });
});

describe('LOT-C F — board move entries follow the same rules', () => {
    it('undo / redo of a move restore the zIndex of each side when nothing drifted', async () => {
        const { server, result } = await mount([
            card('c', { zIndex: 5 }),
            card('e', { zIndex: 7 }),
        ]);
        await run(() => result.current.board.movePostItToTab('c', 'tab-2'));
        const moved = server.docs.c.zIndex;
        expect(moved).toBe(1);
        await run(() => result.current.board.undo());
        expect(server.docs.c.tabId).toBe('tab-1');
        expect(server.docs.c.zIndex).toBe(5);
        await run(() => result.current.board.redo());
        expect(server.docs.c.tabId).toBe('tab-2');
        expect(server.docs.c.zIndex).toBe(moved);
    });

    it('the sibling dissolve is refused: no compensating write, and the undo only brings the moved card back', async () => {
        const { server, result, onError } = await mount([
            card('c', { stackId: 's1', stackOrder: 1, x: 100, y: 100 }),
            card('d', { stackId: 's1', stackOrder: 2, x: 100, y: 100 }),
        ]);
        server.external('c', { content: 'theirs' });
        await run(() => result.current.board.movePostItToTab('d', 'tab-2'));
        expect(server.docs.d.tabId).toBe('tab-2');
        expect(onError).toHaveBeenCalled();
        expect(local(result, 'c')?.stackId).toBe('s1');
        expect(server.patches.filter((p) => p.id === 'c')).toHaveLength(1);
        await run(() => result.current.board.undo());
        expect(server.docs.d.tabId).toBe('tab-1');
        expect(server.patches.filter((p) => p.id === 'c')).toHaveLength(1);
        expect(server.docs.c.content).toBe('theirs');
    });
});
