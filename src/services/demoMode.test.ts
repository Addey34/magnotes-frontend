/**
 * @jest-environment jsdom
 */
import {
    activateDemo,
    clearDemoImportPending,
    deactivateDemo,
    isDemoActive,
    isDemoImportPending,
    isDemoRequested,
    isSignupRequested,
    markDemoImportPending,
    requestedDemoTemplateId,
    stripSignupQuery,
} from './demoMode';

describe('demoMode flags', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    it('activates and deactivates the demo flag', () => {
        expect(isDemoActive()).toBe(false);
        activateDemo();
        expect(isDemoActive()).toBe(true);
        deactivateDemo();
        expect(isDemoActive()).toBe(false);
    });

    it('tracks a pending import across a signup', () => {
        expect(isDemoImportPending()).toBe(false);
        markDemoImportPending();
        expect(isDemoImportPending()).toBe(true);
        clearDemoImportPending();
        expect(isDemoImportPending()).toBe(false);
    });

    it('keeps the pending import and its id across reloads and new tabs', () => {
        markDemoImportPending();
        const idOf = () =>
            JSON.parse(localStorage.getItem('magnotes-demo-import-v1') ?? '{}')
                .importId;
        const first = idOf();
        expect(first).toEqual(expect.any(String));
        sessionStorage.clear(); // a fresh tab no longer has the session flags
        expect(isDemoImportPending()).toBe(true);
        markDemoImportPending(); // a second signup click must not mint a new id
        expect(idOf()).toBe(first);
    });

    it('reads the ?demo request flag from the URL', () => {
        window.history.replaceState({}, '', '/app/');
        expect(isDemoRequested()).toBe(false);
        window.history.replaceState({}, '', '/app/?demo=1');
        expect(isDemoRequested()).toBe(true);
    });

    it('accepts safe template slugs and rejects malformed values', () => {
        expect(requestedDemoTemplateId('?template=client-project')).toBe(
            'client-project'
        );
        expect(requestedDemoTemplateId('?template=Client%20Project')).toBe(
            undefined
        );
        expect(requestedDemoTemplateId('?template=../../admin')).toBe(
            undefined
        );
        expect(requestedDemoTemplateId('')).toBeUndefined();
    });
});

describe('signup entry URL', () => {
    afterEach(() => window.history.replaceState({}, '', '/'));

    it.each([
        ['?signup=1', true],
        ['?signup', true],
        ['?lang=fr&signup=1', true],
        ['?lang=fr', false],
        ['', false],
        // The demo has priority when both are asked.
        ['?demo=1&signup=1', false],
    ])('reads %s as %s', (search, expected) => {
        expect(isSignupRequested(search)).toBe(expected);
    });

    it('reading never touches the address bar', () => {
        window.history.replaceState({}, '', '/app/?lang=fr&signup=1');
        expect(isSignupRequested()).toBe(true);
        expect(isSignupRequested()).toBe(true);
        expect(window.location.search).toBe('?lang=fr&signup=1');
    });

    it('stripping removes only signup, and is idempotent', () => {
        window.history.replaceState({}, '', '/app/?lang=fr&signup=1');
        stripSignupQuery();
        expect(window.location.pathname + window.location.search).toBe(
            '/app/?lang=fr'
        );
        stripSignupQuery();
        expect(window.location.search).toBe('?lang=fr');
        expect(isSignupRequested()).toBe(false);
    });

    it('stripping leaves a demo URL alone', () => {
        window.history.replaceState({}, '', '/app/?demo=1&lang=fr');
        stripSignupQuery();
        expect(window.location.search).toBe('?demo=1&lang=fr');
    });
});
