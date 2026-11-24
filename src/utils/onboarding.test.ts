/** @jest-environment jsdom */
import type { BoardTab } from '../types/boardTypes';
import {
    FRESH_BOARD_MAX_AGE_MS,
    FRESH_SIGNUP_MAX_AGE_MS,
    clearFreshSignup,
    freshServerDefaultBoard,
    hasFreshSignup,
    markFreshSignup,
} from './onboarding';

describe('fresh sign-up marker', () => {
    beforeEach(() => sessionStorage.clear());

    it('is absent unless this tab confirmed a sign-up', () => {
        expect(hasFreshSignup()).toBe(false);
    });

    it('is set by the confirmation and single use', () => {
        markFreshSignup(1_000);
        expect(hasFreshSignup(2_000)).toBe(true);
        clearFreshSignup();
        expect(hasFreshSignup(2_000)).toBe(false);
    });

    it('expires, and ignores garbage', () => {
        markFreshSignup(1_000);
        expect(hasFreshSignup(1_000 + FRESH_SIGNUP_MAX_AGE_MS + 1)).toBe(false);
        sessionStorage.setItem('magnotes-fresh-signup', 'nope');
        expect(hasFreshSignup()).toBe(false);
    });

    it('lives in this tab only (sessionStorage, not localStorage)', () => {
        markFreshSignup();
        expect(localStorage.getItem('magnotes-fresh-signup')).toBeNull();
    });
});

const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const tab = (overrides: Partial<BoardTab> = {}): BoardTab => ({
    _id: 't1',
    userId: 'u1',
    name: 'Maison',
    color: '#facc15',
    icon: 'home',
    order: 0,
    createdAt: new Date(NOW - 5_000).toISOString(),
    updatedAt: new Date(NOW - 5_000).toISOString(),
    ...overrides,
});

describe('freshServerDefaultBoard', () => {
    it('recognises the board the API just created for a new account', () => {
        const board = tab();
        expect(freshServerDefaultBoard([board], NOW)).toBe(board);
    });

    it('never targets an older board, even empty and still named Maison', () => {
        const old = tab({
            createdAt: new Date(NOW - FRESH_BOARD_MAX_AGE_MS - 1).toISOString(),
        });
        expect(freshServerDefaultBoard([old], NOW)).toBeNull();
    });

    it('ignores renamed boards, other icons, several boards or bad dates', () => {
        expect(
            freshServerDefaultBoard([tab({ name: 'Home' })], NOW)
        ).toBeNull();
        expect(
            freshServerDefaultBoard([tab({ icon: 'work' })], NOW)
        ).toBeNull();
        expect(
            freshServerDefaultBoard([tab(), tab({ _id: 't2' })], NOW)
        ).toBeNull();
        expect(freshServerDefaultBoard([], NOW)).toBeNull();
        expect(
            freshServerDefaultBoard([tab({ createdAt: 'not a date' })], NOW)
        ).toBeNull();
    });

    it('tolerates a server clock slightly ahead of the browser', () => {
        const ahead = tab({ createdAt: new Date(NOW + 30_000).toISOString() });
        expect(freshServerDefaultBoard([ahead], NOW)).toBe(ahead);
    });
});
