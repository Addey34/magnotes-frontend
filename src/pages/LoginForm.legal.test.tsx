/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LangProvider } from '../i18n/LangContext';
import LoginForm from './LoginForm';

jest.mock('../services/authApi', () => ({
    forgotPassword: jest.fn(),
    login: jest.fn(),
    register: jest.fn(),
    resendCode: jest.fn(),
    resetPassword: jest.fn(),
    verifyEmail: jest.fn(),
}));
jest.mock('../services/analytics', () => ({ trackProductEvent: jest.fn() }));
jest.mock('../utils/tokenUtils', () => ({ setTokens: jest.fn() }));

const CONTACT = 'mailto:contact@adrianguichard.dev';

function renderLogin(lang: 'fr' | 'en') {
    localStorage.setItem('magnotes-lang', lang);
    return render(
        <LangProvider>
            <LoginForm onLogin={jest.fn()} />
        </LangProvider>
    );
}

const expectLinks = () => {
    expect(
        screen.getByRole('link', { name: 'Confidentialité' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact' })).toBeInTheDocument();
};

describe('LoginForm legal links', () => {
    beforeEach(() => localStorage.clear());

    it.each([
        ['fr', 'Confidentialité', '/confidentialite/'],
        ['en', 'Privacy', '/en/privacy/'],
    ] as const)(
        'links the %s privacy page and the public contact',
        (lang, label, href) => {
            renderLogin(lang);
            const privacy = screen.getByRole('link', { name: label });
            expect(privacy).toHaveAttribute('href', href);
            expect(privacy).toHaveAttribute('target', '_blank');
            expect(privacy).toHaveAttribute('rel', 'noopener noreferrer');
            expect(
                screen.getByRole('link', { name: 'Contact' })
            ).toHaveAttribute('href', CONTACT);
        }
    );

    it('is a labelled navigation made of real links (keyboard reachable)', () => {
        renderLogin('fr');
        const nav = screen.getByRole('navigation', { name: 'Informations' });
        const links = nav.querySelectorAll('a[href]');
        expect(links).toHaveLength(2);
        links.forEach((a) => expect(a).not.toHaveAttribute('tabindex', '-1'));
    });

    it('stays in sign up and forgot-password modes without altering the form', () => {
        renderLogin('fr');
        expectLinks();
        fireEvent.click(
            screen.getByRole('button', { name: 'Créer un compte' })
        );
        expectLinks();
        expect(document.querySelector('#confirm-password')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
        fireEvent.click(
            screen.getByRole('button', { name: /mot de passe oublié/i })
        );
        expectLinks();
    });
});
