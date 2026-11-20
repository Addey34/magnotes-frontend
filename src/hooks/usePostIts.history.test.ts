/** @jest-environment jsdom */

// MGN-DATA-01D-01-REV2 — history (undo/redo) writes go through the same
// coordinator as every other write of a card. `updatePostIt` is replaced by a
// fake server that applies the REAL optimistic-concurrency rule (a write whose
// etag is not the card's current version is refused with a 409).
// useAutosave and usePostIts are wired together exactly like BoardApp does.

import { act, renderHook, waitFor } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import { fetchPostIts, updatePostIt } from '../services/boardApi';
import { PostIt, PostItSaveUpdate } from '../types/boardTypes';
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

const baseCard: PostIt = {
    _id: 'c',
    userId: 'u',
    tabId: 'tab-1',
    title: 'Card',
    content: 'text',
    color: '#facc15',
    x: 12,
    y: 24,
    width: 220,
    height: 160,
    zIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    etag: 'v0',
};

const conflict = () =>
    Object.assign(new Error('conflict'), { response: { status: 412 } });

class FakeServer {
    doc: PostIt = { ...baseCard };
    counter = 0;
    calls: Array<{ base?: string; keys: string[]; outcome: string }> = [];
    gated = false;
    failNext = 0;
    private waiting: Array<() => void> = [];
    open() {
        this.gated = false;
        this.waiting.splice(0).forEach((r) => r());
    }
    /** Another device edits the card: returns the version it produced. */
    external(patch: Partial<PostIt>): string {
        Object.assign(this.doc, patch, { etag: `v${++this.counter}` });
        return this.doc.etag as string;
    }
    update = async (
        _id: string,
        payload: PostItSaveUpdate
    ): Promise<PostIt> => {
        if (this.gated) await new Promise<void>((r) => this.waiting.push(r));
        const { etag: base, ...patch } = payload;
        const keys = Object.keys(patch).sort();
        if (this.failNext > 0) {
            this.failNext--;
            this.calls.push({ base, keys, outcome: 'network' });
            throw new Error('Network Error');
        }
        if (base !== undefined && base !== this.doc.etag) {
            this.calls.push({ base, keys, outcome: '409' });
            throw conflict();
        }
        Object.assign(this.doc, patch, { etag: `v${++this.counter}` });
        this.calls.push({ base, keys, outcome: 'ok' });
        return { ...this.doc };
    };
}

const harness = (server: FakeServer, onMutationError = jest.fn()) =>
    renderHook(() => {
        const control = useRef<CardWriteControl | null>(null);
        const cardWrites = useMemo<CardWriteControl>(
            () => ({
                hold: (id) => control.current?.hold(id),
                release: (id) => control.current?.release(id),
                discard: (id) => control.current?.discard(id),
                write: (id, updates) => control.current!.write!(id, updates),
            }),
            []
        );
        const board = usePostIts(
            'tab-1',
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
    });
type Harness = ReturnType<typeof harness>['result'];

const localCard = (h: Harness) =>
    h.current.board.postIts.find((c) => c._id === 'c');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => {
    for (let i = 0; i < 400; i++) await Promise.resolve();
};
const move = async (h: Harness, x: number, y: number) => {
    await act(async () => {
        await h.current.board.settlePostIt('c', x, y, [], jest.fn());
        await settle();
    });
};
const undo = async (h: Harness) =>
    act(async () => {
        await h.current.board.undo();
        await settle();
    });
const redo = async (h: Harness) =>
    act(async () => {
        await h.current.board.redo();
        await settle();
    });
const conflicts = (s: FakeServer) => s.calls.filter((c) => c.outcome === '409');

const mountBoard = async (server: FakeServer, onError = jest.fn()) => {
    (fetchPostIts as jest.Mock).mockResolvedValue([{ ...baseCard }]);
    (updatePostIt as jest.Mock).mockImplementation(server.update);
    const view = harness(server, onError);
    await waitFor(() =>
        expect(view.result.current.board.postIts).toHaveLength(1)
    );
    return view;
};

describe('usePostIts — MGN-DATA-01D-01-REV2 history through the coordinator', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('1. W4 — move, undo, redo, undo: no conflict against our own writes, server and board agree', async () => {
        const server = new FakeServer();
        const { result } = await mountBoard(server);
        const x0 = server.doc.x;
        await move(result, 400, 300);
        const x1 = server.doc.x;
        expect(x1).not.toBe(x0);
        await undo(result);
        await redo(result);
        await undo(result);
        expect(conflicts(server)).toHaveLength(0);
        expect(server.doc.x).toBe(x0);
        expect(localCard(result)?.x).toBe(x0);
        expect(localCard(result)?.etag).toBe(server.doc.etag);
    });

    it('2. undo/redo after more than 20 acknowledged local writes', async () => {
        const server = new FakeServer();
        const { result } = await mountBoard(server);
        const x0 = server.doc.x;
        await move(result, 400, 300);
        const x1 = server.doc.x;
        for (let i = 0; i < 22; i++) {
            await act(async () => {
                result.current.auto.scheduleSave('c', {
                    content: `t${i}`,
                    etag: localCard(result)!.etag,
                });
                await Promise.resolve();
            });
            await act(async () => {
                await sleep(60);
                await settle();
            });
        }
        expect(conflicts(server)).toHaveLength(0);
        await undo(result);
        expect(conflicts(server)).toHaveLength(0);
        expect(server.doc.x).toBe(x0);
        await redo(result);
        expect(conflicts(server)).toHaveLength(0);
        expect(server.doc.x).toBe(x1);
        expect(server.doc.content).toBe('t21');
    });

    it('3. undo while an autosave is in flight waits behind it and is not refused', async () => {
        const server = new FakeServer();
        const { result } = await mountBoard(server);
        const x0 = server.doc.x;
        await move(result, 400, 300);
        server.gated = true;
        await act(async () => {
            result.current.auto.scheduleSave('c', {
                content: 'typed',
                etag: localCard(result)!.etag,
            });
            await sleep(60);
            await settle();
        });
        let undone: Promise<void> = Promise.resolve();
        await act(async () => {
            undone = result.current.board.undo();
            await settle();
        });
        expect(server.doc.x).not.toBe(x0); // the undo waits behind the text
        await act(async () => {
            server.open();
            await undone;
            await settle();
        });
        expect(conflicts(server)).toHaveLength(0);
        expect(server.doc.x).toBe(x0);
        expect(server.doc.content).toBe('typed');
        // The autosave answer that arrived while the undo was queued must not
        // have rewound the board: it shows what the server holds.
        expect(localCard(result)?.x).toBe(x0);
        expect(localCard(result)?.content).toBe('typed');
        expect(localCard(result)?.etag).toBe(server.doc.etag);
    });

    it('4. a concerned field changed elsewhere and already shown: the undo is refused, nothing is written, the entry stays', async () => {
        const server = new FakeServer();
        const onError = jest.fn();
        const { result } = await mountBoard(server, onError);
        await move(result, 400, 300);
        const theirs = 777;
        const version = server.external({ x: theirs });
        // The board was reloaded and now shows their value and version.
        act(() =>
            result.current.board.patchPostItLocal('c', {
                x: theirs,
                etag: version,
            } as never)
        );
        const writesBefore = server.calls.length;
        await undo(result);
        expect(server.calls.length).toBe(writesBefore); // no write at all
        expect(server.doc.x).toBe(theirs); // never overwritten
        expect(localCard(result)?.x).toBe(theirs);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.board.canUndo).toBe(true); // entry preserved
    });

    it('4b. a concerned field changed elsewhere and NOT yet shown: the server refuses, the board rolls back, the entry stays', async () => {
        const server = new FakeServer();
        const onError = jest.fn();
        const { result } = await mountBoard(server, onError);
        await move(result, 400, 300);
        const movedX = localCard(result)!.x;
        server.external({ x: 777 }); // unseen by this board
        await undo(result);
        expect(conflicts(server).length).toBeGreaterThan(0);
        expect(server.doc.x).toBe(777);
        expect(localCard(result)?.x).toBe(movedX); // local state restored
        expect(onError).toHaveBeenCalled();
        expect(result.current.board.canUndo).toBe(true);
    });

    it('5. an independent field changed elsewhere and already shown: the undo applies and keeps their change', async () => {
        const server = new FakeServer();
        const { result } = await mountBoard(server);
        const x0 = server.doc.x;
        await move(result, 400, 300);
        const version = server.external({ title: 'their title' });
        act(() =>
            result.current.board.patchPostItLocal('c', {
                title: 'their title',
                etag: version,
            } as never)
        );
        await undo(result);
        expect(conflicts(server)).toHaveLength(0);
        expect(server.doc.x).toBe(x0);
        expect(server.doc.title).toBe('their title');
        // Only the fields of the history entry were sent, never their title.
        expect(server.calls.at(-1)?.keys).not.toContain('title');
    });

    it('6. move to another board, then undo and redo: no conflict, card back and forth', async () => {
        const server = new FakeServer();
        const { result } = await mountBoard(server);
        await act(async () => {
            await result.current.board.movePostItToTab('c', 'tab-2');
            await settle();
        });
        expect(server.doc.tabId).toBe('tab-2');
        expect(localCard(result)).toBeUndefined();
        await undo(result);
        expect(server.doc.tabId).toBe('tab-1');
        expect(localCard(result)).toBeDefined();
        await redo(result);
        expect(server.doc.tabId).toBe('tab-2');
        await undo(result);
        await redo(result);
        await undo(result);
        expect(conflicts(server)).toHaveLength(0);
        expect(server.doc.tabId).toBe('tab-1');
        expect(localCard(result)?.etag).toBe(server.doc.etag);
    });

    it('7. a failed undo leaves board, server and history consistent', async () => {
        const server = new FakeServer();
        const onError = jest.fn();
        const { result } = await mountBoard(server, onError);
        await move(result, 400, 300);
        const movedX = server.doc.x;
        server.failNext = 1;
        await undo(result);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(localCard(result)?.x).toBe(movedX); // local state restored
        expect(server.doc.x).toBe(movedX); // server unchanged
        expect(result.current.board.canUndo).toBe(true);
        // The user can try again and it works.
        await undo(result);
        expect(server.doc.x).toBe(12);
        expect(conflicts(server)).toHaveLength(0);
    });
});
