import { expect, test, type Page } from '@playwright/test';

// The Security dialog (signed-in devices + password change), against a mocked
// API: no backend is needed, so it runs on every profile. The real backend
// contract is covered by the server's integration tests.

interface MockSession {
    id: string;
    device: string;
    createdAt: string;
    lastUsedAt: string;
    current: boolean;
}

interface Call {
    method: string;
    path: string;
    body: Record<string, unknown> | null;
}

const base64Url = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = `${base64Url({ alg: 'HS256' })}.${base64Url({
    userId: 'u1',
    exp: Math.floor(Date.now() / 1000) + 3600,
})}.x`;
const minutesAgo = (minutes: number): string =>
    new Date(Date.now() - minutes * 60_000).toISOString();

const LONG_DEVICE =
    'Safari on an iPhone whose device name is long enough to test overflow';

const defaultSessions = (): MockSession[] => [
    {
        id: 'a',
        device: 'Chrome on Windows',
        createdAt: minutesAgo(60 * 24 * 5),
        lastUsedAt: minutesAgo(1),
        current: true,
    },
    {
        id: 'b',
        device: LONG_DEVICE,
        createdAt: minutesAgo(60 * 24 * 20),
        lastUsedAt: minutesAgo(180),
        current: false,
    },
    {
        id: 'c',
        device: 'Firefox on Linux',
        createdAt: minutesAgo(60 * 24 * 40),
        lastUsedAt: minutesAgo(60 * 24 * 3),
        current: false,
    },
];

const mockApi = async (page: Page, sessions: MockSession[]) => {
    const calls: Call[] = [];
    await page.addInitScript(() => localStorage.setItem('magnotes-lang', 'en'));
    await page.route(
        (url) => url.pathname.startsWith('/api/'),
        async (route) => {
            const request = route.request();
            const path = new URL(request.url()).pathname;
            const method = request.method();
            const json = (status: number, body: unknown) =>
                route.fulfill({
                    status,
                    contentType: 'application/json',
                    body: JSON.stringify(body),
                });
            const raw = request.postData();
            calls.push({
                method,
                path,
                body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
            });

            if (path === '/api/auth/refresh') {
                return json(200, {
                    token: accessToken,
                    user: {
                        email: 'a@example.test',
                        displayName: 'a',
                        emailVerified: true,
                    },
                });
            }
            if (path === '/api/account/sessions' && method === 'GET') {
                return json(200, { sessions });
            }
            if (path === '/api/account/sessions/revoke-others') {
                const removed = sessions.filter((s) => !s.current).length;
                sessions.splice(
                    0,
                    sessions.length,
                    ...sessions.filter((s) => s.current)
                );
                return json(200, { revoked: removed });
            }
            if (path.startsWith('/api/account/sessions/')) {
                const id = path.split('/').pop();
                const index = sessions.findIndex((s) => s.id === id);
                if (index < 0) return json(404, { error: 'Not found.' });
                sessions.splice(index, 1);
                return json(200, { message: 'ok' });
            }
            if (path === '/api/account/password') {
                const body = JSON.parse(raw ?? '{}') as {
                    currentPassword?: string;
                    signOutOthers?: boolean;
                };
                if (body.currentPassword === 'wrong-password') {
                    return json(401, { error: 'Mot de passe incorrect.' });
                }
                const revoked = body.signOutOthers === false ? 0 : 2;
                return json(200, { message: 'ok', revoked });
            }
            if (path === '/api/account') {
                return json(200, {
                    email: 'a@example.test',
                    displayName: 'a',
                    emailVerified: true,
                    createdAt: minutesAgo(1000),
                    emailPreferences: {
                        dueDigestFrequency: 'off',
                        timezone: 'Europe/Paris',
                        deliveryHour: 8,
                    },
                });
            }
            if (path === '/api/tabs') {
                return json(200, [
                    {
                        _id: 't1',
                        userId: 'u1',
                        name: 'Board',
                        color: '#fde047',
                        icon: 'home',
                        order: 0,
                        viewport: { x: 0, y: 0, zoom: 1 },
                    },
                ]);
            }
            return json(200, []);
        }
    );
    return calls;
};

const openSecurity = async (page: Page) => {
    await page.goto('/app/');
    await page.locator('button:has(.board-brand-mark)').first().click();
    await page.getByRole('menuitem', { name: /Security/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
};

test.describe('Security dialog', () => {
    test.use({ locale: 'en-US' });

    test('lists devices, flags this one, and signs another out after a confirmation', async ({
        page,
    }) => {
        const calls = await mockApi(page, defaultSessions());
        const dialog = await openSecurity(page);

        await expect(dialog.getByText('Firefox on Linux')).toBeVisible();
        await expect(dialog.getByText('This device')).toHaveCount(1);
        // Every row shows when the session was opened, time included, so two
        // sessions of the same browser can be told apart.
        await expect(
            dialog.getByText(/Signed in on .*\d{1,2}:\d{2}/).first()
        ).toBeVisible();

        await dialog
            .getByRole('button', { name: 'Sign out Firefox on Linux' })
            .click();
        // The first click only asks for a confirmation.
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        await dialog.getByRole('button', { name: 'Confirm' }).click();

        await expect(dialog.getByText('Firefox on Linux')).toHaveCount(0);
        expect(
            calls.some(
                (c) =>
                    c.method === 'DELETE' &&
                    c.path === '/api/account/sessions/c'
            )
        ).toBe(true);
    });

    test('signs out all the other devices in one go', async ({ page }) => {
        const calls = await mockApi(page, defaultSessions());
        const dialog = await openSecurity(page);

        await dialog
            .getByRole('button', { name: 'Sign out all other devices' })
            .click();
        await dialog.getByRole('button', { name: 'Confirm' }).click();

        await expect(dialog.getByText('2 device(s) signed out.')).toBeVisible();
        await expect(dialog.getByText('Firefox on Linux')).toHaveCount(0);
        expect(
            calls.some((c) => c.path === '/api/account/sessions/revoke-others')
        ).toBe(true);
        await expect(
            dialog.getByRole('button', { name: 'Sign out all other devices' })
        ).toBeDisabled();
    });

    test('has nothing to sign out when this is the only device', async ({
        page,
    }) => {
        await mockApi(page, defaultSessions().slice(0, 1));
        const dialog = await openSecurity(page);
        await expect(dialog.getByText('This device')).toBeVisible();
        await expect(
            dialog.getByRole('button', { name: 'Sign out all other devices' })
        ).toBeDisabled();
    });

    test('a wrong current password stays in the form and does not sign you out', async ({
        page,
    }) => {
        const calls = await mockApi(page, defaultSessions());
        const dialog = await openSecurity(page);
        const signOutOthers = dialog.getByRole('checkbox', {
            name: 'Sign out my other devices',
        });
        await expect(signOutOthers).toBeChecked();

        const refreshBefore = calls.filter(
            (c) => c.path === '/api/auth/refresh'
        ).length;
        await dialog.getByLabel('Current password').fill('wrong-password');
        await dialog.getByLabel('New password').fill('a-brand-new-password-1');
        await dialog.locator('button[type="submit"]').click();

        await expect(
            dialog.getByText('Current password is incorrect.')
        ).toBeVisible();
        await expect(dialog).toBeVisible();
        // The auth interceptor must not have tried to refresh or sign out.
        expect(calls.filter((c) => c.path === '/api/auth/refresh').length).toBe(
            refreshBefore
        );
        expect(
            calls.filter((c) => c.path === '/api/account/password')
        ).toHaveLength(1);
    });

    test('changes the password and reports how many devices were signed out', async ({
        page,
    }) => {
        const calls = await mockApi(page, defaultSessions());
        const dialog = await openSecurity(page);

        await dialog.getByLabel('Current password').fill('current-password-1');
        await dialog.getByLabel('New password').fill('a-brand-new-password-1');
        await dialog.locator('button[type="submit"]').click();

        await expect(
            dialog.getByText('Password changed. 2 other device(s) signed out.')
        ).toBeVisible();
        const sent = calls.find((c) => c.path === '/api/account/password');
        expect(sent?.body?.signOutOthers).toBe(true);
    });

    test('unticking the box keeps the other devices signed in', async ({
        page,
    }) => {
        const calls = await mockApi(page, defaultSessions());
        const dialog = await openSecurity(page);

        await dialog
            .getByRole('checkbox', { name: 'Sign out my other devices' })
            .uncheck();
        await dialog.getByLabel('Current password').fill('current-password-1');
        await dialog.getByLabel('New password').fill('a-brand-new-password-1');
        await dialog.locator('button[type="submit"]').click();

        await expect(
            dialog.getByText('Password changed. 0 other device(s) signed out.')
        ).toBeVisible();
        const sent = calls.find((c) => c.path === '/api/account/password');
        expect(sent?.body?.signOutOthers).toBe(false);
    });

    test('a very long device name does not overflow the dialog or the page', async ({
        page,
    }) => {
        await mockApi(page, defaultSessions());
        const dialog = await openSecurity(page);
        await expect(dialog.getByText(LONG_DEVICE)).toBeVisible();

        const overflow = await page.evaluate(() => {
            const box = document.querySelector('.security-dialog');
            return {
                page:
                    document.documentElement.scrollWidth -
                    document.documentElement.clientWidth,
                dialog: box ? box.scrollWidth - box.clientWidth : null,
            };
        });
        expect(overflow.page).toBeLessThanOrEqual(0);
        expect(overflow.dialog).toBe(0);
    });
});

test.describe('Security dialog in demo mode', () => {
    test.use({ locale: 'en-US' });

    test('is not offered: a demo has no account', async ({ page }) => {
        await page.goto('/app/?demo=1&lang=en');
        await page.locator('button:has(.board-brand-mark)').first().click();
        await expect(page.getByRole('menuitem').first()).toBeVisible();
        await expect(
            page.getByRole('menuitem', { name: /Security/ })
        ).toHaveCount(0);
    });
});
