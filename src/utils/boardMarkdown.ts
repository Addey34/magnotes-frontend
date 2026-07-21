interface MarkdownChecklistItem {
    text: string;
    done: boolean;
}

interface MarkdownCard {
    title?: string;
    content?: string;
    checklist?: MarkdownChecklistItem[];
    tags?: string[];
    dueDate?: string | null;
    status?: string | null;
    createdAt?: string;
}

export interface BoardMarkdownOptions {
    documentTitle?: string;
    includeMetadata?: boolean;
}

function escapeMarkdown(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/([`*_[\]<>#])/g, '\\$1');
}

function compareText(left: string, right: string): number {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function compareCards(left: MarkdownCard, right: MarkdownCard): number {
    const leftDate = left.createdAt || '\uffff';
    const rightDate = right.createdAt || '\uffff';
    return (
        compareText(leftDate, rightDate) ||
        compareText(left.title?.trim() || '', right.title?.trim() || '')
    );
}

function formatTag(tag: string): string | null {
    const value = tag.trim().replace(/^#+/, '').replace(/\s+/g, '-');
    return value ? `#${escapeMarkdown(value)}` : null;
}

function cardToMarkdown(
    card: MarkdownCard,
    includeMetadata: boolean
): string {
    const blocks: string[] = [];
    const title = card.title?.trim() || 'Sans titre';
    blocks.push(`## ${escapeMarkdown(title)}`);

    if (includeMetadata) {
        const metadata: string[] = [];
        if (card.status) {
            metadata.push(`**Statut :** ${escapeMarkdown(card.status)}`);
        }
        if (card.dueDate) {
            metadata.push(`**Échéance :** ${escapeMarkdown(card.dueDate)}`);
        }
        const tags = card.tags
            ?.map(formatTag)
            .filter((tag): tag is string => tag !== null);
        if (tags && tags.length > 0) {
            metadata.push(`**Tags :** ${tags.join(' ')}`);
        }
        if (metadata.length > 0) {
            blocks.push(metadata.join('\n'));
        }
    }

    const content = card.content?.trim();
    if (content) {
        blocks.push(escapeMarkdown(content));
    }

    if (card.checklist && card.checklist.length > 0) {
        blocks.push(
            card.checklist
                .map(
                    (item) =>
                        `- [${item.done ? 'x' : ' '}] ${escapeMarkdown(
                            item.text.trim()
                        )}`
                )
                .join('\n')
        );
    }

    return blocks.join('\n\n');
}

export function cardsToMarkdown(
    cards: MarkdownCard[],
    options: BoardMarkdownOptions = {}
): string {
    const sections: string[] = [];
    if (options.documentTitle?.trim()) {
        sections.push(`# ${escapeMarkdown(options.documentTitle.trim())}`);
    }

    const includeMetadata = options.includeMetadata !== false;
    sections.push(
        ...[...cards]
            .sort(compareCards)
            .map((card) => cardToMarkdown(card, includeMetadata))
    );

    return sections.length > 0 ? `${sections.join('\n\n')}\n` : '';
}
