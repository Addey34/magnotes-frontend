import * as React from 'react';
import { useEffect, useState } from 'react';
import BoardApp from './pages/BoardApp';
import LoginForm from './pages/LoginForm';
import PublicBoardView from './pages/PublicBoardView';
import {
    bootstrapSession,
    logout as logoutRequest,
    setupAuthInterceptor,
} from './services/authApi';
import DemoImportBanner from './components/ui/DemoImportBanner';
import { importDemoBoardToAccount } from './services/demoImportRuntime';
import {
    dismissDemoImport,
    DemoImportOutcome,
} from './services/demoImportFlow';
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

const App: React.FC = () => {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isBooting, setIsBooting] = useState(true);
    const [demoActive, setDemoActive] = useState(false);
    // Demo → account import progress. `null` = nothing to show.
    const [importUi, setImportUi] = useState<
        | { state: 'running' }
        | { state: 'failed'; reason: DemoImportFailure }
        | null
    >(null);
    // Bumped after a confirmed import so the board reloads its data.
    const [boardKey, setBoardKey] = useState(0);

    // Never throws: a failed import must not block login or the session.
    const runImport = async () => {
        setImportUi({ state: 'running' });
        const outcome: DemoImportOutcome =
            await importDemoBoardToAccount().catch(
                () => ({ status: 'failed', reason: 'unknown' }) as const
            );
        if (outcome.status === 'failed') {
            setImportUi({ state: 'failed', reason: outcome.reason });
            return;
        }
        setImportUi(null);
        if (outcome.status === 'complete') setBoardKey((k) => k + 1);
    };

    useEffect(() => {
        if (publicShareToken) return;

        let active = true;
        const disposeAuthInterceptor = setupAuthInterceptor(() => {
            if (active) setIsLoggedIn(false);
        });

        bootstrapSession()
            .then((valid) => {
                if (!active) return;
                if (valid) {
                    deactivateDemo();
                    setIsLoggedIn(true);
                    // Resume an import interrupted by a reload or a crash.
                    if (isDemoImportPending()) void runImport();
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
        };
    }, []);

    const handleLogin = async () => {
        // A visitor who tried the demo and then signed up gets their sandbox
        // board imported into the new account (demo mode is already off here).
        // The import is resumable and idempotent; a failure shows a banner with
        // a retry and never blocks login. Local data stays until confirmed.
        if (isDemoImportPending()) {
            deactivateDemo();
            await runImport();
        }
        setDemoActive(false);
        setIsLoggedIn(true);
    };

    const handleLogout = () => {
        logoutRequest();
        setIsLoggedIn(false);
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
                        onRetry={() => void runImport()}
                        onDismiss={() => {
                            dismissDemoImport();
                            setImportUi(null);
                        }}
                    />
                )}
                <BoardApp key={boardKey} onLogout={handleLogout} />
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
            <LoginForm onLogin={handleLogin} />
        </div>
    );
};

export default App;
