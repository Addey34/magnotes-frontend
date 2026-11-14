import { drawnHeight, withMeasuredHeights } from './measuredHeights';

const cards = [
    { _id: 'a', height: 150, title: 'A' },
    { _id: 'b', height: 150, title: 'B' },
];

describe('withMeasuredHeights', () => {
    it('returns the same array when nothing is measured', () => {
        expect(withMeasuredHeights(cards, undefined)).toBe(cards);
        expect(withMeasuredHeights(cards, new Map())).toBe(cards);
    });

    it('returns the same array when measures equal the stored heights', () => {
        expect(withMeasuredHeights(cards, new Map([['a', 150]]))).toBe(cards);
    });

    it('replaces only the measured cards and keeps the other fields', () => {
        const result = withMeasuredHeights(cards, new Map([['a', 251]]));
        expect(result).not.toBe(cards);
        expect(result[0]).toEqual({ _id: 'a', height: 251, title: 'A' });
        expect(result[1]).toBe(cards[1]);
    });

    it('does not mutate the input', () => {
        withMeasuredHeights(cards, new Map([['a', 251]]));
        expect(cards[0].height).toBe(150);
    });
});

describe('drawnHeight', () => {
    it('prefers the measure, falls back to the stored height', () => {
        expect(drawnHeight(cards[0], new Map([['a', 251]]))).toBe(251);
        expect(drawnHeight(cards[1], new Map([['a', 251]]))).toBe(150);
        expect(drawnHeight(cards[0], undefined)).toBe(150);
    });
});
