/** @jest-environment jsdom */

// MGN-DATA-01-LOT-A-REV1 — LA-AUD-02 at the level of the local board merge and
// the local refusal of persistPostIt. useAutosave and usePostIts are wired
// like BoardApp (same echo merge: every field the coordinator reports as
// stale is dropped from the echo, `etag` is always taken).

import { act, renderHook, waitFor } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import {
    deletePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../services/boardApi';
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

const card = (extra: Partial<PostIt> = {}): PostIt => ({
    _id: 'c',
    userId: 'u',
    tabId: 'tab-1',
    title: 'title',
    content: 'old',
    color: '#facc15',
    x: 12,
    y: 24,
    width: 220,
    height: 160,
    zIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    etag: 'V1',
    ...extra,
});

type Call = { base?: string; fields: Record<string, unknown>; outcome: string };
class FakeServer {
    doc: PostIt;
    n = 1;
    calls: Call[] = [];
    constructor(doc: PostIt) {
        this.doc = { ...doc };
    }
    update = async (
        _id: string,
        payload: PostItSaveUpdate
    ): Promise<PostIt> => {
        const { etag: base, ...fields } = payload;
        if (base !== undefined && base !== this.doc.etag) {
            this.calls.push({ base, fields, outcome: '409' });
            throw Object.assign(new Error('conflict'), {
                response: { status: 412 },
            });
        }
        Object.assign(this.doc, fields, { etag: `V${++this.n}` });
        this.calls.push({ base, fields, outcome: 'ok' });
        return { ...this.doc };
    };
}

const harness = (server: FakeServer, onMutationError: () => void) =>
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
            },
            { requireVersion: () => true }
        );
        control.current = {
            hold: auto.holdCard,
            release: auto.releaseCard,
            discard: auto.discardCard,
            write: auto.writeDirect,
        };
        return { board, auto };
    });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => {
    for (let i = 0; i < 400; i++) await Promise.resolve();
};
const mount = async (doc: PostIt) => {
    const server = new FakeServer(doc);
    const onError = jest.fn();
    (fetchPostIts as jest.Mock).mockImplementation(async () => [
        { ...server.doc },
    ]);
    (updatePostIt as jest.Mock).mockImplementation(server.update);
    (deletePostIt as jest.Mock).mockResolvedValue(undefined);
    (restorePostIt as jest.Mock).mockResolvedValue(undefined);
    const view = harness(server, onError);
    await waitFor(() =>
        expect(view.result.current.board.postIts).toHaveLength(1)
    );
    return { server, onError, ...view };
};
const shown = (view: ReturnType<typeof harness>['result']) =>
    view.current.board.postIts[0];

describe('LA-AUD-02 at the board merge level', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('the echo of a group that succeeds never rewinds the text of a refused group', async () => {
        const { server, result } = await mount(card());
        // The user edits the title (version V1), then the content, whose
        // closure still holds an older version (V0): two incompatible groups.
        await act(async () => {
            result.current.board.patchPostItLocal('c', {
                title: 'new title',
                content: 'my text',
            });
            result.current.auto.scheduleSave('c', {
                title: 'new title',
                etag: 'V1',
            });
            result.current.auto.scheduleSave('c', {
                content: 'my text',
                etag: 'V0',
            });
            await sleep(40);
            await result.current.auto.flushPending();
            await settle();
        });
        expect(server.calls.map((c) => c.outcome)).toEqual(['ok', '409']);
        expect(server.doc.title).toBe('new title');
        expect(server.doc.content).toBe('old'); // refused, server untouched
        // The board still shows what the user typed, not the server's echo.
        expect(shown(result).content).toBe('my text');
        expect(shown(result).title).toBe('new title');
        // And the refused text is recoverable with its own base.
        const refused = result.current.auto
            .recoverable('c')
            .filter((i) => i.state === 'conflicted');
        expect(refused).toHaveLength(1);
        expect(refused[0]).toMatchObject({
            fields: { content: 'my text' },
            base: 'V0',
        });
    });

    it('a refused group in the middle: later echoes still keep its text on the board', async () => {
        const { server, result } = await mount(card());
        await act(async () => {
            result.current.board.patchPostItLocal('c', {
                title: 'T',
                content: 'typed',
                x: 77,
            });
            result.current.auto.scheduleSave('c', {
                title: 'T',
                etag: 'V1',
            });
            result.current.auto.scheduleSave('c', {
                content: 'typed',
                etag: 'V0',
            });
            result.current.auto.scheduleSave('c', {
                x: 77,
                etag: 'V1',
            });
            await sleep(40);
            await result.current.auto.flushPending();
            await settle();
        });
        expect(server.calls.map((c) => c.outcome)).toEqual(['ok', '409', 'ok']);
        expect(server.doc.x).toBe(77);
        expect(shown(result).content).toBe('typed');
    });
});

describe('REV1 — persistPostIt refuses locally without a usable version', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('an empty version on the card: no request, the optimistic change is rolled back, the error is reported', async () => {
        const { server, result, onError } = await mount(card({ etag: '' }));
        await act(async () => {
            await result.current.board.savePostIt('c', { x: 500 });
            await settle();
        });
        expect(server.calls).toEqual([]);
        expect(shown(result).x).toBe(12); // rolled back
        expect(onError).toHaveBeenCalled();
    });

    it('control: a card with a version is written with it', async () => {
        const { server, result } = await mount(card());
        await act(async () => {
            await result.current.board.savePostIt('c', { x: 500 });
            await settle();
        });
        expect(server.calls).toEqual([
            { base: 'V1', fields: { x: 500 }, outcome: 'ok' },
        ]);
    });
});
