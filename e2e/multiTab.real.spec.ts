import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Real API + ephemeral database + fictitious accounts only. Same prerequisites
// as auth.real.spec.ts (local API on :5500 and a Mailpit-compatible API).
const enabled = process.env.E2E_REAL_API === '1';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025';
const password = 'StrongPassword123!';

async function verificationCode(email: string): Promise<string> {
    const search = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    const { messages = [] } = (await search.json()) as {
        messages?: Array<{ ID: string }>;
    };
    if (!messages[0]) throw new Error('Verification email has not arrived.');
    const message = await fetch(
        `${mailpitUrl}/api/v1/message/${messages[0].ID}`
    );
    const { Text = '' } = (await message.json()) as { Text?: string };
    const code = Text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('Verification code not found.');
    return code;
}

async function signUp(page: Page, email: string): Promise<void> {
    await page.goto('/app/');
    await page.locator('.auth-switch button').click();
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#confirm-password').fill(password);
    await page.locator('.auth-submit').click();
    const codeInput = page.locator('input[autocomplete="one-time-code"]');
    await expect(codeInput).toBeVisible();
    await expect
        .poll(() => verificationCode(email), { timeout: 10_000 })
        .toMatch(/^\d{6}$/);
    await codeInput.fill(await verificationCode(email));
    await page.locator('.auth-submit').click();
    await expect(page.locator('.board-app')).toBeVisible();
}

const signOut = (page: Page) =>
    page
        .getByRole('button', { name: /^(Déconnexion|Sign out)$/ })
        .first()
        .click();

function trackRefresh(page: Page, log: number[]) {
    page.on('response', (response) => {
        if (response.url().includes('/api/auth/refresh')) {
            log.push(response.status());
        }
    });
}

async function openSecondTab(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    await page.goto('/app/');
    await expect(page.locator('.board-app')).toBeVisible();
    return page;
}

test.describe('multi-tab session coordination (real API)', () => {
    test.skip(
        !enabled,
        'Set E2E_REAL_API=1 after starting the API and Mailpit.'
    );

    test('two tabs reload together without a 401 or a login prompt', async ({
        page,
        context,
    }, testInfo) => {
        await signUp(
            page,
            `mt-a-${testInfo.project.name}-${Date.now()}@example.test`
        );
        const second = await openSecondTab(context);

        const statuses: number[] = [];
        trackRefresh(page, statuses);
        trackRefresh(second, statuses);
        await Promise.all([page.reload(), second.reload()]);
        await expect(page.locator('.board-app')).toBeVisible();
        await expect(second.locator('.board-app')).toBeVisible();

        expect(statuses.length).toBeGreaterThanOrEqual(2);
        expect(statuses.every((status) => status === 200)).toBe(true);
        await expect(page.locator('.auth-page')).toHaveCount(0);

        // No credential is readable from JavaScript in either tab.
        for (const tab of [page, second]) {
            const exposed = await tab.evaluate(() => ({
                local: JSON.stringify({ ...localStorage }),
                session: JSON.stringify({ ...sessionStorage }),
                cookie: document.cookie,
            }));
            expect(exposed.local).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
            expect(exposed.session).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
            expect(exposed.cookie).not.toContain('magnotes_refresh');
        }
    });

    test('logout in one tab signs the other out and survives a reload', async ({
        page,
        context,
    }, testInfo) => {
        await signUp(
            page,
            `mt-b-${testInfo.project.name}-${Date.now()}@example.test`
        );
        const second = await openSecondTab(context);

        await signOut(page);
        await expect(page.locator('.auth-page')).toBeVisible();
        await expect(second.locator('.auth-page')).toBeVisible();
        await expect(page.getByTestId('logout-notice')).toHaveAttribute(
            'data-state',
            'confirmed'
        );
        await expect(second.getByTestId('logout-notice')).toHaveAttribute(
            'data-state',
            'confirmed'
        );

        await second.reload();
        await expect(second.locator('.auth-page')).toBeVisible();
        await expect(second.locator('.board-app')).toHaveCount(0);
    });

    test('an unconfirmed logout is shown explicitly, blocks silent login, and can be retried', async ({
        page,
        context,
    }, testInfo) => {
        await signUp(
            page,
            `mt-c-${testInfo.project.name}-${Date.now()}@example.test`
        );
        const second = await openSecondTab(context);

        await page.route('**/api/auth/logout', (route) =>
            route.abort('failed')
        );
        await signOut(page);
        await expect(page.getByTestId('logout-notice')).toHaveAttribute(
            'data-state',
            'unconfirmed'
        );
        await expect(second.getByTestId('logout-notice')).toHaveAttribute(
            'data-state',
            'unconfirmed'
        );
        await expect(
            page.getByText(/session revoked|session révoquée/i)
        ).toHaveCount(0);

        // The notice must stay inside the viewport (no overflow on phones).
        const box = await page.getByTestId('logout-notice').boundingBox();
        const viewport = page.viewportSize()!;
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        await testInfo.attach('unconfirmed-logout', {
            body: await page.screenshot(),
            contentType: 'image/png',
        });

        // Reload: still signed out, and no silent refresh is attempted.
        const refreshCalls: number[] = [];
        trackRefresh(page, refreshCalls);
        await page.reload();
        await expect(page.locator('.auth-page')).toBeVisible();
        await expect(page.getByTestId('logout-notice')).toHaveAttribute(
            'data-state',
            'unconfirmed'
        );
        expect(refreshCalls).toEqual([]);

        // The server comes back: retry revokes for real.
        await page.unroute('**/api/auth/logout');
        await page.getByTestId('logout-notice').getByRole('button').click();
        await expect(page.getByTestId('logout-notice')).toHaveAttribute(
            'data-state',
            'confirmed'
        );
        await page.reload();
        await expect(page.locator('.auth-page')).toBeVisible();
        await expect(page.getByTestId('logout-notice')).toHaveCount(0);
    });
});
