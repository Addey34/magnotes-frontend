import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const noSession = (page: Page) =>
    page.route('**/api/auth/refresh', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'No active session' }),
        })
    );

test.describe('auth legal links', () => {
    test.beforeEach(async ({ page }) => noSession(page));

    for (const [lang, label, href] of [
        ['fr', 'Confidentialité', '/confidentialite/'],
        ['en', 'Privacy', '/en/privacy/'],
    ] as const) {
        test(`links are visible, focusable and do not overflow (${lang})`, async ({
            page,
        }) => {
            await page.goto(`/app/?lang=${lang}`);
            const nav = page.locator('.auth-legal');
            await expect(nav).toBeVisible();
            const privacy = nav.getByRole('link', { name: label });
            const contact = nav.getByRole('link', { name: 'Contact' });
            await expect(privacy).toHaveAttribute('href', href);
            await expect(contact).toHaveAttribute(
                'href',
                'mailto:contact@adrianguichard.dev'
            );

            const vw = page.viewportSize()!.width;
            for (const link of [privacy, contact]) {
                const box = await link.boundingBox();
                expect(box).not.toBeNull();
                expect(box!.x).toBeGreaterThanOrEqual(0);
                expect(box!.x + box!.width).toBeLessThanOrEqual(vw);
            }
            expect(
                await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        document.documentElement.clientWidth + 1
                )
            ).toBe(true);

            await privacy.focus();
            await expect(privacy).toBeFocused();
        });
    }

    test('links remain in sign up mode and do not disturb the form', async ({
        page,
    }) => {
        await page.goto('/app/?lang=fr');
        await page.locator('.auth-switch button').click();
        await expect(page.locator('#confirm-password')).toBeVisible();
        await expect(page.locator('.auth-legal a')).toHaveCount(2);
        await page.locator('#email').fill('qa@example.com');
        await expect(page.locator('#email')).toHaveValue('qa@example.com');
    });

    test('the privacy link opens the policy in a new tab and keeps the form', async ({
        page,
        context,
    }) => {
        await page.goto('/app/?lang=fr');
        await page.locator('#email').fill('qa@example.com');
        const popup = context.waitForEvent('page');
        await page
            .locator('.auth-legal')
            .getByRole('link', { name: 'Confidentialité' })
            .click();
        const tab = await popup;
        await tab.close();
        await expect(page.locator('#email')).toHaveValue('qa@example.com');
    });
});
