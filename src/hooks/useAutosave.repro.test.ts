/** @jest-environment jsdom */

// MGN-DATA-01B — reproduction tests. They exercise the REAL useAutosave hook and
// control the order of promises. Each test states the behaviour that should
// hold; a failing test is a confirmed defect (RED), a passing one a control.
// The hook is NOT modified to make them pass.

import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

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
const flushMicrotasks = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};
const conflict = () =>
    Object.assign(new Error('conflict'), { response: { status: 412 } });

type Update = {
    content?: string;
    title?: string;
    etag?: string;
};
type Saved = { etag: string } & Update;

describe('useAutosave — MGN-DATA-01B reproduction', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('U1 — a write queued behind an in-flight one carries the version that write produced', async () => {
        // The card still shows v1 when the user types again, because the response
        // of write A (which moves the card to v2) has not arrived yet.
        const a = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a.promise)
            .mockResolvedValue({ etag: 'v3', content: 'ab' });
        const { result } = renderHook(() =>
            useAutosave<Update, Saved>(save, 500)
        );

        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'a',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await flushMicrotasks();
        });
        expect(save).toHaveBeenCalledTimes(1);
        act(() => {
            // PostItCard.scheduleCardSave still reads postIt.etag === 'v1'.
            result.current.scheduleSave('c', {
                content: 'ab',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
        });
        await act(async () => {
            a.resolve({ etag: 'v2', content: 'a' });
            await flushMicrotasks();
        });

        expect(save).toHaveBeenCalledTimes(2);
        // Server is now at v2 (our own write A): sending v1 is a self-inflicted 409.
        expect(save.mock.calls[1][1].etag).toBe('v2');
    });

    it('U2 — when A fails while B is already queued, the stale A value is never replayed over B', async () => {
        const a = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a.promise)
            .mockResolvedValue({ etag: 'v2', content: 'ab' });
        const { result } = renderHook(() =>
            useAutosave<Update, Saved>(save, 500)
        );

        await act(async () => {
            result.current.scheduleSave('c', { content: 'a' });
            jest.advanceTimersByTime(500);
            await flushMicrotasks();
        });
        act(() => {
            result.current.scheduleSave('c', { content: 'ab' });
            jest.advanceTimersByTime(500); // B is now queued behind A
        });
        await act(async () => {
            a.reject(new Error('network'));
            await flushMicrotasks();
        });
        // B succeeded with 'ab'. Coming back online must not resend A's older 'a'.
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await flushMicrotasks();
        });

        const sentContents = save.mock.calls.map((call) => call[1].content);
        expect(sentContents[sentContents.length - 1]).toBe('ab');
        expect(sentContents.filter((c) => c === 'a')).toHaveLength(1);
    });

    it('U3 — control: distinct fields edited by A (failed) and B are both kept', async () => {
        const a = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a.promise)
            .mockResolvedValue({ etag: 'v2' });
        const { result } = renderHook(() =>
            useAutosave<Update, Saved>(save, 500)
        );

        await act(async () => {
            result.current.scheduleSave('c', { title: 'T' });
            jest.advanceTimersByTime(500);
            await flushMicrotasks();
        });
        act(() => {
            result.current.scheduleSave('c', { content: 'C' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => {
            a.reject(new Error('network'));
            await flushMicrotasks();
        });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await flushMicrotasks();
        });

        const merged = Object.assign({}, ...save.mock.calls.map((c) => c[1]));
        expect(merged).toMatchObject({ title: 'T', content: 'C' });
        expect(save.mock.calls.some((c) => c[1].title === 'T')).toBe(true);
    });

    it('U4 — control: the response of an older write does not rewind a field edited since', async () => {
        const a = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a.promise)
            .mockResolvedValue({ etag: 'v3', content: 'abc' });
        const onSaved = jest.fn<void, [string, Saved, string[]]>();
        const { result } = renderHook(() =>
            useAutosave<Update, Saved>(save, 500, undefined, onSaved)
        );
        await act(async () => {
            result.current.scheduleSave('c', { content: 'a' });
            jest.advanceTimersByTime(500);
            await flushMicrotasks();
        });
        act(() => result.current.scheduleSave('c', { content: 'abc' }));
        await act(async () => {
            a.resolve({ etag: 'v2', content: 'a' });
            await flushMicrotasks();
        });
        expect(onSaved.mock.calls[0][2]).toContain('content');
    });

    it('U5 — a 409 is not blindly replayed with the same payload and version on every online/pagehide', async () => {
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockRejectedValue(conflict());
        const onError = jest.fn();
        const { result } = renderHook(() =>
            useAutosave<Update, Saved>(save, 500, onError)
        );
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'mine',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await flushMicrotasks();
        });
        expect(onError).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 3; i++) {
            await act(async () => {
                window.dispatchEvent(new Event('online'));
                await flushMicrotasks();
            });
        }
        // Resending the identical stale write (same etag) can only
        // produce the same 409: one attempt per user action is expected.
        const identical = save.mock.calls.filter(
            (c) => c[1].content === 'mine' && c[1].etag === 'v1'
        );
        expect(identical).toHaveLength(1);
    });

    it('U6 — a conflicted write keeps the user text reachable (not silently dropped)', async () => {
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockRejectedValue(conflict());
        const { result, unmount } = renderHook(() =>
            useAutosave<Update, Saved>(save, 500)
        );
        await act(async () => {
            result.current.scheduleSave('c', {
                content: 'mine',
                etag: 'v1',
            });
            jest.advanceTimersByTime(500);
            await flushMicrotasks();
        });
        // The only copy of the text is the in-memory `failed` queue: after unmount
        // (logout, navigation, reload) nothing can recover it. This test documents
        // the loss by asserting the hook exposes some way to read unsynced content.
        expect(
            (result.current as Record<string, unknown>).unsynced
        ).toBeDefined();
        unmount();
    });

    it('U7 — status never claims "saved" while an earlier write is still failed', async () => {
        const a = deferred<Saved>();
        const save = jest
            .fn<Promise<Saved>, [string, Update]>()
            .mockImplementationOnce(() => a.promise)
            .mockResolvedValue({ etag: 'v2' });
        const { result } = renderHook(() =>
            useAutosave<Update, Saved>(save, 500)
        );
        await act(async () => {
            result.current.scheduleSave('c', { title: 'T' });
            jest.advanceTimersByTime(500);
            await flushMicrotasks();
        });
        act(() => {
            result.current.scheduleSave('c', { content: 'C' });
            jest.advanceTimersByTime(500);
        });
        await act(async () => {
            a.reject(new Error('network'));
            await flushMicrotasks();
        });
        // B succeeded, but the title edit of A is still unsaved.
        expect(result.current.saveState.status).not.toBe('saved');
    });
});
