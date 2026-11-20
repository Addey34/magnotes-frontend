import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
    await page.route('**/api/send*', (route) => route.abort());
    await page.route('**/*', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/send') return route.abort();
        const html =
            pathname === '/' ||
            pathname === '/en/' ||
            pathname.includes('/templates/');
        if (!html && !pathname.startsWith('/img/')) return route.continue();
        const root = resolve('firebase-dist');
        const file = html
            ? resolve(root, `.${pathname}`, 'index.html')
            : resolve(root, `.${pathname}`);
        if (!file.startsWith(root + sep))
            throw new Error('Invalid fixture path');
        await route.fulfill({
            contentType: html ? 'text/html' : 'image/jpeg',
            body: await readFile(file, 'utf8'),
        });
    });
});

for (const lang of ['fr', 'en'] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
        test(`gallery discovery ${lang} ${colorScheme}`, async ({
            page,
        }, testInfo) => {
            await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
            const prefix = lang === 'en' ? '/en' : '';
            await page.goto(`${prefix}/?analytics=off`);
            const landingScan = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();
            expect(landingScan.violations).toEqual([]);
            await page
                .locator('[data-umami-event="landing_templates_opened"]')
                .click();
            await expect(page.locator('.template-card').first()).toBeVisible();
            await expect(page.locator('.nav-links .btn').first()).toBeVisible();
            await expect(page.locator('.brand')).toHaveAttribute(
                'href',
                lang === 'en' ? '/en/' : '/'
            );
            await expect(
                page.locator('.nav-links .btn-primary')
            ).toHaveAttribute('href', `/app/?lang=${lang}`);
            const background = await page
                .locator('body')
                .evaluate(
                    (element) => getComputedStyle(element).backgroundColor
                );
            expect(background).toBe(
                colorScheme === 'dark'
                    ? 'rgb(20, 20, 28)'
                    : 'rgb(246, 247, 251)'
            );
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth - innerWidth
                )
            ).toBeLessThanOrEqual(0);
            await page.screenshot({
                path: testInfo.outputPath('gallery.png'),
                fullPage: true,
            });
            const scan = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();
            expect(scan.violations).toEqual([]);
            await page.locator('.template-card').first().click();
            await expect(page.locator('.board-preview')).toBeVisible();
            const detailScan = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();
            expect(detailScan.violations).toEqual([]);
            await page.locator('.actions .btn-primary').click();
            await expect(page.locator('.post-it-card').first()).toBeVisible();
            await expect(page.locator('.demo-banner')).toBeVisible();
        });
    }
}
