import {
    SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    createPostIt,
    deletePostIt,
    DeleteProof,
    duplicatePostIt,
    fetchPostIts,
    restorePostIt,
    updatePostIt,
} from '../services/boardApi';
import { DEFAULT_POST_IT } from '../constants/boardDefaults';
import {
    CardLink,
    PostIt,
    PostItStack,
    PostItUpdate,
} from '../types/boardTypes';
import { snapToGrid } from './useDragGrid';
import { computeDropIntent, DropIntent } from './dropIntent';
import {
    LayoutOptions,
    layoutBoardCards,
    resolveCardRect,
    stackMembers,
} from './stackLayout';
import { buildCardChange, CardChange, isNoOpChange } from './historyCommands';
import {
    HistoryEntry,
    HistoryPartialError,
    HistoryRefusedError,
    useHistory,
} from './useHistory';
import { drawnHeight, withMeasuredHeights } from './measuredHeights';
import {
    bringCardToFront,
    sendCardToBack,
    stepCardInStack,
    StackOrderChange,
} from './stackOrdering';
import { TemplateCardPayload } from '../utils/boardTemplate';
import { findFreePostItPosition } from '../utils/postItPlacement';
import { trackProductEvent } from '../services/analytics';
import { MissingVersionError, type CardWriteControl } from './useAutosave';
import { isDemoActive } from '../services/demoMode';
import {
    DeletionDeferredError,
    StaleLifecycleError,
    CardOutcome,
    isAppliedOutcome,
    isOutdatedResult,
    isStaleLifecycle,
    isSupersededResult,
    isUncertainOutcome,
    outcomeOfError,
    describeError,
} from '../services/concurrencyOutcome';

export type { DropIntent } from './dropIntent';

// Side effects a card deletion runs on its connections, so the undoable
// deletion can also snapshot/restore the card's links (owned by useConnections).
export interface CardDeleteLinkEffects {
    snapshot: () => CardLink[];
    dropLocal: () => void;
    restoreLocal: (links: CardLink[]) => void;
    restore: (links: CardLink[]) => Promise<void>;
}

// A deletion waits at most this long for the requests of the card that really
// left (UX bound, not a causal guarantee). If one of them is still unresolved
// at expiry, or ended without a usable answer, the token of the card cannot be
// proven: the deletion is NOT sent on a guessed base, the card and its
// intentions are kept and the user is told.
const SETTLE_WAIT_MS = 3000;

const MOVE_FIELDS = [
    'tabId',
    'stackId',
    'stackOrder',
    'x',
    'y',
    'zIndex',
] as const;

export const usePostIts = (
    activeTabId: string | null,
    onLoadError?: () => void,
    onMutationError?: () => void,
    cardWrites?: CardWriteControl
) => {
    // ---- lifecycle gate -----------------------------------------------------
    // `alive`: the board is still mounted (an account change or a sign-out
    // unmounts it). `lives`: one counter per card id, bumped when the card
    // leaves (server-confirmed deletion) and when a restore opens its next
    // life. An operation captures a guard BEFORE awaiting and checks it after:
    // an outcome that belongs to a previous life changes nothing.
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    const lives = useRef<Map<string, number>>(new Map());
    const lifeNow = (postItId: string) => lives.current.get(postItId) ?? 0;
    const bumpLife = (postItId: string) =>
        lives.current.set(postItId, lifeNow(postItId) + 1);
    const lifeGuard = (postItId: string): (() => boolean) => {
        const life = lifeNow(postItId);
        const coordinator = cardWrites?.lifeOf?.(postItId);
        return () =>
            alive.current &&
            lifeNow(postItId) === life &&
            (coordinator ? coordinator() : true);
    };
    // Counts the tokens the board adopted for a card (own acknowledgements,
    // reads, restores): a read that started before the last adoption is older
    // than the board and must not rewind its token.
    const tokenSeq = useRef<Map<string, number>>(new Map());
    const seqOf = (postItId: string) => tokenSeq.current.get(postItId) ?? 0;
    const bumpSeq = (postItId: string) =>
        tokenSeq.current.set(postItId, seqOf(postItId) + 1);

    // Delete a card on the server while its autosave queue stands still. The
    // policy (R1): capture the card's life, suspend new transmissions, wait
    // only for the requests that really left, advance the base only through
    // our own acknowledgements, then send DELETE with If-Match. The queued
    // writes are dropped only once the deletion is known to have succeeded and
    // resume if it failed (nothing typed is lost).
    const deleteCardOnServer = async (
        postItId: string,
        base: string | undefined,
        card?: PostIt
    ): Promise<DeleteProof | undefined> => {
        const stillCurrent = lifeGuard(postItId);
        // Proof of THIS deletion (the base it carried and its mutation id):
        // the only thing a restore of this very deletion may stand on.
        let proof: DeleteProof | undefined;
        cardWrites?.hold(postItId);
        try {
            const outcome = cardWrites?.settle
                ? await cardWrites.settle(postItId, SETTLE_WAIT_MS)
                : undefined;
            // The account, the session or the life of the card changed while
            // waiting: this deletion belongs to another context. It is never
            // sent (a late answer cannot trigger a DELETE in another life).
            if (!stillCurrent()) throw new StaleLifecycleError();
            if (outcome === 'uncertain') {
                cardWrites?.deferred?.(postItId);
                throw new DeletionDeferredError();
            }
            const etag = cardWrites?.rebase
                ? cardWrites.rebase(postItId, base)
                : base;
            // R8: the deletion is durable BEFORE it leaves, and its row follows
            // what the protocol layer says of it afterwards.
            if (card) await cardWrites?.deletion?.begin(card, etag);
            // The wait above is a transaction that can outlast the account or
            // the session: a request must not leave under another context
            // than the one that recorded it. The row, never sent, is closed
            // on the owner and context captured when it was written.
            if (!stillCurrent()) {
                if (card) await cardWrites?.deletion?.abort(postItId, etag);
                throw new StaleLifecycleError();
            }
            let result: 'ok' | 'error' = 'error';
            try {
                proof = (await deletePostIt(postItId, etag)) || undefined;
                result = 'ok';
            } finally {
                if (card) {
                    await cardWrites?.deletion?.outcome(postItId, etag, result);
                }
            }
        } catch (error) {
            // The answer of a DELETE, success or failure, belongs to the
            // context it was sent in: once that context is gone the failure is
            // a stale outcome (nothing to roll back, release or tell).
            if (!stillCurrent()) {
                throw isStaleLifecycle(error)
                    ? error
                    : new StaleLifecycleError();
            }
            cardWrites?.release(postItId);
            throw error;
        }
        // The server applied the deletion, but a context that is gone must not
        // see its queue discarded, its life bumped nor its history written.
        if (!stillCurrent()) throw new StaleLifecycleError();
        // The card is gone: its next life (a restore) starts clean.
        bumpLife(postItId);
        cardWrites?.discard(postItId);
        return proof;
    };

    const [postItsByTab, setPostItsByTabState] = useState<
        Record<string, PostIt[]>
    >({});
    // The boards as they are RIGHT NOW. React state only catches up on the next
    // render, but history closures and write bases must see every local change
    // the moment it is made, so each update is applied to this ref first.
    const postItsByTabRef = useRef(postItsByTab);
    const setPostItsByTab = useCallback(
        (update: SetStateAction<Record<string, PostIt[]>>) => {
            const next =
                typeof update === 'function'
                    ? update(postItsByTabRef.current)
                    : update;
            postItsByTabRef.current = next;
            setPostItsByTabState(next);
        },
        []
    );
    const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set());
    const [failedTabs, setFailedTabs] = useState<Set<string>>(() => new Set());
    const [loadingTabs, setLoadingTabs] = useState<Set<string>>(
        () => new Set()
    );
    const history = useHistory(60, onMutationError);

    const postIts = useMemo(
        () => (activeTabId ? postItsByTab[activeTabId] || [] : []),
        [activeTabId, postItsByTab]
    );

    const getNextZIndex = (cards: PostIt[]): number => {
        return cards.reduce((max, card) => Math.max(max, card.zIndex), 0) + 1;
    };

    const loadPostIts = useCallback(
        async (tabId: string) => {
            setLoadingTabs((current) => new Set(current).add(tabId));
            try {
                const loadedPostIts = await fetchPostIts(tabId);
                if (!alive.current) return;
                loadedPostIts.forEach((card) => {
                    bumpSeq(card._id);
                    cardWrites?.reloaded?.(card._id);
                });
                setPostItsByTab((current) => ({
                    ...current,
                    [tabId]: loadedPostIts,
                }));
                setLoadedTabs((current) => {
                    const next = new Set(current);
                    next.add(tabId);
                    return next;
                });
                setFailedTabs((current) => {
                    const next = new Set(current);
                    next.delete(tabId);
                    return next;
                });
            } catch {
                setFailedTabs((current) => new Set(current).add(tabId));
                onLoadError?.();
            } finally {
                setLoadingTabs((current) => {
                    const next = new Set(current);
                    next.delete(tabId);
                    return next;
                });
            }
        },
        [onLoadError]
    );

    // The token the board holds for a card right now (undefined if unloaded).
    const etagOf = (postItId: string): string | undefined => {
        for (const cards of Object.values(postItsByTabRef.current)) {
            const card = cards.find((postIt) => postIt._id === postItId);
            if (card) return card.etag;
        }
        return undefined;
    };

    // Read cards again through the existing list read path and adopt their
    // server state, EXCEPT the fields that still have an unacknowledged local
    // intention (they stay as the user left them). A failing read throws: the
    // caller decides; the card keeps whatever token it had (never refreshed
    // by guesswork) and writes on it stay refused or blocked.
    const refreshCards = async (
        tabId: string,
        ids: string[],
        protectedKeys: (id: string) => string[] = () => []
    ) => {
        let remaining = ids;
        // A read that started before the board adopted a newer token for a
        // card is older than the board for that card: it is dropped and the
        // card is read again (bounded).
        for (let attempt = 0; attempt < 3 && remaining.length > 0; attempt++) {
            const guards = new Map(remaining.map((id) => [id, lifeGuard(id)]));
            const seqBefore = new Map(remaining.map((id) => [id, seqOf(id)]));
            const fresh = await fetchPostIts(tabId);
            if (!alive.current) return;
            const byId = new Map(fresh.map((card) => [card._id, card]));
            const adopted: string[] = [];
            const overtaken: string[] = [];
            setPostItsByTab((state) => {
                let touched = false;
                const next: Record<string, PostIt[]> = {};
                for (const [key, cards] of Object.entries(state)) {
                    next[key] = cards.map((card) => {
                        if (!remaining.includes(card._id)) return card;
                        // The card left or was restored meanwhile: this read
                        // describes a life that no longer exists.
                        if (!guards.get(card._id)?.()) return card;
                        if (seqOf(card._id) !== seqBefore.get(card._id)) {
                            overtaken.push(card._id);
                            return card;
                        }
                        const server = byId.get(card._id);
                        // Absent on the server (deleted elsewhere): untouched.
                        if (!server) return card;
                        const keep = new Set([
                            ...protectedKeys(card._id),
                            ...(cardWrites?.unsentFields?.(card._id) ?? []),
                        ]);
                        const merged: Record<string, unknown> = { ...server };
                        keep.forEach((field) => {
                            merged[field] = (
                                card as unknown as Record<string, unknown>
                            )[field];
                        });
                        touched = true;
                        adopted.push(card._id);
                        return merged as unknown as PostIt;
                    });
                }
                return touched ? next : state;
            });
            adopted.forEach((id) => {
                bumpSeq(id);
                cardWrites?.reloaded?.(id);
            });
            remaining = overtaken;
        }
    };

    // After a write the server declared overtaken (superseded): read the card
    // again, wherever it lives now. Absent card: nothing to do.
    const reloadCard = async (postItId: string, protectedKeys: string[]) => {
        for (const [tabId, cards] of Object.entries(postItsByTabRef.current)) {
            if (cards.some((card) => card._id === postItId)) {
                await refreshCards(tabId, [postItId], () => protectedKeys);
                return;
            }
        }
    };

    // Put a card back on the server (undo of a deletion, redo of a creation)
    // and ADOPT the card the server answers with: its new token and dates. The
    // snapshot's token is history and is never reused. Fields the user edited
    // while the restore was in flight are kept.
    const restoreAndAdopt = async (snapshot: PostIt, proof?: DeleteProof) => {
        // A restore opens the next life of the card: whatever is still on the
        // wire from the previous one is dead, and so is any older restore.
        bumpLife(snapshot._id);
        const stillCurrent = lifeGuard(snapshot._id);
        let restored: PostIt | null;
        try {
            restored = proof
                ? await restorePostIt(snapshot, proof)
                : await restorePostIt(snapshot);
        } catch (error) {
            // A failure of a restore of a previous life is a stale outcome.
            if (!stillCurrent()) {
                throw isStaleLifecycle(error)
                    ? error
                    : new StaleLifecycleError();
            }
            throw error;
        }
        // The card was deleted again, restored again, or the board is gone:
        // this answer describes a life that no longer exists. The chain this
        // restore belongs to (links, dissolve, history) stops here.
        if (!stillCurrent()) throw new StaleLifecycleError();
        if (!restored) return;
        if (isSupersededResult(restored)) {
            // Applied (the restoration happened) but its token is already
            // overtaken: read the card again. A failing read must not turn an
            // applied restoration into a failed one: the card stays without a
            // token (writes refused locally and kept) and the user is told.
            // The read is one more wait: the context is checked again after
            // it, whatever its outcome, so that a restore of a previous life
            // never lets its chain (links, dissolve, history, notification)
            // run in the current one. The restoration itself is never
            // compensated.
            try {
                await reloadCard(snapshot._id, []);
            } catch {
                if (!stillCurrent()) throw new StaleLifecycleError();
                onMutationError?.();
                return;
            }
            if (!stillCurrent()) throw new StaleLifecycleError();
            return;
        }
        bumpSeq(snapshot._id);
        cardWrites?.reloaded?.(snapshot._id);
        setPostItsByTab((state) => {
            let touched = false;
            const next: Record<string, PostIt[]> = {};
            for (const [tabId, cards] of Object.entries(state)) {
                next[tabId] = cards.map((card) => {
                    if (card._id !== snapshot._id) return card;
                    touched = true;
                    const merged = {
                        ...card,
                        etag: restored.etag,
                        updatedAt: restored.updatedAt,
                    } as Record<string, unknown>;
                    for (const key of Object.keys(restored) as Array<
                        keyof PostIt
                    >) {
                        if (
                            key !== 'etag' &&
                            key !== 'updatedAt' &&
                            Object.is(card[key], snapshot[key])
                        ) {
                            merged[key] = restored[key];
                        }
                    }
                    return merged as unknown as PostIt;
                });
            }
            return touched ? next : state;
        });
    };

    // Put a card back on a board's local list (never twice).
    const putLocal = (tabId: string, card: PostIt) =>
        setPostItsByTab((current) => ({
            ...current,
            [tabId]: [
                ...(current[tabId] || []).filter((c) => c._id !== card._id),
                card,
            ],
        }));
    const dropLocal = (tabId: string, postItId: string) =>
        setPostItsByTab((current) => ({
            ...current,
            [tabId]: (current[tabId] || []).filter(
                (card) => card._id !== postItId
            ),
        }));

    // Roll back the LOCAL part of a card move whose server write failed. Only
    // the moved card is touched, and only the fields the move itself set
    // (board, stack, position, level) while they still hold the optimistic
    // value: what the user did meanwhile to the other cards of either board,
    // or to this card, stays. No list captured before the wait is ever
    // reinstalled. A card that is gone (deleted, moved again elsewhere) is
    // left alone.
    const revertMoveLocal = (
        fromTabId: string,
        toTabId: string,
        original: PostIt,
        optimistic: PostIt
    ) =>
        setPostItsByTab((current) => {
            const id = original._id;
            const destination = current[toTabId];
            const shown = destination?.find((card) => card._id === id);
            // Present on another board (shown again, moved again): not ours
            // to move. Absent everywhere: the optimistic move took it off its
            // board, it comes back.
            const elsewhere = Object.entries(current).some(
                ([tabId, cards]) =>
                    tabId !== toTabId && cards.some((card) => card._id === id)
            );
            if (elsewhere) return current;
            const reverted = { ...(shown ?? original) } as Record<
                string,
                unknown
            >;
            for (const key of MOVE_FIELDS) {
                if (Object.is(reverted[key], optimistic[key])) {
                    reverted[key] = original[key];
                }
            }
            const source = current[fromTabId];
            return {
                ...current,
                ...(destination
                    ? {
                          [toTabId]: destination.filter(
                              (card) => card._id !== id
                          ),
                      }
                    : {}),
                ...(source
                    ? {
                          [fromTabId]: [
                              ...source.filter((card) => card._id !== id),
                              reverted as unknown as PostIt,
                          ],
                      }
                    : {}),
            };
        });

    // Restore a card for an undo / redo. A restore that fails is never answered
    // by a server compensation: when it was certainly refused the card goes
    // away again locally; when its outcome is unknown the card stays shown
    // without a token (its writes are refused locally) until a read settles
    // it. The entry stays where it is and the user is told.
    const restoreOrRefuse = async (
        tabId: string,
        snapshot: PostIt,
        proof?: DeleteProof
    ) => {
        try {
            await restoreAndAdopt(snapshot, proof);
        } catch (error) {
            if (isStaleLifecycle(error)) throw error;
            if (!isUncertainOutcome(error)) dropLocal(tabId, snapshot._id);
            throw new HistoryRefusedError(
                `Card ${snapshot._id} could not be restored`
            );
        }
    };

    /**
     * R8: put back a card whose deletion left the page without a known
     * outcome and is now known to have been applied. The restore stands on
     * THAT deletion's proof only; the card is shown without a token until the
     * server answers, and leaves again if the server refuses.
     */
    const restoreDeleted = async (
        snapshot: PostIt,
        proof: DeleteProof
    ): Promise<void> => {
        putLocal(snapshot.tabId, { ...snapshot, etag: undefined });
        await restoreOrRefuse(snapshot.tabId, snapshot, proof);
    };

    const addPostIt = async (options?: {
        x?: number;
        y?: number;
        color?: string;
        title?: string;
    }): Promise<string | undefined> => {
        if (!activeTabId) return undefined;

        const position = findFreePostItPosition(
            {
                x: options?.x ?? 48 + postIts.length * 24,
                y: options?.y ?? 48 + postIts.length * 24,
            },
            postIts,
            {
                width: DEFAULT_POST_IT.width,
                height: DEFAULT_POST_IT.height,
            }
        );

        let postIt: PostIt;
        try {
            postIt = await createPostIt({
                tabId: activeTabId,
                ...DEFAULT_POST_IT,
                ...(options?.color ? { color: options.color } : {}),
                ...(options?.title ? { title: options.title } : {}),
                x: position.x,
                y: position.y,
            });
        } catch {
            onMutationError?.();
            return undefined;
        }

        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: [...(current[activeTabId] || []), postIt],
        }));
        // Track explicit user intent. Template/onboarding cards use
        // addTemplateCards and deliberately never emit this event.
        trackProductEvent('card_created');

        const addLocal = (card: PostIt = postIt) =>
            setPostItsByTab((current) => ({
                ...current,
                [activeTabId]: [...(current[activeTabId] || []), card],
            }));
        const removeLocal = () =>
            setPostItsByTab((current) => ({
                ...current,
                [activeTabId]: (current[activeTabId] || []).filter(
                    (card) => card._id !== postIt._id
                ),
            }));

        // The restore endpoint re-inserts with the original id, so redo can
        // bring the exact same card back — creation is no longer a history
        // barrier.
        let creationDeleteProof: DeleteProof | undefined;
        history.record({
            undo: async () => {
                const shown = locateCard(postIt._id)?.card ?? postIt;
                const base = etagOf(postIt._id) ?? postIt.etag;
                removeLocal();
                try {
                    creationDeleteProof = await deleteCardOnServer(
                        postIt._id,
                        base
                    );
                } catch (error) {
                    if (isStaleLifecycle(error)) throw error;
                    // Not deleted (refused, deferred) or unknown: the card
                    // comes back locally. It is NEVER restored over the
                    // server's copy, which may carry someone else's change.
                    putLocal(activeTabId, shown);
                    throw new HistoryRefusedError(
                        `Card ${postIt._id} could not be deleted`
                    );
                }
            },
            redo: async () => {
                // No token until the server answers: writes in between are
                // refused locally and kept, never sent on the old life.
                addLocal({ ...postIt, etag: undefined });
                await restoreOrRefuse(activeTabId, postIt, creationDeleteProof);
            },
        });
        return postIt._id;
    };

    // Insert a template's cards into the active board. The create endpoint only
    // persists base fields, so task metadata (status/checklist/tags) is applied
    // with a follow-up patch. Not undoable — creation is a history barrier.
    const addTemplateCards = async (cards: TemplateCardPayload[]) => {
        if (!activeTabId || cards.length === 0) return;

        let hadFailure = false;
        for (const card of cards) {
            const { status, checklist, tags, dueDate, ...base } = card;
            let created: PostIt;
            try {
                created = await createPostIt(base);
            } catch {
                hadFailure = true;
                continue;
            }
            if (!created?._id) continue;

            // Show the persisted card immediately, before the task-fields patch,
            // so a rejected PATCH can't leave a card in the DB but absent from
            // the UI. The optimistic UI always stays a superset of server state.
            setPostItsByTab((current) => ({
                ...current,
                [activeTabId]: [...(current[activeTabId] || []), created],
            }));

            const taskFields: PostItUpdate = {
                ...(status !== undefined ? { status } : {}),
                ...(checklist !== undefined ? { checklist } : {}),
                ...(tags !== undefined ? { tags } : {}),
                ...(dueDate !== undefined ? { dueDate } : {}),
            };

            if (Object.keys(taskFields).length > 0) {
                // A failed task-fields patch must not abort the remaining cards:
                // the base card is already persisted and shown, so we swallow the
                // error and move on rather than leaving the template half-applied.
                try {
                    const saved = await updatePostIt(created._id, {
                        ...taskFields,
                        etag: created.etag,
                    });
                    setPostItsByTab((current) => ({
                        ...current,
                        [activeTabId]: (current[activeTabId] || []).map(
                            (postIt) =>
                                postIt._id === created._id
                                    ? saved || { ...postIt, ...taskFields }
                                    : postIt
                        ),
                    }));
                } catch {
                    // Keep the base card; its task metadata just stays unset.
                    hadFailure = true;
                }
            }
        }
        if (hadFailure) onMutationError?.();
        history.clear();
    };

    const patchPostItLocal = (postItId: string, updates: PostItUpdate) => {
        if (!activeTabId) return;
        if ((updates as { etag?: string }).etag !== undefined) {
            bumpSeq(postItId);
        }

        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: (current[activeTabId] || []).map((postIt) =>
                postIt._id === postItId ? { ...postIt, ...updates } : postIt
            ),
        }));
    };

    const rollbackPostItLocal = (
        postItId: string,
        optimistic: PostItUpdate,
        previous: PostItUpdate
    ) => {
        if (!activeTabId) return;
        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: (current[activeTabId] || []).map((postIt) => {
                if (postIt._id !== postItId) return postIt;
                const reverted = { ...postIt };
                for (const key of Object.keys(optimistic) as Array<
                    keyof PostItUpdate
                >) {
                    if (Object.is(postIt[key], optimistic[key])) {
                        Object.assign(reverted, { [key]: previous[key] });
                    }
                }
                return reverted;
            }),
        }));
    };

    // Live view of every loaded board. Closures built for undo/redo entries
    // outlive the render they were created in: they must read the card as it is
    // NOW, never as it was when the entry was recorded.
    const locateCard = (postItId: string) => {
        for (const [tabId, cards] of Object.entries(postItsByTabRef.current)) {
            const card = cards.find((postIt) => postIt._id === postItId);
            if (card) return { tabId, card };
        }
        return undefined;
    };

    const persistPostIt = async (
        postItId: string,
        updates: PostItUpdate,
        expectedEtag?: string
    ) => {
        // An explicit version is honoured as given. Otherwise the base is the
        // version the board shows for this card now: it only ever comes from a
        // server answer (own acknowledged write or a load), never from an
        // optimistic local patch, and the server still refuses it if the card
        // changed elsewhere since.
        const version = expectedEtag ?? locateCard(postItId)?.card.etag;
        // No known version, no write: the server would apply it unconditionally.
        // Nothing is fabricated or fetched; the caller's rollback handles it.
        if (!version && !isDemoActive()) {
            throw new MissingVersionError();
        }
        const payload = { ...updates, etag: version };
        // The life of the card at the moment the write is issued.
        const stillCurrent = lifeGuard(postItId);
        // Through the card's shared write queue when available, so a direct
        // write and the autosave of the same card never refuse each other.
        const saved: PostIt | undefined = cardWrites?.write
            ? await cardWrites.write(postItId, payload)
            : await updatePostIt(postItId, payload);
        // The card was deleted/restored or the context changed while the
        // request was on its way: nothing of this answer is adopted.
        if (!stillCurrent()) throw new StaleLifecycleError();
        // A superseded answer is overtaken by definition, and an outdated one
        // is older than a read the board adopted since: in both cases the
        // read is the authority and nothing of the answer (token, date,
        // fields) may overwrite it.
        if (saved && !isSupersededResult(saved) && !isOutdatedResult(saved)) {
            bumpSeq(postItId);
            // PATCH responses contain the whole server card. Merge only the
            // fields this request actually wrote (plus its fresh version): an
            // older response must not rewind unrelated edits made while it was
            // in flight. The card is looked up on the board where it lives now
            // (it may have changed board while the request was in flight).
            setPostItsByTab((state) => {
                let touched = false;
                const next: Record<string, PostIt[]> = {};
                for (const [tabId, cards] of Object.entries(state)) {
                    next[tabId] = cards.some((c) => c._id === postItId)
                        ? cards.map((postIt) => {
                              if (postIt._id !== postItId) return postIt;
                              touched = true;
                              const merged: PostIt = {
                                  ...postIt,
                                  updatedAt: saved.updatedAt,
                                  // A superseded answer's token is never
                                  // current: the card is read again below.
                                  ...(saved.etag ? { etag: saved.etag } : {}),
                              };
                              for (const key of Object.keys(updates) as Array<
                                  keyof PostItUpdate
                              >) {
                                  if (Object.is(postIt[key], updates[key])) {
                                      Object.assign(merged, {
                                          [key]: saved[key],
                                      });
                                  }
                              }
                              return merged;
                          })
                        : cards;
                }
                return touched ? next : state;
            });
        }
        if (saved && isSupersededResult(saved) && !cardWrites?.write) {
            // The write is applied: a failing re-read must not undo it. The
            // card keeps its (now stale) token, so the next write on it is
            // refused instead of silently applied.
            await reloadCard(postItId, []).catch(() => undefined);
        }
        return saved;
    };

    const savePostIt = async (postItId: string, updates: PostItUpdate) => {
        const previous = activeTabId
            ? (postItsByTab[activeTabId] || []).find(
                  (postIt) => postIt._id === postItId
              )
            : undefined;
        patchPostItLocal(postItId, updates);
        try {
            await persistPostIt(postItId, updates, previous?.etag);
        } catch (error) {
            // An outcome of a previous life changes nothing here.
            if (isStaleLifecycle(error)) return;
            if (previous) {
                rollbackPostItLocal(
                    postItId,
                    updates,
                    buildCardChange(previous, updates).before
                );
            }
            onMutationError?.();
        }
    };

    // Apply a batch of card patches (local + API) using either their prior
    // ("before") or new ("after") values — the two directions of history.
    // History entries replay values captured when the action was made. Before
    // replaying one, every field it touches must still hold the value the
    // entry expects (what the opposite direction produced): if it changed since
    // (reloaded from another device, for instance) the entry is REFUSED rather
    // than silently overwriting that change. `zIndex` is left out: focusing a
    // card restacks it without being a history action, so it always drifts.
    const assertHistoryApplicable = (
        changes: CardChange[],
        phase: 'before' | 'after'
    ) => {
        const expected = phase === 'before' ? 'after' : 'before';
        const same = (a: unknown, b: unknown) =>
            JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
        for (const change of changes) {
            const located = locateCard(change.id);
            if (!located) continue; // not loaded here: nothing to compare
            for (const key of Object.keys(change[phase]) as Array<
                keyof PostItUpdate
            >) {
                if (key === 'zIndex') continue;
                if (!same(located.card[key], change[expected][key])) {
                    throw new HistoryRefusedError(
                        `Card ${change.id} changed since: ${String(key)}`
                    );
                }
            }
        }
    };

    // The result of every card of a multi-card operation, kept apart.
    interface ChangeReport {
        acked: CardChange[];
        failed: CardChange[];
        stale: CardChange[];
    }

    // The zIndex is restored by an entry only while it still holds what the
    // opposite direction produced: focusing a card restacks it without being a
    // history action, so an entry never sends a zIndex that has drifted.
    const reconcileUpdate = (
        change: CardChange,
        phase: 'before' | 'after'
    ): PostItUpdate => {
        const update: PostItUpdate = { ...change[phase] };
        if ('zIndex' in update) {
            const expected = (phase === 'before' ? change.after : change.before)
                .zIndex;
            // A card that is not loaded on any board cannot have been
            // restacked here: nothing drifted, the version still guards it.
            const located = locateCard(change.id);
            if (located && located.card.zIndex !== expected) {
                delete update.zIndex;
            }
        }
        return update;
    };

    // Write one card of a multi-card operation. Never rejects: its result says
    // what became of this card alone (the others are independent writes). A
    // card that is refused (or whose outcome is unknown) is rolled back at the
    // moment ITS result arrives, not when the slowest card of the operation
    // ends: `rollback` puts back only what that card's write had changed.
    const writeOneCard = async (
        id: string,
        update: PostItUpdate,
        rollback: () => void
    ): Promise<CardOutcome> => {
        try {
            const saved = await persistPostIt(id, update);
            return {
                id,
                kind:
                    saved && isSupersededResult(saved) ? 'superseded' : 'acked',
            };
        } catch (error) {
            const outcome = outcomeOfError(id, error);
            if (outcome.kind !== 'stale') rollback();
            return outcome;
        }
    };

    // Apply a batch of changes card by card. A card that is refused (or whose
    // outcome is unknown) goes back to what it showed before, ALONE: the cards
    // the server acknowledged keep the place it recorded.
    const applyChanges = async (
        changes: CardChange[],
        phase: 'before' | 'after',
        options: { assert?: boolean } = {}
    ): Promise<ChangeReport> => {
        if (options.assert !== false) assertHistoryApplicable(changes, phase);
        const report: ChangeReport = { acked: [], failed: [], stale: [] };
        // An acknowledgement obtained in a context that has ended since is a
        // stale outcome: it must not be recorded nor acted upon.
        const guards = changes.map((change) => lifeGuard(change.id));
        const sent = changes.map((change) => {
            const update = reconcileUpdate(change, phase);
            const located = locateCard(change.id)?.card;
            const previous = located
                ? buildCardChange(located, update).before
                : {};
            if (Object.keys(update).length > 0) {
                patchPostItLocal(change.id, update);
            }
            return { change, update, previous };
        });
        const outcomes = await Promise.all(
            sent.map(({ change, update, previous }) =>
                Object.keys(update).length === 0
                    ? Promise.resolve<CardOutcome>({
                          id: change.id,
                          kind: 'acked',
                      })
                    : writeOneCard(change.id, update, () =>
                          rollbackPostItLocal(change.id, update, previous)
                      )
            )
        );
        outcomes.forEach((outcome, index) => {
            const { change } = sent[index];
            // Every result is re-validated HERE, whatever its kind: a refusal
            // obtained while the card's context was current is a stale
            // outcome too if the context ended while the other cards were
            // still waiting. It is neither reported nor told.
            if (outcome.kind === 'stale' || !guards[index]()) {
                report.stale.push(change);
            } else if (isAppliedOutcome(outcome)) {
                report.acked.push(change);
            } else {
                report.failed.push(change);
            }
        });
        return report;
    };

    // An undo / redo that reached some cards only: the entry is split by what
    // the server really acknowledged (see HistoryPartialError).
    const historyEntryFor = (changes: CardChange[]): HistoryEntry => ({
        undo: () => runDirection(changes, 'before'),
        redo: () => runDirection(changes, 'after'),
    });
    const runDirection = async (
        changes: CardChange[],
        phase: 'before' | 'after'
    ) => {
        const report = await applyChanges(changes, phase);
        if (report.failed.length === 0 && report.stale.length === 0) return;
        if (report.acked.length === 0 && report.failed.length === 0) {
            throw new StaleLifecycleError();
        }
        throw new HistoryPartialError(
            report.acked.length > 0 ? historyEntryFor(report.acked) : null,
            report.failed.length > 0 ? historyEntryFor(report.failed) : null,
            report.failed.length > 0
        );
    };

    // Apply changes optimistically; the history records only what the server
    // acknowledged, and a card that was refused is rolled back on its own.
    const commitChanges = async (changes: CardChange[]) => {
        const effective = changes.filter((change) => !isNoOpChange(change));
        if (effective.length === 0) return;

        effective.forEach((change) =>
            patchPostItLocal(change.id, change.after)
        );

        const guards = effective.map((change) => lifeGuard(change.id));
        const outcomes = await Promise.all(
            effective.map((change) =>
                writeOneCard(change.id, change.after, () =>
                    rollbackPostItLocal(change.id, change.after, change.before)
                )
            )
        );
        const acked: CardChange[] = [];
        let failed = false;
        outcomes.forEach((outcome, index) => {
            const change = effective[index];
            // A result of a context that has ended since (acknowledgement or
            // refusal) is not recorded, not told and not acted upon.
            if (outcome.kind === 'stale' || !guards[index]()) return;
            if (isAppliedOutcome(outcome)) {
                acked.push(change);
            } else {
                console.error(
                    'Board update failed, reverting:',
                    describeError(outcome.error)
                );
                failed = true;
            }
        });
        if (failed) onMutationError?.();
        if (acked.length > 0) history.record(historyEntryFor(acked));
    };

    const focusPostIt = async (postItId: string) => {
        if (!activeTabId) return;

        const currentCards = postItsByTab[activeTabId] || [];
        const focusedCard = currentCards.find(
            (postIt) => postIt._id === postItId
        );
        if (!focusedCard) return;

        const nextZIndex = getNextZIndex(currentCards);

        // For stacked cards: always re-focus because stackOrder offsets mean
        // the raw zIndex doesn't reflect visual layering within the spread.
        // For free cards: skip if already at the top to avoid a no-op API call.
        const alreadyOnTop =
            !focusedCard.stackId && focusedCard.zIndex === nextZIndex - 1;
        if (alreadyOnTop) return;

        patchPostItLocal(postItId, { zIndex: nextZIndex });
        try {
            await persistPostIt(
                postItId,
                { zIndex: nextZIndex },
                focusedCard.etag
            );
        } catch (error) {
            if (isStaleLifecycle(error)) return;
            rollbackPostItLocal(
                postItId,
                { zIndex: nextZIndex },
                { zIndex: focusedCard.zIndex }
            );
            onMutationError?.();
        }
    };

    /**
     * Drop targets are resolved from where cards are actually *drawn*, never
     * from their stored coordinates. A stacked card is persisted at its stack's
     * origin and is not rewritten when that stack moves, so its stored rectangle
     * is a phantom: an invisible drop magnet sitting on empty board space. Cards
     * dropped there used to be swallowed into a collapsed pile and vanish.
     *
     * Two groups are excluded on top of that:
     *  - the buried members of a folded pile, which are drawn nowhere at all;
     *  - the dragged card's own stack siblings, which sit one tab step away —
     *    well inside the stack radius — so a card could never be nudged out of
     *    its own fan without being instantly re-absorbed.
     *
     * `layout` must be the options the board is actually drawn with (a search
     * unfolds every pile, for instance), or the drop targets and the pixels
     * would disagree again.
     */
    const getDropIntent = (
        postItId: string,
        stacks: PostItStack[],
        layout: LayoutOptions = {},
        x?: number,
        y?: number
    ): DropIntent => {
        if (!activeTabId) return null;

        const currentCards = postItsByTab[activeTabId] || [];
        const source = currentCards.find((card) => card._id === postItId);
        if (!source) return null;

        const moved = {
            ...source,
            x: x ?? source.x,
            y: y ?? source.y,
            height: drawnHeight(source, layout.heights),
        };

        const candidates = withMeasuredHeights(
            layoutBoardCards(currentCards, stacks, {
                ...layout,
                draggingCardId: postItId,
            }),
            layout.heights
        ).filter(
            (card) =>
                card._id !== postItId &&
                !(source.stackId && card.stackId === source.stackId)
        );
        return computeDropIntent(moved, candidates);
    };

    /**
     * The first stackOrder no member of `stackId` already holds.
     *
     * One past the highest order in the pile, never "member count + 1": a card
     * pulled out of a stack leaves a gap behind (three cards left holding 2, 3
     * and 4), so counting would hand the newcomer an order another card
     * already has — two cards fighting for the same slot in the fan.
     */
    const nextStackOrderIn = (cards: PostIt[], stackId: string) =>
        cards
            .filter((card) => card.stackId === stackId)
            .reduce(
                (highest, card) => Math.max(highest, card.stackOrder ?? 0),
                0
            ) + 1;

    // A stack of 1 card is not a stack — when removing a member leaves a
    // single sibling behind, dissolve it back into a plain free card instead
    // of leaving a "1 note" stack widget on the board.
    const buildStackDissolveChanges = (
        currentCards: PostIt[],
        stackId: string,
        excludingId: string
    ): CardChange[] => {
        const remaining = currentCards.filter(
            (card) => card.stackId === stackId && card._id !== excludingId
        );
        if (remaining.length !== 1) return [];
        return [
            buildCardChange(remaining[0], {
                stackId: null,
                stackOrder: null,
            }),
        ];
    };

    const settlePostIt = async (
        postItId: string,
        x: number,
        y: number,
        stacks: PostItStack[],
        createStackAt: (x: number, y: number) => Promise<PostItStack | null>,
        layout: LayoutOptions = {}
    ) => {
        if (!activeTabId) return;

        const finalX = snapToGrid(x);
        const finalY = snapToGrid(y);
        const currentCards = postItsByTab[activeTabId] || [];
        const movedCard = currentCards.find((card) => card._id === postItId);
        if (!movedCard) return;

        // Read the intent from the exact spot the card was released at, the
        // same coordinates the live drag preview used: judging the grid-snapped
        // spot instead (up to 5px away) made the card land somewhere other
        // than what the magnet had just shown.
        const intent = getDropIntent(postItId, stacks, layout, x, y);

        if (intent?.type === 'stack') {
            const targetCard = currentCards.find(
                (card) => card._id === intent.targetId
            );
            if (!targetCard) return;

            const existingStack = stacks.find(
                (stack) => stack._id === targetCard.stackId
            );
            const stack =
                existingStack ||
                (await createStackAt(targetCard.x, targetCard.y));

            if (!stack) return;

            // A brand new stack is created from the target card, which has
            // not been given the fresh stack id in local state yet, so its own
            // order (1) is accounted for explicitly.
            const nextStackOrder = existingStack
                ? nextStackOrderIn(currentCards, stack._id)
                : 2;

            if (!existingStack) {
                // A brand new stack was created to hold these cards. Stack
                // creation is not cleanly reversible (recreating a stack yields
                // a fresh id), so treat this gesture as a history barrier.
                if (!targetCard.stackId) {
                    await savePostIt(targetCard._id, {
                        stackId: stack._id,
                        stackOrder: 1,
                        x: stack.x,
                        y: stack.y,
                    });
                }
                await savePostIt(postItId, {
                    stackId: stack._id,
                    stackOrder: nextStackOrder,
                    x: stack.x,
                    y: stack.y,
                });
                history.clear();
                return;
            }

            // Adding a card onto an existing stack is a reversible membership
            // change on the moved card only.
            await commitChanges([
                buildCardChange(movedCard, {
                    stackId: stack._id,
                    stackOrder: nextStackOrder,
                    x: stack.x,
                    y: stack.y,
                }),
            ]);
            return;
        }

        const dissolveChanges = movedCard.stackId
            ? buildStackDissolveChanges(
                  currentCards,
                  movedCard.stackId,
                  postItId
              )
            : [];

        if (intent?.type === 'dock') {
            await commitChanges([
                buildCardChange(movedCard, {
                    stackId: null,
                    stackOrder: null,
                    x: intent.x,
                    y: intent.y,
                }),
                ...dissolveChanges,
            ]);
            return;
        }

        await commitChanges([
            buildCardChange(movedCard, {
                stackId: null,
                stackOrder: null,
                x: finalX,
                y: finalY,
            }),
            ...dissolveChanges,
        ]);
    };

    /**
     * Drop a whole pile onto another card: every member of `sourceStackId`
     * joins the target's stack, keeping its internal order and landing on top
     * of what is already there.
     *
     * Dragging a folded pile moves the stack as one object, so this is the
     * gesture that merges two piles — without it a pile could only ever be
     * taken apart card by card. The source stack is left empty rather than
     * deleted, so undo can put its members back into it.
     */
    const mergeStackInto = async (
        sourceStackId: string,
        targetCardId: string,
        stacks: PostItStack[],
        createStackAt: (x: number, y: number) => Promise<PostItStack | null>
    ) => {
        if (!activeTabId) return;

        const currentCards = postItsByTab[activeTabId] || [];
        const target = currentCards.find((card) => card._id === targetCardId);
        if (!target || target.stackId === sourceStackId) return;

        const movers = stackMembers(currentCards, sourceStackId);
        if (movers.length === 0) return;

        const existingStack = stacks.find(
            (stack) => stack._id === target.stackId
        );
        // A free target has no stack yet. Its stored rectangle is real (it is
        // not stacked), so it can anchor the new one.
        const stack =
            existingStack || (await createStackAt(target.x, target.y));
        if (!stack) return;

        let order = existingStack
            ? nextStackOrderIn(currentCards, stack._id)
            : 2;
        const changes = movers.map((card) =>
            buildCardChange(card, {
                stackId: stack._id,
                stackOrder: order++,
                x: stack.x,
                y: stack.y,
            })
        );

        if (!existingStack) {
            // Creating a stack is not cleanly reversible (a recreated stack
            // gets a fresh id), so this gesture is a history barrier.
            await savePostIt(target._id, {
                stackId: stack._id,
                stackOrder: 1,
                x: stack.x,
                y: stack.y,
            });
            try {
                const report = await applyChanges(changes, 'after');
                if (report.failed.length > 0) onMutationError?.();
            } catch (error) {
                if (!isStaleLifecycle(error)) onMutationError?.();
            }
            history.clear();
            return;
        }

        await commitChanges(changes);
    };

    const unstackPostIt = async (postItId: string, stacks: PostItStack[]) => {
        if (!activeTabId) return;

        const currentCards = postItsByTab[activeTabId] || [];
        const postIt = currentCards.find((card) => card._id === postItId);
        if (!postIt || !postIt.stackId) return;

        // Release the card next to where the user actually sees it. Its stored
        // x/y points at the stack's origin as of the last time it was stacked,
        // so using that directly would drop the card at a stale position — off
        // near wherever the stack used to be.
        const stack = stacks.find((item) => item._id === postIt.stackId);
        const drawn = resolveCardRect(postItId, currentCards, stacks);
        const origin = drawn ?? {
            x: stack?.x ?? postIt.x,
            y: stack?.y ?? postIt.y,
        };

        const changes = [
            buildCardChange(postIt, {
                stackId: null,
                stackOrder: null,
                x: origin.x + 264,
                y: origin.y,
                zIndex: getNextZIndex(currentCards),
            }),
            ...buildStackDissolveChanges(
                currentCards,
                postIt.stackId,
                postItId
            ),
        ];

        await commitChanges(changes);
    };

    // Reorder a card within its stack. `reorder` returns the contiguous
    // stackOrder changes; we apply them as one undoable batch.
    const reorderInStack = async (
        postItId: string,
        reorder: (
            cards: { _id: string; stackOrder?: number | null }[],
            id: string
        ) => StackOrderChange[]
    ) => {
        if (!activeTabId) return;

        const currentCards = postItsByTab[activeTabId] || [];
        const card = currentCards.find((item) => item._id === postItId);
        if (!card || !card.stackId) return;

        const stackCards = currentCards.filter(
            (item) => item.stackId === card.stackId
        );
        const changes = reorder(stackCards, postItId);
        if (changes.length === 0) return;

        const cardChanges = changes
            .map((change) => {
                const target = stackCards.find(
                    (item) => item._id === change.id
                );
                return target
                    ? buildCardChange(target, { stackOrder: change.stackOrder })
                    : null;
            })
            .filter((change): change is CardChange => change !== null);

        await commitChanges(cardChanges);
    };

    const promoteInStack = (postItId: string) =>
        reorderInStack(postItId, bringCardToFront);

    const sendToBackInStack = (postItId: string) =>
        reorderInStack(postItId, sendCardToBack);

    /** Move a card one slot up (`1`) or down (`-1`) inside its own stack. */
    const stepInStack = (postItId: string, direction: 1 | -1) =>
        reorderInStack(postItId, (cards, id) =>
            stepCardInStack(cards, id, direction)
        );

    // The token this chain may use next: the answer's own, unless the server
    // declared it already overtaken (then none: later steps are refused
    // locally rather than sent on a token that cannot be current).
    const nextKnown = (
        saved: PostIt | undefined,
        previous: string | undefined
    ): string | undefined => {
        if (!saved) return previous;
        if (isSupersededResult(saved) || isOutdatedResult(saved)) {
            return undefined;
        }
        return saved.etag ?? previous;
    };

    // The zIndex the move wrote is restored only while the card still has it
    // (see reconcileUpdate): otherwise the key is simply left out.
    const zIndexIfUntouched = (
        postItId: string,
        expectedNow: number,
        target: PostIt
    ): { zIndex?: number } => {
        const located = locateCard(postItId);
        return !located || located.card.zIndex === expectedNow
            ? { zIndex: target.zIndex }
            : {};
    };

    const movePostItToTab = async (postItId: string, targetTabId: string) => {
        if (!activeTabId || activeTabId === targetTabId) return;

        const sourceCards = postItsByTab[activeTabId] || [];
        const postIt = sourceCards.find((card) => card._id === postItId);
        if (!postIt) return;

        // Same rule as a deletion: the card leaves its stack behind, and a stack
        // of one is not a stack.
        const dissolveChanges = postIt.stackId
            ? buildStackDissolveChanges(sourceCards, postIt.stackId, postItId)
            : [];

        const targetCards = postItsByTab[targetTabId] || [];
        const movedPostIt: PostIt = {
            ...postIt,
            tabId: targetTabId,
            stackId: null,
            stackOrder: null,
            x: 48,
            y: 48,
            zIndex: getNextZIndex(targetCards),
        };

        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: (current[activeTabId] || []).filter(
                (card) => card._id !== postItId
            ),
            ...(current[targetTabId]
                ? { [targetTabId]: [...current[targetTabId], movedPostIt] }
                : {}),
        }));

        // Latest version this move chain has acknowledged: the fallback base
        // of its undo/redo when the card is not loaded on any board.
        let knownVersion: string | undefined = postIt.etag;
        try {
            const saved = await persistPostIt(
                postItId,
                {
                    tabId: targetTabId,
                    stackId: null,
                    stackOrder: null,
                    x: movedPostIt.x,
                    y: movedPostIt.y,
                    zIndex: movedPostIt.zIndex,
                },
                postIt.etag
            );
            knownVersion = nextKnown(saved, knownVersion);
        } catch (error) {
            if (isStaleLifecycle(error)) return;
            // The card goes back; nothing else on either board is rewound.
            revertMoveLocal(activeTabId, targetTabId, postIt, movedPostIt);
            onMutationError?.();
            return;
        }

        // What the server acknowledged of the dissolve is all the history may
        // reverse later; a refused sibling simply keeps its stack.
        let dissolveLive = dissolveChanges;
        if (dissolveChanges.length > 0) {
            try {
                const report = await applyChanges(dissolveChanges, 'after');
                if (report.failed.length > 0) onMutationError?.();
                if (report.acked.length === 0 && report.failed.length === 0) {
                    return;
                }
                dissolveLive = report.acked;
            } catch (error) {
                if (!isStaleLifecycle(error)) onMutationError?.();
                dissolveLive = [];
            }
        }

        const moveLocal = (fromTabId: string, toTabId: string, card: PostIt) =>
            setPostItsByTab((current) => ({
                ...current,
                [fromTabId]: (current[fromTabId] || []).filter(
                    (c) => c._id !== postItId
                ),
                ...(current[toTabId]
                    ? { [toTabId]: [...current[toTabId], card] }
                    : {}),
            }));

        // The version to base an undo/redo write on, read BEFORE the local
        // move re-inserts a snapshot of the card: the board's current version
        // when the card is loaded, else the last one this chain acknowledged.
        const baseNow = (expectedTab: string) => {
            const located = locateCard(postItId);
            if (located && located.tabId !== expectedTab) {
                throw new HistoryRefusedError(
                    `Card ${postItId} is no longer on the expected board`
                );
            }
            return located?.card.etag ?? knownVersion;
        };

        // Move the card to `toTab` (local, then server). A move that fails
        // goes back locally and never triggers a compensating write.
        const moveEntryStep = async (
            fromTab: string,
            toTab: string,
            localCard: PostIt,
            updates: PostItUpdate
        ) => {
            const base = baseNow(fromTab);
            const shown = locateCard(postItId)?.card;
            moveLocal(fromTab, toTab, localCard);
            try {
                const saved = await persistPostIt(postItId, updates, base);
                knownVersion = nextKnown(saved, knownVersion);
            } catch (error) {
                if (isStaleLifecycle(error)) throw error;
                // The card goes back where it was shown (only the fields the
                // move set; its other edits stay); when that board was not
                // loaded it simply leaves the board it was added to.
                if (shown) revertMoveLocal(fromTab, toTab, shown, localCard);
                else dropLocal(toTab, postItId);
                throw new HistoryRefusedError(
                    `Card ${postItId} could not be moved`
                );
            }
        };
        // The dissolve is secondary to the move: it is applied for what it
        // can, the user is told about the rest, and the entry only keeps the
        // part the server acknowledged.
        const dissolveStep = async (phase: 'before' | 'after') => {
            const report = await applyChanges(dissolveLive, phase, {
                assert: false,
            });
            if (report.failed.length > 0) onMutationError?.();
            dissolveLive = report.acked;
        };

        history.record({
            undo: async () => {
                assertHistoryApplicable(dissolveLive, 'before');
                await moveEntryStep(targetTabId, activeTabId, postIt, {
                    tabId: activeTabId,
                    stackId: postIt.stackId ?? null,
                    stackOrder: postIt.stackOrder ?? null,
                    x: postIt.x,
                    y: postIt.y,
                    ...zIndexIfUntouched(postItId, movedPostIt.zIndex, postIt),
                });
                await dissolveStep('before');
            },
            redo: async () => {
                assertHistoryApplicable(dissolveLive, 'after');
                await moveEntryStep(activeTabId, targetTabId, movedPostIt, {
                    tabId: targetTabId,
                    stackId: null,
                    stackOrder: null,
                    x: movedPostIt.x,
                    y: movedPostIt.y,
                    ...zIndexIfUntouched(postItId, postIt.zIndex, movedPostIt),
                });
                await dissolveStep('after');
            },
        });
    };

    const removePostIt = async (
        postItId: string,
        linkEffects?: CardDeleteLinkEffects
    ) => {
        if (!activeTabId) return;

        const tabId = activeTabId;
        const deletedCard = (postItsByTab[tabId] || []).find(
            (postIt) => postIt._id === postItId
        );
        if (!deletedCard) return;

        // Snapshot the card's links before the server cascade removes them, so
        // undo can re-create them.
        const relatedLinks = linkEffects?.snapshot() ?? [];

        // Deleting a member can leave a lone sibling behind. A one-card stack is
        // not a pile: it wears a "1" badge and its body swallows the first click
        // to fan out a stack that has nothing to fan, so the note takes two
        // clicks to edit. Free the survivor in the same undo step.
        const dissolveChanges = deletedCard.stackId
            ? buildStackDissolveChanges(
                  postItsByTab[tabId] || [],
                  deletedCard.stackId,
                  postItId
              )
            : [];

        const removeLocal = () => {
            dropLocal(tabId, postItId);
            linkEffects?.dropLocal();
        };
        const restoreLocal = (card: PostIt = deletedCard) =>
            putLocal(tabId, card);

        // The card's own token, read before it leaves the board.
        const deleteBase = etagOf(postItId) ?? deletedCard.etag;
        removeLocal();
        // Each legitimate DELETE brings its own proof; a restore always uses
        // the one of the deletion it undoes.
        let deleteProof: DeleteProof | undefined;
        try {
            deleteProof = await deleteCardOnServer(
                postItId,
                deleteBase,
                deletedCard
            );
        } catch (error) {
            // The deletion belongs to another account/life: the card on the
            // board now is not the one this call removed.
            if (isStaleLifecycle(error)) return;
            restoreLocal();
            linkEffects?.restoreLocal(relatedLinks);
            onMutationError?.();
            return;
        }

        // The card is gone server-side by now, so the dissolve is committed on
        // its own: a sibling the server refuses simply keeps its stack (it is
        // rolled back alone, with no compensating write), and the history only
        // reverses what the server really acknowledged.
        let dissolveLive = dissolveChanges;
        if (dissolveChanges.length > 0) {
            try {
                const report = await applyChanges(dissolveChanges, 'after');
                if (report.failed.length > 0) onMutationError?.();
                if (report.acked.length === 0 && report.failed.length === 0) {
                    return;
                }
                dissolveLive = report.acked;
            } catch (error) {
                if (!isStaleLifecycle(error)) onMutationError?.();
                dissolveLive = [];
            }
        }

        // The restore endpoint re-inserts with the original id, so deletion is
        // now reversible instead of a history barrier.
        history.record({
            undo: async () => {
                assertHistoryApplicable(dissolveLive, 'before');
                // Back on the board without a token until the server answers.
                restoreLocal({ ...deletedCard, etag: undefined });
                await restoreOrRefuse(tabId, deletedCard, deleteProof);
                const report = await applyChanges(dissolveLive, 'before', {
                    assert: false,
                });
                if (report.failed.length > 0) onMutationError?.();
                dissolveLive = report.acked;
                if (relatedLinks.length > 0) {
                    // The card is restored: that part is acquired. Links that
                    // cannot be recreated are told to the user; they never
                    // trigger a compensation that would delete the card again.
                    try {
                        await linkEffects?.restore(relatedLinks);
                    } catch (error) {
                        if (isStaleLifecycle(error)) throw error;
                        onMutationError?.();
                    }
                }
            },
            redo: async () => {
                assertHistoryApplicable(dissolveLive, 'after');
                const shown = locateCard(postItId)?.card ?? deletedCard;
                const base = etagOf(postItId);
                removeLocal();
                try {
                    deleteProof = await deleteCardOnServer(
                        postItId,
                        base,
                        shown
                    );
                } catch (error) {
                    if (isStaleLifecycle(error)) throw error;
                    // Not deleted (refused, deferred) or unknown: it comes
                    // back locally, never restored over the server's copy.
                    restoreLocal(shown);
                    linkEffects?.restoreLocal(relatedLinks);
                    throw new HistoryRefusedError(
                        `Card ${postItId} could not be deleted`
                    );
                }
                const report = await applyChanges(dissolveLive, 'after', {
                    assert: false,
                });
                if (report.failed.length > 0) onMutationError?.();
                dissolveLive = report.acked;
            },
        });
    };

    const clonePostIt = async (
        postItId: string,
        stacks: PostItStack[] = [],
        layout: LayoutOptions = {}
    ) => {
        if (!activeTabId) return;

        const currentCards = postItsByTab[activeTabId] || [];
        const source = currentCards.find((card) => card._id === postItId);

        // The copy is created server-side from the source's stored coordinates,
        // which for a stacked card are its stack's origin as of the last time it
        // was stacked — a phantom. Duplicating a card in a stack that has moved
        // since dropped the copy wherever the stack used to be, sometimes far
        // off-screen. Place it beside the rectangle the user is looking at.
        const drawn = source?.stackId
            ? resolveCardRect(postItId, currentCards, stacks, layout)
            : null;

        let created: PostIt;
        try {
            created = await duplicatePostIt(postItId);
        } catch {
            onMutationError?.();
            return;
        }
        const position = drawn ? { x: drawn.x + 24, y: drawn.y + 24 } : null;

        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: [
                ...(current[activeTabId] || []),
                position ? { ...created, ...position } : created,
            ],
        }));
        history.clear();

        if (position) {
            try {
                await persistPostIt(created._id, position, created.etag);
            } catch (error) {
                if (isStaleLifecycle(error)) return;
                // The copy exists and is shown where it belongs; only its stored
                // position is stale. Rewriting it to the phantom would be worse.
                onMutationError?.();
            }
        }
    };

    useEffect(() => {
        if (
            activeTabId &&
            !loadedTabs.has(activeTabId) &&
            !failedTabs.has(activeTabId) &&
            !loadingTabs.has(activeTabId)
        ) {
            loadPostIts(activeTabId);
        }
    }, [activeTabId, loadPostIts, loadedTabs, loadingTabs, failedTabs]);

    useEffect(() => {
        const retry = () => setFailedTabs(new Set());
        window.addEventListener('online', retry);
        return () => window.removeEventListener('online', retry);
    }, []);

    useEffect(() => {
        if (!activeTabId) return;
        setFailedTabs((current) => {
            if (!current.has(activeTabId)) return current;
            const next = new Set(current);
            next.delete(activeTabId);
            return next;
        });
    }, [activeTabId]);

    // Undo history is scoped to the active board; reset it when switching tabs
    // so entries never target cards from another board.
    useEffect(() => {
        history.clear();
    }, [activeTabId, history.clear]);

    return {
        postIts,
        isLoadingPostIts: activeTabId ? loadingTabs.has(activeTabId) : false,
        addPostIt,
        addTemplateCards,
        patchPostItLocal,
        savePostIt,
        focusPostIt,
        getDropIntent,
        settlePostIt,
        unstackPostIt,
        mergeStackInto,
        promoteInStack,
        sendToBackInStack,
        stepInStack,
        movePostItToTab,
        removePostIt,
        clonePostIt,
        reloadCard,
        refreshCards,
        restoreDeleted,
        undo: history.undo,
        redo: history.redo,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
    };
};
