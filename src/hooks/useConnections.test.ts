/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import {
    deleteConnection,
    fetchConnections,
    updateConnection,
} from '../services/boardApi';
import { CardLink } from '../types/boardTypes';
import { useConnections } from './useConnections';

jest.mock('../services/boardApi', () => ({
    createConnection: jest.fn(),
    deleteConnection: jest.fn(),
    fetchConnections: jest.fn(),
    updateConnection: jest.fn(),
}));

const link: CardLink = {
    _id: 'link-1',
    userId: 'user-1',
    tabId: 'tab-1',
    sourceId: 'card-1',
    targetId: 'card-2',
    label: 'Before',
    kind: 'arrow',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useConnections rollbacks', () => {
    const mockedFetch = fetchConnections as jest.MockedFunction<
        typeof fetchConnections
    >;
    const mockedUpdate = updateConnection as jest.MockedFunction<
        typeof updateConnection
    >;
    const mockedDelete = deleteConnection as jest.MockedFunction<
        typeof deleteConnection
    >;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedFetch.mockResolvedValue([link]);
    });

    it('restores a label when its API update fails', async () => {
        mockedUpdate.mockRejectedValue(new Error('network'));
        const onMutationError = jest.fn();
        const { result } = renderHook(() =>
            useConnections('tab-1', jest.fn(), onMutationError)
        );
        await waitFor(() => expect(result.current.links).toHaveLength(1));

        await act(async () => result.current.relabelLink('link-1', 'After'));

        expect(result.current.links[0].label).toBe('Before');
        expect(onMutationError).toHaveBeenCalledTimes(1);
    });

    it('re-inserts a removed link when deletion fails', async () => {
        mockedDelete.mockRejectedValue(new Error('network'));
        const onMutationError = jest.fn();
        const { result } = renderHook(() =>
            useConnections('tab-1', jest.fn(), onMutationError)
        );
        await waitFor(() => expect(result.current.links).toHaveLength(1));

        await act(async () => result.current.removeLink('link-1'));

        expect(result.current.links).toEqual([link]);
        expect(onMutationError).toHaveBeenCalledTimes(1);
    });

    it('does not retry a failed initial load on every render', async () => {
        mockedFetch.mockRejectedValue(new Error('offline'));
        const onLoadError = jest.fn();
        const { result } = renderHook(() =>
            useConnections('tab-1', onLoadError, jest.fn())
        );

        await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(result.current.isLoadingConnections).toBe(false);
    });
});
