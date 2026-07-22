/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { useNotifications } from './useNotifications';

describe('useNotifications', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('deduplicates notifications sharing the same key', () => {
        const { result } = renderHook(() => useNotifications());

        act(() => {
            result.current.notify('First', { key: 'load', kind: 'error' });
            result.current.notify('Second', { key: 'load', kind: 'error' });
        });

        expect(result.current.notifications).toHaveLength(1);
        expect(result.current.notifications[0].message).toBe('First');
    });

    it('dismisses temporary notifications automatically', () => {
        const { result } = renderHook(() => useNotifications());

        act(() => {
            result.current.notify('Saved', { duration: 1000 });
        });
        expect(result.current.notifications).toHaveLength(1);

        act(() => jest.advanceTimersByTime(1000));
        expect(result.current.notifications).toHaveLength(0);
    });

    it('supports manual dismissal', () => {
        const { result } = renderHook(() => useNotifications());

        act(() => {
            result.current.notify('Persistent', { duration: 0 });
        });
        const id = result.current.notifications[0].id;
        act(() => result.current.dismiss(id));

        expect(result.current.notifications).toHaveLength(0);
    });
});
