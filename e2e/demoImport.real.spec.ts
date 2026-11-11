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

// Everything the visitor wrote or styled, compared field by field. Ids,
// tabId and timestamps legitimately differ between the sandbox and the account.
type CardContent = {
    title: string;
    content: string;
    color: string;
    textColor: string;
    textSize: number;
    fontFamily: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    status?: string;
    priority?: string;
    tags?: string[];
};

const contentOf = (c: CardContent): CardContent => ({
    title: c.title,
    content: c.content,
    color: c.color,
    textColor: c.textColor,
    textSize: c.textSize,
    fontFamily: c.fontFamily,
    x: c.x,
    y: c.y,
    width: c.width,
    height: c.height,
    rotation: c.rotation,
    ...(c.status ? { status: c.status } : {}),
    ...(c.priority ? { priority: c.priority } : {}),
    ...(c.tags && c.tags.length > 0 ? { tags: c.tags } : {}),
});

const byTitle = (a: CardContent, b: CardContent) =>
    a.title.localeCompare(b.title);

type ServerBoard = {
    id: string;
    name: string;
    order: number;
    cards: CardContent[];
    allCardsOnThisBoard: boolean;
};

// Per-board content straight from the API: notes are listed per tabId, so a
// board that exists but holds no note is visible here (the tab count alone is not).
async function serverBoards(
    page: Page,
    creds: Awaited<ReturnType<typeof accountCredentials>>
): Promise<ServerBoard[]> {
    const login = await page.request.post(`${apiUrl}/api/auth/login`, {
        data: { email: creds.email, password: creds.password },
    });
    const { token } = (await login.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    const tabs = (await (
        await page.request.get(`${apiUrl}/api/tabs`, { headers })
    ).json()) as Array<{ _id: string; name: string; order: number }>;
    const boards: ServerBoard[] = [];
    for (const tab of tabs) {
        const cards = (await (
            await page.request.get(`${apiUrl}/api/postits?tabId=${tab._id}`, {
                headers,
            })
        ).json()) as Array<CardContent & { tabId: string }>;
        boards.push({
            id: tab._id,
            name: tab.name,
            order: tab.order,
            cards: cards.map(contentOf).sort(byTitle),
            allCardsOnThisBoard: cards.every((c) => c.tabId === tab._id),
        });
    }
    return boards;
}

const localDemoCards = async (page: Page): Promise<CardContent[]> => {
    const raw = await page.evaluate(
        (key) => localStorage.getItem(key),
        DEMO_KEY
    );
    const cards = raw
        ? (JSON.parse(raw).postIts as CardContent[]).map(contentOf)
        : [];
    return cards.sort(byTitle);
};

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
        const demoCards = await localDemoCards(page);
        expect(demoCards).toHaveLength(6);
        // The synthetic sandbox really carries text, not just titles.
        expect(demoCards.every((c) => c.title && c.content)).toBe(true);

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
        // The retry is confirmed to the visitor, with the number of notes.
        await expect(banner).toHaveAttribute('data-state', 'done');
        await expect(banner).toContainText(/6/);

        expect(calls()).toBe(2);
        expect(await localDemoTabs(page)).toBe(0);
        expect(
            await page.evaluate((k) => localStorage.getItem(k), IMPORT_KEY)
        ).toBeNull();
        expect(await serverTabNames(page, creds)).toHaveLength(demoTabs);
        // The six notes really reached the account, on the imported board,
        // exactly once (the replayed request created no duplicate).
        const boards = await serverBoards(page, creds);
        expect(boards).toHaveLength(demoTabs);
        const imported = boards.filter((b) => b.cards.length > 0);
        expect(imported).toHaveLength(1);
        expect(imported[0].cards).toEqual(demoCards);
        expect(imported[0].allCardsOnThisBoard).toBe(true);
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
        await expect(page.getByTestId('demo-import-banner')).toHaveAttribute(
            'data-state',
            'done'
        );
        await expect.poll(() => localDemoTabs(page)).toBe(0);
        expect(await serverTabNames(page, creds)).toHaveLength(demoTabs);
    });

    test('existing account with several boards: the imported board opens with all six notes', async ({
        page,
        browser,
    }, testInfo) => {
        const creds = await accountCredentials(
            `existing-${testInfo.project.name}`
        );
        test.skip(creds.seeded, 'Needs a fresh account to create boards.');

        // 1. A real account that already owns two boards.
        const setup = await browser.newContext();
        const setupPage = await setup.newPage();
        await setupPage.goto('/app/');
        await setupPage.locator('.auth-switch button').click();
        await setupPage.locator('#email').fill(creds.email);
        await setupPage.locator('#password').fill(creds.password);
        await setupPage.locator('#confirm-password').fill(creds.password);
        await setupPage.locator('.auth-submit').click();
        const codeInput = setupPage.locator(
            'input[autocomplete="one-time-code"]'
        );
        await expect(codeInput).toBeVisible();
        await expect
            .poll(() => verificationCode(creds.email), { timeout: 10_000 })
            .toMatch(/^\d{6}$/);
        await codeInput.fill(await verificationCode(creds.email));
        await setupPage.locator('.auth-submit').click();
        await expect(setupPage.locator('.board-app')).toBeVisible();
        const login = await setupPage.request.post(`${apiUrl}/api/auth/login`, {
            data: { email: creds.email, password: creds.password },
        });
        const { token } = (await login.json()) as { token: string };
        await setupPage.request.post(`${apiUrl}/api/tabs`, {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                name: 'Existing second board',
                color: '#38bdf8',
                icon: '📝',
            },
        });
        const before = await serverBoards(setupPage, creds);
        expect(before.length).toBeGreaterThanOrEqual(2);
        await setup.close();

        // 2. A guest demo with six notes, then login to that existing account.
        await page.goto('/app/?demo=1');
        await expect(page.locator('.demo-banner')).toBeVisible();
        await expect.poll(() => localDemoTabs(page)).toBeGreaterThan(0);
        const demoCards = await localDemoCards(page);
        expect(demoCards).toHaveLength(6);
        // The synthetic sandbox really carries text, not just titles.
        expect(demoCards.every((c) => c.title && c.content)).toBe(true);
        await page.locator('.demo-banner__cta').click();
        await expect(page.locator('.auth-page')).toBeVisible();
        await page.locator('#email').fill(creds.email);
        await page.locator('#password').fill(creds.password);
        await page.locator('.auth-submit').click();

        // 3. Confirmation with the count, then the imported board is the one open.
        const banner = page.getByTestId('demo-import-banner');
        await expect(banner).toHaveAttribute('data-state', 'done');
        await expect(banner).toContainText(/6/);
        await expect(page.locator('.board-app')).toBeVisible();
        await expect(banner).toBeInViewport();
        await expect.poll(() => localDemoTabs(page)).toBe(0);

        const boards = await serverBoards(page, creds);
        expect(boards).toHaveLength(before.length + 1);
        const importedBoard = boards.find(
            (b) => !before.some((old) => old.id === b.id)
        )!;
        // Notes, full contents and ownership: all six, on the new board only.
        expect(importedBoard.cards).toEqual(demoCards);
        expect(importedBoard.allCardsOnThisBoard).toBe(true);
        // Existing boards were not touched.
        for (const old of before) {
            expect(boards.find((b) => b.id === old.id)?.cards).toEqual(
                old.cards
            );
        }
        // The open board is the imported one (shown name + visible cards).
        await expect(page.locator('.board-title')).toContainText(
            importedBoard.name
        );
        await expect(page.locator('.post-it-surface-glow')).toHaveCount(6);
        await page.screenshot({
            path: testInfo.outputPath('imported-board-open.png'),
        });
    });

    test('an orphan card is reported and the local copy is kept', async ({
        page,
    }, testInfo) => {
        const creds = await accountCredentials(
            `orphan-${testInfo.project.name}`
        );
        await page.goto('/app/?demo=1');
        await expect(page.locator('.demo-banner')).toBeVisible();
        await expect.poll(() => localDemoTabs(page)).toBeGreaterThan(0);
        // Corrupt the sandbox: a card pointing at a board that does not exist.
        await page.evaluate((key) => {
            const store = JSON.parse(localStorage.getItem(key) as string);
            store.postIts.push({
                ...store.postIts[0],
                _id: 'orphan-card',
                tabId: 'ghost-tab',
            });
            localStorage.setItem(key, JSON.stringify(store));
        }, DEMO_KEY);
        const demoTabs = await localDemoTabs(page);

        await authenticateFromDemo(page, creds);

        const banner = page.getByTestId('demo-import-banner');
        await expect(banner).toHaveAttribute('data-state', 'partial');
        await expect(page.locator('.board-app')).toBeVisible();
        await expect(banner).toBeInViewport();
        await page.screenshot({
            path: testInfo.outputPath('banner-partial.png'),
        });
        // Nothing local was discarded; the importable part is in the account.
        expect(await localDemoTabs(page)).toBe(demoTabs);
        expect(await serverTabNames(page, creds)).toHaveLength(demoTabs);

        await banner.getByRole('button', { name: /keep|garder/i }).click();
        await expect(banner).toHaveCount(0);
        expect(await localDemoTabs(page)).toBe(demoTabs);
    });
});
