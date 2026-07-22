/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { deletePostIt, fetchPostIts, updatePostIt } from '../services/boardApi';
import { PostIt } from '../types/boardTypes';
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
});
