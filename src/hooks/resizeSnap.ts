/**
 * Edge snapping while a card is being resized. The edges the handle moves
 * (one per axis; a corner handle moves two) snap to the nearest edge of any
 * nearby card — touching it or lining up with it — so a card can be grown until
 * it meets its neighbours on several sides at once. Pure geometry, no DOM:
 * see resizeSnap.test.ts.
 */

import type { DropRect } from './dropIntent';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface ResizeRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Pull of an edge, in screen pixels: converted to board units by the caller so
// the snap feels the same at every zoom level.
export const RESIZE_SNAP_SCREEN_DISTANCE = 10;

// A card only counts when it is within this many board pixels of the resized
// card on the other axis — an edge far across the board is not a neighbour.
export const RESIZE_SNAP_REACH = 160;

function gap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
    return Math.max(aStart - bEnd, bStart - aEnd, 0);
}

function nearestEdge(
    edge: number,
    values: number[],
    threshold: number
): number | null {
    let best: number | null = null;
    let bestDistance = threshold;
    for (const value of values) {
        const distance = Math.abs(edge - value);
        if (distance <= bestDistance) {
            best = value;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * Snap the moving edges of `rect` (as dragged by `corner`) to the edges of
 * `others`. Returns the rect with those edges moved; the opposite edges stay
 * where they are. Sizes are not clamped here.
 */
export function snapResizeRect(
    rect: ResizeRect,
    corner: ResizeCorner,
    others: DropRect[],
    threshold: number
): ResizeRect {
    const west = corner.includes('w');
    const north = corner.includes('n');
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;

    const xEdges: number[] = [];
    const yEdges: number[] = [];
    for (const other of others) {
        const nearVertically =
            gap(rect.y, bottom, other.y, other.y + other.height) <=
            RESIZE_SNAP_REACH;
        const nearHorizontally =
            gap(rect.x, right, other.x, other.x + other.width) <=
            RESIZE_SNAP_REACH;
        if (nearVertically) xEdges.push(other.x, other.x + other.width);
        if (nearHorizontally) yEdges.push(other.y, other.y + other.height);
    }

    let { x, y, width, height } = rect;

    const snappedX = nearestEdge(west ? rect.x : right, xEdges, threshold);
    if (snappedX !== null) {
        if (west) {
            x = snappedX;
            width = right - snappedX;
        } else {
            width = snappedX - rect.x;
        }
    }

    const snappedY = nearestEdge(north ? rect.y : bottom, yEdges, threshold);
    if (snappedY !== null) {
        if (north) {
            y = snappedY;
            height = bottom - snappedY;
        } else {
            height = snappedY - rect.y;
        }
    }

    return { x, y, width, height };
}
