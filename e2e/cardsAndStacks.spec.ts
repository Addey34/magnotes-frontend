import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { startEditingCard } from './cardEditing';

const DEMO_KEY = 'magnotes-demo-board-v1';

const openDemo = async (page: Page) => {
    await page.addInitScript(() => localStorage.setItem('magnotes-lang', 'en'));
    await page.route('**/api/auth/refresh', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'No active session' }),
        })
    );
    await page.goto('/app/?demo=1');
    await expect(page.locator('.board-app')).toBeVisible();
    await expect(page.locator('.post-it-card').first()).toBeVisible();
};

const centre = async (locator: Locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Element has no visible geometry.');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/**
 * Drags from one point to another with the pointer the project really uses:
 * native CDP touch events on the touch project, a mouse otherwise. `onHover`
 * runs while the pointer is still down, so a test can observe the drop intent
 * before it is committed.
 */
const drag = async (
    page: Page,
    isTouch: boolean,
    from: { x: number; y: number },
    to: { x: number; y: number },
    onHover?: () => Promise<void>
) => {
    const steps = 8;
    const at = (step: number) => ({
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
    });
    if (!isTouch) {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let step = 1; step <= steps; step += 1) {
            const point = at(step);
            await page.mouse.move(point.x, point.y);
        }
        await page.waitForTimeout(250);
        await onHover?.();
        await page.mouse.up();
        return;
    }
    const session = await page.context().newCDPSession(page);
    const touch = (point: { x: number; y: number }) => [
        { ...point, id: 1, radiusX: 1, radiusY: 1, force: 1 },
    ];
    await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: touch(from),
    });
    await page.waitForTimeout(80);
    for (let step = 1; step <= steps; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: touch(at(step)),
        });
        await page.waitForTimeout(40);
    }
    await page.waitForTimeout(250);
    await onHover?.();
    await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
    });
    await session.detach();
};

const noHorizontalOverflow = async (page: Page) => {
    const overflow = await page.evaluate(
        () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
};

/** True when the element's text is clipped (ellipsis or overflow). */
const isTruncated = (locator: Locator) =>
    locator.evaluate((element) => element.scrollWidth > element.clientWidth);

const contrastViolations = async (page: Page, selector: string) => {
    const results = await new AxeBuilder({ page })
        .include(selector)
        .withRules(['color-contrast'])
        .analyze();
    return results.violations.flatMap((violation) =>
        violation.nodes.map(
            (node) =>
                `${node.html.slice(0, 120)} :: ${node.any[0]?.message ?? ''}`
        )
    );
};

test.describe('cards and stacks journey', () => {
    test('creates, edits, stacks, fans, selects, folds and persists', async ({
        page,
        isMobile,
    }) => {
        // Desktop runs at 1440x900; the mobile project keeps its 390x844 profile.
        if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
        await openDemo(page);
        const cards = page.locator('.post-it-card');
        const initialCards = await cards.count();
        const initialPiles = await page
            .locator('.post-it-card.is-pile')
            .count();

        // 1-3. Two new cards, each titled and filled in.
        for (const [index, label] of ['Alpha', 'Bravo'].entries()) {
            await page.locator('.create-card-button').click();
            await expect(cards).toHaveCount(initialCards + index + 1);
            const card = cards.last();
            await startEditingCard(card);
            await card.locator('.post-it-title').fill(`UX02 ${label}`);
            await card.locator('.post-it-content').fill(`Content of ${label}`);
            await card.locator('.post-it-content').blur();
            await expect(card.locator('.post-it-title')).toHaveValue(
                `UX02 ${label}`
            );
        }
        const alpha = page.locator('.post-it-card', {
            has: page.locator('.post-it-title[value="UX02 Alpha"]'),
        });
        const bravo = page.locator('.post-it-card', {
            has: page.locator('.post-it-title[value="UX02 Bravo"]'),
        });
        await expect(alpha).toBeVisible();
        await expect(bravo).toBeVisible();

        // The stack rule measures card centre to card centre, so aim the
        // pointer such that Alpha's CENTRE (not the grab point) lands on
        // Bravo's centre.
        const alphaDrag = alpha.locator('.post-it-date');
        const alphaStart = await centre(alphaDrag);
        const alphaCentre = await centre(alpha);
        const bravoCentre = await centre(bravo);
        const target = {
            x: bravoCentre.x + (alphaStart.x - alphaCentre.x),
            y: bravoCentre.y + (alphaStart.y - alphaCentre.y),
        };

        // 4-5. Drop Alpha on the centre of Bravo; the intent badge announces
        // the stack before the pointer is released.
        await drag(page, Boolean(isMobile), alphaStart, target, async () => {
            await expect(page.locator('.drop-intent-badge')).toHaveText(
                /^(stack|empiler)$/i
            );
        });

        const piles = page.locator('.post-it-card.is-pile');
        await expect(piles).toHaveCount(initialPiles + 1);
        // The header counter follows the new pile.
        await expect(page.locator('.board-subtitle')).toContainText(
            `/ ${initialPiles + 1} stack`
        );
        await noHorizontalOverflow(page);
        // The counter reads in full, titles included, whatever the width.
        expect(await isTruncated(page.locator('.board-subtitle'))).toBe(false);
        expect(await isTruncated(page.locator('.board-title-trigger'))).toBe(
            false
        );

        // 6. Fan the new pile out into horizontal side tabs.
        const pile = piles.filter({
            has: page.locator('.post-it-title[value^="UX02"]'),
        });
        await expect(pile).toHaveCount(1);
        await pile.locator('.post-it-stack-badge').dispatchEvent('click');
        const tabs = page.locator('.post-it-fan-tab');
        await expect(tabs).toHaveCount(1);
        await expect(tabs.first()).toBeVisible();
        const tabBox = await tabs.first().boundingBox();
        const frontBox = await page
            .locator('.post-it-card.is-stacked:not(.is-fan-tab)')
            .first()
            .boundingBox();
        // The covered card trails to the LEFT of the front card.
        expect(tabBox && frontBox && tabBox.x < frontBox.x).toBe(true);
        await noHorizontalOverflow(page);
        expect(await contrastViolations(page, '.board-app')).toEqual([]);

        // 7. Pick the covered card through its side tab.
        const tabLabel = await tabs.first().getAttribute('aria-label');
        const pickedTitle = /UX02 (Alpha|Bravo)/.exec(tabLabel ?? '')?.[0];
        expect(pickedTitle).toBeTruthy();
        // A tab resolves on pointer-up (click = promote, drag = pull out), so
        // it needs a real press: a tap on touch, a mouse click otherwise.
        if (isMobile) await tabs.first().tap();
        else await tabs.first().click();
        await expect(
            page.locator(
                `.post-it-card.is-stacked:not(.is-fan-tab) .post-it-title[value="${pickedTitle}"]`
            )
        ).toBeVisible();

        // 8. Fold the pile again.
        await page
            .locator('.post-it-card .post-it-stack-badge[aria-expanded="true"]')
            .dispatchEvent('click');
        await expect(tabs).toHaveCount(0);
        await expect(piles).toHaveCount(initialPiles + 1);

        // 9. Everything survives a reload, visible and in the store.
        await expect
            .poll(() =>
                page.evaluate(
                    (key) => localStorage.getItem(key) || '',
                    DEMO_KEY
                )
            )
            .toContain('UX02 Alpha');
        await page.reload();
        await expect(page.locator('.board-app')).toBeVisible();
        await expect(piles).toHaveCount(initialPiles + 1);
        await expect(page.locator('.board-subtitle')).toContainText(
            `/ ${initialPiles + 1} stack`
        );
        const persisted = await page.evaluate(
            (key) => localStorage.getItem(key) || '',
            DEMO_KEY
        );
        expect(persisted).toContain('UX02 Alpha');
        expect(persisted).toContain('UX02 Bravo');
        await noHorizontalOverflow(page);
    });

    test('the corner handle only rotates and says so', async ({ page }) => {
        await openDemo(page);
        await page.locator('.create-card-button').click();
        const card = page.locator('.post-it-card').last();
        await card.hover();
        const handle = card.locator('.post-it-rotate-handle');
        await expect(handle).toHaveAccessibleName(/rotate note/i);
        await expect(handle).not.toHaveAttribute('title', /move/i);
        await expect(handle).toHaveAttribute('title', /\+15°/);
        const rotationOf = () =>
            page.evaluate((key) => {
                const store = JSON.parse(localStorage.getItem(key) || '{}');
                const cards = store.postIts ?? [];
                return cards[cards.length - 1]?.rotation ?? 0;
            }, DEMO_KEY);
        const before = await rotationOf();
        await handle.dispatchEvent('click');
        await expect.poll(rotationOf).toBe(before + 15);
    });
});
