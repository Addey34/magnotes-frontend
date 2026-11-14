/**
 * A card's stored `height` is only a minimum: the card grows with its content,
 * so what is drawn is taller than what is saved. Anything that reasons about
 * where a card really is (docking, arrows, framing) has to use the drawn
 * height. It is measured on screen and kept client-side only — never saved, and
 * never fed back as the card's `minHeight`, or a card could no longer shrink
 * when its text is deleted.
 */
export type MeasuredHeights = ReadonlyMap<string, number>;

interface HeightCard {
    _id: string;
    height: number;
}

/**
 * The same cards, each with its drawn height when one is known. Returns the
 * input untouched when there is nothing to apply, so memoised consumers keep
 * their identity.
 */
export function withMeasuredHeights<T extends HeightCard>(
    cards: T[],
    heights: MeasuredHeights | undefined
): T[] {
    if (!heights || heights.size === 0) return cards;
    let changed = false;
    const next = cards.map((card) => {
        const measured = heights.get(card._id);
        if (measured === undefined || measured === card.height) return card;
        changed = true;
        return { ...card, height: measured };
    });
    return changed ? next : cards;
}

/** The drawn height of one card, falling back to its stored minimum. */
export function drawnHeight(
    card: HeightCard,
    heights: MeasuredHeights | undefined
): number {
    return heights?.get(card._id) ?? card.height;
}
