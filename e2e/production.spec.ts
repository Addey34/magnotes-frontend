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
        await expectNoBlockingAccessibilityIssues(page);
        expect(failures).toEqual([]);
    });

    test('reports a healthy and ready API', async ({ request }) => {
        for (const path of ['/health', '/health/ready']) {
            const response = await request.get(`${apiUrl}${path}`);
            expect(response.status(), path).toBe(200);
        }
    });
});
