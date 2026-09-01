/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { LangProvider } from '../../i18n/LangContext';
import {
    getAccountProfile,
    updateEmailPreferences,
} from '../../services/accountApi';
import EmailPreferencesDialog from './EmailPreferencesDialog';

jest.mock('../../services/accountApi', () => ({
    getAccountProfile: jest.fn(),
    updateEmailPreferences: jest.fn(),
}));

const profile = {
    email: 'member@example.test',
    displayName: 'member',
    emailVerified: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    emailPreferences: {
        dueDigestFrequency: 'off' as const,
        timezone: 'Europe/Paris',
        deliveryHour: 8,
    },
};

beforeEach(() => {
    localStorage.setItem('magnotes-lang', 'fr');
    jest.mocked(getAccountProfile).mockResolvedValue(profile);
    jest.mocked(updateEmailPreferences).mockImplementation(async (value) => ({
        ...profile,
        emailPreferences: value,
    }));
});

it('loads explicit preferences and saves an opt-in', async () => {
    render(<EmailPreferencesDialog onClose={jest.fn()} />, {
        wrapper: LangProvider,
    });

    const frequency = await screen.findByLabelText('Fréquence');
    fireEvent.change(frequency, { target: { value: 'daily' } });
    fireEvent.change(screen.getByLabelText("Heure d'envoi"), {
        target: { value: '9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
        expect(updateEmailPreferences).toHaveBeenCalledWith({
            dueDigestFrequency: 'daily',
            timezone: 'Europe/Paris',
            deliveryHour: 9,
        })
    );
    expect(await screen.findByText('Préférences enregistrées.')).toBeVisible();
});
