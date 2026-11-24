/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { LangProvider, useT } from './LangContext';

const Probe: React.FC = () => {
    const { lang, setLang } = useT();
    return (
        <button onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}>
            {lang}
        </button>
    );
};

describe('LangProvider', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.history.replaceState({}, '', '/?lang=en');
        document.documentElement.lang = 'fr';
    });

    it('keeps <html lang> in step with the active language', () => {
        render(
            <LangProvider>
                <Probe />
            </LangProvider>
        );
        expect(document.documentElement.lang).toBe('en');
        act(() => screen.getByRole('button').click());
        expect(document.documentElement.lang).toBe('fr');
    });
});
