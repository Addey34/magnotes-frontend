/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import {
    createTab,
    deleteTab,
    fetchTabs,
    updateTab,
} from '../services/boardApi';
import { trackProductEvent } from '../services/analytics';
import { BoardTab } from '../types/boardTypes';
import { useTabs } from './useTabs';

jest.mock('../services/boardApi', () => ({
    createTab: jest.fn(),
    deleteTab: jest.fn(),
    fetchTabs: jest.fn(),
    reorderTabs: jest.fn(),
    updateTab: jest.fn(),
}));

jest.mock('../services/analytics', () => ({
    trackProductEvent: jest.fn(),
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

const tab2: BoardTab = {
    ...tab,
    _id: 'tab-2',
    name: 'Page 2',
    order: 2,
};

const tab3: BoardTab = {
    ...tab,
    _id: 'tab-3',
    name: 'Page 3',
    order: 3,
};

describe('useTabs loading state', () => {
    const mockedFetch = fetchTabs as jest.MockedFunction<typeof fetchTabs>;
    const mockedCreate = createTab as jest.MockedFunction<typeof createTab>;
    const mockedDelete = deleteTab as jest.MockedFunction<typeof deleteTab>;
    const mockedUpdate = updateTab as jest.MockedFunction<typeof updateTab>;
    const mockedTrack = trackProductEvent as jest.MockedFunction<
        typeof trackProductEvent
    >;

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

    it('tracks a board created explicitly by the user', async () => {
        mockedFetch.mockResolvedValue([]);
        mockedCreate.mockResolvedValue(tab);
        const { result } = renderHook(() => useTabs());
        await waitFor(() => expect(result.current.hasLoadedTabs).toBe(true));

        await act(async () => result.current.addTab());

        expect(mockedTrack).toHaveBeenCalledWith('board_created');
    });

    it('does not track the automatic onboarding board as a conversion', async () => {
        mockedFetch.mockResolvedValue([]);
        mockedCreate.mockResolvedValue(tab);
        const { result } = renderHook(() => useTabs());
        await waitFor(() => expect(result.current.hasLoadedTabs).toBe(true));

        await act(async () =>
            result.current.addTab(undefined, { trackCreation: false })
        );

        expect(mockedTrack).not.toHaveBeenCalled();
    });

    it('reverts only the customization fields rejected by the API', async () => {
        mockedFetch.mockResolvedValue([{ ...tab, icon: '🚀' }]);
        mockedUpdate.mockRejectedValue(new Error('network failure'));
        const onLoadError = jest.fn();
        const onMutationError = jest.fn();
        const { result } = renderHook(() =>
            useTabs(onLoadError, onMutationError)
        );
        await waitFor(() => expect(result.current.tabs).toHaveLength(1));

        await act(async () => {
            await result.current.customizeTab('tab-1', {
                color: '#000000',
            });
        });

        expect(result.current.tabs[0]).toMatchObject({
            color: tab.color,
            icon: '🚀',
        });
        expect(onMutationError).toHaveBeenCalledTimes(1);
    });

    it('keeps a newer rename when an older rename fails out of order', async () => {
        mockedFetch.mockResolvedValue([tab]);
        mockedUpdate
            .mockImplementationOnce(async () => {
                await Promise.resolve();
                throw new Error('late network failure');
            })
            .mockResolvedValueOnce(undefined);
        const { result } = renderHook(() => useTabs());
        await waitFor(() => expect(result.current.tabs).toHaveLength(1));

        await act(async () => {
            const olderRequest = result.current.renameTab('tab-1', 'Older');
            const newerRequest = result.current.renameTab('tab-1', 'Newest');
            await Promise.all([olderRequest, newerRequest]);
        });

        expect(result.current.tabs[0].name).toBe('Newest');
    });

    it('restores a failed deletion without dropping a board created meanwhile', async () => {
        mockedFetch.mockResolvedValue([tab, tab2]);
        mockedCreate.mockResolvedValue(tab3);
        let rejectDelete!: (reason: Error) => void;
        mockedDelete.mockReturnValue(
            new Promise((_, reject) => {
                rejectDelete = reject;
            })
        );
        const { result } = renderHook(() => useTabs());
        await waitFor(() => expect(result.current.tabs).toHaveLength(2));

        let deletion!: Promise<boolean>;
        await act(async () => {
            deletion = result.current.removeTab('tab-1');
            await result.current.addTab();
            rejectDelete(new Error('late network failure'));
            await deletion;
        });

        expect(result.current.tabs.map(({ _id }) => _id)).toEqual([
            'tab-1',
            'tab-2',
            'tab-3',
        ]);
        expect(result.current.activeTabId).toBe('tab-3');
    });
});
