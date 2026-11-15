import { expect, type Page, test } from '@playwright/test';
import { startEditingCard } from './cardEditing';

// The selection bar (count + Duplicate / Paste style / Delete + Clear) must
// stay fully usable on a phone. It used to be a single non-wrapping row: at
// 390px the last controls ended up past the screen edge (the clear button at
// x ≈ 430) and the canvas clipped them. Merely being in the DOM, or even
// "visible" for Playwright, proves nothing here: a programmatic scroll of the
// clipped canvas lets `tap()` succeed on a button no finger could ever reach.
// So every check below is a geometric one: inside the viewport, and a real
// hit-test at the button's centre.

const MIN_TARGET = 44; // Comfortable touch target, in rendered pixels.
const DEMO_KEY = 'magnotes-demo-board-v1';
// The compact (grid) layout applies up to this width, included; the single row
// of the desktop layout starts one pixel above.
const GRID_MAX = 760;
// Up to this width (included) the clear button joins the count on row one.
// With a fourth column, French "Supprimer" broke mid-word from 341 to 346px.
const NARROW_MAX = 360;

type BarReport = {
    viewport: { width: number; height: number };
    labels: string[];
    outside: string[];
    covered: string[];
    smallest: number;
    barInside: boolean;
    pageOverflow: boolean;
    canvasScrollLeft: number;
    display: string;
    columns: number;
    // Controls drawn with no size, or hidden by CSS.
    hidden: string[];
    // Labels whose text is cut by their button, or a word broken across lines.
    unreadable: string[];
    smallestFont: number;
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
        const hidden = buttons.filter((b) => {
            const r = rect(b);
            const cs = getComputedStyle(b);
            return (
                r.width === 0 ||
                r.height === 0 ||
                cs.visibility === 'hidden' ||
                cs.display === 'none'
            );
        });
        // A label is unreadable when its text overflows the button, or when a
        // single word is split over two lines (a broken "Supprimer").
        const unreadable = buttons.filter((b) => {
            const text = b.querySelector('span');
            if (!text || getComputedStyle(text).display === 'none')
                return false;
            if (text.scrollWidth > text.clientWidth + 1) return true;
            const tr = rect(text);
            const br = rect(b);
            if (tr.left < br.left - 0.5 || tr.right > br.right + 0.5)
                return true;
            const node = text.firstChild;
            if (!node || node.nodeType !== Node.TEXT_NODE) return false;
            const value = node.textContent ?? '';
            for (const m of value.matchAll(/\S+/g)) {
                const range = document.createRange();
                range.setStart(node, m.index!);
                range.setEnd(node, m.index! + m[0].length);
                if (range.getClientRects().length > 1) return true;
            }
            return false;
        });
        const smallestFont = Math.min(
            ...buttons
                .filter((b) => {
                    const t = b.querySelector('span');
                    return !!t && getComputedStyle(t).display !== 'none';
                })
                .map((b) => parseFloat(getComputedStyle(b).fontSize))
        );
        const barStyle = getComputedStyle(bar);
        return {
            display: barStyle.display,
            columns:
                barStyle.display === 'grid'
                    ? barStyle.gridTemplateColumns.split(' ').length
                    : 0,
            hidden: hidden.map(label),
            unreadable: unreadable.map(label),
            smallestFont,
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
            expect(report.hidden, 'controls with no box').toEqual([]);
            expect(report.unreadable, 'labels cut or broken').toEqual([]);
            // The compact layout owes a finger-sized target; the desktop row
            // keeps its own (smaller) look.
            if (width <= GRID_MAX) {
                expect(report.display).toBe('grid');
                expect(report.smallest).toBeGreaterThanOrEqual(MIN_TARGET);
                expect(report.smallestFont).toBeGreaterThanOrEqual(11);
            }
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

    // ---- Business actions, pressed with a real finger (no force) ---------

    type StoredCard = {
        _id: string;
        title: string;
        content: string;
        color: string;
        finish?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation?: number;
    };
    const storedCards = (page: Page): Promise<StoredCard[]> =>
        page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) || '{}').postIts,
            DEMO_KEY
        );
    const cardIds = (page: Page): Promise<string[]> =>
        page
            .locator('.post-it-card')
            .evaluateAll((els) =>
                els.map((el) => el.getAttribute('data-post-it-id')!)
            );
    const cardById = (page: Page, id: string) =>
        page.locator(`.post-it-card[data-post-it-id="${id}"]`);
    const selectedIds = (page: Page): Promise<string[]> =>
        page
            .locator('.post-it-card.is-selected')
            .evaluateAll((els) =>
                els.map((el) => el.getAttribute('data-post-it-id')!)
            );
    const barButton = (page: Page, name: string) =>
        page.locator('.board-selection-bar').getByRole('button', { name });

    // A plain tap selects one card, a Shift tap adds the next one. The point is
    // inside the card, clear of the bar and of the neighbouring card.
    const tapCard = (page: Page, id: string, extra: { shift?: boolean } = {}) =>
        cardById(page, id).tap({
            position: { x: 24, y: 90 },
            ...(extra.shift ? { modifiers: ['Shift' as const] } : {}),
        });

    // Opens the demo board and returns every note id, plus the ones a finger
    // can really hit at the tap point (on screen, above the bottom controls,
    // not under another note): the phone shows only some of the six notes.
    const openOnPhone = async (page: Page, lang: 'fr' | 'en' = 'fr') => {
        await page.goto(`/app/?demo=1&lang=${lang}`);
        await expect(page.locator('.post-it-card').first()).toBeVisible();
        const ids = await cardIds(page);
        const tappable = await page.evaluate(() =>
            [...document.querySelectorAll('.post-it-card')]
                .filter((card) => {
                    const r = card.getBoundingClientRect();
                    const x = r.left + 24;
                    const y = r.top + 90;
                    if (
                        x < 0 ||
                        x > innerWidth ||
                        y < 0 ||
                        y > innerHeight - 220
                    )
                        return false;
                    const hit = document.elementFromPoint(x, y);
                    return !!hit && card.contains(hit);
                })
                .map((card) => card.getAttribute('data-post-it-id')!)
        );
        expect(
            tappable.length,
            'notes a finger can hit'
        ).toBeGreaterThanOrEqual(2);
        return { ids, tappable };
    };

    test('Duplicate copies the selected note and keeps the original selected', async ({
        page,
    }) => {
        const {
            tappable: [first],
        } = await openOnPhone(page);
        const before = await cardIds(page);
        await tapCard(page, first);
        await expect(cardById(page, first)).toHaveClass(/is-selected/);
        await expect(page.locator('.board-selection-count')).toHaveText(/^1 /);

        await barButton(page, 'Dupliquer').tap();
        await expect(page.locator('.post-it-card')).toHaveCount(
            before.length + 1
        );
        const after = await cardIds(page);
        const clone = after.filter((id) => !before.includes(id));
        expect(clone).toHaveLength(1);
        // Every note that was there is still there, the original is still the
        // one selected, and the bar still offers its actions.
        expect(before.every((id) => after.includes(id))).toBe(true);
        expect(await selectedIds(page)).toEqual([first]);
        await expect(page.locator('.board-selection-bar')).toBeVisible();
        // The copy carries the original's content.
        await expect
            .poll(async () => {
                const cards = await storedCards(page);
                const a = cards.find((c) => c._id === first)!;
                const b = cards.find((c) => c._id === clone[0]);
                return !!b && b.title === a.title && b.content === a.content;
            })
            .toBe(true);
    });

    test('Delete removes only the selected note and clears the selection', async ({
        page,
    }) => {
        const { ids, tappable } = await openOnPhone(page);
        const target = tappable[0];
        await tapCard(page, target);
        await expect(cardById(page, target)).toHaveClass(/is-selected/);
        expect(await selectedIds(page)).toEqual([target]);

        await barButton(page, 'Supprimer').tap();
        await expect(cardById(page, target)).toHaveCount(0);
        await expect(page.locator('.post-it-card')).toHaveCount(ids.length - 1);
        const left = await cardIds(page);
        expect(left.sort()).toEqual(ids.filter((id) => id !== target).sort());
        // Nothing is left selected, so the bar leaves with it.
        await expect(page.locator('.board-selection-bar')).toHaveCount(0);
        expect(await selectedIds(page)).toEqual([]);
        await expect
            .poll(async () => (await storedCards(page)).map((c) => c._id))
            .not.toContain(target);
    });

    test('Delete on a two-note selection removes exactly those two', async ({
        page,
    }) => {
        const { ids, tappable } = await openOnPhone(page);
        const [a, b] = tappable;
        await tapCard(page, a);
        await tapCard(page, b, { shift: true });
        expect((await selectedIds(page)).sort()).toEqual([a, b].sort());
        await expect(page.locator('.board-selection-count')).toHaveText(/^2 /);

        await barButton(page, 'Supprimer').tap();
        await expect(page.locator('.post-it-card')).toHaveCount(ids.length - 2);
        expect((await cardIds(page)).sort()).toEqual(
            ids.filter((id) => id !== a && id !== b).sort()
        );
        expect(await selectedIds(page)).toEqual([]);
        await expect(page.locator('.board-selection-bar')).toHaveCount(0);
    });

    test('Paste style is disabled until a style is copied, then restyles only the look', async ({
        page,
    }) => {
        const { ids, tappable } = await openOnPhone(page);
        // The look is copied from a note out of the finger's reach (its Style
        // panel is driven the way the other specs do); the targets are two
        // notes a finger can really select.
        const [t1, t2] = tappable;
        const source = ids.find((id) => !tappable.includes(id))!;

        // Nothing copied yet: the button is there, reachable, and disabled.
        await tapCard(page, t2);
        const paste = barButton(page, 'Coller le style');
        await expect(paste).toBeVisible();
        await expect(paste).toBeDisabled();
        const report = await reportBar(page);
        expect(report.covered).toEqual([]);

        // Copy a look through the card's own Style panel (the existing UI;
        // its controls can sit under the top bar on a phone, so, as in the
        // other specs, they are dispatched).
        const card = cardById(page, source);
        await startEditingCard(card);
        await card.locator('.card-style-trigger').dispatchEvent('click');
        await page
            .locator('.card-finish-chip.finish-glass')
            .dispatchEvent('click');
        await page
            .locator('.style-copy-row button')
            .first()
            .dispatchEvent('click');
        await expect(card).toHaveClass(/finish-glass/);
        await card.locator('.card-style-trigger').dispatchEvent('click');
        await card.locator('.card-edit-done').dispatchEvent('click');
        await expect(card).not.toHaveClass(/is-editing/);

        // The look is saved a beat after it is applied: wait for the store.
        await expect
            .poll(
                async () =>
                    (await storedCards(page)).find((c) => c._id === source)
                        ?.finish
            )
            .toBe('glass');
        const before = await storedCards(page);
        const copied = before.find((c) => c._id === source)!;

        // Two target notes, selected with real taps: Paste style is now live.
        await tapCard(page, t1);
        await tapCard(page, t2, { shift: true });
        expect((await selectedIds(page)).sort()).toEqual([t1, t2].sort());
        await expect(paste).toBeEnabled();
        await paste.tap();

        for (const id of [t1, t2]) {
            await expect(cardById(page, id)).toHaveClass(/finish-glass/);
        }
        await expect
            .poll(async () => {
                const now = await storedCards(page);
                return [t1, t2].map((id) => {
                    const c = now.find((x) => x._id === id)!;
                    return `${c.finish}|${c.color}`;
                });
            })
            .toEqual([t1, t2].map(() => `glass|${copied.color}`));

        // Content, position, size and rotation are untouched, on the targets
        // and on every other note.
        const now = await storedCards(page);
        const keep = (c: StoredCard) => [
            c.title,
            c.content,
            c.x,
            c.y,
            c.width,
            c.height,
            c.rotation ?? 0,
        ];
        for (const old of before) {
            const next = now.find((c) => c._id === old._id)!;
            expect(keep(next), `note ${old._id}`).toEqual(keep(old));
        }
        // Notes that were not selected keep their own look.
        const others = now.filter((c) => ![source, t1, t2].includes(c._id));
        for (const c of others) {
            expect(c.finish ?? 'flat').not.toBe('glass');
        }
    });

    // ---- A pile ------------------------------------------------------------

    test('selecting a pile keeps every action reachable', async ({ page }) => {
        const { tappable } = await openOnPhone(page);
        // Make a pile of the first two notes straight in the demo store (the
        // drag that stacks cards has its own spec), then reload.
        await page.evaluate(
            ([key, a, b]) => {
                const store = JSON.parse(localStorage.getItem(key)!);
                const base = store.postIts.find(
                    (c: { _id: string }) => c._id === a
                );
                const stamp = new Date().toISOString();
                store.stacks = [
                    {
                        _id: 'stack-e03',
                        userId: base.userId,
                        tabId: base.tabId,
                        x: base.x,
                        y: base.y,
                        collapsed: true,
                        createdAt: stamp,
                        updatedAt: stamp,
                    },
                ];
                for (const [i, id] of [a, b].entries()) {
                    const card = store.postIts.find(
                        (c: { _id: string }) => c._id === id
                    );
                    card.stackId = 'stack-e03';
                    card.stackOrder = i;
                }
                localStorage.setItem(key, JSON.stringify(store));
            },
            [DEMO_KEY, tappable[0], tappable[1]] as const
        );
        await page.reload();
        const pile = page.locator('.post-it-card.is-pile');
        await expect(pile).toHaveCount(1);

        // Select everything (the pile included) the way the keyboard does,
        // then check the bar and clear it with a finger.
        await expect(async () => {
            await page.keyboard.press('Control+a');
            await expect(page.locator('.board-selection-bar')).toBeVisible({
                timeout: 1000,
            });
        }).toPass();
        const report = await reportBar(page);
        expect(report.labels).toHaveLength(4);
        expect(report.outside).toEqual([]);
        expect(report.covered).toEqual([]);
        expect(report.hidden).toEqual([]);
        expect(report.smallest).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(report.canvasScrollLeft).toBe(0);

        await page.locator('.board-selection-clear').tap();
        await expect(page.locator('.board-selection-bar')).toHaveCount(0);
        expect(await selectedIds(page)).toEqual([]);
        await expect(pile).toHaveCount(1);
    });
});

// ---- Layout boundaries ------------------------------------------------------

// The compact layout switches at 760 / 761 px, and its narrow variant at
// 360 / 361 px. Each side of each boundary is its own layout: pin both. 340 to
// 346 are the widths where "Supprimer" used to break mid-word (4 columns).
const BOUNDARIES: [number, 'grid' | 'flex', number][] = [
    // width, display, grid columns (0 = not a grid)
    [340, 'grid', 3],
    [341, 'grid', 3],
    [346, 'grid', 3],
    [NARROW_MAX, 'grid', 3],
    [NARROW_MAX + 1, 'grid', 4],
    [GRID_MAX, 'grid', 4],
    [GRID_MAX + 1, 'flex', 0],
];
for (const lang of ['fr', 'en'] as const) {
    for (const [width, display, columns] of BOUNDARIES) {
        test(`selection bar at the ${width}px boundary (${lang})`, async ({
            page,
        }) => {
            await page.setViewportSize({ width, height: 800 });
            await openWithSelection(page, lang);
            const report = await reportBar(page);
            expect(report.display).toBe(display);
            expect(report.columns).toBe(columns);
            expect(report.labels).toHaveLength(4);
            expect(report.outside).toEqual([]);
            expect(report.covered).toEqual([]);
            expect(report.hidden).toEqual([]);
            expect(report.unreadable).toEqual([]);
            expect(report.pageOverflow).toBe(false);
            expect(report.canvasScrollLeft).toBe(0);
            if (width <= GRID_MAX) {
                expect(report.smallest).toBeGreaterThanOrEqual(MIN_TARGET);
            }
        });
    }
}

// ---- Keyboard ---------------------------------------------------------------

type Stop = {
    label: string;
    focusVisible: boolean;
    ring: boolean;
    inside: boolean;
    clipped: boolean;
    reachable: boolean;
};

// Tabs from the top of the page until focus enters the bar, then keeps going
// until it leaves, and describes every stop.
const tabThroughBar = async (page: Page): Promise<Stop[]> => {
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const stops: Stop[] = [];
    let entered = false;
    for (let i = 0; i < 150; i++) {
        await page.keyboard.press('Tab');
        const stop = await page.evaluate(async () => {
            let el = document.activeElement as HTMLElement | null;
            if (!el || !el.closest('.board-selection-bar')) return null;
            // Let the layout settle (focus can scroll or re-render a frame
            // later on a loaded machine) before measuring.
            await new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done))
            );
            el = document.activeElement as HTMLElement | null;
            if (!el || !el.closest('.board-selection-bar')) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const offset = parseFloat(cs.outlineOffset) || 0;
            const ringPx =
                cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) : 0;
            const grow = Math.max(0, ringPx + offset);
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const inside =
                r.left - grow >= 0 &&
                r.top - grow >= 0 &&
                r.right + grow <= vw &&
                r.bottom + grow <= vh;
            // An ancestor that clips (overflow other than visible) must still
            // contain the control and its focus ring.
            let clipped = false;
            for (let a = el.parentElement; a; a = a.parentElement) {
                const ac = getComputedStyle(a);
                if (ac.overflowX === 'visible' && ac.overflowY === 'visible')
                    continue;
                const ar = a.getBoundingClientRect();
                if (
                    r.left - grow < ar.left - 0.5 ||
                    r.right + grow > ar.right + 0.5 ||
                    r.top - grow < ar.top - 0.5 ||
                    r.bottom + grow > ar.bottom + 0.5
                ) {
                    clipped = true;
                }
            }
            const top = document.elementFromPoint(
                r.x + r.width / 2,
                r.y + r.height / 2
            );
            return {
                label: el.getAttribute('aria-label') || el.textContent!.trim(),
                focusVisible: el.matches(':focus-visible'),
                ring: ringPx > 0 || cs.boxShadow !== 'none',
                inside,
                clipped,
                reachable: !!top && el.contains(top),
            };
        });
        if (stop) {
            entered = true;
            stops.push(stop);
        } else if (entered) {
            break;
        }
    }
    return stops;
};

// Presses Tab, from the top of the page, until the control of the bar with
// this name has focus. A plain loop on the focused element: no timing involved.
const tabTo = async (page: Page, name: string) => {
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    for (let i = 0; i < 250; i++) {
        await page.keyboard.press('Tab');
        const reached = await page.evaluate((wanted) => {
            const el = document.activeElement as HTMLElement | null;
            return (
                !!el?.closest('.board-selection-bar') &&
                (el.getAttribute('aria-label') || el.textContent!.trim()) ===
                    wanted
            );
        }, name);
        if (reached) return;
    }
    throw new Error(`Tab never reached "${name}"`);
};

const KEYBOARD_VIEWPORTS: [string, number, number][] = [
    ['300 × 600 (narrow variant)', 300, 600],
    ['390 × 844', 390, 844],
    ['1280 × 800 (desktop row)', 1280, 800],
];

test.describe('selection bar with the keyboard', () => {
    for (const [name, width, height] of KEYBOARD_VIEWPORTS) {
        test(`Tab reaches every active control, in order, with a visible ring at ${name}`, async ({
            page,
        }) => {
            await page.setViewportSize({ width, height });
            await openWithSelection(page, 'fr');
            const stops = await tabThroughBar(page);

            // Paste style is disabled (nothing copied): the tab order skips it.
            // The clear button comes last in the DOM, which is also where it
            // is reached on the narrow layout, wherever it is drawn.
            expect(stops.map((s) => s.label)).toEqual([
                'Dupliquer',
                'Supprimer',
                'Désélectionner',
            ]);
            for (const stop of stops) {
                expect(stop.focusVisible, `${stop.label} focus-visible`).toBe(
                    true
                );
                expect(stop.ring, `${stop.label} has a ring`).toBe(true);
                expect(stop.inside, `${stop.label} ring on screen`).toBe(true);
                expect(stop.clipped, `${stop.label} ring clipped`).toBe(false);
                expect(stop.reachable, `${stop.label} reachable`).toBe(true);
            }
        });

        test(`Enter clears the selection from the clear button at ${name}`, async ({
            page,
        }) => {
            await page.setViewportSize({ width, height });
            await openWithSelection(page, 'fr');
            const total = await page.locator('.post-it-card').count();
            await tabTo(page, 'Désélectionner');
            await page.keyboard.press('Enter');
            await expect(page.locator('.board-selection-bar')).toHaveCount(0);
            await expect(page.locator('.post-it-card.is-selected')).toHaveCount(
                0
            );
            await expect(page.locator('.post-it-card')).toHaveCount(total);
        });
    }

    test('Space presses Duplicate and Enter presses Delete, from the keyboard', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/app/?demo=1&lang=fr');
        const cards = page.locator('.post-it-card');
        await expect(cards.first()).toBeVisible();
        const total = await cards.count();
        await cards.first().click({ position: { x: 24, y: 90 } });
        await expect(page.locator('.board-selection-bar')).toBeVisible();
        const bar = page.locator('.board-selection-bar');

        await tabTo(page, 'Dupliquer');
        await page.keyboard.press('Space');
        await expect(cards).toHaveCount(total + 1);

        await tabTo(page, 'Supprimer');
        await page.keyboard.press('Enter');
        await expect(cards).toHaveCount(total);
        await expect(bar).toHaveCount(0);
    });

    test('existing shortcuts still work with the bar open: Ctrl+D, Delete, Escape', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/app/?demo=1&lang=fr');
        const cards = page.locator('.post-it-card');
        await expect(cards.first()).toBeVisible();
        const total = await cards.count();
        await cards.first().click({ position: { x: 24, y: 90 } });
        await expect(page.locator('.board-selection-bar')).toBeVisible();

        await page.keyboard.press('Control+d');
        await expect(cards).toHaveCount(total + 1);
        await page.keyboard.press('Delete');
        await expect(cards).toHaveCount(total);
        await expect(page.locator('.board-selection-bar')).toHaveCount(0);

        await cards.first().click({ position: { x: 24, y: 90 } });
        await expect(page.locator('.board-selection-bar')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.board-selection-bar')).toHaveCount(0);
        await expect(cards).toHaveCount(total);
    });
});
