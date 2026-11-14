import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// The rotate handle on a card: a drag turns the card freely and pulls it onto
// 0 / ±90 / 180 when released close to them, a click or an arrow key moves to
// the next 15° notch from any angle, and none of it moves or resizes the card.
// Every check reads the stored angle and the angle actually painted. Presses
// are real (mouse, touch); the few places that use something else say why.
//
// Phone profiles run at 390 x 844, the size the touch checks were specified at.

const DEMO_KEY = 'magnotes-demo-board-v1';
const AUTOSAVE_MS = 500; // useAutosave's default delay
const PHONE = { width: 390, height: 844 };

type Stored = { rotation: number; x: number; y: number; w: number; h: number };

const openDemo = async (page: Page, phone: boolean) => {
    await page.addInitScript(() => localStorage.setItem('magnotes-lang', 'en'));
    await page.route('**/api/auth/refresh', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'No active session' }),
        })
    );
    if (phone) await page.setViewportSize(PHONE);
    await page.goto('/app/?demo=1');
    await expect(page.locator('.post-it-card').first()).toBeVisible();
};

// Wait until a locator stops moving: a card is re-framed into view for a
// moment after it is created, and a tap aimed during that moment misses.
const untilStill = async (locator: Locator) => {
    let last = '';
    for (let i = 0; i < 40; i++) {
        const box = await locator.boundingBox();
        const now = box ? [box.x, box.y].map(Math.round).join(',') : '';
        if (now && now === last) return;
        last = now;
        await locator.page().waitForTimeout(150);
    }
    throw new Error('the handle never stopped moving');
};

const openWithNewCard = async (page: Page, phone: boolean) => {
    await openDemo(page, phone);
    await page.locator('.create-card-button').click();
    const card = page.locator('.post-it-card').last();
    await expect(card).toBeVisible();
    const handle = card.locator('.post-it-rotate-handle');
    await untilStill(handle);
    return { card, handle };
};

// The newest card is the last one stored.
const storedOf = (page: Page): Promise<Stored> =>
    page.evaluate((key) => {
        const store = JSON.parse(localStorage.getItem(key) || '{}');
        const cards = store.postIts ?? [];
        const card = cards[cards.length - 1] ?? {};
        return {
            rotation: card.rotation ?? 0,
            x: card.x,
            y: card.y,
            w: card.width,
            h: card.height,
        };
    }, DEMO_KEY);

const storedRotation = async (page: Page) => (await storedOf(page)).rotation;

// The angle the card is really drawn at, in degrees, from its CSS matrix.
const paintedAngle = (card: Locator): Promise<number> =>
    card.evaluate((element) => {
        const m = new DOMMatrix(getComputedStyle(element).transform);
        return (Math.atan2(m.b, m.a) * 180) / Math.PI;
    });

// Same orientation, whatever the wrapping (180° and -180° are one).
const angleGap = (a: number, b: number) =>
    Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);

// What a finger would actually land on at the centre of the handle: the real
// hit-test, not the CSS. 'handle' is the only answer that lets a gesture start.
const hitAtHandle = (handle: Locator): Promise<string> =>
    handle.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const top = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2
        );
        if (!top) return 'offscreen';
        if (element.contains(top)) return 'handle';
        if (top.closest('.board-selection-bar')) return 'selection-bar';
        if (top.closest('.board-bottom-dock')) return 'bottom-bar';
        return 'other';
    });

// Set an exact starting angle the way a user can: through the Style panel.
const setAngle = async (page: Page, card: Locator, degrees: number) => {
    const trigger = card.locator('.card-style-trigger');
    await trigger.dispatchEvent('click');
    await page
        .getByRole('slider', { name: 'Card rotation' })
        .fill(String(degrees));
    await trigger.dispatchEvent('click');
    await expect(page.locator('.style-panel, .post-it-sheet')).toHaveCount(0);
    await expect.poll(() => storedRotation(page)).toBe(degrees);
    // Closing the panel hands the focus back to nobody; a card still being
    // edited shows its handle while focus is inside it, so give it back.
    await card.locator('.post-it-title').focus();
};

type Geometry = { hx: number; hy: number; cx: number; cy: number };

const geometry = async (card: Locator, handle: Locator): Promise<Geometry> => {
    const [h, c] = await Promise.all([
        handle.boundingBox(),
        card.boundingBox(),
    ]);
    if (!h || !c) throw new Error('card or handle has no box');
    return {
        hx: h.x + h.width / 2,
        hy: h.y + h.height / 2,
        cx: c.x + c.width / 2,
        cy: c.y + c.height / 2,
    };
};

// The point `turn` degrees around the card centre from where the handle sits.
const arc = (g: Geometry) => {
    const start = Math.atan2(g.hy - g.cy, g.hx - g.cx);
    const radius = Math.hypot(g.hx - g.cx, g.hy - g.cy);
    return (turn: number): [number, number] => [
        g.cx + radius * Math.cos(start + (turn * Math.PI) / 180),
        g.cy + radius * Math.sin(start + (turn * Math.PI) / 180),
    ];
};

// Turn the card by `turn` degrees with a real mouse, in small steps.
// `watch` runs after every step, to sample what is painted on the way.
// `release: false` leaves the button down, for tests that act mid-gesture.
const mouseTurn = async (
    page: Page,
    card: Locator,
    handle: Locator,
    turn: number,
    watch?: () => Promise<void>,
    release = true
) => {
    await card.hover();
    const g = await geometry(card, handle);
    const at = arc(g);
    await page.mouse.move(g.hx, g.hy);
    await page.mouse.down();
    const steps = Math.max(3, Math.ceil(Math.abs(turn) / 3));
    for (let i = 1; i <= steps; i++) {
        const [x, y] = at((turn * i) / steps);
        await page.mouse.move(x, y);
        await watch?.();
    }
    if (release) await page.mouse.up();
};

// Same, with a finger (Chromium only: it drives real touch events).
const touchTurn = async (
    page: Page,
    card: Locator,
    handle: Locator,
    turn: number
) => {
    const g = await geometry(card, handle);
    const at = arc(g);
    const cdp = await page.context().newCDPSession(page);
    const point = (x: number, y: number) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: point(g.hx, g.hy),
    });
    const steps = Math.max(3, Math.ceil(Math.abs(turn) / 3));
    for (let i = 1; i <= steps; i++) {
        const [x, y] = at((turn * i) / steps);
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: point(x, y),
        });
    }
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
    });
    await cdp.detach();
};

const press = (locator: Locator, isTouch: boolean) =>
    isTouch ? locator.tap() : locator.click();

// (starting angle, how far the pointer turns, angle expected on release)
const DRAGS: [number, number, number, string][] = [
    [10, -8, 0, 'close to straight'],
    [80, 7, 90, 'close to 90°'],
    [-80, -7, -90, 'close to -90°'],
    [0, 30, 30, 'a free angle stays free'],
];

test.describe('rotate handle: mouse', () => {
    test.beforeEach(({ isMobile }) => {
        test.skip(
            isMobile,
            'Skipped by design: phone profiles are covered by the finger tests; a mouse drag is a desktop gesture.'
        );
    });

    test('a drag snaps near the right angles and leaves free angles alone', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, false);
        const before = await storedOf(page);

        for (const [from, turn, expected, label] of DRAGS) {
            if (from !== 0) await setAngle(page, card, from);
            await mouseTurn(page, card, handle, turn);
            await expect
                .poll(() => storedRotation(page), { message: label })
                .toBe(expected);
            expect(angleGap(await paintedAngle(card), expected)).toBeLessThan(
                0.3
            );
            await page.waitForTimeout(AUTOSAVE_MS);
            if (expected !== 0) await setAngle(page, card, 0);
        }

        // Turning never moved or resized the card.
        const after = await storedOf(page);
        expect([after.x, after.y, after.w, after.h]).toEqual([
            before.x,
            before.y,
            before.w,
            before.h,
        ]);
    });

    test('the angle survives a reload', async ({ page }) => {
        const { card, handle } = await openWithNewCard(page, false);
        await mouseTurn(page, card, handle, 40);
        await expect.poll(() => storedRotation(page)).toBe(40);

        await page.reload();
        await expect(page.locator('.post-it-card').last()).toBeVisible();
        expect(await storedRotation(page)).toBe(40);
        expect(
            angleGap(
                await paintedAngle(page.locator('.post-it-card').last()),
                40
            )
        ).toBeLessThan(0.3);
    });

    test('crossing ±180° keeps turning the same way, without a jump', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, false);
        await setAngle(page, card, 170);

        const seen: number[] = [];
        await mouseTurn(page, card, handle, 24, async () => {
            seen.push(await paintedAngle(card));
        });

        // Every step on screen is a small turn in the same direction, also at
        // the seam where the stored value wraps from 180 to -180.
        let previous = 170;
        for (const angle of seen) {
            const gap = angleGap(angle, previous);
            expect(gap).toBeLessThan(12);
            previous = angle;
        }
        await expect.poll(() => storedRotation(page)).toBe(-166);
        expect(angleGap(await paintedAngle(card), -166)).toBeLessThan(0.3);

        // And back across the seam.
        await setAngle(page, card, -170);
        await mouseTurn(page, card, handle, -24);
        await expect.poll(() => storedRotation(page)).toBe(166);
    });

    test('a drag near ±180° lands on the straight-down position', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, false);
        await setAngle(page, card, 170);
        await mouseTurn(page, card, handle, 8);
        await expect.poll(() => storedRotation(page)).toBe(-180);
        expect(angleGap(await paintedAngle(card), 180)).toBeLessThan(0.3);
    });

    test('works zoomed out', async ({ page }) => {
        const { card, handle } = await openWithNewCard(page, false);
        const zoomOut = page.getByRole('button', { name: 'Zoom out' });
        await expect(zoomOut).toBeVisible();
        await zoomOut.click();
        await zoomOut.click();
        await expect(card).toBeVisible();
        const before = await storedOf(page);

        await setAngle(page, card, 10);
        await mouseTurn(page, card, handle, -8);
        await expect.poll(() => storedRotation(page)).toBe(0);
        await mouseTurn(page, card, handle, 20);
        await expect.poll(() => storedRotation(page)).toBe(20);
        expect(angleGap(await paintedAngle(card), 20)).toBeLessThan(0.3);

        const after = await storedOf(page);
        expect([after.x, after.y, after.w, after.h]).toEqual([
            before.x,
            before.y,
            before.w,
            before.h,
        ]);
    });

    test('the open Style panel stays upright and follows the turn', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, false);
        await card.locator('.card-style-trigger').dispatchEvent('click');
        const panel = page.locator('.style-panel');
        await expect(panel).toBeVisible();
        const width = (await panel.boundingBox())!.width;

        await mouseTurn(page, card, handle, 40, async () => {
            // Upright: the same width on every step, never a tilted box.
            expect(
                Math.abs((await panel.boundingBox())!.width - width)
            ).toBeLessThan(0.5);
        });

        await expect.poll(() => storedRotation(page)).toBe(40);
        await expect(
            panel.getByRole('slider', { name: 'Card rotation' })
        ).toHaveValue('40');
        await expect(panel.locator('.rotation-value')).toHaveText('40°');
    });

    test('moving the card afterwards moves it without turning it', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, false);
        await mouseTurn(page, card, handle, 25);
        await expect.poll(() => storedRotation(page)).toBe(25);
        // A new card is in edit mode, where a drag on the text selects it.
        // Cards are move-first once edit mode is left.
        await card.locator('.card-edit-done').dispatchEvent('click');
        await expect(card).not.toHaveClass(/is-editing/);
        const before = await storedOf(page);

        const box = (await card.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 70, box.y + 120, {
            steps: 8,
        });
        await page.mouse.up();

        await expect
            .poll(async () => (await storedOf(page)).x)
            .not.toBe(before.x);
        expect(await storedRotation(page)).toBe(25);
    });
});

// The pointer's life in a real browser: capture taken and released, a save
// exactly once, and what happens when the gesture is cut short.
test.describe('rotate handle: pointer lifecycle', () => {
    test.beforeEach(({ isMobile, browserName }) => {
        test.skip(
            isMobile || browserName !== 'chromium',
            'Skipped by design: these checks drive the mouse and read Chromium pointer-capture state.'
        );
    });

    // Every write of the demo store, as the angle of the newest card.
    const recordWrites = (page: Page) =>
        page.addInitScript((key) => {
            const writes: number[] = [];
            (window as unknown as { __writes: number[] }).__writes = writes;
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k: string, v: string) {
                if (k === key) {
                    try {
                        const cards = JSON.parse(v).postIts ?? [];
                        writes.push(cards[cards.length - 1]?.rotation ?? 0);
                    } catch {
                        /* not the store */
                    }
                }
                return original.call(this, k, v);
            };
        }, DEMO_KEY);
    const writesOf = (page: Page): Promise<number[]> =>
        page.evaluate(
            () => (window as unknown as { __writes: number[] }).__writes
        );
    // The distinct angles written, in order: 45 twice in a row is one.
    const distinct = (values: number[]) =>
        values.filter((value, i) => i === 0 || value !== values[i - 1]);

    test('the browser grants the capture, and a gesture is saved exactly once', async ({
        page,
    }) => {
        await recordWrites(page);
        const { card, handle } = await openWithNewCard(page, false);
        await card.hover();
        const g = await geometry(card, handle);
        const at = arc(g);

        await page.mouse.move(g.hx, g.hy);
        await page.mouse.down();
        // The pointer is captured by the handle while the button is down.
        expect(await handle.evaluate((el) => el.hasPointerCapture(1))).toBe(
            true
        );
        for (const turn of [10, 25, 40, 55]) {
            const [x, y] = at(turn);
            await page.mouse.move(x, y, { steps: 3 });
        }
        // Nothing is written while the pointer is still down.
        await page.waitForTimeout(AUTOSAVE_MS + 300);
        expect(distinct(await writesOf(page)).at(-1)).toBe(0);

        await page.mouse.up();
        // The capture is released by the browser, which also sends the
        // lostpointercapture that must not undo or repeat anything.
        expect(await handle.evaluate((el) => el.hasPointerCapture(1))).toBe(
            false
        );
        await expect.poll(() => storedRotation(page)).toBe(55);
        await page.waitForTimeout(AUTOSAVE_MS + 500);

        // One saved angle for the whole gesture, no intermediate value.
        expect(distinct(await writesOf(page))).toEqual([0, 55]);
        expect(await storedRotation(page)).toBe(55);
        expect(angleGap(await paintedAngle(card), 55)).toBeLessThan(0.3);
    });

    test('a capture lost mid-gesture gives the angle back and saves nothing', async ({
        page,
    }) => {
        await recordWrites(page);
        const { card, handle } = await openWithNewCard(page, false);
        await mouseTurn(page, card, handle, 40, undefined, false);
        expect(angleGap(await paintedAngle(card), 40)).toBeLessThan(0.3);

        // The browser takes the capture away (as it does when the element is
        // removed or another one grabs the pointer).
        await handle.evaluate((el) => el.releasePointerCapture(1));
        // The browser applies a released capture with the next pointer event.
        await page.mouse.move(5, 5);
        await expect
            .poll(async () => angleGap(await paintedAngle(card), 0))
            .toBeLessThan(0.3);

        await page.mouse.up();
        await page.waitForTimeout(AUTOSAVE_MS + 500);
        expect(distinct(await writesOf(page))).toEqual([0]);
        expect(await storedRotation(page)).toBe(0);
    });

    test('a card that goes away mid-gesture leaves no turn behind', async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await recordWrites(page);
        const { card, handle } = await openWithNewCard(page, false);
        await setAngle(page, card, 10);
        await page.waitForTimeout(AUTOSAVE_MS);

        await mouseTurn(page, card, handle, 30, undefined, false);
        expect(angleGap(await paintedAngle(card), 40)).toBeLessThan(0.3);

        // Another view replaces the canvas, so every card unmounts under the
        // pressed pointer (the view switch itself is the only scripted step).
        await page.evaluate(() =>
            (
                document.querySelector(
                    '[data-view-tab="kanban"]'
                ) as HTMLElement
            ).click()
        );
        await expect(page.locator('.post-it-card')).toHaveCount(0);
        await page.mouse.up();
        await page.waitForTimeout(AUTOSAVE_MS + 500);

        await page.locator('[data-view-tab="canvas"]').click();
        const back = page.locator('.post-it-card').last();
        await expect(back).toBeVisible();
        // The board shows what is stored: the turn in progress was undone.
        expect(angleGap(await paintedAngle(back), 10)).toBeLessThan(0.3);
        expect(await storedRotation(page)).toBe(10);
        expect(distinct(await writesOf(page)).at(-1)).toBe(10);
        expect(errors).toEqual([]);
    });
});

test.describe('rotate handle: finger', () => {
    test.beforeEach(({ isMobile }) => {
        test.skip(
            !isMobile,
            'Skipped by design: finger gestures need a touch profile.'
        );
    });

    test('a tap that selects a card is enough to reach its handle, and a tap on it turns the card', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await card.locator('.card-edit-done').tap();
        await expect(card).not.toHaveClass(/is-editing/);
        await page.keyboard.press('Escape');
        await expect(card).not.toHaveClass(/is-selected/);

        // (Not asserted here: WebKit keeps a sticky :hover after a tap, so
        // the unselected state is covered by the CSS check in "neighbours".)

        // A tap selects the card, and that alone brings the handle up.
        await card.tap();
        await expect(card).toHaveClass(/is-selected/);
        expect(await hitAtHandle(handle)).toBe('handle');

        // And a real tap on it turns the card (Playwright hit-tests the point
        // before it taps and fails if something else would receive it).
        await handle.tap();
        await expect.poll(() => storedRotation(page)).toBe(15);
    });

    test('the handle stays reachable at every notch of a card placed by default', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await card.locator('.card-edit-done').tap();
        await page.keyboard.press('Escape');
        await card.tap();
        await expect(card).toHaveClass(/is-selected/);

        // A full turn, one real tap per notch: the handle orbits the card and
        // must never slip under another control.
        for (let notch = 1; notch <= 24; notch++) {
            expect(await hitAtHandle(handle), `before notch ${notch}`).toBe(
                'handle'
            );
            await handle.tap();
            await expect
                .poll(async () =>
                    angleGap(await paintedAngle(card), notch * 15)
                )
                .toBeLessThan(0.3);
        }
    });

    test('a finger drag turns the card and leaves it where it is', async ({
        page,
        browserName,
    }) => {
        test.skip(
            browserName !== 'chromium',
            'Tooling limit, not a gap in the behaviour: Playwright cannot script a touch drag in WebKit (no CDP touch events). WebKit still gets the tap, notch, key and hit-test checks.'
        );
        const { card, handle } = await openWithNewCard(page, true);
        const before = await storedOf(page);

        // Nothing hovers on a phone: the handle must already be the topmost
        // thing under its own centre.
        expect(await hitAtHandle(handle)).toBe('handle');

        for (const [from, turn, expected, label] of DRAGS) {
            if (from !== 0) await setAngle(page, card, from);
            await touchTurn(page, card, handle, turn);
            await expect
                .poll(() => storedRotation(page), { message: label })
                .toBe(expected);
            expect(angleGap(await paintedAngle(card), expected)).toBeLessThan(
                0.3
            );
            await page.waitForTimeout(AUTOSAVE_MS);
            if (expected !== 0) await setAngle(page, card, 0);
        }

        const after = await storedOf(page);
        expect([after.x, after.y, after.w, after.h]).toEqual([
            before.x,
            before.y,
            before.w,
            before.h,
        ]);
    });
});

// A card sitting low on the screen has its handle under the floating bottom
// controls. Selecting it nudges the board (the view only) just enough to free
// the handle. Phone profiles, 390 x 844.
test.describe('rotate handle: reveal from under the bottom controls', () => {
    test.beforeEach(({ isMobile }) => {
        test.skip(
            !isMobile,
            'Skipped by design: the floating bottom controls only overlap on phone layouts.'
        );
    });

    // The board content's own transform: the view (pan and zoom).
    const view = (page: Page): Promise<string> =>
        page.evaluate(
            () =>
                document.querySelector<HTMLElement>(
                    '.board-canvas [style*="scale("]'
                )?.style.transform ?? ''
        );

    const centre = async (locator: Locator) => {
        const box = (await locator.boundingBox())!;
        return {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
        };
    };

    // Leave edit mode, then drag the card with a real mouse until its handle
    // sits at `handleY` on the screen. The drag selects the card but, being a
    // drag, never asks for a reveal.
    const dropHandleAt = async (
        page: Page,
        card: Locator,
        handle: Locator,
        handleY: number
    ) => {
        await card.locator('.card-edit-done').dispatchEvent('click');
        await expect(card).not.toHaveClass(/is-editing/);
        const g = await geometry(card, handle);
        const start = await centre(card);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x, start.y + (handleY - g.hy), {
            steps: 10,
        });
        await page.mouse.up();
        await untilStill(handle);
    };

    // Tap the top edge of the card (its title and the buttons are elsewhere).
    const tapCard = async (page: Page, card: Locator) => {
        const box = (await card.boundingBox())!;
        await page.touchscreen.tap(box.x + box.width / 2, box.y + 8);
    };

    // Whether each button of the selection bar receives a press at its centre.
    // (On a 390px phone the last one can already sit past the screen edge,
    // before and after: this checks that the reveal changes none of them.)
    const barButtons = (page: Page): Promise<boolean[]> =>
        page.evaluate(() =>
            Array.from(
                document.querySelectorAll('.board-selection-bar button')
            ).map((el) => {
                const r = el.getBoundingClientRect();
                const top = document.elementFromPoint(
                    r.x + r.width / 2,
                    r.y + r.height / 2
                );
                return !!top && el.contains(top);
            })
        );

    const stillFor = async (page: Page, ms = 700) => {
        const before = await view(page);
        await page.waitForTimeout(ms);
        expect(await view(page)).toBe(before);
    };

    for (const [where, handleY] of [
        ['the selection bar', 738],
        ['the phone action row', 790],
    ] as const) {
        test(`selecting a card whose handle is under ${where} frees it; a tap then turns the card and it persists`, async ({
            page,
        }) => {
            const { card, handle } = await openWithNewCard(page, true);
            await dropHandleAt(page, card, handle, handleY);

            // The overlap, with a real hit-test: the handle cannot be pressed.
            expect(await hitAtHandle(handle)).not.toBe('handle');
            // Dropping a card never moves the board by itself.
            const dropped = await view(page);
            await stillFor(page);
            expect(await hitAtHandle(handle)).not.toBe('handle');
            const before = await storedOf(page);
            const barBefore = await page
                .locator('.board-selection-bar')
                .boundingBox();
            const buttonsBefore = await barButtons(page);

            // Select it (a tap): the handle comes out, no forced click.
            await tapCard(page, card);
            await expect.poll(() => hitAtHandle(handle)).toBe('handle');
            expect(await view(page)).not.toBe(dropped);

            // Only the view moved: the data and the fixed bar did not.
            expect(await storedOf(page)).toEqual(before);
            expect(
                await page.locator('.board-selection-bar').boundingBox()
            ).toEqual(barBefore);

            // The bar's own buttons are exactly as pressable as before.
            expect(await barButtons(page)).toEqual(buttonsBefore);
            expect(buttonsBefore.filter(Boolean).length).toBeGreaterThanOrEqual(
                3
            );

            // A real tap on the handle turns the card; the board stays put
            // while it turns, and the card turns about its own centre.
            await untilStill(handle);
            const settled = await view(page);
            const middle = await centre(card);
            await handle.tap();
            await expect.poll(() => storedRotation(page)).toBe(15);
            expect(await view(page)).toBe(settled);
            expect(await centre(card)).toEqual(middle);

            // It survives a reload.
            await page.reload();
            await expect(page.locator('.post-it-card').last()).toBeVisible();
            expect(await storedRotation(page)).toBe(15);
        });
    }

    test('a finger drag on the revealed handle turns the card without moving the board', async ({
        page,
        browserName,
    }) => {
        test.skip(
            browserName !== 'chromium',
            'Tooling limit, not a gap in the behaviour: Playwright cannot script a touch drag in WebKit (no CDP touch events).'
        );
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 738);
        await tapCard(page, card);
        await expect.poll(() => hitAtHandle(handle)).toBe('handle');
        await untilStill(handle);
        const settled = await view(page);
        const middle = await centre(card);

        await touchTurn(page, card, handle, 40);
        await expect.poll(() => storedRotation(page)).toBe(40);
        expect(angleGap(await paintedAngle(card), 40)).toBeLessThan(0.3);
        expect(await view(page)).toBe(settled);
        expect(await centre(card)).toEqual(middle);

        await page.reload();
        await expect(page.locator('.post-it-card').last()).toBeVisible();
        expect(await storedRotation(page)).toBe(40);
    });

    test('nothing moves when the handle is already clear, however often the card is tapped', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await card.locator('.card-edit-done').dispatchEvent('click');
        await untilStill(handle);
        expect(await hitAtHandle(handle)).toBe('handle');
        const before = await view(page);

        for (let i = 0; i < 3; i++) {
            await tapCard(page, card);
            await expect(card).toHaveClass(/is-selected/);
            await page.waitForTimeout(450);
            expect(await view(page)).toBe(before);
        }
    });

    test('a second tap on the selected card does not make the board oscillate', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 738);
        await tapCard(page, card);
        await expect.poll(() => hitAtHandle(handle)).toBe('handle');
        await untilStill(handle);
        const freed = await view(page);

        await tapCard(page, card);
        await page.waitForTimeout(600);
        expect(await view(page)).toBe(freed);
        expect(await hitAtHandle(handle)).toBe('handle');
    });

    test('a card dragged to the bottom edge gets its handle freed, once', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 832);
        await tapCard(page, card);
        await expect.poll(() => hitAtHandle(handle)).toBe('handle');
        await untilStill(handle);
        await stillFor(page, 500);
    });

    test('the board never moves while a pointer is held, nor after a drag', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 738);
        const start = await view(page);

        // Press the card and hold: well past the settle delay, nothing moves,
        // even though the handle is hidden under the bar.
        const box = (await card.boundingBox())!;
        const x = box.x + box.width / 2;
        await page.mouse.move(x, box.y + 8);
        await page.mouse.down();
        await page.waitForTimeout(700);
        expect(await view(page)).toBe(start);
        expect(await hitAtHandle(handle)).not.toBe('handle');

        // Dragging with it still held, then letting go: a drag is not a tap.
        await page.mouse.move(x, box.y - 40, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(700);
        expect(await view(page)).toBe(start);
    });

    test('a manual zoom during the glide wins: the board is never zoomed back', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 738);
        await tapCard(page, card);
        const scaleOf = async () =>
            (await view(page)).match(/scale\([^)]*\)/)![0];
        const initialScale = await scaleOf();
        // Past the settle delay: the glide is under way.
        await page.waitForTimeout(150);
        await page.evaluate(() => {
            const canvas = document.querySelector('.board-canvas')!;
            const r = canvas.getBoundingClientRect();
            canvas.dispatchEvent(
                new WheelEvent('wheel', {
                    deltaY: 250,
                    clientX: r.x + 100,
                    clientY: r.y + 100,
                    bubbles: true,
                    cancelable: true,
                })
            );
        });
        // The zoom lands (WebKit renders it a beat later).
        await expect.poll(scaleOf).not.toBe(initialScale);
        const zoomed = await scaleOf();
        // Whatever the glide had left to do, it never writes the old zoom.
        const seen = await page.evaluate(
            () =>
                new Promise<string[]>((resolve) => {
                    const scales = new Set<string>();
                    const end = performance.now() + 800;
                    const tick = () => {
                        const t =
                            document.querySelector<HTMLElement>(
                                '.board-canvas [style*="scale("]'
                            )?.style.transform ?? '';
                        scales.add(t.match(/scale\([^)]*\)/)?.[0] ?? '');
                        if (performance.now() < end)
                            requestAnimationFrame(tick);
                        else resolve([...scales]);
                    };
                    tick();
                })
        );
        expect(seen).toEqual([zoomed]);
    });

    test('two quick taps on two cards, and a tap then Escape, leave the board steady', async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 738);
        // Another card that is fully on screen.
        const otherIndex = await page.evaluate(
            (lowIndex) => {
                const all = Array.from(
                    document.querySelectorAll('.post-it-card')
                );
                return all.findIndex((el, i) => {
                    const r = el.getBoundingClientRect();
                    return (
                        i !== lowIndex &&
                        r.top > 200 &&
                        r.bottom < 640 &&
                        r.left > 70 &&
                        r.right < 380
                    );
                });
            },
            (await page.locator('.post-it-card').count()) - 1
        );
        expect(otherIndex).toBeGreaterThanOrEqual(0);
        const other = page.locator('.post-it-card').nth(otherIndex);

        // Tap the low card, then another one before anything has happened.
        await tapCard(page, card);
        await page.waitForTimeout(40);
        const otherBox = (await other.boundingBox())!;
        await page.touchscreen.tap(
            otherBox.x + otherBox.width / 2,
            otherBox.y + 8
        );
        await expect(other).toHaveClass(/is-selected/);
        await page.waitForTimeout(700);
        const steady = await view(page);
        await page.waitForTimeout(500);
        expect(await view(page)).toBe(steady);

        // Tap then Escape: nothing selected, nothing to reveal.
        await page.keyboard.press('Escape');
        await tapCard(page, card);
        await page.keyboard.press('Escape');
        const afterEscape = await view(page);
        await page.waitForTimeout(700);
        expect(await view(page)).toBe(afterEscape);
        expect(errors).toEqual([]);
    });

    test('a second finger blocks the reveal until the whole gesture is over', async ({
        page,
        browserName,
    }) => {
        test.skip(
            browserName !== 'chromium',
            'Tooling limit, not a gap in the behaviour: Playwright cannot script multi-touch in WebKit (no CDP touch events). The same rules are unit-tested with synthetic pointers.'
        );
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 738);
        const start = await view(page);
        const box = (await card.boundingBox())!;
        const one = { x: box.x + box.width / 2, y: box.y + 8, id: 1 };
        const two = { x: 30, y: 300, id: 2 };

        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [one],
        });
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [one, two],
        });
        // The first finger lifts while the second stays down.
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [two],
        });
        await page.waitForTimeout(700);
        expect(await view(page)).toBe(start);
        // And two fingers are not a tap, even once both are up.
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        });
        await cdp.detach();
        await page.waitForTimeout(700);
        expect(await view(page)).toBe(start);
        expect(await hitAtHandle(handle)).not.toBe('handle');

        // The next plain tap still works.
        await tapCard(page, card);
        await expect.poll(() => hitAtHandle(handle)).toBe('handle');
    });

    test('near the top edge nothing needs to move', async ({ page }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 400);
        const before = await view(page);
        await tapCard(page, card);
        await expect(card).toHaveClass(/is-selected/);
        await page.waitForTimeout(600);
        expect(await view(page)).toBe(before);
        expect(await hitAtHandle(handle)).toBe('handle');
    });

    test('zoomed out, the handle is still freed and the zoom is kept', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        // The zoom buttons are hidden on a phone and mobile WebKit has no
        // wheel, so the one scripted step here is a wheel event on the canvas
        // (the board's own zoom input).
        await page.evaluate(() => {
            const canvas = document.querySelector('.board-canvas')!;
            const r = canvas.getBoundingClientRect();
            canvas.dispatchEvent(
                new WheelEvent('wheel', {
                    deltaY: 250,
                    clientX: r.x + 100,
                    clientY: r.y + 100,
                    bubbles: true,
                    cancelable: true,
                })
            );
        });
        await page.waitForTimeout(200);
        await untilStill(handle);
        const zoom = (await view(page)).match(/scale\([^)]*\)/)![0];
        expect(zoom).not.toBe('scale(1)');
        await dropHandleAt(page, card, handle, 740);
        expect(await hitAtHandle(handle)).not.toBe('handle');
        await tapCard(page, card);
        await expect.poll(() => hitAtHandle(handle)).toBe('handle');
        // Only the offset changed: the zoom is the one the user chose.
        expect((await view(page)).match(/scale\([^)]*\)/)![0]).toBe(zoom);
    });

    test('with several cards selected, the newest one gets its handle freed', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, true);
        await dropHandleAt(page, card, handle, 738);
        await page.keyboard.press('Escape');
        await expect(card).not.toHaveClass(/is-selected/);
        const before = await storedOf(page);

        // Select every card at once from the keyboard (focus out of any field).
        await page.evaluate(() =>
            (document.activeElement as HTMLElement | null)?.blur()
        );
        await page.keyboard.press('Control+a');
        await expect(page.locator('.board-selection-bar')).toBeVisible();
        expect(
            await page.locator('.post-it-card.is-selected').count()
        ).toBeGreaterThan(1);
        await expect.poll(() => hitAtHandle(handle)).toBe('handle');
        expect(await storedOf(page)).toEqual(before);
    });

    test('respects reduced motion: the view jumps instead of gliding', async ({
        page,
    }) => {
        const sample = (p: Page) =>
            p.evaluate(
                () =>
                    new Promise<number>((resolve) => {
                        const seen = new Set<string>();
                        const end = performance.now() + 900;
                        const tick = () => {
                            seen.add(
                                document.querySelector<HTMLElement>(
                                    '.board-canvas [style*="scale("]'
                                )?.style.transform ?? ''
                            );
                            if (performance.now() < end)
                                requestAnimationFrame(tick);
                            else resolve(seen.size);
                        };
                        tick();
                    })
            );

        for (const [mode, glide] of [
            ['no-preference', true],
            ['reduce', false],
        ] as const) {
            await page.emulateMedia({ reducedMotion: mode });
            const { card, handle } = await openWithNewCard(page, true);
            await dropHandleAt(page, card, handle, 738);
            const watching = sample(page);
            await tapCard(page, card);
            const states = await watching;
            await expect.poll(() => hitAtHandle(handle)).toBe('handle');
            // A jump shows the old and the new view (2 states); a glide shows at
            // least one in between, however few frames a loaded machine renders.
            if (glide) expect(states, mode).toBeGreaterThanOrEqual(3);
            else expect(states, mode).toBeLessThanOrEqual(2);
        }
    });
});

// On a desktop nothing overlaps the handle in the normal case: selecting a
// card, or dragging one, must not move the board.
test.describe('rotate handle: reveal on a desktop', () => {
    test.beforeEach(({ isMobile }) => {
        test.skip(
            isMobile,
            'Skipped by design: the phone layouts are covered by the reveal tests above.'
        );
    });

    const view = (page: Page): Promise<string> =>
        page.evaluate(
            () =>
                document.querySelector<HTMLElement>(
                    '.board-canvas [style*="scale("]'
                )?.style.transform ?? ''
        );

    test('selecting cards with a click never moves the board', async ({
        page,
    }) => {
        await openDemo(page, false);
        // At the moment of each release, is the selected card's handle under
        // the bar or the minimap? (measured in the page, before any reveal)
        await page.evaluate(() => {
            const w = window as unknown as { __hidden: boolean };
            window.addEventListener(
                'pointerup',
                () => {
                    const card = document.querySelector(
                        '.post-it-card.is-selected'
                    );
                    const h = card?.querySelector('.post-it-rotate-handle');
                    if (!h) return void (w.__hidden = false);
                    const r = h.getBoundingClientRect();
                    const top = document.elementFromPoint(
                        r.x + r.width / 2,
                        r.y + r.height / 2
                    );
                    w.__hidden = !!top && !h.contains(top);
                },
                true
            );
        });
        const cards = page.locator('.post-it-card');
        const total = await cards.count();
        let moved = 0;
        for (let i = 0; i < total; i++) {
            const box = await cards.nth(i).boundingBox();
            if (!box) continue;
            const before = await view(page);
            await page.mouse.click(box.x + box.width / 2, box.y + 8);
            await page.waitForTimeout(450);
            const hidden = await page.evaluate(
                () => (window as unknown as { __hidden: boolean }).__hidden
            );
            const changed = (await view(page)) !== before;
            // The board moves for a card whose handle was really covered,
            // and for no other.
            expect(changed, `card ${i}`).toBe(hidden);
            if (changed) moved++;
        }
        // The demo board has at least one such card at this size, and not all.
        expect(moved).toBeGreaterThan(0);
        expect(moved).toBeLessThan(total);
    });

    test('dragging a card, and rotating it, never moves the board', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, false);
        await card.locator('.card-edit-done').dispatchEvent('click');
        const before = await view(page);
        const box = (await card.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 60, box.y + 80, {
            steps: 8,
        });
        await page.mouse.up();
        await page.waitForTimeout(600);
        expect(await view(page)).toBe(before);

        await mouseTurn(page, card, handle, 30);
        await expect.poll(() => storedRotation(page)).toBe(30);
        await page.waitForTimeout(400);
        expect(await view(page)).toBe(before);
    });

    test('a handle really hidden under the bar is freed, and only then', async ({
        page,
    }) => {
        const { card, handle } = await openWithNewCard(page, false);
        await card.locator('.card-edit-done').dispatchEvent('click');
        await untilStill(handle);
        const bar = page.locator('.board-selection-bar');
        await expect(bar).toBeVisible();
        const barBox = (await bar.boundingBox())!;

        // Drag the card until its handle sits under the selection bar.
        const g = await geometry(card, handle);
        const box = (await card.boundingBox())!;
        const sx = box.x + box.width / 2;
        const sy = box.y + box.height / 2;
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        await page.mouse.move(
            sx + (barBox.x + barBox.width / 2 - g.hx),
            sy + (barBox.y + barBox.height / 2 - g.hy),
            { steps: 10 }
        );
        await page.mouse.up();
        await untilStill(handle);
        const dropped = await view(page);
        await page.waitForTimeout(500);
        expect(await view(page)).toBe(dropped);
        expect(await hitAtHandle(handle)).not.toBe('handle');

        const top = (await card.boundingBox())!;
        await page.mouse.click(top.x + top.width / 2, top.y + 8);
        await expect.poll(() => hitAtHandle(handle)).toBe('handle');
        expect(await view(page)).not.toBe(dropped);
    });
});

// The other handles and the stacked cards behave as they did.
test.describe('rotate handle: neighbours', () => {
    test.beforeEach(({ isMobile }) => {
        test.skip(
            !isMobile,
            'Skipped by design: the touch visibility rule only applies where hover does not exist.'
        );
    });

    // One folded stack of two cards, put into the demo store before the page
    // reads it (building one by hand is covered by cardsAndStacks).
    const withStack = async (page: Page) => {
        await openDemo(page, true);
        await page.evaluate((key) => {
            const store = JSON.parse(localStorage.getItem(key) || '{}');
            const [a, b] = store.postIts;
            store.stacks = [
                {
                    _id: 'stack-rev1',
                    userId: a.userId,
                    tabId: a.tabId,
                    x: a.x,
                    y: a.y,
                    collapsed: true,
                    createdAt: a.createdAt,
                    updatedAt: a.updatedAt,
                },
            ];
            a.stackId = b.stackId = 'stack-rev1';
            a.stackOrder = 0;
            b.stackOrder = 1;
            localStorage.setItem(key, JSON.stringify(store));
        }, DEMO_KEY);
        await page.reload();
        await expect(page.locator('.post-it-card.is-pile')).toHaveCount(1);
    };

    const handleStyle = (card: Locator, selector: string) =>
        card.evaluate((element, sel) => {
            const target = element.querySelector(sel);
            if (!target) return null;
            const s = getComputedStyle(target);
            return {
                display: s.display,
                opacity: s.opacity,
                pointerEvents: s.pointerEvents,
            };
        }, selector);

    test('only the selected card shows an active rotate handle; resize handles follow the same rule', async ({
        page,
    }) => {
        await withStack(page);
        // Frame the whole board so every card can be tapped.
        await page.locator('.mobile-board-actions button').last().tap();
        await page.waitForTimeout(600);

        const plain = page.locator('.post-it-card:not(.is-stacked)');
        const total = await plain.count();
        expect(total).toBeGreaterThan(2);

        // Nothing selected: no handle of any kind takes a tap.
        for (let i = 0; i < total; i++) {
            const rotate = await handleStyle(
                plain.nth(i),
                ':scope > .post-it-rotate-handle'
            );
            expect(rotate?.pointerEvents).toBe('none');
            expect(rotate?.opacity).toBe('0');
        }

        await plain.first().tap();
        await expect(plain.first()).toHaveClass(/is-selected/);
        // Opacity eases in, so wait for the end of the transition.
        await expect
            .poll(() =>
                handleStyle(plain.first(), ':scope > .post-it-rotate-handle')
            )
            .toMatchObject({ pointerEvents: 'auto', opacity: '1' });
        await expect
            .poll(() => handleStyle(plain.first(), '.resize-handle'))
            .toMatchObject({ pointerEvents: 'auto', opacity: '1' });

        // Every other card is exactly as before: inert.
        for (let i = 1; i < total; i++) {
            expect(
                await handleStyle(
                    plain.nth(i),
                    ':scope > .post-it-rotate-handle'
                )
            ).toMatchObject({ pointerEvents: 'none', opacity: '0' });
            expect(
                await handleStyle(plain.nth(i), '.resize-handle')
            ).toMatchObject({ pointerEvents: 'none', opacity: '0' });
        }
    });

    test('stacked cards: fan tabs never get a rotate handle, selected or not', async ({
        page,
    }) => {
        await withStack(page);
        await page.locator('.mobile-board-actions button').last().tap();
        await page.waitForTimeout(600);

        // A real press on the folded pile opens its fan.
        await page.locator('.post-it-card.is-pile').first().tap();
        const tabs = page.locator('.post-it-card.is-fan-tab');
        await expect(tabs).toHaveCount(1);

        const rotate = ':scope > .post-it-rotate-handle';
        expect((await handleStyle(tabs.first(), rotate))?.display).toBe('none');
        // Even forced into the selected state, the tab keeps it hidden: the
        // touch rule only sets opacity and pointer events, never display.
        await tabs.first().evaluate((el) => el.classList.add('is-selected'));
        expect((await handleStyle(tabs.first(), rotate))?.display).toBe('none');
        // The front card of the fan is an ordinary card for the handle.
        const front = page.locator('.post-it-card.is-fan-front');
        await expect(front).toHaveCount(1);
        expect((await handleStyle(front, rotate))?.display).not.toBe('none');
    });
});

test.describe('rotate handle: click and keys', () => {
    test('a click or tap goes to the next 15° notch from any angle', async ({
        page,
        isMobile,
    }) => {
        const { card, handle } = await openWithNewCard(page, Boolean(isMobile));

        await press(handle, Boolean(isMobile));
        await expect.poll(() => storedRotation(page)).toBe(15);

        await setAngle(page, card, 37);
        await press(handle, Boolean(isMobile));
        await expect.poll(() => storedRotation(page)).toBe(45);
        expect(angleGap(await paintedAngle(card), 45)).toBeLessThan(0.3);
    });

    test('arrow keys step to the previous and next notch, across the seam', async ({
        page,
        isMobile,
    }) => {
        const { card, handle } = await openWithNewCard(page, Boolean(isMobile));

        await setAngle(page, card, 37);
        await handle.focus();
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => storedRotation(page)).toBe(30);
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => storedRotation(page)).toBe(45);

        await setAngle(page, card, 165);
        await handle.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => storedRotation(page)).toBe(-180);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => storedRotation(page)).toBe(165);
    });

    test('is a named, keyboard-focusable control', async ({
        page,
        isMobile,
    }) => {
        const { handle } = await openWithNewCard(page, Boolean(isMobile));
        await expect(handle).toHaveAccessibleName(/rotate note/i);
        await expect(handle).toHaveAttribute('aria-keyshortcuts', /Arrow/);
        await expect(handle).toHaveAttribute('title', /15° notch/);
        await handle.focus();
        await expect(handle).toBeFocused();
    });
});
