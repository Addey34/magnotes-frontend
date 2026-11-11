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
    counts?: {
        tabs?: number;
        stacks?: number;
        cards?: number;
        connections?: number;
        skipped?: number;
    };
    skippedItems?: { kind: string; id: string; reason: string }[];
    idMap?: { tabs?: Record<string, string> };
}

/** What the visitor gets to see after an import reached the account. */
export interface DemoImportSummary {
    boards: number;
    cards: number;
    // Server id of the first imported board, so the UI can open it.
    focusTabId?: string;
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
    | ({ status: 'complete' } & DemoImportSummary)
    // Server wrote everything importable but left `skipped` items out: the
    // local copy is kept until the visitor decides.
    | ({ status: 'partial'; skipped: number } & Partial<DemoImportSummary>)
    // The pending import belongs to another account: left untouched.
    | { status: 'other-account' }
    // The answer belongs to an import that is no longer the current one.
    | { status: 'stale' }
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

const isCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * The server's confirmation must account for everything that was sent. Counts
 * that are absent, malformed or that do not add up are never trusted: the local
 * copy is the only one left, so doubt keeps it.
 *
 * Boards are never skipped. Stacks, cards and links are either written or
 * skipped, so written + skipped must equal what was sent (the per-kind split of
 * skipped items is capped server-side, hence the sum).
 */
export function verifyImportConfirmation(
    snapshot: DemoSnapshot,
    response: DemoImportResponse
): { skipped: number; summary: DemoImportSummary } | null {
    const counts = response.counts;
    if (!counts) return null;
    const { tabs, stacks, cards, connections, skipped } = counts;
    if (
        !isCount(tabs) ||
        !isCount(stacks) ||
        !isCount(cards) ||
        !isCount(connections) ||
        !isCount(skipped)
    ) {
        return null;
    }
    if (tabs !== snapshot.tabs.length) return null;
    const sent =
        snapshot.stacks.length +
        snapshot.postIts.length +
        snapshot.connections.length;
    if (stacks + cards + connections + skipped !== sent) return null;
    // Per kind: nothing can be written beyond what was sent, so a shortfall in
    // one kind can never be hidden by a surplus in another.
    if (
        stacks > snapshot.stacks.length ||
        cards > snapshot.postIts.length ||
        connections > snapshot.connections.length
    ) {
        return null;
    }
    if ((response.skippedItems?.length ?? 0) > skipped) return null;

    const idMap = response.idMap?.tabs;
    if (!idMap) return null;
    for (const tab of snapshot.tabs) {
        const mapped = idMap[tab._id];
        if (typeof mapped !== 'string' || mapped.length === 0) return null;
    }
    const first = [...snapshot.tabs].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
    )[0];
    return {
        skipped,
        summary: {
            boards: tabs,
            cards,
            focusTabId: first ? idMap[first._id] : undefined,
        },
    };
}

// One run at a time per page: a double click or a retry racing the login
// import must not send the same request twice from this tab. Other tabs are
// covered by the server-side idempotency.
let inFlight: { userId: string; run: Promise<DemoImportOutcome> } | null = null;

export function runDemoImport(
    userId: string,
    deps: DemoImportDeps
): Promise<DemoImportOutcome> {
    // Shared only with the same account: another account signing in meanwhile
    // must get its own answer (the pending import is bound to the first one),
    // never the confirmation of an import that is not its own.
    if (!inFlight || inFlight.userId !== userId) {
        const run: Promise<DemoImportOutcome> = attempt(userId, deps).finally(
            () => {
                if (inFlight?.run === run) inFlight = null;
            }
        );
        inFlight = { userId, run };
    }
    return inFlight.run;
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

    // The answer below is about THIS attempt only. While the request was in
    // flight the page may have started another import (new id), the sandbox may
    // have gained notes, or another tab may have finished or dropped this one.
    // An answer for a superseded attempt must neither erase local data nor
    // overwrite the state of a newer one.
    const isStillCurrentAttempt = () => {
        const live = loadDemoImportState();
        return (
            live !== null &&
            live.importId === current.importId &&
            live.userId === userId &&
            live.snapshotHash === hash
        );
    };

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
        if (!isStillCurrentAttempt()) return { status: 'stale' };
        const reason = classifyImportError(error);
        saveDemoImportState({
            ...current,
            ...(loadDemoImportState() ?? {}),
            userId,
            lastError: reason,
            updatedAt: now(),
        });
        return { status: 'failed', reason };
    }

    if (!isStillCurrentAttempt()) return { status: 'stale' };

    const verified = verifyImportConfirmation(snapshot, response);
    if (!verified) {
        // "complete" that does not match what was sent: keep the local copy.
        saveDemoImportState({
            ...current,
            lastError: 'unknown',
            updatedAt: now(),
        });
        return { status: 'failed', reason: 'unknown' };
    }
    const { skipped, summary } = verified;
    if (skipped > 0) {
        // Never wipe what the server did not take.
        saveDemoImportState({
            ...current,
            lastError: undefined,
            partial: { skipped },
            updatedAt: now(),
        });
        return { status: 'partial', skipped, ...summary };
    }

    // Confirmed with nothing left out: only now is the local copy disposable —
    // and only if it is still exactly what was sent under this import.
    if (hashSnapshot(deps.getSnapshot()) !== hash) return { status: 'stale' };
    deps.resetLocal();
    clearDemoImportState();
    return { status: 'complete', ...summary };
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
