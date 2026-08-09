import {
    EllipsisHorizontalIcon,
    PencilIcon,
    PlusIcon,
    TrashIcon,
} from '@heroicons/react/24/solid';
import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { BoardTab } from '../../types/boardTypes';
import { useT } from '../../i18n/LangContext';
import { useDismiss } from '../../hooks/useDismiss';

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

const POPOVER_VIEWPORT_PADDING = 8;
const POPOVER_GAP = 8;

type TabDropPosition = 'before' | 'after';
type TabDropTarget = {
    tabId: string;
    position: TabDropPosition;
};
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
    onReorderTabs: (
        draggedTabId: string,
        targetTabId: string,
        position: TabDropPosition
    ) => void;
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
    const [openMenuTabId, setOpenMenuTabId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<TabDropTarget | null>(null);
    const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(
        () => new Set()
    );
    const tabsRef = useRef<HTMLElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const popoverAnchorRef = useRef<HTMLElement | null>(null);

    useDismiss(openMenuTabId !== null, tabsRef, () => setOpenMenuTabId(null));

    // Clear tab selection when clicking outside the sidebar.
    useEffect(() => {
        if (selectedTabIds.size === 0) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!tabsRef.current?.contains(event.target as Node)) {
                setSelectedTabIds(new Set());
            }
        };
        window.addEventListener('pointerdown', handlePointerDown);
        return () =>
            window.removeEventListener('pointerdown', handlePointerDown);
    }, [selectedTabIds.size]);

    // Delete selected tabs on Delete/Backspace when the sidebar has focus.
    useEffect(() => {
        if (selectedTabIds.size === 0) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Delete' && event.key !== 'Backspace') return;
            const target = event.target as HTMLElement;
            if (target.closest('input, textarea, select, [contenteditable]'))
                return;
            event.preventDefault();
            const toDelete = [...selectedTabIds];
            // Must keep at least one tab.
            if (tabs.length - toDelete.length < 1) return;
            setSelectedTabIds(new Set());
            toDelete.forEach((id) => onDeleteTab(id));
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedTabIds, tabs.length, onDeleteTab]);

    const clearDragState = () => {
        setDraggedTabId(null);
        setDropTarget(null);
    };

    const handleTabDragStart = (
        event: React.DragEvent<HTMLDivElement>,
        tabId: string
    ) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, input, summary, details')) {
            event.preventDefault();
            return;
        }

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', tabId);
        setDraggedTabId(tabId);
        setDropTarget(null);
    };

    const handleTabDragOver = (
        event: React.DragEvent<HTMLDivElement>,
        tabId: string
    ) => {
        if (!draggedTabId || draggedTabId === tabId) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        const position: TabDropPosition =
            event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        setDropTarget((current) =>
            current?.tabId === tabId && current.position === position
                ? current
                : { tabId, position }
        );
    };

    const handleTabDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        const relatedTarget = event.relatedTarget as Node | null;
        if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) {
            setDropTarget(null);
        }
    };

    const handleTabDrop = (
        event: React.DragEvent<HTMLDivElement>,
        tabId: string
    ) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const position: TabDropPosition =
            dropTarget?.tabId === tabId
                ? dropTarget.position
                : event.clientY < rect.top + rect.height / 2
                  ? 'before'
                  : 'after';
        if (draggedTabId && draggedTabId !== tabId) {
            onReorderTabs(draggedTabId, tabId, position);
        }
        setOpenMenuTabId(null);
        clearDragState();
    };

    const positionOpenPopover = useCallback(() => {
        const popover = popoverRef.current;
        const anchor = popoverAnchorRef.current;
        if (!popover || !anchor) return;

        const anchorRect = anchor.getBoundingClientRect();
        const popoverWidth = popover.offsetWidth;
        const popoverHeight = popover.offsetHeight;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight;
        const padding = POPOVER_VIEWPORT_PADDING;

        const maxLeft = Math.max(
            padding,
            viewportWidth - popoverWidth - padding
        );
        const left = Math.min(
            Math.max(padding, anchorRect.right + POPOVER_GAP),
            maxLeft
        );

        const maxTop = Math.max(
            padding,
            viewportHeight - popoverHeight - padding
        );
        const belowTop = anchorRect.bottom + POPOVER_GAP;
        const aboveTop = anchorRect.top - popoverHeight - POPOVER_GAP;
        const top =
            belowTop <= maxTop
                ? belowTop
                : Math.min(Math.max(padding, aboveTop), maxTop);

        popover.style.setProperty('--popover-left', `${left}px`);
        popover.style.setProperty('--popover-top', `${top}px`);
    }, []);

    useLayoutEffect(() => {
        if (!openMenuTabId) return;

        positionOpenPopover();
        const handleViewportChange = () => positionOpenPopover();

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        window.visualViewport?.addEventListener('resize', handleViewportChange);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
            window.visualViewport?.removeEventListener(
                'resize',
                handleViewportChange
            );
        };
    }, [openMenuTabId, positionOpenPopover]);

    const startRenaming = (tab: BoardTab) => {
        setDraftName(tab.name);
        setEditingTabId(tab._id);
    };

    const commitName = (tabId: string) => {
        onRenameTab(tabId, draftName);
        setEditingTabId(null);
    };

    return (
        <nav
            ref={tabsRef}
            className="board-tabs app-scrollbar"
            aria-label={t('tabs.aria')}
        >
            {tabs.map((tab) => (
                <div
                    key={tab._id}
                    className={`board-tab ${tab._id === activeTabId ? 'is-active' : ''} ${draggedTabId === tab._id ? 'is-dragging' : ''} ${selectedTabIds.has(tab._id) ? 'is-selected' : ''}`}
                    style={{ '--tab-color': tab.color } as React.CSSProperties}
                    data-drop-position={
                        dropTarget?.tabId === tab._id
                            ? dropTarget.position
                            : undefined
                    }
                    draggable
                    aria-grabbed={draggedTabId === tab._id}
                    onDragStart={(event) => handleTabDragStart(event, tab._id)}
                    onDragEnd={clearDragState}
                    onDragOver={(event) => handleTabDragOver(event, tab._id)}
                    onDragLeave={handleTabDragLeave}
                    onDrop={(event) => handleTabDrop(event, tab._id)}
                >
                    <div
                        className="board-tab-select"
                        onClick={(event) => {
                            if (event.ctrlKey || event.metaKey) {
                                // Ctrl/Cmd+click: toggle this tab in the
                                // multi-selection without switching boards.
                                event.preventDefault();
                                setSelectedTabIds((current) => {
                                    const next = new Set(current);
                                    if (next.has(tab._id)) next.delete(tab._id);
                                    else next.add(tab._id);
                                    return next;
                                });
                                return;
                            }
                            setSelectedTabIds(new Set());
                            setOpenMenuTabId(null);
                            onSelectTab(tab._id);
                        }}
                        onDoubleClick={() => startRenaming(tab)}
                        onKeyDown={(event) => {
                            if (
                                event.target === event.currentTarget &&
                                (event.key === 'Enter' || event.key === ' ')
                            ) {
                                event.preventDefault();
                                setOpenMenuTabId(null);
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
                    <details
                        className="board-tab-menu"
                        open={openMenuTabId === tab._id}
                    >
                        <summary
                            title={t('tabs.customize', { name: tab.name })}
                            aria-label={t('tabs.customize', {
                                name: tab.name,
                            })}
                            onClick={(event) => {
                                event.preventDefault();
                                popoverAnchorRef.current = event.currentTarget;
                                setOpenMenuTabId((current) =>
                                    current === tab._id ? null : tab._id
                                );
                            }}
                        >
                            <EllipsisHorizontalIcon aria-hidden="true" />
                        </summary>
                        <div
                            ref={
                                openMenuTabId === tab._id
                                    ? popoverRef
                                    : undefined
                            }
                            className="board-tab-popover app-scrollbar"
                        >
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
                                <label
                                    className="board-tab-custom-color"
                                    title={t('card.color.custom')}
                                >
                                    <PencilIcon aria-hidden="true" />
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
                            </div>
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
            <button
                className="board-tab-add"
                type="button"
                onClick={onAddTab}
                aria-label={t('tabs.newBoard')}
            >
                <PlusIcon />
                <span>{t('tabs.newBoard')}</span>
            </button>
        </nav>
    );
};

export default BoardTabs;
