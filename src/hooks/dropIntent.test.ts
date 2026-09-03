import {
    computeDropIntent,
    DropRect,
    getOverlap,
    STACK_CENTER_DISTANCE,
} from './dropIntent';

const card = (
    _id: string,
    x: number,
    y: number,
    width = 220,
    height = 150
): DropRect => ({ _id, x, y, width, height });

describe('getOverlap', () => {
    it('returns the overlapping length of two ranges', () => {
        expect(getOverlap(0, 10, 5, 20)).toBe(5);
    });

    it('returns 0 for disjoint ranges', () => {
        expect(getOverlap(0, 10, 20, 30)).toBe(0);
    });
});

describe('computeDropIntent', () => {
    it('returns null when there are no candidates', () => {
        expect(computeDropIntent(card('a', 0, 0), [])).toBeNull();
    });

    it('ignores the moved card if it appears among the candidates', () => {
        const moved = card('a', 0, 0);
        expect(computeDropIntent(moved, [moved])).toBeNull();
    });

    describe('stacking', () => {
        it('stacks when centers coincide', () => {
            const moved = card('a', 0, 0);
            const target = card('b', 0, 0);
            expect(computeDropIntent(moved, [target])).toEqual({
                type: 'stack',
                targetId: 'b',
            });
        });

        it('stacks when the center is just inside the threshold', () => {
            const target = card('b', 0, 0); // center (110, 75)
            const moved = card('a', STACK_CENTER_DISTANCE - 1, 0);
            expect(computeDropIntent(moved, [target])).toEqual({
                type: 'stack',
                targetId: 'b',
            });
        });

        it('does not stack once the center is beyond the threshold', () => {
            const target = card('b', 0, 0);
            const moved = card('a', STACK_CENTER_DISTANCE + 5, 0);
            const intent = computeDropIntent(moved, [target]);
            expect(intent?.type).not.toBe('stack');
        });

        it('picks the nearest candidate to stack onto', () => {
            const near = card('near', 5, 0);
            const far = card('far', 300, 300);
            const moved = card('a', 0, 0);
            expect(computeDropIntent(moved, [far, near])).toEqual({
                type: 'stack',
                targetId: 'near',
            });
        });

        it('prefers stacking over docking when both qualify', () => {
            // Fully overlapping cards satisfy both the stack and dock checks;
            // stack must win.
            const moved = card('a', 0, 0);
            const target = card('b', 0, 0);
            expect(computeDropIntent(moved, [target])?.type).toBe('stack');
        });
    });

    describe('docking', () => {
        it('docks to the right edge with full vertical overlap', () => {
            const target = card('b', 0, 0); // right edge at x=220
            const moved = card('a', 220, 0);
            expect(computeDropIntent(moved, [target])).toEqual({
                type: 'dock',
                targetId: 'b',
                x: 220,
                y: 0,
            });
        });

        it('docks below with horizontal overlap', () => {
            const target = card('b', 0, 0); // bottom edge at y=150
            const moved = card('a', 0, 150);
            expect(computeDropIntent(moved, [target])).toEqual({
                type: 'dock',
                targetId: 'b',
                x: 0,
                y: 150,
            });
        });

        it('does not dock when vertical overlap is below the ratio', () => {
            const target = card('b', 0, 0);
            // Slide the moved card far down so overlap < 45% of height.
            const moved = card('a', 220, 130);
            const intent = computeDropIntent(moved, [target]);
            expect(intent).toBeNull();
        });

        it('does not dock when the edge is beyond the distance threshold', () => {
            const target = card('b', 0, 0);
            const moved = card('a', 300, 0); // right edge gap of 80 > 42
            expect(computeDropIntent(moved, [target])).toBeNull();
        });

        it('keeps the exact touching coordinate, not rounded to the grid', () => {
            // Card width (220) isn't a multiple of GRID_SIZE (24); re-snapping
            // this to the grid used to leave a gap/overlap instead of a clean
            // edge-to-edge touch. The target itself doesn't need to be
            // grid-aligned either — 7 is deliberately off-grid here.
            const target = card('b', 7, 0);
            const moved = card('a', 227, 0);
            expect(computeDropIntent(moved, [target])).toEqual({
                type: 'dock',
                targetId: 'b',
                x: 227,
                y: 0,
            });
        });
    });
});
