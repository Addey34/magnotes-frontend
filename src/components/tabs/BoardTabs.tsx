import { Bars3Icon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid';
import React, { useState } from 'react';
import { BoardTab } from '../../types/boardTypes';
import { useT } from '../../i18n/LangContext';

const TAB_COLORS = ['#facc15', '#38bdf8', '#fb7185', '#4ade80', '#c084fc'];
const LEGACY_TAB_ICONS: Record<string, string> = {
    home: '⌂',
    work: '▣',
    ideas: '✦',
    calendar: '▤',
    bookmark: '◆',
    star: '★',
};

const TAB_EMOJIS = [
    '📝',
    '🏠',
    '💼',
    '💡',
    '📅',
    '⭐',
    '✅',
    '🎯',
    '🚀',
    '🔥',
    '🌱',
    '🎨',
    '📚',
    '🧠',
    '❤️',
    '☀️',
    '🌙',
    '⚡',
    '🎵',
    '📌',
    '🗂️',
    '🛒',
    '✈️',
    '🎉',
    '🧘',
    '🏆',
    '🔧',
    '💻',
    '📷',
    '🍀',
];

const getTabIcon = (icon: string): string =>
    LEGACY_TAB_ICONS[icon] || icon || LEGACY_TAB_ICONS.home;

interface BoardTabsProps {
    tabs: BoardTab[];
    activeTabId: string | null;
    onSelectTab: (tabId: string) => void;
    onAddTab: () => void;
    onRenameTab: (tabId: string, name: string) => void;
    onCustomizeTab: (
        tabId: string,
        updates: Partial<Pick<BoardTab, 'color' | 'icon'>>
    ) => void;
    onReorderTabs: (draggedTabId: string, targetTabId: string) => void;
    onDeleteTab: (tabId: string) => void;
}

const BoardTabs: React.FC<BoardTabsProps> = ({
    tabs,
    activeTabId,
    onSelectTab,
    onAddTab,
    onRenameTab,
    onCustomizeTab,
    onReorderTabs,
    onDeleteTab,
}) => {
    const { t } = useT();
    const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
    const [editingTabId, setEditingTabId] = useState<string | null>(null);
    const [draftName, setDraftName] = useState('');

    const startRenaming = (tab: BoardTab) => {
        setDraftName(tab.name);
        setEditingTabId(tab._id);
    };

    const commitName = (tabId: string) => {
        onRenameTab(tabId, draftName);
        setEditingTabId(null);
    };

    return (
        <nav className="board-tabs" aria-label={t('tabs.aria')}>
            <span className="board-tabs-label">{t('tabs.aria')}</span>
            {tabs.map((tab) => (
                <div
                    key={tab._id}
                    className={`board-tab ${tab._id === activeTabId ? 'is-active' : ''} ${draggedTabId === tab._id ? 'is-dragging' : ''}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                        if (draggedTabId) onReorderTabs(draggedTabId, tab._id);
                        setDraggedTabId(null);
                    }}
                >
                    <span
                        className="board-tab-drag"
                        draggable
                        onDragStart={() => setDraggedTabId(tab._id)}
                        onDragEnd={() => setDraggedTabId(null)}
                        title={t('tabs.reorder')}
                    >
                        <Bars3Icon />
                    </span>
                    <div
                        className="board-tab-select"
                        onClick={() => onSelectTab(tab._id)}
                        onDoubleClick={() => startRenaming(tab)}
                        onKeyDown={(event) => {
                            if (
                                event.target === event.currentTarget &&
                                event.key === 'Enter'
                            ) {
                                onSelectTab(tab._id);
                            }
                        }}
                        role="button"
                        tabIndex={0}
                        title={tab.name}
                    >
                        <span
                            className="board-tab-icon"
                            style={{ color: tab.color }}
                        >
                            {getTabIcon(tab.icon)}
                        </span>
                        {editingTabId === tab._id ? (
                            <input
                                className="board-tab-input"
                                value={draftName}
                                autoFocus
                                maxLength={40}
                                onChange={(event) =>
                                    setDraftName(event.target.value)
                                }
                                onBlur={() => commitName(tab._id)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter')
                                        event.currentTarget.blur();
                                    if (event.key === 'Escape')
                                        setEditingTabId(null);
                                }}
                                aria-label={t('tabs.rename', {
                                    name: tab.name,
                                })}
                            />
                        ) : (
                            <span className="board-tab-name">{tab.name}</span>
                        )}
                    </div>
                    <details className="board-tab-menu">
                        <summary
                            title={t('tabs.customize', { name: tab.name })}
                        >
                            •••
                        </summary>
                        <div className="board-tab-popover">
                            <span>{t('tabs.colorLabel')}</span>
                            <div className="board-tab-options">
                                {TAB_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        className={
                                            tab.color === color
                                                ? 'is-selected'
                                                : ''
                                        }
                                        style={{ backgroundColor: color }}
                                        onClick={() =>
                                            onCustomizeTab(tab._id, { color })
                                        }
                                        aria-label={t('card.color.swatch', {
                                            color,
                                        })}
                                    />
                                ))}
                            </div>
                            <label className="board-tab-custom-color">
                                <span>{t('card.color.custom')}</span>
                                <input
                                    type="color"
                                    value={tab.color}
                                    onChange={(event) =>
                                        onCustomizeTab(tab._id, {
                                            color: event.target.value,
                                        })
                                    }
                                    aria-label={t('tabs.customColorFor', {
                                        name: tab.name,
                                    })}
                                />
                            </label>
                            <span>{t('tabs.iconLabel')}</span>
                            <div className="board-tab-icon-options">
                                {TAB_EMOJIS.map((emoji) => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        className={
                                            tab.icon === emoji
                                                ? 'is-selected'
                                                : ''
                                        }
                                        onClick={() =>
                                            onCustomizeTab(tab._id, {
                                                icon: emoji,
                                            })
                                        }
                                        aria-label={t('tabs.pickIcon', {
                                            emoji,
                                        })}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                            <button
                                className="board-tab-delete"
                                type="button"
                                disabled={tabs.length <= 1}
                                onClick={() => {
                                    if (
                                        window.confirm(
                                            t('tabs.deleteConfirm', {
                                                name: tab.name,
                                            })
                                        )
                                    ) {
                                        onDeleteTab(tab._id);
                                    }
                                }}
                            >
                                <TrashIcon /> {t('card.tool.delete')}
                            </button>
                        </div>
                    </details>
                </div>
            ))}
            <button className="board-tab-add" type="button" onClick={onAddTab}>
                <PlusIcon />
                <span>{t('tabs.newBoard')}</span>
            </button>
        </nav>
    );
};

export default BoardTabs;
