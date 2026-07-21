import { buildMentionGraph, CardRef } from './mentionGraph';

const card = (
    _id: string,
    title: string,
    content = ''
): CardRef => ({ _id, title, content });

describe('buildMentionGraph', () => {
    it('returns an entry for every card', () => {
        const cards = [card('1', 'Alpha'), card('2', 'Beta')];
        const graph = buildMentionGraph(cards);
        expect(Object.keys(graph).sort()).toEqual(['1', '2']);
    });

    it('resolves outgoing mentions to their target card', () => {
        const cards = [
            card('1', 'Alpha', 'voir [[Beta]] pour la suite'),
            card('2', 'Beta'),
        ];
        const graph = buildMentionGraph(cards);
        expect(graph['1'].mentions).toEqual([
            { cardId: '2', title: 'Beta' },
        ]);
        expect(graph['1'].unresolved).toEqual([]);
    });

    it('matches mentions case-insensitively', () => {
        const cards = [
            card('1', 'Alpha', 'lié à [[beta]]'),
            card('2', 'Beta'),
        ];
        expect(buildMentionGraph(cards)['1'].mentions).toEqual([
            { cardId: '2', title: 'Beta' },
        ]);
    });

    it('reports mentions with no matching card as unresolved', () => {
        const cards = [card('1', 'Alpha', 'cf [[Inconnu]]')];
        const graph = buildMentionGraph(cards);
        expect(graph['1'].mentions).toEqual([]);
        expect(graph['1'].unresolved).toEqual(['Inconnu']);
    });

    it('builds incoming backlinks with the source title', () => {
        const cards = [
            card('1', 'Alpha', 'voir [[Beta]]'),
            card('2', 'Beta'),
        ];
        const graph = buildMentionGraph(cards);
        expect(graph['2'].backlinks).toEqual([
            { cardId: '1', title: 'Alpha' },
        ]);
        expect(graph['1'].backlinks).toEqual([]);
    });

    it('excludes self-references from backlinks', () => {
        const cards = [card('1', 'Alpha', 'je me cite [[Alpha]]')];
        const graph = buildMentionGraph(cards);
        expect(graph['1'].backlinks).toEqual([]);
        // A self-mention still resolves as an outgoing mention.
        expect(graph['1'].mentions).toEqual([
            { cardId: '1', title: 'Alpha' },
        ]);
    });

    it('does not duplicate a backlink when a card mentions the same target twice', () => {
        const cards = [
            card('1', 'Alpha', '[[Beta]] et encore [[Beta]]'),
            card('2', 'Beta'),
        ];
        expect(buildMentionGraph(cards)['2'].backlinks).toEqual([
            { cardId: '1', title: 'Alpha' },
        ]);
    });
});
