import {
    applyMention,
    findOpenMention,
    suggestMentionTitles,
} from './mentionCompletion';

describe('findOpenMention', () => {
    it('finds the unfinished mention before the caret', () => {
        expect(findOpenMention('voir [[Pro', 10)).toEqual({
            start: 5,
            query: 'Pro',
        });
    });

    it('opens on a bare [[ with an empty query', () => {
        expect(findOpenMention('[[', 2)).toEqual({ start: 0, query: '' });
    });

    it('ignores a mention that is already closed', () => {
        expect(findOpenMention('[[Projet]] suite', 16)).toBeNull();
    });

    it('ignores an [[ on an earlier line', () => {
        expect(findOpenMention('[[Pro\nautre', 11)).toBeNull();
    });

    it('only reads up to the caret', () => {
        expect(findOpenMention('[[Projet', 4)).toEqual({
            start: 0,
            query: 'Pr',
        });
    });

    it('returns null without any [[', () => {
        expect(findOpenMention('rien [ ici', 10)).toBeNull();
    });
});

describe('suggestMentionTitles', () => {
    const titles = [
        'Plan',
        'Projet Alpha',
        'Idée projet',
        'Plan',
        'Notes',
        ' ',
    ];

    it('puts prefix matches before substring matches', () => {
        expect(suggestMentionTitles('pro', titles)).toEqual([
            'Projet Alpha',
            'Idée projet',
        ]);
    });

    it('lists everything (deduplicated, no blanks) for an empty query', () => {
        expect(suggestMentionTitles('', titles)).toEqual([
            'Plan',
            'Projet Alpha',
            'Idée projet',
            'Notes',
        ]);
    });

    it('drops the excluded title and honours the limit', () => {
        expect(suggestMentionTitles('', titles, 'plan', 2)).toEqual([
            'Projet Alpha',
            'Idée projet',
        ]);
    });
});

describe('applyMention', () => {
    it('completes the open mention and parks the caret after ]]', () => {
        const text = 'voir [[Pro et la suite';
        const open = { start: 5, query: 'Pro' };
        expect(applyMention(text, 10, open, 'Projet Alpha')).toEqual({
            text: 'voir [[Projet Alpha]] et la suite',
            caret: 21,
        });
    });

    it('reuses brackets already present after the caret', () => {
        const text = '[[Pro]] fin';
        const open = { start: 0, query: 'Pro' };
        expect(applyMention(text, 5, open, 'Projet')).toEqual({
            text: '[[Projet]] fin',
            caret: 10,
        });
    });
});
