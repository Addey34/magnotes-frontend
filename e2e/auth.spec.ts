import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const mockUnauthenticatedRefresh = async (page: Page) => {
    await page.route('**/api/auth/refresh', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'No active session' }),
        })
    );
};

const openAuth = async (page: Page) => {
    await mockUnauthenticatedRefresh(page);
    await page.goto('/app/');
    await expect(page.locator('.auth-page')).toBeVisible();
};

test.describe('local authentication journeys', () => {
    test('registers and reaches email verification', async ({ page }) => {
        await openAuth(page);
        await page.route('**/api/auth/register', (route) =>
            route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({
                    message: 'Verification code sent',
                    email: 'qa@example.com',
                }),
            })
        );

        await page.locator('.auth-switch button').click();
        await page.locator('#email').fill('qa@example.com');
        await page.locator('#password').fill('StrongPassword123!');
        await page.locator('#confirm-password').fill('StrongPassword123!');
        await page.locator('.auth-submit').click();

        await expect(
            page.locator('input[autocomplete="one-time-code"]')
        ).toBeVisible();
        await expect(page.locator('.auth-message.is-success')).toBeVisible();
    });

    test('routes an unverified login to verification and resends the code', async ({
        page,
    }) => {
        await openAuth(page);
        await page.route('**/api/auth/login', (route) =>
            route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({
                    code: 'EMAIL_NOT_VERIFIED',
                    error: 'Email not verified',
                }),
            })
        );
        await page.route('**/api/auth/resend', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Verification code sent' }),
            })
        );

        await page.locator('#email').fill('qa@example.com');
        await page.locator('#password').fill('StrongPassword123!');
        await page.locator('.auth-submit').click();

        await expect(
            page.locator('input[autocomplete="one-time-code"]')
        ).toBeVisible();
        await expect(page.locator('.auth-message.is-success')).toBeVisible();
    });

    test('shows a login error returned by the API', async ({ page }) => {
        await openAuth(page);
        await page.route('**/api/auth/login', (route) =>
            route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Invalid credentials' }),
            })
        );

        await page.locator('#email').fill('qa@example.com');
        await page.locator('#password').fill('WrongPassword123!');
        await page.locator('.auth-submit').click();

        await expect(page.locator('.auth-message.is-error')).toHaveText(
            'Invalid credentials'
        );
    });

    test('completes the forgot-password and reset transition', async ({
        page,
    }) => {
        await openAuth(page);
        await page.route('**/api/auth/forgot-password', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Reset code sent' }),
            })
        );
        await page.route('**/api/auth/reset-password', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Password reset' }),
            })
        );

        await page.locator('.auth-inline-link').click();
        await page.locator('#email').fill('qa@example.com');
        await page.locator('.auth-submit').click();
        await expect(
            page.locator('input[autocomplete="one-time-code"]')
        ).toBeVisible();

        await page
            .locator('input[autocomplete="one-time-code"]')
            .fill('123456');
        await page.locator('#password').fill('NewStrongPassword123!');
        await page.locator('#confirm-password').fill('NewStrongPassword123!');
        await page.locator('.auth-submit').click();

        await expect(page.locator('#email')).toBeVisible();
        await expect(page.locator('.auth-message.is-success')).toHaveText(
            'Password reset. You can now sign in.'
        );
    });
});
