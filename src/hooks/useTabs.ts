import { useCallback, useEffect, useState } from 'react';
import {
    createTab as createTabRequest,
    deleteTab as deleteTabRequest,
    fetchTabs,
    reorderTabs as reorderTabsRequest,
    updateTab as updateTabRequest,
} from '../services/boardApi';
import { BoardTab } from '../types/boardTypes';

const TAB_COLORS = ['#facc15', '#38bdf8', '#fb7185', '#4ade80', '#c084fc'];
// Colourful emoji default so the board's "logo" stays visible on every theme
// (the legacy monochrome glyphs were tinted by tab.color and washed out on
// light/cork themes). Existing 'home'/'work'/… tabs keep their glyph.
const DEFAULT_TAB_ICON = '📝';

type TabCustomization = Partial<
    Pick<BoardTab, 'color' | 'theme' | 'icon'>
> & { backgroundColor?: string | null };

const normalizeTabs = (tabs: BoardTab[]) =>
    tabs.map((tab) => ({ ...tab, icon: tab.icon || DEFAULT_TAB_ICON }));

export const useTabs = (
    onLoadError?: () => void,
    onMutationError?: () => void
) => {
    const [tabs, setTabs] = useState<BoardTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [isLoadingTabs, setIsLoadingTabs] = useState(false);

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
        } catch {
            onLoadError?.();
        } finally {
            setIsLoadingTabs(false);
        }
    }, [onLoadError]);

    const addTab = async (backgroundColor?: string) => {
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
    };

    const patchTab = async (tabId: string, updates: TabCustomization) => {
        const previousTabs = tabs;
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
                                  : updates.backgroundColor ??
                                    tab.backgroundColor,
                      }
                    : tab
            )
        );
        try {
            await updateTabRequest(tabId, updates);
        } catch {
            setTabs(previousTabs);
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
        if (!normalizedName || normalizedName === currentTab?.name) return;

        const previousTabs = tabs;
        setTabs((currentTabs) =>
            currentTabs.map((tab) =>
                tab._id === tabId ? { ...tab, name: normalizedName } : tab
            )
        );
        try {
            await updateTabRequest(tabId, { name: normalizedName });
        } catch {
            setTabs(previousTabs);
            onMutationError?.();
        }
    };

    const reorderTabs = async (draggedTabId: string, targetTabId: string) => {
        if (draggedTabId === targetTabId) return;
        const previousTabs = tabs;
        const nextTabs = [...tabs];
        const sourceIndex = nextTabs.findIndex(
            (tab) => tab._id === draggedTabId
        );
        const targetIndex = nextTabs.findIndex((tab) => tab._id === targetTabId);
        if (sourceIndex < 0 || targetIndex < 0) return;

        const [movedTab] = nextTabs.splice(sourceIndex, 1);
        nextTabs.splice(targetIndex, 0, movedTab);
        const orderedTabs = nextTabs.map((tab, index) => ({
            ...tab,
            order: index + 1,
        }));
        setTabs(orderedTabs);
        try {
            await reorderTabsRequest(orderedTabs.map((tab) => tab._id));
        } catch {
            setTabs(previousTabs);
            onMutationError?.();
        }
    };

    const removeTab = async (tabId: string) => {
        if (tabs.length <= 1) return false;
        const previousTabs = tabs;
        const deletedIndex = tabs.findIndex((tab) => tab._id === tabId);
        const nextTabs = tabs
            .filter((tab) => tab._id !== tabId)
            .map((tab, index) => ({ ...tab, order: index + 1 }));
        setTabs(nextTabs);
        if (activeTabId === tabId) {
            setActiveTabId(
                nextTabs[Math.min(deletedIndex, nextTabs.length - 1)]?._id ||
                    null
            );
        }

        try {
            await deleteTabRequest(tabId);
            return true;
        } catch {
            setTabs(previousTabs);
            setActiveTabId(activeTabId);
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
