import { expect, test } from '@playwright/test';
import { startEditingCard } from './cardEditing';

// A toolbar button is "active" only while its panel is open: it lets go when
// the panel closes, and never keeps a sticky hover fill after a tap.

const TOOLS = [
    { name: /^card style$/i },
    { name: /^task/i },
    { name: /^image/i },
];

for (const tool of TOOLS) {
    test(`tool ${tool.name} is active only while its panel is open`, async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=en');
        const card = page.locator('.post-it-card').first();
        await startEditingCard(card);
        const button = card
            .locator('.post-it-hover-tools')
            .getByRole('button', { name: tool.name });

        await button.dispatchEvent('click');
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await expect(button).toHaveClass(/is-active/);

        await button.dispatchEvent('click');
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        await expect(button).not.toHaveClass(/is-active/);
    });
}

test('the task button shows a value marker, not the active state, when closed', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en');
    const card = page.locator('.post-it-card').first();
    await startEditingCard(card);
    const button = card
        .locator('.post-it-hover-tools')
        .getByRole('button', { name: /^task/i });
    await button.dispatchEvent('click');
    await page.locator('.task-choice').first().dispatchEvent('click');
    await button.dispatchEvent('click');
    await expect(button).toHaveClass(/has-value/);
    await expect(button).not.toHaveClass(/is-active/);
});
