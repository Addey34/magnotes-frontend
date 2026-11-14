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
