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
    default: function BoardAppMock() {
        React.useEffect(() => {
            boardMounts();
        }, []);
        return <div data-testid="board" />;
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
    logout: jest.fn(),
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
        importDemoBoardToAccount.mockResolvedValue({ status: 'complete' });

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
        await act(async () => finish({ status: 'complete' }));

        expect(await screen.findByTestId('board')).toBeInTheDocument();
        expect(screen.queryByTestId('demo-import-banner')).toBeNull();
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
