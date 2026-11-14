import { expect, test } from '@playwright/test';

// The rotate button sits near the bottom-right corner; it must not cover the
// bottom-right resize handle, otherwise the card cannot be enlarged from there.

test.describe('card resize handles', () => {
    test.skip(({ isMobile }) => isMobile, 'hover-driven desktop handles');
    test.use({ locale: 'fr-FR' });

    test('the bottom-right corner enlarges the card and is not covered by the rotate button', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        const card = page.locator('.post-it-card').nth(1);
        await expect(card).toBeVisible();
        await card.hover();

        const handle = card.locator('.resize-handle.resize-se');
        const hb = await handle.boundingBox();
        if (!hb) throw new Error('resize-se handle has no box');
        const cx = hb.x + hb.width / 2;
        const cy = hb.y + hb.height / 2;

        // What sits under the handle's centre must be the handle itself.
        const topmost = await page.evaluate(
            ([x, y]) => {
                const el = document.elementFromPoint(x, y);
                return el?.className?.toString() ?? '';
            },
            [cx, cy]
        );
        expect(topmost).toContain('resize-se');

        // And the rotate button stays reachable and fully on the card's edge.
        const rotate = card.locator('.post-it-rotate-handle');
        await expect(rotate).toBeVisible();
        const rb = await rotate.boundingBox();
        if (!rb) throw new Error('rotate handle has no box');
        const overlapsHandle =
            rb.x < hb.x + hb.width &&
            rb.x + rb.width > hb.x &&
            rb.y < hb.y + hb.height &&
            rb.y + rb.height > hb.y;
        expect(overlapsHandle).toBe(false);

        const before = await card.boundingBox();
        if (!before) throw new Error('card has no box');
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + 60, cy + 40, { steps: 6 });
        await page.mouse.up();
        const after = await card.boundingBox();
        if (!after) throw new Error('card has no box after resize');
        expect(after.width).toBeGreaterThan(before.width + 40);
        // The opposite (top-left) corner stays put.
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    });

    test('growing a card snaps its right and bottom edges to two neighbours at once', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        const cards = page.locator('.post-it-card');
        await expect(cards).toHaveCount(6);
        await page.waitForTimeout(800);
        const card = cards.first();
        const right = await cards.nth(1).boundingBox(); // beside it
        const below = await cards.nth(3).boundingBox(); // under it
        await card.hover();
        const hb = await card.locator('.resize-se').boundingBox();
        if (!right || !below || !hb) throw new Error('missing box');
        const before = await card.boundingBox();
        if (!before) throw new Error('missing box');

        const cx = hb.x + hb.width / 2;
        const cy = hb.y + hb.height / 2;
        // Release 5px short of the neighbour's left edge and of the card
        // below's top edge: well inside the snap distance on both axes.
        const targetX = right.x - 5;
        const targetY = below.y - 5;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(targetX, targetY, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(300);

        const after = await card.boundingBox();
        if (!after) throw new Error('missing box after');
        expect(Math.abs(after.x + after.width - right.x)).toBeLessThanOrEqual(
            1
        );
        expect(Math.abs(after.y + after.height - below.y)).toBeLessThanOrEqual(
            1
        );
    });

    test('Alt resizes without snapping', async ({ page }) => {
        await page.goto('/app/?demo=1&lang=fr');
        const cards = page.locator('.post-it-card');
        await expect(cards).toHaveCount(6);
        await page.waitForTimeout(800);
        const card = cards.first();
        const right = await cards.nth(1).boundingBox();
        await card.hover();
        const hb = await card.locator('.resize-se').boundingBox();
        if (!right || !hb) throw new Error('missing box');
        const cx = hb.x + hb.width / 2;
        const cy = hb.y + hb.height / 2;
        await page.keyboard.down('Alt');
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(right.x - 5, cy, { steps: 10 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
        await page.waitForTimeout(300);
        const after = await card.boundingBox();
        if (!after) throw new Error('missing box after');
        // Free resize lands where the pointer let go, 5px short of the edge.
        expect(right.x - (after.x + after.width)).toBeGreaterThan(2);
    });

    // The card shows more than its stored height when its text needs the room.
    // Resizing must start from what is drawn: otherwise pulling a top handle
    // slides the whole card instead of growing it.
    for (const [corner, fixedEdge] of [
        ['nw', 'bottom'],
        ['ne', 'bottom'],
        ['sw', 'top'],
        ['se', 'top'],
    ] as const) {
        for (const dy of [-40, 40]) {
            test(`${corner} handle dragged ${dy}px keeps the ${fixedEdge} edge still`, async ({
                page,
            }) => {
                await page.goto('/app/?demo=1&lang=fr');
                const card = page.locator('.post-it-card').first();
                await expect(card).toBeVisible();
                await page.waitForTimeout(800);
                await card.hover();
                const before = await card.boundingBox();
                const hb = await card
                    .locator(`.resize-${corner}`)
                    .boundingBox();
                if (!before || !hb) throw new Error('missing box');
                const cx = hb.x + hb.width / 2;
                const cy = hb.y + hb.height / 2;
                await page.mouse.move(cx, cy);
                await page.mouse.down();
                await page.mouse.move(cx, cy + dy, { steps: 8 });
                await page.mouse.up();
                await page.waitForTimeout(300);
                const after = await card.boundingBox();
                if (!after) throw new Error('missing box after');
                const edge = (b: { y: number; height: number }) =>
                    fixedEdge === 'bottom' ? b.y + b.height : b.y;
                expect(
                    Math.abs(edge(after) - edge(before))
                ).toBeLessThanOrEqual(1);
            });
        }
    }
});
