/**
 * Hard caps for file imports (Markdown / Notion CSV / Trello JSON).
 *
 * Each imported card costs one create request plus, for task cards, one patch,
 * and the API allows 300 requests per minute per IP. 100 cards (at most ~200
 * requests) leaves headroom for normal use; 1 MB is far above any realistic
 * hand-written board export while preventing a huge file from freezing the tab.
 */
export const MAX_IMPORT_FILE_BYTES = 1024 * 1024;
export const MAX_IMPORT_CARDS = 100;

export function isImportFileTooLarge(sizeBytes: number): boolean {
    return sizeBytes > MAX_IMPORT_FILE_BYTES;
}

export function isImportCardCountTooHigh(count: number): boolean {
    return count > MAX_IMPORT_CARDS;
}

/**
 * Per-card limits enforced by the API (mirror of the backend's
 * BOARD_VALIDATION; there is no shared type package). The create request is
 * refused when a title or text is too long, and the task-fields patch is
 * refused as a whole when there are too many tags or checklist items: a real
 * Trello or Notion export then lost cards, or their status, tags and due date.
 */
export const API_CARD_LIMITS = {
    title: 80,
    content: 2000,
    tags: 12,
    checklistItems: 50,
} as const;

const clip = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

type ImportableCard = {
    title: string;
    content: string;
    tags?: string[];
    checklist?: { id: string; text: string; done: boolean }[];
};

export function fitCardToApiLimits<T extends ImportableCard>(card: T): T {
    const next: T = {
        ...card,
        title: clip(card.title, API_CARD_LIMITS.title),
        content: clip(card.content, API_CARD_LIMITS.content),
    };
    if (card.tags) {
        const seen = new Set<string>();
        next.tags = card.tags
            .filter((tag) => {
                const key = tag.trim().toLowerCase();
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, API_CARD_LIMITS.tags);
    }
    if (card.checklist) {
        next.checklist = card.checklist.slice(
            0,
            API_CARD_LIMITS.checklistItems
        );
    }
    return next;
}

/**
 * Fits every card and counts those that lost something on the way (a text
 * shortened, tags or checklist items over the limit), so the import result
 * can say so. Removing a duplicate tag that differs only by case is not a
 * loss and is not counted.
 */
export function fitCardsToApiLimits<T extends ImportableCard>(
    cards: T[]
): { cards: T[]; adjusted: number } {
    let adjusted = 0;
    const fitted = cards.map((card) => {
        const next = fitCardToApiLimits(card);
        const distinctTags = new Set(
            (card.tags ?? [])
                .map((tag) => tag.trim().toLowerCase())
                .filter(Boolean)
        ).size;
        if (
            next.title !== card.title ||
            next.content !== card.content ||
            (next.tags?.length ?? 0) < distinctTags ||
            (next.checklist?.length ?? 0) < (card.checklist?.length ?? 0)
        ) {
            adjusted += 1;
        }
        return next;
    });
    return { cards: fitted, adjusted };
}
