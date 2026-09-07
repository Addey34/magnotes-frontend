// Board appearance presets. Each theme is a cohesive skin applied per board:
// picking one restyles the sidebar, topbar, and canvas together through the CSS
// class `board-theme-<id>` (see BoardApp.css). `clair` is the default (no class,
// so the global light/dark theme applies as before).
//
// A preset is only an identity (a tint hue and an accent); the light/dark
// toggle stays in charge of luminosity. The swatch in the customization panel
// is rendered from the very same CSS variables (`.mn-palette` + the preset's
// class), so there is deliberately no preview colour stored here to drift.

export type BoardThemeId =
    'clair' | 'frigo' | 'magnetique' | 'liege' | 'ardoise';

export interface BoardTheme {
    id: BoardThemeId;
    label: string;
    description: string;
}

export const DEFAULT_BOARD_THEME: BoardThemeId = 'clair';

export const BOARD_THEMES: BoardTheme[] = [
    {
        id: 'clair',
        label: 'Épuré',
        description: 'Suit le thème clair ou sombre de l’application.',
    },
    {
        id: 'frigo',
        label: 'Frigo',
        description: 'Inox brossé et blanc laqué, ambiance porte de frigo.',
    },
    {
        id: 'magnetique',
        label: 'Magnétique',
        description: 'Tableau d’atelier sombre à pastille aimantée.',
    },
    {
        id: 'liege',
        label: 'Liège',
        description: 'Panneau de liège chaleureux et cadre bois.',
    },
    {
        id: 'ardoise',
        label: 'Ardoise',
        description: 'Tableau noir à la craie, contrastes doux.',
    },
];

export const isBoardThemeId = (value: unknown): value is BoardThemeId =>
    typeof value === 'string' &&
    BOARD_THEMES.some((theme) => theme.id === value);

// The CSS class that skins the whole shell. The default theme adds nothing so
// the app-level light/dark theme keeps control.
export const boardThemeClass = (theme: string | undefined): string =>
    theme && theme !== DEFAULT_BOARD_THEME && isBoardThemeId(theme)
        ? `board-theme-${theme}`
        : '';
