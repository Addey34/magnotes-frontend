// WCAG contrast helpers used to keep a card's text readable when its colour
// changes. Only #rgb / #rrggbb inputs are understood; anything else yields null
// and callers must leave the text colour alone.

export const MIN_TEXT_CONTRAST = 4.5;
export const DARK_INK = '#172033';
export const LIGHT_INK = '#f8fafc';

const parseHex = (value: string): [number, number, number] | null => {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return null;
    const hex =
        match[1].length === 3
            ? match[1]
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : match[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
    ];
};

const luminance = ([r, g, b]: [number, number, number]): number => {
    const [lr, lg, lb] = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

export function contrastRatio(a: string, b: string): number | null {
    const ca = parseHex(a);
    const cb = parseHex(b);
    if (!ca || !cb) return null;
    const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * Keeps `currentInk` when it is already readable on `background`; otherwise
 * returns the dark or light default, whichever contrasts better. A deliberate,
 * readable choice is never overridden.
 */
export function readableInk(background: string, currentInk: string): string {
    const current = contrastRatio(background, currentInk);
    if (current === null || current >= MIN_TEXT_CONTRAST) return currentInk;
    const dark = contrastRatio(background, DARK_INK) ?? 0;
    const light = contrastRatio(background, LIGHT_INK) ?? 0;
    return dark >= light ? DARK_INK : LIGHT_INK;
}
