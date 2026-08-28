/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import {
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
