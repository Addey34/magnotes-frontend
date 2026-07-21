import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createStack,
    deleteStack,
    fetchStacks,
    updateStack,
} from '../services/boardApi';
import { PostItStack, PostItStackUpdate } from '../types/boardTypes';
import { snapToGrid } from './useDragGrid';

export const useStacks = (activeTabId: string | null) => {
    const [stacksByTab, setStacksByTab] = useState<
        Record<string, PostItStack[]>
    >({});

    const stacks = useMemo(
        () => (activeTabId ? stacksByTab[activeTabId] || [] : []),
        [activeTabId, stacksByTab]
    );

    const loadStacks = useCallback(async (tabId: string) => {
        const loadedStacks = await fetchStacks(tabId);
        setStacksByTab((current) => ({
            ...current,
            [tabId]: loadedStacks,
        }));
    }, []);

    const addStack = async (x: number, y: number): Promise<PostItStack | null> => {
        if (!activeTabId) return null;

        const stack = await createStack({
            tabId: activeTabId,
            x: snapToGrid(x),
            y: snapToGrid(y),
        });

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
        patchStackLocal(stackId, { collapsed });
        await updateStack(stackId, { collapsed });
    };

    const removeStack = async (stackId: string) => {
        if (!activeTabId) return;

        setStacksByTab((current) => ({
            ...current,
            [activeTabId]: (current[activeTabId] || []).filter(
                (stack) => stack._id !== stackId
            ),
        }));
        await deleteStack(stackId);
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

