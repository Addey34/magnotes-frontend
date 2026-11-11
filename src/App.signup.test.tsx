/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { LangProvider } from './i18n/LangContext';
import { bootstrapSession } from './services/authApi';
import { isDemoImportPending } from './services/demoMode';

// Only the sign-in screen wiring of App is under test: the form and the board
// are replaced by probes.
jest.mock('./pages/BoardApp', () => ({
    __esModule: true,
    default: function BoardAppMock({
        onLogout,
        onRequestSignup,
        demo,
    }: {
        onLogout: () => void;
        onRequestSignup?: () => void;
        demo?: boolean;
    }) {
        return (
            <div data-testid={demo ? 'demo-board' : 'board'}>
                <button onClick={onLogout}>logout</button>
                {onRequestSignup && (
                    <button onClick={onRequestSignup}>keep my notes</button>
                )}
            </div>
        );
    },
}));
jest.mock('./pages/LoginForm', () => ({
    __esModule: true,
    default: function LoginFormMock({
        onLogin,
        initialMode,
    }: {
        onLogin: () => void;
        initialMode?: string;
    }) {
        // Like the real form, the mode is only read when the form mounts.
        const [mode, setMode] = React.useState(initialMode ?? 'login');
        return (
            <div data-testid="login-form" data-mode={mode}>
                <button onClick={onLogin}>log in</button>
                <button
                    onClick={() =>
                        setMode((m) => (m === 'login' ? 'register' : 'login'))
                    }
                >
                    switch
                </button>
            </div>
        );
    },
}));
jest.mock('./pages/PublicBoardView', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('./services/authApi', () => ({
    bootstrapSession: jest.fn(() => Promise.resolve(false)),
    logout: jest.fn(() => Promise.resolve('confirmed')),
    setupAuthInterceptor: jest.fn(() => () => undefined),
}));
jest.mock('./services/demoBoard', () => ({
    resetPristineDemoForLanguage: jest.fn(),
    resetDemoBoard: jest.fn(),
}));
jest.mock('./services/demoImportRuntime', () => ({
    importDemoBoardToAccount: jest.fn(() =>
        Promise.resolve({ status: 'none' })
    ),
}));

import App from './App';

const mockedBootstrap = bootstrapSession as jest.MockedFunction<
    typeof bootstrapSession
>;

function openAt(url: string) {
    window.history.replaceState({}, '', url);
}

function renderApp(strict = false) {
    const tree = (
        <LangProvider>
            <App />
        </LangProvider>
    );
    return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
}

const mode = async () =>
    (await screen.findByTestId('login-form')).getAttribute('data-mode');

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('magnotes-lang', 'fr');
    mockedBootstrap.mockReset();
    mockedBootstrap.mockResolvedValue(false);
});

afterEach(() => openAt('/'));

describe('sign-up entry', () => {
    it('opens the sign-up form for ?signup=1, then cleans the URL', async () => {
        openAt('/app/?lang=fr&signup=1');
        renderApp();

        expect(await mode()).toBe('register');
        expect(window.location.search).toBe('?lang=fr');
    });

    it('opens the sign-up form the same way under StrictMode', async () => {
        openAt('/app/?lang=fr&signup=1');
        renderApp(true);

        expect(await mode()).toBe('register');
        expect(window.location.search).toBe('?lang=fr');
    });

    it('keeps the sign-in screen for a plain /app/ and for ?lang only', async () => {
        openAt('/app/?lang=fr');
        renderApp();

        expect(await mode()).toBe('login');
    });

    it('a reload after the clean-up opens the sign-in screen', async () => {
        openAt('/app/?lang=fr&signup=1');
        const first = renderApp();
        expect(await mode()).toBe('register');
        first.unmount();

        // The address bar no longer carries ?signup: same URL a reload uses.
        renderApp();
        expect(await mode()).toBe('login');
    });

    it('the sign-in link inside the form still switches modes', async () => {
        openAt('/app/?signup=1');
        renderApp();
        expect(await mode()).toBe('register');

        fireEvent.click(screen.getByText('switch'));
        expect(await mode()).toBe('login');
        fireEvent.click(screen.getByText('switch'));
        expect(await mode()).toBe('register');
    });

    it('?demo=1&signup=1 stays in the demo', async () => {
        openAt('/app/?demo=1&signup=1');
        renderApp();

        expect(await screen.findByTestId('demo-board')).toBeInTheDocument();
        expect(screen.queryByTestId('login-form')).toBeNull();
    });

    it('returns to sign in after login then logout', async () => {
        openAt('/app/?signup=1');
        renderApp();
        expect(await mode()).toBe('register');

        fireEvent.click(screen.getByText('log in'));
        expect(await screen.findByTestId('board')).toBeInTheDocument();

        fireEvent.click(screen.getByText('logout'));
        expect(await mode()).toBe('login');
    });

    it('a valid session never shows the form, and a later logout opens sign in', async () => {
        mockedBootstrap.mockResolvedValue(true);
        openAt('/app/?signup=1');
        renderApp();

        expect(await screen.findByTestId('board')).toBeInTheDocument();
        expect(screen.queryByTestId('login-form')).toBeNull();

        fireEvent.click(screen.getByText('logout'));
        expect(await mode()).toBe('login');
    });
});

describe('demo "keep my notes" button', () => {
    it('opens the sign-up form and keeps the import pending', async () => {
        openAt('/app/?demo=1&lang=fr');
        renderApp();
        fireEvent.click(await screen.findByText('keep my notes'));

        expect(await mode()).toBe('register');
        expect(isDemoImportPending()).toBe(true);
        expect(window.location.search).not.toContain('demo');
    });

    it('lets an existing user switch to sign in without losing the import', async () => {
        openAt('/app/?demo=1&lang=fr');
        renderApp();
        fireEvent.click(await screen.findByText('keep my notes'));
        expect(await mode()).toBe('register');

        fireEvent.click(screen.getByText('switch'));
        expect(await mode()).toBe('login');
        expect(isDemoImportPending()).toBe(true);
    });

    it('goes back to sign in after the session ends', async () => {
        openAt('/app/?demo=1&lang=fr');
        renderApp();
        fireEvent.click(await screen.findByText('keep my notes'));
        expect(await mode()).toBe('register');

        await act(async () => {
            fireEvent.click(screen.getByText('log in'));
        });
        expect(await screen.findByTestId('board')).toBeInTheDocument();
        fireEvent.click(screen.getByText('logout'));

        expect(await mode()).toBe('login');
    });
});
