import type { BoardTab } from '../types/boardTypes';

/**
 * The API never returns an empty board list: on the first `GET /api/tabs` it
 * creates a default board named "Maison" (icon "home") and returns it. The
 * client's onboarding only ran when the list was empty, so against the real
 * API it never ran: a new account opened on an empty board called "Maison",
 * in French even for English visitors, without the welcome cards the demo
 * shows.
 *
 * Seeding that board is gated on an explicit event first: this tab has just
 * confirmed a sign-up (email verification succeeded, which happens once per
 * account). The board heuristic below is only a second guard. An existing
 * account that signs in, another tab, or a later reload never carries the
 * marker, so it is never seeded.
 */
export const SERVER_DEFAULT_TAB = { name: 'Maison', icon: 'home' } as const;
export const FRESH_BOARD_MAX_AGE_MS = 10 * 60 * 1000;
const FRESH_SIGNUP_KEY = 'magnotes-fresh-signup';
export const FRESH_SIGNUP_MAX_AGE_MS = 30 * 60 * 1000;

function tabSession(): Storage | null {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
        return null;
    }
}

/** Called once the sign-up's email verification succeeded, in that tab. */
export function markFreshSignup(now: number = Date.now()): void {
    try {
        tabSession()?.setItem(FRESH_SIGNUP_KEY, String(now));
    } catch {
        // Storage full or blocked: the new account simply opens unseeded.
    }
}

/** True while this tab holds a recent, not yet used sign-up confirmation. */
export function hasFreshSignup(now: number = Date.now()): boolean {
    const raw = tabSession()?.getItem(FRESH_SIGNUP_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return (
        Number.isFinite(at) &&
        now - at >= 0 &&
        now - at <= FRESH_SIGNUP_MAX_AGE_MS
    );
}

/** The confirmation is single use: dropped once the decision is taken. */
export function clearFreshSignup(): void {
    try {
        tabSession()?.removeItem(FRESH_SIGNUP_KEY);
    } catch {
        // Nothing to clear.
    }
}

/**
 * The board the API just created for this account: the only board, still
 * with the server's default name and icon, created moments ago. Card
 * emptiness is checked by the caller once the cards are loaded.
 */
export function freshServerDefaultBoard(
    tabs: BoardTab[],
    now: number = Date.now()
): BoardTab | null {
    if (tabs.length !== 1) return null;
    const [tab] = tabs;
    if (
        tab.name !== SERVER_DEFAULT_TAB.name ||
        tab.icon !== SERVER_DEFAULT_TAB.icon
    ) {
        return null;
    }
    const created = Date.parse(tab.createdAt);
    if (!Number.isFinite(created)) return null;
    const age = now - created;
    return age >= -60_000 && age <= FRESH_BOARD_MAX_AGE_MS ? tab : null;
}
