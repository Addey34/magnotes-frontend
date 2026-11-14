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
 * Compute the viewport produced by a two-finger pinch. The board point that
 * started below the fingers remains below their current midpoint, so the same
 * gesture naturally combines zooming and panning.
 */
export function pinchViewport(
    start: ViewportState,
    startMidpoint: ViewportPoint,
    currentMidpoint: ViewportPoint,
    scale: number,
    rect: ViewportRect
): ViewportState {
    const nextZoom = clampZoom(start.zoom * scale);
    const boardPoint = screenToBoard(
        startMidpoint.x,
        startMidpoint.y,
        rect,
        start.offset,
        start.zoom
    );

    return {
        zoom: nextZoom,
        offset: {
            x: currentMidpoint.x - rect.left - boardPoint.x * nextZoom,
            y: currentMidpoint.y - rect.top - boardPoint.y * nextZoom,
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

/** Below this canvas width the board is read on a phone. */
export const PHONE_CANVAS_WIDTH = 600;
/** Smallest zoom at which a card's text is still comfortable to read. */
export const READABLE_ZOOM = 0.85;
const OPENING_MARGIN_X = 16;
// The canvas has a floating status row (storage pill, help button) along its
// top edge; start below it so it never covers the first card.
const OPENING_MARGIN_Y = 72;

/**
 * The view a board opens on the first time. Same as `computeFocusView`, except
 * on a phone: fitting a wide board into a narrow portrait canvas shrinks every
 * card to a speck of unreadable text. There it keeps a readable zoom and pins
 * the content's top-left corner (where the first card is) to the canvas corner,
 * so the user starts on something legible and pans to the rest.
 */
export function computeOpeningView(
    bounds: ViewportBounds | null,
    rect: ViewportRect
): ViewportState {
    const fit = computeFocusView(bounds, rect);
    if (
        !bounds ||
        rect.width >= PHONE_CANVAS_WIDTH ||
        fit.zoom >= READABLE_ZOOM
    ) {
        return fit;
    }
    return {
        zoom: READABLE_ZOOM,
        offset: {
            x: OPENING_MARGIN_X - bounds.minX * READABLE_ZOOM,
            y: OPENING_MARGIN_Y - bounds.minY * READABLE_ZOOM,
        },
    };
}

/** A screen rectangle (client coordinates), e.g. from getBoundingClientRect. */
export interface ScreenRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

const overlaps = (a: ScreenRect, b: ScreenRect): boolean =>
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top;

/**
 * The smallest pan, in screen pixels, that brings `target` (a control that
 * must stay reachable, such as a card's rotate handle) out from under the
 * fixed `obstacles` (selection bar, minimap...) while keeping it inside
 * `area` (the canvas). `margin` is the air kept around the target.
 *
 * Returns null when nothing needs to move (the target is already clear), and
 * also null when no pan of the four directions can clear it without losing it
 * off the canvas or running it into another obstacle: moving the board
 * somewhere worse would not help, so the caller leaves the view alone.
 */
export function computeRevealPan(
    target: ScreenRect,
    obstacles: ScreenRect[],
    area: ScreenRect,
    margin = 8
): ViewportPoint | null {
    const blocking = obstacles.filter((o) => overlaps(target, o));
    if (blocking.length === 0) return null;

    const shift = (dx: number, dy: number): ScreenRect => ({
        left: target.left + dx,
        top: target.top + dy,
        right: target.right + dx,
        bottom: target.bottom + dy,
    });
    const fits = (rect: ScreenRect): boolean =>
        rect.left >= area.left &&
        rect.right <= area.right &&
        rect.top >= area.top &&
        rect.bottom <= area.bottom &&
        obstacles.every((o) => !overlaps(rect, o));

    // Slide the target along one direction until nothing overlaps it, hopping
    // over every obstacle on the way (clearing one may land it on the next).
    const slide = (dir: 'up' | 'down' | 'left' | 'right'): ViewportPoint => {
        let dx = 0;
        let dy = 0;
        for (let i = 0; i <= obstacles.length; i++) {
            const now = shift(dx, dy);
            const hit = obstacles.filter((o) => overlaps(now, o));
            if (hit.length === 0) break;
            if (dir === 'up') {
                dy =
                    Math.min(...hit.map((o) => o.top)) - margin - target.bottom;
            } else if (dir === 'down') {
                dy =
                    Math.max(...hit.map((o) => o.bottom)) + margin - target.top;
            } else if (dir === 'left') {
                dx =
                    Math.min(...hit.map((o) => o.left)) - margin - target.right;
            } else {
                dx =
                    Math.max(...hit.map((o) => o.right)) + margin - target.left;
            }
        }
        return { x: dx, y: dy };
    };

    const candidates: ViewportPoint[] = (
        ['up', 'down', 'left', 'right'] as const
    )
        .map(slide)
        .filter((c) => fits(shift(c.x, c.y)));
    if (candidates.length === 0) return null;
    // A sideways pan pushes the card toward the edge of the screen, so it
    // counts double: up or down is preferred unless sideways is far shorter.
    const cost = (c: ViewportPoint) => Math.abs(c.y) + 2 * Math.abs(c.x);
    candidates.sort((a, b) => cost(a) - cost(b));
    return candidates[0];
}
