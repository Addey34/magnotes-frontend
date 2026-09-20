import {
    ANALYTICS_ORIGIN,
    analyticsConfigIssue,
    isAllowedAnalyticsSource,
} from './analyticsConfig';

describe('analytics hosting configuration', () => {
    it('accepts the self-hosted HTTPS tracker origin', () => {
        const allowed = isAllowedAnalyticsSource(
            `${ANALYTICS_ORIGIN}/script.js`
        );
        expect(allowed).toBe(true);
    });

    it('rejects insecure or unexpected tracker origins', () => {
        const insecure = isAllowedAnalyticsSource(
            'http://analytics-magnotes.adrianguichard.dev/script.js'
        );
        const foreign = isAllowedAnalyticsSource(
            'https://example.com/script.js'
        );
        const malformed = isAllowedAnalyticsSource('not-a-url');

        expect(insecure).toBe(false);
        expect(foreign).toBe(false);
        expect(malformed).toBe(false);
    });

    it('allows analytics to be entirely disabled', () => {
        expect(analyticsConfigIssue(undefined, undefined)).toBeNull();
    });

    it('rejects partial or CSP-incompatible analytics config', () => {
        const missingId = analyticsConfigIssue(`${ANALYTICS_ORIGIN}/script.js`);
        const missingSource = analyticsConfigIssue(undefined, 'website-id');
        const foreignSource = analyticsConfigIssue(
            'https://example.com/script.js',
            'website-id'
        );

        expect(missingId).toMatch(/configured together/);
        expect(missingSource).toMatch(/configured together/);
        expect(foreignSource).toMatch(/must use/);
    });
});
