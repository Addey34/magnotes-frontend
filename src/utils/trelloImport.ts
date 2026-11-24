/**
 * Pure Trello JSON board export → cards importer. Trello's "Export as JSON"
 * gives a board with `lists`, `cards`, and `checklists`; this maps each open
 * card to a MagNotes card, preserving description, labels (→ tags), due date,
 * and merged checklists, and lays lists out as columns (like a Kanban board).
 * No React/DOM, so it is unit tested — see trelloImport.test.ts.
 */

import { DEFAULT_POST_IT } from '../constants/boardDefaults';
import { PostItStatus } from '../types/boardTypes';
import { TemplateCardPayload } from './boardTemplate';
import { todayIso } from './cardMeta';
import { stackByColumn } from './importLayout';
import { ParsedCard } from './markdownImport';

export interface TrelloParsedCard extends ParsedCard {
    column: number;
    row: number;
}

interface TrelloCheckItem {
    name?: string;
    state?: string;
    pos?: number;
}
interface TrelloChecklist {
    idCard?: string;
    checkItems?: TrelloCheckItem[];
}
interface TrelloList {
    id?: string;
    name?: string;
    closed?: boolean;
    pos?: number;
}
interface TrelloLabel {
    name?: string;
    color?: string;
}
interface TrelloCard {
    id?: string;
    name?: string;
    desc?: string;
    idList?: string;
    closed?: boolean;
    due?: string | null;
    labels?: TrelloLabel[];
    pos?: number;
}
interface TrelloBoard {
    lists?: TrelloList[];
    cards?: TrelloCard[];
    checklists?: TrelloChecklist[];
}

// Map a Trello list name to a card status when it clearly names a Kanban stage.
function statusFromListName(
    name: string | undefined
): PostItStatus | undefined {
    const value = (name ?? '').toLowerCase();
    if (/(done|fait|termin|complet|closed|clôtur|cloture)/.test(value)) {
        return 'done';
    }
    if (/(doing|progress|en cours|wip|current)/.test(value)) {
        return 'doing';
    }
    if (/(todo|to do|à faire|a faire|backlog|idea|idée|idee|new)/.test(value)) {
        return 'todo';
    }
    return undefined;
}

/**
 * Trello exports `due` as a full UTC timestamp ("2026-05-01T10:00:00.000Z").
 * MagNotes stores a calendar day and the API rejects anything else: the raw
 * value made the follow-up save of every dated card fail, so it lost its due
 * date, status, tags and checklist. Keep the day as the user saw it in Trello,
 * i.e. in local time.
 */
export function trelloDueDate(due: unknown): string | undefined {
    if (typeof due !== 'string' || !due.trim()) return undefined;
    const value = due.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return undefined;
    return todayIso(date);
}

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

// True when the parsed JSON structurally looks like a Trello board export.
export function isTrelloBoard(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const board = data as TrelloBoard;
    return Array.isArray(board.cards) && Array.isArray(board.lists);
}

export function parseTrelloBoard(data: unknown): TrelloParsedCard[] {
    if (!data || typeof data !== 'object') return [];
    const board = data as TrelloBoard;

    const openLists = asArray<TrelloList>(board.lists)
        .filter((list) => !list.closed)
        .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
    const columnByList = new Map<string, number>();
    openLists.forEach((list, index) => {
        if (list.id) columnByList.set(list.id, index);
    });
    // Cards in an unknown/archived list still import, into a trailing column.
    const fallbackColumn = openLists.length;

    // Pre-group checklists by card so each card merges its check items.
    const checklistsByCard = new Map<string, TrelloCheckItem[]>();
    for (const checklist of asArray<TrelloChecklist>(board.checklists)) {
        if (!checklist.idCard) continue;
        const items = asArray<TrelloCheckItem>(checklist.checkItems);
        const existing = checklistsByCard.get(checklist.idCard) ?? [];
        checklistsByCard.set(checklist.idCard, existing.concat(items));
    }

    const openCards = asArray<TrelloCard>(board.cards).filter(
        (card) => !card.closed
    );

    // Order cards within each column by Trello position, to assign row indices.
    const rowCounters = new Map<number, number>();
    return [...openCards]
        .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
        .map((card) => {
            const column = card.idList
                ? (columnByList.get(card.idList) ?? fallbackColumn)
                : fallbackColumn;
            const row = rowCounters.get(column) ?? 0;
            rowCounters.set(column, row + 1);

            const listName = openLists[column]?.name;
            const tags = asArray<TrelloLabel>(card.labels)
                .map((label) => (label.name ?? '').trim())
                .filter((tag) => tag.length > 0);
            const checklist = (checklistsByCard.get(card.id ?? '') ?? [])
                .slice()
                .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
                .map((item, index) => ({
                    id: `trello-${index}`,
                    text: (item.name ?? '').trim(),
                    done: item.state === 'complete',
                }))
                .filter((item) => item.text.length > 0);

            const parsed: TrelloParsedCard = {
                title: (card.name ?? '').trim(),
                content: (card.desc ?? '').trim(),
                checklist,
                tags,
                column,
                row,
                ...(statusFromListName(listName)
                    ? { status: statusFromListName(listName) }
                    : {}),
                ...(trelloDueDate(card.due)
                    ? { dueDate: trelloDueDate(card.due) }
                    : typeof card.due === 'string' && card.due.trim()
                      ? { unreadDueDate: card.due.trim() }
                      : {}),
            };
            return parsed;
        })
        .filter(
            (card) =>
                card.title !== '' ||
                card.content !== '' ||
                card.checklist.length > 0
        );
}

// Lay imported Trello cards out as columns (lists) centered on `center`.
export function buildTrelloCards(
    cards: TrelloParsedCard[],
    tabId: string,
    center?: { x: number; y: number }
): TemplateCardPayload[] {
    if (cards.length === 0) return [];

    const gapX = DEFAULT_POST_IT.width + 60;
    const maxColumn = Math.max(...cards.map((card) => card.column));
    // Stack each list under its own cards' estimated heights (see importLayout).
    const stacked = stackByColumn(
        cards.map((card) => ({ card, column: card.column, row: card.row }))
    );
    const gridWidth = maxColumn * gapX + DEFAULT_POST_IT.width;
    const gridHeight = stacked.height;
    const originX = center ? center.x - gridWidth / 2 : 48;
    const originY = center ? center.y - gridHeight / 2 : 48;

    return cards.map((card, index) => ({
        tabId,
        title: card.title || 'Sans titre',
        content: card.content,
        color: DEFAULT_POST_IT.color,
        textColor: DEFAULT_POST_IT.textColor,
        textSize: DEFAULT_POST_IT.textSize,
        fontFamily: DEFAULT_POST_IT.fontFamily,
        x: originX + card.column * gapX,
        y: originY + stacked.offsets[index],
        width: DEFAULT_POST_IT.width,
        height: DEFAULT_POST_IT.height,
        ...(card.status !== undefined ? { status: card.status } : {}),
        ...(card.checklist.length > 0 ? { checklist: card.checklist } : {}),
        ...(card.tags.length > 0 ? { tags: card.tags } : {}),
        ...(card.dueDate !== undefined ? { dueDate: card.dueDate } : {}),
    }));
}
