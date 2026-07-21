/**
 * Pure viewport culling for the infinite board canvas: given the visible canvas
 * size and the current pan/zoom, decide which cards fall inside the viewport so
 * the renderer can skip off-screen DOM nodes on large boards. Kept free of
 * React/DOM (callers pass plain numbers) so it can be unit tested — see
 * viewportCulling.test.ts.
 */

import { ViewportBounds, ViewportPoint } from './viewportMath';

/** Extra screen pixels kept mounted beyond each edge, for smooth panning. */
export const VIEWPORT_CULL_MARGIN = 400;

/** Minimal axis-aligned rectangle in board coordinates. */
export interface CullRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Board-space region currently visible in a canvas of `size`, expanded by
 * `margin` screen pixels on every side so cards just outside the edge stay
 * mounted. Mirrors the screen<->board transform of viewportMath.
 */
export function computeVisibleBounds(
    size: { width: number; height: number },
    offset: ViewportPoint,
    zoom: number,
    margin: number = VIEWPORT_CULL_MARGIN
): ViewportBounds {
    return {
        minX: (-offset.x - margin) / zoom,
        minY: (-offset.y - margin) / zoom,
        maxX: (size.width - offset.x + margin) / zoom,
        maxY: (size.height - offset.y + margin) / zoom,
    };
}

/** True when the item's rect overlaps the visible bounds (AABB intersection). */
export function isRectVisible(item: CullRect, bounds: ViewportBounds): boolean {
    return (
        item.x < bounds.maxX &&
        item.x + item.width > bounds.minX &&
        item.y < bounds.maxY &&
        item.y + item.height > bounds.minY
    );
}
