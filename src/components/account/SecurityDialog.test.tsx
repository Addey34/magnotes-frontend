/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { LangProvider } from '../../i18n/LangContext';
import {
    changePassword,
    listSessions,
    revokeOtherSessions,
    revokeSession,
} from '../../services/accountApi';
import SecurityDialog from './SecurityDialog';

jest.mock('../../services/accountApi', () => ({
    listSessions: jest.fn(),
    revokeSession: jest.fn(),
    revokeOtherSessions: jest.fn(),
    changePassword: jest.fn(),
}));

const current = {
    id: 'a',
    device: 'Chrome sur Windows',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastUsedAt: new Date().toISOString(),
    current: true,
};
const other = {
    id: 'b',
    device: 'Safari sur iPhone',
    createdAt: '2026-11-02T10:00:00.000Z',
    lastUsedAt: '2026-11-10T10:00:00.000Z',
    current: false,
};

const setup = (onLogout = jest.fn()) => {
    render(<SecurityDialog onClose={jest.fn()} onLogout={onLogout} />, {
        wrapper: LangProvider,
    });
    return onLogout;
};

beforeEach(() => {
    jest.resetAllMocks();
    localStorage.setItem('magnotes-lang', 'fr');
    jest.mocked(listSessions).mockResolvedValue([current, other]);
});

it('lists devices and flags the current one', async () => {
    setup();
    expect(await screen.findByText('Safari sur iPhone')).toBeVisible();
    expect(screen.getByText('Cet appareil')).toBeVisible();
    expect(
        screen.getAllByRole('button', { name: /^Déconnecter (Safari|Chrome)/ })
    ).toHaveLength(1);
});

it('disables sign-out-others when there is no other device', async () => {
    jest.mocked(listSessions).mockResolvedValue([current]);
    setup();
    await screen.findByText('Chrome sur Windows');
    expect(
        screen.getByRole('button', {
            name: 'Déconnecter tous les autres appareils',
        })
    ).toBeDisabled();
});

it('needs a confirmation click, then reloads the list', async () => {
    jest.mocked(revokeSession).mockResolvedValue();
    setup();
    fireEvent.click(
        await screen.findByRole('button', {
            name: 'Déconnecter Safari sur iPhone',
        })
    );
    expect(revokeSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('b'));
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
});

it('signs out all other devices and reports the count', async () => {
    jest.mocked(revokeOtherSessions).mockResolvedValue(3);
    setup();
    fireEvent.click(
        await screen.findByRole('button', {
            name: 'Déconnecter tous les autres appareils',
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(
        await screen.findByText('3 appareil(s) déconnecté(s).')
    ).toBeVisible();
});

it('shows an error state with retry', async () => {
    jest.mocked(listSessions).mockRejectedValueOnce(new Error('x'));
    setup();
    expect(
        await screen.findByText('Impossible de charger les appareils.')
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Safari sur iPhone')).toBeVisible();
});

describe('password form', () => {
    const fill = () => {
        fireEvent.change(screen.getByLabelText('Mot de passe actuel'), {
            target: { value: 'oldpassword' },
        });
        fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), {
            target: { value: 'newpassword1' },
        });
    };

    it('checks sign-out-others by default and sends its value', async () => {
        jest.mocked(changePassword).mockResolvedValue({
            message: 'ok',
            revoked: 2,
        });
        setup();
        await screen.findByText('Safari sur iPhone');
        expect(
            screen.getByLabelText('Déconnecter mes autres appareils')
        ).toBeChecked();
        fill();
        fireEvent.click(
            screen.getByRole('button', { name: 'Changer le mot de passe' })
        );
        await waitFor(() =>
            expect(changePassword).toHaveBeenCalledWith({
                currentPassword: 'oldpassword',
                newPassword: 'newpassword1',
                signOutOthers: true,
            })
        );
        expect(
            await screen.findByText(
                'Mot de passe modifié. 2 autre(s) appareil(s) déconnecté(s).'
            )
        ).toBeVisible();
    });

    it('sends false when unchecked', async () => {
        jest.mocked(changePassword).mockResolvedValue({
            message: 'ok',
            revoked: 0,
        });
        setup();
        await screen.findByText('Safari sur iPhone');
        fireEvent.click(
            screen.getByLabelText('Déconnecter mes autres appareils')
        );
        fill();
        fireEvent.click(
            screen.getByRole('button', { name: 'Changer le mot de passe' })
        );
        await waitFor(() =>
            expect(changePassword).toHaveBeenCalledWith(
                expect.objectContaining({ signOutOthers: false })
            )
        );
    });

    it('shows a 401 in the form without logging out', async () => {
        jest.mocked(changePassword).mockRejectedValue({
            response: {
                status: 401,
                data: { error: 'Mot de passe incorrect.' },
            },
        });
        const onLogout = setup();
        await screen.findByText('Safari sur iPhone');
        fill();
        fireEvent.click(
            screen.getByRole('button', { name: 'Changer le mot de passe' })
        );
        expect(
            await screen.findByText('Mot de passe actuel incorrect.')
        ).toBeVisible();
        expect(onLogout).not.toHaveBeenCalled();
    });

    it('rejects a too short new password locally', async () => {
        setup();
        await screen.findByText('Safari sur iPhone');
        fireEvent.change(screen.getByLabelText('Mot de passe actuel'), {
            target: { value: 'oldpassword' },
        });
        fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), {
            target: { value: 'short' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Changer le mot de passe' })
        );
        expect(
            await screen.findByText(
                'Le mot de passe doit contenir au moins 8 caractères.'
            )
        ).toBeVisible();
        expect(changePassword).not.toHaveBeenCalled();
    });
});
