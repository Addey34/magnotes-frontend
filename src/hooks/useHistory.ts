import { useCallback, useReducer, useRef } from 'react';

export interface HistoryEntry {
    undo: () => void | Promise<void>;
    redo: () => void | Promise<void>;
}

/**
 * A minimal undo/redo stack. Entries carry their own `undo`/`redo` side
 * effects, so the hook stays domain-agnostic. Stacks live in refs (mutating
 * them must not run side effects the way a state updater would) with a force
 * re-render to keep `canUndo`/`canRedo` in sync.
 */
export function useHistory(limit = 60) {
    const past = useRef<HistoryEntry[]>([]);
    const future = useRef<HistoryEntry[]>([]);
    const [, force] = useReducer((n: number) => n + 1, 0);

    const record = useCallback(
        (entry: HistoryEntry) => {
            past.current = [...past.current, entry].slice(-limit);
            future.current = [];
            force();
        },
        [limit]
    );

    const undo = useCallback(async () => {
        const entry = past.current[past.current.length - 1];
        if (!entry) return;
        past.current = past.current.slice(0, -1);
        future.current = [entry, ...future.current];
        force();
        await entry.undo();
    }, []);

    const redo = useCallback(async () => {
        const entry = future.current[0];
        if (!entry) return;
        future.current = future.current.slice(1);
        past.current = [...past.current, entry];
        force();
        await entry.redo();
    }, []);

    const clear = useCallback(() => {
        if (past.current.length === 0 && future.current.length === 0) return;
        past.current = [];
        future.current = [];
        force();
    }, []);

    return {
        record,
        undo,
        redo,
        clear,
        canUndo: past.current.length > 0,
        canRedo: future.current.length > 0,
    };
}
