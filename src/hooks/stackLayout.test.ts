import { PostIt, PostItStack } from '../types/boardTypes';
import { GRID_SIZE } from './useDragGrid';
import {
    CARD_HEADER_BAND,
    CARD_TOOLS_OVERHANG,
    EXPANDED_STACK_Z_BASE,
    STACK_EXPAND_OFFSET_X,
    STACK_EXPAND_OFFSET_Y,
    STACK_FAN_TOP_GAP,
    canBringToFront,
    isCardHidden,
    layoutBoardCards,
    resolveCardRect,
} from './stackLayout';

const now = '2026-01-01T00:00:00.000Z';

const makeCard = (id: string, overrides: Partial<PostIt> = {}): PostIt => ({
    _id: id,
    userId: 'user-1',
    tabId: 'tab-1',
    title: id,
    content: '',
    color: '#fef08a',
    x: 0,
    y: 0,
    width: 220,
    height: 150,
    zIndex: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const makeStack = (overrides: Partial<PostItStack> = {}): PostItStack => ({
    _id: 'stack-1',
    userId: 'user-1',
    tabId: 'tab-1',
    x: 400,
    y: 200,
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

describe('fan geometry', () => {
    it('leaves every card title both visible and clickable', () => {
        // The step must clear the card's own header band AND the next card's
        // 30px upward pointer reach (its hover-tools sit at top:-30px). Verified
        // on a live fan: a 50px step cleared the header on paper but the next
        // card still owned everything past the first ~18px, so the title was
        // visible and unclickable — the fan looked fixed and was not.
        expect(STACK_EXPAND_OFFSET_Y - CARD_TOOLS_OVERHANG).toBeGreaterThan(
            CARD_HEADER_BAND
        );
    });

    it('keeps the whole fan on the position grid', () => {
        // A stack's origin is grid snapped, so grid-multiple steps land every
        // fanned card on a grid line as well.
        expect(STACK_EXPAND_OFFSET_X % GRID_SIZE).toBe(0);
        expect(STACK_EXPAND_OFFSET_Y % GRID_SIZE).toBe(0);
        expect(STACK_FAN_TOP_GAP % GRID_SIZE).toBe(0);
    });

    it('clears the stack widget before the first card', () => {
        // The widget is 150px tall; the fan must start below it, not on top.
        expect(STACK_FAN_TOP_GAP).toBeGreaterThan(150);
    });
});

describe('canBringToFront', () => {
    const first = makeCard('a', { stackId: 'stack-1', stackOrder: 1 });
    const middle = makeCard('b', { stackId: 'stack-1', stackOrder: 2 });
    const front = makeCard('c', { stackId: 'stack-1', stackOrder: 3 });
    const free = makeCard('free');
    const other = makeCard('d', { stackId: 'stack-2', stackOrder: 9 });
    const fan = [first, middle, front, free, other];

    it('offers the affordance to every card the fan covers', () => {
        expect(canBringToFront(first, fan)).toBe(true);
        expect(canBringToFront(middle, fan)).toBe(true);
    });

    it('hides it on the card that is already fully visible', () => {
        // Promoting the front card is a no-op write; no button, no confusion.
        expect(canBringToFront(front, fan)).toBe(false);
    });

    it('hides it on a card that is not stacked at all', () => {
        expect(canBringToFront(free, fan)).toBe(false);
    });

    it('never counts a member of another stack as a card in front', () => {
        expect(canBringToFront(front, [front, other])).toBe(false);
    });

    it('hides it on a lone stack member', () => {
        expect(canBringToFront(first, [first])).toBe(false);
    });
});

describe('layoutBoardCards', () => {
    it('leaves a free card exactly where it is stored', () => {
        const card = makeCard('free', { x: 900, y: 600 });
        expect(layoutBoardCards([card], [])).toEqual([card]);
    });

    it('draws an expanded stack member on the fan, not at its stored position', () => {
        const stack = makeStack();
        // Stored at the stack origin — the position a drop wrote long ago.
        const first = makeCard('a', {
            stackId: 'stack-1',
            stackOrder: 1,
            x: 400,
            y: 200,
        });
        const second = makeCard('b', {
            stackId: 'stack-1',
            stackOrder: 2,
            x: 400,
            y: 200,
        });

        const [a, b] = layoutBoardCards([first, second], [stack]);

        expect(a).toMatchObject({ x: 400, y: 200 + STACK_FAN_TOP_GAP });
        expect(b).toMatchObject({
            x: 400 + STACK_EXPAND_OFFSET_X,
            y: 200 + STACK_FAN_TOP_GAP + STACK_EXPAND_OFFSET_Y,
        });
    });

    it('follows the stack when it moves, even though the members are not rewritten', () => {
        // Regression: settleStack moves the stack widget but never touches its
        // members' x/y, so their stored coordinates point at the stack's OLD
        // location. Reading those directly leaves phantom rectangles behind on
        // empty board space.
        const moved = makeStack({ x: 430, y: 800 });
        const card = makeCard('a', {
            stackId: 'stack-1',
            stackOrder: 1,
            x: 400,
            y: 200,
        });

        const [laidOut] = layoutBoardCards([card], [moved]);

        expect(laidOut).toMatchObject({ x: 430, y: 800 + STACK_FAN_TOP_GAP });
    });

    it('omits the members of a collapsed stack entirely', () => {
        // Nothing is drawn for them, so they must not be able to catch a drop.
        const stack = makeStack({ collapsed: true });
        const card = makeCard('a', { stackId: 'stack-1', stackOrder: 1 });
        const free = makeCard('free', { x: 900, y: 600 });

        expect(layoutBoardCards([card, free], [stack])).toEqual([free]);
        expect(resolveCardRect('a', [card, free], [stack])).toBeNull();
        expect(isCardHidden(card, [stack])).toBe(true);
        expect(isCardHidden(free, [stack])).toBe(false);
    });

    it('lets the dragged card follow the pointer instead of snapping to the fan', () => {
        // Regression: the fan position used to be re-applied on every render,
        // so a card dragged out of an expanded stack never visibly moved — it
        // stayed glued to the pile and only teleported on release.
        const stack = makeStack();
        const dragged = makeCard('a', {
            stackId: 'stack-1',
            stackOrder: 1,
            x: 812,
            y: 745,
        });

        const [pinned] = layoutBoardCards([dragged], [stack]);
        expect(pinned).toMatchObject({ x: 400, y: 200 + STACK_FAN_TOP_GAP });

        const [live] = layoutBoardCards([dragged], [stack], {
            draggingCardId: 'a',
        });
        expect(live).toMatchObject({ x: 812, y: 745 });
    });

    it('keeps a card whose stack no longer exists visible and free', () => {
        const orphan = makeCard('a', {
            stackId: 'deleted',
            stackOrder: 1,
            x: 120,
            y: 90,
        });
        expect(layoutBoardCards([orphan], [])).toEqual([orphan]);
    });

    it('paints fanned cards above any ordinary card on the board', () => {
        const stack = makeStack();
        const stacked = makeCard('a', {
            stackId: 'stack-1',
            stackOrder: 1,
            zIndex: 2,
        });
        const busyFreeCard = makeCard('free', { zIndex: 9999 });

        const [laidOut] = layoutBoardCards([stacked, busyFreeCard], [stack]);

        expect(laidOut.zIndex).toBeGreaterThanOrEqual(EXPANDED_STACK_Z_BASE);
        expect(laidOut.zIndex).toBeGreaterThan(busyFreeCard.zIndex);
    });

    it('paints strictly by fan order, whatever a card has been clicked', () => {
        // Regression: a click used to raise the focused card above ALL its
        // siblings. That buried the card right after it — header covered by the
        // raised card, body covered by the next one — leaving it with zero
        // clickable pixels. Measured on a live fan: the middle card became
        // completely unselectable. Raw zIndex must not disturb the cascade.
        const stack = makeStack();
        const cards = [
            makeCard('a', { stackId: 'stack-1', stackOrder: 1, zIndex: 1 }),
            // Clicked most recently, so its raw zIndex is the highest.
            makeCard('b', { stackId: 'stack-1', stackOrder: 2, zIndex: 9999 }),
            makeCard('c', { stackId: 'stack-1', stackOrder: 3, zIndex: 2 }),
        ];

        const zIndexes = layoutBoardCards(cards, [stack]).map(
            (card) => card.zIndex
        );

        expect(zIndexes).toEqual([
            EXPANDED_STACK_Z_BASE,
            EXPANDED_STACK_Z_BASE + 1,
            EXPANDED_STACK_Z_BASE + 2,
        ]);
        // Each card sits above the one before it and below the one after it, so
        // every card keeps an exposed band no sibling can steal.
        expect([...zIndexes].sort((a, b) => a - b)).toEqual(zIndexes);
    });
});
