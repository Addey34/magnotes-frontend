import { useCallback, useEffect, useRef, useState } from 'react';
import { SaveState } from '../types/boardTypes';

interface PendingSave<T> {
    timer: number;
    updates: T;
}

export const useAutosave = <T extends object, TResult = void>(
    save: (id: string, updates: T) => Promise<TResult>,
    delay = 500,
    onError?: (error: unknown) => void,
    onSaved?: (id: string, result: TResult, staleKeys: string[]) => void
) => {
    const pending = useRef<Record<string, PendingSave<T>>>({});
    const failed = useRef<Record<string, T>>({});
    const inFlight = useRef<Record<string, Promise<void>>>({});
    const mounted = useRef(true);
    const saveRef = useRef(save);
    const onErrorRef = useRef(onError);
    const onSavedRef = useRef(onSaved);
    const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

    // Keep the autosave queue stable across consumer renders while still
    // calling the latest callbacks. Depending directly on callback identities
    // would rerun the lifecycle effect; its cleanup flushes failed writes and
    // could therefore create an immediate retry loop after a 429/offline error.
    saveRef.current = save;
    onErrorRef.current = onError;
    onSavedRef.current = onSaved;

    const flushSave = useCallback((id: string): Promise<void> => {
        const queued = pending.current[id];
        if (!queued) return inFlight.current[id] || Promise.resolve();

        window.clearTimeout(queued.timer);
        delete pending.current[id];
        const updatesToSave = {
            ...(failed.current[id] || {}),
            ...queued.updates,
        } as T;
        delete failed.current[id];

        if (mounted.current) {
            setSaveState({ status: 'saving', postItId: id });
        }

        // Serialize writes for one card so an older, slower request cannot
        // land after a newer one and overwrite its fields on the server.
        const previous = inFlight.current[id] || Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(() => saveRef.current(id, updatesToSave))
            .then((result) => {
                // Fields the user has kept editing while this request was in
                // flight. The response echoes the card as it was *sent*, so
                // applying those keys would rewind the textarea to an older
                // value and swallow everything typed since — the "it drops
                // letters when I type fast" bug.
                const staleKeys = Object.keys({
                    ...(pending.current[id]?.updates || {}),
                    ...(failed.current[id] || {}),
                });
                onSavedRef.current?.(id, result, staleKeys);
                if (mounted.current) {
                    setSaveState({ status: 'saved', postItId: id });
                }
            })
            .catch((error) => {
                console.error('Autosave failed:', error);
                failed.current[id] = {
                    ...updatesToSave,
                    ...(failed.current[id] || {}),
                } as T;
                onErrorRef.current?.(error);
                if (mounted.current) {
                    setSaveState({ status: 'error', postItId: id });
                }
            })
            .finally(() => {
                if (inFlight.current[id] === operation) {
                    delete inFlight.current[id];
                }
            });

        inFlight.current[id] = operation;
        return operation;
    }, []);

    const scheduleSave = useCallback(
        (id: string, updates: T) => {
            const current = pending.current[id];
            if (current) window.clearTimeout(current.timer);

            setSaveState({ status: 'saving', postItId: id });

            const mergedUpdates = {
                ...(current?.updates || {}),
                ...updates,
            } as T;
            const timer = window.setTimeout(() => void flushSave(id), delay);
            pending.current[id] = { timer, updates: mergedUpdates };
        },
        [delay, flushSave]
    );

    const flushPending = useCallback(() => {
        const ids = new Set([
            ...Object.keys(pending.current),
            ...Object.keys(failed.current),
        ]);
        ids.forEach((id) => {
            if (!pending.current[id] && failed.current[id]) {
                pending.current[id] = {
                    timer: 0,
                    updates: failed.current[id],
                };
                delete failed.current[id];
            }
        });
        return Promise.all([...ids].map(flushSave)).then(() => undefined);
    }, [flushSave]);

    useEffect(() => {
        mounted.current = true;
        const handlePageHide = () => void flushPending();
        const handleOnline = () => void flushPending();
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('online', handleOnline);

        return () => {
            mounted.current = false;
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('online', handleOnline);
            void flushPending();
        };
    }, [flushPending]);

    return { saveState, scheduleSave, flushPending };
};
