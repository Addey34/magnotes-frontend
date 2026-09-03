// Free-drag positions snap to this grid (docking no longer does — it snaps
// to the target card's exact edge instead, see dropIntent.ts). 10 divides
// evenly into every card-size constant in play: the default card (220x150),
// and the resize bounds (CARD_LIMITS.minSize 120, maxSize 640) — a card at
// any of those sizes lands exactly on a grid line instead of a few pixels
// off it. Resizing itself is still free-form/pixel-perfect, so this can't
// guarantee alignment for an arbitrary resized width, but it covers every
// size that actually appears as a constant in the codebase.
export const GRID_SIZE = 10;

export function snapToGrid(value: number): number {
    return Math.max(0, Math.round(value / GRID_SIZE) * GRID_SIZE);
}
