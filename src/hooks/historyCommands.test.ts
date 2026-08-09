import {
    buildCardChange,
    captureBefore,
    isNoOpChange,
} from './historyCommands';
import { PostIt } from '../types/boardTypes';

const baseCard: PostIt = {
    _id: 'card-1',
    userId: 'u1',
    tabId: 't1',
    title: 'Note',
    content: '',
    color: '#fef08a',
    x: 100,
    y: 120,
    width: 220,
    height: 150,
    zIndex: 3,
    stackId: 'stack-9',
    stackOrder: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('captureBefore', () => {
    it('captures only the keys present in the patch', () => {
        const before = captureBefore(baseCard, { x: 999, y: 999 });
        expect(before).toEqual({ x: 100, y: 120 });
    });

    it('normalizes undefined fields to null so they round-trip through $unset', () => {
        const freeCard: PostIt = {
            ...baseCard,
            stackId: undefined,
            stackOrder: undefined,
        };
        const before = captureBefore(freeCard, {
            stackId: null,
            stackOrder: null,
        });
        expect(before).toEqual({ stackId: null, stackOrder: null });
    });

    it('preserves an existing stack membership so undo can restack', () => {
        const before = captureBefore(baseCard, {
            stackId: null,
            stackOrder: null,
        });
        expect(before).toEqual({ stackId: 'stack-9', stackOrder: 2 });
    });
});

describe('buildCardChange', () => {
    it('pairs the card id with before/after patches', () => {
        const change = buildCardChange(baseCard, { x: 200, y: 240 });
        expect(change).toEqual({
            id: 'card-1',
            before: { x: 100, y: 120 },
            after: { x: 200, y: 240 },
        });
    });
});

describe('isNoOpChange', () => {
    it('detects a change that leaves every field untouched', () => {
        const change = buildCardChange(baseCard, { x: 100, y: 120 });
        expect(isNoOpChange(change)).toBe(true);
    });

    it('reports a real change as not a no-op', () => {
        const change = buildCardChange(baseCard, { x: 100, y: 121 });
        expect(isNoOpChange(change)).toBe(false);
    });
});
