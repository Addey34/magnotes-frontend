import { useCallback, useEffect, useRef, useState } from 'react';
import { SaveState } from '../types/boardTypes';
import {
    allUnresolvedOperations,
    closeIdentity,
    findIdentity,
    forgetUnresolved,
    identityOf,
    markAmbiguous,
    acknowledgedIdOf,
    operationKeyOf,
    sameContext,
    unresolvedOperations,
} from '../services/mutationProtocol';
import { contextNow } from '../services/operationContext';
import type { JournalPort } from '../services/journalBridge';
import {
    MissingVersionError,
    StaleLifecycleError,
    isFinalRefusal,
    isSupersededResult,
    isUncertainOutcome,
    markOutdated,
    describeError,
} from '../services/concurrencyOutcome';

export { MissingVersionError };

interface PendingSave<T> {
    timer: number;
    updates: T;
}

/**
 * Controls the board hands to the code that deletes cards, so a deletion and
 * the autosave queue of that card never race.
 */
export interface CardWriteControl {
    /** A deletion was deferred because a write of the card is still uncertain. */
    deferred?: (id: string) => void;
    /** R8: the durable record of a deletion (begin before it leaves, outcome after). */
    deletion?: {
        begin: (
            card: { _id: string },
            etag: string | undefined
        ) => Promise<void>;
        outcome: (
            id: string,
            etag: string | undefined,
            result?: 'ok' | 'error'
        ) => Promise<void>;
        abort: (id: string, etag: string | undefined) => Promise<void>;
    };
    /** Stop sending this card's queued writes; keep them in case the delete fails. */
    hold: (id: string) => void;
    /** The deletion failed: resume the held writes. */
    release: (id: string) => void;
    /** The deletion succeeded: drop every queued, failed and late write of the card. */
    discard: (id: string) => void;
    /**
     * Send a write the caller wants to await itself (move, resize, undo...)
     * through the same per-card queue and version lineage as the autosave, so
     * the two can never refuse each other. Resolves/rejects with the save
     * function's own outcome; the caller keeps its rollback logic.
     */
    write?: (id: string, updates: any) => Promise<any>;
    /**
     * Resolves when every request of the card that REALLY LEFT has ended, or
     * after `maxWaitMs`. `'uncertain'` means a request is still on the wire at
     * expiry, or one ended without a usable answer (lost answer): the token of
     * the card cannot be proven. Suspended and unsent intentions are never
     * waited for (they cannot leave while the card is held).
     */
    settle?: (
        id: string,
        maxWaitMs?: number
    ) => Promise<void | 'settled' | 'uncertain'>;
    /**
     * The board adopted a read of the card (reload, superseded, restore): an
     * answer to a request that was already on the wire is older than it.
     */
    reloaded?: (id: string) => void;
    /**
     * A predicate that stays true only while the card keeps the life (and the
     * account/session context) it has right now. Capture it before an await
     * and check it after.
     */
    lifeOf?: (id: string) => () => boolean;
    /**
     * The token a write based on `base` must carry now, following the card's
     * own acknowledged writes; undefined when that base is known overtaken.
     */
    rebase?: (id: string, base: string | undefined) => string | undefined;
    /** Names of the fields that still have an unacknowledged intention. */
    unsentFields?: (id: string) => string[];
}

export interface AutosaveOptions<TResult, TUpdate extends object = object> {
    /** Version a successful response moved the card to. Defaults to `result.updatedAt`. */
    getVersion?: (result: TResult) => string | undefined;
    /**
     * Whether a failure is a FINAL refusal (default: 412, 400 malformed
     * token, 428, 404 and the historical 409): the intention is kept as
     * `conflicted`, never replayed on its own. Anything else (network, 503,
     * 5xx) stays `failed` and is retried.
     */
    isConflict?: (error: unknown) => boolean;
    /**
     * The server applied the write but says the card was overtaken
     * (`X-Concurrency-Superseded`): its token must not be adopted. The card
     * is read again here; the coordinator waits for it before sending
     * anything else for that card. `protectedKeys` are fields that still have
     * an unacknowledged intention and must not be overwritten by the reload.
     */
    onSuperseded?: (
        id: string,
        result: TResult,
        protectedKeys: string[]
    ) => Promise<void> | void;
    /**
     * Whether a write must carry the version it is based on. When it returns
     * true, a write without a known version (absent or empty) is refused
     * locally: never sent, a queued content is kept as a `blocked` intention.
     * Off by default; the demo board has no server versions.
     */
    requireVersion?: () => boolean;
    /**
     * Identity of the account that owns the session (null when signed out).
     * It is checked every time a request is about to leave and after every
     * wait: once it changed, the previous context is invalidated and nothing
     * of it is sent, adopted or notified. Omitted: no owner check.
     */
    owner?: () => string | null | undefined;
    /**
     * Same as `save`, but receives the guard that must hold before EVERY
     * (re)transmission of the request (the card's life, the owner).
     */
    /**
     * Durable mirror of the intentions (D2): drafts are recorded before the
     * debounce, the exact operation before its first emission, and each
     * outcome closes only its own record. Absent: nothing is persisted.
     */
    journal?: JournalPort;
    send?: (
        id: string,
        updates: TUpdate,
        guard: { canSend: () => boolean }
    ) => Promise<TResult>;
}

/**
 * One unsent intention of a card, as exposed for recovery. Nothing here is
 * ever replayed on its own except `failed` ones (retried on their own base).
 *  - failed:     sent and failed for a reason that may go away; retried.
 *  - conflicted: refused with a conflict; kept, never replayed.
 *  - blocked:    refused locally (no version); kept, never sent.
 *  - displaced:  an older value set aside by a newer direct write in flight.
 *  - pending:    typed, still waiting for the debounce.
 * `order` is the logical clock of the newest field of the intention; `base`
 * is the version its fields were authored on (never rewritten to a newer one).
 */
export interface RecoverableIntent {
    id: number;
    state:
        | 'failed'
        | 'conflicted'
        | 'blocked'
        | 'displaced'
        | 'pending'
        | 'suspended';
    fields: Record<string, unknown>;
    base?: string;
    order: number;
}

// The internal base of a write is the card's opaque concurrency token
// (`etag`): it is compared for identity only, never decoded or ordered.
const VERSION_KEY = 'etag';
// Acknowledged versions kept per card even when no write needs them any more:
// a component can still hold a closure built before the last acknowledgement
// reached it. A small constant, so memory never grows with the number of saves.
const GRACE_ENTRIES = 2;

const defaultIsConflict = (error: unknown): boolean => isFinalRefusal(error);
const isStaleError = (error: unknown): boolean =>
    error instanceof StaleLifecycleError;

const defaultGetVersion = (result: unknown): string | undefined =>
    (result as { etag?: string } | undefined)?.etag;

// An absent or empty version is "no version".
const baseOf = (record: unknown): string | undefined => {
    const value = (record as Record<string, unknown> | undefined)?.[
        VERSION_KEY
    ];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
};
const fieldsOf = (record: unknown): string[] =>
    Object.keys((record as Record<string, unknown>) ?? {}).filter(
        (key) => key !== VERSION_KEY
    );
const splitGroup = (record: unknown) => {
    const fields: Record<string, unknown> = {};
    for (const key of fieldsOf(record)) {
        fields[key] = (record as Record<string, unknown>)[key];
    }
    return { fields, base: baseOf(record) };
};

/** An unsent intention kept by the coordinator (failed, conflicted or blocked). */
interface Intent {
    id: number;
    state: 'failed' | 'conflicted' | 'blocked';
    fields: Record<string, unknown>;
    base?: string;
    order: number;
}

/**
 * An older value of a field that a newer DIRECT write displaced. It is kept in
 * memory until a compatible later modification of that field is acknowledged
 * (then it is obsolete) and goes back to the queue, with its own version, if
 * the newest direct write fails: the visible state is then the older value.
 */
interface Displaced {
    key: string;
    value: unknown;
    base?: string;
    order: number;
    /** Set when the server already refused this value (final refusal). */
    refused?: boolean;
}
/** The latest direct intention on a field: what orders it against autosaves. */
interface DirectIntent {
    token: number;
    seq: number;
    status: 'pending' | 'failed';
}

export const useAutosave = <T extends object, TResult = void>(
    save: (id: string, updates: T) => Promise<TResult>,
    delay = 500,
    onError?: (error: unknown) => void,
    onSaved?: (id: string, result: TResult, staleKeys: string[]) => void,
    options: AutosaveOptions<TResult, T> = {}
) => {
    // ---- the intentions of one card ---------------------------------------
    // Every entry keeps the version its fields were authored on; two entries
    // are merged into one request only when their versions are proven to be
    // the same card state (see `prepareGroups`).
    //   pending     typed/edited, waiting for the debounce
    //   retained    failed | conflicted | blocked intentions (one model)
    //   superseded  older values displaced by a direct write
    const pending = useRef<Record<string, PendingSave<T>>>({});
    const retained = useRef<Record<string, Intent[]>>({});
    const inFlight = useRef<Record<string, Promise<void>>>({});
    // Logical clock per field: every intention (autosave or direct) bumps it.
    const fieldVersions = useRef<Record<string, Record<string, number>>>({});
    // Versions our own acknowledged writes superseded: base -> acknowledged.
    // A write queued behind another one may follow this chain; anything else
    // (a version we never produced) is left for the server to judge.
    const lineage = useRef<Record<string, Map<string, string>>>({});
    // Base versions of writes that are queued but have not resolved their base
    // yet. A lineage entry is never released while one of them still needs it.
    const awaiting = useRef<Record<string, Map<number, string>>>({});
    const opSeq = useRef(0);
    const intentSeq = useRef(0);
    // Fields of direct writes that are queued or on the wire. An autosave
    // answer that arrives meanwhile describes the card from BEFORE those writes:
    // applying those fields would rewind the optimistic value the board shows.
    const directKeys = useRef<Record<string, Map<number, string[]>>>({});
    // Fields of groups already taken out of the queues by a flush but not sent
    // yet (or on the wire): they are in no bucket, still unsaved, and an echo
    // must not rewind them.
    const extracted = useRef<Record<string, Map<number, string[]>>>({});
    const directIntent = useRef<Record<string, Record<string, DirectIntent>>>(
        {}
    );
    const superseded = useRef<Record<string, Map<number, Displaced[]>>>({});
    const held = useRef<Set<string>>(new Set());
    // Tokens known NOT to be the card's current state (a superseded answer's
    // own token and the base it was written on): nothing is sent on them.
    const unreliable = useRef<Record<string, Set<string>>>({});
    const epoch = useRef<Record<string, number>>({});
    // Context of the whole coordinator (account / session): bumped when it is
    // invalidated, which makes every operation started before it stale.
    const generation = useRef(0);
    const boundOwner = useRef<string | null | undefined>(undefined);
    // Requests that REALLY left and have not ended yet, per card.
    const wire = useRef<Record<string, Set<Promise<void>>>>({});
    const holdWaiters = useRef<Record<string, Array<() => void>>>({});
    // Direct writes waiting for the card to be released: unsent, recoverable.
    const suspendedDirect = useRef<
        Record<
            string,
            Map<
                number,
                {
                    fields: Record<string, unknown>;
                    base?: string;
                    order: number;
                }
            >
        >
    >({});
    // Reads of the card adopted by the board (see CardWriteControl.reloaded).
    const adoptions = useRef<Record<string, number>>({});
    const lastTouched = useRef<string | undefined>(undefined);
    const mounted = useRef(true);
    const saveRef = useRef(save);
    // Local (durable) writes in progress and what the storage last reported.
    const localInFlight = useRef(0);
    const [localSave, setLocalSave] = useState<{
        status: 'idle' | 'saving' | 'saved' | 'unavailable' | 'quota';
    }>({ status: 'idle' });
    const trackLocal = (work: Promise<boolean>): Promise<boolean> => {
        localInFlight.current += 1;
        setLocalSave((now) =>
            now.status === 'saving' ? now : { status: 'saving' }
        );
        return work
            .catch(() => false)
            .then((ok) => {
                localInFlight.current -= 1;
                if (!mounted.current) return ok;
                const journalStatus =
                    optionsRef.current.journal?.journal.getStatus();
                if (!ok || journalStatus === 'unavailable') {
                    setLocalSave({
                        status:
                            journalStatus === 'quota' ? 'quota' : 'unavailable',
                    });
                } else if (localInFlight.current === 0) {
                    setLocalSave({ status: 'saved' });
                }
                return ok;
            });
    };
    const onErrorRef = useRef(onError);
    const onSavedRef = useRef(onSaved);
    const optionsRef = useRef(options);
    const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

    // Keep the autosave queue stable across consumer renders while still
    // calling the latest callbacks. Depending directly on callback identities
    // would rerun the lifecycle effect; its cleanup flushes failed writes and
    // could therefore create an immediate retry loop after a 429/offline error.
    saveRef.current = save;
    // The write leaves through `options.send` when the caller provides one (it
    // receives the guard every (re)transmission must satisfy), else `save`.
    const rawTransmit = (
        id: string,
        payload: T,
        canSend: () => boolean
    ): Promise<TResult> =>
        optionsRef.current.send
            ? optionsRef.current.send(id, payload, { canSend })
            : saveRef.current(id, payload);
    // With a journal, the exact operation is recorded durably BEFORE its first
    // emission (a storage that fails never blocks the network write: the
    // status then says the local copy does not exist).
    const transmit = (
        id: string,
        payload: T,
        canSend: () => boolean
    ): Promise<TResult> => {
        const port = optionsRef.current.journal;
        if (!port) return rawTransmit(id, payload, canSend);
        return trackLocal(port.freeze(id, payload)).then(() =>
            rawTransmit(id, payload, canSend)
        );
    };
    onErrorRef.current = onError;
    onSavedRef.current = onSaved;
    optionsRef.current = options;

    const intentsOf = (id: string, state?: Intent['state']) =>
        (retained.current[id] || []).filter(
            (intent) => !state || intent.state === state
        );
    const setIntents = (id: string, list: Intent[]) => {
        if (list.length > 0) retained.current[id] = list;
        else delete retained.current[id];
    };
    /**
     * Runs a task in the card's own write queue: the only coordination there
     * is. A recovered operation is replayed through it, so it never races an
     * active write of the same card (and nothing queued behind it overtakes).
     */
    const runExclusive = <R>(
        id: string,
        task: () => Promise<R>
    ): Promise<R> => {
        const previous = inFlight.current[id] || Promise.resolve();
        const operation = previous.then(task);
        const tail: Promise<void> = operation.then(
            () => undefined,
            () => undefined
        );
        inFlight.current[id] = tail;
        void tail.then(() => {
            if (inFlight.current[id] === tail) delete inFlight.current[id];
        });
        return operation;
    };
    // ---- lifecycle gate -----------------------------------------------------
    // Is the owner of the session still the one this coordinator started with?
    const ownerOk = (): boolean => {
        const read = optionsRef.current.owner;
        if (!read) return true;
        const now = read() ?? null;
        const bound = boundOwner.current;
        if (bound === undefined || bound === null) {
            boundOwner.current = now; // first owner seen: bind to it
            return true;
        }
        return now === bound;
    };
    // The life of a card as it is right now: stays true until the card is
    // discarded (deleted) or the whole context is invalidated.
    const lifeOf = (id: string): (() => boolean) => {
        const sentGeneration = generation.current;
        const sentEpoch = epoch.current[id] || 0;
        return () =>
            generation.current === sentGeneration &&
            (epoch.current[id] || 0) === sentEpoch;
    };
    const wake = (id: string) => {
        const waiting = holdWaiters.current[id];
        delete holdWaiters.current[id];
        waiting?.forEach((resume) => resume());
    };
    const trackWire = (id: string, request: Promise<unknown>) => {
        const set = (wire.current[id] ||= new Set());
        const done: Promise<void> = request.then(
            () => undefined,
            () => undefined
        );
        set.add(done);
        void done.then(() => {
            set.delete(done);
            if (set.size === 0 && wire.current[id] === set) {
                delete wire.current[id];
            }
        });
    };
    // The coordinator keeps NO registry of its own for uncertain writes: the
    // operation (identity, regime, ambiguity) lives in the protocol layer and
    // is looked up there, so the reference is unique. A write that did not go
    // through the protocol layer (a custom `save`) is registered there under
    // the very same identity the API layer would have minted for it.
    const splitPayload = (payload: unknown) => {
        const { etag, ...fields } = (payload ?? {}) as Record<string, unknown>;
        return { base: etag as string | undefined, fields };
    };
    /** Operations of the card, in the current context, that may be applied. */
    const unresolvedNow = (id: string) =>
        unresolvedOperations(id).filter((operation) =>
            sameContext(operation.context, contextNow())
        );
    /**
     * An acknowledged write. Whether the protocol layer closed its operation
     * (only a proven answer does) is decided there; an answer that did not go
     * through it closes its own operation. Historical-regime operations of the
     * card are settled by any acknowledgement (their token is proven now);
     * operations sent under D1 never are.
     */
    const settleAcknowledged = (
        id: string,
        payload: unknown,
        result: unknown
    ) => {
        const port = optionsRef.current.journal;
        if (port) {
            // ONE causal decision: the journal closes on the proof the
            // protocol layer attached to this very result, never on the mere
            // fact that a result came back. A result that went through the
            // protocol layer WITHOUT that proof leaves the intention durable
            // and unresolved (it did leave the page: ambiguous).
            const proven = acknowledgedIdOf(result);
            if (proven !== undefined) {
                void trackLocal(
                    port.acknowledged(
                        id,
                        payload,
                        proven,
                        (result as { etag?: unknown } | undefined)?.etag as
                            string | undefined
                    )
                );
            } else if (operationKeyOf(result) !== undefined) {
                void trackLocal(port.uncertain(id, payload));
            } else {
                // a custom `save` that bypasses the protocol layer closes its
                // own operation
                void trackLocal(port.acknowledged(id, payload));
            }
        }
        if (operationKeyOf(result) === undefined) {
            const { base, fields } = splitPayload(payload);
            closeIdentity(
                findIdentity('PATCH', id, base, fields, contextNow())
            );
        }
        forgetUnresolved(id);
    };
    const noteOutcome = (id: string, payload: unknown, error: unknown) => {
        const port = optionsRef.current.journal;
        if (port) {
            const status = (
                error as { response?: { status?: number } } | undefined
            )?.response?.status;
            if (isUncertainOutcome(error)) {
                void trackLocal(port.uncertain(id, payload));
            } else if (
                (optionsRef.current.isConflict ?? defaultIsConflict)(error)
            ) {
                void trackLocal(
                    port.refused(
                        id,
                        payload,
                        status === 404
                            ? 'not-found'
                            : status === 412
                              ? 'precondition-failed'
                              : 'refused'
                    )
                );
            } else {
                void trackLocal(port.retryable(id, payload));
            }
        }
        const { base, fields } = splitPayload(payload);
        if (base === undefined) return;
        if (isUncertainOutcome(error)) {
            if (operationKeyOf(error) === undefined) {
                markAmbiguous(
                    identityOf('PATCH', id, base, fields, contextNow())
                );
            }
        } else {
            // Historical regime: a certain answer for this base proves it.
            // An operation sent under D1 is closed by its receipt only.
            for (const operation of unresolvedOperations(id)) {
                if (
                    operation.regime === 'historical' &&
                    operation.base === base
                ) {
                    closeIdentity(operation);
                }
            }
        }
    };
    const clearCard = (id: string) => {
        const queued = pending.current[id];
        if (queued) window.clearTimeout(queued.timer);
        delete pending.current[id];
        delete retained.current[id];
        delete fieldVersions.current[id];
        delete lineage.current[id];
        delete unreliable.current[id];
        delete awaiting.current[id];
        delete directKeys.current[id];
        delete extracted.current[id];
        delete directIntent.current[id];
        delete superseded.current[id];
        delete wire.current[id];
        delete suspendedDirect.current[id];
        delete adoptions.current[id];
        optionsRef.current.journal?.forget(id);
        // The next life of the card gets its own queue: a request of the old
        // life that never ends must not delay it.
        delete inFlight.current[id];
        epoch.current[id] = (epoch.current[id] || 0) + 1;
        wake(id);
    };
    // The session context changed (another account, signed out, revoked):
    // nothing of the previous context may be sent, adopted or notified.
    const invalidateAll = () => {
        generation.current += 1;
        const ids = new Set([
            ...Object.keys(pending.current),
            ...Object.keys(retained.current),
            ...Object.keys(inFlight.current),
            ...Object.keys(holdWaiters.current),
            ...Object.keys(suspendedDirect.current),
            ...Object.keys(fieldVersions.current),
        ]);
        ids.forEach(clearCard);
        held.current.clear();
        refreshState();
    };
    const groupOf = (intent: Intent): T =>
        ({
            ...intent.fields,
            ...(intent.base !== undefined
                ? { [VERSION_KEY]: intent.base }
                : {}),
        }) as unknown as T;
    // Logical clock of the newest of these fields.
    const clockOf = (
        id: string,
        keys: string[],
        from?: Record<string, number>
    ) =>
        Math.max(
            0,
            ...keys.map(
                (key) => (from ?? fieldVersions.current[id] ?? {})[key] || 0
            )
        );

    // One global state derived from the real states of every card. It is
    // "saving" while any intention is waiting or travelling (debounce, queue,
    // a direct write queued or on the wire, an intention suspended by a hold,
    // a group taken out of the queues but not sent yet), "error" while an
    // intention is kept (failed, conflicted, blocked, displaced) or a write
    // ended without a usable answer (uncertain), and "saved" only when none of
    // them exists. A final error of one card is never hidden by the success of
    // another one.
    const refreshState = useCallback(() => {
        if (!mounted.current) return;
        const activeIds = [
            ...new Set([
                ...Object.keys(inFlight.current),
                ...Object.keys(pending.current),
                ...Object.keys(directKeys.current),
                ...Object.keys(extracted.current),
                ...Object.keys(suspendedDirect.current),
                ...Object.keys(wire.current),
            ]),
        ];
        const problemIds = [
            ...new Set([
                ...Object.keys(retained.current),
                ...Object.keys(superseded.current),
                ...allUnresolvedOperations()
                    .filter((operation) =>
                        sameContext(operation.context, contextNow())
                    )
                    .map((operation) => operation.resource),
            ]),
        ];
        if (activeIds.length > 0) {
            setSaveState({ status: 'saving', postItId: activeIds[0] });
        } else if (problemIds.length > 0) {
            setSaveState({ status: 'error', postItId: problemIds[0] });
        } else {
            setSaveState({ status: 'saved', postItId: lastTouched.current });
        }
    }, []);

    // The version a write is based on, resolved at SEND time: only a version
    // that one of our own acknowledged writes superseded is advanced.
    const resolveBase = (id: string, updates: T): T => {
        const original = baseOf(updates);
        if (original === undefined) return updates;
        const chain = lineage.current[id];
        let base = original;
        // `seen` guards against a cycle (a version string seen twice), never
        // against a long chain: any length of acknowledged history is followed.
        const seen = new Set<string>();
        while (chain && chain.has(base) && !seen.has(base)) {
            seen.add(base);
            base = chain.get(base) as string;
        }
        return base === original
            ? updates
            : ({ ...updates, [VERSION_KEY]: base } as T);
    };
    // Does `from` lead to `target` along this card's own acknowledged writes
    // (or equal it)? Only then are two intentions proven to rest on the same
    // causal line; a base we never produced is left for the server to judge.
    const descendsFrom = (
        id: string,
        from: string | undefined,
        target: string | undefined
    ): boolean => {
        // An absent base proves nothing: it is compatible only with another
        // absent base (the demo board, which has no tokens at all).
        if (from === undefined || target === undefined) return from === target;
        const chain = lineage.current[id];
        const seen = new Set<string>();
        let current = from;
        while (!seen.has(current)) {
            if (current === target) return true;
            seen.add(current);
            const next = chain?.get(current);
            if (next === undefined) return false;
            current = next;
        }
        return false;
    };
    const resolvedBaseOf = (id: string, updates: T) =>
        baseOf(resolveBase(id, updates));

    // Versions some write of this card still depends on. A conflicted write is
    // never replayed, so it needs nothing.
    const neededBases = (id: string): Set<string> => {
        const needed = new Set<string>();
        const add = (base: string | undefined) => {
            if (base !== undefined) needed.add(base);
        };
        add(baseOf(pending.current[id]?.updates)); // also covers held writes
        intentsOf(id, 'failed').forEach((intent) => add(intent.base));
        awaiting.current[id]?.forEach((base) => needed.add(base));
        superseded.current[id]?.forEach((entries) =>
            entries.forEach((entry) => add(entry.base))
        );
        return needed;
    };

    // Release every lineage entry no write can reach any more, keeping only the
    // few most recent ones (see GRACE_ENTRIES).
    const pruneLineage = (id: string) => {
        const chain = lineage.current[id];
        if (!chain) return;
        const keys = [...chain.keys()];
        const keep = new Set<string>(keys.slice(-GRACE_ENTRIES));
        for (const base of neededBases(id)) {
            const seen = new Set<string>();
            let cursor: string | undefined = base;
            while (
                cursor !== undefined &&
                chain.has(cursor) &&
                !seen.has(cursor)
            ) {
                seen.add(cursor);
                keep.add(cursor);
                cursor = chain.get(cursor);
            }
        }
        for (const key of keys) if (!keep.has(key)) chain.delete(key);
        if (chain.size === 0) delete lineage.current[id];
    };

    // Record that OUR write based on `base` was acknowledged as `version`, and
    // compress: every older base that was acknowledged into `base` now leads
    // straight to `version`. Only versions of a locally acknowledged chain are
    // ever linked; a version produced elsewhere never enters the map.
    const recordAck = (id: string, base: string, version: string) => {
        const chain = (lineage.current[id] ||= new Map());
        for (const [from, to] of chain) {
            if (to !== base) continue;
            if (from === version) chain.delete(from);
            else chain.set(from, version);
        }
        chain.delete(base);
        chain.set(base, version); // re-inserted: insertion order = recency
    };

    // Keep a new unsent intention. Failed ones join the last failed intention
    // only when both are proven to be based on the same card state; conflicted
    // and blocked ones are NEVER merged: each keeps its own provenance.
    const retain = (
        id: string,
        state: Intent['state'],
        group: T,
        order: number
    ) => {
        const { fields, base } = splitGroup(group);
        const list = [...(retained.current[id] || [])];
        if (state === 'failed') {
            const lastIndex = list.map((i) => i.state).lastIndexOf('failed');
            const last = lastIndex >= 0 ? list[lastIndex] : undefined;
            if (
                last &&
                resolvedBaseOf(id, groupOf(last)) === resolvedBaseOf(id, group)
            ) {
                list[lastIndex] = {
                    ...last,
                    fields: { ...last.fields, ...fields },
                    order: Math.max(last.order, order),
                };
                setIntents(id, list);
                return;
            }
        }
        list.push({ id: ++intentSeq.current, state, fields, base, order });
        setIntents(id, list);
    };

    // A value kept aside (see Displaced) goes back to the queue with its own
    // version, and a flush is scheduled so it is not forgotten.
    const reinstate = (id: string, entry: Displaced) => {
        // A definitively refused value (412...) never becomes retryable again.
        retain(
            id,
            entry.refused ? 'conflicted' : 'failed',
            {
                [entry.key]: entry.value,
                ...(entry.base !== undefined
                    ? { [VERSION_KEY]: entry.base }
                    : {}),
            } as unknown as T,
            entry.order
        );
        if (!entry.refused && !pending.current[id] && !held.current.has(id)) {
            pending.current[id] = {
                timer: window.setTimeout(() => void flushSave(id), delay),
                updates: {} as T,
            };
        }
    };

    const flushSave = useCallback(
        (id: string): Promise<void> => {
            if (!ownerOk()) {
                invalidateAll();
                return Promise.resolve();
            }
            const queued = pending.current[id];
            const failedIntents = intentsOf(id, 'failed');
            if (!queued && failedIntents.length === 0) {
                return inFlight.current[id] || Promise.resolve();
            }
            // A card being deleted sends nothing; its writes wait for the outcome.
            if (held.current.has(id)) {
                return inFlight.current[id] || Promise.resolve();
            }

            if (queued) window.clearTimeout(queued.timer);
            delete pending.current[id];
            setIntents(
                id,
                intentsOf(id).filter((intent) => intent.state !== 'failed')
            );

            // Oldest first. A field that a newer intention carries never
            // travels in an older group: the newest value is the intention.
            const newest = new Set<string>();
            const ordered: T[] = [];
            const candidates = [
                ...failedIntents.map(groupOf),
                queued?.updates,
            ].filter((group): group is T => group !== undefined);
            for (let i = candidates.length - 1; i >= 0; i--) {
                const group = candidates[i];
                const kept: Record<string, unknown> = {};
                for (const key of fieldsOf(group)) {
                    if (newest.has(key)) continue;
                    newest.add(key);
                    kept[key] = (group as Record<string, unknown>)[key];
                }
                if (Object.keys(kept).length === 0) continue;
                const base = baseOf(group);
                if (base !== undefined) kept[VERSION_KEY] = base;
                ordered.unshift(kept as T);
            }
            if (ordered.length === 0) {
                refreshState();
                return inFlight.current[id] || Promise.resolve();
            }

            const sentVersions = { ...fieldVersions.current[id] };
            const alive = lifeOf(id);
            const isStale = () => !alive();
            const adoptionsAtSend = adoptions.current[id] || 0;

            // From now until its base is resolved, each group pins its version;
            // until it is sent, its fields are protected against any echo.
            const tokens = ordered.map((group) => {
                const token = ++opSeq.current;
                const base = baseOf(group);
                if (base !== undefined) {
                    (awaiting.current[id] ||= new Map()).set(token, base);
                }
                (extracted.current[id] ||= new Map()).set(
                    token,
                    fieldsOf(group)
                );
                return token;
            });
            const releaseAwaiting = () => {
                const pinned = awaiting.current[id];
                if (!pinned) return;
                tokens.forEach((token) => pinned.delete(token));
                if (pinned.size === 0) delete awaiting.current[id];
            };
            const releaseExtracted = (released: number[]) => {
                const live = extracted.current[id];
                if (!live) return;
                released.forEach((token) => live.delete(token));
                if (live.size === 0) delete extracted.current[id];
            };

            lastTouched.current = id;
            refreshState();

            // Built at send time, once the previous write has settled so its
            // acknowledged version can be followed legitimately. Two adjacent
            // groups become one request only when their versions resolve to
            // the same one (our own acknowledgements proved it).
            const prepareGroups = () => {
                const merged: Array<{ payload: T; tokens: number[] }> = [];
                ordered.forEach((group, index) => {
                    const resolved = resolveBase(id, group);
                    const last = merged[merged.length - 1];
                    if (last && baseOf(last.payload) === baseOf(resolved)) {
                        last.payload = { ...last.payload, ...resolved } as T;
                        last.tokens.push(tokens[index]);
                    } else {
                        merged.push({
                            payload: resolved,
                            tokens: [tokens[index]],
                        });
                    }
                });
                return merged;
            };

            const sendGroup = async (
                payload: T,
                payloadTokens: number[]
            ): Promise<void> => {
                const baseSent = baseOf(payload);
                const payloadKeys = fieldsOf(payload);
                if (
                    optionsRef.current.requireVersion?.() &&
                    baseSent === undefined
                ) {
                    // No version, no write: the content stays reachable.
                    retain(
                        id,
                        'blocked',
                        payload,
                        clockOf(id, payloadKeys, sentVersions)
                    );
                    onErrorRef.current?.(new MissingVersionError());
                    return;
                }
                if (
                    baseSent !== undefined &&
                    unreliable.current[id]?.has(baseSent)
                ) {
                    // Depends on a base the server already overtook: kept,
                    // never sent, recoverable.
                    retain(
                        id,
                        'blocked',
                        payload,
                        clockOf(id, payloadKeys, sentVersions)
                    );
                    onErrorRef.current?.(new MissingVersionError());
                    return;
                }
                try {
                    const request = transmit(
                        id,
                        payload,
                        () => !isStale() && ownerOk()
                    );
                    trackWire(id, request);
                    const result = await request;
                    if (isStale()) return;
                    if (!ownerOk()) {
                        invalidateAll();
                        return;
                    }
                    // An answer to a request that left before the board adopted
                    // a newer read of the card must not rewind that read.
                    if ((adoptions.current[id] || 0) !== adoptionsAtSend) {
                        markOutdated(result);
                    }
                    settleAcknowledged(id, payload, result);

                    const overtaken = isSupersededResult(result);
                    const version = (
                        optionsRef.current.getVersion ?? defaultGetVersion
                    )(result);
                    if (overtaken) {
                        // Applied, but its token is already stale: never
                        // recorded as the successor of the base.
                        const bad = (unreliable.current[id] ||= new Set());
                        if (baseSent) bad.add(baseSent);
                        if (version) bad.add(version);
                    } else if (
                        typeof baseSent === 'string' &&
                        version &&
                        version !== baseSent
                    ) {
                        recordAck(id, baseSent, version);
                    }

                    // Fields of every OTHER unacknowledged intention of this
                    // card, whatever its internal state: the response echoes
                    // the card as it was *sent*, so applying those keys would
                    // rewind what the board shows.
                    const protectedKeys = new Set<string>();
                    directKeys.current[id]?.forEach((keys) =>
                        keys.forEach((key) => protectedKeys.add(key))
                    );
                    extracted.current[id]?.forEach((keys, token) => {
                        if (!payloadTokens.includes(token)) {
                            keys.forEach((key) => protectedKeys.add(key));
                        }
                    });
                    fieldsOf(pending.current[id]?.updates).forEach((key) =>
                        protectedKeys.add(key)
                    );
                    intentsOf(id).forEach((intent) =>
                        Object.keys(intent.fields).forEach((key) =>
                            protectedKeys.add(key)
                        )
                    );
                    Object.entries(fieldVersions.current[id] || {}).forEach(
                        ([key, current]) => {
                            if (current !== sentVersions[key]) {
                                protectedKeys.add(key);
                            }
                        }
                    );
                    if (mounted.current) {
                        onSavedRef.current?.(id, result, [...protectedKeys]);
                    }
                    if (overtaken) {
                        try {
                            await optionsRef.current.onSuperseded?.(
                                id,
                                result,
                                [...protectedKeys]
                            );
                        } catch (reloadError) {
                            // The card stays on an unreliable token: writes
                            // on it remain blocked and recoverable.
                            console.error(
                                'Reload after superseded failed:',
                                describeError(reloadError)
                            );
                            if (!isStale() && mounted.current) {
                                onErrorRef.current?.(reloadError);
                            }
                        }
                    }
                } catch (error) {
                    // Late failure of a write whose card is gone: nothing to
                    // keep and nothing to tell the user.
                    if (isStale()) return;
                    // The owner changed while the request was on the wire: a
                    // failure is as foreign to the new context as a success.
                    if (!ownerOk()) {
                        invalidateAll();
                        return;
                    }
                    console.error('Autosave failed:', describeError(error));
                    noteOutcome(id, payload, error);

                    // Keep only the fields nobody edited since this write was
                    // prepared. A newer value for a field is already queued (or
                    // sent) and must never be overwritten by this older one;
                    // when that newer intention is a direct write still on its
                    // way, the older value is only set aside (see Displaced).
                    const kept: Record<string, unknown> = {};
                    const refusedFinally = (
                        optionsRef.current.isConflict ?? defaultIsConflict
                    )(error);
                    for (const key of payloadKeys) {
                        const value = (payload as Record<string, unknown>)[key];
                        const current = (fieldVersions.current[id] || {})[key];
                        if (current === sentVersions[key]) {
                            kept[key] = value;
                            continue;
                        }
                        const intent = directIntent.current[id]?.[key];
                        if (intent && intent.seq === current) {
                            if (intent.status === 'pending') {
                                const list = (superseded.current[id] ||=
                                    new Map());
                                const entries = list.get(intent.token) ?? [];
                                entries.push({
                                    key,
                                    value,
                                    base: baseSent,
                                    order: sentVersions[key] || 0,
                                    refused: refusedFinally,
                                });
                                list.set(intent.token, entries);
                            } else {
                                kept[key] = value; // that write failed too
                            }
                        }
                    }
                    if (Object.keys(kept).length > 0) {
                        if (baseSent !== undefined)
                            kept[VERSION_KEY] = baseSent;
                        const isConflict =
                            optionsRef.current.isConflict ?? defaultIsConflict;
                        retain(
                            id,
                            isConflict(error) ? 'conflicted' : 'failed',
                            kept as T,
                            clockOf(id, Object.keys(kept), sentVersions)
                        );
                    }
                    if (mounted.current) onErrorRef.current?.(error);
                }
            };

            // Serialize writes for one card so an older, slower request cannot
            // land after a newer one and overwrite its fields on the server.
            const previous = inFlight.current[id] || Promise.resolve();
            const operation: Promise<void> = previous
                .catch(() => undefined)
                .then(async () => {
                    // The card was deleted while this write waited its turn.
                    if (isStale()) return;
                    if (!ownerOk()) {
                        invalidateAll();
                        return;
                    }
                    const payloads = prepareGroups();
                    releaseAwaiting();
                    for (const { payload, tokens: payloadTokens } of payloads) {
                        if (isStale()) return;
                        // Checked again for EVERY group: an earlier group may
                        // have ended (or failed) under another owner.
                        if (!ownerOk()) {
                            invalidateAll();
                            return;
                        }
                        // The suspension is checked HERE, when the request is
                        // about to leave, not only when it was queued: this
                        // group (and the ones behind it) go back to the
                        // intentions of the card, recoverable, and leave on
                        // release.
                        if (held.current.has(id)) {
                            const rest = payloads.slice(
                                payloads.findIndex((p) => p.payload === payload)
                            );
                            for (const group of rest) {
                                retain(
                                    id,
                                    'failed',
                                    group.payload,
                                    clockOf(
                                        id,
                                        fieldsOf(group.payload),
                                        sentVersions
                                    )
                                );
                            }
                            releaseExtracted(tokens);
                            return;
                        }
                        try {
                            // Re-resolved now: an earlier group of this very operation may
                            // just have been acknowledged on the same base.
                            await sendGroup(
                                resolveBase(id, payload),
                                payloadTokens
                            );
                        } finally {
                            releaseExtracted(payloadTokens);
                        }
                    }
                })
                .finally(() => {
                    releaseAwaiting();
                    releaseExtracted(tokens);
                    if (inFlight.current[id] === operation) {
                        delete inFlight.current[id];
                    }
                    pruneLineage(id);
                    refreshState();
                });

            inFlight.current[id] = operation;
            return operation;
        },
        [delay, refreshState]
    );

    // A direct write: same chain, same base resolution and acknowledgement as
    // an autosave, but awaited by the caller (which owns rollback and history).
    // It is also an INTENTION on its fields: the older values of those fields
    // that are still waiting (debounce, retry, an earlier direct write) are
    // set aside, never sent over it and never lost while it is unacknowledged.
    const writeDirect = useCallback(
        (id: string, updates: T): Promise<TResult> => {
            const baseAtQueue = baseOf(updates);
            if (optionsRef.current.requireVersion?.() && !baseAtQueue) {
                // Refused before anything is touched: the caller rolls back its
                // optimistic change, so nothing hidden remains unsaved.
                return Promise.reject(new MissingVersionError());
            }
            if (!ownerOk()) {
                invalidateAll();
                return Promise.reject(new StaleLifecycleError());
            }
            const directPort = optionsRef.current.journal;
            if (directPort) void trackLocal(directPort.draft(id, updates));
            const alive = lifeOf(id);
            const isStale = () => !alive();
            const adoptionsAtSend = adoptions.current[id] || 0;
            const token = ++opSeq.current;
            if (baseAtQueue !== undefined) {
                (awaiting.current[id] ||= new Map()).set(token, baseAtQueue);
            }
            const releaseAwaiting = () => {
                const pinned = awaiting.current[id];
                if (!pinned) return;
                pinned.delete(token);
                if (pinned.size === 0) delete awaiting.current[id];
            };
            const keys = fieldsOf(updates);
            (directKeys.current[id] ||= new Map()).set(token, keys);
            const releaseDirectKeys = () => {
                const live = directKeys.current[id];
                if (!live) return;
                live.delete(token);
                if (live.size === 0) delete directKeys.current[id];
            };

            // Register the intention and set the displaced values aside.
            const versions = (fieldVersions.current[id] ||= {});
            const intents = (directIntent.current[id] ||= {});
            const mySeq: Record<string, number> = {};
            const displaced: Displaced[] = [];
            const queued = pending.current[id];
            const failedList = intentsOf(id, 'failed');
            const lists = superseded.current[id];
            for (const key of keys) {
                const before = versions[key] || 0;
                versions[key] = before + 1;
                mySeq[key] = versions[key];
                intents[key] = { token, seq: versions[key], status: 'pending' };
                if (queued && key in (queued.updates as object)) {
                    displaced.push({
                        key,
                        value: (queued.updates as Record<string, unknown>)[key],
                        base: baseOf(queued.updates),
                        order: before,
                    });
                    delete (queued.updates as Record<string, unknown>)[key];
                }
                for (const intent of failedList) {
                    if (key in intent.fields) {
                        displaced.push({
                            key,
                            value: intent.fields[key],
                            base: intent.base,
                            order: before,
                        });
                        delete intent.fields[key];
                    }
                }
                // Values an earlier direct write had set aside are handed over
                // to this newer intention: they must survive if it fails too.
                lists?.forEach((entries, otherToken) => {
                    const stay = entries.filter((entry) => {
                        if (entry.key !== key) return true;
                        displaced.push(entry);
                        return false;
                    });
                    if (stay.length > 0) lists.set(otherToken, stay);
                    else lists.delete(otherToken);
                });
            }
            if (queued && fieldsOf(queued.updates).length === 0) {
                window.clearTimeout(queued.timer);
                delete pending.current[id];
            }
            setIntents(
                id,
                intentsOf(id).filter(
                    (intent) =>
                        intent.state !== 'failed' ||
                        Object.keys(intent.fields).length > 0
                )
            );
            if (superseded.current[id]?.size === 0) {
                delete superseded.current[id];
            }
            if (displaced.length > 0) {
                (superseded.current[id] ||= new Map()).set(token, displaced);
            }

            const settleIntent = (
                outcome: 'acked' | 'failed',
                ackedBase?: string
            ) => {
                let aside = superseded.current[id]?.get(token) ?? [];
                superseded.current[id]?.delete(token);
                if (outcome === 'acked') {
                    // The values set aside for this write are obsolete only
                    // when they rest on a base this acknowledgement descends
                    // from. The others stay recoverable under a key of their
                    // own: a newer acknowledged write never deletes them.
                    const incompatible = aside.filter(
                        (entry) => !descendsFrom(id, entry.base, ackedBase)
                    );
                    if (incompatible.length > 0) {
                        (superseded.current[id] ||= new Map()).set(
                            -++intentSeq.current,
                            incompatible
                        );
                    }
                    aside = [];
                    // A compatible later modification of these fields is
                    // acknowledged: the older values, wherever they were kept,
                    // are obsolete.
                    superseded.current[id]?.forEach((entries, otherToken) => {
                        const stay = entries.filter(
                            (entry) =>
                                !(
                                    entry.key in mySeq &&
                                    entry.order < mySeq[entry.key] &&
                                    // never delete a value of an incompatible
                                    // base just because a newer write landed
                                    descendsFrom(id, entry.base, ackedBase)
                                )
                        );
                        if (stay.length > 0) {
                            superseded.current[id].set(otherToken, stay);
                        } else {
                            superseded.current[id].delete(otherToken);
                        }
                    });
                }
                if (superseded.current[id]?.size === 0) {
                    delete superseded.current[id];
                }
                for (const key of keys) {
                    const intent = directIntent.current[id]?.[key];
                    if (intent?.token !== token) continue;
                    if (outcome === 'failed') {
                        intent.status = 'failed';
                    } else {
                        delete directIntent.current[id][key];
                    }
                }
                if (outcome === 'failed') {
                    // The caller rolls back to what the board showed before:
                    // the older value is the user's intention again, unless a
                    // newer one has been expressed since.
                    for (const entry of aside) {
                        const intent = directIntent.current[id]?.[entry.key];
                        if (
                            intent?.token === token &&
                            intent.seq ===
                                fieldVersions.current[id]?.[entry.key]
                        ) {
                            reinstate(id, entry);
                        }
                    }
                }
                if (
                    directIntent.current[id] &&
                    Object.keys(directIntent.current[id]).length === 0
                ) {
                    delete directIntent.current[id];
                }
            };
            refreshState();

            const previous = inFlight.current[id] || Promise.resolve();
            const task = previous
                .catch(() => undefined)
                .then(async () => {
                    if (isStale()) {
                        throw new StaleLifecycleError('Card was discarded');
                    }
                    // The suspension is checked when the request is about to
                    // leave: the write waits (recoverable, unsent) until the
                    // card is released, or is dropped with its card.
                    if (held.current.has(id)) {
                        (suspendedDirect.current[id] ||= new Map()).set(token, {
                            fields: splitGroup(updates).fields,
                            base: baseAtQueue,
                            order: Math.max(
                                0,
                                ...keys.map((key) => mySeq[key] || 0)
                            ),
                        });
                        refreshState();
                        while (held.current.has(id) && !isStale()) {
                            await new Promise<void>((resume) =>
                                (holdWaiters.current[id] ||= []).push(resume)
                            );
                        }
                        suspendedDirect.current[id]?.delete(token);
                        if (suspendedDirect.current[id]?.size === 0) {
                            delete suspendedDirect.current[id];
                        }
                        if (isStale()) throw new StaleLifecycleError();
                    }
                    if (!ownerOk()) {
                        invalidateAll();
                        throw new StaleLifecycleError();
                    }
                    const payload = resolveBase(id, updates);
                    releaseAwaiting();
                    const baseSent = baseOf(payload);
                    if (
                        baseSent !== undefined &&
                        unreliable.current[id]?.has(baseSent)
                    ) {
                        throw new MissingVersionError();
                    }
                    const request = transmit(
                        id,
                        payload,
                        () => !isStale() && ownerOk()
                    );
                    trackWire(id, request);
                    let result: TResult;
                    try {
                        result = await request;
                    } catch (error) {
                        if (!isStale()) {
                            if (!ownerOk()) {
                                invalidateAll();
                                throw new StaleLifecycleError();
                            }
                            noteOutcome(id, payload, error);
                        }
                        throw error;
                    }
                    // The card was deleted, restored or the context changed
                    // while the request was on the wire: its answer belongs to
                    // a previous life and is neither a success nor a failure
                    // for the current one.
                    if (isStale()) throw new StaleLifecycleError();
                    if (!ownerOk()) {
                        invalidateAll();
                        throw new StaleLifecycleError();
                    }
                    settleAcknowledged(id, payload, result);
                    if ((adoptions.current[id] || 0) !== adoptionsAtSend) {
                        markOutdated(result);
                    }
                    {
                        const overtaken = isSupersededResult(result);
                        const version = (
                            optionsRef.current.getVersion ?? defaultGetVersion
                        )(result);
                        if (overtaken) {
                            const bad = (unreliable.current[id] ||= new Set());
                            if (baseSent) bad.add(baseSent);
                            if (version) bad.add(version);
                        } else if (
                            typeof baseSent === 'string' &&
                            version &&
                            version !== baseSent
                        ) {
                            recordAck(id, baseSent, version);
                        }
                        settleIntent('acked', baseSent);
                        if (overtaken) {
                            try {
                                await optionsRef.current.onSuperseded?.(
                                    id,
                                    result,
                                    []
                                );
                            } catch (reloadError) {
                                console.error(
                                    'Reload after superseded failed:',
                                    describeError(reloadError)
                                );
                            }
                            // The read that followed is the authority: the
                            // board adopted it, the answer is outdated.
                            markOutdated(result);
                            if (isStale()) throw new StaleLifecycleError();
                        }
                    }
                    return result;
                })
                .catch((error) => {
                    // A failure under another owner invalidates the context
                    // first: it is a stale outcome, never a rollback.
                    if (!isStale() && !ownerOk()) invalidateAll();
                    if (isStale()) {
                        // Late failure of a previous life: nothing to roll
                        // back, nothing to tell, nothing to keep.
                        throw isStaleError(error)
                            ? error
                            : new StaleLifecycleError();
                    }
                    if (!isStaleError(error)) settleIntent('failed');
                    throw error;
                });
            const settled: Promise<void> = task
                .then(
                    () => undefined,
                    () => undefined
                )
                .finally(() => {
                    releaseAwaiting();
                    releaseDirectKeys();
                    if (inFlight.current[id] === settled) {
                        delete inFlight.current[id];
                    }
                    pruneLineage(id);
                    refreshState();
                });
            inFlight.current[id] = settled;
            return task;
        },
        [delay, refreshState]
    );

    // The base the newest UNSENT local content of a field was authored on.
    // Two situations that look alike are kept apart: `exists: false` (no
    // unsent intention on the field) and `exists: true` with no base (an
    // intention whose provenance is UNKNOWN: written while the card had no
    // token). The second one is never promoted to a token adopted later.
    const authoredBase = (
        id: string,
        key: string
    ): { exists: boolean; base?: string } => {
        let best: { order: number; base?: string } | undefined;
        const consider = (order: number, base?: string) => {
            if (!best || order >= best.order) best = { order, base };
        };
        intentsOf(id).forEach((intent) => {
            if (key in intent.fields) consider(intent.order, intent.base);
        });
        superseded.current[id]?.forEach((entries) =>
            entries.forEach((entry) => {
                if (entry.key === key) consider(entry.order, entry.base);
            })
        );
        suspendedDirect.current[id]?.forEach((entry) => {
            if (key in entry.fields) consider(entry.order, entry.base);
        });
        const queued = pending.current[id]?.updates;
        if (queued && key in (queued as object)) {
            consider(clockOf(id, [key]), baseOf(queued));
        }
        const found = best as { order: number; base?: string } | undefined;
        return found ? { exists: true, base: found.base } : { exists: false };
    };

    const scheduleSave = useCallback(
        (id: string, updatesIn: T) => {
            if (!ownerOk()) {
                invalidateAll();
                return;
            }
            let updates = updatesIn;
            const journalPort = optionsRef.current.journal;
            if (journalPort) void trackLocal(journalPort.draft(id, updatesIn));
            const versions = (fieldVersions.current[id] ||= {});
            // Provenance: a field whose local content is still unreconciled
            // (unsent, failed, refused) was authored on a base. A newer typing
            // on top of it rests on that SAME base, never on a token the board
            // adopted since (a read of someone else's change): otherwise the
            // text would be sent as if its author had seen that change. Such
            // fields leave on their own provenance (the server judges them);
            // the others use the token the card shows.
            const shown = baseOf(updates);
            if (shown !== undefined) {
                // The `undefined` key holds content of UNKNOWN provenance.
                const foreign = new Map<
                    string | undefined,
                    Record<string, unknown>
                >();
                for (const key of fieldsOf(updates)) {
                    const authored = authoredBase(id, key);
                    if (!authored.exists) continue;
                    const unknown = authored.base === undefined;
                    if (
                        unknown ||
                        (authored.base !== shown &&
                            !descendsFrom(id, authored.base, shown) &&
                            !descendsFrom(id, shown, authored.base))
                    ) {
                        const group = foreign.get(authored.base) ?? {};
                        group[key] = (updates as Record<string, unknown>)[key];
                        foreign.set(authored.base, group);
                    }
                }
                if (foreign.size > 0) {
                    const rest: Record<string, unknown> = {
                        ...(updates as Record<string, unknown>),
                    };
                    for (const [authored, fields] of foreign) {
                        Object.keys(fields).forEach((key) => {
                            delete rest[key];
                            versions[key] = (versions[key] || 0) + 1;
                            // the newest value is the one that travels
                            const queuedNow = pending.current[id]?.updates as
                                Record<string, unknown> | undefined;
                            if (queuedNow) delete queuedNow[key];
                            setIntents(
                                id,
                                intentsOf(id)
                                    .map((intent) =>
                                        intent.state === 'failed' &&
                                        key in intent.fields
                                            ? {
                                                  ...intent,
                                                  fields: Object.fromEntries(
                                                      Object.entries(
                                                          intent.fields
                                                      ).filter(
                                                          ([k]) => k !== key
                                                      )
                                                  ),
                                              }
                                            : intent
                                    )
                                    .filter(
                                        (intent) =>
                                            intent.state !== 'failed' ||
                                            Object.keys(intent.fields).length >
                                                0
                                    )
                            );
                        });
                        retain(
                            id,
                            'failed',
                            {
                                ...fields,
                                ...(authored !== undefined
                                    ? { [VERSION_KEY]: authored }
                                    : {}),
                            } as unknown as T,
                            clockOf(id, Object.keys(fields))
                        );
                    }
                    updates = rest as unknown as T;
                }
            }
            const current = pending.current[id];
            if (current) window.clearTimeout(current.timer);
            // The waiting fields join the new ones only if they are proven to
            // be based on the same card state. Otherwise they are moved aside
            // as a group of their own: they are never promoted to a version
            // they were not written on.
            let carried: T | undefined = current?.updates;
            const carriedOrder = clockOf(id, fieldsOf(carried));
            Object.keys(updates).forEach((key) => {
                versions[key] = (versions[key] || 0) + 1;
            });
            if (
                carried &&
                fieldsOf(carried).length > 0 &&
                resolvedBaseOf(id, carried) !== resolvedBaseOf(id, updates)
            ) {
                retain(id, 'failed', carried, carriedOrder);
                carried = undefined;
            }
            const mergedUpdates = {
                ...(carried || {}),
                ...updates,
            } as T;
            const timer = held.current.has(id)
                ? 0
                : window.setTimeout(() => void flushSave(id), delay);
            pending.current[id] = { timer, updates: mergedUpdates };
            lastTouched.current = id;
            refreshState();
        },
        [delay, flushSave, refreshState]
    );

    const flushPending = useCallback(() => {
        // Conflicted and blocked writes are deliberately absent: they are not
        // replayed.
        const ids = new Set([
            ...Object.keys(pending.current),
            ...Object.keys(retained.current).filter(
                (id) => intentsOf(id, 'failed').length > 0
            ),
            ...Object.keys(inFlight.current),
        ]);
        return Promise.all([...ids].map(flushSave)).then(() => undefined);
    }, [flushSave]);

    const holdCard = useCallback((id: string) => {
        held.current.add(id);
        const queued = pending.current[id];
        if (queued) window.clearTimeout(queued.timer);
    }, []);

    const releaseCard = useCallback(
        (id: string) => {
            held.current.delete(id);
            wake(id);
            // Failed writes rejoin the next flush (each with its own version)
            // so nothing typed is lost when the deletion did not happen.
            if (pending.current[id] || intentsOf(id, 'failed').length > 0) {
                void flushSave(id);
            }
        },
        [flushSave]
    );

    const discardCard = useCallback(
        (id: string) => {
            held.current.delete(id);
            // Writes already on the wire cannot be recalled; bumping the epoch
            // makes their late outcome (success or failure) invisible, and the
            // card's next life starts on a queue of its own.
            clearCard(id);
            refreshState();
        },
        [refreshState]
    );

    useEffect(() => {
        mounted.current = true;
        const handlePageHide = () => void flushPending();
        const handleOnline = () => void flushPending();
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('online', handleOnline);

        return () => {
            mounted.current = false;
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('online', handleOnline);
            // Leaving the board: what is queued still goes out (flushSave
            // refuses it when the owner is no longer the same), and nothing
            // that comes back is reported to a screen that no longer exists.
            void flushPending();
        };
    }, [flushPending]);

    // Sizes of the bookkeeping kept for a card (used by tests to prove that
    // references are released once every write has settled).
    const diagnostics = useCallback(
        (id: string) => ({
            lineage: lineage.current[id]?.size ?? 0,
            awaiting: awaiting.current[id]?.size ?? 0,
        }),
        []
    );

    // Every unsent content kept in memory for a card, one entry per intention
    // with its own state, provenance (`base`), fields and logical order.
    const recoverable = useCallback((id: string): RecoverableIntent[] => {
        const out: RecoverableIntent[] = intentsOf(id).map((intent) => ({
            id: intent.id,
            state: intent.state,
            fields: { ...intent.fields },
            base: intent.base,
            order: intent.order,
        }));
        superseded.current[id]?.forEach((entries) =>
            entries.forEach((entry) =>
                out.push({
                    id: ++intentSeq.current,
                    state: 'displaced',
                    fields: { [entry.key]: entry.value },
                    base: entry.base,
                    order: entry.order,
                })
            )
        );
        suspendedDirect.current[id]?.forEach((entry) =>
            out.push({
                id: ++intentSeq.current,
                state: 'suspended',
                fields: { ...entry.fields },
                base: entry.base,
                order: entry.order,
            })
        );
        const queued = pending.current[id]?.updates;
        if (queued && fieldsOf(queued).length > 0) {
            out.push({
                id: ++intentSeq.current,
                state: 'pending',
                fields: splitGroup(queued).fields,
                base: baseOf(queued),
                order: clockOf(id, fieldsOf(queued)),
            });
        }
        return out.sort((a, b) => a.order - b.order);
    }, []);

    // Resolves once every write already on its way for the card has ended
    // (acknowledged or failed): what a deletion waits for before it reads the
    // card's own token.
    const settle = useCallback(
        async (
            id: string,
            maxWaitMs?: number
        ): Promise<'settled' | 'uncertain'> => {
            const startedAt = Date.now();
            // Only requests that REALLY left are waited for: an intention that
            // is suspended or queued behind the hold cannot leave and would
            // make the wait last forever.
            for (;;) {
                const live = wire.current[id];
                if (!live || live.size === 0) break;
                const ended = Promise.all([...live]).then(() => 'ended');
                if (maxWaitMs === undefined) {
                    await ended;
                    continue;
                }
                const left = maxWaitMs - (Date.now() - startedAt);
                if (left <= 0) return 'uncertain';
                let timer: ReturnType<typeof setTimeout> | undefined;
                const expired = new Promise<string>((resolve) => {
                    timer = setTimeout(() => resolve('expired'), left);
                });
                const winner = await Promise.race([ended, expired]);
                if (timer !== undefined) clearTimeout(timer);
                if (winner === 'expired') return 'uncertain';
            }
            return unresolvedNow(id).length > 0 ? 'uncertain' : 'settled';
        },
        []
    );

    // The board adopted a read of the card: answers to requests that were
    // already on the wire are older than it, and the unproven writes no longer
    // matter (the token is now one the server just handed out).
    const reloaded = useCallback((id: string) => {
        adoptions.current[id] = (adoptions.current[id] || 0) + 1;
        // A read is not a receipt: with the D1 protocol proven, an operation
        // that may still be applied stays unresolved after it. Historical
        // regime (no receipts exist): the read replaces the unproven token.
        // (the regime is a property of each operation, not of the page)
        forgetUnresolved(id);
    }, []);

    const lifeOfCard = useCallback((id: string): (() => boolean) => {
        const stillAlive = lifeOf(id);
        return () => stillAlive() && ownerOk();
    }, []);

    // The token a write based on `base` must carry NOW: `base` advanced along
    // this card's own acknowledged writes. `undefined` when that base is known
    // to be overtaken (a superseded answer), so nothing is sent on it.
    const rebase = useCallback((id: string, base: string | undefined) => {
        if (base === undefined) return undefined;
        const resolved = baseOf(resolveBase(id, { [VERSION_KEY]: base } as T));
        if (resolved === undefined) return undefined;
        return unreliable.current[id]?.has(resolved) ? undefined : resolved;
    }, []);

    // Unsent content still held in memory for a card (the durable copy is the
    // journal's; this is what the screen can show without waiting for it).
    const unsynced = useCallback(
        (id: string): RecoverableIntent[] => recoverable(id),
        [recoverable]
    );

    return {
        saveState,
        localSave,
        unsynced,
        scheduleSave,
        flushPending,
        holdCard,
        releaseCard,
        discardCard,
        runExclusive,
        writeDirect,
        diagnostics,
        recoverable,
        settle,
        rebase,
        reloaded,
        lifeOf: lifeOfCard,
        invalidateAll,
    };
};
