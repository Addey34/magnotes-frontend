import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const mockUnauthenticatedRefresh = async (page: Page) => {
    await page.route('**/api/auth/refresh', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'No active session' }),
        })
    );
};
const viewports = [
    { width: 320, height: 740 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
];

test.describe('authentication surface', () => {
    test.beforeEach(({ page }) => mockUnauthenticatedRefresh(page));
    test('renders and stays within the viewport at supported sizes', async ({
        page,
    }) => {
        for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            await page.goto('/app/');
            await expect(page.locator('.auth-page')).toBeVisible();
            await expect(page.locator('#email')).toBeVisible();

            const hasHorizontalOverflow = await page.evaluate(
                () =>
                    document.documentElement.scrollWidth > window.innerWidth + 1
            );
            expect(hasHorizontalOverflow).toBe(false);
        }
    });

    test('keeps the active form and primary action visible at keyboard height', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 500 });
        await page.goto('/app/');

        await page.getByRole('button', { name: /create an account/i }).click();
        const confirmation = page.locator('#confirm-password');
        await confirmation.focus();

        const submit = page.locator('.auth-submit');
        await expect(confirmation).toBeVisible();
        await expect(submit).toBeVisible();
        const bounds = await submit.boundingBox();
        expect(bounds).not.toBeNull();
        expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
            500
        );
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth + 1
            )
        ).toBe(false);
    });
});

test.describe('guest demo surface', () => {
    test.beforeEach(({ page }) => mockUnauthenticatedRefresh(page));
    test('opens the local board without requiring an account', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1');
        await expect(page.locator('.board-app')).toBeVisible();
        await expect(page.locator('.demo-banner')).toBeVisible();

        if ((page.viewportSize()?.width ?? 0) <= 620) {
            await expect(page.locator('.mobile-board-actions')).toBeVisible();
            await expect(
                page.locator('.mobile-board-action.is-primary')
            ).toBeVisible();
        }

        const hasHorizontalOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1
        );
        expect(hasHorizontalOverflow).toBe(false);
    });

    test('seeds a fully English welcome board for English users', async ({
        page,
    }) => {
        await page.addInitScript(() => {
            localStorage.setItem('magnotes-lang', 'en');
        });
        await page.goto('/app/?demo=1');

        await expect(page.locator('.board-tab-name').first()).toHaveText(
            'Welcome'
        );
        await expect(page.locator('.post-it-title').first()).toHaveValue(
            'Welcome to MagNotes 👋'
        );
        await expect(page.locator('.post-it-card').first()).toContainText(
            'This board is yours.'
        );
    });

    test('keeps card editing visible at keyboard height', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 500 });
        await page.goto('/app/?demo=1');

        const card = page.locator('.post-it-card').first();
        const title = card.locator('.post-it-title');
        await title.focus();

        const [titleBounds, actionsBounds] = await Promise.all([
            title.boundingBox(),
            page.locator('.mobile-board-actions').boundingBox(),
        ]);
        expect(titleBounds).not.toBeNull();
        expect(actionsBounds).not.toBeNull();
        expect(titleBounds?.y ?? 500).toBeGreaterThanOrEqual(0);
        expect((titleBounds?.y ?? 0) + (titleBounds?.height ?? 0)).toBeLessThan(
            actionsBounds?.y ?? 500
        );
    });

    test('preserves in-progress editing through portrait and landscape rotation', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/app/?demo=1');

        const title = page.locator('.post-it-title').first();
        await title.fill('Rotation-safe note');
        await page.setViewportSize({ width: 844, height: 390 });

        await expect(title).toHaveValue('Rotation-safe note');
        await expect(page.locator('.board-topbar')).toBeVisible();
        await expect(page.locator('.board-workspace')).toBeVisible();
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth + 1
            )
        ).toBe(false);
    });

    test('keeps command and card dialogs inside a compact mobile viewport', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 320, height: 500 });
        await page.goto('/app/?demo=1');

        await page.locator('.mobile-board-action').nth(1).click();
        const palette = page.locator('.command-palette');
        await expect(palette).toBeVisible();
        const paletteBounds = await palette.boundingBox();
        expect(paletteBounds).not.toBeNull();
        expect(paletteBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect(
            (paletteBounds?.x ?? 0) + (paletteBounds?.width ?? 0)
        ).toBeLessThanOrEqual(320);
        expect(paletteBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
        expect(
            (paletteBounds?.y ?? 0) + (paletteBounds?.height ?? 0)
        ).toBeLessThanOrEqual(500);
        await page.keyboard.press('Escape');

        const cards = page.locator('.post-it-card');
        const visibleCardIndex = await cards.evaluateAll((elements) => {
            let bestIndex = -1;
            let bestArea = 0;
            elements.forEach((element, index) => {
                const rect = element.getBoundingClientRect();
                const width = Math.max(
                    0,
                    Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)
                );
                const height = Math.max(
                    0,
                    Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)
                );
                if (width * height > bestArea) {
                    bestArea = width * height;
                    bestIndex = index;
                }
            });
            return bestIndex;
        });
        expect(visibleCardIndex).toBeGreaterThanOrEqual(0);
        const visibleCard = cards.nth(visibleCardIndex);
        await visibleCard.locator('.post-it-title').focus();
        const expand = visibleCard.getByRole('button', { name: /expand/i });
        await expect(expand).toBeVisible();
        await expand.click();

        const detail = page.locator('.card-detail');
        await expect(detail).toBeVisible();
        await expect(detail.locator('.card-detail-editor')).toBeVisible();
        await expect(detail.locator('.card-detail-close')).toBeVisible();
        const detailBounds = await detail.boundingBox();
        expect(detailBounds).not.toBeNull();
        expect(detailBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect(
            (detailBounds?.x ?? 0) + (detailBounds?.width ?? 0)
        ).toBeLessThanOrEqual(320);
        expect(detailBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
        expect(
            (detailBounds?.y ?? 0) + (detailBounds?.height ?? 0)
        ).toBeLessThanOrEqual(500);
        await detail.locator('.card-detail-close').click();
        await expect(detail).toBeHidden();
    });

    test('sidebar expands on hover without covering the workspace', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/app/?demo=1');

        const sidebar = page.locator('.board-sidebar');
        const workspace = page.locator('.board-workspace');
        const topbar = page.locator('.board-topbar');
        const collapsedWidth = await sidebar.evaluate((element) =>
            Math.round(element.getBoundingClientRect().width)
        );

        expect(collapsedWidth).toBeLessThan(100);

        const collapsedWorkspaceLeft = await workspace.evaluate((element) =>
            Math.round(element.getBoundingClientRect().left)
        );

        await sidebar.hover();
        await expect
            .poll(
                () =>
                    sidebar.evaluate((element) =>
                        Math.round(element.getBoundingClientRect().width)
                    ),
                { timeout: 1500 }
            )
            .toBeGreaterThan(180);

        const workspaceLeft = await workspace.evaluate((element) =>
            Math.round(element.getBoundingClientRect().left)
        );

        expect(workspaceLeft).toBe(collapsedWorkspaceLeft);

        const topbarBounds = await topbar.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                left: Math.round(rect.left),
                right: Math.round(rect.right),
            };
        });
        expect(topbarBounds.left).toBe(0);
        expect(topbarBounds.right).toBe(1440);

        await page.locator('.board-canvas').hover({
            position: { x: 420, y: 300 },
        });
        await expect
            .poll(
                () =>
                    sidebar.evaluate((element) =>
                        Math.round(element.getBoundingClientRect().width)
                    ),
                { timeout: 1500 }
            )
            .toBeLessThan(100);
    });

    test('page customization keeps the custom color inline and dismisses outside', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/app/?demo=1');

        await page.locator('.board-sidebar').hover();
        const menu = page.locator('.board-tab-menu').first();
        await menu.locator('summary').click();

        const popover = menu.locator('.board-tab-popover');
        await expect(popover).toBeVisible();

        const preset = popover.locator('.board-tab-options button').first();
        const customColor = popover.locator('.board-tab-custom-color');
        const [presetRect, customRect] = await Promise.all([
            preset.boundingBox(),
            customColor.boundingBox(),
        ]);
        expect(presetRect).not.toBeNull();
        expect(customRect).not.toBeNull();
        expect(
            Math.abs((presetRect?.y ?? 0) - (customRect?.y ?? 0))
        ).toBeLessThan(2);

        await page.locator('.board-workspace').click({
            position: { x: 420, y: 300 },
        });
        await expect(popover).toBeHidden();
    });

    test('responsive toolbar keeps appearance and palette usable', async ({
        page,
    }) => {
        for (const viewport of [
            { width: 390, height: 844 },
            { width: 768, height: 1024 },
        ]) {
            await page.setViewportSize(viewport);
            await page.goto('/app/?demo=1');

            const tools = page.locator('.board-topbar-tools');
            await expect(tools).toBeVisible();
            if (viewport.width < 1180) {
                await expect(tools).toHaveCSS('overflow-x', 'auto');
            }

            const appearanceTrigger = page.locator('.board-appearance-trigger');
            await appearanceTrigger.scrollIntoViewIfNeeded();
            await appearanceTrigger.click();
            const appearancePanel = page.locator('.board-appearance-panel');
            await expect(appearancePanel).toBeVisible();
            const appearanceRect = await appearancePanel.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                };
            });
            expect(appearanceRect.left).toBeGreaterThanOrEqual(0);
            expect(appearanceRect.right).toBeLessThanOrEqual(viewport.width);
            expect(appearanceRect.top).toBeGreaterThanOrEqual(0);
            expect(appearanceRect.bottom).toBeLessThanOrEqual(viewport.height);

            await page.keyboard.press('Escape');
            if (viewport.width <= 820) {
                const colorFilter = page.locator('.board-color-filter');
                await colorFilter.locator('summary').click();
                const colorPopover = page.locator(
                    '.board-color-filter-popover'
                );
                await expect(colorPopover).toBeVisible();
                const colorMetrics = await colorPopover.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return {
                        left: rect.left,
                        right: rect.right,
                        scrollWidth: element.scrollWidth,
                        clientWidth: element.clientWidth,
                    };
                });
                expect(colorMetrics.left).toBeGreaterThanOrEqual(0);
                expect(colorMetrics.right).toBeLessThanOrEqual(viewport.width);
                expect(colorMetrics.scrollWidth).toBeLessThanOrEqual(
                    colorMetrics.clientWidth + 1
                );
                await page.keyboard.press('Escape');
            }
            await page
                .locator('.command-palette-trigger')
                .scrollIntoViewIfNeeded();
            await page.locator('.command-palette-trigger').click();
            const palette = page.locator('.command-palette');
            await expect(palette).toBeVisible();
            const paletteRect = await palette.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right };
            });
            expect(paletteRect.left).toBeGreaterThanOrEqual(0);
            expect(paletteRect.right).toBeLessThanOrEqual(viewport.width);
        }
    });

    test('mobile chrome stays fixed and two-finger gestures zoom only the canvas', async ({
        page,
        browserName,
    }, testInfo) => {
        test.skip(
            browserName !== 'chromium' ||
                !testInfo.project.name.includes('mobile'),
            'The multi-touch assertion runs in the Chromium mobile project'
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/app/?demo=1');

        const sidebar = page.locator('.board-sidebar');
        const canvas = page.locator('.board-canvas');
        const [sidebarBox, canvasBox] = await Promise.all([
            sidebar.boundingBox(),
            canvas.boundingBox(),
        ]);
        expect(sidebarBox).not.toBeNull();
        expect(canvasBox).not.toBeNull();
        expect(Math.round(sidebarBox?.y ?? 0)).toBe(
            Math.round(canvasBox?.y ?? 0)
        );

        const content = page.locator('.board-content');
        const transformBefore = await content.evaluate(
            (element) => element.style.transform
        );
        const session = await page.context().newCDPSession(page);
        const pageScaleBefore = await page.evaluate(
            () => window.visualViewport?.scale ?? 1
        );

        if (!sidebarBox) throw new Error('No sidebar available for pinch test');
        const sidebarCenter = {
            x: sidebarBox.x + sidebarBox.width / 2,
            y: sidebarBox.y + Math.min(120, sidebarBox.height / 2),
        };
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
                { x: sidebarCenter.x - 8, y: sidebarCenter.y, id: 1 },
                { x: sidebarCenter.x + 8, y: sidebarCenter.y, id: 2 },
            ],
        });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
                { x: sidebarCenter.x - 20, y: sidebarCenter.y, id: 1 },
                { x: sidebarCenter.x + 20, y: sidebarCenter.y, id: 2 },
            ],
        });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        });

        expect(
            await content.evaluate((element) => element.style.transform)
        ).toBe(transformBefore);
        expect(
            await page.evaluate(() => window.visualViewport?.scale ?? 1)
        ).toBe(pageScaleBefore);
        expect(await sidebar.boundingBox()).toEqual(sidebarBox);

        const cards = page.locator('.post-it-card');
        const cardIndex = await cards.evaluateAll((elements) =>
            elements.findIndex((element) => {
                const rect = element.getBoundingClientRect();
                return (
                    rect.left >= 0 &&
                    rect.right <= innerWidth &&
                    rect.top >= 0 &&
                    rect.bottom <= innerHeight
                );
            })
        );
        expect(cardIndex).toBeGreaterThanOrEqual(0);
        const cardBox = await cards.nth(cardIndex).boundingBox();
        if (!cardBox) throw new Error('No card available for pinch test');
        const x = cardBox.x + cardBox.width / 2;
        const y = cardBox.y + cardBox.height / 2;
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
                { x: x - 20, y, id: 1 },
                { x: x + 20, y, id: 2 },
            ],
        });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
                { x: x - 130, y, id: 1 },
                { x: x + 130, y, id: 2 },
            ],
        });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        });

        await expect
            .poll(() => content.evaluate((element) => element.style.transform))
            .not.toBe(transformBefore);
        const transformZoomed = await content.evaluate(
            (element) => element.style.transform
        );

        // A second, inward pinch must remain available after the board hits its
        // maximum zoom. This reproduces the iOS report where the whole page was
        // enlarged and could no longer be zoomed back out.
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
                { x: x - 120, y, id: 1 },
                { x: x + 120, y, id: 2 },
            ],
        });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
                { x: x - 20, y, id: 1 },
                { x: x + 20, y, id: 2 },
            ],
        });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        });

        await expect
            .poll(() => content.evaluate((element) => element.style.transform))
            .not.toBe(transformZoomed);
        expect(
            await page.evaluate(() => window.visualViewport?.scale ?? 1)
        ).toBe(pageScaleBefore);
    });

    test('a native touch drag moves a card without breaking mobile editing', async ({
        page,
        browserName,
    }, testInfo) => {
        test.skip(
            browserName !== 'chromium' ||
                testInfo.project.name !== 'chromium-touch',
            'The native touch drag assertion runs in the isolated Chromium touch project'
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/app/?demo=1');

        const cards = page.locator('.post-it-card');
        await expect(cards.first()).toBeVisible();
        const findExposedCard = () =>
            cards.evaluateAll((elements) =>
                elements.findIndex((element) => {
                    const dragArea = element.querySelector('.post-it-date');
                    if (!dragArea) return false;
                    const rect = dragArea.getBoundingClientRect();
                    const topmost = document.elementFromPoint(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2
                    );
                    return topmost?.closest('.post-it-card') === element;
                })
            );
        await expect.poll(findExposedCard).toBeGreaterThanOrEqual(0);
        const exposedCardIndex = await findExposedCard();
        const card = cards.nth(exposedCardIndex);
        const before = await card.boundingBox();
        const dragArea = await card.locator('.post-it-date').boundingBox();
        if (!before || !dragArea)
            throw new Error('No visible card geometry for touch drag.');

        const viewportWidth = page.viewportSize()?.width ?? 390;
        const leftSpace = before.x;
        const rightSpace = viewportWidth - (before.x + before.width);
        const deltaX = rightSpace >= leftSpace ? 60 : -60;
        const start = {
            x: dragArea.x + dragArea.width / 2,
            y: dragArea.y + dragArea.height / 2,
        };
        const session = await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
                { ...start, id: 1, radiusX: 1, radiusY: 1, force: 1 },
            ],
        });
        await page.waitForTimeout(80);
        for (let step = 1; step <= 6; step += 1) {
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [
                    {
                        x: start.x + (deltaX * step) / 6,
                        y: start.y + (45 * step) / 6,
                        id: 1,
                        radiusX: 1,
                        radiusY: 1,
                        force: 1,
                    },
                ],
            });
            await page.waitForTimeout(60);
        }
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        });

        await expect
            .poll(async () => {
                const current = await card.boundingBox();
                return current ? Math.abs(current.x - before.x) : 0;
            })
            .toBeGreaterThan(30);

        const title = card.locator('.post-it-title');
        await title.fill('Note tactile QA');
        await expect(title).toHaveValue('Note tactile QA');
        const hasHorizontalOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1
        );
        expect(hasHorizontalOverflow).toBe(false);
    });

    test('view tabs support keyboard navigation', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/app/?demo=1');

        const canvasTab = page.locator('[data-view-tab="canvas"]');
        const kanbanTab = page.locator('[data-view-tab="kanban"]');
        await canvasTab.focus();
        await canvasTab.press('ArrowRight');

        await expect(kanbanTab).toHaveAttribute('aria-selected', 'true');
        await expect(kanbanTab).toBeFocused();
    });
});
test.describe('accessibility smoke checks', () => {
    test.beforeEach(({ page }) => mockUnauthenticatedRefresh(page));
    test('auth screen has no serious or critical violations', async ({
        page,
    }) => {
        await page.goto('/app/');

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .analyze();
        const blockingViolations = results.violations.filter((violation) =>
            ['serious', 'critical'].includes(violation.impact ?? '')
        );

        expect(blockingViolations).toEqual([]);
    });

    test('guest board has no serious or critical violations', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1');

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .analyze();
        const blockingViolations = results.violations.filter((violation) =>
            ['serious', 'critical'].includes(violation.impact ?? '')
        );

        expect(blockingViolations).toEqual([]);
    });
});
