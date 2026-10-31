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
