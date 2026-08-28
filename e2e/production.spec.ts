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
    test('serves the authentication surface without browser failures', async ({
        page,
    }) => {
        const failures = monitorBrowserFailures(page);

        const response = await page.goto('/app/', { waitUntil: 'networkidle' });
        expect(response?.status()).toBe(200);
        await expect(page.locator('.auth-page')).toBeVisible();
        await expect(page.locator('#email')).toBeVisible();
        await expect(page.locator('#umami-analytics')).toHaveAttribute(
            'src',
            'https://analytics-magnotes.adrianguichard.dev/script.js'
        );
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
