// R-A (focus race): text typed in the title of a freshly created card must
// stay in the title. The interaction is real: pointer clicks move the focus and
// the keyboard types into whatever element owns it, so a focus stolen by the
// editor sends the characters to the wrong field (locator.fill() focuses the
// field itself and would hide the defect).
//
// Persistence is asserted in MongoDB. Run it with `pnpm run e2e:real:focus`
// against a local isolated stack (see playwright.real-focus.config.ts).
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PASSWORD = 'StrongPassword123!';
const env = (name: string): string => process.env[name] ?? '';
const loopback = (url: string): boolean =>
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);

const mongosh = (expression: string): string =>
    execFileSync(
        'docker',
        [
            'exec',
            env('E2E_MONGO_CONTAINER'),
            'mongosh',
            '--quiet',
            env('E2E_DB'),
            '--eval',
            expression,
        ],
        { encoding: 'utf8' }
    ).trim();

/** Refuse to create accounts or query a database unless the stack is isolated. */
function assertIsolatedStack(baseURL: string | undefined): void {
    const missing = [
        'E2E_REAL_API',
        'E2E_ISOLATED_STACK',
        'E2E_MONGO_CONTAINER',
        'E2E_DB',
        'E2E_MAILPIT_URL',
    ].filter((name) => !env(name));
    if (missing.length)
        throw new Error(
            `Isolated stack not declared: set ${missing.join(', ')}`
        );
    if (env('E2E_REAL_API') !== '1' || env('E2E_ISOLATED_STACK') !== '1')
        throw new Error('E2E_REAL_API and E2E_ISOLATED_STACK must be "1".');
    if (!baseURL || !loopback(baseURL) || !loopback(env('E2E_MAILPIT_URL')))
        throw new Error('The app and the mailbox must be on a loopback host.');
    if (!/e2e|test|ra01|isolated|data01/i.test(env('E2E_DB')))
        throw new Error('E2E_DB must be an explicitly throw-away database.');
    const ports = JSON.parse(
        execFileSync(
            'docker',
            [
                'inspect',
                '-f',
                '{{json .NetworkSettings.Ports}}',
                env('E2E_MONGO_CONTAINER'),
            ],
            { encoding: 'utf8' }
        )
    ) as Record<string, Array<{ HostIp: string }> | null>;
    for (const bindings of Object.values(ports))
        for (const binding of bindings ?? [])
            if (binding.HostIp !== '127.0.0.1')
                throw new Error('MongoDB must only be published on 127.0.0.1.');
    const foreign = mongosh(
        'db.Users.countDocuments({email: {$not: /@example\\.test$/}})'
    );
    if (foreign !== '0')
        throw new Error('The database holds non-synthetic accounts: refusing.');
}

const dbCards = (title: string) =>
    JSON.parse(
        mongosh(
            `JSON.stringify(db.PostIts.find({title:${JSON.stringify(title)}},{title:1,content:1,_id:0}).toArray())`
        )
    ) as Array<{ title: string; content: string }>;

async function verificationCode(email: string): Promise<string> {
    const base = env('E2E_MAILPIT_URL');
    const search = await fetch(
        `${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    const { messages = [] } = (await search.json()) as {
        messages?: Array<{ ID: string }>;
    };
    if (!messages[0]) throw new Error('mail not yet received');
    const msg = await (
        await fetch(`${base}/api/v1/message/${messages[0].ID}`)
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

test.describe('R-A — title typed with the keyboard right after creating a card', () => {
    const RUNS = Number(process.env.RA_RUNS || 1);
    for (const delay of (process.env.RA_DELAYS || '0,600')
        .split(',')
        .map(Number)) {
        for (let n = 1; n <= RUNS; n++) {
            test(`POST delayed ${delay}ms — run ${n}`, async ({
                page,
            }, info) => {
                assertIsolatedStack(info.project.use.baseURL);
                await signup(
                    page,
                    `focus-${delay}-${n}-${info.project.name}-${Date.now()}@example.test`
                );
                if (delay)
                    await page.route('**/api/postits', async (route) => {
                        if (route.request().method() === 'POST')
                            await new Promise((r) => setTimeout(r, delay));
                        await route.continue();
                    });
                // The tap on the title lands while the card is mounting, before
                // React runs the edit-mode effects (what a fast user does on a
                // slow device). The observer only moves the real focus; every
                // character below is typed with the keyboard into whichever
                // element owns the focus at that moment.
                await page.evaluate(() => {
                    new MutationObserver((records) => {
                        for (const record of records)
                            for (const node of record.addedNodes) {
                                const title = (
                                    node as HTMLElement
                                ).querySelector?.<HTMLInputElement>(
                                    '.post-it-title'
                                );
                                title?.focus();
                            }
                    }).observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                });
                const cards = page.locator('.post-it-card');
                const before = await cards.count();
                await page.locator('.create-card-button').click();
                await expect(cards).toHaveCount(before + 1);
                const card = cards.last();
                const title = `RA-${delay}-${n}-${Date.now() % 100000}`;
                const content = `Body ${title}`;
                await page.keyboard.press('ControlOrMeta+A');
                await page.keyboard.type(title);
                await card.locator('.post-it-content').click();
                await page.keyboard.type(content);
                await card.locator('.post-it-content').blur();
                await expect
                    .poll(() => dbCards(title).length, { timeout: 20_000 })
                    .toBe(1);
                await page.waitForTimeout(1500);
                expect(dbCards(title).map((r) => r.content)).toEqual([content]);
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
