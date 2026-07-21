// Board appearance presets. Each theme is a cohesive skin applied per board:
// picking one restyles the sidebar, topbar, and canvas together through the CSS
// class `board-theme-<id>` (see BoardApp.css). `clair` is the default (no class,
// so the global light/dark theme applies as before).
//
// `preview` colours drive the swatch shown in the customization panel and are
// purely presentational — the real styling lives in CSS variables.

export type BoardThemeId =
    | 'clair'
    | 'frigo'
    | 'magnetique'
    | 'liege'
    | 'ardoise';

export interface BoardTheme {
    id: BoardThemeId;
    label: string;
    description: string;
    // [surface, canvas, accent] — used to render the preset preview.
    preview: [string, string, string];
}

export const DEFAULT_BOARD_THEME: BoardThemeId = 'clair';

export const BOARD_THEMES: BoardTheme[] = [
    {
        id: 'clair',
        label: 'Épuré',
        description: 'Suit le thème clair ou sombre de l’application.',
        preview: ['#f6f7fa', '#ffffff', '#806df5'],
    },
    {
        id: 'frigo',
        label: 'Frigo',
        description: 'Inox brossé et blanc laqué, ambiance porte de frigo.',
        preview: ['#d7dde3', '#eef1f4', '#e2574c'],
    },
    {
        id: 'magnetique',
        label: 'Magnétique',
        description: 'Tableau d’atelier sombre à pastille aimantée.',
        preview: ['#2a2f3a', '#1d222c', '#4f8cff'],
    },
    {
        id: 'liege',
        label: 'Liège',
        description: 'Panneau de liège chaleureux et cadre bois.',
        preview: ['#b98a4e', '#c9a066', '#3f7d54'],
    },
    {
        id: 'ardoise',
        label: 'Ardoise',
        description: 'Tableau noir à la craie, contrastes doux.',
        preview: ['#33413b', '#20302a', '#f4f1e6'],
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
