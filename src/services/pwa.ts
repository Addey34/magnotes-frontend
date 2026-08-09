/**
 * Service worker registration for the installable PWA. Dependency-free.
 *
 * Registration is gated on `enabled` (production only — passed from index.tsx)
 * so dev/HMR and the demo sandbox never install a worker that would serve stale
 * assets. The SW file itself lives in public/service-worker.js and is scoped to
 * /app/. `navigator` is injected so the logic is unit-testable.
 */

type SWContainer = Pick<ServiceWorkerContainer, 'register'>;
interface RegistrarNavigator {
    serviceWorker?: SWContainer;
}

export interface RegisterOptions {
    enabled: boolean;
    /** Defaults to the global navigator; injectable for tests. */
    nav?: RegistrarNavigator;
    /** Defaults to '/app/service-worker.js'. */
    scriptUrl?: string;
}

/**
 * Register the service worker when enabled and supported. Returns the
 * registration promise (or null when skipped) so callers/tests can await it.
 */
export function registerServiceWorker(
    options: RegisterOptions
): Promise<unknown> | null {
    const { enabled } = options;
    if (!enabled) return null;

    const nav: RegistrarNavigator | undefined =
        options.nav ??
        (typeof navigator !== 'undefined'
            ? (navigator as RegistrarNavigator)
            : undefined);

    const container = nav?.serviceWorker;
    if (!container) return null;

    const scriptUrl = options.scriptUrl ?? '/app/service-worker.js';
    return container.register(scriptUrl, { scope: '/app/' }).catch((error) => {
        // A failed SW registration must never break the app.
        console.warn('[pwa] service worker registration failed:', error);
        return null;
    });
}
