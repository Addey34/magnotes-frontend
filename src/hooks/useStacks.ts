import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createStack,
    deleteStack,
    fetchStacks,
    updateStack,
} from '../services/boardApi';
import { PostItStack, PostItStackUpdate } from '../types/boardTypes';
import { snapToGrid } from './useDragGrid';

export const useStacks = (
    activeTabId: string | null,
    onLoadError?: () => void,
    onMutationError?: () => void
) => {
    const [stacksByTab, setStacksByTab] = useState<
        Record<string, PostItStack[]>
    >({});

    const stacks = useMemo(
        () => (activeTabId ? stacksByTab[activeTabId] || [] : []),
        [activeTabId, stacksByTab]
    );

    const loadStacks = useCallback(
        async (tabId: string) => {
            try {
                const loadedStacks = await fetchStacks(tabId);
                setStacksByTab((current) => ({
                    ...current,
                    [tabId]: loadedStacks,
                }));
            } catch {
                onLoadError?.();
            }
        },
        [onLoadError]
    );

    const addStack = async (x: number, y: number): Promise<PostItStack | null> => {
        if (!activeTabId) return null;

        let stack: PostItStack;
        try {
            stack = await createStack({
                tabId: activeTabId,
                x: snapToGrid(x),
                y: snapToGrid(y),
            });
        } catch {
            onMutationError?.();
            return null;
        }

        setStacksByTab((current) => ({
            ...current,
            [activeTabId]: [...(current[activeTabId] || []), stack],
        }));

        return stack;
    };

    const patchStackLocal = (stackId: string, updates: PostItStackUpdate) => {
        if (!activeTabId) return;

        setStacksByTab((current) => ({
            ...current,
            [activeTabId]: (current[activeTabId] || []).map((stack) =>
                stack._id === stackId ? { ...stack, ...updates } : stack
            ),
        }));
    };

    const toggleStack = async (stackId: string, collapsed: boolean) => {
        if (!activeTabId) return;
        const previous = (stacksByTab[activeTabId] || []).find(
            (stack) => stack._id === stackId
        );
        if (!previous) return;
        patchStackLocal(stackId, { collapsed });
        try {
            await updateStack(stackId, { collapsed });
        } catch {
            patchStackLocal(stackId, { collapsed: previous.collapsed });
            onMutationError?.();
        }
    };

    const removeStack = async (stackId: string) => {
        if (!activeTabId) return;
        const currentStacks = stacksByTab[activeTabId] || [];
        const removedIndex = currentStacks.findIndex(
            (stack) => stack._id === stackId
        );
        const removed = currentStacks[removedIndex];
        if (!removed) return;

        setStacksByTab((current) => ({
            ...current,
            [activeTabId]: (current[activeTabId] || []).filter(
                (stack) => stack._id !== stackId
            ),
        }));
        try {
            await deleteStack(stackId);
        } catch {
            setStacksByTab((current) => {
                const next = [...(current[activeTabId] || [])];
                if (!next.some((stack) => stack._id === stackId)) {
                    next.splice(Math.min(removedIndex, next.length), 0, removed);
                }
                return { ...current, [activeTabId]: next };
            });
            onMutationError?.();
        }
    };

    useEffect(() => {
        if (activeTabId && !stacksByTab[activeTabId]) {
            loadStacks(activeTabId);
        }
    }, [activeTabId, loadStacks, stacksByTab]);

    return {
        stacks,
        addStack,
        toggleStack,
        removeStack,
    };
};

