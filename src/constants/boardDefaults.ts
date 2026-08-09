export const CARD_COLORS = [
    '#fef08a',
    '#fecdd3',
    '#bbf7d0',
    '#bae6fd',
    '#e9d5ff',
    '#fdba74',
] as const;
export const TEXT_COLORS = [
    '#172033',
    '#334155',
    '#7f1d1d',
    '#14532d',
    '#1e3a8a',
    '#581c87',
] as const;
export const FONT_FAMILIES = [
    'Inter',
    'Comic Sans MS',
    'Georgia',
    'Courier New',
    'Trebuchet MS',
] as const;

export const CARD_STYLE_PRESETS = [
    {
        id: 'yellow-note',
        label: 'Note jaune',
        color: '#fef08a',
        textColor: '#172033',
        textSize: 13,
        fontFamily: 'Inter',
    },
    {
        id: 'dark-neon',
        label: 'Sombre néon',
        color: '#172033',
        textColor: '#a7f3d0',
        textSize: 14,
        fontFamily: 'Courier New',
    },
    {
        id: 'paper',
        label: 'Papier',
        color: '#fff7ed',
        textColor: '#4a2c1a',
        textSize: 14,
        fontFamily: 'Georgia',
    },
] as const;

export const CARD_LIMITS = {
    minSize: 120,
    maxSize: 640,
    minTextSize: 11,
    maxTextSize: 24,
};

import { CardFinish, PostItPriority, PostItStatus } from '../types/boardTypes';

export const CARD_FINISHES: { id: CardFinish; label: string }[] = [
    { id: 'flat', label: 'Plat' },
    { id: 'matte', label: 'Mat' },
    { id: 'metallic', label: 'Métal' },
    { id: 'glass', label: 'Verre' },
    { id: 'paper', label: 'Papier' },
];

export const CARD_STATUSES: {
    id: PostItStatus;
    label: string;
    color: string;
}[] = [
    { id: 'todo', label: 'À faire', color: '#94a3b8' },
    { id: 'doing', label: 'En cours', color: '#3b82f6' },
    { id: 'done', label: 'Fait', color: '#22c55e' },
];

export const CARD_PRIORITIES: {
    id: PostItPriority;
    label: string;
    color: string;
}[] = [
    { id: 'low', label: 'Basse', color: '#64748b' },
    { id: 'medium', label: 'Moyenne', color: '#f59e0b' },
    { id: 'high', label: 'Haute', color: '#ef4444' },
];

export const DEFAULT_POST_IT = {
    title: 'Nouvelle note',
    content: '',
    color: '#fef08a',
    textColor: '#172033',
    textSize: 13,
    fontFamily: 'Inter',
    width: 220,
    height: 150,
    rotation: 0,
};
