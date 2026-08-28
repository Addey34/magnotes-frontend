/**
 * Privacy-first analytics via self-hosted Umami. No cookies, no personal data —
 * Umami only records anonymous page views and events.
 *
 * This module is intentionally free of `import.meta` so it stays unit-testable
 * under ts-jest (CommonJS). The Vite env is read by the caller (index.tsx),
 * which passes the resolved config in. If `src`/`websiteId` are absent, or the
 * visitor is in the demo sandbox, injection is skipped.
 *
 * The tracker origin must be allow-listed in the Firebase CSP
 * (script-src + connect-src).
 */

import { isDemoRequested } from './demoMode';

const SCRIPT_ID = 'umami-analytics';

export interface AnalyticsConfig {
    src?: string;
    websiteId?: string;
    /** When true, skip injection (demo sandbox traffic is noise). */
    isDemo?: boolean;
}

export type ProductEvent =
    | 'signup_started'
    | 'signup_registered'
    | 'email_verified'
    | 'login_completed'
    | 'board_created'
    | 'card_created';

type UmamiTracker = {
    track: (event: ProductEvent) => void;
};

/**
 * Sends one anonymous product milestone when Umami has loaded. Event payloads
 * deliberately never include emails, user ids, board names, or card content.
 */
export function trackProductEvent(event: ProductEvent): boolean {
    if (typeof window === 'undefined' || isDemoRequested()) return false;

    const tracker = (window as typeof window & { umami?: UmamiTracker }).umami;
    if (typeof tracker?.track !== 'function') return false;

    tracker.track(event);
    return true;
}

/**
 * Inject the Umami tracker once. Pure w.r.t. its `config` argument.
 * Returns true when a script tag was injected.
 */
export function initAnalytics(config: AnalyticsConfig = {}): boolean {
    if (typeof document === 'undefined') return false;

    const { src, websiteId } = config;
    const isDemo = config.isDemo ?? isDemoRequested();

    if (!src || !websiteId) return false;
    if (isDemo) return false;
    if (document.getElementById(SCRIPT_ID)) return false;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = src;
    script.setAttribute('data-website-id', websiteId);
    document.head.appendChild(script);
    return true;
}
