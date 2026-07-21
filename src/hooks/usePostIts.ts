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
import { CardLink, PostIt, PostItStack, PostItUpdate } from '../types/boardTypes';
import { snapToGrid } from './useDragGrid';
import { computeDropIntent, DropIntent } from './dropIntent';
import { buildCardChange, CardChange, isNoOpChange } from './historyCommands';
import { useHistory } from './useHistory';
import { bringCardToFront, sendCardToBack, StackOrderChange } from './stackOrdering';
import { TemplateCardPayload } from '../utils/boardTemplate';

export type { DropIntent } from './dropIntent';

// Side effects a card deletion runs on its connections, so the undoable
// deletion can also snapshot/restore the card's links (owned by useConnections).
export interface CardDeleteLinkEffects {
    snapshot: () => CardLink[];
    dropLocal: () => void;
    restore: (links: CardLink[]) => Promise<void>;
}

export const usePostIts = (activeTabId: string | null) => {
    const [postItsByTab, setPostItsByTab] = useState<Record<string, PostIt[]>>(
        {}
    );
    const [isLoadingPostIts, setIsLoadingPostIts] = useState(false);
    const history = useHistory();

    const postIts = useMemo(
        () => (activeTabId ? postItsByTab[activeTabId] || [] : []),
        [activeTabId, postItsByTab]
    );

    const getNextZIndex = (cards: PostIt[]): number => {
        return cards.reduce((max, card) => Math.max(max, card.zIndex), 0) + 1;
    };

    const loadPostIts = useCallback(async (tabId: string) => {
        setIsLoadingPostIts(true);
        try {
            const loadedPostIts = await fetchPostIts(tabId);
            setPostItsByTab((current) => ({
                ...current,
                [tabId]: loadedPostIts,
            }));
        } finally {
            setIsLoadingPostIts(false);
        }
    }, []);

    const addPostIt = async (
        options?: { x?: number; y?: number; color?: string; title?: string }
    ) => {
        if (!activeTabId) return;

        const postIt = await createPostIt({
            tabId: activeTabId,
            ...DEFAULT_POST_IT,
            ...(options?.color ? { color: options.color } : {}),
            ...(options?.title ? { title: options.title } : {}),
            x: options?.x ?? 48 + postIts.length * 24,
            y: options?.y ?? 48 + postIts.length * 24,
        });

        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: [...(current[activeTabId] || []), postIt],
        }));
        history.clear();
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
                    await updatePostIt(created._id, taskFields);
                    setPostItsByTab((current) => ({
                        ...current,
                        [activeTabId]: (current[activeTabId] || []).map(
                            (postIt) =>
                                postIt._id === created._id
                                    ? { ...postIt, ...taskFields }
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

    const savePostIt = async (postItId: string, updates: PostItUpdate) => {
        patchPostItLocal(postItId, updates);
        await updatePostIt(postItId, updates);
    };

    // Apply a batch of card patches (local + API) using either their prior
    // ("before") or new ("after") values — the two directions of history.
    const applyChanges = (changes: CardChange[], phase: 'before' | 'after') => {
        changes.forEach((change) => patchPostItLocal(change.id, change[phase]));
        return Promise.all(
            changes.map((change) => updatePostIt(change.id, change[phase]))
        );
    };

    // Apply changes optimistically; on success register a reversible history
    // entry, on failure roll the cards back so the board never shows a change
    // the server rejected.
    const commitChanges = async (changes: CardChange[]) => {
        const effective = changes.filter((change) => !isNoOpChange(change));
        if (effective.length === 0) return;

        effective.forEach((change) => patchPostItLocal(change.id, change.after));

        try {
            await Promise.all(
                effective.map((change) => updatePostIt(change.id, change.after))
            );
        } catch (error) {
            console.error('Board update failed, reverting:', error);
            effective.forEach((change) =>
                patchPostItLocal(change.id, change.before)
            );
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
        const focusedCard = currentCards.find((postIt) => postIt._id === postItId);
        const nextZIndex = getNextZIndex(currentCards);

        if (!focusedCard || focusedCard.zIndex === nextZIndex - 1) {
            return;
        }

        patchPostItLocal(postItId, { zIndex: nextZIndex });
        await updatePostIt(postItId, { zIndex: nextZIndex });
    };

    const getDropIntent = (
        postItId: string,
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

        const candidates = currentCards.filter((card) => card._id !== postItId);
        return computeDropIntent(moved, candidates, snapToGrid);
    };

    const settlePostIt = async (
        postItId: string,
        x: number,
        y: number,
        stacks: PostItStack[],
        createStackAt: (x: number, y: number) => Promise<PostItStack | null>
    ) => {
        if (!activeTabId) return;

        const finalX = snapToGrid(x);
        const finalY = snapToGrid(y);
        const currentCards = postItsByTab[activeTabId] || [];
        const movedCard = currentCards.find((card) => card._id === postItId);
        if (!movedCard) return;

        const intent = getDropIntent(postItId, finalX, finalY);

        if (intent?.type === 'stack') {
            const targetCard = currentCards.find((card) => card._id === intent.targetId);
            if (!targetCard) return;

            const existingStack = stacks.find(
                (stack) => stack._id === targetCard.stackId
            );
            const stack =
                existingStack || (await createStackAt(targetCard.x, targetCard.y));

            if (!stack) return;

            const stackedCards = currentCards.filter(
                (card) => card.stackId === stack._id
            );
            const nextStackOrder = stackedCards.length + 1;

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

        if (intent?.type === 'dock') {
            await commitChanges([
                buildCardChange(movedCard, {
                    stackId: null,
                    stackOrder: null,
                    x: intent.x,
                    y: intent.y,
                }),
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
        ]);
    };

    const unstackPostIt = async (postItId: string) => {
        if (!activeTabId) return;

        const currentCards = postItsByTab[activeTabId] || [];
        const postIt = currentCards.find((card) => card._id === postItId);
        if (!postIt) return;

        await commitChanges([
            buildCardChange(postIt, {
                stackId: null,
                stackOrder: null,
                x: postIt.x + 264,
                y: postIt.y,
                zIndex: getNextZIndex(currentCards),
            }),
        ]);
    };

    // Reorder a card within its stack. `reorder` returns the contiguous
    // stackOrder changes; we apply them as one undoable batch.
    const reorderInStack = async (
        postItId: string,
        reorder: (cards: { _id: string; stackOrder?: number | null }[], id: string) => StackOrderChange[]
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
                const target = stackCards.find((item) => item._id === change.id);
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

    const movePostItToTab = async (postItId: string, targetTabId: string) => {
        if (!activeTabId || activeTabId === targetTabId) return;

        const sourceCards = postItsByTab[activeTabId] || [];
        const postIt = sourceCards.find((card) => card._id === postItId);
        if (!postIt) return;

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

        await updatePostIt(postItId, {
            tabId: targetTabId,
            stackId: null,
            stackOrder: null,
            x: movedPostIt.x,
            y: movedPostIt.y,
            zIndex: movedPostIt.zIndex,
        });
        history.clear();
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
        await deletePostIt(postItId);

        // The restore endpoint re-inserts with the original id, so deletion is
        // now reversible instead of a history barrier.
        history.record({
            undo: async () => {
                restoreLocal();
                await restorePostIt(deletedCard);
                if (relatedLinks.length > 0) {
                    await linkEffects?.restore(relatedLinks);
                }
            },
            redo: async () => {
                removeLocal();
                await deletePostIt(postItId);
            },
        });
    };

    const clonePostIt = async (postItId: string) => {
        if (!activeTabId) return;

        const postIt = await duplicatePostIt(postItId);
        setPostItsByTab((current) => ({
            ...current,
            [activeTabId]: [...(current[activeTabId] || []), postIt],
        }));
        history.clear();
    };

    useEffect(() => {
        if (activeTabId && !postItsByTab[activeTabId]) {
            loadPostIts(activeTabId);
        }
    }, [activeTabId, loadPostIts, postItsByTab]);

    // Undo history is scoped to the active board; reset it when switching tabs
    // so entries never target cards from another board.
    useEffect(() => {
        history.clear();
    }, [activeTabId, history.clear]);

    return {
        postIts,
        isLoadingPostIts,
        addPostIt,
        addTemplateCards,
        patchPostItLocal,
        savePostIt,
        focusPostIt,
        getDropIntent,
        settlePostIt,
        unstackPostIt,
        promoteInStack,
        sendToBackInStack,
        movePostItToTab,
        removePostIt,
        clonePostIt,
        undo: history.undo,
        redo: history.redo,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
    };
};
