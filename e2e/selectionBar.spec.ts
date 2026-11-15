import { expect, type Page, test } from '@playwright/test';

// The selection bar (count + Duplicate / Paste style / Delete + Clear) must
// stay fully usable on a phone. It used to be a single non-wrapping row: at
// 390px the last controls ended up past the screen edge (the clear button at
// x ≈ 430) and the canvas clipped them. Merely being in the DOM, or even
// "visible" for Playwright, proves nothing here: a programmatic scroll of the
// clipped canvas lets `tap()` succeed on a button no finger could ever reach.
// So every check below is a geometric one: inside the viewport, and a real
// hit-test at the button's centre.

const MIN_TARGET = 44; // Comfortable touch target, in rendered pixels.

type BarReport = {
    viewport: { width: number; height: number };
    labels: string[];
    outside: string[];
    covered: string[];
    smallest: number;
    barInside: boolean;
    pageOverflow: boolean;
    canvasScrollLeft: number;
};

// Opens the demo board in `lang` and selects every card (keyboard shortcut,
// the same state a multi-selection produces).
const openWithSelection = async (page: Page, lang: 'fr' | 'en') => {
    await page.goto(`/app/?demo=1&lang=${lang}`);
    await expect(page.locator('.post-it-card').first()).toBeVisible();
    // The shortcut listener attaches once the board has mounted: press it again
    // until the bar shows, instead of guessing a delay.
    await expect(async () => {
        await page.keyboard.press('Control+a');
        await expect(page.locator('.board-selection-bar')).toBeVisible({
            timeout: 1000,
        });
    }).toPass();
};

const reportBar = (page: Page): Promise<BarReport> =>
    page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const bar = document.querySelector('.board-selection-bar')!;
        const buttons = [...bar.querySelectorAll('button')];
        const label = (b: Element) =>
            b.getAttribute('aria-label') || b.textContent!.trim();
        const rect = (b: Element) => b.getBoundingClientRect();
        const inside = (b: Element) => {
            const r = rect(b);
            return r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh;
        };
        const reachable = (b: Element) => {
            const r = rect(b);
            const top = document.elementFromPoint(
                r.x + r.width / 2,
                r.y + r.height / 2
            );
            return !!top && b.contains(top);
        };
        const barBox = rect(bar);
        return {
            viewport: { width: vw, height: vh },
            labels: buttons.map(label),
            outside: buttons.filter((b) => !inside(b)).map(label),
            covered: buttons.filter((b) => !reachable(b)).map(label),
            smallest: Math.min(
                ...buttons.map((b) => Math.min(rect(b).width, rect(b).height))
            ),
            barInside: barBox.left >= 0 && barBox.right <= vw,
            pageOverflow:
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
            canvasScrollLeft:
                document.querySelector('.board-canvas')?.scrollLeft ?? 0,
        };
    });

// Widths and heights of real phones, a large phone, a phone on its side, a
// narrow landscape phone, a tablet. The 390 × 844 case is the reported one.
const VIEWPORTS: [string, number, number][] = [
    ['320 × 568', 320, 568],
    ['360 × 740', 360, 740],
    ['390 × 844', 390, 844],
    ['412 × 915', 412, 915],
    ['667 × 375 landscape', 667, 375],
    ['768 × 1024', 768, 1024],
    ['1280 × 800', 1280, 800],
];

for (const lang of ['fr', 'en'] as const) {
    for (const [name, width, height] of VIEWPORTS) {
        test(`selection bar: every control is on screen and reachable at ${name} (${lang})`, async ({
            page,
        }) => {
            await page.setViewportSize({ width, height });
            await openWithSelection(page, lang);

            const report = await reportBar(page);
            expect(report.labels).toHaveLength(4);
            expect(report.outside, 'controls past the screen edge').toEqual([]);
            expect(report.covered, 'controls under another element').toEqual(
                []
            );
            expect(report.barInside).toBe(true);
            expect(report.pageOverflow).toBe(false);
            // The clipped canvas must not have been scrolled to hide a defect.
            expect(report.canvasScrollLeft).toBe(0);
        });
    }
}

test.describe('selection bar with a finger', () => {
    test.beforeEach(({ isMobile }) => {
        test.skip(
            !isMobile,
            'Skipped by design: finger gestures need a touch profile.'
        );
    });
    test.use({ viewport: { width: 390, height: 844 } });

    for (const lang of ['fr', 'en'] as const) {
        test(`one tap clears the selection at 390 × 844 (${lang}) and nothing else changes`, async ({
            page,
        }) => {
            await page.goto(`/app/?demo=1&lang=${lang}`);
            const cards = page.locator('.post-it-card');
            await expect(cards.first()).toBeVisible();
            const total = await cards.count();

            // A tap on a card selects it.
            await cards.first().tap({ position: { x: 20, y: 6 } });
            await expect(cards.first()).toHaveClass(/is-selected/);
            const bar = page.locator('.board-selection-bar');
            await expect(bar).toBeVisible();

            // Before tapping, prove a finger could get there: the control sits
            // inside the screen, big enough, and nothing covers its centre.
            const clear = page.locator('.board-selection-clear');
            const box = (await clear.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(390);
            expect(box.y + box.height).toBeLessThanOrEqual(844);
            expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(
                MIN_TARGET
            );
            const report = await reportBar(page);
            expect(report.covered).toEqual([]);
            expect(report.canvasScrollLeft).toBe(0);
            await expect(clear).toHaveAccessibleName(
                lang === 'fr' ? 'Désélectionner' : 'Clear selection'
            );

            // A real tap, no force: it clears the selection and only that.
            await clear.tap();
            await expect(bar).toHaveCount(0);
            await expect(page.locator('.post-it-card.is-selected')).toHaveCount(
                0
            );
            await expect(cards).toHaveCount(total);
            expect(
                await page
                    .locator('.board-canvas')
                    .evaluate((el) => el.scrollLeft)
            ).toBe(0);
        });
    }

    test('every action of the bar can be pressed on a phone, with a comfortable target', async ({
        page,
    }) => {
        await page.goto('/app/?demo=1&lang=fr');
        const cards = page.locator('.post-it-card');
        await expect(cards.first()).toBeVisible();
        const total = await cards.count();
        await cards.first().tap({ position: { x: 20, y: 6 } });
        await expect(page.locator('.board-selection-bar')).toBeVisible();

        const report = await reportBar(page);
        expect(report.outside).toEqual([]);
        expect(report.covered).toEqual([]);
        expect(report.smallest).toBeGreaterThanOrEqual(MIN_TARGET);

        // Duplicate really acts (one more card), then Delete takes it back.
        await page.getByRole('button', { name: 'Dupliquer' }).tap();
        await expect(cards).toHaveCount(total + 1);
        await expect(page.locator('.board-selection-bar')).toBeVisible();
    });
});
