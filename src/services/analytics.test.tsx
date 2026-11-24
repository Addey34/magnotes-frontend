/**
 * @jest-environment jsdom
 */
import {
    initAnalytics,
    isSensitiveAnalyticsPath,
    trackProductEvent,
} from './analytics';

const CONFIG = {
    src: 'https://analytics.example.com/script.js',
    websiteId: 'abc-123',
};

function tracker(): HTMLScriptElement | null {
    return document.getElementById(
        'umami-analytics'
    ) as HTMLScriptElement | null;
}

describe('initAnalytics', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        window.history.replaceState({}, '', '/');
        delete (window as typeof window & { umami?: unknown }).umami;
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
        expect(initAnalytics({ src: CONFIG.src })).toBe(false);
        expect(initAnalytics({ websiteId: CONFIG.websiteId })).toBe(false);
        expect(tracker()).toBeNull();
    });

    it('measures the demo sandbox through the same tracker', () => {
        window.history.replaceState({}, '', '/app/?demo=1');
        expect(initAnalytics(CONFIG)).toBe(true);
        expect(tracker()).not.toBeNull();
    });

    it('opts automated QA out through the analytics query parameter', () => {
        window.history.replaceState({}, '', '/app/?analytics=off');
        const track = jest.fn();
        (window as typeof window & { umami?: { track: typeof track } }).umami =
            { track };

        expect(initAnalytics(CONFIG)).toBe(false);
        expect(trackProductEvent('card_created')).toBe(false);
        expect(tracker()).toBeNull();
        expect(track).not.toHaveBeenCalled();
    });

    it('never tracks a public share capability URL', () => {
        const token = 'a'.repeat(32);
        window.history.replaceState({}, '', `/app/b/${token}`);
        const track = jest.fn();
        (window as typeof window & { umami?: { track: typeof track } }).umami =
            { track };

        expect(isSensitiveAnalyticsPath()).toBe(true);
        expect(initAnalytics(CONFIG)).toBe(false);
        expect(trackProductEvent('card_created')).toBe(false);
        expect(tracker()).toBeNull();
        expect(track).not.toHaveBeenCalled();
    });

    it('injects at most once', () => {
        expect(initAnalytics(CONFIG)).toBe(true);
        expect(initAnalytics(CONFIG)).toBe(false);
        expect(document.querySelectorAll('#umami-analytics')).toHaveLength(1);
    });

    it('tracks anonymous product events only when Umami is available', () => {
        const track = jest.fn();
        (window as typeof window & { umami?: { track: typeof track } }).umami =
            {
                track,
            };

        expect(trackProductEvent('email_verified')).toBe(true);
        expect(track).toHaveBeenCalledWith('email_verified');

        delete (window as typeof window & { umami?: unknown }).umami;
        expect(trackProductEvent('login_completed')).toBe(false);
    });

    describe('tracker that loads late', () => {
        const setUmami = (track: jest.Mock) => {
            (window as typeof window & { umami?: { track: jest.Mock } }).umami =
                { track };
        };

        it('holds early milestones and sends them once the tracker loaded', () => {
            initAnalytics(CONFIG);
            expect(trackProductEvent('signup_started')).toBe(false);
            expect(trackProductEvent('card_created')).toBe(false);

            const track = jest.fn();
            setUmami(track);
            tracker()!.dispatchEvent(new Event('load'));

            expect(track.mock.calls).toEqual([
                ['signup_started'],
                ['card_created'],
            ]);
            // Sent once, and later events go straight through.
            tracker()!.dispatchEvent(new Event('load'));
            expect(track).toHaveBeenCalledTimes(2);
            expect(trackProductEvent('login_completed')).toBe(true);
        });

        it('drops held events when the tracker cannot load', () => {
            initAnalytics(CONFIG);
            trackProductEvent('signup_started');
            tracker()!.dispatchEvent(new Event('error'));
            const track = jest.fn();
            setUmami(track);
            tracker()!.dispatchEvent(new Event('load'));
            expect(track).not.toHaveBeenCalled();
            // No unbounded buffering behind a blocked tracker.
            delete (window as typeof window & { umami?: unknown }).umami;
            trackProductEvent('signup_started');
            setUmami(track);
            tracker()!.dispatchEvent(new Event('load'));
            expect(track).not.toHaveBeenCalled();
        });

        it('never holds opted-out, shared-link or sandbox account events', () => {
            const track = jest.fn();
            window.history.replaceState({}, '', '/app/?analytics=off');
            initAnalytics({ ...CONFIG, disabled: false });
            trackProductEvent('signup_started');
            window.history.replaceState({}, '', '/app/?demo=1');
            trackProductEvent('login_completed');
            window.history.replaceState({}, '', '/');
            setUmami(track);
            tracker()?.dispatchEvent(new Event('load'));
            expect(track).not.toHaveBeenCalled();
        });

        it('keeps the demo_* name chosen when the event happened', () => {
            initAnalytics(CONFIG);
            window.history.replaceState({}, '', '/app/?demo=1');
            trackProductEvent('card_created');
            window.history.replaceState({}, '', '/app/');
            const track = jest.fn();
            setUmami(track);
            tracker()!.dispatchEvent(new Event('load'));
            expect(track).toHaveBeenCalledWith('demo_card_created');
        });

        it('bounds the number of held events', () => {
            initAnalytics(CONFIG);
            for (let i = 0; i < 100; i++) trackProductEvent('card_created');
            const track = jest.fn();
            setUmami(track);
            tracker()!.dispatchEvent(new Event('load'));
            expect(track).toHaveBeenCalledTimes(20);
        });
    });

    describe('demo sandbox', () => {
        const track = jest.fn();
        beforeEach(() => {
            track.mockClear();
            window.history.replaceState({}, '', '/app/?demo=1');
            (
                window as typeof window & { umami?: { track: typeof track } }
            ).umami = { track };
        });

        it('reports demo creation under demo_* names only', () => {
            expect(trackProductEvent('card_created')).toBe(true);
            expect(trackProductEvent('board_created')).toBe(true);
            expect(track.mock.calls).toEqual([
                ['demo_card_created'],
                ['demo_board_created'],
            ]);
        });

        it('sends demo journey events with no payload', () => {
            expect(trackProductEvent('demo_signup_cta_clicked')).toBe(true);
            expect(trackProductEvent('demo_import_started')).toBe(true);
            for (const call of track.mock.calls) {
                expect(call).toHaveLength(1);
                expect(typeof call[0]).toBe('string');
            }
        });

        it('never sends account milestones from the sandbox', () => {
            for (const event of [
                'signup_started',
                'signup_registered',
                'email_verified',
                'login_completed',
            ] as const) {
                expect(trackProductEvent(event)).toBe(false);
            }
            expect(track).not.toHaveBeenCalled();
        });

        it('still honours analytics=off and share links', () => {
            window.history.replaceState({}, '', '/app/?demo=1&analytics=off');
            expect(trackProductEvent('card_created')).toBe(false);
            expect(track).not.toHaveBeenCalled();
        });
    });

    it('sends import events after the sandbox was left', () => {
        const track = jest.fn();
        (window as typeof window & { umami?: { track: typeof track } }).umami =
            { track };
        window.history.replaceState({}, '', '/app/');
        expect(trackProductEvent('demo_import_completed')).toBe(true);
        expect(track).toHaveBeenCalledWith('demo_import_completed');
    });
});
