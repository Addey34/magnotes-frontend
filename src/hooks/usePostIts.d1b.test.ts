/** @jest-environment jsdom */

// MGN-DATA-01-LOT-D1B — a restore stands on the proof of the deletion it undoes:
// the proof of the DELETE actually transmitted, renewed by every legitimate
// DELETE, never invented and never borrowed from another deletion.

import { act, renderHook, waitFor } from '@testing-library/react';
import {
    deletePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../services/boardApi';
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
    content: 'text',
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

describe('D1B — restore stands on the proof of its own deletion', () => {
    const mockedFetch = fetchPostIts as jest.MockedFunction<
        typeof fetchPostIts
    >;
    const mockedDelete = deletePostIt as jest.MockedFunction<
        typeof deletePostIt
    >;
    const mockedRestore = restorePostIt as jest.MockedFunction<
        typeof restorePostIt
    >;
    const mockedUpdate = updatePostIt as jest.MockedFunction<
        typeof updatePostIt
    >;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedFetch.mockResolvedValue([card]);
        mockedUpdate.mockResolvedValue(undefined);
    });

    it('undo restores with the proof of the DELETE it undoes; redo + undo again uses the NEW deletion proof', async () => {
        mockedDelete
            .mockResolvedValueOnce({ etag: 'E1', mutationId: 'DEL-ONE' })
            .mockResolvedValueOnce({ etag: 'R2', mutationId: 'DEL-TWO' });
        mockedRestore.mockResolvedValueOnce({ ...card, etag: 'R2' });
        mockedRestore.mockResolvedValueOnce({ ...card, etag: 'R3' });
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toEqual([card]));

        await act(async () => result.current.removePostIt('card-1'));
        await act(async () => result.current.undo());
        expect(mockedRestore).toHaveBeenNthCalledWith(1, card, {
            etag: 'E1',
            mutationId: 'DEL-ONE',
        });

        await act(async () => result.current.redo());
        await act(async () => result.current.undo());
        expect(mockedRestore).toHaveBeenNthCalledWith(2, card, {
            etag: 'R2',
            mutationId: 'DEL-TWO',
        });
    });

    it('without any proof (unproven server) the historical restore call is kept', async () => {
        mockedDelete.mockResolvedValue(undefined);
        mockedRestore.mockResolvedValue({ ...card, etag: 'R2' });
        const { result } = renderHook(() =>
            usePostIts('tab-1', jest.fn(), jest.fn())
        );
        await waitFor(() => expect(result.current.postIts).toEqual([card]));
        await act(async () => result.current.removePostIt('card-1'));
        await act(async () => result.current.undo());
        expect(mockedRestore).toHaveBeenCalledWith(card);
    });
});
