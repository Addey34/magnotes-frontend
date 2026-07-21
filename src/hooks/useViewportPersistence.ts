import { useEffect, useRef } from 'react';
import { updateTab } from '../services/boardApi';
import { BoardTab } from '../types/boardTypes';
import { BoardBounds, BoardPoint } from './useBoardViewport';
import { readViewport, writeViewport } from './viewportStorage';

const LOCAL_DEBOUNCE_MS = 200;
const SERVER_DEBOUNCE_MS = 1500;

interface ViewportPersistenceParams {
    activeTabId: string | null;
    tabs: BoardTab[];
    zoom: number;
    offset: BoardPoint;
    isLoading: boolean;
    contentBounds: BoardBounds | null;
    setViewport: (next: { zoom: number; offset: BoardPoint }) => void;
    focusBounds: (bounds: BoardBounds | null) => void;
}

/**
 * Remembers each board's pan/zoom across sessions and devices.
 *
 * Restore priority on tab open:
 *   1. Server-persisted viewport from the BoardTab record (synced across devices).
 *   2. Local localStorage fallback (in case the tab was never saved server-side).
 *   3. Auto-frame the board's content (first-open behavior).
 *
 * After the viewport is settled, changes are written to both localStorage
 * (200 ms debounce, instant feel) and the server (1500 ms debounce, avoids
 * spamming the API while panning).
 */
export function useViewportPersistence({
    activeTabId,
    tabs,
    zoom,
    offset,
    isLoading,
    contentBounds,
    setViewport,
    focusBounds,
}: ViewportPersistenceParams): void {
    const claimedTabRef = useRef<string | null>(null);

    // On tab switch: restore saved viewport or auto-frame.
    useEffect(() => {
        if (!activeTabId || isLoading) return;
        if (claimedTabRef.current === activeTabId) return;

        // 1. Server-persisted viewport (cross-device).
        const serverTab = tabs.find((t) => t._id === activeTabId);
        if (serverTab?.viewport) {
            setViewport({
                zoom: serverTab.viewport.zoom,
                offset: { x: serverTab.viewport.x, y: serverTab.viewport.y },
            });
            claimedTabRef.current = activeTabId;
            return;
        }

        // 2. localStorage fallback.
        const local = readViewport(activeTabId);
        if (local) {
            setViewport(local);
            claimedTabRef.current = activeTabId;
            return;
        }

        // 3. Auto-frame content.
        const frame = window.requestAnimationFrame(() => {
            focusBounds(contentBounds);
            claimedTabRef.current = activeTabId;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeTabId, isLoading, tabs, contentBounds, focusBounds, setViewport]);

    // Persist viewport changes for the active tab.
    useEffect(() => {
        if (!activeTabId || claimedTabRef.current !== activeTabId) return;

        const localTimeout = window.setTimeout(() => {
            writeViewport(activeTabId, { zoom, offset });
        }, LOCAL_DEBOUNCE_MS);

        const serverTimeout = window.setTimeout(() => {
            updateTab(activeTabId, {
                viewport: { x: offset.x, y: offset.y, zoom },
            }).catch(() => {});
        }, SERVER_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(localTimeout);
            window.clearTimeout(serverTimeout);
        };
    }, [activeTabId, zoom, offset]);
}
