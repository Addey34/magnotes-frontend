import type { DropRect } from './dropIntent';
import { RESIZE_SNAP_REACH, snapResizeRect } from './resizeSnap';

const other = (
    _id: string,
    x: number,
    y: number,
    width = 200,
    height = 150
): DropRect => ({ _id, x, y, width, height });

const rect = { x: 0, y: 0, width: 200, height: 150 };

describe('snapResizeRect', () => {
    it('snaps the right edge to the left edge of a card beside it', () => {
        const next = snapResizeRect(
            { ...rect, width: 295 },
            'se',
            [other('b', 300, 0)],
            10
        );
        expect(next.width).toBe(300);
        expect(next.height).toBe(150);
    });

    it('snaps both moving edges of a corner handle in one go', () => {
        const next = snapResizeRect(
            { x: 0, y: 0, width: 296, height: 196 },
            'se',
            [other('right', 300, 0), other('below', 0, 200)],
            10
        );
        expect(next.width).toBe(300);
        expect(next.height).toBe(200);
    });

    it('lines the edge up with a neighbour when it is within reach', () => {
        const next = snapResizeRect(
            { ...rect, width: 396 },
            'se',
            [other('b', 100, 200, 300, 100)], // right edge at 400
            10
        );
        expect(next.width).toBe(400);
    });

    it('moves the left edge and keeps the right edge fixed', () => {
        const next = snapResizeRect(
            { x: 104, y: 0, width: 196, height: 150 },
            'nw',
            [other('b', -100, 0)], // right edge at 100
            10
        );
        expect(next.x).toBe(100);
        expect(next.x + next.width).toBe(300);
    });

    it('moves the top edge and keeps the bottom edge fixed', () => {
        const next = snapResizeRect(
            { x: 0, y: 104, width: 200, height: 96 },
            'ne',
            [other('b', 0, -50)], // bottom edge at 100
            10
        );
        expect(next.y).toBe(100);
        expect(next.y + next.height).toBe(200);
    });

    it('leaves the rect alone when nothing is close', () => {
        const start = { ...rect, width: 250 };
        expect(snapResizeRect(start, 'se', [other('b', 400, 0)], 10)).toEqual(
            start
        );
    });

    it('ignores edges of cards far away on the other axis', () => {
        const start = { ...rect, width: 295 };
        const far = other('b', 300, RESIZE_SNAP_REACH + 500);
        expect(snapResizeRect(start, 'se', [far], 10)).toEqual(start);
    });

    it('does not move the edges the handle does not drag', () => {
        const next = snapResizeRect(
            { x: 3, y: 3, width: 200, height: 150 },
            'se',
            [other('b', 0, 0, 3, 3)],
            10
        );
        expect(next.x).toBe(3);
        expect(next.y).toBe(3);
    });
});
