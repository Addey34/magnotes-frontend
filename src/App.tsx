import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import BoardApp from './pages/BoardApp';
import LoginForm from './pages/LoginForm';
import PublicBoardView from './pages/PublicBoardView';
import {
    bootstrapSession,
    logout as logoutRequest,
    LogoutResult,
    retryLogout,
    setupAuthInterceptor,
} from './services/authApi';
import {
    currentGeneration,
    hasPendingLogout,
    startSessionCoordination,
} from './services/sessionCoordinator';
import LogoutNotice, { LogoutNoticeState } from './components/ui/LogoutNotice';
import DemoImportBanner from './components/ui/DemoImportBanner';
import { importDemoBoardToAccount } from './services/demoImportRuntime';
import {
    dismissDemoImport,
    DemoImportOutcome,
    eraseLocalAfterPartialImport,
} from './services/demoImportFlow';
import { resetDemoBoard } from './services/demoBoard';
import { DemoImportFailure } from './services/demoImportState';
import {
    activateDemo,
    deactivateDemo,
    isDemoActive,
    isDemoImportPending,
    isDemoRequested,
    markDemoImportPending,
    requestedDemoTemplateId,
} from './services/demoMode';
import { resetPristineDemoForLanguage } from './services/demoBoard';
import { detectLang } from './i18n/i18n';

// Public read-only share route: `/app/b/<token>` (or `/b/<token>` in dev).
// No client router in the app — a path check picks the public view before the
// auth flow so a shared link never prompts for login.
const publicShareToken = (() => {
    const match = window.location.pathname.match(/\/b\/([a-f0-9]{32})/i);
    return match ? match[1] : null;
})();

const requestedTemplateId = requestedDemoTemplateId();

// Drop the `?demo` query from the URL without a reload, so refreshing after a
// signup request doesn't drop the visitor back into the sandbox.
const stripDemoQuery = () => {
    if (typeof window === 'undefined' || !window.history) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('demo')) {
        url.searchParams.delete('demo');
        window.history.replaceState({}, '', url.toString());
    }
};

const IMPORT_GATE_MS = 3000;

const App: React.FC = () => {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isBooting, setIsBooting] = useState(true);
    // Sign-in screen notice about server-side revocation. A logout left
    // unconfirmed (failure, closed tab) survives a reload and blocks silent
    // re-authentication until it is retried or the user signs in again.
    const [logoutNotice, setLogoutNotice] = useState<LogoutNoticeState | null>(
        () => (hasPendingLogout() ? 'unconfirmed' : null)
    );
    const [demoActive, setDemoActive] = useState(false);
    // Demo → account import progress. `null` = nothing to show.
    const [importUi, setImportUi] = useState<
        | { state: 'running' }
        | { state: 'failed'; reason: DemoImportFailure }
        | { state: 'partial'; skipped: number }
        | { state: 'done'; boards: number; cards: number }
        | null
    >(null);
    // Board to open after an import (a logged-in account lands on its own
    // first board otherwise, which hides what was just imported).
    const [focusTabId, setFocusTabId] = useState<string | undefined>();
    // Identifies the import run of the current session. A logout invalidates
    // it, so an answer that comes back later (the request itself keeps going and
    // stays idempotent server-side) can never touch the next session's UI.
    const importRun = useRef(0);
    const importGateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Brief head start for the import right after login, so the board does not
    // race it (a board opened on an empty account creates its own default tab
    // on the server). Bounded: the account always opens after IMPORT_GATE_MS,
    // whatever the import API does.
    const [importGate, setImportGate] = useState(false);
    // Bumped after a confirmed import so the board reloads its data.
    const [boardKey, setBoardKey] = useState(0);

    // Never throws: a failed import must not block login or the session.
    const runImport = async () => {
        const run = ++importRun.current;
        setImportUi({ state: 'running' });
        const outcome: DemoImportOutcome =
            await importDemoBoardToAccount().catch(
                () => ({ status: 'failed', reason: 'unknown' }) as const
            );
        // Signed out (or replaced by a newer run) while the request was in
        // flight: nothing of this answer belongs to the current session.
        if (run !== importRun.current) return;
        if (outcome.status === 'failed') {
            setImportUi({ state: 'failed', reason: outcome.reason });
            return;
        }
        if (outcome.status === 'partial') {
            setImportUi({ state: 'partial', skipped: outcome.skipped });
            if (outcome.focusTabId) setFocusTabId(outcome.focusTabId);
            setBoardKey((k) => k + 1);
            return;
        }
        if (outcome.status === 'complete') {
            setFocusTabId(outcome.focusTabId);
            setImportUi({
                state: 'done',
                boards: outcome.boards,
                cards: outcome.cards,
            });
            setBoardKey((k) => k + 1);
            return;
        }
        setImportUi(null);
    };

    const runImportAtEntry = () => {
        setImportGate(true);
        if (importGateTimer.current) clearTimeout(importGateTimer.current);
        const timer = setTimeout(() => setImportGate(false), IMPORT_GATE_MS);
        importGateTimer.current = timer;
        const pending = runImport();
        const run = importRun.current;
        void pending.finally(() => {
            clearTimeout(timer);
            if (run === importRun.current) setImportGate(false);
        });
    };

    // End of a session: forget everything the import of that session produced
    // (banner, board to open, grace period) and invalidate its pending answer.
    useEffect(() => {
        if (isLoggedIn) return;
        importRun.current += 1;
        if (importGateTimer.current) clearTimeout(importGateTimer.current);
        importGateTimer.current = null;
        setImportUi(null);
        setImportGate(false);
        setFocusTabId(undefined);
    }, [isLoggedIn]);

    useEffect(() => {
        if (publicShareToken) return;

        let active = true;
        const disposeAuthInterceptor = setupAuthInterceptor(() => {
            if (active) setIsLoggedIn(false);
        });

        const disposeCoordination = startSessionCoordination({
            onRemoteLogout: () => {
                if (!active) return;
                setIsLoggedIn(false);
                setLogoutNotice('pending');
            },
            onLogoutConfirmed: () => {
                if (active) setLogoutNotice('confirmed');
            },
            onLogoutFailed: () => {
                if (active) setLogoutNotice('unconfirmed');
            },
        });

        // A logout interrupted by a reload or a closed tab is retried once,
        // automatically; the notice shows the outcome (retry stays manual).
        if (hasPendingLogout()) runRevocation(retryLogout);

        const bootGeneration = currentGeneration();
        bootstrapSession()
            .then((valid) => {
                // A login/logout happened while the bootstrap was in flight:
                // its (late) answer describes an older session. Ignore it.
                if (!active || bootGeneration !== currentGeneration()) return;
                if (valid) {
                    deactivateDemo();
                    setIsLoggedIn(true);
                    // Resume an import interrupted by a reload or a crash.
                    if (isDemoImportPending()) runImportAtEntry();
                } else if (isDemoRequested() || isDemoActive()) {
                    resetPristineDemoForLanguage(detectLang());
                    activateDemo();
                    setDemoActive(true);
                }
            })
            .finally(() => {
                if (active) setIsBooting(false);
            });

        return () => {
            active = false;
            disposeAuthInterceptor();
            disposeCoordination();
        };
    }, []);

    const handleLogin = () => {
        // A visitor who tried the demo and then signed up gets their sandbox
        // board imported into the new account (demo mode is already off here).
        // Login itself is never gated on it: the account opens after at most
        // IMPORT_GATE_MS and the import keeps running in the background
        // (resumable, idempotent, banner + retry, local data kept until the
        // server confirms).
        if (isDemoImportPending()) {
            deactivateDemo();
            runImportAtEntry();
        }
        setDemoActive(false);
        revocationSeq.current += 1;
        setLogoutNotice(null);
        setIsLoggedIn(true);
    };

    // Only the most recent revocation may update the notice; a stale result
    // ('superseded' or an older logout) never overwrites a newer state.
    const revocationSeq = useRef(0);
    const runRevocation = (request: () => Promise<LogoutResult>) => {
        const seq = ++revocationSeq.current;
        setLogoutNotice('pending');
        void request().then((result) => {
            if (seq !== revocationSeq.current) return;
            // 'superseded': a newer session replaced this logout; claim nothing.
            setLogoutNotice(result === 'superseded' ? null : result);
        });
    };

    const handleLogout = () => {
        setIsLoggedIn(false);
        runRevocation(logoutRequest);
    };

    // From the demo banner: keep the sandbox for import, leave demo mode, and
    // show the login/signup screen.
    const handleRequestSignup = () => {
        markDemoImportPending();
        deactivateDemo();
        stripDemoQuery();
        setDemoActive(false);
    };

    if (publicShareToken) {
        return <PublicBoardView token={publicShareToken} />;
    }

    if (isBooting) {
        return null;
    }

    if (isLoggedIn) {
        return (
            <div>
                {importUi && (
                    <DemoImportBanner
                        state={importUi.state}
                        reason={
                            importUi.state === 'failed'
                                ? importUi.reason
                                : undefined
                        }
                        skipped={
                            importUi.state === 'partial'
                                ? importUi.skipped
                                : undefined
                        }
                        boards={
                            importUi.state === 'done'
                                ? importUi.boards
                                : undefined
                        }
                        cards={
                            importUi.state === 'done'
                                ? importUi.cards
                                : undefined
                        }
                        onRetry={() => void runImport()}
                        onDismiss={() => {
                            dismissDemoImport();
                            setImportUi(null);
                        }}
                        onEraseLocal={() => {
                            eraseLocalAfterPartialImport(resetDemoBoard);
                            setImportUi(null);
                        }}
                    />
                )}
                {!importGate && (
                    <BoardApp
                        key={boardKey}
                        onLogout={handleLogout}
                        initialTabId={focusTabId}
                    />
                )}
            </div>
        );
    }

    if (demoActive) {
        return (
            <div>
                <BoardApp
                    onLogout={handleRequestSignup}
                    demo
                    onRequestSignup={handleRequestSignup}
                    initialTemplateId={requestedTemplateId}
                />
            </div>
        );
    }

    return (
        <div>
            {logoutNotice && (
                <LogoutNotice
                    state={logoutNotice}
                    onRetry={() => runRevocation(retryLogout)}
                />
            )}
            <LoginForm onLogin={handleLogin} />
        </div>
    );
};

export default App;
