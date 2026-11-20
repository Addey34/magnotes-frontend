/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D1A — C-AUD-02 (superseded restore while the read is in
// flight), C-AUD-03 (rollback of a board move) and C-AUD-04 (late grouping of
// refusals). Same harness as the LOT-C board tests (real coordinator, wired as
// BoardApp wires it); a red test on the C code is a confirmed defect
// (preuves/RED-usePostIts-D1A-on-C.txt).

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

const http = (status: number, code?: string) =>
    Object.assign(new Error(`http ${status}`), {
        response: { status, data: code ? { code } : {} },
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
            throw http(503, 'CONCURRENCY_UNAVAILABLE');
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

// ---------------------------------------------------------------------------
// C-AUD-02 — a superseded restore waits for a read; the context can change
// during that last wait.
// ---------------------------------------------------------------------------
describe('D1A C-AUD-02 — superseded restore: the context is checked after the read too', () => {
    const deleted = async () => {
        const ctx = await mount([card('c'), card('z')]);
        const links = linkEffects();
        await run(() => ctx.result.current.board.removePostIt('c', links));
        expect(ctx.server.docs.c).toBeUndefined();
        ctx.server.restoreSuperseded = true;
        return { ...ctx, links };
    };
    const invalidate = (result: Harness) => {
        owner = 'user-2';
        result.current.auto.invalidateAll();
    };

    it('the read succeeds after the context changed: links, notification, history and compensation are not run', async () => {
        const { server, result, onError, links } = await deleted();
        const open = server.gateFetch();
        let undoing: Promise<unknown> = Promise.resolve();
        await run(() => {
            undoing = result.current.board.undo();
        });
        await run(async () => {
            invalidate(result);
            open();
            await undoing;
        });
        expect(server.docs.c).toBeDefined(); // applied, never compensated
        expect(server.deletes.filter((d) => d.out === 'ok')).toHaveLength(1);
        expect(links.restore).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        // The entry did not move: the stale outcome changes nothing.
        expect(result.current.board.canRedo).toBe(false);
    });

    it('the read fails after the context changed: nothing is told, nothing is run', async () => {
        const { server, result, onError, links } = await deleted();
        const open = server.gateFetch();
        (fetchPostIts as jest.Mock).mockImplementationOnce(async () => {
            await server.fetchGate;
            throw lost();
        });
        let undoing: Promise<unknown> = Promise.resolve();
        await run(() => {
            undoing = result.current.board.undo();
        });
        await run(async () => {
            invalidate(result);
            open();
            await undoing;
        });
        expect(links.restore).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(server.deletes.filter((d) => d.out === 'ok')).toHaveLength(1);
    });

    it('the board is unmounted while the read is in flight: the old restore chain stops and nothing is told', async () => {
        const { server, result, onError, links, unmount } = await deleted();
        const open = server.gateFetch();
        let undoing: Promise<unknown> = Promise.resolve();
        await run(() => {
            undoing = result.current.board.undo();
        });
        unmount();
        await act(async () => {
            open();
            await undoing;
            await settleAll();
        });
        expect(links.restore).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('control (current life): the read succeeds, the chain continues and the links are restored once', async () => {
        const { result, onError, links } = await deleted();
        await run(() => result.current.board.undo());
        expect(links.restore).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.board.canRedo).toBe(true);
    });

    it('control (current life): the read fails, the restoration stays applied, the user is told once and nothing is deleted again', async () => {
        const { server, result, onError } = await deleted();
        (fetchPostIts as jest.Mock).mockRejectedValueOnce(lost());
        await run(() => result.current.board.undo());
        expect(server.docs.c).toBeDefined();
        expect(server.deletes.filter((d) => d.out === 'ok')).toHaveLength(1);
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// C-AUD-03 — the rollback of a failed board move touches the moved card only.
// ---------------------------------------------------------------------------
describe('D1A C-AUD-03 — rollback of a board move never reinstalls a whole list', () => {
    const board = async () => {
        const ctx = await mount([
            card('c', { x: 100, y: 120 }),
            card('b', { x: 300, y: 40 }),
            card('d', { x: 20, y: 400 }),
        ]);
        (createPostIt as jest.Mock).mockImplementation(async () => {
            const doc = card('n', { title: 'new', etag: 'N1' });
            ctx.server.docs.n = { ...doc };
            return { ...doc };
        });
        return ctx;
    };
    const ids = (h: Harness) =>
        h.current.board.postIts.map((p) => p._id).sort();

    /** A is moving (its PATCH is held); others change meanwhile. */
    const pendingMove = async (
        ctx: Awaited<ReturnType<typeof board>>,
        outcome: 'refused' | 'uncertain'
    ) => {
        const { server, result } = ctx;
        const open =
            outcome === 'uncertain'
                ? server.hold((f) => 'tabId' in f, 'before', 'fail')
                : server.hold((f) => 'tabId' in f, 'before', 'ok');
        if (outcome === 'refused') server.external('c', { content: 'theirs' });
        let moving: Promise<unknown> = Promise.resolve();
        await run(() => {
            moving = result.current.board.movePostItToTab('c', 'tab-2');
        });
        expect(ids(result)).toEqual(['b', 'd']); // optimistic
        return { open, moving: () => moving };
    };
    const meanwhile = async (ctx: Awaited<ReturnType<typeof board>>) => {
        const { result } = ctx;
        await run(() =>
            result.current.board.patchPostItLocal('b', { content: 'b edited' })
        );
        await run(() => result.current.board.removePostIt('d'));
        await run(() => result.current.board.addPostIt());
    };
    const finish = async (p: Awaited<ReturnType<typeof pendingMove>>) =>
        run(async () => {
            p.open();
            await p.moving();
        });

    it.each(['refused', 'uncertain'] as const)(
        'move refused (%s) while other cards were edited, deleted and created: only A comes back',
        async (outcome) => {
            const ctx = await board();
            const p = await pendingMove(ctx, outcome);
            await meanwhile(ctx);
            await finish(p);
            const { result, onError, server } = ctx;
            expect(ids(result)).toEqual(['b', 'c', 'n']); // d stays deleted
            expect(local(result, 'b')?.content).toBe('b edited');
            expect(local(result, 'c')?.x).toBe(100);
            expect(local(result, 'c')?.y).toBe(120);
            expect(local(result, 'c')?.tabId).toBe('tab-1');
            expect(server.docs.d).toBeUndefined();
            expect(onError).toHaveBeenCalledTimes(1);
            // no compensating write on a refused / uncertain move
            expect(server.patches.filter((x) => x.id === 'c')).toHaveLength(1);
        }
    );

    it('the user switches board during the wait: the move comes back on its source, the other cards are untouched', async () => {
        const ctx = await board();
        const p = await pendingMove(ctx, 'refused');
        await run(() =>
            ctx.result.current.board.patchPostItLocal('b', {
                content: 'b edited',
            })
        );
        ctx.rerender({ tab: 'tab-2' });
        await finish(p);
        ctx.rerender({ tab: 'tab-1' });
        await waitFor(() => expect(ids(ctx.result)).toContain('c'));
        expect(local(ctx.result, 'b')?.content).toBe('b edited');
        expect(local(ctx.result, 'c')?.tabId).toBe('tab-1');
        expect(ids(ctx.result)).toEqual(['b', 'c', 'd']);
    });

    it('control: nothing else changed, the refusal puts A back exactly where it was', async () => {
        const ctx = await board();
        const p = await pendingMove(ctx, 'refused');
        await finish(p);
        expect(ids(ctx.result)).toEqual(['b', 'c', 'd']);
        expect(local(ctx.result, 'c')?.x).toBe(100);
        expect(local(ctx.result, 'c')?.stackId ?? null).toBeNull();
    });

    it('undo of a move refused by the server: A leaves the board again, the other cards edited during the wait are untouched, no compensating write', async () => {
        const ctx = await board();
        const { server, result } = ctx;
        await run(() => result.current.board.movePostItToTab('c', 'tab-2'));
        expect(ids(result)).toEqual(['b', 'd']);
        const open = server.hold((f) => f.tabId === 'tab-1', 'before', 'ok');
        server.external('c', { content: 'theirs' });
        let undoing: Promise<unknown> = Promise.resolve();
        await run(() => {
            undoing = result.current.board.undo();
        });
        expect(ids(result)).toEqual(['b', 'c', 'd']); // optimistic undo
        await run(() =>
            result.current.board.patchPostItLocal('b', { content: 'b edited' })
        );
        await run(async () => {
            open();
            await undoing;
        });
        expect(ids(result)).toEqual(['b', 'd']);
        expect(local(result, 'b')?.content).toBe('b edited');
        expect(server.docs.c.tabId).toBe('tab-2');
        expect(server.patches.filter((x) => x.id === 'c')).toHaveLength(2);
        expect(ctx.onError).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// C-AUD-04 — every result is re-validated when the outcomes are grouped.
// ---------------------------------------------------------------------------
describe('D1A C-AUD-04 — a refusal obtained in a context that ended is a stale outcome too', () => {
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
    const change = (result: Harness) => {
        owner = 'user-2';
        result.current.auto.invalidateAll();
    };

    it('commit: A refused, B still waiting, the context changes, B is answered: no notification, no history entry', async () => {
        const { server, result, onError, merge } = await pile();
        server.external('a', { content: 'theirs' }); // a refused at once
        const open = server.hold((f) => f.stackOrder === 3, 'before'); // b held
        let done: Promise<unknown> = Promise.resolve();
        await run(() => {
            done = merge();
        });
        await run(async () => {
            change(result);
            open();
            await done;
        });
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.board.canUndo).toBe(false);
    });

    it('commit, symmetric: A acknowledged, B refused after the context changed: nothing recorded, nothing told', async () => {
        const { server, result, onError, merge } = await pile();
        server.external('b', { content: 'theirs' });
        const open = server.hold((f) => f.stackOrder === 3, 'before'); // b held
        let done: Promise<unknown> = Promise.resolve();
        await run(() => {
            done = merge();
        });
        await run(async () => {
            change(result);
            open();
            await done;
        });
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.board.canUndo).toBe(false);
    });

    it('commit: only the life of the refused card ends; the valid acknowledgements of the others are recorded, the dead refusal is not told', async () => {
        const { server, result, onError, merge } = await pile();
        server.external('a', { content: 'theirs' });
        const open = server.hold((f) => f.stackOrder === 3, 'before'); // b held
        let done: Promise<unknown> = Promise.resolve();
        await run(() => {
            done = merge();
        });
        await run(async () => {
            result.current.auto.discardCard('a');
            open();
            await done;
        });
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.board.canUndo).toBe(true);
        await run(() => result.current.board.undo());
        expect(server.docs.b.stackId).toBe('s1');
        expect(server.docs.c.stackId).toBe('s1');
    });

    describe('undo of a merged pile', () => {
        const merged = async () => {
            const ctx = await pile();
            await run(ctx.merge);
            return ctx;
        };

        it('A refused, B waiting, the context changes: the undo is a stale outcome (no partial entry, no notification, cursor untouched)', async () => {
            const { server, result, onError } = await merged();
            server.external('a', { content: 'theirs' });
            const open = server.hold(
                (f) => f.stackOrder === 2 && f.stackId === 's1',
                'before'
            );
            let undoing: Promise<unknown> = Promise.resolve();
            await run(() => {
                undoing = result.current.board.undo();
            });
            await run(async () => {
                change(result);
                open();
                await undoing;
            });
            expect(onError).not.toHaveBeenCalled();
            expect(result.current.board.canUndo).toBe(true);
            expect(result.current.board.canRedo).toBe(false);
        });

        it('only the refused card changes life: the other cards still count, the entry is split without telling the user about the dead refusal', async () => {
            const { server, result, onError } = await merged();
            server.external('a', { content: 'theirs' });
            const open = server.hold(
                (f) => f.stackOrder === 2 && f.stackId === 's1',
                'before'
            );
            let undoing: Promise<unknown> = Promise.resolve();
            await run(() => {
                undoing = result.current.board.undo();
            });
            await run(async () => {
                result.current.auto.discardCard('a');
                open();
                await undoing;
            });
            expect(onError).not.toHaveBeenCalled();
            expect(server.docs.b.stackId).toBe('s1');
            expect(server.docs.c.stackId).toBe('s1');
            expect(result.current.board.canRedo).toBe(true);
        });

        it('control: with no change of context the partial result is notified once', async () => {
            const { server, result, onError } = await merged();
            server.external('a', { content: 'theirs' });
            await run(() => result.current.board.undo());
            expect(onError).toHaveBeenCalledTimes(1);
            expect(result.current.board.canRedo).toBe(true);
            expect(result.current.board.canUndo).toBe(true);
        });
    });
});
