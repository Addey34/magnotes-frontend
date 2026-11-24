import { IMPORT_GAP, placeBesideContent } from './importPlacement';

const card = (x: number, y: number) => ({ x, y, width: 220, height: 150 });

describe('placeBesideContent', () => {
    it('keeps the cards where they are on an empty board', () => {
        const cards = [card(10, 20)];
        expect(placeBesideContent(cards, null)).toBe(cards);
    });

    it('moves the block to the right of the content, top-aligned', () => {
        const placed = placeBesideContent([card(500, 300), card(780, 460)], {
            minX: 0,
            minY: 40,
            maxX: 1000,
            maxY: 900,
        });
        expect(placed.map(({ x, y }) => ({ x, y }))).toEqual([
            { x: 1000 + IMPORT_GAP, y: 40 },
            { x: 1000 + IMPORT_GAP + 280, y: 200 },
        ]);
    });

    it('never overlaps the existing content horizontally', () => {
        const content = { minX: -300, minY: -200, maxX: 640, maxY: 500 };
        const placed = placeBesideContent(
            [card(0, 0), card(100, 100), card(-50, 300)],
            content
        );
        expect(Math.min(...placed.map((c) => c.x))).toBeGreaterThan(
            content.maxX
        );
    });
});
