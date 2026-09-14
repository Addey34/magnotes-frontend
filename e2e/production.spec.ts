import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const apiUrl =
    process.env.PRODUCTION_API_URL ?? 'https://api-magnotes.adrianguichard.dev';

const monitorBrowserFailures = (page: Page) => {
    const failures: string[] = [];

    page.on('pageerror', (error) =>
        failures.push(`pageerror: ${error.message}`)
    );
    page.on('console', (message) => {
        // Resource errors are recorded below with their URL and status.
        if (
            message.type() === 'error' &&
            !message.text().startsWith('Failed to load resource:')
        ) {
            failures.push(`console: ${message.text()}`);
        }
    });
    page.on('response', (response) => {
        const expectedAnonymousRefresh =
            response.status() === 401 &&
            response.url().includes('/api/auth/refresh');
        if (response.status() >= 400 && !expectedAnonymousRefresh) {
            failures.push(`response: ${response.status()} ${response.url()}`);
        }
    });
    page.on('requestfailed', (request) => {
        failures.push(
            `request: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`
        );
    });

    return failures;
};

const expectNoBlockingAccessibilityIssues = async (page: Page) => {
    const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
    const blocking = results.violations.filter((violation) =>
        ['serious', 'critical'].includes(violation.impact ?? '')
    );

    expect(blocking).toEqual([]);
};

test.describe('deployed production', () => {
    test.beforeEach(async ({ page }) => {
        await page.route(
            'https://analytics-magnotes.adrianguichard.dev/api/send',
            (route) => route.fulfill({ status: 204, body: '' })
        );
    });

    for (const path of ['/', '/en/']) {
        test(`keeps every landing navigation action inside the mobile header (${path})`, async ({
            page,
        }) => {
            const response = await page.goto(path, {
                waitUntil: 'networkidle',
            });
            expect(response?.status()).toBe(200);

            const header = page.locator('header');
            const headerBox = await header.boundingBox();
            expect(headerBox).not.toBeNull();
            for (const action of await header.locator('a').all()) {
                const actionBox = await action.boundingBox();
                expect(actionBox).not.toBeNull();
                expect(actionBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
                expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(
                    headerBox!.y + headerBox!.height
                );
                expect(actionBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
                expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
                    headerBox!.x + headerBox!.width
                );
            }
        });
    }

    test('keeps acquisition analytics measurable while honoring QA opt-out', async ({
        page,
    }) => {
        let analyticsRequests = 0;
        page.on('request', (request) => {
            if (
                request.url() ===
                'https://analytics-magnotes.adrianguichard.dev/api/send'
            ) {
                analyticsRequests += 1;
            }
        });

        await page.goto('/?analytics=off', { waitUntil: 'networkidle' });
        await expect(page.locator('script[data-website-id]')).toHaveAttribute(
            'data-before-send',
            'magNotesAnalyticsBeforeSend'
        );
        await expect(
            page.locator('[data-umami-event="landing_demo_started"]')
        ).not.toHaveCount(0);

        await page.goto('/templates/client-project/?analytics=off', {
            waitUntil: 'networkidle',
        });
        await expect(
            page.locator('[data-umami-event="template_demo_started"]').first()
        ).toHaveAttribute('data-umami-event-template', 'client-project');
        expect(analyticsRequests).toBe(0);
    });

    for (const [path, heading, alternate] of [
        ['/confidentialite/', 'Politique de confidentialité', '/en/privacy/'],
        ['/en/privacy/', 'Privacy policy', '/confidentialite/'],
    ] as const) {
        test(`serves an indexable privacy page (${path})`, async ({ page }) => {
            const failures = monitorBrowserFailures(page);
            const response = await page.goto(path, {
                waitUntil: 'networkidle',
            });

            expect(response?.status()).toBe(200);
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(
                heading
            );
            await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
                'content',
                'index, follow'
            );
            await expect(
                page.locator(`link[rel="alternate"][href$="${alternate}"]`)
            ).toHaveCount(1);
            await expectNoBlockingAccessibilityIssues(page);
            expect(failures).toEqual([]);
        });
    }

    test('serves the authentication surface and tracker without recording QA', async ({
        page,
    }) => {
        let interceptedAnalyticsRequests = 0;
        page.on('request', (request) => {
            if (
                request.url() ===
                'https://analytics-magnotes.adrianguichard.dev/api/send'
            ) {
                interceptedAnalyticsRequests += 1;
            }
        });
        const failures = monitorBrowserFailures(page);

        const response = await page.goto('/app/', { waitUntil: 'networkidle' });
        expect(response?.status()).toBe(200);
        await expect(page.locator('.auth-page')).toBeVisible();
        await expect(page.locator('#email')).toBeVisible();
        await expect(page.locator('#umami-analytics')).toHaveAttribute(
            'src',
            'https://analytics-magnotes.adrianguichard.dev/script.js'
        );
        expect(interceptedAnalyticsRequests).toBeGreaterThan(0);
        await expectNoBlockingAccessibilityIssues(page);
        expect(failures).toEqual([]);
    });

    test('keeps the public demo usable without browser failures', async ({
        page,
    }) => {
        const failures = monitorBrowserFailures(page);

        const response = await page.goto('/app/?demo=1', {
            waitUntil: 'networkidle',
        });
        expect(response?.status()).toBe(200);
        await expect(page.locator('.board-app')).toBeVisible();
        await expect(page.locator('.demo-banner')).toBeVisible();
        await expect(page.locator('.post-it-card')).toHaveCount(6);
        await expect(page.locator('#umami-analytics')).toHaveCount(0);
        await expectNoBlockingAccessibilityIssues(page);
        expect(failures).toEqual([]);
    });

    test('keeps explicit production QA out of analytics', async ({ page }) => {
        const failures = monitorBrowserFailures(page);
        const response = await page.goto('/app/?analytics=off', {
            waitUntil: 'networkidle',
        });

        expect(response?.status()).toBe(200);
        await expect(page.locator('.auth-page')).toBeVisible();
        await expect(page.locator('#umami-analytics')).toHaveCount(0);
        expect(failures).toEqual([]);
    });

    test('reports a healthy and ready API', async ({ request }) => {
        for (const path of ['/health', '/health/ready']) {
            const response = await request.get(`${apiUrl}${path}`);
            expect(response.status(), path).toBe(200);
        }
    });

    test('keeps protected and unknown public resources closed', async ({
        request,
    }) => {
        const protectedResponse = await request.get(`${apiUrl}/api/tabs`);
        expect(protectedResponse.status()).toBe(401);

        const unknownShare = await request.get(
            `${apiUrl}/api/public/boards/00000000000000000000000000000000`
        );
        expect(unknownShare.status()).toBe(404);
    });

    test('serves an installable manifest with reachable icons', async ({
        request,
    }) => {
        const response = await request.get('/app/manifest.webmanifest');
        expect(response.status()).toBe(200);
        const manifest = (await response.json()) as {
            name?: string;
            start_url?: string;
            scope?: string;
            display?: string;
            icons?: Array<{ src: string; sizes: string; purpose?: string }>;
        };

        expect(manifest).toMatchObject({
            name: 'MagNotes',
            start_url: '/app/',
            scope: '/app/',
            display: 'standalone',
        });
        expect(manifest.icons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ sizes: '192x192' }),
                expect.objectContaining({ sizes: '512x512' }),
                expect.objectContaining({ purpose: 'maskable' }),
            ])
        );

        for (const icon of manifest.icons ?? []) {
            const iconResponse = await request.get(icon.src);
            expect(iconResponse.status(), icon.src).toBe(200);
        }
    });

    test('boots the demo from the service-worker cache while offline', async ({
        context,
        page,
    }) => {
        await page.goto('/app/?demo=1', { waitUntil: 'networkidle' });
        await page.evaluate(() => navigator.serviceWorker.ready);

        // Reload once online under SW control so the hashed JS/CSS bundles are
        // cached by the worker's cache-first static-asset strategy.
        await page.reload({ waitUntil: 'networkidle' });
        await expect
            .poll(() =>
                page.evaluate(() => Boolean(navigator.serviceWorker.controller))
            )
            .toBe(true);

        await context.setOffline(true);
        try {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expect(page.locator('.board-app')).toBeVisible();
            await expect(page.locator('.post-it-card')).toHaveCount(6);
        } finally {
            await context.setOffline(false);
        }
    });
});
