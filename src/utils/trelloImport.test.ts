import { todayIso } from './cardMeta';
import {
    buildTrelloCards,
    isTrelloBoard,
    parseTrelloBoard,
    trelloDueDate,
} from './trelloImport';

describe('trelloDueDate', () => {
    it('keeps a calendar day and converts a timestamp to a local day', () => {
        expect(trelloDueDate('2026-05-01')).toBe('2026-05-01');
        const stamp = '2026-05-01T22:30:00.000Z';
        expect(trelloDueDate(stamp)).toBe(todayIso(new Date(stamp)));
    });

    it('drops empty or unreadable values instead of sending them', () => {
        expect(trelloDueDate(null)).toBeUndefined();
        expect(trelloDueDate('')).toBeUndefined();
        expect(trelloDueDate('soon')).toBeUndefined();
        expect(trelloDueDate(42)).toBeUndefined();
    });

    it('flags an unreadable due date on the parsed card', () => {
        const [card] = parseTrelloBoard({
            name: 'B',
            lists: [{ id: 'l', name: 'Todo', pos: 1 }],
            cards: [{ id: 'c', name: 'X', idList: 'l', pos: 1, due: 'soon' }],
        });
        expect(card.dueDate).toBeUndefined();
        expect(card.unreadDueDate).toBe('soon');
    });
});

const sampleBoard = {
    name: 'Projet',
    lists: [
        { id: 'l1', name: 'À faire', pos: 1 },
        { id: 'l2', name: 'En cours', pos: 2 },
        { id: 'l3', name: 'Terminé', pos: 3 },
        { id: 'l4', name: 'Archive', pos: 4, closed: true },
    ],
    cards: [
        {
            id: 'c1',
            name: 'Première tâche',
            desc: 'description',
            idList: 'l1',
            pos: 2,
            labels: [{ name: 'urgent' }, { name: '' }],
            due: '2026-05-01T10:00:00.000Z',
        },
        {
            id: 'c2',
            name: 'Autre tâche',
            idList: 'l1',
            pos: 1,
        },
        { id: 'c3', name: 'En route', idList: 'l2', pos: 1 },
        { id: 'c4', name: 'Fini', idList: 'l3', pos: 1 },
        { id: 'c5', name: 'Archivée', idList: 'l1', pos: 5, closed: true },
    ],
    checklists: [
        {
            idCard: 'c1',
            checkItems: [
                { name: 'étape 2', state: 'incomplete', pos: 2 },
                { name: 'étape 1', state: 'complete', pos: 1 },
            ],
        },
    ],
};

describe('isTrelloBoard', () => {
    it('recognizes a Trello export shape', () => {
        expect(isTrelloBoard(sampleBoard)).toBe(true);
        expect(isTrelloBoard({ cards: [], lists: [] })).toBe(true);
    });

    it('rejects non-Trello data', () => {
        expect(isTrelloBoard(null)).toBe(false);
        expect(isTrelloBoard({ foo: 1 })).toBe(false);
        expect(isTrelloBoard('# Markdown')).toBe(false);
    });
});

describe('parseTrelloBoard', () => {
    const cards = parseTrelloBoard(sampleBoard);

    it('imports only open cards', () => {
        expect(cards.map((card) => card.title).sort()).toEqual([
            'Autre tâche',
            'En route',
            'Fini',
            'Première tâche',
        ]);
    });

    it('assigns columns by list order and rows by card position', () => {
        const first = cards.find((card) => card.title === 'Autre tâche');
        const second = cards.find((card) => card.title === 'Première tâche');
        // Both in list l1 (column 0); pos 1 before pos 2.
        expect(first?.column).toBe(0);
        expect(first?.row).toBe(0);
        expect(second?.column).toBe(0);
        expect(second?.row).toBe(1);
        expect(cards.find((card) => card.title === 'En route')?.column).toBe(1);
    });

    it('maps labels to tags, due date, and merges checklist items in order', () => {
        const card = cards.find((c) => c.title === 'Première tâche');
        expect(card?.tags).toEqual(['urgent']);
        // A calendar day, the only form the API accepts (local time).
        expect(card?.dueDate).toBe(
            todayIso(new Date('2026-05-01T10:00:00.000Z'))
        );
        expect(card?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(card?.checklist.map((item) => [item.text, item.done])).toEqual([
            ['étape 1', true],
            ['étape 2', false],
        ]);
    });

    it('derives status from the list name', () => {
        expect(cards.find((card) => card.title === 'Autre tâche')?.status).toBe(
            'todo'
        );
        expect(cards.find((card) => card.title === 'En route')?.status).toBe(
            'doing'
        );
        expect(cards.find((card) => card.title === 'Fini')?.status).toBe(
            'done'
        );
    });

    it('returns an empty array for non-board input', () => {
        expect(parseTrelloBoard(null)).toEqual([]);
        expect(parseTrelloBoard({})).toEqual([]);
    });
});

describe('buildTrelloCards', () => {
    it('positions cards in columns and rows', () => {
        const cards = parseTrelloBoard(sampleBoard);
        const payloads = buildTrelloCards(cards, 'tab-1');
        expect(payloads).toHaveLength(4);
        const positions = new Set(
            payloads.map((card) => `${card.x},${card.y}`)
        );
        expect(positions.size).toBe(payloads.length);
        expect(payloads.every((card) => card.tabId === 'tab-1')).toBe(true);
    });

    it('centers the grid on the provided point', () => {
        const cards = parseTrelloBoard(sampleBoard);
        const payloads = buildTrelloCards(cards, 'tab-1', { x: 500, y: 500 });
        const minX = Math.min(...payloads.map((card) => card.x));
        const maxX = Math.max(...payloads.map((card) => card.x + card.width));
        expect((minX + maxX) / 2).toBeCloseTo(500);
    });

    it('returns an empty array for no cards', () => {
        expect(buildTrelloCards([], 'tab-1')).toEqual([]);
    });
});
