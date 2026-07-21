interface MentionCard {
    _id: string;
    title: string;
}

interface BacklinkCard extends MentionCard {
    content: string;
}

export interface ResolvedMentions {
    resolved: { title: string; cardId: string }[];
    unresolved: string[];
}

function normalizeTitle(title: string): string {
    return title.trim().toLowerCase();
}

function firstCardByTitle<T extends MentionCard>(cards: T[]): Map<string, T> {
    const byTitle = new Map<string, T>();
    for (const card of cards) {
        const title = normalizeTitle(card.title);
        if (title && !byTitle.has(title)) {
            byTitle.set(title, card);
        }
    }
    return byTitle;
}

export function parseMentions(text: string): string[] {
    const mentions: string[] = [];
    const seen = new Set<string>();
    const pattern = /\[\[([^[\]]*)\]\]/g;

    for (const match of text.matchAll(pattern)) {
        const title = match[1].trim();
        const normalizedTitle = normalizeTitle(title);
        if (!normalizedTitle || seen.has(normalizedTitle)) {
            continue;
        }
        seen.add(normalizedTitle);
        mentions.push(title);
    }

    return mentions;
}

export function resolveMentions(
    text: string,
    cards: MentionCard[]
): ResolvedMentions {
    const byTitle = firstCardByTitle(cards);
    const result: ResolvedMentions = { resolved: [], unresolved: [] };

    for (const mention of parseMentions(text)) {
        const card = byTitle.get(normalizeTitle(mention));
        if (card) {
            result.resolved.push({ title: card.title, cardId: card._id });
        } else {
            result.unresolved.push(mention);
        }
    }

    return result;
}

export function buildBacklinkIndex(
    cards: BacklinkCard[]
): Record<string, string[]> {
    const byTitle = firstCardByTitle(cards);
    const backlinks: Record<string, string[]> = Object.fromEntries(
        cards.map((card) => [card._id, []])
    );
    const seenByTarget = new Map<string, Set<string>>();

    for (const source of cards) {
        for (const mention of parseMentions(source.content)) {
            const target = byTitle.get(normalizeTitle(mention));
            if (!target || target._id === source._id) {
                continue;
            }

            const seenSources = seenByTarget.get(target._id) ?? new Set();
            if (!seenSources.has(source._id)) {
                backlinks[target._id].push(source._id);
                seenSources.add(source._id);
                seenByTarget.set(target._id, seenSources);
            }
        }
    }

    return backlinks;
}
