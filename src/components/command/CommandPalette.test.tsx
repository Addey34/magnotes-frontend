/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
    fireEvent,
    render as rtlRender,
    RenderOptions,
    screen,
} from '@testing-library/react';
import React from 'react';
import CommandPalette, { PaletteCommand } from './CommandPalette';
import { LangProvider } from '../../i18n/LangContext';

// Force French so the assertions below are language-independent, then wrap every
// render in the i18n provider that CommandPalette's useT() needs.
beforeEach(() => localStorage.setItem('magnotes-lang', 'fr'));
const render = (ui: React.ReactElement, options?: RenderOptions) =>
    rtlRender(ui, { wrapper: LangProvider, ...options });

const makeCommands = (spy: () => void = jest.fn()): PaletteCommand[] => [
    { id: 'new-card', label: 'Nouvelle carte', group: 'Actions', run: spy },
    { id: 'frame', label: 'Cadrer le tableau', group: 'Actions', run: spy },
    { id: 'theme', label: 'Basculer le thème', group: 'Préférences', run: spy },
];

const activeLabel = () =>
    document
        .querySelector('[data-active="true"] .command-palette-item-label')
        ?.textContent?.trim();

describe('CommandPalette', () => {
    it('renders nothing while closed', () => {
        const { container } = render(
            <CommandPalette
                open={false}
                commands={makeCommands()}
                onClose={jest.fn()}
            />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('highlights the top match when the query changes', () => {
        render(
            <CommandPalette
                open
                commands={makeCommands()}
                onClose={jest.fn()}
            />
        );
        const input = screen.getByLabelText('Rechercher une commande');

        // Move the active row down, then type: the best match should reset to top.
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.change(input, { target: { value: 'thème' } });

        expect(activeLabel()).toBe('Basculer le thème');
    });

    it('runs the active command on Enter and closes', () => {
        const run = jest.fn();
        const onClose = jest.fn();
        render(
            <CommandPalette
                open
                commands={makeCommands(run)}
                onClose={onClose}
            />
        );
        const input = screen.getByLabelText('Rechercher une commande');

        fireEvent.change(input, { target: { value: 'cadrer' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(run).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape without running a command', () => {
        const run = jest.fn();
        const onClose = jest.fn();
        render(
            <CommandPalette
                open
                commands={makeCommands(run)}
                onClose={onClose}
            />
        );
        fireEvent.keyDown(screen.getByLabelText('Rechercher une commande'), {
            key: 'Escape',
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(run).not.toHaveBeenCalled();
    });

    it('offers a quick-capture entry at the top for a non-empty query', () => {
        const onQuickCapture = jest.fn();
        render(
            <CommandPalette
                open
                commands={makeCommands()}
                onClose={jest.fn()}
                onQuickCapture={onQuickCapture}
            />
        );
        const input = screen.getByLabelText('Rechercher une commande');
        fireEvent.change(input, { target: { value: 'idée neuve' } });

        expect(activeLabel()).toBe('Créer la note « idée neuve »');

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onQuickCapture).toHaveBeenCalledWith('idée neuve');
    });

    it('restores focus to the previously focused element on close', () => {
        const trigger = document.createElement('button');
        trigger.textContent = 'ouvrir';
        document.body.appendChild(trigger);
        trigger.focus();
        expect(document.activeElement).toBe(trigger);

        const { rerender } = render(
            <CommandPalette
                open
                commands={makeCommands()}
                onClose={jest.fn()}
            />
        );
        rerender(
            <CommandPalette
                open={false}
                commands={makeCommands()}
                onClose={jest.fn()}
            />
        );

        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });
});
