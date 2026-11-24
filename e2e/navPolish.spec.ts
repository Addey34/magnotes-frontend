import { expect, test } from '@playwright/test';

test('the sidebar rail is centred on one axis', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    await expect(page.locator('.board-tab').first()).toBeVisible();
    const axis = await page.evaluate(() => {
        const sidebar = document.querySelector('.board-sidebar')!;
        const box = sidebar.getBoundingClientRect();
        const centre = (el: Element) => {
            const r = el.getBoundingClientRect();
            return r.x + r.width / 2;
        };
        const pick = (selector: string) =>
            [...document.querySelectorAll(selector)].map(centre);
        return {
            rail: box.x + box.width / 2,
            items: [
                ...pick('.board-brand-mark'),
                ...pick('.board-tab-icon'),
                ...pick('.board-tab-add'),
                ...pick('.board-sidebar-footer button'),
            ],
        };
    });
    expect(axis.items.length).toBeGreaterThanOrEqual(5);
    for (const x of axis.items) {
        expect(Math.abs(x - axis.rail)).toBeLessThanOrEqual(1.5);
    }
});

test('a page can be edited (icon) on every device', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    const tab = page.locator('.board-tab.is-active').first();
    await expect(tab).toBeVisible();
    await tab.hover();
    const badge = tab.locator('.board-tab-menu summary');
    await expect(badge).toBeVisible();
    await badge.click();

    const popover = page.locator('.board-tab-popover');
    await expect(popover).toBeVisible();
    const viewport = page.viewportSize()!;
    const box = (await popover.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

    // Every icon of the grid sits inside the popover (nothing clipped).
    const buttons = popover.locator('.board-tab-icon-options button');
    const last = (await buttons.last().boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(box.x + box.width - 8);

    const before = await tab.locator('.board-tab-icon').innerText();
    await buttons.nth(3).click();
    await expect(tab.locator('.board-tab-icon')).not.toHaveText(before);
});
