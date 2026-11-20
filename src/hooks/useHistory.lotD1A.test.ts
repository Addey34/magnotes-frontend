/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import {
    HistoryPartialError,
    HistoryRefusedError,
    useHistory,
    type HistoryEntry,
} from './useHistory';

/**
 * LOT-D1A C-AUD-01 — identity of the history cursor.
 *
 * An entry is moved by IDENTITY, never by position: a new action recorded
 * while an undo/redo is awaiting the server must survive it, and the entry that
 * was really applied is the one that moves. A recorded action cuts the redo
 * branch (explicit policy) — it is never lost and never resurrected.
 */

interface Spy extends HistoryEntry {
    undo: jest.Mock;
    redo: jest.Mock;
    name: string;
}

const entry = (name: string): Spy => ({
    name,
    undo: jest.fn().mockResolvedValue(undefined),
    redo: jest.fn().mockResolvedValue(undefined),
});

/**
 * An entry whose FIRST undo (or redo) waits for the test to release it; any
 * later call resolves at once (so a wrong implementation fails an assertion
 * instead of hanging the suite).
 */
const gated = (name: string, side: 'undo' | 'redo' = 'undo') => {
    const e = entry(name);
    let release: (error?: unknown) => void = () => undefined;
    let first = true;
    e[side] = jest.fn(() => {
        if (!first) return Promise.resolve();
        first = false;
        return new Promise<void>((resolve, reject) => {
            release = (error?: unknown) => (error ? reject(error) : resolve());
        });
    });
    return { e, release: (error?: unknown) => release(error) };
};

const setup = (onError = jest.fn()) => {
    const hook = renderHook(() => useHistory(60, onError));
    return { ...hook, onError };
};

/** Replays the whole stack from the top and reports what ran, in order. */
const drain = async (
    result: { current: ReturnType<typeof useHistory> },
    max = 6
) => {
    let guard = 0;
    while (result.current.canUndo && guard++ < max) {
        await act(async () => result.current.undo());
    }
};

describe('C-AUD-01 — a recorded action during an undo is not lost', () => {
    it('full success: the entry that was undone leaves the past, the new one stays and the redo branch is cut', async () => {
        const { result } = setup();
        const e = gated('E');
        const n = entry('N');
        act(() => result.current.record(e.e));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
        });
        act(() => result.current.record(n));
        await act(async () => {
            e.release();
            await pending;
        });

        // N is still undoable, E is NOT back in the stack, nothing to redo.
        expect(result.current.canRedo).toBe(false);
        await act(async () => result.current.undo());
        expect(n.undo).toHaveBeenCalledTimes(1);
        expect(e.e.undo).toHaveBeenCalledTimes(1);
        expect(result.current.canUndo).toBe(false);
    });

    it('full success: the redo entry after the new action is the new one, never the old one', async () => {
        const { result } = setup();
        const e = gated('E');
        const n = entry('N');
        act(() => result.current.record(e.e));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
        });
        act(() => result.current.record(n));
        await act(async () => {
            e.release();
            await pending;
        });
        await act(async () => result.current.undo());
        await act(async () => result.current.redo());
        expect(n.redo).toHaveBeenCalledTimes(1);
        expect(e.e.redo).not.toHaveBeenCalled();
    });

    it('redo success: the redone entry goes back before the action recorded meanwhile', async () => {
        const { result } = setup();
        const e = gated('E', 'redo');
        const n = entry('N');
        act(() => result.current.record(e.e));
        await act(async () => result.current.undo());
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.redo();
        });
        act(() => result.current.record(n));
        await act(async () => {
            e.release();
            await pending;
        });
        const order: string[] = [];
        n.undo.mockImplementation(async () => void order.push('N'));
        e.e.undo.mockImplementation(async () => void order.push('E'));
        await drain(result);
        expect(order).toEqual(['N', 'E']);
        expect(result.current.canRedo).toBe(true);
    });

    it('partial undo: the untouched part replaces the entry in place, the new action stays on top, the done part is not resurrected as a redo', async () => {
        const { result, onError } = setup();
        const done = entry('done');
        const left = entry('left');
        const e = gated('E');
        const n = entry('N');
        act(() => result.current.record(e.e));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
        });
        act(() => result.current.record(n));
        await act(async () => {
            e.release(new HistoryPartialError(done, left));
            await pending;
        });
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.canRedo).toBe(false);
        const order: string[] = [];
        n.undo.mockImplementation(async () => void order.push('N'));
        left.undo.mockImplementation(async () => void order.push('left'));
        await drain(result);
        expect(order).toEqual(['N', 'left']);
        expect(done.undo).not.toHaveBeenCalled();
    });

    it('partial redo: the redone part goes before the new action, the untouched part is not kept as a redo', async () => {
        const { result } = setup();
        const done = entry('done');
        const left = entry('left');
        const e = gated('E', 'redo');
        const n = entry('N');
        act(() => result.current.record(e.e));
        await act(async () => result.current.undo());
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.redo();
        });
        act(() => result.current.record(n));
        await act(async () => {
            e.release(new HistoryPartialError(done, left));
            await pending;
        });
        expect(result.current.canRedo).toBe(false);
        const order: string[] = [];
        n.undo.mockImplementation(async () => void order.push('N'));
        done.undo.mockImplementation(async () => void order.push('done'));
        await drain(result);
        expect(order).toEqual(['N', 'done']);
    });

    it('refused undo: both entries stay exactly where they were', async () => {
        const { result, onError } = setup();
        const e = gated('E');
        const n = entry('N');
        act(() => result.current.record(e.e));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
        });
        act(() => result.current.record(n));
        await act(async () => {
            e.release(new HistoryRefusedError());
            await pending;
        });
        expect(onError).toHaveBeenCalledTimes(1);
        const order: string[] = [];
        n.undo.mockImplementation(async () => void order.push('N'));
        e.e.undo.mockImplementation(async () => void order.push('E'));
        await drain(result);
        expect(order).toEqual(['N', 'E']);
    });

    it('with no action recorded meanwhile the behaviour is unchanged (undo then redo)', async () => {
        const { result } = setup();
        const a = entry('A');
        const b = entry('B');
        act(() => result.current.record(a));
        act(() => result.current.record(b));
        await act(async () => result.current.undo());
        expect(result.current.canRedo).toBe(true);
        await act(async () => result.current.redo());
        expect(b.redo).toHaveBeenCalledTimes(1);
        await act(async () => result.current.undo());
        await act(async () => result.current.undo());
        expect(a.undo).toHaveBeenCalledTimes(1);
        expect(b.undo).toHaveBeenCalledTimes(2);
    });

    it('the history limit never removes the entry recorded during the operation', async () => {
        const hook = renderHook(() => useHistory(2));
        const { result } = hook;
        const a = entry('A');
        const e = gated('E');
        const n = entry('N');
        act(() => result.current.record(a));
        act(() => result.current.record(e.e));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
        });
        act(() => result.current.record(n));
        await act(async () => {
            e.release();
            await pending;
        });
        await act(async () => result.current.undo());
        expect(n.undo).toHaveBeenCalledTimes(1);
    });
});

describe('C-AUD-01 — clear and parallel operations', () => {
    it('clear during an undo: the entry recorded afterwards in the new context is not touched by the old result', async () => {
        const { result } = setup();
        const e = gated('E');
        const n = entry('N');
        act(() => result.current.record(e.e));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
            result.current.clear();
        });
        act(() => result.current.record(n));
        await act(async () => {
            e.release();
            await pending;
        });
        expect(result.current.canRedo).toBe(false);
        await act(async () => result.current.undo());
        expect(n.undo).toHaveBeenCalledTimes(1);
    });

    it('a redo requested while an undo is running is ignored, not queued', async () => {
        const { result } = setup();
        const e = gated('E');
        act(() => result.current.record(e.e));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
        });
        await act(async () => result.current.redo());
        await act(async () => {
            e.release();
            await pending;
        });
        expect(e.e.redo).not.toHaveBeenCalled();
        expect(result.current.canRedo).toBe(true);
    });
});

describe('C-AUD-01 — notifications follow the generation', () => {
    const afterClear = async (error: unknown) => {
        const { result, onError } = setup();
        const e = gated('E');
        act(() => result.current.record(e.e));
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
            result.current.clear();
        });
        await act(async () => {
            e.release(error);
            await pending;
        });
        return { result, onError, entry: e.e };
    };

    it('a refusal that arrives after the board changed does not notify the new board', async () => {
        const { onError } = await afterClear(new HistoryRefusedError());
        expect(onError).not.toHaveBeenCalled();
    });

    it('a partial result that arrives after the board changed does not notify the new board', async () => {
        const { onError } = await afterClear(
            new HistoryPartialError(entry('d'), entry('l'))
        );
        expect(onError).not.toHaveBeenCalled();
    });

    it('an unexpected error that arrives after the board changed does not notify nor compensate', async () => {
        const { onError, entry: e } = await afterClear(new Error('boom'));
        expect(onError).not.toHaveBeenCalled();
        expect(e.redo).not.toHaveBeenCalled();
    });

    it('the notification of the current generation is kept', async () => {
        const { result, onError } = setup();
        const e = entry('E');
        e.undo.mockRejectedValue(new HistoryRefusedError());
        act(() => result.current.record(e));
        await act(async () => result.current.undo());
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('C-AUD-01 — the generic compensation never replays an entry blindly', () => {
    it('an unexpected error in undo keeps the entry, notifies once and does not run the opposite side', async () => {
        const { result, onError } = setup();
        const e = entry('E');
        e.undo.mockRejectedValue(new Error('unexpected'));
        act(() => result.current.record(e));
        await act(async () => result.current.undo());
        expect(e.redo).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.canUndo).toBe(true);
        expect(result.current.canRedo).toBe(false);
    });

    it('an unexpected error in redo keeps the entry and does not run the opposite side', async () => {
        const { result, onError } = setup();
        const e = entry('E');
        e.redo.mockRejectedValue(new Error('unexpected'));
        act(() => result.current.record(e));
        await act(async () => result.current.undo());
        await act(async () => result.current.redo());
        expect(e.undo).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.canRedo).toBe(true);
        expect(result.current.canUndo).toBe(false);
    });
});
