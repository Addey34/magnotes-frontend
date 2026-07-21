import * as React from 'react';
import { LANGS } from './i18n';
import { useT } from './LangContext';

// Compact FR/EN toggle. `className` lets callers place it (auth page, menu…).
export const LanguageSwitch: React.FC<{ className?: string }> = ({
    className,
}) => {
    const { lang, setLang, t } = useT();
    return (
        <div
            className={`lang-switch ${className ?? ''}`.trim()}
            role="group"
            aria-label={t('lang.switch.aria')}
        >
            {LANGS.map((code) => (
                <button
                    key={code}
                    type="button"
                    className={
                        code === lang
                            ? 'lang-switch__btn is-active'
                            : 'lang-switch__btn'
                    }
                    aria-pressed={code === lang}
                    onClick={() => setLang(code)}
                >
                    {t(code === 'fr' ? 'lang.fr' : 'lang.en')}
                </button>
            ))}
        </div>
    );
};
