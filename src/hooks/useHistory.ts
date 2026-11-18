import { useCallback, useReducer, useRef } from 'react';
import { isStaleLifecycle } from '../services/concurrencyOutcome';

/**
 * Thrown by an entry that refuses to run because the cards it targets no longer
 * look the way it expects (they changed elsewhere). Nothing was applied, so no
 * compensation runs and the entry stays where it is.
 */
export class HistoryRefusedError extends Error {
    constructor(message = 'History entry refused: the card changed') {
        super(message);
        this.name = 'HistoryRefusedError';
    }
}

export interface HistoryEntry {
    undo: () => void | Promise<void>;
    redo: () => void | Promise<void>;
}

/**
 * Thrown by an entry that was applied to SOME of its cards only. The operation
 * is neither entirely done nor entirely cancelled, so it is split by what
 * really happened (nothing is compensated):
 *  - `done`  the part that now sits on the other side of the cursor (may be
 *            empty: nothing was applied);
 *  - `left`  the part that did not move and stays where the entry was (may be
 *            empty: only stale cards remained).
 * `notify` says whether the user must be told (a refusal), as opposed to cards
 * that merely belonged to a previous life.
 */
export class HistoryPartialError extends Error {
    constructor(
        public readonly done: HistoryEntry | null,
        public readonly left: HistoryEntry | null,
        public readonly notify = true
    ) {
        super('History entry applied to some cards only');
        this.name = 'HistoryPartialError';
    }
}

/**
 * A minimal undo/redo stack. Entries carry their own `undo`/`redo` side
 * effects, so the hook stays domain-agnostic. Stacks live in refs (mutating
 * them must not run side effects the way a state updater would) with a force
 * re-render to keep `canUndo`/`canRedo` in sync.
 *
 * Cursor policy (LOT-D1A, C-AUD-01):
 *  - an entry is moved by IDENTITY, never by position: an action recorded while
 *    an undo/redo awaits the server stays in the stack and is never removed by
 *    the older operation's result;
 *  - an action recorded meanwhile cuts the redo branch, exactly as it does when
 *    nothing is running: what the operation had put on the other side of the
 *    cursor is not resurrected after it;
 *  - what an operation applied is ordered BEFORE the actions recorded during it
 *    (its local effect started first);
 *  - results and notifications of an operation started in a previous
 *    generation (history cleared, board changed) change and say nothing;
 *  - no generic compensation: an unexpected error leaves the entry where it is
 *    and tells the user once. Replaying the opposite side after an unknown
 *    outcome would send a second mutation on top of an answer we do not have.
 */
export function useHistory(limit = 60, onError?: () => void) {
    const past = useRef<HistoryEntry[]>([]);
    const future = useRef<HistoryEntry[]>([]);
    const applying = useRef(false);
    const generation = useRef(0);
    /** Entries recorded while an undo/redo is awaiting; null when idle. */
    const recordedDuring = useRef<HistoryEntry[] | null>(null);
    const [, force] = useReducer((n: number) => n + 1, 0);

    const record = useCallback(
        (entry: HistoryEntry) => {
            past.current = [...past.current, entry].slice(-limit);
            future.current = [];
            recordedDuring.current?.push(entry);
            force();
        },
        [limit]
    );

    /** Places what an operation applied before the entries recorded meanwhile. */
    const pushApplied = (done: HistoryEntry, recorded: HistoryEntry[]) => {
        const base = past.current.filter((e) => !recorded.includes(e));
        past.current = [...base, done, ...recorded].slice(-limit);
    };

    const undo = useCallback(async () => {
        const entry = past.current[past.current.length - 1];
        if (!entry || applying.current) return;
        const startGeneration = generation.current;
        const current = () => generation.current === startGeneration;
        applying.current = true;
        recordedDuring.current = [];
        force();
        try {
            await entry.undo();
            if (current()) {
                const recorded = recordedDuring.current ?? [];
                past.current = past.current.filter((e) => e !== entry);
                // A new action cut the redo branch: the undone entry does not
                // come back as a redo.
                if (recorded.length === 0) {
                    future.current = [entry, ...future.current];
                }
            }
        } catch (error) {
            // The entry belongs to a previous life of a card (deleted,
            // restored, other account): nothing was applied to the current
            // one, so there is nothing to compensate nor to tell.
            if (isStaleLifecycle(error)) return;
            if (error instanceof HistoryPartialError) {
                // Neither entirely applied nor entirely cancelled: the cursor
                // follows what the server really acknowledged.
                if (current()) {
                    const recorded = recordedDuring.current ?? [];
                    const at = past.current.indexOf(entry);
                    if (at >= 0) {
                        past.current = [
                            ...past.current.slice(0, at),
                            ...(error.left ? [error.left] : []),
                            ...past.current.slice(at + 1),
                        ];
                    }
                    if (error.done && recorded.length === 0) {
                        future.current = [error.done, ...future.current];
                    }
                    if (error.notify) onError?.();
                }
                return;
            }
            if (error instanceof HistoryRefusedError) {
                if (current()) onError?.();
                return;
            }
            // Unexpected error: the entry stays, nothing is replayed.
            if (current()) onError?.();
        } finally {
            applying.current = false;
            recordedDuring.current = null;
            force();
        }
    }, [onError, limit]);

    const redo = useCallback(async () => {
        const entry = future.current[0];
        if (!entry || applying.current) return;
        const startGeneration = generation.current;
        const current = () => generation.current === startGeneration;
        applying.current = true;
        recordedDuring.current = [];
        force();
        try {
            await entry.redo();
            if (current()) {
                const recorded = recordedDuring.current ?? [];
                future.current = future.current.filter((e) => e !== entry);
                pushApplied(entry, recorded);
            }
        } catch (error) {
            if (isStaleLifecycle(error)) return;
            if (error instanceof HistoryPartialError) {
                if (current()) {
                    const recorded = recordedDuring.current ?? [];
                    // The redo branch only survives when no action cut it.
                    if (recorded.length === 0) {
                        const at = future.current.indexOf(entry);
                        if (at >= 0) {
                            future.current = [
                                ...future.current.slice(0, at),
                                ...(error.left ? [error.left] : []),
                                ...future.current.slice(at + 1),
                            ];
                        }
                    }
                    if (error.done) pushApplied(error.done, recorded);
                    if (error.notify) onError?.();
                }
                return;
            }
            if (error instanceof HistoryRefusedError) {
                if (current()) onError?.();
                return;
            }
            if (current()) onError?.();
        } finally {
            applying.current = false;
            recordedDuring.current = null;
            force();
        }
    }, [onError, limit]);

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
