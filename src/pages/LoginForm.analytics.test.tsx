/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LangProvider } from '../i18n/LangContext';
import {
    login,
    register,
    verifyEmail,
} from '../services/authApi';
import { trackProductEvent } from '../services/analytics';
import LoginForm from './LoginForm';

jest.mock('../services/authApi', () => ({
    forgotPassword: jest.fn(),
    login: jest.fn(),
    register: jest.fn(),
    resendCode: jest.fn(),
    resetPassword: jest.fn(),
    verifyEmail: jest.fn(),
}));
jest.mock('../services/analytics', () => ({
    trackProductEvent: jest.fn(),
}));
jest.mock('../utils/tokenUtils', () => ({
    setTokens: jest.fn(),
}));

const mockedLogin = login as jest.MockedFunction<typeof login>;
const mockedRegister = register as jest.MockedFunction<typeof register>;
const mockedVerifyEmail = verifyEmail as jest.MockedFunction<
    typeof verifyEmail
>;
const mockedTrack = trackProductEvent as jest.MockedFunction<
    typeof trackProductEvent
>;

function renderLogin(onLogin = jest.fn()) {
    localStorage.setItem('magnotes-lang', 'fr');
    const rendered = render(
        <LangProvider>
            <LoginForm onLogin={onLogin} />
        </LangProvider>
    );
    return { ...rendered, onLogin };
}

function fill(selector: string, value: string) {
    const input = document.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing input: ${selector}`);
    }
    fireEvent.change(input, { target: { value } });
}

describe('LoginForm analytics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    it('measures the successful signup and verification milestones', async () => {
        mockedRegister.mockResolvedValue({
            message: 'Code envoyé.',
            email: 'user@example.com',
        });
        mockedVerifyEmail.mockResolvedValue({
            token: 'access-token',
            user: {
                email: 'user@example.com',
                displayName: 'User',
                emailVerified: true,
            },
        });
        const { onLogin } = renderLogin();

        fireEvent.click(
            screen.getByRole('button', { name: 'Créer un compte' })
        );
        expect(mockedTrack).toHaveBeenCalledWith('signup_started');

        fill('#email', ' user@example.com ');
        fill('#password', 'password-123');
        fill('#confirm-password', 'password-123');
        fireEvent.click(
            screen.getByRole('button', { name: 'Créer mon compte' })
        );

        await waitFor(() =>
            expect(mockedTrack).toHaveBeenCalledWith('signup_registered')
        );
        fill('input[autocomplete="one-time-code"]', '123456');
        fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

        await waitFor(() =>
            expect(mockedTrack).toHaveBeenCalledWith('email_verified')
        );
        expect(onLogin).toHaveBeenCalledTimes(1);
        expect(mockedTrack.mock.calls.map(([event]) => event)).toEqual([
            'signup_started',
            'signup_registered',
            'email_verified',
        ]);
    });

    it('does not report a registration milestone when the API rejects it', async () => {
        mockedRegister.mockRejectedValue(new Error('network error'));
        renderLogin();

        fireEvent.click(
            screen.getByRole('button', { name: 'Créer un compte' })
        );
        fill('#email', 'user@example.com');
        fill('#password', 'password-123');
        fill('#confirm-password', 'password-123');
        fireEvent.click(
            screen.getByRole('button', { name: 'Créer mon compte' })
        );

        await screen.findByRole('alert');
        expect(mockedTrack).not.toHaveBeenCalledWith('signup_registered');
    });

    it('reports login only after a successful API response', async () => {
        mockedLogin.mockResolvedValue({
            token: 'access-token',
            user: {
                email: 'user@example.com',
                displayName: 'User',
                emailVerified: true,
            },
        });
        const { onLogin } = renderLogin();
        fill('#email', 'user@example.com');
        fill('#password', 'password-123');
        fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

        await waitFor(() =>
            expect(mockedTrack).toHaveBeenCalledWith('login_completed')
        );
        expect(onLogin).toHaveBeenCalledTimes(1);
    });
});
