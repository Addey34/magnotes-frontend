import { buildBacklinkIndex, parseMentions, resolveMentions } from './mentions';

describe('parseMentions', () => {
    it('extracts, trims, and de-duplicates multiple mentions', () => {
        expect(
            parseMentions(
                'Voir [[ Projet Alpha ]] et [[Brief]]. Puis [[projet alpha]].'
            )
        ).toEqual(['Projet Alpha', 'Brief']);
    });

    it('ignores empty and unclosed brackets', () => {
        expect(parseMentions('Vide [[  ]] puis [[Non fermé')).toEqual([]);
    });
});

describe('resolveMentions', () => {
    const cards = [
        { _id: 'alpha-first', title: 'Projet Alpha' },
        { _id: 'alpha-second', title: ' projet alpha ' },
        { _id: 'brief', title: 'Brief' },
    ];

    it('resolves titles case-insensitively and reports missing cards', () => {
        expect(
            resolveMentions('[[PROJET ALPHA]] [[ brief ]] [[Inconnue]]', cards)
        ).toEqual({
            resolved: [
                { title: 'Projet Alpha', cardId: 'alpha-first' },
                { title: 'Brief', cardId: 'brief' },
            ],
            unresolved: ['Inconnue'],
        });
    });

    it('uses the first card when normalized titles are duplicated', () => {
        expect(resolveMentions('[[Projet Alpha]]', cards).resolved).toEqual([
            { title: 'Projet Alpha', cardId: 'alpha-first' },
        ]);
    });
});

describe('buildBacklinkIndex', () => {
    it('indexes unique backlinks and excludes self-references', () => {
        const cards = [
            {
                _id: 'alpha',
                title: 'Alpha',
                content: 'Dépend de [[Beta]], encore [[ beta ]], et [[Alpha]].',
            },
            {
                _id: 'beta',
                title: 'Beta',
                content: 'Retour vers [[ALPHA]].',
            },
            {
                _id: 'orphan',
                title: 'Sans lien',
                content: 'Aucune mention.',
            },
        ];

        expect(buildBacklinkIndex(cards)).toEqual({
            alpha: ['beta'],
            beta: ['alpha'],
            orphan: [],
        });
    });
});
