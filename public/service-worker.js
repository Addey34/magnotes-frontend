/*
 * MagNotes service worker — dependency-free, scoped to /app/.
 *
 * Strategy:
 *   - API calls (/api/**) are never cached (dynamic + auth-scoped).
 *   - Navigations use network-first, falling back to the cached app shell so the
 *     SPA still boots offline.
 *   - Same-origin static assets (hashed JS/CSS, icons) use cache-first.
 *
 * Vite emits content-hashed asset filenames, so cache-first is safe: a new
 * build produces new URLs. Bump CACHE_VERSION to force-drop old shells.
 */
const CACHE_VERSION = 'v1';
const CACHE = `magnotes-${CACHE_VERSION}`;
const APP_SHELL = '/app/index.html';
const PRECACHE = [APP_SHELL, '/app/manifest.webmanifest', '/app/icon.svg'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== CACHE)
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never intercept API traffic — always hit the network.
    if (url.pathname.startsWith('/api/')) return;
    // Only handle our own origin.
    if (url.origin !== self.location.origin) return;

    // Navigations: network-first with app-shell fallback (offline SPA boot).
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() =>
                caches
                    .match(request)
                    .then((cached) => cached || caches.match(APP_SHELL))
            )
        );
        return;
    }

    // Static same-origin assets: cache-first, then populate the cache.
    event.respondWith(
        caches.match(request).then(
            (cached) =>
                cached ||
                fetch(request).then((response) => {
                    if (response.ok && response.type === 'basic') {
                        const copy = response.clone();
                        caches
                            .open(CACHE)
                            .then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
        )
    );
});
