import { expect, test, type Page } from '@playwright/test';
import { startEditingCard } from './cardEditing';

// A card's stored height is only a minimum: it grows with its content. The
// board geometry (docking, here) must follow what is actually drawn, or a card
// docks against an edge that does not exist on screen.

test.skip(
    ({ isMobile }) => isMobile,
    'Pointer drag on a desktop canvas; touch drag is covered elsewhere.'
);

const rectOf = (page: Page, titleStart: string) =>
    page.evaluate((start) => {
        const card = [...document.querySelectorAll('.post-it-card')].find(
            (node) =>
                (
                    node.querySelector('.post-it-title') as HTMLInputElement
                )?.value.startsWith(start)
        );
        if (!card) throw new Error(`No card starting with "${start}"`);
        const r = card.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }, titleStart);

test('a card dropped near the visible bottom edge docks flush under a grown card', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=fr');
    await expect(page.locator('.post-it-card')).toHaveCount(6);
    await page.waitForTimeout(1200);

    const target = await rectOf(page, 'Ctrl+K');
    const moved = await rectOf(page, 'Changez');
    // The demo card is drawn past its stored 150 px minimum.
    expect(target.bottom - target.top).toBeGreaterThan(170);

    // Drop it a few pixels above the target's *visible* bottom edge, aligned
    // on its left edge: within docking distance of the drawn edge, but far
    // from the stored one.
    const grab = { x: moved.left + 110, y: moved.top + 120 };
    const dx = target.left - moved.left;
    const dy = target.bottom - 8 - moved.top;
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + dx / 2, grab.y + dy / 2, { steps: 8 });
    await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(600);

    const after = await rectOf(page, 'Changez');
    // Flush under the drawn bottom edge: touching, not overlapping, not far.
    expect(after.top).toBeGreaterThanOrEqual(target.bottom - 2);
    expect(after.top).toBeLessThanOrEqual(target.bottom + 2);
    expect(Math.abs(after.left - target.left)).toBeLessThanOrEqual(2);
});

test('a grown card still shrinks when its text is deleted', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=fr');
    await expect(page.locator('.post-it-card')).toHaveCount(6);
    await page.waitForTimeout(1000);
    const card = page
        .locator('.post-it-card')
        .filter({ has: page.locator('input.post-it-title[value^="Ctrl+K"]') });
    const heightOf = async () =>
        Math.round((await card.boundingBox())?.height ?? 0);
    const before = await heightOf();
    expect(before).toBeGreaterThan(170);

    await startEditingCard(card);
    await card.locator('textarea.post-it-content').fill('');

    // The measured height must never become the card's new minimum.
    await expect.poll(heightOf).toBeLessThan(before - 20);
});
