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

const openDemo = async (page: Page) => {
    await mockUnauthenticatedRefresh(page);
    await page.goto('/app/?demo=1');
    await expect(page.locator('.board-app')).toBeVisible();
    await expect(page.locator('.post-it-card').first()).toBeVisible();
};

test.describe('critical demo journeys', () => {
    test('opens a public template directly in the demo', async ({ page }) => {
        await mockUnauthenticatedRefresh(page);
        await page.goto('/app/?demo=1&template=client-project');

        await expect(page.locator('.board-app')).toBeVisible();
        await expect(
            page.locator('.post-it-title[value="Brief and objectives"]')
        ).toBeVisible();
        await expect(page.locator('.board-title-trigger')).toHaveText(
            'Client project'
        );
    });

    test('creates and edits a card', async ({ page }) => {
        await openDemo(page);

        const cards = page.locator('.post-it-card');
        const initialCount = await cards.count();
        await page.locator('.create-card-button').click();
        await expect(cards).toHaveCount(initialCount + 1);

        const card = cards.last();
        await card.locator('.post-it-title').fill('E2E note');
        await card
            .locator('.post-it-content')
            .fill('Created and edited through the demo flow.');
        await card.locator('.post-it-content').blur();

        await expect(card.locator('.post-it-title')).toHaveValue('E2E note');
        await expect
            .poll(() =>
                page.evaluate(
                    () => localStorage.getItem('magnotes-demo-board-v1') || ''
                )
            )
            .toContain('E2E note');
    });

    test('quick capture creates a titled card from the command palette', async ({
        page,
    }) => {
        await openDemo(page);

        await page.locator('.command-palette-trigger').click();
        const palette = page.locator('.command-palette');
        await expect(palette).toBeVisible();
        await palette.locator('input').fill('E2E quick capture');
        await palette.locator('.command-palette-item').first().click();

        await expect
            .poll(() =>
                page
                    .locator('.post-it-title')
                    .evaluateAll((inputs) =>
                        inputs.some(
                            (input) =>
                                (input as HTMLInputElement).value ===
                                'E2E quick capture'
                        )
                    )
            )
            .toBe(true);
    });

    test('imports a Notion database CSV into cards', async ({ page }) => {
        await openDemo(page);

        await page.locator('input[type="file"]').setInputFiles({
            name: 'notion-tasks.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(
                'Name,Description,Status,Due date,Tags\n' +
                    'Launch page,"Copy, screenshots",In progress,2026-09-04,"marketing, urgent"'
            ),
        });

        const importedCard = page.locator('.post-it-card').filter({
            has: page.locator('.post-it-title[value="Launch page"]'),
        });
        await expect(importedCard).toBeVisible();
        await expect(importedCard.locator('.post-it-content')).toContainText(
            'Copy, screenshots'
        );
    });

    test('switches between the four board views', async ({ page }) => {
        await openDemo(page);

        for (const [tab, view] of [
            ['canvas', '.board-canvas'],
            ['kanban', '.board-kanban'],
            ['agenda', '.board-agenda'],
            ['timeline', '.board-timeline'],
        ]) {
            await page.locator('[data-view-tab=' + tab + ']').click();
            await expect(page.locator(view)).toBeVisible();
        }
    });
});
