/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { fetchTabs } from '../services/boardApi';
import { BoardTab } from '../types/boardTypes';
import { useTabs } from './useTabs';

jest.mock('../services/boardApi', () => ({
    deleteTab: jest.fn(),
    fetchTabs: jest.fn(),
    reorderTabs: jest.fn(),
    updateTab: jest.fn(),
}));

const tab: BoardTab = {
    _id: 'tab-1',
    userId: 'user-1',
    name: 'Page 1',
    color: '#facc15',
    icon: '📝',
    order: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useTabs loading state', () => {
    const mockedFetch = fetchTabs as jest.MockedFunction<typeof fetchTabs>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not expose an empty loaded state before the first response', async () => {
        let resolveFetch!: (tabs: BoardTab[]) => void;
        mockedFetch.mockReturnValue(
            new Promise((resolve) => {
                resolveFetch = resolve;
            })
        );

        const { result } = renderHook(() => useTabs());

        expect(result.current.isLoadingTabs).toBe(true);
        expect(result.current.hasLoadedTabs).toBe(false);
        expect(result.current.tabs).toEqual([]);

        await act(async () => resolveFetch([tab]));
        await waitFor(() => expect(result.current.hasLoadedTabs).toBe(true));

        expect(result.current.isLoadingTabs).toBe(false);
        expect(result.current.tabs).toEqual([{ ...tab, icon: '📝' }]);
    });

    it('marks an empty account as loaded only after the response succeeds', async () => {
        mockedFetch.mockResolvedValue([]);
        const { result } = renderHook(() => useTabs());

        await waitFor(() => expect(result.current.hasLoadedTabs).toBe(true));

        expect(result.current.isLoadingTabs).toBe(false);
        expect(result.current.tabs).toEqual([]);
        expect(result.current.activeTabId).toBeNull();
    });

    it('keeps the loaded flag false when the initial fetch fails', async () => {
        mockedFetch.mockRejectedValue(new Error('offline'));
        const onLoadError = jest.fn();
        const { result } = renderHook(() => useTabs(onLoadError, jest.fn()));

        await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));

        expect(result.current.isLoadingTabs).toBe(false);
        expect(result.current.hasLoadedTabs).toBe(false);
    });
});
