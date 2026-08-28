/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createPostIt, fetchPostIts } from '../services/boardApi';
import { trackProductEvent } from '../services/analytics';
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

jest.mock('../services/analytics', () => ({
    trackProductEvent: jest.fn(),
}));

const onboardingCard: PostIt = {
    _id: 'welcome-card',
    userId: 'user-1',
    tabId: 'tab-1',
    title: 'Bienvenue',
    content: '',
    color: '#facc15',
    x: 0,
    y: 0,
    width: 220,
    height: 160,
    zIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('usePostIts activation analytics', () => {
    const mockedFetch = fetchPostIts as jest.MockedFunction<
        typeof fetchPostIts
    >;
    const mockedCreate = createPostIt as jest.MockedFunction<
        typeof createPostIt
    >;
    const mockedTrack = trackProductEvent as jest.MockedFunction<
        typeof trackProductEvent
    >;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedFetch.mockResolvedValue([onboardingCard]);
        mockedCreate.mockResolvedValue({
            ...onboardingCard,
            _id: 'user-card',
            title: 'Ma carte',
            zIndex: 2,
        });
    });

    it('tracks an intentional card even when onboarding cards already exist', async () => {
        const { result } = renderHook(() => usePostIts('tab-1'));
        await waitFor(() => expect(result.current.postIts).toHaveLength(1));

        expect(mockedTrack).not.toHaveBeenCalled();
        await act(async () => result.current.addPostIt({ title: 'Ma carte' }));

        expect(mockedTrack).toHaveBeenCalledTimes(1);
        expect(mockedTrack).toHaveBeenCalledWith('card_created');
    });
});
