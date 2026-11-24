/**
 * A card stores a single font name ("Inter", "Georgia"…). Used alone as a CSS
 * `font-family`, a name the device does not have falls back to the browser's
 * default font, which is a serif (Times) on Windows, Android and iOS: the
 * default "Inter" card then rendered in Times everywhere Inter is not
 * installed. Every stored name is therefore expanded into a stack that ends on
 * a generic family of the same kind. The stored value itself never changes.
 */
const STACKS: Record<string, string> = {
    Inter: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    'Comic Sans MS':
        '"Comic Sans MS", "Comic Neue", "Chalkboard SE", "Comic Sans", cursive',
    Georgia: 'Georgia, Cambria, "Times New Roman", Times, serif',
    'Courier New':
        '"Courier New", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'Trebuchet MS':
        '"Trebuchet MS", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
};

export const DEFAULT_CARD_FONT = 'Inter';

export function cardFontStack(name?: string | null): string {
    const font = name?.trim() || DEFAULT_CARD_FONT;
    const known = STACKS[font];
    if (known) return known;
    // Unknown name (imported data, older client): keep it first, but never
    // let it fall through to the browser's serif default.
    const quoted = /^[\w-]+$/.test(font) ? font : `"${font.replace(/"/g, '')}"`;
    return `${quoted}, ${STACKS[DEFAULT_CARD_FONT]}`;
}
