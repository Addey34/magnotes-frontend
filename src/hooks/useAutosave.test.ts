/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

describe('useAutosave', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('merges debounced updates for the same card', async () => {
        const save = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useAutosave(save, 500));

        act(() => {
            result.current.scheduleSave('card-1', { title: 'Title' });
            result.current.scheduleSave('card-1', { content: 'Body' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => Promise.resolve());

        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith('card-1', {
            title: 'Title',
            content: 'Body',
        });
    });

    it('keeps pending saves independent between cards', async () => {
        const save = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useAutosave(save, 500));

        act(() => {
            result.current.scheduleSave('card-1', { title: 'One' });
            result.current.scheduleSave('card-2', { title: 'Two' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => Promise.resolve());

        expect(save).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenCalledWith('card-1', { title: 'One' });
        expect(save).toHaveBeenCalledWith('card-2', { title: 'Two' });
    });

    it('flushes pending updates when the owner unmounts', async () => {
        const save = jest.fn().mockResolvedValue(undefined);
        const { result, unmount } = renderHook(() => useAutosave(save, 500));

        act(() => {
            result.current.scheduleSave('card-1', { title: 'Unsaved' });
        });
        unmount();
        await act(async () => Promise.resolve());

        expect(save).toHaveBeenCalledWith('card-1', { title: 'Unsaved' });
    });

    it('exposes an explicit flush for navigation boundaries', async () => {
        const save = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useAutosave(save, 500));

        act(() => {
            result.current.scheduleSave('card-1', { title: 'Now' });
        });
        await act(async () => result.current.flushPending());

        expect(save).toHaveBeenCalledWith('card-1', { title: 'Now' });
        expect(result.current.saveState).toEqual({
            status: 'saved',
            postItId: 'card-1',
        });
    });

    it('reports a failed save to its error handler', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const save = jest.fn().mockRejectedValue(new Error('offline'));
        const onError = jest.fn();
        const { result } = renderHook(() => useAutosave(save, 500, onError));

        act(() => {
            result.current.scheduleSave('card-1', { title: 'Retry me' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => Promise.resolve());

        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.saveState.status).toBe('error');
    });

    it('retries failed updates when the browser comes back online', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const save = jest
            .fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(undefined);
        const { result } = renderHook(() => useAutosave(save, 500));

        act(() => {
            result.current.scheduleSave('card-1', { title: 'Keep me' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => Promise.resolve());
        expect(result.current.saveState.status).toBe('error');

        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await Promise.resolve();
        });

        expect(save).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenLastCalledWith('card-1', {
            title: 'Keep me',
        });
        expect(result.current.saveState.status).toBe('saved');
    });

    it('does not retry a failed save merely because callbacks change', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const save = jest.fn().mockRejectedValue(new Error('rate limited'));
        type HookProps = { onError: (error: unknown) => void };
        const { result, rerender } = renderHook(
            ({ onError }: HookProps) => useAutosave(save, 500, onError),
            {
                initialProps: {
                    onError: jest.fn<void, [unknown]>(),
                },
            }
        );

        act(() => {
            result.current.scheduleSave('card-1', { title: 'Keep me' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => Promise.resolve());
        expect(save).toHaveBeenCalledTimes(1);

        rerender({ onError: jest.fn<void, [unknown]>() });
        await act(async () => Promise.resolve());

        expect(save).toHaveBeenCalledTimes(1);
        expect(result.current.saveState.status).toBe('error');
    });
});
