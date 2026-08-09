import {
    findFreePostItPosition,
    POST_IT_PLACEMENT_GAP,
} from './postItPlacement';

const size = { width: 220, height: 150 };

describe('findFreePostItPosition', () => {
    it('keeps a new post-it out of existing cards', () => {
        const position = findFreePostItPosition(
            { x: 72, y: 72 },
            [{ x: 48, y: 48, ...size }],
            size
        );

        expect(
            position.x >= 48 + size.width + POST_IT_PLACEMENT_GAP ||
                position.y >= 48 + size.height + POST_IT_PLACEMENT_GAP
        ).toBe(true);
    });

    it('allows cards to remain close while preserving a gap', () => {
        const position = findFreePostItPosition(
            { x: 0, y: 0 },
            [{ x: 220 + POST_IT_PLACEMENT_GAP, y: 0, ...size }],
            size
        );

        expect(position).toEqual({ x: 0, y: 0 });
    });

    it('clamps requested positions to the visible board origin', () => {
        expect(findFreePostItPosition({ x: -20, y: -8 }, [], size)).toEqual({
            x: 0,
            y: 0,
        });
    });
});
