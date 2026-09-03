/**
 * Single source of truth for where a card is actually drawn on the board.
 *
 * A stacked card's persisted `x`/`y` is NOT where it appears: members of a
 * stack are stored at the stack's origin (see `settlePostIt`) while an expanded
 * stack draws them in a fan below the stack widget, and a collapsed stack draws
 * them not at all. Moving a stack does not rewrite its members' coordinates
 * either, so those stored values go stale the moment a stack is dragged.
 *
 * Every consumer that needs a card's real rectangle — rendering, the drop-intent
 * engine, unstacking, viewport framing — must go through this module. Reading
 * `card.x`/`card.y` directly for a stacked card yields a phantom position: a
 * rectangle nothing is drawn at. Drops used to be captured by those phantoms,
 * which silently swallowed cards into invisible piles.
 *
 * Pure (no React/DOM) so it can be unit tested — see stackLayout.test.ts.
 */

import { PostIt, PostItStack } from '../types/boardTypes';

/** Fan step between two consecutive cards of an expanded stack. */
export const STACK_EXPAND_OFFSET_X = 34;
export const STACK_EXPAND_OFFSET_Y = 28;

/** Vertical clearance between the stack widget and the first fanned card. */
export const STACK_FAN_TOP_GAP = 190;

/**
 * A regular card's zIndex is a small sequential counter (see `getNextZIndex`),
 * so this floor guarantees an expanded stack's fanned cards always paint above
 * every ordinary card on the board, not just above their own stack siblings.
 */
export const EXPANDED_STACK_Z_BASE = 1_000_000;

export interface LayoutOptions {
    /**
     * The card currently being dragged. It follows the pointer, so its live
     * model position wins over the stack fan — otherwise the fan would pin it
     * in place and the drag would show no movement at all.
     */
    draggingCardId?: string | null;
}

/** 0-based fan slot of a card inside its stack. */
export function fanOrder(card: PostIt): number {
    return Math.max(0, (card.stackOrder || 1) - 1);
}

/** Where the `order`-th (0-based) card of an expanded stack is drawn. */
export function fanPosition(
    stack: PostItStack,
    order: number
): { x: number; y: number } {
    return {
        x: stack.x + order * STACK_EXPAND_OFFSET_X,
        y: stack.y + STACK_FAN_TOP_GAP + order * STACK_EXPAND_OFFSET_Y,
    };
}

/**
 * The one card of a stack that is raised above its siblings by a click. Ties on
 * raw zIndex are broken deterministically (highest stackOrder, then id) so two
 * cards can never claim the same top slot and overlap unresolvably.
 */
function focusedSiblingId(siblings: PostIt[]): string | null {
    let best: PostIt | null = null;
    for (const card of siblings) {
        if (
            !best ||
            card.zIndex > best.zIndex ||
            (card.zIndex === best.zIndex &&
                ((card.stackOrder || 0) > (best.stackOrder || 0) ||
                    ((card.stackOrder || 0) === (best.stackOrder || 0) &&
                        card._id > best._id)))
        ) {
            best = card;
        }
    }
    return best?._id ?? null;
}

/** True when a card belongs to a stack that is currently collapsed shut. */
export function isCardHidden(card: PostIt, stacks: PostItStack[]): boolean {
    if (!card.stackId) return false;
    const stack = stacks.find((item) => item._id === card.stackId);
    return Boolean(stack?.collapsed);
}

/**
 * Every card that is actually drawn on the canvas, carrying its real on-board
 * position and paint order. Members of a collapsed stack are omitted: nothing
 * is drawn for them, so they must not act as drop targets either.
 */
export function layoutBoardCards(
    cards: PostIt[],
    stacks: PostItStack[],
    options: LayoutOptions = {}
): PostIt[] {
    const laidOut: PostIt[] = [];

    for (const card of cards) {
        if (!card.stackId) {
            laidOut.push(card);
            continue;
        }

        const stack = stacks.find((item) => item._id === card.stackId);
        // An orphaned stackId (stack already deleted) leaves the card free.
        if (!stack) {
            laidOut.push(card);
            continue;
        }

        if (stack.collapsed) continue;

        // The dragged card is following the pointer: its model position is the
        // live truth, and re-applying the fan here would freeze it in place.
        if (options.draggingCardId === card._id) {
            laidOut.push(card);
            continue;
        }

        const siblings = cards.filter((item) => item.stackId === card.stackId);
        const order = fanOrder(card);
        const isFocused = focusedSiblingId(siblings) === card._id;

        laidOut.push({
            ...card,
            ...fanPosition(stack, order),
            zIndex:
                EXPANDED_STACK_Z_BASE + (isFocused ? siblings.length : order),
        });
    }

    return laidOut;
}

/**
 * The rectangle a single card really occupies, or null when it is hidden inside
 * a collapsed stack. Use this instead of reading `card.x`/`card.y`.
 */
export function resolveCardRect(
    cardId: string,
    cards: PostIt[],
    stacks: PostItStack[],
    options: LayoutOptions = {}
): PostIt | null {
    return (
        layoutBoardCards(cards, stacks, options).find(
            (card) => card._id === cardId
        ) ?? null
    );
}
