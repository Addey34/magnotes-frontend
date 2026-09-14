import { useCallback, useEffect, useState } from 'react';
import {
    createTab as createTabRequest,
    deleteTab as deleteTabRequest,
    fetchTabs,
    reorderTabs as reorderTabsRequest,
    updateTab as updateTabRequest,
} from '../services/boardApi';
import { BoardTab } from '../types/boardTypes';
import { trackProductEvent } from '../services/analytics';

const TAB_COLORS = ['#facc15', '#38bdf8', '#fb7185', '#4ade80', '#c084fc'];
// Colourful emoji default so the board's "logo" stays visible on every theme
// (the legacy monochrome glyphs were tinted by tab.color and washed out on
// light/cork themes). Existing 'home'/'work'/… tabs keep their glyph.
const DEFAULT_TAB_ICON = '📝';

type TabCustomization = Partial<Pick<BoardTab, 'color' | 'theme' | 'icon'>> & {
    backgroundColor?: string | null;
};

type AddTabOptions = {
    trackCreation?: boolean;
};

const normalizeTabs = (tabs: BoardTab[]) =>
    tabs.map((tab) => ({ ...tab, icon: tab.icon || DEFAULT_TAB_ICON }));

export const useTabs = (
    onLoadError?: () => void,
    onMutationError?: () => void
) => {
    const [tabs, setTabs] = useState<BoardTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    // Start in the loading state so consumers cannot mistake the initial
    // empty array for a successfully loaded account with no boards.
    const [isLoadingTabs, setIsLoadingTabs] = useState(true);
    const [hasLoadedTabs, setHasLoadedTabs] = useState(false);

    const loadTabs = useCallback(async () => {
        setIsLoadingTabs(true);
        try {
            const loadedTabs = normalizeTabs(await fetchTabs());
            setTabs(loadedTabs);
            setActiveTabId((currentTabId) =>
                loadedTabs.some((tab) => tab._id === currentTabId)
                    ? currentTabId
                    : loadedTabs[0]?._id || null
            );
            setHasLoadedTabs(true);
        } catch {
            onLoadError?.();
        } finally {
            setIsLoadingTabs(false);
        }
    }, [onLoadError]);

    const addTab = async (
        backgroundColor?: string,
        { trackCreation = true }: AddTabOptions = {}
    ) => {
        const color = TAB_COLORS[tabs.length % TAB_COLORS.length];
        let tab: BoardTab;
        try {
            tab = await createTabRequest(
                `Page ${tabs.length + 1}`,
                color,
                DEFAULT_TAB_ICON,
                backgroundColor
            );
        } catch {
            onMutationError?.();
            return;
        }
        setTabs((currentTabs) => [...currentTabs, tab]);
        setActiveTabId(tab._id);
        if (trackCreation) trackProductEvent('board_created');
    };

    const patchTab = async (tabId: string, updates: TabCustomization) => {
        const previous = tabs.find((tab) => tab._id === tabId);
        if (!previous) return;
        const optimisticBackground =
            updates.backgroundColor === null
                ? undefined
                : (updates.backgroundColor ?? previous.backgroundColor);
        setTabs((currentTabs) =>
            currentTabs.map((tab) =>
                tab._id === tabId
                    ? {
                          ...tab,
                          ...updates,
                          // null clears the field locally (sent as null to unset).
                          backgroundColor:
                              updates.backgroundColor === null
                                  ? undefined
                                  : (updates.backgroundColor ??
                                    tab.backgroundColor),
                      }
                    : tab
            )
        );
        try {
            await updateTabRequest(tabId, updates);
        } catch {
            // Only revert fields that still contain this request's optimistic
            // value. A later successful edit must never be overwritten by an
            // older request failing out of order.
            setTabs((currentTabs) =>
                currentTabs.map((tab) => {
                    if (tab._id !== tabId) return tab;
                    const reverted = { ...tab };
                    for (const key of ['color', 'theme', 'icon'] as const) {
                        if (
                            key in updates &&
                            Object.is(tab[key], updates[key])
                        ) {
                            Object.assign(reverted, { [key]: previous[key] });
                        }
                    }
                    if (
                        'backgroundColor' in updates &&
                        Object.is(tab.backgroundColor, optimisticBackground)
                    ) {
                        reverted.backgroundColor = previous.backgroundColor;
                    }
                    return reverted;
                })
            );
            onMutationError?.();
        }
    };

    // Local-only sync after the share API call has persisted server-side, so a
    // reopened share dialog reflects the current token without a refetch.
    const setTabShareToken = (tabId: string, token: string | null) => {
        setTabs((currentTabs) =>
            currentTabs.map((tab) =>
                tab._id === tabId
                    ? { ...tab, shareToken: token ?? undefined }
                    : tab
            )
        );
    };

    const renameTab = async (tabId: string, name: string) => {
        const normalizedName = name.trim();
        const currentTab = tabs.find((tab) => tab._id === tabId);
        if (
            !currentTab ||
            !normalizedName ||
            normalizedName === currentTab.name
        )
            return;

        const previousName = currentTab.name;
        setTabs((currentTabs) =>
            currentTabs.map((tab) =>
                tab._id === tabId ? { ...tab, name: normalizedName } : tab
            )
        );
        try {
            await updateTabRequest(tabId, { name: normalizedName });
        } catch {
            setTabs((currentTabs) =>
                currentTabs.map((tab) =>
                    tab._id === tabId && tab.name === normalizedName
                        ? { ...tab, name: previousName }
                        : tab
                )
            );
            onMutationError?.();
        }
    };

    const reorderTabs = async (
        draggedTabId: string,
        targetTabId: string,
        position: 'before' | 'after' = 'before'
    ) => {
        if (draggedTabId === targetTabId) return;
        const previousOrder = new Map(
            tabs.map((tab) => [tab._id, tab.order] as const)
        );
        const nextTabs = [...tabs];
        const sourceIndex = nextTabs.findIndex(
            (tab) => tab._id === draggedTabId
        );
        const targetIndex = nextTabs.findIndex(
            (tab) => tab._id === targetTabId
        );
        if (sourceIndex < 0 || targetIndex < 0) return;

        const [movedTab] = nextTabs.splice(sourceIndex, 1);
        const adjustedTargetIndex =
            sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
        const insertIndex =
            position === 'after'
                ? adjustedTargetIndex + 1
                : adjustedTargetIndex;
        nextTabs.splice(insertIndex, 0, movedTab);
        const orderedTabs = nextTabs.map((tab, index) => ({
            ...tab,
            order: index + 1,
        }));
        const optimisticOrder = new Map(
            orderedTabs.map((tab) => [tab._id, tab.order] as const)
        );
        setTabs(orderedTabs);
        try {
            await reorderTabsRequest(orderedTabs.map((tab) => tab._id));
        } catch {
            setTabs((currentTabs) =>
                currentTabs
                    .map((tab) =>
                        previousOrder.has(tab._id) &&
                        tab.order === optimisticOrder.get(tab._id)
                            ? { ...tab, order: previousOrder.get(tab._id)! }
                            : tab
                    )
                    .sort((a, b) => a.order - b.order)
            );
            onMutationError?.();
        }
    };

    const removeTab = async (tabId: string) => {
        if (tabs.length <= 1) return false;
        const deletedIndex = tabs.findIndex((tab) => tab._id === tabId);
        if (deletedIndex < 0) return false;
        const removedTab = tabs[deletedIndex];
        const nextTabs = tabs
            .filter((tab) => tab._id !== tabId)
            .map((tab, index) => ({ ...tab, order: index + 1 }));
        setTabs(nextTabs);
        const fallbackActiveTabId =
            nextTabs[Math.min(deletedIndex, nextTabs.length - 1)]?._id || null;
        if (activeTabId === tabId) setActiveTabId(fallbackActiveTabId);

        try {
            await deleteTabRequest(tabId);
            return true;
        } catch {
            setTabs((currentTabs) => {
                if (currentTabs.some((tab) => tab._id === tabId)) {
                    return currentTabs;
                }
                const restored = [...currentTabs];
                restored.splice(
                    Math.min(deletedIndex, restored.length),
                    0,
                    removedTab
                );
                return restored.map((tab, index) => ({
                    ...tab,
                    order: index + 1,
                }));
            });
            setActiveTabId((current) =>
                activeTabId === tabId && current === fallbackActiveTabId
                    ? tabId
                    : current
            );
            onMutationError?.();
            return false;
        }
    };

    useEffect(() => {
        loadTabs();
    }, [loadTabs]);

    return {
        tabs,
        activeTabId,
        isLoadingTabs,
        hasLoadedTabs,
        setActiveTabId,
        addTab,
        renameTab,
        customizeTab: patchTab,
        setTabShareToken,
        reorderTabs,
        removeTab,
        loadTabs,
    };
};
