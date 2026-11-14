import { expect, test } from '@playwright/test';

// Holding the button down on empty canvas is a pan. However fast the drag
// crosses the cards, it must never turn into a native text selection.

test.describe('board pan', () => {
    test.skip(({ isMobile }) => isMobile, 'mouse-only gesture');
    test.use({ locale: 'fr-FR' });

    test('a fast pan across cards selects no text', async ({
        page,
        viewport,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        await expect(page.locator('.post-it-card')).toHaveCount(6);
        await page.waitForTimeout(800);

        const width = viewport?.width ?? 1280;
        const height = viewport?.height ?? 800;
        const gestures = [
            [200, 160, width - 280, height - 100],
            [width - 80, height - 20, 300, 230],
        ];
        for (const [sx, sy, ex, ey] of gestures) {
            await page.mouse.move(sx, sy);
            await page.mouse.down();
            await page.mouse.move(ex, ey, { steps: 3 });
            const selected = await page.evaluate(
                () => window.getSelection()?.toString().length ?? 0
            );
            await page.mouse.up();
            expect(selected).toBe(0);
        }
    });
});
