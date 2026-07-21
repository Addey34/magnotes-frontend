// Pure geometry for drawing connection arrows between two cards.
// Board coordinates (can be negative); no React, fully unit-testable.

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

export interface LinkAnchors {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    // Midpoint of the drawn segment, used to place link controls/labels.
    mx: number;
    my: number;
}

export function centerOf(box: Box): Point {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Point on the box border, starting from its center and heading toward
// `toward`. Lets an arrow stop cleanly at the card edge instead of its center.
export function borderPoint(box: Box, toward: Point): Point {
    const center = centerOf(box);
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    if (dx === 0 && dy === 0) return center;

    const halfWidth = box.width / 2;
    const halfHeight = box.height / 2;
    // Scale the direction vector so it lands exactly on the nearest edge.
    const scale =
        1 /
        Math.max(
            halfWidth === 0 ? Infinity : Math.abs(dx) / halfWidth,
            halfHeight === 0 ? Infinity : Math.abs(dy) / halfHeight
        );

    return { x: center.x + dx * scale, y: center.y + dy * scale };
}

// Anchors for a link drawn from `source` to `target`, trimmed to both borders.
export function linkAnchors(source: Box, target: Box): LinkAnchors {
    const sourceCenter = centerOf(source);
    const targetCenter = centerOf(target);
    const start = borderPoint(source, targetCenter);
    const end = borderPoint(target, sourceCenter);

    return {
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        mx: (start.x + end.x) / 2,
        my: (start.y + end.y) / 2,
    };
}
