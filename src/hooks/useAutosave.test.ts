/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

describe('useAutosave', () => {
    it('keeps newer queued writes stale until they are acknowledged', async () => {
        let resolveFirst: (value: unknown) => void = () => {};
        const save = jest
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValue({ content: 'new' });
        const onSaved = jest.fn();
        const { result } = renderHook(() =>
            useAutosave(save, 500, undefined, onSaved)
        );
        await act(async () => {
            result.current.scheduleSave('card', { content: 'old' });
            jest.advanceTimersByTime(500);
            await Promise.resolve();
        });
        act(() => {
            result.current.scheduleSave('card', { content: 'new' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => {
            resolveFirst({ content: 'old' });
            await result.current.flushPending();
        });
        expect(onSaved.mock.calls[0][2]).toContain('content');
        expect(save).toHaveBeenLastCalledWith('card', { content: 'new' });
        expect(result.current.saveState.status).toBe('saved');
    });
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

    it('flags the fields edited while a save was in flight as stale', async () => {
        // Regression: the caller applies the server's echo of the saved card to
        // local state. The echo reflects the card as it was *sent*, so applying
        // `content` after the user kept typing rewound the textarea and ate the
        // characters typed since — "it drops letters when I type fast".
        let resolveSave: (value: unknown) => void = () => {};
        const save = jest
            .fn()
            .mockImplementationOnce(
                () => new Promise((resolve) => (resolveSave = resolve))
            )
            // The follow-up write the unmount flush drains; it must not reject
            // and spam the console with a bogus autosave failure.
            .mockResolvedValue({ content: 'Bonjour' });
        const onSaved = jest.fn<void, [string, unknown, string[]]>();
        const { result } = renderHook(() =>
            useAutosave(save, 500, undefined, onSaved)
        );

        await act(async () => {
            result.current.scheduleSave('card-1', { content: 'Bonj' });
            jest.advanceTimersByTime(500);
            // Let the serialising promise chain reach the actual save call.
            await Promise.resolve();
        });
        expect(save).toHaveBeenCalledTimes(1);

        // The request is in flight; the user keeps typing.
        act(() => {
            result.current.scheduleSave('card-1', { content: 'Bonjour' });
        });

        await act(async () => {
            resolveSave({ content: 'Bonj' });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(onSaved.mock.calls[0][2]).toContain('content');
    });

    it('reports no stale fields when nothing was typed during the save', async () => {
        const save = jest.fn().mockResolvedValue({ content: 'Bonjour' });
        const onSaved = jest.fn<void, [string, unknown, string[]]>();
        const { result } = renderHook(() =>
            useAutosave(save, 500, undefined, onSaved)
        );

        act(() => {
            result.current.scheduleSave('card-1', { content: 'Bonjour' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => Promise.resolve());

        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(onSaved.mock.calls[0][2]).toEqual([]);
    });

    describe('a failed write overtaken by a newer one', () => {
        const setup = () => {
            let rejectA: (e: unknown) => void = () => {};
            const save = jest
                .fn()
                .mockImplementationOnce(
                    () =>
                        new Promise((_, reject) => {
                            rejectA = reject;
                        })
                )
                .mockResolvedValue(undefined);
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const hook = renderHook(() => useAutosave(save, 500));
            return { save, hook, rejectA: (e: unknown) => rejectA(e) };
        };

        it('never replays the older value after the newer one was saved', async () => {
            const { save, hook, rejectA } = setup();
            await act(async () => {
                hook.result.current.scheduleSave('c', { title: 'A' });
                jest.advanceTimersByTime(500);
            });
            // B is queued while A is still in flight.
            await act(async () => {
                hook.result.current.scheduleSave('c', { title: 'B' });
                jest.advanceTimersByTime(500);
            });
            await act(async () => {
                rejectA(new Error('boom'));
                await Promise.resolve();
            });
            await act(async () => {
                await hook.result.current.flushPending();
            });
            expect(save.mock.calls.map((c) => c[1])).toEqual([
                { title: 'A' },
                { title: 'B' },
            ]);
            // Retry trigger (e.g. the browser comes back online).
            await act(async () => {
                window.dispatchEvent(new Event('online'));
                await hook.result.current.flushPending();
            });
            expect(save).toHaveBeenCalledTimes(2);
        });

        it('keeps independent fields of the failed write for the retry', async () => {
            const { save, hook, rejectA } = setup();
            await act(async () => {
                hook.result.current.scheduleSave('c', {
                    title: 'A',
                    content: 'text',
                });
                jest.advanceTimersByTime(500);
            });
            await act(async () => {
                hook.result.current.scheduleSave('c', { title: 'B' });
                jest.advanceTimersByTime(500);
            });
            await act(async () => {
                rejectA(new Error('boom'));
                await Promise.resolve();
            });
            await act(async () => {
                await hook.result.current.flushPending();
            });
            await act(async () => {
                await hook.result.current.flushPending();
            });
            expect(save).toHaveBeenLastCalledWith('c', { content: 'text' });
        });

        it('lets the newest value win when both writes fail', async () => {
            let rejectA: (e: unknown) => void = () => {};
            let rejectB: (e: unknown) => void = () => {};
            const save = jest
                .fn()
                .mockImplementationOnce(
                    () => new Promise((_, r) => (rejectA = r))
                )
                .mockImplementationOnce(
                    () => new Promise((_, r) => (rejectB = r))
                )
                .mockResolvedValue(undefined);
            jest.spyOn(console, 'error').mockImplementation(() => {});
            const { result } = renderHook(() => useAutosave(save, 500));
            await act(async () => {
                result.current.scheduleSave('c', { title: 'A' });
                jest.advanceTimersByTime(500);
            });
            await act(async () => {
                result.current.scheduleSave('c', { title: 'B' });
                jest.advanceTimersByTime(500);
            });
            await act(async () => {
                rejectA(new Error('a'));
                await Promise.resolve();
                await Promise.resolve();
            });
            await act(async () => {
                rejectB(new Error('b'));
                await Promise.resolve();
                await Promise.resolve();
            });
            await act(async () => {
                await result.current.flushPending();
            });
            expect(save).toHaveBeenLastCalledWith('c', { title: 'B' });
        });
    });

    describe('leaving the page with unsynced edits', () => {
        const leave = () => {
            const event = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        };
        const setOnline = (value: boolean) =>
            jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);

        it('never interrupts a normal reload when everything is saved', async () => {
            setOnline(true);
            const save = jest.fn().mockResolvedValue(undefined);
            const { result } = renderHook(() => useAutosave(save, 500));
            expect(leave()).toBe(false);

            act(() => {
                result.current.scheduleSave('card', { title: 'a' });
                jest.advanceTimersByTime(500);
            });
            await act(async () => Promise.resolve());
            expect(leave()).toBe(false);
        });

        it('asks for confirmation once a save has failed, and stops when it is retried', async () => {
            setOnline(true);
            const save = jest
                .fn()
                .mockRejectedValueOnce(new Error('Network Error'))
                .mockResolvedValue(undefined);
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const { result } = renderHook(() => useAutosave(save, 500));

            act(() => {
                result.current.scheduleSave('card', { title: 'a' });
                jest.advanceTimersByTime(500);
            });
            await act(async () => Promise.resolve());
            expect(leave()).toBe(true);

            await act(async () => {
                window.dispatchEvent(new Event('online'));
                await Promise.resolve();
            });
            await act(async () => Promise.resolve());
            expect(save).toHaveBeenCalledTimes(2);
            expect(leave()).toBe(false);
        });

        it('asks for confirmation while offline with an edit still waiting', () => {
            setOnline(false);
            const save = jest.fn().mockResolvedValue(undefined);
            const { result } = renderHook(() => useAutosave(save, 500));
            expect(leave()).toBe(false);

            act(() => result.current.scheduleSave('card', { title: 'a' }));
            expect(leave()).toBe(true);
        });

        it('removes its listener with the owner', () => {
            setOnline(false);
            const save = jest.fn().mockResolvedValue(undefined);
            const { result, unmount } = renderHook(() =>
                useAutosave(save, 500)
            );
            act(() => result.current.scheduleSave('card', { title: 'a' }));
            unmount();
            expect(leave()).toBe(false);
        });
    });
});
