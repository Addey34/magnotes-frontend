/**
 * Privacy-first analytics via self-hosted Umami. No cookies, no personal data —
 * Umami only records anonymous page views and events.
 *
 * This module is intentionally free of `import.meta` so it stays unit-testable
 * under ts-jest (CommonJS). The Vite env is read by the caller (index.tsx),
 * which passes the resolved config in. If `src`/`websiteId` are absent,
 * injection is skipped.
 *
 * The demo sandbox is measured too (it is the top of the acquisition funnel),
 * but only through the anonymous `demo_*` events below: never card content,
 * titles, ids or any other payload.
 *
 * The tracker origin must be allow-listed in the Firebase CSP
 * (script-src + connect-src).
 */

import { isDemoActive, isDemoRequested } from './demoMode';

const SCRIPT_ID = 'umami-analytics';

export interface AnalyticsConfig {
    src?: string;
    websiteId?: string;
    /** Explicit opt-out for automated production QA and privacy controls. */
    disabled?: boolean;
}

export type ProductEvent =
    | 'signup_started'
    | 'signup_registered'
    | 'email_verified'
    | 'login_completed'
    | 'board_created'
    | 'card_created'
    | 'demo_board_created'
    | 'demo_card_created'
    | 'demo_signup_cta_clicked'
    | 'demo_import_started'
    | 'demo_import_completed'
    | 'demo_import_failed';

// Inside the demo sandbox, board/card creation is reported under its own
// `demo_*` name so demo activity can never be mistaken for account activity.
const DEMO_VARIANT: Partial<Record<ProductEvent, ProductEvent>> = {
    board_created: 'demo_board_created',
    card_created: 'demo_card_created',
};

// Events that belong to the demo journey and are always allowed. The import
// events fire right after the visitor left the sandbox for an account.
const DEMO_JOURNEY_EVENTS: ReadonlySet<ProductEvent> = new Set([
    'demo_board_created',
    'demo_card_created',
    'demo_signup_cta_clicked',
    'demo_import_started',
    'demo_import_completed',
    'demo_import_failed',
]);

export function isInDemoSandbox(): boolean {
    return isDemoRequested() || isDemoActive();
}

type UmamiTracker = {
    track: (event: ProductEvent) => void;
};

export function isAnalyticsDisabled(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        new URLSearchParams(window.location.search).get('analytics') === 'off'
    );
}

export function isSensitiveAnalyticsPath(): boolean {
    if (typeof window === 'undefined') return false;
    return /^\/app\/b\/[a-f0-9]{32}\/?$/i.test(window.location.pathname);
}

/**
 * Sends one anonymous product milestone when Umami has loaded. Event payloads
 * deliberately never include emails, user ids, board names, or card content.
 */
export function trackProductEvent(event: ProductEvent): boolean {
    if (
        typeof window === 'undefined' ||
        isAnalyticsDisabled() ||
        isSensitiveAnalyticsPath()
    )
        return false;

    const name = isInDemoSandbox() ? (DEMO_VARIANT[event] ?? event) : event;
    // In the sandbox only demo-journey events are sent (no login/signup
    // milestones, which describe a real account).
    if (isInDemoSandbox() && !DEMO_JOURNEY_EVENTS.has(name)) return false;

    const tracker = (window as typeof window & { umami?: UmamiTracker }).umami;
    if (typeof tracker?.track !== 'function') return false;

    tracker.track(name);
    return true;
}

/**
 * Inject the Umami tracker once. Pure w.r.t. its `config` argument.
 * Returns true when a script tag was injected.
 */
export function initAnalytics(config: AnalyticsConfig = {}): boolean {
    if (typeof document === 'undefined') return false;

    const { src, websiteId } = config;
    const disabled = config.disabled ?? isAnalyticsDisabled();

    if (isSensitiveAnalyticsPath()) return false;
    if (!src || !websiteId) return false;
    if (disabled) return false;
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
