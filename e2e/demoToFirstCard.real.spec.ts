import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The whole acquisition journey against the real API: demo -> sign-up (email
// code) -> demo import -> first card created in the account -> still there
// after a reload. Needs the isolated stack (API + MongoDB + Mailpit), see
// demoImport.real.spec.ts. Runs in French and English.
const enabled = process.env.E2E_REAL_API === '1';
const apiUrl = process.env.VITE_API_URL || 'http://127.0.0.1:5500';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025';

test.skip(!enabled, 'Needs the isolated real stack (E2E_REAL_API=1).');

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

async function accountCardTitles(
    page: Page,
    email: string,
    password: string
): Promise<string[]> {
    const login = await page.request.post(`${apiUrl}/api/auth/login`, {
        data: { email, password },
    });
    const { token } = (await login.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    const tabs = (await (
        await page.request.get(`${apiUrl}/api/tabs`, { headers })
    ).json()) as Array<{ _id: string }>;
    const titles: string[] = [];
    for (const tab of tabs) {
        const cards = (await (
            await page.request.get(`${apiUrl}/api/postits?tabId=${tab._id}`, {
                headers,
            })
        ).json()) as Array<{ title: string }>;
        titles.push(...cards.map((c) => c.title));
    }
    return titles;
}

const visibleTitles = (page: Page) =>
    page
        .locator('.post-it-card .post-it-title')
        .evaluateAll((nodes) =>
            nodes.map(
                (n) => (n as HTMLInputElement).value ?? n.textContent ?? ''
            )
        );

const expectNoBlockingAccessibilityIssues = async (page: Page) => {
    const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
    expect(
        results.violations.filter((v) =>
            ['serious', 'critical'].includes(v.impact ?? '')
        )
    ).toEqual([]);
};

const COPY = {
    fr: { notice: 'vos notes de démo seront conservées' },
    en: { notice: 'your demo notes will be kept' },
} as const;

test.describe('real journey: demo to first card', () => {
    test.skip(
        !!process.env.E2E_SEEDED_EMAIL,
        'Needs a fresh account (sign-up).'
    );

    for (const lang of ['fr', 'en'] as const) {
        test(`demo, sign-up, import, first card persisted (${lang})`, async ({
            page,
        }, testInfo) => {
            const email = `e2e-journey-${lang}-${testInfo.project.name}-${Date.now()}@example.test`;
            const password = 'StrongPassword123!';
            const demoTitle = `Demo card ${lang}`;
            const firstTitle = `First real card ${lang}`;

            await page.addInitScript(() => {
                const calls: unknown[][] = [];
                (window as unknown as { __calls: unknown[][] }).__calls = calls;
                (window as unknown as { umami: unknown }).umami = {
                    track: (...args: unknown[]) => calls.push(args),
                };
            });

            // 1. A card in the demo, then straight to sign-up (no pause: the
            // last edit must survive leaving the sandbox).
            await page.goto(`/app/?demo=1&lang=${lang}`);
            const cards = page.locator('.post-it-card');
            await expect(cards).toHaveCount(6);
            await page.locator('.create-card-button').click();
            await expect(cards).toHaveCount(7);
            await cards.last().locator('.post-it-title').fill(demoTitle);
            await page.locator('.demo-banner__cta').click();

            // 2. The sign-up screen says the notes come along.
            await expect(page.locator('#confirm-password')).toBeVisible();
            await expect(page.locator('.auth-header p')).toContainText(
                COPY[lang].notice
            );
            await expectNoBlockingAccessibilityIssues(page);

            // 3. Sign-up with the emailed code.
            await page.locator('#email').fill(email);
            await page.locator('#password').fill(password);
            await page.locator('#confirm-password').fill(password);
            await page.locator('.auth-submit').click();
            const codeInput = page.locator(
                'input[autocomplete="one-time-code"]'
            );
            await expect(codeInput).toBeVisible();
            await expect
                .poll(() => verificationCode(email), { timeout: 10_000 })
                .toMatch(/^\d{6}$/);
            await codeInput.fill(await verificationCode(email));
            await page.locator('.auth-submit').click();

            // 4. The import completed: seven notes, the demo one included.
            const banner = page.getByTestId('demo-import-banner');
            await expect(banner).toHaveAttribute('data-state', 'done');
            await expect(page.locator('.board-app')).toBeVisible();
            await expect
                .poll(async () =>
                    (await accountCardTitles(page, email, password)).includes(
                        demoTitle
                    )
                )
                .toBe(true);
            expect(
                (await accountCardTitles(page, email, password)).length
            ).toBe(7);

            // 5. The first real card is saved by the API...
            const before = await cards.count();
            await page.locator('.create-card-button').click();
            await expect(cards).toHaveCount(before + 1);
            await cards.last().locator('.post-it-title').fill(firstTitle);
            await expect
                .poll(async () =>
                    (await accountCardTitles(page, email, password)).includes(
                        firstTitle
                    )
                )
                .toBe(true);

            // Events so far: names only, nothing personal, nothing from notes.
            const calls = await page.evaluate(
                () => (window as unknown as { __calls: unknown[][] }).__calls
            );
            const names = calls.map((c) => c[0]);
            for (const expected of [
                'demo_card_created',
                'demo_signup_cta_clicked',
                'signup_registered',
                'email_verified',
                'demo_import_started',
                'demo_import_completed',
                'card_created',
            ]) {
                expect(names, `event ${expected}`).toContain(expected);
            }
            expect(calls.every((c) => c.length === 1)).toBe(true);
            const serialized = JSON.stringify(calls);
            for (const secret of [email, password, demoTitle, firstTitle]) {
                expect(serialized).not.toContain(secret);
            }

            // 6. ...and still there after a reload.
            await page.reload();
            await expect(page.locator('.board-app')).toBeVisible();
            await expect.poll(() => visibleTitles(page)).toContain(firstTitle);
            await expectNoBlockingAccessibilityIssues(page);
            const overflow = await page.evaluate(
                () =>
                    document.documentElement.scrollWidth -
                    document.documentElement.clientWidth
            );
            expect(overflow).toBeLessThanOrEqual(0);
        });
    }
});
