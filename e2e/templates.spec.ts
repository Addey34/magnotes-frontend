import { expect, test } from '@playwright/test';
import { BOARD_TEMPLATES } from '../src/constants/boardTemplates';

// Cards grow with their content, so overlap can only be judged on the render.
for (const template of BOARD_TEMPLATES) {
    test(`template "${template.id}" renders without overlapping cards`, async ({
        page,
    }) => {
        await page.goto(`/app/?demo=1&lang=en&template=${template.id}`);
        await expect(page.locator('.post-it-card')).toHaveCount(
            template.cards.length
        );
        await page.waitForTimeout(400);
        const overlaps = await page.evaluate(() => {
            const cards = [
                ...document.querySelectorAll<HTMLElement>('.post-it-card'),
            ].map((element) => ({
                title:
                    element.querySelector<HTMLInputElement>('.post-it-title')
                        ?.value ?? '',
                rect: element.getBoundingClientRect(),
            }));
            const found: string[] = [];
            for (let i = 0; i < cards.length; i++) {
                for (let j = i + 1; j < cards.length; j++) {
                    const a = cards[i].rect;
                    const b = cards[j].rect;
                    const width =
                        Math.min(a.right, b.right) - Math.max(a.left, b.left);
                    const height =
                        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                    if (width > 2 && height > 2) {
                        found.push(
                            `${cards[i].title} x ${cards[j].title} (${Math.round(width)}x${Math.round(height)})`
                        );
                    }
                }
            }
            return found;
        });
        expect(overlaps).toEqual([]);
    });
}
