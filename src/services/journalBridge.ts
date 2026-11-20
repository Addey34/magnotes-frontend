/**
 * MGN-DATA-01 / D2-S1 — what the autosave coordinator tells the journal.
 *
 * The coordinator stays the only engine of intentions; this port only MIRRORS
 * its transitions into durable records, namespaced by the authenticated owner.
 * It keeps no registry of operations: the identity (mutation id, body, regime)
 * is the one the protocol layer owns (`identityOf` is idempotent on the
 * request key), so the id written here is the id that leaves on the wire.
 *
 *   draft(...)      typed content, recorded BEFORE the debounce
 *   freeze(...)     the exact operation, recorded durably BEFORE its first
 *                   emission; the draft fields it carries leave the draft
 *   acknowledged()  closes ONLY that operation
 *   refused()       a final refusal: content kept as a conflict
 *   uncertain()     the operation stays, marked ambiguous
 *   retryable()     certain failure, not final: back to a draft
 */

import {
    OperationContext,
    canonical,
    findIdentity,
    identityOf,
    requestKeyOf,
    sameContext,
    stampRegime,
} from './mutationProtocol';
import { contextNow } from './operationContext';
import {
    ConflictReason,
    DraftRecord,
    LocalJournal,
    OpRecord,
    ConflictRecord,
    keyOf,
} from './localJournal';

type Payload = Record<string, unknown> & { etag?: string };

const split = (payload: unknown) => {
    const { etag, ...fields } = (payload ?? {}) as Payload;
    return {
        base: typeof etag === 'string' && etag !== '' ? etag : undefined,
        fields,
    };
};

export interface JournalPort {
    /** the durable owner (account id) right now; null: nothing is recorded */
    owner: () => string | null;
    draft: (id: string, payload: unknown) => Promise<boolean>;
    freeze: (id: string, payload: unknown) => Promise<boolean>;
    /**
     * `proof`: the mutation id the protocol layer acknowledged, if any.
     * `nextBase`: the version token the acknowledgement produced: the base the
     * card moved to CAUSALLY (a legitimate rebase of what was typed before).
     */
    acknowledged: (
        id: string,
        payload: unknown,
        proof?: string,
        nextBase?: string
    ) => Promise<boolean>;
    /**
     * Exclusive take-over of a record another page wrote (compare-and-set on
     * its previous writer). Resolves to the record as it now stands, or false
     * when another page won / the storage failed: nothing moved then.
     */
    take: (
        record: DraftRecord | OpRecord | ConflictRecord,
        options?: { as?: 'draft'; base?: string | null }
    ) => Promise<DraftRecord | OpRecord | false>;
    refused: (
        id: string,
        payload: unknown,
        reason: ConflictReason
    ) => Promise<boolean>;
    uncertain: (id: string, payload: unknown) => Promise<boolean>;
    retryable: (id: string, payload: unknown) => Promise<boolean>;
    /** forget the mirror of a card (its life ended); records stay stored */
    forget: (id: string) => void;
    /**
     * The user abandoned these records (local copy only: a request that
     * already left is not cancelled): the memory mirrors forget them so they
     * are not silently written again.
     */
    release: (records: Array<DraftRecord | OpRecord | ConflictRecord>) => void;
    /** the local storage was deleted: every mirror is forgotten (all tabs) */
    reset: () => void;
    /**
     * R8 — a DELETE is recorded durably BEFORE it leaves (with the card's
     * snapshot, the only thing a restore of exactly this deletion needs) and
     * its row follows the protocol layer's own verdict about the operation.
     */
    deletion: {
        begin: (
            card: { _id: string },
            etag: string | undefined
        ) => Promise<void>;
        /**
         * What the protocol layer says of the request that left. `result` is
         * what the caller saw: 'ok' (answered with proof) or 'error'. It acts
         * on the owner and the context CAPTURED by `begin`, never on whoever
         * is signed in now.
         */
        outcome: (
            id: string,
            etag: string | undefined,
            result?: 'ok' | 'error'
        ) => Promise<void>;
        /** The request never left (its context was gone): the row is closed. */
        abort: (id: string, etag: string | undefined) => Promise<void>;
    };
    journal: LocalJournal;
}

export function createJournalPort(
    journal: LocalJournal,
    owner: () => string | null
): JournalPort {
    // mirror of what the draft rows of THIS tab currently hold: resource|base
    const drafts = new Map<string, Record<string, unknown>>();
    const frozen = new Map<string, OpRecord>();
    // The mutation id each logical request was frozen under. The protocol
    // layer forgets an identity once it is closed (and mints a NEW id for the
    // same request later), so an outcome is always matched to what was
    // recorded at freeze time, never to a freshly minted identity.
    const issued = new Map<string, string>();
    // newBase -> the base it was reached FROM, recorded only on a causal
    // acknowledgement: the sole evidence that two draft bases are one lineage.
    const ancestry = new Map<string, string>();
    const ancestorsOf = (id: string, base: string | undefined): Set<string> => {
        const out = new Set<string>();
        let at = base;
        while (at !== undefined && ancestry.has(`${id}|${at}`)) {
            at = ancestry.get(`${id}|${at}`);
            if (at === undefined || out.has(at)) break;
            out.add(at);
        }
        return out;
    };
    const draftKey = (id: string, base: string | undefined) =>
        `${id}|${base ?? ''}`;

    const identity = (id: string, payload: unknown) => {
        const { base, fields } = split(payload);
        return {
            base,
            fields,
            op: identityOf('PATCH', id, base, fields, contextNow()),
        };
    };

    const requestKey = (id: string, payload: unknown): string => {
        const { base, fields } = split(payload);
        return requestKeyOf('PATCH', id, base, fields, contextNow());
    };

    // the durable row of each DELETE of this page, by resource|base
    // with the owner and the context it was recorded under: an outcome never
    // reads who is signed in NOW (it may be someone else, or a new session).
    const deletions = new Map<
        string,
        { who: string; context: OperationContext; record: OpRecord }
    >();
    const forgetAll = () => {
        deletions.clear();
        drafts.clear();
        frozen.clear();
        issued.clear();
        ancestry.clear();
    };
    // Another tab deleted the local storage: what this tab mirrors must not
    // bring it back at the next keystroke.
    let channel: BroadcastChannel | undefined;
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            channel = new BroadcastChannel('magnotes-journal-control');
            channel.onmessage = (event: MessageEvent) => {
                const data = event.data as { type?: string; owner?: string };
                if (data?.type === 'purged' && data.owner === owner()) {
                    forgetAll();
                }
            };
        }
    } catch {
        channel = undefined;
    }

    return {
        journal,
        owner,
        release: (records) => {
            for (const record of records) {
                if (record.kind === 'draft') {
                    const row = record as DraftRecord;
                    drafts.delete(
                        draftKey(row.resource, row.base ?? undefined)
                    );
                } else if (record.kind === 'op') {
                    const row = record as OpRecord;
                    frozen.delete(row.mutationId);
                    for (const [key, id] of [...issued]) {
                        if (id === row.mutationId) issued.delete(key);
                    }
                }
            }
        },
        deletion: {
            begin: async (card, etag) => {
                const who = owner();
                const context = contextNow();
                if (!who || !etag) return;
                const op = identityOf('DELETE', card._id, etag, null, context);
                if (!op) return;
                stampRegime(op);
                const snapshot = JSON.parse(JSON.stringify(card)) as Record<
                    string,
                    unknown
                >;
                const record = await journal.recordOperation(who, {
                    resource: card._id,
                    method: 'DELETE',
                    mutationId: op.id,
                    base: etag,
                    body: { card: snapshot },
                    regime: op.regime,
                });
                if (record) {
                    deletions.set(`${card._id}|${etag}`, {
                        who,
                        context,
                        record,
                    });
                }
            },
            outcome: async (id, etag, result = 'error') => {
                const key = `${id}|${etag}`;
                const held = deletions.get(key);
                if (!held) return;
                const { who, context, record } = held;
                // The protocol layer decides: an operation it still holds as
                // ambiguous stays durable and uncertain.
                const live = findIdentity('DELETE', id, etag, null, context);
                const markAmbiguous = async () => {
                    const marked: OpRecord = {
                        ...record,
                        state: 'ambiguous',
                        regime: live?.regime === 'd1' ? 'd1' : record.regime,
                    };
                    deletions.set(key, { who, context, record: marked });
                    await journal.markAmbiguous(who, id, marked);
                };
                if (live && !live.closed && live.ambiguous) {
                    await markAmbiguous();
                    return;
                }
                // The request left in a context that is gone (another account,
                // a new session of the same account): an identity absent from
                // the registry proves nothing there. Only an answer WITH proof
                // closes the row; anything else stays durable and uncertain.
                const gone =
                    owner() !== who || !sameContext(context, contextNow());
                if (gone && result !== 'ok') {
                    await markAmbiguous();
                    return;
                }
                deletions.delete(key);
                await journal.closeOp(who, id, record.mutationId);
            },
            abort: async (id, etag) => {
                const key = `${id}|${etag}`;
                const held = deletions.get(key);
                if (!held) return;
                deletions.delete(key);
                await journal.closeOp(held.who, id, held.record.mutationId);
            },
        },
        reset: () => {
            forgetAll();
            const who = owner();
            if (who) channel?.postMessage({ type: 'purged', owner: who });
        },
        draft: async (id, payload) => {
            const who = owner();
            if (!who) return false;
            const { base, fields } = split(payload);
            const mirror = {
                ...(drafts.get(draftKey(id, base)) ?? {}),
                ...fields,
            };
            drafts.set(draftKey(id, base), mirror);
            return journal.saveDraft(who, id, base, mirror);
        },
        freeze: async (id, payload) => {
            const who = owner();
            if (!who) return false;
            const { base, fields, op } = identity(id, payload);
            if (!op) return false;
            // the regime is part of what is frozen BEFORE the emission: once
            // the protocol is proven the operation leaves as d1 (sendLogical
            // stamps it again at the wire; a later change is written back by
            // `uncertain`)
            stampRegime(op);
            // what remains of the draft once the operation carries its fields:
            // a newer value of a field (typed since) stays a draft
            const mirror = { ...(drafts.get(draftKey(id, base)) ?? {}) };
            for (const key of Object.keys(fields)) {
                if (
                    key in mirror &&
                    canonical(mirror[key]) === canonical(fields[key])
                ) {
                    delete mirror[key];
                }
            }
            drafts.set(draftKey(id, base), mirror);
            // Draft rows of OTHER bases lose a field only when their base is a
            // causal ancestor of this operation's base (the card moved from it
            // to this one through an acknowledged write) and the value is the
            // one carried. Equal content on an unrelated base is independent
            // typing, never evidence of lineage.
            const lineage = ancestorsOf(id, base);
            const others: Array<{
                base: string | undefined;
                fields: Record<string, unknown> | null;
            }> = [];
            for (const [key, held] of drafts) {
                if (!key.startsWith(`${id}|`) || key === draftKey(id, base)) {
                    continue;
                }
                const otherBase = key.slice(id.length + 1);
                if (!lineage.has(otherBase)) continue;
                const rest = { ...held };
                let changed = false;
                for (const field of Object.keys(fields)) {
                    if (
                        field in rest &&
                        canonical(rest[field]) === canonical(fields[field])
                    ) {
                        delete rest[field];
                        changed = true;
                    }
                }
                if (!changed) continue;
                drafts.set(key, rest);
                others.push({
                    base: otherBase === '' ? undefined : otherBase,
                    fields: Object.keys(rest).length > 0 ? rest : null,
                });
            }
            const ok = await journal.freeze(
                who,
                {
                    resource: id,
                    method: 'PATCH',
                    mutationId: op.id,
                    base,
                    body: op.body as Record<string, unknown>,
                    regime: op.regime,
                    // a replay of an operation already ambiguous stays so
                    state: frozen.get(op.id)?.state,
                },
                Object.keys(mirror).length > 0 ? mirror : null,
                base,
                others
            );
            if (ok) {
                issued.set(requestKey(id, payload), op.id);
                frozen.set(op.id, {
                    key: keyOf(who, id, 'op', op.id),
                    kind: 'op',
                    schema: 1,
                    owner: who,
                    resource: id,
                    writer: journal.writer,
                    at: Date.now(),
                    method: 'PATCH',
                    mutationId: op.id,
                    base: base ?? null,
                    body: op.body as Record<string, unknown>,
                    regime: op.regime,
                    state: frozen.get(op.id)?.state ?? 'frozen',
                    covered: Object.keys(fields),
                });
            }
            return ok;
        },
        acknowledged: async (id, payload, proof, nextBase) => {
            const who = owner();
            if (!who) return false;
            const key = requestKey(id, payload);
            const mutationId = issued.get(key);
            if (!mutationId) return false; // never frozen by this page
            // the proof must be the one of THIS operation, not of another
            if (proof !== undefined && proof !== mutationId) return false;
            const { base } = split(payload);
            issued.delete(key);
            frozen.delete(mutationId);
            // The card moved from `base` to `nextBase` through THIS operation:
            // the answer carrying the proof IS the causal evidence, whether or
            // not the local closure below succeeds. It is recorded BEFORE any
            // await, because the next write of the card (rebased on this very
            // answer) freezes right after it and must already see the lineage.
            if (nextBase && base !== undefined && nextBase !== base) {
                ancestry.set(`${id}|${nextBase}`, base);
            }
            return journal.closeOp(who, id, mutationId);
        },
        refused: async (id, payload, reason) => {
            const who = owner();
            if (!who) return false;
            const { base, fields } = split(payload);
            const key = requestKey(id, payload);
            const mutationId = issued.get(key) ?? null;
            issued.delete(key);
            if (mutationId) frozen.delete(mutationId);
            return journal.recordConflict(
                who,
                id,
                base,
                fields,
                reason,
                mutationId,
                mutationId ? [keyOf(who, id, 'op', mutationId)] : []
            );
        },
        uncertain: async (id, payload) => {
            const who = owner();
            if (!who) return false;
            const mutationId = issued.get(requestKey(id, payload));
            const record = mutationId ? frozen.get(mutationId) : undefined;
            if (!record) return false;
            // the regime may have become d1 between the freeze and the wire
            const live = findIdentity(
                'PATCH',
                id,
                split(payload).base,
                split(payload).fields,
                contextNow()
            );
            const marked = {
                ...record,
                state: 'ambiguous' as const,
                regime: live?.regime === 'd1' ? ('d1' as const) : record.regime,
            };
            frozen.set(record.mutationId, marked);
            return journal.markAmbiguous(who, id, marked);
        },
        retryable: async (id, payload) => {
            const who = owner();
            if (!who) return false;
            const { base, fields } = split(payload);
            const key = requestKey(id, payload);
            const mutationId = issued.get(key);
            const record = mutationId ? frozen.get(mutationId) : undefined;
            if (!record) return false;
            issued.delete(key);
            frozen.delete(record.mutationId);
            // newer typed values win over the older ones that come back
            const mirror = {
                ...fields,
                ...(drafts.get(draftKey(id, base)) ?? {}),
            };
            drafts.set(draftKey(id, base), mirror);
            return journal.thaw(who, record, mirror);
        },
        take: async (record, options = {}) => {
            const who = owner();
            // a record of another account is never read, taken or moved
            if (!who || record.owner !== who) return false;
            const base =
                options.base !== undefined ? options.base : record.base;
            const taken = await journal.take(who, record, {
                ...options,
                // read again for every attempt: typing never waits for a take-over
                own: () =>
                    drafts.get(draftKey(record.resource, base ?? undefined)),
            });
            if (taken && taken.kind === 'draft') {
                // what was typed since is newer than what the row carries
                const key = draftKey(record.resource, taken.base ?? undefined);
                drafts.set(key, {
                    ...taken.fields,
                    ...(drafts.get(key) ?? {}),
                });
            }
            if (taken && taken.kind === 'op')
                frozen.set(taken.mutationId, taken);
            return taken;
        },
        forget: (id) => {
            for (const key of [...issued.keys()]) {
                if (key.includes(`|PATCH|${id}|`)) issued.delete(key);
            }
            for (const key of [...drafts.keys()]) {
                if (key.startsWith(`${id}|`)) drafts.delete(key);
            }
            for (const key of [...ancestry.keys()]) {
                if (key.startsWith(`${id}|`)) ancestry.delete(key);
            }
        },
    };
}

export type { DraftRecord };
