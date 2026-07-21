import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import React from 'react';
import {
    BOARD_THEMES,
    BoardThemeId,
    DEFAULT_BOARD_THEME,
} from '../../constants/boardThemes';
import { TranslationKey } from '../../i18n/dictionary';
import { useT } from '../../i18n/LangContext';

interface AppearancePanelProps {
    activeTheme: string;
    customBackground?: string;
    // Fallback shown in the colour input when no custom background is set.
    defaultBackground: string;
    onSelectTheme: (theme: BoardThemeId) => void;
    onCustomBackground: (color: string) => void;
    onResetBackground: () => void;
}

const AppearancePanel: React.FC<AppearancePanelProps> = ({
    activeTheme,
    customBackground,
    defaultBackground,
    onSelectTheme,
    onCustomBackground,
    onResetBackground,
}) => {
    const { t } = useT();
    const effectiveTheme = activeTheme || DEFAULT_BOARD_THEME;

    return (
        <div
            className="board-appearance-panel"
            role="dialog"
            aria-label={t('app.appearance.title')}
        >
            <div className="appearance-section">
                <p className="appearance-title">{t('appearance.ambiance')}</p>
                <div className="appearance-themes">
                    {BOARD_THEMES.map((theme) => (
                        <button
                            key={theme.id}
                            type="button"
                            className={`appearance-theme ${
                                effectiveTheme === theme.id ? 'is-active' : ''
                            }`}
                            onClick={() => onSelectTheme(theme.id)}
                            title={t(
                                `theme.${theme.id}.desc` as TranslationKey
                            )}
                            aria-pressed={effectiveTheme === theme.id}
                        >
                            <span
                                className="appearance-theme-preview"
                                aria-hidden="true"
                            >
                                <span
                                    style={{ background: theme.preview[0] }}
                                />
                                <span
                                    style={{ background: theme.preview[1] }}
                                />
                                <span
                                    className="appearance-theme-accent"
                                    style={{ background: theme.preview[2] }}
                                />
                            </span>
                            <span className="appearance-theme-label">
                                {t(`theme.${theme.id}.label` as TranslationKey)}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="appearance-section">
                <p className="appearance-title">
                    {t('appearance.background')}
                </p>
                <div className="appearance-custom">
                    <label
                        className="appearance-custom-swatch"
                        title={t('appearance.customSwatch')}
                        style={{
                            background: customBackground || defaultBackground,
                        }}
                    >
                        <input
                            type="color"
                            value={customBackground || defaultBackground}
                            onChange={(event) =>
                                onCustomBackground(event.target.value)
                            }
                            aria-label={t('appearance.customSwatch')}
                        />
                    </label>
                    <span className="appearance-custom-copy">
                        {customBackground
                            ? t('appearance.customActive')
                            : t('appearance.followsTheme')}
                    </span>
                    <button
                        type="button"
                        className="appearance-reset"
                        onClick={onResetBackground}
                        disabled={!customBackground}
                        title={t('appearance.reset')}
                    >
                        <ArrowUturnLeftIcon />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AppearancePanel;
