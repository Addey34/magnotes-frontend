/**
 * Pure helpers for rendering a card's task metadata (due date) in the Kanban
 * and Agenda views. No React/DOM, so they are unit tested — see cardMeta.test.ts.
 */

import { Lang } from '../i18n/i18n';

/** BCP-47 locale for date formatting, derived from the app language. */
const DATE_LOCALE: Record<Lang, string> = { fr: 'fr-FR', en: 'en-US' };

/** Today as an ISO calendar day (YYYY-MM-DD), local time. */
export function todayIso(now: Date = new Date()): string {
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

/** True when a due date is before today and the card is not done. */
export function isOverdue(
    dueDate: string,
    done: boolean,
    now: Date = new Date()
): boolean {
    if (done) return false;
    return dueDate < todayIso(now);
}

/**
 * Short human label for a due date (e.g. "20 juil." in FR, "Jul 20" in EN).
 * Formats with the app language rather than the system locale so the label
 * matches the rest of the UI. Falls back to English if `lang` is omitted.
 */
export function formatDueDate(dueDate: string, lang: Lang = 'en'): string {
    const date = new Date(`${dueDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dueDate;
    return date.toLocaleDateString(DATE_LOCALE[lang], {
        day: '2-digit',
        month: 'short',
    });
}

export type AgendaBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

/** Classify a card's due date into an agenda bucket relative to `now`. */
export function agendaBucket(
    dueDate: string | null | undefined,
    done: boolean,
    now: Date = new Date()
): AgendaBucket {
    if (!dueDate) return 'none';
    const today = todayIso(now);
    if (!done && dueDate < today) return 'overdue';
    if (dueDate === today) return 'today';
    const weekAhead = todayIso(
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    );
    if (dueDate <= weekAhead) return 'week';
    return 'later';
}
