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

/**
 * Fan step between two consecutive cards of an expanded stack.
 *
 * Two things have to fit in the vertical step, or the fan is unusable — every
 * card but the front one becomes a sliver you can neither read nor aim at:
 *
 *  - CARD_HEADER_BAND (~43px): 13px card padding, a 14px/1.2 title line with
 *    2px of padding either side, then the header rule's 6px padding, 1px border
 *    and 2px margin. Below this the card's own title is sliced in half.
 *  - CARD_TOOLS_OVERHANG (30px): `.post-it-hover-tools` is pinned at top:-30px,
 *    so a card claims pointer hits from 30px ABOVE its own top edge. Measured on
 *    a live fan: with a 50px step a card only owned its first ~18px, the next
 *    card having already taken everything below that.
 *
 * The step must clear both (43 + 30), rounded up to the grid. Both steps are
 * multiples of GRID_SIZE and a stack's origin is grid snapped (see settleStack),
 * so every fanned card lands on a grid line too.
 */
export const CARD_HEADER_BAND = 43;
export const CARD_TOOLS_OVERHANG = 30;
export const STACK_EXPAND_OFFSET_X = 30;
export const STACK_EXPAND_OFFSET_Y = 80;

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
 * True when the card sits in a stack and is not already its front-most member.
 *
 * The fan leaves only its last card fully readable — every earlier one is
 * covered from just below its header band down by the next. So bringing a card
 * forward means making it last in fan order (`promoteInStack`), never lifting it
 * out of the cascade: the cascade is what guarantees each sibling keeps a
 * clickable header band of its own.
 *
 * Pass the tab's full card list, not a filtered one: a search hiding a sibling
 * must not make a middle card look like the front of its fan.
 */
export function canBringToFront(card: PostIt, cards: PostIt[]): boolean {
    if (!card.stackId) return false;
    const order = fanOrder(card);
    return cards.some(
        (item) => item.stackId === card.stackId && fanOrder(item) > order
    );
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

        const order = fanOrder(card);

        laidOut.push({
            ...card,
            ...fanPosition(stack, order),
            // Paint order follows fan order, strictly. Clicking a card used to
            // raise it above ALL its siblings, which buried the card right
            // after it: that one's header was covered by the raised card and
            // its body by the next, leaving it with zero clickable pixels —
            // genuinely impossible to select or edit. In a cascade the only
            // arrangement where every card keeps a reachable header band is the
            // fan's own order, so nothing overrides it.
            zIndex: EXPANDED_STACK_Z_BASE + order,
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
