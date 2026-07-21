import { CommandItem, fuzzyScore, searchCommands } from './commandSearch';

const commands: CommandItem[] = [
    { id: 'reopen', label: 'Reopen board' },
    { id: 'open', label: 'Open board' },
    { id: 'palette', label: 'Command palette' },
];

describe('fuzzyScore', () => {
    it('ranks prefixes above contiguous and subsequence matches', () => {
        const prefix = fuzzyScore('open', 'Open board');
        const contiguous = fuzzyScore('open', 'Reopen board');
        const subsequence = fuzzyScore('opn', 'Reopen board');

        expect(prefix).not.toBeNull();
        expect(contiguous).not.toBeNull();
        expect(subsequence).not.toBeNull();
        expect(prefix!).toBeGreaterThan(contiguous!);
        expect(contiguous!).toBeGreaterThan(subsequence!);
    });

    it('matches without regard to case or accents', () => {
        expect(fuzzyScore('resume', 'RÉSUMÉ client')).not.toBeNull();
    });

    it('supports non-contiguous subsequences and rejects missing ones', () => {
        expect(fuzzyScore('cmdplte', 'Command palette')).not.toBeNull();
        expect(fuzzyScore('xyz', 'Command palette')).toBeNull();
    });
});

describe('searchCommands', () => {
    it('prioritizes a prefix over a later contiguous match', () => {
        expect(searchCommands('open', commands).map(({ id }) => id)).toEqual([
            'open',
            'reopen',
        ]);
    });

    it('returns the original items unchanged for an empty query', () => {
        expect(searchCommands('   ', commands)).toBe(commands);
    });

    it('searches command keywords', () => {
        const items: CommandItem[] = [
            { id: 'delete', label: 'Supprimer' },
            {
                id: 'create',
                label: 'Créer une carte',
                keywords: ['nouvelle note', 'ajouter'],
            },
        ];

        expect(searchCommands('note', items)).toEqual([items[1]]);
    });

    it('preserves source order when scores are equal', () => {
        const items: CommandItem[] = [
            { id: 'first', label: 'Open' },
            { id: 'second', label: 'Open' },
            { id: 'third', label: 'Open' },
        ];

        expect(searchCommands('open', items)).toEqual(items);
    });
});
