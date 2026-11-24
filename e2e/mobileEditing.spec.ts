import { expect, test } from '@playwright/test';

test.setTimeout(60_000);

test('critical sync presentations and help stay reachable during compact editing', async ({
    page,
    context,
}) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await expect(card).toBeVisible();
    await page.waitForTimeout(1200);
    await card.click({ position: { x: 100, y: 100 } });
    await card.getByRole('button', { name: 'Edit card' }).click();
    await page.setViewportSize({ width: 320, height: 400 });
    await context.setOffline(true);
    const status = page.locator('.board-sync-status');
    await expect(status).toContainText('Offline');
    await expect(status).toBeVisible();
    await context.setOffline(false);
    // Presentation-only fixtures for statuses that the backend-free demo cannot
    // produce. This verifies CSS/accessibility, not autosave behavior.
    for (const state of ['error', 'saving']) {
        await status.evaluate((element, value) => {
            element.className = `board-sync-status is-${value}`;
            element.textContent =
                value === 'error' ? 'Needs attention' : 'Saving…';
        }, state);
        await expect(status).toBeVisible();
        const statusBox = await status.boundingBox();
        const toolsBox = await card
            .locator('.post-it-hover-tools')
            .boundingBox();
        expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(
            toolsBox!.y
        );
    }
    await page.getByRole('button', { name: 'Help and shortcuts' }).click();
    await expect(page.locator('#board-help')).toBeVisible();
    await page.keyboard.press('Escape');
    await card.locator('.card-edit-done').click();
    await expect(card).not.toHaveClass(/is-editing/);
});

for (const lang of ['fr', 'en'] as const) {
    for (const theme of ['theme-dark', 'theme-light'] as const) {
        test(`editing stays reachable in ${lang} with ${theme} as the viewport shrinks`, async ({
            page,
            isMobile,
        }, testInfo) => {
            await page.setViewportSize({ width: 320, height: 640 });
            await page.addInitScript(
                (value) => localStorage.setItem('magnotes-theme', value),
                theme
            );
            await page.goto(`/app/?demo=1&lang=${lang}`);
            const card = page.locator('.post-it-card').first();
            await expect(card).toBeVisible();
            // The demo performs its initial auto-frame after loading.
            await page.waitForTimeout(1200);
            await card.click({ position: { x: 100, y: 100 } });
            await card
                .getByRole('button', {
                    name: lang === 'fr' ? 'Modifier la carte' : 'Edit card',
                })
                .click();
            const title = card.locator('.post-it-title');
            await title.fill('A note in progress');
            await title.focus();
            await title.evaluate((input: HTMLInputElement) =>
                input.setSelectionRange(2, 6)
            );
            await page.setViewportSize({ width: 320, height: 400 });
            await page.screenshot({
                path: testInfo.outputPath('editing-short.png'),
            });
            await expect(title).toHaveValue('A note in progress');
            await expect(title).toBeFocused();
            expect(
                await title.evaluate((input: HTMLInputElement) => [
                    input.selectionStart,
                    input.selectionEnd,
                ])
            ).toEqual([2, 6]);
            await expect(page.locator('.board-selection-bar')).toBeHidden();
            await expect(page.locator('.board-topbar-status')).toBeVisible();
            const box = await title.boundingBox();
            const topbar = await page.locator('.board-topbar').boundingBox();
            const dock = await page
                .locator('.mobile-board-actions')
                .boundingBox();
            const canvas = await page.locator('.board-canvas').boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(canvas!.x);
            expect(box!.y).toBeGreaterThanOrEqual(topbar!.y + topbar!.height);
            expect(box!.y + box!.height).toBeLessThanOrEqual(dock!.y);
            await card.getByTestId('card-expand').click({ timeout: 3000 });
            await expect(page.locator('.card-detail')).toBeVisible();
            await page.getByTestId('card-detail-leave').click();
            await expect(page.locator('.card-detail')).toBeHidden();
            await expect(title).toHaveValue('A note in progress');
            await title.focus();
            await page.setViewportSize({ width: 640, height: 320 });
            await expect(title).toHaveValue('A note in progress');
            await expect(title).toBeFocused();
            const rotated = await title.boundingBox();
            const rotatedBar = await page
                .locator('.board-topbar')
                .boundingBox();
            expect(rotated!.y).toBeGreaterThanOrEqual(
                rotatedBar!.y + rotatedBar!.height
            );
            expect(rotated!.y + rotated!.height).toBeLessThanOrEqual(320);
            if (isMobile)
                await expect(page.locator('.board-selection-bar')).toBeHidden();
            await page.setViewportSize({ width: 320, height: 640 });
            await card
                .getByRole('button', {
                    name:
                        lang === 'fr'
                            ? 'Terminer la modification'
                            : 'Finish editing',
                })
                .click();
            await expect(page.locator('.board-selection-bar')).toBeVisible();
            await expect(page.locator('.board-topbar-status')).toBeVisible();
        });
    }
}

test('pinch simulation keeps the draft and focused editor', async ({
    page,
    isMobile,
}) => {
    test.skip(!isMobile, 'Touch gesture exercised on mobile profiles');
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await expect(card).toBeVisible();
    await page.waitForTimeout(1200);
    await card.click({ position: { x: 100, y: 100 } });
    await card.getByRole('button', { name: 'Edit card' }).click();
    const title = card.locator('.post-it-title');
    await title.fill('Draft across zoom');
    await title.focus();
    const content = page.locator('.board-content');
    const before = await content.evaluate((element) => element.style.transform);
    await page.locator('.board-canvas').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const point = (x: number) => ({ clientX: x, clientY: rect.top + 30 });
        const send = (type: string, touches: ReturnType<typeof point>[]) => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'touches', { value: touches });
            element.dispatchEvent(event);
        };
        const x = rect.left + rect.width / 2;
        send('touchstart', [point(x - 20), point(x + 20)]);
        send('touchmove', [point(x - 40), point(x + 40)]);
        send('touchend', []);
    });
    await expect
        .poll(() => content.evaluate((element) => element.style.transform))
        .not.toBe(before);
    await expect(title).toHaveValue('Draft across zoom');
    await expect(title).toBeFocused();
});

test('the selection bar stays available while editing on a wide desktop', async ({
    page,
    isMobile,
}) => {
    test.skip(isMobile, 'Desktop layout check');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await expect(card).toBeVisible();
    await page.waitForTimeout(1200);
    await card.click({ position: { x: 100, y: 100 } });
    await card.getByRole('button', { name: 'Edit card' }).click();
    await expect(card).toHaveClass(/is-editing/);
    await expect(page.locator('.board-selection-bar')).toBeVisible();
});
