export interface PostItPlacementRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PostItPlacementSize {
    width: number;
    height: number;
}

export const POST_IT_PLACEMENT_GAP = 16;

const isOverlapping = (
    candidate: PostItPlacementRect,
    existing: PostItPlacementRect[],
    gap: number
) =>
    existing.some(
        (rect) =>
            candidate.x < rect.x + rect.width + gap &&
            candidate.x + candidate.width + gap > rect.x &&
            candidate.y < rect.y + rect.height + gap &&
            candidate.y + candidate.height + gap > rect.y
    );

const candidateKey = (x: number, y: number) => `${x}:${y}`;

/**
 * Finds the closest open area around the requested point. New cards keep a
 * small breathing room from existing cards, while drag-and-drop remains free
 * to bring cards closer and activate the existing dock/stack magnetism.
 */
export const findFreePostItPosition = (
    desired: Pick<PostItPlacementRect, 'x' | 'y'>,
    existing: PostItPlacementRect[],
    size: PostItPlacementSize,
    gap = POST_IT_PLACEMENT_GAP
): Pick<PostItPlacementRect, 'x' | 'y'> => {
    const baseX = Math.max(0, Math.round(desired.x));
    const baseY = Math.max(0, Math.round(desired.y));
    const step = 24;
    const seen = new Set<string>();
    const maxRadius = Math.max(24, existing.length + 8);

    for (let radius = 0; radius <= maxRadius; radius += 1) {
        const offsets =
            radius === 0
                ? [[0, 0]]
                : Array.from({ length: radius * 8 }, (_, index) => {
                      const side = Math.floor(index / 2);
                      const isPositive = index % 2 === 0;
                      const distance = (side + 1) * step;
                      return side % 2 === 0
                          ? [isPositive ? distance : -distance, radius * step]
                          : [radius * step, isPositive ? distance : -distance];
                  });

        for (const [offsetX, offsetY] of offsets) {
            const x = Math.max(0, baseX + offsetX);
            const y = Math.max(0, baseY + offsetY);
            const key = candidateKey(x, y);
            if (seen.has(key)) continue;
            seen.add(key);

            if (
                !isOverlapping(
                    { x, y, width: size.width, height: size.height },
                    existing,
                    gap
                )
            ) {
                return { x, y };
            }
        }
    }

    const rightmost = existing.reduce(
        (max, rect) => Math.max(max, rect.x + rect.width),
        0
    );
    return {
        x: Math.max(baseX, Math.round(rightmost + gap)),
        y: baseY,
    };
};
