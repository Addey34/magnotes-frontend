import {
    clampZoom,
    computeFocusView,
    computeOpeningView,
    MAX_ZOOM,
    MIN_ZOOM,
    pinchViewport,
    READABLE_ZOOM,
    screenToBoard,
    ViewportRect,
    zoomAroundPoint,
    computeRevealPan,
} from './viewportMath';

const rect = (
    left: number,
    top: number,
    width: number,
    height: number
): ViewportRect => ({ left, top, width, height });

describe('clampZoom', () => {
    it('clamps below the minimum', () => {
        expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    });

    it('clamps above the maximum', () => {
        expect(clampZoom(10)).toBe(MAX_ZOOM);
    });

    it('leaves an in-range value untouched', () => {
        expect(clampZoom(1)).toBe(1);
    });
});

describe('screenToBoard', () => {
    it('subtracts rect origin and offset then divides by zoom', () => {
        const point = screenToBoard(
            150,
            80,
            rect(100, 50, 800, 600),
            { x: 0, y: 0 },
            1
        );
        expect(point).toEqual({ x: 50, y: 30 });
    });

    it('accounts for zoom and offset', () => {
        const point = screenToBoard(
            150,
            80,
            rect(100, 50, 800, 600),
            { x: 10, y: -20 },
            2
        );
        expect(point).toEqual({ x: 20, y: 25 });
    });

    it('handles negative board coordinates (bidirectional canvas)', () => {
        const point = screenToBoard(
            0,
            0,
            rect(0, 0, 800, 600),
            { x: 200, y: 120 },
            1
        );
        expect(point).toEqual({ x: -200, y: -120 });
    });
});

describe('zoomAroundPoint', () => {
    it('keeps the board point under the cursor anchored after zooming', () => {
        const r = rect(0, 0, 1000, 800);
        const offset = { x: 120, y: -40 };
        const cursorX = 300;
        const cursorY = 200;

        const boardBefore = screenToBoard(cursorX, cursorY, r, offset, 1);
        const next = zoomAroundPoint(2, cursorX, cursorY, r, offset, 1);
        const boardAfter = screenToBoard(
            cursorX,
            cursorY,
            r,
            next.offset,
            next.zoom
        );

        expect(next.zoom).toBe(2);
        expect(boardAfter.x).toBeCloseTo(boardBefore.x);
        expect(boardAfter.y).toBeCloseTo(boardBefore.y);
    });

    it('clamps the zoom but still anchors the cursor', () => {
        const r = rect(0, 0, 1000, 800);
        const offset = { x: 0, y: 0 };
        const boardBefore = screenToBoard(400, 300, r, offset, 1);
        const next = zoomAroundPoint(99, 400, 300, r, offset, 1);
        const boardAfter = screenToBoard(400, 300, r, next.offset, next.zoom);

        expect(next.zoom).toBe(MAX_ZOOM);
        expect(boardAfter.x).toBeCloseTo(boardBefore.x);
        expect(boardAfter.y).toBeCloseTo(boardBefore.y);
    });
});

describe('pinchViewport', () => {
    it('keeps the initial midpoint board point under the moved fingers', () => {
        const r = rect(10, 20, 1000, 800);
        const start = { zoom: 1, offset: { x: 80, y: -40 } };
        const startMidpoint = { x: 300, y: 260 };
        const currentMidpoint = { x: 360, y: 300 };
        const boardBefore = screenToBoard(
            startMidpoint.x,
            startMidpoint.y,
            r,
            start.offset,
            start.zoom
        );

        const next = pinchViewport(
            start,
            startMidpoint,
            currentMidpoint,
            1.5,
            r
        );
        const boardAfter = screenToBoard(
            currentMidpoint.x,
            currentMidpoint.y,
            r,
            next.offset,
            next.zoom
        );

        expect(next.zoom).toBe(1.5);
        expect(boardAfter.x).toBeCloseTo(boardBefore.x);
        expect(boardAfter.y).toBeCloseTo(boardBefore.y);
    });

    it('clamps the pinch zoom to the supported range', () => {
        const next = pinchViewport(
            { zoom: 1, offset: { x: 0, y: 0 } },
            { x: 100, y: 100 },
            { x: 100, y: 100 },
            99,
            rect(0, 0, 800, 600)
        );

        expect(next.zoom).toBe(MAX_ZOOM);
    });
});

describe('computeFocusView', () => {
    it('resets to origin at 1x when there are no bounds', () => {
        expect(computeFocusView(null, rect(0, 0, 1000, 800))).toEqual({
            zoom: 1,
            offset: { x: 0, y: 0 },
        });
    });

    it('never zooms past 1x for small content', () => {
        const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const view = computeFocusView(bounds, rect(0, 0, 1000, 800));
        expect(view.zoom).toBe(1);
    });

    it('centers the content within the viewport', () => {
        const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
        const r = rect(0, 0, 1000, 800);
        const view = computeFocusView(bounds, r);
        const center = { x: 100, y: 50 };

        // The content center should map to the viewport center on screen.
        const screenX = center.x * view.zoom + view.offset.x;
        const screenY = center.y * view.zoom + view.offset.y;
        expect(screenX).toBeCloseTo(r.width / 2);
        expect(screenY).toBeCloseTo(r.height / 2);
    });

    it('zooms out to fit large content', () => {
        const bounds = { minX: 0, minY: 0, maxX: 5000, maxY: 4000 };
        const view = computeFocusView(bounds, rect(0, 0, 1000, 800));
        expect(view.zoom).toBeLessThan(1);
        expect(view.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    });
});

describe('computeOpeningView', () => {
    const wide = { minX: 100, minY: 200, maxX: 1000, maxY: 700 };

    it('matches the fit view on a desktop-sized canvas', () => {
        const r = rect(0, 0, 1280, 700);
        expect(computeOpeningView(wide, r)).toEqual(computeFocusView(wide, r));
    });

    it('matches the fit view when the content already fits readably', () => {
        const small = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
        const r = rect(0, 0, 400, 800);
        expect(computeOpeningView(small, r)).toEqual(
            computeFocusView(small, r)
        );
    });

    it('keeps a readable zoom on a phone instead of shrinking to fit', () => {
        const r = rect(0, 0, 390, 700);
        expect(computeFocusView(wide, r).zoom).toBeLessThan(READABLE_ZOOM);
        expect(computeOpeningView(wide, r).zoom).toBe(READABLE_ZOOM);
    });

    it('pins the content top-left below the status row on a phone', () => {
        const r = rect(0, 0, 390, 700);
        const view = computeOpeningView(wide, r);
        expect(wide.minX * view.zoom + view.offset.x).toBeCloseTo(16);
        expect(wide.minY * view.zoom + view.offset.y).toBeCloseTo(72);
    });

    it('resets like the fit view when there is nothing to frame', () => {
        expect(computeOpeningView(null, rect(0, 0, 390, 700))).toEqual({
            zoom: 1,
            offset: { x: 0, y: 0 },
        });
    });
});

describe('computeRevealPan', () => {
    const rect = (left: number, top: number, w: number, h: number) => ({
        left,
        top,
        right: left + w,
        bottom: top + h,
    });
    const canvas = rect(0, 0, 390, 844);
    const bar = rect(40, 720, 310, 56);

    it('does nothing when the target is already clear', () => {
        expect(
            computeRevealPan(rect(100, 500, 32, 32), [bar], canvas)
        ).toBeNull();
        // Touching is not overlapping.
        expect(
            computeRevealPan(rect(100, 688, 32, 32), [bar], canvas)
        ).toBeNull();
    });

    it('pans up by just what clears the obstacle, plus the margin', () => {
        const pan = computeRevealPan(rect(100, 700, 32, 32), [bar], canvas);
        // bottom 732 -> must end at 720 - 8
        expect(pan).toEqual({ x: 0, y: 720 - 8 - 732 });
    });

    it('goes sideways when up and down would leave the canvas', () => {
        const column = rect(150, 0, 100, 830);
        const pan = computeRevealPan(rect(130, 100, 32, 32), [column], canvas);
        expect(pan).toEqual({ x: 150 - 8 - 162, y: 0 });
    });

    it('prefers a vertical pan unless sideways is far shorter', () => {
        const high = rect(150, 110, 100, 56);
        // up is -30, left is -20 but counts double
        expect(
            computeRevealPan(rect(130, 100, 32, 32), [high], canvas)
        ).toEqual({ x: 0, y: 110 - 8 - 132 });
    });

    it('gives up rather than push the target off the canvas', () => {
        const wide = rect(0, 10, 390, 834);
        expect(
            computeRevealPan(rect(100, 300, 32, 32), [wide], canvas)
        ).toBeNull();
    });

    it('hops over every obstacle on the way, never landing on one', () => {
        const tall = rect(0, 720, 390, 120);
        const minimap = rect(0, 660, 390, 30);
        // Clearing the bar alone would end on the minimap: go past both.
        expect(
            computeRevealPan(rect(100, 700, 32, 32), [tall, minimap], canvas)
        ).toEqual({ x: 0, y: 660 - 8 - 732 });
    });
});
