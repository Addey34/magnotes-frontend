import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Proves, against the isolated real stack, the landing promises that had no
// end-to-end evidence yet: Trello / Notion / Markdown import into an account,
// Markdown export, a read-only public link, and account deletion that really
// removes the data (the shared link dies with it). Synthetic data only.
//
// Needs the same stack as auth.real.spec.ts: E2E_REAL_API=1, the API behind
// Vite's /api proxy (VITE_API_URL) and Mailpit (E2E_MAILPIT_URL).

const enabled = process.env.E2E_REAL_API === '1';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025';
const PASSWORD = 'StrongPassword123!';

type MailpitSearch = { messages?: Array<{ ID: string }> };

async function verificationCode(email: string): Promise<string> {
    const search = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    const { messages = [] } = (await search.json()) as MailpitSearch;
    if (!messages[0]) throw new Error('Verification email not arrived yet.');
    const message = await fetch(
        `${mailpitUrl}/api/v1/message/${messages[0].ID}`
    );
    const { Text = '' } = (await message.json()) as { Text?: string };
    const code = Text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('Verification code not found.');
    return code;
}

async function signUp(page: Page, email: string) {
    await page.goto('/app/');
    await page.locator('.auth-switch button').click();
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirm-password').fill(PASSWORD);
    await page.locator('.auth-submit').click();
    const codeInput = page.locator('input[autocomplete="one-time-code"]');
    await expect(codeInput).toBeVisible();
    await expect
        .poll(() => verificationCode(email).catch(() => ''), {
            timeout: 15_000,
        })
        .toMatch(/^\d{6}$/);
    await codeInput.fill(await verificationCode(email));
    await page.locator('.auth-submit').click();
    await expect(page.locator('.board-app')).toBeVisible();
    // The welcome board is seeded on first sign-in.
    await expect(page.locator('.post-it-card')).toHaveCount(6, {
        timeout: 15_000,
    });
}

const menuItem = (page: Page, name: RegExp) =>
    page.locator('.board-brand-menu > button[role="menuitem"]', {
        hasText: name,
    });

async function openBrandMenu(page: Page) {
    await page.getByRole('button', { name: /MagNotes/ }).click();
    await expect(page.locator('.board-brand-menu')).toBeVisible();
}

async function importFile(
    page: Page,
    file: { name: string; mimeType: string; text: string }
) {
    await openBrandMenu(page);
    const chooser = page.waitForEvent('filechooser');
    await menuItem(page, /Importer|Import/).click();
    await (
        await chooser
    ).setFiles({
        name: file.name,
        mimeType: file.mimeType,
        buffer: Buffer.from(file.text, 'utf8'),
    });
}

async function cardTitles(page: Page): Promise<string[]> {
    return page
        .locator('.post-it-title')
        .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value)
        );
}

const LONG_TITLE = `Trello long ${'x'.repeat(110)}`;
const trelloBoard = {
    name: 'Synthetic Trello',
    lists: [
        { id: 'l1', name: 'En cours', pos: 1 },
        { id: 'l2', name: 'Done', pos: 2 },
    ],
    cards: [
        {
            id: 'c1',
            name: 'Trello alpha',
            desc: 'Synthetic description',
            idList: 'l1',
            pos: 1,
            // Real Trello exports carry a full timestamp.
            due: '2030-03-14T09:00:00.000Z',
            labels: [{ name: 'urgent' }],
        },
        {
            id: 'c2',
            name: LONG_TITLE,
            desc: 'y'.repeat(2600),
            idList: 'l2',
            pos: 2,
            labels: Array.from({ length: 15 }, (_, i) => ({ name: `L${i}` })),
        },
    ],
    checklists: [
        {
            idCard: 'c1',
            checkItems: [
                { name: 'Step one', state: 'complete', pos: 1 },
                { name: 'Step two', state: 'incomplete', pos: 2 },
            ],
        },
    ],
};

const notionCsv = [
    'Name,Status,Due,Tags,Description',
    'Notion one,In progress,2030-04-02,"alpha, beta","Line, with comma"',
    'Notion two,Done,,,Second row',
].join('\n');

const markdownFile = [
    '# Synthetic notes',
    '',
    '## Markdown card',
    '',
    '**Échéance :** 25/12/2030',
    '**Tags :** #md',
    '',
    'Hand-written note.',
    '',
    '- [ ] first step',
].join('\n');

type ExportedCard = {
    title: string;
    content: string;
    status?: string;
    dueDate?: string | null;
    tags?: string[];
    checklist?: { text: string; done: boolean }[];
};

test.describe('landing promises on the real stack', () => {
    test.skip(!enabled, 'Set E2E_REAL_API=1 with the isolated local stack.');
    test.setTimeout(180_000);

    for (const lang of ['fr', 'en'] as const) {
        test(`import, export, read-only share and real account deletion (${lang})`, async ({
            page,
            browser,
        }, testInfo) => {
            await page.addInitScript(
                (value) => localStorage.setItem('magnotes-lang', value),
                lang
            );
            const email = `promises-${lang}-${testInfo.project.name}-${Date.now()}@example.test`;
            await signUp(page, email);
            // The new account opens on the localized welcome board, not on an
            // empty board named "Maison".
            await expect(page.locator('.board-tab-name').first()).toHaveText(
                lang === 'fr' ? 'Bienvenue' : 'Welcome'
            );

            // --- Imports ----------------------------------------------------
            await importFile(page, {
                name: 'trello.json',
                mimeType: 'application/json',
                text: JSON.stringify(trelloBoard),
            });
            // The long card was shortened to fit the API: the result says so.
            await expect(
                page.locator('.app-notification', {
                    hasText:
                        /2 note\(s\) import.*1 (raccourcie\(s\)|shortened) /,
                })
            ).toBeVisible({ timeout: 20_000 });

            await importFile(page, {
                name: 'notion.csv',
                mimeType: 'text/csv',
                text: notionCsv,
            });
            await expect
                .poll(() => cardTitles(page), { timeout: 20_000 })
                .toEqual(expect.arrayContaining(['Notion one', 'Notion two']));

            await importFile(page, {
                name: 'notes.md',
                mimeType: 'text/markdown',
                text: markdownFile,
            });
            await expect
                .poll(() => cardTitles(page), { timeout: 20_000 })
                .toEqual(expect.arrayContaining(['Markdown card']));
            // "25/12/2030" cannot be stored as a day: reported, not hidden.
            await expect(
                page.locator('.app-notification', {
                    hasText:
                        /1 (échéance\(s\) au format non reconnu|due date\(s\) in an unrecognised format)/,
                })
            ).toBeVisible();

            // Partial success is reported with counts: the server refuses
            // one creation out of three (injected failure, real API for the
            // two others).
            let refused = false;
            await page.route('**/api/postits', async (route) => {
                if (route.request().method() === 'POST' && !refused) {
                    refused = true;
                    await route.fulfill({ status: 500, body: '{}' });
                    return;
                }
                await route.continue();
            });
            await importFile(page, {
                name: 'partial.md',
                mimeType: 'text/markdown',
                text: '## Part A\n\na\n\n## Part B\n\nb\n\n## Part C\n\nc',
            });
            await expect(
                page.locator('.app-notification', {
                    hasText: /2 note\(s\) sur 3|2 of 3 note\(s\)/,
                })
            ).toBeVisible({ timeout: 20_000 });
            await page.unroute('**/api/postits');

            // A file with nothing to import says so instead of doing nothing.
            await importFile(page, {
                name: 'empty.txt',
                mimeType: 'text/plain',
                text: '   \n',
            });
            await expect(
                page.locator('.app-notification', {
                    hasText: /Aucune note trouvée|No notes found/,
                })
            ).toBeVisible();

            // Persistence: reload (drops all client state), then read the server's
            // copy through the full export below. The DOM is not used for this:
            // off-screen cards are culled, so it only ever holds what is visible.
            await page.reload();
            await expect(page.locator('.board-app')).toBeVisible();
            await expect(page.locator('.post-it-card').first()).toBeVisible();

            // --- Full JSON export: field-level proof -------------------------
            await openBrandMenu(page);
            const jsonDownload = page.waitForEvent('download');
            await menuItem(page, /Exporter mes données|Export my data/).click();
            const jsonPath = await (await jsonDownload).path();
            if (!jsonPath) throw new Error('JSON export path unavailable.');
            const exported = JSON.parse(await readFile(jsonPath, 'utf8')) as {
                postIts: ExportedCard[];
            };
            const byTitle = (title: string) =>
                exported.postIts.find((card) => card.title === title);

            const alpha = byTitle('Trello alpha');
            expect(alpha).toMatchObject({
                status: 'doing',
                tags: ['urgent'],
                content: 'Synthetic description',
            });
            expect(alpha?.dueDate).toMatch(/^2030-03-1[34]$/);
            expect(
                alpha?.checklist?.map((item) => [item.text, item.done])
            ).toEqual([
                ['Step one', true],
                ['Step two', false],
            ]);
            const long = exported.postIts.find((card) =>
                card.title.startsWith('Trello long')
            );
            expect(long?.title).toHaveLength(80);
            expect(long?.content.length).toBe(2000);
            expect(long?.tags).toHaveLength(12);
            expect(long?.status).toBe('done');
            expect(byTitle('Notion one')).toMatchObject({
                status: 'doing',
                dueDate: '2030-04-02',
                tags: ['alpha', 'beta'],
                content: 'Line, with comma',
            });
            expect(byTitle('Notion two')).toMatchObject({ status: 'done' });
            const md = byTitle('Markdown card');
            expect(md).toMatchObject({ tags: ['md'] });
            expect(md?.dueDate ?? null).toBeNull();
            expect(md?.checklist?.[0]?.text).toBe('first step');
            // Welcome board seeded with relative due dates (Agenda not empty).
            expect(
                exported.postIts.filter((card) =>
                    /^\d{4}-\d{2}-\d{2}$/.test(card.dueDate ?? '')
                ).length
            ).toBeGreaterThanOrEqual(3);

            // --- Markdown export of the current board ------------------------
            await openBrandMenu(page);
            const mdDownload = page.waitForEvent('download');
            await menuItem(
                page,
                /Exporter en Markdown|Export as Markdown/
            ).click();
            const mdFile = await mdDownload;
            expect(mdFile.suggestedFilename()).toMatch(/\.md$/);
            const mdPath = await mdFile.path();
            if (!mdPath) throw new Error('Markdown export path unavailable.');
            const markdown = await readFile(mdPath, 'utf8');
            expect(markdown).toContain('## Trello alpha');
            expect(markdown).toContain('## Notion one');
            expect(markdown).toMatch(/- \[x\] Step one/);
            expect(markdown).toMatch(/#urgent/);

            // --- Read-only public link -----------------------------------------
            await openBrandMenu(page);
            await menuItem(page, /Partager|Share/).click();
            const shareDialog = page.locator('.share-dialog');
            await expect(shareDialog).toBeVisible();
            await shareDialog.locator('.share-dialog__enable').click();
            const shareUrl = await shareDialog
                .locator('.share-dialog__link input')
                .inputValue();
            await shareDialog.locator('.share-dialog__close').click();

            // A fresh context: no session cookie at all, like a client opening
            // the link.
            const visitor = await browser.newContext();
            const publicPage = await visitor.newPage();
            await publicPage.goto(shareUrl);
            const board = publicPage.locator('.public-board');
            await expect(board).toBeVisible();
            await expect(
                publicPage.getByRole('heading', { name: 'Trello alpha' })
            ).toBeVisible();
            expect(
                await board
                    .locator(
                        'input, textarea, select, [contenteditable="true"], .post-it-hover-tools'
                    )
                    .count()
            ).toBe(0);
            // Without the owner's session the API refuses any write.
            const writeStatus = await publicPage.evaluate(async () => {
                const response = await fetch('/api/postits', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'intrusion', content: '' }),
                });
                return response.status;
            });
            expect([401, 403]).toContain(writeStatus);

            // --- Account deletion removes the data ---------------------------
            await openBrandMenu(page);
            await page
                .locator(
                    '.board-brand-menu > button[role="menuitem"].is-danger'
                )
                .click();
            const deleteDialog = page.locator('.account-dialog');
            await expect(deleteDialog).toBeVisible();
            await deleteDialog
                .locator('input[autocomplete="current-password"]')
                .fill(PASSWORD);
            await deleteDialog.locator('button.is-danger').click();
            await expect(page.locator('.auth-page')).toBeVisible();

            // The shared board is gone with the account.
            await publicPage.reload();
            await expect(
                publicPage.locator('.public-board__notfound')
            ).toBeVisible();
            await visitor.close();

            // And the account cannot sign in any more.
            await page.locator('#email').fill(email);
            await page.locator('#password').fill(PASSWORD);
            await page.locator('.auth-submit').click();
            await expect(page.locator('.auth-message.is-error')).toBeVisible();
        });
    }
});
