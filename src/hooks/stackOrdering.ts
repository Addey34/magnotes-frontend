/**
 * Pure ordering helpers for the cards inside a stack. `stackOrder` is a 1-based
 * position where the highest value is the visible top of the pile. Reordering
 * renumbers contiguously so the expanded-stack fan offsets stay tight. Kept free
 * of React so it can be unit tested — see stackOrdering.test.ts.
 */

export interface StackCard {
    _id: string;
    stackOrder?: number | null;
}

export interface StackOrderChange {
    id: string;
    stackOrder: number;
}

/** Cards from back (lowest order) to front (highest order). */
export function sortStackCards<T extends StackCard>(cards: T[]): T[] {
    return [...cards].sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
}

/** Cards from front (top of pile) to back. */
export function stackCardsFrontToBack<T extends StackCard>(cards: T[]): T[] {
    return sortStackCards(cards).reverse();
}

function renumber(ordered: StackCard[]): StackOrderChange[] {
    const changes: StackOrderChange[] = [];
    ordered.forEach((card, index) => {
        const nextOrder = index + 1;
        if ((card.stackOrder ?? 0) !== nextOrder) {
            changes.push({ id: card._id, stackOrder: nextOrder });
        }
    });
    return changes;
}

/**
 * Move a card to the front (top) of its stack. Returns the minimal set of
 * stackOrder changes needed, or an empty array if the card is absent or already
 * on top.
 */
export function bringCardToFront(
    cards: StackCard[],
    id: string
): StackOrderChange[] {
    const ordered = sortStackCards(cards);
    const moved = ordered.find((card) => card._id === id);
    if (!moved) return [];

    const rest = ordered.filter((card) => card._id !== id);
    return renumber([...rest, moved]);
}

/** Move a card to the back (bottom) of its stack. */
export function sendCardToBack(
    cards: StackCard[],
    id: string
): StackOrderChange[] {
    const ordered = sortStackCards(cards);
    const moved = ordered.find((card) => card._id === id);
    if (!moved) return [];

    const rest = ordered.filter((card) => card._id !== id);
    return renumber([moved, ...rest]);
}
