/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { LangProvider } from '../../i18n/LangContext';
import { submitFeedback } from '../../services/feedbackApi';
import FeedbackDialog from './FeedbackDialog';

jest.mock('../../services/feedbackApi', () => ({
    submitFeedback: jest.fn(),
}));

beforeEach(() => {
    localStorage.setItem('magnotes-lang', 'fr');
    jest.mocked(submitFeedback).mockResolvedValue(true);
});

it('sends the trimmed message with context and shows a thank-you message', async () => {
    render(<FeedbackDialog context="kanban" onClose={jest.fn()} />, {
        wrapper: LangProvider,
    });

    fireEvent.change(screen.getByLabelText('Votre message'), {
        target: { value: '  Super outil, merci !  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() =>
        expect(submitFeedback).toHaveBeenCalledWith(
            'Super outil, merci !',
            'kanban'
        )
    );
    expect(
        await screen.findByText('Merci ! Votre message a bien été envoyé.')
    ).toBeVisible();
});

it('disables submit for an empty message', () => {
    render(<FeedbackDialog onClose={jest.fn()} />, { wrapper: LangProvider });

    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
});

it('shows an error and stays open when submission fails', async () => {
    jest.mocked(submitFeedback).mockResolvedValue(false);
    render(<FeedbackDialog onClose={jest.fn()} />, { wrapper: LangProvider });

    fireEvent.change(screen.getByLabelText('Votre message'), {
        target: { value: 'Un bug quelque part' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    expect(
        await screen.findByText("Échec de l'envoi. Réessayez dans un instant.")
    ).toBeVisible();
    expect(screen.getByLabelText('Votre message')).toBeInTheDocument();
});

it('closes on Escape', () => {
    const onClose = jest.fn();
    render(<FeedbackDialog onClose={onClose} />, { wrapper: LangProvider });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
});
