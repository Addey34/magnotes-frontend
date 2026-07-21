import { ViewportPoint, ViewportState } from './viewportMath';

/**
 * Per-board viewport persistence. Each tab remembers its own zoom/offset so
 * switching back restores the previous pan/zoom instead of re-framing. Parsing
 * is defensive (bad/legacy localStorage entries are ignored) and storage is
 * injectable so the logic can be unit tested without a DOM — see
 * viewportStorage.test.ts.
 */

const KEY_PREFIX = 'magnotes-viewport:';

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function getStorage(explicit?: StorageLike): StorageLike | null {
    if (explicit) return explicit;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isValidViewport(value: unknown): value is ViewportState {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as { zoom?: unknown; offset?: unknown };
    if (!isFiniteNumber(candidate.zoom)) return false;
    const offset = candidate.offset as ViewportPoint | undefined;
    return (
        !!offset &&
        typeof offset === 'object' &&
        isFiniteNumber(offset.x) &&
        isFiniteNumber(offset.y)
    );
}

export function parseViewport(raw: string | null): ViewportState | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (isValidViewport(parsed)) {
            return {
                zoom: parsed.zoom,
                offset: { x: parsed.offset.x, y: parsed.offset.y },
            };
        }
    } catch {
        // Corrupt entry — treat as absent.
    }
    return null;
}

export function readViewport(
    tabId: string,
    storage?: StorageLike
): ViewportState | null {
    const store = getStorage(storage);
    if (!store) return null;
    return parseViewport(store.getItem(KEY_PREFIX + tabId));
}

export function writeViewport(
    tabId: string,
    state: ViewportState,
    storage?: StorageLike
): void {
    const store = getStorage(storage);
    if (!store) return;
    store.setItem(
        KEY_PREFIX + tabId,
        JSON.stringify({ zoom: state.zoom, offset: state.offset })
    );
}

export function clearViewport(tabId: string, storage?: StorageLike): void {
    const store = getStorage(storage);
    if (!store) return;
    store.removeItem(KEY_PREFIX + tabId);
}
