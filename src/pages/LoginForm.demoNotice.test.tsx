/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { LangProvider } from '../i18n/LangContext';
import { markDemoImportPending } from '../services/demoMode';
import LoginForm from './LoginForm';

jest.mock('../services/authApi', () => ({
    forgotPassword: jest.fn(),
    login: jest.fn(),
    register: jest.fn(),
    resendCode: jest.fn(),
    resetPassword: jest.fn(),
    verifyEmail: jest.fn(),
}));
jest.mock('../utils/tokenUtils', () => ({ setTokens: jest.fn() }));

function renderLogin(lang: 'fr' | 'en', mode: 'login' | 'register') {
    localStorage.setItem('magnotes-lang', lang);
    return render(
        <LangProvider>
            <LoginForm onLogin={jest.fn()} initialMode={mode} />
        </LangProvider>
    );
}

describe('LoginForm demo notice', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('says the demo notes are kept when the visitor comes from the demo', () => {
        markDemoImportPending();
        renderLogin('fr', 'register');
        expect(screen.getByText(/vos notes de démo/i)).toBeInTheDocument();
    });

    it('says it on the sign-in screen too, in English', () => {
        markDemoImportPending();
        renderLogin('en', 'login');
        expect(
            screen.getByText('Your demo notes will be added to your account.')
        ).toBeInTheDocument();
    });

    it('keeps the plain wording for a visitor who never used the demo', () => {
        renderLogin('fr', 'register');
        expect(screen.queryByText(/vos notes de démo/i)).toBeNull();
        expect(
            screen.getByText('Un e-mail, un mot de passe, et c’est parti.')
        ).toBeInTheDocument();
    });
});
