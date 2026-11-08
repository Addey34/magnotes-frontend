/**
 * Persistent progress of the demo → account import.
 *
 * Stored in localStorage (not sessionStorage) so a reload, a closed tab or a
 * crash never loses the import identity: the same `importId` is replayed until
 * the server confirms completion, which is what lets the server recognise
 * already-written resources instead of duplicating them.
 *
 * `userId` binds the import to the first account that attempted it, so a
 * sandbox pending for one account is never pushed into another one.
 */

const STATE_KEY = 'magnotes-demo-import-v1';

export type DemoImportFailure =
    'network' | 'unavailable' | 'rejected' | 'conflict' | 'unknown';

export interface DemoImportState {
    importId: string;
    userId?: string;
    attempts: number;
    lastError?: DemoImportFailure;
    // Fingerprint of the sandbox content sent under `importId`.
    snapshotHash?: string;
    // Visitor walked away from the import (the sandbox is kept). The id is kept
    // too, so asking again with the same content replays the SAME import
    // instead of creating a second copy of whatever already reached the server.
    abandoned?: boolean;
    // Visitor explicitly asked again (signup click) after an abandon or from a
    // possibly different account: allows a fresh id if content or account changed.
    revived?: boolean;
    // Server confirmed but left items out: local data must be kept.
    partial?: { skipped: number };
    updatedAt: string;
}

/** Cheap, stable, non-cryptographic fingerprint (change detection only). */
export function hashSnapshot(value: unknown): string {
    const text = JSON.stringify(value) ?? '';
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 =
        Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
        Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 =
        Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
        Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// Same shape the API accepts: a v4 UUID.
export function newImportId(): string {
    const c = typeof crypto !== 'undefined' ? crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') {
        c.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 16; i += 1) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10).join(''),
    ].join('-');
}

// When localStorage is unavailable (private mode, blocked storage) progress
// still survives for the life of the page.
let memoryState: DemoImportState | null = null;

function isState(value: unknown): value is DemoImportState {
    const v = value as Partial<DemoImportState> | null;
    return (
        !!v &&
        typeof v === 'object' &&
        typeof v.importId === 'string' &&
        v.importId.length > 0 &&
        typeof v.attempts === 'number'
    );
}

export function loadDemoImportState(): DemoImportState | null {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        // Storage works and holds nothing: that is the truth (the in-memory
        // copy is only a fallback for when storage itself is unavailable).
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        return isState(parsed) ? parsed : null;
    } catch {
        return memoryState;
    }
}

export function saveDemoImportState(state: DemoImportState): void {
    memoryState = state;
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
        /* kept in memory only */
    }
}

export function clearDemoImportState(): void {
    memoryState = null;
    try {
        localStorage.removeItem(STATE_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Called when the visitor asks to sign up from the demo. Never replaces an
 * existing id (so no accidental second copy); it only re-arms an abandoned or
 * partial import and flags the explicit request.
 */
export function ensureDemoImportState(): DemoImportState {
    const existing = loadDemoImportState();
    if (existing) {
        const revived: DemoImportState = {
            ...existing,
            abandoned: false,
            revived: true,
            partial: undefined,
            updatedAt: new Date().toISOString(),
        };
        saveDemoImportState(revived);
        return revived;
    }
    const created: DemoImportState = {
        importId: newImportId(),
        attempts: 0,
        updatedAt: new Date().toISOString(),
    };
    saveDemoImportState(created);
    return created;
}
