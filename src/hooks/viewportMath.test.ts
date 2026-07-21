import {
    clampZoom,
    computeFocusView,
    MAX_ZOOM,
    MIN_ZOOM,
    screenToBoard,
    ViewportRect,
    zoomAroundPoint,
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
        const point = screenToBoard(150, 80, rect(100, 50, 800, 600), { x: 0, y: 0 }, 1);
        expect(point).toEqual({ x: 50, y: 30 });
    });

    it('accounts for zoom and offset', () => {
        const point = screenToBoard(150, 80, rect(100, 50, 800, 600), { x: 10, y: -20 }, 2);
        expect(point).toEqual({ x: 20, y: 25 });
    });

    it('handles negative board coordinates (bidirectional canvas)', () => {
        const point = screenToBoard(0, 0, rect(0, 0, 800, 600), { x: 200, y: 120 }, 1);
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
        const boardAfter = screenToBoard(cursorX, cursorY, r, next.offset, next.zoom);

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
