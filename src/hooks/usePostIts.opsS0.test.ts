/** @jest-environment jsdom */

// MGN-DATA-01 / OPS-S0-01 — a DELETE never leaves under another context.
// `deletion.begin` is a durable transaction awaited AFTER the last life check
// and BEFORE the request: the account or the session may change in between.
// The request is then not sent, and the row recorded (never sent) is closed on
// the owner and context captured when it was written.

import { act, renderHook, waitFor } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import { deletePostIt, fetchPostIts, updatePostIt } from '../services/boardApi';
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

const base: PostIt = {
    _id: 'c',
    userId: 'u',
    tabId: 'tab-1',
    title: 'title c',
    content: 'text c',
    color: '#facc15',
    x: 12,
    y: 24,
    width: 220,
    height: 160,
    zIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    etag: 'E1',
};

let owner: string | null = 'user-1';

const harness = (deletion: NonNullable<CardWriteControl['deletion']>) =>
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
                    rebase: (id, b) => control.current!.rebase!(id, b),
                    reloaded: (id) => control.current?.reloaded?.(id),
                    lifeOf: (id) => control.current!.lifeOf!(id),
                    unsentFields: () => [],
                    deletion,
                }),
                []
            );
            const board = usePostIts(tab, jest.fn(), jest.fn(), cardWrites);
            const auto = useAutosave<PostItSaveUpdate, PostIt | undefined>(
                (id, updates) => updatePostIt(id, updates),
                20,
                jest.fn(),
                () => undefined,
                { requireVersion: () => true, owner: () => owner }
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
                unsentFields: () => [],
            };
            return { board, auto };
        },
        { initialProps: { tab: 'tab-1' } }
    );

const mount = async (deletion: NonNullable<CardWriteControl['deletion']>) => {
    (fetchPostIts as jest.Mock).mockResolvedValue([{ ...base }]);
    (deletePostIt as jest.Mock).mockResolvedValue(undefined);
    owner = 'user-1';
    const view = harness(deletion);
    await waitFor(() =>
        expect(view.result.current.board.postIts).toHaveLength(1)
    );
    return view;
};

beforeEach(() => jest.resetAllMocks());

describe('OPS-S0-01 — the wait of deletion.begin', () => {
    it('the account changes during the transaction: no DELETE leaves, the never-sent row is closed on ITS owner', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const deletion = {
            begin: jest.fn(() => gate),
            outcome: jest.fn(async () => undefined),
            abort: jest.fn(async () => undefined),
        };
        const { result } = await mount(deletion);
        let removal: Promise<unknown> = Promise.resolve();
        await act(async () => {
            removal = result.current.board.removePostIt('c');
            for (let i = 0; i < 50; i++) await Promise.resolve();
        });
        expect(deletion.begin).toHaveBeenCalledTimes(1);
        owner = 'user-2'; // another account while the transaction is pending
        await act(async () => {
            release();
            await removal;
        });
        expect(deletePostIt).not.toHaveBeenCalled(); // nothing stale leaves
        expect(deletion.abort).toHaveBeenCalledWith('c', 'E1');
        expect(deletion.outcome).not.toHaveBeenCalled();
    });

    it('control: the context unchanged, the DELETE leaves once with the recorded base and the outcome follows', async () => {
        const deletion = {
            begin: jest.fn(async () => undefined),
            outcome: jest.fn(async () => undefined),
            abort: jest.fn(async () => undefined),
        };
        const { result } = await mount(deletion);
        await act(async () => {
            await result.current.board.removePostIt('c');
        });
        expect(deletePostIt).toHaveBeenCalledTimes(1);
        expect((deletePostIt as jest.Mock).mock.calls[0][1]).toBe('E1');
        expect(deletion.outcome).toHaveBeenCalledWith('c', 'E1', 'ok');
        expect(deletion.abort).not.toHaveBeenCalled();
    });
});
