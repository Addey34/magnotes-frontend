import { expect, test } from '@playwright/test';
import { startEditingCard } from './cardEditing';

// Picking a dark card colour must not leave the text unreadable, and the text
// popover must fit its colour row (6 stock inks + the free picker).

test('a dark card colour flips the ink to a readable one', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await expect(card).toBeVisible();
    await startEditingCard(card);
    await card.locator('.card-style-trigger').dispatchEvent('click');
    await page.locator('.style-panel').evaluate((node) => {
        const input = node.querySelector<HTMLInputElement>(
            '.color-swatch-row input[type=color]'
        )!;
        const set = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )!.set!;
        set.call(input, '#1e3a8a');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect
        .poll(() =>
            card
                .locator('.post-it-title')
                .evaluate((n) => getComputedStyle(n).color)
        )
        .toBe('rgb(248, 250, 252)');
});

test('the text popover fits its colour row', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await startEditingCard(card);
    await card.locator('.card-style-trigger').dispatchEvent('click');
    const fits = await page.locator('.style-panel').evaluate((pop) => {
        const box = pop.getBoundingClientRect();
        return [...pop.querySelectorAll('.text-color-swatch')].every((s) => {
            const r = s.getBoundingClientRect();
            return r.left >= box.left && r.right <= box.right;
        });
    });
    expect(fits).toBe(true);
    // The popover itself must stay fully visible, not clipped by the canvas.
    const clipped = await page.locator('.style-panel').evaluate((pop) => {
        const box = pop.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + 6, box.top + 40);
        return !hit || !pop.contains(hit);
    });
    expect(clipped).toBe(false);
    await page.screenshot({ path: test.info().outputPath('text-popover.png') });
});
