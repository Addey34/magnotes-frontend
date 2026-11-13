import { expect, test, type Locator, type Page } from '@playwright/test';

// Typing `[[` in a card opens a list of the board's card titles. Runs on the
// demo board (no backend), on every touch and desktop profile.

const openDemo = async (page: Page): Promise<string> => {
    await page.goto('/app/?demo=1&lang=en');
    await expect(page.locator('.post-it-title').first()).toBeVisible();
    const titles = await page
        .locator('.post-it-title')
        .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value.trim())
        );
    const target = titles.find((title) => title.length >= 4);
    if (!target) throw new Error('The demo board has no card to mention.');
    return target;
};

// A new card opens straight in edit mode, with a body ready to type in.
const newCardBody = async (page: Page): Promise<Locator> => {
    await page
        .locator(
            '.create-card-button:visible, .mobile-board-action.is-primary:visible'
        )
        .first()
        .click();
    const editing = page.locator('.post-it-card.is-editing');
    await expect(editing).toBeVisible();
    const body = editing.locator('textarea.post-it-content');
    await body.click();
    return body;
};

test.describe('[[ mention autocomplete', () => {
    test('offers matching titles and inserts the one that is tapped', async ({
        page,
    }) => {
        const target = await openDemo(page);
        const body = await newCardBody(page);
        await body.pressSequentially(`see [[${target.slice(0, 3)}`);

        const list = page.locator('.post-it-mention-suggest');
        await expect(list).toBeVisible();
        const option = list.getByRole('option', { name: target, exact: true });
        await expect(option).toBeVisible();

        // The list stays inside its card and never widens the page.
        const card = page.locator('.post-it-card.is-editing');
        const cardBox = await card.boundingBox();
        const listBox = await list.boundingBox();
        if (!cardBox || !listBox) throw new Error('Missing layout boxes.');
        expect(listBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
        expect(listBox.x + listBox.width).toBeLessThanOrEqual(
            cardBox.x + cardBox.width + 1
        );
        const overflow = await page.evaluate(
            () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);

        await option.click();
        await expect(body).toHaveValue(`see [[${target}]]`);
        await expect(list).toBeHidden();
    });

    test('keyboard: arrows move, Enter inserts, text continues after ]]', async ({
        page,
    }) => {
        const target = await openDemo(page);
        const body = await newCardBody(page);
        await body.pressSequentially(`[[${target.slice(0, 1)}`);
        const list = page.locator('.post-it-mention-suggest');
        await expect(list).toBeVisible();
        const options = list.getByRole('option');
        const count = await options.count();

        // The first suggestion is highlighted; ArrowDown moves it on (wrapping
        // when the list has a single entry).
        await expect(options.first()).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('ArrowDown');
        await expect(options.nth(1 % count)).toHaveAttribute(
            'aria-selected',
            'true'
        );
        const chosen = (await options.nth(1 % count).textContent())?.trim();

        await page.keyboard.press('Enter');
        await expect(body).toHaveValue(`[[${chosen}]]`);
        await page.keyboard.type(' next');
        await expect(body).toHaveValue(`[[${chosen}]] next`);
    });

    test('Escape closes the list without leaving edit mode', async ({
        page,
    }) => {
        const target = await openDemo(page);
        const body = await newCardBody(page);
        await body.pressSequentially(`[[${target.slice(0, 2)}`);
        const list = page.locator('.post-it-mention-suggest');
        await expect(list).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(list).toBeHidden();
        await expect(page.locator('.post-it-card.is-editing')).toBeVisible();
        await expect(body).toBeFocused();
    });
});
