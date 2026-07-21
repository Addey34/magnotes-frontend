/**
 * Pure viewport math for the infinite board canvas: screen<->board coordinate
 * conversion, cursor-centered zoom, and content framing. Kept free of React/DOM
 * (callers pass a plain rect) so the transforms can be unit tested — see
 * viewportMath.test.ts.
 */

export interface ViewportPoint {
    x: number;
    y: number;
}

export interface ViewportBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Minimal shape of a DOMRect the math needs (left/top/width/height). */
export interface ViewportRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface ViewportState {
    zoom: number;
    offset: ViewportPoint;
}

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;
export const FOCUS_PADDING = 180;

export function clampZoom(
    value: number,
    min: number = MIN_ZOOM,
    max: number = MAX_ZOOM
): number {
    return Math.min(max, Math.max(min, value));
}

/** Convert screen (client) coordinates to board coordinates. */
export function screenToBoard(
    clientX: number,
    clientY: number,
    rect: ViewportRect,
    offset: ViewportPoint,
    zoom: number
): ViewportPoint {
    return {
        x: (clientX - rect.left - offset.x) / zoom,
        y: (clientY - rect.top - offset.y) / zoom,
    };
}

/**
 * Compute the next zoom+offset so the board point under (clientX, clientY)
 * stays anchored under the cursor after zooming. Mirrors the wheel-zoom
 * behavior of useBoardViewport.
 */
export function zoomAroundPoint(
    nextZoom: number,
    clientX: number,
    clientY: number,
    rect: ViewportRect,
    offset: ViewportPoint,
    zoom: number
): ViewportState {
    const clampedZoom = clampZoom(nextZoom);
    const boardX = (clientX - rect.left - offset.x) / zoom;
    const boardY = (clientY - rect.top - offset.y) / zoom;

    return {
        zoom: clampedZoom,
        offset: {
            x: clientX - rect.left - boardX * clampedZoom,
            y: clientY - rect.top - boardY * clampedZoom,
        },
    };
}

/**
 * Compute the zoom+offset that frames `bounds` centered in `rect`, never
 * zooming past 1x. Returns a reset view when there is nothing to frame.
 */
export function computeFocusView(
    bounds: ViewportBounds | null,
    rect: ViewportRect
): ViewportState {
    if (!bounds) {
        return { zoom: 1, offset: { x: 0, y: 0 } };
    }

    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    const nextZoom = clampZoom(
        Math.min(
            1,
            rect.width / (contentWidth + FOCUS_PADDING),
            rect.height / (contentHeight + FOCUS_PADDING)
        )
    );

    return {
        zoom: nextZoom,
        offset: {
            x: rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * nextZoom,
            y: rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * nextZoom,
        },
    };
}
