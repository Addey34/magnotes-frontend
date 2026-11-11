/**
 * Guest demo mode — lets a visitor try the board with zero friction (no
 * account). While active, `boardApi` routes every read/write to the
 * localStorage-backed `demoBoard` store instead of the server. App.tsx owns the
 * lifecycle: it activates demo mode when the landing links to `/app/?demo` and
 * the visitor is not logged in, and deactivates it once a real session exists.
 *
 * The active flag lives in sessionStorage so it survives in-app reloads but not
 * a fresh tab; the demo *data* itself lives in localStorage (see demoBoard.ts)
 * so a returning visitor keeps their sandbox until they sign up.
 */

import {
    clearDemoImportState,
    ensureDemoImportState,
    loadDemoImportState,
} from './demoImportState';

const ACTIVE_KEY = 'magnotes-demo-active';

function safeSession(): Storage | null {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
        return null;
    }
}

// True when the current URL explicitly asks for the demo (`?demo` / `?demo=1`).
export function isDemoRequested(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('demo');
}

// True when the URL asks to open the sign-up form directly (`?signup` /
// `?signup=1`). Pure read, no side effect: it is called from a React state
// initializer, which StrictMode runs twice. The demo has priority: a URL that
// asks for both stays in the demo.
export function isSignupRequested(search?: string): boolean {
    if (typeof window === 'undefined' && search === undefined) return false;
    const params = new URLSearchParams(search ?? window.location.search);
    return params.has('signup') && !params.has('demo');
}

// Drops `signup` from the address bar without a reload, so a refresh or a
// later return to the login screen does not reopen the sign-up form. Idempotent
// and separate from the read above.
export function stripSignupQuery(): void {
    if (typeof window === 'undefined' || !window.history) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('signup')) return;
    url.searchParams.delete('signup');
    window.history.replaceState({}, '', url.toString());
}

export function requestedDemoTemplateId(search?: string): string | undefined {
    if (typeof window === 'undefined' && search === undefined) return undefined;
    const value = new URLSearchParams(search ?? window.location.search).get(
        'template'
    );
    return value && /^[a-z0-9-]+$/.test(value) ? value : undefined;
}

export function isDemoActive(): boolean {
    return safeSession()?.getItem(ACTIVE_KEY) === '1';
}

export function activateDemo(): void {
    safeSession()?.setItem(ACTIVE_KEY, '1');
}

export function deactivateDemo(): void {
    safeSession()?.removeItem(ACTIVE_KEY);
}

// Set when a demo visitor asks to create an account, so that after a successful
// login/signup App knows to import their sandbox board into the new account.
// Backed by persistent storage (see demoImportState.ts): the pending import and
// its id survive reloads and failed attempts until the server confirms.
export function markDemoImportPending(): void {
    ensureDemoImportState();
}

export function isDemoImportPending(): boolean {
    const state = loadDemoImportState();
    return state !== null && !state.abandoned;
}

export function clearDemoImportPending(): void {
    clearDemoImportState();
}
