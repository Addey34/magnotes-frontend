import { expect, test } from '@playwright/test';

// Switching views or renaming the board must not move the controls around:
// everything stays on the right, the canvas-only zoom/appearance controls sit to
// the LEFT of the view switch (so the switch and what follows keep their place),
// and the title block keeps its size while it is edited.

const VIEWS = ['canvas', 'kanban', 'agenda', 'timeline', 'canvas'] as const;

// 1181-1399px is left out on purpose: the canvas controls only just fit there, so
// the search box gives way (and the switch with it) on the canvas.
for (const width of [1837, 1440, 1024]) {
    test(`the view switch does not move between views at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/app/?demo=1&lang=en');
        const switcher = page.locator('.board-view-switch');
        const create = page.locator('.create-card-button');

        let reference: { left: number; createLeft: number } | null = null;
        for (const view of VIEWS) {
            await page.locator(`[data-view-tab="${view}"]`).click();
            await expect(
                page.locator(`[data-view-tab="${view}"]`)
            ).toHaveAttribute('aria-selected', 'true');
            const left = (await switcher.boundingBox())!.x;
            const createLeft = (await create.boundingBox())!.x;
            reference ??= { left, createLeft };
            expect(left, `${view}: switch x`).toBeCloseTo(reference.left, 0);
            // Right-aligned bar only: the compact bar (<= 1180px) scrolls from
            // the left, so the canvas controls legitimately push what follows.
            if (width > 1180) {
                expect(createLeft, `${view}: new-note x`).toBeCloseTo(
                    reference.createLeft,
                    0
                );
            }
        }
    });
}

test('on a wide screen the list views start right under the top bar and are centred', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1837, height: 799 });
    await page.goto('/app/?demo=1&lang=en');
    for (const view of ['kanban', 'timeline'] as const) {
        await page.locator(`[data-view-tab="${view}"]`).click();
        const topbar = (await page.locator('.board-topbar').boundingBox())!;
        // Inner container: its box excludes the scroll area's own scrollbar.
        const container = page.locator('.board-alt-view > *').first();
        const box = (await container.boundingBox())!;
        const first = (await container.locator('> *').first().boundingBox())!;
        const last = (await container.locator('> *').last().boundingBox())!;
        expect(
            first.y - (topbar.y + topbar.height),
            `${view}: top gap`
        ).toBeLessThan(24);
        const left = first.x - box.x;
        const right = box.x + box.width - (last.x + last.width);
        expect(Math.abs(left - right), `${view}: centred`).toBeLessThan(2);
        expect(left, `${view}: has side margins`).toBeGreaterThan(40);
    }
});

test('renaming the board title moves nothing around it', async ({ page }) => {
    await page.goto('/app/?demo=1&lang=en');
    const sel = ['.board-title-group', '.board-view-switch', '.board-subtitle'];
    const read = async () =>
        Promise.all(
            sel.map(async (s) => {
                // The subtitle is hidden on compact screens.
                const b = await page.locator(s).first().boundingBox();
                if (!b) return null;
                // Its box widens with the field; its text does not move, so
                // compare position and height only.
                return s === '.board-subtitle'
                    ? [b.x, b.y, b.height]
                    : [b.x, b.y, b.width, b.height];
            })
        );
    const before = await read();
    await page.locator('.board-title-trigger').click();
    await expect(page.locator('.board-title-editor input')).toBeFocused();
    const after = await read();
    expect(after).toEqual(before);

    await page.keyboard.press('Escape');
    await expect(page.locator('.board-title-editor')).toHaveCount(0);
    expect(await read()).toEqual(before);
});
