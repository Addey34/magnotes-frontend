/**
 * Single source of truth for where a card is actually drawn on the board, and
 * for the role each card plays inside its stack.
 *
 * A stack has no widget of its own: it is a spatial arrangement of the real
 * cards, nothing more. Three arrangements exist — two on the board itself, plus
 * a flat one for renderers that cannot open a pile (see `spreadStacks`).
 *
 *  - **Pile** (`collapsed`): only the front card is drawn, at the stack origin,
 *    fully editable. The cards under it show as printed deck edges (a card
 *    class + CSS custom properties, see `buildStackViews`), never as DOM of
 *    their own — they own no pixels, so they must not catch drops either.
 *  - **Fan** (expanded): the cards splay out as tabs. The front card keeps the
 *    stack origin — expanding and folding therefore never move the card the
 *    user is looking at — and each older card peeks out to its left by exactly
 *    STACK_TAB_STEP px, a full-height band no sibling can cover.
 *
 * A stacked card's persisted `x`/`y` is NOT where it appears: members are
 * stored at the stack's origin (see `settlePostIt`) and moving a stack does not
 * rewrite them, so those stored values go stale the moment a stack is dragged.
 * Every consumer that needs a card's real rectangle — rendering, the
 * drop-intent engine, unstacking, viewport framing, the minimap — must go
 * through this module. Reading `card.x`/`card.y` directly for a stacked card
 * yields a phantom: a rectangle nothing is drawn at. Drops used to be captured
 * by those phantoms, which silently swallowed cards into invisible piles.
 *
 * Pure (no React/DOM) so it can be unit tested — see stackLayout.test.ts.
 */

import { PostIt, PostItStack } from '../types/boardTypes';

/**
 * Horizontal step between two consecutive cards of an expanded fan, and so the
 * exact width of the band each covered card keeps for itself.
 *
 * The fan is horizontal on purpose. A vertical cascade could not guarantee a
 * covered card any usable surface: `.post-it-hover-tools` is pinned at
 * `top:-30px`, so a card claims pointer hits 30px ABOVE its own top edge and
 * silently ate the band of the card behind it. Offsetting sideways puts the
 * covering card entirely out of that column, so the band stays reachable by
 * construction rather than by arithmetic. 40px is wide enough for the vertical
 * tab label and stays a GRID_SIZE multiple, so a grid-snapped stack origin
 * keeps every fanned card on a grid line too.
 */
export const STACK_TAB_STEP = 40;

/** How many deck edges a folded pile prints behind its front card. */
export const PILE_MAX_EDGES = 3;

/** Gap between two notes of the same stack once laid out flat (`spreadStacks`). */
export const STACK_SPREAD_GAP = 16;

/**
 * A regular card's zIndex is a small sequential counter (see `getNextZIndex`),
 * so this floor guarantees an expanded stack's fanned cards always paint above
 * every ordinary card on the board, not just above their own stack siblings.
 */
export const EXPANDED_STACK_Z_BASE = 1_000_000;

/** What a card is, as seen from its stack. */
export type CardStackRole =
    /** Front card of a folded pile: the only member drawn. */
    | 'pile'
    /** Front card of an open fan: fully visible, sits on the stack origin. */
    | 'fan-front'
    /** Covered card of an open fan: shows a STACK_TAB_STEP-wide tab. */
    | 'fan-tab';

export interface CardStackView {
    stackId: string;
    role: CardStackRole;
    /** Members of the stack, drawn or not. */
    count: number;
    /** 1-based rank from the back of the stack. */
    position: number;
    /** Colours of the cards buried under this one, nearest first. */
    underColors: string[];
}

export interface LayoutOptions {
    /**
     * The card currently being dragged. It follows the pointer, so its live
     * model position wins over the stack fan — otherwise the fan would pin it
     * in place and the drag would show no movement at all. A folded pile is the
     * exception: dragging its front card drags the whole stack, so the card
     * stays welded to the (moving) stack origin.
     */
    draggingCardId?: string | null;
    /**
     * Open every stack, whatever its stored `collapsed` flag. Set while a
     * search or colour filter is active: a card buried in a pile has to be
     * readable and editable when the user searches for it, and hiding it behind
     * a sibling that does not match would make the search lie.
     */
    revealCollapsed?: boolean;
}

/** True when the stack is drawn as a fan rather than as a folded pile. */
export function isStackFanned(
    stack: PostItStack,
    options: LayoutOptions = {}
): boolean {
    return !stack.collapsed || Boolean(options.revealCollapsed);
}

/**
 * Members of a stack from back to front.
 *
 * `stackOrder` is authoritative but not trusted to be contiguous: a failed
 * write or an old board can leave gaps or ties. Ordering by rank rather than by
 * the raw value means the fan never grows a hole, and the tie-breakers keep the
 * order stable from one render to the next.
 */
export function stackMembers(cards: PostIt[], stackId: string): PostIt[] {
    return cards
        .filter((card) => card.stackId === stackId)
        .sort(
            (a, b) =>
                (a.stackOrder ?? 0) - (b.stackOrder ?? 0) ||
                a.createdAt.localeCompare(b.createdAt) ||
                a._id.localeCompare(b._id)
        );
}

/**
 * Where the `index`-th (0-based, back to front) card of a `count`-card fan is
 * drawn. The front card owns the stack origin and the rest trail off to its
 * left, so folding and unfolding leave it exactly where it was.
 */
export function fanPosition(
    stack: PostItStack,
    index: number,
    count: number
): { x: number; y: number } {
    return {
        x: stack.x - (count - 1 - index) * STACK_TAB_STEP,
        y: stack.y,
    };
}

/**
 * Every card that is actually drawn on the canvas, carrying its real on-board
 * position and paint order. The buried members of a folded pile are omitted:
 * nothing is drawn for them, so they must not act as drop targets either.
 */
export function layoutBoardCards(
    cards: PostIt[],
    stacks: PostItStack[],
    options: LayoutOptions = {}
): PostIt[] {
    const laidOut: PostIt[] = [];
    const members = new Map<string, PostIt[]>();

    for (const card of cards) {
        // An orphaned stackId (stack already deleted) leaves the card free.
        const stack = card.stackId
            ? stacks.find((item) => item._id === card.stackId)
            : undefined;
        if (!stack) {
            laidOut.push(card);
            continue;
        }

        let group = members.get(stack._id);
        if (!group) {
            group = stackMembers(cards, stack._id);
            members.set(stack._id, group);
        }
        const index = group.findIndex((item) => item._id === card._id);

        if (!isStackFanned(stack, options)) {
            // Folded: the front card *is* the pile. Dragging it drags the
            // stack, so it stays on the origin even while it is the dragged
            // card — the origin itself is what moves under the pointer.
            if (index !== group.length - 1) continue;
            laidOut.push({ ...card, x: stack.x, y: stack.y });
            continue;
        }

        // The dragged card is following the pointer: its model position is the
        // live truth, and re-applying the fan here would freeze it in place.
        if (options.draggingCardId === card._id) {
            laidOut.push(card);
            continue;
        }

        laidOut.push({
            ...card,
            ...fanPosition(stack, index, group.length),
            // Paint order follows fan order, strictly. Clicking a card used to
            // raise it above ALL its siblings, which buried the card right
            // after it, leaving it with zero clickable pixels — genuinely
            // impossible to select or edit. In a cascade the only arrangement
            // where every card keeps a reachable band is the fan's own order,
            // so nothing overrides it.
            zIndex: EXPANDED_STACK_Z_BASE + index,
        });
    }

    return laidOut;
}

/**
 * Every card at a readable position, stacks laid out flat: members side by
 * side from the stack origin, back to front, none covering another.
 *
 * This is the third arrangement, and it exists for renderers that cannot open a
 * pile — the read-only public board, which has no pan/zoom engine and nothing to
 * click. Drawing those boards from the stored coordinates piled every member of
 * a stack on the exact same pixel: the reader saw one note and the rest were
 * buried under it for good. A fan would not help either, since promoting a card
 * takes a click nobody can make there.
 */
export function spreadStacks(cards: PostIt[], stacks: PostItStack[]): PostIt[] {
    if (stacks.length === 0) return cards;

    const placed = new Map<string, { x: number; y: number }>();
    for (const stack of stacks) {
        let x = stack.x;
        for (const member of stackMembers(cards, stack._id)) {
            placed.set(member._id, { x, y: stack.y });
            x += member.width + STACK_SPREAD_GAP;
        }
    }

    return cards.map((card) => {
        const position = placed.get(card._id);
        return position ? { ...card, ...position } : card;
    });
}

/**
 * The role every drawn stacked card plays, keyed by card id. Cards absent from
 * the map are either free or buried in a folded pile; either way they need no
 * stack chrome.
 *
 * `drawnIds`, when given, is the set of cards actually mounted — the board's
 * filters have already run. Roles are decided among those: a search that hides
 * four of a pile's five notes leaves the fifth alone on the board, and it must
 * carry the front card's chrome rather than a tab pointing at siblings nothing
 * is drawing. `count` and `position` still describe the whole stack, because a
 * pile badge reading "1" while the pile holds five would be a lie.
 *
 * A card dragged out of an open fan gets no view at all: it is following the
 * pointer, on its way out of the stack, and dragging it around with a tab still
 * painted down its side reads as a bug. The fan behind it closes up as if it had
 * already left, which is exactly what a drop away from the stack will do. A
 * folded pile is the opposite case and keeps its role: dragging its front card
 * IS dragging the stack, and the board reads that role to route the move.
 */
export function buildStackViews(
    cards: PostIt[],
    stacks: PostItStack[],
    options: LayoutOptions = {},
    drawnIds?: ReadonlySet<string>
): Map<string, CardStackView> {
    const views = new Map<string, CardStackView>();
    const isDrawn = (card: PostIt) => !drawnIds || drawnIds.has(card._id);

    for (const stack of stacks) {
        const group = stackMembers(cards, stack._id);
        if (group.length === 0) continue;
        const fanned = isStackFanned(stack, options);
        const leaving = (card: PostIt) =>
            fanned && card._id === options.draggingCardId;
        const shown = group.filter((card) => isDrawn(card) && !leaving(card));
        const frontId = fanned
            ? shown[shown.length - 1]?._id
            : group[group.length - 1]._id;

        group.forEach((card, index) => {
            const isFront = card._id === frontId;
            if (!fanned && !isFront) return;
            if (!isDrawn(card) || leaving(card)) return;
            views.set(card._id, {
                stackId: stack._id,
                role: fanned ? (isFront ? 'fan-front' : 'fan-tab') : 'pile',
                count: group.length,
                position: index + 1,
                underColors: group
                    .slice(0, index)
                    .reverse()
                    .slice(0, PILE_MAX_EDGES)
                    .map((item) => item.color),
            });
        });
    }

    return views;
}

/**
 * The rectangle a single card really occupies, or null when it is buried in a
 * folded pile. Use this instead of reading `card.x`/`card.y`.
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
