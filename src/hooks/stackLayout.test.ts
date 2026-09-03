import { PostIt, PostItStack } from '../types/boardTypes';
import {
    EXPANDED_STACK_Z_BASE,
    STACK_EXPAND_OFFSET_X,
    STACK_EXPAND_OFFSET_Y,
    STACK_FAN_TOP_GAP,
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

    it('gives the top slot to exactly one card when siblings tie on zIndex', () => {
        // A tie used to make every tied sibling claim the same top z-index, so
        // they overlapped unresolvably and clicks landed unpredictably.
        const stack = makeStack();
        const cards = [
            makeCard('a', { stackId: 'stack-1', stackOrder: 1, zIndex: 5 }),
            makeCard('b', { stackId: 'stack-1', stackOrder: 2, zIndex: 5 }),
            makeCard('c', { stackId: 'stack-1', stackOrder: 3, zIndex: 5 }),
        ];

        const zIndexes = layoutBoardCards(cards, [stack]).map(
            (card) => card.zIndex
        );

        expect(new Set(zIndexes).size).toBe(zIndexes.length);
        const top = EXPANDED_STACK_Z_BASE + cards.length;
        expect(zIndexes.filter((z) => z === top)).toHaveLength(1);
    });
});
