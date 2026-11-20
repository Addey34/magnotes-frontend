/**
 * MGN-DATA-01 / D2-S2 + S3 (+ D2-REV1) — recovery of the journal after an
 * interruption.
 *
 *  - reading the local base, taking an operation over and recovering after the
 *    interruption of its owner are three different things: a record written
 *    by another tab is taken over only once that tab is PROVEN dead (its Web
 *    Lock is gone) AND through an exclusive compare-and-set; when liveness
 *    cannot be proven (no Web Locks, query failing) nothing is taken
 *    automatically, the record is listed for an explicit decision; age is
 *    never a proof of death;
 *  - a recovered ambiguous operation is replayed with the same mutation id,
 *    resource, base and body, once, never with an unconditional write; a read
 *    of the card proves nothing;
 *  - what cannot be resolved is kept and handed to the user.
 */

import {
    acknowledgedIdOf,
    closeIdentity,
    getCapability,
    markAmbiguous,
    OperationContext,
    restoreIdentity,
    sameContext,
} from './mutationProtocol';
import { contextNow } from './operationContext';
import {
    ConflictReason,
    ConflictRecord,
    DraftRecord,
    JournalSnapshot,
    LocalJournal,
    OpRecord,
} from './localJournal';
import { probeCapability, updatePostIt } from './boardApi';
import { StaleLifecycleError } from './concurrencyOutcome';

const LOCK_PREFIX = 'magnotes-journal-writer:';

const locksApi = (): LockManager | undefined =>
    (globalThis.navigator as Navigator | undefined)?.locks;

/** Holds this page's writer lock for as long as the page lives. */
export function holdWriterLock(journal: LocalJournal): void {
    const locks = locksApi();
    if (!locks) return;
    void locks
        .request(
            LOCK_PREFIX + journal.writer,
            () => new Promise<void>(() => {})
        )
        .catch(() => undefined);
}

/** true: alive · false: proven dead · undefined: cannot tell. */
export async function writerAlive(
    writer: string
): Promise<boolean | undefined> {
    const locks = locksApi();
    if (!locks?.query) return undefined;
    try {
        const { held = [] } = await locks.query();
        return held.some((lock) => lock.name === LOCK_PREFIX + writer);
    } catch {
        return undefined;
    }
}

export interface Recoverable {
    /** mine, or written by a page PROVEN dead: may be taken over */
    drafts: DraftRecord[];
    ops: OpRecord[];
    conflicts: ConflictRecord[];
    /** liveness cannot be proven: listed, never taken automatically */
    undetermined: Array<DraftRecord | OpRecord>;
    /** written by tabs proven alive: shown nowhere, never taken */
    foreign: number;
    invalid: number;
}

/** What this page may take over for the owner (and what it must leave). */
export async function collectRecoverable(
    journal: LocalJournal,
    owner: string
): Promise<Recoverable> {
    const snap: JournalSnapshot = await journal.read(owner);
    const verdicts = new Map<string, boolean | undefined>();
    const standing = async (record: {
        writer: string;
    }): Promise<'mine' | 'dead' | 'alive' | 'unknown'> => {
        if (record.writer === journal.writer) return 'mine';
        if (!verdicts.has(record.writer)) {
            verdicts.set(record.writer, await writerAlive(record.writer));
        }
        const alive = verdicts.get(record.writer);
        if (alive === false) return 'dead';
        if (alive === true) return 'alive';
        return 'unknown';
    };
    const out: Recoverable = {
        drafts: [],
        ops: [],
        conflicts: snap.conflicts,
        undetermined: [],
        foreign: 0,
        invalid: snap.invalid,
    };
    for (const draft of snap.drafts) {
        const who = await standing(draft);
        if (who === 'mine' || who === 'dead') out.drafts.push(draft);
        else if (who === 'unknown') out.undetermined.push(draft);
        else out.foreign += 1;
    }
    for (const op of snap.ops) {
        const who = await standing(op);
        if (who === 'mine' || who === 'dead') out.ops.push(op);
        else if (who === 'unknown') out.undetermined.push(op);
        else out.foreign += 1;
    }
    return out;
}

export type ReplayVerdict =
    | 'applied'
    | 'refused'
    | 'uncertain'
    | 'not-replayable'
    | 'stale'
    | 'context';

const reasonOf = (error: unknown): ConflictReason => {
    const status = (error as { response?: { status?: number } })?.response
        ?.status;
    if (status === 404) return 'not-found';
    if (status === 412) return 'precondition-failed';
    return 'refused';
};

/**
 * Replay of a recovered operation: the very same request (same id, resource,
 * base and frozen body), with NO way around the guarantees of the protocol —
 * not even for a manual retry.
 *
 *  - the durable owner is the current account and the session is the one the
 *    replay started under, before AND after every await, up to the wire;
 *  - only an operation sent under D1 is replayed (a historical-regime one has
 *    no receipts: it is kept, never promoted);
 *  - the capability is RE-PROVEN by the capability probe when it is not known
 *    (a server that cannot prove it leaves the content recoverable);
 *  - a frozen row proves nothing about whether the request ever left: it is
 *    replayed as possibly-sent (ambiguous);
 *  - the identity of the replay is the durable one; another identity already
 *    registered for the request is never substituted;
 *  - the journal closes ONLY on the acknowledgement of that identity.
 */
export async function replayRecoveredOperation(
    journal: LocalJournal,
    owner: string,
    op: OpRecord,
    authorized?: OperationContext
): Promise<ReplayVerdict> {
    if (op.method !== 'PATCH') return 'not-replayable';
    if (op.regime !== 'd1') return 'not-replayable';
    // The record is the owner's, and the action was authorized under a
    // context (account + session) that must still be the current one: a task
    // that waited in a queue never runs under a later session.
    if (op.owner !== owner) return 'context';
    if (authorized && !sameContext(authorized, contextNow())) return 'context';
    const issuedUnder = contextNow();
    const stillMine = () =>
        issuedUnder.userId === owner && sameContext(issuedUnder, contextNow());
    if (!stillMine()) return 'context';
    if (getCapability() !== 'd1') {
        await probeCapability();
        if (!stillMine()) return 'context';
        if (getCapability() !== 'd1') return 'not-replayable';
    }
    const identity = restoreIdentity(
        {
            id: op.mutationId,
            method: 'PATCH',
            resource: op.resource,
            base: op.base ?? undefined,
            body: op.body,
            regime: 'd1',
            ambiguous: true,
        },
        issuedUnder
    );
    if (!identity) return 'not-replayable';
    markAmbiguous(identity);
    let result: Awaited<ReturnType<typeof updatePostIt>>;
    try {
        result = await updatePostIt(
            op.resource,
            {
                ...op.body,
                ...(op.base ? { etag: op.base } : {}),
            } as Parameters<typeof updatePostIt>[1],
            { canSend: stillMine }
        );
    } catch (error) {
        if (error instanceof StaleLifecycleError) {
            if (!stillMine()) return 'context';
            // The receipt belongs to a life of the card that is gone: the
            // content stays recoverable, an explicit resolution is proposed.
            await journal.recordConflict(
                owner,
                op.resource,
                op.base ?? undefined,
                op.body,
                'receipt-unavailable',
                op.mutationId,
                [op.key]
            );
            closeIdentity(identity);
            return 'stale';
        }
        // Only the absence of an answer (or a server-side failure) leaves the
        // outcome open. A definite answer of the server (412, 404, 409, 428...)
        // to THIS request is its judgment: with a receipt window that may have
        // evicted the original, the content is kept and an explicit resolution
        // is proposed, never replayed again in a loop.
        const answer = (error as { response?: { status?: number } })?.response;
        if (!answer || (answer.status ?? 0) >= 500) return 'uncertain';
        if (!stillMine()) return 'context';
        // any other answer of the server is a refusal of THIS request: the
        // content is kept as a conflict, never rewritten unconditionally
        await journal.recordConflict(
            owner,
            op.resource,
            op.base ?? undefined,
            op.body,
            reasonOf(error),
            op.mutationId,
            [op.key]
        );
        closeIdentity(identity);
        return 'refused';
    }
    // No proof, no closure: a result that does not carry the acknowledgement
    // of THIS identity leaves the durable operation where it is.
    if (acknowledgedIdOf(result) !== op.mutationId) return 'uncertain';
    if (!stillMine()) return 'context';
    await journal.closeOp(owner, op.resource, op.mutationId);
    return 'applied';
}
