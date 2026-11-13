import { formatRelativeTime } from './relativeTime';

const now = new Date('2026-11-13T12:00:00.000Z');

describe('formatRelativeTime', () => {
    it('formats minutes, hours and days in English', () => {
        expect(formatRelativeTime('2026-11-13T11:55:00.000Z', 'en', now)).toBe(
            '5 minutes ago'
        );
        expect(formatRelativeTime('2026-11-13T09:00:00.000Z', 'en', now)).toBe(
            '3 hours ago'
        );
        expect(formatRelativeTime('2026-11-11T12:00:00.000Z', 'en', now)).toBe(
            '2 days ago'
        );
    });

    it('formats in French', () => {
        expect(formatRelativeTime('2026-11-13T09:00:00.000Z', 'fr', now)).toBe(
            'il y a 3 heures'
        );
    });

    it('reads as now under a minute', () => {
        expect(formatRelativeTime('2026-11-13T11:59:50.000Z', 'en', now)).toBe(
            'now'
        );
    });

    it('returns invalid input unchanged', () => {
        expect(formatRelativeTime('nope', 'en', now)).toBe('nope');
    });
});
