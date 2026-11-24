import {
    API_CARD_LIMITS,
    fitCardToApiLimits,
    fitCardsToApiLimits,
    MAX_IMPORT_CARDS,
    MAX_IMPORT_FILE_BYTES,
    isImportCardCountTooHigh,
    isImportFileTooLarge,
} from './importLimits';

describe('importLimits', () => {
    it('accepts a file at the size limit and rejects one byte above', () => {
        expect(isImportFileTooLarge(MAX_IMPORT_FILE_BYTES)).toBe(false);
        expect(isImportFileTooLarge(MAX_IMPORT_FILE_BYTES + 1)).toBe(true);
    });

    it('accepts the maximum card count and rejects one more', () => {
        expect(isImportCardCountTooHigh(MAX_IMPORT_CARDS)).toBe(false);
        expect(isImportCardCountTooHigh(MAX_IMPORT_CARDS + 1)).toBe(true);
    });
});

describe('fitCardToApiLimits', () => {
    const base = { title: 'Titre', content: 'Texte', x: 1 };

    it('leaves a card within the limits untouched', () => {
        const card = { ...base, tags: ['a'], checklist: [] };
        expect(fitCardToApiLimits(card)).toEqual(card);
    });

    it('shortens a long title and text with an ellipsis, within the cap', () => {
        const card = fitCardToApiLimits({
            ...base,
            title: 'T'.repeat(120),
            content: 'C'.repeat(5000),
        });
        expect(card.title).toHaveLength(API_CARD_LIMITS.title);
        expect(card.title.endsWith('…')).toBe(true);
        expect(card.content).toHaveLength(API_CARD_LIMITS.content);
        expect(card.content.endsWith('…')).toBe(true);
        expect(card.x).toBe(1);
    });

    it('keeps at most 12 distinct tags and 50 checklist items', () => {
        const card = fitCardToApiLimits({
            ...base,
            tags: [
                'Urgent',
                'urgent',
                ...Array.from({ length: 20 }, (_, i) => `t${i}`),
            ],
            checklist: Array.from({ length: 60 }, (_, i) => ({
                id: `c${i}`,
                text: `item ${i}`,
                done: false,
            })),
        });
        expect(card.tags).toHaveLength(API_CARD_LIMITS.tags);
        expect(card.tags?.filter((tag) => /urgent/i.test(tag))).toEqual([
            'Urgent',
        ]);
        expect(card.checklist).toHaveLength(API_CARD_LIMITS.checklistItems);
        expect(card.checklist?.[0].id).toBe('c0');
    });
});

describe('fitCardsToApiLimits', () => {
    const base = { title: 'Titre', content: 'Texte' };

    it('counts only the cards that lost something', () => {
        const { cards, adjusted } = fitCardsToApiLimits([
            base,
            { ...base, title: 'T'.repeat(100) },
            { ...base, tags: Array.from({ length: 13 }, (_, i) => `t${i}`) },
            {
                ...base,
                checklist: Array.from({ length: 51 }, (_, i) => ({
                    id: `${i}`,
                    text: 'x',
                    done: false,
                })),
            },
            // Case-only duplicates collapse without losing anything.
            { ...base, tags: ['Urgent', 'urgent'] },
        ]);
        expect(cards).toHaveLength(5);
        expect(adjusted).toBe(3);
    });
});
