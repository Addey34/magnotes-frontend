import {
    ANALYTICS_ORIGIN,
    analyticsConfigIssue,
    isAllowedAnalyticsSource,
} from './analyticsConfig';

describe('analytics hosting configuration', () => {
    it('accepts the self-hosted HTTPS tracker origin', () => {
        expect(
            isAllowedAnalyticsSource(`${ANALYTICS_ORIGIN}/script.js`)
        ).toBe(true);
    });

    it('rejects insecure or unexpected tracker origins', () => {
        expect(
            isAllowedAnalyticsSource(
                'http://analytics-magnotes.adrianguichard.dev/script.js'
            )
        ).toBe(false);
        expect(
            isAllowedAnalyticsSource('https://example.com/script.js')
        ).toBe(false);
        expect(isAllowedAnalyticsSource('not-a-url')).toBe(false);
    });

    it('allows analytics to be entirely disabled', () => {
        expect(analyticsConfigIssue(undefined, undefined)).toBeNull();
    });

    it('rejects partial or CSP-incompatible analytics config', () => {
        expect(analyticsConfigIssue(`${ANALYTICS_ORIGIN}/script.js`)).toMatch(
            /configured together/
        );
        expect(
            analyticsConfigIssue(undefined, 'website-id')
        ).toMatch(/configured together/);
        expect(
            analyticsConfigIssue(
                'https://example.com/script.js',
                'website-id'
            )
        ).toMatch(/must use/);
    });
});
