import {
    addChecklistItem,
    checklistProgress,
    removeChecklistItem,
    toggleChecklistItem,
    updateChecklistText,
} from './checklist';
import { ChecklistItem } from '../types/boardTypes';

const base: ChecklistItem[] = [
    { id: '1', text: 'A', done: false },
    { id: '2', text: 'B', done: true },
];

describe('addChecklistItem', () => {
    it('appends a trimmed, not-done item with a fresh id', () => {
        const next = addChecklistItem(base, '  Nouveau  ');
        expect(next).toHaveLength(3);
        expect(next[2].text).toBe('Nouveau');
        expect(next[2].done).toBe(false);
        expect(next[2].id).toBeTruthy();
    });

    it('ignores blank text and does not mutate the input', () => {
        expect(addChecklistItem(base, '   ')).toBe(base);
    });
});

describe('toggleChecklistItem', () => {
    it('flips only the matching item', () => {
        const next = toggleChecklistItem(base, '1');
        expect(next[0].done).toBe(true);
        expect(next[1].done).toBe(true);
        expect(base[0].done).toBe(false); // original untouched
    });
});

describe('updateChecklistText', () => {
    it('rewrites the matching item text', () => {
        expect(updateChecklistText(base, '2', 'B2')[1].text).toBe('B2');
    });
});

describe('removeChecklistItem', () => {
    it('drops the matching item', () => {
        const next = removeChecklistItem(base, '1');
        expect(next).toHaveLength(1);
        expect(next[0].id).toBe('2');
    });
});

describe('checklistProgress', () => {
    it('counts done vs total', () => {
        expect(checklistProgress(base)).toEqual({ done: 1, total: 2 });
        expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
    });
});
