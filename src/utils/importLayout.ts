import { DEFAULT_POST_IT } from '../constants/boardDefaults';

interface Measurable {
    content: string;
    checklist: unknown[];
    tags: string[];
    status?: unknown;
    dueDate?: unknown;
}

/** Vertical room between two imported cards. */
export const IMPORT_ROW_GAP = 30;

/**
 * Cards grow with their tags, due date, checklist and text; their real height
 * is measured at render time, after the import. A fixed pitch made tall cards
 * cover the next row, so estimate generously from the content instead.
 */
export function estimateImportedHeight(card: Measurable): number {
    let height = DEFAULT_POST_IT.height;
    if (card.tags.length > 0 || card.status !== undefined || card.dueDate) {
        height += 70;
    }
    height += 40 * Math.min(card.checklist.length, 10);
    // Body text beyond the three lines the default card shows.
    const extraLines = Math.min(
        Math.max(Math.ceil(card.content.length / 32) - 3, 0),
        8
    );
    return height + 20 * extraLines;
}

/**
 * Top offset of each item when stacked in columns: items of one column sit
 * under each other, separated by `IMPORT_ROW_GAP`. Returns the offsets (in the
 * input order) and the height of the tallest column.
 */
export function stackByColumn<T extends Measurable>(
    items: { card: T; column: number; row: number }[]
): { offsets: number[]; height: number } {
    const order = items
        .map((item, index) => ({ ...item, index }))
        .sort((a, b) => a.column - b.column || a.row - b.row);
    const bottoms = new Map<number, number>();
    const offsets: number[] = new Array(items.length).fill(0);
    let height = 0;
    for (const item of order) {
        const top = bottoms.has(item.column)
            ? (bottoms.get(item.column) as number) + IMPORT_ROW_GAP
            : 0;
        offsets[item.index] = top;
        const bottom = top + estimateImportedHeight(item.card);
        bottoms.set(item.column, bottom);
        height = Math.max(height, bottom);
    }
    return { offsets, height };
}
