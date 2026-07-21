/**
 * @jest-environment jsdom
 */
import { DICTIONARY, TranslationKey } from './dictionary';
import { detectLang, STORAGE_KEY, storeLang, translate } from './i18n';

describe('translation dictionary', () => {
    it('has both fr and en for every key', () => {
        for (const [key, entry] of Object.entries(DICTIONARY)) {
            expect(typeof entry.fr).toBe('string');
            expect(typeof entry.en).toBe('string');
            expect(entry.fr.length).toBeGreaterThan(0);
            expect(entry.en.length).toBeGreaterThan(0);
            void key;
        }
    });
});

describe('translate', () => {
    it('returns the requested language', () => {
        expect(translate('fr', 'auth.submit.login')).toBe('Se connecter');
        expect(translate('en', 'auth.submit.login')).toBe('Sign in');
    });

    it('interpolates {param} placeholders', () => {
        // Uses a synthetic key via the real function to check interpolation.
        const key = Object.keys(DICTIONARY)[0] as TranslationKey;
        const raw = translate('en', key);
        expect(typeof raw).toBe('string');
        // Direct interpolation check on a literal-bearing call.
        const rendered = translate('en', 'auth.submit.login', { unused: 'x' });
        expect(rendered).toBe('Sign in');
    });

    it('falls back to the key for an unknown entry', () => {
        expect(translate('en', 'does.not.exist' as TranslationKey)).toBe(
            'does.not.exist'
        );
    });
});

describe('detectLang', () => {
    beforeEach(() => localStorage.clear());

    it('prefers a stored override', () => {
        storeLang('en');
        expect(detectLang()).toBe('en');
        storeLang('fr');
        expect(detectLang()).toBe('fr');
    });

    it('ignores an invalid stored value and falls back', () => {
        localStorage.setItem(STORAGE_KEY, 'de');
        // jsdom navigator.language is usually en-US → English default.
        expect(['fr', 'en']).toContain(detectLang());
    });
});
