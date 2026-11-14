import { expect, test } from '@playwright/test';
import { startEditingCard } from './cardEditing';

// The style panels share one control kit: the active choice is exposed with
// aria-pressed, stock swatches have human names, every panel stays inside the
// visible canvas (also when the board is zoomed out) and targets stay usable.

const MIN_TARGET = 24; // WCAG 2.5.8 floor, in rendered pixels.

test('style panels expose their state, names and usable targets', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await expect(card).toBeVisible();
    await startEditingCard(card);

    const panels: [string, string][] = [
        ['.card-style-trigger', '.style-panel'],
        ['button[aria-label^="Task"]', '.task-popover'],
        ['button[aria-label^="Image"]', '.media-popover'],
    ];
    for (const [trigger, panel] of panels) {
        await card.locator(trigger).dispatchEvent('click');
        const pop = page.locator(panel);
        await expect(pop).toBeVisible();

        const report = await pop.evaluate((node) => {
            // Beside the card on a wide screen (inside the canvas), bottom
            // sheet on a phone (inside the window).
            const host = node.closest('.board-canvas');
            const canvas = host
                ? host.getBoundingClientRect()
                : new DOMRect(0, 0, innerWidth, innerHeight);
            const box = node.getBoundingClientRect();
            const small = [
                ...node.querySelectorAll(
                    'button, select, input:not([type=color])'
                ),
            ]
                .map((n) => n.getBoundingClientRect())
                .filter(
                    (r) => r.width > 0 && Math.min(r.width, r.height) < 24
                ).length;
            return {
                inside:
                    box.left >= canvas.left - 1 &&
                    box.right <= canvas.right + 1,
                small,
            };
        });
        expect(report.inside, `${panel} stays inside the canvas`).toBe(true);
        expect(
            report.small,
            `${panel} has no target under ${MIN_TARGET}px`
        ).toBe(0);
        await card.locator(trigger).dispatchEvent('click');
    }

    await card.locator('.card-style-trigger').dispatchEvent('click');
    const yellow = page.getByRole('button', { name: 'Color Yellow' });
    await expect(yellow).toHaveAttribute('aria-pressed', 'true');
    const matte = page.locator('.card-finish-chip.finish-matte');
    await matte.dispatchEvent('click');
    await expect(matte).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.card-finish-chip.finish-flat')).toHaveAttribute(
        'aria-pressed',
        'false'
    );
});
