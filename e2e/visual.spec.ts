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

type Rect = {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
};

const rectOf = async (page: Page, selector: string): Promise<Rect> =>
    page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height,
        };
    });

const expectAligned = (first: number, second: number) =>
    expect(Math.abs(first - second)).toBeLessThanOrEqual(1);

test.describe('visual layout contracts', () => {
    test.beforeEach(({ page }) => mockUnauthenticatedRefresh(page));

    test('keeps navigation, toolbar and board in independent regions', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1');
        await expect(page.locator('.board-canvas')).toBeVisible();

        const viewport = page.viewportSize();
        expect(viewport).not.toBeNull();
        const [topbar, sidebar, canvas] = await Promise.all([
            rectOf(page, '.board-topbar'),
            rectOf(page, '.board-sidebar'),
            rectOf(page, '.board-canvas'),
        ]);

        expectAligned(topbar.bottom, canvas.top);
        expectAligned(sidebar.top, canvas.top);
        expectAligned(sidebar.right, canvas.left);
        expect(canvas.right).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
        expect(canvas.bottom).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
        expect(canvas.width).toBeGreaterThan(200);
        expect(canvas.height).toBeGreaterThan(300);

        const hasDocumentOverflow = await page.evaluate(
            () =>
                document.documentElement.scrollWidth > window.innerWidth + 1 ||
                document.documentElement.scrollHeight > window.innerHeight + 1
        );
        expect(hasDocumentOverflow).toBe(false);

        if ((viewport?.width ?? 0) <= 620) {
            const mobileActions = await rectOf(page, '.mobile-board-actions');
            expect(mobileActions.left).toBeGreaterThanOrEqual(canvas.left);
            expect(mobileActions.right).toBeLessThanOrEqual(canvas.right + 1);
            expect(mobileActions.top).toBeGreaterThanOrEqual(canvas.top);
            expect(mobileActions.bottom).toBeLessThanOrEqual(canvas.bottom + 1);
        }
    });

    test('renders every board view inside the workspace', async ({ page }) => {
        await page.goto('/app/?demo=1');

        for (const view of ['kanban', 'agenda', 'timeline'] as const) {
            await page.locator(`[data-view-tab="${view}"]`).click();
            const altView = page.locator('.board-alt-view');
            await expect(altView).toBeVisible();
            const [workspace, surface] = await Promise.all([
                rectOf(page, '.board-workspace'),
                rectOf(page, '.board-alt-view'),
            ]);
            expect(surface.left).toBeGreaterThanOrEqual(workspace.left);
            expect(surface.right).toBeLessThanOrEqual(workspace.right + 1);
            expect(surface.top).toBeGreaterThanOrEqual(workspace.top);
            expect(surface.bottom).toBeLessThanOrEqual(workspace.bottom + 1);
        }
    });

    test('contains no visible mojibake in text or generated labels', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1');
        const corruption = await page.evaluate(() => {
            const generated = [...document.querySelectorAll('*')]
                .flatMap((element) => [
                    getComputedStyle(element, '::before').content,
                    getComputedStyle(element, '::after').content,
                ])
                .join(' ');
            const inspected = `${document.body.innerText} ${generated}`;
            return ['Ã', 'Â', 'â†', 'â€', 'âŒ', '�'].find((fragment) =>
                inspected.includes(fragment)
            );
        });

        expect(corruption).toBeUndefined();
    });

    test('matches the stable demo-board visual reference', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-08-27T12:00:00Z'));
        await page.goto('/app/?demo=1');
        await expect(page.locator('.post-it-card')).toHaveCount(6);
        await expect(page.locator('.board-loading')).toBeHidden();
        const viewport = page.viewportSize();
        const frameButton =
            (viewport?.width ?? 0) <= 620
                ? page.locator('.mobile-board-actions button').last()
                : page.locator('.board-zoom-controls button').last();
        await frameButton.click();
        // Capture an explicitly framed state. This avoids making the pixel
        // reference depend on the asynchronous first-board onboarding race.

        await expect(page).toHaveScreenshot('demo-board.png', {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.03,
        });
    });
});
