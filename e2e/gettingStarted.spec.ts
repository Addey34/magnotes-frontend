import { expect, test } from '@playwright/test';

for (const lang of ['fr', 'en'] as const) {
    for (const theme of ['theme-dark', 'theme-light'] as const) {
        test(`discover the board in ${lang} with ${theme}`, async ({
            page,
            isMobile,
        }, testInfo) => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.addInitScript((initialTheme) => {
                localStorage.setItem('magnotes-theme', initialTheme);
            }, theme);
            await page.goto(`/app/?demo=1&lang=${lang}`);
            await expect(page.locator('.post-it-card').first()).toBeVisible();
            const label =
                lang === 'fr' ? 'Aide et raccourcis' : 'Help and shortcuts';
            const button = page.getByRole('button', { name: label });
            const help = page.locator('#board-help');
            await expect(button).toHaveAttribute('aria-expanded', 'false');
            await button.click();
            await expect(button).toHaveAttribute('aria-expanded', 'true');
            await expect(help).toBeVisible();
            await expect(help).toContainText(
                lang === 'fr' ? 'Kanban' : 'Timeline'
            );
            await expect(
                help.locator(isMobile ? '.touch-help' : '.pointer-help').first()
            ).toBeVisible();
            const box = await help.boundingBox();
            const viewport = page.viewportSize();
            expect(box).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
            expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
            expect(
                await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth -
                        document.documentElement.clientWidth
                )
            ).toBeLessThanOrEqual(0);
            await page.screenshot({ path: testInfo.outputPath('help.png') });
            await button.click();
            await expect(help).toBeHidden();
            await button.click();
            await page.keyboard.press('Escape');
            await expect(help).toBeHidden();
            await button.click();
            await page
                .locator('.board-canvas')
                .click({ position: { x: 10, y: 10 }, force: true });
            await expect(help).toBeHidden();
            await page.locator('[data-view-tab="kanban"]').click();
            await expect(
                page.locator('[data-view-tab="kanban"]')
            ).toHaveAttribute('aria-selected', 'true');
            await page.locator('[data-view-tab="canvas"]').click();
            const cards = page.locator('.post-it-card');
            const count = await cards.count();
            await page
                .locator(
                    '.create-card-button:visible, .mobile-board-action.is-primary:visible'
                )
                .first()
                .click();
            await expect(cards).toHaveCount(count + 1);
            await expect(
                page.locator('.post-it-card.is-editing .post-it-title')
            ).toBeFocused();
        });
    }
}
