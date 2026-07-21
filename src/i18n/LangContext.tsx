/**
 * React binding for the i18n core: a provider holds the current language and a
 * `useT()` hook returns `t(key, params?)` plus the language and a setter. Kept
 * separate from the pure core so the core stays unit-testable without React.
 */

import * as React from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { TranslationKey } from './dictionary';
import { detectLang, Lang, storeLang, translate } from './i18n';

interface LangContextValue {
    lang: Lang;
    setLang: (lang: Lang) => void;
    t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export const LangProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [lang, setLangState] = useState<Lang>(() => detectLang());

    const setLang = useCallback((next: Lang) => {
        storeLang(next);
        setLangState(next);
    }, []);

    const value = useMemo<LangContextValue>(
        () => ({
            lang,
            setLang,
            t: (key, params) => translate(lang, key, params),
        }),
        [lang, setLang]
    );

    return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
};

export function useT(): LangContextValue {
    const context = useContext(LangContext);
    if (!context) {
        throw new Error('useT must be used within a LangProvider');
    }
    return context;
}
