import { GRID_SIZE, snapToGrid } from './useDragGrid';

describe('snapToGrid', () => {
    it('rounds to the nearest grid line', () => {
        expect(snapToGrid(37)).toBe(40);
        expect(snapToGrid(34)).toBe(30);
        expect(snapToGrid(200)).toBe(200);
    });

    it('keeps negative positions: the canvas extends past the origin', () => {
        expect(snapToGrid(-87)).toBe(-90);
        expect(snapToGrid(-300)).toBe(-300);
    });

    it('never returns negative zero', () => {
        expect(Object.is(snapToGrid(-2), 0)).toBe(true);
        expect(Object.is(snapToGrid(-0), 0)).toBe(true);
    });

    it('always lands on a multiple of the grid size', () => {
        for (const v of [-1234, -55, -5, 0, 5, 55, 1234]) {
            expect(Math.abs(snapToGrid(v)) % GRID_SIZE).toBe(0);
        }
    });
});
