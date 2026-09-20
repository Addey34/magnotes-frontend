export const ANALYTICS_ORIGIN = 'https://analytics-magnotes.adrianguichard.dev';

export function isAllowedAnalyticsSource(value?: string): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === ANALYTICS_ORIGIN;
    } catch {
        return false;
    }
}

export function analyticsConfigIssue(
    src?: string,
    websiteId?: string
): string | null {
    if (!src && !websiteId) return null;
    if (!src || !websiteId) {
        return 'VITE_UMAMI_SRC and VITE_UMAMI_WEBSITE_ID must be configured together.';
    }
    if (!isAllowedAnalyticsSource(src)) {
        return `VITE_UMAMI_SRC must use ${ANALYTICS_ORIGIN} over HTTPS.`;
    }
    return null;
}
