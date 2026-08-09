/**
 * @jest-environment jsdom
 */
import { initAnalytics } from './analytics';

const CONFIG = {
    src: 'https://analytics.example.com/script.js',
    websiteId: 'abc-123',
    isDemo: false,
};

function tracker(): HTMLScriptElement | null {
    return document.getElementById(
        'umami-analytics'
    ) as HTMLScriptElement | null;
}

describe('initAnalytics', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
    });

    it('injects the tracker when fully configured', () => {
        expect(initAnalytics(CONFIG)).toBe(true);
        const el = tracker();
        expect(el).not.toBeNull();
        expect(el?.src).toBe(CONFIG.src);
        expect(el?.getAttribute('data-website-id')).toBe(CONFIG.websiteId);
        expect(el?.async).toBe(true);
    });

    it('is a no-op when the src or website id is missing', () => {
        expect(initAnalytics({ src: CONFIG.src, isDemo: false })).toBe(false);
        expect(
            initAnalytics({ websiteId: CONFIG.websiteId, isDemo: false })
        ).toBe(false);
        expect(tracker()).toBeNull();
    });

    it('does not track the demo sandbox', () => {
        expect(initAnalytics({ ...CONFIG, isDemo: true })).toBe(false);
        expect(tracker()).toBeNull();
    });

    it('injects at most once', () => {
        expect(initAnalytics(CONFIG)).toBe(true);
        expect(initAnalytics(CONFIG)).toBe(false);
        expect(document.querySelectorAll('#umami-analytics')).toHaveLength(1);
    });
});
