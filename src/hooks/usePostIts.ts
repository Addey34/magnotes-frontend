import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createPostIt,
    deletePostIt,
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
import { useHistory } from './useHistory';
import {
    bringCardToFront,
    sendCardToBack,
    stepCardInStack,
    StackOrderChange,
} from './stackOrdering';
import { TemplateCardPayload } from '../utils/boardTemplate';
import { findFreePostItPosition } from '../utils/postItPlacement';
import { trackProductEvent } from '../services/analytics';

export type { DropIntent } from './dropIntent';

// Side effects a card deletion runs on its connections, so the undoable
// deletion can also snapshot/restore the card's links (owned by useConnections).
export interface CardDeleteLinkEffects {
    snapshot: () => CardLink[];
    dropLocal: () => void;
    restoreLocal: (links: CardLink[]) => void;
    restore: (links: CardLink[]) => Promise<void>;
}

export const usePostIts = (
    activeTabId: string | null,
    onLoadError?: () => void,
    onMutationError?: () => void
) => {
    const [postItsByTab, setPostItsByTab] = useState<Record<string, PostIt[]>>(
        {}
    );
    const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set());
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
                setPostItsByTab((current) => ({
                    ...current,
                    [tabId]: loadedPostIts,
                }));
            } catch {
                onLoadError?.();
            } finally {
                setLoadedTabs((current) => {
                    const next = new Set(current);
                    next.add(tabId);
                    return next;
                });
                setLoadingTabs((current) => {
                    const next = new Set(current);
                    next.delete(tabId);
                    return next;
                });
            }
        },
        [onLoadError]
    );

    const addPostIt = async (options?: {
        x?: number;
        y?: number;
        color?: string;
        title?: string;
    }) => {
        if (!activeTabId) return;

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

        const postIt = await createPostIt({
            tabId: activeTabId,
            ...DEFAULT_POST_IT,
            ...(options?.color ? { color: options.color } : {}),
            ...(options?.title ? { title: options.title } : {}),
            x: position.x,
            y: position.y,
        });

        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: [...(current[activeTabId] || []), postIt],
        }));
        // Track explicit user intent. Template/onboarding cards use
        // addTemplateCards and deliberately never emit this event.
        trackProductEvent('card_created');

        const addLocal = () =>
            setPostItsByTab((current) => ({
                ...current,
                [activeTabId]: [...(current[activeTabId] || []), postIt],
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
        history.record({
            undo: async () => {
                removeLocal();
                await deletePostIt(postIt._id);
            },
            redo: async () => {
                addLocal();
                await restorePostIt(postIt);
            },
        });
    };

    // Insert a template's cards into the active board. The create endpoint only
    // persists base fields, so task metadata (status/checklist/tags) is applied
    // with a follow-up patch. Not undoable — creation is a history barrier.
    const addTemplateCards = async (cards: TemplateCardPayload[]) => {
        if (!activeTabId || cards.length === 0) return;

        for (const card of cards) {
            const { status, checklist, tags, dueDate, ...base } = card;
            const created = await createPostIt(base);
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
                        expectedUpdatedAt: created.updatedAt,
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
                }
            }
        }
        history.clear();
    };

    const patchPostItLocal = (postItId: string, updates: PostItUpdate) => {
        if (!activeTabId) return;

        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: (current[activeTabId] || []).map((postIt) =>
                postIt._id === postItId ? { ...postIt, ...updates } : postIt
            ),
        }));
    };

    const persistPostIt = async (
        postItId: string,
        updates: PostItUpdate,
        expectedUpdatedAt?: string
    ) => {
        const current = activeTabId
            ? (postItsByTab[activeTabId] || []).find(
                  (postIt) => postIt._id === postItId
              )
            : undefined;
        const saved = await updatePostIt(postItId, {
            ...updates,
            expectedUpdatedAt: expectedUpdatedAt ?? current?.updatedAt,
        });
        if (saved) patchPostItLocal(postItId, saved);
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
            await persistPostIt(postItId, updates, previous?.updatedAt);
        } catch {
            if (previous) {
                patchPostItLocal(
                    postItId,
                    buildCardChange(previous, updates).before
                );
            }
            onMutationError?.();
        }
    };

    // Apply a batch of card patches (local + API) using either their prior
    // ("before") or new ("after") values — the two directions of history.
    const applyChanges = (changes: CardChange[], phase: 'before' | 'after') => {
        changes.forEach((change) => patchPostItLocal(change.id, change[phase]));
        return Promise.all(
            changes.map((change) => persistPostIt(change.id, change[phase]))
        );
    };

    // Apply changes optimistically; on success register a reversible history
    // entry, on failure roll the cards back so the board never shows a change
    // the server rejected.
    const commitChanges = async (changes: CardChange[]) => {
        const effective = changes.filter((change) => !isNoOpChange(change));
        if (effective.length === 0) return;

        effective.forEach((change) =>
            patchPostItLocal(change.id, change.after)
        );

        try {
            await Promise.all(
                effective.map((change) =>
                    persistPostIt(change.id, change.after)
                )
            );
        } catch (error) {
            console.error('Board update failed, reverting:', error);
            effective.forEach((change) =>
                patchPostItLocal(change.id, change.before)
            );
            onMutationError?.();
            return;
        }

        history.record({
            undo: async () => {
                await applyChanges(effective, 'before');
            },
            redo: async () => {
                await applyChanges(effective, 'after');
            },
        });
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
                focusedCard.updatedAt
            );
        } catch {
            patchPostItLocal(postItId, { zIndex: focusedCard.zIndex });
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
        };

        const candidates = layoutBoardCards(currentCards, stacks, {
            ...layout,
            draggingCardId: postItId,
        }).filter(
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

        const intent = getDropIntent(postItId, stacks, layout, finalX, finalY);

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
            await applyChanges(changes, 'after');
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

        try {
            await persistPostIt(
                postItId,
                {
                    tabId: targetTabId,
                    stackId: null,
                    stackOrder: null,
                    x: movedPostIt.x,
                    y: movedPostIt.y,
                    zIndex: movedPostIt.zIndex,
                },
                postIt.updatedAt
            );
        } catch {
            setPostItsByTab((current) => ({
                ...current,
                [activeTabId]: sourceCards,
                ...(postItsByTab[targetTabId]
                    ? { [targetTabId]: targetCards }
                    : {}),
            }));
            onMutationError?.();
            return;
        }

        if (dissolveChanges.length > 0) {
            await applyChanges(dissolveChanges, 'after').catch(() => {
                onMutationError?.();
            });
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

        history.record({
            undo: async () => {
                moveLocal(targetTabId, activeTabId, postIt);
                await persistPostIt(
                    postItId,
                    {
                        tabId: activeTabId,
                        stackId: postIt.stackId ?? null,
                        stackOrder: postIt.stackOrder ?? null,
                        x: postIt.x,
                        y: postIt.y,
                        zIndex: postIt.zIndex,
                    },
                    movedPostIt.updatedAt
                );
                await applyChanges(dissolveChanges, 'before');
            },
            redo: async () => {
                moveLocal(activeTabId, targetTabId, movedPostIt);
                await applyChanges(dissolveChanges, 'after');
                await persistPostIt(
                    postItId,
                    {
                        tabId: targetTabId,
                        stackId: null,
                        stackOrder: null,
                        x: movedPostIt.x,
                        y: movedPostIt.y,
                        zIndex: movedPostIt.zIndex,
                    },
                    postIt.updatedAt
                );
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
            setPostItsByTab((current) => ({
                ...current,
                [tabId]: (current[tabId] || []).filter(
                    (postIt) => postIt._id !== postItId
                ),
            }));
            linkEffects?.dropLocal();
        };
        const restoreLocal = () =>
            setPostItsByTab((current) => ({
                ...current,
                [tabId]: [...(current[tabId] || []), deletedCard],
            }));

        removeLocal();
        try {
            await deletePostIt(postItId);
        } catch {
            restoreLocal();
            linkEffects?.restoreLocal(relatedLinks);
            onMutationError?.();
            return;
        }

        // The card is gone server-side by now, so the dissolve is committed on
        // its own: if it fails the board simply keeps a one-card stack, which is
        // cosmetic, and rolling the deletion back would be a worse lie.
        if (dissolveChanges.length > 0) {
            try {
                await applyChanges(dissolveChanges, 'after');
            } catch {
                applyChanges(dissolveChanges, 'before').catch(() => undefined);
                onMutationError?.();
            }
        }

        // The restore endpoint re-inserts with the original id, so deletion is
        // now reversible instead of a history barrier.
        history.record({
            undo: async () => {
                restoreLocal();
                await restorePostIt(deletedCard);
                await applyChanges(dissolveChanges, 'before');
                if (relatedLinks.length > 0) {
                    await linkEffects?.restore(relatedLinks);
                }
            },
            redo: async () => {
                removeLocal();
                await deletePostIt(postItId);
                await applyChanges(dissolveChanges, 'after');
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

        const created = await duplicatePostIt(postItId);
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
                await persistPostIt(created._id, position, created.updatedAt);
            } catch {
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
            !loadingTabs.has(activeTabId)
        ) {
            loadPostIts(activeTabId);
        }
    }, [activeTabId, loadPostIts, loadedTabs, loadingTabs]);

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
        undo: history.undo,
        redo: history.redo,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
    };
};
