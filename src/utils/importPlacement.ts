type Placed = { x: number; y: number; width: number; height: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const IMPORT_GAP = 96;

/**
 * Imported cards used to be centred on the viewport, i.e. dropped on top of
 * the cards already there (a first import onto the welcome board buried it).
 * When the board has content, move the imported block, as a whole, to the
 * right of that content, top-aligned with it. Relative layout is preserved.
 */
export function placeBesideContent<T extends Placed>(
    cards: T[],
    content: Bounds | null,
    gap: number = IMPORT_GAP
): T[] {
    if (!content || cards.length === 0) return cards;
    const minX = Math.min(...cards.map((card) => card.x));
    const minY = Math.min(...cards.map((card) => card.y));
    const dx = content.maxX + gap - minX;
    const dy = content.minY - minY;
    return cards.map((card) => ({
        ...card,
        x: Math.round(card.x + dx),
        y: Math.round(card.y + dy),
    }));
}
