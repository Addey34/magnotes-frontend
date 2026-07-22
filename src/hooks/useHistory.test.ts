/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { useHistory } from './useHistory';

describe('useHistory transactions', () => {
    it('moves an entry only after a successful undo', async () => {
        const undo = jest.fn().mockResolvedValue(undefined);
        const redo = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useHistory());

        act(() => result.current.record({ undo, redo }));
        expect(result.current.canUndo).toBe(true);

        await act(async () => result.current.undo());

        expect(undo).toHaveBeenCalledTimes(1);
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(true);
    });

    it('compensates a failed undo and keeps it available', async () => {
        const undo = jest.fn().mockRejectedValue(new Error('network'));
        const redo = jest.fn().mockResolvedValue(undefined);
        const onError = jest.fn();
        const { result } = renderHook(() => useHistory(60, onError));

        act(() => result.current.record({ undo, redo }));
        await act(async () => result.current.undo());

        expect(undo).toHaveBeenCalledTimes(1);
        expect(redo).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.canUndo).toBe(true);
        expect(result.current.canRedo).toBe(false);
    });

    it('compensates a failed redo and keeps it available', async () => {
        const undo = jest.fn().mockResolvedValue(undefined);
        const redo = jest.fn().mockRejectedValue(new Error('network'));
        const onError = jest.fn();
        const { result } = renderHook(() => useHistory(60, onError));

        act(() => result.current.record({ undo, redo }));
        await act(async () => result.current.undo());
        await act(async () => result.current.redo());

        expect(redo).toHaveBeenCalledTimes(1);
        expect(undo).toHaveBeenCalledTimes(2);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(true);
    });

    it('ignores concurrent history requests while one is running', async () => {
        let resolveUndo!: () => void;
        const undo = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveUndo = resolve;
                })
        );
        const redo = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useHistory());

        act(() => result.current.record({ undo, redo }));
        let first!: Promise<void>;
        act(() => {
            first = result.current.undo();
            void result.current.undo();
        });

        expect(undo).toHaveBeenCalledTimes(1);
        expect(result.current.isApplying).toBe(true);
        expect(result.current.canUndo).toBe(false);

        await act(async () => {
            resolveUndo();
            await first;
        });
        expect(result.current.canRedo).toBe(true);
    });

    it('does not move an entry into a new board after history is cleared', async () => {
        let resolveUndo!: () => void;
        const undo = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveUndo = resolve;
                })
        );
        const { result } = renderHook(() => useHistory());

        act(() =>
            result.current.record({
                undo,
                redo: jest.fn().mockResolvedValue(undefined),
            })
        );
        let pending!: Promise<void>;
        act(() => {
            pending = result.current.undo();
            result.current.clear();
        });

        await act(async () => {
            resolveUndo();
            await pending;
        });

        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });
});
