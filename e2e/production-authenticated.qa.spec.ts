import { expect, test, type Locator, type Page } from '@playwright/test';

const waitForCardSave = (page: Page) =>
    page.waitForResponse(
        (response) =>
            response.request().method() === 'PATCH' &&
            /\/api\/postits\/[^/]+$/.test(new URL(response.url()).pathname) &&
            response.ok()
    );

async function setCardContent(
    page: Page,
    card: Locator,
    content: string
): Promise<void> {
    await card.hover();
    await card.getByLabel('Agrandir (édition Markdown)').click();
    const editor = page.locator('.card-detail-editor');
    await expect(editor).toBeVisible();
    await editor.fill(content);
    await page.locator('.card-detail-close').click();
}

const email = process.env.PRODUCTION_QA_EMAIL;
const password = process.env.PRODUCTION_QA_PASSWORD;
const deleteAccount = process.env.PRODUCTION_QA_DELETE_ACCOUNT === '1';

test.describe('authenticated production gestures', () => {
    test.skip(
        !email || !password,
        'Set PRODUCTION_QA_EMAIL and PRODUCTION_QA_PASSWORD for a disposable account.'
    );

    test('persists board customization and advanced card gestures', async ({
        page,
    }) => {
        await page.addInitScript(() =>
            localStorage.setItem('magnotes-lang', 'fr')
        );

        try {
            await page.goto('/app/?analytics=off');
            await page.locator('#email').fill(email!);
            await page.locator('#password').fill(password!);
            await page.locator('.auth-submit').click();
            await expect(page.locator('.board-app')).toBeVisible();

            const tabs = page.locator('.board-tab');
            const initialTabCount = await tabs.count();
            const originalTabName = await tabs
                .first()
                .locator('.board-tab-name')
                .innerText();
            await page.getByRole('button', { name: 'Nouveau tableau' }).click();
            await expect(tabs).toHaveCount(initialTabCount + 1);

            const boardName = `QA avancée ${Date.now()}`;
            await page.locator('.board-title-trigger').click();
            const titleEditor = page.getByLabel('Renommer la page active');
            await titleEditor.fill(boardName);
            await titleEditor.press('Enter');
            await expect(page.locator('.board-title-trigger')).toHaveText(
                boardName
            );

            const newTab = tabs.filter({ hasText: boardName });
            const originalTab = tabs.filter({ hasText: originalTabName });
            await newTab.dragTo(originalTab, {
                targetPosition: { x: 20, y: 2 },
            });
            await expect(tabs.first().locator('.board-tab-name')).toHaveText(
                boardName
            );

            await page
                .getByRole('button', { name: 'Apparence du tableau' })
                .click();
            const appearance = page.getByRole('dialog', {
                name: 'Apparence du tableau',
            });
            await appearance.getByRole('button', { name: 'Liège' }).click();
            const background = appearance.locator('input[type="color"]');
            await background.fill('#245678');
            await expect(page.locator('.board-app')).toHaveClass(
                /board-theme-liege/
            );
            await expect(background).toHaveValue('#245678');

            await page.waitForTimeout(600);
            await page.reload();
            await expect(page.locator('.board-app')).toBeVisible();
            await expect(tabs.first().locator('.board-tab-name')).toHaveText(
                boardName
            );
            await expect(page.locator('.board-title-trigger')).toHaveText(
                boardName
            );
            await expect(page.locator('.board-app')).toHaveClass(
                /board-theme-liege/
            );
            await page
                .getByRole('button', { name: 'Apparence du tableau' })
                .click();
            await expect(
                page
                    .getByRole('dialog', { name: 'Apparence du tableau' })
                    .locator('input[type="color"]')
            ).toHaveValue('#245678');
            await page
                .getByRole('button', { name: 'Apparence du tableau' })
                .click();

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
            if (!persistedBox)
                throw new Error('Persisted card geometry is unavailable.');
            expect(persistedBox.width).toBeGreaterThan(beforeResize.width + 60);

            const targetTitle = `QA cible ${Date.now()}`;
            const contentSaved = waitForCardSave(page);
            await setCardContent(
                page,
                persistedCard,
                `Relation vers [[${targetTitle}]]`
            );
            await contentSaved;
            await persistedCard.hover();
            await persistedCard
                .getByLabel('Tâche (statut, échéance, checklist)')
                .click();
            const checklistInput = persistedCard.getByPlaceholder(
                'Nouvelle sous-tâche…'
            );
            const checklistSaved = waitForCardSave(page);
            await checklistInput.fill('Valider le parcours avancé');
            await checklistInput.press('Enter');
            const checklistRow = persistedCard.locator('.task-checklist-row');
            await expect(checklistRow).toHaveCount(1);
            await checklistRow.locator('input[type="checkbox"]').check();
            await checklistSaved;
            await persistedCard
                .getByLabel('Tâche (statut, échéance, checklist)')
                .click();

            const canvas = page.locator('.board-canvas');
            const canvasBox = await canvas.boundingBox();
            if (!canvasBox)
                throw new Error('Board canvas geometry is unavailable.');
            const candidates = [
                { x: 180, y: 170 },
                { x: canvasBox.width - 180, y: 170 },
                { x: 180, y: canvasBox.height - 170 },
                { x: canvasBox.width - 180, y: canvasBox.height - 170 },
            ];
            const persistedCenter = {
                x: persistedBox.x - canvasBox.x + persistedBox.width / 2,
                y: persistedBox.y - canvasBox.y + persistedBox.height / 2,
            };
            const targetPoint = candidates.reduce((farthest, candidate) =>
                Math.hypot(
                    candidate.x - persistedCenter.x,
                    candidate.y - persistedCenter.y
                ) >
                Math.hypot(
                    farthest.x - persistedCenter.x,
                    farthest.y - persistedCenter.y
                )
                    ? candidate
                    : farthest
            );
            const beforeTargetCount = await cards.count();
            await canvas.dblclick({ position: targetPoint });
            await expect(cards).toHaveCount(beforeTargetCount + 1);
            const targetCard = cards.last();
            const targetSaved = waitForCardSave(page);
            await targetCard.locator('.post-it-title').fill(targetTitle);
            await targetSaved;

            await persistedCard.hover();
            await persistedCard.getByTitle('Relier à une autre carte').click();
            await targetCard.locator('.post-it-date').click();
            await expect(page.locator('.board-connection')).toHaveCount(1);

            await page.reload();
            await expect(page.locator('.board-app')).toBeVisible();
            await expect(page.locator('.board-connection')).toHaveCount(1);
            await expect(
                matchingCards.first().locator('.post-it-mentions')
            ).toContainText(targetTitle);
            await expect(
                matchingCards
                    .first()
                    .locator('.post-it-checklist input[type="checkbox"]')
            ).toBeChecked();

            const beforeDuplicateCount = await cards.count();
            await matchingCards.first().hover();
            await matchingCards
                .first()
                .getByLabel('Dupliquer', { exact: true })
                .click();
            await expect(page.locator('.post-it-card')).toHaveCount(
                beforeDuplicateCount + 1
            );
            const duplicateCard = matchingCards.last();
            await duplicateCard.hover();
            await duplicateCard
                .getByLabel('Supprimer', { exact: true })
                .click();
            await expect(page.locator('.post-it-card')).toHaveCount(
                beforeDuplicateCount
            );
            await page.getByTitle('Annuler (Ctrl+Z)').click();
            await expect(page.locator('.post-it-card')).toHaveCount(
                beforeDuplicateCount + 1
            );

            await expect(matchingCards).toHaveCount(2);
            const stackSource = matchingCards.last();
            const stackHandle = await stackSource
                .locator('.post-it-date')
                .boundingBox();
            if (!stackHandle)
                throw new Error('Stack source geometry is unavailable.');
            const stackStart = {
                x: stackHandle.x + stackHandle.width / 2,
                y: stackHandle.y + stackHandle.height / 2,
            };
            await page.mouse.move(stackStart.x, stackStart.y);
            await page.mouse.down();
            await page.mouse.move(stackStart.x + 100, stackStart.y + 80, {
                steps: 4,
            });
            await page.mouse.move(stackStart.x, stackStart.y, { steps: 4 });
            await page.mouse.up();
            await expect(page.locator('.post-it-stack-card')).toHaveCount(1);
            await page.reload();
            await expect(page.locator('.board-app')).toBeVisible();
            await expect(page.locator('.post-it-stack-card')).toHaveCount(1);
        } finally {
            if (deleteAccount && !page.isClosed()) {
                await page.goto('/app/?analytics=off');
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
