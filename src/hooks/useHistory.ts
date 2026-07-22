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
export function useHistory(limit = 60, onError?: () => void) {
    const past = useRef<HistoryEntry[]>([]);
    const future = useRef<HistoryEntry[]>([]);
    const applying = useRef(false);
    const generation = useRef(0);
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
        if (!entry || applying.current) return;
        const startGeneration = generation.current;
        applying.current = true;
        force();
        try {
            await entry.undo();
            if (generation.current === startGeneration) {
                past.current = past.current.slice(0, -1);
                future.current = [entry, ...future.current];
            }
        } catch {
            // Commands update local state before awaiting the API. Running the
            // inverse restores that local state even if its API call also fails.
            try {
                await entry.redo();
            } catch {
                // Best-effort server compensation; the inverse already restored
                // the local snapshot synchronously.
            }
            onError?.();
        } finally {
            applying.current = false;
            force();
        }
    }, [onError]);

    const redo = useCallback(async () => {
        const entry = future.current[0];
        if (!entry || applying.current) return;
        const startGeneration = generation.current;
        applying.current = true;
        force();
        try {
            await entry.redo();
            if (generation.current === startGeneration) {
                future.current = future.current.slice(1);
                past.current = [...past.current, entry];
            }
        } catch {
            try {
                await entry.undo();
            } catch {
                // See undo compensation above.
            }
            onError?.();
        } finally {
            applying.current = false;
            force();
        }
    }, [onError]);

    const clear = useCallback(() => {
        generation.current += 1;
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
        canUndo: !applying.current && past.current.length > 0,
        canRedo: !applying.current && future.current.length > 0,
        isApplying: applying.current,
    };
}
