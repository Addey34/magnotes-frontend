/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { LangProvider } from '../../i18n/LangContext';
import NotificationCenter from './NotificationCenter';

beforeEach(() => localStorage.setItem('magnotes-lang', 'fr'));

describe('NotificationCenter', () => {
    it('announces the persistent offline state', () => {
        render(
            <LangProvider>
                <NotificationCenter
                    isOnline={false}
                    notifications={[]}
                    onDismiss={jest.fn()}
                />
            </LangProvider>
        );

        expect(screen.getByRole('status')).toHaveTextContent('hors ligne');
    });

    it('renders errors as alerts and lets the user dismiss them', () => {
        const onDismiss = jest.fn();
        render(
            <LangProvider>
                <NotificationCenter
                    isOnline
                    notifications={[
                        { id: 7, kind: 'error', message: 'Échec réseau' },
                    ]}
                    onDismiss={onDismiss}
                />
            </LangProvider>
        );

        expect(screen.getByRole('alert')).toHaveTextContent('Échec réseau');
        fireEvent.click(
            screen.getByRole('button', { name: 'Fermer la notification' })
        );
        expect(onDismiss).toHaveBeenCalledWith(7);
    });
});
