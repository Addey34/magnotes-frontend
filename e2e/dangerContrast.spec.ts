import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const KEY = 'magnotes-demo-board-v1';
const THEMES = ['theme-dark', 'theme-light'] as const;

/**
 * Destructive actions and error/alert texts must keep 4.5:1 in both
 * luminosities. Screens that demo mode cannot reach (account dialogs, feedback
 * error) are measured by mounting the real classes inside the real shells and
 * reading computed colors, so the assertion does not depend on axe resolving a
 * background it may report as "incomplete".
 */
const open = async (page: Page, theme: string) => {
    await page.addInitScript((value) => {
        localStorage.setItem('magnotes-lang', 'en');
        localStorage.setItem('magnotes-theme', value);
    }, theme);
    await page.route('**/api/auth/refresh', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'No active session' }),
        })
    );
    await page.goto('/app/?demo=1');
    await expect(page.locator('.post-it-card').first()).toBeVisible();
    // A few overdue cards, so the overdue badges and column exist.
    await page.evaluate((key) => {
        const store = JSON.parse(localStorage.getItem(key) as string);
        store.postIts.slice(0, 4).forEach((card: { dueDate?: string }) => {
            card.dueDate = '2020-01-01';
        });
        localStorage.setItem(key, JSON.stringify(store));
    }, KEY);
    await page.reload();
    await expect(page.locator('.post-it-card').first()).toBeVisible();
};

const colorViolations = async (page: Page) => {
    const results = await new AxeBuilder({ page })
        .withRules(['color-contrast'])
        .analyze();
    return results.violations.flatMap((violation) =>
        violation.nodes.map(
            (node) =>
                `${node.html.slice(0, 100)} :: ${node.any[0]?.message ?? ''}`
        )
    );
};

/** WCAG contrast of each element's text against its composited background. */
const measure = (page: Page, selectors: Record<string, string>) =>
    page.evaluate((map) => {
        type Rgba = [number, number, number, number];
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const rgba = (css: string): Rgba => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = '#000';
            ctx.fillStyle = css;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
            return [r, g, b, a / 255];
        };
        const over = (top: Rgba, under: Rgba): Rgba => {
            const a = top[3] + under[3] * (1 - top[3]);
            if (a === 0) return [0, 0, 0, 0];
            const mix = (i: 0 | 1 | 2) =>
                (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
            return [mix(0), mix(1), mix(2), a];
        };
        const lum = ([r, g, b]: Rgba) => {
            const f = (c: number) => {
                const s = c / 255;
                return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const out: Record<string, number> = {};
        for (const [name, selector] of Object.entries(map)) {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (!el) {
                out[name] = -1;
                continue;
            }
            // Composite the backgrounds from the element up to the root.
            let bg: Rgba = [0, 0, 0, 0];
            for (
                let node: HTMLElement | null = el;
                node && bg[3] < 0.999;
                node = node.parentElement
            ) {
                bg = over(bg, rgba(getComputedStyle(node).backgroundColor));
            }
            bg = over(bg, [255, 255, 255, 1]);
            const fg = over(rgba(getComputedStyle(el).color), bg);
            const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
            out[name] = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
        }
        return out;
    }, selectors);

for (const theme of THEMES) {
    test.describe(`danger and error contrast (${theme})`, () => {
        test('selection bar, overdue badges and overdue views', async ({
            page,
        }) => {
            await open(page, theme);
            const badge = await measure(page, {
                canvasOverdueBadge: '.post-it-badge.due-badge.is-overdue',
            });
            expect(badge.canvasOverdueBadge).toBeGreaterThanOrEqual(4.5);

            await page.locator('.create-card-button').click();
            const selection = await measure(page, {
                selectionDelete: '.board-selection-bar button.is-danger',
            });
            expect(selection.selectionDelete).toBeGreaterThanOrEqual(4.5);

            for (const view of ['kanban', 'timeline']) {
                await page.locator(`[data-view-tab="${view}"]`).click();
                await expect(
                    page.locator(`[data-view-tab="${view}"]`)
                ).toHaveAttribute('aria-selected', 'true');
                expect(await colorViolations(page)).toEqual([]);
            }
        });

        test('screens demo mode cannot reach, measured in their real shells', async ({
            page,
        }) => {
            await open(page, theme);
            await page.evaluate(() => {
                document.querySelector('.board-app')!.insertAdjacentHTML(
                    'beforeend',
                    `<div class="share-dialog feedback-dialog" style="position:static"><p class="feedback-dialog__error" id="p-feedback">Error</p></div>
                     <div class="account-dialog" style="position:static">
                        <p class="account-dialog-error" id="p-account-error">Error</p>
                        <div class="account-dialog-actions"><button class="is-danger" id="p-account-delete">Delete</button></div>
                     </div>
                     <div class="board-brand-menu" style="position:static;opacity:1;transform:none;visibility:visible"><button class="is-danger" id="p-menu-delete"><span>Delete account</span></button></div>
                     <div class="connection-tools" style="position:static"><button class="is-danger" id="p-connection"><span>Delete link</span></button></div>`
                );
            });
            const ratios = await measure(page, {
                feedbackError: '#p-feedback',
                accountError: '#p-account-error',
                accountDeleteButton: '#p-account-delete',
                brandMenuDelete: '#p-menu-delete span',
                connectionDelete: '#p-connection span',
            });
            for (const [name, ratio] of Object.entries(ratios)) {
                expect(ratio, `${name} (${theme})`).toBeGreaterThanOrEqual(4.5);
            }
        });
    });
}
