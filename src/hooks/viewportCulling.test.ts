import {
    computeVisibleBounds,
    isRectVisible,
    VIEWPORT_CULL_MARGIN,
} from './viewportCulling';

describe('computeVisibleBounds', () => {
    it('maps the canvas to board space at 1x with no offset (minus the margin)', () => {
        const bounds = computeVisibleBounds(
            { width: 1000, height: 600 },
            { x: 0, y: 0 },
            1,
            0
        );
        expect(bounds.minX).toBeCloseTo(0);
        expect(bounds.minY).toBeCloseTo(0);
        expect(bounds.maxX).toBe(1000);
        expect(bounds.maxY).toBe(600);
    });

    it('accounts for pan offset (panning right reveals negative board coords)', () => {
        const bounds = computeVisibleBounds(
            { width: 1000, height: 600 },
            { x: 200, y: 100 },
            1,
            0
        );
        expect(bounds).toEqual({
            minX: -200,
            minY: -100,
            maxX: 800,
            maxY: 500,
        });
    });

    it('divides by zoom so a zoomed-out view covers more board area', () => {
        const bounds = computeVisibleBounds(
            { width: 1000, height: 600 },
            { x: 0, y: 0 },
            0.5,
            0
        );
        expect(bounds.minX).toBeCloseTo(0);
        expect(bounds.minY).toBeCloseTo(0);
        expect(bounds.maxX).toBe(2000);
        expect(bounds.maxY).toBe(1200);
    });

    it('expands by the margin on every side (in board units)', () => {
        const bounds = computeVisibleBounds(
            { width: 1000, height: 600 },
            { x: 0, y: 0 },
            2,
            400
        );
        expect(bounds.minX).toBe(-200);
        expect(bounds.minY).toBe(-200);
        expect(bounds.maxX).toBe(700);
        expect(bounds.maxY).toBe(500);
    });

    it('defaults the margin to VIEWPORT_CULL_MARGIN', () => {
        const withDefault = computeVisibleBounds(
            { width: 1000, height: 600 },
            { x: 0, y: 0 },
            1
        );
        expect(withDefault.minX).toBe(-VIEWPORT_CULL_MARGIN);
    });
});

describe('isRectVisible', () => {
    const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 600 };

    it('keeps a card fully inside the viewport', () => {
        expect(
            isRectVisible({ x: 100, y: 100, width: 200, height: 150 }, bounds)
        ).toBe(true);
    });

    it('keeps a card overlapping the edge', () => {
        expect(
            isRectVisible({ x: -50, y: 50, width: 100, height: 100 }, bounds)
        ).toBe(true);
    });

    it('culls a card entirely to the left', () => {
        expect(
            isRectVisible({ x: -300, y: 50, width: 100, height: 100 }, bounds)
        ).toBe(false);
    });

    it('culls a card entirely below', () => {
        expect(
            isRectVisible({ x: 50, y: 800, width: 100, height: 100 }, bounds)
        ).toBe(false);
    });

    it('treats edge-touching rects as not overlapping (strict bounds)', () => {
        expect(
            isRectVisible({ x: 1000, y: 0, width: 100, height: 100 }, bounds)
        ).toBe(false);
    });
});
