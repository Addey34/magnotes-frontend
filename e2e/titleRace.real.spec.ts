// MGN-DATA-RA-01 — R-A: a title typed while the creation POST is still in
// flight must survive. Real local API + throw-away MongoDB, synthetic data.
// Persistence is asserted against MongoDB (mongosh), never against the UI.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const enabled = process.env.E2E_REAL_API === '1';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8125';
const MONGO = process.env.E2E_MONGO_CONTAINER || 'magnotes-ra01-mongo';
const DBNAME = process.env.E2E_DB || 'MagNotesData01';
const PASSWORD = 'StrongPassword123!';

const dbCard = (title: string) =>
    JSON.parse(
        execFileSync(
            'docker',
            [
                'exec',
                MONGO,
                'mongosh',
                '--quiet',
                DBNAME,
                '--eval',
                `JSON.stringify(db.PostIts.find({title:${JSON.stringify(title)}},{title:1,content:1,_id:0}).toArray())`,
            ],
            { encoding: 'utf8' }
        ).trim()
    ) as Array<{ title: string; content: string }>;
async function verificationCode(email: string): Promise<string> {
    const search = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    const { messages = [] } = (await search.json()) as {
        messages?: Array<{ ID: string }>;
    };
    if (!messages[0]) throw new Error('mail not yet received');
    const msg = await (
        await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`)
    ).json();
    const code = String(msg.Text ?? '').match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('no code');
    return code;
}
async function signup(page: Page, email: string) {
    await page.goto('/app/');
    await expect(page.locator('.auth-page')).toBeVisible();
    await page.locator('.auth-switch button').click();
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirm-password').fill(PASSWORD);
    await page.locator('.auth-submit').click();
    const code = page.locator('input[autocomplete="one-time-code"]');
    await expect(code).toBeVisible();
    await expect
        .poll(() => verificationCode(email).catch(() => ''), {
            timeout: 15_000,
        })
        .toMatch(/^\d{6}$/);
    await code.fill(await verificationCode(email));
    await page.locator('.auth-submit').click();
    await expect(page.locator('.board-app')).toBeVisible();
}

test.describe('R-A — title typed while the creation POST is in flight', () => {
    test.skip(!enabled, 'needs E2E_REAL_API=1 and the local stack');
    const RUNS = Number(process.env.RA_RUNS || 3);
    for (const delay of (process.env.RA_DELAYS || '0,400,1500')
        .split(',')
        .map(Number)) {
        for (let n = 1; n <= RUNS; n++) {
            test(`POST delayed ${delay}ms — run ${n}`, async ({
                page,
            }, info) => {
                await signup(
                    page,
                    `ra01-${delay}-${n}-${info.project.name}-${Date.now()}@example.test`
                );
                if (delay)
                    await page.route('**/api/postits', async (route) => {
                        if (route.request().method() === 'POST')
                            await new Promise((r) => setTimeout(r, delay));
                        await route.continue();
                    });
                const cards = page.locator('.post-it-card');
                const before = await cards.count();
                await page.locator('.create-card-button').click();
                await expect(cards).toHaveCount(before + 1);
                const card = cards.last();
                // The board may enter edit mode on its own at the same moment.
                if (
                    !(await card.evaluate((el) =>
                        el.classList.contains('is-editing')
                    ))
                )
                    await card
                        .getByRole('button', {
                            name: /^(edit card|modifier la carte)$/i,
                        })
                        .dispatchEvent('click', {}, { timeout: 2000 })
                        .catch(() => undefined);
                await expect(card).toHaveClass(/is-editing/);
                const title = `RA-${delay}-${n}-${Date.now() % 100000}`;
                const content = `Body ${title}`;
                await card.locator('.post-it-title').fill(title);
                await card.locator('.post-it-content').fill(content);
                await card.locator('.post-it-content').blur();
                await expect
                    .poll(() => dbCard(title).length, { timeout: 20_000 })
                    .toBe(1);
                await page.waitForTimeout(1500);
                const rows = dbCard(title);
                expect(rows.map((r) => r.content)).toEqual([content]);
                await expect(card.locator('.post-it-title')).toHaveValue(title);
                await page.reload();
                await expect(page.locator('.board-app')).toBeVisible();
                await expect(page.locator('.post-it-title').last()).toHaveValue(
                    title
                );
            });
        }
    }
});
