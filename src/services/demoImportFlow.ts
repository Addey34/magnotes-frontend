/**
 * Orchestration of a recoverable demo → account import.
 *
 * The server owns idempotency (PUT /api/imports/:importId): this module only
 * guarantees the client side of the contract — the same importId is replayed
 * until the server confirms completion, local data is wiped only after that
 * confirmation, progress survives reloads, and a failure is reported instead
 * of thrown so login is never blocked.
 *
 * Dependencies are injected so every interruption scenario is unit-testable
 * (see demoImportFlow.test.ts); demoImportRuntime.ts wires the real ones.
 */

import type { DemoSnapshot } from './demoBoard';
import {
    clearDemoImportState,
    DemoImportFailure,
    loadDemoImportState,
    saveDemoImportState,
} from './demoImportState';

export interface DemoImportResponse {
    importId: string;
    status: string;
}

export interface DemoImportDeps {
    getSnapshot(): DemoSnapshot;
    resetLocal(): void;
    putImport(
        importId: string,
        snapshot: DemoSnapshot
    ): Promise<DemoImportResponse>;
}

export type DemoImportOutcome =
    | { status: 'none' }
    | { status: 'complete' }
    // The pending import belongs to another account: left untouched.
    | { status: 'other-account' }
    | { status: 'failed'; reason: DemoImportFailure };

export function classifyImportError(error: unknown): DemoImportFailure {
    const e = error as {
        response?: { status?: number };
        request?: unknown;
        code?: string;
    };
    const status = e?.response?.status;
    if (status === undefined) {
        return e?.request || e?.code ? 'network' : 'unknown';
    }
    if (status === 409) return 'conflict';
    if (status === 404 || status === 502 || status === 503 || status === 504) {
        return 'unavailable';
    }
    if (status === 400 || status === 413) return 'rejected';
    if (status === 401 || status === 408 || status === 429 || status >= 500) {
        return 'network';
    }
    return 'unknown';
}

// One run at a time per page: a double click or a retry racing the login
// import must not send the same request twice from this tab. Other tabs are
// covered by the server-side idempotency.
let inFlight: Promise<DemoImportOutcome> | null = null;

export function runDemoImport(
    userId: string,
    deps: DemoImportDeps
): Promise<DemoImportOutcome> {
    if (!inFlight) {
        inFlight = attempt(userId, deps).finally(() => {
            inFlight = null;
        });
    }
    return inFlight;
}

async function attempt(
    userId: string,
    deps: DemoImportDeps
): Promise<DemoImportOutcome> {
    const state = loadDemoImportState();
    if (!state) return { status: 'none' };

    if (state.userId && state.userId !== userId) {
        return { status: 'other-account' };
    }

    const snapshot = deps.getSnapshot();
    if (snapshot.tabs.length === 0) {
        // Nothing left locally (e.g. a crash right after a confirmed import).
        clearDemoImportState();
        return { status: 'none' };
    }

    saveDemoImportState({
        ...state,
        userId,
        attempts: state.attempts + 1,
        updatedAt: new Date().toISOString(),
    });

    try {
        const response = await deps.putImport(state.importId, snapshot);
        if (
            !response ||
            response.status !== 'complete' ||
            response.importId !== state.importId
        ) {
            throw new Error('Import not confirmed by the server');
        }
    } catch (error) {
        const reason = classifyImportError(error);
        const current = loadDemoImportState() ?? state;
        saveDemoImportState({
            ...current,
            userId,
            lastError: reason,
            updatedAt: new Date().toISOString(),
        });
        return { status: 'failed', reason };
    }

    // Confirmed: only now is the local copy disposable.
    deps.resetLocal();
    clearDemoImportState();
    return { status: 'complete' };
}

/** Visitor chose to abandon the import: keep local data, drop the pending id. */
export function dismissDemoImport(): void {
    clearDemoImportState();
}
