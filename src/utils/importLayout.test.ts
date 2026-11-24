import {
    estimateImportedHeight,
    IMPORT_ROW_GAP,
    stackByColumn,
} from './importLayout';
import { DEFAULT_POST_IT } from '../constants/boardDefaults';

const plain = { content: '', checklist: [], tags: [] };

describe('estimateImportedHeight', () => {
    it('is the default height for a bare card', () => {
        expect(estimateImportedHeight(plain)).toBe(DEFAULT_POST_IT.height);
    });

    it('grows with tags, checklist items and long text', () => {
        const tagged = estimateImportedHeight({ ...plain, tags: ['a'] });
        const withList = estimateImportedHeight({
            ...plain,
            checklist: [1, 2, 3, 4],
        });
        const wordy = estimateImportedHeight({
            ...plain,
            content: 'x'.repeat(400),
        });
        expect(tagged).toBeGreaterThan(DEFAULT_POST_IT.height);
        expect(withList).toBeGreaterThan(tagged);
        expect(wordy).toBeGreaterThan(DEFAULT_POST_IT.height);
    });

    it('caps the growth so one huge card cannot push a column away', () => {
        const huge = estimateImportedHeight({
            content: 'x'.repeat(100_000),
            checklist: new Array(500).fill(0),
            tags: ['a'],
            dueDate: '2030-01-01',
        });
        expect(huge).toBeLessThanOrEqual(DEFAULT_POST_IT.height + 650);
    });
});

describe('stackByColumn', () => {
    it('stacks a column under the estimated height of the card above', () => {
        const tall = { ...plain, checklist: [1, 2, 3, 4] };
        const { offsets, height } = stackByColumn([
            { card: tall, column: 0, row: 0 },
            { card: plain, column: 0, row: 1 },
            { card: plain, column: 1, row: 0 },
        ]);
        expect(offsets[0]).toBe(0);
        expect(offsets[1]).toBe(estimateImportedHeight(tall) + IMPORT_ROW_GAP);
        expect(offsets[2]).toBe(0);
        expect(height).toBe(offsets[1] + estimateImportedHeight(plain));
    });

    it('keeps the input order whatever the order of the rows', () => {
        const { offsets } = stackByColumn([
            { card: plain, column: 0, row: 1 },
            { card: plain, column: 0, row: 0 },
        ]);
        expect(offsets[1]).toBe(0);
        expect(offsets[0]).toBeGreaterThan(0);
    });
});
