import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Which form the sign-in screen opens on. No API needed: the session probe is
// answered "not signed in".
const IMPORT_KEY = 'magnotes-demo-import-v1';

const noSession = (page: Page) =>
    page.route('**/api/auth/refresh', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'No active session' }),
        })
    );

const expectSignUp = async (page: Page) => {
    await expect(page.locator('.auth-page')).toBeVisible();
    await expect(page.locator('#confirm-password')).toBeVisible();
};
const expectSignIn = async (page: Page) => {
    await expect(page.locator('.auth-page')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#confirm-password')).toHaveCount(0);
};

const noHorizontalOverflow = (page: Page) =>
    page.evaluate(
        () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1
    );

test.describe('sign-up entry', () => {
    test.beforeEach(async ({ page }) => noSession(page));

    test('a start link opens the sign-up form and cleans the URL', async ({
        page,
    }) => {
        await page.goto('/app/?lang=fr&signup=1');

        await expectSignUp(page);
        await expect(page.locator('.auth-submit')).toHaveText(
            'Créer mon compte'
        );
        expect(new URL(page.url()).searchParams.has('signup')).toBe(false);
        expect(new URL(page.url()).searchParams.get('lang')).toBe('fr');
        expect(await noHorizontalOverflow(page)).toBe(true);
    });

    test('works in English', async ({ page }) => {
        await page.goto('/app/?lang=en&signup=1');

        await expectSignUp(page);
        await expect(page.locator('.auth-submit')).toHaveText(
            'Create my account'
        );
    });

    test('a plain /app/ keeps the sign-in screen', async ({ page }) => {
        await page.goto('/app/?lang=fr');

        await expectSignIn(page);
        await expect(page.locator('.auth-submit')).toHaveText('Se connecter');
    });

    test('a reload after the clean-up opens the sign-in screen', async ({
        page,
    }) => {
        await page.goto('/app/?lang=fr&signup=1');
        await expectSignUp(page);

        await page.reload();

        await expectSignIn(page);
    });

    test('the switch link goes both ways', async ({ page }) => {
        await page.goto('/app/?signup=1');
        await expectSignUp(page);

        await page.locator('.auth-switch button').click();
        await expectSignIn(page);
        await page.locator('.auth-switch button').click();
        await expectSignUp(page);
    });

    test('?demo=1&signup=1 stays in the demo', async ({ page }) => {
        await page.goto('/app/?demo=1&signup=1');

        await expect(page.locator('.demo-banner')).toBeVisible();
        await expect(page.locator('.auth-page')).toHaveCount(0);
    });

    test('the demo "keep my notes" button opens sign-up and keeps the import', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        await expect(page.locator('.demo-banner')).toBeVisible();

        await page.locator('.demo-banner__cta').click();

        await expectSignUp(page);
        expect(
            await page.evaluate((k) => localStorage.getItem(k), IMPORT_KEY)
        ).not.toBeNull();
        expect(new URL(page.url()).searchParams.has('demo')).toBe(false);

        // An existing user can still sign in from there, import still pending.
        await page.locator('.auth-switch button').click();
        await expectSignIn(page);
        expect(
            await page.evaluate((k) => localStorage.getItem(k), IMPORT_KEY)
        ).not.toBeNull();
        expect(await noHorizontalOverflow(page)).toBe(true);
    });
});
