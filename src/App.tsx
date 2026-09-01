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
import { importDemoBoardToAccount } from './services/demoImportRuntime';
import {
    activateDemo,
    clearDemoImportPending,
    deactivateDemo,
    isDemoActive,
    isDemoImportPending,
    isDemoRequested,
    markDemoImportPending,
    requestedDemoTemplateId,
} from './services/demoMode';

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

    useEffect(() => {
        if (publicShareToken) return;
        setupAuthInterceptor(() => setIsLoggedIn(false));
        bootstrapSession()
            .then((valid) => {
                if (valid) {
                    deactivateDemo();
                    setIsLoggedIn(true);
                } else if (isDemoRequested() || isDemoActive()) {
                    activateDemo();
                    setDemoActive(true);
                }
            })
            .finally(() => setIsBooting(false));
    }, []);

    const handleLogin = async () => {
        // A visitor who tried the demo and then signed up gets their sandbox
        // board imported into the new account (demo mode is already off here).
        if (isDemoImportPending()) {
            deactivateDemo();
            try {
                await importDemoBoardToAccount();
            } catch {
                // A failed import must not block login; the sandbox stays local.
            }
            clearDemoImportPending();
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
                <BoardApp onLogout={handleLogout} />
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
