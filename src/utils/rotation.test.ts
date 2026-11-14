import { snapRotation } from './rotation';

describe('snapRotation', () => {
    it('settles on the right angles within the snap range', () => {
        expect(snapRotation(3)).toBe(0);
        expect(snapRotation(-4)).toBe(0);
        expect(snapRotation(87)).toBe(90);
        expect(snapRotation(-93)).toBe(-90);
        expect(snapRotation(178)).toBe(180);
        expect(snapRotation(-179)).toBe(-180);
    });

    it('leaves every other angle untouched', () => {
        expect(snapRotation(5)).toBe(5);
        expect(snapRotation(15)).toBe(15);
        expect(snapRotation(-45)).toBe(-45);
        expect(snapRotation(85)).toBe(85);
    });
});
