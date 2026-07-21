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

const ACTIVE_KEY = 'magnotes-demo-active';
const IMPORT_PENDING_KEY = 'magnotes-demo-import-pending';

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
export function markDemoImportPending(): void {
    safeSession()?.setItem(IMPORT_PENDING_KEY, '1');
}

export function isDemoImportPending(): boolean {
    return safeSession()?.getItem(IMPORT_PENDING_KEY) === '1';
}

export function clearDemoImportPending(): void {
    safeSession()?.removeItem(IMPORT_PENDING_KEY);
}
