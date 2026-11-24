import { expect, Page, test } from '@playwright/test';

// Imported cards grow with their tags and checklist (heights are measured at
// render time), so overlap can only be judged on the render.
const trelloBoard = {
    lists: [
        { id: 'a', name: 'To do', pos: 1 },
        { id: 'b', name: 'In progress', pos: 2 },
        { id: 'c', name: 'Done', pos: 3 },
    ],
    cards: [
        {
            id: '1',
            name: 'Brand assets',
            desc: 'Logo, fonts, colours.',
            idList: 'a',
            pos: 1,
            due: '2030-06-03T09:00:00Z',
            labels: [{ name: 'client' }, { name: 'brand' }],
        },
        {
            id: '2',
            name: 'Homepage copy',
            desc: 'Hero, three benefits and one call to action for the page.',
            idList: 'a',
            pos: 2,
            labels: [{ name: 'copy' }],
        },
        {
            id: '3',
            name: 'Wireframes',
            desc: 'Low fidelity first.',
            idList: 'b',
            pos: 1,
            due: '2030-06-10T09:00:00Z',
            labels: [{ name: 'design' }],
        },
        {
            id: '4',
            name: 'Component library',
            idList: 'b',
            pos: 2,
            labels: [{ name: 'dev' }],
        },
        {
            id: '5',
            name: 'Kick-off',
            desc: 'Goals and budget agreed.',
            idList: 'c',
            pos: 1,
        },
        { id: '6', name: 'Sitemap', idList: 'c', pos: 2 },
    ],
    checklists: [
        {
            idCard: '3',
            checkItems: [
                { name: 'Home', state: 'complete', pos: 1 },
                { name: 'Pricing', state: 'incomplete', pos: 2 },
                { name: 'Contact', state: 'incomplete', pos: 3 },
                { name: 'About', state: 'incomplete', pos: 4 },
            ],
        },
    ],
};

const markdown = [
    '# First',
    'Some text',
    '- [ ] one',
    '- [ ] two',
    '- [ ] three',
    '# Second',
    'More text',
    '**Tags:** a, b',
    '# Third',
    '- [x] done',
    '# Fourth',
    'text',
].join('\n');

async function overlaps(page: Page, importedTitles: string[]) {
    await page.waitForTimeout(600);
    return page.evaluate((titles) => {
        const cards = [
            ...document.querySelectorAll<HTMLElement>('.post-it-card'),
        ]
            .map((element) => ({
                title:
                    element.querySelector<HTMLInputElement>('.post-it-title')
                        ?.value ?? '',
                rect: element.getBoundingClientRect(),
            }))
            .filter((card) => titles.includes(card.title));
        const found: string[] = [];
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                const a = cards[i].rect;
                const b = cards[j].rect;
                const width =
                    Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const height =
                    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (width > 2 && height > 2)
                    found.push(`${cards[i].title} x ${cards[j].title}`);
            }
        }
        return { count: cards.length, found };
    }, importedTitles);
}

test('an imported Trello board lays out without overlapping cards', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en&analytics=off');
    await page.locator('.post-it-card').first().waitFor();
    await page.locator('input[type=file]').setInputFiles({
        name: 'trello.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(trelloBoard)),
    });
    const titles = trelloBoard.cards.map((card) => card.name);
    await expect
        .poll(async () => (await overlaps(page, titles)).count)
        .toBe(titles.length);
    const result = await overlaps(page, titles);
    expect(result.count).toBe(titles.length);
    expect(result.found).toEqual([]);
});

test('an imported Markdown file lays out without overlapping cards', async ({
    page,
}) => {
    await page.goto('/app/?demo=1&lang=en&analytics=off');
    await page.locator('.post-it-card').first().waitFor();
    await page.locator('input[type=file]').setInputFiles({
        name: 'notes.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(markdown),
    });
    // The first heading of a file is taken as the document title: that card is untitled.
    const titles = ['', 'Second', 'Third', 'Fourth'];
    await expect
        .poll(async () => (await overlaps(page, titles)).count)
        .toBe(titles.length);
    const result = await overlaps(page, titles);
    expect(result.count).toBe(titles.length);
    expect(result.found).toEqual([]);
});
