/**
 * Orchestration of a recoverable demo → account import.
 *
 * The server owns idempotency (PUT /api/imports/:importId): this module only
 * guarantees the client side of the contract — the same importId is replayed
 * until the server confirms completion, local data is wiped only after a
 * confirmation that left nothing out, progress survives reloads, and a failure
 * is reported instead of thrown so it can never block the session.
 *
 * Dependencies are injected so every interruption scenario is unit-testable
 * (see demoImportFlow.test.ts); demoImportRuntime.ts wires the real ones.
 */

import type { DemoSnapshot } from './demoBoard';
import {
    clearDemoImportState,
    DemoImportFailure,
    hashSnapshot,
    loadDemoImportState,
    newImportId,
    saveDemoImportState,
} from './demoImportState';

export interface DemoImportResponse {
    importId: string;
    status: string;
    counts?: { skipped?: number };
    skippedItems?: { kind: string; id: string; reason: string }[];
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
    // Server wrote everything importable but left `skipped` items out: the
    // local copy is kept until the visitor decides.
    | { status: 'partial'; skipped: number }
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
    let state = loadDemoImportState();
    if (!state || state.abandoned) return { status: 'none' };

    // Already confirmed with leftovers: wait for the visitor's decision.
    if (state.partial) {
        return { status: 'partial', skipped: state.partial.skipped };
    }

    const now = () => new Date().toISOString();

    if (state.userId && state.userId !== userId) {
        // Only an explicit new signup request may move on to another account.
        // The server scopes ids per user, so a fresh id cannot duplicate there.
        if (!state.revived) return { status: 'other-account' };
        state = { importId: newImportId(), attempts: 0, updatedAt: now() };
    }

    const snapshot = deps.getSnapshot();
    if (snapshot.tabs.length === 0) {
        // Nothing left locally (e.g. a crash right after a confirmed import).
        clearDemoImportState();
        return { status: 'none' };
    }

    const hash = hashSnapshot(snapshot);
    if (state.revived && state.snapshotHash && state.snapshotHash !== hash) {
        // The sandbox changed since the abandoned attempt: it is new content,
        // not a replay, so the old identity (bound to other content) is dropped.
        state = { importId: newImportId(), attempts: 0, updatedAt: now() };
    }

    const current = {
        ...state,
        userId,
        snapshotHash: hash,
        revived: false,
        attempts: state.attempts + 1,
        updatedAt: now(),
    };
    saveDemoImportState(current);

    let response: DemoImportResponse;
    try {
        response = await deps.putImport(current.importId, snapshot);
        if (
            !response ||
            response.status !== 'complete' ||
            response.importId !== current.importId
        ) {
            throw new Error('Import not confirmed by the server');
        }
    } catch (error) {
        const reason = classifyImportError(error);
        saveDemoImportState({
            ...(loadDemoImportState() ?? current),
            userId,
            lastError: reason,
            updatedAt: now(),
        });
        return { status: 'failed', reason };
    }

    const skipped = Math.max(
        response.counts?.skipped ?? 0,
        response.skippedItems?.length ?? 0
    );
    if (skipped > 0) {
        // Never wipe what the server did not take.
        saveDemoImportState({
            ...current,
            lastError: undefined,
            partial: { skipped },
            updatedAt: now(),
        });
        return { status: 'partial', skipped };
    }

    // Confirmed with nothing left out: only now is the local copy disposable.
    deps.resetLocal();
    clearDemoImportState();
    return { status: 'complete' };
}

/**
 * Visitor walks away from the import. Local data is kept. When an attempt
 * already reached the server, the id and content fingerprint are remembered so
 * asking again with the same content replays the same import (no duplicates).
 */
export function dismissDemoImport(): void {
    const state = loadDemoImportState();
    if (!state) return;
    if (!state.snapshotHash) {
        clearDemoImportState(); // nothing was ever sent
        return;
    }
    saveDemoImportState({
        ...state,
        abandoned: true,
        revived: false,
        updatedAt: new Date().toISOString(),
    });
}

/**
 * Explicit visitor decision after a partial import: erase the local copy
 * (the importable part already lives in the account).
 */
export function eraseLocalAfterPartialImport(resetLocal: () => void): void {
    resetLocal();
    clearDemoImportState();
}
