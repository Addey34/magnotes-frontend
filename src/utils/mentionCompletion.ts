/**
 * Pure helpers behind the `[[mention]]` autocomplete of a card's textarea:
 * detect an unfinished `[[` before the caret, rank the card titles that match
 * what was typed, and splice the chosen title back into the text.
 */

export interface OpenMention {
    /** Index of the first `[` of the unfinished `[[`. */
    start: number;
    /** What was typed after `[[`, up to the caret. */
    query: string;
}

export const MAX_MENTION_SUGGESTIONS = 6;

/**
 * The mention being typed at `caret`, or null. A mention is open when the
 * nearest `[[` before the caret has no `]` or `[` after it and stays on the
 * same line, so a closed `[[a]]` or a stray `[[` many lines up never hijacks
 * the caret.
 */
export function findOpenMention(
    text: string,
    caret: number
): OpenMention | null {
    const before = text.slice(0, caret);
    const start = before.lastIndexOf('[[');
    if (start === -1) return null;
    const query = before.slice(start + 2);
    if (/[[\]\n]/.test(query)) return null;
    return { start, query };
}

/**
 * Titles matching `query` (case-insensitive), prefix matches first, then
 * substring matches, each group in board order. Duplicates, blanks and
 * `exclude` (the card's own title: a self-mention links nowhere) are dropped.
 */
export function suggestMentionTitles(
    query: string,
    titles: string[],
    exclude = '',
    limit = MAX_MENTION_SUGGESTIONS
): string[] {
    const needle = query.trim().toLowerCase();
    const skip = exclude.trim().toLowerCase();
    const seen = new Set<string>();
    const prefix: string[] = [];
    const inner: string[] = [];

    for (const raw of titles) {
        const title = raw.trim();
        const key = title.toLowerCase();
        if (!title || key === skip || seen.has(key)) continue;
        seen.add(key);
        if (!needle || key.startsWith(needle)) prefix.push(title);
        else if (key.includes(needle)) inner.push(title);
    }

    return [...prefix, ...inner].slice(0, limit);
}

/**
 * Replace the open mention with `[[title]]` and report where the caret goes:
 * right after the closing brackets. If the text after the caret already
 * starts with `]]` (the user typed them, or an editor auto-closed them) they
 * are reused instead of doubled.
 */
export function applyMention(
    text: string,
    caret: number,
    open: OpenMention,
    title: string
): { text: string; caret: number } {
    const head = text.slice(0, open.start);
    let tail = text.slice(caret);
    if (tail.startsWith(']]')) tail = tail.slice(2);
    const inserted = `[[${title}]]`;
    return {
        text: head + inserted + tail,
        caret: head.length + inserted.length,
    };
}
