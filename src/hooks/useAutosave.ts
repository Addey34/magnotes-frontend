import { useCallback, useEffect, useRef, useState } from 'react';
import { SaveState } from '../types/boardTypes';

export const useAutosave = <T>(
    save: (id: string, updates: T) => Promise<void>,
    delay = 500
) => {
    const timers = useRef<Record<string, number>>({});
    const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

    const scheduleSave = useCallback(
        (id: string, updates: T) => {
            window.clearTimeout(timers.current[id]);
            setSaveState({ status: 'saving', postItId: id });

            timers.current[id] = window.setTimeout(async () => {
                try {
                    await save(id, updates);
                    setSaveState({ status: 'saved', postItId: id });
                } catch (error) {
                    console.error('Autosave failed:', error);
                    setSaveState({ status: 'error', postItId: id });
                }
            }, delay);
        },
        [delay, save]
    );

    useEffect(() => {
        return () => {
            Object.values(timers.current).forEach((timer) =>
                window.clearTimeout(timer)
            );
        };
    }, []);

    return { saveState, scheduleSave };
};

