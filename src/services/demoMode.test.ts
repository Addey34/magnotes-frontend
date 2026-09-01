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
    markDemoImportPending,
    requestedDemoTemplateId,
} from './demoMode';

describe('demoMode flags', () => {
    beforeEach(() => sessionStorage.clear());

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
