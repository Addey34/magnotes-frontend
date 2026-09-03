/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { deleteStack, fetchStacks, updateStack } from '../services/boardApi';
import { PostItStack } from '../types/boardTypes';
import { snapToGrid } from './useDragGrid';
import { useStacks } from './useStacks';

jest.mock('../services/boardApi', () => ({
    createStack: jest.fn(),
    deleteStack: jest.fn(),
    fetchStacks: jest.fn(),
    updateStack: jest.fn(),
}));

const stack: PostItStack = {
    _id: 'stack-1',
    userId: 'user-1',
    tabId: 'tab-1',
    x: 24,
    y: 48,
    collapsed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useStacks rollbacks', () => {
    const mockedFetch = fetchStacks as jest.MockedFunction<typeof fetchStacks>;
    const mockedUpdate = updateStack as jest.MockedFunction<typeof updateStack>;
    const mockedDelete = deleteStack as jest.MockedFunction<typeof deleteStack>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedFetch.mockResolvedValue([stack]);
    });

    it('restores the collapsed state when an update fails', async () => {
        mockedUpdate.mockRejectedValue(new Error('network'));
        const onMutationError = jest.fn();
        const { result } = renderHook(() =>
            useStacks('tab-1', jest.fn(), onMutationError)
        );
        await waitFor(() => expect(result.current.stacks).toHaveLength(1));

        await act(async () => result.current.toggleStack('stack-1', true));

        expect(result.current.stacks[0].collapsed).toBe(false);
        expect(onMutationError).toHaveBeenCalledTimes(1);
    });

    it('snaps a moved stack and restores its position when saving fails', async () => {
        mockedUpdate.mockRejectedValue(new Error('network'));
        const onMutationError = jest.fn();
        const { result } = renderHook(() =>
            useStacks('tab-1', jest.fn(), onMutationError)
        );
        await waitFor(() => expect(result.current.stacks).toHaveLength(1));

        await act(async () => result.current.settleStack('stack-1', 37, 53));

        expect(mockedUpdate).toHaveBeenCalledWith('stack-1', {
            x: snapToGrid(37),
            y: snapToGrid(53),
        });
        expect(result.current.stacks[0]).toMatchObject({ x: 24, y: 48 });
        expect(onMutationError).toHaveBeenCalledTimes(1);
    });

    it('re-inserts a removed stack when deletion fails', async () => {
        mockedDelete.mockRejectedValue(new Error('network'));
        const onMutationError = jest.fn();
        const { result } = renderHook(() =>
            useStacks('tab-1', jest.fn(), onMutationError)
        );
        await waitFor(() => expect(result.current.stacks).toHaveLength(1));

        await act(async () => result.current.removeStack('stack-1'));

        expect(result.current.stacks).toEqual([stack]);
        expect(onMutationError).toHaveBeenCalledTimes(1);
    });

    it('does not retry a failed initial load on every render', async () => {
        mockedFetch.mockRejectedValue(new Error('offline'));
        const onLoadError = jest.fn();
        const { result } = renderHook(() =>
            useStacks('tab-1', onLoadError, jest.fn())
        );

        await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(result.current.isLoadingStacks).toBe(false);
    });
});
