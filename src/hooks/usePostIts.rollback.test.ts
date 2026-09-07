/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import {
    createPostIt,
    deletePostIt,
    duplicatePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../services/boardApi';
import { PostIt, PostItStack } from '../types/boardTypes';
import { usePostIts } from './usePostIts';

jest.mock('../services/boardApi', () => ({
    createPostIt: jest.fn(),
    deletePostIt: jest.fn(),
    duplicatePostIt: jest.fn(),
    fetchPostIts: jest.fn(),
    restorePostIt: jest.fn(),
    updatePostIt: jest.fn(),
}));

const card: PostIt = {
    _id: 'card-1',
    userId: 'user-1',
    tabId: 'tab-1',
    title: 'Card',
    content: '',
    color: '#facc15',
    x: 12,
    y: 24,
    width: 220,
    height: 160,
    zIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

const secondCard: PostIt = {
    ...card,
    _id: 'card-2',
    title: 'Second card',
    x: 260,
};

describe('usePostIts rollbacks', () => {
    const mockedFetch = fetchPostIts as jest.MockedFunction<
        typeof fetchPostIts
    >;
    const mockedUpdate = updatePostIt as jest.MockedFunction<
        typeof updatePostIt
    >;
    const mockedDelete = deletePostIt as jest.MockedFunction<
        typeof deletePostIt
    >;
    const mockedDuplicate = duplicatePostIt as jest.MockedFunction<
        typeof duplicatePostIt
    >;
    const mockedRestore = restorePostIt as jest.MockedFunction<
        typeof restorePostIt
    >;
    const mockedCreate = createPostIt as jest.MockedFunction<
        typeof createPostIt
    >;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedFetch.mockResolvedValue([card]);
    });

    it('restores a card when moving it to another board fails', async () => {
        mockedUpdate.mockRejectedValue(new Error('network'));
        const onMutationError = jest.fn();
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), onMutationError)
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(1));

        await act(async () =>
            result.current.movePostItToTab('card-1', 'tab-2')
        );

        expect(result.current.postIts).toEqual([card]);
        expect(onMutationError).toHaveBeenCalledTimes(1);
    });

    it('creates a stack when a card is dropped on another card center', async () => {
        mockedUpdate.mockResolvedValue(undefined);
        mockedFetch.mockResolvedValue([card, secondCard]);
        const stack: PostItStack = {
            _id: 'stack-1',
            userId: 'user-1',
            tabId: 'tab-1',
            x: card.x,
            y: card.y,
            collapsed: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };
        const createStackAt = jest.fn().mockResolvedValue(stack);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(2));

        await act(async () =>
            result.current.settlePostIt(
                'card-2',
                card.x,
                card.y,
                [],
                createStackAt
            )
        );

        expect(createStackAt).toHaveBeenCalledWith(card.x, card.y);
        expect(mockedUpdate).toHaveBeenCalledWith('card-1', {
            expectedUpdatedAt: card.updatedAt,
            stackId: 'stack-1',
            stackOrder: 1,
            x: card.x,
            y: card.y,
        });
        expect(mockedUpdate).toHaveBeenCalledWith('card-2', {
            expectedUpdatedAt: secondCard.updatedAt,
            stackId: 'stack-1',
            stackOrder: 2,
            x: card.x,
            y: card.y,
        });
    });

    it('dissolves a stack back to a free card when only one member is left', async () => {
        // Regression: unstacking the second-to-last member used to leave a
        // "1 note" stack widget behind instead of a plain free card.
        mockedUpdate.mockResolvedValue(undefined);
        const stackedFirst: PostIt = {
            ...card,
            stackId: 'stack-1',
            stackOrder: 1,
        };
        const stackedSecond: PostIt = {
            ...secondCard,
            stackId: 'stack-1',
            stackOrder: 2,
        };
        mockedFetch.mockResolvedValue([stackedFirst, stackedSecond]);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(2));

        await act(async () => result.current.unstackPostIt('card-2', []));

        expect(mockedUpdate).toHaveBeenCalledWith(
            'card-1',
            expect.objectContaining({ stackId: null, stackOrder: null })
        );
        expect(
            result.current.postIts.find((item) => item._id === 'card-1')
        ).toEqual(expect.objectContaining({ stackId: null, stackOrder: null }));
    });

    it('ignores the phantom rectangles left behind by a moved stack', async () => {
        // Regression: a stack's members keep the coordinates they were given
        // when stacked, and settleStack never rewrites them. After the stack is
        // dragged elsewhere, those stale rectangles sat on empty board space as
        // invisible drop magnets — a card dropped there was swallowed into the
        // pile and disappeared from the canvas.
        mockedUpdate.mockResolvedValue(undefined);
        const hidden: PostIt = {
            ...card,
            _id: 'hidden-1',
            stackId: 'stack-1',
            stackOrder: 1,
            x: 400,
            y: 200,
        };
        const free: PostIt = { ...secondCard, x: 1000, y: 600 };
        mockedFetch.mockResolvedValue([hidden, free]);
        // The stack has since been dragged far away from (400, 200).
        const movedStack: PostItStack = {
            _id: 'stack-1',
            userId: 'user-1',
            tabId: 'tab-1',
            x: 430,
            y: 800,
            collapsed: true,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
        };
        const createStackAt = jest.fn();
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(2));

        // Drop the free card right onto the vacated (400, 200) spot.
        expect(
            result.current.getDropIntent('card-2', [movedStack], {}, 400, 200)
        ).toBeNull();

        await act(async () =>
            result.current.settlePostIt(
                'card-2',
                400,
                200,
                [movedStack],
                createStackAt
            )
        );

        expect(createStackAt).not.toHaveBeenCalled();
        expect(
            result.current.postIts.find((item) => item._id === 'card-2')
        ).toMatchObject({ stackId: null, x: 400, y: 200 });
    });

    it('does not re-absorb a card nudged within its own expanded stack fan', async () => {
        // Fan siblings sit one tab step apart — inside the stack radius — so
        // without excluding them a card could never be pulled out of its own
        // pile: every drop landed back on a sibling and re-stacked.
        const stack: PostItStack = {
            _id: 'stack-1',
            userId: 'user-1',
            tabId: 'tab-1',
            x: 400,
            y: 200,
            collapsed: false,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
        };
        mockedFetch.mockResolvedValue([
            { ...card, stackId: 'stack-1', stackOrder: 1, x: 400, y: 200 },
            {
                ...secondCard,
                stackId: 'stack-1',
                stackOrder: 2,
                x: 400,
                y: 200,
            },
        ]);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(2));

        // Sibling "card-1" is drawn at (360, 200); drop card-2 right on it.
        expect(
            result.current.getDropIntent('card-2', [stack], {}, 360, 200)
        ).toBeNull();
    });

    it('restores a card and its local links when deletion fails', async () => {
        mockedDelete.mockRejectedValue(new Error('network'));
        const onMutationError = jest.fn();
        const dropLocal = jest.fn();
        const restoreLocal = jest.fn();
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), onMutationError)
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(1));

        await act(async () =>
            result.current.removePostIt('card-1', {
                snapshot: () => [],
                dropLocal,
                restoreLocal,
                restore: jest.fn(),
            })
        );

        expect(result.current.postIts).toEqual([card]);
        expect(dropLocal).toHaveBeenCalledTimes(1);
        expect(restoreLocal).toHaveBeenCalledWith([]);
        expect(onMutationError).toHaveBeenCalledTimes(1);
    });

    it('undoes deletion after duplicating a card', async () => {
        mockedDuplicate.mockResolvedValue(secondCard);
        mockedDelete.mockResolvedValue(undefined);
        mockedRestore.mockResolvedValue(card);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toEqual([card]));

        await act(async () => result.current.clonePostIt('card-1'));
        expect(result.current.postIts).toEqual([card, secondCard]);

        await act(async () => result.current.removePostIt('card-1'));
        expect(result.current.postIts).toEqual([secondCard]);
        expect(result.current.canUndo).toBe(true);

        await act(async () => result.current.undo());

        expect(mockedRestore).toHaveBeenCalledWith(card);
        expect(result.current.postIts).toEqual([secondCard, card]);
    });

    it('undoes and redoes card creation', async () => {
        const created: PostIt = { ...secondCard, x: 48, y: 48 };
        mockedCreate.mockResolvedValue(created);
        mockedDelete.mockResolvedValue(undefined);
        mockedRestore.mockResolvedValue(created);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toEqual([card]));

        await act(async () => result.current.addPostIt());
        expect(result.current.postIts).toEqual([card, created]);
        expect(result.current.canUndo).toBe(true);

        await act(async () => result.current.undo());
        expect(mockedDelete).toHaveBeenCalledWith(created._id);
        expect(result.current.postIts).toEqual([card]);
        expect(result.current.canRedo).toBe(true);

        await act(async () => result.current.redo());
        expect(mockedRestore).toHaveBeenCalledWith(created);
        expect(result.current.postIts).toEqual([card, created]);
    });

    it('undoes and redoes moving a card to another board', async () => {
        mockedUpdate.mockResolvedValue(undefined);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toEqual([card]));

        await act(async () =>
            result.current.movePostItToTab('card-1', 'tab-2')
        );
        expect(result.current.postIts).toEqual([]);
        expect(result.current.canUndo).toBe(true);

        await act(async () => result.current.undo());
        expect(result.current.postIts).toEqual([card]);
        expect(result.current.canRedo).toBe(true);

        await act(async () => result.current.redo());
        expect(result.current.postIts).toEqual([]);
    });

    it('gives a card dropped on a pile a slot no sibling already holds', async () => {
        // Regression: the new order was "member count + 1". Pulling a card out
        // of a stack leaves a gap behind (three cards left holding 2, 3 and 4),
        // so counting handed the newcomer an order another card already had —
        // two cards fighting for the same slot in the fan.
        const stack: PostItStack = {
            _id: 'stack-1',
            userId: 'user-1',
            tabId: 'tab-1',
            x: 400,
            y: 200,
            collapsed: true,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
        };
        mockedFetch.mockResolvedValue([
            { ...card, stackId: 'stack-1', stackOrder: 2, x: 400, y: 200 },
            { ...secondCard, x: 900, y: 700 },
        ]);
        mockedUpdate.mockImplementation(async (id, updates) => ({
            ...card,
            _id: id,
            ...updates,
        }));
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(2));

        // Drop the free card straight onto the folded pile.
        await act(async () =>
            result.current.settlePostIt('card-2', 400, 200, [stack], jest.fn())
        );

        const orders = result.current.postIts
            .filter((item) => item.stackId === 'stack-1')
            .map((item) => item.stackOrder);
        expect(orders).toEqual([2, 3]);
        expect(new Set(orders).size).toBe(orders.length);
    });

    it('dissolves the stack when deleting a card leaves one member behind', async () => {
        // A stack of one is not a pile: it wears a "1" badge and its body eats
        // the first click to fan out a stack with nothing to fan, so the note
        // needs two clicks to edit. Deleting a member has to free the survivor
        // just like unstacking does.
        mockedUpdate.mockResolvedValue(undefined);
        mockedDelete.mockResolvedValue(undefined);
        mockedRestore.mockResolvedValue(card);
        mockedFetch.mockResolvedValue([
            { ...card, stackId: 'stack-1', stackOrder: 1 },
            { ...secondCard, stackId: 'stack-1', stackOrder: 2 },
        ]);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(2));

        await act(async () => result.current.removePostIt('card-2'));

        expect(result.current.postIts).toEqual([
            expect.objectContaining({
                _id: 'card-1',
                stackId: null,
                stackOrder: null,
            }),
        ]);

        // One Ctrl+Z puts back both the card and the pile it belonged to.
        await act(async () => result.current.undo());
        expect(
            result.current.postIts.find((item) => item._id === 'card-1')
        ).toEqual(
            expect.objectContaining({ stackId: 'stack-1', stackOrder: 1 })
        );
    });

    it('dissolves the stack when a member is moved to another board', async () => {
        mockedUpdate.mockResolvedValue(undefined);
        mockedFetch.mockResolvedValue([
            { ...card, stackId: 'stack-1', stackOrder: 1 },
            { ...secondCard, stackId: 'stack-1', stackOrder: 2 },
        ]);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(2));

        await act(async () =>
            result.current.movePostItToTab('card-2', 'tab-2')
        );

        expect(result.current.postIts).toEqual([
            expect.objectContaining({
                _id: 'card-1',
                stackId: null,
                stackOrder: null,
            }),
        ]);
    });

    it('places the copy of a stacked card beside where that card is drawn', async () => {
        // Regression: the copy is created server-side at "source.x + 24", and a
        // stacked card's stored x/y is its stack's origin as of the last time it
        // was stacked. Duplicating a card in a stack that had moved since sent
        // the copy to where the stack used to be, often off-screen.
        const stack: PostItStack = {
            _id: 'stack-1',
            userId: 'user-1',
            tabId: 'tab-1',
            x: 400,
            y: 200,
            collapsed: true,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
        };
        // card.x/y is (12, 24): the phantom the stack left behind.
        mockedFetch.mockResolvedValue([
            { ...card, stackId: 'stack-1', stackOrder: 1 },
        ]);
        mockedDuplicate.mockResolvedValue({
            ...secondCard,
            x: card.x + 24,
            y: card.y + 24,
        });
        mockedUpdate.mockResolvedValue(undefined);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(1));

        await act(async () => result.current.clonePostIt('card-1', [stack]));

        expect(
            result.current.postIts.find((item) => item._id === 'card-2')
        ).toMatchObject({ x: 424, y: 224 });
        expect(mockedUpdate).toHaveBeenCalledWith('card-2', {
            expectedUpdatedAt: secondCard.updatedAt,
            x: 424,
            y: 224,
        });
    });

    it('leaves the copy of a free card exactly where the server put it', async () => {
        const copy: PostIt = { ...secondCard, x: card.x + 24, y: card.y + 24 };
        mockedDuplicate.mockResolvedValue(copy);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toEqual([card]));

        await act(async () => result.current.clonePostIt('card-1'));

        expect(result.current.postIts).toEqual([card, copy]);
        expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it('merges a dropped pile into the target stack, its notes landing on top', async () => {
        // Dragging a folded pile moves the whole stack, so this is the only
        // gesture that can join two piles — without it a pile could only ever
        // be taken apart one card at a time.
        mockedUpdate.mockResolvedValue(undefined);
        const target: PostItStack = {
            _id: 'stack-target',
            userId: 'user-1',
            tabId: 'tab-1',
            x: 400,
            y: 200,
            collapsed: true,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
        };
        const source: PostItStack = { ...target, _id: 'stack-source', x: 900 };
        mockedFetch.mockResolvedValue([
            {
                ...card,
                _id: 'in-target',
                stackId: 'stack-target',
                stackOrder: 3,
            },
            {
                ...card,
                _id: 'moving-a',
                stackId: 'stack-source',
                stackOrder: 1,
            },
            {
                ...card,
                _id: 'moving-b',
                stackId: 'stack-source',
                stackOrder: 2,
            },
        ]);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(3));

        await act(async () =>
            result.current.mergeStackInto(
                'stack-source',
                'in-target',
                [target, source],
                jest.fn()
            )
        );

        const merged = result.current.postIts
            .filter((item) => item.stackId === 'stack-target')
            .map((item) => [item._id, item.stackOrder]);
        // Slots continue past the target's highest (3), and the incoming pile
        // keeps its own order.
        expect(merged).toEqual([
            ['in-target', 3],
            ['moving-a', 4],
            ['moving-b', 5],
        ]);
        expect(
            result.current.postIts.some(
                (item) => item.stackId === 'stack-source'
            )
        ).toBe(false);
    });

    it('creates a stack when a pile is dropped on a free card', async () => {
        mockedUpdate.mockResolvedValue(undefined);
        const source: PostItStack = {
            _id: 'stack-source',
            userId: 'user-1',
            tabId: 'tab-1',
            x: 900,
            y: 200,
            collapsed: true,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
        };
        mockedFetch.mockResolvedValue([
            { ...secondCard, x: 400, y: 200 },
            {
                ...card,
                _id: 'moving-a',
                stackId: 'stack-source',
                stackOrder: 1,
            },
        ]);
        const created: PostItStack = { ...source, _id: 'stack-new', x: 400 };
        const createStackAt = jest.fn().mockResolvedValue(created);
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toHaveLength(2));

        await act(async () =>
            result.current.mergeStackInto(
                'stack-source',
                'card-2',
                [source],
                createStackAt
            )
        );

        expect(createStackAt).toHaveBeenCalledWith(400, 200);
        expect(
            result.current.postIts.map((item) => [item._id, item.stackOrder])
        ).toEqual([
            ['card-2', 1],
            ['moving-a', 2],
        ]);
    });

    it('does not retry a failed initial load on every render', async () => {
        mockedFetch.mockRejectedValue(new Error('offline'));
        const onLoadError = jest.fn();
        const { result } = renderHook(() =>
            usePostIts('tab-1', onLoadError, jest.fn())
        );

        await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(result.current.isLoadingPostIts).toBe(false);
    });
});
