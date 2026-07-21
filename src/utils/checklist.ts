/**
 * Pure helpers for a card's checklist (Pillar 1 — work objects). No React/DOM,
 * so they are unit tested — see checklist.test.ts. All functions return new
 * arrays and never mutate their input.
 */

import { ChecklistItem } from '../types/boardTypes';

function newId(): string {
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }
    return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addChecklistItem(
    list: ChecklistItem[],
    text: string
): ChecklistItem[] {
    const trimmed = text.trim();
    if (!trimmed) return list;
    return [...list, { id: newId(), text: trimmed, done: false }];
}

export function toggleChecklistItem(
    list: ChecklistItem[],
    id: string
): ChecklistItem[] {
    return list.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item
    );
}

export function updateChecklistText(
    list: ChecklistItem[],
    id: string,
    text: string
): ChecklistItem[] {
    return list.map((item) => (item.id === id ? { ...item, text } : item));
}

export function removeChecklistItem(
    list: ChecklistItem[],
    id: string
): ChecklistItem[] {
    return list.filter((item) => item.id !== id);
}

export function checklistProgress(list: ChecklistItem[]): {
    done: number;
    total: number;
} {
    return {
        done: list.filter((item) => item.done).length,
        total: list.length,
    };
}
