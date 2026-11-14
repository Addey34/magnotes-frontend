import {
    computeDropIntent,
    DropRect,
    getOverlap,
    STACK_CENTER_DISTANCE,
} from './dropIntent';

const card = (
    _id: string,
    x: number,
    y: number,
    width = 220,
    height = 150
): DropRect => ({ _id, x, y, width, height });

describe('getOverlap', () => {
    it('returns the overlapping length of two ranges', () => {
        expect(getOverlap(0, 10, 5, 20)).toBe(5);
    });

    it('returns 0 for disjoint ranges', () => {
        expect(getOverlap(0, 10, 20, 30)).toBe(0);
    });
});

describe('computeDropIntent', () => {
    it('returns null when there are no candidates', () => {
        expect(computeDropIntent(card('a', 0, 0), [])).toBeNull();
    });

    it('ignores the moved card if it appears among the candidates', () => {
        const moved = card('a', 0, 0);
        expect(computeDropIntent(moved, [moved])).toBeNull();
    });

    describe('stacking', () => {
        it('stacks when centers coincide', () => {
            const moved = card('a', 0, 0);
            const target = card('b', 0, 0);
            expect(computeDropIntent(moved, [target])).toEqual({
                type: 'stack',
                targetId: 'b',
            });
        });

        it('stacks when the center is just inside the threshold', () => {
            const target = card('b', 0, 0); // center (110, 75)
            const moved = card('a', STACK_CENTER_DISTANCE - 1, 0);
            expect(computeDropIntent(moved, [target])).toEqual({
                type: 'stack',
                targetId: 'b',
            });
        });

        it('does not stack once the center is beyond the threshold', () => {
            const target = card('b', 0, 0);
            const moved = card('a', STACK_CENTER_DISTANCE + 5, 0);
            const intent = computeDropIntent(moved, [target]);
            expect(intent?.type).not.toBe('stack');
        });

        it('picks the nearest candidate to stack onto', () => {
            const near = card('near', 5, 0);
            const far = card('far', 300, 300);
            const moved = card('a', 0, 0);
            expect(computeDropIntent(moved, [far, near])).toEqual({
                type: 'stack',
                targetId: 'near',
            });
        });

        it('prefers stacking over docking when both qualify', () => {
            // Fully overlapping cards satisfy both the stack and dock checks;
            // stack must win.
            const moved = card('a', 0, 0);
            const target = card('b', 0, 0);
            expect(computeDropIntent(moved, [target])?.type).toBe('stack');
        });
    });

    describe('docking', () => {
        it('docks to the right edge with full vertical overlap', () => {
            const target = card('b', 0, 0); // right edge at x=220
            const moved = card('a', 220, 0);
            expect(computeDropIntent(moved, [target])).toMatchObject({
                type: 'dock',
                targetId: 'b',
                x: 220,
                y: 0,
            });
        });

        it('docks below with horizontal overlap', () => {
            const target = card('b', 0, 0); // bottom edge at y=150
            const moved = card('a', 0, 150);
            expect(computeDropIntent(moved, [target])).toMatchObject({
                type: 'dock',
                targetId: 'b',
                x: 0,
                y: 150,
            });
        });

        it('does not dock when vertical overlap is below the ratio', () => {
            const target = card('b', 0, 0);
            // Slide the moved card far down so overlap < 45% of height.
            const moved = card('a', 220, 130);
            const intent = computeDropIntent(moved, [target]);
            expect(intent).toBeNull();
        });

        it('does not dock when the edge is beyond the distance threshold', () => {
            const target = card('b', 0, 0);
            const moved = card('a', 300, 0); // right edge gap of 80 > 20
            expect(computeDropIntent(moved, [target])).toBeNull();
        });

        it('keeps the exact touching coordinate, not rounded to the grid', () => {
            // Card width (220) isn't a multiple of GRID_SIZE (24); re-snapping
            // this to the grid used to leave a gap/overlap instead of a clean
            // edge-to-edge touch. The target itself doesn't need to be
            // grid-aligned either — 7 is deliberately off-grid here.
            const target = card('b', 7, 0);
            const moved = card('a', 227, 0);
            expect(computeDropIntent(moved, [target])).toMatchObject({
                type: 'dock',
                targetId: 'b',
                x: 227,
                y: 0,
            });
        });
    });

    describe('docking against several sides at once', () => {
        it('touches the side card and the card above in the same drop', () => {
            const left = card('left', 0, 200); // right edge x=220
            const above = card('above', 240, 0); // bottom edge y=150
            const moved = card('m', 225, 160);
            // Docked on the right of `left` (x=220), and the free axis lands
            // flush under `above` (y=150) instead of copying left's top (200).
            expect(computeDropIntent(moved, [left, above])).toMatchObject({
                type: 'dock',
                targetId: 'left',
                x: 220,
                y: 150,
            });
        });

        it('does the same on the other axis: below one card, beside another', () => {
            const top = card('top', 0, 0); // bottom edge y=150
            const side = card('side', 230, 160); // left edge x=230
            const moved = card('m', 5, 155);
            // Docked below `top` (y=150), then pushed flush against `side`
            // (its left edge, so the moved card ends at x=230).
            expect(computeDropIntent(moved, [top, side])).toMatchObject({
                type: 'dock',
                targetId: 'top',
                x: 10,
                y: 150,
            });
        });

        it('keeps the dropped offset when nothing is close enough to line up with', () => {
            const left = card('left', 0, 200);
            const far = card('far', 240, -300);
            const moved = card('m', 225, 160);
            // Docked on the right of `left`, but 40px above its top: a
            // deliberate stagger, not snapped to y=200.
            expect(computeDropIntent(moved, [left, far])).toMatchObject({
                type: 'dock',
                targetId: 'left',
                x: 220,
                y: 160,
            });
        });

        it('aligns with the neighbour top when dropped close to it', () => {
            const left = card('left', 0, 200);
            expect(
                computeDropIntent(card('m', 225, 208), [left])
            ).toMatchObject({ x: 220, y: 200 });
        });

        it('lets a card be centred under two cards sitting side by side', () => {
            const a = card('a', 0, 0); // spans x 0..220
            const b = card('b', 220, 0); // spans x 220..440, run centre 220
            // Moved card centre at x=228 → left edge 118, within reach of the
            // centred position (110); it must land centred, flush below.
            expect(
                computeDropIntent(card('m', 118, 155), [a, b])
            ).toMatchObject({
                type: 'dock',
                x: 110,
                y: 150,
                neighborIds: expect.arrayContaining(['a', 'b']),
            });
        });

        it('keeps a staggered position under two cards when far from any alignment', () => {
            const a = card('a', 0, 0);
            const b = card('b', 220, 0);
            expect(computeDropIntent(card('m', 60, 155), [a, b])).toMatchObject(
                { x: 60, y: 150 }
            );
        });

        it('never lines up with a card that sits in its own column', () => {
            const left = card('left', 0, 200);
            // `below` occupies the docked card's column: aligning with its top
            // (y=420) would land on top of it; only touching it is allowed.
            const below = card('below', 240, 420);
            const moved = card('m', 225, 205);
            const intent = computeDropIntent(moved, [left, below]);
            expect(intent).toMatchObject({ type: 'dock', x: 220 });
            if (intent?.type === 'dock') {
                const overlapsBelow =
                    intent.y < below.y + below.height &&
                    intent.y + moved.height > below.y;
                expect(overlapsBelow).toBe(false);
            }
        });
    });
});

describe('dock neighbours', () => {
    it('lists the dock target alone when it touches nothing else', () => {
        const intent = computeDropIntent(card('a', 220, 0), [card('b', 0, 0)]);
        expect(intent).toMatchObject({ type: 'dock', neighborIds: ['b'] });
    });

    it('lists every card a corner drop touches, target first', () => {
        const left = card('left', 0, 200);
        const above = card('above', 240, 0);
        const intent = computeDropIntent(card('m', 225, 160), [left, above]);
        expect(intent).toMatchObject({
            type: 'dock',
            targetId: 'left',
            neighborIds: ['left', 'above'],
        });
    });

    it('does not list cards that are only close, not flush', () => {
        const left = card('left', 0, 200);
        const near = card('near', 240, -60); // bottom edge y=90, not touching
        const intent = computeDropIntent(card('m', 225, 205), [left, near]);
        expect(intent).toMatchObject({ type: 'dock', neighborIds: ['left'] });
    });
});

describe('sliding along a docked edge', () => {
    it('keeps any position along the edge, not only aligned ones', () => {
        const target = card('t', 0, 0);
        for (const y of [-80, -30, 31, 77, 80]) {
            expect(
                computeDropIntent(card('m', 222, y), [target])
            ).toMatchObject({ type: 'dock', x: 220, y });
        }
    });

    it('no longer pulls from far away', () => {
        const target = card('t', 0, 0);
        expect(computeDropIntent(card('m', 250, 0), [target])).toBeNull();
    });
});
