import {
    expect,
    test,
    type Locator,
    type Page,
    type Route,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';

const enabled = process.env.E2E_REAL_API === '1';
const mailpitUrl = process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025';

type MailpitSearch = { messages?: Array<{ ID: string }> };
type MailpitMessage = { Text?: string };

async function verificationCode(email: string): Promise<string> {
    const search = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    if (!search.ok) throw new Error(`Mailpit search failed: ${search.status}`);
    const { messages = [] } = (await search.json()) as MailpitSearch;
    const message = messages[0];
    if (!message) throw new Error('Verification email has not arrived yet.');

    const response = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
    if (!response.ok)
        throw new Error(`Mailpit message failed: ${response.status}`);
    const { Text = '' } = (await response.json()) as MailpitMessage;
    const code = Text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('Verification code was not found in the email.');
    return code;
}

async function cardLeft(page: Page, title: string): Promise<number | null> {
    return page.locator('.post-it-card').evaluateAll((cards, cardTitle) => {
        const card = cards.find(
            (element) =>
                (element.querySelector('.post-it-title') as HTMLInputElement)
                    ?.value === cardTitle
        );
        return card?.getBoundingClientRect().x ?? null;
    }, title);
}

async function cardByTitle(page: Page, title: string): Promise<Locator> {
    const cards = page.locator('.post-it-card');
    const index = await cards.evaluateAll(
        (elements, cardTitle) =>
            elements.findIndex(
                (element) =>
                    (
                        element.querySelector(
                            '.post-it-title'
                        ) as HTMLInputElement
                    )?.value === cardTitle
            ),
        title
    );
    if (index < 0) throw new Error(`Card "${title}" was not found.`);
    return cards.nth(index);
}

async function setCardContent(
    page: Page,
    card: Locator,
    content: string
): Promise<void> {
    await card.hover();
    await card.locator('.post-it-hover-tools .icon-button').nth(3).click();
    const editor = page.locator('.card-detail-editor');
    await expect(editor).toBeVisible();
    await editor.fill(content);
    await page.locator('.card-detail-close').click();
}

test.describe('real local authentication', () => {
    test.skip(
        !enabled,
        'Set E2E_REAL_API=1 after starting the local API and Mailpit.'
    );

    test('registers, receives the email, verifies, and opens a board', async ({
        page,
    }, testInfo) => {
        const email = `e2e-${testInfo.project.name}-${Date.now()}@example.test`;
        const password = 'StrongPassword123!';

        await page.goto('/app/');
        await expect(page.locator('.auth-page')).toBeVisible();
        await page.locator('.auth-switch button').click();
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(password);
        await page.locator('#confirm-password').fill(password);
        await page.locator('.auth-submit').click();
        await expect(
            page.locator('input[autocomplete="one-time-code"]')
        ).toBeVisible();

        await expect
            .poll(() => verificationCode(email), { timeout: 10_000 })
            .toMatch(/^\d{6}$/);
        const signupCode = await verificationCode(email);
        await page
            .locator('input[autocomplete="one-time-code"]')
            .fill(signupCode === '000000' ? '999999' : '000000');
        await page.locator('.auth-submit').click();
        await expect(page.locator('.auth-message.is-error')).toBeVisible();
        await expect(
            page.locator('input[autocomplete="one-time-code"]')
        ).toBeVisible();
        await page
            .locator('input[autocomplete="one-time-code"]')
            .fill(signupCode);
        await page.locator('.auth-submit').click();

        await expect(page.locator('.board-app')).toBeVisible();

        const cards = page.locator('.post-it-card');
        const initialCardCount = await cards.count();
        let title = `E2E card ${testInfo.project.name}`;
        await page.locator('.create-card-button').click();
        await expect(cards).toHaveCount(initialCardCount + 1);

        const card = cards.last();
        await card.locator('.post-it-title').fill(title);
        await card
            .locator('.post-it-content')
            .fill('Created through the authenticated API flow.');
        await card.locator('.post-it-content').blur();
        await expect(card.locator('.post-it-title')).toHaveValue(title);
        // Text autosave is debounced in the UI; wait for its API write before
        // using reload as the persistence assertion below.
        await page.waitForTimeout(800);

        // A second session saves a newer revision. The original session must
        // receive a conflict instead of overwriting that change after its own
        // debounced edit is sent with an older expectedUpdatedAt value.
        const peerPage = await page.context().newPage();
        await peerPage.goto('/app/');
        await expect(peerPage.locator('.board-app')).toBeVisible();
        const peerContent = 'Saved by the second session.';
        await setCardContent(
            peerPage,
            await cardByTitle(peerPage, title),
            peerContent
        );
        await page.waitForTimeout(800);

        await setCardContent(
            page,
            card,
            'Stale content from the first session.'
        );
        await expect(
            page.locator('.app-notification[role="alert"]')
        ).toContainText(/changed elsewhere|modifiée ailleurs/i);
        await page.reload();
        await expect(page.locator('.board-app')).toBeVisible();
        await expect(cardByTitle(page, title)).resolves.toBeDefined();
        await expect(
            (await cardByTitle(page, title)).locator('.post-it-content')
        ).toContainText(peerContent);
        await peerPage.close();

        // A transient network failure keeps the local change queued. The
        // browser's online event must retry it with the current card version.
        let interruptedPatch = false;
        const interruptFirstPatch = async (route: Route) => {
            if (!interruptedPatch && route.request().method() === 'PATCH') {
                interruptedPatch = true;
                await route.abort('failed');
                return;
            }
            await route.continue();
        };
        await page.route('**/api/postits/**', interruptFirstPatch);
        const recoveredTitle = `Recovered ${testInfo.project.name}`;
        await (
            await cardByTitle(page, title)
        )
            .locator('.post-it-title')
            .fill(recoveredTitle);
        await expect(
            page.locator('.app-notification[role="alert"]').last()
        ).toContainText(/could not be saved|n’a pas pu être enregistrée/i);
        expect(interruptedPatch).toBe(true);
        await page.unroute('**/api/postits/**', interruptFirstPatch);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect
            .poll(async () => {
                const recoveredCard = await cardByTitle(page, recoveredTitle);
                return recoveredCard.locator('.post-it-title').inputValue();
            })
            .toBe(recoveredTitle);
        await page.reload();
        await expect(page.locator('.board-app')).toBeVisible();
        await expect(
            (await cardByTitle(page, recoveredTitle)).locator('.post-it-title')
        ).toHaveValue(recoveredTitle);
        title = recoveredTitle;

        // Drag from the non-interactive date area so this reproduces a real
        // canvas gesture rather than changing the card through an API call.
        const leftBeforeDrag = await cardLeft(page, title);
        const dragStart = await card.locator('.post-it-date').boundingBox();
        if (leftBeforeDrag === null || !dragStart)
            throw new Error('Created card is not available to drag.');
        await page.mouse.move(
            dragStart.x + dragStart.width / 2,
            dragStart.y + dragStart.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
            dragStart.x + dragStart.width / 2 + 120,
            dragStart.y + dragStart.height / 2 + 80,
            { steps: 5 }
        );
        await page.mouse.up();
        await expect
            .poll(() => cardLeft(page, title))
            .toBeGreaterThan(leftBeforeDrag + 70);
        // Move writes immediately, but give the API completion a small margin
        // before the reload below turns the UI assertion into persistence QA.
        await page.waitForTimeout(500);

        const quickCaptureTitle = `Quick capture ${testInfo.project.name}`;
        await page.locator('.command-palette-trigger').click();
        const palette = page.locator('.command-palette');
        await expect(palette).toBeVisible();
        await palette.locator('input').fill(quickCaptureTitle);
        await palette.locator('.command-palette-item').first().click();
        await expect
            .poll(() =>
                page
                    .locator('.post-it-title')
                    .evaluateAll(
                        (inputs, value) =>
                            inputs.some(
                                (input) =>
                                    (input as HTMLInputElement).value === value
                            ),
                        quickCaptureTitle
                    )
            )
            .toBe(true);

        await page.reload();
        await expect(page.locator('.board-app')).toBeVisible();
        await expect
            .poll(() =>
                page
                    .locator('.post-it-title')
                    .evaluateAll(
                        (inputs, value) =>
                            inputs.some(
                                (input) =>
                                    (input as HTMLInputElement).value === value
                            ),
                        title
                    )
            )
            .toBe(true);
        await expect
            .poll(() => cardLeft(page, title))
            .toBeGreaterThan(leftBeforeDrag + 70);
        await expect
            .poll(() =>
                page
                    .locator('.post-it-title')
                    .evaluateAll(
                        (inputs, value) =>
                            inputs.some(
                                (input) =>
                                    (input as HTMLInputElement).value === value
                            ),
                        quickCaptureTitle
                    )
            )
            .toBe(true);

        // Reloading drops the in-memory access token. Reopening the board
        // proves that the HttpOnly refresh cookie restores the session.
        await page.reload();
        await expect(page.locator('.board-app')).toBeVisible();

        await page.locator('.sidebar-command').last().click();
        await expect(page.locator('.auth-page')).toBeVisible();
        await page.reload();
        await expect(page.locator('.auth-page')).toBeVisible();

        const newPassword = 'NewStrongPassword123!';
        await page.locator('.auth-inline-link').click();
        await page.locator('#email').fill(email);
        await page.locator('.auth-submit').click();
        await expect(
            page.locator('input[autocomplete="one-time-code"]')
        ).toBeVisible();
        await expect
            .poll(() => verificationCode(email), { timeout: 10_000 })
            .toMatch(/^\d{6}$/);
        await page
            .locator('input[autocomplete="one-time-code"]')
            .fill(await verificationCode(email));
        await page.locator('#password').fill(newPassword);
        await page.locator('#confirm-password').fill(newPassword);
        await page.locator('.auth-submit').click();
        await expect(page.locator('#email')).toBeVisible();

        await page.locator('#email').fill(email);
        await page.locator('#password').fill(password);
        await page.locator('.auth-submit').click();
        await expect(page.locator('.auth-message.is-error')).toBeVisible();

        await page.locator('#password').fill(newPassword);
        await page.locator('.auth-submit').click();
        await expect(page.locator('.board-app')).toBeVisible();

        await page.getByRole('button', { name: /MagNotes/ }).click();
        const menuItems = page.locator(
            '.board-brand-menu > button[role="menuitem"]'
        );
        await menuItems.nth(4).click();
        const shareDialog = page.locator('.share-dialog');
        await expect(shareDialog).toBeVisible();
        await shareDialog.locator('.share-dialog__enable').click();
        const shareUrl = await shareDialog
            .locator('.share-dialog__link input')
            .inputValue();

        // PublicBoardView deliberately bypasses the authenticated app branch,
        // so the same browser context still proves the link is read-only.
        const publicPage = await page.context().newPage();
        await publicPage.goto(shareUrl);
        await expect(publicPage.locator('.public-board')).toBeVisible();
        await expect(
            publicPage.getByRole('heading', { name: title })
        ).toBeVisible();

        await shareDialog.locator('.share-dialog__revoke').click();
        await expect(
            shareDialog.locator('.share-dialog__enable')
        ).toBeVisible();
        await publicPage.reload();
        await expect(
            publicPage.locator('.public-board__notfound')
        ).toBeVisible();
        await publicPage.close();
        await shareDialog.locator('.share-dialog__close').click();
        await expect(shareDialog).toBeHidden();

        await page.getByRole('button', { name: /MagNotes/ }).click();
        const exportMenuItems = page.locator(
            '.board-brand-menu > button[role="menuitem"]'
        );
        const downloadPromise = page.waitForEvent('download');
        await exportMenuItems.nth(3).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('magnotes-export.json');
        const downloadPath = await download.path();
        if (!downloadPath)
            throw new Error('Export download path is unavailable.');
        const exported = JSON.parse(await readFile(downloadPath, 'utf8')) as {
            account: { email: string };
            postIts: Array<{ title: string }>;
        };
        expect(exported.account.email).toBe(email);
        expect(exported.postIts).toEqual(
            expect.arrayContaining([expect.objectContaining({ title })])
        );

        await page.getByRole('button', { name: /MagNotes/ }).click();
        const deleteMenuItems = page.locator(
            '.board-brand-menu > button[role="menuitem"]'
        );
        await deleteMenuItems.nth(5).click();
        const deleteDialog = page.locator('.account-dialog');
        await expect(deleteDialog).toBeVisible();
        await deleteDialog
            .locator('input[autocomplete="current-password"]')
            .fill('incorrect-password');
        await deleteDialog.locator('button.is-danger').click();
        await expect(
            deleteDialog.locator('.account-dialog-error[role="alert"]')
        ).toBeVisible();
        await expect(deleteDialog).toBeVisible();
        await deleteDialog
            .locator('input[autocomplete="current-password"]')
            .fill(newPassword);
        await deleteDialog.locator('button.is-danger').click();
        await expect(page.locator('.auth-page')).toBeVisible();
        await page.reload();
        await expect(page.locator('.auth-page')).toBeVisible();

        await page.locator('#email').fill(email);
        await page.locator('#password').fill(newPassword);
        await page.locator('.auth-submit').click();
        await expect(page.locator('.auth-message.is-error')).toBeVisible();
    });
});
