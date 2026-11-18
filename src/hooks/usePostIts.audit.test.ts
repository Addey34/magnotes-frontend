/** @jest-environment jsdom */

// MGN-DATA-01D-01-REV3A — reproductions of the CTO addendum findings at the
// usePostIts level (AUD-01, 03 on x/y, 04, 05, 06, 08). `boardApi` is replaced
// by a fake server that applies the REAL optimistic-concurrency rule and can
// hold a request (before it is applied) or its response (after), fail it, and
// delete / restore cards like the backend does (restore keeps the version of
// the snapshot it is given). useAutosave and usePostIts are wired like
// BoardApp. Each test states the INVARIANT; a failing test is a CONFIRMED,
// still-open defect. Controls that must pass are labelled "control".

import { act, renderHook, waitFor } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import {
    deletePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../services/boardApi';
import { PostIt, PostItSaveUpdate, PostItStack } from '../types/boardTypes';
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
    etag: 'v0',
    ...extra,
});

const conflict = () =>
    Object.assign(new Error('conflict'), { response: { status: 412 } });
const network = () => new Error('Network Error');

type Call = {
    n: number;
    id: string;
    base?: string;
    fields: Record<string, unknown>;
    outcome: string;
};
type Rule = {
    match: (call: Call) => boolean;
    phase: 'before' | 'after';
    then: 'ok' | 'fail';
    gate: Promise<void>;
    open: () => void;
    used: boolean;
};

class FakeServer {
    docs: Record<string, PostIt> = {};
    counter = 0;
    seq = 0;
    calls: Call[] = [];
    rules: Rule[] = [];
    deleteGate: Promise<void> | null = null;
    deleteFails = false;
    constructor(cards: PostIt[]) {
        cards.forEach((c) => (this.docs[c._id] = { ...c }));
    }
    /** Hold a matching request ('before' = not applied yet, 'after' = applied, answer retained). */
    hold(
        match: (call: Call) => boolean,
        phase: 'before' | 'after',
        then: 'ok' | 'fail' = 'ok'
    ) {
        let open!: () => void;
        const gate = new Promise<void>((r) => (open = r));
        this.rules.push({ match, phase, then, gate, open, used: false });
        return open;
    }
    holdDelete() {
        let open!: () => void;
        this.deleteGate = new Promise<void>((r) => (open = r));
        return open;
    }
    external(id: string, patch: Partial<PostIt>): string {
        Object.assign(this.docs[id], patch, {
            etag: `x${++this.counter}`,
        });
        return this.docs[id].etag as string;
    }
    update = async (id: string, payload: PostItSaveUpdate): Promise<PostIt> => {
        const { etag: base, ...fields } = payload;
        const call: Call = { n: ++this.seq, id, base, fields, outcome: '' };
        const rule = this.rules.find((r) => !r.used && r.match(call));
        if (rule) rule.used = true;
        if (rule?.phase === 'before') {
            await rule.gate;
            if (rule.then === 'fail') {
                call.outcome = 'network-before';
                this.calls.push(call);
                throw network();
            }
        }
        const doc = this.docs[id];
        if (!doc) {
            call.outcome = '404';
            this.calls.push(call);
            throw Object.assign(new Error('nf'), { response: { status: 404 } });
        }
        if (base !== undefined && base !== doc.etag) {
            call.outcome = '409';
            this.calls.push(call);
            throw conflict();
        }
        Object.assign(doc, fields, { etag: `s${++this.counter}` });
        call.outcome = 'ok';
        this.calls.push(call);
        const answer = { ...doc };
        if (rule?.phase === 'after') {
            await rule.gate;
            if (rule.then === 'fail') throw network();
        }
        return answer;
    };
    remove = async (id: string) => {
        if (this.deleteGate) await this.deleteGate;
        if (this.deleteFails) throw network();
        delete this.docs[id];
    };
    restore = async (snapshot: PostIt) => {
        // Backend behaviour: re-inserted with the version it is given.
        this.docs[snapshot._id] = { ...snapshot };
        return { ...snapshot };
    };
}

const harness = (server: FakeServer, onMutationError: () => void) =>
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
                (id, updates) => server.update(id, updates),
                20,
                jest.fn(),
                (id, saved, staleKeys) => {
                    if (!saved) return;
                    boardRef.current.patchPostItLocal(
                        id,
                        Object.fromEntries(
                            Object.entries(saved).filter(
                                ([key]) =>
                                    key === 'etag' || !staleKeys.includes(key)
                            )
                        ) as Partial<PostIt>
                    );
                }
            );
            control.current = {
                hold: auto.holdCard,
                release: auto.releaseCard,
                discard: auto.discardCard,
                write: auto.writeDirect,
            };
            return { board, auto };
        },
        { initialProps: { tab: 'tab-1' } }
    );
type Harness = ReturnType<typeof harness>['result'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => {
    for (let i = 0; i < 400; i++) await Promise.resolve();
};
const local = (h: Harness, id = 'c') =>
    h.current.board.postIts.find((p) => p._id === id);
const conflicts = (s: FakeServer) => s.calls.filter((c) => c.outcome === '409');

const mount = async (cards: PostIt[]) => {
    const server = new FakeServer(cards);
    const onError = jest.fn();
    (fetchPostIts as jest.Mock).mockImplementation(async (tabId: string) =>
        Object.values(server.docs)
            .filter((d) => d.tabId === tabId)
            .map((d) => ({ ...d }))
    );
    (updatePostIt as jest.Mock).mockImplementation(server.update);
    (deletePostIt as jest.Mock).mockImplementation(server.remove);
    (restorePostIt as jest.Mock).mockImplementation(server.restore);
    const view = harness(server, onError);
    await waitFor(() =>
        expect(view.result.current.board.postIts).toHaveLength(cards.length)
    );
    return { server, onError, ...view };
};

const run = (fn: () => Promise<unknown> | void) =>
    act(async () => {
        await fn();
        await settle();
    });

const noopCreateStack = jest.fn();

describe('REV3A hook-level reproductions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    describe('AUD-01 — an answer from a previous existence of the card never reaches the restored card', () => {
        // Old-life direct write: applied by the server, its answer retained.
        const oldLifeThenRestore = async () => {
            const ctx = await mount([card('c')]);
            const open = ctx.server.hold((call) => 'x' in call.fields, 'after');
            let first: Promise<unknown> = Promise.resolve();
            await run(() => {
                first = ctx.result.current.board.settlePostIt(
                    'c',
                    400,
                    300,
                    [],
                    noopCreateStack
                );
            });
            expect(ctx.server.docs.c.x).not.toBe(12); // applied before delete
            await run(() => ctx.result.current.board.removePostIt('c'));
            expect(ctx.server.docs.c).toBeUndefined();
            await run(() => ctx.result.current.board.undo()); // restore
            expect(ctx.server.docs.c).toBeDefined();
            return { ...ctx, open, first };
        };

        it('late success: the restored card keeps showing the version the server holds', async () => {
            const { server, result, open, first } = await oldLifeThenRestore();
            const restoredVersion = server.docs.c.etag;
            await run(async () => {
                open(); // the old answer is released
                await first;
            });
            expect(local(result)?.etag).toBe(restoredVersion);
            expect(local(result)?.etag).toBe(server.docs.c.etag);
        });

        it('late success, then a new modification: it is not refused with a 409 against our own old answer', async () => {
            const { server, result, open, first } = await oldLifeThenRestore();
            await run(async () => {
                open();
                await first;
            });
            await run(() =>
                result.current.board.settlePostIt(
                    'c',
                    600,
                    500,
                    [],
                    noopCreateStack
                )
            );
            expect(conflicts(server)).toHaveLength(0);
            expect(server.docs.c.x).toBe(local(result)?.x);
        });

        it('late success after a NEW modification was already queued: final board == server', async () => {
            const { server, result, open, first } = await oldLifeThenRestore();
            let second: Promise<unknown> = Promise.resolve();
            await run(() => {
                second = result.current.board.settlePostIt(
                    'c',
                    600,
                    500,
                    [],
                    noopCreateStack
                );
            });
            await run(async () => {
                open();
                await first;
                await second;
            });
            expect(local(result)?.x).toBe(server.docs.c.x);
            expect(local(result)?.etag).toBe(server.docs.c.etag);
            expect(conflicts(server)).toHaveLength(0);
        });

        it('late FAILURE of an old-life write does not roll the restored card back nor alert the user', async () => {
            const ctx = await mount([card('c')]);
            const open = ctx.server.hold(
                (call) => 'x' in call.fields,
                'before',
                'fail'
            );
            let first: Promise<unknown> = Promise.resolve();
            await run(() => {
                first = ctx.result.current.board.settlePostIt(
                    'c',
                    400,
                    300,
                    [],
                    noopCreateStack
                );
            });
            const optimisticX = local(ctx.result)!.x;
            await run(() => ctx.result.current.board.removePostIt('c'));
            await run(() => ctx.result.current.board.undo()); // restored at optimisticX
            expect(ctx.server.docs.c.x).toBe(optimisticX);
            ctx.onError.mockClear();
            await run(async () => {
                open(); // the old request now fails
                await first;
            });
            expect(local(ctx.result)?.x).toBe(ctx.server.docs.c.x);
            expect(ctx.onError).not.toHaveBeenCalled();
        });
    });

    describe('AUD-03 — x/y are written by both the autosave (resize) and the direct path (drag)', () => {
        it('resize pending in the debounce, then a drag: the drag (last intention) wins', async () => {
            const { server, result } = await mount([card('c')]);
            const base = local(result)!.etag;
            await run(() => {
                result.current.auto.scheduleSave('c', {
                    x: 10,
                    y: 10,
                    width: 300,
                    etag: base,
                });
            });
            await run(() =>
                result.current.board.settlePostIt(
                    'c',
                    400,
                    300,
                    [],
                    noopCreateStack
                )
            );
            const draggedX = server.docs.c.x;
            await act(async () => {
                await sleep(120);
                await settle();
            });
            expect(server.docs.c.x).toBe(draggedX);
            expect(local(result)?.x).toBe(server.docs.c.x);
        });
    });

    describe('AUD-04 — undo/redo of a board move never brings back an old snapshot', () => {
        it('text typed and still unsent when the card is moved: local, server and history agree after every step', async () => {
            const { server, result } = await mount([card('c')]);
            await run(() => {
                result.current.board.patchPostItLocal('c', {
                    content: 'typed before the move',
                });
                result.current.auto.scheduleSave('c', {
                    content: 'typed before the move',
                    etag: local(result)!.etag,
                });
            });
            await run(() => result.current.board.movePostItToTab('c', 'tab-2'));
            await act(async () => {
                await sleep(100);
                await settle();
            });
            expect(server.docs.c.tabId).toBe('tab-2');
            expect(server.docs.c.content).toBe('typed before the move');
            for (const step of ['undo', 'redo', 'undo'] as const) {
                await run(() => result.current.board[step]());
                expect(conflicts(server)).toHaveLength(0);
                if (step === 'undo') {
                    expect(local(result)?.content).toBe(server.docs.c.content);
                    expect(local(result)?.title).toBe(server.docs.c.title);
                    expect(local(result)?.etag).toBe(server.docs.c.etag);
                }
            }
            expect(server.docs.c.content).toBe('typed before the move');
        });

        it('another device edited the card after the move: the undo is refused, nothing of theirs is overwritten', async () => {
            const { server, result, onError } = await mount([card('c')]);
            await run(() => result.current.board.movePostItToTab('c', 'tab-2'));
            server.external('c', { content: 'theirs', x: 777 });
            await run(() => result.current.board.undo());
            expect(server.docs.c.content).toBe('theirs');
            expect(server.docs.c.x).toBe(777);
            expect(server.docs.c.tabId).toBe('tab-2'); // still moved
            expect(onError).toHaveBeenCalled();
            expect(local(result)).toBeUndefined(); // not shown on a board it is not on
            expect(result.current.board.canUndo).toBe(true);
        });
    });

    describe('AUD-05 — zIndex in history entries', () => {
        // c and d form a stack; d is released (history entry writes its zIndex).
        const unstacked = async () => {
            const ctx = await mount([
                card('c', { stackId: 's1', stackOrder: 1, x: 100, y: 100 }),
                card('d', { stackId: 's1', stackOrder: 2, x: 100, y: 100 }),
                card('e', { zIndex: 3 }),
            ]);
            const stacks: PostItStack[] = [
                {
                    _id: 's1',
                    userId: 'u',
                    tabId: 'tab-1',
                    x: 100,
                    y: 100,
                    collapsed: false,
                    createdAt: 'x',
                    updatedAt: 'x',
                },
            ];
            await run(() =>
                ctx.result.current.board.unstackPostIt('d', stacks)
            );
            return ctx;
        };

        it('inventory: history entries that write zIndex', async () => {
            const { server } = await unstacked();
            const wroteZ = server.calls.filter((c) => 'zIndex' in c.fields);
            expect(wroteZ.map((c) => c.id)).toEqual(['d']); // unstack of d
        });

        it('a zIndex changed after the action is not overwritten by the undo', async () => {
            const { server, result } = await unstacked();
            // d is raised afterwards (focus of another card, then of d).
            await run(() => result.current.board.focusPostIt('e'));
            await run(() => result.current.board.focusPostIt('d'));
            const raised = server.docs.d.zIndex;
            await run(() => result.current.board.undo());
            expect(server.docs.d.stackId).toBe('s1'); // the undo itself worked
            expect(server.docs.d.zIndex).toBe(raised);
        });
    });

    describe('AUD-06 — a write with no known version', () => {
        it('a direct write for a card that no loaded board shows is not sent without a version', async () => {
            const { server, result } = await mount([card('c')]);
            // Card of another board (not loaded here): no version is known.
            server.docs.z = card('z', { tabId: 'tab-9' });
            await run(() => result.current.board.savePostIt('z', { x: 5 }));
            const unversioned = server.calls.filter(
                (c) => c.id === 'z' && c.base === undefined
            );
            expect(unversioned).toHaveLength(0);
        });

        it('control: a card that is shown is always written with its version', async () => {
            const { server, result } = await mount([card('c')]);
            await run(() => result.current.board.savePostIt('c', { x: 5 }));
            expect(server.calls.every((c) => c.base !== undefined)).toBe(true);
        });
    });

    describe('AUD-08 — multi-card operations', () => {
        const stackOfTwo = async () => {
            const ctx = await mount([
                card('c', { stackId: 's1', stackOrder: 1, x: 100, y: 100 }),
                card('d', { stackId: 's1', stackOrder: 2, x: 100, y: 100 }),
            ]);
            const stacks: PostItStack[] = [
                {
                    _id: 's1',
                    userId: 'u',
                    tabId: 'tab-1',
                    x: 100,
                    y: 100,
                    collapsed: false,
                    createdAt: 'x',
                    updatedAt: 'x',
                },
            ];
            return { ...ctx, stacks };
        };
        const agree = (server: FakeServer, result: Harness, id: string) =>
            expect({
                stackId: local(result, id)?.stackId ?? null,
                x: local(result, id)?.x,
            }).toEqual({
                stackId: server.docs[id].stackId ?? null,
                x: server.docs[id].x,
            });

        it('partial failure of a committed multi-card change: board and server agree for every card', async () => {
            const { server, result, stacks } = await stackOfTwo();
            // d's write succeeds, c's (dissolve of the remaining sibling) fails.
            server.hold((call) => call.id === 'c', 'before', 'fail')();
            await run(() => result.current.board.unstackPostIt('d', stacks));
            agree(server, result, 'c');
            agree(server, result, 'd');
        });

        it('partial failure of an undo: board and server agree for every card', async () => {
            const { server, result, stacks } = await stackOfTwo();
            await run(() => result.current.board.unstackPostIt('d', stacks));
            expect(server.docs.d.stackId ?? null).toBeNull();
            server.hold((call) => call.id === 'c', 'before', 'fail')();
            await run(() => result.current.board.undo());
            expect(
                server.calls.some((c) => c.outcome === 'network-before')
            ).toBe(true); // the failure really happened
            agree(server, result, 'c');
            agree(server, result, 'd');
        });

        it('control: a successful undo then redo of the same operation leaves board == server', async () => {
            const { server, result, stacks } = await stackOfTwo();
            await run(() => result.current.board.unstackPostIt('d', stacks));
            await run(() => result.current.board.undo());
            await run(() => result.current.board.redo());
            expect(conflicts(server)).toHaveLength(0);
            agree(server, result, 'c');
            agree(server, result, 'd');
        });
    });
});
