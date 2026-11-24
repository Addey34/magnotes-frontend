import {
    expect,
    test,
    type APIRequestContext,
    type Page,
} from '@playwright/test';

// The welcome board is seeded only for a sign-up confirmed in this tab, and
// at most once. Proven against the isolated real stack: an existing account
// (even with an empty, just-created "Maison" board) is never seeded, nor is
// a reload or a second tab of a new account.

const enabled = process.env.E2E_REAL_API === '1';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:5500';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025';
const PASSWORD = 'StrongPassword123!';

async function verificationCode(email: string): Promise<string> {
    const search = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    const { messages = [] } = (await search.json()) as {
        messages?: Array<{ ID: string }>;
    };
    if (!messages[0]) throw new Error('Verification email not arrived yet.');
    const message = await fetch(
        `${mailpitUrl}/api/v1/message/${messages[0].ID}`
    );
    const { Text = '' } = (await message.json()) as { Text?: string };
    const code = Text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('Verification code not found.');
    return code;
}

async function waitForCode(email: string): Promise<string> {
    await expect
        .poll(() => verificationCode(email).catch(() => ''), {
            timeout: 15_000,
        })
        .toMatch(/^\d{6}$/);
    return verificationCode(email);
}

// Server truth: every board and how many cards each holds.
async function serverState(request: APIRequestContext, email: string) {
    const login = await request.post(`${apiUrl}/api/auth/login`, {
        data: { email, password: PASSWORD },
    });
    const { token } = (await login.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    const tabs = (await (
        await request.get(`${apiUrl}/api/tabs`, { headers })
    ).json()) as Array<{ _id: string; name: string }>;
    let cards = 0;
    for (const tab of tabs) {
        const list = (await (
            await request.get(`${apiUrl}/api/postits?tabId=${tab._id}`, {
                headers,
            })
        ).json()) as unknown[];
        cards += list.length;
    }
    return { boards: tabs.map((tab) => tab.name), cards };
}

async function signInUi(page: Page, email: string) {
    await page.goto('/app/');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('.auth-submit').click();
    await expect(page.locator('.board-app')).toBeVisible();
}

test.describe('welcome board seeding', () => {
    test.skip(!enabled, 'Set E2E_REAL_API=1 with the isolated local stack.');
    test.setTimeout(120_000);

    test('an existing account with a fresh empty Maison board is not seeded', async ({
        page,
        request,
    }, testInfo) => {
        // Account created and verified outside this browser tab.
        const email = `existing-${testInfo.project.name}-${Date.now()}@example.test`;
        await request.post(`${apiUrl}/api/auth/register`, {
            data: { email, password: PASSWORD },
        });
        const code = await waitForCode(email);
        await request.post(`${apiUrl}/api/auth/verify`, {
            data: { email, code },
        });
        // The API creates its default board on this first listing.
        expect(await serverState(request, email)).toEqual({
            boards: ['Maison'],
            cards: 0,
        });

        await signInUi(page, email);
        await expect(page.locator('.board-tab-name').first()).toHaveText(
            'Maison'
        );
        // Give a would-be seed every chance to run, then read the server.
        await page.waitForTimeout(3_000);
        await expect(page.locator('.post-it-card')).toHaveCount(0);
        await page.reload();
        await expect(page.locator('.board-app')).toBeVisible();
        await page.waitForTimeout(2_000);
        expect(await serverState(request, email)).toEqual({
            boards: ['Maison'],
            cards: 0,
        });
    });

    test('a new account is seeded once: not again on reload or in a second tab', async ({
        page,
        context,
        request,
    }, testInfo) => {
        const email = `seed-${testInfo.project.name}-${Date.now()}@example.test`;
        await page.goto('/app/');
        await page.locator('.auth-switch button').click();
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(PASSWORD);
        await page.locator('#confirm-password').fill(PASSWORD);
        await page.locator('.auth-submit').click();
        const codeInput = page.locator('input[autocomplete="one-time-code"]');
        await expect(codeInput).toBeVisible();
        await codeInput.fill(await waitForCode(email));
        await page.locator('.auth-submit').click();
        await expect(page.locator('.post-it-card')).toHaveCount(6, {
            timeout: 15_000,
        });

        // A second tab of the same session, then a reload of the first.
        const second = await context.newPage();
        await second.goto('/app/');
        await expect(second.locator('.board-app')).toBeVisible();
        await page.reload();
        await expect(page.locator('.board-app')).toBeVisible();
        await page.waitForTimeout(3_000);
        await expect(second.locator('.post-it-card')).toHaveCount(6);
        await expect(page.locator('.post-it-card')).toHaveCount(6);
        const state = await serverState(request, email);
        expect(state.cards).toBe(6);
        expect(state.boards).toHaveLength(1);
        expect(state.boards[0]).not.toBe('Maison');
    });
});
