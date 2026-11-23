import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Acquisition funnel: the demo sandbox is measured through anonymous `demo_*`
// events only. A stub replaces the Umami tracker so the exact calls can be read.
// No API needed: the session probe is answered "not signed in".

type Call = unknown[];

const stubTracker = (page: Page) =>
    page.addInitScript(() => {
        const calls: unknown[][] = [];
        (window as unknown as { __umamiCalls: unknown[][] }).__umamiCalls =
            calls;
        (window as unknown as { umami: unknown }).umami = {
            track: (...args: unknown[]) => calls.push(args),
        };
    });

const trackerCalls = (page: Page) =>
    page.evaluate(
        () => (window as unknown as { __umamiCalls: unknown[][] }).__umamiCalls
    ) as Promise<Call[]>;

const noSession = (page: Page) =>
    page.route('**/api/auth/refresh', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'No active session' }),
        })
    );

test.describe('demo funnel events', () => {
    test.beforeEach(async ({ page }) => {
        await noSession(page);
        await stubTracker(page);
    });

    test('demo card creation and the signup CTA are counted, anonymously', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=en');
        const cards = page.locator('.post-it-card');
        await expect(cards.first()).toBeVisible();
        const initialCount = await cards.count();

        await page.locator('.create-card-button').click();
        await expect(cards).toHaveCount(initialCount + 1);
        await cards.last().locator('.post-it-title').fill('Secret title 42');

        await page.locator('.demo-banner__cta').click();
        await expect(page.locator('#confirm-password')).toBeVisible();

        const calls = await trackerCalls(page);
        expect(calls).toEqual([
            ['demo_card_created'],
            ['demo_signup_cta_clicked'],
        ]);
        // Event name only: no payload, never any card content.
        expect(JSON.stringify(calls)).not.toContain('Secret');
    });

    test('analytics=off sends nothing from the demo', async ({ page }) => {
        await page.goto('/app/?demo=1&lang=en&analytics=off');
        await expect(page.locator('.post-it-card').first()).toBeVisible();
        await page.locator('.create-card-button').click();
        await page.locator('.demo-banner__cta').click();
        await expect(page.locator('#confirm-password')).toBeVisible();

        expect(await trackerCalls(page)).toEqual([]);
    });

    test('no signup milestone is reported from the sandbox', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=en');
        await expect(page.locator('.post-it-card').first()).toBeVisible();
        await page.locator('.demo-banner__cta').click();
        await expect(page.locator('#confirm-password')).toBeVisible();

        const names = (await trackerCalls(page)).map((call) => call[0]);
        expect(names).not.toContain('signup_started');
        expect(names).toContain('demo_signup_cta_clicked');
    });

    test('the last edit typed before the signup CTA stays in the demo copy', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=en');
        const cards = page.locator('.post-it-card');
        await expect(cards.first()).toBeVisible();
        const initialCount = await cards.count();
        await page.locator('.create-card-button').click();
        await expect(cards).toHaveCount(initialCount + 1);
        await cards.last().locator('.post-it-title').fill('Typed just before');

        // No pause: the autosave debounce has not fired yet.
        await page.locator('.demo-banner__cta').click();
        await expect(page.locator('#confirm-password')).toBeVisible();

        await expect
            .poll(() =>
                page.evaluate(() =>
                    (
                        localStorage.getItem('magnotes-demo-board-v1') ?? ''
                    ).includes('Typed just before')
                )
            )
            .toBe(true);
    });
});
