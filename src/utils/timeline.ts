// Pure grouping for the Timeline/Planning view: an "overdue" lane, one lane per
// distinct upcoming due date (chronological), and an "undated" lane. Kept free
// of React/PostIt specifics so it can be unit-tested in isolation.

export interface TimelineCard {
    dueDate?: string | null;
    status?: string | null;
}

export interface TimelineGroups<T extends TimelineCard> {
    overdue: T[];
    dated: { date: string; cards: T[] }[];
    undated: T[];
}

export function buildTimeline<T extends TimelineCard>(
    cards: T[],
    today: string
): TimelineGroups<T> {
    const overdue: T[] = [];
    const undated: T[] = [];
    const byDate = new Map<string, T[]>();

    for (const card of cards) {
        const due = card.dueDate;
        if (!due) {
            undated.push(card);
            continue;
        }
        if (due < today && card.status !== 'done') {
            overdue.push(card);
            continue;
        }
        const bucket = byDate.get(due);
        if (bucket) {
            bucket.push(card);
        } else {
            byDate.set(due, [card]);
        }
    }

    overdue.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

    const dated = [...byDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, list]) => ({ date, cards: list }));

    return { overdue, dated, undated };
}
