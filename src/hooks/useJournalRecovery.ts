import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ConflictRecord,
    DraftRecord,
    LocalJournal,
    OpRecord,
} from '../services/localJournal';
import {
    ReplayVerdict,
    collectRecoverable,
    replayRecoveredOperation,
} from '../services/journalRecovery';
import { ServerCardView, readServerCard } from '../services/boardApi';
import type { JournalPort } from '../services/journalBridge';
import { PostIt } from '../types/boardTypes';
import { contextNow } from '../services/operationContext';
import { currentGeneration } from '../services/sessionCoordinator';
import { prefixOf } from '../services/localJournal';

export type RecoveryKind = 'draft' | 'op' | 'conflict';

export interface RecoveryItem {
    key: string;
    kind: RecoveryKind;
    resource: string;
    title: string | null;
    fields: Record<string, unknown>;
    base: string | null;
    reason?: ConflictRecord['reason'];
    /** the card as it is shown on screen (may hold optimistic values) */
    card?: PostIt;
    /**
     * The writer of this record is not provably dead and not provably alive
     * (no Web Locks): nothing is taken automatically, the user decides.
     */
    undetermined?: boolean;
    /** a draft whose base version is unknown: never sent automatically */
    unknownBase?: boolean;
    /** the HTTP method of a recorded operation (PATCH, DELETE) */
    method?: string;
    record: DraftRecord | OpRecord | ConflictRecord;
}

/** What the last action on an item said (shown by the panel). */
export type RecoveryNote =
    | ReplayVerdict
    | 'verify-failed'
    | 'storage'
    | 'taken-elsewhere'
    | 'kept'
    | 'in-doubt'
    | 'restored'
    | 'done';

interface Options {
    /** the durable owner right now (null: signed out, demo) */
    owner: () => string | null;
    journal: LocalJournal;
    port: JournalPort;
    cards: PostIt[];
    /** the board currently shown (where a card absent from the screen lives) */
    activeTabId?: string | null;
    /** a new, explicit user intention on the card's current version */
    scheduleSave: (id: string, updates: Record<string, unknown>) => void;
    reloadCard: (id: string) => Promise<void>;
    /** R8: puts back a card whose deletion was applied, on that deletion's proof */
    restoreDeleted: (
        snapshot: PostIt,
        proof: { etag: string; mutationId?: string }
    ) => Promise<void>;
    /** sends what was just taken over without waiting for the debounce */
    flush: () => Promise<void>;
    /**
     * Runs a task in the card's own write queue (the only coordination there
     * is): a recovered operation never races an active write of the same card.
     */
    exclusive: <R>(id: string, task: () => Promise<R>) => Promise<R>;
    /** bumps whenever the coordinator's state moves (re-reads the journal) */
    tick: unknown;
}

/**
 * Recovery of the journal for the authenticated owner: what an interrupted
 * page left is read only once the account is confirmed, taken over only from
 * writers proven dead through an exclusive compare-and-set, and what cannot
 * resolve itself is handed to the user.
 */
export function useJournalRecovery({
    owner,
    journal,
    port,
    cards,
    activeTabId,
    scheduleSave,
    reloadCard,
    restoreDeleted,
    flush,
    exclusive,
    tick,
}: Options) {
    const [items, setItems] = useState<RecoveryItem[]>([]);
    const [notes, setNotes] = useState<Record<string, RecoveryNote>>({});
    const [servers, setServers] = useState<Record<string, ServerCardView>>({});
    const handled = useRef(new Set<string>());
    // A page that was just closed may still hold its writer lock for a moment:
    // what it wrote is looked at again shortly, never taken while it lives.
    const [recheck, setRecheck] = useState(0);
    const rechecks = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const cardsRef = useRef(cards);
    cardsRef.current = cards;
    // The latest callbacks: the take-over is a multi-step transaction that must
    // never be abandoned half-way because the screen re-rendered.
    const live = useRef({
        owner,
        port,
        scheduleSave,
        reloadCard,
        restoreDeleted,
        flush,
        exclusive,
        activeTabId,
    });
    live.current = {
        owner,
        port,
        scheduleSave,
        reloadCard,
        restoreDeleted,
        flush,
        exclusive,
        activeTabId,
    };
    // Who, in which session, authorized an action: the account AND the session
    // generation (a sign-out and sign-in of the same account is another one).
    const stampNow = () =>
        `${live.current.owner() ?? ''}|${currentGeneration()}`;
    const running = useRef(false);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    // `refresh` must be STABLE (it is an effect dependency): the owner is read
    // through the live ref. The list is replaced only when what it SHOWS
    // changed (record, card version and content included): otherwise every
    // render would trigger a read and a new list, an endless loop.
    const lastShown = useRef('');
    const show = (next: RecoveryItem[]) => {
        const signature = JSON.stringify(
            next.map((item) => [
                item.key,
                item.record.at,
                item.title,
                item.undetermined ?? false,
                item.unknownBase ?? false,
                item.card?.etag ?? null,
                item.card?.content ?? null,
            ])
        );
        if (signature === lastShown.current) return;
        lastShown.current = signature;
        setItems(next);
    };
    const note = (key: string, value: RecoveryNote) => {
        if (alive.current) setNotes((all) => ({ ...all, [key]: value }));
    };

    const refresh = useCallback(async () => {
        const who = live.current.owner();
        if (!who) {
            if (alive.current) show([]);
            return;
        }
        const found = await collectRecoverable(journal, who);
        // an account change while reading: nothing of it is shown
        if (!alive.current || live.current.owner() !== who) return;
        const byId = new Map(cardsRef.current.map((card) => [card._id, card]));
        const make = (
            record: DraftRecord | OpRecord | ConflictRecord,
            extra: Partial<RecoveryItem> = {}
        ): RecoveryItem => {
            const card = byId.get(record.resource);
            return {
                key: record.key,
                kind: record.kind,
                resource: record.resource,
                title: card?.title ?? null,
                fields:
                    record.kind === 'op'
                        ? (record as OpRecord).body
                        : (record as DraftRecord | ConflictRecord).fields,
                base: record.base,
                reason:
                    record.kind === 'conflict'
                        ? (record as ConflictRecord).reason
                        : undefined,
                card,
                record,
                method:
                    record.kind === 'op'
                        ? (record as OpRecord).method
                        : undefined,
                ...extra,
            };
        };
        const undetermined = new Set(found.undetermined.map((r) => r.key));
        show([
            ...found.conflicts.map((record) => make(record)),
            ...found.ops.map((record) => make(record)),
            ...found.undetermined
                .filter((record) => record.kind === 'op')
                .map((record) => make(record, { undetermined: true })),
            // a draft of THIS page is live state of the coordinator, not a
            // loss; one of a dead page without a known base is handed over
            ...found.drafts
                .filter((draft) => draft.writer !== journal.writer)
                .map((draft) =>
                    make(draft, { unknownBase: draft.base === null })
                ),
            ...found.undetermined
                .filter((record) => record.kind === 'draft')
                .map((record) =>
                    make(record, {
                        undetermined: undetermined.has(record.key),
                        unknownBase: record.base === null,
                    })
                ),
        ]);
    }, [journal]);

    // Automatic take-over, only from pages PROVEN dead, and only through the
    // exclusive compare-and-set of the journal: two successors racing for the
    // same record cannot both win. A draft goes back through the normal queue
    // on the version it was AUTHORED on (the server judges it: a changed card
    // becomes a conflict, never an overwrite); a draft whose base is unknown
    // is NEVER rebased onto the card's current version: it is handed to the
    // user. A recovered operation is replayed as the same request, once, only
    // when the protocol is proven.
    useEffect(() => {
        const who = live.current.owner();
        if (!who || cards.length === 0 || running.current) return;
        running.current = true;
        void (async () => {
            try {
                const found = await collectRecoverable(journal, who);
                let lostRace = false;
                const at = stampNow();
                const authorized = contextNow();
                const same = () => stampNow() === at;
                if (!same()) return;
                const byId = new Map(
                    cardsRef.current.map((card) => [card._id, card])
                );
                for (const draft of found.drafts) {
                    if (draft.writer === journal.writer) continue;
                    const card = byId.get(draft.resource);
                    if (!card || handled.current.has(draft.key)) continue;
                    if (draft.base === null) continue; // assisted recovery
                    handled.current.add(draft.key);
                    const taken = await live.current.port.take(draft);
                    if (!taken || taken.kind !== 'draft') {
                        lostRace = true; // another page owns it now: keep watching it
                        continue;
                    }
                    if (!same()) return;
                    live.current.scheduleSave(draft.resource, {
                        ...taken.fields,
                        etag: draft.base,
                    });
                    void live.current.flush();
                }
                for (const op of found.ops) {
                    const card = byId.get(op.resource);
                    if (!card || handled.current.has(op.key)) continue;
                    if (op.writer === journal.writer) continue;
                    // a deletion is never replayed on its own (it could remove a
                    // card the user sees alive): it is resolved by the user
                    if (op.method !== 'PATCH') continue;
                    handled.current.add(op.key);
                    const taken = await live.current.port.take(op);
                    if (!taken || taken.kind !== 'op') {
                        lostRace = true;
                        continue;
                    }
                    if (!same()) return;
                    const verdict = await live.current.exclusive(
                        op.resource,
                        () =>
                            replayRecoveredOperation(
                                journal,
                                who,
                                taken,
                                authorized
                            )
                    );
                    if (verdict === 'applied' && same()) {
                        await live.current.reloadCard(op.resource);
                    }
                }
                await refresh();
                // no proof of liveness yet: look again shortly, a closing page
                // releases its lock
                // (quickly at first, then every 2 s for as long as another
                // page holds work: it may close at any moment, and a page
                // that stopped looking would never take its work over)
                if ((found.foreign > 0 || lostRace) && mounted.current) {
                    const delay = rechecks.current < 40 ? 150 : 2000;
                    rechecks.current += 1;
                    window.setTimeout(() => {
                        if (mounted.current) setRecheck((n) => n + 1);
                    }, delay);
                } else if (found.foreign === 0 && !lostRace) {
                    rechecks.current = 0;
                }
            } finally {
                running.current = false;
            }
        })();
    }, [cards.length, journal, tick, recheck]);

    useEffect(() => {
        void refresh();
    }, [refresh, tick, cards]);

    /** A read-only look at the server's own copy, for comparison only. */
    const compare = useCallback(async (item: RecoveryItem) => {
        const who = live.current.owner();
        const at = stampNow();
        if (!who || item.record.owner !== who) return;
        const tabId =
            cardsRef.current.find((c) => c._id === item.resource)?.tabId ??
            live.current.activeTabId;
        if (!who || !tabId) {
            setServers((all) => ({
                ...all,
                [item.key]: { state: 'unavailable' },
            }));
            return;
        }
        const view = await readServerCard(tabId, item.resource);
        if (!alive.current || stampNow() !== at) return;
        setServers((all) => ({ ...all, [item.key]: view }));
    }, []);

    /**
     * A NEW voluntary write: only after the user decides it, on a server
     * version that was just VERIFIED by a read (never on the screen's
     * possibly-optimistic copy, never on an unknown base). It is never
     * presented as the replay of the old write. The source stays until the
     * content is durable under the new intention (one atomic move); if the
     * server refuses the new write, the normal path keeps the content as a
     * conflict.
     */
    const resume = useCallback(
        async (item: RecoveryItem) => {
            const who = live.current.owner();
            const at = stampNow();
            // an item of another account, or one shown before a new session,
            // is never acted on
            if (!who || item.record.owner !== who) return;
            const tabId =
                cardsRef.current.find((c) => c._id === item.resource)?.tabId ??
                live.current.activeTabId;
            const view = tabId
                ? await readServerCard(tabId, item.resource)
                : ({ state: 'unavailable' } as ServerCardView);
            if (!alive.current || stampNow() !== at) return;
            if (view.state !== 'found' || !view.card.etag) {
                note(item.key, 'verify-failed');
                setServers((all) => ({ ...all, [item.key]: view }));
                return;
            }
            const base = view.card.etag;
            const taken = await live.current.port.take(item.record, {
                as: 'draft',
                base,
            });
            if (!taken || taken.kind !== 'draft') {
                note(item.key, 'storage');
                await refresh();
                return;
            }
            if (stampNow() !== at) return;
            live.current.scheduleSave(item.resource, {
                ...taken.fields,
                etag: base,
            });
            void live.current.flush();
            note(item.key, 'done');
            await refresh();
        },
        [refresh]
    );

    /** Replays the SAME request: no way around the protocol, no force. */
    const retry = useCallback(
        async (item: RecoveryItem) => {
            const who = live.current.owner();
            const at = stampNow();
            const authorized = contextNow();
            if (!who || item.kind !== 'op' || item.record.owner !== who) return;
            let op = item.record as OpRecord;
            if (op.writer !== journal.writer) {
                // an explicit decision: the exclusive claim comes first
                const taken = await live.current.port.take(op);
                if (!taken || taken.kind !== 'op') {
                    note(item.key, 'taken-elsewhere');
                    await refresh();
                    return;
                }
                op = taken;
            }
            const verdict = await live.current.exclusive(item.resource, () =>
                replayRecoveredOperation(journal, who, op, authorized)
            );
            if (stampNow() !== at) return;
            note(item.key, verdict);
            if (verdict === 'applied') {
                await live.current.reloadCard(item.resource);
            }
            await refresh();
        },
        [journal, refresh]
    );

    /**
     * R8 — resolve an uncertain DELETE by the SERVER's own copy, never by an
     * assumption (a 200, a 404 or equal content prove nothing about THIS
     * request):
     *  - the card exists there: the deletion is not in force; the local record
     *    goes (a request already sent cannot be cancelled: said to the user);
     *  - the card is absent: the deletion was applied; the card is restored
     *    strictly on the proof of THIS deletion (its base and id), never by an
     *    unconditional write, and never by a new deletion;
     *  - the server cannot be read: nothing changes.
     */
    const resolveDelete = useCallback(
        async (item: RecoveryItem) => {
            const who = live.current.owner();
            const at = stampNow();
            const op = item.record as OpRecord;
            const snapshot = (op.body as { card?: PostIt } | undefined)?.card;
            if (!who || op.owner !== who) return;
            if (op.kind !== 'op' || op.method !== 'DELETE') return;
            if (!snapshot) {
                note(item.key, 'verify-failed');
                return;
            }
            const view = await readServerCard(
                snapshot.tabId,
                item.resource,
                `${snapshot.title ?? ''} ${snapshot.content ?? ''}`
            );
            if (!alive.current || stampNow() !== at) return;
            setServers((all) => ({ ...all, [item.key]: view }));
            if (view.state === 'unavailable') {
                note(item.key, 'verify-failed');
                return;
            }
            if (view.state === 'found') {
                // A live card proves nothing about a request that may still be
                // in flight: the DELETE carried `op.base` as its precondition.
                // Only a card whose version is NOT that base shows the
                // request can no longer take effect on it (it changed, or it
                // is a new life); the row is then settled. On the very same
                // version the outcome is unknown: the snapshot stays, and
                // only an explicit abandon (or a later check) closes it.
                const etag = view.card.etag;
                if (!etag || etag === op.base) {
                    note(item.key, 'in-doubt');
                    return;
                }
                live.current.port.release([op]);
                await journal.discard([op.key]);
                note(item.key, 'kept');
                await live.current.reloadCard(item.resource);
                await refresh();
                return;
            }
            if (!op.base) {
                note(item.key, 'not-replayable');
                return;
            }
            try {
                await live.current.restoreDeleted(snapshot, {
                    etag: op.base,
                    mutationId: op.mutationId,
                });
            } catch {
                if (stampNow() === at) note(item.key, 'refused');
                return;
            }
            if (stampNow() !== at) return;
            live.current.port.release([op]);
            await journal.discard([op.key]);
            note(item.key, 'restored');
            await refresh();
        },
        [journal, refresh]
    );

    /**
     * An explicit abandon of the LOCAL copy. It does not cancel a request that
     * already left: the server may still apply it. The memory mirrors forget
     * the record, so it is not silently written again.
     */
    const abandon = useCallback(
        async (item: RecoveryItem) => {
            const who = live.current.owner();
            // the durable owner of the item, not whoever is signed in now
            if (
                !who ||
                item.record.owner !== who ||
                !item.key.startsWith(prefixOf(who))
            ) {
                return;
            }
            live.current.port.release([item.record]);
            await journal.discard([item.key]);
            await refresh();
        },
        [journal, refresh]
    );

    const clearAll = useCallback(async () => {
        const who = live.current.owner();
        if (!who) return;
        live.current.port.reset();
        await journal.purge(who);
        handled.current.clear();
        await refresh();
    }, [journal, refresh]);

    return {
        items,
        notes,
        servers,
        refresh,
        compare,
        resume,
        retry,
        resolveDelete,
        abandon,
        clearAll,
    };
}
