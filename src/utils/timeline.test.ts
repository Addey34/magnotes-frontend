import { buildTimeline } from './timeline';

const TODAY = '2026-07-16';

describe('buildTimeline', () => {
    it('splits cards into overdue, dated (chronological) and undated', () => {
        const cards = [
            { id: 'a', dueDate: '2026-07-10', status: 'todo' }, // overdue
            { id: 'b', dueDate: '2026-07-20', status: 'todo' },
            { id: 'c', dueDate: null, status: 'doing' }, // undated
            { id: 'd', dueDate: '2026-07-16', status: 'todo' }, // today
            { id: 'e', dueDate: '2026-07-20', status: 'done' }, // same date as b
        ];

        const groups = buildTimeline(cards, TODAY);

        expect(groups.overdue.map((c) => c.id)).toEqual(['a']);
        expect(groups.undated.map((c) => c.id)).toEqual(['c']);
        expect(groups.dated.map((col) => col.date)).toEqual([
            '2026-07-16',
            '2026-07-20',
        ]);
        expect(groups.dated[1].cards.map((c) => c.id)).toEqual(['b', 'e']);
    });

    it('keeps a done past-due card out of overdue (placed on its date)', () => {
        const cards = [{ id: 'x', dueDate: '2026-07-01', status: 'done' }];
        const groups = buildTimeline(cards, TODAY);

        expect(groups.overdue).toHaveLength(0);
        expect(groups.dated).toEqual([
            { date: '2026-07-01', cards: [cards[0]] },
        ]);
    });

    it('handles an empty list', () => {
        expect(buildTimeline([], TODAY)).toEqual({
            overdue: [],
            dated: [],
            undated: [],
        });
    });
});
