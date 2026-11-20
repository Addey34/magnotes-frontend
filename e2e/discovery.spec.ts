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
        // Read as raw bytes: decoding JPEGs as UTF-8 corrupts them.
        await route.fulfill({
            contentType: html ? 'text/html' : 'image/jpeg',
            body: await readFile(file),
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
            const shot = await page.screenshot({
                path: testInfo.outputPath('gallery.png'),
                fullPage: true,
            });
            // PNG signature + non-trivial payload: the capture is intact.
            expect(shot.subarray(0, 8).toString('hex')).toBe(
                '89504e470d0a1a0a'
            );
            expect(shot.length).toBeGreaterThan(5_000);
            const brokenImages = await page.evaluate(async () => {
                const imgs = [...document.images].filter((img) =>
                    img.src.includes('/img/')
                );
                await Promise.all(
                    imgs.map((img) => img.decode().catch(() => undefined))
                );
                return {
                    count: imgs.length,
                    broken: imgs
                        .filter(
                            (img) =>
                                !img.complete ||
                                img.naturalWidth < 100 ||
                                img.naturalHeight < 100
                        )
                        .map((img) => img.src),
                };
            });
            expect(brokenImages.broken).toEqual([]);
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

test('landing CTAs, language switch and funnel attributes', async ({
    page,
}) => {
    await page.goto('/?analytics=off');
    // Landing images are real JPEGs, not UTF-8-mangled bytes.
    const landingImages = await page.evaluate(async () => {
        const imgs = [...document.images].filter((img) =>
            img.src.includes('/img/view-')
        );
        imgs.forEach((img) => (img.loading = 'eager'));
        await Promise.all(imgs.map((img) => img.decode().catch(() => 0)));
        return imgs.map((img) => [img.naturalWidth, img.naturalHeight]);
    });
    expect(landingImages.length).toBeGreaterThan(0);
    for (const [w, h] of landingImages) {
        expect(w).toBeGreaterThan(100);
        expect(h).toBeGreaterThan(100);
    }
    // Funnel: each CTA carries its Umami event and the right destination.
    const demo = page.locator('[data-umami-event="landing_demo_started"]');
    for (const cta of await demo.all())
        await expect(cta).toHaveAttribute('href', '/app/?demo=1&lang=fr');
    for (const cta of await page
        .locator('[data-umami-event="landing_signup_clicked"]')
        .all())
        await expect(cta).toHaveAttribute('href', '/app/?lang=fr&signup=1');
    // Language switch lands on the EN page and keeps EN CTAs.
    await page.locator('a.btn-ghost[href="/en/"]').first().click();
    await expect(page).toHaveURL(/\/en\/\?|\/en\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(demo.first()).toHaveAttribute('href', '/app/?demo=1&lang=en');
    // Real navigation of the demo CTA.
    await Promise.all([
        page.waitForURL(/\/app\/\?demo=1&lang=en/),
        demo.first().click(),
    ]);
});
