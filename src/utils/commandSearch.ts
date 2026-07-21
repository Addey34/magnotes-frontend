export interface CommandItem {
    id: string;
    label: string;
    keywords?: string[];
    group?: string;
}

function normalizeSearchText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .trim();
}

export function fuzzyScore(query: string, text: string): number | null {
    const normalizedQuery = normalizeSearchText(query);
    const normalizedText = normalizeSearchText(text);

    if (!normalizedQuery) return 0;
    if (!normalizedText || normalizedQuery.length > normalizedText.length) {
        return null;
    }

    const lengthRatio = normalizedQuery.length / normalizedText.length;
    if (normalizedText.startsWith(normalizedQuery)) {
        return 3 + lengthRatio;
    }

    const contiguousIndex = normalizedText.indexOf(normalizedQuery);
    if (contiguousIndex >= 0) {
        const positionBonus = 1 - contiguousIndex / normalizedText.length;
        return 2 + lengthRatio * 0.8 + positionBonus * 0.2;
    }

    let queryIndex = 0;
    let firstMatch = -1;
    let lastMatch = -1;

    for (
        let textIndex = 0;
        textIndex < normalizedText.length &&
        queryIndex < normalizedQuery.length;
        textIndex += 1
    ) {
        if (normalizedText[textIndex] !== normalizedQuery[queryIndex]) continue;
        if (firstMatch < 0) firstMatch = textIndex;
        lastMatch = textIndex;
        queryIndex += 1;
    }

    if (queryIndex !== normalizedQuery.length) return null;

    const matchSpan = lastMatch - firstMatch + 1;
    const compactness = normalizedQuery.length / matchSpan;
    const positionBonus = 1 - firstMatch / normalizedText.length;
    return 1 + lengthRatio * 0.5 + compactness * 0.4 + positionBonus * 0.1;
}

export function searchCommands(
    query: string,
    items: CommandItem[]
): CommandItem[] {
    if (!normalizeSearchText(query)) return items;

    return items
        .map((item, index) => {
            const scores = [item.label, ...(item.keywords ?? [])]
                .map((text) => fuzzyScore(query, text))
                .filter((score): score is number => score !== null);

            return {
                item,
                index,
                score: scores.length > 0 ? Math.max(...scores) : null,
            };
        })
        .filter(
            (
                result
            ): result is {
                item: CommandItem;
                index: number;
                score: number;
            } => result.score !== null
        )
        .sort(
            (left, right) =>
                right.score - left.score || left.index - right.index
        )
        .map(({ item }) => item);
}
