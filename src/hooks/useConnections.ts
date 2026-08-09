import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createConnection,
    deleteConnection,
    fetchConnections,
    updateConnection,
} from '../services/boardApi';
import { CardLink, CardLinkKind } from '../types/boardTypes';

export const useConnections = (
    activeTabId: string | null,
    onLoadError?: () => void,
    onMutationError?: () => void
) => {
    const [linksByTab, setLinksByTab] = useState<Record<string, CardLink[]>>(
        {}
    );
    const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set());
    const [loadingTabs, setLoadingTabs] = useState<Set<string>>(
        () => new Set()
    );

    const links = useMemo(
        () => (activeTabId ? linksByTab[activeTabId] || [] : []),
        [activeTabId, linksByTab]
    );

    const loadLinks = useCallback(
        async (tabId: string) => {
            setLoadingTabs((current) => new Set(current).add(tabId));
            try {
                const loaded = await fetchConnections(tabId);
                setLinksByTab((current) => ({
                    ...current,
                    [tabId]: loaded,
                }));
            } catch {
                onLoadError?.();
            } finally {
                setLoadedTabs((current) => new Set(current).add(tabId));
                setLoadingTabs((current) => {
                    const next = new Set(current);
                    next.delete(tabId);
                    return next;
                });
            }
        },
        [onLoadError]
    );

    const addLink = useCallback(
        async (
            sourceId: string,
            targetId: string,
            kind: CardLinkKind = 'arrow'
        ): Promise<void> => {
            if (!activeTabId || sourceId === targetId) return;

            const existing = linksByTab[activeTabId] || [];
            // Avoid duplicates in either direction (an arrow already links them).
            const duplicate = existing.some(
                (link) =>
                    (link.sourceId === sourceId &&
                        link.targetId === targetId) ||
                    (link.sourceId === targetId && link.targetId === sourceId)
            );
            if (duplicate) return;

            let link: CardLink;
            try {
                link = await createConnection({
                    tabId: activeTabId,
                    sourceId,
                    targetId,
                    kind,
                });
            } catch {
                onMutationError?.();
                return;
            }
            if (!link || !link._id) return;

            setLinksByTab((current) => ({
                ...current,
                [activeTabId]: [...(current[activeTabId] || []), link],
            }));
        },
        [activeTabId, linksByTab, onMutationError]
    );

    const patchLinkLocal = useCallback(
        (linkId: string, updates: Partial<CardLink>) => {
            if (!activeTabId) return;
            setLinksByTab((current) => ({
                ...current,
                [activeTabId]: (current[activeTabId] || []).map((link) =>
                    link._id === linkId ? { ...link, ...updates } : link
                ),
            }));
        },
        [activeTabId]
    );

    const relabelLink = useCallback(
        async (linkId: string, label: string): Promise<void> => {
            const trimmed = label.trim().slice(0, 60);
            const previous = activeTabId
                ? (linksByTab[activeTabId] || []).find(
                      (link) => link._id === linkId
                  )
                : undefined;
            if (!previous) return;
            patchLinkLocal(linkId, { label: trimmed });
            try {
                await updateConnection(linkId, { label: trimmed });
            } catch {
                patchLinkLocal(linkId, { label: previous.label });
                onMutationError?.();
            }
        },
        [activeTabId, linksByTab, onMutationError, patchLinkLocal]
    );

    const removeLink = useCallback(
        async (linkId: string): Promise<void> => {
            if (!activeTabId) return;
            const currentLinks = linksByTab[activeTabId] || [];
            const removedIndex = currentLinks.findIndex(
                (link) => link._id === linkId
            );
            const removed = currentLinks[removedIndex];
            if (!removed) return;
            setLinksByTab((current) => ({
                ...current,
                [activeTabId]: (current[activeTabId] || []).filter(
                    (link) => link._id !== linkId
                ),
            }));
            try {
                await deleteConnection(linkId);
            } catch {
                setLinksByTab((current) => {
                    const next = [...(current[activeTabId] || [])];
                    if (!next.some((link) => link._id === linkId)) {
                        next.splice(
                            Math.min(removedIndex, next.length),
                            0,
                            removed
                        );
                    }
                    return { ...current, [activeTabId]: next };
                });
                onMutationError?.();
            }
        },
        [activeTabId, linksByTab, onMutationError]
    );

    const restoreLinksLocal = useCallback(
        (links: CardLink[]) => {
            if (!activeTabId || links.length === 0) return;
            setLinksByTab((current) => {
                const existing = current[activeTabId] || [];
                const existingIds = new Set(existing.map((link) => link._id));
                return {
                    ...current,
                    [activeTabId]: [
                        ...existing,
                        ...links.filter((link) => !existingIds.has(link._id)),
                    ],
                };
            });
        },
        [activeTabId]
    );

    // Links touching a card, used to snapshot them before the card is deleted.
    const getLinksForCard = useCallback(
        (cardId: string): CardLink[] => {
            if (!activeTabId) return [];
            return (linksByTab[activeTabId] || []).filter(
                (link) => link.sourceId === cardId || link.targetId === cardId
            );
        },
        [activeTabId, linksByTab]
    );

    // Drop a deleted card's links from the local cache (the server already
    // cascade-deleted them); keeps the canvas free of dangling arrows.
    const dropLinksForCard = useCallback(
        (cardId: string) => {
            if (!activeTabId) return;
            setLinksByTab((current) => ({
                ...current,
                [activeTabId]: (current[activeTabId] || []).filter(
                    (link) =>
                        link.sourceId !== cardId && link.targetId !== cardId
                ),
            }));
        },
        [activeTabId]
    );

    // Re-create previously deleted links (on undo of a card deletion). The
    // restore path re-inserts the card with its id, so source/target stay valid;
    // new link ids are fine since links are not part of the undo history.
    const restoreLinks = useCallback(
        async (links: CardLink[]): Promise<void> => {
            if (!activeTabId || links.length === 0) return;
            const recreated: CardLink[] = [];
            for (const link of links) {
                const created = await createConnection({
                    tabId: link.tabId,
                    sourceId: link.sourceId,
                    targetId: link.targetId,
                    label: link.label,
                    kind: link.kind,
                });
                if (created && created._id) recreated.push(created);
            }
            if (recreated.length === 0) return;
            setLinksByTab((current) => ({
                ...current,
                [activeTabId]: [...(current[activeTabId] || []), ...recreated],
            }));
        },
        [activeTabId]
    );

    useEffect(() => {
        if (
            activeTabId &&
            !loadedTabs.has(activeTabId) &&
            !loadingTabs.has(activeTabId)
        ) {
            loadLinks(activeTabId);
        }
    }, [activeTabId, loadLinks, loadedTabs]);

    return {
        links,
        isLoadingConnections: activeTabId
            ? loadingTabs.has(activeTabId)
            : false,
        addLink,
        relabelLink,
        removeLink,
        getLinksForCard,
        dropLinksForCard,
        restoreLinksLocal,
        restoreLinks,
    };
};
