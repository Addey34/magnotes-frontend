import { PostIt, PostItUpdate } from '../types/boardTypes';

/**
 * Pure helpers for building undoable card commands. A command captures the
 * "before" and "after" values of exactly the fields an operation changes, so
 * undo/redo can replay them through the normal patch API without any special
 * backend support. Kept free of React so it can be unit tested — see
 * historyCommands.test.ts.
 */

export interface CardChange {
    id: string;
    before: PostItUpdate;
    after: PostItUpdate;
}

/**
 * Capture the prior value of every key present in `after`. Missing values
 * (e.g. an unset stackId) are normalized to null so undo restores them via the
 * same `$unset` path the app already uses for nullable fields.
 */
export function captureBefore(card: PostIt, after: PostItUpdate): PostItUpdate {
    const before: PostItUpdate = {};
    (Object.keys(after) as (keyof PostItUpdate)[]).forEach((key) => {
        const value = card[key];
        (before[key] as unknown) = value === undefined ? null : value;
    });
    return before;
}

/** Build a change from a card's current state and the patch being applied. */
export function buildCardChange(card: PostIt, after: PostItUpdate): CardChange {
    return { id: card._id, before: captureBefore(card, after), after };
}

/** True when the patch would not actually change any captured field. */
export function isNoOpChange(change: CardChange): boolean {
    return (Object.keys(change.after) as (keyof PostItUpdate)[]).every(
        (key) => change.before[key] === change.after[key]
    );
}
