/**
 * Pure Markdown → cards importer — the inverse of `boardMarkdown.ts`. It round-
 * trips a board exported by `cardsToMarkdown`, and degrades gracefully on any
 * hand-written Markdown (headings become card titles, paragraphs become
 * content, `- [ ]` lines become checklist items). No React/DOM, so it is unit
 * tested — see markdownImport.test.ts.
 */

import { DEFAULT_POST_IT } from '../constants/boardDefaults';
import { ChecklistItem, PostItStatus } from '../types/boardTypes';
import { TemplateCardPayload } from './boardTemplate';

export interface ParsedCard {
    title: string;
    content: string;
    checklist: ChecklistItem[];
    tags: string[];
    status?: PostItStatus;
    dueDate?: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const CHECKLIST = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
const META_STATUS = /^\*\*Statut\s*:\*\*\s*(.+)$/;
const META_DUE = /^\*\*Échéance\s*:\*\*\s*(.+)$/;
const META_TAGS = /^\*\*Tags\s*:\*\*\s*(.+)$/;
const STATUSES: PostItStatus[] = ['todo', 'doing', 'done'];

// Reverse `escapeMarkdown`: drop the backslash before an escaped special char
// (or a doubled backslash). Matches are non-overlapping left-to-right, so a
// single global pass correctly restores the original text.
function unescapeMarkdown(value: string): string {
    return value.replace(/\\([\\`*_[\]<>#])/g, '$1');
}

function parseTags(value: string): string[] {
    return value
        .split(/\s+/)
        .map((token) => unescapeMarkdown(token).replace(/^#+/, '').trim())
        .filter((tag) => tag.length > 0);
}

function buildCard(titleLine: string, bodyLines: string[]): ParsedCard {
    const card: ParsedCard = {
        title: unescapeMarkdown(titleLine.trim()),
        content: '',
        checklist: [],
        tags: [],
    };

    const contentLines: string[] = [];
    for (const line of bodyLines) {
        const status = line.match(META_STATUS);
        if (status) {
            const value = unescapeMarkdown(status[1].trim());
            if ((STATUSES as string[]).includes(value)) {
                card.status = value as PostItStatus;
            }
            continue;
        }
        const due = line.match(META_DUE);
        if (due) {
            card.dueDate = unescapeMarkdown(due[1].trim());
            continue;
        }
        const tags = line.match(META_TAGS);
        if (tags) {
            card.tags.push(...parseTags(tags[1]));
            continue;
        }
        const item = line.match(CHECKLIST);
        if (item) {
            const done = item[1].toLowerCase() === 'x';
            const text = unescapeMarkdown(item[2].trim());
            if (text) {
                card.checklist.push({
                    id: `md-${card.checklist.length}`,
                    text,
                    done,
                });
            }
            continue;
        }
        contentLines.push(line);
    }

    card.content = unescapeMarkdown(contentLines.join('\n').trim());
    return card;
}

// Split a Markdown document into cards. A single leading level-1 heading is
// treated as the document title (as produced by the exporter) and dropped;
// every other heading starts a new card.
export function parseMarkdownCards(markdown: string): ParsedCard[] {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

    let index = 0;
    while (index < lines.length && lines[index].trim() === '') index += 1;
    const firstHeading = lines[index]?.match(HEADING);
    if (firstHeading && firstHeading[1].length === 1) index += 1;

    const cards: ParsedCard[] = [];
    let title: string | null = null;
    let body: string[] = [];
    const flush = () => {
        if (title === null && body.every((line) => line.trim() === '')) return;
        cards.push(buildCard(title ?? '', body));
    };

    let started = false;
    for (; index < lines.length; index += 1) {
        const heading = lines[index].match(HEADING);
        if (heading) {
            if (started) flush();
            started = true;
            title = heading[2];
            body = [];
        } else if (started) {
            body.push(lines[index]);
        } else if (lines[index].trim() !== '') {
            // Preamble before the first heading becomes an untitled card.
            started = true;
            title = null;
            body = [lines[index]];
        }
    }
    if (started) flush();

    return cards.filter(
        (card) =>
            card.title !== '' ||
            card.content !== '' ||
            card.checklist.length > 0
    );
}

// Lay parsed cards out in a centered grid so an import never stacks everything
// at one point. Reuses the template-insertion payload so the existing create +
// task-fields patch path applies status/checklist/tags/dueDate.
export function buildImportedCards(
    cards: ParsedCard[],
    tabId: string,
    center?: { x: number; y: number }
): TemplateCardPayload[] {
    if (cards.length === 0) return [];

    const gapX = DEFAULT_POST_IT.width + 40;
    const gapY = DEFAULT_POST_IT.height + 40;
    const columns = Math.ceil(Math.sqrt(cards.length));
    const rows = Math.ceil(cards.length / columns);

    // Center the whole grid's bounding box on `center` when provided.
    const gridWidth = (columns - 1) * gapX + DEFAULT_POST_IT.width;
    const gridHeight = (rows - 1) * gapY + DEFAULT_POST_IT.height;
    const originX = center ? center.x - gridWidth / 2 : 48;
    const originY = center ? center.y - gridHeight / 2 : 48;

    return cards.map((card, cardIndex) => {
        const column = cardIndex % columns;
        const row = Math.floor(cardIndex / columns);
        return {
            tabId,
            title: card.title || 'Sans titre',
            content: card.content,
            color: DEFAULT_POST_IT.color,
            textColor: DEFAULT_POST_IT.textColor,
            textSize: DEFAULT_POST_IT.textSize,
            fontFamily: DEFAULT_POST_IT.fontFamily,
            x: originX + column * gapX,
            y: originY + row * gapY,
            width: DEFAULT_POST_IT.width,
            height: DEFAULT_POST_IT.height,
            ...(card.status !== undefined ? { status: card.status } : {}),
            ...(card.checklist.length > 0
                ? { checklist: card.checklist }
                : {}),
            ...(card.tags.length > 0 ? { tags: card.tags } : {}),
            ...(card.dueDate !== undefined ? { dueDate: card.dueDate } : {}),
        };
    });
}
