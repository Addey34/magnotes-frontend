import { CardFinish, PostIt } from '../types/boardTypes';

// What "copy style" carries: the look of a card, never its content, size,
// position or rotation.
export interface CardStyle {
    color: string;
    textColor?: string;
    textSize?: number;
    fontFamily?: string;
    finish: CardFinish;
}

const STYLE_KEY = 'magnotes.copiedCardStyle';
const RECENT_KEY = 'magnotes.recentCardColors';
export const MAX_RECENT_COLORS = 6;

const HEX = /^#[0-9a-f]{6}$/i;

function readJson(key: string): unknown {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage can be blocked (private window): the feature just forgets.
    }
}

export function pickCardStyle(card: PostIt): CardStyle {
    return {
        color: card.color,
        ...(card.textColor ? { textColor: card.textColor } : {}),
        ...(card.textSize ? { textSize: card.textSize } : {}),
        ...(card.fontFamily ? { fontFamily: card.fontFamily } : {}),
        finish: card.finish || 'flat',
    };
}

export function copyCardStyle(card: PostIt): CardStyle {
    const style = pickCardStyle(card);
    writeJson(STYLE_KEY, style);
    window.dispatchEvent(new Event('magnotes:card-style-changed'));
    return style;
}

export function readCopiedStyle(): CardStyle | null {
    const value = readJson(STYLE_KEY);
    if (!value || typeof value !== 'object') return null;
    const style = value as Partial<CardStyle>;
    if (typeof style.color !== 'string' || !HEX.test(style.color)) return null;
    return style as CardStyle;
}

// Most recent first, no duplicates (case-insensitive), capped.
export function pushRecentColor(list: string[], color: string): string[] {
    if (!HEX.test(color)) return list;
    const next = color.toLowerCase();
    return [next, ...list.filter((c) => c.toLowerCase() !== next)].slice(
        0,
        MAX_RECENT_COLORS
    );
}

export function readRecentColors(): string[] {
    const value = readJson(RECENT_KEY);
    return Array.isArray(value)
        ? value
              .filter((c): c is string => typeof c === 'string' && HEX.test(c))
              .slice(0, MAX_RECENT_COLORS)
        : [];
}

export function rememberColor(color: string): string[] {
    const next = pushRecentColor(readRecentColors(), color);
    writeJson(RECENT_KEY, next);
    return next;
}
