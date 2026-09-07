import { PostIt, PostItStack } from '../types/boardTypes';
import { GRID_SIZE } from './useDragGrid';
import { CARD_LIMITS } from '../constants/boardDefaults';
import {
    EXPANDED_STACK_Z_BASE,
    PILE_MAX_EDGES,
    STACK_TAB_STEP,
    buildStackViews,
    fanPosition,
    isStackFanned,
    layoutBoardCards,
    resolveCardRect,
    spreadStacks,
    stackMembers,
    STACK_SPREAD_GAP,
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

/** A three-card stack, back to front: a, b, c. */
const trio = () => [
    makeCard('a', { stackId: 'stack-1', stackOrder: 1, color: '#aaa' }),
    makeCard('b', { stackId: 'stack-1', stackOrder: 2, color: '#bbb' }),
    makeCard('c', { stackId: 'stack-1', stackOrder: 3, color: '#ccc' }),
];

describe('fan geometry', () => {
    it('leaves every covered card a band no sibling can reach', () => {
        // The step is the exposed band, and the covering card starts exactly
        // one step to the right — outside that column entirely. That is what
        // the old vertical cascade could not promise: `.post-it-hover-tools`
        // reaches 30px ABOVE its card, so a card silently claimed pointer hits
        // over the header of the card behind it and the fan looked usable
        // while being unusable.
        expect(STACK_TAB_STEP).toBeGreaterThan(0);
        expect(STACK_TAB_STEP).toBeLessThan(CARD_LIMITS.minSize);
    });

    it('keeps the whole fan on the position grid', () => {
        // A stack's origin is grid snapped, so a grid-multiple step lands every
        // fanned card on a grid line as well.
        expect(STACK_TAB_STEP % GRID_SIZE).toBe(0);
    });

    it('anchors the front card on the stack origin', () => {
        // Folding and unfolding must not move the card the user is reading:
        // the fan grows away from the front card, never under it.
        const stack = makeStack();
        expect(fanPosition(stack, 2, 3)).toEqual({ x: 400, y: 200 });
        expect(fanPosition(stack, 1, 3)).toEqual({
            x: 400 - STACK_TAB_STEP,
            y: 200,
        });
        expect(fanPosition(stack, 0, 3)).toEqual({
            x: 400 - 2 * STACK_TAB_STEP,
            y: 200,
        });
        // A lone card sits exactly where the pile did.
        expect(fanPosition(stack, 0, 1)).toEqual({ x: 400, y: 200 });
    });
});

describe('stackMembers', () => {
    it('orders members from back to front', () => {
        const [a, b, c] = trio();
        expect(
            stackMembers([c, a, b], 'stack-1').map((card) => card._id)
        ).toEqual(['a', 'b', 'c']);
    });

    it('closes gaps and ties in stackOrder instead of leaving holes', () => {
        // A failed write or an old board can leave non-contiguous orders. The
        // fan is built from rank, not from the raw value, so it never grows a
        // gap — and ties fall back to a stable, deterministic order.
        const cards = [
            makeCard('a', { stackId: 'stack-1', stackOrder: 9 }),
            makeCard('b', { stackId: 'stack-1', stackOrder: 2 }),
            makeCard('c', { stackId: 'stack-1', stackOrder: 2 }),
        ];
        expect(stackMembers(cards, 'stack-1').map((card) => card._id)).toEqual([
            'b',
            'c',
            'a',
        ]);
    });

    it('ignores members of another stack', () => {
        const cards = [
            makeCard('a', { stackId: 'stack-1', stackOrder: 1 }),
            makeCard('z', { stackId: 'stack-2', stackOrder: 1 }),
        ];
        expect(stackMembers(cards, 'stack-1').map((card) => card._id)).toEqual([
            'a',
        ]);
    });
});

describe('isStackFanned', () => {
    it('follows the stored flag by default', () => {
        expect(isStackFanned(makeStack())).toBe(true);
        expect(isStackFanned(makeStack({ collapsed: true }))).toBe(false);
    });

    it('opens every pile while a filter is active', () => {
        // A search whose match stays folded inside a pile is a search that
        // lies: the card is counted as a result and drawn nowhere.
        expect(
            isStackFanned(makeStack({ collapsed: true }), {
                revealCollapsed: true,
            })
        ).toBe(true);
    });
});

describe('layoutBoardCards', () => {
    it('leaves a free card exactly where it is stored', () => {
        const card = makeCard('free', { x: 900, y: 600 });
        expect(layoutBoardCards([card], [])).toEqual([card]);
    });

    it('splays an open stack into tabs, front card on the origin', () => {
        const stack = makeStack();
        // All stored at the stack origin — the position a drop wrote long ago.
        const cards = trio().map((card) => ({ ...card, x: 400, y: 200 }));

        const [a, b, c] = layoutBoardCards(cards, [stack]);

        expect(a).toMatchObject({ x: 400 - 2 * STACK_TAB_STEP, y: 200 });
        expect(b).toMatchObject({ x: 400 - STACK_TAB_STEP, y: 200 });
        expect(c).toMatchObject({ x: 400, y: 200 });
    });

    it('draws a folded pile as its front card alone, on the origin', () => {
        // The buried cards own no pixels, so they must not catch a drop
        // either — that phantom is what used to swallow cards into piles.
        const stack = makeStack({ collapsed: true });
        const cards = trio();

        const drawn = layoutBoardCards(cards, [stack]);

        expect(drawn).toHaveLength(1);
        expect(drawn[0]).toMatchObject({ _id: 'c', x: 400, y: 200 });
        expect(resolveCardRect('a', cards, [stack])).toBeNull();
    });

    it('folding and unfolding never moves the front card', () => {
        const cards = trio();
        const open = resolveCardRect('c', cards, [makeStack()]);
        const folded = resolveCardRect('c', cards, [
            makeStack({ collapsed: true }),
        ]);
        expect(open).toMatchObject({ x: 400, y: 200 });
        expect(folded).toMatchObject({ x: 400, y: 200 });
    });

    it('reveals the whole pile while a filter is active', () => {
        const stack = makeStack({ collapsed: true });
        const drawn = layoutBoardCards(trio(), [stack], {
            revealCollapsed: true,
        });
        expect(drawn.map((card) => card._id)).toEqual(['a', 'b', 'c']);
    });

    it('follows the stack when it moves, even though members are not rewritten', () => {
        // Regression: settleStack moves the stack but never touches its
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

        expect(layoutBoardCards([card], [moved])[0]).toMatchObject({
            x: 430,
            y: 800,
        });
    });

    it('lets a fanned card being dragged follow the pointer', () => {
        // Regression: the fan position used to be re-applied on every render,
        // so a card dragged out of an open stack never visibly moved — it
        // stayed glued to the pile and only teleported on release.
        const stack = makeStack();
        const dragged = makeCard('a', {
            stackId: 'stack-1',
            stackOrder: 1,
            x: 812,
            y: 745,
        });

        expect(layoutBoardCards([dragged], [stack])[0]).toMatchObject({
            x: 400,
            y: 200,
        });
        expect(
            layoutBoardCards([dragged], [stack], { draggingCardId: 'a' })[0]
        ).toMatchObject({ x: 812, y: 745 });
    });

    it('keeps a dragged pile welded to its stack origin', () => {
        // Dragging the top card of a folded pile drags the whole pile: the
        // stack's coordinates are what move, so the card must stay on the
        // origin instead of breaking away from the deck edges behind it.
        const stack = makeStack({ collapsed: true, x: 620, y: 310 });
        const cards = trio();

        const [drawn] = layoutBoardCards(cards, [stack], {
            draggingCardId: 'c',
        });

        expect(drawn).toMatchObject({ _id: 'c', x: 620, y: 310 });
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
        // siblings. That buried the card right after it, leaving it with zero
        // clickable pixels — genuinely unselectable. Raw zIndex must not
        // disturb the cascade.
        const stack = makeStack();
        const cards = trio();
        // Clicked most recently, so its raw zIndex is the highest.
        cards[1].zIndex = 9999;

        const zIndexes = layoutBoardCards(cards, [stack]).map(
            (card) => card.zIndex
        );

        expect(zIndexes).toEqual([
            EXPANDED_STACK_Z_BASE,
            EXPANDED_STACK_Z_BASE + 1,
            EXPANDED_STACK_Z_BASE + 2,
        ]);
        // Each card sits above the one before it and below the one after it,
        // so every card keeps an exposed band no sibling can steal.
        expect([...zIndexes].sort((a, b) => a - b)).toEqual(zIndexes);
    });
});

describe('spreadStacks', () => {
    it('lays every member out side by side, none covering another', () => {
        // Regression: the read-only public board drew cards from their stored
        // coordinates, which for stacked cards is the stack origin — every note
        // of a pile landed on the same pixel and only the top one was readable.
        const spread = spreadStacks(trio(), [makeStack()]);
        const step = 220 + STACK_SPREAD_GAP;

        expect(spread.map((card) => [card.x, card.y])).toEqual([
            [400, 200],
            [400 + step, 200],
            [400 + 2 * step, 200],
        ]);
    });

    it('spreads a folded pile too — a reader cannot click it open', () => {
        const spread = spreadStacks(trio(), [makeStack({ collapsed: true })]);
        const xs = spread.map((card) => card.x);
        expect(new Set(xs).size).toBe(3);
    });

    it('leaves free cards on their own coordinates', () => {
        const free = makeCard('free', { x: 900, y: 700 });
        const spread = spreadStacks([...trio(), free], [makeStack()]);
        expect(spread.find((card) => card._id === 'free')).toMatchObject({
            x: 900,
            y: 700,
        });
    });

    it('returns the cards untouched when the board has no stack', () => {
        const cards = [makeCard('free', { x: 10, y: 20 })];
        expect(spreadStacks(cards, [])).toBe(cards);
    });
});

describe('buildStackViews', () => {
    it('gives a folded pile one drawn card and hides the rest', () => {
        const views = buildStackViews(trio(), [makeStack({ collapsed: true })]);

        expect(views.get('c')).toMatchObject({
            stackId: 'stack-1',
            role: 'pile',
            count: 3,
            position: 3,
        });
        // Buried cards get no chrome because they get no DOM.
        expect(views.has('a')).toBe(false);
        expect(views.has('b')).toBe(false);
    });

    it('prints the deck edges in the colours of the cards underneath', () => {
        // The pile shows what it holds: the edges are the real cards, nearest
        // first, so a stack reads as a stack of *these* notes.
        const view = buildStackViews(trio(), [makeStack({ collapsed: true })]);
        expect(view.get('c')?.underColors).toEqual(['#bbb', '#aaa']);
    });

    it('never prints more edges than the pile can show', () => {
        const many = Array.from({ length: 9 }, (_, index) =>
            makeCard(`card-${index}`, {
                stackId: 'stack-1',
                stackOrder: index + 1,
            })
        );
        const views = buildStackViews(many, [makeStack({ collapsed: true })]);
        expect(views.get('card-8')?.underColors).toHaveLength(PILE_MAX_EDGES);
    });

    it('marks the last card of an open fan as the front one', () => {
        const views = buildStackViews(trio(), [makeStack()]);
        expect(views.get('a')?.role).toBe('fan-tab');
        expect(views.get('b')?.role).toBe('fan-tab');
        expect(views.get('c')?.role).toBe('fan-front');
    });

    it('crowns the front-most card the board is actually drawing', () => {
        // A search that matches one buried note leaves it alone on the board.
        // It has to wear the front card's chrome — its own toolbar, the fold
        // control — not a tab pointing at siblings nothing is drawing.
        const views = buildStackViews(
            trio(),
            [makeStack()],
            {},
            new Set(['b'])
        );

        expect(views.get('b')).toMatchObject({ role: 'fan-front', count: 3 });
        expect(views.has('a')).toBe(false);
        expect(views.has('c')).toBe(false);
    });

    it('keeps the badge honest about how many notes the pile holds', () => {
        // "1 note" on a pile of three would be a lie: the filter decides what
        // is drawn, never how big the stack is.
        const views = buildStackViews(
            trio(),
            [makeStack()],
            {},
            new Set(['b'])
        );
        expect(views.get('b')?.count).toBe(3);
        expect(views.get('b')?.position).toBe(2);
    });

    it('strips the tab off a card being dragged out of the fan', () => {
        // The card is following the pointer, on its way out of the stack.
        // Dragging it around with a tab still painted down its side reads as a
        // bug, and the fan behind it should close up the way the drop will.
        const views = buildStackViews(trio(), [makeStack()], {
            draggingCardId: 'b',
        });

        expect(views.has('b')).toBe(false);
        expect(views.get('a')?.role).toBe('fan-tab');
        expect(views.get('c')?.role).toBe('fan-front');
    });

    it('promotes the next card when the front one is dragged out', () => {
        const views = buildStackViews(trio(), [makeStack()], {
            draggingCardId: 'c',
        });

        expect(views.has('c')).toBe(false);
        expect(views.get('b')?.role).toBe('fan-front');
    });

    it('keeps the role of a folded pile being dragged', () => {
        // The board reads this role to route the drag onto the stack itself:
        // losing it mid-drag would leave the pile behind and walk off with the
        // top card alone.
        const views = buildStackViews(
            trio(),
            [makeStack({ collapsed: true })],
            { draggingCardId: 'c' }
        );

        expect(views.get('c')).toMatchObject({
            role: 'pile',
            stackId: 'stack-1',
        });
    });

    it('ignores a stack with no cards left in it', () => {
        expect(buildStackViews([], [makeStack()]).size).toBe(0);
    });

    it('leaves free cards out entirely', () => {
        const views = buildStackViews([makeCard('free')], [makeStack()]);
        expect(views.has('free')).toBe(false);
    });
});
