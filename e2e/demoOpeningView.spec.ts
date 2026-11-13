import { expect, test } from '@playwright/test';

// A first-time visitor lands on the demo board. On a phone the whole board
// cannot fit at a readable size, so the first card must be legible and in view
// (the rest is a pan away); on a wide screen everything must be in view.

const PHONE_WIDTH = 600;
const MIN_READABLE_CARD_WIDTH = 180;
// A card renders a little taller than its stored height, so the fit view can
// leave the bottom edge of the last row a few pixels past the canvas.
const BOTTOM_TOLERANCE = 24;

test.describe('demo opening view', () => {
    test.use({ locale: 'fr-FR' });

    test('opens on something legible and in view', async ({
        page,
        viewport,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        const cards = page.locator('.post-it-card');
        await expect(cards.first()).toBeVisible();
        await expect(cards).toHaveCount(6);
        // Let the opening auto-frame settle.
        await page.waitForTimeout(1200);

        const width = viewport?.width ?? 1280;
        const height = viewport?.height ?? 800;
        const boxes = await cards.evaluateAll((nodes) =>
            nodes.map((node) => {
                const r = node.getBoundingClientRect();
                return { x: r.x, y: r.y, w: r.width, h: r.height };
            })
        );
        const inView = (b: { x: number; y: number; w: number; h: number }) =>
            b.x >= 0 &&
            b.y >= 0 &&
            b.x + b.w <= width &&
            b.y + b.h <= height + BOTTOM_TOLERANCE;

        if (width < PHONE_WIDTH) {
            // The first card is large enough to read and fully on screen.
            const first = boxes.reduce((a, b) =>
                b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a
            );
            expect(first.w).toBeGreaterThanOrEqual(MIN_READABLE_CARD_WIDTH);
            expect(inView(first)).toBe(true);
            // It sits in the upper half, not under a screen of empty canvas.
            expect(first.y).toBeLessThan(height / 2);
        } else {
            expect(boxes.every(inView)).toBe(true);
        }

        const overflow = await page.evaluate(
            () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test('Cadrer still fits the whole board', async ({ page, viewport }) => {
        await page.goto('/app/?demo=1&lang=fr');
        await expect(page.locator('.post-it-card').first()).toBeVisible();
        await page
            .locator('button[aria-label="Cadrer toutes les notes"]:visible')
            .first()
            .click();
        await page.waitForTimeout(300);

        const width = viewport?.width ?? 1280;
        const height = viewport?.height ?? 800;
        const boxes = await page
            .locator('.post-it-card')
            .evaluateAll((nodes) =>
                nodes.map((node) => node.getBoundingClientRect())
            );
        expect(
            boxes.every(
                (b) =>
                    b.left >= 0 &&
                    b.top >= 0 &&
                    b.right <= width &&
                    b.bottom <= height + BOTTOM_TOLERANCE
            )
        ).toBe(true);
    });
});
