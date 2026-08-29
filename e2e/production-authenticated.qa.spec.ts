import { expect, test } from '@playwright/test';

const email = process.env.PRODUCTION_QA_EMAIL;
const password = process.env.PRODUCTION_QA_PASSWORD;
const deleteAccount = process.env.PRODUCTION_QA_DELETE_ACCOUNT === '1';

test.describe('authenticated production gestures', () => {
    test.skip(
        !email || !password,
        'Set PRODUCTION_QA_EMAIL and PRODUCTION_QA_PASSWORD for a disposable account.'
    );

    test('persists drag/resize and restores a deleted duplicate', async ({
        page,
    }) => {
        await page.addInitScript(() =>
            localStorage.setItem('magnotes-lang', 'fr')
        );

        try {
            await page.goto('/app/');
            await page.locator('#email').fill(email!);
            await page.locator('#password').fill(password!);
            await page.locator('.auth-submit').click();
            await expect(page.locator('.board-app')).toBeVisible();

            const cards = page.locator('.post-it-card');
            const initialCount = await cards.count();
            await page.locator('.create-card-button').click();
            await expect(cards).toHaveCount(initialCount + 1);

            const title = `QA gestures ${Date.now()}`;
            const card = cards.last();
            await card.locator('.post-it-title').fill(title);
            await card.locator('.post-it-content').fill('Disposable QA card.');
            await card.locator('.post-it-content').blur();
            await page.waitForTimeout(800);

            const beforeDrag = await card.boundingBox();
            const dragHandle = await card
                .locator('.post-it-date')
                .boundingBox();
            if (!beforeDrag || !dragHandle)
                throw new Error('Card drag geometry is unavailable.');
            const viewportWidth = page.viewportSize()?.width ?? 1280;
            const leftSpace = beforeDrag.x - 70;
            const rightSpace =
                viewportWidth - (beforeDrag.x + beforeDrag.width);
            const dragDeltaX = rightSpace >= leftSpace ? 140 : -140;
            await page.mouse.move(
                dragHandle.x + dragHandle.width / 2,
                dragHandle.y + dragHandle.height / 2
            );
            await page.mouse.down();
            await page.mouse.move(
                dragHandle.x + dragHandle.width / 2 + dragDeltaX,
                dragHandle.y + dragHandle.height / 2 + 90,
                { steps: 6 }
            );
            await page.mouse.up();
            await expect
                .poll(async () => {
                    const currentX = (await card.boundingBox())?.x;
                    return currentX === undefined
                        ? 0
                        : Math.abs(currentX - beforeDrag.x);
                })
                .toBeGreaterThan(70);

            const beforeResize = await card.boundingBox();
            const resizeHandle = await card.locator('.resize-sw').boundingBox();
            if (!beforeResize || !resizeHandle)
                throw new Error('Card resize geometry is unavailable.');
            await page.mouse.move(
                resizeHandle.x + resizeHandle.width / 2,
                resizeHandle.y + resizeHandle.height / 2
            );
            await page.mouse.down();
            await page.mouse.move(
                resizeHandle.x + resizeHandle.width / 2 - 100,
                resizeHandle.y + resizeHandle.height / 2 + 70,
                { steps: 6 }
            );
            await page.mouse.up();
            await expect
                .poll(async () => (await card.boundingBox())?.width ?? 0)
                .toBeGreaterThan(beforeResize.width + 60);
            await expect
                .poll(async () => (await card.boundingBox())?.height ?? 0)
                .toBeGreaterThan(beforeResize.height + 40);

            await page.waitForTimeout(600);
            await page.reload();
            await expect(page.locator('.board-app')).toBeVisible();
            const matchingCards = page.locator('.post-it-card').filter({
                has: page.locator(`.post-it-title[value="${title}"]`),
            });
            await expect(matchingCards).toHaveCount(1);
            const persistedCard = matchingCards.first();
            const persistedBox = await persistedCard.boundingBox();
            expect(persistedBox?.width ?? 0).toBeGreaterThan(
                beforeResize.width + 60
            );

            await persistedCard.hover();
            await persistedCard
                .getByLabel('Dupliquer', { exact: true })
                .click();
            await expect(page.locator('.post-it-card')).toHaveCount(
                initialCount + 2
            );
            const duplicateCard = matchingCards.last();
            await duplicateCard.hover();
            await duplicateCard
                .getByLabel('Supprimer', { exact: true })
                .click();
            await expect(page.locator('.post-it-card')).toHaveCount(
                initialCount + 1
            );
            await page.getByTitle('Annuler (Ctrl+Z)').click();
            await expect(page.locator('.post-it-card')).toHaveCount(
                initialCount + 2
            );
        } finally {
            if (deleteAccount && !page.isClosed()) {
                await page.goto('/app/');
                const board = page.locator('.board-app');
                const auth = page.locator('.auth-page');
                await expect(board.or(auth)).toBeVisible();
                if (await board.isVisible()) {
                    await page
                        .getByRole('button', { name: /MagNotes/ })
                        .click();
                    const menuItems = page.locator(
                        '.board-brand-menu > button[role="menuitem"]'
                    );
                    await menuItems.nth(5).click();
                    const dialog = page.locator('.account-dialog');
                    await dialog
                        .locator('input[autocomplete="current-password"]')
                        .fill(password!);
                    await dialog.locator('button.is-danger').click();
                    await expect(page.locator('.auth-page')).toBeVisible();
                }
            }
        }
    });
});
