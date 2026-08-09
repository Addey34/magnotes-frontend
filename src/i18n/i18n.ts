/**
 * Lightweight i18n core (no dependency). Strings live in `dictionary.ts` as
 * `{ fr, en }` pairs; `translate` looks one up and interpolates `{param}`
 * placeholders. Language is detected from a stored override, else the browser
 * language (French for `fr*`, English otherwise — English is the default for
 * the international audience). Pure and unit tested — see i18n.test.ts.
 */

import { DICTIONARY, TranslationKey } from './dictionary';

export type Lang = 'fr' | 'en';
export const LANGS: Lang[] = ['fr', 'en'];
export const STORAGE_KEY = 'magnotes-lang';

export function isLang(value: unknown): value is Lang {
    return value === 'fr' || value === 'en';
}

export function detectLang(): Lang {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (isLang(stored)) return stored;
    } catch {
        /* storage unavailable — fall through to browser detection */
    }
    const nav =
        typeof navigator !== 'undefined' ? navigator.language || '' : '';
    return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function storeLang(lang: Lang): void {
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        /* ignore */
    }
}

export function translate(
    lang: Lang,
    key: TranslationKey,
    params?: Record<string, string | number>
): string {
    const entry = DICTIONARY[key];
    // Missing keys return the key itself, a visible signal in dev rather than a
    // crash; French falls back to English text when a pair lacks `fr`.
    let text: string = entry ? (entry[lang] ?? entry.en) : key;
    if (params) {
        for (const [name, value] of Object.entries(params)) {
            text = text.replace(
                new RegExp(`\\{${name}\\}`, 'g'),
                String(value)
            );
        }
    }
    return text;
}
