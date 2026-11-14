import { expect, test } from '@playwright/test';

// While a card is dragged near several cards, the magnetism must read every
// card it would end up touching, not just the one that decided the dock.

test.describe('dock magnetism', () => {
    test.skip(({ isMobile }) => isMobile, 'mouse drag');
    test.use({ locale: 'fr-FR' });

    test('a corner drop highlights every card it touches and docks flush on both sides', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        const cards = page.locator('.post-it-card');
        await expect(cards).toHaveCount(6);
        await page.waitForTimeout(800);

        const left = await cards.nth(0).boundingBox(); // top-left card
        const above = await cards.nth(1).boundingBox(); // card above the slot
        const moving = cards.nth(4);
        const start = await moving.boundingBox();
        if (!left || !above || !start) throw new Error('missing box');

        // Aim a few pixels past the corner formed by the left card's right
        // edge and the card above's bottom edge.
        const wantLeft = left.x + left.width + 4;
        const wantTop = above.y + above.height + 4;
        const grabX = start.x + start.width / 2;
        const grabY = start.y + 8;
        await page.mouse.move(grabX, grabY);
        await page.mouse.down();
        await page.mouse.move(
            grabX + (wantLeft - start.x),
            grabY + (wantTop - start.y),
            { steps: 12 }
        );

        // Mid-drag: both neighbours glow, not only one of them.
        await expect
            .poll(() => page.locator('.post-it-card.is-drop-target').count())
            .toBeGreaterThanOrEqual(2);

        // And the dragged card is already drawn where it will land, not under
        // the pointer 4px away from the corner. Tolerance 2.5px: the lifted
        // card is drawn 1.5% larger, around its centre.
        await page.waitForTimeout(200);
        const live = await moving.boundingBox();
        if (!live) throw new Error('missing live box');
        expect(Math.abs(live.x - (left.x + left.width))).toBeLessThanOrEqual(
            2.5
        );
        expect(Math.abs(live.y - (above.y + above.height))).toBeLessThanOrEqual(
            2.5
        );

        await page.mouse.up();
        await page.waitForTimeout(500);
        const after = await moving.boundingBox();
        if (!after) throw new Error('missing box after');
        // Flush against the left card's right edge and the upper card's
        // bottom edge at the same time.
        expect(Math.abs(after.x - (left.x + left.width))).toBeLessThanOrEqual(
            1.5
        );
        expect(
            Math.abs(after.y - (above.y + above.height))
        ).toBeLessThanOrEqual(1.5);
    });

    test('a staggered drop keeps its offset and does not jump on release', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        const cards = page.locator('.post-it-card');
        await expect(cards).toHaveCount(6);
        await page.waitForTimeout(800);

        const target = await cards.nth(0).boundingBox();
        const moving = cards.nth(4);
        const start = await moving.boundingBox();
        if (!target || !start) throw new Error('missing box');

        // Just under the first card, shifted 70px sideways on purpose.
        const wantLeft = target.x + 70;
        const wantTop = target.y + target.height + 8;
        const grabX = start.x + start.width / 2;
        const grabY = start.y + 8;
        await page.mouse.move(grabX, grabY);
        await page.mouse.down();
        await page.mouse.move(
            grabX + (wantLeft - start.x),
            grabY + (wantTop - start.y),
            { steps: 12 }
        );
        await page.waitForTimeout(250);
        const live = await moving.boundingBox();
        await page.mouse.up();
        await page.waitForTimeout(500);
        const after = await moving.boundingBox();
        if (!live || !after) throw new Error('missing box');

        // Flush under the card, offset kept, and no jump between the drag
        // preview and the dropped card.
        expect(
            Math.abs(after.y - (target.y + target.height))
        ).toBeLessThanOrEqual(1.5);
        expect(Math.abs(after.x - wantLeft)).toBeLessThanOrEqual(2);
        expect(Math.abs(after.x - live.x)).toBeLessThanOrEqual(2.5);
        expect(Math.abs(after.y - live.y)).toBeLessThanOrEqual(2.5);
    });
});
