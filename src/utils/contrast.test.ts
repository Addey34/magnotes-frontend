import { DARK_INK, LIGHT_INK, contrastRatio, readableInk } from './contrast';

describe('contrastRatio', () => {
    it('is 21 for black on white and 1 for identical colours', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
        expect(contrastRatio('#172033', '#172033')).toBe(1);
    });

    it('accepts short hex and returns null for unsupported input', () => {
        expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
        expect(contrastRatio('red', '#000')).toBeNull();
    });
});

describe('readableInk', () => {
    it('keeps a readable text colour, even a custom one', () => {
        expect(readableInk('#fef08a', '#7f1d1d')).toBe('#7f1d1d');
    });

    it('switches to light ink on a dark card', () => {
        expect(readableInk('#1e3a8a', DARK_INK)).toBe(LIGHT_INK);
        expect(readableInk('#172033', DARK_INK)).toBe(LIGHT_INK);
    });

    it('switches back to dark ink on a light card', () => {
        expect(readableInk('#fef08a', LIGHT_INK)).toBe(DARK_INK);
    });

    it('leaves unknown colours untouched', () => {
        expect(readableInk('rebeccapurple', DARK_INK)).toBe(DARK_INK);
    });

    it('keeps every stock palette pair readable', () => {
        const cards = [
            '#fef08a',
            '#fecdd3',
            '#bbf7d0',
            '#bae6fd',
            '#e9d5ff',
            '#fdba74',
        ];
        for (const c of cards) {
            expect(readableInk(c, DARK_INK)).toBe(DARK_INK);
        }
    });
});
