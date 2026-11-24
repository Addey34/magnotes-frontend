import { FONT_FAMILIES } from '../constants/boardDefaults';
import { cardFontStack } from './cardFont';

const GENERIC = /(sans-serif|serif|monospace|cursive)$/;

describe('cardFontStack', () => {
    it('ends every offered font on a generic family of the same kind', () => {
        for (const font of FONT_FAMILIES) {
            const stack = cardFontStack(font);
            expect(stack).toMatch(GENERIC);
            expect(stack.replace(/"/g, '').startsWith(font)).toBe(true);
        }
        expect(cardFontStack('Inter')).toMatch(/sans-serif$/);
        expect(cardFontStack('Georgia')).toMatch(/serif$/);
        expect(cardFontStack('Georgia')).not.toMatch(/sans-serif$/);
        expect(cardFontStack('Courier New')).toMatch(/monospace$/);
    });

    it('uses the default sans-serif stack for a missing font', () => {
        expect(cardFontStack(undefined)).toBe(cardFontStack('Inter'));
        expect(cardFontStack('')).toBe(cardFontStack('Inter'));
        expect(cardFontStack('   ')).toBe(cardFontStack('Inter'));
    });

    it('keeps an unknown font first and still falls back to sans-serif', () => {
        expect(cardFontStack('Roboto')).toMatch(/^Roboto, Inter,.*sans-serif$/);
        expect(cardFontStack('Open Sans')).toMatch(/^"Open Sans", Inter,/);
        expect(cardFontStack('Bad"Font')).toMatch(/^"BadFont", /);
    });
});
