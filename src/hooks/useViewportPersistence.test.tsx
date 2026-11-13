/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { BoardTab } from '../types/boardTypes';
import { useViewportPersistence } from './useViewportPersistence';

jest.mock('../services/boardApi', () => ({
    updateTab: jest.fn().mockResolvedValue(undefined),
}));

const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
const tab = { _id: 'tab-1', name: 'Board' } as unknown as BoardTab;

const setup = (contentBounds: typeof bounds | null) => {
    const openBounds = jest.fn();
    const setViewport = jest.fn();
    const hook = renderHook(
        (props: { contentBounds: typeof bounds | null }) =>
            useViewportPersistence({
                activeTabId: 'tab-1',
                tabs: [tab],
                zoom: 1,
                offset: { x: 0, y: 0 },
                isLoading: false,
                contentBounds: props.contentBounds,
                setViewport,
                openBounds,
            }),
        { initialProps: { contentBounds } }
    );
    return { openBounds, hook };
};

describe('useViewportPersistence opening frame', () => {
    beforeEach(() => {
        window.localStorage.clear();
        jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    it('frames the content once it is measured', () => {
        const { openBounds } = setup(bounds);
        act(() => {
            jest.runOnlyPendingTimers();
        });
        expect(openBounds).toHaveBeenCalledTimes(1);
        expect(openBounds).toHaveBeenCalledWith(bounds);
    });

    it('does not reset the view while cards are still being measured', () => {
        const { openBounds, hook } = setup(null);
        act(() => {
            jest.advanceTimersByTime(300);
        });
        expect(openBounds).not.toHaveBeenCalled();

        // The cards arrive inside the grace period: frame them, never reset.
        hook.rerender({ contentBounds: bounds });
        act(() => {
            jest.runOnlyPendingTimers();
        });
        expect(openBounds).toHaveBeenCalledTimes(1);
        expect(openBounds).toHaveBeenCalledWith(bounds);
    });

    it('treats a board still empty after the grace period as empty', () => {
        const { openBounds } = setup(null);
        act(() => {
            jest.advanceTimersByTime(700);
        });
        expect(openBounds).toHaveBeenCalledTimes(1);
        expect(openBounds).toHaveBeenCalledWith(null);
    });
});
