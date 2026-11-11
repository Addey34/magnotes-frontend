/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { LangProvider } from './i18n/LangContext';
import { markDemoImportPending } from './services/demoMode';

// Heavy / Vite-only modules are replaced: only the login ↔ import wiring of
// App is under test.
const boardMounts = jest.fn();
jest.mock('./pages/BoardApp', () => ({
    __esModule: true,
    default: function BoardAppMock({
        initialTabId,
        onLogout,
    }: {
        initialTabId?: string;
        onLogout?: () => void;
    }) {
        React.useEffect(() => {
            boardMounts();
        }, []);
        return (
            <div data-testid="board" data-initial-tab={initialTabId ?? ''}>
                <button onClick={onLogout}>logout</button>
            </div>
        );
    },
}));
jest.mock('./pages/LoginForm', () => ({
    __esModule: true,
    default: ({ onLogin }: { onLogin: () => void }) => (
        <button onClick={onLogin}>login</button>
    ),
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

const importDemoBoardToAccount = jest.fn();
jest.mock('./services/demoImportRuntime', () => ({
    importDemoBoardToAccount: () => importDemoBoardToAccount(),
}));

import App from './App';

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('magnotes-lang', 'en');
    boardMounts.mockClear();
    importDemoBoardToAccount.mockReset();
});

async function renderAtLogin() {
    render(
        <LangProvider>
            <App />
        </LangProvider>
    );
    return screen.findByText('login');
}

describe('login is never gated on the demo import', () => {
    it('opens the account after a short grace even if the import never answers', async () => {
        jest.useFakeTimers();
        try {
            markDemoImportPending();
            // The API never answers (the 20 s request timeout never elapses).
            importDemoBoardToAccount.mockReturnValue(
                new Promise(() => undefined)
            );

            fireEvent.click(await renderAtLogin());

            // Head start for the import: the board is not mounted yet…
            expect(screen.queryByTestId('board')).toBeNull();
            expect(screen.getByTestId('demo-import-banner')).toHaveAttribute(
                'data-state',
                'running'
            );
            // …but never beyond the grace period, far below the 20 s timeout.
            await act(async () => {
                jest.advanceTimersByTime(3_100);
            });

            expect(screen.getByTestId('board')).toBeInTheDocument();
            expect(screen.getByTestId('demo-import-banner')).toHaveAttribute(
                'data-state',
                'running'
            );
            expect(importDemoBoardToAccount).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('opens the board right away when the import answers quickly', async () => {
        markDemoImportPending();
        importDemoBoardToAccount.mockResolvedValue({
            status: 'complete',
            boards: 1,
            cards: 6,
            focusTabId: 'srv-1',
        });

        fireEvent.click(await renderAtLogin());

        expect(await screen.findByTestId('board')).toBeInTheDocument();
        // Mounted once, after the import: no board raced the import.
        expect(boardMounts).toHaveBeenCalledTimes(1);
    });

    it('stays logged in and offers a retry when the import fails', async () => {
        markDemoImportPending();
        importDemoBoardToAccount.mockResolvedValue({
            status: 'failed',
            reason: 'network',
        });

        fireEvent.click(await renderAtLogin());

        expect(await screen.findByTestId('board')).toBeInTheDocument();
        expect(
            await screen.findByRole('button', { name: /resume import/i })
        ).toBeInTheDocument();
    });

    it('reloads the board once the import completes', async () => {
        markDemoImportPending();
        let finish: (v: unknown) => void = () => undefined;
        importDemoBoardToAccount.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );

        fireEvent.click(await renderAtLogin());
        await act(async () =>
            finish({
                status: 'complete',
                boards: 2,
                cards: 6,
                focusTabId: 'srv-1',
            })
        );

        const board = await screen.findByTestId('board');
        // The imported board is opened, and the visitor is told what arrived.
        expect(board).toHaveAttribute('data-initial-tab', 'srv-1');
        const banner = screen.getByTestId('demo-import-banner');
        expect(banner).toHaveAttribute('data-state', 'done');
        expect(banner).toHaveTextContent(
            'Import complete: 6 note(s) in 2 board(s)'
        );

        fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        expect(screen.queryByTestId('demo-import-banner')).toBeNull();
    });

    it('opens the imported board even when only part of the import arrived', async () => {
        markDemoImportPending();
        importDemoBoardToAccount.mockResolvedValue({
            status: 'partial',
            skipped: 1,
            boards: 1,
            cards: 5,
            focusTabId: 'srv-9',
        });

        fireEvent.click(await renderAtLogin());

        expect(await screen.findByTestId('board')).toHaveAttribute(
            'data-initial-tab',
            'srv-9'
        );
        expect(screen.getByTestId('demo-import-banner')).toHaveAttribute(
            'data-state',
            'partial'
        );
    });

    it('does not call the import at all when none is pending', async () => {
        fireEvent.click(await renderAtLogin());
        expect(await screen.findByTestId('board')).toBeInTheDocument();
        expect(importDemoBoardToAccount).not.toHaveBeenCalled();
    });

    it('tells the visitor when items were left out and keeps the choice explicit', async () => {
        markDemoImportPending();
        importDemoBoardToAccount.mockResolvedValue({
            status: 'partial',
            skipped: 2,
        });

        fireEvent.click(await renderAtLogin());

        expect(
            await screen.findByText(/2 item\(s\) could not be transferred/i)
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /keep local copy/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /erase local copy/i })
        ).toBeInTheDocument();
    });
});

describe('a late import answer never leaks into a newer session', () => {
    const lateOutcome = {
        status: 'complete',
        boards: 1,
        cards: 6,
        focusTabId: 'srv-old',
    };

    async function loginPastGateThenLogout(finishImport: {
        current: (v: unknown) => void;
    }) {
        markDemoImportPending();
        importDemoBoardToAccount.mockReturnValueOnce(
            new Promise((resolve) => {
                finishImport.current = resolve;
            })
        );
        fireEvent.click(await renderAtLogin());
        // The grace period elapses while the import is still in flight.
        await act(async () => {
            jest.advanceTimersByTime(3_100);
        });
        expect(screen.getByTestId('board')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'logout' }));
        await screen.findByText('login');
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('drops the answer that arrives after logout and re-login', async () => {
        const finish = { current: (_v: unknown) => undefined };
        await loginPastGateThenLogout(finish);

        // The late answer lands while signed out…
        await act(async () => finish.current(lateOutcome));
        // …and the visitor signs in again (the completed import cleared its
        // own pending state, as the real flow does).
        localStorage.clear();
        fireEvent.click(screen.getByText('login'));

        const board = await screen.findByTestId('board');
        expect(board).toHaveAttribute('data-initial-tab', '');
        expect(screen.queryByTestId('demo-import-banner')).toBeNull();
    });

    it('drops the answer that arrives after re-login too', async () => {
        const finish = { current: (_v: unknown) => undefined };
        await loginPastGateThenLogout(finish);

        localStorage.clear();
        fireEvent.click(screen.getByText('login'));
        await screen.findByTestId('board');
        await act(async () => finish.current(lateOutcome));

        expect(screen.getByTestId('board')).toHaveAttribute(
            'data-initial-tab',
            ''
        );
        expect(screen.queryByTestId('demo-import-banner')).toBeNull();
    });

    it('does not show the old running banner in the next session', async () => {
        const finish = { current: (_v: unknown) => undefined };
        await loginPastGateThenLogout(finish);

        localStorage.clear();
        fireEvent.click(screen.getByText('login'));

        await screen.findByTestId('board');
        expect(screen.queryByTestId('demo-import-banner')).toBeNull();
    });
});
