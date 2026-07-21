import { cardsToMarkdown } from './boardMarkdown';
import { buildImportedCards, parseMarkdownCards } from './markdownImport';

describe('parseMarkdownCards', () => {
    it('splits level-2 headings into cards and drops the document title', () => {
        const cards = parseMarkdownCards(
            '# Mon tableau\n\n## Première\n\nDu contenu.\n\n## Seconde\n\nAutre.'
        );
        expect(cards.map((card) => card.title)).toEqual([
            'Première',
            'Seconde',
        ]);
        expect(cards[0].content).toBe('Du contenu.');
        expect(cards[1].content).toBe('Autre.');
    });

    it('parses status, tags, due date, and checklist metadata', () => {
        const cards = parseMarkdownCards(
            [
                '## Tâche',
                '',
                '**Statut :** doing',
                '**Échéance :** 2026-12-01',
                '**Tags :** #urgent #client',
                '',
                'Description libre.',
                '',
                '- [ ] Étape A',
                '- [x] Étape B',
            ].join('\n')
        );

        expect(cards).toHaveLength(1);
        const card = cards[0];
        expect(card.status).toBe('doing');
        expect(card.dueDate).toBe('2026-12-01');
        expect(card.tags).toEqual(['urgent', 'client']);
        expect(card.content).toBe('Description libre.');
        expect(card.checklist).toEqual([
            { id: 'md-0', text: 'Étape A', done: false },
            { id: 'md-1', text: 'Étape B', done: true },
        ]);
    });

    it('ignores an unknown status value', () => {
        const [card] = parseMarkdownCards('## X\n\n**Statut :** bloqué');
        expect(card.status).toBeUndefined();
    });

    it('treats preamble before any heading as an untitled card', () => {
        const cards = parseMarkdownCards('Juste une note libre.\n\n## Titre');
        expect(cards).toHaveLength(2);
        expect(cards[0].title).toBe('');
        expect(cards[0].content).toBe('Juste une note libre.');
        expect(cards[1].title).toBe('Titre');
    });

    it('accepts hand-written markdown with any heading level', () => {
        const cards = parseMarkdownCards('### Idée\n\nTexte.\n\n- [ ] à faire');
        expect(cards).toHaveLength(1);
        expect(cards[0].title).toBe('Idée');
        expect(cards[0].checklist).toHaveLength(1);
    });

    it('tolerates CRLF line endings', () => {
        const cards = parseMarkdownCards('## A\r\n\r\nLigne.\r\n');
        expect(cards[0].content).toBe('Ligne.');
    });

    it('drops empty documents and blank cards', () => {
        expect(parseMarkdownCards('')).toEqual([]);
        expect(parseMarkdownCards('# Titre seul')).toEqual([]);
        expect(parseMarkdownCards('##   \n\n')).toEqual([]);
    });

    it('round-trips a board exported by cardsToMarkdown', () => {
        const exported = cardsToMarkdown(
            [
                {
                    title: 'Carte # spéciale',
                    content: 'Texte avec *étoiles* et [crochets].',
                    status: 'todo',
                    dueDate: '2026-01-15',
                    tags: ['a-b', 'c'],
                    checklist: [
                        { text: 'un', done: true },
                        { text: 'deux', done: false },
                    ],
                    createdAt: '2026-01-01',
                },
            ],
            { documentTitle: 'Board' }
        );

        const [card] = parseMarkdownCards(exported);
        expect(card.title).toBe('Carte # spéciale');
        expect(card.content).toBe('Texte avec *étoiles* et [crochets].');
        expect(card.status).toBe('todo');
        expect(card.dueDate).toBe('2026-01-15');
        expect(card.tags).toEqual(['a-b', 'c']);
        expect(card.checklist.map((item) => [item.text, item.done])).toEqual([
            ['un', true],
            ['deux', false],
        ]);
    });
});

describe('buildImportedCards', () => {
    const parsed = parseMarkdownCards(
        '## A\n\ncontenu\n\n## B\n\n## C\n\n## D'
    );

    it('returns one payload per card with a fallback title', () => {
        const payloads = buildImportedCards(parsed, 'tab-1');
        expect(payloads).toHaveLength(4);
        expect(payloads.every((card) => card.tabId === 'tab-1')).toBe(true);
        expect(payloads.every((card) => card.title.length > 0)).toBe(true);
    });

    it('lays cards out in a grid (no two share a position)', () => {
        const payloads = buildImportedCards(parsed, 'tab-1');
        const positions = new Set(
            payloads.map((card) => `${card.x},${card.y}`)
        );
        expect(positions.size).toBe(payloads.length);
    });

    it('centers the grid bounding box on the provided point', () => {
        const payloads = buildImportedCards(parsed, 'tab-1', {
            x: 1000,
            y: 1000,
        });
        const minX = Math.min(...payloads.map((card) => card.x));
        const maxX = Math.max(...payloads.map((card) => card.x + card.width));
        expect((minX + maxX) / 2).toBeCloseTo(1000);
    });

    it('returns an empty array for no cards', () => {
        expect(buildImportedCards([], 'tab-1')).toEqual([]);
    });
});
