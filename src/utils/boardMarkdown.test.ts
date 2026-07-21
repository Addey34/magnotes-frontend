import { cardsToMarkdown } from './boardMarkdown';

describe('cardsToMarkdown', () => {
    it('serializes task metadata, tags, and checklist items', () => {
        expect(
            cardsToMarkdown([
                {
                    title: 'Lancement',
                    content: 'Préparer le brief.',
                    status: 'doing',
                    dueDate: '2026-07-31',
                    tags: ['client', 'projet urgent'],
                    checklist: [
                        { text: 'Valider le budget', done: true },
                        { text: 'Planifier la réunion', done: false },
                    ],
                    createdAt: '2026-07-14T08:00:00.000Z',
                },
            ])
        ).toBe(
            [
                '## Lancement',
                '',
                '**Statut :** doing',
                '**Échéance :** 2026-07-31',
                '**Tags :** #client #projet-urgent',
                '',
                'Préparer le brief.',
                '',
                '- [x] Valider le budget',
                '- [ ] Planifier la réunion',
                '',
            ].join('\n')
        );
    });

    it('sorts by creation date then title without mutating the input', () => {
        const cards = [
            { title: 'Plus tard', createdAt: '2026-07-15T08:00:00.000Z' },
            { title: 'Bêta', createdAt: '2026-07-14T08:00:00.000Z' },
            { title: 'Alpha', createdAt: '2026-07-14T08:00:00.000Z' },
        ];

        const markdown = cardsToMarkdown(cards);

        expect(markdown.indexOf('## Alpha')).toBeLessThan(
            markdown.indexOf('## Bêta')
        );
        expect(markdown.indexOf('## Bêta')).toBeLessThan(
            markdown.indexOf('## Plus tard')
        );
        expect(cards.map((card) => card.title)).toEqual([
            'Plus tard',
            'Bêta',
            'Alpha',
        ]);
    });

    it('handles an empty board and an empty card', () => {
        expect(cardsToMarkdown([])).toBe('');
        expect(cardsToMarkdown([{ title: '  ', content: '  ' }])).toBe(
            '## Sans titre\n'
        );
    });

    it('escapes basic Markdown syntax in user-authored fields', () => {
        const markdown = cardsToMarkdown([
            {
                title: 'Plan #1 [urgent]',
                content: '# Intro avec *emphase* et [lien]',
                checklist: [{ text: 'Cocher _ici_', done: false }],
            },
        ]);

        expect(markdown).toContain('## Plan \\#1 \\[urgent\\]');
        expect(markdown).toContain(
            '\\# Intro avec \\*emphase\\* et \\[lien\\]'
        );
        expect(markdown).toContain('- [ ] Cocher \\_ici\\_');
    });

    it('supports a document title and optional metadata omission', () => {
        expect(
            cardsToMarkdown(
                [{ title: 'Carte', status: 'done', dueDate: '2026-07-14' }],
                {
                    documentTitle: 'Projet #1',
                    includeMetadata: false,
                }
            )
        ).toBe('# Projet \\#1\n\n## Carte\n');
    });
});
