import { expect, test } from '@playwright/test';
import { startEditingCard } from './cardEditing';

// One Style panel opens beside the card (never over it on a wide screen), stays
// upright whatever the card's tilt, and owns the rotation controls.

test('the style panel sits beside the card and stays upright', async ({
    page,
    viewport,
}) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await expect(card).toBeVisible();
    await startEditingCard(card);
    await card.locator('.card-style-trigger').dispatchEvent('click');
    const panel = page.locator('.style-panel');
    await expect(panel).toBeVisible();

    if ((viewport?.width ?? 0) > 900) {
        const [c, p] = await Promise.all([
            card.boundingBox(),
            panel.boundingBox(),
        ]);
        const overlaps =
            p!.x < c!.x + c!.width &&
            p!.x + p!.width > c!.x &&
            p!.y < c!.y + c!.height &&
            p!.y + p!.height > c!.y;
        expect(overlaps, 'panel must not cover the card').toBe(false);
    }

    const slider = panel.getByRole('slider', { name: 'Card rotation' });
    await slider.fill('30');
    await expect(card).toHaveCSS('transform', /matrix\(0\.866/);
    await expect(panel.locator('.rotation-value')).toHaveText('30°');

    // Turned back by the card's own rotation: the box stays axis-aligned.
    const upright = await panel.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const el = node as HTMLElement;
        return Math.abs(r.width / el.offsetWidth - r.height / el.offsetHeight);
    });
    expect(upright).toBeLessThan(0.03);
});

test('rotation snaps to straight and can be reset', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await startEditingCard(card);
    await card.locator('.card-style-trigger').dispatchEvent('click');
    const panel = page.locator('.style-panel');
    const slider = panel.getByRole('slider', { name: 'Card rotation' });
    const reset = panel.getByRole('button', { name: 'Straighten (0°)' });

    await slider.fill('45');
    await expect(panel.locator('.rotation-value')).toHaveText('45°');
    await expect(reset).toBeEnabled();
    await reset.dispatchEvent('click');
    await expect(panel.locator('.rotation-value')).toHaveText('0°');
    await expect(reset).toBeDisabled();

    await slider.fill('3');
    await expect(panel.locator('.rotation-value')).toHaveText('0°');
});

// A look copied from one card can be pasted on the whole selection.
test('a copied style is pasted on every selected card', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    const cards = page.locator('.post-it-card');
    const first = cards.first();
    await expect(first).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(1);

    await startEditingCard(first);
    await first.locator('.card-style-trigger').dispatchEvent('click');
    await page.locator('.card-finish-chip.finish-glass').dispatchEvent('click');
    await page.locator('.style-copy-row button').first().dispatchEvent('click');
    await expect(first).toHaveClass(/finish-glass/);
    await first.locator('.card-style-trigger').dispatchEvent('click');
    await first.locator('.card-edit-done').dispatchEvent('click');

    await page.locator('.board-canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+a');
    const paste = page.locator('.board-selection-bar button', {
        hasText: 'Paste style',
    });
    await expect(paste).toBeEnabled();
    await paste.dispatchEvent('click');

    const total = await cards.count();
    await expect(page.locator('.post-it-card.finish-glass')).toHaveCount(total);
});
