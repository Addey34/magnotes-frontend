import { Lang } from '../i18n/i18n';

const LOCALE: Record<Lang, string> = { fr: 'fr-FR', en: 'en-US' };

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
];

/**
 * Relative label for a past ISO date ("il y a 3 heures", "3 hours ago").
 * Under a minute reads "just now" (via numeric: 'auto'); unparseable input
 * is returned unchanged.
 */
export function formatRelativeTime(
    iso: string,
    lang: Lang = 'en',
    now: Date = new Date()
): string {
    const time = new Date(iso).getTime();
    if (Number.isNaN(time)) return iso;
    const seconds = Math.round((time - now.getTime()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(LOCALE[lang], {
        numeric: 'auto',
    });
    const abs = Math.abs(seconds);
    for (const [unit, size] of UNITS) {
        if (abs >= size)
            return formatter.format(Math.trunc(seconds / size), unit);
    }
    return formatter.format(0, 'second');
}
