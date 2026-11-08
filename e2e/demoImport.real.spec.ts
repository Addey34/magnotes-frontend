import { expect, test, type Page } from '@playwright/test';

// Cross frontend/backend check of the demo → account import against the real
// API (PUT /api/imports/:importId). Needs the API; the account comes either
// from Mailpit (CI) or from E2E_SEEDED_EMAIL / E2E_SEEDED_PASSWORD.
const enabled = process.env.E2E_REAL_API === '1';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:5500';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025';
const DEMO_KEY = 'magnotes-demo-board-v1';
const IMPORT_KEY = 'magnotes-demo-import-v1';

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

async function accountCredentials(testName: string) {
    const seededEmail = process.env.E2E_SEEDED_EMAIL;
    if (seededEmail) {
        return {
            seeded: true,
            // One seeded account per test so assertions never see leftovers.
            email: seededEmail.replace('@', `+${testName}@`),
            password: process.env.E2E_SEEDED_PASSWORD || '',
        };
    }
    return {
        seeded: false,
        email: `e2e-import-${testName}-${Date.now()}@example.test`,
        password: 'StrongPassword123!',
    };
}

async function authenticateFromDemo(
    page: Page,
    creds: Awaited<ReturnType<typeof accountCredentials>>
) {
    await page.locator('.demo-banner__cta').click();
    await expect(page.locator('.auth-page')).toBeVisible();
    if (creds.seeded) {
        await page.locator('#email').fill(creds.email);
        await page.locator('#password').fill(creds.password);
        await page.locator('.auth-submit').click();
        return;
    }
    await page.locator('.auth-switch button').click();
    await page.locator('#email').fill(creds.email);
    await page.locator('#password').fill(creds.password);
    await page.locator('#confirm-password').fill(creds.password);
    await page.locator('.auth-submit').click();
    const codeInput = page.locator('input[autocomplete="one-time-code"]');
    await expect(codeInput).toBeVisible();
    await expect
        .poll(() => verificationCode(creds.email), { timeout: 10_000 })
        .toMatch(/^\d{6}$/);
    await codeInput.fill(await verificationCode(creds.email));
    await page.locator('.auth-submit').click();
}

async function serverTabNames(
    page: Page,
    creds: Awaited<ReturnType<typeof accountCredentials>>
): Promise<string[]> {
    const login = await page.request.post(`${apiUrl}/api/auth/login`, {
        data: { email: creds.email, password: creds.password },
    });
    const { token } = (await login.json()) as { token: string };
    const tabs = await page.request.get(`${apiUrl}/api/tabs`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return ((await tabs.json()) as Array<{ name: string }>).map((t) => t.name);
}

const localDemoTabs = (page: Page) =>
    page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw).tabs?.length ?? 0) : 0;
    }, DEMO_KEY);

// The server performs the whole import but the response never reaches the page.
async function loseFirstImportResponse(page: Page) {
    let calls = 0;
    await page.route('**/api/imports/*', async (route) => {
        calls += 1;
        if (calls === 1) {
            await route.fetch();
            await route.abort('failed');
            return;
        }
        await route.continue();
    });
    return () => calls;
}

test.describe('real demo import', () => {
    test.skip(!enabled, 'Set E2E_REAL_API=1 after starting the local API.');

    test('lost response: data stays local, retry creates no duplicate', async ({
        page,
    }, testInfo) => {
        const creds = await accountCredentials(
            `retry-${testInfo.project.name}`
        );
        await page.goto('/app/?demo=1');
        await expect(page.locator('.demo-banner')).toBeVisible();
        // The sandbox is seeded asynchronously after the banner shows.
        await expect.poll(() => localDemoTabs(page)).toBeGreaterThan(0);
        const demoTabs = await localDemoTabs(page);

        const calls = await loseFirstImportResponse(page);
        await authenticateFromDemo(page, creds);

        const banner = page.getByTestId('demo-import-banner');
        await expect(banner).toHaveAttribute('data-state', 'failed');
        await expect(page.locator('.board-app')).toBeVisible();
        // Login worked and nothing local was discarded.
        expect(await localDemoTabs(page)).toBe(demoTabs);
        expect(
            await page.evaluate((k) => localStorage.getItem(k), IMPORT_KEY)
        ).not.toBeNull();
        await expect(banner).toBeInViewport();
        await page.screenshot({
            path: testInfo.outputPath('banner-failed.png'),
        });

        await banner.getByRole('button').first().click();
        await expect(banner).toHaveCount(0);

        expect(calls()).toBe(2);
        expect(await localDemoTabs(page)).toBe(0);
        expect(
            await page.evaluate((k) => localStorage.getItem(k), IMPORT_KEY)
        ).toBeNull();
        expect(await serverTabNames(page, creds)).toHaveLength(demoTabs);
    });

    test('reload after a failed import resumes it automatically', async ({
        page,
    }, testInfo) => {
        const creds = await accountCredentials(
            `reload-${testInfo.project.name}`
        );
        await page.goto('/app/?demo=1');
        await expect(page.locator('.demo-banner')).toBeVisible();
        // The sandbox is seeded asynchronously after the banner shows.
        await expect.poll(() => localDemoTabs(page)).toBeGreaterThan(0);
        const demoTabs = await localDemoTabs(page);
        await loseFirstImportResponse(page);
        await authenticateFromDemo(page, creds);
        await expect(page.getByTestId('demo-import-banner')).toHaveAttribute(
            'data-state',
            'failed'
        );

        await page.reload();

        await expect(page.locator('.board-app')).toBeVisible();
        await expect(page.getByTestId('demo-import-banner')).toHaveCount(0);
        await expect.poll(() => localDemoTabs(page)).toBe(0);
        expect(await serverTabNames(page, creds)).toHaveLength(demoTabs);
    });
});
