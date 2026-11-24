import { expect, test } from '@playwright/test';
import { startEditingCard } from './cardEditing';

// The expanded editor must carry the app theme (it used to mount on <body>,
// outside the scope of the theme variables: white text on a white sheet), and a
// card shows a single contour at a time.

test('the expanded editor is mounted in the app and stays readable', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await startEditingCard(card);
    await card.getByTestId('card-expand').dispatchEvent('click');

    const dialog = page.getByRole('dialog', { name: /./ }).last();
    await expect(dialog).toBeVisible();
    await expect(page.locator('.board-app .card-detail')).toHaveCount(1);
    await expect(page.locator('body > .card-detail-backdrop')).toHaveCount(0);

    const [background, color] = await dialog
        .locator('.card-detail-editor')
        .evaluate((node) => [
            getComputedStyle(node.closest('.card-detail')!).backgroundColor,
            getComputedStyle(node).color,
        ]);
    expect(color).not.toBe(background);
    await expect(page.getByTestId('card-detail-leave')).toBeVisible();
});

test('an edited, selected card shows one contour, not two', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await card.click({ position: { x: 20, y: 20 } });
    await expect(card).toHaveClass(/is-selected/);
    await startEditingCard(card);
    await expect(card).toHaveClass(/is-editing/);
    await expect(card).toHaveCSS('outline-style', 'none');
    await expect(card).toHaveCSS(
        'box-shadow',
        /rgb\(124, 108, 240\) 0px 0px 0px 2px/
    );
});

test('card toolbar buttons expose a tooltip text', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await startEditingCard(card);
    const tools = card.locator('.post-it-hover-tools > [data-tip]');
    expect(await tools.count()).toBeGreaterThanOrEqual(8);
    await expect(tools.first()).toHaveAttribute('data-tip', /.+/);
});

test('the expanded editor can be left and does not create cards behind it', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en');
    const cards = page.locator('.post-it-card');
    const card = cards.first();
    await startEditingCard(card);
    const before = await cards.count();
    await card.getByTestId('card-expand').dispatchEvent('click');

    const leave = page.getByTestId('card-detail-leave');
    await expect(leave).toHaveText(/leave full screen/i);
    const box = await leave.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    // A double-click on the dim backdrop and inside the dialog creates nothing.
    await page.locator('.card-detail-backdrop').dispatchEvent('dblclick');
    await page.locator('.card-detail-editor').dblclick();
    await expect(cards).toHaveCount(before);

    await leave.click();
    await expect(page.locator('.card-detail')).toHaveCount(0);
    await expect(cards).toHaveCount(before);
});

test('a selected card has no corner dot', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await card.click({ position: { x: 20, y: 20 } });
    await expect(card).toHaveClass(/is-selected/);
    await expect
        .poll(() =>
            card.evaluate((el) => getComputedStyle(el, '::after').content)
        )
        .not.toBe('""');
});

test('the expanded editor has no preview column', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=fr');
    const card = page.locator('.post-it-card').first();
    await startEditingCard(card);
    await card.getByTestId('card-expand').dispatchEvent('click');
    await expect(page.locator('.card-detail-editor')).toBeVisible();
    await expect(page.locator('.card-detail')).not.toContainText(/aperçu/i);
    await expect(page.locator('.card-detail-preview')).toHaveCount(0);
});

test('the formatting toolbar writes Markdown for the user', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await startEditingCard(card);
    await card.getByTestId('card-expand').dispatchEvent('click');

    const editor = page.locator('.card-detail-editor');
    await editor.fill('hello world');
    await editor.evaluate((el: HTMLTextAreaElement) =>
        el.setSelectionRange(6, 11)
    );
    await page.getByTestId('card-format-bold').click();
    await expect(editor).toHaveValue('hello **world**');

    await page.getByTestId('card-format-bold').click();
    await expect(editor).toHaveValue('hello world');

    await editor.press('Control+a');
    await page.getByTestId('card-format-ul').click();
    await expect(editor).toHaveValue('- hello world');

    await editor.press('Control+a');
    await editor.press('Control+i');
    await expect(editor).toHaveValue('_- hello world_');
    await expect(page.getByTestId('card-format-float')).toHaveCount(0);
});

test('selecting text on the card shows a floating formatting bar', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await startEditingCard(card);
    const body = card.locator('.post-it-content');
    const float = page.getByTestId('card-format-float');

    await body.fill('hello world');
    await body.click();
    await expect(float).toHaveCount(0);

    // Select "world" the way a user does: from the keyboard.
    await body.press('End');
    for (let i = 0; i < 5; i++) await body.press('Shift+ArrowLeft');
    await expect(float).toBeVisible();
    await float.getByTestId('card-format-bold').click();
    await expect(body).toHaveValue('hello **world**');
    await expect(body).toBeFocused();

    // Nothing selected: the bar goes away; Ctrl+I still works from the keyboard.
    await body.press('ArrowLeft');
    await expect(float).toHaveCount(0);
    await body.press('Home');
    for (let i = 0; i < 5; i++) await body.press('Shift+ArrowRight');
    await body.press('Control+i');
    await expect(body).toHaveValue('_hello_ **world**');
});
