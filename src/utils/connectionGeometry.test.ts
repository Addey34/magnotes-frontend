import { Box, borderPoint, centerOf, linkAnchors } from './connectionGeometry';

const box = (x: number, y: number, width = 100, height = 100): Box => ({
    x,
    y,
    width,
    height,
});

describe('centerOf', () => {
    it('returns the geometric center', () => {
        expect(centerOf(box(0, 0, 200, 100))).toEqual({ x: 100, y: 50 });
    });

    it('handles negative coordinates', () => {
        expect(centerOf(box(-100, -100, 100, 100))).toEqual({ x: -50, y: -50 });
    });
});

describe('borderPoint', () => {
    const square = box(0, 0, 100, 100); // center (50,50)

    it('lands on the right edge when heading right', () => {
        const point = borderPoint(square, { x: 1000, y: 50 });
        expect(point).toEqual({ x: 100, y: 50 });
    });

    it('lands on the top edge when heading up', () => {
        const point = borderPoint(square, { x: 50, y: -1000 });
        expect(point).toEqual({ x: 50, y: 0 });
    });

    it('hits the corner on a perfect diagonal', () => {
        const point = borderPoint(square, { x: 1000, y: 1000 });
        expect(point).toEqual({ x: 100, y: 100 });
    });

    it('returns the center when the target coincides with it', () => {
        expect(borderPoint(square, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
    });
});

describe('linkAnchors', () => {
    it('trims both endpoints to the facing edges', () => {
        const source = box(0, 0, 100, 100); // center (50,50)
        const target = box(200, 0, 100, 100); // center (250,50)
        const anchors = linkAnchors(source, target);
        expect(anchors.x1).toBe(100); // source right edge
        expect(anchors.y1).toBe(50);
        expect(anchors.x2).toBe(200); // target left edge
        expect(anchors.y2).toBe(50);
        expect(anchors.mx).toBe(150);
        expect(anchors.my).toBe(50);
    });
});
