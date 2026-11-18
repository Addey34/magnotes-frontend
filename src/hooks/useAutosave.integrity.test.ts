/** @jest-environment jsdom */

// MGN-DATA-01C — targeted integrity tests for the autosave engine: version
// propagation, failed-write merging, global status and deletion control.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

type Update = {
    content?: string;
    title?: string;
    status?: string;
    etag?: string;
};
type Saved = { etag: string };

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
};
const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};
const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};
const conflict = () =>
    Object.assign(new Error('conflict'), { response: { status: 412 } });

const render = (
    save: jest.Mock<Promise<Saved>, [string, Update]>,
    onSaved?: jest.Mock,
    onError?: jest.Mock
) => renderHook(() => useAutosave<Update, Saved>(save, 500, onError, onSaved));

describe('useAutosave — MGN-DATA-01C integrity', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('follows the version chain across three successive writes on one card', async () => {
        const gates = [deferred<Saved>(), deferred<Saved>(), deferred<Saved>()];
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => gates[0].promise)
            .mockImplementationOnce(() => gates[1].promise)
            .mockImplementationOnce(() => gates[2].promise);
        const { result } = render(save);

        // Three writes are scheduled while the card still shows v1.
        for (const text of ['a', 'ab', 'abc']) {
            await act(async () => {
                result.current.scheduleSave('c', {
                    content: text,
                    etag: 'v1',
                });
                jest.advanceTimersByTime(500);
                await settle();
            });
        }
        expect(save).toHaveBeenCalledTimes(1);
        await act(async () => {
            gates[0].resolve({ etag: 'v2' });
            await settle();
        });
        await act(async () => {
            gates[1].resolve({ etag: 'v3' });
            await settle();
        });
        await act(async () => {
            gates[2].resolve({ etag: 'v4' });
            await settle();
        });

        expect(save.mock.calls.map((c) => c[1].etag)).toEqual([
            'v1',
            'v2',
            'v3',
        ]);
        expect(result.current.saveState.status).toBe('saved');
    });

    it('never adopts a version it did not produce (external change is left to the server)', async () => {
        const a = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a.promise)
            .mockResolvedValue({ etag: 'v9' });
        const { result } = render(save);
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'a',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        act(() => {
            // Scheduled from a card the user reloaded at an unrelated version.
            result.current.scheduleSave('c', {
                content: 'ab',
                etag: 'vExternal',
            });
            jest.advanceTimersByTime(500);
        });
        await act(async () => {
            a.resolve({ etag: 'v2' });
            await settle();
        });
        expect(save.mock.calls[1][1].etag).toBe('vExternal');
    });

    it('keeps version chains of different cards strictly apart', async () => {
        const a1 = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a1.promise)
            .mockResolvedValue({ etag: 'x' });
        const { result } = render(save);
        await act(async () => {
            result.current.scheduleSave('A', {
                content: '1',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        await act(async () => {
            a1.resolve({ etag: 'v2' });
            await settle();
        });
        // Card B happens to be based on the same string: it must not be advanced.
        await act(async () => {
            result.current.scheduleSave('B', {
                content: '2',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        expect(save.mock.calls[1]).toEqual(['B', { content: '2', etag: 'v1' }]);
    });

    it('keeps a saved card and a failed card apart in the global status', async () => {
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementation(async (id) => {
                if (id === 'bad') throw new Error('network');
                return { etag: 'v2' };
            });
        const { result } = render(save);
        await act(async () => {
            result.current.scheduleSave('good', { content: 'ok' });
            result.current.scheduleSave('bad', { content: 'ko' });
            jest.advanceTimersByTime(500);
            await settle();
        });
        expect(result.current.saveState.status).toBe('error');
        expect(result.current.saveState.postItId).toBe('bad');

        save.mockResolvedValue({ etag: 'v3' });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await settle();
        });
        expect(result.current.saveState.status).toBe('saved');
    });

    it('is never "saved" while a second card is still in flight', async () => {
        const slow = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementation((id) =>
                id === 'slow' ? slow.promise : Promise.resolve({ etag: 'v2' })
            );
        const { result } = render(save);
        await act(async () => {
            result.current.scheduleSave('fast', { content: 'f' });
            result.current.scheduleSave('slow', { content: 's' });
            jest.advanceTimersByTime(500);
            await settle();
        });
        expect(result.current.saveState.status).toBe('saving');
        await act(async () => {
            slow.resolve({ etag: 'v3' });
            await settle();
        });
        expect(result.current.saveState.status).toBe('saved');
    });

    it('retries a failed first edit together with a different later one (both fields kept)', async () => {
        const a = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a.promise)
            .mockResolvedValue({ etag: 'v2' });
        const { result } = render(save);
        await act(async () => {
            result.current.scheduleSave('c', {
                title: 'T',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        await act(async () => {
            a.reject(new Error('network'));
            await settle();
        });
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'C',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        expect(save.mock.calls[1][1]).toEqual({
            title: 'T',
            content: 'C',
            etag: 'v1',
        });
    });

    it('lets the newer value of the same field win when both writes fail', async () => {
        const a = deferred<Saved>();
        const b = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a.promise)
            .mockImplementationOnce(() => b.promise)
            .mockResolvedValue({ etag: 'v2' });
        const { result } = render(save);
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a' });
            jest.advanceTimersByTime(500);
            await settle();
        });
        act(() => {
            result.current.scheduleSave('c', { content: 'ab' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => {
            a.reject(new Error('network'));
            await settle();
        });
        await act(async () => {
            b.reject(new Error('network'));
            await settle();
        });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await settle();
        });
        const retried = save.mock.calls.slice(2).map((c) => c[1].content);
        expect(retried).toEqual(['ab']);
    });

    it('does not replay a conflicted write and keeps the status in error', async () => {
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockRejectedValue(conflict());
        const { result } = render(save);
        await act(async () => {
            result.current.scheduleSave('c', {
                status: 'done',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await settle();
        });
        for (let i = 0; i < 3; i++) {
            await act(async () => {
                window.dispatchEvent(new Event('online'));
                await settle();
            });
        }
        expect(save).toHaveBeenCalledTimes(1);
        expect(result.current.saveState.status).toBe('error');
    });

    describe('card deletion control', () => {
        it('sends nothing for a held card, and resumes it when the deletion failed', async () => {
            const save = jest
                .fn<Promise<Saved>, [string, Update]>()
                .mockResolvedValue({ etag: 'v2' });
            const { result } = render(save);
            await act(async () => {
                result.current.scheduleSave('c', { content: 'typed' });
                result.current.holdCard('c');
                jest.advanceTimersByTime(2000);
                await settle();
            });
            expect(save).not.toHaveBeenCalled();
            await act(async () => {
                result.current.releaseCard('c'); // deletion failed
                await settle();
            });
            expect(save).toHaveBeenCalledWith('c', { content: 'typed' });
        });

        it('drops a held card’s writes once the deletion succeeded', async () => {
            const save = jest
                .fn<Promise<Saved>, [string, Update]>()
                .mockResolvedValue({ etag: 'v2' });
            const { result } = render(save);
            await act(async () => {
                result.current.scheduleSave('c', { content: 'typed' });
                result.current.holdCard('c');
                result.current.discardCard('c');
                jest.advanceTimersByTime(2000);
                await settle();
                window.dispatchEvent(new Event('online'));
                await settle();
            });
            expect(save).not.toHaveBeenCalled();
            expect(result.current.saveState.status).toBe('saved');
        });

        it('ignores the late success of a write already in flight when the card is deleted', async () => {
            const a = deferred<Saved>();
            const save = jest
                .fn<Promise<Saved>, [string, Update]>()
                .mockImplementationOnce(() => a.promise);
            const onSaved = jest.fn();
            const { result } = render(save, onSaved);
            await act(async () => {
                result.current.scheduleSave('c', { content: 'x' });
                jest.advanceTimersByTime(500);
                await settle();
            });
            act(() => result.current.discardCard('c'));
            await act(async () => {
                a.resolve({ etag: 'v2' });
                await settle();
            });
            expect(onSaved).not.toHaveBeenCalled();
            expect(result.current.saveState.status).toBe('saved');
        });

        it('ignores the late failure of an in-flight write after deletion (no ghost retry, no error)', async () => {
            const a = deferred<Saved>();
            const save = jest
                .fn<Promise<Saved>, [string, Update]>()
                .mockImplementationOnce(() => a.promise);
            const onError = jest.fn();
            const { result } = render(save, undefined, onError);
            await act(async () => {
                result.current.scheduleSave('c', { content: 'x' });
                jest.advanceTimersByTime(500);
                await settle();
            });
            act(() => result.current.discardCard('c'));
            await act(async () => {
                a.reject(
                    Object.assign(new Error('gone'), {
                        response: { status: 404 },
                    })
                );
                await settle();
                window.dispatchEvent(new Event('online'));
                await settle();
            });
            expect(onError).not.toHaveBeenCalled();
            expect(save).toHaveBeenCalledTimes(1);
            expect(result.current.saveState.status).toBe('saved');
        });

        it('skips a write that was still waiting behind an in-flight one when the card is deleted', async () => {
            const a = deferred<Saved>();
            const save = jest
                .fn<Promise<Saved>, [string, Update]>()
                .mockImplementationOnce(() => a.promise)
                .mockResolvedValue({ etag: 'v3' });
            const { result } = render(save);
            await act(async () => {
                result.current.scheduleSave('c', { content: 'a' });
                jest.advanceTimersByTime(500);
                await settle();
            });
            act(() => {
                result.current.scheduleSave('c', { content: 'ab' });
                jest.advanceTimersByTime(500); // queued behind the in-flight write
            });
            act(() => result.current.discardCard('c'));
            await act(async () => {
                a.resolve({ etag: 'v2' });
                await settle();
            });
            expect(save).toHaveBeenCalledTimes(1);
        });
    });
});
