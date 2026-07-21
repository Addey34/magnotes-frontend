import { buildBacklinkIndex, resolveMentions } from './mentions';

export interface CardRef {
    _id: string;
    title: string;
    content: string;
}

export interface CardLinkRef {
    cardId: string;
    title: string;
}

export interface CardMentionView {
    // Resolved `[[mentions]]` found in this card's own content.
    mentions: CardLinkRef[];
    // Mentions in this card's content with no matching card title.
    unresolved: string[];
    // Other cards that mention this card in their content ("cité par").
    backlinks: CardLinkRef[];
}

/**
 * Compose the pure mention primitives (`resolveMentions` + `buildBacklinkIndex`)
 * into a per-card view model the board UI can render directly: outgoing resolved
 * mentions, unresolved mentions, and incoming backlinks (each carrying the
 * target card's current title for display). Cards absent from `graph` simply
 * have no mentions/backlinks.
 */
export function buildMentionGraph(
    cards: CardRef[]
): Record<string, CardMentionView> {
    const titleById = new Map(cards.map((card) => [card._id, card.title]));
    const backlinkIndex = buildBacklinkIndex(cards);

    const graph: Record<string, CardMentionView> = {};
    for (const card of cards) {
        const { resolved, unresolved } = resolveMentions(card.content, cards);
        graph[card._id] = {
            mentions: resolved.map((mention) => ({
                cardId: mention.cardId,
                title: mention.title,
            })),
            unresolved,
            backlinks: (backlinkIndex[card._id] || []).map((cardId) => ({
                cardId,
                title: titleById.get(cardId) || '',
            })),
        };
    }

    return graph;
}
