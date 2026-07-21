import { agendaBucket, formatDueDate, isOverdue, todayIso } from './cardMeta';

const NOW = new Date('2026-07-13T12:00:00');

describe('todayIso', () => {
    it('returns the local calendar day', () => {
        expect(todayIso(NOW)).toBe('2026-07-13');
    });
});

describe('isOverdue', () => {
    it('is true for a past date on a non-done card', () => {
        expect(isOverdue('2026-07-10', false, NOW)).toBe(true);
    });
    it('is false when the card is done', () => {
        expect(isOverdue('2026-07-10', true, NOW)).toBe(false);
    });
    it('is false for today or the future', () => {
        expect(isOverdue('2026-07-13', false, NOW)).toBe(false);
        expect(isOverdue('2026-07-20', false, NOW)).toBe(false);
    });
});

describe('agendaBucket', () => {
    it('classifies relative to now', () => {
        expect(agendaBucket(null, false, NOW)).toBe('none');
        expect(agendaBucket('2026-07-10', false, NOW)).toBe('overdue');
        expect(agendaBucket('2026-07-13', false, NOW)).toBe('today');
        expect(agendaBucket('2026-07-18', false, NOW)).toBe('week');
        expect(agendaBucket('2026-08-30', false, NOW)).toBe('later');
    });
    it('a done past card is not overdue (falls in week/later by date)', () => {
        expect(agendaBucket('2026-07-10', true, NOW)).not.toBe('overdue');
    });
});

describe('formatDueDate', () => {
    it('formats a valid date and passes through garbage', () => {
        expect(formatDueDate('2026-07-20')).toMatch(/\d{2}/);
        expect(formatDueDate('nope')).toBe('nope');
    });
});
